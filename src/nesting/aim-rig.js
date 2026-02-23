export const AIM_RIG_DEFAULTS = {
  // Rotation speed targets (rad/s at full joystick deflection)
  yawRate: Math.PI * 1.2,          // Horizontal: 216°/s target
  pitchRate: Math.PI * 0.96,       // Vertical: 173°/s target

  // Pitch limits
  maxPitch: (85 * Math.PI) / 180,  // 85° up
  minPitch: (-30 * Math.PI) / 180, // 30° below horizon (needed for distant targets on sphere)

  // Input stabilization
  smoothing: 15,                    // Joystick exponential smoothing
  pointerSmoothing: 12,             // Pointer/touch drag smoothing
  lookSensitivity: 0.0025,          // Pointer delta → angle scaling
  pointerDeadzone: 0.1,             // Min pointer movement to register (px)
  maxPointerDelta: 40,              // Max pointer movement per frame (px)
  axisDeadzone: 0.08,               // Joystick center deadzone
  axisExpo: 0.4,                    // Non-linear: fine control at small deflections

  // Inertia system — creates "heavy turret" feel
  // Uses asymmetric stiffness: high tracking during input, low friction on release
  trackingStiffness: 25,            // How fast velocity tracks input (higher = snappier response)
  coastStiffness: 4.0,              // Velocity decay on release (lower = more momentum glide)
  maxYawVelocity: Math.PI * 1.2,    // Max horizontal rotation speed (rad/s)
  maxPitchVelocity: Math.PI * 0.96, // Max vertical rotation speed (rad/s)

  // Banking (visual roll during horizontal turns)
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
    const configuredMaxPitch = options.maxPitch ?? AIM_RIG_DEFAULTS.maxPitch;
    const configuredMinPitch = options.minPitch ?? AIM_RIG_DEFAULTS.minPitch;
    this.maxPitch = Math.max(configuredMaxPitch, configuredMinPitch);
    this.minPitch = Math.min(configuredMinPitch, configuredMaxPitch);
    this.smoothing = options.smoothing ?? AIM_RIG_DEFAULTS.smoothing;
    this.pointerSmoothing = options.pointerSmoothing ?? AIM_RIG_DEFAULTS.pointerSmoothing;
    this.lookSensitivity = options.lookSensitivity ?? AIM_RIG_DEFAULTS.lookSensitivity;
    this.pointerDeadzone = options.pointerDeadzone ?? AIM_RIG_DEFAULTS.pointerDeadzone;
    this.maxPointerDelta = options.maxPointerDelta ?? AIM_RIG_DEFAULTS.maxPointerDelta;
    this.axisDeadzone = options.axisDeadzone ?? AIM_RIG_DEFAULTS.axisDeadzone;
    this.axisExpo = options.axisExpo ?? AIM_RIG_DEFAULTS.axisExpo;
    this.trackingStiffness = options.trackingStiffness ?? AIM_RIG_DEFAULTS.trackingStiffness;
    this.coastStiffness = options.coastStiffness ?? AIM_RIG_DEFAULTS.coastStiffness;
    this.maxYawVelocity = options.maxYawVelocity ?? AIM_RIG_DEFAULTS.maxYawVelocity;
    this.maxPitchVelocity = options.maxPitchVelocity ?? AIM_RIG_DEFAULTS.maxPitchVelocity;
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

    // Velocity-driven inertia state
    this._yawVelocity = 0;
    this._pitchVelocity = 0;

    // Banking state
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
      this._yawVelocity = 0;
      this._pitchVelocity = 0;
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
    this._yawVelocity = 0;
    this._pitchVelocity = 0;
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

    // Reset all state
    this._yaw = 0;
    this._pitch = 0;
    this._yawVelocity = 0;
    this._pitchVelocity = 0;
    this._smoothedX = 0;
    this._smoothedY = 0;
    this._smoothedDeltaX = 0;
    this._smoothedDeltaY = 0;
    this._smoothedBank = 0;
  }

  // Apply deadzone and expo curve to a single axis value.
  // Deadzone eliminates joystick noise near center.
  // Expo blends linear with cubic for fine control at small deflections
  // and fast sweeps at full deflection.
  _shapeAxis(value) {
    const magnitude = Math.abs(value);
    if (magnitude < this.axisDeadzone) return 0;
    const sign = value > 0 ? 1 : -1;
    const remapped = (magnitude - this.axisDeadzone) / (1 - this.axisDeadzone);
    const clamped = Math.min(remapped, 1);
    const k = this.axisExpo;
    return sign * ((1 - k) * clamped + k * clamped * clamped * clamped);
  }

  update({ axisX = 0, axisY = 0, deltaX = 0, deltaY = 0 } = {}, deltaTime = 0) {
    if (!this._active) return;
    const dt = Math.min(Math.max(deltaTime, 0), 0.05);
    if (dt <= 0) return;

    // ── Channel 1: Joystick (rate-based) ───────────────────────────
    // Shape raw input through deadzone + expo curve, then smooth
    const shapedX = this._shapeAxis(axisX);
    const shapedY = this._shapeAxis(axisY);

    const smoothStep = 1 - Math.exp(-this.smoothing * dt);
    this._smoothedX += (shapedX - this._smoothedX) * smoothStep;
    this._smoothedY += (shapedY - this._smoothedY) * smoothStep;

    // Joystick drives desired angular velocity
    let desiredYawVel = -this._smoothedX * this.yawRate;
    let desiredPitchVel = this._smoothedY * this.pitchRate;

    // ── Channel 2: Pointer/touch drag (delta-based) ────────────────
    const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
    const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
    const targetDeltaX = Math.abs(safeDeltaX) < this.pointerDeadzone
      ? 0
      : clamp(safeDeltaX, -this.maxPointerDelta, this.maxPointerDelta);
    const targetDeltaY = Math.abs(safeDeltaY) < this.pointerDeadzone
      ? 0
      : clamp(safeDeltaY, -this.maxPointerDelta, this.maxPointerDelta);

    const pointerSmoothStep = 1 - Math.exp(-this.pointerSmoothing * dt);
    this._smoothedDeltaX += (targetDeltaX - this._smoothedDeltaX) * pointerSmoothStep;
    this._smoothedDeltaY += (targetDeltaY - this._smoothedDeltaY) * pointerSmoothStep;

    // Convert pointer frame-delta to velocity contribution
    if (Math.abs(this._smoothedDeltaX) > 0.01 || Math.abs(this._smoothedDeltaY) > 0.01) {
      desiredYawVel += -this._smoothedDeltaX * this.lookSensitivity / dt;
      desiredPitchVel += this._smoothedDeltaY * this.lookSensitivity / dt;
    }

    // ── Inertia layer: asymmetric tracking ─────────────────────────
    // High stiffness when input actively drives velocity (responsive)
    // Low stiffness when decelerating/releasing (momentum glide)
    //
    // "Coasting" = there's existing velocity but desired is significantly less
    // (e.g., finger lifted, joystick released, or input fading out)
    // Exception: actively pushing opposite direction → track responsively

    const oppositeYaw = Math.sign(desiredYawVel) !== 0 &&
                        Math.sign(desiredYawVel) !== Math.sign(this._yawVelocity);
    const coastingYaw = !oppositeYaw &&
                        Math.abs(this._yawVelocity) > 0.01 &&
                        Math.abs(desiredYawVel) < Math.abs(this._yawVelocity) * 0.8;

    const oppositePitch = Math.sign(desiredPitchVel) !== 0 &&
                          Math.sign(desiredPitchVel) !== Math.sign(this._pitchVelocity);
    const coastingPitch = !oppositePitch &&
                          Math.abs(this._pitchVelocity) > 0.01 &&
                          Math.abs(desiredPitchVel) < Math.abs(this._pitchVelocity) * 0.8;

    const yawStiff = coastingYaw ? this.coastStiffness : this.trackingStiffness;
    const pitchStiff = coastingPitch ? this.coastStiffness : this.trackingStiffness;

    const yawStep = 1 - Math.exp(-yawStiff * dt);
    const pitchStep = 1 - Math.exp(-pitchStiff * dt);

    this._yawVelocity += (desiredYawVel - this._yawVelocity) * yawStep;
    this._pitchVelocity += (desiredPitchVel - this._pitchVelocity) * pitchStep;

    // ── Velocity limits ────────────────────────────────────────────
    this._yawVelocity = clamp(this._yawVelocity, -this.maxYawVelocity, this.maxYawVelocity);
    this._pitchVelocity = clamp(this._pitchVelocity, -this.maxPitchVelocity, this.maxPitchVelocity);

    // Kill tiny velocities to prevent endless micro-drift
    if (Math.abs(this._yawVelocity) < 0.005) this._yawVelocity = 0;
    if (Math.abs(this._pitchVelocity) < 0.005) this._pitchVelocity = 0;

    // ── Apply velocity to angles ───────────────────────────────────
    this._yaw += this._yawVelocity * dt;
    this._pitch += this._pitchVelocity * dt;

    // ── Pitch boundaries ───────────────────────────────────────────
    this._pitch = clamp(this._pitch, this.minPitch, this.maxPitch);
    // Kill velocity at hard stops (prevents energy buildup against limits)
    if (this._pitch >= this.maxPitch && this._pitchVelocity > 0) this._pitchVelocity = 0;
    if (this._pitch <= this.minPitch && this._pitchVelocity < 0) this._pitchVelocity = 0;

    // ── Yaw normalization ──────────────────────────────────────────
    this._yaw = normalizeAngle(this._yaw);

    // ── Banking from yaw velocity ──────────────────────────────────
    // _yawVelocity is now the true angular velocity from the inertia system
    const targetBank = clamp(
      -this._yawVelocity * this.bankInfluence,
      -this.maxBank,
      this.maxBank
    );
    const bankSmoothStep = 1 - Math.exp(-this.bankSmoothing * dt);
    this._smoothedBank += (targetBank - this._smoothedBank) * bankSmoothStep;
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
