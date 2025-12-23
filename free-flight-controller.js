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

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    this.throttle = options.throttle ?? 1;
    this.sprintMultiplier = options.sprintMultiplier ?? 1.4;
    this.isSprinting = false;
    // When false (default), pushing up/forward pitches the nose UP (push forward to fly up)
    // When true, controls are airplane-style: push forward to dive, pull back to climb
    this.invertPitch = options.invertPitch ?? false;

    this.input = createAxisRecord();
    // Accumulated look deltas (from mouse/touch) - applied once per frame
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    this.bank = 0;
    this.pitch = 0;
    this.visualPitch = 0;
    this.forwardSpeed = BASE_FORWARD_SPEED;
    this.verticalVelocity = 0;
    this.elapsed = 0;

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

  setSprintActive(isActive) {
    this.isSprinting = Boolean(isActive);
  }

  setInvertPitch(invert) {
    this.invertPitch = Boolean(invert);
  }

  setSphereCenter(center) {
    if (center === null || center === undefined) {
      this._sphereCenter = null;
      return;
    }
    if (typeof center.clone === 'function') {
      this._sphereCenter = center.clone();
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

    this.elapsed += deltaTime;
    const effectiveThrottle = this.getEffectiveThrottle();

    // Use local up (world Y for flat, radial for spherical)
    const up = this._computeLocalUp();

    // On spherical worlds, re-align quaternion when local up changes.
    // This keeps the forward direction tangent to the sphere surface as the bird moves.
    if (this._sphereCenter) {
      const upDot = this._previousUp.dot(up);
      // Only re-align if the up direction has changed significantly
      if (upDot < 0.99999) {
        // Compute rotation from previous up to current up
        this._alignQuaternion.setFromUnitVectors(this._previousUp, up);
        // Apply this rotation to quaternion to maintain relative heading
        this.quaternion.premultiply(this._alignQuaternion).normalize();
      }
      this._previousUp.copy(up);
    }

    // --- COMBINED ROTATION FROM ALL SOURCES ---
    // Combine input.yaw with pending look delta (from mouse/touch)
    const pitchInput = this.invertPitch ? this.input.pitch : -this.input.pitch;

    // Total yaw = input-based yaw + accumulated look delta
    const totalYawDelta = (-this.input.yaw * YAW_RATE * deltaTime) + this._pendingYaw;
    const totalPitchDelta = (pitchInput * PITCH_RATE * deltaTime) + this._pendingPitch;

    // Clear pending deltas after consuming
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    // Apply yaw rotation around LOCAL up axis
    if (totalYawDelta !== 0) {
      this._yawQuaternion.setFromAxisAngle(up, totalYawDelta);
      this.quaternion.premultiply(this._yawQuaternion);
    }

    // Apply pitch rotation around the LOCAL horizontal right axis
    if (totalPitchDelta !== 0) {
      // Get current forward direction
      const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion);
      // Project forward onto local horizontal plane (perpendicular to local up)
      const upComponent = forward.dot(up);
      const horizontalForward = this._up.copy(forward).addScaledVector(up, -upComponent);
      const horizontalLength = horizontalForward.length();

      if (horizontalLength > 0.001) {
        horizontalForward.divideScalar(horizontalLength);
        // Right axis: horizontalForward × up gives proper right-hand side
        const right = this._right.crossVectors(horizontalForward, up).normalize();
        this._pitchQuaternion.setFromAxisAngle(right, totalPitchDelta);
        this.quaternion.premultiply(this._pitchQuaternion);
      }
    }

    this.quaternion.normalize();

    // --- CALCULATE VELOCITY FROM FACING DIRECTION ---
    // This is the key fix: velocity directly follows quaternion (like SimpleFlightController)
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion);

    // For spherical worlds, ensure forward is tangent to the sphere (perpendicular to up)
    if (this._sphereCenter) {
      const upComponent = forward.dot(up);
      forward.addScaledVector(up, -upComponent);
      if (forward.lengthSq() > 1e-9) {
        forward.normalize();
      } else {
        forward.set(0, 0, -1).applyQuaternion(this.quaternion);
      }
    }

    // --- STREAMLINED KINEMATICS ---
    const targetSpeed = Math.min(
      MAX_FORWARD_SPEED,
      BASE_FORWARD_SPEED * effectiveThrottle,
    );

    if (this.forwardSpeed < targetSpeed) {
      this.forwardSpeed = Math.min(targetSpeed, this.forwardSpeed + SPEED_RAMP * deltaTime);
    } else if (this.forwardSpeed > targetSpeed) {
      this.forwardSpeed = Math.max(targetSpeed, this.forwardSpeed - SPEED_RAMP * deltaTime * 0.6);
    }

    this.verticalVelocity += pitchInput * LIFT_ACCELERATION * deltaTime;
    this.verticalVelocity = clamp(this.verticalVelocity, -MAX_VERTICAL_SPEED, MAX_VERTICAL_SPEED, this.verticalVelocity);

    // Set velocity directly from facing direction (the key fix!)
    this.velocity.copy(forward).multiplyScalar(this.forwardSpeed);
    this.velocity.addScaledVector(up, this.verticalVelocity);

    this.position.addScaledVector(this.velocity, deltaTime);

    // --- VISUAL OUTPUT (banking, visual pitch) ---
    // Copy base quaternion for visual, then apply banking
    this._visualQuaternion.copy(this.quaternion);

    // Bank into turns based on input (not rotation delta, for smoother visuals)
    const yawInput = this.input.yaw;
    const targetBank = clamp(yawInput * MAX_BANK_ANGLE, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Smooth interpolation (lerp) for banking
    const bankStep = 1 - Math.exp(-BANK_RESPONSE * deltaTime);
    this.bank += (targetBank - this.bank) * bankStep;
    this.bank = clamp(this.bank, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Apply visual bank rotation around the forward axis
    const bankAxis = this._forward.set(0, 0, -1).applyQuaternion(this._visualQuaternion).normalize();
    this._bankQuaternion.setFromAxisAngle(bankAxis, this.bank);
    this._visualQuaternion.multiply(this._bankQuaternion);

    // --- PROCEDURAL VISUAL PITCH ---
    const visualVerticalSpeed = this.velocity.dot(up);
    const currentSpeed = this.velocity.length();
    const verticalRatio = currentSpeed > 0.1 ? visualVerticalSpeed / currentSpeed : 0;
    const targetVisualPitch = clamp(-verticalRatio * MAX_VISUAL_PITCH_ANGLE, -MAX_VISUAL_PITCH_ANGLE, MAX_VISUAL_PITCH_ANGLE, this.visualPitch);

    const pitchStep = 1 - Math.exp(-VISUAL_PITCH_RESPONSE * deltaTime);
    this.visualPitch += (targetVisualPitch - this.visualPitch) * pitchStep;
    this.visualPitch = clamp(this.visualPitch, -MAX_VISUAL_PITCH_ANGLE, MAX_VISUAL_PITCH_ANGLE, this.visualPitch);

    const visualPitchAxis = this._right.set(1, 0, 0).applyQuaternion(this._visualQuaternion).normalize();
    this._pitchQuaternion.setFromAxisAngle(visualPitchAxis, this.visualPitch);
    this._visualQuaternion.multiply(this._pitchQuaternion);

    this.pitch = 0;

    return {
      position: this.position,
      quaternion: this._visualQuaternion,
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
    this._visualQuaternion.copy(this._initialQuaternion);
    this.bank = 0;
    this.pitch = 0;
    this.visualPitch = 0;
    this.forwardSpeed = BASE_FORWARD_SPEED;
    this.verticalVelocity = 0;
    this.elapsed = 0;
    this._pendingYaw = 0;
    this._pendingPitch = 0;
    Object.assign(this.input, createAxisRecord());
    this.setInputs({ yaw: 0, pitch: 0 });
    this.setSprintActive(false);
    // Reset previous up to match initial position's local up
    this._computeLocalUp();
    this._previousUp.copy(this._localUp);
  }
}
