import { createThumbstick } from './thumbstick.js';
import { createFloatingThumbstick } from './virtual-thumbstick.js';

const THRUST_AXIS_KEYS = {
  strafe: {
    positive: ['KeyD', 'ArrowRight'],
    negative: ['KeyA', 'ArrowLeft'],
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

  const axisSources = {
    keyboard: { strafe: 0 },
    leftStick: { strafe: 0 },
  };

  const thrustKeys = new Set();

  const combineAxis = (axis) => {
    const total = Object.values(axisSources).reduce((sum, source) => sum + (source[axis] ?? 0), 0);
    return clamp(total, -1, 1);
  };

  const applyThrustInput = () => {
    flightController.setThrustInput({
      strafe: combineAxis('strafe'),
    });
    if (typeof onThrustChange === 'function') {
      onThrustChange(flightController.input);
    }
  };

  const updateKeyboardAxes = () => {
    // Only handle left/right turning
    axisSources.keyboard.strafe = computeAxisValue(THRUST_AXIS_KEYS.strafe);
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
    // Only use left/right from the stick
    const strafe = clamp(value.x, -1, 1);
    axisSources.leftStick.strafe = strafe;
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

  const handleKeyDown = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    const isLeftRight =
      THRUST_AXIS_KEYS.strafe.positive.includes(code) ||
      THRUST_AXIS_KEYS.strafe.negative.includes(code);
    if (!isLeftRight) {
      return;
    }
    event.preventDefault();
    thrustKeys.add(code);
    updateKeyboardAxes();
  };

  const handleKeyUp = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    const isLeftRight =
      THRUST_AXIS_KEYS.strafe.positive.includes(code) ||
      THRUST_AXIS_KEYS.strafe.negative.includes(code);
    if (!isLeftRight) {
      return;
    }
    event.preventDefault();
    thrustKeys.delete(code);
    updateKeyboardAxes();
  };

  const resetAxisRecord = (record) => {
    record.strafe = 0;
  };

  const resetInputs = () => {
    thrustKeys.clear();
    Object.values(axisSources).forEach(resetAxisRecord);
    applyThrustInput();
    leftThumbstick?.reset?.();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
  }

  const dispose = () => {
    resetInputs();
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    }
    leftThumbstick?.destroy?.();
  };

  applyThrustInput();

  return {
    applyAnalogLook: () => {}, // Dummy for compatibility
    reset: resetInputs,
    dispose,
    setSprintOverride: () => {}, // Dummy for compatibility
  };
}
