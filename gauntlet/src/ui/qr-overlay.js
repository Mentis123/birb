/**
 * ui/qr-overlay.js — the three-finger QR reveal.
 *
 * The Vibe Academy / Birb Labs convention: put three fingers on the screen and
 * a QR code for the page you are on appears, so anyone standing next to you can
 * scan it off your phone. Hidden by design — it is a demo affordance, not a
 * feature, so it must never take screen space or appear in the UI.
 *
 * WHY THREE FINGERS. One and two are gameplay: the stick is one thumb, stick
 * plus boost is two, and Turret Defense uses both at once. Three is the first
 * count the game itself can never generate, so the gesture cannot fire mid-run
 * by accident. The armed/valid dance below exists for the same reason — a
 * three-finger contact that started as a one-finger drag is somebody flying,
 * not somebody asking for a QR code.
 *
 * DESKTOP gets the keyboard instead (a demo laptop has no touchscreen): the
 * `Q` key, which nothing else in the game uses.
 */

import { encodeQR, drawQR } from './qr.js';

const STYLE_ID = 'gauntlet-qr-style';

/** All three fingers must be down within this of the first, in ms. */
const GATHER_MS = 600;

/** And held this long before it fires, so a fumbled grab is not a trigger. */
const HOLD_MS = 320;

function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
.gq-wrap {
  /* Above the splash/menu screens (100) and the pause sheet, but below the
     fatal-error overlay (500) — a crash message must never be hidden behind a
     QR code. At 60 the title screen simply painted over it. */
  position: fixed; inset: 0; z-index: 480;
  display: flex; align-items: center; justify-content: center;
  padding: 22px;
  background: rgba(8, 16, 30, 0.88);
  backdrop-filter: blur(6px);
  font-family: ui-rounded, "Arial Rounded MT Bold", "Nunito", "Trebuchet MS", system-ui, sans-serif;
  animation: gq-in 0.22s ease-out both;
}
.gq-wrap[hidden] { display: none; }
@keyframes gq-in { from { opacity: 0; } to { opacity: 1; } }

.gq-card {
  background: #fff6dc;
  border: 4px solid #0f1c33;
  border-radius: 22px;
  box-shadow: 0 7px 0 0 #0f1c33, 0 22px 44px rgba(4, 10, 22, 0.6);
  padding: 18px 18px 16px;
  text-align: center;
  max-width: min(360px, 100%);
  animation: gq-pop 0.34s cubic-bezier(0.16, 1.15, 0.3, 1) both;
}
@keyframes gq-pop { from { transform: scale(0.86) translateY(14px); } to { transform: none; } }

.gq-kicker {
  display: block; width: max-content; margin: -26px auto 12px; padding: 5px 16px 6px;
  background: #0f1c33; color: #fff6dc; border-radius: 0 0 12px 12px;
  font-size: 10px; font-weight: 900; letter-spacing: 0.3em; text-transform: uppercase;
}
/* The canvas is rendered at whole-module resolution and scaled up with
   pixelated smoothing — a QR resampled with bilinear filtering is a QR that
   phones hesitate over. */
