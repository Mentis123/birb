export function createSequenceCameraRig(three, options = {}) {
  if (!three) {
    throw new Error("createSequenceCameraRig requires the THREE namespace");
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
    anchor: new Vector3(),
    lookMatrix: new Matrix4(),
    lookDirection: new Vector3(),
    lookTarget: new Vector3(),
  };

  const state = {
    camera: null,
    initialized: false,
    position: new Vector3(),
    desiredPosition: new Vector3(),
    lookAt: new Vector3(),
    desiredLookAt: new Vector3(),
    orientation: new Quaternion(),
    targetOrientation: new Quaternion(),
    up: new Vector3(0, 1, 0),
    orbitAngle: 0,
    timeScale: options.timeScale ?? 1,
    orbitSpeed: options.orbitSpeed ?? 0.22,
    orbitRadius: options.orbitRadius ?? 4.6,
    verticalBias: options.verticalBias ?? 1.52,
    verticalAmplitude: options.verticalAmplitude ?? 0.42,
    verticalFrequency: options.verticalFrequency ?? 1.1,
    ambientPositionInfluence: clamp01(
      options.ambientPositionInfluence ?? 0.18,
    ),
    anchorOffset: options.anchorOffset
      ? options.anchorOffset.clone()
      : new Vector3(0, 0, 0),
    lookAtOffset: options.lookAtOffset
      ? options.lookAtOffset.clone()
      : new Vector3(0, 0.6, 0),
    positionDamping: options.positionDamping ?? 0.18,
    lookAtDamping: options.lookAtDamping ?? 0.2,
    rotationDamping: options.rotationDamping ?? 0.18,
  };

  function assertCamera(camera) {
    if (!camera) {
      return null;
    }
    if (!(camera instanceof PerspectiveCamera)) {
      throw new Error("Sequence camera rig expects a PerspectiveCamera instance");
    }
    return camera;
  }

  function configure(config = {}) {
    if (!config) {
      return;
    }
    if (config.anchorOffset) {
      state.anchorOffset.copy(config.anchorOffset);
    }
    if (config.lookAtOffset) {
      state.lookAtOffset.copy(config.lookAtOffset);
    }
    if (Number.isFinite(config.orbitSpeed)) {
      state.orbitSpeed = config.orbitSpeed;
    }
    if (Number.isFinite(config.timeScale)) {
      state.timeScale = config.timeScale;
    }
    if (Number.isFinite(config.orbitRadius)) {
      state.orbitRadius = config.orbitRadius;
    }
    if (Number.isFinite(config.verticalBias)) {
      state.verticalBias = config.verticalBias;
    }
    if (Number.isFinite(config.verticalAmplitude)) {
      state.verticalAmplitude = config.verticalAmplitude;
    }
    if (Number.isFinite(config.verticalFrequency)) {
      state.verticalFrequency = config.verticalFrequency;
    }
    if (Number.isFinite(config.ambientPositionInfluence)) {
      state.ambientPositionInfluence = clamp01(
        config.ambientPositionInfluence,
      );
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

  function getAnchor(pose, ambientOffsets) {
    scratch.anchor.set(0, 0.6, 0);
    if (pose?.position) {
      scratch.anchor.copy(pose.position);
    }
    if (ambientOffsets?.position && state.ambientPositionInfluence > 0) {
      scratch.anchor.addScaledVector(
        ambientOffsets.position,
        state.ambientPositionInfluence,
      );
    }
    scratch.anchor.add(state.anchorOffset);
    return scratch.anchor;
  }

  function computeTargets({ pose, ambientOffsets, delta = 0 }) {
    const step = Number.isFinite(delta) && delta > 0 ? delta : 0;
    const anchor = getAnchor(pose, ambientOffsets);

    state.orbitAngle += state.orbitSpeed * state.timeScale * step;
    if (!Number.isFinite(state.orbitAngle)) {
      state.orbitAngle = 0;
    }

    const angle = state.orbitAngle;
    const verticalAngle = angle * state.verticalFrequency;

    state.desiredPosition.set(
      Math.cos(angle) * state.orbitRadius,
      state.verticalBias + Math.sin(verticalAngle) * state.verticalAmplitude,
      Math.sin(angle) * state.orbitRadius,
    );

    state.desiredPosition.add(anchor);

    state.desiredLookAt.copy(anchor).add(state.lookAtOffset);
  }

  function reset({
    camera = state.camera,
    pose,
    ambientOffsets,
  } = {}) {
    const perspective = assertCamera(camera);
    if (!perspective) {
      return;
    }

    computeTargets({ pose, ambientOffsets, delta: 0 });

    state.position.copy(state.desiredPosition);
    state.lookAt.copy(state.desiredLookAt);

    scratch.lookMatrix.lookAt(state.position, state.lookAt, state.up);
    state.orientation.setFromRotationMatrix(scratch.lookMatrix);

    perspective.position.copy(state.position);
    perspective.quaternion.copy(state.orientation);
    scratch.lookDirection
      .set(0, 0, -1)
      .applyQuaternion(state.orientation);
    scratch.lookTarget.copy(state.position).add(scratch.lookDirection);
    perspective.lookAt(scratch.lookTarget);

    state.initialized = true;
  }

  function update({
    camera = state.camera,
    pose,
    ambientOffsets,
    delta,
  } = {}) {
    const perspective = assertCamera(camera);
    if (!perspective) {
      return null;
    }

    computeTargets({ pose, ambientOffsets, delta });

    if (!state.initialized) {
      reset({ camera: perspective, pose, ambientOffsets });
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
    scratch.lookDirection
      .set(0, 0, -1)
      .applyQuaternion(state.orientation);
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
      orbitAngle: state.orbitAngle,
      orbitRadius: state.orbitRadius,
      orbitSpeed: state.orbitSpeed,
      verticalBias: state.verticalBias,
      verticalAmplitude: state.verticalAmplitude,
      verticalFrequency: state.verticalFrequency,
      ambientPositionInfluence: state.ambientPositionInfluence,
      positionDamping: state.positionDamping,
      lookAtDamping: state.lookAtDamping,
      rotationDamping: state.rotationDamping,
    };
  }

  return {
    attach,
    configure,
    reset,
    update,
    getDebugState,
  };
}
