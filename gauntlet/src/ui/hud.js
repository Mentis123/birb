/**
 * hud.js — Birb Gauntlet's race HUD.
 *
 * Hand-built DOM in the same cel language as the 3D: cream "sticker" panels
 * with a 3px ink border and a hard (blur-free) ink drop shadow, echoing the
 * inverted-hull outlines in the scene. Nothing here looks like default HTML —
 * no browser widgets, no default fonts at default weights, no thin hairlines.
 *
 * Design rules this file follows:
 *   - Every colour comes from `CSS` (the palette as CSS strings). No inline hex.
 *   - Readable at arm's length on a phone in daylight: ink on cream is the
 *     highest-contrast pairing in the palette, so every load-bearing number
 *     (lap, position, speed) sits on cream. Only decoration sits on ink.
 *   - Zero-allocation update paths. Every setter early-outs on an unchanged
 *     value, so `textContent` is written only when the string genuinely
 *     changes and the minimap redraw allocates nothing at all.
 *   - `prefers-reduced-motion` gates DECORATIVE motion only (countdown punch,
 *     wrong-way shake, countdown punch). Lap counters, speed, minimap and the
 *     countdown NUMBERS keep updating. A HUD that stops updating is a bug, not
 *     an accessibility feature.
 *
 * One <canvas> exists: the minimap. Everything else is DOM so it stays crisp
 * at any DPR and costs the GPU nothing.
 */

import { CSS } from '/gauntlet/src/core/palette.js';

const STYLE_ID = 'gauntlet-hud-style';

/** Sample counts for the minimap course polyline, per quality tier. */
const MAP_SAMPLES = { low: 72, mid: 96, high: 128 };
/** Minimap CSS size in px, per tier. */
// Deliberately small. On a real phone the 132px map plus a 132px speed dial
// ate the lower third of the screen and left nowhere to rest a thumb.
const MAP_SIZE = { low: 74, mid: 82, high: 88 };

const ORDINALS = ['TH', 'ST', 'ND', 'RD'];
function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return 'TH';
    return ORDINALS[n % 10] || 'TH';
}

