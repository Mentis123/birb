export const AIM_RIG_DEFAULTS = {
  yawRate: Math.PI * 1.5,     // Snappier horizontal rotation
  pitchRate: Math.PI * 0.55,  // More responsive vertical
  maxPitch: (85 * Math.PI) / 180,  // Turret-style vertical range
  smoothing: 10,
  pointerSmoothing: 12,
  lookSensitivity: 0.0025,
  pointerDeadzone: 0.1,
  maxPointerDelta: 40,
  bankInfluence: 0,
  maxBank: 0,
  bankSmoothing: 4,
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const TWO_PI = Math.PI * 2;

// Normalize angle to [-PI, PI] range to prevent drift over long sessions
const normalizeAngle = (angle) => {
  while (angle > Math.PI) angle -= TWO_PI;
  while (angle < -Math.PI) angle += TWO_PI;
  return angle;
};

export class AimRig {
  constructor(THREE, options = {}) {
    if (!THREE) {
      throw new Error('AimRig requires a THREE namespace');
    }
    const { Vector3, Quaternion, Matrix4 } = THREE;
    this.THREE = THREE;
    this.yawRate = options.yawRate ?? AIM_RIG_DEFAULTS.yawRate;
    this.pitchRate = options.pitchRate ?? AIM_RIG_DEFAULTS.pitchRate;
    this.maxPitch = options.maxPitch ?? AIM_RIG_DEFAULTS.maxPitch;
    this.smoothing = options.smoothing ?? AIM_RIG_DEFAULTS.smoothing;
    this.pointerSmoothing = options.pointerSmoothing ?? AIM_RIG_DEFAULTS.pointerSmoothing;
    this.lookSensitivity = options.lookSensitivity ?? AIM_RIG_DEFAULTS.lookSensitivity;
    this.pointerDeadzone = options.pointerDeadzone ?? AIM_RIG_DEFAULTS.pointerDeadzone;
    this.maxPointerDelta = options.maxPointerDelta ?? AIM_RIG_DEFAULTS.maxPointerDelta;
    this.bankInfluence = options.bankInfluence ?? AIM_RIG_DEFAULTS.bankInfluence;
    this.maxBank = options.maxBank ?? AIM_RIG_DEFAULTS.maxBank;
    this.bankSmoothing = options.bankSmoothing ?? AIM_RIG_DEFAULTS.bankSmoothing;

    this._referenceUp = new Vector3(0, 1, 0);
    this._referenceForward = new Vector3(0, 0, -1);
    this._referenceRight = new Vector3(1, 0, 0);
    this._scratchForward = new Vector3(0, 0, -1);
    this._scratchRight = new Vector3(1, 0, 0);
    this._scratchUp = new Vector3(0, 1, 0);
    this._scratchQuat = new Quaternion();
    this._scratchMatrix = new Matrix4();

    this._smoothedX = 0;
    this._smoothedY = 0;
    this._smoothedDeltaX = 0;
    this._smoothedDeltaY = 0;
    this._yaw = 0;
    this._pitch = 0;
    this._active = false;
    // Banking state
    this._previousYaw = 0;
    this._yawVelocity = 0;
    this._smoothedBank = 0;
  }

  setActive(isActive) {
    const next = Boolean(isActive);
    if (next === this._active) return;
    this._active = next;
    this._smoothedX = 0;
    this._smoothedY = 0;
    this._smoothedDeltaX = 0;
    this._smoothedDeltaY = 0;
    if (!next) {
      this._yaw = 0;
      this._pitch = 0;
      this._previousYaw = 0;
      this._yawVelocity = 0;
      this._smoothedBank = 0;
    }
  }

  isActive() {
    return this._active;
  }

  setReferenceFromQuaternion(quaternion) {
    if (!quaternion) return;
    this._referenceForward.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    this._referenceUp.set(0, 1, 0).applyQuaternion(quaternion).normalize();
    this._referenceRight.crossVectors(this._referenceForward, this._referenceUp).normalize();
    this._yaw = 0;
    this._pitch = 0;
    this._smoothedX = 0;
    this._smoothedY = 0;
    this._smoothedDeltaX = 0;
    this._smoothedDeltaY = 0;
  }

  /**
   * Set reference frame directly from forward direction and local up vector.
   * This ensures a perfect horizon regardless of how the bird landed.
   * @param {Vector3} forward - The forward direction (will be projected to tangent plane)
   * @param {Vector3} localUp - The true local up vector (e.g., radial from sphere center)
   */
  setReferenceFromVectors(forward, localUp) {
    if (!forward || !localUp) return;

    // Use the provided localUp directly (this is the key to perfect horizon)
    this._referenceUp.copy(localUp).normalize();

    // Project forward onto the tangent plane perpendicular to localUp
    const forwardProjected = forward.clone()
      .sub(this._referenceUp.clone().multiplyScalar(forward.dot(this._referenceUp)))
      .normalize();

    // Handle edge case: if forward was parallel to up, pick a fallback
    if (forwardProjected.lengthSq() < 0.001) {
      // Use world X projected as fallback
      const fallback = new this.THREE.Vector3(1, 0, 0);
      forwardProjected.copy(fallback)
        .sub(this._referenceUp.clone().multiplyScalar(fallback.dot(this._referenceUp)))
        .normalize();
    }

    this._referenceForward.copy(forwardProjected);
    // Right = forward × up (consistent with getQuaternion)
    this._referenceRight.crossVectors(this._referenceForward, this._referenceUp).normalize();

    // Reset aim angles and banking state
    this._yaw = 0;
    this._pitch = 0;
    this._smoothedX = 0;
    this._smoothedY = 0;
    this._smoothedDeltaX = 0;
    this._smoothedDeltaY = 0;
    this._previousYaw = 0;
    this._yawVelocity = 0;
    this._smoothedBank = 0;
  }

  update({ axisX = 0, axisY = 0, deltaX = 0, deltaY = 0 } = {}, deltaTime = 0) {
    if (!this._active) return;
    const limitedDelta = Math.min(Math.max(deltaTime, 0), 0.05);
    if (limitedDelta > 0) {
      const smoothStep = 1 - Math.exp(-this.smoothing * limitedDelta);
      this._smoothedX += (axisX - this._smoothedX) * smoothStep;
      this._smoothedY += (axisY - this._smoothedY) * smoothStep;

      this._yaw += -this._smoothedX * this.yawRate * limitedDelta;
      this._pitch += this._smoothedY * this.pitchRate * limitedDelta;
    }

    const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
    const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
    const targetDeltaX = Math.abs(safeDeltaX) < this.pointerDeadzone
      ? 0
      : clamp(safeDeltaX, -this.maxPointerDelta, this.maxPointerDelta);
    const targetDeltaY = Math.abs(safeDeltaY) < this.pointerDeadzone
      ? 0
      : clamp(safeDeltaY, -this.maxPointerDelta, this.maxPointerDelta);

    if (limitedDelta > 0) {
      const pointerSmoothStep = 1 - Math.exp(-this.pointerSmoothing * limitedDelta);
      this._smoothedDeltaX += (targetDeltaX - this._smoothedDeltaX) * pointerSmoothStep;
      this._smoothedDeltaY += (targetDeltaY - this._smoothedDeltaY) * pointerSmoothStep;
    } else {
      this._smoothedDeltaX = targetDeltaX;
      this._smoothedDeltaY = targetDeltaY;
    }

    if (this._smoothedDeltaX !== 0 || this._smoothedDeltaY !== 0) {
      this._yaw += -this._smoothedDeltaX * this.lookSensitivity;
      this._pitch += this._smoothedDeltaY * this.lookSensitivity;
    }

    // Clamp pitch to prevent looking past vertical
    this._pitch = clamp(this._pitch, -this.maxPitch, this.maxPitch);

    // Normalize yaw to prevent floating point drift over long sessions
    // This allows continuous 360° rotation while keeping values bounded
    this._yaw = normalizeAngle(this._yaw);

    // Calculate yaw velocity for banking effect
    if (limitedDelta > 0) {
      const yawDelta = normalizeAngle(this._yaw - this._previousYaw);
      this._yawVelocity = yawDelta / limitedDelta;
      this._previousYaw = this._yaw;

      // Calculate target bank based on yaw velocity (turn left = bank left, etc.)
      // Negative because turning right (negative yaw change) should bank right (negative bank)
      const targetBank = clamp(
        -this._yawVelocity * this.bankInfluence,
        -this.maxBank,
        this.maxBank
      );

      // Smooth the bank for pleasant transitions
      const bankSmoothStep = 1 - Math.exp(-this.bankSmoothing * limitedDelta);
      this._smoothedBank += (targetBank - this._smoothedBank) * bankSmoothStep;
    }
  }

  getQuaternion(target = new this.THREE.Quaternion()) {
    // Standard FPS/turret camera approach:
    // 1. Apply yaw around reference up
    // 2. Apply pitch around the yawed right axis
    // 3. Calculate up from right × forward to maintain orthonormal basis
    //
    // Key insight: right stays constant for a given yaw (it's the pitch axis).
    // Recalculating right from pitchedForward × up fails at high pitch angles
    // because pitchedForward becomes nearly parallel to up.

    const forward = this._scratchForward.copy(this._referenceForward);

    // Apply yaw rotation around reference up
    if (Math.abs(this._yaw) > 1e-8) {
      this._scratchQuat.setFromAxisAngle(this._referenceUp, this._yaw);
      forward.applyQuaternion(this._scratchQuat).normalize();
    }

    // Calculate right vector (perpendicular to yawed forward and reference up)
    // This right vector stays constant regardless of pitch
    const right = this._scratchRight.crossVectors(forward, this._referenceUp).normalize();

    // Apply pitch rotation around the right vector
    if (Math.abs(this._pitch) > 1e-8) {
      this._scratchQuat.setFromAxisAngle(right, this._pitch);
      forward.applyQuaternion(this._scratchQuat).normalize();
    }

    // Calculate up vector to be perpendicular to both right and forward
    // This ensures an orthonormal basis even at extreme pitch angles
    let up = this._scratchUp.crossVectors(right, forward).normalize();

    // Apply banking (roll around the forward axis) for visual feedback during turns
    // This tilts the horizon slightly when turning, creating a more immersive feel
    if (Math.abs(this._smoothedBank) > 1e-6) {
      this._scratchQuat.setFromAxisAngle(forward, this._smoothedBank);
      up.applyQuaternion(this._scratchQuat).normalize();
      // Recalculate right to maintain orthonormal basis after bank
      right.crossVectors(forward, up).normalize();
    }

    // Build rotation matrix from orthonormal basis
    // In Three.js camera convention, we look down -Z, so negate forward
    this._scratchMatrix.makeBasis(right, up, forward.clone().negate());
    return target.setFromRotationMatrix(this._scratchMatrix);
  }

  getLookDirection(target = new this.THREE.Vector3()) {
    const quaternion = this.getQuaternion(this._scratchQuat);
    return target.set(0, 0, -1).applyQuaternion(quaternion).normalize();
  }
}
