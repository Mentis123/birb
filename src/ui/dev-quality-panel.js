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

/**
 * The device's own pixel ratio, and the ceiling of the render-DPR control.
 *
 * Guarded because this module is imported under plain `node --test`, where
 * there is no window at all — the 4-class Three stub in node_modules means the
 * unit suite never has a DOM. Falls back to 2, which is a sane desktop-retina
 * bound rather than a value that would silently disable the control.
 *
 * Rendering ABOVE native buys nothing: there are no pixels to put it in. So
 * native is the honest ceiling, and it is a real one — an iPhone reports 3.
 */
export function nativeDpr() {
  const r = (typeof window !== 'undefined' && window && window.devicePixelRatio) || 0;
  return r > 0 ? Math.max(1, r) : 2;
}

export const PANEL_VIEWS = Object.freeze({
  PERFORMANCE: 'performance',
  LOOK: 'look',
  ULTRA: 'ultra',
  CAPTURE: 'capture',
});

const VIEW_ORDER = [PANEL_VIEWS.PERFORMANCE, PANEL_VIEWS.LOOK, PANEL_VIEWS.ULTRA, PANEL_VIEWS.CAPTURE];
const VIEW_LABELS = {
  [PANEL_VIEWS.PERFORMANCE]: 'Performance',
  [PANEL_VIEWS.LOOK]: 'Look',
  [PANEL_VIEWS.ULTRA]: 'Ultra',
  [PANEL_VIEWS.CAPTURE]: 'Capture',
};

/**
 * Ascend wave — the Ultra view exists because the panel's every other
 * ceiling was, until this wave, the shipping value wearing a slider's
 * clothes: it could only ever shed. Everything under this tab pushes PAST
 * what a player who never opens this panel sees. Nothing here moves unless
 * you touch it (or tap MAX REALISM), and BACK TO SHIPPING DEFAULT undoes it
 * exactly — same distance out as in.
 */
