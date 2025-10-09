import { createThumbstick } from './thumbstick.js';

const DEFAULT_ANALOG_LOOK_SPEED = 480;
const DEFAULT_ROLL_SENSITIVITY = 0.65;
const DEFAULT_TOUCH_SPRINT_THRESHOLD = 0.75;

const SHIFT_CODES = new Set(['ShiftLeft', 'ShiftRight']);

const THRUST_AXIS_KEYS = {
  forward: {
    positive: ['KeyW', 'ArrowUp'],
    negative: ['KeyS', 'ArrowDown'],
  },
  strafe: {
    positive: ['KeyD', 'ArrowRight'],
    negative: ['KeyA', 'ArrowLeft'],
  },
  lift: {
    positive: ['Space', 'KeyE'],
    negative: ['KeyQ'],
  },
};

const THRUST_AXES = Object.values(THRUST_AXIS_KEYS);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isEditableTarget = (target) => {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (!target.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName);
};

export function createFlightControls({
  canvas,
  flightController,
  leftThumbstickElement,
  rightThumbstickElement,
  liftButtonElements = [],
  analogLookSpeed = DEFAULT_ANALOG_LOOK_SPEED,
  rollSensitivity = DEFAULT_ROLL_SENSITIVITY,
  touchSprintThreshold = DEFAULT_TOUCH_SPRINT_THRESHOLD,
  getCameraMode,
  followMode,
  onSprintChange,
  onThrustChange,
} = {}) {
  if (!flightController) {
    throw new Error('createFlightControls requires a FreeFlightController instance');
  }
  if (!canvas) {
    throw new Error('createFlightControls requires a canvas element');
  }

  const analogLook = { x: 0, y: 0 };
  const thrustKeys = new Set();
  const effectiveRollSensitivity = Number.isFinite(rollSensitivity)
    ? Math.max(0, Math.min(rollSensitivity, 1))
    : DEFAULT_ROLL_SENSITIVITY;
  const thrustSources = {
    keys: { forward: 0, strafe: 0, lift: 0, roll: 0 },
    touch: { forward: 0, strafe: 0, lift: 0, roll: 0 },
  };
  const sprintSources = { keys: false, touch: false };
  const touchLiftPresses = new Map();
  const liftButtons = Array.isArray(liftButtonElements)
    ? liftButtonElements.filter(Boolean)
    : [];

  let sprintActive = false;

  const pointerListenerOptions = { passive: false };

  const leftThumbstick = createThumbstick(leftThumbstickElement, {
    onChange: (value, context = {}) => {
      thrustSources.touch.forward = -value.y;
      thrustSources.touch.strafe = 0;
      thrustSources.touch.roll = value.x * effectiveRollSensitivity;
      const magnitude = Math.hypot(value.x, value.y);
      const shouldSprint =
        context.pointerType === 'touch' &&
        Boolean(context.isActive) &&
        magnitude >= touchSprintThreshold;
      sprintSources.touch = shouldSprint;
      updateSprintState();
      applyThrustInput();
    },
  });

  const rightThumbstick = createThumbstick(rightThumbstickElement, {
    onChange: (value, context = {}) => {
      const pointerType = context?.pointerType ?? null;
      const currentMode = typeof getCameraMode === 'function' ? getCameraMode() : null;
      const isFollowModeActive =
        pointerType === 'touch' &&
        followMode != null &&
        currentMode === followMode;
      analogLook.x = value.x;
      analogLook.y = isFollowModeActive ? -value.y : value.y;
    },
  });

  const computeAxisValue = (axisKeys) => {
    const hasPositive = axisKeys.positive.some((code) => thrustKeys.has(code));
    const hasNegative = axisKeys.negative.some((code) => thrustKeys.has(code));
    if (hasPositive && hasNegative) return 0;
    if (hasPositive) return 1;
    if (hasNegative) return -1;
    return 0;
  };

  const combineThrustAxis = (axis) => {
    return clamp(
      Object.values(thrustSources).reduce((sum, source) => sum + (source[axis] ?? 0), 0),
      -1,
      1
    );
  };

  const applyThrustInput = () => {
    flightController.setThrustInput({
      forward: combineThrustAxis('forward'),
      strafe: combineThrustAxis('strafe'),
      lift: combineThrustAxis('lift'),
      roll: combineThrustAxis('roll'),
    });
    if (typeof onThrustChange === 'function') {
      onThrustChange(flightController.input);
    }
  };

  const setSprintActive = (isActive) => {
    if (sprintActive === isActive) {
      return;
    }
    sprintActive = isActive;
    flightController.setSprintActive(isActive);
    if (typeof onSprintChange === 'function') {
      onSprintChange(isActive);
    }
  };

  const updateSprintState = () => {
    setSprintActive(Boolean(sprintSources.keys || sprintSources.touch));
  };

  const updateThrustFromKeys = () => {
    thrustSources.keys.forward = computeAxisValue(THRUST_AXIS_KEYS.forward);
    thrustSources.keys.strafe = computeAxisValue(THRUST_AXIS_KEYS.strafe);
    thrustSources.keys.lift = computeAxisValue(THRUST_AXIS_KEYS.lift);
    thrustSources.keys.roll = thrustSources.keys.strafe;
    applyThrustInput();
  };

  const updateLiftFromButtons = () => {
    let lift = 0;
    touchLiftPresses.forEach((value) => {
      lift += value;
    });
    thrustSources.touch.lift = clamp(lift, -1, 1);
    applyThrustInput();
  };

  const handleLiftButtonDown = (event) => {
    event.preventDefault();
    const { currentTarget } = event;
    const direction = Number.parseFloat(currentTarget?.dataset?.lift ?? '0');
    if (!Number.isFinite(direction) || direction === 0) {
      return;
    }
    if (typeof currentTarget?.setPointerCapture === 'function') {
      try {
        currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore capture failures to preserve input on unsupported browsers.
      }
    }
    touchLiftPresses.set(event.pointerId, direction);
    currentTarget?.classList.add('is-active');
    updateLiftFromButtons();
  };

  const handleLiftButtonEnd = (event) => {
    const { currentTarget } = event;
    if (
      typeof currentTarget?.hasPointerCapture === 'function' &&
      currentTarget.hasPointerCapture(event.pointerId) &&
      typeof currentTarget.releasePointerCapture === 'function'
    ) {
      try {
        currentTarget.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Ignore release failures to avoid breaking touch input fallbacks.
      }
    }
    event.preventDefault();
    touchLiftPresses.delete(event.pointerId);
    currentTarget?.classList.remove('is-active');
    updateLiftFromButtons();
  };

  const handleLiftContextMenu = (event) => {
    event.preventDefault();
  };

  liftButtons.forEach((button) => {
    button.addEventListener('pointerdown', handleLiftButtonDown, pointerListenerOptions);
    button.addEventListener('pointerup', handleLiftButtonEnd, pointerListenerOptions);
    button.addEventListener('pointercancel', handleLiftButtonEnd, pointerListenerOptions);
    button.addEventListener('lostpointercapture', handleLiftButtonEnd, pointerListenerOptions);
    button.addEventListener('contextmenu', handleLiftContextMenu);
  });

  const handleKeyDown = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    const isShift = SHIFT_CODES.has(code);
    const isThrustKey = THRUST_AXES.some(
      (axis) => axis.positive.includes(code) || axis.negative.includes(code)
    );
    if (!isThrustKey && !isShift) {
      return;
    }
    event.preventDefault();
    if (isThrustKey) {
      thrustKeys.add(code);
      updateThrustFromKeys();
    }
    if (isShift) {
      sprintSources.keys = true;
      updateSprintState();
    }
  };

  const handleKeyUp = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    const isShift = SHIFT_CODES.has(code);
    const isThrustKey = THRUST_AXES.some(
      (axis) => axis.positive.includes(code) || axis.negative.includes(code)
    );
    if (!isThrustKey && !isShift) {
      return;
    }
    event.preventDefault();
    if (isThrustKey) {
      thrustKeys.delete(code);
      updateThrustFromKeys();
    }
    if (isShift) {
      sprintSources.keys = false;
      updateSprintState();
    }
  };

  const handleCanvasClick = () => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches) {
      return;
    }
    if (canvas.requestPointerLock && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  };

  const handlePointerMove = (event) => {
    if (document.pointerLockElement === canvas) {
      flightController.addLookDelta(event.movementX, event.movementY);
    }
  };

  const resetInputs = ({ releasePointerLock = false } = {}) => {
    thrustKeys.clear();
    thrustSources.keys.forward = 0;
    thrustSources.keys.strafe = 0;
    thrustSources.keys.lift = 0;
    thrustSources.keys.roll = 0;
    thrustSources.touch.forward = 0;
    thrustSources.touch.strafe = 0;
    thrustSources.touch.lift = 0;
    thrustSources.touch.roll = 0;
    applyThrustInput();

    sprintSources.keys = false;
    sprintSources.touch = false;
    updateSprintState();

    analogLook.x = 0;
    analogLook.y = 0;

    touchLiftPresses.clear();
    liftButtons.forEach((button) => button.classList.remove('is-active'));

    leftThumbstick?.reset?.();
    rightThumbstick?.reset?.();

    if (releasePointerLock && document.pointerLockElement === canvas) {
      if (typeof document.exitPointerLock === 'function') {
        document.exitPointerLock();
      }
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handlePointerMove);
  }
  canvas.addEventListener('click', handleCanvasClick);

  const applyAnalogLook = (deltaTime = 0) => {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }
    const limitedDelta = Math.min(Math.max(deltaTime, 0), 0.05);
    const lookX = analogLook.x;
    const lookY = -analogLook.y;
    if (lookX === 0 && lookY === 0) {
      return;
    }
    flightController.addLookDelta(lookX * analogLookSpeed * limitedDelta, lookY * analogLookSpeed * limitedDelta);
  };

  const dispose = () => {
    resetInputs({ releasePointerLock: true });
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handlePointerMove);
    }
    canvas.removeEventListener('click', handleCanvasClick);
    liftButtons.forEach((button) => {
      button.removeEventListener('pointerdown', handleLiftButtonDown, pointerListenerOptions);
      button.removeEventListener('pointerup', handleLiftButtonEnd, pointerListenerOptions);
      button.removeEventListener('pointercancel', handleLiftButtonEnd, pointerListenerOptions);
      button.removeEventListener('lostpointercapture', handleLiftButtonEnd, pointerListenerOptions);
      button.removeEventListener('contextmenu', handleLiftContextMenu);
    });
    leftThumbstick?.destroy?.();
    rightThumbstick?.destroy?.();
  };

  // Initialize controller state with zeroed inputs.
  applyThrustInput();
  updateSprintState();

  return {
    applyAnalogLook,
    reset: resetInputs,
    dispose,
  };
}
