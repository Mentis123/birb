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
export const THROTTLE_POWER_MULTIPLIER = 1.5;
// Maximum vertical speed when pitching fully up/down
// Set equal to MAX_FORWARD_SPEED to allow steep dives/climbs
export const MAX_VERTICAL_SPEED = 7;
// Total velocity magnitude cap - ensures forward + vertical share a budget
// When climbing/diving, forward speed is reduced to maintain this cap
export const MAX_TOTAL_SPEED = 7;
// Rotation rates for pitch and yaw (radians per second at full stick deflection)
export const PITCH_RATE = Math.PI * 0.6;
export const YAW_RATE = Math.PI * 0.75;
// How quickly the visual bank angle responds to yaw input
export const BANK_RESPONSE = 8;
// Upper bound on how far the bird can bank for readability and comfort.
export const MAX_BANK_ANGLE = (65 * Math.PI) / 180;
// Maximum visual pitch tilt when climbing/diving (nose up/down effect)
export const MAX_VISUAL_PITCH_ANGLE = (22 * Math.PI) / 180;
// Maximum pitch angle when in nest look-around mode (allows looking up/down freely)
export const MAX_NEST_PITCH_ANGLE = (85 * Math.PI) / 180;
// How quickly the visual pitch responds to vertical velocity
export const VISUAL_PITCH_RESPONSE = 6;
// How quickly pitch responds when in nest look-around mode (more responsive)
export const NEST_PITCH_RESPONSE = 12;
// Smoothing factor for nest look input (0 = instant, higher = smoother/slower)
// This dampens jittery input while preserving responsiveness
export const NEST_LOOK_SMOOTHING = 8;
// Reduced rotation rates for nest look mode (feels more controlled)
export const NEST_YAW_RATE = Math.PI * 0.5;
export const NEST_PITCH_RATE = Math.PI * 0.4;

const clamp = (value, min, max, fallback) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

// Extract all rotation components from a quaternion using YXZ Euler decomposition
// Uses an existing Euler instance to avoid constructor lookup issues
const extractRotationsFromQuaternion = (quaternion, eulerInstance) => {
  eulerInstance.setFromQuaternion(quaternion, 'YXZ');
  return { heading: eulerInstance.y, pitch: eulerInstance.x, bank: eulerInstance.z };
};

const noop = () => {};

