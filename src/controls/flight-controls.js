import { createThumbstick } from './thumbstick.js';
import { createFloatingThumbstick } from './virtual-thumbstick.js';

const DEFAULT_ANALOG_LOOK_SPEED = 360;
const DEFAULT_ROLL_SENSITIVITY = 0.45;
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

const THRUST_AXIS_LIST = Object.values(THRUST_AXIS_KEYS);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const createAxisRecord = () => ({ forward: 0, strafe: 0, lift: 0, roll: 0 });

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

  const effectiveRollSensitivity = Number.isFinite(rollSensitivity)
    ? clamp(rollSensitivity, 0, 1)
    : DEFAULT_ROLL_SENSITIVITY;
  const effectiveTouchSprintThreshold = Number.isFinite(touchSprintThreshold)
    ? clamp(touchSprintThreshold, 0, 1)
    : DEFAULT_TOUCH_SPRINT_THRESHOLD;

  const axisSources = {
    keyboard: createAxisRecord(),
    leftStick: createAxisRecord(),
    liftButtons: createAxisRecord(),
  };

  const sprintSources = {
    keyboard: false,
    touchStick: false,
    analogStick: false,
  };

  const touchPointers = new Set();
  let primaryTouchPointerId = null;
  let touchStickActive = false;

  let externalSprint = false;

  const analogLookState = {
    x: 0,
    y: 0,
    isActive: false,
    pointerType: null,
  };

  const touchLiftPresses = new Map();
  const liftButtons = Array.isArray(liftButtonElements)
    ? liftButtonElements.filter(Boolean)
    : [];
  const thrustKeys = new Set();

  let sprintActive = false;

  const pointerListenerOptions = { passive: false };
  const globalTouchListenerOptions = { passive: true };

  const combineAxis = (axis) => {
    const total = Object.values(axisSources).reduce((sum, source) => sum + (source[axis] ?? 0), 0);
    return clamp(total, -1, 1);
  };

  const applyThrustInput = () => {
    flightController.setThrustInput({
      forward: combineAxis('forward'),
      strafe: combineAxis('strafe'),
      lift: combineAxis('lift'),
      roll: combineAxis('roll'),
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
    setSprintActive(
      Boolean(
        sprintSources.keyboard || sprintSources.touchStick || sprintSources.analogStick || externalSprint
      )
    );
  };

  const updateTouchSprintState = () => {
    if (!touchStickActive) {
      sprintSources.touchStick = false;
      updateSprintState();
      return;
    }
    const hasPrimary =
      primaryTouchPointerId !== null && touchPointers.has(primaryTouchPointerId);
    const additionalTouches = hasPrimary ? touchPointers.size - 1 : touchPointers.size;
    sprintSources.touchStick = Boolean(hasPrimary && additionalTouches > 0);
    updateSprintState();
  };

  const updateKeyboardAxes = () => {
    axisSources.keyboard.forward = computeAxisValue(THRUST_AXIS_KEYS.forward);
    axisSources.keyboard.strafe = computeAxisValue(THRUST_AXIS_KEYS.strafe);
    axisSources.keyboard.lift = computeAxisValue(THRUST_AXIS_KEYS.lift);
    axisSources.keyboard.roll = clamp(axisSources.keyboard.strafe * effectiveRollSensitivity, -1, 1);
    applyThrustInput();
  };

  const computeAxisValue = (axisKeys) => {
    const hasPositive = axisKeys.positive.some((code) => thrustKeys.has(code));
    const hasNegative = axisKeys.negative.some((code) => thrustKeys.has(code));
    if (hasPositive && hasNegative) return 0;
    if (hasPositive) return 1;
    if (hasNegative) return -1;
    return 0;
  };

  const updateLiftFromButtons = () => {
    let lift = 0;
    touchLiftPresses.forEach((value) => {
      lift += value;
    });
    axisSources.liftButtons.lift = clamp(lift, -1, 1);
    applyThrustInput();
  };

  const handleLeftStickChange = (value, context = {}) => {
    const forward = clamp(-value.y, -1, 1);
    const strafe = clamp(value.x, -1, 1);
    axisSources.leftStick.forward = forward;
    axisSources.leftStick.strafe = strafe;
    axisSources.leftStick.roll = clamp(strafe * effectiveRollSensitivity, -1, 1);
    axisSources.leftStick.lift = 0;

    const pointerType = context.pointerType ?? null;
    if (pointerType === 'touch') {
      touchStickActive = Boolean(context.isActive);
      const pointerId = typeof context.pointerId === 'number' ? context.pointerId : null;
      if (touchStickActive && pointerId !== null) {
        primaryTouchPointerId = pointerId;
        touchPointers.add(pointerId);
      } else if (!touchStickActive && pointerId !== null && primaryTouchPointerId === pointerId) {
        primaryTouchPointerId = null;
      }
      updateTouchSprintState();
    } else {
      touchStickActive = false;
      const magnitudeForSprint = clamp(
        context.magnitude ?? Math.hypot(value.x, value.y),
        0,
        1
      );
      sprintSources.analogStick = Boolean(
        context.isActive && magnitudeForSprint >= effectiveTouchSprintThreshold
      );
      updateSprintState();
    }
    applyThrustInput();
  };

  const handleRightStickChange = (value, context = {}) => {
    const pointerType = context.pointerType ?? null;
    const currentMode = typeof getCameraMode === 'function' ? getCameraMode() : null;
    const shouldInvertY =
      pointerType === 'touch' &&
      followMode != null &&
      currentMode === followMode;

    analogLookState.x = clamp(value.x, -1, 1);
    analogLookState.y = clamp(shouldInvertY ? -value.y : value.y, -1, 1);
    analogLookState.pointerType = pointerType;
    analogLookState.isActive = Boolean(context.isActive);
  };

  const leftThumbstick =
    (leftThumbstickElement &&
      (createThumbstick(leftThumbstickElement, {
        deadzone: 0.15,
        onChange: handleLeftStickChange,
      }) ||
        createFloatingThumbstick(leftThumbstickElement, {
          deadzone: 0.15,
          expo: 0.32,
          onChange: handleLeftStickChange,
        }))) ||
    null;

  const rightThumbstick =
    (rightThumbstickElement &&
      (createThumbstick(rightThumbstickElement, {
        deadzone: 0.08,
        onChange: handleRightStickChange,
      }) ||
        createFloatingThumbstick(rightThumbstickElement, {
          deadzone: 0.08,
          expo: 0.28,
          onChange: handleRightStickChange,
        }))) ||
    null;

  const handleGlobalTouchDown = (event) => {
    if (event.pointerType !== 'touch') {
      return;
    }
    touchPointers.add(event.pointerId);
    if (!touchStickActive) {
      return;
    }
    updateTouchSprintState();
  };

  const handleGlobalTouchEnd = (event) => {
    if (event.pointerType !== 'touch') {
      return;
    }
    touchPointers.delete(event.pointerId);
    if (primaryTouchPointerId === event.pointerId) {
      primaryTouchPointerId = null;
      touchStickActive = false;
    }
    if (!touchStickActive) {
      sprintSources.touchStick = false;
    }
    updateTouchSprintState();
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
        // Ignore capture failures.
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
        // Ignore release failures.
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
    const isThrustKey = THRUST_AXIS_LIST.some(
      (axis) => axis.positive.includes(code) || axis.negative.includes(code)
    );
    if (!isThrustKey && !isShift) {
      return;
    }
    event.preventDefault();
    if (isThrustKey) {
      thrustKeys.add(code);
      updateKeyboardAxes();
    }
    if (isShift) {
      sprintSources.keyboard = true;
      updateSprintState();
    }
  };

  const handleKeyUp = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    const isShift = SHIFT_CODES.has(code);
    const isThrustKey = THRUST_AXIS_LIST.some(
      (axis) => axis.positive.includes(code) || axis.negative.includes(code)
    );
    if (!isThrustKey && !isShift) {
      return;
    }
    event.preventDefault();
    if (isThrustKey) {
      thrustKeys.delete(code);
      updateKeyboardAxes();
    }
    if (isShift) {
      sprintSources.keyboard = false;
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

  const resetAxisRecord = (record) => {
    record.forward = 0;
    record.strafe = 0;
    record.lift = 0;
    record.roll = 0;
  };

  const resetInputs = ({ releasePointerLock = false } = {}) => {
    thrustKeys.clear();
    Object.values(axisSources).forEach(resetAxisRecord);
    applyThrustInput();

    sprintSources.keyboard = false;
    sprintSources.touchStick = false;
    sprintSources.analogStick = false;
    externalSprint = false;
    updateSprintState();

    touchPointers.clear();
    primaryTouchPointerId = null;
    touchStickActive = false;

    analogLookState.x = 0;
    analogLookState.y = 0;
    analogLookState.isActive = false;
    analogLookState.pointerType = null;

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

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleGlobalTouchDown, globalTouchListenerOptions);
    window.addEventListener('pointerup', handleGlobalTouchEnd, globalTouchListenerOptions);
    window.addEventListener('pointercancel', handleGlobalTouchEnd, globalTouchListenerOptions);
  }

  const applyAnalogLook = (deltaTime = 0) => {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }
    const limitedDelta = Math.min(Math.max(deltaTime, 0), 0.05);
    const lookX = analogLookState.x;
    // Vertical orientation is already handled when writing analogLookState.y, so
    // pass it through unchanged to keep up-input pitching the camera upward.
    const lookY = analogLookState.y;
    if (lookX === 0 && lookY === 0) {
      return;
    }
    flightController.addLookDelta(
      lookX * analogLookSpeed * limitedDelta,
      lookY * analogLookSpeed * limitedDelta
    );
  };

  const dispose = () => {
    resetInputs({ releasePointerLock: true });
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handlePointerMove);
    }
    canvas.removeEventListener('click', handleCanvasClick);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', handleGlobalTouchDown, globalTouchListenerOptions);
      window.removeEventListener('pointerup', handleGlobalTouchEnd, globalTouchListenerOptions);
      window.removeEventListener('pointercancel', handleGlobalTouchEnd, globalTouchListenerOptions);
    }
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

  applyThrustInput();
  updateSprintState();

  return {
    applyAnalogLook,
    reset: resetInputs,
    dispose,
    setSprintOverride(isActive) {
      externalSprint = Boolean(isActive);
      updateSprintState();
    },
  };
}
