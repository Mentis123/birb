import { createFollowCameraRig } from "./follow-camera.js";
import { attachFpvCamera } from "./fpv-camera.js";

const easeInOutCubic = (t) => {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
};

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
      offset: new Vector3(0, 0.14, -0.38),
      blendDuration: 0.26,
      positionDamping: 0,
      rotationDamping: 0,
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
  });

  let activeUpdater = null;

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

    if (transitionState.active && transitionState.type === "fromFpv") {
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
        transitionState.fromPosition.copy(camera.position);
        transitionState.fromQuaternion.copy(camera.quaternion);
        followState.rig.reset({
          camera,
          pose,
          velocity,
          ambientOffsets,
          steering,
        });
      }
    }
  };

  const updateFpv = ({ pose, ambientOffsets, delta }) => {
    fpvRig.update({ pose, ambientOffsets, delta });
  };

  const beginFollowTransitionFromFpv = ({
    pose,
    velocity,
    ambientOffsets,
    steering,
  }) => {
    if (!pose || !pose.position || !pose.quaternion) {
      transitionState.active = false;
      transitionState.type = null;
      return false;
    }

    transitionState.active = true;
    transitionState.type = "fromFpv";
    transitionState.elapsed = 0;
    transitionState.duration =
      modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
    transitionState.fromPosition.copy(camera.position);
    transitionState.fromQuaternion.copy(camera.quaternion);

    followState.rig.configure(modeConfigurations[CAMERA_MODES.FOLLOW]);

    followState.rig.reset({
      camera: transitionCamera,
      pose,
      velocity,
      ambientOffsets,
      steering,
    });

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
      applyFixedState();
      activeUpdater = null;
      fpvRig.reset();
      return;
    }

    if (state.mode === CAMERA_MODES.FPV) {
      transitionState.active = false;
      transitionState.type = null;
      transitionState.elapsed = 0;
      transitionState.duration =
        modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
      fpvRig.activateBlend();
      activeUpdater = updateFpv;
      return;
    }

    activeUpdater = updateFollow;
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
          forward: flightController.input?.forward ?? 0,
          strafe: flightController.input?.strafe ?? 0,
          lift: flightController.input?.lift ?? 0,
        }
      : null;

    if (previousMode === CAMERA_MODES.FPV) {
      const startedTransition = beginFollowTransitionFromFpv({
        pose,
        velocity,
        ambientOffsets,
        steering,
      });
      if (!startedTransition) {
        transitionState.active = false;
        transitionState.type = null;
        transitionState.elapsed = 0;
        transitionState.duration =
          modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
        followState.rig.reset({
          camera,
          pose,
          velocity,
          ambientOffsets,
          steering,
        });
      }
    } else {
      transitionState.active = false;
      transitionState.type = null;
      transitionState.elapsed = 0;
      transitionState.duration =
        modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;
      followState.rig.reset({
        camera,
        pose,
        velocity,
        ambientOffsets,
        steering,
      });
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
    transitionState.duration =
      modeConfigurations[CAMERA_MODES.FPV].blendDuration ?? 0.26;

    if (state.mode === CAMERA_MODES.FIXED) {
      applyFixedState();
      activeUpdater = null;
      return;
    }

    if (state.mode !== CAMERA_MODES.FOLLOW) {
      state.mode = CAMERA_MODES.FOLLOW;
      activeUpdater = updateFollow;
    }

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
          forward: flightController.input?.forward ?? 0,
          strafe: flightController.input?.strafe ?? 0,
          lift: flightController.input?.lift ?? 0,
        }
      : null;

    followState.rig.reset({
      camera,
      pose,
      velocity,
      ambientOffsets,
      steering,
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

  reset();

  return {
    camera,
    setMode,
    getMode,
    reset,
    updateActiveCamera,
    update: updateActiveCamera,
    dispose,
    getConfig(mode) {
      return modeConfigurations[mode];
    },
  };
}
