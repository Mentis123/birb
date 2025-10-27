export function createFollowCameraRig(three, options = {}) {
  if (!three) {
    throw new Error("createFollowCameraRig requires the THREE namespace");
  }

  const {
    Vector3,
    Quaternion,
    Matrix4,
    PerspectiveCamera,
  } = three;

  const clamp01 = (value) => Math.min(Math.max(value, 0), 1);
  const resolveWeight = (damping, deltaSteps) => {
    if (!Number.isFinite(damping) || damping <= 0) {
      return 0;
    }
    const step = Number.isFinite(deltaSteps) ? Math.max(deltaSteps, 0) : 0;
    if (step <= 0) {
      return clamp01(damping);
    }
    const normalized = Math.min(step * 60, 1);
    const constrained = clamp01(damping);
    return 1 - Math.pow(1 - constrained, normalized);
  };

  const scratch = {
    offset: new Vector3(),
    anticipation: new Vector3(),
    velocity: new Vector3(),
    forward: new Vector3(0, 0, -1),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    lookMatrix: new Matrix4(),
    lookDirection: new Vector3(),
    lookTarget: new Vector3(),
  };

  const state = {
    camera: null,
    initialized: false,
    offset: options.offset ? options.offset.clone() : new Vector3(0, 1.2, 2.5),
    position: new Vector3(),
    lookAt: new Vector3(),
    desiredPosition: new Vector3(),
    desiredLookAt: new Vector3(),
    positionDamping: options.positionDamping ?? 0.12,
    lookAtDamping: options.lookAtDamping ?? 0.15,
    rotationDamping: options.rotationDamping ?? 0.12,
    velocityLookAhead: options.velocityLookAhead ?? 0.25,
    steeringLookAhead: {
      forward: options.steeringLookAhead?.forward ?? 0.45,
      strafe: options.steeringLookAhead?.strafe ?? 0.35,
      lift: options.steeringLookAhead?.lift ?? 0.25,
    },
    orientation: new Quaternion(),
    targetOrientation: new Quaternion(),
    up: new Vector3(0, 1, 0),
  };

  function assertCamera(camera) {
    if (!camera) {
      return null;
    }
    if (!(camera instanceof PerspectiveCamera)) {
      throw new Error("Follow camera rig expects a PerspectiveCamera instance");
    }
    return camera;
  }

  function configure(config = {}) {
    if (config.offset) {
      state.offset.copy(config.offset);
    }
    if (Number.isFinite(config.positionDamping)) {
      state.positionDamping = clamp01(config.positionDamping);
    }
    if (Number.isFinite(config.lookAtDamping)) {
      state.lookAtDamping = clamp01(config.lookAtDamping);
    }
    if (Number.isFinite(config.rotationDamping)) {
      state.rotationDamping = clamp01(config.rotationDamping);
    }
    if (Number.isFinite(config.velocityLookAhead)) {
      state.velocityLookAhead = config.velocityLookAhead;
    }
    if (config.steeringLookAhead) {
      state.steeringLookAhead.forward =
        config.steeringLookAhead.forward ?? state.steeringLookAhead.forward;
      state.steeringLookAhead.strafe =
        config.steeringLookAhead.strafe ?? state.steeringLookAhead.strafe;
      state.steeringLookAhead.lift =
        config.steeringLookAhead.lift ?? state.steeringLookAhead.lift;
    }
  }

  function attach(camera, config) {
    const perspective = assertCamera(camera);
    if (!perspective) {
      return;
    }
    state.camera = perspective;
    if (config) {
      configure(config);
    }
    state.initialized = false;
  }

  function computeTargets({ pose, velocity, ambientOffsets, steering }) {
    if (!pose) {
      return false;
    }

    state.desiredLookAt.copy(pose.position);
    if (ambientOffsets?.position) {
      state.desiredLookAt.add(ambientOffsets.position);
    }

    scratch.offset.copy(state.offset);
    if (pose.quaternion) {
      scratch.offset.applyQuaternion(pose.quaternion);
    }

    state.desiredPosition.copy(state.desiredLookAt).add(scratch.offset);

    scratch.anticipation.set(0, 0, 0);

    if (velocity) {
      scratch.velocity.copy(velocity);
      const velocityLength = scratch.velocity.length();
      if (velocityLength > 0.0001) {
        scratch.velocity.normalize();
        scratch.anticipation.addScaledVector(
          scratch.velocity,
          state.velocityLookAhead * velocityLength,
        );
      }
    }

    if (steering) {
      if (pose.quaternion) {
        scratch.forward.set(0, 0, -1).applyQuaternion(pose.quaternion);
        scratch.right.set(1, 0, 0).applyQuaternion(pose.quaternion);
        scratch.up.set(0, 1, 0).applyQuaternion(pose.quaternion);
      }
      if (Number.isFinite(steering.forward) && steering.forward !== 0) {
        scratch.anticipation.addScaledVector(
          scratch.forward,
          state.steeringLookAhead.forward * steering.forward,
        );
      }
      if (Number.isFinite(steering.strafe) && steering.strafe !== 0) {
        scratch.anticipation.addScaledVector(
          scratch.right,
          state.steeringLookAhead.strafe * steering.strafe,
        );
      }
      if (Number.isFinite(steering.lift) && steering.lift !== 0) {
        scratch.anticipation.addScaledVector(
          scratch.up,
          state.steeringLookAhead.lift * steering.lift,
        );
      }
    }

    if (scratch.anticipation.lengthSq() > 0) {
      state.desiredLookAt.add(scratch.anticipation);
    }

    return true;
  }

  function reset({ camera = state.camera, pose, velocity, ambientOffsets, steering } = {}) {
    const perspective = assertCamera(camera);
    if (!perspective) {
      return;
    }

    if (!computeTargets({ pose, velocity, ambientOffsets, steering })) {
      state.initialized = false;
      return;
    }

    state.position.copy(state.desiredPosition);
    state.lookAt.copy(state.desiredLookAt);
    scratch.lookMatrix.lookAt(state.position, state.lookAt, state.up);
    state.orientation.setFromRotationMatrix(scratch.lookMatrix);

    perspective.position.copy(state.position);
    perspective.quaternion.copy(state.orientation);
    scratch.lookDirection.set(0, 0, -1).applyQuaternion(state.orientation);
    scratch.lookTarget.copy(state.position).add(scratch.lookDirection);
    perspective.lookAt(scratch.lookTarget);

    state.initialized = true;
  }

  function updateFromPose({
    camera = state.camera,
    pose,
    velocity,
    ambientOffsets,
    steering,
    delta,
  } = {}) {
    const perspective = assertCamera(camera);
    if (!perspective || !computeTargets({ pose, velocity, ambientOffsets, steering })) {
      return null;
    }

    if (!state.initialized) {
      reset({ camera: perspective, pose, velocity, ambientOffsets, steering });
      return {
        position: state.position.clone(),
        lookAt: state.lookAt.clone(),
      };
    }

    const positionAlpha = resolveWeight(state.positionDamping, delta);
    const lookAtAlpha = resolveWeight(state.lookAtDamping, delta);
    const rotationAlpha = resolveWeight(state.rotationDamping, delta);

    state.position.lerp(state.desiredPosition, positionAlpha);
    state.lookAt.lerp(state.desiredLookAt, lookAtAlpha);

    perspective.position.copy(state.position);

    scratch.lookMatrix.lookAt(state.position, state.lookAt, state.up);
    state.targetOrientation.setFromRotationMatrix(scratch.lookMatrix);
    state.orientation.slerp(state.targetOrientation, rotationAlpha);
    perspective.quaternion.copy(state.orientation);
    scratch.lookDirection.set(0, 0, -1).applyQuaternion(state.orientation);
    scratch.lookTarget.copy(state.position).add(scratch.lookDirection);
    perspective.lookAt(scratch.lookTarget);

    return {
      position: state.position.clone(),
      lookAt: state.lookAt.clone(),
    };
  }

  function getDebugState() {
    return {
      position: state.position.clone(),
      lookAt: state.lookAt.clone(),
      offset: state.offset.clone(),
      offsetMagnitude: state.offset.length(),
      positionDamping: state.positionDamping,
      lookAtDamping: state.lookAtDamping,
      rotationDamping: state.rotationDamping,
      velocityLookAhead: state.velocityLookAhead,
      steeringLookAhead: { ...state.steeringLookAhead },
    };
  }

  return {
    attach,
    configure,
    reset,
    updateFromPose,
    getDebugState,
  };
}
