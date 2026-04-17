/**
 * bird-flight.js
 *
 * Standard Flight Controller for Spherical Worlds.
 * Separates Position and Orientation to allow full 6DOF control
 * (constrained to sphere surface).
 *
 * OPTIMIZED: Uses pre-allocated scratch vectors to eliminate per-frame garbage collection
 */

export const FLIGHT_DEFAULTS = {
    speed: 11,                  // bumped 8 -> 11 (~37%) for traversable 4× world
    yawRate: Math.PI * 0.8,
    pitchRate: Math.PI * 0.6,
    maxPitch: Math.PI * 0.4,
};

// Zen mode tuning — chill and floaty, NOT slow.
// Applied as read-time multipliers so base constants stay intact for other modes.
export const ZEN_TUNING = {
    speedMul: 1.0,    // no speed nerf — Zen is the default, players need to cover ground
    yawMul: 0.9,      // gentle softening only
    pitchMul: 0.9,    // gentle softening only
};

export class BirdFlight {
    constructor(THREE, options = {}) {
        this.THREE = THREE;
        const { Vector3, Quaternion } = THREE;

        // Configuration
        this.sphereCenter = options.sphereCenter ? options.sphereCenter.clone() : new Vector3(0, 0, 0);
        this.sphereRadius = options.sphereRadius ?? 100;
        this.speed = options.speed ?? FLIGHT_DEFAULTS.speed;
        this.yawRate = options.yawRate ?? FLIGHT_DEFAULTS.yawRate;
        this.pitchRate = options.pitchRate ?? FLIGHT_DEFAULTS.pitchRate;

        // Zen mode flag — when true, applies ZEN_TUNING multipliers at read-time.
        // Does NOT mutate base constants, so toggling back is byte-identical for other modes.
        this.zenMode = Boolean(options.zenMode);

        // State identifiers
        // 1. Position: Absolute world position
        this.position = options.position
            ? options.position.clone()
            : new Vector3(0, this.sphereRadius, 0);

        // 2. Quaternion: Orientation in World Space
        this.quaternion = options.quaternion
            ? options.quaternion.clone()
            : new Quaternion();

        // Pre-allocated scratch variables (ZERO per-frame allocations)
        this._scratch = {
            vec3: new Vector3(),
            vec3_2: new Vector3(),
            vec3_3: new Vector3(),
            axis: new Vector3(),
            quat: new Quaternion(),
            transportQuat: new Quaternion(),
            up: new Vector3(),
            forward: new Vector3(),
            oldPos: new Vector3(),
            oldNormal: new Vector3(),
            newNormal: new Vector3(),
            radialOffset: new Vector3(),
            sphereNormal: new Vector3(),
            displacement: new Vector3(),
        };

        // Pre-allocated pose output (reused each frame)
        this._poseOutput = {
            position: new Vector3(),
            quaternion: new Quaternion(),
            velocity: new Vector3()
        };

        // Ensure initially on surface
        this._constrainToSphere();
    }

    /**
     * Yaw (Turn Left/Right)
     * Rotates around the Bird's Local Up axis
     */
    yaw(input, deltaTime) {
        if (!input) return;
        const yawMul = this.zenMode ? ZEN_TUNING.yawMul : 1;
        const angle = -input * this.yawRate * yawMul * deltaTime; // Input+ (Right) -> Neg Angle (Right Turn?)
        // Standard: Rotate Around Y.
        // If input +1 (Right), we want to turn Right.
        // RotY(-ang) turns Right.
        this._scratch.axis.set(0, 1, 0);
        this._scratch.quat.setFromAxisAngle(this._scratch.axis, angle);
        this.quaternion.multiply(this._scratch.quat);
    }

    /**
     * Pitch (Nose Up/Down)
     * Rotates around the Bird's Local X axis
     */
    pitch(input, deltaTime) {
        if (!input) return;
        // User request: "Push Up (Input +1) should Fly Up"
        // +1 Input -> Positive Rotation around X -> Nose Up
        const pitchMul = this.zenMode ? ZEN_TUNING.pitchMul : 1;
        const angle = input * this.pitchRate * pitchMul * deltaTime;

        this._scratch.axis.set(1, 0, 0);
        this._scratch.quat.setFromAxisAngle(this._scratch.axis, angle);
        this.quaternion.multiply(this._scratch.quat);
    }

