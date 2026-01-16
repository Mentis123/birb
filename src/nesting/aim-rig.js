export const AIM_RIG_DEFAULTS = {
  yawRate: Math.PI * 0.5,
  pitchRate: Math.PI * 0.4,
  maxPitch: (85 * Math.PI) / 180,
  smoothing: 10,
  lookSensitivity: 0.002,
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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
    this.lookSensitivity = options.lookSensitivity ?? AIM_RIG_DEFAULTS.lookSensitivity;

    this._referenceUp = new Vector3(0, 1, 0);
    this._referenceForward = new Vector3(0, 0, -1);
    this._referenceRight = new Vector3(1, 0, 0);
    this._scratchForward = new Vector3(0, 0, -1);
    this._scratchRight = new Vector3(1, 0, 0);
    this._scratchQuat = new Quaternion();
    this._scratchMatrix = new Matrix4();

    this._smoothedX = 0;
    this._smoothedY = 0;
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

    if (Number.isFinite(deltaX) || Number.isFinite(deltaY)) {
      this._yaw += -deltaX * this.lookSensitivity;
      this._pitch += deltaY * this.lookSensitivity;
    }

    this._pitch = clamp(this._pitch, -this.maxPitch, this.maxPitch);
  }

  getQuaternion(target = new this.THREE.Quaternion()) {
    const up = this._referenceUp;
    const yawedForward = this._scratchForward.copy(this._referenceForward);
    if (Math.abs(this._yaw) > 1e-8) {
      this._scratchQuat.setFromAxisAngle(up, this._yaw);
      yawedForward.applyQuaternion(this._scratchQuat).normalize();
    }

    const right = this._scratchRight.crossVectors(yawedForward, up).normalize();
    const pitchedForward = this._scratchForward.copy(yawedForward);
    if (Math.abs(this._pitch) > 1e-8) {
      this._scratchQuat.setFromAxisAngle(right, this._pitch);
      pitchedForward.applyQuaternion(this._scratchQuat).normalize();
    }

    const finalRight = this._scratchRight.crossVectors(pitchedForward, up).normalize();
    this._scratchMatrix.makeBasis(finalRight, up, pitchedForward.clone().negate());
    return target.setFromRotationMatrix(this._scratchMatrix);
  }

  getLookDirection(target = new this.THREE.Vector3()) {
    const quaternion = this.getQuaternion(this._scratchQuat);
    return target.set(0, 0, -1).applyQuaternion(quaternion).normalize();
  }
}
