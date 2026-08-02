/**
 * view/orbit.js — phone-first orbit / pinch camera.
 *
 * Hand-rolled rather than OrbitControls, for the same reason this artefact has
 * its own joystick and its own QR encoder: OrbitControls lives in Three's
 * `examples/` and this ships nothing but the core build. It is also about sixty
 * lines when you only need the three gestures that matter.
 *
 * Gestures: one finger orbits, two fingers pinch to dolly AND drag to pan,
 * double-tap reframes. On a mouse: drag orbits, wheel dollies, and either the
 * right button, the middle button or shift-drag pans.
 *
 * Pinch and pan are read from the SAME two-finger gesture rather than being
 * separate modes — the pinch from the change in finger separation, the pan from
 * the movement of their midpoint. Nobody spreads two fingers without also
 * drifting them, so a mode switch here feels like the app fighting you.
 *
 * Three things worth knowing:
 *
 *   - PITCH IS CLAMPED just above the ground plane. There is nothing modelled
 *     under the base, so letting the camera go below it shows the inside of the
 *     hem and ends the illusion instantly.
 *   - PAN IS CLAMPED to a box around the group, because a study you can lose
 *     off the edge of the screen is a study with a bug in it. Double-tap
 *     recentres, and that is also the way back if you do get lost.
 *   - THE CAMERA HAS MOMENTUM and the scene only renders while something is
 *     moving. A static sculpture at a locked 60fps is a phone getting warm for
 *     nothing; this idles at zero draw calls until you touch it.
 */

const DEG = Math.PI / 180;

/**
 * Screen-right and screen-up as world vectors, for a camera at `yaw`/`pitch`
 * looking at its target.
 *
 * Pure, and exported, because this is the one piece of the file with real maths
 * in it and a sign error here is invisible in code review and obvious only as
 * "panning goes the wrong way when you orbit round the back".
 *
 * @returns {{rx,ry,rz, ux,uy,uz}} unit right and up vectors
 */
