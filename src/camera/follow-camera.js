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
    noRollQuaternion: new Quaternion(),
    viewDir: new Vector3(),
    stableUp: new Vector3(),
    stableRight: new Vector3(),
  };

  // Compute a stable up vector that avoids gimbal lock when looking near poles.
  // When the view direction is nearly parallel to the up vector, the lookAt
  // matrix becomes degenerate. We fix this by deriving a stable up from the
  // camera's current right vector.
  function computeStableUp(position, lookAt, preferredUp, currentOrientation) {
    scratch.viewDir.subVectors(lookAt, position);
    const viewLength = scratch.viewDir.length();
    if (viewLength < 1e-6) {
      return preferredUp;
    }
    scratch.viewDir.divideScalar(viewLength);

    // Check if view direction is nearly parallel to preferred up (gimbal lock zone)
    const parallelism = Math.abs(scratch.viewDir.dot(preferredUp));
    if (parallelism < 0.99) {
      // Safe zone - use preferred up
      return preferredUp;
    }

    // Near gimbal lock - compute stable up from current camera orientation
    // Get the current right vector from the camera's orientation
    scratch.stableRight.set(1, 0, 0).applyQuaternion(currentOrientation);

    // Compute a new up that's perpendicular to both view direction and right
    scratch.stableUp.crossVectors(scratch.stableRight, scratch.viewDir);
    if (scratch.stableUp.lengthSq() < 1e-6) {
      // Fallback: right was also parallel, use world Z to derive up
      scratch.stableRight.set(0, 0, 1);
      scratch.stableUp.crossVectors(scratch.stableRight, scratch.viewDir);
    }
    scratch.stableUp.normalize();

    return scratch.stableUp;
  }

  const state = {
    camera: null,
    initialized: false,
    offset: options.offset ? options.offset.clone() : new Vector3(0, 1.0, 3.0),
    position: new Vector3(),
    lookAt: new Vector3(),
    desiredPosition: new Vector3(),
    desiredLookAt: new Vector3(),
    positionDamping: options.positionDamping ?? 0.12,
    lookAtDamping: options.lookAtDamping ?? 0.15,
    rotationDamping: options.rotationDamping ?? 0.12,
    velocityLookAhead: options.velocityLookAhead ?? 0.25,
    steeringLookAhead: {
      yaw: options.steeringLookAhead?.yaw ?? 0.45,
      pitch: options.steeringLookAhead?.pitch ?? 0.35,
    },
    orientation: new Quaternion(),
    targetOrientation: new Quaternion(),
    up: new Vector3(0, 1, 0),
    // Spherical world support: when set, "up" becomes radial from sphere center
    sphereCenter: options.sphereCenter ? options.sphereCenter.clone() : null,
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
      state.steeringLookAhead.yaw =
        config.steeringLookAhead.yaw ?? config.steeringLookAhead.strafe ?? state.steeringLookAhead.yaw;
      state.steeringLookAhead.pitch =
        config.steeringLookAhead.pitch ?? config.steeringLookAhead.lift ?? state.steeringLookAhead.pitch;
    }
    // Handle sphereCenter configuration
    if (config.sphereCenter !== undefined) {
      if (config.sphereCenter === null) {
        state.sphereCenter = null;
      } else if (config.sphereCenter && typeof config.sphereCenter.clone === 'function') {
        state.sphereCenter = config.sphereCenter.clone();
      }
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

    // Get bird's forward direction from its quaternion
    // In THREE.js, default forward is -Z
    if (pose.quaternion) {
      scratch.forward.set(0, 0, -1).applyQuaternion(pose.quaternion);
      if (scratch.forward.lengthSq() < 1e-6) {
        scratch.forward.set(0, 0, -1);
      } else {
        scratch.forward.normalize();
      }
    } else {
      scratch.forward.set(0, 0, -1);
    }

    // Compute local "up" direction
    // For spherical worlds: up is radial from sphere center
    // For flat worlds: up is world Y axis (0, 1, 0)
    if (state.sphereCenter) {
      state.up.copy(pose.position).sub(state.sphereCenter);
      if (state.up.lengthSq() < 1e-6) {
        state.up.set(0, 1, 0);
      } else {
        state.up.normalize();
      }
    } else {
      state.up.set(0, 1, 0);
    }

    // Camera positioning using the user's reference formula:
    // Camera.Position = Bird.Position - (Bird.Forward * Distance) + (Up * Height)
    // offset.z = distance behind, offset.y = height above
    const distanceBehind = Math.abs(state.offset.z);
    const heightAbove = state.offset.y;

    // Start with bird position (plus ambient bob if any)
    state.desiredPosition.copy(pose.position);
    if (ambientOffsets?.position) {
      state.desiredPosition.add(ambientOffsets.position);
    }

    // Place camera BEHIND the bird (subtract forward direction)
    state.desiredPosition.addScaledVector(scratch.forward, -distanceBehind);
    // Place camera ABOVE the bird (in local up direction for spherical worlds)
    state.desiredPosition.addScaledVector(state.up, heightAbove);

    // Camera look-at target: bird position (with ambient offset)
    state.desiredLookAt.copy(pose.position);
    if (ambientOffsets?.position) {
      state.desiredLookAt.add(ambientOffsets.position);
    }

    // Add look-ahead anticipation so camera looks where bird is going
    // Reference: Camera.LookAt = Bird.Position + (Bird.Forward * LeadDistance)
    scratch.anticipation.set(0, 0, 0);

    // Velocity-based look-ahead: look further ahead when moving faster
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

    // Steering-based anticipation: look toward where user is steering
    if (steering) {
      // Compute right vector from forward and world up
      scratch.right.crossVectors(scratch.forward, state.up);
      if (scratch.right.lengthSq() < 1e-6) {
        scratch.right.set(1, 0, 0);
      } else {
        scratch.right.normalize();
      }
      // Compute local up from right and forward
      scratch.up.crossVectors(scratch.right, scratch.forward).normalize();

      const steeringYaw = Number.isFinite(steering.yaw)
        ? steering.yaw
        : steering.strafe;
      const steeringPitch = Number.isFinite(steering.pitch)
        ? steering.pitch
        : steering.lift;

      if (Number.isFinite(steeringYaw) && steeringYaw !== 0) {
        scratch.anticipation.addScaledVector(
          scratch.right,
          state.steeringLookAhead.yaw * steeringYaw,
        );
      }
      if (Number.isFinite(steeringPitch) && steeringPitch !== 0) {
        scratch.anticipation.addScaledVector(
          scratch.up,
          state.steeringLookAhead.pitch * steeringPitch,
        );
      }
    }

    // Add base forward look-ahead so camera always looks ahead of the bird
    const baseLookAhead = distanceBehind * 0.5;
    scratch.anticipation.addScaledVector(scratch.forward, baseLookAhead);

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
    // Use stable up to avoid gimbal lock at poles
    const upForLookAt = computeStableUp(state.position, state.lookAt, state.up, state.orientation);
    scratch.lookMatrix.lookAt(state.position, state.lookAt, upForLookAt);
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

    // Use stable up to avoid gimbal lock at poles
    const upForLookAt = computeStableUp(state.position, state.lookAt, state.up, state.orientation);
    scratch.lookMatrix.lookAt(state.position, state.lookAt, upForLookAt);
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
