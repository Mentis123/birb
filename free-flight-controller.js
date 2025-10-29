// ============================================================================
// SIMPLIFIED FLIGHT PHYSICS - Clean, intuitive bird flight
// ============================================================================

// Basic physics constants
export const GRAVITY = 5.0; // Gentle downward pull
export const MAX_SPEED = 20.0; // Maximum flight speed
export const CRUISE_SPEED = 8.0; // Comfortable flying speed

// Direct control - simple and responsive
export const PITCH_SPEED = 0.8; // How fast pitch changes (radians/sec)
export const MAX_PITCH_UP = (30 * Math.PI) / 180; // Max climb angle (30°)
export const MAX_PITCH_DOWN = (40 * Math.PI) / 180; // Max dive angle (40°)
export const AUTO_LEVEL_STRENGTH = 2.0; // Returns to level when no input

// Movement forces
export const FORWARD_THRUST = 3.0; // Base forward acceleration (reduced to 25% for better control)
export const FLAP_BOOST = 6.0; // Extra thrust when flapping (sprint)
export const AIR_RESISTANCE = 0.3; // Air drag coefficient
export const LIFT_STRENGTH = 6.0; // Upward force when moving forward (increased to overcome gravity)

// Turning
export const TURN_SPEED = Math.PI * 0.5; // Yaw rotation speed
export const BANK_SPEED = 3.0; // How fast we bank into turns (smooth, stable banking)
export const MAX_BANK_ANGLE = (25 * Math.PI) / 180; // Max roll angle (25° for stable turns)

// Input smoothing
export const INPUT_SMOOTHING = 12; // Input smoothing factor
export const LOOK_SENSITIVITY = 0.0025;

// Ambient motion - subtle life when idle
export const AMBIENT_BOB_AMPLITUDE = 0.16;
export const AMBIENT_BOB_SPEED = 1.15;
export const AMBIENT_ROLL_AMPLITUDE = 0.08;
export const AMBIENT_ROLL_SPEED = 0.9;
export const AMBIENT_YAW_AMPLITUDE = 0.05;
export const AMBIENT_YAW_SPEED = 0.7;

// Legacy - kept for walk mode
export const IDLE_LINEAR_DRAG = 4.2;

export const WALK_MAX_SPEED = 4.2;
export const WALK_ACCELERATION = 14;
export const WALK_LINEAR_DRAG = 6.5;
export const WALK_SPRINT_MULTIPLIER = 1.6;
export const WALK_GRAVITY = 22;
export const WALK_JUMP_SPEED = 6.4;
export const WALK_GROUND_HEIGHT = 0.2;

const clamp = (value, min, max, fallback) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const createAxisRecord = () => ({ forward: 0, strafe: 0, lift: 0, roll: 0 });

const MOVEMENT_MODES = Object.freeze({
  FLYING: "flying",
  GROUNDED: "grounded",
});