const VIEW_INTRO = {
  [PANEL_VIEWS.ULTRA]:
    'Above the shipping default. These controls make the game render MORE than it ships with — real shadows, hardware AA, sharper textures at grazing angles, a denser ground mesh. Nothing below moves until you touch it.',
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
  // TEL-8/9/10 also render on the Ultra tab (Wave "Ascend" — requirement 5:
  // "show the cost live" where the above-baseline controls actually are, not
  // just on a different tab the thumb has to leave to check).
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
    // Stays on the Performance tab, NOT Ultra: tools/lib/quality-captures.mjs
    // (frozen, oracle-manifest.txt) drives this control by label right after
    // "Weather density" without switching tabs first (A10) — moving it would
    // break a passing oracle to serve a cosmetic grouping. Its range above
    // 1.0 IS this wave's above-baseline lever; the Ultra view's intro text
    // and the MAX REALISM preset both reach it without duplicating the
    // control.
    id: 'decorativeDensity', view: PANEL_VIEWS.PERFORMANCE, kind: 'slider',
    label: 'Decorative density (wind / contact shadow / ribbons)',
    // Back to 1. The Ascend gate drove this through the panel's own listener at
    // 1.5 and 2.0 and measured requested=1 / effective=1 with the readout showing
    // the number the user picked, and 0 delta in draw calls and triangles over 12
    // adjacent frame pairs. Even unclamped, above 1.0 it only scales
    // visualUniforms.wind — about 14 mm more foliage sway. There is no denser
    // decoration behind this slider to ask for, so offering the range was the
    // panel telling the truth about a number and lying about an effect.
    min: 0, max: 1, step: 0.05, requestKey: 'decorativeDensity',
  },
  // ---- Look view: render-cost-vs-fidelity dials ----
  {
    id: 'dpr', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Render DPR',
    // Max is the DEVICE's own pixel ratio, resolved at build time — 3.0 on
    // the iPhone this is built for. 2.0 was 67% of native with no way to ask
    // for the rest, on the one control that most changes how the game looks.
    min: 0.85, max: nativeDpr(), step: 0.05, requestKey: 'dpr',
  },
  {
    id: 'postQuality', view: PANEL_VIEWS.LOOK, kind: 'select', label: 'Post quality',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'quarter', label: 'Quarter' },
      { value: 'half', label: 'Half' },
      { value: 'full', label: 'Full (post at scene resolution)' },
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

  // ---- Look view: per-biome colour grade (VISUAL_UPGRADE_BUILD_PLAN §16.10)
  // ----
  // Tone mapping / exposure / the bloom knee sit ABOVE each biome's own light
  // rig (ambient/key/rim/fill/glow, tuned per biome already) — see
  // world-shell.js's DEFAULT_GRADE and index.html's applyColorGrade. Every
  // control below routes through the SAME qualitySettings
  // request()/apply()/readEffective() precedence (CONTRACT §7.1) as every
  // dial above it on this same tab; this file has no rendering side effect
  // of its own for these any more than for postQuality/shafts/bloomStrength.
  // index.html scopes a standing request PER BIOME (gradeOverridesByBiome) —
  // switching environment shows THAT biome's own grade (its default, or a
  // standing override made while IT was active), never one carried over from
  // whichever biome happened to be on screen when a slider was last moved.
  {
    id: 'tone', view: PANEL_VIEWS.LOOK, kind: 'select', label: 'Tone mapping', group: 'Grade',
    options: [
      { value: 'neutral', label: 'Neutral (shipping)' },
      { value: 'agx', label: 'AgX' },
      { value: 'aces', label: 'ACES Filmic' },
    ],
    requestKey: 'tone',
    hint: 'Changes what the bloom pass sees as bright. A different curve may need its own Bloom threshold below to keep rings/gates readable — measure it, do not assume it carries over from Neutral (CLAUDE.md: "0.79 against a 0.78 knee" missed a bloom entirely).',
  },
  {
    id: 'exposure', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Exposure', group: 'Grade',
    min: 0.7, max: 1.8, step: 0.02, requestKey: 'exposure',
  },
  {
    id: 'bloomThreshold', view: PANEL_VIEWS.LOOK, kind: 'slider', label: 'Bloom threshold', group: 'Grade',
    min: 0.3, max: 1.2, step: 0.01, requestKey: 'bloomThreshold',
    hint: 'The tone-mapped-luminance knee the bright pass thresholds. Lower = more things glow. Shipping is 0.78 under Neutral — a different tone curve changes what crosses it, so re-check this per grade rather than carrying the number over.',
  },
  {
    id: 'gradeNextCandidate', view: PANEL_VIEWS.LOOK, kind: 'action', label: 'Next candidate', group: 'Grade',
    hint: 'Cycles the same comparison set tools/birb-lighting.mjs --grades renders to a sheet for THIS biome, applied live from a fixed baseline each tap (never compounding onto the last candidate) — so a sheet frame and this phone show the same set.',
  },
  {
    id: 'copyGrade', view: PANEL_VIEWS.LOOK, kind: 'action', label: 'Copy grade', group: 'Grade',
    hint: 'Copies {biome, tone, exposure, bloomThreshold} for THIS biome as one JSON line, ready to paste back into a message.',
  },

  // ---- Ultra view: ABOVE the shipping default (Ascend wave) ----
  // Every control below this line pushes PAST what a player who never opens
  // the workbench sees — the opposite of the Performance view's shedding
  // dials. `requestKey` for each routes through the SAME quality-settings
  // apply()/readEffective()/clamp() precedence (CONTRACT §7.1) as every
  // existing lever; this file has no rendering side effect of its own for
  // these any more than for the ones above.
  {
    id: 'maxRealism', view: PANEL_VIEWS.ULTRA, kind: 'action', label: 'MAX REALISM — set every lever below to its ceiling',
    hint: 'One tap: native DPR, post Full, shadows on at 2048px VSM, 4x MSAA, anisotropy at the device max, terrain resolution High, decorative density at 2.0. Reversible — see the button next to this one.',
  },
  {
    id: 'backToShipping', view: PANEL_VIEWS.ULTRA, kind: 'action', label: 'BACK TO SHIPPING DEFAULT',
    hint: 'Clears every override above AND in Performance/Look back to exactly what a player who never opens this panel sees — same distance out as MAX REALISM is in.',
  },
  {
    id: 'shadowsEnabled', view: PANEL_VIEWS.ULTRA, kind: 'toggle', label: 'Real shadows (shadow map)',
    requestKey: 'shadowsEnabled',
    hint: 'Off ships on every device today — contact shadows are faked instead. Turning this on recompiles every material in the scene (verified against tools/birb-shaders.mjs with this ON, all 4 biomes).',
  },
  {
    id: 'shadowType', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Shadow filter',
    options: [
      { value: 'basic', label: 'Basic (hard edge, cheapest)' },
      { value: 'pcf', label: 'PCF' },
      { value: 'vsm', label: 'VSM (softest)' },
    ],
    requestKey: 'shadowType',
  },
  {
    id: 'shadowMapSize', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Shadow map size',
    options: [
      { value: 'low', label: 'Low (512px)' },
      { value: 'medium', label: 'Medium (1024px)' },
      { value: 'high', label: 'High (2048px)' },
    ],
    requestKey: 'shadowMapSize',
  },
  {
    // `antialias` is a WebGL CONTEXT-CREATION flag (index.html:
    // `antialias: !isMobile`) — it cannot be toggled on a live renderer, so
    // this lever does not flip it. It raises hardware MSAA on the bloom
    // pass's offscreen scene target instead (bloom-pass.js `setSamples`),
    // which resolves automatically with no extra draw call. Off by default
    // on every platform, including desktop, where the context flag already
    // supplies real AA on its own no-post fallback path — this control adds
    // AA to the POST path everywhere, opt-in only. A device lacking
    // EXT_color_buffer_float or WebGL2 reports the effective sample count
    // back as 0 regardless of what is requested here (an honest
    // requested-vs-effective desync, not a broken control).
    id: 'antialiasing', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Antialiasing (scene MSAA)',
    options: [
      { value: 'off', label: 'Off' },
      { value: '2x', label: '2x' },
      { value: '4x', label: '4x' },
    ],
    requestKey: 'antialiasing',
  },
  {
    id: 'anisotropy', view: PANEL_VIEWS.ULTRA, kind: 'slider', label: 'Anisotropic filtering',
    // 0 is the "back to shipping default" sentinel (restores each texture's
    // own authored value — cloudTex shipped at 2, everything else at 1), not
    // a real GL level. 16 is a generic UI ceiling; the actual request is
    // clamped to THIS device's renderer.capabilities.getMaxAnisotropy() on
    // the index.html side regardless of what this slider allows, exactly
    // like the dpr control's native-vs-requested pattern above.
    min: 0, max: 16, step: 1, requestKey: 'anisotropy',
    hint: 'Only ground/prop-adjacent textures that exist — water surfaces, the bird’s contact-shadow decal, the authored surfaces, the desktop cloud shell — everything else in this game has no sampled texture to sharpen. 0 = shipping (cloudTex=2, everything else untouched).',
  },
  {
    id: 'terrainResolution', view: PANEL_VIEWS.ULTRA, kind: 'select', label: 'Terrain mesh resolution',
    options: [
      { value: 'standard', label: 'Standard (shipping — 112x72 mobile / 128x96 desktop)' },
      { value: 'high', label: 'High (160x104 / 192x128, +17-24k tris)' },
      { value: 'ultra', label: 'Ultra (208x136 / 256x168, +40-61k tris — exceeds the 80k budget alone)' },
    ],
    requestKey: 'terrainResolution',
    hint: 'Rebuilds the ground mesh on release, not per frame. Real silhouette/terrain detail, not a filter.',
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
  /* Reported from the device: "when it pops up it covers the whole screen so I
     keep having to close it to view things". At 72vh it did — and you cannot
     judge a colour grade through a panel that covers the thing you are grading,
     which is the one job this panel has. Three states now, cycled from the
     header, and COMPACT is the default: enough to work a slider, small enough
     to watch the sky while you do. */
  max-height: var(--bqp-h, 40vh);
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
#${ROOT_ELEMENT_ID}[data-size="peek"] { --bqp-h: 96px; }
#${ROOT_ELEMENT_ID}[data-size="compact"] { --bqp-h: 40vh; }
#${ROOT_ELEMENT_ID}[data-size="full"] { --bqp-h: 78vh; }
#${ROOT_ELEMENT_ID} .bqp-size {
  width: 44px;
  min-height: 44px;
  background: none;
  border: 0;
  color: #e8ecf1;
  font-size: 15px;
}
/* The launcher. The three-finger gesture stays — it is the fast path once you
   know it — but a gesture with no visible affordance is a feature nobody can
   find, which is exactly how this one was reported. Small, low-contrast, out of
   the thumb's flight path, and it never covers the stick or the boost pill. */