export function panBasis(yaw, pitch) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    return {
        rx: cy, ry: 0, rz: -sy,
        ux: -sy * sp, uy: cp, uz: -cy * sp,
    };
}

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
    /** How far the orbit point may be panned from centre, in metres. */
    panRadius: 2.4,
    minTargetY: 0.15,
    maxTargetY: 3.10,
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
    // The point the camera orbits, which panning moves.
    let cx = 0, cy = cfg.targetY, cz = 0;
    let tcx = cx, tcy = cy, tcz = cz;

    let idle = 0;
    let dirty = true;

    // Pointer bookkeeping. Tracked by id so a second finger landing does not
    // teleport the orbit — the classic bug when you switch from drag to pinch.
    const active = new Map();
    let pinchStart = 0;
    let pinchDistance = 0;
    let midX = 0, midY = 0;          // previous two-finger midpoint, for pan
    let lastTapAt = 0;
    let mousePan = false;
    // Tap detection state. A gesture is everything between "first finger down"
    // and "last finger up", and only a gesture that was ONE finger, brief, and
    // barely moved counts as a tap.
    let gestureFingers = 0;
    let downAt = 0, downX = 0, downY = 0, moved = 0;

    function markMoved() { idle = 0; dirty = true; }

    function pointerPos(e) { return { x: e.clientX, y: e.clientY }; }

    /** Seed the pinch scale and the pan midpoint from the two live pointers. */
    function seedTwoFinger() {
        const [a, b] = [...active.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        pinchDistance = tDistance;
        midX = (a.x + b.x) * 0.5;
        midY = (a.y + b.y) * 0.5;
    }

    /**
     * Move the orbit point by a screen-space drag, in CSS pixels.
     *
     * The scale factor converts pixels to metres at the target's depth, so the
     * sculpture tracks the finger regardless of how far out you are zoomed —
     * a fixed metres-per-pixel makes panning glacial up close and uncontrollable
     * from across the plaza.
     */
    function panByPixels(dx, dy) {
        const h = domElement.clientHeight || 800;
        const fov = (camera.fov || 40) * DEG;
        const perPixel = (2 * Math.tan(fov * 0.5) * distance) / h;
        const b = panBasis(yaw, pitch);
        // Negated: the sculpture should follow the finger, so the point the
        // camera looks at moves the other way.
        tcx = clamp(tcx - (dx * b.rx - dy * b.ux) * perPixel, -cfg.panRadius, cfg.panRadius);
        tcy = clamp(tcy - (dx * b.ry - dy * b.uy) * perPixel, cfg.minTargetY, cfg.maxTargetY);
        tcz = clamp(tcz - (dx * b.rz - dy * b.uz) * perPixel, -cfg.panRadius, cfg.panRadius);
    }

    function onDown(e) {
        // Guarded: capture throws NotFoundError for a pointer id the browser
        // does not own, which includes every synthetic event a test harness
        // dispatches. An uncaught throw here would eat the gesture.
        try { domElement.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        active.set(e.pointerId, pointerPos(e));
        if (active.size === 1) {
            gestureFingers = 1;
            downAt = performance.now(); downX = e.clientX; downY = e.clientY; moved = 0;
            // Mouse only: right, middle, or shift-left pans instead of orbiting.
            if (e.pointerType === 'mouse') {
                mousePan = e.button === 1 || e.button === 2 || e.shiftKey;
            }
        }
        if (active.size > gestureFingers) gestureFingers = active.size;
        if (active.size === 2) seedTwoFinger();
        markMoved();
    }

    function onMove(e) {
        if (!active.has(e.pointerId)) return;
        const prev = active.get(e.pointerId);
        const now = pointerPos(e);
        active.set(e.pointerId, now);

        moved = Math.max(moved, Math.hypot(now.x - downX, now.y - downY));

        if (active.size === 1) {
            if (mousePan) {
                panByPixels(now.x - prev.x, now.y - prev.y);
            } else {
                tYaw -= (now.x - prev.x) * cfg.dragSpeed;
                tPitch += (now.y - prev.y) * cfg.dragSpeed;
                if (tPitch < cfg.minPitch) tPitch = cfg.minPitch;
                if (tPitch > cfg.maxPitch) tPitch = cfg.maxPitch;
            }
        } else if (active.size === 2 && pinchStart > 0) {
            const [a, b] = [...active.values()];
            // Dolly from the change in separation...
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 1) {
                tDistance = clamp(pinchDistance * (pinchStart / d),
                    cfg.minDistance, cfg.maxDistance);
            }
            // ...and pan from the movement of the midpoint, in the same gesture.
            const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
            panByPixels(mx - midX, my - midY);
            midX = mx; midY = my;
        }
        markMoved();
    }

    function onUp(e) {
        active.delete(e.pointerId);
        if (active.size < 2) pinchStart = 0;
        // Lifting one of two fingers must re-seed, or the survivor's next move
        // is measured against a midpoint that no longer exists.
        if (active.size === 2) seedTwoFinger();

        // Double tap anywhere resets the framing — but ONLY for a gesture that
        // was a single brief stationary touch. Counting every pointerup made
        // the end of a pinch look like a double tap: two fingers lift within a
        // few milliseconds of each other, so letting go of a zoom snapped the
        // whole view back to its default. That is also why this waits for the
        // LAST finger — a two-finger gesture must not leave a half-tap primed.
        if (active.size === 0) {
            const t = performance.now();
            const wasTap = e.type === 'pointerup' && gestureFingers === 1
                && (t - downAt) < 300 && moved < 12;
            if (wasTap) {
                if (t - lastTapAt < 320) { reset(); lastTapAt = 0; } else lastTapAt = t;
            } else {
                lastTapAt = 0;
            }
            gestureFingers = 0;
            mousePan = false;
        }
        markMoved();
    }

    function onWheel(e) {
        e.preventDefault();
        // A trackpad pinch arrives as ctrl+wheel; two-finger scroll arrives as
        // a plain wheel with both axes. Treat the former as dolly and the
        // latter as pan, which is what every other 3D viewer on a Mac does.
        if (!e.ctrlKey && (Math.abs(e.deltaX) > 0 || e.shiftKey)) {
            panByPixels(-e.deltaX, -e.deltaY);
        } else {
            tDistance = clamp(tDistance * (1 + Math.sign(e.deltaY) * 0.12),
                cfg.minDistance, cfg.maxDistance);
        }
        markMoved();
    }

    function onContextMenu(e) { e.preventDefault(); }

    domElement.addEventListener('pointerdown', onDown);
    domElement.addEventListener('pointermove', onMove);
    domElement.addEventListener('pointerup', onUp);
    domElement.addEventListener('pointercancel', onUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('contextmenu', onContextMenu);

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function reset() {
        tYaw = cfg.yaw;
        tPitch = cfg.pitch;
        tDistance = cfg.distance;
        tcx = 0; tcy = cfg.targetY; tcz = 0;
        markMoved();
    }

    /** Jump straight to an angle — used by the screenshot harness. */
    function setView(y, p, d, snap = true) {
        tYaw = y; tPitch = p; tDistance = clamp(d, cfg.minDistance, cfg.maxDistance);
        if (snap) { yaw = tYaw; pitch = tPitch; distance = tDistance; }
        dirty = true;
    }

    /** Jump the orbit point — used by the screenshot harness. */
    function setTarget(x, y, z, snap = true) {
        tcx = clamp(x, -cfg.panRadius, cfg.panRadius);
        tcy = clamp(y, cfg.minTargetY, cfg.maxTargetY);
        tcz = clamp(z, -cfg.panRadius, cfg.panRadius);
        if (snap) { cx = tcx; cy = tcy; cz = tcz; }
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
        cx += (tcx - cx) * k;
        cy += (tcy - cy) * k;
        cz += (tcz - cz) * k;

        const moving = Math.abs(tYaw - yaw) > 1e-5
            || Math.abs(tPitch - pitch) > 1e-5
            || Math.abs(tDistance - distance) > 1e-4
            || Math.abs(tcx - cx) > 1e-4
            || Math.abs(tcy - cy) > 1e-4
            || Math.abs(tcz - cz) > 1e-4;

        const cp = Math.cos(pitch);
        camera.position.set(
            cx + Math.sin(yaw) * cp * distance,
            cy + Math.sin(pitch) * distance,
            cz + Math.cos(yaw) * cp * distance
        );
        camera.lookAt(cx, cy, cz);

        const wasDirty = dirty;
        if (!moving) dirty = false;
        return wasDirty || moving;
    }

    return {
        update,
        reset,
        setView,
        setTarget,
        invalidate: markMoved,
        get yaw() { return yaw; },
        get pitch() { return pitch; },
        get distance() { return distance; },
        get target() { return { x: cx, y: cy, z: cz }; },
        get targetY() { return cy; },
        set targetY(v) { tcy = cy = clamp(v, cfg.minTargetY, cfg.maxTargetY); dirty = true; },
        dispose() {
            domElement.removeEventListener('pointerdown', onDown);
            domElement.removeEventListener('pointermove', onMove);
            domElement.removeEventListener('pointerup', onUp);
            domElement.removeEventListener('pointercancel', onUp);
            domElement.removeEventListener('wheel', onWheel);
            domElement.removeEventListener('contextmenu', onContextMenu);
        },
    };
}

export default createOrbit;
