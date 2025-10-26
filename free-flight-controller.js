// ============================================================================
// AERODYNAMIC FLIGHT PHYSICS - Redesigned for intuitive, fun mobile flying
// ============================================================================

// Core aerodynamics - these create the bird flight feel
export const GRAVITY = 6.0; // Constant downward acceleration (reduced for easier flying)
export const LIFT_COEFFICIENT = 7.5; // How much lift is generated from speed (balanced to prevent rocketing upward)
export const MIN_FLIGHT_SPEED = 1.5; // Minimum speed to generate meaningful lift (lowered)
export const OPTIMAL_GLIDE_SPEED = 6.5; // Sweet spot where lift ≈ gravity
export const MAX_SAFE_SPEED = 25.0; // Terminal velocity limit

// Drag system - tuned for graceful gliding
export const BASE_DRAG = 0.20; // Base air resistance (increased to provide more control)
export const SPEED_DRAG = 0.020; // Speed-dependent drag (slightly increased for stability)
export const FORM_DRAG = 0.22; // Drag from angle of attack (slightly reduced)

// Pitch control - how the bird aims up/down
export const PITCH_SPEED = 1.8; // Radians per second (how fast bird pitches)
export const MAX_PITCH_UP = (65 * Math.PI) / 180; // Maximum climb angle
export const MAX_PITCH_DOWN = (75 * Math.PI) / 180; // Maximum dive angle
export const PITCH_STABILITY = 0.8; // How much the bird wants to level out pitch

// Thrust system - for flapping/powered flight
export const FLAP_THRUST = 8.0; // Acceleration when flapping (sprint, reduced for gentler feel)
export const THRUST_EFFICIENCY_AT_SPEED = 0.6; // Thrust efficiency vs speed

// Banking and turning - smooth, realistic turns
export const BANK_FROM_TURN_INPUT = 0.85; // How much turn input causes banking
export const BANK_RESPONSIVENESS = 3.5; // How quickly wings bank
export const BANK_ROLL_SPEED = Math.PI * 1.2; // Maximum roll velocity
export const MAX_BANK_ANGLE = (55 * Math.PI) / 180; // Steeper banks for tighter turns
export const BANK_LEVEL_STIFFNESS = 3.0; // Return to level flight
export const TURN_SPEED = Math.PI * 0.95; // Base yaw rotation speed
export const BANKED_TURN_BONUS = 1.8; // Banking makes turns tighter

