// Relaxed, chill gliding feel
export const MOVEMENT_ACCELERATION = 2.8;
export const LINEAR_DRAG = 1.2;
export const SPRINT_MULTIPLIER = 1.4;
// Upper bound on how far the bird can bank for readability and comfort.
export const MAX_BANK_ANGLE = (35 * Math.PI) / 180;
// How quickly a banked input should translate into a gentle yaw turn.
export const BANK_TURN_RATE = Math.PI * 0.45;
// How quickly the controller adapts its roll orientation when reversing direction.
export const BANK_ORIENTATION_DAMPING = 2.5;
// Maximum amount the bird pitches up or down when steering with the stick.
export const MAX_PITCH_ANGLE = (45 * Math.PI) / 180;
// How quickly the bird eases toward target pitch and bank angles.
export const TILT_DAMPING = 14;
// Minimum desired forward speed so the bird always keeps gliding.
export const CRUISE_FORWARD_SPEED = 2.1;
export const LOOK_SENSITIVITY = 0.002;
export const AMBIENT_BOB_AMPLITUDE = 0.06;
export const AMBIENT_BOB_SPEED = 0.8;
export const AMBIENT_ROLL_AMPLITUDE = 0.025;
export const AMBIENT_ROLL_SPEED = 0.6;
export const AMBIENT_YAW_AMPLITUDE = 0.015;
export const AMBIENT_YAW_SPEED = 0.5;

export const INPUT_SMOOTHING = 8;
export const STRAFE_DAMPING = 0.5;
export const IDLE_LINEAR_DRAG = 2.5;
export const LIFT_ACCELERATION_MULTIPLIER = 1.8;
export const THROTTLE_POWER_MULTIPLIER = 2;
// Rotation rates for pitch and yaw (radians per second at full stick deflection)
export const PITCH_RATE = Math.PI * 0.5;
export const YAW_RATE = Math.PI * 0.6;
// How quickly the visual bank angle responds to yaw input
export const BANK_RESPONSE = 6;

const clamp = (value, min, max, fallback) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const createAxisRecord = () => ({ forward: 0, strafe: 0, lift: 0, roll: 0 });

export class FreeFlightController {
  constructor(three, options = {}) {
    if (!three) {
      throw new Error("FreeFlightController requires a THREE namespace");
    }

    this.THREE = three;
    const { Vector3, Quaternion, Euler } = three;

    this.position = new Vector3();
    this.velocity = new Vector3();
    this.quaternion = new Quaternion();
    this.lookQuaternion = new Quaternion();

    this._forward = new Vector3(0, 0, -1);
    this._right = new Vector3(1, 0, 0);
    this._up = new Vector3(0, 1, 0);
    this._acceleration = new Vector3();
    this._bankQuaternion = new Quaternion();
    this._yawQuaternion = new Quaternion();
    this._pitchQuaternion = new Quaternion();
    this._ambientPosition = new Vector3();
    this._ambientQuaternion = new Quaternion();
    this._ambientEuler = new Euler(0, 0, 0, "YXZ");
    this._bankOrientation = 1;

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    this.throttle = options.throttle ?? 1;
    this.sprintMultiplier = options.sprintMultiplier ?? SPRINT_MULTIPLIER;
    this.isSprinting = false;
    // When false (default), pushing up/forward pitches the nose UP (push forward to fly up)
    // When true, controls are airplane-style: push forward to dive, pull back to climb
    this.invertPitch = options.invertPitch ?? false;

    const providedSmoothing = options.inputSmoothing;
    this.inputSmoothing = Number.isFinite(providedSmoothing)
      ? Math.max(0, providedSmoothing)
      : INPUT_SMOOTHING;

    const providedStrafeDamping = options.strafeDamping;
    this.strafeDamping = Number.isFinite(providedStrafeDamping)
      ? clamp(providedStrafeDamping, 0, 1, STRAFE_DAMPING)
      : STRAFE_DAMPING;

    const providedIdleDrag = options.idleLinearDrag;
    this.idleLinearDrag = Number.isFinite(providedIdleDrag) && providedIdleDrag >= 0
      ? providedIdleDrag
      : IDLE_LINEAR_DRAG;

    this.input = createAxisRecord();
    this._smoothedInput = createAxisRecord();

    this.bank = 0;
    this.pitch = 0;
    this.elapsed = 0;

    this.reset();
  }

  setThrustInput({
    forward = this.input.forward,
    strafe = this.input.strafe,
    lift = this.input.lift,
    roll = this.input.roll,
  } = {}) {
    this.input.forward = clamp(forward, -1, 1, this.input.forward);
    this.input.strafe = clamp(strafe, -1, 1, this.input.strafe);
    this.input.lift = clamp(lift, -1, 1, this.input.lift);
    this.input.roll = clamp(roll, -1, 1, this.input.roll);
  }

