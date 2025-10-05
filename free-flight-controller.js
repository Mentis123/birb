export const MOVEMENT_ACCELERATION = 4.5;
export const LINEAR_DRAG = 1.6;
export const SPRINT_MULTIPLIER = 1.75;
export const MAX_PITCH_ANGLE = (70 * Math.PI) / 180;
// Allow a full 180° roll so the player can comfortably fly upside down.
export const BANK_MAX_ANGLE = Math.PI;
export const BANK_RESPONSIVENESS = 6.5;
export const LOOK_SENSITIVITY = 0.0025;
export const AMBIENT_BOB_AMPLITUDE = 0.16;
export const AMBIENT_BOB_SPEED = 1.15;
export const AMBIENT_ROLL_AMPLITUDE = 0.08;
export const AMBIENT_ROLL_SPEED = 0.9;
export const AMBIENT_YAW_AMPLITUDE = 0.05;
export const AMBIENT_YAW_SPEED = 0.7;

const clamp = (value, min, max, fallback) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

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
    this.euler = new Euler(0, 0, 0, "YXZ");

    this._forward = new Vector3(0, 0, -1);
    this._right = new Vector3(1, 0, 0);
    this._up = new Vector3(0, 1, 0);
    this._acceleration = new Vector3();
    this._bankQuaternion = new Quaternion();
    this._ambientPosition = new Vector3();
    this._ambientQuaternion = new Quaternion();
    this._ambientEuler = new Euler(0, 0, 0, "YXZ");

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    this.throttle = options.throttle ?? 1;
    this.sprintMultiplier = options.sprintMultiplier ?? SPRINT_MULTIPLIER;
    this.isSprinting = false;

    this.input = {
      forward: 0,
      strafe: 0,
      lift: 0,
    };

    this.yaw = 0;
    this.pitch = 0;
    this.bank = 0;
    this.elapsed = 0;

    this.reset();
  }

  setThrustInput({ forward = this.input.forward, strafe = this.input.strafe, lift = this.input.lift } = {}) {
    this.input.forward = clamp(forward, -1, 1, this.input.forward);
    this.input.strafe = clamp(strafe, -1, 1, this.input.strafe);
    this.input.lift = clamp(lift, -1, 1, this.input.lift);
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

    this.yaw -= deltaX * this.lookSensitivity;
    this.pitch += deltaY * this.lookSensitivity;

    if (this.yaw > Math.PI) {
      this.yaw -= Math.PI * 2;
    } else if (this.yaw < -Math.PI) {
      this.yaw += Math.PI * 2;
    }

    const minPitch = -MAX_PITCH_ANGLE;
    const maxPitch = MAX_PITCH_ANGLE;
    this.pitch = Math.min(Math.max(this.pitch, minPitch), maxPitch);
  }

  getSpeed() {
    return this.velocity.length();
  }

  update(deltaTime = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      deltaTime = 0;
    }

    this.elapsed += deltaTime;

    this.euler.set(this.pitch, this.yaw, 0);
    this.quaternion.setFromEuler(this.euler);

    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    const up = this._up.set(0, 1, 0);

    const acceleration = this._acceleration.set(0, 0, 0);
    acceleration.addScaledVector(forward, this.input.forward);
    acceleration.addScaledVector(right, this.input.strafe);
    acceleration.addScaledVector(up, this.input.lift);

    if (acceleration.lengthSq() > 1) {
      acceleration.normalize();
    }

    acceleration.multiplyScalar(MOVEMENT_ACCELERATION * this.getEffectiveThrottle());

    this.velocity.addScaledVector(acceleration, deltaTime);

    const dragMultiplier = Math.max(0, 1 - LINEAR_DRAG * deltaTime);
    this.velocity.multiplyScalar(dragMultiplier);

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

    const bankTarget = this.input.strafe * bankOrientation * BANK_MAX_ANGLE;
    const bankStep = 1 - Math.exp(-BANK_RESPONSIVENESS * deltaTime);
    this.bank += (bankTarget - this.bank) * bankStep;

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
    this.quaternion.copy(this._initialQuaternion);
    this.euler.setFromQuaternion(this._initialQuaternion, "YXZ");
    this.pitch = this.euler.x;
    this.yaw = this.euler.y;
    this.bank = 0;
    this.elapsed = 0;
    this.setThrustInput({ forward: 0, strafe: 0, lift: 0 });
    this.setSprintActive(false);
  }
}
