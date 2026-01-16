/**
 * bird-flight.js
 * 
 * Standard Flight Controller for Spherical Worlds.
 * Separates Position and Orientation to allow full 6DOF control 
 * (constrained to sphere surface).
 */

export const FLIGHT_DEFAULTS = {
    speed: 4,
    yawRate: Math.PI * 0.8,
    pitchRate: Math.PI * 0.6,
    maxPitch: Math.PI * 0.4,
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

        // State identifiers
        // 1. Position: Absolute world position
        this.position = options.position
            ? options.position.clone()
            : new Vector3(0, this.sphereRadius, 0);

        // 2. Quaternion: Orientation in World Space
        this.quaternion = options.quaternion
            ? options.quaternion.clone()
            : new Quaternion();

        // Scratch variables
        this._scratch = {
            vec3: new Vector3(),
            axis: new Vector3(),
            quat: new Quaternion(),
            up: new Vector3(),
            forward: new Vector3(),
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
        const angle = -input * this.yawRate * deltaTime; // Input+ (Right) -> Neg Angle (Right Turn?)
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
        const angle = input * this.pitchRate * deltaTime;

        this._scratch.axis.set(1, 0, 0);
        this._scratch.quat.setFromAxisAngle(this._scratch.axis, angle);
        this.quaternion.multiply(this._scratch.quat);
    }

    update(deltaTime) {
        if (deltaTime <= 0) return this._getPose();

        const { Vector3, Quaternion } = this.THREE;

        // 1. Move Forward
        // Get forward direction: (0, 0, -1) rotated by Q
        this._scratch.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();

        // Calculate displacement
        // Note: If pitched up, forward has an Up component. 
        // We might want to project forward onto the surface tangent if we want constant ground speed.
        // But for "Flight" feel, flying towards sky should just move you less along ground.
        const displacement = this._scratch.forward.multiplyScalar(this.speed * deltaTime);

        // Save old position/normal for transport
        const oldPos = this.position.clone();
        const oldNormal = oldPos.clone().normalize();

        // Apply movement
        this.position.add(displacement);

        // 2. Constrain to Sphere (keep minimum altitude, allow climbing)
        const radialOffset = this.position.clone().sub(this.sphereCenter);
        const radialDistance = radialOffset.length();
        if (radialDistance < this.sphereRadius) {
            radialOffset.normalize().multiplyScalar(this.sphereRadius);
            this.position.copy(radialOffset.add(this.sphereCenter));
        }

        // 3. Transport Rotation (Spherical Adjustment)
        // We moved along the sphere, so our "Up" vector (Gravity) changed.
        // We must rotate the bird's orientation to match the new local vertical.
        const newNormal = this.position.clone().sub(this.sphereCenter).normalize();

        // Calculate quaternion that rotates Old Normal to New Normal
        const transportQ = new Quaternion().setFromUnitVectors(oldNormal, newNormal);

        // Apply this rotation GLOBALLY to the bird (Pre-multiply)
        // This effectively "drags" the bird's orientation to follow the curve
        this.quaternion.premultiply(transportQ);

        // 4. Auto-Leveling (Pitch)
        // If no pitch input, slowly rotate back to level flight (tangent to sphere)
        // Level flight means Local Forward has 0 vertical component relative to Sphere Normal.
        // We already have 'newNormal' (World Up).
        // Forward is (0,0,-1) applied by Quat.
        // We want Forward dot Normal = 0.
        // Current Pitch Angle = Asin(Forward dot Normal).
        // We want to rotate around Local X (Pitch) to reduce this angle.

        // Only auto-level if speed is sufficient (aerodynamic stability)
        if (this.speed > 0.5) {
            const currentForward = this._scratch.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
            const sphereNormal = this.position.clone().sub(this.sphereCenter).normalize();

            // Pitch Angle: Angle between Forward vector and the Tangent Plane.
            // Sin(Pitch) = Forward dot Normal.
            const sinPitch = currentForward.dot(sphereNormal);

            // If pointing UP (positive dot), we want to Pitch DOWN (Negative X Rot).
            // If pointing DOWN (negative dot), we want to Pitch UP (Positive X Rot).
            // So correction is proportional to -sinPitch.

            const autoLevelStrength = 1.0; // Adjustment strength
            const correction = -sinPitch * autoLevelStrength * deltaTime;

            // Apply if significant
            if (Math.abs(correction) > 0.0001) {
                this._scratch.axis.set(1, 0, 0); // Local X
                this._scratch.quat.setFromAxisAngle(this._scratch.axis, correction);
                this.quaternion.multiply(this._scratch.quat);
            }
        }

        return this._getPose();
    }

    tick(input, deltaTime) {
        const limitedDelta = Math.min(Math.max(deltaTime, 0), 0.05);
        this.yaw(input.x, limitedDelta);
        this.pitch(input.y, limitedDelta);
        return this.update(limitedDelta);
    }

    _constrainToSphere() {
        if (this.sphereCenter) {
            const radialOffset = this.position.clone().sub(this.sphereCenter);
            const radialDistance = radialOffset.length();
            if (radialDistance < this.sphereRadius) {
                radialOffset.normalize().multiplyScalar(this.sphereRadius);
                this.position.copy(radialOffset.add(this.sphereCenter));
            }
        }
    }

    _getPose() {
        return {
            position: this.position.clone(),
            quaternion: this.quaternion.clone(),
            velocity: new this.THREE.Vector3() // Todo: calc velocity if needed
        };
    }

    // Getters for external checking
    getPosition() { return this.position.clone(); }

    setSpeed(speed) {
        this.speed = speed;
    }
}
