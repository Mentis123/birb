/**
 * src/ui/dev-quality-panel.js — the quality panel.
 *
 * Three fingers held and released, the ` key, the ⚙ launcher or `?devpanel`
 * open it. It is the performance workbench of docs/ULTRACODE_PERFORMANCE_PLAN
 * §4 / docs/perf/CONTRACT.md §3, §6, §7 — telemetry, the request-routed
 * levers, the evidence export — rebuilt for the place it is actually used:
 * a phone, outdoors, mid-flight, with a thumb.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NOT CHANGE (the frozen oracle drives this DOM)
 * ---------------------------------------------------------------------------
 * tools/lib/quality-captures.mjs is hash-frozen in tools/oracle-manifest.txt
 * (R5) and drives this panel by:
 *   - `#birb-dev-quality-panel`, opened by the `birb:dev-panel-open`
 *     CustomEvent and read through its `hidden` property;
 *   - `.bqp-tab` buttons whose textContent is the view label ('Performance',
 *     'Look');
 *   - `.bqp-control` wrappers located by their `.bqp-control-label` text
 *     ('Render DPR' on Look; 'Weather density' and 'Decorative density (wind /
 *     contact shadow / ribbons)' on Performance), each containing an
 *     `input[type="range"]` that commits on real `input` + `change` events;
 *   - `.bqp-stale-banner`, hidden unless the build is stale.
 * Every one of those is preserved verbatim below. Move a slider to another
 * tab or reword one of those three labels and a green oracle goes red for a
 * cosmetic reason — the decorativeDensity entry's own comment records the
 * one time that nearly happened.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REGISTERS UNCONDITIONALLY (CONTRACT §6)
 * ---------------------------------------------------------------------------
 * `window.__BIRB` only exists under `?debug`, and every harness in this repo
 * loads the page with `?debug=1`. A panel built inside that block would pass
 * every automated check while being UNREACHABLE at the one URL it exists to
 * be used on — the phone, at the production domain, mid-flight. So `mount()`
 * is called unconditionally from index.html, the DOM is attached immediately
 * (hidden via the `hidden` attribute), and `?debug` never gates it.
 *
 * ---------------------------------------------------------------------------
 * WHY TELEMETRY UPDATES AT 4 Hz, NEVER PER FRAME (§3.4)
 * ---------------------------------------------------------------------------
 * Instrumentation that manufactures the bottleneck invalidates every
 * measurement taken with the panel open. The tick is a plain `setInterval`,
 * runs only while the panel is open, and is torn down on close. Sliders
 * update their own readout on every `input` event (cheap text mutation,
 * matches the finger) but the `onRequest` call is throttled to one per
 * `COMMIT_THROTTLE_MS`, with a final commit forced on `change` (pointer-up)
 * so the last position is never lost to the throttle window.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROLS ARE NEVER LABELS (G2b's STOP condition)
 * ---------------------------------------------------------------------------
 * Every enabled control calls `onRequest(...)` and nothing else — this file
 * has no rendering side effect of its own. index.html's handler is what
 * calls into quality-settings.js and the single sizing function (CONTRACT
 * §7). A control this module cannot verify is wired to anything is rendered
 * DISABLED with its reason visible, never as a live control that quietly
 * does nothing.
 *
 * ---------------------------------------------------------------------------
 * THE PRESET STRIP IS THE PRIMARY CONTROL NOW
 * ---------------------------------------------------------------------------
 * The owner's report that settled the layout: "when I go into the settings
 * and choose max realism it looks better — I want the best view as default
 * always on". So Ultra IS the old MAX REALISM lever set, it is the shipping
 * default, and the four presets (Ultra / Amazing / Okay / Light — the same
 * four the gear menu cycles) sit in the header of every tab, one tap each.
 * The MAX REALISM and BACK TO SHIPPING buttons are gone because they became
 * two of those four: Ultra, and Amazing (the baseline every lever is
 * measured against). The per-lever controls below the strip are for
 * finding out WHICH lever a phone cannot afford, not for reaching the top.
 */

import { BOOT_FLAGS, readBootFlag, withBootFlag, withoutBootFlags, anyBootFlagSet } from './boot-flags.js';

const win = typeof window !== 'undefined' ? window : null;

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

/**
 * The device's own pixel ratio, and the ceiling of the render-DPR control.
 *
 * Guarded because this module is imported under plain `node --test`, where
 * there is no window at all. Falls back to 2, a sane desktop-retina bound
 * rather than a value that would silently disable the control. Rendering
 * ABOVE native buys nothing: there are no pixels to put it in. So native is
 * the honest ceiling, and it is a real one — an iPhone reports 3.
 */
export function nativeDpr() {
  const r = (win && win.devicePixelRatio) || 0;
  return r > 0 ? Math.max(1, r) : 2;
}

export const PANEL_VIEWS = Object.freeze({
  PERFORMANCE: 'performance',
  LOOK: 'look',
  ULTRA: 'ultra',
  FLAGS: 'flags',
  CAPTURE: 'capture',
});

const VIEW_ORDER = [PANEL_VIEWS.PERFORMANCE, PANEL_VIEWS.LOOK, PANEL_VIEWS.ULTRA, PANEL_VIEWS.FLAGS, PANEL_VIEWS.CAPTURE];
const VIEW_LABELS = {
  [PANEL_VIEWS.PERFORMANCE]: 'Performance',
  [PANEL_VIEWS.LOOK]: 'Look',
  [PANEL_VIEWS.ULTRA]: 'Ultra',
  [PANEL_VIEWS.FLAGS]: 'Flags',
  [PANEL_VIEWS.CAPTURE]: 'Capture',
};

const VIEW_INTRO = {
  [PANEL_VIEWS.PERFORMANCE]:
    'What the frame costs and the levers that shed it. A preset up top sets all of this at once; these are for finding which one lever a phone cannot afford.',
  [PANEL_VIEWS.LOOK]:
    'Resolution, post and the colour grade. The grade is per biome: a change here follows THIS biome, not the one you fly to next.',
  [PANEL_VIEWS.ULTRA]:
    'The above-baseline levers. Ultra (the default) has every one of these at its ceiling; Amazing is the baseline they are measured against. Turn one off to see what it was buying.',
  [PANEL_VIEWS.FLAGS]:
    'Boot-time A/B switches. Tapping one RELOADS the game with that flag in the URL — your position is lost; the landmark (?goto) and biome (?env) are kept.',
  [PANEL_VIEWS.CAPTURE]:
    'Evidence. Export the full telemetry as JSON, or snapshot twice for a before/after diff.',
};