function styleText() {
    return `
.gauntlet-hud {
  --ink: ${CSS.ink};
  --ink-soft: ${CSS.inkSoft};
  --cream: ${CSS.uiCream};
  --gold: ${CSS.uiGold};
  --cyan: ${CSS.uiCyan};
  --panel: ${CSS.uiPanel};
  --mint: ${CSS.ribbon};
  --warn: ${CSS.birdRival1};
  --font: ui-rounded, "Arial Rounded MT Bold", "Nunito", "Trebuchet MS", "DejaVu Sans", system-ui, sans-serif;
  position: absolute; inset: 0;
  font-family: var(--font);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  user-select: none; -webkit-user-select: none;
}
.gauntlet-hud * { box-sizing: border-box; margin: 0; }

/* --- the sticker: the single visual primitive everything is built from --- */
.vh-card {
  background: var(--cream);
  border: 3px solid var(--ink);
  border-radius: 12px;
  box-shadow: 0 3px 0 0 var(--ink), 0 7px 14px rgba(4, 10, 22, 0.40);
  padding: 3px 8px 4px;
  position: relative;
}
/* Gloss sits BEHIND the type — an overlay here ghosts the numerals. */
.vh-card::after {
  content: ''; position: absolute; inset: 3px 3px auto; height: 38%; z-index: 0;
  border-radius: 10px 10px 40% 40%;
  background: rgba(255, 255, 255, 0.6); pointer-events: none;
}
.vh-card > * { position: relative; z-index: 1; }
.vh-lab {
  display: block; font-size: 8px; font-weight: 800; line-height: 1;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink);
  opacity: 0.62;
}
.vh-val {
  display: block; font-size: 20px; font-weight: 900; line-height: 1.02;
  letter-spacing: -0.01em; font-variant-numeric: tabular-nums;
}
.vh-val small { font-size: 0.52em; letter-spacing: 0.04em; opacity: 0.66; }

/* --- corners ------------------------------------------------------------- */
.vh-tl, .vh-tr { position: absolute; display: flex; gap: 6px; }
/* The hidden attribute is a UA rule of display:none, which loses to any class
   rule that sets display. Every chip and card here sets display, so without
   this the attribute silently does nothing — which is exactly what happened:
   Casual booted showing six empty chips and a gate counter it does not use.
   (No backticks in this comment: the whole stylesheet is a template literal.) */
.gauntlet-hud [hidden] { display: none !important; }
.vh-tl { top: calc(12px + env(safe-area-inset-top)); left: calc(12px + env(safe-area-inset-left));
         flex-direction: column; align-items: flex-start; }
.vh-tr { top: calc(12px + env(safe-area-inset-top)); right: calc(12px + env(safe-area-inset-right));
         flex-direction: column; align-items: flex-end; }
/* --vh-bottom is set by the integrator. The touch controls own the bottom
   corners of a phone screen — that is where thumbs rest — so on a build with
   an on-screen stick the HUD's bottom clusters have to lift clear of them or
   the minimap and the joystick base occupy the same pixels. Both modules are
   correct in isolation; only integration can see the collision. */


.vh-pos .vh-val { color: var(--ink); }
.vh-pos.is-lead { background: var(--gold); }
.vh-pos.is-lead .vh-lab { opacity: 0.75; }

/* --- chips (secondary readouts sit on ink, not cream) -------------------- */
.vh-chip {
  display: flex; align-items: baseline; gap: 5px;
  background: rgba(10, 19, 36, 0.86);
  border: 2px solid var(--ink);
  border-radius: 9px;
  padding: 2px 7px 3px;
  color: var(--cream);
  box-shadow: 0 3px 0 0 rgba(4, 10, 22, 0.75);
}
.vh-chip .k { font-size: 9px; font-weight: 800; letter-spacing: 0.16em; opacity: 0.6; text-transform: uppercase; }
.vh-chip .v { font-size: 15px; font-weight: 900; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
.vh-gate .v { color: var(--mint); }
.vh-split .v { color: var(--cream); }
.vh-split .d { font-size: 14px; font-weight: 900; font-variant-numeric: tabular-nums; }
.vh-split .d.up { color: ${CSS.birdRival1}; }
.vh-split .d.down { color: ${CSS.ribbon}; }
.vh-split[hidden] { display: none; }

/* --- minimap ------------------------------------------------------------- */
.vh-map { position: relative; padding: 4px; border-radius: 50%; }
.vh-map::after { display: none; }
.vh-map canvas { display: block; border-radius: 50%; background: rgba(10, 19, 36, 0.92); }
.vh-map .vh-nose {
  position: absolute; top: -7px; left: 50%; transform: translateX(-50%);
  width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent;
  border-bottom: 11px solid var(--ink);
}
.vh-map .vh-nose::after {
  content: ''; position: absolute; left: -5px; top: 4px;
  width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent;
  border-bottom: 7px solid var(--gold);
}

/* --- speed --------------------------------------------------------------- */
.vh-speed { position: relative; align-self: flex-end; overflow: hidden; }
.vh-speed .v { font-size: 17px; font-weight: 900; font-variant-numeric: tabular-nums; }
.vh-speed .k { font-size: 8px; font-weight: 800; letter-spacing: 0.14em;
               text-transform: uppercase; opacity: 0.7; }
.vh-speed-bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 0%;
                background: var(--cyan); transition: width 0.12s linear; }
.vh-speed-num {
  position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-56%);
  text-align: center; font-size: 34px; font-weight: 900; line-height: 1;
  font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--ink);
}
.vh-speed-unit {
  position: absolute; left: 0; right: 0; top: 50%; margin-top: 14px;
  text-align: center; font-size: 9px; font-weight: 800; letter-spacing: 0.24em;
  color: var(--ink); opacity: 0.55;
}

.vh-combo.is-hot .v { color: var(--gold); }
.vh-lives.is-critical .v { color: #ff7a7a; }

/* --- countdown ----------------------------------------------------------- */
.vh-count {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.vh-count[hidden] { display: none; }
/* Flat, edgeless darkening. A radial scrim leaves a visible soft ellipse over
   a clean sky and reads as a rendering artefact. */
.vh-count-scrim { position: absolute; inset: 0; background: rgba(10, 19, 36, 0.34); }
/* Two stacked layers, not a text-shadow ring: an 8-way shadow reads as
   misregistered printing at this size. A stroked under-layer is a clean hull,
   and it echoes the inverted-hull outlines in the 3D. */
.vh-count-num {
  position: relative; display: grid; place-items: center;
  font-size: clamp(120px, 36vw, 200px); font-weight: 900; line-height: 0.92;
  letter-spacing: -0.03em;
  filter: drop-shadow(0 12px 0 rgba(10, 19, 36, 0.45)) drop-shadow(0 0 40px rgba(255, 221, 68, 0.55));
}
.vh-count-num > span { grid-area: 1 / 1; }
.vh-count-num .s { -webkit-text-stroke: 12px var(--ink); color: var(--ink); }
.vh-count-num .f { color: var(--cream); }
.vh-count-num.go { font-size: clamp(88px, 27vw, 158px); letter-spacing: 0.01em; }
.vh-count-num.go .f { color: var(--gold); }
/* A pill, not bare text: the caption has to survive landing on a bird. */
.vh-count-cap {
  position: absolute; top: calc(50% + clamp(80px, 24vw, 132px)); left: 50%;
  transform: translateX(-50%);
  font-size: 12px; font-weight: 900; letter-spacing: 0.4em; text-transform: uppercase;
  color: var(--cream); background: var(--ink);
  border: 3px solid var(--ink); border-radius: 999px;
  padding: 6px 20px 7px 24px; white-space: nowrap;
  box-shadow: 0 4px 0 0 rgba(4, 10, 22, 0.6);
}
.vh-count-cap:empty { display: none; }
.vh-count-num.punch { animation: vh-punch 0.5s cubic-bezier(0.16, 1.2, 0.3, 1) both; }
@keyframes vh-punch {
  0%   { transform: scale(2.1) rotate(-7deg); opacity: 0; }
  38%  { transform: scale(0.9) rotate(2deg); opacity: 1; }
  62%  { transform: scale(1.06) rotate(-1deg); }
  100% { transform: scale(1) rotate(0deg); }
}
.vh-count-ring {
  position: absolute; width: min(66vw, 320px); aspect-ratio: 1; border-radius: 50%;
  border: 7px solid rgba(255, 221, 68, 0.5);
}
.vh-count-ring.spin { animation: vh-ring 1s ease-out infinite; }
@keyframes vh-ring {
  0%   { transform: scale(0.65); opacity: 0.9; }
  100% { transform: scale(1.25); opacity: 0; }
}

/* --- wrong way ----------------------------------------------------------- */
.vh-wrong {
  position: absolute; left: 50%; top: 26%; transform: translate(-50%, -50%) rotate(-2.5deg);
  display: flex; align-items: center; gap: 10px;
  background:
    repeating-linear-gradient(-45deg, rgba(15, 28, 51, 0.22) 0 9px, rgba(15, 28, 51, 0) 9px 20px),
    ${CSS.birdRival1};
  border: 4px solid var(--ink); border-radius: 14px;
  padding: 7px 16px 9px;
  box-shadow: 0 5px 0 0 var(--ink), 0 14px 26px rgba(4, 10, 22, 0.5);
  color: var(--cream);
  font-size: 19px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase;
  white-space: nowrap;
}
.vh-wrong[hidden] { display: none; }
.vh-wrong .ch { color: var(--ink); font-size: 22px; line-height: 1; }
.vh-wrong.anim { animation: vh-wobble 0.66s ease-in-out infinite; }
@keyframes vh-wobble {
  0%, 100% { transform: translate(-50%, -50%) rotate(-2.5deg) scale(1); }
  50%      { transform: translate(-50%, -50%) rotate(1.8deg) scale(1.05); }
}

/* --- action prompt (Land / Take off) ------------------------------------
   Bottom-CENTRE, between the two thumbs rather than under either. The stick
   owns the left half and the boost pill roams the right, so a button parked in
   either corner is a button someone lands on by accident mid-turn. */
/* Small, and low enough to stay out of the turret's sight picture. It used to
   sit a full thumb-height above the bottom edge, right where the gun is. */
.vh-action {
  position: absolute; left: 50%; transform: translateX(-50%);
  bottom: max(8px, env(safe-area-inset-bottom, 0px));
  pointer-events: auto; cursor: pointer;
  font-family: var(--font); font-size: 10px; font-weight: 900;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink);
  background: var(--gold); border: 3px solid var(--ink); border-radius: 999px;
  padding: 5px 13px 6px; box-shadow: 0 3px 0 0 var(--ink);
  transition: transform 0.08s ease, box-shadow 0.08s ease;
  opacity: 0.92;
}
.vh-action:active { transform: translateX(-50%) translateY(3px); box-shadow: 0 0 0 0 var(--ink); opacity: 1; }
.vh-action.calm { background: var(--cream); }

/* --- results ------------------------------------------------------------- */
.vh-results {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 18px; pointer-events: auto;
  background: radial-gradient(120% 90% at 50% 0%, rgba(31, 95, 158, 0.62), rgba(10, 19, 36, 0.93));
  backdrop-filter: blur(3px);
}
.vh-results[hidden] { display: none; }
.vh-res-card {
  width: min(360px, 100%);
  background: var(--cream);
  border: 4px solid var(--ink); border-radius: 22px;
  box-shadow: 0 7px 0 0 var(--ink), 0 22px 44px rgba(4, 10, 22, 0.6);
  padding: 16px 16px 15px; text-align: center;
  max-height: 100%; overflow: auto;
}
.vh-res-card.pop { animation: vh-pop 0.42s cubic-bezier(0.16, 1.15, 0.3, 1) both; }
@keyframes vh-pop { 0% { transform: scale(0.82) translateY(18px); opacity: 0; } 100% { transform: none; opacity: 1; } }
/* A tab hung off the card's top edge — block-level, or it shares a line with
   the placement badge and the two collide. */
.vh-res-kicker {
  display: block; width: max-content; margin: -20px auto 10px; padding: 5px 18px 6px;
  background: var(--ink); color: var(--cream); border-radius: 0 0 12px 12px;
  font-size: 10px; font-weight: 900; letter-spacing: 0.32em; text-transform: uppercase;
}
.vh-res-place {
  font-size: 62px; font-weight: 900; line-height: 1; letter-spacing: -0.03em; margin-top: 2px;
  display: inline-block; padding: 4px 22px 6px; border-radius: 18px;
  border: 4px solid var(--ink); background: var(--cyan); color: var(--ink);
  box-shadow: 0 5px 0 0 var(--ink);
}
.vh-res-place.p1 { background: var(--gold); }
.vh-res-place.p3 { background: ${CSS.birdRival2}; }
.vh-res-place.p4 { background: ${CSS.birdRival1}; color: var(--cream); }
.vh-res-place small { font-size: 0.38em; letter-spacing: 0.05em; opacity: 0.75; }
.vh-res-head { display: flex; align-items: center; justify-content: center; gap: 14px; }
.vh-res-tot { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; }
.vh-res-tot-lab { font-size: 9px; font-weight: 900; letter-spacing: 0.28em; text-transform: uppercase; opacity: 0.55; }
.vh-res-total {
  display: inline-block; padding: 4px 14px 5px;
  background: var(--ink); color: var(--cream); border-radius: 10px;
  font-size: 19px; font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: 0.02em;
}
.vh-res-laps { margin-top: 12px; border-top: 3px dashed rgba(15, 28, 51, 0.28); padding-top: 8px; }
.vh-res-row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 4px 2px; font-weight: 800; font-size: 14px;
  border-bottom: 2px solid rgba(15, 28, 51, 0.1);
}
.vh-res-row .n { font-size: 10px; letter-spacing: 0.18em; opacity: 0.6; text-transform: uppercase; }
.vh-res-row .t { font-variant-numeric: tabular-nums; font-size: 16px; font-weight: 900; }
.vh-res-row .d { font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 900; min-width: 52px; text-align: right; }
.vh-res-row .d.up { color: ${CSS.canyonDeep}; }
.vh-res-row .d.down { color: ${CSS.meadowDeep}; }
.vh-res-row.best { background: rgba(255, 221, 68, 0.4); border-radius: 8px; }
.vh-res-field { margin-top: 10px; text-align: left; }
.vh-res-field .vh-res-row:last-child { border-bottom: none; }
.vh-res-field .p { display: flex; align-items: center; gap: 8px; }
.vh-res-field .dot { width: 12px; height: 12px; border-radius: 50%; border: 2.5px solid var(--ink); }
.vh-res-field .vh-res-row.mine {
  background: rgba(0, 212, 255, 0.22); border-radius: 9px;
  box-shadow: inset 0 0 0 2.5px var(--ink);
  padding-left: 6px; padding-right: 6px;
}
.vh-res-field .me { text-decoration: underline; text-decoration-thickness: 3px; text-underline-offset: 3px; }
.vh-share {
  margin-top: 14px; width: 100%; cursor: pointer; pointer-events: auto;
  font-family: var(--font); font-size: 15px; font-weight: 900; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--ink);
  background: var(--gold); border: 4px solid var(--ink); border-radius: 14px;
  padding: 11px 14px 12px; box-shadow: 0 5px 0 0 var(--ink);
  transition: transform 0.08s ease, box-shadow 0.08s ease;
}
.vh-share:active { transform: translateY(4px); box-shadow: 0 1px 0 0 var(--ink); }
/* Retry / Menu sit BELOW share as equal halves. A finished mini-game has to
   offer the next run without making the player find the pause button, which
   the results overlay is sitting on top of. */
.vh-res-actions { display: flex; gap: 9px; margin-top: 9px; }
.vh-res-actions button {
  flex: 1 1 0; cursor: pointer; pointer-events: auto;
  font-family: var(--font); font-size: 13px; font-weight: 900; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--ink);
  background: var(--cream); border: 4px solid var(--ink); border-radius: 13px;
  padding: 9px 8px 10px; box-shadow: 0 5px 0 0 var(--ink);
  transition: transform 0.08s ease, box-shadow 0.08s ease;
}
.vh-res-actions button.primary { background: var(--cyan); }
.vh-res-actions button:active { transform: translateY(4px); box-shadow: 0 1px 0 0 var(--ink); }
/* A best-time / new-record banner under the headline. */
.vh-res-best {
  margin-top: 9px; padding: 6px 10px 7px; border-radius: 11px;
  border: 3px solid var(--ink); background: rgba(255, 221, 68, 0.45);
  font-size: 11px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase;
}
.vh-res-best[hidden] { display: none; }

/* --- reduced motion: decoration only. Numbers keep updating. ------------- */
.gauntlet-hud.vh-reduce .vh-count-num.punch,
.gauntlet-hud.vh-reduce .vh-count-ring.spin,
.gauntlet-hud.vh-reduce .vh-wrong.anim,
.gauntlet-hud.vh-reduce .vh-res-card.pop { animation: none !important; }

/* --- desktop: the same design, scaled up from each corner ---------------
   Fixed px sizing tuned for a 390pt phone reads as undersized furniture on a
   900px window, so the corner clusters scale as units rather than being
   re-laid-out. */
@media (min-width: 700px) and (min-height: 560px) {
  .vh-tl { transform: scale(1.3); transform-origin: top left; }
  .vh-tr { transform: scale(1.3); transform-origin: top right; }
  }

/* --- narrow phones: shrink the furniture, never the numbers ------------- */
@media (max-width: 400px) {
  .vh-val { font-size: 18px; }
  }
`;
}

