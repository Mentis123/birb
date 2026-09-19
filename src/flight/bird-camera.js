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

        // A committed aerobatic manoeuvre asks this rig to HOLD its frame.
        // This camera stands behind the bird along the bird's own FORWARD,
        // and during a loop that forward points up, then backwards, then
        // down — so the camera swings underneath the bird and out the far
        // side, and the world reads as going backwards. Under a hold the
        // offset is taken along `heading` (the level heading the bird had
        // when the move began) instead, the stand-off is stretched by
        // `distanceMul` so a loop whose radius is smaller than the ordinary
        // stand-off stays in front of the lens, and the smoothing floor is
        // raised so the rig actually REACHES that station inside a move that
        // lasts two seconds. `weight` 0..1; at 0 all of this is inert.
        //
        // Up is already radial here (see update), which is why a barrel
        // roll needed nothing from this: the horizon holds by construction.
        this._hold = {
            weight: 0,
            distanceMul: 1,
            heading: new THREE.Vector3(0, 0, -1),
        };
    }

    /**
     * Hold a stable frame for a committed manoeuvre. `heading` is copied,
     * never retained. Weight 0 (or no argument) releases the hold.
     */
    setHold({ weight = 0, heading = null, distanceMul = 1 } = {}) {
        const h = this._hold;
        h.weight = Math.max(0, Math.min(1, Number.isFinite(weight) ? weight : 0));
        h.distanceMul = Number.isFinite(distanceMul) && distanceMul > 0 ? distanceMul : 1;
        if (heading && heading.lengthSq() > 1e-6) h.heading.copy(heading).normalize();
        return h.weight;
    }

    /** The hold as this rig actually has it, for a harness to read back. */
    getHold() {
        return { weight: this._hold.weight, distanceMul: this._hold.distanceMul, heading: this._hold.heading.clone() };
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

        // Under a hold, stand off along the HELD heading rather than the
        // bird's live forward, and further back.
        const hold = this._hold;
        let distance = this.distance;
        let height = this.height;
        if (hold.weight > 0) {
            s.forward.lerp(hold.heading, hold.weight);
            if (s.forward.lengthSq() < 1e-6) s.forward.copy(hold.heading); else s.forward.normalize();
            const stretch = 1 + (hold.distanceMul - 1) * hold.weight;
            distance *= stretch;
            height *= stretch;
        }

        // Desired camera position: behind and above bird
        s.desiredPos
            .copy(birdPosition)
            .addScaledVector(s.forward, -distance)  // Behind
            .addScaledVector(s.up, height);          // Above

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

        // Smooth interpolation. (No hold-specific floor: at smoothing 0.1
        // this already closes ~90% of the gap per 60 Hz frame, so the rig
        // reaches a held station in a few frames on its own. The lag that
        // motivated one was measured on the legacy follow rig, which is
        // parked on this path — not here.)
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
