export const AIM_RIG_DEFAULTS = {
  yawRate: Math.PI * 0.8,     // Faster horizontal rotation for responsive feel
  pitchRate: Math.PI * 0.65,  // Faster vertical rotation
  maxPitch: (80 * Math.PI) / 180,  // Slightly reduced to prevent disorienting extremes
  smoothing: 8,               // Less smoothing for more direct feel
  pointerSmoothing: 12,       // Reduced for faster pointer response
  lookSensitivity: 0.0025,    // Slightly higher for better pointer control
  pointerDeadzone: 0.08,      // Smaller deadzone for tighter control
  maxPointerDelta: 50,        // Allow larger pointer movements
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
    const up = this._scratchUp.crossVectors(right, forward).normalize();

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
