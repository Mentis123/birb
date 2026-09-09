/**
 * src/ui/dev-quality-panel.js — performance workbench.
 *
 * Wave 2 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4, implementing
 * docs/perf/CONTRACT.md §3 (telemetry field table + sentinel protocol), §6
 * (RULING — the panel registers on the PRODUCTION path) and §7 (precedence +
 * the routing register).
 *
 * ---------------------------------------------------------------------------
 * P2.3a (shell) / P2.3b (this task) SPLIT
 * ---------------------------------------------------------------------------
 * P2.3a built the mount/open/close lifecycle, the three-view registry and a
 * render-on-tick loop that stubs every telemetry field with its sentinel.
 * P2.3b (this file, now) adds:
 *   - CONTROL_REGISTRY: the actual interactive controls (mode buttons,
 *     target rate, DPR slider, post quality + shafts + bloom strength,
 *     weather/mist/decorative density, surface detail) and the DOM/wiring to
 *     drive them, dispatched through one injected `onRequest(request)`.
 *   - `getControlState()` — a second injected accessor (distinct from
 *     `getTelemetry()`) so controls can show what they are CURRENTLY set to,
 *     independent of the read-only telemetry rows.
 *   - `getEvidence()` — the raw materials for the evidence export; this file
 *     wraps it in a schema envelope (schemaVersion, capturedAtMs, the full
 *     telemetry dump) and owns the actual export/compare actions.
 * The shell's own structure (FIELD_REGISTRY, the sentinel protocol, the 4Hz
 * tick, the open/close event contract) is unchanged — this task extends it,
 * per its own docstring, "without restructuring this file".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REGISTERS UNCONDITIONALLY (CONTRACT §6)
 * ---------------------------------------------------------------------------
 * `window.__BIRB` only exists under `?debug`, and every harness in this repo
 * loads the page with `?debug=1`. A panel built inside that block would pass
 * every automated check while being UNREACHABLE at the one URL it exists to
 * be used on — the phone, at the production domain, mid-flight. So this
 * module's `mount()` is called unconditionally from index.html, its DOM is
 * built and attached immediately (hidden via the `hidden` attribute), and
 * `?debug` never gates it. `?debug` still gates only the scriptable
 * `window.__BIRB` handle, exactly as before.
 *
 * ---------------------------------------------------------------------------
 * WHY TELEMETRY (AND CONTROL STATE) UPDATES AT 4 Hz, NEVER PER FRAME (§3.4)
 * ---------------------------------------------------------------------------
 * "Update panel telemetry about four times per second; avoid per-frame DOM
 * work" — the "no per-frame DOM write" half is a hard rule: instrumentation
 * that manufactures the bottleneck invalidates every measurement taken with
 * the panel open. The tick loop is a plain `setInterval`, runs only while the
 * panel is open, and is torn down on close.
 *
 * Sliders are the one control that COULD generate per-frame DOM/request
 * traffic if wired naively (dragging fires many `input` events). They do
 * not: the local readout text updates immediately on `input` (cheap text
 * mutation, matches the user's finger), but the actual `onRequest` call is
 * throttled to at most one per `COMMIT_THROTTLE_MS`, with a final commit
 * forced on `change` (pointer-up) so the very last position is never lost to
 * the throttle window ("Sliders commit at intervals, not per input event").
 *
 * ---------------------------------------------------------------------------
 * THE SENTINEL PROTOCOL (CONTRACT §3.1) — every field, no exceptions here
 * ---------------------------------------------------------------------------
 * `{ value: null, state: 'unavailable', reason: <closed enum> }` is the ONLY
 * representation for "no source". A field this shell has no entry for in the
 * telemetry supplied by `getTelemetry()` renders its registry default
 * sentinel — never `0`, `-1`, bare `null`, or a value re-derived from intent.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROLS ARE NEVER LABELS (G2b's STOP condition)
 * ---------------------------------------------------------------------------
 * Every enabled control here calls `onRequest(...)` and nothing else — this
 * file has no rendering side effect of its own. index.html's `onRequest`
 * implementation is what actually calls into `quality-settings.js` and the
 * single sizing function (CONTRACT §7). A control this module cannot verify
 * is wired to anything (surface detail: no runtime variant exists at all —
 * DEF-4; target rate: only 60 ships — DEF-3) is rendered DISABLED with its
 * reason visible, never as an interactive control that quietly does
 * nothing — a disabled control with a stated reason is honest; an enabled
 * one wired to nothing is the exact defect this workbench exists to catch.
 */