    update(deltaTime) {
        if (deltaTime <= 0) return this._getPose();

        const s = this._scratch; // Shorthand for scratch vectors

        // 1. Move Forward
        // Get forward direction: (0, 0, -1) rotated by Q
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();

        // Calculate displacement (reuse scratch vector)
        // Zen mode applies a speed multiplier at read-time without mutating this.speed.
        const speedMul = this.zenMode ? ZEN_TUNING.speedMul : 1;
        s.displacement.copy(s.forward).multiplyScalar(this.speed * speedMul * deltaTime);

        // Save old position/normal for transport (using scratch vectors - NO allocations)
        s.oldPos.copy(this.position);
        s.oldNormal.copy(s.oldPos).normalize();

        // Apply movement
        this.position.add(s.displacement);

        // 2. Constrain to Sphere (keep minimum altitude, allow climbing)
        s.radialOffset.copy(this.position).sub(this.sphereCenter);
        const radialDistance = s.radialOffset.length();
        if (radialDistance < this.sphereRadius) {
            s.radialOffset.normalize().multiplyScalar(this.sphereRadius);
            this.position.copy(s.radialOffset).add(this.sphereCenter);
        }

        // 3. Transport Rotation (Spherical Adjustment)
        // We moved along the sphere, so our "Up" vector (Gravity) changed.
        // We must rotate the bird's orientation to match the new local vertical.
        s.newNormal.copy(this.position).sub(this.sphereCenter).normalize();

        // Calculate quaternion that rotates Old Normal to New Normal (using scratch quat)
        s.transportQuat.setFromUnitVectors(s.oldNormal, s.newNormal);

        // Apply this rotation GLOBALLY to the bird (Pre-multiply)
        // This effectively "drags" the bird's orientation to follow the curve
        this.quaternion.premultiply(s.transportQuat);

        // 4. Auto-Leveling (Pitch)
        // Only auto-level if speed is sufficient (aerodynamic stability)
        if (this.speed > 0.5) {
            s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
            s.sphereNormal.copy(this.position).sub(this.sphereCenter).normalize();

            // Pitch Angle: Sin(Pitch) = Forward dot Normal
            const sinPitch = s.forward.dot(s.sphereNormal);

            // Correction proportional to -sinPitch
            const autoLevelStrength = 1.0;
            const correction = -sinPitch * autoLevelStrength * deltaTime;

            // Apply if significant
            if (Math.abs(correction) > 0.0001) {
                s.axis.set(1, 0, 0); // Local X
                s.quat.setFromAxisAngle(s.axis, correction);
                this.quaternion.multiply(s.quat);
            }
        }

        return this._getPose();
    }

    tick(input, deltaTime) {
        const limitedDelta = Math.min(Math.max(deltaTime, 0), 0.05);
        this.yaw(input.x, limitedDelta);
        this.pitch(input.y, limitedDelta);

        // Zen mode: gentle auto-level-roll when stick is near-centered.
        // Rotates around local Z to align the bird's local "up" with the sphere normal,
        // preventing accidental disorientation. Small per-frame correction, not snappy.
        if (this.zenMode) {
            const inputMag = Math.hypot(input.x || 0, input.y || 0);
            if (inputMag < 0.1) {
                this._applyZenAutoLevelRoll(limitedDelta);
            }
        }

        return this.update(limitedDelta);
    }

    /**
     * Zen auto-level-roll. Gently interpolates the bird's local-up toward the
     * sphere normal by rotating around local Z. Zero allocations.
     */
    _applyZenAutoLevelRoll(deltaTime) {
        const s = this._scratch;
        // Local up of the bird in world space
        s.up.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
        // Sphere outward normal at bird position
        s.sphereNormal.copy(this.position).sub(this.sphereCenter).normalize();
        // Local right of the bird
        const localRight = s.vec3_2.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
        // Roll angle = angle between local-up and sphere-normal projected onto roll plane
        // sin(roll) ≈ sphereNormal dot localRight (right component of normal)
        const sinRoll = s.sphereNormal.dot(localRight);
        // Gentle correction proportional to -sinRoll. Strength keeps it floaty.
        const correction = -sinRoll * 1.2 * deltaTime;
        if (Math.abs(correction) > 0.0001) {
            s.axis.set(0, 0, 1); // Local Z (roll axis)
            s.quat.setFromAxisAngle(s.axis, correction);
            this.quaternion.multiply(s.quat);
        }
    }

    _constrainToSphere() {
        if (this.sphereCenter) {
            const s = this._scratch;
            s.radialOffset.copy(this.position).sub(this.sphereCenter);
            const radialDistance = s.radialOffset.length();
            if (radialDistance < this.sphereRadius) {
                s.radialOffset.normalize().multiplyScalar(this.sphereRadius);
                this.position.copy(s.radialOffset).add(this.sphereCenter);
            }
        }
    }

    _getPose() {
        // Reuse pre-allocated pose output to avoid allocations
        this._poseOutput.position.copy(this.position);
        this._poseOutput.quaternion.copy(this.quaternion);
        this._poseOutput.velocity.set(0, 0, 0); // Todo: calc velocity if needed
        return this._poseOutput;
    }

    // Getters for external checking
    // Note: getPosition returns a copy for safety when used externally
    getPosition() { return this._scratch.vec3.copy(this.position); }

    setSpeed(speed) {
        this.speed = speed;
    }

    /**
     * Toggle Zen mode. When enabled, applies ZEN_TUNING multipliers to forward
     * speed, yaw rate, and pitch rate at read-time. Base constants are not mutated.
     */
    setZenMode(enabled) {
        this.zenMode = Boolean(enabled);
    }
}
