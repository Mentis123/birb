// Streamlined, responsive gliding defaults
export const BASE_FORWARD_SPEED = 3.5;
export const MAX_FORWARD_SPEED = 7;
export const SPEED_RAMP = 3;
export const LOOK_SENSITIVITY = 0.002;
export const AMBIENT_BOB_AMPLITUDE = 0.06;
export const AMBIENT_BOB_SPEED = 0.8;
export const AMBIENT_ROLL_AMPLITUDE = 0.025;
export const AMBIENT_ROLL_SPEED = 0.6;
export const AMBIENT_YAW_AMPLITUDE = 0.015;
export const AMBIENT_YAW_SPEED = 0.5;

export const LIFT_ACCELERATION = 4;
export const THROTTLE_POWER_MULTIPLIER = 2;
// Maximum vertical speed to prevent runaway climbing/diving
export const MAX_VERTICAL_SPEED = 3.5;
// Rotation rates for pitch and yaw (radians per second at full stick deflection)
export const PITCH_RATE = Math.PI * 0.6;
export const YAW_RATE = Math.PI * 0.75;
// How quickly the visual bank angle responds to yaw input
export const BANK_RESPONSE = 8;
// Upper bound on how far the bird can bank for readability and comfort.
export const MAX_BANK_ANGLE = (65 * Math.PI) / 180;
// Maximum visual pitch tilt when climbing/diving (nose up/down effect)
export const MAX_VISUAL_PITCH_ANGLE = (22 * Math.PI) / 180;
// How quickly the visual pitch responds to vertical velocity
export const VISUAL_PITCH_RESPONSE = 6;

const clamp = (value, min, max, fallback) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const noop = () => {};

const resolveLogger = (logger) => {
  if (logger === null || logger === undefined || logger === false) return noop;
  if (typeof logger === 'function') return logger;
  if (logger && typeof logger.debug === 'function') return (...args) => logger.debug(...args);
  if (logger && typeof logger.log === 'function') return (...args) => logger.log(...args);
  if (typeof console !== 'undefined') {
    if (typeof console.debug === 'function') return (...args) => console.debug(...args);
    if (typeof console.log === 'function') return (...args) => console.log(...args);
  }
  return noop;
};

const createAxisRecord = () => ({ yaw: 0, pitch: 0 });

export class FreeFlightController {
  constructor(three, options = {}) {
    if (!three) {
      throw new Error("FreeFlightController requires a THREE namespace");
    }

    this.THREE = three;
    const { Vector3, Quaternion, Euler } = three;

    this.position = new Vector3();
    this.velocity = new Vector3();
    // Single quaternion for flight direction (like SimpleFlightController)
    this.quaternion = new Quaternion();
    // Separate quaternion for visual output (includes banking)
    this._visualQuaternion = new Quaternion();
    // Keep lookQuaternion as alias for compatibility with nesting system
    this.lookQuaternion = this.quaternion;

    this._forward = new Vector3(0, 0, -1);
    this._right = new Vector3(1, 0, 0);
    this._up = new Vector3(0, 1, 0);
    this._localUp = new Vector3(0, 1, 0);
    this._bankQuaternion = new Quaternion();
    this._yawQuaternion = new Quaternion();
    this._pitchQuaternion = new Quaternion();
    this._alignQuaternion = new Quaternion();
    this._previousUp = new Vector3(0, 1, 0);
    this._ambientPosition = new Vector3();
    this._ambientQuaternion = new Quaternion();
    this._ambientEuler = new Euler(0, 0, 0, "YXZ");
    this._sphereCenter = options.sphereCenter ? options.sphereCenter.clone() : null;

    this._initialFrozen = Boolean(options.frozen ?? false);
    this.frozen = this._initialFrozen;
    this._frozenInitialized = false;

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    // Default throttle to 0 (stationary) - game code sets throttle > 0 to start flight
    this._initialThrottle = options.throttle ?? 0;
    this.throttle = this._initialThrottle;
    this.sprintMultiplier = options.sprintMultiplier ?? 1.4;
    this.isSprinting = false;
    // When false (default), pushing up/forward pitches the nose UP (push forward to fly up)
    // When true, controls are airplane-style: push forward to dive, pull back to climb
    this.invertPitch = options.invertPitch ?? false;

    this.input = createAxisRecord();
    // Accumulated look deltas (from mouse/touch) - applied once per frame
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    this._yawOnlyMode = false;
    this._pitchOnlyMode = false;

    this.bank = 0;
    this.pitch = 0;
    this.visualPitch = 0;
    this.forwardSpeed = BASE_FORWARD_SPEED;
    this.verticalVelocity = 0;
    this.elapsed = 0;

    this._debugLogging = Boolean(options.debugLogging ?? false);
    this._log = resolveLogger(options.debugLogger ?? options.logger);

    this.reset();
  }

  setInputs({
    yaw = this.input.yaw,
    pitch = this.input.pitch,
    // Legacy parameters retained for API compatibility
    forward,
    roll,
    strafe: _strafe,
    lift: _lift,
  } = {}) {
    const resolvedYaw = Number.isFinite(yaw) ? yaw : roll;
    const resolvedPitch = Number.isFinite(pitch) ? pitch : forward;
    this.input.yaw = clamp(resolvedYaw, -1, 1, this.input.yaw);
    this.input.pitch = clamp(resolvedPitch, -1, 1, this.input.pitch);
  }

