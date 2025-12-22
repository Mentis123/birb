import { createThumbstick } from './thumbstick.js';
import { inputShaping } from './virtual-thumbstick.js';

const DEFAULT_ANALOG_LOOK_SPEED = 480;
const DEFAULT_TOUCH_JOYSTICK_DEADZONE = 0.15;
const DEFAULT_TOUCH_LOOK_DEADZONE = 0.08;
const DEFAULT_TOUCH_JOYSTICK_EXPO = 0.32;
const DEFAULT_TOUCH_LOOK_EXPO = 0.18;
const TOUCH_JOYSTICK_SIZE = 120;

const PITCH_AXIS_KEYS = {
  positive: ['KeyW', 'ArrowUp'],
  negative: ['KeyS', 'ArrowDown'],
};

const YAW_AXIS_KEYS = {
  positive: ['KeyD', 'ArrowRight'],
  negative: ['KeyA', 'ArrowLeft'],
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const DEFAULT_THRUST_SHAPING = {
  deadzone: DEFAULT_TOUCH_JOYSTICK_DEADZONE,
  expo: DEFAULT_TOUCH_JOYSTICK_EXPO,
};

const DEFAULT_LOOK_SHAPING = {
  deadzone: DEFAULT_TOUCH_LOOK_DEADZONE,
  expo: DEFAULT_TOUCH_LOOK_EXPO,
};

const createAxisRecord = () => ({ yaw: 0, pitch: 0 });

const normalizeShapingConfig = (config = {}, fallback = DEFAULT_THRUST_SHAPING) => ({
  deadzone: clamp(
    Number.isFinite(config.deadzone) ? config.deadzone : fallback.deadzone,
    0,
    0.95
  ),
  expo: clamp(Number.isFinite(config.expo) ? config.expo : fallback.expo, 0, 1),
});

const { shapeAxis } = inputShaping;

const shapeStickInput = (x, y, config = DEFAULT_THRUST_SHAPING) => {
  const rawX = clamp(Number.isFinite(x) ? x : 0, -1, 1);
  const rawY = clamp(Number.isFinite(y) ? y : 0, -1, 1);
  const rawMagnitude = clamp(Math.hypot(rawX, rawY), 0, 1);
  const shapedX = shapeAxis(rawX, config);
  const shapedY = shapeAxis(rawY, config);
  const magnitude = clamp(Math.hypot(shapedX, shapedY), 0, 1);
  return {
    x: shapedX,
    y: shapedY,
    magnitude,
    angle: Math.atan2(shapedY, shapedX),
    raw: { x: rawX, y: rawY },
    rawMagnitude,
  };
};

const normalizeNippleData = (data = {}) => {
  const vectorX = Number.isFinite(data?.vector?.x) ? data.vector.x : null;
  const vectorY = Number.isFinite(data?.vector?.y) ? data.vector.y : null;
  const angle = Number.isFinite(data?.angle?.radian) ? data.angle.radian : null;
  const force = clamp(Number.isFinite(data?.force) ? data.force : 0, 0, 1);
  const rawX = clamp(vectorX ?? (angle !== null ? Math.cos(angle) * force : 0), -1, 1);
  const rawY = clamp(vectorY ?? (angle !== null ? Math.sin(angle) * force : 0), -1, 1);
  return {
    raw: { x: rawX, y: rawY },
    rawMagnitude: clamp(Math.hypot(rawX, rawY), 0, 1),
  };
};

const shapeStickWithContext = (value = {}, context = {}, config = DEFAULT_THRUST_SHAPING) => {
  const rawX = context?.raw?.x ?? value?.x ?? 0;
  const rawY = context?.raw?.y ?? value?.y ?? 0;
  const shaped = shapeStickInput(rawX, rawY, config);
  if (Number.isFinite(context?.rawMagnitude)) {
    shaped.rawMagnitude = clamp(context.rawMagnitude, 0, 1);
  }
  return shaped;
};

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
  touchZoneElement,
  nipplejs,
  analogLookSpeed = DEFAULT_ANALOG_LOOK_SPEED,
  thrustShaping = DEFAULT_THRUST_SHAPING,
  lookShaping = DEFAULT_LOOK_SHAPING,
  getCameraMode,
  followMode,
  onThrustChange,
} = {}) {
  if (!flightController) {
    throw new Error('createFlightControls requires a FreeFlightController instance');
  }
  if (!canvas) {
    throw new Error('createFlightControls requires a canvas element');
  }

  if (canvas?.style) {
    canvas.style.touchAction = 'none';
  }
  if (touchZoneElement?.style) {
    touchZoneElement.style.touchAction = 'none';
  }

  const thrustInputShaping = normalizeShapingConfig(thrustShaping, DEFAULT_THRUST_SHAPING);
  const lookInputShaping = normalizeShapingConfig(lookShaping, DEFAULT_LOOK_SHAPING);
  const yawPitchShaping = { ...thrustInputShaping, expo: 0 };

  const axisSources = {
    keyboard: createAxisRecord(),
    leftStick: createAxisRecord(),
  };

  const analogLookState = {
    x: 0,
    y: 0,
    isActive: false,
    pointerType: null,
  };

  const thrustKeys = new Set();

  const touchJoystickState = {
    manager: null,
    nipple: null,
    handlers: null,
  };

  const useDynamicTouchJoysticks = Boolean(touchZoneElement && nipplejs);

  const combineAxis = (axis) => {
    const total = Object.values(axisSources).reduce((sum, source) => sum + (source[axis] ?? 0), 0);
    return clamp(total, -1, 1);
  };

  const applyInputs = () => {
    const yaw = combineAxis('yaw');
    const pitch = combineAxis('pitch');
    if (typeof flightController.setInputs === 'function') {
      flightController.setInputs({ yaw, pitch });
    } else {
      flightController.setThrustInput?.({ yaw, pitch });
    }
    if (typeof onThrustChange === 'function') {
      onThrustChange(flightController.input);
    }
  };

  const updateKeyboardAxes = () => {
    axisSources.keyboard.pitch = computeAxisValue(PITCH_AXIS_KEYS);
    axisSources.keyboard.yaw = computeAxisValue(YAW_AXIS_KEYS);
    applyInputs();
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
    const shaped = shapeStickWithContext(value, context, yawPitchShaping);
    const pitch = clamp(shaped.y, -1, 1);
    const yaw = clamp(shaped.x, -1, 1);
    axisSources.leftStick.pitch = pitch;
    axisSources.leftStick.yaw = yaw;
    applyInputs();
  };

  const handleRightStickChange = (value, context = {}) => {
    const shaped = shapeStickWithContext(value, context, lookInputShaping);
    const pointerType = context.pointerType ?? null;
    const currentMode = typeof getCameraMode === 'function' ? getCameraMode() : null;
    const isFollowMode = followMode != null && currentMode === followMode;

    // Match mouse behavior: positive X = look/turn right
    // addLookDelta already negates, so we DON'T negate here
    analogLookState.x = clamp(shaped.x, -1, 1);
    analogLookState.y = clamp(shaped.y, -1, 1);
    analogLookState.pointerType = pointerType;
    analogLookState.isActive = Boolean(context.isActive);
    analogLookState.isFollowMode = isFollowMode;
  };

  const resetLookTouchJoystick = () => {
    handleRightStickChange(
      { x: 0, y: 0 },
      { isActive: false, pointerType: 'touch', magnitude: 0, rawMagnitude: 0 }
    );
  };

  const handleTouchJoystickMove = (data) => {
    const normalized = normalizeNippleData(data);
    const payload = { x: normalized.raw.x, y: normalized.raw.y };
    const context = {
      isActive: true,
      pointerType: 'touch',
      raw: normalized.raw,
      rawMagnitude: normalized.rawMagnitude,
    };
    handleRightStickChange(payload, context);
  };

  const detachLookJoystick = () => {
    if (!touchJoystickState.nipple) return;
    const { nipple, move, end } = touchJoystickState.nipple;
    nipple.off('move', move);
    nipple.off('end', end);
    touchJoystickState.nipple = null;
    resetLookTouchJoystick();
  };

  const attachLookJoystick = (nipple) => {
    if (!nipple) return;
    detachLookJoystick();
    const move = (event, data) => handleTouchJoystickMove(data);
    const end = () => resetLookTouchJoystick();
    nipple.on('move', move);
    nipple.on('end', end);
    touchJoystickState.nipple = { nipple, move, end };
  };

  const setupTouchJoysticks = () => {
    const prefersCoarsePointer =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : true;
    if (!useDynamicTouchJoysticks || !touchZoneElement || !nipplejs || !prefersCoarsePointer) return;
    try {
      touchJoystickState.manager = nipplejs.create({
        zone: touchZoneElement,
        mode: 'dynamic',
        multitouch: false,
        maxNumberOfNipples: 1,
        size: TOUCH_JOYSTICK_SIZE,
        color: '#aac8ff',
        fadeTime: 120,
        restOpacity: 0.2,
        threshold: 0.05,
      });

      touchZoneElement.classList.add('has-dynamic-joystick');
      touchZoneElement.style.touchAction = 'none';

      // Find the ghost thumbstick placeholder to hide/show based on touch state
      const ghostThumbstick = touchZoneElement.querySelector('.thumbstick');

      const handleAdded = (event, nipple) => {
        attachLookJoystick(nipple);
        // Hide the ghost when user touches elsewhere
        if (ghostThumbstick) {
          ghostThumbstick.classList.add('is-hidden');
        }
      };

      const handleRemoved = (event, nipple) => {
        if (touchJoystickState.nipple?.nipple === nipple) {
          detachLookJoystick();
        }
        // Show the ghost again when touch ends
        if (ghostThumbstick) {
          ghostThumbstick.classList.remove('is-hidden');
        }
      };

      touchJoystickState.manager.on('added', handleAdded);
      touchJoystickState.manager.on('removed', handleRemoved);
      touchJoystickState.handlers = { handleAdded, handleRemoved };
    } catch (error) {
      console.error('Failed to initialize touch joysticks', error);
    }
  };

  const leftThumbstick = useDynamicTouchJoysticks
    ? null
    : createThumbstick(leftThumbstickElement, {
        deadzone: 0,
        onChange: handleLeftStickChange,
      });

  const rightThumbstick = useDynamicTouchJoysticks
    ? null
    : createThumbstick(rightThumbstickElement, {
        deadzone: 0,
        onChange: handleRightStickChange,
      });

  setupTouchJoysticks();

  const handleKeyDown = (event) => {
    const { code } = event;
    if (!code || isEditableTarget(event.target)) {
      return;
    }
    const isPitchKey = PITCH_AXIS_KEYS.positive.includes(code) || PITCH_AXIS_KEYS.negative.includes(code);
    const isYawKey = YAW_AXIS_KEYS.positive.includes(code) || YAW_AXIS_KEYS.negative.includes(code);
    if (!isPitchKey && !isYawKey) {
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
    const isPitchKey = PITCH_AXIS_KEYS.positive.includes(code) || PITCH_AXIS_KEYS.negative.includes(code);
    const isYawKey = YAW_AXIS_KEYS.positive.includes(code) || YAW_AXIS_KEYS.negative.includes(code);
    if (!isPitchKey && !isYawKey) {
      return;
    }
    event.preventDefault();
    thrustKeys.delete(code);
    updateKeyboardAxes();
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
    record.yaw = 0;
    record.pitch = 0;
  };

  const resetInputs = ({ releasePointerLock = false } = {}) => {
    thrustKeys.clear();
    Object.values(axisSources).forEach(resetAxisRecord);
    applyInputs();

    analogLookState.x = 0;
    analogLookState.y = 0;
    analogLookState.isActive = false;
    analogLookState.pointerType = null;

    detachLookJoystick();

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
    const lookX = analogLookState.x;
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
    if (touchJoystickState.manager) {
      if (touchJoystickState.handlers) {
        const { handleAdded, handleRemoved } = touchJoystickState.handlers;
        touchJoystickState.manager.off('added', handleAdded);
        touchJoystickState.manager.off('removed', handleRemoved);
      }
      touchJoystickState.manager.destroy();
      touchJoystickState.manager = null;
      touchJoystickState.nipple = null;
    }
    if (touchZoneElement?.classList) {
      touchZoneElement.classList.remove('has-dynamic-joystick');
    }
    leftThumbstick?.destroy?.();
    rightThumbstick?.destroy?.();
  };

  applyInputs();

  return {
    applyAnalogLook,
    reset: resetInputs,
    dispose,
  };
}
