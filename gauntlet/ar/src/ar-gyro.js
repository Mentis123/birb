/**
 * ar-gyro.js — device orientation -> camera quaternion.
 *
 * This is the whole reason "magic window" AR works without WebXR: iOS Safari
 * exposes no immersive-ar session and no ARKit, but it does report device
 * attitude, and attitude alone is enough to keep a virtual object pinned to a
 * DIRECTION in the room. What you do not get is position — walking toward the
 * screen will not make it bigger. That limitation is inherent, not a bug to
 * chase later in the tuning.
 *
 * The conversion below is the canonical Three.js DeviceOrientationControls
 * derivation and is not worth re-deriving:
 *
 *   euler(beta, alpha, -gamma, 'YXZ')     device attitude in its own frame
 *   * q1 (-90 deg about X)                the camera looks out the BACK of the phone
 *   * q0 (-screenAngle about Z)           undo the screen's own rotation
 *
 * Both trailing multiplies are load-bearing. Drop q1 and the world sits under
 * your feet; drop q0 and everything rolls 90 degrees the moment the phone
 * rotates.
 *
 * Zero-allocation: every scratch object is built once here at module-factory
 * time and mutated in place. `update()` runs every frame.
 */

export function isGyroSupported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/** iOS 13+ gates the sensor behind an explicit, gesture-bound grant. */
export function gyroNeedsPermission() {
    return Boolean(
        typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function'
    );
}

const DEG2RAD = Math.PI / 180;

/**
 * @param {object} THREE
 * @param {object} [opts]
 * @param {number} [opts.smoothing] 0..1 per 60Hz frame. Raw sensor output has a
 *   visible tremor that reads as the whole room shivering, because the eye is
 *   comparing the virtual screen against a rock-steady real background. A light
 *   slerp kills it. Too much and the screen lags the phone, which is worse.
 */
export function createARGyro(THREE, opts = {}) {
    const smoothing = opts.smoothing ?? 0.35;

    // --- pre-allocated scratch -------------------------------------------
    const _euler = new THREE.Euler();
    const _q0 = new THREE.Quaternion();
    const _q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90deg about X
    const _zee = new THREE.Vector3(0, 0, 1);
    const _target = new THREE.Quaternion();

    /** The smoothed, ready-to-copy orientation. */
    const quaternion = new THREE.Quaternion();

    let alpha = 0, beta = 0, gamma = 0;
    let screenAngle = 0;
    let hasReading = false;
    let running = false;
    let disposed = false;

    function readScreenAngle() {
        let deg = 0;
        if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
            deg = screen.orientation.angle;
        } else if (typeof window.orientation === 'number') {
            deg = window.orientation;
        }
        screenAngle = deg * DEG2RAD;
    }
    readScreenAngle();

    function onOrientation(e) {
        if (disposed) return;
        // A device with no gyro still fires the event, with nulls. Treating
        // null as 0 would silently pin the view forward and look like success.
        if (e.alpha === null && e.beta === null && e.gamma === null) return;
        alpha = (e.alpha || 0) * DEG2RAD;
        beta = (e.beta || 0) * DEG2RAD;
        gamma = (e.gamma || 0) * DEG2RAD;
        hasReading = true;
    }

    function onScreenChange() { readScreenAngle(); }

    async function requestPermission() {
        if (!gyroNeedsPermission()) return { granted: true };
        try {
            const res = await DeviceOrientationEvent.requestPermission();
            return { granted: res === 'granted', response: res };
        } catch (err) {
            // Thrown when not called from a user gesture. That is a programming
            // error on our side, so say so plainly rather than "denied".
            return {
                granted: false,
                message: 'Motion access must be requested from a tap. Reload and try again.',
                error: err,
            };
        }
    }

    function start() {
        if (running || disposed) return;
        running = true;
        window.addEventListener('deviceorientation', onOrientation, true);
        window.addEventListener('orientationchange', onScreenChange);
        if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.addEventListener) {
            screen.orientation.addEventListener('change', onScreenChange);
        }
    }

    /**
     * Recompute the smoothed orientation. Zero allocation.
     * @param {number} dt seconds
     */
    function update(dt) {
        if (!hasReading || disposed) return quaternion;

        _euler.set(beta, alpha, -gamma, 'YXZ');
        _target.setFromEuler(_euler);
        _target.multiply(_q1);
        _target.multiply(_q0.setFromAxisAngle(_zee, -screenAngle));

        let d = dt;
        if (!(d > 0)) d = 1 / 60;
        else if (d > 0.1) d = 0.1;
        // Framerate-independent form of "slerp `smoothing` per 60Hz frame".
        const a = 1 - Math.pow(1 - smoothing, d * 60);
        quaternion.slerp(_target, a);
        return quaternion;
    }

    /** Jump straight to the current attitude with no easing (first frame). */
    function snap() {
        if (!hasReading) return quaternion;
        _euler.set(beta, alpha, -gamma, 'YXZ');
        quaternion.setFromEuler(_euler);
        quaternion.multiply(_q1);
        quaternion.multiply(_q0.setFromAxisAngle(_zee, -screenAngle));
        return quaternion;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        running = false;
        window.removeEventListener('deviceorientation', onOrientation, true);
        window.removeEventListener('orientationchange', onScreenChange);
        if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.removeEventListener) {
            screen.orientation.removeEventListener('change', onScreenChange);
        }
    }

    return {
        quaternion,
        requestPermission,
        start,
        update,
        snap,
        dispose,
        get hasReading() { return hasReading; },
        get raw() { return { alpha, beta, gamma, screenAngle }; },
    };
}