  setThrustInput(inputs = {}) {
    this.setInputs(inputs);
  }

  setThrottle(value) {
    const nextValue = clamp(value, 0, 1, this.throttle);
    this.throttle = nextValue;
  }

  setFrozen(isFrozen) {
    this.frozen = Boolean(isFrozen);
    if (!this.frozen) {
      this._frozenInitialized = false;
    }
  }

  setYawOnlyMode(isActive) {
    this._yawOnlyMode = Boolean(isActive);
  }

  setPitchOnlyMode(isActive) {
    this._pitchOnlyMode = Boolean(isActive);
  }

  setSprintActive(isActive) {
    this.isSprinting = Boolean(isActive);
  }

  setInvertPitch(invert) {
    this.invertPitch = Boolean(invert);
  }

  setSphereCenter(center) {
    if (center === null || center === undefined) {
      this._sphereCenter = null;
      // Reset to world up for flat world
      this._previousUp.set(0, 1, 0);
      return;
    }
    if (typeof center.clone === 'function') {
      this._sphereCenter = center.clone();
      // Update _previousUp to match new local up direction
      // This prevents unwanted quaternion realignment on the next frame
      this._computeLocalUp();
      this._previousUp.copy(this._localUp);
    }
  }

  // Compute the local "up" direction based on current position
  // For flat worlds: world Y axis
  _computeLocalUp() {
    if (this._sphereCenter) {
      this._localUp.copy(this.position).sub(this._sphereCenter);
      if (this._localUp.lengthSq() > 1e-9) {
        this._localUp.normalize();
        return this._localUp;
      }
    }
    this._localUp.set(0, 1, 0);
    return this._localUp;
  }

  _logFlightState(label, payload) {
    if (!this._debugLogging) return;
    this._log(`[free-flight] ${label}`, payload);
  }

  getEffectiveThrottle() {
    const baseThrottle = this.throttle * THROTTLE_POWER_MULTIPLIER;
    const multiplier = this.isSprinting ? this.sprintMultiplier : 1;
    return baseThrottle * multiplier;
  }

  // Queue look delta for processing in update() - ensures single rotation path
  addLookDelta(deltaX, deltaY) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }
    // Accumulate pending rotation - will be applied in update()
    this._pendingYaw += -deltaX * this.lookSensitivity;
    this._pendingPitch += deltaY * this.lookSensitivity;
  }

  getSpeed() {
    return this.velocity.length();
  }

  update(deltaTime = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      deltaTime = 0;
    }

    // Keep velocity at zero - no forward movement
    this.velocity.set(0, 0, 0);
    this.forwardSpeed = 0;
    this.verticalVelocity = 0;

    // Get local up for yaw axis
    const up = this._computeLocalUp();

    // Apply yaw rotation from input (turning left/right)
    const yawDelta = -this.input.yaw * YAW_RATE * deltaTime;
    if (yawDelta !== 0) {
      this._yawQuaternion.setFromAxisAngle(up, yawDelta);
      this.quaternion.premultiply(this._yawQuaternion).normalize();
    }

    // Clear any pending look deltas
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    // Visual banking - wing dips on the side we're turning toward
    const yawInput = this.input.yaw;
    const targetBank = clamp(yawInput * MAX_BANK_ANGLE, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    const bankStep = 1 - Math.exp(-BANK_RESPONSE * deltaTime);
    this.bank += (targetBank - this.bank) * bankStep;
    this.bank = clamp(this.bank, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Build visual quaternion with banking applied
    this._visualQuaternion.copy(this.quaternion);
    const bankAxis = this._forward.set(0, 0, -1).applyQuaternion(this._visualQuaternion).normalize();
    this._bankQuaternion.setFromAxisAngle(bankAxis, this.bank);
    this._visualQuaternion.multiply(this._bankQuaternion);

    return {
      position: this.position,
      quaternion: this._visualQuaternion,
    };
  }

  getAmbientOffsets() {
    // DEBUGGING: Disabled all ambient motion (bobbing, rolling, yaw)
    this._ambientPosition.set(0, 0, 0);
    this._ambientQuaternion.set(0, 0, 0, 1); // Identity quaternion

    return {
      position: this._ambientPosition,
      quaternion: this._ambientQuaternion,
    };
  }

  reset() {
    this.position.copy(this._initialPosition);
    this.velocity.set(0, 0, 0);
    this.quaternion.copy(this._initialQuaternion);
    this._visualQuaternion.copy(this._initialQuaternion);
    this.bank = 0;
    this.pitch = 0;
    this.visualPitch = 0;
    this.forwardSpeed = 0;
    this.verticalVelocity = 0;
    this.elapsed = 0;
    this._pendingYaw = 0;
    this._pendingPitch = 0;
    this._yawOnlyMode = false;
    this._pitchOnlyMode = false;
    Object.assign(this.input, createAxisRecord());
    this.setInputs({ yaw: 0, pitch: 0 });
    this.setSprintActive(false);
    this.throttle = this._initialThrottle;
    this.frozen = this._initialFrozen;
    this._frozenInitialized = false;
    // Reset previous up to match initial position's local up
    this._computeLocalUp();
    this._previousUp.copy(this._localUp);
  }
}
