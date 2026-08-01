/**
 * touch.js — VYOM's own virtual joystick. No nipplejs, no dependencies.
 *
 * Design:
 *   - LEFT half of the screen is the stick. It is thumb-anchored: the base
 *     appears wherever the thumb lands (clamped so it never hangs off the
 *     edge), so there is no "find the stick" moment and it works for any hand
 *     size or phone. The base and knob are drawn in the same cel language as
 *     the HUD — cream sticker, 3px ink border, hard ink drop shadow.
 *   - RIGHT half is the boost tap zone, with a cel BOOST pill that lights gold
 *     while held and a ripple at the touch point.
 *   - MULTI-TOUCH IS THE WHOLE POINT. Stick and boost are tracked by separate
 *     pointerIds, so holding boost with the right thumb while steering with
 *     the left works, and lifting either one leaves the other untouched. Move
 *     and up/cancel are bound on `window` rather than relying on pointer
 *     capture, because a captured pointer that is lost during a scroll-cancel
 *     on iOS never delivers its pointerup to the element.
 *   - Keyboard (WASD/arrows, space) is a desktop-testing convenience and only
 *     drives the stick while no touch owns it.
 *
 * Shaping (deadzone -> expo -> smoothing) happens in `update(dt)`, on the
 * MAGNITUDE rather than per-axis, so a diagonal push is not shaped differently
 * from a cardinal one and the stick's direction is never bent.
 *
 * `value` is mutated in place and never replaced — callers are expected to
 * hold a reference to it for the lifetime of the run.
 *
 * Axis convention: `x` positive = right, `y` positive = thumb pushed UP the
 * screen = nose up. That matches flight.js's pitch sign.
 */

import { CSS } from '/vyom/src/core/palette.js';

export const INPUT_TUNING = {
    deadzone: 0.14,
    expo: 0.3,
    smoothing: 0.28,     // per 60Hz frame; made framerate-independent in update()
    radius: 54,          // px of thumb travel for full deflection
    edgeMargin: 74,      // keeps the base fully on-screen
};

const STYLE_ID = 'vyom-input-style';

function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
.vyom-input {
  position: absolute; inset: 0; z-index: 8;
  touch-action: none; -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
  font-family: ui-rounded, "Arial Rounded MT Bold", "Nunito", "Trebuchet MS", "DejaVu Sans", system-ui, sans-serif;
  overflow: hidden;
}
.vyom-input.is-hidden { display: none; }

/* --- stick ------------------------------------------------------------- */
.vi-stick {
  position: absolute; left: 0; top: 0;
  width: ${INPUT_TUNING.radius * 2}px; height: ${INPUT_TUNING.radius * 2}px;
  margin-left: ${-INPUT_TUNING.radius}px; margin-top: ${-INPUT_TUNING.radius}px;
  opacity: 0; transform: translate3d(-999px, -999px, 0) scale(0.82);
  transition: opacity 120ms ease-out, transform 120ms ease-out;
  will-change: transform, opacity;
}
.vi-stick.is-active { opacity: 1; }
.vi-stick.is-hint { opacity: 0.42; }
.vi-stick svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }

.vi-knob {
  position: absolute; left: 50%; top: 50%;
  width: 62px; height: 62px; margin-left: -31px; margin-top: -31px;
  will-change: transform;
}
.vi-knob svg { position: absolute; inset: 0; width: 100%; height: 100%; }

/* --- boost ------------------------------------------------------------- */
.vi-boost {
  position: absolute; right: 22px; bottom: 34px;
  padding: 12px 20px 14px;
  border: 3px solid ${CSS.ink}; border-radius: 999px;
  background: ${CSS.uiCream};
  box-shadow: 0 5px 0 0 ${CSS.ink}, 0 12px 22px rgba(4, 10, 22, 0.4);
  color: ${CSS.ink}; font-weight: 900; letter-spacing: 0.14em; font-size: 15px;
  display: flex; align-items: center; gap: 8px;
  transition: transform 70ms ease-out, background-color 70ms ease-out, box-shadow 70ms ease-out;
}
.vi-boost::after {
  content: ''; position: absolute; inset: 3px 3px auto; height: 42%;
  border-radius: 999px 999px 40% 40%;
  background: rgba(255,255,255,0.62); pointer-events: none;
}
.vi-boost span { position: relative; z-index: 1; }
.vi-boost .vi-chev { font-size: 17px; line-height: 1; }
.vi-boost.is-on {
  background: ${CSS.uiGold};
  transform: translateY(4px);
  box-shadow: 0 1px 0 0 ${CSS.ink}, 0 6px 14px rgba(4, 10, 22, 0.4);
}

