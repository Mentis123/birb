// ============================================================================
// Simplified free flight controller used across the demo scenes
// ============================================================================

export const TURN_SPEED = Math.PI * 0.5;

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
    const { Vector3, Quaternion } = three;

    this.lookQuaternion = options.orientation?.clone?.() ?? new Quaternion();
    this.quaternion = this.lookQuaternion.clone();
    this.position = options.position?.clone?.() ?? new Vector3(0, 1, 0);

    this.velocity = new Vector3();
    this.acceleration = new Vector3();
    this.speed = 0;
    this.lift = 0;
    this.gravity = 0;

    this._up = new Vector3(0, 1, 0);
    this._right = new Vector3(1, 0, 0);
    this._direction = new Vector3(0, 0, -1);
    this._yawQuaternion = new Quaternion();
    this._pitchQuaternion = new Quaternion();
    this._rollAxis = new Vector3(0, 0, 1);
    this._velocityBuffer = new Vector3();

    this._ambientOffsets = {
      position: new Vector3(),
      quaternion: new Quaternion(),
    };

    this._initialPosition = this.position.clone();
    this._initialQuaternion = this.lookQuaternion.clone();

    this.turnSpeed = options.turnSpeed ?? TURN_SPEED;

    const speedMin = Math.max(0, Number.isFinite(options.speedMin) ? options.speedMin : 0.35);
    const speedMaxCandidate = Number.isFinite(options.speedMax) ? options.speedMax : 7.5;
    const speedMax = Math.max(speedMaxCandidate, speedMin + 0.5);

    this.config = {
      speedMin,
      speedMax,
      lift: Math.max(0.05, Number.isFinite(options.lift) ? options.lift : 1.25),
      gravity: Math.max(0.05, Number.isFinite(options.gravity) ? options.gravity : 0.45),
      flapStrength: Math.max(
        0.05,
        Number.isFinite(options.flapStrength) ? options.flapStrength : 1.1,
      ),
    };

    this.gravity = this.config.gravity;

    const initialThrottle = Number.isFinite(options.initialThrottle)
      ? Math.min(Math.max(options.initialThrottle, 0), 1)
      : 0.6;

    this.input = {
      strafe: 0,
      yaw: 0,
      pitch: 0,
      throttle: initialThrottle,
      dive: false,
      hover: initialThrottle <= 0.08,
    };

    this._smoothedInput = { yaw: 0, pitch: 0 };

    this.elapsed = 0;
    this.bank = 0;
    this.isSprinting = false;

    this.reset();
  }

  setThrustInput({
    strafe = this.input.strafe,
    yaw = Number.isFinite(strafe) ? strafe : this.input.yaw,
    pitch = this.input.pitch,
  } = {}) {
    const nextStrafe = clamp(strafe, -1, 1, this.input.strafe);
    this.input.strafe = nextStrafe;
    this.input.yaw = clamp(Number.isFinite(yaw) ? yaw : nextStrafe, -1, 1, this.input.yaw);
    this.input.pitch = clamp(pitch, -1, 1, this.input.pitch);
  }

  setThrottle(value) {
    const normalized = clamp(Number.parseFloat(value), 0, 1, this.input.throttle);
    this.input.throttle = normalized;
    this.input.hover = normalized <= 0.08;
  }

  setSprintActive(isActive) {
    const next = Boolean(isActive);
    this.isSprinting = next;
    this.input.dive = next;
    if (next) {
      this.input.hover = false;
    }
  }

  getEffectiveThrottle() {
    return this.input.throttle;
  }

  addLookDelta(deltaX, deltaY) {}

  getSpeed() {
    return this.speed;
  }

  getVelocity() {
    return this.velocity.clone();
  }

  getPitch() {
    return 0;
  }

  getPitchDegrees() {
    return 0;
  }

  setMovementMode(mode) {
    return "flying";
  }

  getMovementMode() {
    return "flying";
  }

  requestJump(strength) {
    return false;
  }

  requestTakeoff() {
    return false;
  }

  isGrounded() {
    return false;
  }

  update(deltaTime = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      deltaTime = 0;
    }

    this.elapsed += deltaTime;

    const smoothingStrength = deltaTime > 0 ? 1 - Math.exp(-10 * deltaTime) : 1;
    this._smoothedInput.yaw += (this.input.yaw - this._smoothedInput.yaw) * smoothingStrength;
    this._smoothedInput.pitch += (this.input.pitch - this._smoothedInput.pitch) * smoothingStrength;

    if (deltaTime <= 0) {
      return {
        position: this.position,
        quaternion: this.quaternion,
      };
    }

    const yawDelta = clamp(this._smoothedInput.yaw, -1, 1, 0) * this.turnSpeed * deltaTime;
    const pitchDelta = clamp(this._smoothedInput.pitch, -1, 1, 0) * (this.turnSpeed * 0.5) * deltaTime;

    if (Math.abs(yawDelta) > 1e-6) {
      this._yawQuaternion.setFromAxisAngle(this._up, -yawDelta);
      this.lookQuaternion.premultiply(this._yawQuaternion);
    }

    if (Math.abs(pitchDelta) > 1e-6) {
      this._right.set(1, 0, 0).applyQuaternion(this.lookQuaternion).normalize();
      this._pitchQuaternion.setFromAxisAngle(this._right, pitchDelta);
      this.lookQuaternion.multiply(this._pitchQuaternion);
    }

    this.lookQuaternion.normalize();
    this.quaternion.copy(this.lookQuaternion);

    const speedRange = Math.max(this.config.speedMax - this.config.speedMin, 0.0001);
    const throttle = clamp(this.input.throttle, 0, 1, 0.6);
    const flapDelta = this.input.dive ? this.config.flapStrength : 0;
    const hoverDrag = this.input.hover ? this.config.flapStrength * 0.5 : 0;
    const targetSpeed = this.config.speedMin + speedRange * throttle + flapDelta - hoverDrag;
    const clampedTargetSpeed = clamp(targetSpeed, this.config.speedMin, this.config.speedMax);
    this.speed += (clampedTargetSpeed - this.speed) * smoothingStrength;

    this._direction.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();

    const pitchLift = clamp(-this._smoothedInput.pitch * this.config.lift, -this.config.lift, this.config.lift);
    const hoverLift = this.input.hover ? this.config.lift * 0.75 : 0;
    const diveDrop = this.input.dive ? -this.config.lift * 0.35 : 0;
    const targetLift = pitchLift + hoverLift + diveDrop;
    this.lift += (targetLift - this.lift) * smoothingStrength;

    const verticalVelocity = this.lift - this.gravity;

    this._velocityBuffer.copy(this._direction).multiplyScalar(this.speed);
    this._velocityBuffer.y += verticalVelocity;

    if (deltaTime > 0) {
      this.acceleration.copy(this._velocityBuffer).sub(this.velocity).divideScalar(deltaTime);
    } else {
      this.acceleration.set(0, 0, 0);
    }

    this.velocity.copy(this._velocityBuffer);
    this.position.addScaledVector(this.velocity, deltaTime);

    const speedFactor = clamp(this.speed / Math.max(this.config.speedMax, 0.0001), 0, 1, 0);
    const bankTarget = clamp(-this._smoothedInput.yaw, -1, 1, 0) * (0.35 + 0.25 * speedFactor);
    this.bank += (bankTarget - this.bank) * smoothingStrength;

    return {
      position: this.position,
      quaternion: this.quaternion,
    };
  }

  getAmbientOffsets() {
    const speedFactor = clamp(this.speed / Math.max(this.config.speedMax, 0.0001), 0, 1, 0);
    const wobble = 0.01 + 0.015 * speedFactor;
    const bob = Math.sin(this.elapsed * 2.1) * wobble;
    const sway = Math.sin(this.elapsed * 1.1) * wobble * 0.5;
    this._ambientOffsets.position.set(sway, bob, 0);

    this._rollAxis.copy(this._direction).normalize();
    const rollAngle = this.bank * (0.5 + 0.25 * speedFactor);
    this._ambientOffsets.quaternion.setFromAxisAngle(this._rollAxis, rollAngle);

    return this._ambientOffsets;
  }

  reset() {
    this.position.copy(this._initialPosition);
    this.lookQuaternion.copy(this._initialQuaternion);
    this.quaternion.copy(this._initialQuaternion);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    const normalizedThrottle = clamp(this.input.throttle, 0, 1, 0.6);
    const speedRange = Math.max(this.config.speedMax - this.config.speedMin, 0.0001);
    this.speed = this.config.speedMin + speedRange * normalizedThrottle;
    this.lift = 0;
    this.gravity = this.config.gravity;
    this.elapsed = 0;
    this.input.strafe = 0;
    this.input.yaw = 0;
    this.input.pitch = 0;
    this.input.dive = false;
    this.input.hover = normalizedThrottle <= 0.08;
    this._smoothedInput.yaw = 0;
    this._smoothedInput.pitch = 0;
    this.bank = 0;
    this._direction.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
  }
}
