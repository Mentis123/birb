// ============================================================================
// ULTRA SIMPLIFIED CONTROLLER - Just floating and rotating
// ============================================================================

// Just turning speed
export const TURN_SPEED = Math.PI * 0.5; // How fast we rotate left/right

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

    // Fixed position - birb just floats here
    this.position = new Vector3(0, 1, 0);
    this.quaternion = new Quaternion();
    this.lookQuaternion = new Quaternion();

    this._up = new Vector3(0, 1, 0);
    this._yawQuaternion = new Quaternion();

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 1, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.turnSpeed = options.turnSpeed ?? TURN_SPEED;

    // Only track strafe input (left/right for rotation)
    this.input = { strafe: 0 };
    this._smoothedInput = { strafe: 0 };

    this.elapsed = 0;
    this.bank = 0; // No banking, but keep property for compatibility
    this.isSprinting = false;

    this.reset();
  }

  setThrustInput({ strafe = this.input.strafe } = {}) {
    this.input.strafe = clamp(strafe, -1, 1, this.input.strafe);
  }

  // Dummy methods for compatibility
  setThrottle(value) {}
  setSprintActive(isActive) {}
  getEffectiveThrottle() { return 1; }
  addLookDelta(deltaX, deltaY) {}
  getSpeed() { return 0; }
  getVelocity() { return new this.THREE.Vector3(0, 0, 0); }
  getPitch() { return 0; }
  getPitchDegrees() { return 0; }
  setMovementMode(mode) { return "floating"; }
  getMovementMode() { return "floating"; }
  requestJump(strength) { return false; }
  requestTakeoff() { return false; }
  isGrounded() { return false; }

  update(deltaTime = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      deltaTime = 0;
    }

    this.elapsed += deltaTime;

    // Simple input smoothing
    const smoothingStrength = deltaTime > 0 ? 1 - Math.exp(-12 * deltaTime) : 1;
    this._smoothedInput.strafe += (this.input.strafe - this._smoothedInput.strafe) * smoothingStrength;

    if (deltaTime <= 0) {
      return {
        position: this.position,
        quaternion: this.quaternion,
      };
    }

    // Only handle yaw rotation (left/right turning)
    const strafeInput = clamp(this._smoothedInput.strafe, -1, 1, 0);
    const yawAngle = -strafeInput * this.turnSpeed * deltaTime;

    if (Math.abs(yawAngle) > 1e-6) {
      this._yawQuaternion.setFromAxisAngle(this._up, yawAngle);
      this.lookQuaternion.premultiply(this._yawQuaternion);
    }

    this.lookQuaternion.normalize();
    this.quaternion.copy(this.lookQuaternion);

    // Position stays fixed - just floating in space
    this.position.copy(this._initialPosition);

    return {
      position: this.position,
      quaternion: this.quaternion,
    };
  }

  getAmbientOffsets() {
    // No ambient motion - just static
    return {
      position: new this.THREE.Vector3(0, 0, 0),
      quaternion: new this.THREE.Quaternion(),
    };
  }

  reset() {
    this.position.copy(this._initialPosition);
    this.lookQuaternion.copy(this._initialQuaternion);
    this.quaternion.copy(this._initialQuaternion);
    this.elapsed = 0;
    this.input.strafe = 0;
    this._smoothedInput.strafe = 0;
  }
}
