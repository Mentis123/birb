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

        // 2. Constrain to Sphere
        this.position.sub(this.sphereCenter).normalize().multiplyScalar(this.sphereRadius).add(this.sphereCenter);

        // 3. Transport Rotation (Spherical Adjustment)
        // We moved along the sphere, so our "Up" vector (Gravity) changed.
        // We must rotate the bird's orientation to match the new local vertical.
        const newNormal = this.position.clone().sub(this.sphereCenter).normalize();

        // Calculate quaternion that rotates Old Normal to New Normal
        const transportQ = new Quaternion().setFromUnitVectors(oldNormal, newNormal);

        // Apply this rotation GLOBALLY to the bird (Pre-multiply)
        // This effectively "drags" the bird's orientation along with the earth's curve
        this.quaternion.premultiply(transportQ);

        return this._getPose();
    }

    tick(input, deltaTime) {
        this.yaw(input.x, deltaTime);
        this.pitch(input.y, deltaTime);
        return this.update(deltaTime);
    }

    _constrainToSphere() {
        if (this.sphereCenter) {
            this.position.sub(this.sphereCenter).normalize().multiplyScalar(this.sphereRadius).add(this.sphereCenter);
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
}
