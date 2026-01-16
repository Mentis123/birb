import { createFollowCameraRig } from "./follow-camera.js";
import { attachFpvCamera } from "./fpv-camera.js";
import { createSequenceCameraRig } from "./sequence-camera.js";

const easeInOutCubic = (t) => {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
};

export const CAMERA_MODES = Object.freeze({
  FOLLOW: "Follow",
  SEQUENCE: "Sequence",
  FPV: "FPV",
  FIXED: "Fixed",
});

const MODE_VALUES = Object.values(CAMERA_MODES);

function createDebugOverlay({ getSnapshot }) {
  if (!new URLSearchParams(window.location.search).has("debugCamera")) {
    return { dispose() {} };
  }

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.top = "1rem";
  overlay.style.right = "1rem";
  overlay.style.zIndex = "9999";
  overlay.style.padding = "0.5rem 0.75rem";
  overlay.style.background = "rgba(10, 19, 35, 0.82)";
  overlay.style.color = "#d6e4ff";
  overlay.style.fontFamily = "monospace";
  overlay.style.fontSize = "0.75rem";
  overlay.style.lineHeight = "1.4";
  overlay.style.borderRadius = "0.5rem";
  overlay.style.whiteSpace = "pre";
  overlay.style.pointerEvents = "none";
  document.body.appendChild(overlay);

  let rafId = 0;
  const renderOverlay = () => {
    const snapshot = getSnapshot();
    const {
      mode,
      config,
      offset,
      cameraPosition,
      followMetrics,
      sequenceMetrics,
    } = snapshot;
    const formatVector = (vector) =>
      vector
        ? `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`
        : "(n/a)";

    const positionDamping = config?.positionDamping ?? null;
    const lookAtDamping = config?.lookAtDamping ?? null;
    const rotationDamping = config?.rotationDamping ?? null;

    const lines = [
      `Camera Mode: ${mode}`,
      `Camera Position: ${formatVector(cameraPosition)}`,
      `Offset: ${formatVector(offset)}`,
      `Position Damping: ${
        Number.isFinite(positionDamping) ? positionDamping.toFixed(3) : "n/a"
      }`,
      `LookAt Damping: ${
        Number.isFinite(lookAtDamping) ? lookAtDamping.toFixed(3) : "n/a"
      }`,
      `Rotation Damping: ${
        Number.isFinite(rotationDamping) ? rotationDamping.toFixed(3) : "n/a"
      }`,
    ];

    if (followMetrics) {
      lines.push(
        `Follow Offset Distance: ${followMetrics.offsetMagnitude.toFixed(2)}`,
        `Follow Position: ${formatVector(followMetrics.position)}`,
        `Follow LookAt: ${formatVector(followMetrics.lookAt)}`,
        `Follow Damping (pos/look/rot): ${followMetrics.positionDamping.toFixed(3)} / ${followMetrics.lookAtDamping.toFixed(3)} / ${followMetrics.rotationDamping.toFixed(3)}`,
        `Velocity LookAhead: ${followMetrics.velocityLookAhead.toFixed(2)}`,
        `Steering LookAhead: yaw:${followMetrics.steeringLookAhead.yaw.toFixed(2)} pitch:${followMetrics.steeringLookAhead.pitch.toFixed(2)}`,
      );
    }

    if (sequenceMetrics) {
      lines.push(
        `Sequence Orbit Radius: ${sequenceMetrics.orbitRadius.toFixed(2)}`,
        `Sequence Orbit Speed: ${sequenceMetrics.orbitSpeed.toFixed(3)}`,
        `Sequence Vertical Bias: ${sequenceMetrics.verticalBias.toFixed(2)}`,
        `Sequence Vertical Amplitude: ${sequenceMetrics.verticalAmplitude.toFixed(2)}`,
        `Sequence Vertical Frequency: ${sequenceMetrics.verticalFrequency.toFixed(2)}`,
      );
    }

    overlay.textContent = lines.join("\n");

    rafId = window.requestAnimationFrame(renderOverlay);
  };

  rafId = window.requestAnimationFrame(renderOverlay);

  return {
    dispose() {
      window.cancelAnimationFrame(rafId);
      overlay.remove();
    },
  };
}

