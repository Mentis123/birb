import { createThumbstick } from './thumbstick.js';
import { createFloatingThumbstick } from './virtual-thumbstick.js';

const DEFAULT_HOVER_THROTTLE = 0.05;
const DEFAULT_FLAP_THROTTLE = 0.7;
const DIVE_SWIPE_THRESHOLD = 48;

const FLAP_KEYS = ['ShiftLeft', 'ShiftRight'];
const DIVE_KEYS = ['Space'];

const THRUST_AXIS_KEYS = {
  yaw: {
    positive: ['KeyD', 'ArrowRight'],
    negative: ['KeyA', 'ArrowLeft'],
  },
  pitch: {
    positive: ['KeyS', 'ArrowDown'],
    negative: ['KeyW', 'ArrowUp'],
  },
};

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
  onThrustChange,
} = {}) {
  if (!flightController) {
    throw new Error('createFlightControls requires a FreeFlightController instance');
  }
  if (!canvas) {
    throw new Error('createFlightControls requires a canvas element');
  }

  const createAxisRecord = (throttleDefault = 0) => ({
    strafe: 0,
    yaw: 0,
    pitch: 0,
    throttle: throttleDefault,
    dive: 0,
  });

  const axisSources = {
    base: createAxisRecord(-1),
    keyboard: createAxisRecord(),
    leftStick: createAxisRecord(),
    gestures: createAxisRecord(),
    override: createAxisRecord(),
  };

  const thrustKeys = new Set();
  const pointerMeta = new Map();
  const pointerFlapIds = new Set();
  const touchPointerIds = new Set();

  const gestureState = {
    keyboardFlapActive: false,
    keyboardDiveActive: false,
  };

  const initialThrottle = clamp(flightController.input?.throttle ?? DEFAULT_FLAP_THROTTLE, 0, 1);
  const throttleState = {
    hover: clamp(initialThrottle * 0.25, 0.02, 0.08),
    flap: Math.max(initialThrottle, DEFAULT_FLAP_THROTTLE),
    current: initialThrottle,
  };

  const diveState = { current: Boolean(flightController.input?.dive ?? false) };

  const combineAxis = (axis, { min = -1, max = 1 } = {}) => {
    const total = Object.values(axisSources).reduce((sum, source) => sum + (source[axis] ?? 0), 0);
    return clamp(total, min, max);
  };

  const getThrottleForAxis = (value) => (value >= 0 ? throttleState.flap : throttleState.hover);

  const applyDiveState = (isActive) => {
    if (diveState.current === isActive) {
      return;
    }
    diveState.current = isActive;
    flightController.setSprintActive(isActive);
  };

  const applyThrustInput = () => {
    const strafe = combineAxis('strafe');
    const yaw = combineAxis('yaw');
    const pitch = combineAxis('pitch');

    flightController.setThrustInput({
      strafe,
      yaw,
      pitch,
    });

    const throttleAxis = combineAxis('throttle');
    const nextThrottle = getThrottleForAxis(throttleAxis);
    if (Math.abs(nextThrottle - throttleState.current) > 1e-4) {
      throttleState.current = nextThrottle;
      flightController.setThrottle(nextThrottle);
    }

    const diveAxis = combineAxis('dive', { min: 0, max: 1 });
    applyDiveState(diveAxis >= 0.5);

    if (typeof onThrustChange === 'function') {
      onThrustChange(flightController.input);
    }
  };

  const updateKeyboardAxes = () => {
    axisSources.keyboard.strafe = computeAxisValue(THRUST_AXIS_KEYS.yaw);
    axisSources.keyboard.yaw = axisSources.keyboard.strafe;
    axisSources.keyboard.pitch = computeAxisValue(THRUST_AXIS_KEYS.pitch);
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

  const handleLeftStickChange = (value, context = {}) => {
    const yaw = clamp(value.x, -1, 1);
    const pitch = clamp(value.y, -1, 1);
    axisSources.leftStick.strafe = yaw;
    axisSources.leftStick.yaw = yaw;
    axisSources.leftStick.pitch = clamp(-pitch, -1, 1);
    applyThrustInput();
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

  const updateGestureAxes = () => {
    const pointerDiveActive = touchPointerIds.size >= 2;
    const swipeDiveActive = Array.from(pointerMeta.values()).some((meta) => meta.swipeDive);

    const flapActive = pointerFlapIds.size > 0 || gestureState.keyboardFlapActive;
    axisSources.gestures.throttle = flapActive ? 1 : 0;

    const diveActive = gestureState.keyboardDiveActive || pointerDiveActive || swipeDiveActive;
    axisSources.gestures.dive = diveActive ? 1 : 0;
    applyThrustInput();
  };

  const handleKeyDown = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    let handled = false;
    const isYawKey =
      THRUST_AXIS_KEYS.yaw.positive.includes(code) || THRUST_AXIS_KEYS.yaw.negative.includes(code);
    const isPitchKey =
      THRUST_AXIS_KEYS.pitch.positive.includes(code) ||
      THRUST_AXIS_KEYS.pitch.negative.includes(code);
    if (isYawKey || isPitchKey) {
      thrustKeys.add(code);
      updateKeyboardAxes();
      handled = true;
    }
    if (FLAP_KEYS.includes(code) && !gestureState.keyboardFlapActive) {
      gestureState.keyboardFlapActive = true;
      updateGestureAxes();
      handled = true;
    }
    if (DIVE_KEYS.includes(code) && !gestureState.keyboardDiveActive) {
      gestureState.keyboardDiveActive = true;
      updateGestureAxes();
      handled = true;
    }
    if (handled) {
      event.preventDefault();
    }
  };

  const handleKeyUp = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    let handled = false;
    const isYawKey =
      THRUST_AXIS_KEYS.yaw.positive.includes(code) || THRUST_AXIS_KEYS.yaw.negative.includes(code);
    const isPitchKey =
      THRUST_AXIS_KEYS.pitch.positive.includes(code) ||
      THRUST_AXIS_KEYS.pitch.negative.includes(code);
    if (isYawKey || isPitchKey) {
      thrustKeys.delete(code);
      updateKeyboardAxes();
      handled = true;
    }
    if (FLAP_KEYS.includes(code) && gestureState.keyboardFlapActive) {
      gestureState.keyboardFlapActive = false;
      updateGestureAxes();
      handled = true;
    }
    if (DIVE_KEYS.includes(code) && gestureState.keyboardDiveActive) {
      gestureState.keyboardDiveActive = false;
      updateGestureAxes();
      handled = true;
    }
    if (handled) {
      event.preventDefault();
    }
  };

  const handlePointerDown = (event) => {
    if (event.button != null && event.button !== 0 && event.pointerType !== 'touch') {
      return;
    }
    const pointerType = (event.pointerType || 'mouse').toLowerCase();
    pointerMeta.set(event.pointerId, {
      pointerType,
      startY: event.clientY,
      swipeDive: false,
    });
    pointerFlapIds.add(event.pointerId);
    if (pointerType === 'touch') {
      touchPointerIds.add(event.pointerId);
    }
    updateGestureAxes();
    event.preventDefault();
  };

  const handlePointerMove = (event) => {
    const meta = pointerMeta.get(event.pointerId);
    if (!meta) return;
    if (!meta.swipeDive && event.clientY - meta.startY >= DIVE_SWIPE_THRESHOLD) {
      meta.swipeDive = true;
      updateGestureAxes();
    }
  };

  const clearPointer = (pointerId) => {
    const meta = pointerMeta.get(pointerId);
    if (!meta) return;
    pointerMeta.delete(pointerId);
    pointerFlapIds.delete(pointerId);
    if (meta.pointerType === 'touch') {
      touchPointerIds.delete(pointerId);
    }
  };

  const handlePointerEnd = (event) => {
    if (!pointerMeta.has(event.pointerId)) {
      return;
    }
    clearPointer(event.pointerId);
    updateGestureAxes();
  };

  const resetAxisRecord = (record, { throttleDefault = 0 } = {}) => {
    record.strafe = 0;
    record.yaw = 0;
    record.pitch = 0;
    record.throttle = throttleDefault;
    record.dive = 0;
  };

  const resetInputs = () => {
    thrustKeys.clear();
    pointerMeta.clear();
    pointerFlapIds.clear();
    touchPointerIds.clear();
    gestureState.keyboardFlapActive = false;
    gestureState.keyboardDiveActive = false;
    resetAxisRecord(axisSources.base, { throttleDefault: -1 });
    resetAxisRecord(axisSources.keyboard);
    resetAxisRecord(axisSources.leftStick);
    resetAxisRecord(axisSources.gestures);
    resetAxisRecord(axisSources.override);
    applyThrustInput();
    leftThumbstick?.reset?.();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
  }

  const pointerListenerOptions = { passive: false };

  if (canvas) {
    canvas.addEventListener('pointerdown', handlePointerDown, pointerListenerOptions);
  }

  const globalPointerTarget = typeof window !== 'undefined' ? window : null;
  if (globalPointerTarget) {
    globalPointerTarget.addEventListener('pointermove', handlePointerMove, pointerListenerOptions);
    globalPointerTarget.addEventListener('pointerup', handlePointerEnd, pointerListenerOptions);
    globalPointerTarget.addEventListener('pointercancel', handlePointerEnd, pointerListenerOptions);
    globalPointerTarget.addEventListener('pointerleave', handlePointerEnd, pointerListenerOptions);
  }

  const dispose = () => {
    resetInputs();
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    }
    if (canvas) {
      canvas.removeEventListener('pointerdown', handlePointerDown, pointerListenerOptions);
    }
    if (globalPointerTarget) {
      globalPointerTarget.removeEventListener('pointermove', handlePointerMove, pointerListenerOptions);
      globalPointerTarget.removeEventListener('pointerup', handlePointerEnd, pointerListenerOptions);
      globalPointerTarget.removeEventListener('pointercancel', handlePointerEnd, pointerListenerOptions);
      globalPointerTarget.removeEventListener('pointerleave', handlePointerEnd, pointerListenerOptions);
    }
    leftThumbstick?.destroy?.();
  };

  applyThrustInput();

  return {
    applyAnalogLook: () => {}, // Dummy for compatibility
    reset: resetInputs,
    dispose,
    setSprintOverride(value) {
      if (value == null) {
        axisSources.override.dive = 0;
      } else {
        axisSources.override.dive = value ? 1 : 0;
      }
      applyThrustInput();
    },
  };
}
