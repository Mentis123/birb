import { OrbitControls } from "https://esm.sh/three@0.161.0/examples/jsm/controls/OrbitControls";

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
    const { mode, config, offset, cameraPosition } = snapshot;
    const formatVector = (vector) =>
      vector
        ? `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`
        : "(n/a)";

    const easing = config?.easing ?? null;
    const smoothing = config?.smoothing ?? null;

    overlay.textContent = [
      `Camera Mode: ${mode}`,
      `Camera Position: ${formatVector(cameraPosition)}`,
      `Offset: ${formatVector(offset)}`,
      `Easing: ${Number.isFinite(easing) ? easing.toFixed(3) : "n/a"}`,
      `Smoothing: ${Number.isFinite(smoothing) ? smoothing.toFixed(3) : "n/a"}`,
    ].join("\n");

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

export function createCameraState({ three, scene, flightController, domElement }) {
  if (!three) {
    throw new Error("createCameraState requires the THREE namespace");
  }

  const {
    PerspectiveCamera,
    Vector3,
    Quaternion,
  } = three;

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  const defaultPosition = new Vector3(2.75, 1.8, 3.65);
  const defaultTarget = new Vector3(0, 0.5, 0);

  const controls = new OrbitControls(camera, domElement ?? document.body);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.3;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI / 2;
  controls.target.copy(defaultTarget);

  const followState = {
    position: defaultPosition.clone(),
    target: defaultTarget.clone(),
    initialized: false,
  };

  const fpvState = {
    quaternion: new Quaternion(),
    initialized: false,
  };

  const scratch = {
    targetPosition: new Vector3(),
    ambientPosition: new Vector3(),
    desiredPosition: new Vector3(),
    offset: new Vector3(),
    lookAt: new Vector3(),
    quaternion: new Quaternion(),
  };

  const modeConfigurations = {
    [CAMERA_MODES.FIXED]: {
      offset: defaultPosition.clone().sub(defaultTarget),
      easing: 0.18,
      smoothing: 0.12,
    },
    [CAMERA_MODES.FOLLOW]: {
      offset: new Vector3(0, 1.2, 4.2),
      easing: 0.22,
      smoothing: 0.16,
    },
    [CAMERA_MODES.FPV]: {
      offset: new Vector3(0, 0.2, 0.45),
      easing: 0.28,
      smoothing: 0.22,
    },
  };

  const state = {
    mode: CAMERA_MODES.FIXED,
  };

  const debugScratchOffset = new Vector3();

  const debugOverlay = createDebugOverlay({
    getSnapshot: () => {
      const mode = state.mode;
      const config = modeConfigurations[mode];
      let offset = config?.offset ?? null;
      if (mode === CAMERA_MODES.FIXED && controls) {
        offset = debugScratchOffset
          .copy(camera.position)
          .sub(controls.target);
      }
      return {
        mode,
        config,
        offset: offset ? offset.clone() : null,
        cameraPosition: camera.position.clone(),
      };
    },
  });

  if (scene && typeof scene.add === "function") {
    scene.add(camera);
  }

  const applyFixedState = () => {
    controls.enabled = true;
    camera.position.copy(defaultPosition);
    controls.target.copy(defaultTarget);
    controls.update();
  };

  const updateFollow = ({ pose, ambientOffsets }) => {
    if (!pose) return;
    const config = modeConfigurations[CAMERA_MODES.FOLLOW];
    const smoothing = Number.isFinite(config.smoothing) ? config.smoothing : 0.16;
    const easing = Number.isFinite(config.easing) ? config.easing : smoothing;

    scratch.targetPosition.copy(pose.position);
    if (ambientOffsets?.position) {
      scratch.targetPosition.add(scratch.ambientPosition.copy(ambientOffsets.position));
    }

    scratch.desiredPosition.copy(scratch.targetPosition).add(config.offset);

    if (!followState.initialized) {
      followState.position.copy(scratch.desiredPosition);
      followState.target.copy(scratch.targetPosition);
      followState.initialized = true;
    }

    followState.position.lerp(scratch.desiredPosition, smoothing);
    followState.target.lerp(scratch.targetPosition, easing);

    camera.position.copy(followState.position);
    camera.lookAt(followState.target);
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
      controls.enabled = false;
      followState.initialized = false;
      fpvState.initialized = false;
    }
  }

  function getMode() {
    return state.mode;
  }

  function reset() {
    state.mode = CAMERA_MODES.FIXED;
    followState.initialized = false;
    fpvState.initialized = false;
    applyFixedState();
  }

  function update({ pose, ambientOffsets, delta } = {}) {
    if (state.mode === CAMERA_MODES.FIXED) {
      controls.enabled = true;
      controls.update();
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
    controls.dispose();
    if (scene && typeof scene.remove === "function") {
      scene.remove(camera);
    }
  }

  reset();

  return {
    camera,
    controls,
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
