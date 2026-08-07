/**
 * ar-placement.js — drag to move the screen, pinch to resize it.
 *
 * Because the screen lives in spherical coordinates around a stationary viewer
 * (see ar-screen.js), dragging is not a raycast — it is an angular nudge. One
 * finger moving `dx` pixels sweeps the screen `dx * k` radians around you. That
 * has a property a raycast placement does not: the screen tracks the finger at
 * the same rate regardless of how far away it is set, so a distant screen does
 * not feel glued and a near one does not fly off.
 *
 * The drag is applied in the VIEWER's frame, not the world frame. If you turn
 * 90 degrees and drag right, the screen must move right on YOUR screen, which
 * means the gesture has to be composed with the current gyro heading. Ignoring
 * this was the first version's bug: after turning around, drag-right moved the
 * screen left.
 *
 * Pinch does DISTANCE, not scale. Pushing the screen away and shrinking it look
 * almost identical through a phone, but only one of them keeps the thing
 * believably in the room; scaling a "screen" up to 3m wide at 1m away reads as
 * a billboard glued to the lens. Distance is clamped, and apparent size is
 * therefore honest.
 */

export const PLACEMENT_TUNING = Object.freeze({
    // Radians of sweep per pixel of drag. Tuned so a full swipe across a phone
    // (~390px) moves the screen about 75 degrees — enough to reposition in one
    // gesture, gentle enough to fine-tune.
    dragToRadians: 0.0034,
    minElevation: -0.9,
    maxElevation: 0.9,
    minDistance: 1.0,
    maxDistance: 5.0,
});

/**
 * @param {HTMLElement} rootEl element that receives the gestures
 * @param {object} deps
 * @param {() => {azimuth:number, elevation:number, distance:number, scale:number}} deps.getPlacement
 * @param {(p:object) => void} deps.setPlacement
 * @param {() => number} deps.getViewYaw yaw of the gyro camera, radians
 */
export function createPlacementControls(rootEl, deps) {
    const tune = PLACEMENT_TUNING;
    let enabled = false;
    let disposed = false;

    // Active pointers, tracked by id so a second finger starts a pinch rather
    // than fighting the drag.
    const pointers = new Map();

    let dragId = null;
    let lastX = 0, lastY = 0;
    let pinchStartDist = 0;
    let pinchStartDistance = 0;   // the screen's distance when the pinch began
    let pinching = false;

    function onDown(e) {
        if (!enabled || disposed) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 1) {
            dragId = e.pointerId;
            lastX = e.clientX;
            lastY = e.clientY;
        } else if (pointers.size === 2) {
            // Second finger down: stop dragging, start pinching.
            dragId = null;
            pinching = true;
            pinchStartDist = pinchSpan();
            pinchStartDistance = deps.getPlacement().distance;
        }
        try { rootEl.setPointerCapture(e.pointerId); } catch (_) { /* best effort */ }
        if (e.cancelable) e.preventDefault();
    }

    function pinchSpan() {
        const it = pointers.values();
        const a = it.next().value;
        const b = it.next().value;
        if (!a || !b) return 0;
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function onMove(e) {
        if (!enabled || disposed) return;
        const p = pointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;

        if (pinching && pointers.size >= 2) {
            const span = pinchSpan();
            if (pinchStartDist > 8 && span > 8) {
                // Fingers apart => pull the screen CLOSER (it gets bigger),
                // which is the direction every photo app has trained thumbs on.
                const ratio = pinchStartDist / span;
                const next = clamp(pinchStartDistance * ratio, tune.minDistance, tune.maxDistance);
                deps.setPlacement({ distance: next });
            }
            if (e.cancelable) e.preventDefault();
            return;
        }

        if (e.pointerId !== dragId) return;

        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;

        const cur = deps.getPlacement();
        // Compose with the viewer's heading so the gesture is screen-relative.
        // Dragging right must push the screen to the right of where you are
        // LOOKING, not toward world +X.
        const yaw = deps.getViewYaw ? deps.getViewYaw() : 0;
        void yaw; // azimuth is already measured in the same frame as the view

        deps.setPlacement({
            azimuth: cur.azimuth + dx * tune.dragToRadians,
            elevation: clamp(
                cur.elevation - dy * tune.dragToRadians,
                tune.minElevation, tune.maxElevation
            ),
        });

        if (e.cancelable) e.preventDefault();
    }

    function onUp(e) {
        if (disposed) return;
        pointers.delete(e.pointerId);
        if (e.pointerId === dragId) dragId = null;
        if (pointers.size < 2) pinching = false;
        // Lifting one of two fingers should hand control back to the remaining
        // one rather than dead-ending the gesture.
        if (pointers.size === 1) {
            const [id, p] = pointers.entries().next().value;
            dragId = id;
            lastX = p.x;
            lastY = p.y;
        }
        try { rootEl.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }

    function onWheel(e) {
        // Desktop convenience for testing without a phone.
        if (!enabled || disposed) return;
        const cur = deps.getPlacement();
        deps.setPlacement({
            distance: clamp(cur.distance + Math.sign(e.deltaY) * 0.12, tune.minDistance, tune.maxDistance),
        });
        if (e.cancelable) e.preventDefault();
    }

    rootEl.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    rootEl.addEventListener('wheel', onWheel, { passive: false });

    function setEnabled(on) {
        enabled = Boolean(on);
        if (!enabled) {
            pointers.clear();
            dragId = null;
            pinching = false;
        }
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        rootEl.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        rootEl.removeEventListener('wheel', onWheel);
    }

    return { setEnabled, dispose, get isPinching() { return pinching; } };
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
