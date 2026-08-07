/**
 * ar-camera.js — rear-camera passthrough for Birb AR.
 *
 * Ported to an ES module from the 2025 AR shooter's `AR/js/camera.js`, which
 * was a global-script class against Three r128. The API surface it proved is
 * kept; the plumbing is modernised.
 *
 * iOS notes that are load-bearing, not trivia:
 *   - getUserMedia REQUIRES a secure context. Vercel gives us that in prod, but
 *     a plain-http LAN test will fail here and nowhere else, which reads as a
 *     broken camera rather than a broken URL. `isSecure()` exists to say so.
 *   - The <video> must be muted + playsinline + autoplay or Safari refuses to
 *     start it inline and either does nothing or goes fullscreen.
 *   - `facingMode: 'environment'` is a HINT. Some devices ignore it, so the
 *     resolved track label/settings are exposed for the caller to report.
 *   - play() can still reject after a successful getUserMedia (a backgrounded
 *     tab, an interrupted gesture). That is not fatal — the loop below retries
 *     on the next visibility change.
 */

export const CAMERA_CONSTRAINTS = Object.freeze({
    // Modest resolution on purpose: the feed is a BACKGROUND. Asking for 1080p
    // costs decode bandwidth that the two render passes need, and it is being
    // displayed behind a floating screen the player is looking at, not read.
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
});

export function isCameraSupported() {
    return Boolean(
        typeof navigator !== 'undefined'
        && navigator.mediaDevices
        && navigator.mediaDevices.getUserMedia
    );
}

export function isSecure() {
    if (typeof window === 'undefined') return false;
    return window.isSecureContext
        || location.protocol === 'https:'
        || location.hostname === 'localhost'
        || location.hostname === '127.0.0.1';
}

/**
 * @param {HTMLVideoElement} videoEl
 * @returns {{ start():Promise<object>, stop():void, retryPlay():Promise<void>,
 *            get active():boolean, get settings():object|null }}
 */
export function createARCamera(videoEl) {
    let stream = null;
    let disposed = false;

    async function start() {
        if (disposed) return { success: false, reason: 'disposed' };
        if (!isCameraSupported()) {
            return { success: false, reason: 'unsupported', message: 'This browser has no camera API.' };
        }
        if (!isSecure()) {
            return { success: false, reason: 'insecure', message: 'Camera needs HTTPS.' };
        }

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: 'environment' }, ...CAMERA_CONSTRAINTS },
            });
        } catch (err) {
            // NotAllowedError is a denied prompt; NotFoundError is no camera.
            // They need different copy, so pass the name through rather than
            // flattening everything into "camera failed".
            return { success: false, reason: err && err.name ? err.name : 'error', message: describe(err) };
        }

        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('muted', '');

        try {
            await videoEl.play();
        } catch (_) {
            // Non-fatal: the stream is live and the element will start on the
            // next gesture or visibility change. retryPlay() is the hook.
        }

        return { success: true, settings: settingsOf() };
    }

    function settingsOf() {
        if (!stream) return null;
        const track = stream.getVideoTracks()[0];
        if (!track) return null;
        const s = typeof track.getSettings === 'function' ? track.getSettings() : {};
        return { label: track.label || '', width: s.width, height: s.height, facingMode: s.facingMode };
    }

    async function retryPlay() {
        if (!stream || disposed) return;
        try { await videoEl.play(); } catch (_) { /* still blocked; try again later */ }
    }

    function stop() {
        disposed = true;
        if (stream) {
            stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) { /* already ended */ } });
            stream = null;
        }
        try { videoEl.srcObject = null; } catch (_) { /* ignore */ }
    }

    return {
        start,
        stop,
        retryPlay,
        get active() { return Boolean(stream); },
        get settings() { return settingsOf(); },
    };
}

function describe(err) {
    const name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'Camera permission was denied. Allow it in Settings and reload.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'No camera found on this device.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'The camera is already in use by another app.';
    }
    return (err && err.message) ? err.message : 'The camera could not be started.';
}