.gq-card canvas {
  display: block; width: 100%; height: auto; max-width: 260px; margin: 0 auto;
  border: 3px solid #0f1c33; border-radius: 10px;
  image-rendering: pixelated;
}
.gq-label {
  margin-top: 12px; font-size: 12px; font-weight: 900;
  letter-spacing: 0.1em; color: #0f1c33; word-break: break-all;
}
.gq-hint {
  margin-top: 6px; font-size: 10px; letter-spacing: 0.16em;
  text-transform: uppercase; color: #0f1c33; opacity: 0.55;
}
.gq-close {
  margin-top: 14px; width: 100%; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 900;
  letter-spacing: 0.18em; text-transform: uppercase; color: #0f1c33;
  background: #ffdd44; border: 4px solid #0f1c33; border-radius: 14px;
  padding: 10px 12px 11px; box-shadow: 0 5px 0 0 #0f1c33;
}
.gq-close:active { transform: translateY(4px); box-shadow: 0 1px 0 0 #0f1c33; }
@media (prefers-reduced-motion: reduce) {
  .gq-wrap, .gq-card { animation: none !important; }
}
`;
    doc.head.appendChild(el);
}

/**
 * Install the three-finger QR reveal.
 *
 * @param {object} [opts]
 * @param {string} [opts.url]    what to encode; defaults to the current page
 * @param {string} [opts.label]  caption under the code
 * @param {Document} [opts.document]
 * @returns {{show, hide, isOpen, dispose, element}}
 */
export function createQrOverlay(opts = {}) {
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    ensureStyle(doc);

    const wrap = doc.createElement('div');
    wrap.className = 'gq-wrap';
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Scan to open this page');

    const card = doc.createElement('div');
    card.className = 'gq-card';
    wrap.appendChild(card);

    const kicker = doc.createElement('div');
    kicker.className = 'gq-kicker';
    kicker.textContent = 'Scan to play';
    card.appendChild(kicker);

    const canvas = doc.createElement('canvas');
    card.appendChild(canvas);

    const label = doc.createElement('div');
    label.className = 'gq-label';
    card.appendChild(label);

    const hint = doc.createElement('div');
    hint.className = 'gq-hint';
    hint.textContent = 'Three fingers to show · tap to close';
    card.appendChild(hint);

    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'gq-close';
    close.textContent = 'Close';
    card.appendChild(close);

    doc.body.appendChild(wrap);

    let open = false;
    let painted = null;

    function targetUrl() {
        if (opts.url) return opts.url;
        try { return String(window.location.href).split('#')[0]; } catch { return ''; }
    }

    function show() {
        if (open) return;
        const url = targetUrl();
        // Re-encode only when the URL actually changed — the mode is in the
        // query string, so it does change between runs.
        if (painted !== url) {
            try {
                drawQR(canvas, encodeQR(url), { scale: 6, quiet: 3 });
                painted = url;
            } catch (err) {
                // A URL too long for version 10 must not take the game down
                // with it; show the text and let someone type it.
                canvas.hidden = true;
            }
        }
        label.textContent = opts.label || url.replace(/^https?:\/\//, '');
        wrap.hidden = false;
        open = true;
    }

    function hide() {
        if (!open) return;
        wrap.hidden = true;
        open = false;
    }

    // --- the gesture --------------------------------------------------------
    // `armed` tracks a candidate: three fingers that ARRIVED together. It is
    // invalidated the moment the count is wrong, so a two-finger gesture that
    // picks up a third finger late does not count.
    let firstTouchAt = 0;
    let armedAt = 0;
    let valid = false;

    function onStart(e) {
        const n = e.touches ? e.touches.length : 0;
        const now = Date.now();
        if (n === 1) { firstTouchAt = now; valid = false; armedAt = 0; }
        if (n === 3) {
            // All three landed inside the gather window: a deliberate grab.
            valid = now - firstTouchAt <= GATHER_MS;
            armedAt = now;
        } else if (n > 3) {
            valid = false;
        }
    }

    function onEnd(e) {
        const n = e.touches ? e.touches.length : 0;
        // Fires on the RELEASE of a held three-finger grab. Firing on touch
        // down instead would pop the card up mid-gesture, over the very screen
        // the player is still touching.
        if (valid && armedAt && n < 3 && Date.now() - armedAt >= HOLD_MS) {
            valid = false;
            armedAt = 0;
            show();
            return;
        }
        if (n === 0) { valid = false; armedAt = 0; }
    }

    function onKey(e) {
        if (e.key === 'q' || e.key === 'Q') { open ? hide() : show(); }
        else if (e.key === 'Escape' && open) hide();
    }

    doc.addEventListener('touchstart', onStart, { passive: true });
    doc.addEventListener('touchend', onEnd, { passive: true });
    doc.addEventListener('touchcancel', onEnd, { passive: true });
    doc.addEventListener('keydown', onKey);
    wrap.addEventListener('click', hide);
    close.addEventListener('click', (e) => { e.stopPropagation(); hide(); });

    return {
        element: wrap,
        show,
        hide,
        isOpen() { return open; },
        dispose() {
            doc.removeEventListener('touchstart', onStart);
            doc.removeEventListener('touchend', onEnd);
            doc.removeEventListener('touchcancel', onEnd);
            doc.removeEventListener('keydown', onKey);
            if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        },
    };
}

export default createQrOverlay;
