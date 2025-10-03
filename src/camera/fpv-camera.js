const easeInOutCubic = (t) => {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
};

export function attachFpvCamera({
  camera,
  flightController,
  offset,
  blendDuration = 0.24,
  positionDamping = 0,
  rotationDamping = 0,
  rollInfluence = 1,
} = {}) {
  if (!camera) {
    throw new Error("attachFpvCamera requires a camera instance");
  }

  const Vector3Ctor = camera.position.constructor;
  const QuaternionCtor = camera.quaternion.constructor;
  const EulerCtor =
    (camera.rotation && camera.rotation.constructor) ||
    flightController?.euler?.constructor ||
    null;

  const localOffset = offset && typeof offset.clone === "function"
    ? offset.clone()
    : new Vector3Ctor(0, 0.12, -0.35);

  const state = {
    flightController,
    blendDuration: Number.isFinite(blendDuration) && blendDuration > 0 ? blendDuration : 0.2,
    blending: false,
    blendElapsed: 0,
    startPosition: camera.position.clone(),
    startQuaternion: camera.quaternion.clone(),
    targetPosition: camera.position.clone(),
    targetQuaternion: camera.quaternion.clone(),
    positionDamping: Number.isFinite(positionDamping) && positionDamping > 0 ? positionDamping : 0,
    rotationDamping: Number.isFinite(rotationDamping) && rotationDamping > 0 ? rotationDamping : 0,
    rollInfluence: Math.min(
      Math.max(Number.isFinite(rollInfluence) ? rollInfluence : 1, 0),
      1,
    ),
    firstUpdate: true,
    lastPosePosition: camera.position.clone(),
    lastPoseQuaternion: camera.quaternion.clone(),
    positionEpsilonSq: 1e-6,
    orientationEpsilon: 1e-5,
  };

  const scratch = {
    localOffset:
      typeof localOffset.clone === "function"
        ? localOffset.clone()
        : new Vector3Ctor(),
    orientation: new QuaternionCtor(),
    euler: EulerCtor ? new EulerCtor(0, 0, 0, "YXZ") : null,
    candidatePosition: new Vector3Ctor(),
  };

  const updateTargetFromPose = ({ pose, ambientOffsets }) => {
    if (!pose || !pose.position || !pose.quaternion) {
      return false;
    }

    scratch.orientation.copy(pose.quaternion);

    if (scratch.euler && state.rollInfluence < 1) {
      scratch.euler.setFromQuaternion(scratch.orientation, "YXZ");
      scratch.euler.z *= state.rollInfluence;
      scratch.orientation.setFromEuler(scratch.euler);
    }

    scratch.localOffset.copy(localOffset).applyQuaternion(scratch.orientation);

    scratch.candidatePosition
      .copy(pose.position)
      .add(scratch.localOffset);

    const positionDeltaSq = scratch.candidatePosition.distanceToSquared(
      state.lastPosePosition,
    );
    const dot = Math.min(
      Math.max(Math.abs(state.lastPoseQuaternion.dot(scratch.orientation)), 0),
      1,
    );
    const orientationDelta = 1 - dot;

    const hasMeaningfulChange =
      positionDeltaSq > state.positionEpsilonSq || orientationDelta > state.orientationEpsilon;

    if (hasMeaningfulChange) {
      state.targetPosition.copy(scratch.candidatePosition);
      state.targetQuaternion.copy(scratch.orientation);
      state.lastPosePosition.copy(state.targetPosition);
      state.lastPoseQuaternion.copy(state.targetQuaternion);
    } else {
      state.targetPosition.copy(state.lastPosePosition);
      state.targetQuaternion.copy(state.lastPoseQuaternion);
    }

    // Skipping ambient position offsets avoids injecting the subtle idle bob used for
    // third-person cameras. The additional vertical motion felt jittery in first-person
    // and was a frequent source of motion sickness reports, so we keep the view locked
    // tightly to the capsule while in FPV mode.

    // Applying the ambient rotation offsets in first-person produced large, disorienting
    // spins while blending between camera poses. The ambient quaternion is only used to
    // add a subtle wobble for third-person views, so we intentionally skip it here to keep
    // the FPV orientation stable.

    return true;
  };

  const applyBlend = (delta) => {
    const timeStep = Number.isFinite(delta) && delta > 0 ? delta : 1 / 60;
    state.blendElapsed += timeStep;
    const progress = Math.min(state.blendElapsed / state.blendDuration, 1);
    const eased = easeInOutCubic(progress);

    camera.position.copy(state.startPosition).lerp(state.targetPosition, eased);
    camera.quaternion.copy(state.startQuaternion).slerp(state.targetQuaternion, eased);

    if (progress >= 1) {
      state.blending = false;
    }
  };

  const getDampedAlpha = (lambda, delta) => {
    if (!Number.isFinite(lambda) || lambda <= 0) {
      return 1;
    }
    const step = Number.isFinite(delta) && delta > 0 ? delta : 1 / 60;
    return 1 - Math.exp(-lambda * step);
  };

  const applyDamped = (delta) => {
    const positionAlpha = getDampedAlpha(state.positionDamping, delta);
    const rotationAlpha = getDampedAlpha(state.rotationDamping, delta);

    if (positionAlpha >= 1) {
      camera.position.copy(state.targetPosition);
    } else {
      camera.position.lerp(state.targetPosition, positionAlpha);
    }

    if (rotationAlpha >= 1) {
      camera.quaternion.copy(state.targetQuaternion);
    } else {
      camera.quaternion.slerp(state.targetQuaternion, rotationAlpha);
    }
  };

  return {
    activateBlend() {
      state.blending = true;
      state.blendElapsed = 0;
      state.startPosition.copy(camera.position);
      state.startQuaternion.copy(camera.quaternion);
      state.firstUpdate = false;
      state.lastPosePosition.copy(camera.position);
      state.lastPoseQuaternion.copy(camera.quaternion);
    },
    reset() {
      state.blending = false;
      state.blendElapsed = 0;
      state.firstUpdate = true;
      state.lastPosePosition.copy(camera.position);
      state.lastPoseQuaternion.copy(camera.quaternion);
    },
    update({ pose, ambientOffsets, delta } = {}) {
      if (!updateTargetFromPose({ pose, ambientOffsets })) {
        return;
      }

      if (state.firstUpdate) {
        camera.position.copy(state.targetPosition);
        camera.quaternion.copy(state.targetQuaternion);
        state.firstUpdate = false;
        state.lastPosePosition.copy(state.targetPosition);
        state.lastPoseQuaternion.copy(state.targetQuaternion);
        return;
      }

      if (state.blending) {
        applyBlend(delta);
      } else {
        applyDamped(delta);
      }
    },
    getSnapshot() {
      return {
        position: state.targetPosition.clone(),
        quaternion: state.targetQuaternion.clone(),
      };
    },
  };
}
