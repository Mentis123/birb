// Relaxed, chill gliding feel
export const MOVEMENT_ACCELERATION = 2.8;
export const LINEAR_DRAG = 1.2;
export const SPRINT_MULTIPLIER = 1.4;
// Upper bound on how far the bird can bank for readability and comfort.
export const MAX_BANK_ANGLE = (70 * Math.PI) / 180;
// Maximum visual pitch tilt when climbing/diving (nose up/down effect)
export const MAX_VISUAL_PITCH_ANGLE = (25 * Math.PI) / 180;
// How quickly the visual pitch responds to vertical velocity
export const VISUAL_PITCH_RESPONSE = 5;
// How quickly a banked input should translate into a gentle yaw turn.
export const BANK_TURN_RATE = Math.PI * 0.45;
// How quickly the controller adapts its roll orientation when reversing direction.
export const BANK_ORIENTATION_DAMPING = 2.5;
// Maximum amount the bird pitches up or down when steering with the stick.
export const MAX_PITCH_ANGLE = (45 * Math.PI) / 180;
// How quickly the bird eases toward target pitch and bank angles.
export const TILT_DAMPING = 14;
// Minimum desired forward speed so the bird always keeps gliding.
export const CRUISE_FORWARD_SPEED = 2.1;
export const LOOK_SENSITIVITY = 0.002;
export const AMBIENT_BOB_AMPLITUDE = 0.06;
export const AMBIENT_BOB_SPEED = 0.8;
export const AMBIENT_ROLL_AMPLITUDE = 0.025;
export const AMBIENT_ROLL_SPEED = 0.6;
export const AMBIENT_YAW_AMPLITUDE = 0.015;
export const AMBIENT_YAW_SPEED = 0.5;