/** CONTRACT §3.1 — the closed reason enum. Adding to this list is a gate decision. */
export const SENTINEL_REASONS = Object.freeze({
  NOT_IMPLEMENTED: 'not-implemented',
  NO_EXTENSION: 'no-extension',
  NO_CONTEXT: 'no-context',
  DISJOINT: 'disjoint',
  INSUFFICIENT_SAMPLES: 'insufficient-samples',
  PAUSED: 'paused',
  NOT_APPLICABLE: 'not-applicable',
  STALE: 'stale',
});

/** The one legal shape for "there is no source for this field yet". */
export function sentinel(reason = SENTINEL_REASONS.NOT_IMPLEMENTED) {
  return Object.freeze({ value: null, state: 'unavailable', reason });
}

export const PANEL_VIEWS = Object.freeze({
  PERFORMANCE: 'performance',
  LOOK: 'look',
  CAPTURE: 'capture',
});

const VIEW_ORDER = [PANEL_VIEWS.PERFORMANCE, PANEL_VIEWS.LOOK, PANEL_VIEWS.CAPTURE];
const VIEW_LABELS = {
  [PANEL_VIEWS.PERFORMANCE]: 'Performance',
  [PANEL_VIEWS.LOOK]: 'Look',
  [PANEL_VIEWS.CAPTURE]: 'Capture',
};

/**
 * FIELD_REGISTRY — every field named by CONTRACT §3.2 (TEL-*) and §3.3
 * (PNL-*), assigned to the view it reads most naturally under.
 *
 * `defaultReason` is this module's OWN sentinel reason: it renders whenever
 * `getTelemetry()` supplies no entry for that field id. index.html's real
 * supplier now covers most of §3.2's W0/W2 rows for real (TEL-1/2/3/5-12/
 * 16-20); TEL-13/14/15 and all six PNL-* rows stay sentinel until Wave 3
 * (the controller, the mode concept, and the learning loop respectively) —
 * exactly as CONTRACT §3.3 requires ("a panel that ships in Wave 2 must show
 * them as sentinels rather than omitting them").
 */
