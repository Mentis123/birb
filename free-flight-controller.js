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
    this.quaternion = new Quaternion();
    this.lookQuaternion = new Quaternion();

    this._forward = new Vector3(0, 0, -1);
    this._right = new Vector3(1, 0, 0);
    this._up = new Vector3(0, 1, 0);
    this._localUp = new Vector3(0, 1, 0);
    this._acceleration = new Vector3();
    this._velocityForward = new Vector3(0, 0, -1); // Dedicated vector for velocity direction
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

  addLookDelta(deltaX, deltaY) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }

    const yawAngle = -deltaX * this.lookSensitivity;
    const pitchAngle = deltaY * this.lookSensitivity;

    // Use local up (world Y for flat)
    const up = this._computeLocalUp();

    if (yawAngle !== 0) {
      this._yawQuaternion.setFromAxisAngle(up, yawAngle);
      this.lookQuaternion.premultiply(this._yawQuaternion);
    }

    if (pitchAngle !== 0) {
      // Project forward onto the local horizontal plane (perpendicular to local up)
      const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
      // Remove the component along the local up to get horizontal forward
      const upComponent = forward.dot(up);
      const horizontalForward = this._acceleration.copy(forward).addScaledVector(up, -upComponent);
      const horizontalLength = horizontalForward.length();

      // Only apply if we have a valid horizontal direction (not looking straight up/down)
      if (horizontalLength > 0.001) {
        horizontalForward.divideScalar(horizontalLength);
        // horizontalForward × up gives proper right-hand side
        const right = this._right.crossVectors(horizontalForward, up).normalize();
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

    // Use local up (world Y axis)
    const up = this._computeLocalUp();

    // On spherical worlds, re-align lookQuaternion when local up changes.
    // This keeps the forward direction tangent to the sphere surface as the bird moves.
    if (this._sphereCenter) {
      const upDot = this._previousUp.dot(up);
      // Only re-align if the up direction has changed significantly
      if (upDot < 0.99999) {
        // Compute rotation from previous up to current up
        this._alignQuaternion.setFromUnitVectors(this._previousUp, up);
        // Apply this rotation to lookQuaternion to maintain relative heading
        this.lookQuaternion.premultiply(this._alignQuaternion).normalize();
      }
      this._previousUp.copy(up);
    }

    // --- ROTATION-BASED FLIGHT CONTROLS ---
    // Pitch control: by default (unchecked), pushing forward/up tilts the nose up (non-inverted)
    // When invertPitch is true (checked), controls become airplane-style: push forward to dive
    // Joystick UP produces negative pitch input, so non-inverted uses the negative to pitch up
    const pitchInput = this.invertPitch ? this.input.pitch : -this.input.pitch;
    const pitchDelta = pitchInput * PITCH_RATE * deltaTime;

    // Yaw: joystick X drives yaw for responsive turns
    const yawInput = this.input.yaw;
    const yawDelta = -yawInput * YAW_RATE * deltaTime;

    // Apply yaw rotation around LOCAL up axis
    if (yawDelta !== 0) {
      this._yawQuaternion.setFromAxisAngle(up, yawDelta);
      this.lookQuaternion.premultiply(this._yawQuaternion).normalize();
    }

    // Apply pitch rotation around the LOCAL horizontal right axis
    // This ensures up/down stays aligned with the local vertical
    if (pitchDelta !== 0) {
      // Get current forward direction
      const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
      // Project forward onto local horizontal plane (perpendicular to local up)
      const upComponent = forward.dot(up);
      const horizontalForward = this._acceleration.copy(forward).addScaledVector(up, -upComponent);
      const horizontalLength = horizontalForward.length();

      if (horizontalLength > 0.001) {
        horizontalForward.divideScalar(horizontalLength);
        // Right axis: horizontalForward × up gives proper right-hand side
        const right = this._right.crossVectors(horizontalForward, up).normalize();
        this._pitchQuaternion.setFromAxisAngle(right, pitchDelta);
        this.lookQuaternion.premultiply(this._pitchQuaternion).normalize();
      }
    }

    // Start with the look quaternion as the base orientation
    this.quaternion.copy(this.lookQuaternion);

    // Calculate the velocity forward direction using a DEDICATED vector
    // This prevents any accidental modification from other calculations
    const velocityForward = this._velocityForward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);

    // For spherical worlds, ensure forward is tangent to the sphere (perpendicular to up)
    // This prevents any drift in the vertical component of the forward direction
    if (this._sphereCenter) {
      const upComponent = velocityForward.dot(up);
      velocityForward.addScaledVector(up, -upComponent);
    }
    velocityForward.normalize();

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

    // Compute the target velocity based on facing direction
    const targetVelocity = this._acceleration
      .copy(velocityForward)
      .multiplyScalar(this.forwardSpeed)
      .addScaledVector(up, this.verticalVelocity);

    // Directly set velocity to match facing direction - bird always moves where it's pointing
    // This ensures immediate response to heading changes with no lag or drift
    this.velocity.copy(targetVelocity);

    this.position.addScaledVector(this.velocity, deltaTime);

    // --- PROCEDURAL BANKING (ROLL) ---
    // Bank into turns: pushing right → bank right (right wing down, left wing up)
    // In THREE.js, rotating around forward axis (-Z): positive angle = right side goes down
    // So positive yawInput (turning right) needs positive bank for right wing down
    const targetBank = clamp(yawInput * MAX_BANK_ANGLE, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Smooth interpolation (lerp) for banking
    const bankStep = 1 - Math.exp(-BANK_RESPONSE * deltaTime);
    this.bank += (targetBank - this.bank) * bankStep;
    this.bank = clamp(this.bank, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Apply visual bank rotation around the forward axis
    const bankAxis = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    this._bankQuaternion.setFromAxisAngle(bankAxis, this.bank);
    this.quaternion.multiply(this._bankQuaternion);

    // --- PROCEDURAL VISUAL PITCH ---
    // Tilt nose up when climbing, nose down when diving based on vertical velocity
    // Use velocity component along local up direction
    const visualVerticalSpeed = this.velocity.dot(up);
    const currentSpeed = this.velocity.length();
    // Normalize vertical velocity relative to total speed for proportional tilt
    const verticalRatio = currentSpeed > 0.1 ? visualVerticalSpeed / currentSpeed : 0;
    // Target pitch: positive vertical ratio (climbing) → nose up (negative pitch in local space)
    const targetVisualPitch = clamp(-verticalRatio * MAX_VISUAL_PITCH_ANGLE, -MAX_VISUAL_PITCH_ANGLE, MAX_VISUAL_PITCH_ANGLE, this.visualPitch);

    // Smooth interpolation for visual pitch
    const pitchStep = 1 - Math.exp(-VISUAL_PITCH_RESPONSE * deltaTime);
    this.visualPitch += (targetVisualPitch - this.visualPitch) * pitchStep;
    this.visualPitch = clamp(this.visualPitch, -MAX_VISUAL_PITCH_ANGLE, MAX_VISUAL_PITCH_ANGLE, this.visualPitch);

    // Apply visual pitch rotation around the local right axis
    const visualPitchAxis = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    this._pitchQuaternion.setFromAxisAngle(visualPitchAxis, this.visualPitch);
    this.quaternion.multiply(this._pitchQuaternion);

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
    this.bank = 0;
    this.pitch = 0;
    this.visualPitch = 0;
    this.forwardSpeed = BASE_FORWARD_SPEED;
    this.verticalVelocity = 0;
    this.elapsed = 0;
    Object.assign(this.input, createAxisRecord());
    this.setInputs({ yaw: 0, pitch: 0 });
    this.setSprintActive(false);
    // Reset previous up to match initial position's local up
    this._computeLocalUp();
    this._previousUp.copy(this._localUp);
  }
}