#birb-dev-quality-launcher {
  position: fixed;
  right: max(8px, env(safe-area-inset-right));
  top: max(8px, env(safe-area-inset-top));
  width: 40px; height: 40px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(12,14,18,0.45);
  color: #cfe6f5;
  font: 15px/1 -apple-system, BlinkMacSystemFont, sans-serif;
  display: flex; align-items: center; justify-content: center;
  z-index: 999998;
  -webkit-tap-highlight-color: transparent;
}
#birb-dev-quality-launcher[hidden] { display: none !important; }
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
#${ROOT_ELEMENT_ID} .bqp-subsection-title {
  margin: 16px 0 2px;
  padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.08);
  color: #7fb8e0;
  font-size: 11px;
  font-weight: 600;
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
#${ROOT_ELEMENT_ID} .bqp-view-intro {
  margin: 0 0 10px;
  padding: 8px 10px;
  background: rgba(79, 195, 247, 0.1);
  border: 1px solid rgba(79, 195, 247, 0.35);
  border-radius: 8px;
  color: #bfe9fb;
  font-size: 12px;
}
#${ROOT_ELEMENT_ID} .bqp-control[data-id="maxRealism"] .bqp-action-btn {
  background: #3a1f0a;
  border-color: #f0a742;
  color: #ffd9a0;
  font-weight: 700;
}
#${ROOT_ELEMENT_ID} .bqp-control[data-id="backToShipping"] .bqp-action-btn {
  background: #12261a;
  border-color: #4caf7d;
  color: #baf0d3;
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
  let sizeButton = null;
  let launcherEl = null;
  // Restored per device, so the size you chose survives a reload — you are
  // outdoors and should not have to set it again every time.
  let panelSize = (() => {
    try { return win.localStorage.getItem('birbPanelSize') || 'compact'; }
    catch (_) { return 'compact'; }
  })();
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

    const sizeBtn = doc.createElement('button');
    sizeBtn.type = 'button';
    sizeBtn.className = 'bqp-size';
    sizeBtn.setAttribute('aria-label', 'Cycle panel size');
    sizeBtn.textContent = '⌃';
    sizeBtn.addEventListener('click', () => {
      const order = ['peek', 'compact', 'full'];
      const next = order[(order.indexOf(panelSize) + 1) % order.length];
      setPanelSize(next);
    });
    tabs.appendChild(sizeBtn);
    sizeButton = sizeBtn;

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

    setPanelSize(panelSize);
    ensureLauncher();

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
      if (control.id === 'gradeNextCandidate') {
        // Read by tick() from controlState.grade.candidate — index.html
        // names the candidate it just applied; showing that name (not just
        // "done") is the whole point ("Show the candidate's NAME" — panel
        // task brief).
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

    return { wrap, input: inputEl, readout: readoutEl, kind: control.kind };
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
      // real work (qualitySettings.setMode('auto'), adaptiveTier.unpin(),
      // and, for 'reset', also clearing panelOverrides). The next tick()
      // picks up the real post-reset state from getControlState().
      if (compareDiffEl) { compareDiffEl.hidden = true; }
      compareSnapshotA = null;
    }
  }

  /**
   * "Copy grade" (panel task): {biome, tone, exposure, bloomThreshold} for
   * the CURRENTLY ACTIVE biome, as one compact JSON line — "the owner is
   * reading numbers off a phone screen and retyping them" is exactly the
   * failure mode this exists to remove. Reads getControlState() fresh
   * (rather than whatever the last 4Hz tick cached) so a rapid grade-then-
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
    let lastGroup;
    for (const control of CONTROL_REGISTRY) {
      if (control.view !== view) continue;
      // A `group` (currently only Look's Grade section) gets its own small
      // sub-heading the first time it appears, so the colour-grade controls
      // read as a labelled group distinct from the render-cost dials above
      // them rather than one undifferentiated list under "Controls".
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

  /**
   * Panel size. 'compact' is the default because the panel's job is to let you
   * change something and WATCH THE RESULT, and at 72vh there was nothing left
   * to watch. 'peek' keeps only the tab strip and one row on screen, which is
   * what you want while flying to a spot; 'full' is for reading telemetry.
   */
  function setPanelSize(next) {
    panelSize = next;
    if (root) root.setAttribute('data-size', next);
    if (sizeButton) {
      sizeButton.textContent = next === 'full' ? '⌄' : '⌃';
      sizeButton.setAttribute('aria-label', `Panel size: ${next}. Tap to cycle.`);
    }
    try { win.localStorage.setItem('birbPanelSize', next); } catch (_) { /* private mode */ }
  }

  /**
   * The launcher. The three-finger gesture is the fast path, but it is
   * invisible: reported from the device as "it's hard to get that diag console
   * up - maybe a little button?" A gesture nobody can discover is a feature
   * nobody has.
   *
   * Deliberately NOT inside the ?debug block — CONTRACT §6 puts the workbench
   * on the production path, and a launcher that only exists under ?debug would
   * be unreachable at the one URL the workbench exists to be used on.
   */
  function ensureLauncher() {
    if (launcherEl || !doc || !doc.body) return;
    launcherEl = doc.createElement('button');
    launcherEl.type = 'button';
    launcherEl.id = 'birb-dev-quality-launcher';
    launcherEl.setAttribute('aria-label', 'Open performance workbench');
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

    const hasControls = CONTROL_REGISTRY.some((c) => c.view === activeView);
    if (hasControls) {
      const title = doc.createElement('div');
      title.className = 'bqp-section-title';
      title.textContent = 'Controls';
      bodyEl.appendChild(title);
      if (VIEW_INTRO[activeView]) {
        const intro = doc.createElement('div');
        intro.className = 'bqp-hint bqp-view-intro';
        intro.textContent = VIEW_INTRO[activeView];
        bodyEl.appendChild(intro);
      }
      buildControlsForView(activeView);

      const telemetryTitle = doc.createElement('div');
      telemetryTitle.className = 'bqp-section-title';
      telemetryTitle.textContent = 'Telemetry';
      bodyEl.appendChild(telemetryTitle);
    }

    for (const field of FIELD_REGISTRY) {
      if (!matchesView(field.view, activeView)) continue;
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
      } else if (def.id === 'gradeNextCandidate' && entry.readout) {
        // controlState.grade is a shared object (index.html's
        // panelGetControlState), not keyed per control id like the others
        // above — `candidate` is null until "Next candidate" has been
        // pressed at least once since the last environment switch.
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
