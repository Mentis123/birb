export const MOVEMENT_ACCELERATION = 5.25;
export const LINEAR_DRAG = 0.6;
export const SPRINT_MULTIPLIER = 1.75;
// Controls how quickly the bird eases toward new roll velocities when banking.
export const BANK_RESPONSIVENESS = 2.75;
// Maximum roll velocity (radians per second) that sustained input can achieve.
export const BANK_ROLL_SPEED = Math.PI;
// Highest bank angle (radians) that the controller will allow before clamping.
export const MAX_BANK_ANGLE = (35 * Math.PI) / 180;
// How strongly the controller tries to level the bird's wings when there is no roll input.
export const BANK_LEVEL_STIFFNESS = 4.25;
export const LOOK_SENSITIVITY = 0.0025;
export const AMBIENT_BOB_AMPLITUDE = 0.16;
export const AMBIENT_BOB_SPEED = 1.15;
export const AMBIENT_ROLL_AMPLITUDE = 0.08;
export const AMBIENT_ROLL_SPEED = 0.9;
export const AMBIENT_YAW_AMPLITUDE = 0.05;
export const AMBIENT_YAW_SPEED = 0.7;

// Yaw speed applied when using the simplified turn input.
export const TURN_SPEED = Math.PI * 0.75;

export const INPUT_SMOOTHING = 12;
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

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    this.throttle = options.throttle ?? 1;
    this.sprintMultiplier = options.sprintMultiplier ?? SPRINT_MULTIPLIER;
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
      this._walkState.verticalVelocity = 0;
      this._walkState.isGrounded = false;
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

    if (deltaTime > 0) {
      // Apply a gentle yaw response so horizontal thrust becomes a smooth turn
      // instead of a sharp strafe.
      const yawInput = clamp(smoothed.strafe, -1, 1, 0);
      // Negative sign keeps a positive strafe input yawing the bird to the right
      // to match the on-screen joystick direction.
      const yawAngle = -yawInput * this.turnSpeed * deltaTime;
      if (Math.abs(yawAngle) > 1e-6) {
        this._yawQuaternion.setFromAxisAngle(up, yawAngle);
        this.lookQuaternion.premultiply(this._yawQuaternion);
      }
    }

    this.lookQuaternion.normalize();
    this.quaternion.copy(this.lookQuaternion);

    if (this._movementMode === MOVEMENT_MODES.WALK) {
      this._walkEuler.setFromQuaternion(this.quaternion);
      this._walkEuler.x = 0;
      this._walkEuler.z = 0;
      this.quaternion.setFromEuler(this._walkEuler);
      this.lookQuaternion.copy(this.quaternion);
    }

    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

    if (this._movementMode === MOVEMENT_MODES.WALK) {
      return this._updateWalk(deltaTime, smoothed, { forward, right, up });
    }

    const acceleration = this._acceleration.set(0, 0, 0);
    const forwardInput = clamp(smoothed.forward, -1, 1, 0);
    const liftInput = clamp(smoothed.lift, -1, 1, 0);

    const hasTranslationInput =
      Math.abs(forwardInput) > 1e-3 ||
      Math.abs(liftInput) > 1e-3;

    const effectiveAcceleration = MOVEMENT_ACCELERATION * this.getEffectiveThrottle();

    if (Math.abs(forwardInput) > 1e-3) {
      acceleration.addScaledVector(forward, forwardInput);
      if (acceleration.lengthSq() > 1) {
        acceleration.normalize();
      }
      acceleration.multiplyScalar(effectiveAcceleration);
      this.velocity.addScaledVector(acceleration, deltaTime);
    }

    if (Math.abs(liftInput) > 1e-3) {
      const liftAcceleration = liftInput * effectiveAcceleration;
      this.velocity.addScaledVector(up, liftAcceleration * deltaTime);
    }

    const dragMultiplier = Math.exp(-LINEAR_DRAG * deltaTime);
    this.velocity.multiplyScalar(dragMultiplier);

    if (!hasTranslationInput) {
      const idleDragMultiplier = Math.exp(-this.idleLinearDrag * deltaTime);
      this.velocity.multiplyScalar(idleDragMultiplier);
    }

    if (Math.abs(smoothed.strafe) < 0.05) {
      const sidewaysSpeed = this.velocity.dot(right);
      if (Math.abs(sidewaysSpeed) > 1e-3) {
        const correctionRate = MOVEMENT_ACCELERATION * 0.45;
        const maxCorrection = correctionRate * deltaTime;
        const correction = Math.sign(sidewaysSpeed) * Math.min(Math.abs(sidewaysSpeed), maxCorrection);
        this.velocity.addScaledVector(right, -correction);
      }
    }

    this.position.addScaledVector(this.velocity, deltaTime);

    const forwardZ = forward.z;
    let bankOrientation = 1;
    // When the bird is facing back toward the camera (positive Z), invert the
    // roll direction so turning left still lowers the left wing.
    if (forwardZ > 1e-4) {
      bankOrientation = -1;
    } else if (forwardZ < -1e-4) {
      bankOrientation = 1;
    }

    const bankStep = 1 - Math.exp(-BANK_RESPONSIVENESS * deltaTime);
    const maxBankAngle = Math.max(0, this.maxBankAngle ?? 0);
    const rawRollInput = smoothed.roll * bankOrientation;
    let rollInput = rawRollInput;
    let rollInputClampedByBankLimit = false;

    if (maxBankAngle > 0) {
      const bankAbs = Math.abs(this.bank);
      if (bankAbs >= maxBankAngle - 1e-4 && Math.sign(rollInput) === Math.sign(this.bank)) {
        rollInput = 0;
        rollInputClampedByBankLimit = true;
      }
    }

    if (Math.abs(rollInput) > 1e-4) {
      const targetAngularVelocity = rollInput * BANK_ROLL_SPEED;
      this._bankVelocity += (targetAngularVelocity - this._bankVelocity) * bankStep;
    } else if (!rollInputClampedByBankLimit && Math.abs(rawRollInput) <= 1e-4) {
      const levelingAngularVelocity = -this.bank * BANK_LEVEL_STIFFNESS;
      const targetAngularVelocity = clamp(
        levelingAngularVelocity,
        -BANK_ROLL_SPEED,
        BANK_ROLL_SPEED,
        0
      );
      this._bankVelocity += (targetAngularVelocity - this._bankVelocity) * bankStep;
    } else {
      this._bankVelocity += (0 - this._bankVelocity) * bankStep;
    }

    this.bank += this._bankVelocity * deltaTime;

    if (maxBankAngle > 0) {
      if (this.bank > maxBankAngle) {
        this.bank = maxBankAngle;
        if (this._bankVelocity > 0) {
          this._bankVelocity = 0;
        }
      } else if (this.bank < -maxBankAngle) {
        this.bank = -maxBankAngle;
        if (this._bankVelocity < 0) {
          this._bankVelocity = 0;
        }
      }
    }

    this._bankQuaternion.setFromAxisAngle(forward, -this.bank);
    this.quaternion.multiply(this._bankQuaternion);

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
    this.velocity.set(0, 0, 0);
    this.lookQuaternion.copy(this._initialQuaternion);
    this.quaternion.copy(this._initialQuaternion);
    this.bank = 0;
    this._bankVelocity = 0;
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