  setThrottle(value) {
    const nextValue = clamp(value, 0, 1, this.throttle);
    this.throttle = nextValue;
  }

  setSprintActive(isActive) {
    this.isSprinting = Boolean(isActive);
  }

  setInvertPitch(invert) {
    this.invertPitch = Boolean(invert);
  }

  getEffectiveThrottle() {
    const baseThrottle = this.throttle * THROTTLE_POWER_MULTIPLIER;
    const multiplier = this.isSprinting ? this.sprintMultiplier : 1;
    return baseThrottle * multiplier;
  }

  addLookDelta(deltaX, deltaY) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }

    const yawAngle = -deltaX * this.lookSensitivity;
    const pitchAngle = deltaY * this.lookSensitivity;

    if (yawAngle !== 0) {
      this._yawQuaternion.setFromAxisAngle(this._up, yawAngle);
      this.lookQuaternion.premultiply(this._yawQuaternion);
    }

    if (pitchAngle !== 0) {
      // Use WORLD horizontal right axis for pitch to prevent roll drift
      // This ensures up/down stays pure vertical regardless of yaw orientation
      const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
      const horizontalForward = this._acceleration.set(forward.x, 0, forward.z);
      const horizontalLength = horizontalForward.length();
      // Only apply if we have a valid horizontal direction (not looking straight up/down)
      if (horizontalLength > 0.001) {
        horizontalForward.divideScalar(horizontalLength);
        const up = this._up.set(0, 1, 0);
        const right = this._right.crossVectors(up, horizontalForward).normalize();
        this._pitchQuaternion.setFromAxisAngle(right, pitchAngle);
        this.lookQuaternion.premultiply(this._pitchQuaternion);
      }
    }

    this.lookQuaternion.normalize();
  }

  getSpeed() {
    return this.velocity.length();
  }

  update(deltaTime = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      deltaTime = 0;
    }

    this.elapsed += deltaTime;
    const effectiveThrottle = this.getEffectiveThrottle();

    const up = this._up.set(0, 1, 0);

    // Ease input changes over time so gamepad and keyboard controls feel less twitchy.
    const smoothingStrength = this.inputSmoothing > 0 ? 1 - Math.exp(-this.inputSmoothing * deltaTime) : 1;
    const smoothed = this._smoothedInput;

    if (smoothingStrength >= 1) {
      smoothed.forward = this.input.forward;
      smoothed.strafe = this.input.strafe;
      smoothed.lift = this.input.lift;
      smoothed.roll = this.input.roll;
    } else if (smoothingStrength > 0) {
      smoothed.forward += (this.input.forward - smoothed.forward) * smoothingStrength;
      smoothed.strafe += (this.input.strafe - smoothed.strafe) * smoothingStrength;
      smoothed.lift += (this.input.lift - smoothed.lift) * smoothingStrength;
      smoothed.roll += (this.input.roll - smoothed.roll) * smoothingStrength;
    }

    // --- ROTATION-BASED FLIGHT CONTROLS ---
    // Pitch control: by default (unchecked), pushing forward/up tilts the nose up (non-inverted)
    // When invertPitch is true (checked), controls become airplane-style: push forward to dive
    // Joystick UP produces negative forward input, so non-inverted uses the negative to pitch up
    const pitchInput = this.invertPitch ? smoothed.forward : -smoothed.forward;
    const pitchDelta = pitchInput * PITCH_RATE * deltaTime;

    // Yaw: joystick RIGHT (positive roll/strafe) → nose RIGHT (negative rotation on Y-axis)
    // In Three.js, positive Y rotation is counterclockwise (left), so we negate for intuitive controls
    const yawInput = smoothed.roll;
    const yawDelta = -yawInput * YAW_RATE * deltaTime;

    // Apply yaw rotation around global up axis
    if (yawDelta !== 0) {
      this._yawQuaternion.setFromAxisAngle(up, yawDelta);
      this.lookQuaternion.premultiply(this._yawQuaternion).normalize();
    }

    // Apply pitch rotation around the WORLD horizontal right axis
    // This ensures up/down stays pure vertical regardless of yaw orientation
    if (pitchDelta !== 0) {
      // Get current forward direction
      const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
      // Project forward onto horizontal plane and get perpendicular right vector
      const horizontalForward = this._acceleration.set(forward.x, 0, forward.z).normalize();
      // Right axis: horizontalForward × up gives proper right-hand side
      // (up × horizontalForward incorrectly gave LEFT, causing inverted pitch)
      const right = this._right.crossVectors(horizontalForward, up).normalize();
      this._pitchQuaternion.setFromAxisAngle(right, pitchDelta);
      this.lookQuaternion.premultiply(this._pitchQuaternion).normalize();
    }

    // Start with the look quaternion as the base orientation
    this.quaternion.copy(this.lookQuaternion);

    // Get the forward direction AFTER rotation is applied
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

    // --- ROTATION-BASED MOVEMENT ---
    // The bird always moves in its forward direction based on current rotation
    // Cruise speed maintains constant forward velocity
    const cruiseTargetSpeed = CRUISE_FORWARD_SPEED * effectiveThrottle;
    const forwardSpeed = this.velocity.dot(forward);

    // Always apply gentle forward glide to maintain cruise speed
    if (cruiseTargetSpeed > 0) {
      const cruiseAcceleration = (cruiseTargetSpeed - forwardSpeed) * MOVEMENT_ACCELERATION * 0.5;
      this.velocity.addScaledVector(forward, cruiseAcceleration * deltaTime);
    }

    // Apply lift input for direct vertical control (can still ascend/descend beyond pitch)
    if (Math.abs(smoothed.lift) > 1e-3) {
      const liftAcceleration = smoothed.lift * MOVEMENT_ACCELERATION * LIFT_ACCELERATION_MULTIPLIER;
      this.velocity.addScaledVector(up, liftAcceleration * deltaTime);
    }

    // Apply drag
    const dragMultiplier = Math.exp(-LINEAR_DRAG * deltaTime);
    this.velocity.multiplyScalar(dragMultiplier);

    // Correct sideways drift - bird should move where it's pointing, not slide
    const sidewaysSpeed = this.velocity.dot(right);
    if (Math.abs(sidewaysSpeed) > 1e-3) {
      const correctionRate = MOVEMENT_ACCELERATION * 0.8;
      const maxCorrection = correctionRate * deltaTime;
      const correction = Math.sign(sidewaysSpeed) * Math.min(Math.abs(sidewaysSpeed), maxCorrection);
      this.velocity.addScaledVector(right, -correction);
    }

    // Update position based on velocity
    this.position.addScaledVector(this.velocity, deltaTime);

    // --- PROCEDURAL BANKING (ROLL) ---
    // Bank into turns: pushing right → bank right (right wing down, left wing up)
    // Negate yawInput so positive input gives negative bank (right wing down in THREE.js)
    const targetBank = clamp(-yawInput * MAX_BANK_ANGLE, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Smooth interpolation (lerp) for banking
    const bankStep = 1 - Math.exp(-BANK_RESPONSE * deltaTime);
    this.bank += (targetBank - this.bank) * bankStep;
    this.bank = clamp(this.bank, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Apply visual bank rotation around the forward axis
    const bankAxis = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    this._bankQuaternion.setFromAxisAngle(bankAxis, this.bank);
    this.quaternion.multiply(this._bankQuaternion);

    // Reset pitch tracking (no longer used for visual tilt, rotation is in lookQuaternion)
    this.pitch = 0;

    return {
      position: this.position,
      quaternion: this.quaternion,
    };
  }

  getAmbientOffsets() {
    const bob = Math.sin(this.elapsed * AMBIENT_BOB_SPEED) * AMBIENT_BOB_AMPLITUDE;
    const roll = Math.sin(this.elapsed * AMBIENT_ROLL_SPEED) * AMBIENT_ROLL_AMPLITUDE;
    const yaw = Math.cos(this.elapsed * AMBIENT_YAW_SPEED) * AMBIENT_YAW_AMPLITUDE;

    this._ambientPosition.set(0, bob, 0);
    this._ambientEuler.set(0, yaw, roll);
    this._ambientQuaternion.setFromEuler(this._ambientEuler);

    return {
      position: this._ambientPosition,
      quaternion: this._ambientQuaternion,
    };
  }

  reset() {
    this.position.copy(this._initialPosition);
    this.velocity.set(0, 0, 0);
    this.lookQuaternion.copy(this._initialQuaternion);
    this.quaternion.copy(this._initialQuaternion);
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
    this.bank = 0;
    this.pitch = 0;
    this._bankOrientation = forward.z >= 0 ? 1 : -1;
    this.elapsed = 0;
    Object.assign(this.input, createAxisRecord());
    Object.assign(this._smoothedInput, createAxisRecord());
    this.setThrustInput({ forward: 0, strafe: 0, lift: 0, roll: 0 });
    this.setSprintActive(false);
  }
}