const MOVEMENT_MODE_VALUES = new Set(Object.values(MOVEMENT_MODES));

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
    this._acceleration = new Vector3();
    this._bankQuaternion = new Quaternion();
    this._yawQuaternion = new Quaternion();
    this._pitchQuaternion = new Quaternion();
    this._ambientPosition = new Vector3();
    this._ambientQuaternion = new Quaternion();
    this._ambientEuler = new Euler(0, 0, 0, "YXZ");
    this._walkEuler = new Euler(0, 0, 0, "YXZ");
    this._walkForward = new Vector3();
    this._walkRight = new Vector3();

    // New aerodynamic physics state
    this._pitch = 0; // Current pitch angle (radians, + = nose up, - = nose down)
    this._pitchVelocity = 0; // Rate of pitch change
    this._liftForce = new Vector3();
    this._dragForce = new Vector3();
    this._gravityForce = new Vector3();
    this._thrustForce = new Vector3();

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    this.throttle = options.throttle ?? 1;
    this.turnSpeed = options.turnSpeed ?? TURN_SPEED;
    this.maxBankAngle = options.maxBankAngle ?? MAX_BANK_ANGLE;
    this.isSprinting = false;

    const providedSmoothing = options.inputSmoothing;
    this.inputSmoothing = Number.isFinite(providedSmoothing)
      ? Math.max(0, providedSmoothing)
      : INPUT_SMOOTHING;

    const providedIdleDrag = options.idleLinearDrag;
    this.idleLinearDrag = Number.isFinite(providedIdleDrag) && providedIdleDrag >= 0
      ? providedIdleDrag
      : IDLE_LINEAR_DRAG;

    this.walkAcceleration = options.walkAcceleration ?? WALK_ACCELERATION;
    this.walkLinearDrag = options.walkLinearDrag ?? WALK_LINEAR_DRAG;
    this.walkMaxSpeed = options.walkMaxSpeed ?? WALK_MAX_SPEED;
    this.walkSprintMultiplier = options.walkSprintMultiplier ?? WALK_SPRINT_MULTIPLIER;
    this.walkGravity = options.walkGravity ?? WALK_GRAVITY;
    this.walkJumpSpeed = options.walkJumpSpeed ?? WALK_JUMP_SPEED;
    this.walkGroundHeight = options.walkGroundHeight ?? WALK_GROUND_HEIGHT;

    this.input = createAxisRecord();
    this._smoothedInput = createAxisRecord();

    this.bank = 0;
    this._bankVelocity = 0;
    this.elapsed = 0;

    this._initialMovementMode = MOVEMENT_MODE_VALUES.has(options.movementMode)
      ? options.movementMode
      : MOVEMENT_MODES.GROUNDED;
    this._movementMode = this._initialMovementMode;
    this._walkState = {
      verticalVelocity: 0,
      isGrounded: false,
    };

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

  getEffectiveThrottle() {
    const baseThrottle = this.throttle;
    let multiplier = 1;
    if (this.isSprinting) {
      multiplier = this._movementMode === MOVEMENT_MODES.WALK ? this.walkSprintMultiplier : this.sprintMultiplier;
    }
    return baseThrottle * multiplier;
  }

  addLookDelta(deltaX, deltaY) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }

    const yawAngle = -deltaX * this.lookSensitivity;
    const pitchAngle = deltaY * this.lookSensitivity;

    if (yawAngle !== 0) {
      this._yawQuaternion.setFromAxisAngle(this._up, yawAngle);
      this.lookQuaternion.premultiply(this._yawQuaternion);
    }

    if (pitchAngle !== 0) {
      const right = this._right.set(1, 0, 0).applyQuaternion(this.lookQuaternion).normalize();
      this._pitchQuaternion.setFromAxisAngle(right, pitchAngle);
      this.lookQuaternion.multiply(this._pitchQuaternion);
    }

    this.lookQuaternion.normalize();
  }

  getSpeed() {
    return this.velocity.length();
  }

  getPitch() {
    return this._pitch;
  }

  getPitchDegrees() {
    return (this._pitch * 180) / Math.PI;
  }

  setMovementMode(mode) {
    const nextMode = MOVEMENT_MODE_VALUES.has(mode) ? mode : MOVEMENT_MODES.GROUNDED;
    if (this._movementMode === nextMode) {
      return this._movementMode;
    }
    this._movementMode = nextMode;
    if (nextMode === MOVEMENT_MODES.GROUNDED) {
      // Landing - transition to grounded state
      this.bank = 0;
      this._bankVelocity = 0;
      this._walkState.verticalVelocity = 0;
      this._walkState.isGrounded = true;
      this.velocity.y = 0;
      if (this.position.y < this.walkGroundHeight) {
        this.position.y = this.walkGroundHeight;
      }
    } else {
      // Taking off - transition to flight mode smoothly
      this._walkState.verticalVelocity = 0;
      this._walkState.isGrounded = false;

      // Start with good forward motion to generate lift immediately
      const currentSpeed = this.velocity.length();
      if (currentSpeed < CRUISE_SPEED * 0.6) {
        const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
        // Start at ~60% cruise speed to quickly build lift
        this.velocity.copy(forward).multiplyScalar(CRUISE_SPEED * 0.6);
        // Add a small upward boost to help with takeoff
        this.velocity.y = 1.5;
      }

      // Reset pitch to level for smooth transition
      this._pitch = 0;
      this._pitchVelocity = 0;
    }
    return this._movementMode;
  }

  getMovementMode() {
    return this._movementMode;
  }

  requestJump(strength = this.walkJumpSpeed) {
    if (this._movementMode !== MOVEMENT_MODES.GROUNDED) {
      return false;
    }
    if (!this._walkState.isGrounded) {
      return false;
    }
    const jumpStrength = Number.isFinite(strength) ? Math.max(0, strength) : this.walkJumpSpeed;
    this._walkState.verticalVelocity = jumpStrength;
    this.velocity.y = jumpStrength;
    this.position.y = Math.max(this.position.y, this.walkGroundHeight);
    this._walkState.isGrounded = false;
    return true;
  }

  requestTakeoff() {
    if (this._movementMode !== MOVEMENT_MODES.GROUNDED) {
      return false;
    }
    if (!this._walkState.isGrounded) {
      return false;
    }
    this.setMovementMode(MOVEMENT_MODES.FLYING);
    return true;
  }

  isGrounded() {
    return this._movementMode === MOVEMENT_MODES.GROUNDED || this._walkState.isGrounded;
  }

  update(deltaTime = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      deltaTime = 0;
    }

    this.elapsed += deltaTime;

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

    const up = this._up.set(0, 1, 0);

    if (this._movementMode === MOVEMENT_MODES.GROUNDED) {
      // Handle grounded mode separately (walk physics)
      if (deltaTime > 0) {
        const yawInput = clamp(smoothed.strafe, -1, 1, 0);
        const yawAngle = -yawInput * this.turnSpeed * deltaTime;
        if (Math.abs(yawAngle) > 1e-6) {
          this._yawQuaternion.setFromAxisAngle(up, yawAngle);
          this.lookQuaternion.premultiply(this._yawQuaternion);
        }
      }

      this.lookQuaternion.normalize();
      this.quaternion.copy(this.lookQuaternion);

      this._walkEuler.setFromQuaternion(this.quaternion);
      this._walkEuler.x = 0;
      this._walkEuler.z = 0;
      this.quaternion.setFromEuler(this._walkEuler);
      this.lookQuaternion.copy(this.quaternion);

      const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
      const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

      return this._updateWalk(deltaTime, smoothed, { forward, right, up });
    }

    // ========================================================================
    // SIMPLIFIED FLIGHT PHYSICS - Arcade-style, easy to control
    // ========================================================================

    if (deltaTime <= 0) {
      return {
        position: this.position,
        quaternion: this.quaternion,
      };
    }

    const forwardInput = clamp(smoothed.forward, -1, 1, 0);
    const strafeInput = clamp(smoothed.strafe, -1, 1, 0);

    // 1. PITCH CONTROL - Simple and direct
    // Forward input directly controls pitch angle
    const targetPitchVelocity = forwardInput * PITCH_SPEED;
    this._pitchVelocity = targetPitchVelocity;
    this._pitch += this._pitchVelocity * deltaTime;

    // Auto-level when no input
    if (Math.abs(forwardInput) < 0.1) {
      this._pitch -= this._pitch * AUTO_LEVEL_STRENGTH * deltaTime;
    }

    // Clamp pitch
    this._pitch = clamp(this._pitch, -MAX_PITCH_DOWN, MAX_PITCH_UP, this._pitch);

    // 2. YAW/TURNING - Strafe input turns the bird
    const yawAngle = -strafeInput * this.turnSpeed * deltaTime;
    if (Math.abs(yawAngle) > 1e-6) {
      this._yawQuaternion.setFromAxisAngle(up, yawAngle);
      this.lookQuaternion.premultiply(this._yawQuaternion);
    }
    this.lookQuaternion.normalize();

    // 3. BUILD ORIENTATION
    this.quaternion.copy(this.lookQuaternion);

    // Apply pitch
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this._pitchQuaternion.setFromAxisAngle(right, this._pitch);
    this.quaternion.multiply(this._pitchQuaternion);

    // Get forward direction
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();

    // 4. BANKING - Lean into turns
    const targetBank = -strafeInput * this.maxBankAngle;
    const bankDiff = targetBank - this.bank;
    this.bank += bankDiff * BANK_SPEED * deltaTime;

    // Auto-level bank when no strafe input (prevents wobble)
    if (Math.abs(strafeInput) < 0.05) {
      this.bank -= this.bank * BANK_SPEED * 0.5 * deltaTime;
    }

    this.bank = clamp(this.bank, -this.maxBankAngle, this.maxBankAngle, this.bank);

    // Apply bank
    this._bankQuaternion.setFromAxisAngle(forward, -this.bank);
    this.quaternion.multiply(this._bankQuaternion);

    // 5. SIMPLE PHYSICS - Arcade-style forces
    const speed = this.velocity.length();

    // Always accelerate forward in the direction we're facing
    let thrustAmount = FORWARD_THRUST * this.throttle;

    // Extra thrust when flapping (sprinting)
    if (this.isSprinting) {
      thrustAmount += FLAP_BOOST;
    }

    // Apply forward thrust
    this._thrustForce.copy(forward).multiplyScalar(thrustAmount);
    this._acceleration.copy(this._thrustForce);

    // Gravity pulls down
    this._acceleration.y -= GRAVITY;

    // Lift - upward force when moving forward
    // More lift when level or climbing, less when diving
    if (speed > 0.5) {
      const speedFactor = Math.min(speed / CRUISE_SPEED, 1.5);
      let liftAmount = LIFT_STRENGTH * speedFactor;

      // Pitch affects lift: climbing increases lift, diving reduces it
      if (this._pitch > 0) {
        // Climbing: boost lift
        const climbBoost = 1.0 + (this._pitch / MAX_PITCH_UP) * 0.5;
        liftAmount *= climbBoost;
      } else if (this._pitch < 0) {
        // Diving: reduce lift but keep minimum for control
        const divePenalty = Math.max(0.4, 1.0 + this._pitch / MAX_PITCH_DOWN);
        liftAmount *= divePenalty;
      }

      this._acceleration.y += liftAmount;
    }

    // Air resistance - simple drag
    const drag = speed * AIR_RESISTANCE;
    if (speed > 0.01) {
      this._dragForce.copy(this.velocity).normalize().multiplyScalar(-drag);
      this._acceleration.add(this._dragForce);
    }

    // 6. UPDATE VELOCITY
    this.velocity.addScaledVector(this._acceleration, deltaTime);

    // Speed limit
    const currentSpeed = this.velocity.length();
    if (currentSpeed > MAX_SPEED) {
      this.velocity.multiplyScalar(MAX_SPEED / currentSpeed);
    }

    // 7. UPDATE POSITION
    this.position.addScaledVector(this.velocity, deltaTime);

    // 8. GROUND COLLISION DETECTION
    // If bird hits the ground while flying, automatically land
    if (this.position.y <= this.walkGroundHeight) {
      this.position.y = this.walkGroundHeight;
      this.setMovementMode(MOVEMENT_MODES.GROUNDED);
      // Dampen horizontal velocity on landing
      this.velocity.multiplyScalar(0.3);
      this.velocity.y = 0;
    }

    return {
      position: this.position,
      quaternion: this.quaternion,
    };
  }

  _updateWalk(deltaTime, smoothed, basis = {}) {
    const { forward, right, up } = basis;
    const throttle = Math.min(Math.max(this.throttle, 0), 1);

    const horizontalForward = this._walkForward.copy(forward ?? this._forward.set(0, 0, -1));
    horizontalForward.y = 0;
    if (horizontalForward.lengthSq() < 1e-6) {
      horizontalForward.set(0, 0, -1);
    } else {
      horizontalForward.normalize();
    }

    const horizontalRight = this._walkRight.copy(right ?? this._right.set(1, 0, 0));
    horizontalRight.y = 0;
    if (horizontalRight.lengthSq() < 1e-6) {
      horizontalRight.crossVectors(up ?? this._up.set(0, 1, 0), horizontalForward).normalize();
    } else {
      horizontalRight.normalize();
    }

    const acceleration = this._acceleration.set(0, 0, 0);
    if (throttle > 0) {
      acceleration
        .addScaledVector(horizontalForward, smoothed.forward)
        .addScaledVector(horizontalRight, smoothed.strafe);

      if (acceleration.lengthSq() > 1) {
        acceleration.normalize();
      }

      acceleration.multiplyScalar(this.walkAcceleration * throttle);
      this.velocity.addScaledVector(acceleration, deltaTime);
    }

    const dragMultiplier = Math.exp(-this.walkLinearDrag * deltaTime);
    this.velocity.x *= dragMultiplier;
    this.velocity.z *= dragMultiplier;

    const sprintMultiplier = this.isSprinting ? this.walkSprintMultiplier : 1;
    const maxSpeed = this.walkMaxSpeed * Math.max(throttle, 0.01) * sprintMultiplier;
    if (maxSpeed > 0) {
      const horizontalSpeedSq = this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z;
      if (horizontalSpeedSq > maxSpeed * maxSpeed) {
        const scale = maxSpeed / Math.sqrt(horizontalSpeedSq);
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
    }

    this._walkState.verticalVelocity -= this.walkGravity * deltaTime;
    this.velocity.y = this._walkState.verticalVelocity;
    this.position.addScaledVector(this.velocity, deltaTime);

    if (this.position.y <= this.walkGroundHeight) {
      this.position.y = this.walkGroundHeight;
      this._walkState.verticalVelocity = 0;
      this.velocity.y = 0;
      this._walkState.isGrounded = true;
    } else {
      this._walkState.isGrounded = false;
    }

    this.bank = 0;
    this._bankVelocity = 0;

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
    this.lookQuaternion.copy(this._initialQuaternion);
    this.quaternion.copy(this._initialQuaternion);

    // Start with gentle velocity in flight mode
    if (this._initialMovementMode === MOVEMENT_MODES.FLYING) {
      const forward = this._forward.set(0, 0, -1).applyQuaternion(this._initialQuaternion);
      this.velocity.copy(forward).multiplyScalar(CRUISE_SPEED * 0.5); // Start slow
    } else {
      this.velocity.set(0, 0, 0);
    }

    this.bank = 0;
    this._bankVelocity = 0;
    this._pitch = 0;
    this._pitchVelocity = 0;
    this.elapsed = 0;
    this._movementMode = this._initialMovementMode;
    this._walkState.verticalVelocity = 0;
    this._walkState.isGrounded = this._initialMovementMode === MOVEMENT_MODES.GROUNDED;
    Object.assign(this.input, createAxisRecord());
    Object.assign(this._smoothedInput, createAxisRecord());
    this.setThrustInput({ forward: 0, strafe: 0, lift: 0, roll: 0 });
    this.setSprintActive(false);
  }
}