// Input and control feel
export const INPUT_SMOOTHING = 14; // Smoother input for mobile
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
  GLIDE: "glide",
  FLY: "fly",
  WALK: "walk",
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
    this.flapThrust = options.flapThrust ?? FLAP_THRUST;
    this.turnSpeed = options.turnSpeed ?? TURN_SPEED;
    const providedMaxBankAngle = options.maxBankAngle;
    this.maxBankAngle =
      Number.isFinite(providedMaxBankAngle) && providedMaxBankAngle > 0
        ? providedMaxBankAngle
        : MAX_BANK_ANGLE;
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
      : MOVEMENT_MODES.GLIDE;
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
    const nextMode = MOVEMENT_MODE_VALUES.has(mode) ? mode : MOVEMENT_MODES.GLIDE;
    if (this._movementMode === nextMode) {
      return this._movementMode;
    }
    this._movementMode = nextMode;
    if (nextMode === MOVEMENT_MODES.WALK) {
      this.bank = 0;
      this._bankVelocity = 0;
      this._walkState.verticalVelocity = 0;
      this._walkState.isGrounded = false;
      this.velocity.y = 0;
      if (this.position.y < this.walkGroundHeight) {
        this.position.y = this.walkGroundHeight;
      }
    } else {
      // Transitioning TO flight mode (glide/fly)
      this._walkState.verticalVelocity = 0;
      this._walkState.isGrounded = false;

      // Give the bird initial flight velocity to prevent falling
      // Use a gentle starting speed to avoid rapid vertical launch
      const currentSpeed = this.velocity.length();
      if (currentSpeed < MIN_FLIGHT_SPEED) {
        const initialSpeed = 1.6; // Very gentle speed for smooth transition
        const forward = this._forward.set(0, 0, -1).applyQuaternion(this.lookQuaternion);
        this.velocity.copy(forward).multiplyScalar(initialSpeed);
      }

      // Reset pitch to level flight for smoother transition
      this._pitch = 0;
      this._pitchVelocity = 0;
    }
    return this._movementMode;
  }

  getMovementMode() {
    return this._movementMode;
  }

  requestJump(strength = this.walkJumpSpeed) {
    if (this._movementMode !== MOVEMENT_MODES.WALK) {
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

  isGrounded() {
    if (this._movementMode !== MOVEMENT_MODES.WALK) {
      return false;
    }
    return this._walkState.isGrounded;
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

    if (this._movementMode === MOVEMENT_MODES.WALK) {
      // Handle walk mode separately
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
    // NEW AERODYNAMIC FLIGHT PHYSICS
    // ========================================================================

    if (deltaTime <= 0) {
      return {
        position: this.position,
        quaternion: this.quaternion,
      };
    }

    const forwardInput = clamp(smoothed.forward, -1, 1, 0);
    const strafeInput = clamp(smoothed.strafe, -1, 1, 0);

    // 1. PITCH CONTROL - Forward stick controls pitch (nose up/down)
    // Negative forward = pitch down (dive), Positive forward = pitch up (climb)
    const pitchInput = -forwardInput; // Invert so forward = nose down
    const targetPitchVelocity = pitchInput * PITCH_SPEED;

    // Smooth pitch response
    const pitchAccelStep = 1 - Math.exp(-8.0 * deltaTime);
    this._pitchVelocity += (targetPitchVelocity - this._pitchVelocity) * pitchAccelStep;

    // Apply pitch velocity
    this._pitch += this._pitchVelocity * deltaTime;

    // Gentle auto-level when no input (let pitch drift toward 0)
    if (Math.abs(pitchInput) < 0.05) {
      const levelingForce = -this._pitch * PITCH_STABILITY * deltaTime;
      this._pitch += levelingForce;
    }

    // Clamp pitch to safe limits
    this._pitch = clamp(this._pitch, -MAX_PITCH_DOWN, MAX_PITCH_UP, this._pitch);

    // 2. YAW AND BANK - Strafe input causes turning with automatic banking
    let turnInput = strafeInput;
    let effectiveTurnSpeed = this.turnSpeed;

    // Banking makes turns tighter
    const bankAmount = Math.abs(this.bank);
    if (bankAmount > 0.1) {
      const bankContribution = Math.sin(bankAmount);
      effectiveTurnSpeed *= (1 + bankContribution * (BANKED_TURN_BONUS - 1));
    }

    const yawAngle = -turnInput * effectiveTurnSpeed * deltaTime;
    if (Math.abs(yawAngle) > 1e-6) {
      this._yawQuaternion.setFromAxisAngle(up, yawAngle);
      this.lookQuaternion.premultiply(this._yawQuaternion);
    }

    this.lookQuaternion.normalize();

    // 3. BUILD ORIENTATION - Yaw, then Pitch, then Bank
    // Start with yaw
    this.quaternion.copy(this.lookQuaternion);

    // Apply pitch
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this._pitchQuaternion.setFromAxisAngle(right, this._pitch);
    this.quaternion.multiply(this._pitchQuaternion);

    // Get forward direction after pitch
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();

    // 4. BANKING - Automatically bank based on turn input
    const forwardZ = forward.z;
    let bankOrientation = 1;
    if (forwardZ > 1e-4) {
      bankOrientation = -1;
    } else if (forwardZ < -1e-4) {
      bankOrientation = 1;
    }

    const targetBankFromTurn = -strafeInput * bankOrientation * BANK_FROM_TURN_INPUT * this.maxBankAngle;
    const rollInput = smoothed.roll * bankOrientation;
    const targetBankFromRoll = rollInput * this.maxBankAngle;

    // Combine banking sources
    const targetBank = clamp(targetBankFromTurn + targetBankFromRoll, -this.maxBankAngle, this.maxBankAngle, 0);

    const bankStep = 1 - Math.exp(-BANK_RESPONSIVENESS * deltaTime);
    const targetBankVelocity = (targetBank - this.bank) * BANK_LEVEL_STIFFNESS;
    const clampedTargetVelocity = clamp(targetBankVelocity, -BANK_ROLL_SPEED, BANK_ROLL_SPEED, 0);

    this._bankVelocity += (clampedTargetVelocity - this._bankVelocity) * bankStep;
    this.bank += this._bankVelocity * deltaTime;
    this.bank = clamp(this.bank, -this.maxBankAngle, this.maxBankAngle, this.bank);

    // Apply bank rotation
    this._bankQuaternion.setFromAxisAngle(forward, -this.bank);
    this.quaternion.multiply(this._bankQuaternion);

    // 5. AERODYNAMIC FORCES
    const speed = this.velocity.length();
    const speedSq = speed * speed;

    // GRAVITY - always pulls down
    this._gravityForce.set(0, -GRAVITY, 0);

    // LIFT - generated by speed and angle of attack
    // More speed = more lift, but pitched up too much increases drag and reduces efficiency
    const liftEfficiency = Math.max(0, Math.cos(this._pitch)); // Best at level, worse when pitched
    const speedAboveMin = Math.max(0, speed - MIN_FLIGHT_SPEED);
    const liftMagnitude = LIFT_COEFFICIENT * speedAboveMin * liftEfficiency;

    // Lift acts perpendicular to velocity, upward relative to wings
    const wingUp = this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this._liftForce.copy(wingUp).multiplyScalar(liftMagnitude);

    // DRAG - opposes motion, increases with speed² and angle of attack
    if (speed > 0.01) {
      const dragMagnitude = BASE_DRAG + SPEED_DRAG * speedSq;
      const angleOfAttackDrag = FORM_DRAG * Math.abs(Math.sin(this._pitch));
      const totalDrag = dragMagnitude + angleOfAttackDrag;

      this._dragForce.copy(this.velocity).normalize().multiplyScalar(-totalDrag * speed);
    } else {
      this._dragForce.set(0, 0, 0);
    }

    // THRUST - flapping gives forward thrust
    this._thrustForce.set(0, 0, 0);
    if (this.isSprinting && this.throttle > 0) {
      const thrustEfficiency = 1 - Math.min(1, speed / MAX_SAFE_SPEED) * THRUST_EFFICIENCY_AT_SPEED;
      const thrustMagnitude = this.flapThrust * this.throttle * thrustEfficiency;
      this._thrustForce.copy(forward).multiplyScalar(thrustMagnitude);
    }

    // 6. INTEGRATE FORCES
    this._acceleration.set(0, 0, 0)
      .add(this._gravityForce)
      .add(this._liftForce)
      .add(this._dragForce)
      .add(this._thrustForce);

    this.velocity.addScaledVector(this._acceleration, deltaTime);

    // Speed limiter for safety
    const currentSpeed = this.velocity.length();
    if (currentSpeed > MAX_SAFE_SPEED) {
      this.velocity.multiplyScalar(MAX_SAFE_SPEED / currentSpeed);
    }

    // 7. UPDATE POSITION
    this.position.addScaledVector(this.velocity, deltaTime);

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

    // Give bird initial forward velocity for flight modes so it doesn't fall immediately
    if (this._initialMovementMode !== MOVEMENT_MODES.WALK) {
      const initialSpeed = OPTIMAL_GLIDE_SPEED * 0.8; // Start at 80% of optimal speed
      const forward = this._forward.set(0, 0, -1).applyQuaternion(this._initialQuaternion);
      this.velocity.copy(forward).multiplyScalar(initialSpeed);
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
    this._walkState.isGrounded = false;
    Object.assign(this.input, createAxisRecord());
    Object.assign(this._smoothedInput, createAxisRecord());
    this.setThrustInput({ forward: 0, strafe: 0, lift: 0, roll: 0 });
    this.setSprintActive(false);
  }
}
