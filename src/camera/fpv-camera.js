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
} = {}) {
  if (!camera) {
    throw new Error("attachFpvCamera requires a camera instance");
  }

  const Vector3Ctor = camera.position.constructor;

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
  };

  const scratch = {
    localOffset,
    ambientPosition: new Vector3Ctor(),
    resolvedAmbient: null,
  };

  const resolveAmbientOffsets = (ambientOffsets) => {
    if (ambientOffsets) {
      return ambientOffsets;
    }
    if (state.flightController && typeof state.flightController.getAmbientOffsets === "function") {
      return state.flightController.getAmbientOffsets();
    }
    return null;
  };

  const updateTargetFromPose = ({ pose, ambientOffsets }) => {
    if (!pose || !pose.position || !pose.quaternion) {
      return false;
    }

    scratch.localOffset.copy(localOffset).applyQuaternion(pose.quaternion);

    state.targetPosition.copy(pose.position).add(scratch.localOffset);
    state.targetQuaternion.copy(pose.quaternion);

    scratch.resolvedAmbient = resolveAmbientOffsets(ambientOffsets);
    if (scratch.resolvedAmbient?.position) {
      state.targetPosition.add(scratch.ambientPosition.copy(scratch.resolvedAmbient.position));
    }
    if (scratch.resolvedAmbient?.quaternion) {
      state.targetQuaternion.multiply(scratch.resolvedAmbient.quaternion);
    }

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

  const applyDirect = () => {
    camera.position.copy(state.targetPosition);
    camera.quaternion.copy(state.targetQuaternion);
  };

  return {
    activateBlend() {
      state.blending = true;
      state.blendElapsed = 0;
      state.startPosition.copy(camera.position);
      state.startQuaternion.copy(camera.quaternion);
    },
    reset() {
      state.blending = false;
      state.blendElapsed = 0;
    },
    update({ pose, ambientOffsets, delta } = {}) {
      if (!updateTargetFromPose({ pose, ambientOffsets })) {
        return;
      }

      if (state.blending) {
        applyBlend(delta);
      } else {
        applyDirect();
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
