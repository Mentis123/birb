// Relaxed, chill gliding feel
export const MOVEMENT_ACCELERATION = 2.8;
export const LINEAR_DRAG = 1.2;
export const SPRINT_MULTIPLIER = 1.4;
// Controls how quickly the bird eases toward new roll velocities when strafing.
export const BANK_RESPONSIVENESS = 2.5;
// Maximum roll velocity (radians per second) that sustained input can achieve.
export const BANK_ROLL_SPEED = Math.PI * 0.8;
// Upper bound on how far the bird can bank for readability and comfort.
export const MAX_BANK_ANGLE = Math.PI / 3;
// How quickly a banked input should translate into a gentle yaw turn.
export const BANK_TURN_RATE = Math.PI * 0.45;
// How quickly the bird levels its wings when roll input stops.
export const BANK_RETURN_RATE = 1.6;
// Minimum desired forward speed so the bird always keeps gliding.
export const CRUISE_FORWARD_SPEED = 2.1;
export const LOOK_SENSITIVITY = 0.002;
export const AMBIENT_BOB_AMPLITUDE = 0.12;
export const AMBIENT_BOB_SPEED = 0.8;
export const AMBIENT_ROLL_AMPLITUDE = 0.05;
export const AMBIENT_ROLL_SPEED = 0.6;
export const AMBIENT_YAW_AMPLITUDE = 0.03;
export const AMBIENT_YAW_SPEED = 0.5;

export const INPUT_SMOOTHING = 8;
export const STRAFE_DAMPING = 0.5;
export const IDLE_LINEAR_DRAG = 2.5;
export const LIFT_ACCELERATION_MULTIPLIER = 1.8;

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
    this._bankVelocity = 0;
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

  getEffectiveThrottle() {
    const baseThrottle = this.throttle;
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
      const right = this._right.set(1, 0, 0).applyQuaternion(this.lookQuaternion).normalize();
      this._pitchQuaternion.setFromAxisAngle(right, pitchAngle);
      this.lookQuaternion.multiply(this._pitchQuaternion);
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

    const bankedYaw = smoothed.roll * BANK_TURN_RATE;
    if (bankedYaw !== 0) {
      this._yawQuaternion.setFromAxisAngle(up, bankedYaw * deltaTime);
      this.lookQuaternion.premultiply(this._yawQuaternion).normalize();
    }

    this.quaternion.copy(this.lookQuaternion);

    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

    const acceleration = this._acceleration.set(0, 0, 0);
    acceleration.addScaledVector(forward, smoothed.forward);
    acceleration.addScaledVector(right, smoothed.strafe * this.strafeDamping);
    acceleration.addScaledVector(up, smoothed.lift * LIFT_ACCELERATION_MULTIPLIER);

    if (acceleration.lengthSq() > 1) {
      acceleration.normalize();
    }

    const hasTranslationInput =
      Math.abs(smoothed.forward) > 1e-3 ||
      Math.abs(smoothed.strafe) > 1e-3 ||
      Math.abs(smoothed.lift) > 1e-3;

    acceleration.multiplyScalar(MOVEMENT_ACCELERATION * this.getEffectiveThrottle());

    this.velocity.addScaledVector(acceleration, deltaTime);

    const dragMultiplier = Math.exp(-LINEAR_DRAG * deltaTime);
    this.velocity.multiplyScalar(dragMultiplier);

    if (!hasTranslationInput) {
      const idleDragMultiplier = Math.exp(-this.idleLinearDrag * deltaTime);
      this.velocity.multiplyScalar(idleDragMultiplier);
    }

    const forwardSpeed = this.velocity.dot(forward);
    const wantsForwardGlide = smoothed.forward >= -0.1;
    if (wantsForwardGlide && forwardSpeed < CRUISE_FORWARD_SPEED) {
      const cruiseAcceleration = (CRUISE_FORWARD_SPEED - forwardSpeed) * MOVEMENT_ACCELERATION * 0.35;
      this.velocity.addScaledVector(forward, cruiseAcceleration * deltaTime);
    }

    if (Math.abs(smoothed.strafe) < 0.05) {
      const sidewaysSpeed = this.velocity.dot(right);
      if (Math.abs(sidewaysSpeed) > 1e-3) {
        const correctionRate = MOVEMENT_ACCELERATION * 0.45;
        const maxCorrection = correctionRate * deltaTime;
        const correction = Math.sign(sidewaysSpeed) * Math.min(Math.abs(sidewaysSpeed), maxCorrection);
        this.velocity.addScaledVector(right, -correction);
      }
    }

    this.position.addScaledVector(this.velocity, deltaTime);

    const forwardZ = forward.z;
    let bankOrientation = 1;
    // When the bird is facing back toward the camera (positive Z), invert the
    // roll direction so strafing left still lowers the left wing.
    if (forwardZ > 1e-4) {
      bankOrientation = -1;
    } else if (forwardZ < -1e-4) {
      bankOrientation = 1;
    }

    const bankStep = 1 - Math.exp(-BANK_RESPONSIVENESS * deltaTime);
    const orientationStep = 1 - Math.exp(-BANK_RESPONSIVENESS * 0.6 * deltaTime);
    this._bankOrientation += (bankOrientation - this._bankOrientation) * orientationStep;

    const rollInput = smoothed.roll * this._bankOrientation;
    const hasRollInput = Math.abs(rollInput) > 1e-4;
    const targetAngularVelocity = hasRollInput
      ? rollInput * BANK_ROLL_SPEED
      : -this.bank * BANK_RETURN_RATE - this._bankVelocity;

    this._bankVelocity += targetAngularVelocity * bankStep;

    this.bank += this._bankVelocity * deltaTime;
    this.bank = clamp(this.bank, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);
    // Prevent the clamp from fighting the easing by clearing residual velocity at the limits.
    if (Math.abs(this.bank) >= MAX_BANK_ANGLE && Math.sign(this.bank) === Math.sign(this._bankVelocity)) {
      this._bankVelocity = 0;
    }

    this._bankQuaternion.setFromAxisAngle(forward, this.bank);
    this.quaternion.multiply(this._bankQuaternion);

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
    this.bank = 0;
    this._bankVelocity = 0;
    this._bankOrientation = 1;
    this.elapsed = 0;
    Object.assign(this.input, createAxisRecord());
    Object.assign(this._smoothedInput, createAxisRecord());
    this.setThrustInput({ forward: 0, strafe: 0, lift: 0, roll: 0 });
    this.setSprintActive(false);
  }
}