.vi-ripple {
  position: absolute; left: 0; top: 0; width: 26px; height: 26px;
  margin-left: -13px; margin-top: -13px; border-radius: 50%;
  border: 3px solid ${CSS.uiCyan}; opacity: 0;
  transform: translate3d(-999px, -999px, 0);
  pointer-events: none;
}
.vi-ripple.is-go { animation: viRipple 520ms ease-out 1; }
@keyframes viRipple {
  0%   { opacity: 0.95; scale: 0.4; }
  100% { opacity: 0;    scale: 3.6; }
}
@media (prefers-reduced-motion: reduce) {
  .vi-ripple.is-go { animation-duration: 1ms; }
}
`;
    document.head.appendChild(el);
}

/** Cel base ring: cream disc, ink border, ink tick marks, gloss. */
function baseSvg() {
    let ticks = '';
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const major = i % 2 === 0;
        const r0 = major ? 34 : 37, r1 = 43;
        ticks += `<line x1="${(50 + Math.cos(a) * r0).toFixed(2)}" y1="${(50 + Math.sin(a) * r0).toFixed(2)}"`
            + ` x2="${(50 + Math.cos(a) * r1).toFixed(2)}" y2="${(50 + Math.sin(a) * r1).toFixed(2)}"`
            + ` stroke="${CSS.ink}" stroke-width="${major ? 3.2 : 2}" stroke-linecap="round" opacity="${major ? 0.85 : 0.4}"/>`;
    }
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="rgba(15,28,51,0.30)" stroke="${CSS.ink}" stroke-width="4"/>
  <circle cx="50" cy="50" r="38" fill="none" stroke="${CSS.uiCream}" stroke-width="2.4" opacity="0.55"/>
  <circle cx="50" cy="50" r="17" fill="none" stroke="${CSS.uiCream}" stroke-width="2" opacity="0.3"/>
  ${ticks}
</svg>`;
}

