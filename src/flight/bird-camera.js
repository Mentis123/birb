/**
 * bird-camera.js
 * 
 * Simple follow camera. Stays behind bird, looks at bird.
 * Uses lerp for smoothness without complex damping systems.
 */

export const CAMERA_DEFAULTS = {
    distance: 8,       // How far behind the bird
    height: 3,         // How far above the bird
    lookAhead: 2,      // How far in front of bird to look
    smoothing: 0.1,    // 0 = instant, 1 = very slow (0.1 = snappy but smooth)
};

export class BirdCamera {
    constructor(THREE, camera, options = {}) {
        this.THREE = THREE;
        this.camera = camera;

        // Configuration
        this.distance = options.distance ?? CAMERA_DEFAULTS.distance;
        this.height = options.height ?? CAMERA_DEFAULTS.height;
        this.lookAhead = options.lookAhead ?? CAMERA_DEFAULTS.lookAhead;
        this.smoothing = options.smoothing ?? CAMERA_DEFAULTS.smoothing;

        // Spherical world support
        this.sphereCenter = options.sphereCenter
            ? options.sphereCenter.clone()
            : null;

        // Current smoothed position (starts at camera position)
        this._currentPosition = camera.position.clone();
        this._currentLookAt = new THREE.Vector3();
        this._initialized = false;

        // Scratch vectors
        this._scratch = {
            desiredPos: new THREE.Vector3(),
            desiredLookAt: new THREE.Vector3(),
            forward: new THREE.Vector3(),
            up: new THREE.Vector3(),
        };
    }

    /**
     * Update camera to follow bird
     * @param {Vector3} birdPosition
     * @param {Quaternion} birdQuaternion
     * @param {number} deltaTime
     */
    update(birdPosition, birdQuaternion, deltaTime) {
        const { Vector3 } = this.THREE;
        const s = this._scratch;

        // Get bird's forward and up directions
        s.forward.set(0, 0, -1).applyQuaternion(birdQuaternion).normalize();

        if (this.sphereCenter) {
            // Spherical: up is radial from sphere center
            s.up.copy(birdPosition).sub(this.sphereCenter).normalize();
        } else {
            // Flat: up is world Y
            s.up.set(0, 1, 0);
        }

        // Desired camera position: behind and above bird
        s.desiredPos
            .copy(birdPosition)
            .addScaledVector(s.forward, -this.distance)  // Behind
            .addScaledVector(s.up, this.height);          // Above

        // Desired look-at: slightly ahead of bird
        s.desiredLookAt
            .copy(birdPosition)
            .addScaledVector(s.forward, this.lookAhead);

        // First frame: snap to position
        if (!this._initialized) {
            this._currentPosition.copy(s.desiredPos);
            this._currentLookAt.copy(s.desiredLookAt);
            this._initialized = true;
        }

        // Smooth interpolation
        const alpha = 1 - Math.pow(this.smoothing, deltaTime * 60);
        this._currentPosition.lerp(s.desiredPos, alpha);
        this._currentLookAt.lerp(s.desiredLookAt, alpha);

        // Apply to camera
        this.camera.position.copy(this._currentPosition);
        this.camera.lookAt(this._currentLookAt);

        // For spherical worlds, align camera's up with local up
        if (this.sphereCenter) {
            this.camera.up.copy(s.up);
        }
    }

    /**
     * Snap camera to position (no smoothing)
     */
    snap(birdPosition, birdQuaternion) {
        this._initialized = false;
        this.update(birdPosition, birdQuaternion, 1);
    }

    /**
     * Configure camera parameters
     */
    configure(options) {
        if (options.distance !== undefined) this.distance = options.distance;
        if (options.height !== undefined) this.height = options.height;
        if (options.lookAhead !== undefined) this.lookAhead = options.lookAhead;
        if (options.smoothing !== undefined) this.smoothing = options.smoothing;
        if (options.sphereCenter !== undefined) {
            this.sphereCenter = options.sphereCenter?.clone() ?? null;
        }
    }
}
