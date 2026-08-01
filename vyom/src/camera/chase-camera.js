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
        dist: 11.5,        // behind the bird
        height: 3.9,       // above it, along the radial
        lookAhead: 11.0,   // aim point in front of the bird
        // Aim BELOW the bird, not level with it. A level aim puts the horizon
        // across the middle of the frame and hands the top half to empty sky;
        // dropping the aim point fills the frame with the ground the bird is
        // racing over, which is where all the readable motion is.
        lookLift: -1.1,
        posK: 6.0,
        lookK: 10.0,
        headK: 4.5,        // how fast the framing heading follows the bird
        minDist: 7.0,      // the bird may never come closer than this
        climbAim: 4.5,     // aim down this much more in a full climb
        diveAim: 2.5,      // aim up this much more in a full dive
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
        headK: 1.5,
        minDist: 14.0,
        climbAim: 0,
        diveAim: 0,
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
        headK: 3.0,
        minDist: 6.0,
        climbAim: 0,
        diveAim: 0,
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
 * @param {Function} [opts.terrainHeightAt] (nx,ny,nz) -> height <= 0. Optional
 *                                      but strongly recommended: without it the
 *                                      rig has no way to know it is underground
 * @param {number}  [opts.sphereRadius] baseline planet radius (default 100)
 * @param {number}  [opts.groundClearance] how far above the floor to hold
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
    const terrainHeightAt = opts.terrainHeightAt || null;
    const sphereRadius = opts.sphereRadius ?? 100;
    const groundClearance = opts.groundClearance ?? 2.2;

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
    const _raw = new Vector3();
    const _toCam = new Vector3();
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
        _raw.set(0, 0, -1).applyQuaternion(targetQuat);
        // Keep the pitch before flattening: the aim needs it (see below).
        const sinPitch = Math.max(-1, Math.min(1, _raw.dot(_up)));
        _raw.addScaledVector(_up, -_raw.dot(_up));
        if (_raw.lengthSq() < 1e-6) {
            _raw.set(0, 1, 0).cross(_up);
            if (_raw.lengthSq() < 1e-6) _raw.set(1, 0, 0).cross(_up);
        }
        _raw.normalize();

        // Smooth the FRAMING heading rather than using the instantaneous one.
        // Reason, found in a captured tumble frame: a knockdown spins the bird
        // at ~7 rad/s, so the anchor "behind the bird" orbits it several times
        // a second and drags the camera straight through the model — the bird
        // filled the bottom third of the lens. An averaged heading keeps the
        // rig roughly behind where the bird was going, which is also what a
        // camera operator would do. In normal flight the rate is high enough
        // that turns still whip.
        if (!seeded) {
            _fwd.copy(_raw);
        } else {
            _fwd.lerp(_raw, 1 - Math.exp(-mode.headK * (dt || 0)));
            _fwd.addScaledVector(_up, -_fwd.dot(_up));
            if (_fwd.lengthSq() < 1e-8) _fwd.copy(_raw); else _fwd.normalize();
        }
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

        // Portrait correction. A phone frame at the same pitch is over half
        // sky, so aim further down as the aspect narrows. Same correction the
        // planet probe needed — it is a property of the framing, not of one
        // subsystem. Measured on a 390x844 capture: -3.2 was too much (it
        // pushed the bird into the top third and handed the bottom third to
        // featureless near ground), -1.6 lands the horizon around 40% with the
        // bird just above it.
        const aspect = camera.aspect || 1;
        const portrait = aspect >= 1 ? 0 : Math.min(1, (1 - aspect) / 0.5);
        // Pitch compensation. Captured at the top of a boost climb: the bird
        // was 26 units up with the nose high, and the frame was 85% empty sky —
        // no ground, no horizon, nothing to judge speed or position against.
        // A chase camera has to fight the target's pitch, not inherit it: aim
        // DOWN in a climb to hold the horizon, and UP in a dive so the ground
        // does not fill the whole lens.
        const climb = sinPitch > 0 ? sinPitch : 0;
        const dive = sinPitch < 0 ? -sinPitch : 0;
        const pitchAim = -mode.climbAim * climb + mode.diveAim * dive;

        _desiredLook.copy(targetPos)
            .addScaledVector(_fwd, mode.lookAhead)
            .addScaledVector(_up, mode.lookLift + pitchAim - 1.6 * portrait);
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

            // Hard floor on how close the bird may get. The springs alone
            // cannot guarantee this: any fast heading change moves the anchor
            // faster than the camera can follow, and the shortest path between
            // the old and new anchor passes near the bird.
            _toCam.subVectors(_pos, targetPos);
            const d = _toCam.length();
            if (d < mode.minDist) {
                if (d < 1e-4) _toCam.copy(_fwd).multiplyScalar(-1).addScaledVector(_up, 0.35).normalize();
                else _toCam.multiplyScalar(1 / d);
                _pos.copy(targetPos).addScaledVector(_toCam, mode.minDist);
            }

            // Ground clearance. The rig sits BEHIND the bird, so in a canyon
            // dive the anchor is up on the rim one moment and inside the wall
            // the next; with no floor the frame cuts to the inside of the
            // terrain. Same downward-only floor the flight model uses, so the
            // camera and the bird agree about where the ground is.
            if (terrainHeightAt) {
                const cr = _pos.length();
                if (cr > 1e-3) {
                    const inv = 1 / cr;
                    const h = terrainHeightAt(_pos.x * inv, _pos.y * inv, _pos.z * inv);
                    const floor = sphereRadius + (h < 0 ? h : 0) + groundClearance;
                    if (cr < floor) _pos.multiplyScalar(floor * inv);
                }
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
            // Clear `seeded` FIRST so frame() takes the target's heading
            // outright instead of smoothing toward it from the old one — a
            // snap that inherited the previous heading would swing the camera
            // around the bird over the next second, which is the exact thing a
            // snap exists to avoid.
            seeded = false;
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