/** Cel knob: cyan sticker with ink border and a hard gloss crescent. */
function knobSvg() {
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="57" r="42" fill="${CSS.ink}" opacity="0.55"/>
  <circle cx="50" cy="50" r="42" fill="${CSS.uiCyan}" stroke="${CSS.ink}" stroke-width="6"/>
  <path d="M22 40 A34 34 0 0 1 74 24 A44 44 0 0 0 22 40 Z" fill="${CSS.uiCream}" opacity="0.85"/>
  <circle cx="50" cy="50" r="11" fill="${CSS.uiCream}" stroke="${CSS.ink}" stroke-width="4"/>
</svg>`;
}

/**
 * @param {HTMLElement} rootEl  element the layer is appended to (usually the game root)
 * @param {object} [opts]
 * @param {(down:boolean)=>void} [opts.onBoost] fired on the press edge (true) and release (false)
 */
export function createInput(rootEl, opts = {}) {
    const onBoost = typeof opts.onBoost === 'function' ? opts.onBoost : null;
    const tune = INPUT_TUNING;

    // The caller-owned value object. Mutated in place, never replaced.
    const value = { x: 0, y: 0, boost: false };

    let disposed = false;
    let visible = true;
    let everTouched = false;

    // --- DOM ---------------------------------------------------------------
    ensureStyle();
    const layer = document.createElement('div');
    layer.className = 'vyom-input';

    const stick = document.createElement('div');
    stick.className = 'vi-stick';
    stick.innerHTML = baseSvg();
    const knob = document.createElement('div');
    knob.className = 'vi-knob';
    knob.innerHTML = knobSvg();
    stick.appendChild(knob);

    const boostPill = document.createElement('div');
    boostPill.className = 'vi-boost';
    boostPill.innerHTML = '<span class="vi-chev">»</span><span>BOOST</span>';

    const ripple = document.createElement('div');
    ripple.className = 'vi-ripple';

    layer.appendChild(stick);
    layer.appendChild(boostPill);
    layer.appendChild(ripple);
    (rootEl || document.body).appendChild(layer);

    // --- state (all pre-allocated; update() touches numbers only) ----------
    let stickId = null, boostId = null;
    let originX = 0, originY = 0;
    let rawX = 0, rawY = 0;            // unshaped stick deflection, -1..1
    let keyX = 0, keyY = 0, keyBoost = false;
    let boostHeld = false;
    let knobX = 0, knobY = 0;
    let rectX = 0, rectY = 0, rectW = 1, rectH = 1;
    const keys = { up: false, down: false, left: false, right: false };

    function readRect() {
        const r = layer.getBoundingClientRect();
        rectX = r.left; rectY = r.top;
        rectW = r.width || 1; rectH = r.height || 1;
    }
    readRect();

    function placeHint() {
        // A dim ghost stick until the player's first touch, so the control is
        // discoverable without a tutorial card.
        if (everTouched || stickId !== null) return;
        const x = Math.min(rectW * 0.24, 132);
        const y = rectH - 148;
        stick.style.transform = `translate3d(${x}px, ${y}px, 0) scale(0.82)`;
        stick.classList.add('is-hint');
    }
    placeHint();

    function showStick(x, y) {
        stick.classList.remove('is-hint');
        stick.classList.add('is-active');
        stick.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1)`;
    }

    function hideStick() {
        stick.classList.remove('is-active');
        knob.style.transform = 'translate3d(0px, 0px, 0)';
        knobX = knobY = 0;
        placeHint();
    }

    function setKnob(dx, dy) {
        if (dx === knobX && dy === knobY) return;
        knobX = dx; knobY = dy;
        knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    }

    function setBoost(down, px, py) {
        if (boostHeld === down) return;
        boostHeld = down;
        boostPill.classList.toggle('is-on', down);
        if (down && px !== undefined) {
            ripple.style.transform = `translate3d(${px}px, ${py}px, 0)`;
            ripple.classList.remove('is-go');
            // Force a reflow so the animation restarts on a repeat tap.
            void ripple.offsetWidth;
            ripple.classList.add('is-go');
        }
        if (onBoost) onBoost(down);
    }

    // --- pointer handling --------------------------------------------------

    function onPointerDown(e) {
        if (!visible || disposed) return;
        readRect();
        const lx = e.clientX - rectX;
        const ly = e.clientY - rectY;
        if (lx < rectW * 0.5) {
            if (stickId !== null) return;            // one stick, first thumb wins
            stickId = e.pointerId;
            everTouched = true;
            const m = tune.edgeMargin;
            originX = Math.max(m, Math.min(rectW * 0.5 - 8, lx));
            originY = Math.max(m, Math.min(rectH - m, ly));
            rawX = 0; rawY = 0;
            showStick(originX, originY);
            setKnob(0, 0);
        } else {
            if (boostId !== null) return;
            boostId = e.pointerId;
            everTouched = true;
            setBoost(true, lx, ly);
        }
        // Capture is best-effort: it fails for synthetic pointers and for
        // pointers the UA has already released. window listeners are the
        // real guarantee, so a failure here is not an error.
        try { layer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (e.cancelable) e.preventDefault();
    }

    function onPointerMove(e) {
        if (disposed) return;
        if (e.pointerId !== stickId) return;         // boost pointer needs no tracking
        const dx = (e.clientX - rectX) - originX;
        const dy = (e.clientY - rectY) - originY;
        const r = tune.radius;
        const len = Math.hypot(dx, dy);
        let kx = dx, ky = dy;
        if (len > r) { const s = r / len; kx = dx * s; ky = dy * s; }
        setKnob(kx, ky);
        rawX = kx / r;
        rawY = -ky / r;                              // screen-up = nose-up
        if (e.cancelable) e.preventDefault();
    }

    function onPointerUp(e) {
        if (disposed) return;
        if (e.pointerId === stickId) {
            stickId = null;
            rawX = 0; rawY = 0;
            hideStick();
        } else if (e.pointerId === boostId) {
            boostId = null;
            setBoost(false);
        } else {
            return;
        }
        try { layer.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }

    // --- keyboard ----------------------------------------------------------

    function keyAxis() {
        keyX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        keyY = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    }

    function keyCode(e) {
        const k = e.key;
        if (k === 'ArrowUp' || k === 'w' || k === 'W') return 'up';
        if (k === 'ArrowDown' || k === 's' || k === 'S') return 'down';
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') return 'left';
        if (k === 'ArrowRight' || k === 'd' || k === 'D') return 'right';
        if (k === ' ' || k === 'Spacebar' || e.code === 'Space') return 'boost';
        return null;
    }

    function onKeyDown(e) {
        if (disposed || !visible || e.repeat) return;
        const c = keyCode(e);
        if (!c) return;
        if (c === 'boost') {
            keyBoost = true;
            if (boostId === null) setBoost(true);
        } else {
            keys[c] = true;
            keyAxis();
        }
        if (e.cancelable) e.preventDefault();
    }

    function onKeyUp(e) {
        if (disposed) return;
        const c = keyCode(e);
        if (!c) return;
        if (c === 'boost') {
            keyBoost = false;
            if (boostId === null) setBoost(false);
        } else {
            keys[c] = false;
            keyAxis();
        }
    }

    function onBlur() {
        keys.up = keys.down = keys.left = keys.right = false;
        keyBoost = false;
        keyAxis();
        if (boostId === null) setBoost(false);
    }

    function onResize() { readRect(); placeHint(); }

    layer.addEventListener('pointerdown', onPointerDown, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    layer.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- update ------------------------------------------------------------

    /**
     * Deadzone -> expo -> exponential smoothing. Zero allocation.
     * @param {number} dt seconds
     */
    function update(dt) {
        if (disposed) return value;
        let tx, ty;
        if (stickId !== null) { tx = rawX; ty = rawY; }
        else { tx = keyX; ty = keyY; }

        const mag = Math.hypot(tx, ty);
        if (mag > 1e-6) {
            let n = (mag - tune.deadzone) / (1 - tune.deadzone);
            if (n <= 0) { tx = 0; ty = 0; }
            else {
                if (n > 1) n = 1;
                // Expo blends linear with cubic: fine control near centre,
                // full authority at the rim, and no direction bending.
                const shaped = n * (1 - tune.expo) + n * n * n * tune.expo;
                const s = shaped / mag;
                tx *= s; ty *= s;
            }
        } else { tx = 0; ty = 0; }

        let d = dt;
        if (!(d > 0)) d = 1 / 60;
        else if (d > 0.1) d = 0.1;
        // Framerate-independent form of "lerp 0.28 per 60Hz frame".
        const a = 1 - Math.pow(1 - tune.smoothing, d * 60);
        value.x += (tx - value.x) * a;
        value.y += (ty - value.y) * a;
        if (value.x < 1e-4 && value.x > -1e-4) value.x = 0;
        if (value.y < 1e-4 && value.y > -1e-4) value.y = 0;
        value.boost = boostHeld;
        return value;
    }

    function setVisible(on) {
        visible = on !== false;
        layer.classList.toggle('is-hidden', !visible);
        if (!visible) {
            stickId = null; boostId = null;
            rawX = 0; rawY = 0;
            hideStick();
            setBoost(false);
        }
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        layer.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('resize', onResize);
        if (layer.parentNode) layer.parentNode.removeChild(layer);
    }

    return {
        value,
        update,
        setVisible,
        dispose,
        // --- inspection hooks for the dev probe --------------------------
        element: layer,
        get raw() { return { x: rawX, y: rawY }; },       // build-time/debug only
        get stickActive() { return stickId !== null; },
        get boostActive() { return boostHeld; },
        get stickPointerId() { return stickId; },
        get boostPointerId() { return boostId; },
    };
}