/**
 * Build the HUD.
 *
 * @param {HTMLElement} rootEl  container (usually `#hud`, pointer-events:none)
 * @param {{quality?: 'low'|'mid'|'high'}} options
 */
export function createHUD(rootEl, options = {}) {
    const quality = options.quality === 'low' || options.quality === 'mid' ? options.quality : 'high';
    const doc = rootEl.ownerDocument || document;
    const win = doc.defaultView || window;

    // ---- style (once per document) --------------------------------------
    let styleEl = doc.getElementById(STYLE_ID);
    let ownsStyle = false;
    if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = styleText();
        doc.head.appendChild(styleEl);
        ownsStyle = true;
    }

    rootEl.classList.add('gauntlet-hud');
    // Lift the bottom clusters clear of on-screen controls. See --vh-bottom.
    if (Number.isFinite(options.bottomInset)) {
        rootEl.style.setProperty('--vh-bottom', options.bottomInset + 'px');
    }

    function el(tag, cls, parent, html) {
        const node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (html !== undefined) node.innerHTML = html;
        if (parent) parent.appendChild(node);
        return node;
    }

    // ---- top-left: lap + gate + split ------------------------------------
    const tl = el('div', 'vh-tl', rootEl);
    const lapCard = el('div', 'vh-card vh-lap', tl);
    el('span', 'vh-lab', lapCard).textContent = 'Lap';
    const lapVal = el('span', 'vh-val', lapCard);
    lapVal.innerHTML = '1<small>/3</small>';
    const lapNum = lapVal.firstChild;
    const lapTot = lapVal.querySelector('small');

    const gateChip = el('div', 'vh-chip vh-gate', tl, '<span class="k">Gate</span><span class="v">01/12</span>');
    const gateVal = gateChip.querySelector('.v');

    const splitChip = el('div', 'vh-chip vh-split', tl,
        '<span class="k">Split</span><span class="v">--:--.--</span><span class="d"></span>');
    const splitVal = splitChip.querySelector('.v');
    const splitDelta = splitChip.querySelector('.d');
    splitChip.hidden = true;

    // --- mode chips -------------------------------------------------------
    // One chip per readout the ported Birb Mobile modes need. They all live in
    // the same stack and are shown/hidden by setModeChrome, so the HUD never
    // has to know WHICH mode is running — only what that mode switched on.
    function chip(cls, key) {
        const c = el('div', 'vh-chip ' + cls, tl,
            '<span class="k">' + key + '</span><span class="v"></span>');
        c.hidden = true;
        return { el: c, v: c.querySelector('.v') };
    }
    const ringsChip = chip('vh-rings', 'Rings');
    const clockChip = chip('vh-clock', 'Time');
    const scoreChip = chip('vh-score', 'Score');
    const comboChip = chip('vh-combo', 'Combo');
    const waveChip = chip('vh-wave', 'Wave');
    const livesChip = chip('vh-lives', 'Lives');

    // ---- top-right: position ---------------------------------------------
    const tr = el('div', 'vh-tr', rootEl);
    const posCard = el('div', 'vh-card vh-pos', tr);
    el('span', 'vh-lab', posCard).textContent = 'Pos';
    const posVal = el('span', 'vh-val', posCard);
    posVal.innerHTML = '1<small>ST</small>';
    const posNum = posVal.firstChild;
    const posSuffix = posVal.querySelector('small');

    // ---- minimap: top-right, under the position card ---------------------
    // The bottom corners belong to the player's thumbs, not to readouts.
    const mapCard = el('div', 'vh-card vh-map', tr);
    el('div', 'vh-nose', mapCard);
    const mapCanvas = el('canvas', null, mapCard);
    const mapCss = MAP_SIZE[quality];
    mapCanvas.style.width = mapCss + 'px';
    mapCanvas.style.height = mapCss + 'px';
    const mapCtx = mapCanvas.getContext('2d');

    // ---- speed: a chip under the map, not a 132px dial --------------------
    // The dial was handsome and cost a third of the playfield. Speed is felt
    // more than read; the thin fill bar keeps the at-a-glance feedback.
    const speedWrap = el('div', 'vh-chip vh-speed', tr,
        '<span class="v">0</span><span class="k">km/h</span><i class="vh-speed-bar"></i>');
    const speedNum = speedWrap.querySelector('.v');
    const gaugeFill = speedWrap.querySelector('.vh-speed-bar');


    // ---- countdown --------------------------------------------------------
    // Inserted BEFORE the corner furniture so the countdown scrim dims the
    // game, not the HUD — greyed-out cream cards read as a disabled UI.
    const countWrap = el('div', 'vh-count', null);
    rootEl.insertBefore(countWrap, rootEl.firstChild);
    countWrap.hidden = true;
    el('div', 'vh-count-scrim', countWrap);
    const countRing = el('div', 'vh-count-ring', countWrap);
    const countNum = el('div', 'vh-count-num', countWrap, '<span class="s"></span><span class="f"></span>');
    const countStroke = countNum.querySelector('.s');
    const countFace = countNum.querySelector('.f');
    const countCap = el('div', 'vh-count-cap', countWrap);

    // ---- wrong way --------------------------------------------------------
    const wrong = el('div', 'vh-wrong', rootEl,
        '<span class="ch">&#9666;&#9666;</span><span>Wrong way</span><span class="ch">&#9656;&#9656;</span>');
    wrong.hidden = true;

    // ---- action prompt ----------------------------------------------------
    const actionBtn = el('button', 'vh-action', rootEl);
    actionBtn.type = 'button';
    actionBtn.hidden = true;
    let _onAction = null;
    let _actionLabel = null;
    actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_onAction) _onAction();
    });

    // ---- results ----------------------------------------------------------
    const results = el('div', 'vh-results', rootEl);
    results.hidden = true;
    const resCard = el('div', 'vh-res-card', results);
    const resKicker = el('div', 'vh-res-kicker', resCard);
    resKicker.textContent = 'Race complete';
    const resPlace = el('div', 'vh-res-place', resCard);
    resPlace.innerHTML = '1<small>ST</small>';
    const resPlaceNum = resPlace.firstChild;
    const resPlaceSuffix = resPlace.querySelector('small');
    const resHead = el('div', 'vh-res-head', resCard);
    resHead.appendChild(resPlace);
    const totWrap = el('div', 'vh-res-tot', resHead);
    const resTotLab = el('div', 'vh-res-tot-lab', totWrap);
    resTotLab.textContent = 'Total';
    const resTotal = el('div', 'vh-res-total', totWrap);
    resTotal.textContent = '--:--.--';
    const resBest = el('div', 'vh-res-best', resCard);
    resBest.hidden = true;
    const resLaps = el('div', 'vh-res-laps', resCard);
    const resField = el('div', 'vh-res-field', resCard);
    const shareBtn = el('button', 'vh-share', resCard);
    shareBtn.type = 'button';
    shareBtn.textContent = 'Share result';
    const resActions = el('div', 'vh-res-actions', resCard);
    resActions.hidden = true;             // until the integrator wires them
    const retryBtn = el('button', 'primary', resActions);
    retryBtn.type = 'button';
    retryBtn.textContent = 'Retry';
    const menuBtn = el('button', '', resActions);
    menuBtn.type = 'button';
    menuBtn.textContent = 'Menu';
    let _onRetry = null;
    let _onMenu = null;
    retryBtn.addEventListener('click', () => { if (_onRetry) _onRetry(); });
    menuBtn.addEventListener('click', () => { if (_onMenu) _onMenu(); });

    // ---- reduced motion (decoration only) --------------------------------
    let motionMq = null;
    function applyMotion() {
        rootEl.classList.toggle('vh-reduce', Boolean(motionMq && motionMq.matches));
    }
    try {
        motionMq = win.matchMedia('(prefers-reduced-motion: reduce)');
        if (motionMq.addEventListener) motionMq.addEventListener('change', applyMotion);
        else if (motionMq.addListener) motionMq.addListener(applyMotion);
        applyMotion();
    } catch { /* no matchMedia — assume full motion */ }
    const reduced = () => Boolean(motionMq && motionMq.matches);

    // =====================================================================
    // Minimap
    // =====================================================================
    const SAMPLES = MAP_SAMPLES[quality];
    const _samples = new Float32Array(SAMPLES * 3);
    let _sampleCount = 0;
    let _srcRef = null;
    let _gatePos = null;
    let _gateCount = 0;
    let _nextGate = 0;

    // Scratch that satisfies both `out.set(x,y,z)` and `out.copy(v)` course
    // implementations without dragging THREE in.
    const _sampleOut = {
        x: 0, y: 0, z: 0,
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
        copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    };

    // Heading state (smoothed from player motion — the map is heading-up).
    let _hx = 0, _hy = 0, _hz = -1;
    let _px = 0, _py = 0, _pz = 0, _hasPrev = false;

    // Tangent basis scratch (scalars only — nothing allocates per frame).
    let _ux = 0, _uy = 1, _uz = 0;
    let _fx = 0, _fy = 0, _fz = -1;
    let _rx = 1, _ry = 0, _rz = 0;

    let mapPx = 0, mapHalf = 0, mapScale = 1;
    const VIEW_RANGE = 78; // world units from the player to the map edge

    const RACER_COLORS = [CSS.birdPlayer, CSS.birdRival1, CSS.birdRival2, CSS.birdRival3];

    function sizeMap() {
        const dpr = Math.min(win.devicePixelRatio || 1, quality === 'high' ? 3 : 2);
        mapPx = Math.round(mapCss * dpr);
        if (mapCanvas.width !== mapPx) {
            mapCanvas.width = mapPx;
            mapCanvas.height = mapPx;
        }
        mapHalf = mapPx * 0.5;
        mapScale = (mapHalf - 4 * dpr) / VIEW_RANGE;
        mapCtx.lineJoin = 'round';
        mapCtx.lineCap = 'round';
    }
    sizeMap();

    function resample(source) {
        if (source === _srcRef) return;
        _srcRef = source;
        _gatePos = null;
        _gateCount = 0;
        if (!source) { _sampleCount = 0; return; }

        if (source.length !== undefined && typeof source.sampleAt !== 'function') {
            // Raw sample buffer: copy up to our capacity, evenly strided.
            const n = Math.floor(source.length / 3);
            const count = Math.min(n, SAMPLES);
            for (let i = 0; i < count; i++) {
                const s = Math.floor((i * n) / count) * 3;
                _samples[i * 3] = source[s];
                _samples[i * 3 + 1] = source[s + 1];
                _samples[i * 3 + 2] = source[s + 2];
            }
            _sampleCount = count;
            return;
        }

        if (typeof source.sampleAt === 'function') {
            for (let i = 0; i < SAMPLES; i++) {
                source.sampleAt(i / SAMPLES, _sampleOut);
                _samples[i * 3] = _sampleOut.x;
                _samples[i * 3 + 1] = _sampleOut.y;
                _samples[i * 3 + 2] = _sampleOut.z;
            }
            _sampleCount = SAMPLES;
            if (source.gatePositions && source.gatePositions.length >= 3) {
                _gatePos = source.gatePositions;
                _gateCount = Math.floor(source.gatePositions.length / 3);
            }
            return;
        }
        _sampleCount = 0;
    }

    /** Rebuild the tangent basis (up = radial, forward = smoothed heading). */
    function updateBasis(x, y, z) {
        let inv = 1 / Math.max(1e-6, Math.hypot(x, y, z));
        _ux = x * inv; _uy = y * inv; _uz = z * inv;

        if (_hasPrev) {
            const dx = x - _px, dy = y - _py, dz = z - _pz;
            const m = Math.hypot(dx, dy, dz);
            if (m > 1e-4) {
                const k = reduced() ? 0.45 : 0.22; // response, not decoration
                _hx += (dx / m - _hx) * k;
                _hy += (dy / m - _hy) * k;
                _hz += (dz / m - _hz) * k;
            }
        }
        _px = x; _py = y; _pz = z; _hasPrev = true;

        // Project the heading onto the tangent plane.
        let d = _hx * _ux + _hy * _uy + _hz * _uz;
        let fx = _hx - _ux * d, fy = _hy - _uy * d, fz = _hz - _uz * d;
        let fm = Math.hypot(fx, fy, fz);
        if (fm < 1e-5) {
            // Degenerate: pick any tangent so the map still draws.
            fx = -_uz; fy = 0; fz = _ux;
            fm = Math.hypot(fx, fy, fz);
            if (fm < 1e-5) { fx = 1; fy = 0; fz = 0; fm = 1; }
        }
        inv = 1 / fm;
        _fx = fx * inv; _fy = fy * inv; _fz = fz * inv;

        // right = forward x up
        _rx = _fy * _uz - _fz * _uy;
        _ry = _fz * _ux - _fx * _uz;
        _rz = _fx * _uy - _fy * _ux;
    }

    // Projection outputs (scalars — no vector allocation).
    let _projX = 0, _projY = 0, _projVis = false;
    function project(x, y, z, px, py, pz) {
        const inv = 1 / Math.max(1e-6, Math.hypot(x, y, z));
        // Behind the horizon relative to the player's up? Drop it.
        _projVis = (x * inv) * _ux + (y * inv) * _uy + (z * inv) * _uz > 0.34;
        const vx = x - px, vy = y - py, vz = z - pz;
        _projX = mapHalf + (vx * _rx + vy * _ry + vz * _rz) * mapScale;
        _projY = mapHalf - (vx * _fx + vy * _fy + vz * _fz) * mapScale;
    }

    function strokeCourse(px, py, pz, width, color) {
        mapCtx.beginPath();
        mapCtx.lineWidth = width;
        mapCtx.strokeStyle = color;
        let drawing = false;
        for (let i = 0; i <= _sampleCount; i++) {
            const j = (i % _sampleCount) * 3;
            project(_samples[j], _samples[j + 1], _samples[j + 2], px, py, pz);
            const off = _projX < -mapPx || _projX > mapPx * 2 || _projY < -mapPx || _projY > mapPx * 2;
            if (!_projVis || off) { drawing = false; continue; }
            if (!drawing) { mapCtx.moveTo(_projX, _projY); drawing = true; }
            else mapCtx.lineTo(_projX, _projY);
        }
        mapCtx.stroke();
    }

    function drawMap(source, racerPositions, playerIndex) {
        if (!mapCtx || !racerPositions || racerPositions.length < 3) return;
        resample(source);

        const pi = (playerIndex | 0) * 3;
        const px = racerPositions[pi], py = racerPositions[pi + 1], pz = racerPositions[pi + 2];
        updateBasis(px, py, pz);

        const dpr = mapPx / mapCss;
        mapCtx.clearRect(0, 0, mapPx, mapPx);

        // Dish
        mapCtx.beginPath();
        mapCtx.arc(mapHalf, mapHalf, mapHalf - 1, 0, Math.PI * 2);
        mapCtx.fillStyle = 'rgba(10,19,36,0.94)';
        mapCtx.fill();
        mapCtx.save();
        mapCtx.clip();

        // Range rings — sparse, so the course reads as the hero.
        mapCtx.strokeStyle = 'rgba(255,246,220,0.13)';
        mapCtx.lineWidth = 1 * dpr;
        for (let k = 1; k <= 2; k++) {
            mapCtx.beginPath();
            mapCtx.arc(mapHalf, mapHalf, (mapHalf - 4 * dpr) * (k / 2.4), 0, Math.PI * 2);
            mapCtx.stroke();
        }

        if (_sampleCount > 1) {
            strokeCourse(px, py, pz, 6.5 * dpr, CSS.ink);          // ink under-stroke
            strokeCourse(px, py, pz, 3.0 * dpr, CSS.ribbon);       // ribbon
        }

        // Gates: ticks along the line, the next one gold and larger.
        for (let g = 0; g < _gateCount; g++) {
            project(_gatePos[g * 3], _gatePos[g * 3 + 1], _gatePos[g * 3 + 2], px, py, pz);
            if (!_projVis) continue;
            const isNext = g === _nextGate;
            mapCtx.beginPath();
            mapCtx.arc(_projX, _projY, (isNext ? 4.2 : 2.2) * dpr, 0, Math.PI * 2);
            mapCtx.fillStyle = isNext ? CSS.uiGold : CSS.gatePassed;
            mapCtx.fill();
            mapCtx.lineWidth = 1.6 * dpr;
            mapCtx.strokeStyle = CSS.ink;
            mapCtx.stroke();
        }

        // Rivals
        const count = Math.floor(racerPositions.length / 3);
        for (let i = 0; i < count; i++) {
            if (i === (playerIndex | 0)) continue;
            project(racerPositions[i * 3], racerPositions[i * 3 + 1], racerPositions[i * 3 + 2], px, py, pz);
            if (!_projVis) continue;
            mapCtx.beginPath();
            mapCtx.arc(_projX, _projY, 4.4 * dpr, 0, Math.PI * 2);
            mapCtx.fillStyle = RACER_COLORS[i % RACER_COLORS.length];
            mapCtx.fill();
            mapCtx.lineWidth = 2 * dpr;
            mapCtx.strokeStyle = CSS.ink;
            mapCtx.stroke();
        }

        mapCtx.restore();

        // Rim ticks — give the dish a scale reference so empty space still
        // reads as an instrument rather than a hole.
        mapCtx.strokeStyle = 'rgba(255,246,220,0.24)';
        mapCtx.lineWidth = 1.8 * dpr;
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            const r0 = mapHalf - 3 * dpr;
            const r1 = mapHalf - (k % 2 ? 6 : 11) * dpr;
            mapCtx.beginPath();
            mapCtx.moveTo(mapHalf + Math.sin(a) * r0, mapHalf - Math.cos(a) * r0);
            mapCtx.lineTo(mapHalf + Math.sin(a) * r1, mapHalf - Math.cos(a) * r1);
            mapCtx.stroke();
        }

        // Bearing chevron on the rim for the next gate — the one thing the
        // player actually needs when the line runs off the dish.
        if (_gateCount > 0) {
            const gi = (_nextGate % _gateCount) * 3;
            project(_gatePos[gi], _gatePos[gi + 1], _gatePos[gi + 2], px, py, pz);
            const dx = _projX - mapHalf, dy = _projY - mapHalf;
            const m = Math.hypot(dx, dy);
            if (m > 1e-3) {
                const ux = dx / m, uy = dy / m;
                const rr = mapHalf - 8 * dpr;
                const cx = mapHalf + ux * rr, cy = mapHalf + uy * rr;
                const t = 6.5 * dpr;
                mapCtx.beginPath();
                mapCtx.moveTo(cx + ux * t, cy + uy * t);
                mapCtx.lineTo(cx - uy * t - ux * t * 0.7, cy + ux * t - uy * t * 0.7);
                mapCtx.lineTo(cx + uy * t - ux * t * 0.7, cy - ux * t - uy * t * 0.7);
                mapCtx.closePath();
                mapCtx.fillStyle = CSS.uiGold;
                mapCtx.fill();
                mapCtx.lineWidth = 2 * dpr;
                mapCtx.strokeStyle = CSS.ink;
                mapCtx.stroke();
            }
        }

        // Player: always dead centre, always pointing up. A soft view cone
        // first, so the marker reads as "me, facing there" at a glance.
        mapCtx.save();
        mapCtx.beginPath();
        mapCtx.arc(mapHalf, mapHalf, mapHalf - 1, 0, Math.PI * 2);
        mapCtx.clip();
        mapCtx.beginPath();
        mapCtx.moveTo(mapHalf, mapHalf);
        mapCtx.lineTo(mapHalf - mapHalf * 0.62, 0);
        mapCtx.lineTo(mapHalf + mapHalf * 0.62, 0);
        mapCtx.closePath();
        mapCtx.fillStyle = 'rgba(78,201,245,0.16)';
        mapCtx.fill();
        mapCtx.restore();

        const s = 9.5 * dpr;
        mapCtx.beginPath();
        mapCtx.moveTo(mapHalf, mapHalf - s * 1.25);
        mapCtx.lineTo(mapHalf + s * 0.85, mapHalf + s * 0.95);
        mapCtx.lineTo(mapHalf, mapHalf + s * 0.45);
        mapCtx.lineTo(mapHalf - s * 0.85, mapHalf + s * 0.95);
        mapCtx.closePath();
        mapCtx.fillStyle = CSS.birdPlayer;
        mapCtx.fill();
        mapCtx.lineWidth = 2.4 * dpr;
        mapCtx.strokeStyle = CSS.ink;
        mapCtx.stroke();
    }

    // =====================================================================
    // Setters — every one early-outs on an unchanged value
    // =====================================================================
    let _lap = -1, _lapTotal = -1;
    let _pos = -1, _posTotal = -1;
    let _kmh = -1, _speed01 = -1;
    let _gateIdx = -1, _gateTotal = -1;
    let _splitText = null, _splitDelta = NaN;
    let _countN = -999, _countShown = false;
    let _wrongOn = false;
    let _resultsOn = false;
    let _shareText = 'I raced the Birb Gauntlet sky circuit.';

    function setLap(lap, total) {
        if (lap === _lap && total === _lapTotal) return;
        if (lap !== _lap) { _lap = lap; lapNum.textContent = lap; }
        if (total !== _lapTotal) { _lapTotal = total; lapTot.textContent = '/' + total; }
    }

    function setPosition(pos, total) {
        if (pos === _pos && total === _posTotal) return;
        if (pos !== _pos) {
            _pos = pos;
            posNum.textContent = pos;
            posSuffix.textContent = ordinalSuffix(pos);
            posCard.classList.toggle('is-lead', pos === 1);
        }
        _posTotal = total;
    }

    function setSpeed(kmh, speed01) {
        const k = Math.round(kmh) | 0;
        if (k !== _kmh) { _kmh = k; speedNum.textContent = k; }
        const s = speed01 < 0 ? 0 : speed01 > 1 ? 1 : speed01;
        // Quantise so the dashoffset string only changes when it visibly moves.
        const q = Math.round(s * 200) / 200;
        if (q !== _speed01) {
            _speed01 = q;
            gaugeFill.style.width = (q * 100).toFixed(1) + '%';
        }
    }

    let _rings = -1, _ringsTot = -1, _clock = null, _score = -1;
    let _combo = -1, _wave = -1, _lives = -1;

    function setRings(n, total) {
        if (n === _rings && total === _ringsTot) return;
        _rings = n; _ringsTot = total;
        ringsChip.v.textContent = n + '/' + total;
    }
    function setClock(text) {
        if (text === _clock) return;
        _clock = text;
        clockChip.v.textContent = text;
    }
    function setScore(n) {
        const v = Math.round(n) | 0;
        if (v === _score) return;
        _score = v;
        scoreChip.v.textContent = v;
    }
    function setCombo(mult) {
        // Quantised to the display precision so an unchanged readout is a
        // no-op rather than a per-frame textContent write.
        const q = Math.round(mult * 100) / 100;
        if (q === _combo) return;
        _combo = q;
        comboChip.v.textContent = 'x' + q.toFixed(2).replace(/0$/, '');
        comboChip.el.classList.toggle('is-hot', q >= 2);
    }
    function setWave(n) {
        if (n === _wave) return;
        _wave = n;
        waveChip.v.textContent = n;
    }
    function setLives(n) {
        if (n === _lives) return;
        _lives = n;
        // Hearts read faster than a number at a glance under pressure.
        livesChip.v.textContent = n > 0 ? '\u2665'.repeat(Math.min(n, 5)) : '\u2014';
        livesChip.el.classList.toggle('is-critical', n <= 1);
    }

    /**
     * Show exactly the readouts this mode uses.
     *
     * Takes the mode DESCRIPTOR, not a mode id — the HUD stays ignorant of
     * which modes exist, so adding one never means editing this function.
     */
    function setModeChrome(def) {
        const race = Boolean(def.rivals);
        lapCard.hidden = !def.laps;
        posCard.hidden = !race;
        gateChip.hidden = !def.course;
        if (!race) splitChip.hidden = true;

        ringsChip.el.hidden = !def.rings;
        clockChip.el.hidden = !def.timed || race;
        scoreChip.el.hidden = def.scoreKind !== 'score';
        comboChip.el.hidden = def.drones !== 'hunt';
        waveChip.el.hidden = def.drones !== 'waves';
        livesChip.el.hidden = !def.canFail;
    }

    function setGate(index, total) {
        const i = (index | 0);
        if (i === _gateIdx && total === _gateTotal) return;
        _gateIdx = i; _gateTotal = total;
        _nextGate = i;
        const shown = Math.min(i + 1, total);
        gateVal.textContent = (shown < 10 ? '0' + shown : shown) + '/' + (total < 10 ? '0' + total : total);
    }

    /**
     * @param {string|null} text   formatted split, e.g. "1:12.44". null hides.
     * @param {number} [delta]     ms vs. reference. Negative = faster = mint.
     */
    function setSplit(text, delta) {
        if (text === _splitText && (delta === _splitDelta || (Number.isNaN(delta) && Number.isNaN(_splitDelta)))) return;
        _splitText = text;
        _splitDelta = delta;
        if (text === null || text === undefined || text === '') {
            if (!splitChip.hidden) splitChip.hidden = true;
            return;
        }
        if (splitChip.hidden) splitChip.hidden = false;
        splitVal.textContent = text;
        if (delta === null || delta === undefined || !Number.isFinite(delta)) {
            splitDelta.textContent = '';
            splitDelta.className = 'd';
        } else {
            const sign = delta >= 0 ? '+' : '-';
            splitDelta.textContent = sign + (Math.abs(delta) / 1000).toFixed(2);
            splitDelta.className = delta >= 0 ? 'd up' : 'd down';
        }
    }

    function showCountdown(n) {
        const v = n | 0;
        if (!_countShown) { countWrap.hidden = false; _countShown = true; }
        if (v === _countN) return;
        _countN = v;
        const txt = v > 0 ? String(v) : 'GO!';
        countStroke.textContent = txt;
        countFace.textContent = txt;
        countCap.textContent = v > 0 ? 'Get ready' : '';
        countNum.classList.toggle('go', v <= 0);
        // Punch is decoration: restart the animation only when motion is allowed.
        countNum.classList.remove('punch');
        countRing.classList.remove('spin');
        if (!reduced()) {
            void countNum.offsetWidth; // force reflow so the animation replays
            countNum.classList.add('punch');
            countRing.classList.add('spin');
        }
    }

    function hideCountdown() {
        if (!_countShown) return;
        _countShown = false;
        _countN = -999;
        countWrap.hidden = true;
        countNum.classList.remove('punch');
        countRing.classList.remove('spin');
    }

    function showWrongWay(on) {
        const v = Boolean(on);
        if (v === _wrongOn) return;
        _wrongOn = v;
        wrong.hidden = !v;
        wrong.classList.toggle('anim', v && !reduced());
    }

    // ---- results ----------------------------------------------------------
    /** Row labels/values are built from mode state, but they still land in
     *  innerHTML, so they get escaped rather than trusted. */
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function rowTime(row) {
        if (!row) return null;
        if (Number.isFinite(row.totalMs)) return row.totalMs;
        if (Number.isFinite(row.time)) return row.time;
        if (Number.isFinite(row.ms)) return row.ms;
        return null;
    }
    function fmt(ms) {
        if (!Number.isFinite(ms) || ms < 0) return '--:--.--';
        const t = Math.floor(ms);
        const m = Math.floor(t / 60000);
        const s = Math.floor(t / 1000) % 60;
        const c = Math.floor((t % 1000) / 10);
        return m + ':' + (s < 10 ? '0' + s : s) + '.' + (c < 10 ? '0' + c : c);
    }

    /**
     * @param {Array<{name?, place?, position?, isPlayer?, color?, totalMs?, laps?}>} rows
     */
    function showResults(rows) {
        const list = Array.isArray(rows) ? rows : [];
        let me = null;
        for (let i = 0; i < list.length; i++) {
            if (list[i] && (list[i].isPlayer || list[i].player || list[i].index === 0)) { me = list[i]; break; }
        }
        if (!me && list.length) me = list[0];

        // The card is shared with showModeResults, so the race path restores
        // everything the mini-game path repurposes.
        resKicker.textContent = 'Race complete';
        resTotLab.textContent = 'Total';
        resBest.hidden = true;

        const place = me && Number.isFinite(me.place) ? me.place
            : me && Number.isFinite(me.position) ? me.position
                : (list.indexOf(me) + 1) || 1;
        resPlaceNum.textContent = place;
        resPlaceSuffix.textContent = ordinalSuffix(place);
        resPlace.className = 'vh-res-place p' + (place >= 1 && place <= 4 ? place : 4);
        const total = rowTime(me);
        resTotal.textContent = fmt(total);

        // Per-lap splits for the player, best lap highlighted.
        const laps = (me && Array.isArray(me.laps)) ? me.laps : [];
        let best = Infinity;
        for (let i = 0; i < laps.length; i++) if (Number.isFinite(laps[i]) && laps[i] < best) best = laps[i];
        let html = '';
        for (let i = 0; i < laps.length; i++) {
            const ms = laps[i];
            const isBest = Number.isFinite(ms) && ms === best;
            const d = (i > 0 && Number.isFinite(ms) && Number.isFinite(laps[i - 1])) ? ms - laps[i - 1] : null;
            const dTxt = d === null ? '' : (d >= 0 ? '+' : '-') + (Math.abs(d) / 1000).toFixed(2);
            const dCls = d === null ? 'd' : (d >= 0 ? 'd up' : 'd down');
            html += `<div class="vh-res-row${isBest ? ' best' : ''}">`
                + `<span class="n">Lap ${i + 1}${isBest ? ' &#9733;' : ''}</span>`
                + `<span class="t">${fmt(ms)}</span><span class="${dCls}">${dTxt}</span></div>`;
        }
        if (!laps.length) {
            html = '<div class="vh-res-row"><span class="n">Lap splits</span><span class="t">--:--.--</span></div>';
        }
        resLaps.innerHTML = html;

        // The field.
        let field = '';
        for (let i = 0; i < list.length; i++) {
            const r = list[i] || {};
            const p = Number.isFinite(r.place) ? r.place : Number.isFinite(r.position) ? r.position : i + 1;
            const isMe = r === me;
            const colour = r.color || RACER_COLORS[(Number.isFinite(r.index) ? r.index : i) % RACER_COLORS.length];
            field += `<div class="vh-res-row${isMe ? ' mine' : ''}"><span class="p">`
                + `<span class="dot" style="background:${colour}"></span>`
                + `<span class="n">${p}${ordinalSuffix(p).toLowerCase()}</span>`
                + `<span class="${isMe ? 'me' : ''}">${r.name || (isMe ? 'You' : 'Rival ' + (i + 1))}</span>`
                + `</span><span class="t">${fmt(rowTime(r))}</span></div>`;
        }
        resField.innerHTML = field;

        _shareText = 'Birb Gauntlet — finished ' + place + ordinalSuffix(place).toLowerCase()
            + ' on the sky circuit in ' + fmt(total) + '.';
        shareBtn.textContent = 'Share result';

        results.hidden = false;
        _resultsOn = true;
        resCard.classList.remove('pop');
        if (!reduced()) { void resCard.offsetWidth; resCard.classList.add('pop'); }
    }

    /**
     * Results for a mode that has no field and no lap splits.
     *
     * Same card, different contents — a mini-game reports ONE headline number
     * and a couple of stat rows, and forcing that through the race's
     * place/field/lap-split shape is how you end up with "1st" printed over a
     * solo Ring Rush run and an empty rival table underneath it.
     *
     * @param {object} o
     * @param {string} o.kicker        tab text, e.g. 'Ring Rush complete'
     * @param {string} o.badge         the big number/word in the badge
     * @param {string} [o.badgeSmall]  superscript inside the badge
     * @param {number} [o.badgeTone]   1..4, picks the badge colour
     * @param {string} o.totalLabel    label beside the headline value
     * @param {string} o.totalText     the headline value, pre-formatted
     * @param {boolean} [o.isNewBest]
     * @param {string} [o.bestText]    e.g. 'Best 0:42.10'
     * @param {Array<{label,value}>} [o.rows]
     * @param {string} [o.shareText]
     */
    function showModeResults(o) {
        const opts = o || {};
        resKicker.textContent = opts.kicker || 'Run complete';

        resPlaceNum.textContent = opts.badge == null ? '' : String(opts.badge);
        resPlaceSuffix.textContent = opts.badgeSmall || '';
        const tone = Number.isFinite(opts.badgeTone) ? opts.badgeTone : 1;
        resPlace.className = 'vh-res-place p' + (tone >= 1 && tone <= 4 ? tone : 1);

        resTotLab.textContent = opts.totalLabel || 'Result';
        resTotal.textContent = opts.totalText == null ? '--' : String(opts.totalText);

        if (opts.isNewBest || opts.bestText) {
            resBest.hidden = false;
            resBest.textContent = opts.isNewBest
                ? ('New best' + (opts.bestText ? ' — ' + opts.bestText : '') + ' ★')
                : opts.bestText;
        } else {
            resBest.hidden = true;
        }

        const rows = Array.isArray(opts.rows) ? opts.rows : [];
        let html = '';
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i] || {};
            html += '<div class="vh-res-row"><span class="n">' + esc(r.label)
                + '</span><span class="t">' + esc(r.value) + '</span></div>';
        }
        resLaps.innerHTML = html;
        resField.innerHTML = '';

        _shareText = opts.shareText
            || ('Birb Gauntlet — ' + (opts.kicker || 'run') + ': ' + (opts.totalText || ''));
        shareBtn.textContent = 'Share result';

        results.hidden = false;
        _resultsOn = true;
        resCard.classList.remove('pop');
        if (!reduced()) { void resCard.offsetWidth; resCard.classList.add('pop'); }
    }

    /**
     * The single contextual action. `label` of null hides the button.
     *
     * Called every frame from the loop, so it early-outs on an unchanged label
     * — reassigning textContent on a live DOM node 60 times a second is a
     * layout invalidation the phone does not need.
     */
    function setAction(label, tone) {
        if (label === _actionLabel) return;
        _actionLabel = label;
        if (label == null) { actionBtn.hidden = true; return; }
        actionBtn.textContent = label;
        actionBtn.classList.toggle('calm', tone === 'calm');
        actionBtn.hidden = false;
    }

    /** Who to call when the action button is tapped. */
    function onAction(fn) {
        _onAction = typeof fn === 'function' ? fn : null;
    }

    /** Wire the Retry / Menu buttons. Passing null hides that button. */
    function setResultsActions(handlers) {
        const h = handlers || {};
        _onRetry = typeof h.onRetry === 'function' ? h.onRetry : null;
        _onMenu = typeof h.onMenu === 'function' ? h.onMenu : null;
        retryBtn.hidden = !_onRetry;
        menuBtn.hidden = !_onMenu;
        resActions.hidden = !_onRetry && !_onMenu;
    }

    function hideResults() {
        if (!_resultsOn) return;
        _resultsOn = false;
        results.hidden = true;
        resCard.classList.remove('pop');
    }

    function onShare() {
        const payload = { title: 'Birb Gauntlet', text: _shareText, url: win.location ? win.location.href : undefined };
        try {
            if (win.navigator && win.navigator.share) {
                win.navigator.share(payload).catch(() => { });
                return;
            }
            if (win.navigator && win.navigator.clipboard) {
                win.navigator.clipboard.writeText(_shareText + ' ' + (payload.url || '')).then(() => {
                    shareBtn.textContent = 'Copied!';
                }, () => { shareBtn.textContent = 'Copy failed'; });
                return;
            }
        } catch { /* fall through */ }
        shareBtn.textContent = 'Copied!';
    }
    shareBtn.addEventListener('click', onShare);

    function resize() { sizeMap(); }

    function dispose() {
        shareBtn.removeEventListener('click', onShare);
        if (motionMq) {
            if (motionMq.removeEventListener) motionMq.removeEventListener('change', applyMotion);
            else if (motionMq.removeListener) motionMq.removeListener(applyMotion);
        }
        [tl, tr, countWrap, wrong, actionBtn, results].forEach((n) => { if (n.parentNode) n.parentNode.removeChild(n); });
        rootEl.classList.remove('gauntlet-hud', 'vh-reduce');
        if (ownsStyle && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
        _srcRef = null;
        _gatePos = null;
    }

    return {
        setLap,
        setPosition,
        setRings,
        setClock,
        setScore,
        setCombo,
        setWave,
        setLives,
        setModeChrome,
        setSpeed,
        setSplit,
        setGate,
        showCountdown,
        hideCountdown,
        showWrongWay,
        setAction,
        onAction,
        showResults,
        showModeResults,
        setResultsActions,
        hideResults,
        minimap: { update: drawMap, resize },
        resize,
        dispose,
        /** Exposed for the probe page / integrator debugging. */
        elements: { root: rootEl, results, countdown: countWrap, wrongWay: wrong, mapCanvas },
    };
}

export default createHUD;