const resolveLogger = (logger) => {
  if (logger === null || logger === undefined || logger === false) return noop;
  if (typeof logger === 'function') return logger;
  if (logger && typeof logger.debug === 'function') return (...args) => logger.debug(...args);
  if (logger && typeof logger.log === 'function') return (...args) => logger.log(...args);
  if (typeof console !== 'undefined') {
    if (typeof console.debug === 'function') return (...args) => console.debug(...args);
    if (typeof console.log === 'function') return (...args) => console.log(...args);
  }
  return noop;
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
    // Single quaternion for flight direction (combines heading + pitch)
    this.quaternion = new Quaternion();
    // Separate quaternion for visual output (includes banking for aesthetics)
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

    this._initialFrozen = Boolean(options.frozen ?? false);
    this.frozen = this._initialFrozen;
    this._frozenInitialized = false;

    this._initialPosition = options.position ? options.position.clone() : new Vector3(0, 0.65, 0);
    this._initialQuaternion = options.orientation ? options.orientation.clone() : new Quaternion();

    this.lookSensitivity = options.lookSensitivity ?? LOOK_SENSITIVITY;
    // Default throttle to 0 (stationary) - game code sets throttle > 0 to start flight
    this._initialThrottle = options.throttle ?? 0;
    this.throttle = this._initialThrottle;
    this.sprintMultiplier = options.sprintMultiplier ?? 1.4;
    this.isSprinting = false;
    // When false (default), pushing up/forward pitches the nose UP (push forward to fly up)
    // When true, controls are airplane-style: push forward to dive, pull back to climb
    this.invertPitch = options.invertPitch ?? false;

    this.input = createAxisRecord();
    // Accumulated look deltas (from mouse/touch) - applied once per frame
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    this._yawOnlyMode = false;
    this._pitchOnlyMode = false;
    // Nest look-around mode: allows larger pitch range and more responsive controls
    this._nestLookMode = false;
    // Smoothed input for nest look mode to reduce jitter
    this._smoothedNestYaw = 0;
    this._smoothedNestPitch = 0;

    // Track heading as a scalar angle to avoid quaternion accumulation issues
    this.heading = 0;
    this.bank = 0;
    this.pitch = 0;
    this.visualPitch = 0;
    this.forwardSpeed = BASE_FORWARD_SPEED;
    this.verticalVelocity = 0;
    this.elapsed = 0;

    this._debugLogging = Boolean(options.debugLogging ?? false);
    this._log = resolveLogger(options.debugLogger ?? options.logger);

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

  setFrozen(isFrozen) {
    this.frozen = Boolean(isFrozen);
    if (!this.frozen) {
      this._frozenInitialized = false;
    }
  }

  setYawOnlyMode(isActive) {
    this._yawOnlyMode = Boolean(isActive);
  }

  setPitchOnlyMode(isActive) {
    this._pitchOnlyMode = Boolean(isActive);
  }

  // Enable/disable nest look-around mode (larger pitch range, more responsive)
  setNestLookMode(isActive) {
    this._nestLookMode = Boolean(isActive);
    // Reset smoothed input and pitch when transitioning modes
    this._smoothedNestYaw = 0;
    this._smoothedNestPitch = 0;
    if (!this._nestLookMode) {
      // Reset pitch when exiting nest mode to avoid stuck at extreme angles
      this.pitch = clamp(this.pitch, -MAX_VISUAL_PITCH_ANGLE, MAX_VISUAL_PITCH_ANGLE, 0);
    }
  }

  isNestLookMode() {
    return this._nestLookMode;
  }

  setSprintActive(isActive) {
    this.isSprinting = Boolean(isActive);
  }

  setInvertPitch(invert) {
    this.invertPitch = Boolean(invert);
  }

  /**
   * Set the controller's orientation from a quaternion.
   * This method properly extracts heading/pitch/bank values from the quaternion,
   * ensuring that subsequent update() calls don't overwrite the orientation.
   * Use this instead of directly modifying controller.quaternion.
   *
   * @param {Quaternion} quaternion - The target orientation quaternion
   * @param {Object} options - Optional configuration
   * @param {boolean} options.preserveBank - If true, keeps current bank value (default: false)
   */
  setOrientation(quaternion, { preserveBank = false } = {}) {
    if (!quaternion || typeof quaternion.clone !== 'function') {
      return;
    }
    const rotations = extractRotationsFromQuaternion(quaternion, this._ambientEuler);
    this.heading = rotations.heading;
    this.pitch = rotations.pitch;
    if (!preserveBank) {
      this.bank = rotations.bank;
    }
    this.visualPitch = this.pitch;
    // Rebuild quaternions from extracted values to ensure consistency
    this._ambientEuler.set(this.pitch, this.heading, this.bank, 'YXZ');
    this._visualQuaternion.setFromEuler(this._ambientEuler);
    this._ambientEuler.set(this.pitch, this.heading, 0, 'YXZ');
    this.quaternion.setFromEuler(this._ambientEuler);
  }

  /**
   * Set heading directly (useful for aligning with a specific compass direction)
   * @param {number} headingRadians - The heading in radians
   */
  setHeading(headingRadians) {
    if (!Number.isFinite(headingRadians)) {
      return;
    }
    this.heading = headingRadians;
    // Normalize heading to [-PI, PI]
    const TWO_PI = Math.PI * 2;
    while (this.heading > Math.PI) this.heading -= TWO_PI;
    while (this.heading < -Math.PI) this.heading += TWO_PI;
    // Rebuild quaternions
    this._ambientEuler.set(this.pitch, this.heading, this.bank, 'YXZ');
    this._visualQuaternion.setFromEuler(this._ambientEuler);
    this._ambientEuler.set(this.pitch, this.heading, 0, 'YXZ');
    this.quaternion.setFromEuler(this._ambientEuler);
  }

  setSphereCenter(center) {
    if (center === null || center === undefined) {
      this._sphereCenter = null;
      // Reset to world up for flat world
      this._previousUp.set(0, 1, 0);
      return;
    }
    if (typeof center.clone === 'function') {
      this._sphereCenter = center.clone();
      // Update _previousUp to match new local up direction
      // This prevents unwanted quaternion realignment on the next frame
      this._computeLocalUp();
      this._previousUp.copy(this._localUp);
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

  _logFlightState(label, payload) {
    if (!this._debugLogging) return;
    this._log(`[free-flight] ${label}`, payload);
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

    if (deltaTime === 0) {
      this.velocity.set(0, 0, 0);
      this.forwardSpeed = 0;
      this.verticalVelocity = 0;
    }

    // Get inputs
    const yawInput = this._pitchOnlyMode ? 0 : this.input.yaw;
    let pitchInput = this._yawOnlyMode ? 0 : this.input.pitch;
    if (this.invertPitch) {
      pitchInput = -pitchInput;
    }

    const hasElapsedTime = deltaTime > 0;
    const hasRotationInput =
      this._pendingYaw !== 0 ||
      this._pendingPitch !== 0 ||
      yawInput !== 0 ||
      pitchInput !== 0;
    // Allow rotation-only updates (for stationary nest free-look) even when
    // simulation time isn't advancing by falling back to a small timestep.
    const rotationDeltaTime = hasElapsedTime
      ? deltaTime
      : hasRotationInput
        ? 1 / 60
        : 0;

    let combinedYaw = yawInput;
    let combinedPitch = pitchInput;

    if (rotationDeltaTime > 0) {
      // Apply accumulated look deltas to the current frame's inputs
      // Convert the queued deltas into normalized axis contributions so that
      // right-stick/mouse look influences the same rotation path as thrust yaw/pitch.
      const lookYawInput = clamp(
        this._pendingYaw / (YAW_RATE * rotationDeltaTime),
        -1,
        1,
        0,
      );
      const lookPitchInput = clamp(
        this._pendingPitch / (PITCH_RATE * rotationDeltaTime),
        -1,
        1,
        0,
      );

      combinedYaw = clamp(yawInput + lookYawInput, -1, 1, yawInput);
      combinedPitch = clamp(pitchInput + lookPitchInput, -1, 1, pitchInput);

      // Clear queued deltas now that they've been consumed
      this._pendingYaw = 0;
      this._pendingPitch = 0;
    }

    // In nest mode, apply input smoothing to reduce jitter and make controls feel fluid
    let effectiveYaw = combinedYaw;
    let effectivePitch = combinedPitch;

    if (this._nestLookMode && rotationDeltaTime > 0) {
      // Smooth interpolation toward target input values
      const smoothStep = 1 - Math.exp(-NEST_LOOK_SMOOTHING * rotationDeltaTime);
      this._smoothedNestYaw += (combinedYaw - this._smoothedNestYaw) * smoothStep;
      this._smoothedNestPitch += (combinedPitch - this._smoothedNestPitch) * smoothStep;

      // Use smoothed values for nest look
      effectiveYaw = this._smoothedNestYaw;
      effectivePitch = this._smoothedNestPitch;
    }

    // Update heading as a scalar angle
    // yawDelta sign: negative yawInput (stick left) -> positive delta -> heading increases -> turn left
    //                positive yawInput (stick right) -> negative delta -> heading decreases -> turn right
    // Use reduced rotation rate in nest mode for more controlled look-around
    const activeYawRate = this._nestLookMode ? NEST_YAW_RATE : YAW_RATE;
    const yawDelta = -effectiveYaw * activeYawRate * rotationDeltaTime;
    this.heading += yawDelta;

    // Normalize heading to [-PI, PI] to prevent floating-point precision issues over time
    const TWO_PI = Math.PI * 2;
    while (this.heading > Math.PI) this.heading -= TWO_PI;
    while (this.heading < -Math.PI) this.heading += TWO_PI;

    // Visual banking - wing dips on the side we're turning toward
    // Left stick (positive yaw) = left wing down = negative roll in THREE.js
    // No banking in nest mode (bird is stationary)
    const targetBank = this._nestLookMode ? 0 : -combinedYaw * MAX_BANK_ANGLE;

    const bankStep = 1 - Math.exp(-BANK_RESPONSE * rotationDeltaTime);
    this.bank += (targetBank - this.bank) * bankStep;
    this.bank = clamp(this.bank, -MAX_BANK_ANGLE, MAX_BANK_ANGLE, this.bank);

    // Visual pitch - nose up when pushing up, nose down when pushing down
    // Positive pitch input (up stick) = positive pitch angle = nose up
    // Use larger pitch range and faster response when in nest look-around mode
    const maxPitchAngle = this._nestLookMode ? MAX_NEST_PITCH_ANGLE : MAX_VISUAL_PITCH_ANGLE;
    const pitchResponse = this._nestLookMode ? NEST_PITCH_RESPONSE : VISUAL_PITCH_RESPONSE;

    // In nest mode, accumulate pitch from smoothed input for fluid free look
    // In flight mode, pitch is proportional to input (returns to level when released)
    if (this._nestLookMode) {
      // Accumulate pitch from smoothed input - free look style with reduced rate
      const pitchDelta = effectivePitch * NEST_PITCH_RATE * rotationDeltaTime;
      this.pitch += pitchDelta;
      this.pitch = clamp(this.pitch, -maxPitchAngle, maxPitchAngle, this.pitch);
    } else {
      // Flight mode: pitch proportional to input
      const targetPitch = combinedPitch * maxPitchAngle;
      const pitchStep = 1 - Math.exp(-pitchResponse * rotationDeltaTime);
      this.pitch += (targetPitch - this.pitch) * pitchStep;
      this.pitch = clamp(this.pitch, -maxPitchAngle, maxPitchAngle, this.pitch);
    }
    this.visualPitch = this.pitch;

    // Build orientation quaternions
    if (this._sphereCenter) {
      this._computeLocalUp();

      // DEBUG: Log heading changes
      if (Math.abs(effectiveYaw) > 0.01) {
        console.log('YAW INPUT:', effectiveYaw.toFixed(3), 'HEADING:', this.heading.toFixed(3));
      }

      // SPHERICAL WORLD: Build quaternion using LOCAL up as yaw axis
      // This ensures heading rotation happens in the local tangent plane,
      // not around world Y.

      // Step 1: Create yaw rotation around LOCAL up
      this._yawQuaternion.setFromAxisAngle(this._localUp, this.heading);

      // Step 2: Compute local right (perpendicular to local up and world forward reference)
      // Use world -Z projected onto tangent plane as reference forward
      const refForward = this._forward.set(0, 0, -1);
      const upDot = refForward.dot(this._localUp);
      refForward.addScaledVector(this._localUp, -upDot);
      if (refForward.lengthSq() < 1e-6) {
        refForward.set(1, 0, 0);
        const fallbackDot = refForward.dot(this._localUp);
        refForward.addScaledVector(this._localUp, -fallbackDot);
      }
      refForward.normalize();

      // Local right is perpendicular to both local up and reference forward
      const localRight = this._right.crossVectors(this._localUp, refForward).normalize();

      // Step 3: Create pitch rotation around local right
      this._pitchQuaternion.setFromAxisAngle(localRight, this.pitch);

      // Step 4: Create bank rotation around local forward (after yaw)
      const localForward = refForward.clone().applyQuaternion(this._yawQuaternion);
      this._bankQuaternion.setFromAxisAngle(localForward, this.bank);

      // Combine: yaw, then pitch, then bank
      this._visualQuaternion.copy(this._yawQuaternion)
        .multiply(this._pitchQuaternion)
        .multiply(this._bankQuaternion);

      // Physics quaternion: yaw and pitch only (no bank)
      this.quaternion.copy(this._yawQuaternion).multiply(this._pitchQuaternion);

    } else {
      // FLAT WORLD: Use original Euler-based approach
      this._ambientEuler.set(this.pitch, this.heading, this.bank, 'YXZ');
      this._visualQuaternion.setFromEuler(this._ambientEuler);

      this._ambientEuler.set(this.pitch, this.heading, 0, 'YXZ');
      this.quaternion.setFromEuler(this._ambientEuler);
    }

    const canTranslate =
      !this.frozen &&
      !this._yawOnlyMode &&
      !this._pitchOnlyMode &&
      hasElapsedTime;

    // DEBUG: Why can't we translate?
    if (!canTranslate && this.elapsed % 0.5 < 0.02) {
      console.log('CANT TRANSLATE: frozen=', this.frozen, 'yawOnly=', this._yawOnlyMode, 'pitchOnly=', this._pitchOnlyMode, 'hasTime=', hasElapsedTime);
    }

    if (canTranslate) {
      const throttle = this.getEffectiveThrottle();
      this._computeLocalUp();

      let forwardDirection;

      if (this._sphereCenter) {
        // SPHERICAL: Compute forward same way as quaternion is built
        // Start with world -Z projected onto tangent plane
        forwardDirection = this._forward.set(0, 0, -1);
        const refDot = forwardDirection.dot(this._localUp);
        forwardDirection.addScaledVector(this._localUp, -refDot);
        if (forwardDirection.lengthSq() < 1e-6) {
          forwardDirection.set(1, 0, 0);
          const fallbackDot = forwardDirection.dot(this._localUp);
          forwardDirection.addScaledVector(this._localUp, -fallbackDot);
        }
        forwardDirection.normalize();

        // Apply yaw rotation around local up (same as quaternion building)
        forwardDirection.applyQuaternion(this._yawQuaternion);
        forwardDirection.normalize();

        // DEBUG: Log heading and forward
        if (this.elapsed % 0.5 < 0.02) {
          console.log('HEADING:', this.heading.toFixed(2), 'FWD:', forwardDirection.x.toFixed(2), forwardDirection.y.toFixed(2), forwardDirection.z.toFixed(2));
        }
      } else {
        // FLAT: Use quaternion-based forward
        forwardDirection = this._forward.set(0, 0, -1).applyQuaternion(this.quaternion);
        forwardDirection.normalize();
      }

      // Calculate uncapped target speeds
      const rawForwardSpeed = clamp(
        throttle * (BASE_FORWARD_SPEED + SPEED_RAMP),
        0,
        MAX_FORWARD_SPEED,
        this.forwardSpeed,
      );

      const rawVerticalVelocity = clamp(
        combinedPitch * LIFT_ACCELERATION * throttle,
        -MAX_VERTICAL_SPEED,
        MAX_VERTICAL_SPEED,
        this.verticalVelocity,
      );

      this.velocity
        .copy(forwardDirection)
        .multiplyScalar(rawForwardSpeed)
        .addScaledVector(this._localUp, rawVerticalVelocity);

      const uncappedSpeed = this.velocity.length();
      if (uncappedSpeed > MAX_TOTAL_SPEED && uncappedSpeed > 0) {
        this.velocity.multiplyScalar(MAX_TOTAL_SPEED / uncappedSpeed);
      }

      this.forwardSpeed = this.velocity.dot(forwardDirection);
      this.verticalVelocity = this.velocity.dot(this._localUp);

      this.position.addScaledVector(this.velocity, deltaTime);
    } else {
      this.velocity.set(0, 0, 0);
      this.forwardSpeed = 0;
      this.verticalVelocity = 0;
    }

    return {
      position: this.position,
      quaternion: this._visualQuaternion,
    };
  }

  getAmbientOffsets() {
    // DEBUGGING: Disabled all ambient motion (bobbing, rolling, yaw)
    this._ambientPosition.set(0, 0, 0);
    this._ambientQuaternion.set(0, 0, 0, 1); // Identity quaternion

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

    // CRITICAL FIX: Extract heading/pitch/bank from initial quaternion instead of
    // resetting to 0. This ensures the bird's direction matches its initial orientation
    // and prevents the first update() from overwriting the initial quaternion.
    const rotations = extractRotationsFromQuaternion(this._initialQuaternion, this._ambientEuler);
    this.heading = rotations.heading;
    this.pitch = rotations.pitch;
    this.bank = rotations.bank;
    this.visualPitch = this.pitch;

    this.forwardSpeed = 0;
    this.verticalVelocity = 0;
    this.elapsed = 0;
    this._pendingYaw = 0;
    this._pendingPitch = 0;
    this._yawOnlyMode = false;
    this._pitchOnlyMode = false;
    this._nestLookMode = false;
    Object.assign(this.input, createAxisRecord());
    this.setInputs({ yaw: 0, pitch: 0 });
    this.setSprintActive(false);
    this.throttle = this._initialThrottle;
    this.frozen = this._initialFrozen;
    this._frozenInitialized = false;
    // Reset previous up to match initial position's local up
    this._computeLocalUp();
    this._previousUp.copy(this._localUp);
  }

  /**
   * Set the initial orientation for the controller. This can be called after
   * construction to change the spawn orientation. The heading and pitch will
   * be extracted from the quaternion on the next reset() call.
   */
  setInitialOrientation(quaternion) {
    if (quaternion && typeof quaternion.clone === 'function') {
      this._initialQuaternion.copy(quaternion);
    }
  }

  /**
   * Get the current heading angle in radians.
   */
  getHeading() {
    return this.heading;
  }

  /**
   * Set the heading angle directly (in radians). Useful for teleportation
   * or spawning at a specific orientation.
   */
  setHeading(radians) {
    if (Number.isFinite(radians)) {
      this.heading = radians;
      // Normalize to [-PI, PI]
      const TWO_PI = Math.PI * 2;
      while (this.heading > Math.PI) this.heading -= TWO_PI;
      while (this.heading < -Math.PI) this.heading += TWO_PI;
    }
  }
}
