/**
 * camera/chase-camera.js — VYOM's chase camera.
 *
 * ===========================================================================
 * THE ONE RULE: UP IS RADIAL, NEVER WORLD UP.
 * ===========================================================================
 * On a miniature planet the bird flies a great circle, so its "up" sweeps
 * through every direction in the world over one lap. A camera holding
 * `camera.up = (0,1,0)` will roll the horizon through a full 360 degrees as
 * the bird circles, which is not a stylistic choice — it is genuinely nauseating
 * and it makes the course unreadable. So the camera's up is
 * `normalize(targetPos)`, recomputed every frame. The horizon then stays level
 * everywhere on the planet.
 *
 * Everything else is about lag. A camera welded to the bird gives no sense of
 * speed, because nothing in frame moves relative to the bird. So position and
 * look-at are both spring-damped with different stiffnesses (position lags
 * more than aim), which makes hard turns swing the tail of the bird across
 * frame and makes acceleration read as the camera falling behind and catching
 * up.
 *
 * FOV kick: the field of view widens with speed. This is the cheapest and most
 * effective speed cue there is — the periphery stretches, so the same velocity
 * reads faster. It is also why this module has a dependency on outline.js:
 * `outlineShared.uUnitPerPixel` is derived from the FOV, so an un-notified FOV
 * change silently fattens every ink line in the game during a boost. Every FOV
 * write here goes through `_applyFov`, which calls `updateOutlineProjection`.
 *
 * THREE is passed in; this module imports only from core. Zero allocation per
 * frame.
 */

import { updateOutlineProjection } from '../core/outline.js';

/**
 * Per-mode framing. `posK`/`lookK` are exponential-smoothing rates in 1/s:
 * higher = stiffer. Position is deliberately looser than aim.
 */
const MODES = {
    chase: {
        dist: 15.0,        // behind the bird
        height: 4.4,       // above it, along the radial
        lookAhead: 13.0,   // aim point in front of the bird
        lookLift: 1.2,
        posK: 6.0,
        lookK: 10.0,
        fov: 60,
        fovKick: 13,       // degrees added at speed01 = 1
        fovK: 3.2,
    },
    // Slow hero orbit for the title screen and the pre-race flyby.
    orbit: {
        dist: 26.0,
        height: 10.0,
        lookAhead: 0.0,
        lookLift: 0.0,
        posK: 1.8,
        lookK: 2.6,
        fov: 52,
        fovKick: 0,
        fovK: 1.2,
        orbitRate: 0.22,   // rad/s around the bird
    },
    // Three-quarter front view for the results screen celebration.
    results: {
        dist: -9.5,        // negative = in FRONT of the bird, looking back
        height: 3.0,
        lookAhead: 0.0,
        lookLift: 0.6,
        posK: 3.0,
        lookK: 4.0,
        fov: 46,
        fovKick: 0,
        fovK: 2.0,
        sideOffset: 5.0,
    },
};

const QUALITY_SHAKE = { low: 0.65, mid: 0.85, high: 1.0 };

/**
 * @param {object} THREE
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} [opts]
 * @param {string}  [opts.quality]      'low'|'mid'|'high'
 * @param {object}  [opts.renderer]     used to read the drawing-buffer height
 *                                      and pixel ratio for outline widths
 * @param {number}  [opts.bufferHeight] explicit override if there is no renderer
 * @param {number}  [opts.pixelRatio]
 */