export const FIELD_REGISTRY = Object.freeze([
  { id: 'TEL-1', label: 'Delivered FPS', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-2', label: 'p50 / p95 / p99 frame interval', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-3', label: 'Missed-target-frame %', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-4', label: 'CPU update / render-submission time', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-5', label: 'GPU time', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-6', label: 'Drawing-buffer pixels', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-7', label: 'Effective render DPR / native-resolution %', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-8', label: 'Scene calls / triangles', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-9', label: 'Total calls / triangles / passes', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-10', label: 'Program count', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-11', label: 'Resource counts (geometries / textures)', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-12', label: 'Estimated owned render-target memory', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-13', label: 'Last adjustment / reason', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-14', label: 'Cooldown', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-15', label: 'Active mode', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-16', label: 'Pinned state', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-17', label: 'Bloom / post target dimensions + downscale', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-18', label: 'Requested vs. effective pixel ratio', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-19', label: 'Stats path taken', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-20', label: 'Build identity', view: PANEL_VIEWS.CAPTURE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'PNL-1', label: 'Last hypothesis', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'PNL-2', label: 'Measured outcome', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'PNL-3', label: 'Confidence', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'PNL-4', label: 'Recent decisions', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'PNL-5', label: 'Learning on/off + reset profile', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'PNL-6', label: 'Export evidence', view: PANEL_VIEWS.CAPTURE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
]);

/**
 * CONTROL_REGISTRY — the interactive levers, per PERFORMANCE_REALISM_PLAN's
 * control table (CTL-1..8) and CONTRACT §10 PRO-9. Each entry names its
 * `requestKey` (the key `qualitySettings.request({source:'panel', key, ...})`
 * uses on the index.html side) or, for `kind: 'action'`/`'mode'`, the action
 * name dispatched through `onRequest`.
 *
 * `disabled: true` entries are RENDERED, never omitted (an absent row reads
 * as "not part of the product" — the same reasoning CONTRACT §3.3 gives for
 * sentinel telemetry rows) but are inert: no `onRequest` call is ever made
 * for them, because no rendering target exists to wire them to yet.
 */
export const CONTROL_REGISTRY = Object.freeze([
  // ---- Performance view: mode + the levers that trade cost for headroom ----
  {
    id: 'mode', view: PANEL_VIEWS.PERFORMANCE, kind: 'buttons', label: 'Mode',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'manual', label: 'Manual' },
      { value: 'benchmark', label: 'Benchmark' },
    ],
  },
  {
    id: 'resumeAuto', view: PANEL_VIEWS.PERFORMANCE, kind: 'action', label: 'Resume Auto',
    hint: "Clears stale history (CONTRACT §2.1 'manual' tag) and un-pins the adaptive tier.",
  },
  {
    id: 'targetRate', view: PANEL_VIEWS.PERFORMANCE, kind: 'select', label: 'Target rate',
    options: [{ value: '60', label: '60 fps' }],
    disabled: true,
    disabledReason: 'DEF-3: 30/90/120 deferred — no real pacing mechanism exists, and iOS caps rAF at 60 Hz anyway.',
  },
  {
    id: 'weatherDensity', view: PANEL_VIEWS.PERFORMANCE, kind: 'slider', label: 'Weather density',
    min: 0, max: 1, step: 0.05, requestKey: 'weatherDensity',
  },
  {
    id: 'mistBudget', view: PANEL_VIEWS.PERFORMANCE, kind: 'slider', label: 'Mist budget',
    min: 0, max: 1, step: 0.05, requestKey: 'mistBudget',
  },
  {
    id: 'decorativeDensity', view: PANEL_VIEWS.PERFORMANCE, kind: 'slider',
    label: 'Decorative density (wind / contact shadow / ribbons)',
    min: 0, max: 1, step: 0.05, requestKey: 'decorativeDensity',
  },

  // ---- Look view: render-cost-vs-fidelity dials ----
  {
    id: 'dpr', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Render DPR',
    min: 0.85, max: 2.0, step: 0.05, requestKey: 'dpr',
  },
  {
    id: 'postQuality', view: PANEL_VIEWS.LOOK, kind: 'select', label: 'Post quality',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'quarter', label: 'Quarter' },
      { value: 'half', label: 'Half' },
    ],
    requestKey: 'postQuality',
  },
  {
    id: 'shafts', view: PANEL_VIEWS.LOOK, kind: 'toggle', label: 'Light shafts',
    requestKey: 'shafts',
  },
  {
    id: 'bloomStrength', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Bloom strength',
    min: 0, max: 2, step: 0.05, requestKey: 'bloomStrength',
  },
  {
    id: 'surfaceDetail', view: PANEL_VIEWS.LOOK, kind: 'select', label: 'Surface detail',
    options: [{ value: 'baseline', label: 'Baseline' }],
    disabled: true,
    disabledReason: 'DEF-4: no runtime variant switch exists on the ground shader — ships baseline only.',
  },

  // ---- Capture view: evidence ----
  {
    id: 'compare', view: PANEL_VIEWS.CAPTURE, kind: 'action', label: 'Snapshot for A/B compare',
    hint: 'First tap captures A; second captures B and shows what changed.',
  },
  {
    id: 'export', view: PANEL_VIEWS.CAPTURE, kind: 'action', label: 'Export evidence JSON',
  },
  {
    id: 'reset', view: PANEL_VIEWS.CAPTURE, kind: 'action', label: 'Reset overrides + history',
    hint: "Same as Resume Auto, plus clears every panel override back to tier-derived defaults.",
  },
]);

const DEFAULT_OPEN_EVENT = 'birb:dev-panel-open';
const DEFAULT_CLOSE_EVENT = 'birb:dev-panel-close';
const DEFAULT_UPDATE_HZ = 4;
const COMMIT_THROTTLE_MS = 150;
const STYLE_ELEMENT_ID = 'birb-dev-quality-panel-style';
const ROOT_ELEMENT_ID = 'birb-dev-quality-panel';
const EXPORT_SCHEMA_VERSION = 1;

