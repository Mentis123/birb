/**
 * bird-flight.js
 * 
 * Simple flight controller with ONE source of truth.
 * 
 * Key insight: The quaternion IS the state. Everything derives from it.
 * - Position = derived from quaternion (for spherical) or tracked separately (for flat)
 * - Forward = local -Z of quaternion
 * - Up = local +Y of quaternion
 * - Velocity = forward * speed
 */

export const FLIGHT_DEFAULTS = {
    speed: 5,
    yawRate: Math.PI * 0.8,      // ~144°/sec - snappy turns
    pitchRate: Math.PI * 0.6,    // ~108°/sec - responsive pitch
    maxPitch: Math.PI * 0.4,     // 72° - allows steep climbs/dives
};

export class BirdFlight {
    constructor(THREE, options = {}) {
        this.THREE = THREE;
        const { Vector3, Quaternion } = THREE;

        // === THE ONE SOURCE OF TRUTH ===
        this.quaternion = new Quaternion();

        // Spherical world configuration
        this.sphereCenter = options.sphereCenter
            ? options.sphereCenter.clone()
            : null;
        this.sphereRadius = options.sphereRadius ?? 100;

        // For flat worlds, we track position separately
        this._flatPosition = new Vector3(0, 5, 0);

        // Flight parameters
        this.speed = options.speed ?? FLIGHT_DEFAULTS.speed;
        this.yawRate = options.yawRate ?? FLIGHT_DEFAULTS.yawRate;
        this.pitchRate = options.pitchRate ?? FLIGHT_DEFAULTS.pitchRate;
        this.maxPitch = options.maxPitch ?? FLIGHT_DEFAULTS.maxPitch;

        // Current pitch angle (tracked to enforce limits)
        this._pitch = 0;

        // Scratch vectors (reused to avoid allocations)
        this._scratch = {
            forward: new Vector3(),
            up: new Vector3(),
            right: new Vector3(),
            axis: new Vector3(),
            tempQ: new Quaternion(),
        };

        // Initialize
        if (options.position) {
            this.setPosition(options.position);
        }
        if (options.quaternion) {
            this.quaternion.copy(options.quaternion);
        }
    }

    // === GETTERS (derived from quaternion) ===

    /** Get current position */
    getPosition() {
        if (this.sphereCenter) {
            // Spherical: position = center + up * radius
            return this._scratch.up
                .set(0, 1, 0)
                .applyQuaternion(this.quaternion)
                .multiplyScalar(this.sphereRadius)
                .add(this.sphereCenter);
        }
        return this._flatPosition.clone();
    }

    /** Get forward direction (where bird is facing) */
    getForward() {
        return this._scratch.forward
            .set(0, 0, -1)
            .applyQuaternion(this.quaternion)
            .normalize();
    }

    /** Get up direction (top of bird's head) */
    getUp() {
        return this._scratch.up
            .set(0, 1, 0)
            .applyQuaternion(this.quaternion)
            .normalize();
    }

    /** Get right direction (bird's right wing) */
    getRight() {
        return this._scratch.right
            .set(1, 0, 0)
            .applyQuaternion(this.quaternion)
            .normalize();
    }

    /** Get current velocity vector */
    getVelocity() {
        return this.getForward().multiplyScalar(this.speed);
    }

    /** Get the authoritative quaternion for rendering */
    getQuaternion() {
        return this.quaternion;
    }

    // === SETTERS ===

    /** Set position (mainly for initialization) */
    setPosition(position) {
        if (this.sphereCenter) {
            // Spherical: derive quaternion from position
            const up = position.clone().sub(this.sphereCenter).normalize();
            const forward = new this.THREE.Vector3(0, 0, -1);

            // Find rotation that takes world-up to local-up
            this._scratch.tempQ.setFromUnitVectors(
                new this.THREE.Vector3(0, 1, 0),
                up
            );
            this.quaternion.copy(this._scratch.tempQ);
        } else {
            this._flatPosition.copy(position);
        }
    }

    /** Set speed */
    setSpeed(speed) {
        this.speed = Math.max(0, speed);
    }

    // === CONTROL METHODS ===

    /**
     * Apply yaw (turn left/right)
     * @param {number} input - -1 (left) to +1 (right)
     * @param {number} deltaTime - frame time in seconds
     */
    yaw(input, deltaTime) {
        if (!Number.isFinite(input) || input === 0) return;

        // Yaw rotates around local Y axis
        const angle = -input * this.yawRate * deltaTime;
        this._scratch.axis.set(0, 1, 0);
        this._scratch.tempQ.setFromAxisAngle(this._scratch.axis, angle);
        this.quaternion.multiply(this._scratch.tempQ);
        this.quaternion.normalize();
    }

    /**
     * Apply pitch (nose up/down)
     * @param {number} input - -1 (down) to +1 (up)
     * @param {number} deltaTime - frame time in seconds
     */
    pitch(input, deltaTime) {
        if (!Number.isFinite(input) || input === 0) return;

        // Calculate new pitch angle
        const pitchDelta = input * this.pitchRate * deltaTime;
        const newPitch = this._pitch + pitchDelta;

        // Enforce pitch limits
        if (newPitch > this.maxPitch || newPitch < -this.maxPitch) {
            return;
        }
        this._pitch = newPitch;

        // Pitch rotates around local X axis
        this._scratch.axis.set(1, 0, 0);
        this._scratch.tempQ.setFromAxisAngle(this._scratch.axis, pitchDelta);
        this.quaternion.multiply(this._scratch.tempQ);
        this.quaternion.normalize();
    }

    /**
     * Main update - moves bird forward
     * @param {number} deltaTime - frame time in seconds
     */
    update(deltaTime) {
        if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

        if (this.sphereCenter) {
            // Spherical: moving forward = pitching forward on the sphere
            // This rotates around local X, which moves us along the surface
            const moveAngle = (this.speed * deltaTime) / this.sphereRadius;
            this._scratch.axis.set(1, 0, 0);
            this._scratch.tempQ.setFromAxisAngle(this._scratch.axis, -moveAngle);
            this.quaternion.premultiply(this._scratch.tempQ);
            this.quaternion.normalize();
        } else {
            // Flat: simple position += forward * speed * dt
            const forward = this.getForward();
            this._flatPosition.addScaledVector(forward, this.speed * deltaTime);
        }

        // Return pose for rendering
        return {
            position: this.getPosition(),
            quaternion: this.quaternion,
            velocity: this.getVelocity(),
        };
    }

    /**
     * Combined input + update (convenience method)
     */
    tick(input, deltaTime) {
        this.yaw(input.x, deltaTime);
        this.pitch(input.y, deltaTime);
        return this.update(deltaTime);
    }

    /**
     * Reset to initial state
     */
    reset(position, quaternion) {
        this.quaternion.set(0, 0, 0, 1);
        this._pitch = 0;
        this._flatPosition.set(0, 5, 0);

        if (position) this.setPosition(position);
        if (quaternion) this.quaternion.copy(quaternion);
    }
}
