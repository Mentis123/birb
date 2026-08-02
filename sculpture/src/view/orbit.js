/**
 * view/orbit.js — phone-first orbit / pinch camera.
 *
 * Hand-rolled rather than OrbitControls, for the same reason this artefact has
 * its own joystick and its own QR encoder: OrbitControls lives in Three's
 * `examples/` and this ships nothing but the core build. It is also about sixty
 * lines when you only need the three gestures that matter.
 *
 * Gestures: one finger orbits, two pinch to dolly, double-tap reframes.
 *
 * Two things worth knowing:
 *
 *   - PITCH IS CLAMPED just above the ground plane. There is nothing modelled
 *     under the base, so letting the camera go below it shows the inside of the
 *     hem and ends the illusion instantly.
 *   - THE CAMERA HAS MOMENTUM and the scene only renders while something is
 *     moving. A static sculpture at a locked 60fps is a phone getting warm for
 *     nothing; this idles at zero draw calls until you touch it.
 */

const DEG = Math.PI / 180;

export const ORBIT_DEFAULTS = {
    /** Radians. 0 looks along +Z at the group's front. */
    yaw: 0,
    pitch: 6 * DEG,
    distance: 6.4,
    minDistance: 2.05,
    maxDistance: 13.0,
    minPitch: -4 * DEG,
    maxPitch: 62 * DEG,
    /** Height of the point the camera orbits, in metres. */
    targetY: 1.28,
    damping: 0.115,
    dragSpeed: 0.0072,
    /** Idle spin, radians/second, after `idleDelay` untouched. */
    idleSpin: 0.085,
    idleDelay: 9.0,
};

export function createOrbit(camera, domElement, opts = {}) {
    const cfg = Object.assign({}, ORBIT_DEFAULTS, opts);

    let yaw = cfg.yaw, pitch = cfg.pitch, distance = cfg.distance;
    let tYaw = yaw, tPitch = pitch, tDistance = distance;
    let targetY = cfg.targetY;

    let idle = 0;
    let dirty = true;

    // Pointer bookkeeping. Tracked by id so a second finger landing does not
    // teleport the orbit — the classic bug when you switch from drag to pinch.
    const active = new Map();
    let pinchStart = 0;
    let pinchDistance = 0;
    let lastTapAt = 0;

    function markMoved() { idle = 0; dirty = true; }

    function pointerPos(e) { return { x: e.clientX, y: e.clientY }; }

    function onDown(e) {
        domElement.setPointerCapture && domElement.setPointerCapture(e.pointerId);
        active.set(e.pointerId, pointerPos(e));
        if (active.size === 2) {
            const [a, b] = [...active.values()];
            pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
            pinchDistance = tDistance;
        }
        markMoved();
    }

    function onMove(e) {
        if (!active.has(e.pointerId)) return;
        const prev = active.get(e.pointerId);
        const now = pointerPos(e);
        active.set(e.pointerId, now);

        if (active.size === 1) {
            tYaw -= (now.x - prev.x) * cfg.dragSpeed;
            tPitch += (now.y - prev.y) * cfg.dragSpeed;
            if (tPitch < cfg.minPitch) tPitch = cfg.minPitch;
            if (tPitch > cfg.maxPitch) tPitch = cfg.maxPitch;
        } else if (active.size === 2 && pinchStart > 0) {
            const [a, b] = [...active.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 1) {
                tDistance = clamp(pinchDistance * (pinchStart / d),
                    cfg.minDistance, cfg.maxDistance);
            }
        }
        markMoved();
    }

    function onUp(e) {
        active.delete(e.pointerId);
        if (active.size < 2) pinchStart = 0;
        // Double tap anywhere resets the framing.
        if (e.type === 'pointerup') {
            const t = performance.now();
            if (t - lastTapAt < 320) { reset(); lastTapAt = 0; } else lastTapAt = t;
        }
        markMoved();
    }

    function onWheel(e) {
        e.preventDefault();
        tDistance = clamp(tDistance * (1 + Math.sign(e.deltaY) * 0.12),
            cfg.minDistance, cfg.maxDistance);
        markMoved();
    }

    domElement.addEventListener('pointerdown', onDown);
    domElement.addEventListener('pointermove', onMove);
    domElement.addEventListener('pointerup', onUp);
    domElement.addEventListener('pointercancel', onUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function reset() {
        tYaw = cfg.yaw;
        tPitch = cfg.pitch;
        tDistance = cfg.distance;
        markMoved();
    }

    /** Jump straight to an angle — used by the screenshot harness. */
    function setView(y, p, d, snap = true) {
        tYaw = y; tPitch = p; tDistance = clamp(d, cfg.minDistance, cfg.maxDistance);
        if (snap) { yaw = tYaw; pitch = tPitch; distance = tDistance; }
        dirty = true;
    }

    /**
     * Advance and write the camera. Returns true if anything moved, so the
     * caller can skip the render entirely on a still frame.
     */
    function update(dt) {
        if (active.size === 0) {
            idle += dt;
            if (idle > cfg.idleDelay) { tYaw -= cfg.idleSpin * dt; dirty = true; }
        }

        const k = 1 - Math.pow(1 - cfg.damping, dt * 60);
        yaw += (tYaw - yaw) * k;
        pitch += (tPitch - pitch) * k;
        distance += (tDistance - distance) * k;

        const moving = Math.abs(tYaw - yaw) > 1e-5
            || Math.abs(tPitch - pitch) > 1e-5
            || Math.abs(tDistance - distance) > 1e-4;

        const cp = Math.cos(pitch);
        camera.position.set(
            Math.sin(yaw) * cp * distance,
            targetY + Math.sin(pitch) * distance,
            Math.cos(yaw) * cp * distance
        );
        camera.lookAt(0, targetY, 0);

        const wasDirty = dirty;
        if (!moving) dirty = false;
        return wasDirty || moving;
    }

    return {
        update,
        reset,
        setView,
        invalidate: markMoved,
        get yaw() { return yaw; },
        get pitch() { return pitch; },
        get distance() { return distance; },
        set targetY(v) { targetY = v; dirty = true; },
        dispose() {
            domElement.removeEventListener('pointerdown', onDown);
            domElement.removeEventListener('pointermove', onMove);
            domElement.removeEventListener('pointerup', onUp);
            domElement.removeEventListener('pointercancel', onUp);
            domElement.removeEventListener('wheel', onWheel);
        },
    };
}

export default createOrbit;
