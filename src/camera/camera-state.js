import { createFollowCameraRig } from "./follow-camera.js";

export const CAMERA_MODES = Object.freeze({
  FOLLOW: "Follow",
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
    const { mode, config, offset, cameraPosition, followMetrics } = snapshot;
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
        `Steering LookAhead: f:${followMetrics.steeringLookAhead.forward.toFixed(2)} s:${followMetrics.steeringLookAhead.strafe.toFixed(2)} l:${followMetrics.steeringLookAhead.lift.toFixed(2)}`,
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

export function createCameraState({ three, scene, flightController }) {
  if (!three) {
    throw new Error("createCameraState requires the THREE namespace");
  }

  const {
    PerspectiveCamera,
    Vector3,
    Quaternion,
    Matrix4,
  } = three;

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  const defaultPosition = new Vector3(2.75, 1.8, 3.65);
  const defaultTarget = new Vector3(0, 0.5, 0);

  const followState = {
    rig: createFollowCameraRig(three),
  };

  const fpvState = {
    quaternion: new Quaternion(),
    initialized: false,
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
      offset: new Vector3(0, 1.2, 4.2),
      positionDamping: 0.16,
      lookAtDamping: 0.24,
      rotationDamping: 0.2,
      velocityLookAhead: 0.52,
      steeringLookAhead: {
        forward: 0.75,
        strafe: 0.55,
        lift: 0.38,
      },
    },
    [CAMERA_MODES.FPV]: {
      offset: new Vector3(0, 0.2, 0.45),
      easing: 0.28,
      smoothing: 0.22,
    },
  };

  const state = {
    mode: CAMERA_MODES.FOLLOW,
  };

  const debugScratchOffset = new Vector3();

  const debugOverlay = createDebugOverlay({
    getSnapshot: () => {
      const mode = state.mode;
      const config = modeConfigurations[mode];
      let offset = config?.offset ?? null;
      let followMetrics = null;
      if (mode === CAMERA_MODES.FIXED) {
        offset = debugScratchOffset.copy(camera.position).sub(defaultTarget);
      }
      if (mode === CAMERA_MODES.FOLLOW) {
        followMetrics = followState.rig.getDebugState();
        offset = followMetrics?.offset ?? offset;
      }
      return {
        mode,
        config,
        offset: offset ? offset.clone() : null,
        cameraPosition: camera.position.clone(),
        followMetrics,
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

  const updateFollow = ({ pose, ambientOffsets, delta }) => {
    if (!pose) return;

    followState.rig.configure(modeConfigurations[CAMERA_MODES.FOLLOW]);

    const velocity = flightController?.velocity?.clone?.() ?? null;
    const steering = flightController
      ? {
          forward: flightController.input?.forward ?? 0,
          strafe: flightController.input?.strafe ?? 0,
          lift: flightController.input?.lift ?? 0,
        }
      : null;

    followState.rig.updateFromPose({
      pose,
      velocity,
      ambientOffsets,
      steering,
      delta,
    });
  };

  const updateFpv = ({ pose, ambientOffsets, delta }) => {
    if (!pose) return;
    const config = modeConfigurations[CAMERA_MODES.FPV];
    const smoothing = Number.isFinite(config.smoothing) ? config.smoothing : 0.24;
    const easing = Number.isFinite(config.easing) ? config.easing : smoothing;

    scratch.offset.copy(config.offset).applyQuaternion(pose.quaternion);
    scratch.targetPosition.copy(pose.position);
    if (ambientOffsets?.position) {
      scratch.targetPosition.add(scratch.ambientPosition.copy(ambientOffsets.position));
    }
    scratch.targetPosition.add(scratch.offset);

    if (!fpvState.initialized) {
      camera.position.copy(scratch.targetPosition);
      fpvState.quaternion.copy(pose.quaternion);
      if (ambientOffsets?.quaternion) {
        fpvState.quaternion.multiply(ambientOffsets.quaternion);
      }
      fpvState.initialized = true;
    }

    camera.position.lerp(scratch.targetPosition, smoothing);

    scratch.quaternion.copy(pose.quaternion);
    if (ambientOffsets?.quaternion) {
      scratch.quaternion.multiply(ambientOffsets.quaternion);
    }

    fpvState.quaternion.slerp(scratch.quaternion, easing * (Number.isFinite(delta) ? Math.min(delta * 60, 1) : 1));
    camera.quaternion.copy(fpvState.quaternion);
  };

  function setMode(nextMode) {
    if (!MODE_VALUES.includes(nextMode)) {
      return;
    }

    if (state.mode === nextMode) {
      return;
    }

    state.mode = nextMode;

    if (state.mode === CAMERA_MODES.FIXED) {
      applyFixedState();
    } else {
      followState.rig.reset();
      fpvState.initialized = false;
    }
  }

  function getMode() {
    return state.mode;
  }

  function reset() {
    fpvState.initialized = false;

    if (state.mode === CAMERA_MODES.FOLLOW) {
      const pose = flightController
        ? {
            position: flightController.position?.clone?.() ?? null,
            quaternion: flightController.quaternion?.clone?.() ?? null,
          }
        : null;
      const velocity = flightController?.velocity?.clone?.() ?? null;
      followState.rig.reset({
        camera,
        pose,
        velocity,
        steering: flightController
          ? {
              forward: flightController.input?.forward ?? 0,
              strafe: flightController.input?.strafe ?? 0,
              lift: flightController.input?.lift ?? 0,
            }
          : null,
      });
    } else if (state.mode === CAMERA_MODES.FPV) {
      const pose = flightController
        ? {
            position: flightController.position,
            quaternion: flightController.quaternion,
          }
        : null;
      if (pose) {
        const config = modeConfigurations[CAMERA_MODES.FPV];
        scratch.offset.copy(config.offset).applyQuaternion(pose.quaternion);
        scratch.targetPosition.copy(pose.position);
        camera.position.copy(scratch.targetPosition).add(scratch.offset);
        camera.quaternion.copy(pose.quaternion);
        if (flightController?.getAmbientOffsets) {
          const ambientOffsets = flightController.getAmbientOffsets();
          if (ambientOffsets?.position) {
            camera.position.add(ambientOffsets.position);
          }
          if (ambientOffsets?.quaternion) {
            camera.quaternion.multiply(ambientOffsets.quaternion);
          }
        }
      } else {
        fpvState.initialized = false;
      }
    } else {
      applyFixedState();
      state.mode = CAMERA_MODES.FIXED;
    }
  }

  function update({ pose, ambientOffsets, delta } = {}) {
    if (state.mode === CAMERA_MODES.FIXED) {
      return;
    }

    if (state.mode === CAMERA_MODES.FOLLOW) {
      updateFollow({ pose, ambientOffsets, delta });
    } else if (state.mode === CAMERA_MODES.FPV) {
      updateFpv({ pose, ambientOffsets, delta });
    }
  }

  function dispose() {
    debugOverlay.dispose();
    if (scene && typeof scene.remove === "function") {
      scene.remove(camera);
    }
  }

  reset();

  return {
    camera,
    setMode,
    getMode,
    reset,
    update,
    dispose,
    getConfig(mode) {
      return modeConfigurations[mode];
    },
  };
}