const STYLE_TEXT = `
#${ROOT_ELEMENT_ID} {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: rgba(12, 14, 18, 0.94);
  color: #e8ecf1;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  border-top: 1px solid rgba(255,255,255,0.14);
  border-radius: 14px 14px 0 0;
  z-index: 999999;
  touch-action: none;
  box-shadow: 0 -8px 24px rgba(0,0,0,0.4);
}
#${ROOT_ELEMENT_ID}[hidden] { display: none; }
#${ROOT_ELEMENT_ID} .bqp-tabs {
  display: flex;
  flex: 0 0 auto;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
#${ROOT_ELEMENT_ID} .bqp-tab {
  flex: 1 1 0;
  padding: 12px 4px;
  min-height: 44px;
  background: transparent;
  border: none;
  color: #9aa4b2;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
#${ROOT_ELEMENT_ID} .bqp-tab[aria-selected="true"] {
  color: #fff;
  box-shadow: inset 0 -2px 0 #4fc3f7;
}
#${ROOT_ELEMENT_ID} .bqp-close {
  flex: 0 0 auto;
  width: 44px;
  min-height: 44px;
  background: transparent;
  border: none;
  color: #9aa4b2;
  font-size: 18px;
}
#${ROOT_ELEMENT_ID} .bqp-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px 14px 20px;
  -webkit-overflow-scrolling: touch;
}
#${ROOT_ELEMENT_ID} .bqp-section-title {
  margin: 14px 0 4px;
  color: #6b7280;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
#${ROOT_ELEMENT_ID} .bqp-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
#${ROOT_ELEMENT_ID} .bqp-row-label { color: #9aa4b2; }
#${ROOT_ELEMENT_ID} .bqp-row-value { color: #e8ecf1; font-variant-numeric: tabular-nums; text-align: right; }
#${ROOT_ELEMENT_ID} .bqp-row-value.bqp-unavailable { color: #6b7280; font-style: italic; }
#${ROOT_ELEMENT_ID} .bqp-control {
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
#${ROOT_ELEMENT_ID} .bqp-control-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
#${ROOT_ELEMENT_ID} .bqp-control-label { color: #cbd3dd; }
#${ROOT_ELEMENT_ID} .bqp-control-readout { color: #4fc3f7; font-variant-numeric: tabular-nums; }
#${ROOT_ELEMENT_ID} .bqp-control input[type="range"] { width: 100%; }
#${ROOT_ELEMENT_ID} .bqp-control select {
  width: 100%;
  min-height: 36px;
  background: #1b1f27;
  color: #e8ecf1;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  padding: 4px 8px;
}
#${ROOT_ELEMENT_ID} .bqp-buttons { display: flex; gap: 6px; }
#${ROOT_ELEMENT_ID} .bqp-btn {
  flex: 1 1 0;
  min-height: 36px;
  background: #1b1f27;
  color: #cbd3dd;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  font-size: 13px;
}
#${ROOT_ELEMENT_ID} .bqp-btn[aria-pressed="true"] {
  background: #234559;
  color: #fff;
  border-color: #4fc3f7;
}
#${ROOT_ELEMENT_ID} .bqp-action-btn {
  width: 100%;
  min-height: 40px;
  background: #1b1f27;
  color: #e8ecf1;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
}
#${ROOT_ELEMENT_ID} .bqp-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
#${ROOT_ELEMENT_ID} .bqp-hint, #${ROOT_ELEMENT_ID} .bqp-disabled-note {
  color: #6b7280;
  font-size: 11px;
  margin-top: 3px;
}
#${ROOT_ELEMENT_ID} .bqp-control[data-disabled="true"] { opacity: 0.55; }
#${ROOT_ELEMENT_ID} .bqp-compare-diff {
  margin-top: 8px;
  padding: 8px;
  background: rgba(255,255,255,0.04);
  border-radius: 8px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
#${ROOT_ELEMENT_ID} .bqp-stale-banner {
  flex: 0 0 auto;
  padding: 8px 14px;
  background: #5c1f1f;
  color: #ffd7d7;
  font-size: 12px;
  font-weight: 600;
}
#${ROOT_ELEMENT_ID} .bqp-stale-banner[hidden] { display: none; }
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = STYLE_TEXT;
  doc.head.appendChild(style);
}

/** Render one field's current value into display text. Sentinel-safe. */
function displayFieldValue(entry) {
  if (entry && entry.state === 'unavailable') {
    return { text: 'unavailable', unavailable: true };
  }
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'value')) {
    const v = entry.value;
    return { text: v === null || v === undefined ? 'unavailable' : String(v), unavailable: v === null || v === undefined };
  }
  return { text: 'unavailable', unavailable: true };
}

function formatNumber(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

/**
 * createDevQualityPanel — factory for the panel.
 *
 * @param {Object} [opts]
 *   doc                — injected `document` (defaults to the global).
 *   getTelemetry()      — returns a plain object keyed by FIELD_REGISTRY id,
 *                         e.g. `{ 'TEL-1': { value: 58, state: 'ok' } }`.
 *                         Fields it does not mention render their registry
 *                         sentinel.
 *   getControlState()   — returns a plain object keyed by CONTROL_REGISTRY
 *                         id, e.g. `{ dpr: { requested: 1.2, effective: 1.2 },
 *                         mode: 'auto', shafts: { requested: true,
 *                         effective: true } }`. Absent/omitted keys render
 *                         the control at its declared default position.
 *   getEvidence()        — returns the raw materials for an evidence export
 *                         (device/build/mode/requested/effective/timing/
 *                         gates — whatever index.html assembles). This
 *                         module wraps it in the schema envelope and owns
 *                         serialisation; it does not require this shape.
 *   onRequest(request)   — called for every control interaction. Shapes:
 *                           { kind: 'mode', mode }
 *                           { kind: 'control', key, value }
 *                           { kind: 'action', action }  (resumeAuto/reset/
 *                             export/compare — export/compare are also
 *                             handled locally for the DOM/Blob part, but
 *                             onRequest still fires so index.html can log
 *                             or gate them)
 *   openEventName / closeEventName — CustomEvent names on `document`.
 *   updateHz            — telemetry/control refresh rate while open. Default 4.
 *   setInterval / clearInterval — injectable for tests.
 *   now()               — injectable clock for the slider commit throttle.
 *   onOpen / onClose    — optional lifecycle callbacks.
 *
 * @returns {Object}
 *   .mount() / .open() / .close() / .isOpen() / .setView(id) / .getView() / .destroy()
 */
export function createDevQualityPanel(opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    throw new Error('createDevQualityPanel requires a document (browser environment or injected `doc`)');
  }

  const getTelemetry = typeof opts.getTelemetry === 'function' ? opts.getTelemetry : () => ({});
  const getControlState = typeof opts.getControlState === 'function' ? opts.getControlState : () => ({});
  const getEvidence = typeof opts.getEvidence === 'function' ? opts.getEvidence : () => ({});
  // SW-5: "stale === true renders a visible panel warning". Separate from
  // getEvidence() so it can be read every tick cheaply without re-running a
  // whole evidence build; index.html's implementation is just
  // `() => buildIdentity().stale`.
  const getBuildStale = typeof opts.getBuildStale === 'function' ? opts.getBuildStale : () => false;
  const onRequest = typeof opts.onRequest === 'function' ? opts.onRequest : () => {};
  const openEventName = opts.openEventName || DEFAULT_OPEN_EVENT;
  const closeEventName = opts.closeEventName || DEFAULT_CLOSE_EVENT;
  const updateHz = opts.updateHz || DEFAULT_UPDATE_HZ;
  const tickIntervalMs = Math.max(1, Math.round(1000 / updateHz));
  const setIntervalFn = opts.setInterval || setInterval;
  const clearIntervalFn = opts.clearInterval || clearInterval;
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const onOpen = typeof opts.onOpen === 'function' ? opts.onOpen : () => {};
  const onClose = typeof opts.onClose === 'function' ? opts.onClose : () => {};

  let mounted = false;
  let open = false;
  let timerId = null;
  let activeView = PANEL_VIEWS.PERFORMANCE;

  let root = null;
  let tabButtons = null; // view -> button element
  let bodyEl = null;
  let staleBanner = null;
  let rowValueEls = null; // field id -> value element
  let controlEls = null; // control id -> { el, readout?, wrap, kind }

  // A/B compare snapshots (in-session only — DEF-1 defers any persistence).
  let compareSnapshotA = null;
  let compareDiffEl = null;

  // Per-slider "last committed at" clock, so a drag commits at most once per
  // COMMIT_THROTTLE_MS rather than once per `input` event.
  const lastCommitAt = {};

  function buildDom() {
    ensureStyle(doc);

    root = doc.getElementById(ROOT_ELEMENT_ID);
    if (root) {
      root.hidden = true;
      return;
    }

    root = doc.createElement('div');
    root.id = ROOT_ELEMENT_ID;
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Performance workbench');

    const tabs = doc.createElement('div');
    tabs.className = 'bqp-tabs';
    tabButtons = {};
    for (const view of VIEW_ORDER) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'bqp-tab';
      btn.textContent = VIEW_LABELS[view];
      btn.setAttribute('aria-selected', String(view === activeView));
      btn.addEventListener('click', () => setView(view));
      tabs.appendChild(btn);
      tabButtons[view] = btn;
    }

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'bqp-close';
    closeBtn.setAttribute('aria-label', 'Close performance workbench');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => close());
    tabs.appendChild(closeBtn);

    staleBanner = doc.createElement('div');
    staleBanner.className = 'bqp-stale-banner';
    staleBanner.hidden = true;
    staleBanner.textContent =
      'Stale build: the service worker is serving a PREVIOUS build’s modules. Every number below is unreliable — hard-reload before measuring.';

    bodyEl = doc.createElement('div');
    bodyEl.className = 'bqp-body';

    root.appendChild(tabs);
    root.appendChild(staleBanner);
    root.appendChild(bodyEl);
    doc.body.appendChild(root);

    renderBody();
  }

  // -------------------------------------------------------------------------
  // Controls — build once per view render, update on tick (never rebuilt on
  // every tick: that would thrash focus/scroll position while dragging).
  // -------------------------------------------------------------------------

  function commitControl(control, value) {
    if (control.kind === 'toggle' || control.kind === 'select' || control.kind === 'buttons') {
      onRequest({ kind: 'control', key: control.requestKey, value });
      return;
    }
    // slider: throttled.
    const t = nowFn();
    const last = lastCommitAt[control.id] || 0;
    if (t - last < COMMIT_THROTTLE_MS) return;
    lastCommitAt[control.id] = t;
    onRequest({ kind: 'control', key: control.requestKey, value });
  }

  function forceCommitControl(control, value) {
    lastCommitAt[control.id] = 0;
    onRequest({ kind: 'control', key: control.requestKey, value });
  }

  function buildControl(control) {
    const wrap = doc.createElement('div');
    wrap.className = 'bqp-control';
    if (control.disabled) wrap.setAttribute('data-disabled', 'true');

    const head = doc.createElement('div');
    head.className = 'bqp-control-head';
    const label = doc.createElement('span');
    label.className = 'bqp-control-label';
    label.textContent = control.label;
    head.appendChild(label);

    let readoutEl = null;
    let inputEl = null;

    if (control.kind === 'slider') {
      readoutEl = doc.createElement('span');
      readoutEl.className = 'bqp-control-readout';
      head.appendChild(readoutEl);
      wrap.appendChild(head);

      inputEl = doc.createElement('input');
      inputEl.type = 'range';
      inputEl.min = String(control.min);
      inputEl.max = String(control.max);
      inputEl.step = String(control.step);
      inputEl.disabled = !!control.disabled;
      inputEl.addEventListener('input', () => {
        const v = Number.parseFloat(inputEl.value);
        if (readoutEl) readoutEl.textContent = formatNumber(v, 2);
        if (!control.disabled) commitControl(control, v);
      });
      inputEl.addEventListener('change', () => {
        const v = Number.parseFloat(inputEl.value);
        if (!control.disabled) forceCommitControl(control, v);
      });
      wrap.appendChild(inputEl);
    } else if (control.kind === 'select') {
      wrap.appendChild(head);
      inputEl = doc.createElement('select');
      inputEl.disabled = !!control.disabled;
      for (const opt of control.options) {
        const optionEl = doc.createElement('option');
        optionEl.value = String(opt.value);
        optionEl.textContent = opt.label;
        inputEl.appendChild(optionEl);
      }
      inputEl.addEventListener('change', () => {
        if (!control.disabled) commitControl(control, inputEl.value);
      });
      wrap.appendChild(inputEl);
    } else if (control.kind === 'toggle') {
      const row = doc.createElement('label');
      row.className = 'bqp-toggle-row';
      const toggleLabel = doc.createElement('span');
      toggleLabel.className = 'bqp-control-label';
      toggleLabel.textContent = control.label;
      inputEl = doc.createElement('input');
      inputEl.type = 'checkbox';
      inputEl.disabled = !!control.disabled;
      inputEl.addEventListener('change', () => {
        if (!control.disabled) commitControl(control, inputEl.checked);
      });
      row.appendChild(toggleLabel);
      row.appendChild(inputEl);
      wrap.appendChild(row);
    } else if (control.kind === 'buttons') {
      wrap.appendChild(head);
      const row = doc.createElement('div');
      row.className = 'bqp-buttons';
      const buttonEls = {};
      for (const opt of control.options) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'bqp-btn';
        btn.textContent = opt.label;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => onRequest({ kind: 'mode', mode: opt.value }));
        row.appendChild(btn);
        buttonEls[opt.value] = btn;
      }
      wrap.appendChild(row);
      inputEl = buttonEls; // map of value -> button, for tick() to update aria-pressed
    } else if (control.kind === 'action') {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'bqp-action-btn';
      btn.textContent = control.label;
      btn.addEventListener('click', () => handleAction(control));
      wrap.appendChild(btn);
      inputEl = btn;
    }

    if (control.disabled && control.disabledReason) {
      const note = doc.createElement('div');
      note.className = 'bqp-disabled-note';
      note.textContent = control.disabledReason;
      wrap.appendChild(note);
    } else if (control.hint) {
      const hint = doc.createElement('div');
      hint.className = 'bqp-hint';
      hint.textContent = control.hint;
      wrap.appendChild(hint);
    }

    if (control.id === 'compare') {
      compareDiffEl = doc.createElement('div');
      compareDiffEl.className = 'bqp-compare-diff';
      compareDiffEl.hidden = true;
      wrap.appendChild(compareDiffEl);
    }

    return { wrap, input: inputEl, readout: readoutEl, kind: control.kind };
  }

  function handleAction(control) {
    onRequest({ kind: 'action', action: control.id });
    if (control.id === 'export') {
      downloadEvidence();
    } else if (control.id === 'compare') {
      runCompareStep();
    } else if (control.id === 'reset' || control.id === 'resumeAuto') {
      // Local reflection only — index.html's onRequest handler does the
      // real work (qualitySettings.setMode('auto'), adaptiveTier.unpin(),
      // and, for 'reset', also clearing panelOverrides). The next tick()
      // picks up the real post-reset state from getControlState().
      if (compareDiffEl) { compareDiffEl.hidden = true; }
      compareSnapshotA = null;
    }
  }

  function buildEvidenceEnvelope() {
    const raw = getEvidence() || {};
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      capturedAtMs: Date.now(),
      ...raw,
      // Every FIELD_REGISTRY id is guaranteed present (sentinel or real),
      // which is what makes this export a SUPERSET of any narrower fixture
      // schema written against a subset of these fields.
      telemetry: collectTelemetrySnapshot(),
    };
  }

  function collectTelemetrySnapshot() {
    let telemetry;
    try {
      telemetry = getTelemetry() || {};
    } catch {
      telemetry = {};
    }
    const out = {};
    for (const field of FIELD_REGISTRY) {
      out[field.id] = Object.prototype.hasOwnProperty.call(telemetry, field.id)
        ? telemetry[field.id]
        : sentinel(field.defaultReason);
    }
    return out;
  }

  function downloadEvidence() {
    const evidence = buildEvidenceEnvelope();
    const json = JSON.stringify(evidence, null, 2);
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `birb-quality-${evidence.capturedAtMs}.json`;
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Blob/URL unavailable (a headless harness without full DOM support).
      // Exporting is best-effort UI sugar; the underlying data is already
      // reachable via getEvidence()/getTelemetry() for any harness that
      // needs it programmatically.
    }
  }

  function diffValues(a, b) {
    const lines = [];
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const av = a ? a[key] : undefined;
      const bv = b ? b[key] : undefined;
      if (JSON.stringify(av) !== JSON.stringify(bv)) {
        lines.push(`${key}: ${JSON.stringify(av)} -> ${JSON.stringify(bv)}`);
      }
    }
    return lines;
  }

  function runCompareStep() {
    const snapshot = buildEvidenceEnvelope();
    if (!compareSnapshotA) {
      compareSnapshotA = snapshot;
      if (compareDiffEl) {
        compareDiffEl.hidden = false;
        compareDiffEl.textContent = 'Snapshot A captured. Change a setting, then tap again to capture B.';
      }
      return;
    }
    const requestedDiff = diffValues(compareSnapshotA.requested, snapshot.requested);
    const effectiveDiff = diffValues(compareSnapshotA.effective, snapshot.effective);
    if (compareDiffEl) {
      compareDiffEl.hidden = false;
      const lines = [];
      lines.push(`A @ ${compareSnapshotA.capturedAtMs}  ->  B @ ${snapshot.capturedAtMs}`);
      lines.push(requestedDiff.length ? `requested changed:\n  ${requestedDiff.join('\n  ')}` : 'requested: unchanged');
      lines.push(effectiveDiff.length ? `effective changed:\n  ${effectiveDiff.join('\n  ')}` : 'effective: unchanged');
      compareDiffEl.textContent = lines.join('\n\n');
    }
    compareSnapshotA = null; // next tap starts a fresh A
  }

  function buildControlsForView(view) {
    controlEls = controlEls || {};
    for (const control of CONTROL_REGISTRY) {
      if (control.view !== view) continue;
      const built = buildControl(control);
      bodyEl.appendChild(built.wrap);
      controlEls[control.id] = { ...built, def: control };
    }
  }

  function renderBody() {
    if (!bodyEl) return;
    bodyEl.textContent = '';
    rowValueEls = {};
    controlEls = {};
    compareDiffEl = null;

    const hasControls = CONTROL_REGISTRY.some((c) => c.view === activeView);
    if (hasControls) {
      const title = doc.createElement('div');
      title.className = 'bqp-section-title';
      title.textContent = 'Controls';
      bodyEl.appendChild(title);
      buildControlsForView(activeView);

      const telemetryTitle = doc.createElement('div');
      telemetryTitle.className = 'bqp-section-title';
      telemetryTitle.textContent = 'Telemetry';
      bodyEl.appendChild(telemetryTitle);
    }

    for (const field of FIELD_REGISTRY) {
      if (field.view !== activeView) continue;
      const row = doc.createElement('div');
      row.className = 'bqp-row';

      const label = doc.createElement('span');
      label.className = 'bqp-row-label';
      label.textContent = field.label;

      const value = doc.createElement('span');
      value.className = 'bqp-row-value';

      row.appendChild(label);
      row.appendChild(value);
      bodyEl.appendChild(row);
      rowValueEls[field.id] = value;
    }
    tick(); // paint immediately so switching views never shows a blank frame
  }

  function setView(view) {
    if (!VIEW_ORDER.includes(view) || view === activeView) return;
    activeView = view;
    if (tabButtons) {
      for (const v of VIEW_ORDER) {
        tabButtons[v].setAttribute('aria-selected', String(v === view));
      }
    }
    renderBody();
  }

  /** One telemetry + control-state refresh. Text/attribute mutation only. */
  function tick() {
    if (staleBanner) {
      let stale = false;
      try { stale = !!getBuildStale(); } catch { stale = false; }
      staleBanner.hidden = !stale;
    }
    if (!rowValueEls) return;
    let telemetry;
    try {
      telemetry = getTelemetry() || {};
    } catch {
      telemetry = {};
    }
    for (const field of FIELD_REGISTRY) {
      const el = rowValueEls[field.id];
      if (!el) continue;
      const entry = Object.prototype.hasOwnProperty.call(telemetry, field.id)
        ? telemetry[field.id]
        : sentinel(field.defaultReason);
      const { text, unavailable } = displayFieldValue(entry);
      el.textContent = text;
      el.classList.toggle('bqp-unavailable', unavailable);
    }

    if (!controlEls) return;
    let controlState;
    try {
      controlState = getControlState() || {};
    } catch {
      controlState = {};
    }
    for (const [id, entry] of Object.entries(controlEls)) {
      const def = entry.def;
      const state = controlState[id];
      if (def.kind === 'buttons') {
        const currentMode = controlState.mode;
        for (const [value, btn] of Object.entries(entry.input)) {
          btn.setAttribute('aria-pressed', String(value === currentMode));
        }
      } else if (def.kind === 'slider') {
        if (state && Number.isFinite(state.effective) && doc.activeElement !== entry.input) {
          entry.input.value = String(state.effective);
          if (entry.readout) entry.readout.textContent = formatNumber(state.effective, 2);
        } else if (!state && entry.readout && !entry.readout.textContent) {
          entry.readout.textContent = formatNumber(Number.parseFloat(entry.input.value), 2);
        }
      } else if (def.kind === 'select') {
        if (state && state.effective !== undefined && doc.activeElement !== entry.input) {
          entry.input.value = String(state.effective);
        }
      } else if (def.kind === 'toggle') {
        if (state && typeof state.effective === 'boolean' && doc.activeElement !== entry.input) {
          entry.input.checked = state.effective;
        }
      }
    }
  }

  function handleOpenEvent() {
    openPanel();
  }

  function openPanel() {
    if (open) return;
    if (!mounted) mount();
    open = true;
    root.hidden = false;
    renderBody();
    if (timerId !== null) clearIntervalFn(timerId);
    timerId = setIntervalFn(tick, tickIntervalMs);
    onOpen();
  }

  function close() {
    if (!open) return;
    open = false;
    if (root) root.hidden = true;
    if (timerId !== null) {
      clearIntervalFn(timerId);
      timerId = null;
    }
    onClose();
    // Tell the gesture wiring the panel is gone so the three-finger hold can
    // open it again later in the same session (index.html un-latches its
    // `devPanelOpen` flag on this event — see CONTRACT §6.5 / dev-gesture.js).
    doc.dispatchEvent(new CustomEvent(closeEventName));
  }

  function mount() {
    if (mounted) return;
    buildDom();
    doc.addEventListener(openEventName, handleOpenEvent);
    mounted = true;
  }

  function destroy() {
    if (timerId !== null) {
      clearIntervalFn(timerId);
      timerId = null;
    }
    if (mounted) {
      doc.removeEventListener(openEventName, handleOpenEvent);
    }
    if (root && root.parentNode) {
      root.parentNode.removeChild(root);
    }
    root = null;
    bodyEl = null;
    staleBanner = null;
    rowValueEls = null;
    tabButtons = null;
    controlEls = null;
    compareSnapshotA = null;
    compareDiffEl = null;
    mounted = false;
    open = false;
  }

  return {
    mount,
    open: openPanel,
    close,
    isOpen: () => open,
    setView,
    getView: () => activeView,
    destroy,
  };
}