/** A FIELD_REGISTRY/CONTROL_REGISTRY entry's `view` may be one id or several. */
function matchesView(entryView, view) {
  return Array.isArray(entryView) ? entryView.includes(view) : entryView === view;
}

/**
 * FIELD_REGISTRY — every field named by CONTRACT §3.2 (TEL-*) and §3.3
 * (PNL-*), assigned to the view it reads most naturally under.
 *
 * `defaultReason` is this module's OWN sentinel reason: it renders whenever
 * `getTelemetry()` supplies no entry for that field id. TEL-13/14/15 and the
 * six PNL-* rows stay sentinel until the controller/mode/learning waves land
 * — CONTRACT §3.3: "a panel that ships must show them as sentinels rather
 * than omitting them".
 */
export const FIELD_REGISTRY = Object.freeze([
  { id: 'TEL-1', label: 'Delivered FPS', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-2', label: 'p50 / p95 / p99 frame interval', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-3', label: 'Missed-target-frame %', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-4', label: 'CPU update / render-submission time', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-5', label: 'GPU time', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-6', label: 'Drawing-buffer pixels', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-7', label: 'Effective render DPR / native-resolution %', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  // TEL-8/9/10 also render on the Ultra tab ("show the cost live" where the
  // above-baseline controls actually are, not on a tab the thumb has to
  // leave to check).
  { id: 'TEL-8', label: 'Scene calls / triangles', view: [PANEL_VIEWS.PERFORMANCE, PANEL_VIEWS.ULTRA], defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-9', label: 'Total calls / triangles / passes', view: [PANEL_VIEWS.PERFORMANCE, PANEL_VIEWS.ULTRA], defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-10', label: 'Program count', view: [PANEL_VIEWS.PERFORMANCE, PANEL_VIEWS.ULTRA], defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-11', label: 'Resource counts (geometries / textures)', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-12', label: 'Estimated owned render-target memory', view: PANEL_VIEWS.LOOK, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-13', label: 'Last adjustment / reason', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-14', label: 'Cooldown', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-15', label: 'Active mode', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-16', label: 'Pinned state', view: PANEL_VIEWS.PERFORMANCE, defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
  { id: 'TEL-17', label: 'Bloom / post target dimensions + downscale', view: [PANEL_VIEWS.LOOK, PANEL_VIEWS.ULTRA], defaultReason: SENTINEL_REASONS.NOT_IMPLEMENTED },
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
 * CONTROL_REGISTRY — the interactive levers. Each entry names its
 * `requestKey` (the key `qualitySettings.request({source:'panel', key, ...})`
 * uses on the index.html side) or, for `kind: 'action'`/`'mode'`, the action
 * dispatched through `onRequest`.
 *
 * A `select` with four options or fewer renders as a row of big buttons (a
 * native picker is two taps and a scroll on a phone; a row is one tap and
 * shows every choice). `short` on an option is its button text; `label` is
 * kept for the native `<select>` fallback and for readers.
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
    hint: 'Manual stops the adaptive tier writing anything the panel owns. Benchmark also freezes the sun.',
  },
  {
    id: 'resumeAuto', view: PANEL_VIEWS.PERFORMANCE, kind: 'action', label: 'Resume Auto',
    hint: "Clears stale history (CONTRACT §2.1 'manual' tag) and un-pins the adaptive tier.",
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
    // Stays on the Performance tab, NOT Ultra: tools/lib/quality-captures.mjs
    // (frozen, oracle-manifest.txt) drives this control by label right after
    // "Weather density" without switching tabs first (A10) — moving it would
    // break a passing oracle to serve a cosmetic grouping. Max is 1: the
    // Ascend gate measured 1.5 and 2.0 as a label (clamped to 1, and even
    // unclamped it only scales visualUniforms.wind).
    id: 'decorativeDensity', view: PANEL_VIEWS.PERFORMANCE, kind: 'slider',
    label: 'Decorative density (wind / contact shadow / ribbons)',
    min: 0, max: 1, step: 0.05, requestKey: 'decorativeDensity',
  },
  {
    id: 'targetRate', view: PANEL_VIEWS.PERFORMANCE, kind: 'select', label: 'Target rate',
    options: [{ value: '60', label: '60 fps', short: '60 fps' }],
    disabled: true,
    disabledReason: 'DEF-3: 30/90/120 deferred — no real pacing mechanism exists, and iOS caps rAF at 60 Hz anyway.',
  },

  // ---- Look view: resolution, post, and the per-biome grade ----
  {
    id: 'dpr', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Render DPR',
    // Max is the DEVICE's own pixel ratio, resolved at build time — 3.0 on
    // the iPhone this is built for.
    min: 0.85, max: nativeDpr(), step: 0.05, requestKey: 'dpr',
    hint: 'Ultra renders at native. Setting this pins the ratio; a preset tap hands it back to the tier.',
  },
  {
    id: 'postQuality', view: PANEL_VIEWS.LOOK, kind: 'select', label: 'Post quality',
    options: [
      { value: 'off', label: 'Off', short: 'Off' },
      { value: 'quarter', label: 'Quarter', short: '¼' },
      { value: 'half', label: 'Half', short: '½' },
      { value: 'full', label: 'Full (post at scene resolution)', short: 'Full' },
    ],
    requestKey: 'postQuality',
    hint: 'Bloom, light shafts and the vignette run at this fraction of the scene. Ultra is Full; the baseline is Half.',
  },
  {
    id: 'shafts', view: PANEL_VIEWS.LOOK, kind: 'toggle', label: 'Light shafts',
    requestKey: 'shafts',
  },
  {
    id: 'bloomStrength', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Bloom strength',
    min: 0, max: 2, step: 0.05, requestKey: 'bloomStrength',
    hint: 'Shipping is 0.78.',
  },
  {
    id: 'surfaceDetail', view: PANEL_VIEWS.LOOK, kind: 'select', label: 'Surface detail',
    options: [{ value: 'baseline', label: 'Baseline', short: 'Baseline' }],
    disabled: true,
    disabledReason: 'DEF-4: no runtime variant switch exists on the ground shader — ships baseline only.',
  },
  // Tone mapping / exposure / the bloom knee sit ABOVE each biome's own
  // light rig. index.html scopes a standing request PER BIOME
  // (gradeOverridesByBiome) — switching environment shows THAT biome's own
  // grade, never one carried over from whichever biome was on screen when
  // a slider was last moved.
  {
    id: 'tone', view: PANEL_VIEWS.LOOK, kind: 'select', label: 'Tone mapping', group: 'Grade (this biome)',
    options: [
      { value: 'neutral', label: 'Neutral (shipping)', short: 'Neutral' },
      { value: 'agx', label: 'AgX', short: 'AgX' },
      { value: 'aces', label: 'ACES Filmic', short: 'ACES' },
    ],
    requestKey: 'tone',
    hint: 'Changes what the bloom pass sees as bright — a different curve needs its own bloom threshold below to keep rings readable.',
  },
  {
    id: 'exposure', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Exposure', group: 'Grade (this biome)',
    min: 0.7, max: 1.8, step: 0.02, requestKey: 'exposure',
  },
  {
    id: 'bloomThreshold', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Bloom threshold', group: 'Grade (this biome)',
    min: 0.3, max: 1.2, step: 0.01, requestKey: 'bloomThreshold',
    hint: 'The tone-mapped luminance knee. Lower = more things glow. Shipping is 0.78 under Neutral.',
  },
  {
    id: 'gradeNextCandidate', view: PANEL_VIEWS.LOOK, kind: 'action', label: 'Next candidate grade', group: 'Grade (this biome)',
    hint: 'Cycles the same comparison set tools/birb-lighting.mjs --grades renders to a sheet, from a fixed baseline each tap.',
  },
  {
    id: 'copyGrade', view: PANEL_VIEWS.LOOK, kind: 'action', label: 'Copy grade', group: 'Grade (this biome)',
    hint: 'Copies {biome, tone, exposure, bloomThreshold} as one JSON line, ready to paste into a message.',
  },

  // ---- Ultra view: the above-baseline levers ----
  // Ultra (the shipping default preset) holds every one of these at its
  // ceiling. Amazing is the baseline. Each `requestKey` routes through the
  // SAME quality-settings apply()/readEffective()/clamp() precedence
  // (CONTRACT §7.1) as every other lever; this file has no rendering side
  // effect of its own for any of them.
  {
    id: 'shadowsEnabled', view: PANEL_VIEWS.ULTRA, kind: 'toggle', label: 'Real shadows (shadow map)',
    requestKey: 'shadowsEnabled',
    hint: 'On at Ultra. Off at every other preset — contact shadows are faked instead. Flipping it recompiles every material in the scene.',
  },
  {
    id: 'shadowType', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Shadow filter',
    options: [
      { value: 'basic', label: 'Basic (hard edge, cheapest)', short: 'Basic' },
      { value: 'pcf', label: 'PCF', short: 'PCF' },
      { value: 'vsm', label: 'VSM (softest)', short: 'VSM' },
    ],
    requestKey: 'shadowType',
    hint: 'Ultra is VSM, the softest. PCF is the cheaper real shadow.',
  },
  {
    id: 'shadowMapSize', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Shadow map size',
    options: [
      { value: 'low', label: 'Low (512px)', short: '512' },
      { value: 'medium', label: 'Medium (1024px)', short: '1024' },
      { value: 'high', label: 'High (2048px)', short: '2048' },
    ],
    requestKey: 'shadowMapSize',
  },
  {
    // `antialias` is a WebGL CONTEXT-CREATION flag — it cannot be toggled on
    // a live renderer, so this lever raises hardware MSAA on the bloom
    // pass's offscreen scene target instead (bloom-pass.js `setSamples`). A
    // device lacking EXT_color_buffer_float reports the effective sample
    // count back as 0 regardless of what is requested — an honest
    // requested-vs-effective desync, not a broken control.
    id: 'antialiasing', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Antialiasing (scene MSAA)',
    options: [
      { value: 'off', label: 'Off', short: 'Off' },
      { value: '2x', label: '2x', short: '2x' },
      { value: '4x', label: '4x', short: '4x' },
    ],
    requestKey: 'antialiasing',
    hint: 'Hardware MSAA on the scene target. Ultra is 4x.',
  },
  {
    id: 'anisotropy', view: PANEL_VIEWS.ULTRA, kind: 'slider', label: 'Anisotropic filtering',
    // 0 is the "back to shipping" sentinel (restores each texture's own
    // authored value), not a real GL level. 16 is a generic UI ceiling; the
    // request is clamped to THIS device's getMaxAnisotropy() on the
    // index.html side.
    min: 0, max: 16, step: 1, requestKey: 'anisotropy',
    hint: 'Sharper textures at grazing angles. 0 = each texture’s own authored value. Ultra is the device maximum.',
  },
  {
    id: 'terrainResolution', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Terrain mesh resolution',
    options: [
      { value: 'standard', label: 'Standard (112x72 mobile / 128x96 desktop)', short: 'Standard' },
      { value: 'high', label: 'High (160x104 / 192x128, +17-24k tris)', short: 'High' },
      { value: 'ultra', label: 'Ultra (208x136 / 256x168, +40-61k tris)', short: 'Ultra' },
    ],
    requestKey: 'terrainResolution',
    hint: 'Rebuilds the ground mesh on release. Real silhouette detail, not a filter. The Ultra preset uses High; Ultra alone exceeds the 80k triangle budget on desktop.',
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
    id: 'reset', view: PANEL_VIEWS.CAPTURE, kind: 'action', label: 'Reset to baseline (Amazing)',
    hint: 'Every lever back to the value a player who never opened this panel sees, tier handed back to the controller, history cleared. Same as tapping Amazing, without remembering it as your preference.',
  },
]);

const DEFAULT_OPEN_EVENT = 'birb:dev-panel-open';
const DEFAULT_CLOSE_EVENT = 'birb:dev-panel-close';
const DEFAULT_UPDATE_HZ = 4;
const COMMIT_THROTTLE_MS = 150;
const STYLE_ELEMENT_ID = 'birb-dev-quality-panel-style';
const ROOT_ELEMENT_ID = 'birb-dev-quality-panel';
const LAUNCHER_ID = 'birb-dev-quality-launcher';
const EXPORT_SCHEMA_VERSION = 1;
const SIZE_STORAGE_KEY = 'birbPanelSize';
/** How many options a select may have before it falls back to a native picker. */
const SEGMENTED_MAX_OPTIONS = 4;

/**
 * Mobile-first. Everything a thumb touches is at least 44 CSS px tall; the
 * sheet stops well short of the top of the screen so the world stays visible
 * while a slider moves (the panel's job is to change something and WATCH the
 * result); `touch-action` is scoped so the body scrolls vertically, sliders
 * own their own horizontal drag, and nothing reaches the joystick underneath.
 */
const STYLE_TEXT = `
#${ROOT_ELEMENT_ID} {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  max-height: var(--bqp-h, 48vh);
  display: flex;
  flex-direction: column;
  background: rgba(11, 13, 18, 0.95);
  color: #e8ecf1;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  border-top: 1px solid rgba(255,255,255,0.14);
  border-radius: 18px 18px 0 0;
  z-index: 999999;
  box-shadow: 0 -10px 30px rgba(0,0,0,0.45);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
#${ROOT_ELEMENT_ID}[hidden] { display: none; }
#${ROOT_ELEMENT_ID}[data-size="peek"] { --bqp-h: none; }
#${ROOT_ELEMENT_ID}[data-size="peek"] .bqp-body { display: none; }
#${ROOT_ELEMENT_ID}[data-size="compact"] { --bqp-h: 48vh; }
#${ROOT_ELEMENT_ID}[data-size="full"] { --bqp-h: 88vh; }
#${ROOT_ELEMENT_ID} * { box-sizing: border-box; }
#${ROOT_ELEMENT_ID} button { font: inherit; cursor: pointer; }
#${ROOT_ELEMENT_ID} .bqp-head { flex: 0 0 auto; padding: 6px 12px 0; }
#${ROOT_ELEMENT_ID} .bqp-grip {
  width: 40px; height: 4px; margin: 0 auto 6px;
  border-radius: 2px; background: rgba(255,255,255,0.28);
}
#${ROOT_ELEMENT_ID} .bqp-title-row {
  display: flex; align-items: center; gap: 8px; min-height: 40px;
}
#${ROOT_ELEMENT_ID} .bqp-title { font-weight: 700; font-size: 15px; letter-spacing: 0.01em; }
#${ROOT_ELEMENT_ID} .bqp-live {
  flex: 1 1 auto; color: #9aa4b2; font-size: 12px; font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#${ROOT_ELEMENT_ID} .bqp-size, #${ROOT_ELEMENT_ID} .bqp-close {
  flex: 0 0 auto; width: 44px; height: 44px; border-radius: 22px;
  background: rgba(255,255,255,0.06); border: 0; color: #e8ecf1; font-size: 17px;
}
#${ROOT_ELEMENT_ID} .bqp-close { font-size: 18px; color: #cbd3dd; }
#${ROOT_ELEMENT_ID} .bqp-presets {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 4px;
}
#${ROOT_ELEMENT_ID} .bqp-preset {
  min-height: 46px; border-radius: 12px; padding: 4px 2px;
  background: #171b23; color: #cbd3dd; border: 1px solid rgba(255,255,255,0.12);
  font-weight: 600; font-size: 14px;
}
#${ROOT_ELEMENT_ID} .bqp-preset[aria-pressed="true"] {
  background: #3a2a0f; color: #ffd9a0; border-color: #f0a742;
  box-shadow: 0 0 0 1px rgba(240,167,66,0.35) inset;
}
#${ROOT_ELEMENT_ID} .bqp-preset-hint {
  min-height: 18px; margin: 5px 2px 0; color: #9aa4b2; font-size: 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#${ROOT_ELEMENT_ID} .bqp-tabs {
  display: flex; margin-top: 4px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
#${ROOT_ELEMENT_ID} .bqp-tab {
  flex: 1 1 0; padding: 10px 2px; min-height: 44px;
  background: transparent; border: none; color: #9aa4b2;
  font-size: 13px; font-weight: 600; letter-spacing: 0.01em; white-space: nowrap;
}
#${ROOT_ELEMENT_ID} .bqp-tab[aria-selected="true"] { color: #fff; box-shadow: inset 0 -2px 0 #4fc3f7; }
#${ROOT_ELEMENT_ID} .bqp-stale-banner {
  flex: 0 0 auto; padding: 8px 14px;
  background: #5c1f1f; color: #ffd7d7; font-size: 12px; font-weight: 600;
}
#${ROOT_ELEMENT_ID} .bqp-stale-banner[hidden] { display: none; }
#${ROOT_ELEMENT_ID} .bqp-body {
  flex: 1 1 auto; overflow-y: auto; padding: 6px 12px 24px;
  -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior: contain;
}
#${ROOT_ELEMENT_ID} .bqp-view-intro {
  margin: 4px 0 8px; padding: 8px 10px; border-radius: 10px;
  background: rgba(79,195,247,0.08); border: 1px solid rgba(79,195,247,0.28);
  color: #bfe9fb; font-size: 12px; line-height: 1.35;
}
#${ROOT_ELEMENT_ID} .bqp-section-title {
  margin: 14px 0 4px; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
}
#${ROOT_ELEMENT_ID} .bqp-subsection-title {
  margin: 14px 0 2px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);
  color: #7fb8e0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
}
#${ROOT_ELEMENT_ID} .bqp-control {
  padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
}
#${ROOT_ELEMENT_ID} .bqp-control-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px;
}
#${ROOT_ELEMENT_ID} .bqp-control-label { color: #dfe5ec; font-weight: 500; }
#${ROOT_ELEMENT_ID} .bqp-control-readout { color: #4fc3f7; font-variant-numeric: tabular-nums; font-weight: 600; }
#${ROOT_ELEMENT_ID} .bqp-control input[type="range"] {
  width: 100%; height: 44px; margin: 0; background: transparent; touch-action: none;
  -webkit-appearance: none; appearance: none;
}
#${ROOT_ELEMENT_ID} .bqp-control input[type="range"]::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px; background: rgba(255,255,255,0.18);
}
#${ROOT_ELEMENT_ID} .bqp-control input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 28px; height: 28px; margin-top: -11px;
  border-radius: 14px; background: #4fc3f7; border: 2px solid #0b0d12; box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
#${ROOT_ELEMENT_ID} .bqp-control input[type="range"]::-moz-range-track {
  height: 6px; border-radius: 3px; background: rgba(255,255,255,0.18);
}
#${ROOT_ELEMENT_ID} .bqp-control input[type="range"]::-moz-range-thumb {
  width: 28px; height: 28px; border-radius: 14px; background: #4fc3f7; border: 2px solid #0b0d12;
}
#${ROOT_ELEMENT_ID} .bqp-control input[type="range"]:disabled::-webkit-slider-thumb { background: #4b5563; }
#${ROOT_ELEMENT_ID} .bqp-control select {
  width: 100%; min-height: 44px; background: #171b23; color: #e8ecf1;
  border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 6px 10px; font: inherit;
}
#${ROOT_ELEMENT_ID} .bqp-seg { display: flex; flex-wrap: wrap; gap: 6px; }
#${ROOT_ELEMENT_ID} .bqp-seg-btn {
  flex: 1 1 0; min-width: 64px; min-height: 44px; padding: 4px 6px; border-radius: 10px;
  background: #171b23; color: #cbd3dd; border: 1px solid rgba(255,255,255,0.12); font-size: 14px;
}
#${ROOT_ELEMENT_ID} .bqp-seg-btn[aria-pressed="true"] { background: #234559; color: #fff; border-color: #4fc3f7; }
#${ROOT_ELEMENT_ID} .bqp-seg-btn:disabled { opacity: 0.5; cursor: default; }
#${ROOT_ELEMENT_ID} .bqp-switch-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px;
}
#${ROOT_ELEMENT_ID} .bqp-switch {
  -webkit-appearance: none; appearance: none; flex: 0 0 auto;
  width: 52px; height: 32px; margin: 0; border-radius: 16px; position: relative;
  background: rgba(255,255,255,0.18); border: 0; transition: background 120ms;
}
#${ROOT_ELEMENT_ID} .bqp-switch::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 13px;
  background: #fff; transition: transform 120ms; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
#${ROOT_ELEMENT_ID} .bqp-switch:checked { background: #2d9cdb; }
#${ROOT_ELEMENT_ID} .bqp-switch:checked::after { transform: translateX(20px); }
#${ROOT_ELEMENT_ID} .bqp-switch:disabled { opacity: 0.4; }
#${ROOT_ELEMENT_ID} .bqp-action-btn {
  width: 100%; min-height: 48px; border-radius: 12px; padding: 6px 12px;
  background: #171b23; color: #e8ecf1; border: 1px solid rgba(255,255,255,0.15); font-weight: 600;
}
#${ROOT_ELEMENT_ID} .bqp-control[data-id="reset"] .bqp-action-btn,
#${ROOT_ELEMENT_ID} .bqp-flag-clear .bqp-action-btn { background: #12261a; border-color: #4caf7d; color: #baf0d3; }
#${ROOT_ELEMENT_ID} .bqp-hint, #${ROOT_ELEMENT_ID} .bqp-disabled-note { color: #7c8594; font-size: 12px; margin-top: 5px; line-height: 1.35; }
#${ROOT_ELEMENT_ID} .bqp-control[data-disabled="true"] { opacity: 0.55; }
#${ROOT_ELEMENT_ID} .bqp-flag-forced { color: #f0a742; }
#${ROOT_ELEMENT_ID} .bqp-row {
  display: flex; justify-content: space-between; gap: 12px; padding: 7px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px;
}
#${ROOT_ELEMENT_ID} .bqp-row-label { color: #9aa4b2; }
#${ROOT_ELEMENT_ID} .bqp-row-value { color: #e8ecf1; font-variant-numeric: tabular-nums; text-align: right; }
#${ROOT_ELEMENT_ID} .bqp-row-value.bqp-unavailable { color: #6b7280; font-style: italic; }
#${ROOT_ELEMENT_ID} .bqp-compare-diff {
  margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.04); border-radius: 10px;
  font-size: 12px; white-space: pre-wrap; word-break: break-word; user-select: text; -webkit-user-select: text;
}
/* The launcher. The three-finger gesture stays — it is the fast path once you
   know it — but a gesture with no visible affordance is a feature nobody can
   find, which is exactly how this one was reported. Small, low-contrast, out of
   the thumb's flight path, and it never covers the stick or the boost pill. */
#${LAUNCHER_ID} {
  position: fixed;
  right: max(8px, env(safe-area-inset-right));
  top: max(8px, env(safe-area-inset-top));
  width: 40px; height: 40px; border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.22); background: rgba(12,14,18,0.45); color: #cfe6f5;
  font: 15px/1 -apple-system, BlinkMacSystemFont, sans-serif;
  display: flex; align-items: center; justify-content: center;
  z-index: 999998; -webkit-tap-highlight-color: transparent;
}
#${LAUNCHER_ID}[hidden] { display: none !important; }
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

function readStoredSize() {
  try { return (win && win.localStorage && win.localStorage.getItem(SIZE_STORAGE_KEY)) || 'compact'; }
  catch (_) { return 'compact'; }
}

/**
 * createDevQualityPanel — factory for the panel.
 *
 * @param {Object} [opts]
 *   doc                — injected `document` (defaults to the global).
 *   getTelemetry()      — plain object keyed by FIELD_REGISTRY id; fields it
 *                         does not mention render their registry sentinel.
 *   getControlState()   — plain object keyed by CONTROL_REGISTRY id
 *                         (`{ dpr: { requested, effective }, mode: 'auto',
 *                         ... }`) plus `preset: { id }` for the strip and
 *                         `grade` for the Look tab's candidate readout.
 *   getPresets()        — `[{ id, label, hint }]`, the same list the gear
 *                         menu cycles, in order. Read lazily on every render
 *                         so index.html may define it after the panel.
 *   getEvidence()       — raw materials for the evidence export; wrapped in
 *                         a schema envelope here.
 *   getBuildStale()     — true when the service worker is serving a previous
 *                         build's modules (SW-5); paints the banner.
 *   onRequest(request)  — called for every control interaction. Shapes:
 *                           { kind: 'mode', mode }
 *                           { kind: 'control', key, value }
 *                           { kind: 'action', action }
 *                           { kind: 'preset', id, index }
 *                           { kind: 'flag', key, value, search }  (informational —
 *                             the panel navigates itself right after)
 *   openEventName / closeEventName — CustomEvent names on `document`.
 *   updateHz            — refresh rate while open. Default 4.
 *   setInterval / clearInterval / now — injectable for tests.
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
  const getPresets = typeof opts.getPresets === 'function' ? opts.getPresets : () => [];
  const getEvidence = typeof opts.getEvidence === 'function' ? opts.getEvidence : () => ({});
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
  let sizeButton = null;
  let launcherEl = null;
  let liveEl = null;
  let presetsEl = null;
  let presetButtons = null; // id -> button
  let presetHintEl = null;
  let panelSize = readStoredSize();
  let staleBanner = null;
  let rowValueEls = null; // field id -> value element
  let controlEls = null; // control id -> { el, readout?, wrap, kind }

  // A/B compare snapshots (in-session only).
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
    root.setAttribute('aria-label', 'Quality panel');

    const head = doc.createElement('div');
    head.className = 'bqp-head';

    const grip = doc.createElement('div');
    grip.className = 'bqp-grip';
    head.appendChild(grip);

    const titleRow = doc.createElement('div');
    titleRow.className = 'bqp-title-row';
    const title = doc.createElement('span');
    title.className = 'bqp-title';
    title.textContent = 'Quality';
    titleRow.appendChild(title);
    liveEl = doc.createElement('span');
    liveEl.className = 'bqp-live';
    titleRow.appendChild(liveEl);

    const sizeBtn = doc.createElement('button');
    sizeBtn.type = 'button';
    sizeBtn.className = 'bqp-size';
    sizeBtn.setAttribute('aria-label', 'Cycle panel size');
    sizeBtn.addEventListener('click', () => {
      const order = ['peek', 'compact', 'full'];
      const next = order[(order.indexOf(panelSize) + 1) % order.length];
      setPanelSize(next);
    });
    titleRow.appendChild(sizeBtn);
    sizeButton = sizeBtn;

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'bqp-close';
    closeBtn.setAttribute('aria-label', 'Close quality panel');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => close());
    titleRow.appendChild(closeBtn);
    head.appendChild(titleRow);

    presetsEl = doc.createElement('div');
    presetsEl.className = 'bqp-presets';
    presetsEl.setAttribute('role', 'group');
    presetsEl.setAttribute('aria-label', 'Quality preset');
    head.appendChild(presetsEl);
    presetHintEl = doc.createElement('div');
    presetHintEl.className = 'bqp-preset-hint';
    head.appendChild(presetHintEl);
    buildPresetStrip();

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
    head.appendChild(tabs);

    staleBanner = doc.createElement('div');
    staleBanner.className = 'bqp-stale-banner';
    staleBanner.hidden = true;
    staleBanner.textContent =
      'Stale build: the service worker is serving a PREVIOUS build’s modules. Every number below is unreliable — hard-reload before measuring.';

    bodyEl = doc.createElement('div');
    bodyEl.className = 'bqp-body';

    root.appendChild(head);
    root.appendChild(staleBanner);
    root.appendChild(bodyEl);
    doc.body.appendChild(root);

    setPanelSize(panelSize);
    ensureLauncher();

    renderBody();
  }

  /**
   * The preset strip — rebuilt whenever the list changes length (it never
   * does after boot, but the list is read lazily so index.html may define
   * the presets after the panel is constructed).
   */
  function buildPresetStrip() {
    if (!presetsEl) return;
    let presets;
    try { presets = getPresets() || []; } catch { presets = []; }
    presetsEl.textContent = '';
    presetButtons = {};
    presetsEl.style.gridTemplateColumns = `repeat(${Math.max(1, presets.length)}, 1fr)`;
    presets.forEach((preset, index) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'bqp-preset';
      btn.textContent = preset.label;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('data-preset', preset.id);
      btn.addEventListener('click', () => {
        onRequest({ kind: 'preset', id: preset.id, index });
        // Reflect immediately — the real state arrives on the next tick,
        // but a tap that shows nothing for 250 ms reads as a missed tap.
        syncPresetStrip(preset.id, presets);
      });
      presetsEl.appendChild(btn);
      presetButtons[preset.id] = btn;
    });
    presetsEl.hidden = presets.length === 0;
    if (presetHintEl) presetHintEl.hidden = presets.length === 0;
  }

  function syncPresetStrip(activeId, presets) {
    if (!presetButtons) return;
    let active = null;
    for (const [id, btn] of Object.entries(presetButtons)) {
      const pressed = id === activeId;
      btn.setAttribute('aria-pressed', String(pressed));
      if (pressed) active = presets.find((p) => p.id === id) || null;
    }
    if (presetHintEl) presetHintEl.textContent = active && active.hint ? active.hint : '';
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

  /** A row of buttons standing in for a select; returns value -> button. */
  function buildSegmented(options, { disabled, onPick, pressedValue }) {
    const row = doc.createElement('div');
    row.className = 'bqp-seg';
    row.setAttribute('role', 'group');
    const buttons = {};
    for (const opt of options) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'bqp-seg-btn';
      btn.textContent = opt.short || opt.label;
      btn.title = opt.label;
      btn.disabled = !!disabled;
      btn.setAttribute('aria-pressed', String(pressedValue !== undefined && String(opt.value) === String(pressedValue)));
      btn.addEventListener('click', () => { if (!disabled) onPick(opt.value, btn); });
      row.appendChild(btn);
      buttons[String(opt.value)] = btn;
    }
    return { row, buttons };
  }

  function pressOnly(buttons, value) {
    for (const [v, btn] of Object.entries(buttons)) btn.setAttribute('aria-pressed', String(v === String(value)));
  }

  function buildControl(control) {
    const wrap = doc.createElement('div');
    wrap.className = 'bqp-control';
    wrap.setAttribute('data-id', control.id);
    if (control.disabled) wrap.setAttribute('data-disabled', 'true');

    const head = doc.createElement('div');
    head.className = 'bqp-control-head';
    const label = doc.createElement('span');
    label.className = 'bqp-control-label';
    label.textContent = control.label;
    head.appendChild(label);

    let readoutEl = null;
    let inputEl = null;
    let segmented = false;

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
      inputEl.setAttribute('aria-label', control.label);
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
      if (control.options.length <= SEGMENTED_MAX_OPTIONS) {
        segmented = true;
        const seg = buildSegmented(control.options, {
          disabled: control.disabled,
          onPick: (value) => {
            pressOnly(seg.buttons, value);
            commitControl(control, value);
          },
        });
        wrap.appendChild(seg.row);
        inputEl = seg.buttons;
      } else {
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
      }
    } else if (control.kind === 'toggle') {
      const row = doc.createElement('label');
      row.className = 'bqp-switch-row';
      const toggleLabel = doc.createElement('span');
      toggleLabel.className = 'bqp-control-label';
      toggleLabel.textContent = control.label;
      inputEl = doc.createElement('input');
      inputEl.type = 'checkbox';
      inputEl.className = 'bqp-switch';
      inputEl.disabled = !!control.disabled;
      inputEl.addEventListener('change', () => {
        if (!control.disabled) commitControl(control, inputEl.checked);
      });
      row.appendChild(toggleLabel);
      row.appendChild(inputEl);
      wrap.appendChild(row);
    } else if (control.kind === 'buttons') {
      wrap.appendChild(head);
      const seg = buildSegmented(control.options, {
        disabled: control.disabled,
        onPick: (value) => {
          pressOnly(seg.buttons, value);
          onRequest({ kind: 'mode', mode: value });
        },
      });
      wrap.appendChild(seg.row);
      inputEl = seg.buttons; // map of value -> button, for tick() to update aria-pressed
    } else if (control.kind === 'action') {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'bqp-action-btn';
      btn.textContent = control.label;
      btn.addEventListener('click', () => handleAction(control));
      wrap.appendChild(btn);
      inputEl = btn;
      if (control.id === 'gradeNextCandidate') {
        // Read by tick() from controlState.grade.candidate — index.html
        // names the candidate it just applied; showing that name (not just
        // "done") is the whole point.
        readoutEl = doc.createElement('div');
        readoutEl.className = 'bqp-hint';
        readoutEl.textContent = 'Tap to preview a candidate grade for this biome';
        wrap.appendChild(readoutEl);
      }
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

    return { wrap, input: inputEl, readout: readoutEl, kind: control.kind, segmented };
  }

  function handleAction(control) {
    onRequest({ kind: 'action', action: control.id });
    if (control.id === 'export') {
      downloadEvidence();
    } else if (control.id === 'compare') {
      runCompareStep();
    } else if (control.id === 'copyGrade') {
      copyGradeToClipboard();
    } else if (control.id === 'reset' || control.id === 'resumeAuto') {
      // Local reflection only — index.html's onRequest handler does the
      // real work. The next tick() picks up the real post-reset state.
      if (compareDiffEl) { compareDiffEl.hidden = true; }
      compareSnapshotA = null;
    }
  }

  /**
   * "Copy grade": {biome, tone, exposure, bloomThreshold} for the CURRENTLY
   * ACTIVE biome, as one compact JSON line — "the owner is reading numbers
   * off a phone screen and retyping them" is exactly the failure mode this
   * exists to remove. Reads getControlState() fresh so a rapid grade-then-
   * copy never copies a stale reading.
   */
  function copyGradeToClipboard() {
    let state;
    try { state = getControlState() || {}; } catch { state = {}; }
    const g = state.grade || {};
    const payload = JSON.stringify({
      biome: g.biome ?? null,
      tone: g.tone ?? null,
      exposure: g.exposure ?? null,
      bloomThreshold: g.bloomThreshold ?? null,
    });
    const entry = controlEls && controlEls.copyGrade;
    const btn = entry && entry.input;
    const showFeedback = (text) => {
      if (!btn) return;
      const original = btn.dataset.originalLabel || btn.textContent;
      btn.dataset.originalLabel = original;
      btn.textContent = text;
      setTimeout(() => { if (btn) btn.textContent = original; }, 1200);
    };
    const fallbackCopy = () => {
      try {
        const ta = doc.createElement('textarea');
        ta.value = payload;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.focus();
        ta.select();
        doc.execCommand('copy');
        doc.body.removeChild(ta);
        showFeedback('Copied!');
      } catch {
        showFeedback('Copy failed');
      }
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(() => showFeedback('Copied!'), fallbackCopy);
    } else {
      fallbackCopy();
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
      // The underlying data is already reachable via getEvidence()/
      // getTelemetry() for any harness that needs it programmatically.
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
    let lastGroup;
    for (const control of CONTROL_REGISTRY) {
      if (control.view !== view) continue;
      if (control.group && control.group !== lastGroup) {
        const sub = doc.createElement('div');
        sub.className = 'bqp-subsection-title';
        sub.textContent = control.group;
        bodyEl.appendChild(sub);
        lastGroup = control.group;
      }
      const built = buildControl(control);
      bodyEl.appendChild(built.wrap);
      controlEls[control.id] = { ...built, def: control };
    }
  }

  // -------------------------------------------------------------------------
  // Flags — the boot-time A/B switches, from src/ui/boot-flags.js. Static
  // (read once from the URL at render); tapping one navigates.
  // -------------------------------------------------------------------------

  function currentSearch() {
    return (win && win.location && win.location.search) || '';
  }

  function navigateToSearch(nextSearch) {
    if (!win || !win.location) return;
    const loc = win.location;
    const href = `${loc.pathname}${nextSearch ? `?${nextSearch}` : ''}${loc.hash || ''}`;
    loc.assign(href);
  }

  function bootFlagLabel(key) {
    const f = BOOT_FLAGS.find((x) => x.key === key);
    return f ? f.label : key;
  }

  function buildFlagsView() {
    const search = currentSearch();
    let lastGroup;
    for (const flag of BOOT_FLAGS) {
      if (flag.group !== lastGroup) {
        const sub = doc.createElement('div');
        sub.className = 'bqp-subsection-title';
        sub.textContent = flag.group;
        bodyEl.appendChild(sub);
        lastGroup = flag.group;
      }
      const state = readBootFlag(search, flag.key);
      const wrap = doc.createElement('div');
      wrap.className = 'bqp-control';
      wrap.setAttribute('data-flag', flag.key);
      if (flag.kind === 'toggle') {
        const row = doc.createElement('label');
        row.className = 'bqp-switch-row';
        const lbl = doc.createElement('span');
        lbl.className = 'bqp-control-label';
        lbl.textContent = flag.label;
        const input = doc.createElement('input');
        input.type = 'checkbox';
        input.className = 'bqp-switch';
        input.checked = !!state.on;
        input.disabled = !!state.forcedOff;
        input.addEventListener('change', () => {
          const next = withBootFlag(search, flag.key, input.checked);
          onRequest({ kind: 'flag', key: flag.key, value: input.checked, search: next });
          navigateToSearch(next);
        });
        row.appendChild(lbl);
        row.appendChild(input);
        wrap.appendChild(row);
        if (state.forcedOff) {
          const note = doc.createElement('div');
          note.className = 'bqp-hint bqp-flag-forced';
          note.textContent = `Off because ?${flag.parent}=0 is set. Turn “${bootFlagLabel(flag.parent)}” back on first.`;
          wrap.appendChild(note);
        }
      } else {
        const head = doc.createElement('div');
        head.className = 'bqp-control-head';
        const lbl = doc.createElement('span');
        lbl.className = 'bqp-control-label';
        lbl.textContent = flag.label;
        head.appendChild(lbl);
        wrap.appendChild(head);
        const seg = buildSegmented(flag.options.map((o) => ({ value: o.value, label: o.label, short: o.label })), {
          pressedValue: state.value,
          onPick: (value) => {
            const next = withBootFlag(search, flag.key, value);
            onRequest({ kind: 'flag', key: flag.key, value, search: next });
            navigateToSearch(next);
          },
        });
        wrap.appendChild(seg.row);
      }
      if (flag.hint) {
        const hint = doc.createElement('div');
        hint.className = 'bqp-hint';
        hint.textContent = flag.hint;
        wrap.appendChild(hint);
      }
      bodyEl.appendChild(wrap);
    }

    if (anyBootFlagSet(search)) {
      const wrap = doc.createElement('div');
      wrap.className = 'bqp-control bqp-flag-clear';
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'bqp-action-btn';
      btn.textContent = 'Clear every flag (reload at the shipping defaults)';
      btn.addEventListener('click', () => {
        const next = withoutBootFlags(search);
        onRequest({ kind: 'flag', key: null, value: null, search: next });
        navigateToSearch(next);
      });
      wrap.appendChild(btn);
      bodyEl.appendChild(wrap);
    }
  }

  /**
   * Panel size. 'compact' is the default because the panel's job is to let you
   * change something and WATCH THE RESULT; 'peek' keeps only the header —
   * the live readout, the preset strip and the tabs — which is what you want
   * while flying to a spot; 'full' is for reading telemetry.
   */
  function setPanelSize(next) {
    panelSize = next;
    if (root) root.setAttribute('data-size', next);
    if (sizeButton) {
      sizeButton.textContent = next === 'full' ? '⌄' : '⌃';
      sizeButton.setAttribute('aria-label', `Panel size: ${next}. Tap to cycle.`);
    }
    try { if (win && win.localStorage) win.localStorage.setItem(SIZE_STORAGE_KEY, next); } catch (_) { /* private mode */ }
  }

  /**
   * The launcher. The three-finger gesture is the fast path, but it is
   * invisible: reported from the device as "it's hard to get that diag console
   * up - maybe a little button?" Deliberately NOT inside the ?debug block —
   * CONTRACT §6 puts the workbench on the production path.
   */
  function ensureLauncher() {
    if (launcherEl || !doc || !doc.body) return;
    launcherEl = doc.createElement('button');
    launcherEl.type = 'button';
    launcherEl.id = LAUNCHER_ID;
    launcherEl.setAttribute('aria-label', 'Open quality panel');
    launcherEl.textContent = '⚙';
    launcherEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openPanel();
    });
    doc.body.appendChild(launcherEl);
  }

  function syncLauncher() {
    if (!launcherEl) return;
    // Hidden while the panel is up: it would sit on top of the panel's own
    // close button, and two controls for the same thing on a phone is one too
    // many.
    launcherEl.hidden = !!(root && !root.hidden);
  }

  function renderBody() {
    if (!bodyEl) return;
    bodyEl.textContent = '';
    rowValueEls = {};
    controlEls = {};
    compareDiffEl = null;

    if (VIEW_INTRO[activeView]) {
      const intro = doc.createElement('div');
      intro.className = 'bqp-hint bqp-view-intro';
      intro.textContent = VIEW_INTRO[activeView];
      bodyEl.appendChild(intro);
    }

    if (activeView === PANEL_VIEWS.FLAGS) {
      buildFlagsView();
      tick();
      return;
    }

    if (CONTROL_REGISTRY.some((c) => c.view === activeView)) {
      buildControlsForView(activeView);
    }

    const fields = FIELD_REGISTRY.filter((f) => matchesView(f.view, activeView));
    if (fields.length) {
      const telemetryTitle = doc.createElement('div');
      telemetryTitle.className = 'bqp-section-title';
      telemetryTitle.textContent = 'Telemetry';
      bodyEl.appendChild(telemetryTitle);
    }
    for (const field of fields) {
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
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  /** One telemetry + control-state refresh. Text/attribute mutation only. */
  function tick() {
    if (staleBanner) {
      let stale = false;
      try { stale = !!getBuildStale(); } catch { stale = false; }
      staleBanner.hidden = !stale;
    }
    let telemetry;
    try {
      telemetry = getTelemetry() || {};
    } catch {
      telemetry = {};
    }
    if (liveEl) {
      const fps = telemetry['TEL-1'];
      const calls = telemetry['TEL-8'];
      const parts = [];
      if (fps && fps.state !== 'unavailable' && Number.isFinite(fps.value)) parts.push(`${Math.round(fps.value)} fps`);
      if (calls && calls.state !== 'unavailable' && calls.value != null) parts.push(String(calls.value));
      liveEl.textContent = parts.join(' · ');
    }

    let controlState;
    try {
      controlState = getControlState() || {};
    } catch {
      controlState = {};
    }
    if (presetButtons) {
      let presets;
      try { presets = getPresets() || []; } catch { presets = []; }
      if (presets.length !== Object.keys(presetButtons).length) buildPresetStrip();
      const p = controlState.preset;
      syncPresetStrip(p && p.id, presets);
    }

    if (rowValueEls) {
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
    }

    if (!controlEls) return;
    for (const [id, entry] of Object.entries(controlEls)) {
      const def = entry.def;
      const state = controlState[id];
      if (def.kind === 'buttons') {
        pressOnly(entry.input, controlState.mode);
      } else if (def.kind === 'slider') {
        if (state && Number.isFinite(state.effective) && doc.activeElement !== entry.input) {
          entry.input.value = String(state.effective);
          if (entry.readout) entry.readout.textContent = formatNumber(state.effective, 2);
        } else if (!state && entry.readout && !entry.readout.textContent) {
          entry.readout.textContent = formatNumber(Number.parseFloat(entry.input.value), 2);
        }
      } else if (def.kind === 'select') {
        if (state && state.effective !== undefined && state.effective !== null) {
          if (entry.segmented) pressOnly(entry.input, state.effective);
          else if (doc.activeElement !== entry.input) entry.input.value = String(state.effective);
        }
      } else if (def.kind === 'toggle') {
        if (state && typeof state.effective === 'boolean' && doc.activeElement !== entry.input) {
          entry.input.checked = state.effective;
        }
      } else if (def.id === 'gradeNextCandidate' && entry.readout) {
        const g = controlState.grade;
        const c = g && g.candidate;
        entry.readout.textContent = c && c.name
          ? `${c.index + 1}/${c.total}: ${c.name}`
          : 'Tap to preview a candidate grade for this biome';
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
    syncLauncher();
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
    syncLauncher();
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
    if (launcherEl && launcherEl.parentNode) {
      launcherEl.parentNode.removeChild(launcherEl);
    }
    root = null;
    bodyEl = null;
    liveEl = null;
    presetsEl = null;
    presetButtons = null;
    presetHintEl = null;
    launcherEl = null;
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