export function createCameraState({ three, scene, flightController, sphereCenter = null }) {
  if (!three) {
    throw new Error("createCameraState requires the THREE namespace");
  }

  const {
    PerspectiveCamera,
    Vector3,
    Quaternion,
    Matrix4,
  } = three;

  // Track the sphere center for spherical world support
  let activeSphereCenter = sphereCenter ? sphereCenter.clone() : null;

  const camera = new PerspectiveCamera(60, 1, 0.1, 500);
  // Default camera position for spherical world (bird starts at y = 33)
  const defaultPosition = new Vector3(5, 38, 8);
  const defaultTarget = new Vector3(0, 33, 0);

  const followState = {
    rig: createFollowCameraRig(three),
  };

  const sequenceState = {
    rig: createSequenceCameraRig(three),
  };

  const scratch = {
    targetPosition: new Vector3(),
    ambientPosition: new Vector3(),
    offset: new Vector3(),
    quaternion: new Quaternion(),
    lookMatrix: new Matrix4(),
  };

  const modeConfigurations = {
    [CAMERA_MODES.FIXED]: {
      offset: defaultPosition.clone().sub(defaultTarget),
      positionDamping: 0.2,
      lookAtDamping: 0.24,
      rotationDamping: 0.18,
    },
    [CAMERA_MODES.FOLLOW]: {
      // offset.y = height above bird, offset.z = distance behind bird (use negative or positive, abs is taken)
      offset: new Vector3(0, 0.8, 2.2),
      positionDamping: 0.14,
      lookAtDamping: 0.20,
      rotationDamping: 0.16,
      velocityLookAhead: 0.45,
      steeringLookAhead: {
        yaw: 0.65,
        pitch: 0.45,
      },
    },
    [CAMERA_MODES.SEQUENCE]: {
      anchorOffset: new Vector3(0, 0, 0),
      lookAtOffset: new Vector3(0, 0.66, 0),
      orbitRadius: 4.85,
      orbitSpeed: 0.18,
      verticalBias: 1.64,
      verticalAmplitude: 0.42,
      verticalFrequency: 1.12,
      ambientPositionInfluence: 0.18,
      positionDamping: 0.2,
      lookAtDamping: 0.24,
      rotationDamping: 0.22,
    },
    [CAMERA_MODES.FPV]: {
      offset: new Vector3(0, 0.14, -0.38),
      blendDuration: 0.26,
      positionDamping: 18,
      rotationDamping: 20,
      rollInfluence: 0.42,
    },
  };

  const state = {
    mode: CAMERA_MODES.FOLLOW,
  };

  const debugScratchOffset = new Vector3();

  const transitionState = {
    active: false,
    type: null,
    elapsed: 0,
    duration: modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26,
    fromPosition: new Vector3(),
    fromQuaternion: new Quaternion(),
    toPosition: new Vector3(),
    toQuaternion: new Quaternion(),
    targetMode: null,
  };

  const transitionCamera = new PerspectiveCamera(
    camera.fov,
    camera.aspect,
    camera.near,
    camera.far,
  );
  transitionCamera.up.copy(camera.up);

  const fpvRig = attachFpvCamera({
    camera,
    flightController,
    offset: modeConfigurations[CAMERA_MODES.FPV].offset,
    blendDuration: modeConfigurations[CAMERA_MODES.FPV].blendDuration,
    positionDamping: modeConfigurations[CAMERA_MODES.FPV].positionDamping,
    rotationDamping: modeConfigurations[CAMERA_MODES.FPV].rotationDamping,
    rollInfluence: modeConfigurations[CAMERA_MODES.FPV].rollInfluence,
  });

  let activeUpdater = null;

  const debugOverlay = createDebugOverlay({
    getSnapshot: () => {
      const mode = state.mode;
      const config = modeConfigurations[mode];
      let offset = config?.offset ?? null;
      let followMetrics = null;
      let sequenceMetrics = null;
      if (mode === CAMERA_MODES.FIXED) {
        offset = debugScratchOffset.copy(camera.position).sub(defaultTarget);
      }
      if (mode === CAMERA_MODES.FOLLOW) {
        followMetrics = followState.rig.getDebugState();
        offset = followMetrics?.offset ?? offset;
      }
      if (mode === CAMERA_MODES.SEQUENCE) {
        sequenceMetrics = sequenceState.rig.getDebugState?.() ?? null;
      }
      return {
        mode,
        config,
        offset: offset ? offset.clone() : null,
        cameraPosition: camera.position.clone(),
        followMetrics,
        sequenceMetrics,
      };
    },
  });

  if (scene && typeof scene.add === "function") {
    scene.add(camera);
  }

  const applyFixedState = () => {
    camera.position.copy(defaultPosition);
    scratch.lookMatrix.lookAt(defaultPosition, defaultTarget, camera.up);
    camera.quaternion.setFromRotationMatrix(scratch.lookMatrix);
    camera.lookAt(defaultTarget);
  };

  followState.rig.attach(camera, modeConfigurations[CAMERA_MODES.FOLLOW]);
  sequenceState.rig.attach(
    camera,
    modeConfigurations[CAMERA_MODES.SEQUENCE],
  );

  const applyTransitionFromFpv = ({
    rig,
    pose,
    velocity,
    ambientOffsets,
    steering,
    delta,
  }) => {
    if (!transitionState.active || transitionState.type !== "fromFpv") {
      return;
    }

    if (
      transitionState.targetMode &&
      transitionState.targetMode !== state.mode
    ) {
      return;
    }

    transitionState.toPosition.copy(camera.position);
    transitionState.toQuaternion.copy(camera.quaternion);

    const step = Number.isFinite(delta) && delta > 0 ? delta : 1 / 60;
    transitionState.elapsed += step;
    const progress = Math.min(
      transitionState.elapsed / Math.max(transitionState.duration, 1e-4),
      1,
    );
    const eased = easeInOutCubic(progress);

    camera.position
      .copy(transitionState.fromPosition)
      .lerp(transitionState.toPosition, eased);
    camera.quaternion
      .copy(transitionState.fromQuaternion)
      .slerp(transitionState.toQuaternion, eased);

    if (progress >= 1) {
      transitionState.active = false;
      transitionState.type = null;
      transitionState.targetMode = null;
      transitionState.fromPosition.copy(camera.position);
      transitionState.fromQuaternion.copy(camera.quaternion);
      if (rig?.reset) {
        rig.reset({
          camera,
          pose,
          velocity,
          ambientOffsets,
          steering,
        });
      }
    }
  };

  const updateFollow = ({ pose, ambientOffsets, delta }) => {
    if (!pose) return;

    // Include sphereCenter in the configuration for spherical world support
    followState.rig.configure({
      ...modeConfigurations[CAMERA_MODES.FOLLOW],
      sphereCenter: activeSphereCenter,
    });

    const velocity = flightController?.velocity?.clone?.() ?? null;
    const steering = flightController
      ? {
          yaw: flightController.input?.yaw ?? 0,
          pitch: flightController.input?.pitch ?? 0,
        }
      : null;

    followState.rig.updateFromPose({
      pose,
      velocity,
      ambientOffsets,
      steering,
      delta,
    });

    applyTransitionFromFpv({
      rig: followState.rig,
      pose,
      velocity,
      ambientOffsets,
      steering,
      delta,
    });
  };

  const updateSequence = ({ pose, ambientOffsets, delta }) => {
    sequenceState.rig.configure(modeConfigurations[CAMERA_MODES.SEQUENCE]);

    sequenceState.rig.update({
      pose,
      ambientOffsets,
      delta,
    });

    applyTransitionFromFpv({
      rig: sequenceState.rig,
      pose,
      ambientOffsets,
      delta,
    });
  };

  const updateFpv = ({ pose, ambientOffsets, delta }) => {
    fpvRig.update({ pose, ambientOffsets, delta });
  };

  const beginThirdPersonTransitionFromFpv = ({
    mode,
    rig,
    pose,
    velocity,
    ambientOffsets,
    steering,
  }) => {
    if (!pose || !pose.position || !pose.quaternion) {
      transitionState.active = false;
      transitionState.type = null;
      transitionState.targetMode = null;
      return false;
    }

    transitionState.active = true;
    transitionState.type = "fromFpv";
    transitionState.targetMode = mode ?? null;
    transitionState.elapsed = 0;
    transitionState.duration =
      modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
    transitionState.fromPosition.copy(camera.position);
    transitionState.fromQuaternion.copy(camera.quaternion);

    if (rig?.configure) {
      rig.configure(modeConfigurations[mode]);
    }

    if (rig?.reset) {
      rig.reset({
        camera: transitionCamera,
        pose,
        velocity,
        ambientOffsets,
        steering,
      });
    } else {
      transitionCamera.position.copy(camera.position);
      transitionCamera.quaternion.copy(camera.quaternion);
    }

    transitionState.toPosition.copy(transitionCamera.position);
    transitionState.toQuaternion.copy(transitionCamera.quaternion);
    return true;
  };

  function setMode(nextMode) {
    if (!MODE_VALUES.includes(nextMode)) {
      return;
    }

    if (state.mode === nextMode) {
      return;
    }

    const previousMode = state.mode;
    state.mode = nextMode;

    if (state.mode === CAMERA_MODES.FIXED) {
      transitionState.active = false;
      transitionState.type = null;
      transitionState.elapsed = 0;
      transitionState.targetMode = null;
      applyFixedState();
      activeUpdater = null;
      fpvRig.reset();
      return;
    }

    if (state.mode === CAMERA_MODES.FPV) {
      transitionState.active = false;
      transitionState.type = null;
      transitionState.elapsed = 0;
      transitionState.targetMode = null;
      transitionState.duration =
        modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
      fpvRig.activateBlend();
      activeUpdater = updateFpv;
      return;
    }

    let targetRig = null;
    switch (state.mode) {
      case CAMERA_MODES.SEQUENCE:
        activeUpdater = updateSequence;
        targetRig = sequenceState.rig;
        break;
      case CAMERA_MODES.FOLLOW:
      default:
        activeUpdater = updateFollow;
        targetRig = followState.rig;
        break;
    }

    fpvRig.reset();
    transitionState.duration =
      modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;

    const pose = flightController
      ? {
          position: flightController.position?.clone?.() ?? null,
          quaternion: flightController.quaternion?.clone?.() ?? null,
        }
      : null;
    const velocity = flightController?.velocity?.clone?.() ?? null;
    const ambientOffsets = flightController?.getAmbientOffsets
      ? flightController.getAmbientOffsets()
      : null;
    const steering = flightController
      ? {
          yaw: flightController.input?.yaw ?? 0,
          pitch: flightController.input?.pitch ?? 0,
        }
      : null;

    if (targetRig?.configure) {
      targetRig.configure(modeConfigurations[state.mode]);
    }

    const resetPayload = {
      camera,
      pose,
      velocity,
      ambientOffsets,
      steering,
    };

    if (previousMode === CAMERA_MODES.FPV) {
      const startedTransition = beginThirdPersonTransitionFromFpv({
        mode: state.mode,
        rig: targetRig,
        pose,
        velocity,
        ambientOffsets,
        steering,
      });
      if (!startedTransition) {
        transitionState.active = false;
        transitionState.type = null;
        transitionState.targetMode = null;
        transitionState.elapsed = 0;
        transitionState.duration =
          modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
        targetRig?.reset?.(resetPayload);
      }
    } else {
      transitionState.active = false;
      transitionState.type = null;
      transitionState.targetMode = null;
      transitionState.elapsed = 0;
      transitionState.duration =
        modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
      targetRig?.reset?.(resetPayload);
    }
  }

  function getMode() {
    return state.mode;
  }

  function reset() {
    fpvRig.reset();
    transitionState.active = false;
    transitionState.type = null;
    transitionState.elapsed = 0;
    transitionState.targetMode = null;
    transitionState.duration =
      modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;

    if (state.mode === CAMERA_MODES.FIXED) {
      applyFixedState();
      activeUpdater = null;
      return;
    }

    if (state.mode !== CAMERA_MODES.FOLLOW) {
      state.mode = CAMERA_MODES.FOLLOW;
    }
    activeUpdater = updateFollow;

    const pose = flightController
      ? {
          position: flightController.position?.clone?.() ?? null,
          quaternion: flightController.quaternion?.clone?.() ?? null,
        }
      : null;
    const velocity = flightController?.velocity?.clone?.() ?? null;
    const ambientOffsets = flightController?.getAmbientOffsets
      ? flightController.getAmbientOffsets()
      : null;
    const steering = flightController
      ? {
          yaw: flightController.input?.yaw ?? 0,
          pitch: flightController.input?.pitch ?? 0,
        }
      : null;

    followState.rig.reset({
      camera,
      pose,
      velocity,
      ambientOffsets,
      steering,
    });

    sequenceState.rig.configure(modeConfigurations[CAMERA_MODES.SEQUENCE]);
    sequenceState.rig.reset({
      camera: transitionCamera,
      pose,
      ambientOffsets,
    });
  }

  function updateActiveCamera({ pose, ambientOffsets, delta } = {}) {
    if (state.mode === CAMERA_MODES.FIXED || typeof activeUpdater !== "function") {
      return;
    }

    activeUpdater({ pose, ambientOffsets, delta });
  }

  function dispose() {
    debugOverlay.dispose();
    if (scene && typeof scene.remove === "function") {
      scene.remove(camera);
    }
  }

  function setSphereCenter(center) {
    if (center === null || center === undefined) {
      activeSphereCenter = null;
    } else if (center && typeof center.clone === 'function') {
      activeSphereCenter = center.clone();
    }
  }

  reset();

  return {
    camera,
    setMode,
    getMode,
    reset,
    updateActiveCamera,
    update: updateActiveCamera,
    dispose,
    setSphereCenter,
    getConfig(mode) {
      return modeConfigurations[mode];
    },
  };
}