export const INPUT_SMOOTHING = 8;
export const STRAFE_DAMPING = 0.5;
export const IDLE_LINEAR_DRAG = 2.5;
export const LIFT_ACCELERATION_MULTIPLIER = 1.8;
export const THROTTLE_POWER_MULTIPLIER = 2;
export const SPHERICAL_ALTITUDE_STIFFNESS = 12;
export const SPHERICAL_ALTITUDE_DAMPING = 7;
export const SPHERICAL_ALTITUDE_RATE = 6;
// Maximum vertical speed to prevent runaway climbing/diving
export const MAX_VERTICAL_SPEED = 4.0;
// Rotation rates for pitch and yaw (radians per second at full stick deflection)
export const PITCH_RATE = Math.PI * 0.5;
export const YAW_RATE = Math.PI * 0.6;
// How quickly the visual bank angle responds to yaw input
export const BANK_RESPONSE = 6;

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
    this._localUp = new Vector3(0, 1, 0);
    this._acceleration = new Vector3();
    this._bankQuaternion = new Quaternion();
    this._yawQuaternion = new Quaternion();
    this._pitchQuaternion = new Quaternion();
    this._ambientPosition = new Vector3();
    this._ambientQuaternion = new Quaternion();
    this._ambientEuler = new Euler(0, 0, 0, "YXZ");
    this._bankOrientation = 1;

    // Spherical world support: when set, "up" is computed radially from this center
    this._sphereCenter = null;
    this._targetRadius = null;

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    this.throttle = options.throttle ?? 1;
    this.sprintMultiplier = options.sprintMultiplier ?? SPRINT_MULTIPLIER;
    this.isSprinting = false;
    // When false (default), pushing up/forward pitches the nose UP (push forward to fly up)
    // When true, controls are airplane-style: push forward to dive, pull back to climb
    this.invertPitch = options.invertPitch ?? false;

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
    this.pitch = 0;
    this.visualPitch = 0;
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

  setInvertPitch(invert) {
    this.invertPitch = Boolean(invert);
  }

  setSphereCenter(center) {
    if (center === null || center === undefined) {
      this._sphereCenter = null;
      this._targetRadius = null;
    } else if (center && typeof center.clone === 'function') {
      this._sphereCenter = center.clone();
      this._targetRadius = this.position.clone().sub(this._sphereCenter).length();
    }
  }

  // Compute the local "up" direction based on current position
  // For spherical worlds: radial from sphere center
  // For flat worlds: world Y axis
  _computeLocalUp() {
    if (this._sphereCenter) {
      this._localUp.copy(this.position).sub(this._sphereCenter);
      if (this._localUp.lengthSq() < 1e-6) {
        this._localUp.set(0, 1, 0);
      } else {
        this._localUp.normalize();
      }
    } else {
      this._localUp.set(0, 1, 0);
    }
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

    // Use local up (radial for spherical world, world Y for flat)
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

    // Use local up (radial for spherical world, world Y for flat)
    const up = this._computeLocalUp();

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

    // --- ROTATION-BASED FLIGHT CONTROLS ---
    // Pitch control: by default (unchecked), pushing forward/up tilts the nose up (non-inverted)
    // When invertPitch is true (checked), controls become airplane-style: push forward to dive
    // Joystick UP produces negative forward input, so non-inverted uses the negative to pitch up
    const pitchInput = this.invertPitch ? smoothed.forward : -smoothed.forward;
    const pitchDelta = pitchInput * PITCH_RATE * deltaTime;

    // Yaw: joystick RIGHT (positive roll/strafe) → nose RIGHT (negative rotation on local up axis)
    const yawInput = smoothed.roll;
    const yawDelta = -yawInput * YAW_RATE * deltaTime;

    // Apply yaw rotation around LOCAL up axis (radial for spherical world)
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

    // Get the forward direction AFTER rotation is applied
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

    // --- ROTATION-BASED MOVEMENT ---
    // Re-express velocity in the bird's local frame so heading changes steer motion.
    // This prevents a rotated bird from continuing to travel along a stale world-axis vector.
    const forwardSpeed = this.velocity.dot(forward);
    const verticalSpeed = this.velocity.dot(up);
    this.velocity
      .copy(forward)
      .multiplyScalar(forwardSpeed)
      .addScaledVector(up, verticalSpeed);

    // The bird always moves in its forward direction based on current rotation
    // Cruise speed maintains constant forward velocity
    const cruiseTargetSpeed = CRUISE_FORWARD_SPEED * effectiveThrottle;
    const alignedForwardSpeed = this.velocity.dot(forward);

    // Always apply gentle forward glide to maintain cruise speed
    if (cruiseTargetSpeed > 0) {
      const cruiseAcceleration = (cruiseTargetSpeed - alignedForwardSpeed) * MOVEMENT_ACCELERATION * 0.5;
      this.velocity.addScaledVector(forward, cruiseAcceleration * deltaTime);
    }

    // Apply lift input for direct vertical control (can still ascend/descend beyond pitch)
    if (Math.abs(smoothed.lift) > 1e-3) {
      const liftAcceleration = smoothed.lift * MOVEMENT_ACCELERATION * LIFT_ACCELERATION_MULTIPLIER;
      this.velocity.addScaledVector(up, liftAcceleration * deltaTime);
    }

    // Apply drag
    const dragMultiplier = Math.exp(-LINEAR_DRAG * deltaTime);
    this.velocity.multiplyScalar(dragMultiplier);

    // Align velocity direction with facing direction while preserving speed
    // This ensures the bird moves where it's pointing, not sliding or drifting
    // IMPORTANT: Only align the HORIZONTAL component - don't convert horizontal speed to vertical!
    // This prevents runaway climbing when the bird pitches up.

    // Extract vertical component (along local up) - this is preserved separately
    const currentVerticalSpeed = this.velocity.dot(up);

    // Get horizontal velocity by removing vertical component
    const horizontalVelocity = this._acceleration.copy(this.velocity).addScaledVector(up, -currentVerticalSpeed);
    const horizontalSpeed = horizontalVelocity.length();

    if (horizontalSpeed > 0.1) {
      // Get the horizontal component of forward direction
      const forwardHorizontal = this._right.copy(forward).addScaledVector(up, -forward.dot(up));
      const forwardHorizontalLength = forwardHorizontal.length();

      if (forwardHorizontalLength > 0.01) {
        forwardHorizontal.divideScalar(forwardHorizontalLength);

        // Align horizontal velocity toward horizontal forward
        const alignmentRate = 8;
        const alignmentStrength = 1 - Math.exp(-alignmentRate * deltaTime);

        // Target horizontal velocity preserves horizontal speed
        const targetHorizontal = forwardHorizontal.multiplyScalar(horizontalSpeed);
        horizontalVelocity.lerp(targetHorizontal, alignmentStrength);
      }
    }

    // Cap vertical speed to prevent runaway climbing/diving
    const cappedVerticalSpeed = Math.max(-MAX_VERTICAL_SPEED, Math.min(MAX_VERTICAL_SPEED, currentVerticalSpeed));

    // Recombine: horizontal velocity + capped vertical velocity
    this.velocity.copy(horizontalVelocity).addScaledVector(up, cappedVerticalSpeed);

    // Also correct any remaining sideways drift
    // Recalculate right axis since we reused _right for temp calculations above
    const rightAxis = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    const sidewaysSpeed = this.velocity.dot(rightAxis);
    if (Math.abs(sidewaysSpeed) > 1e-3) {
      const correctionRate = MOVEMENT_ACCELERATION * 1.5;
      const maxCorrection = correctionRate * deltaTime;
      const correction = Math.sign(sidewaysSpeed) * Math.min(Math.abs(sidewaysSpeed), maxCorrection);
      this.velocity.addScaledVector(rightAxis, -correction);
    }

    // Update position based on velocity
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
    // Use velocity component along local up direction (radial for spherical worlds)
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

    // --- SPHERICAL ALTITUDE STABILIZATION ---
    if (this._sphereCenter) {
      const radialVector = this._acceleration.copy(this.position).sub(this._sphereCenter);
      const radius = radialVector.length();

      // Establish a target radius so the bird hugs the world instead of drifting into space
      if (!Number.isFinite(this._targetRadius)) {
        this._targetRadius = radius > 0 ? radius : 0;
      }

      if (radius > 1e-6) {
        radialVector.multiplyScalar(1 / radius);

        // Allow the lift input to intentionally change cruising altitude around the sphere
        if (Math.abs(smoothed.lift) > 1e-3) {
          this._targetRadius += smoothed.lift * SPHERICAL_ALTITUDE_RATE * deltaTime;
          this._targetRadius = Math.max(1, this._targetRadius);
        }

        // Damped spring to pull the bird back toward the target altitude and cancel radial drift
        const altitudeError = radius - this._targetRadius;
        const radialSpeed = this.velocity.dot(radialVector);
        const altitudeAcceleration =
          -altitudeError * SPHERICAL_ALTITUDE_STIFFNESS - radialSpeed * SPHERICAL_ALTITUDE_DAMPING;
        this.velocity.addScaledVector(radialVector, altitudeAcceleration * deltaTime);

        // Nudge position toward the target radius to eliminate slow creep
        const positionCorrection = -altitudeError *
          Math.min(1, SPHERICAL_ALTITUDE_STIFFNESS * deltaTime * 0.25);
        this.position.addScaledVector(radialVector, positionCorrection);
      }
    }

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
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
    this.bank = 0;
    this.pitch = 0;
    this.visualPitch = 0;
    this._bankOrientation = forward.z >= 0 ? 1 : -1;
    this.elapsed = 0;
    Object.assign(this.input, createAxisRecord());
    Object.assign(this._smoothedInput, createAxisRecord());
    this.setThrustInput({ forward: 0, strafe: 0, lift: 0, roll: 0 });
    this.setSprintActive(false);
    if (this._sphereCenter) {
      this._targetRadius = this.position.clone().sub(this._sphereCenter).length();
    } else {
      this._targetRadius = null;
    }
  }
}