export function createChaseCamera(THREE, camera, opts = {}) {
    const { Vector3 } = THREE;

    const shakeScale = QUALITY_SHAKE[opts.quality] || QUALITY_SHAKE.high;
    let renderer = opts.renderer || null;
    let bufferHeight = opts.bufferHeight || 0;
    let pixelRatio = opts.pixelRatio || 1;

    let modeName = 'chase';
    let mode = MODES.chase;
    let orbitAngle = 0;
    let shakeTime = 0;
    let fov = mode.fov;
    let appliedFov = -1;

    // --- scratch ------------------------------------------------------------
    const _pos = new Vector3();        // smoothed camera position
    const _look = new Vector3();       // smoothed look-at point
    const _up = new Vector3(0, 1, 0);  // radial up at the target
    const _fwd = new Vector3();
    const _right = new Vector3();
    const _desired = new Vector3();
    const _desiredLook = new Vector3();
    const _tan = new Vector3();
    let seeded = false;

    /**
     * Write a FOV and tell the outline shader about it. Outline width is
     * derived from tan(fov/2), so a boost that widens the FOV without this call
     * visibly fattens every ink line in the frame.
     */
    function applyFov(next) {
        if (Math.abs(next - appliedFov) < 0.02) return;
        appliedFov = next;
        camera.fov = next;
        camera.updateProjectionMatrix();
        const h = renderer ? renderer.domElement.height : bufferHeight;
        const pr = renderer ? renderer.getPixelRatio() : pixelRatio;
        if (h) updateOutlineProjection(camera, h, pr);
    }

    /**
     * Build the radial-up frame at the target and the desired camera pose for
     * the current mode. Fills _up, _fwd, _desired and _desiredLook.
     */
    function frame(targetPos, targetQuat, dt) {
        _up.copy(targetPos).normalize();
        if (!(_up.lengthSq() > 0.5)) _up.set(0, 1, 0);

        // Flatten the bird's forward into the tangent plane. Using the raw
        // forward would let a steep dive drop the camera through the ground and
        // a climb point it at the sky; the chase rig wants the HEADING, with
        // pitch expressed by the look-at lift instead.
        _fwd.set(0, 0, -1).applyQuaternion(targetQuat);
        _fwd.addScaledVector(_up, -_fwd.dot(_up));
        if (_fwd.lengthSq() < 1e-6) {
            _fwd.set(0, 1, 0).cross(_up);
            if (_fwd.lengthSq() < 1e-6) _fwd.set(1, 0, 0).cross(_up);
        }
        _fwd.normalize();
        _right.crossVectors(_fwd, _up).normalize();

        if (modeName === 'orbit') {
            orbitAngle += mode.orbitRate * dt;
            const c = Math.cos(orbitAngle), s = Math.sin(orbitAngle);
            _tan.copy(_fwd).multiplyScalar(c).addScaledVector(_right, s);
            _desired.copy(targetPos)
                .addScaledVector(_tan, -mode.dist)
                .addScaledVector(_up, mode.height);
            _desiredLook.copy(targetPos).addScaledVector(_up, mode.lookLift);
            return;
        }

        _desired.copy(targetPos)
            .addScaledVector(_fwd, -mode.dist)
            .addScaledVector(_up, mode.height);
        if (mode.sideOffset) _desired.addScaledVector(_right, mode.sideOffset);

        _desiredLook.copy(targetPos)
            .addScaledVector(_fwd, mode.lookAhead)
            .addScaledVector(_up, mode.lookLift);
    }

    /** Deterministic shake — two incommensurate sines, no RNG, no allocation. */
    function shake(amount, dt) {
        if (amount <= 0.0001) return;
        shakeTime += dt;
        const a = amount * shakeScale;
        const ox = (Math.sin(shakeTime * 47.3) * 0.62 + Math.sin(shakeTime * 91.7) * 0.38) * a;
        const oy = (Math.sin(shakeTime * 38.1 + 1.7) * 0.58 + Math.sin(shakeTime * 73.9) * 0.42) * a;
        _pos.addScaledVector(_right, ox);
        _pos.addScaledVector(_up, oy);
        _look.addScaledVector(_right, ox * 0.35);
    }

    const api = {
        /**
         * @param {number} dt
         * @param {THREE.Vector3} targetPos
         * @param {THREE.Quaternion} targetQuat
         * @param {number} [speed01]     0..1 over the FULL speed envelope
         * @param {number} [shakeAmount] world units of shake
         */
        update(dt, targetPos, targetQuat, speed01 = 0, shakeAmount = 0) {
            const step = dt > 0.05 ? 0.05 : (dt > 0 ? dt : 0);
            frame(targetPos, targetQuat, step);

            if (!seeded) {
                _pos.copy(_desired);
                _look.copy(_desiredLook);
                seeded = true;
            } else {
                // Exponential smoothing: frame-rate independent, never
                // overshoots, and unlike a real spring it cannot ring after a
                // teleport.
                const kp = 1 - Math.exp(-mode.posK * step);
                const kl = 1 - Math.exp(-mode.lookK * step);
                _pos.lerp(_desired, kp);
                _look.lerp(_desiredLook, kl);
            }

            shake(shakeAmount, step);

            const targetFov = mode.fov + mode.fovKick * (speed01 < 0 ? 0 : (speed01 > 1 ? 1 : speed01));
            fov += (targetFov - fov) * (1 - Math.exp(-mode.fovK * step));
            applyFov(fov);

            camera.up.copy(_up);          // RADIAL. Never (0,1,0).
            camera.position.copy(_pos);
            camera.lookAt(_look);
        },

        /** Teleport the rig onto the target — use after a respawn or a mode cut. */
        snapToTarget(targetPos, targetQuat) {
            frame(targetPos, targetQuat, 0);
            _pos.copy(_desired);
            _look.copy(_desiredLook);
            seeded = true;
            fov = mode.fov;
            applyFov(fov);
            camera.up.copy(_up);
            camera.position.copy(_pos);
            camera.lookAt(_look);
        },

        setMode(name) {
            if (!MODES[name] || name === modeName) return;
            modeName = name;
            mode = MODES[name];
            orbitAngle = 0;
        },

        getMode() { return modeName; },

        /** Tell the rig where to read outline scale from, after a resize. */
        setRenderer(r) { renderer = r; appliedFov = -1; applyFov(fov); },
        setViewport(height, ratio) {
            bufferHeight = height;
            pixelRatio = ratio || 1;
            appliedFov = -1;
            applyFov(fov);
        },

        get fov() { return fov; },

        dispose() { renderer = null; },
    };

    return api;
}

export default createChaseCamera;
