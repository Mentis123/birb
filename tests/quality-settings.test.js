/**
 * tests/quality-settings.test.js — RED-FIRST spec for `src/game/quality-settings.js`.
 *
 * Wave 1 / task P1.1b of docs/ULTRACODE_PERFORMANCE_PLAN.md §4. The module under
 * test DOES NOT EXIST YET; Wave 2 (P2.1) builds it. This file is the oracle it
 * will be built against, so the API below is a CONTRACT, not a suggestion.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SUITE EXISTS
 * ---------------------------------------------------------------------------
 * Requirement CTL-1 (docs/perf/requirements.json), verbatim from
 * docs/PERFORMANCE_REALISM_PLAN.md:
 *
 *   "Auto / Manual / Benchmark — Manual suspends Auto. Benchmark fixes seed,
 *    route, settings and sun; it does not adapt during a comparison. Resume Auto
 *    clears stale history."
 *
 * Four things in that sentence are load-bearing and each has a documented cost
 * in this repo if it is got wrong:
 *
 *  1. **"and sun".** The game runs a TEN-MINUTE sun cycle. A benchmark that
 *     freezes seed, route and settings but not the sun produces an A/B whose two
 *     halves were lit differently — and if they were taken three minutes apart,
 *     the lighting delta swamps whatever setting was under test. That does not
 *     fail; it produces a confident wrong number, and the device day that
 *     produced it (Wave 4, the hard gate for this whole programme) is wasted.
 *     So FS/QS-A4 asserts the frozen SET contains 'sun', not just that freezing
 *     happened.
 *
 *  2. **"Manual suspends Auto"** must mean the adaptive layer cannot WRITE, not
 *     merely that it is asked politely. CONTRACT §7.1: "Once Manual is active,
 *     the adaptive tier must not write the quantities the panel owns — not once,
 *     not on the next frame." So QS-A2 asserts `apply` was never called, not
 *     that the value was restored afterwards.
 *
 *  3. **requested ≠ effective.** CONTRACT §0 defines `effective` as "a value read
 *     back off the live object that renders … never recomputed from intent."
 *     This entire programme exists because of one such desync (A6). A settings
 *     module that echoes the request back as the effective value is the desync
 *     with a nicer face on it, and it passes every naive test. QS-A6 injects a
 *     `readEffective` that deliberately returns something ELSE, and requires the
 *     record to carry the read-back value.
 *
 *  4. **`paused` is not a reset tag.** CONTRACT §2.2 (RUL-2): pausing marks
 *     samples invalid for decisions and KEEPS them; it does not clear history.
 *     QS-A10 pins the closed enum and asserts `setPaused(true)` emits no reset.
 *
 * ---------------------------------------------------------------------------
 * THE API THIS SUITE PINS  (Wave 2 transcribes; it does not redesign)
 * ---------------------------------------------------------------------------
 *   export const QUALITY_MODES    = { AUTO:'auto', MANUAL:'manual', BENCHMARK:'benchmark' }
 *   export const REQUEST_SOURCES  = { PANEL:'panel', ADAPTIVE:'adaptive', PROBE:'probe' }
 *   export const RESET_TAGS       = { LOAD:'load', RESUME:'resume', RESIZE:'resize',
 *                                     ORIENTATION:'orientation', CONTEXT_RESTORE:'contextRestore',
 *                                     ENVIRONMENT:'environment', MANUAL:'manual' }
 *   export const BENCHMARK_FROZEN = ['seed','route','settings','sun']   // order-insensitive
 *
 *   export function createQualitySettings({
 *     apply,           // (key, requestedValue) => void   the ONE routing point (CONTRACT §7.2)
 *     readEffective,   // (key) => value                  read back off the live object
 *     onResetHistory,  // ({ tag, mode, atMs }) => void   tag ∈ RESET_TAGS, always present
 *     freeze,          // (what, frozen) => void          what ∈ BENCHMARK_FROZEN
 *     now,             // () => ms                        injected clock (fake-clock friendly)
 *     clamp,           // optional (key, value) => value  bounds live OUTSIDE this module
 *     storage,         // optional { getItem, setItem }   locks are session-scoped: never written
 *   })
 *
 * Instance surface:
 *   .mode                      'auto' | 'manual' | 'benchmark'
 *   .setMode(mode)             throws RangeError on anything else — no silent fallback
 *   .request({ source, key, value })  -> record (below)
 *   .sealDefaults()            ends the probe's window ("after the first frame", CONTRACT §7.1)
 *   .setPaused(bool)           validity state; NOT a reset
 *   .setLearningEnabled(bool)  the user's PNL-5 toggle
 *   .snapshot()                { mode, adapting, learning, paused, sealed, values }
 *
 * Record shape (the requested-vs-effective pair is the point of the module):
 *   { key, source, requested, effective, clamped, changed, applied, rejected, reason }
 *   - requested : exactly what the caller asked for, unmodified
 *   - effective : whatever readEffective(key) returns AFTER apply() — never the request
 *   - clamped   : requested !== the value handed to apply()
 *   - changed   : readEffective(key) after !== readEffective(key) before
 *   - rejected  : true when the request never reached apply(); reason ∈
 *                 { 'mode-locked', 'probe-after-init', 'unknown-source' }
 *
 * NOTE ON PROVISIONAL NUMBERS (CONTRACT §10 rule 1): the DPR range 0.85–2.0 and
 * the 1.7 mobile ceiling are PRO-9, provenance `unmeasured`. No test below
 * hardcodes them. Bounds are injected via `clamp`, and the assertions are about
 * REPORTING a clamp, never about where the clamp sits.
 *
 * ---------------------------------------------------------------------------
 * R4 — red-first form
 * ---------------------------------------------------------------------------
 * Every test dynamic-imports INSIDE its body and is skipped unless
 * BIRB_PERF_IMPL is set. A top-level static import of a module that does not
 * exist resolves before any skip is evaluated and turns tests.yml red for the
 * whole repo — humanoid/, gauntlet/, sculpture/ and icon3d/ included.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../src/game/quality-settings.js';
const IMPL = process.env.BIRB_PERF_IMPL ? false
  : 'BIRB_PERF_IMPL unset — src/game/quality-settings.js is a Wave 2 deliverable (P2.1)';

/** Dynamic import with a legible red. Preserves err.code so ERR_MODULE_NOT_FOUND stays visible. */
async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 2 P2.1 must create it.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// A recording double for every injected side effect. Nothing here computes a
// quality value: the harness's job is to be able to LIE about the effective
// value, so a module that echoes the request is detectable.
// ---------------------------------------------------------------------------
function makeRig({ quantise = null, clamp = null } = {}) {
  const applied = [];      // { key, value }
  const resets = [];       // { tag, mode, atMs }
  const frozen = [];       // { what, frozen }
  const stored = [];       // { key, value }
  const live = new Map();  // the "live object that renders"
  let t = 1000;

  const rig = {
    applied, resets, frozen, stored, live,
    advance(ms) { t += ms; return t; },
    get nowMs() { return t; },
    setLive(key, value) { live.set(key, value); },
    deps: {
      now: () => t,
      apply(key, value) {
        applied.push({ key, value });
        // The live object stores what it can actually do with the value, which
        // is not necessarily the value: quantise() stands in for DPR rounding,
        // texture-size rounding, a driver refusing a dimension, and so on.
        live.set(key, quantise ? quantise(key, value) : value);
      },
      readEffective(key) { return live.has(key) ? live.get(key) : null; },
      onResetHistory(evt) { resets.push(evt); },
      freeze(what, isFrozen) { frozen.push({ what, frozen: isFrozen }); },
      storage: {
        getItem: () => null,
        setItem: (key, value) => { stored.push({ key, value }); },
      },
    },
  };
  if (clamp) rig.deps.clamp = clamp;
  return rig;
}

// ---------------------------------------------------------------------------
// QS-A1 — the mode enum is a CLOSED set of exactly three, and an unknown mode
//         is rejected loudly.
//
// Would catch: `setMode(x) { this.mode = x }`, which lets a typo ('Manual',
// 'bench') put the panel into a fourth state nothing else in the system knows
// about — the panel then displays a mode the controller does not honour, which
// is TEL-15's forbidden inference arriving by a different door.
// ---------------------------------------------------------------------------
test('QS-A1 the mode enum is exactly {auto, manual, benchmark} and unknown modes throw', { skip: IMPL }, async () => {
  const { createQualitySettings, QUALITY_MODES } = await load();

  assert.deepEqual(
    Object.values(QUALITY_MODES).slice().sort(),
    ['auto', 'benchmark', 'manual'],
    'QUALITY_MODES must be exactly the three named by CTL-1',
  );

  const rig = makeRig();
  const s = createQualitySettings(rig.deps);
  assert.equal(s.mode, QUALITY_MODES.AUTO, 'a fresh session starts in Auto');

  for (const bad of ['Manual', 'bench', 'pinned', '', null, undefined, 3]) {
    assert.throws(
      () => s.setMode(bad),
      RangeError,
      `setMode(${JSON.stringify(bad)}) must throw RangeError, not fall back silently`,
    );
    assert.equal(s.mode, QUALITY_MODES.AUTO, 'a rejected setMode must not move the mode');
  }
});

// ---------------------------------------------------------------------------
// QS-A2 — Manual suspends Auto: an adaptive request must never reach apply().
//
// Would catch: an implementation that lets the adaptive layer write and then
// "restores" the manual value on the next frame. CONTRACT §7.1: "not once, not
// on the next frame." Six sites in index.html write these quantities EVERY
// FRAME (T4 wind, T6 weather density, T9 contact shadow, T10 ribbons), so a
// write-then-restore design produces a value that flickers at 60 Hz while every
// static assertion still reads the right number.
// ---------------------------------------------------------------------------
test('QS-A2 in Manual an adaptive request never reaches apply()', { skip: IMPL }, async () => {
  const { createQualitySettings, QUALITY_MODES, REQUEST_SOURCES } = await load();
  const rig = makeRig();
  const s = createQualitySettings(rig.deps);

  s.setMode(QUALITY_MODES.MANUAL);
  const panel = s.request({ source: REQUEST_SOURCES.PANEL, key: 'dpr', value: 1.4 });
  assert.equal(panel.rejected, false, 'the panel owns the value in Manual');
  assert.equal(rig.applied.length, 1);

  const before = rig.applied.length;
  const adaptive = s.request({ source: REQUEST_SOURCES.ADAPTIVE, key: 'dpr', value: 0.85 });

  assert.equal(adaptive.rejected, true, 'Manual suspends Auto');
  assert.equal(adaptive.reason, 'mode-locked');
  assert.equal(rig.applied.length, before, 'apply() must not be called at all — not once');
  assert.equal(rig.deps.readEffective('dpr'), 1.4, 'the panel value survives untouched');

  // …and the suspension is not a one-frame courtesy.
  for (let frame = 0; frame < 8; frame += 1) {
    rig.advance(16);
    s.request({ source: REQUEST_SOURCES.ADAPTIVE, key: 'dpr', value: 0.85 });
  }
  assert.equal(rig.applied.length, before, 'still zero adaptive writes eight frames later');
  assert.equal(rig.deps.readEffective('dpr'), 1.4);
});

// ---------------------------------------------------------------------------
// QS-A3 — Benchmark suspends BOTH adaptation and learning, and Manual suspends
//         adaptation while preserving the user's learning preference.
//
// Would catch: `learning = !benchmark`, which silently discards the user's
// PNL-5 toggle. Also catches a Benchmark that stops adapting but keeps writing
// learned actions — "it does not adapt during a comparison" (CTL-1) is about
// the settings not moving, and a learned action moves them.
// ---------------------------------------------------------------------------
test('QS-A3 Benchmark suspends adaptation and learning; Manual restores the user preference', { skip: IMPL }, async () => {
  const { createQualitySettings, QUALITY_MODES, REQUEST_SOURCES } = await load();
  const rig = makeRig();
  const s = createQualitySettings(rig.deps);

  s.setLearningEnabled(true);
  assert.equal(s.snapshot().adapting, true, 'Auto adapts');
  assert.equal(s.snapshot().learning, true, 'and learns, because the user asked it to');

  s.setMode(QUALITY_MODES.MANUAL);
  assert.equal(s.snapshot().adapting, false);
  assert.equal(s.snapshot().learning, false, 'Manual suspends learning-driven changes');

  s.setMode(QUALITY_MODES.BENCHMARK);
  assert.equal(s.snapshot().adapting, false);
  assert.equal(s.snapshot().learning, false);
  const n = rig.applied.length;
  s.request({ source: REQUEST_SOURCES.ADAPTIVE, key: 'weatherDensity', value: 0 });
  assert.equal(rig.applied.length, n, 'Benchmark does not adapt during a comparison');

  s.setMode(QUALITY_MODES.AUTO);
  assert.equal(s.snapshot().learning, true,
    "Resume Auto must restore the user's learning toggle, not leave it off");
});

// ---------------------------------------------------------------------------
// QS-A4 — Benchmark freezes seed, route, settings AND SUN. This is the one.
//
// Would catch: freezing seed + route + settings and forgetting the sun. The
// game's sun cycle is ten minutes; two benchmark runs three minutes apart are
// lit differently, so the A/B measures the time of day. Nothing fails, nothing
// warns, and the number is confidently wrong — and it is the number a Wave 4
// device day exists to produce.
//
// Oracle independence: the assertion is on the SET handed to the injected
// freeze() callback, which the module cannot satisfy by restating its own
// intent. The test also requires the thaw on exit, because a benchmark that
// never unfreezes the sun ships a game with a stopped sky.
// ---------------------------------------------------------------------------
test('QS-A4 Benchmark freezes seed, route, settings AND sun, and thaws all four on exit', { skip: IMPL }, async () => {
  const { createQualitySettings, QUALITY_MODES, BENCHMARK_FROZEN } = await load();

  assert.deepEqual(
    BENCHMARK_FROZEN.slice().sort(),
    ['route', 'seed', 'settings', 'sun'],
    'CTL-1 verbatim: "Benchmark fixes seed, route, settings and sun"',
  );

  const rig = makeRig();
  const s = createQualitySettings(rig.deps);

  s.setMode(QUALITY_MODES.BENCHMARK);
  const frozenSet = rig.frozen.filter((f) => f.frozen === true).map((f) => f.what).sort();
  assert.deepEqual(frozenSet, ['route', 'seed', 'settings', 'sun'],
    'all four are frozen on entering Benchmark — the sun above all, it moves on a ten-minute cycle');

  rig.frozen.length = 0;
  s.setMode(QUALITY_MODES.AUTO);
  const thawed = rig.frozen.filter((f) => f.frozen === false).map((f) => f.what).sort();
  assert.deepEqual(thawed, ['route', 'seed', 'settings', 'sun'],
    'leaving Benchmark thaws all four — a game shipped with a frozen sun is the same bug wearing a different hat');
});

// ---------------------------------------------------------------------------
// QS-A5 — Resume Auto clears stale history, with the 'manual' tag from the
//         closed enum, and does so from BOTH locked modes.
//
// Would catch: (a) no reset at all, so the controller resumes on windows
// accumulated while a human was dragging sliders and immediately downshifts;
// (b) an untagged reset — CONTRACT §2.1: "An untagged reset is a contract
// violation", because an untagged reset in the evidence export cannot be told
// from a spike; (c) a reset that fires only from Manual, leaving Benchmark's
// frozen-settings windows to poison the first Auto decision.
// ---------------------------------------------------------------------------
test("QS-A5 Resume Auto clears stale history with the 'manual' tag, from Manual and from Benchmark", { skip: IMPL }, async () => {
  const { createQualitySettings, QUALITY_MODES, RESET_TAGS } = await load();

  for (const locked of [QUALITY_MODES.MANUAL, QUALITY_MODES.BENCHMARK]) {
    const rig = makeRig();
    const s = createQualitySettings(rig.deps);

    s.setMode(locked);
    rig.resets.length = 0;
    rig.advance(5000);

    s.setMode(QUALITY_MODES.AUTO);
    assert.equal(rig.resets.length, 1, `exactly one history reset resuming Auto from ${locked}`);
    assert.equal(rig.resets[0].tag, RESET_TAGS.MANUAL,
      "the tag is 'manual' — the panel-action tag from the closed enum (CONTRACT §2.1)");
    assert.ok(
      Object.values(RESET_TAGS).includes(rig.resets[0].tag),
      'and it is a member of the closed enum, not a free-form string',
    );
    assert.equal(rig.resets[0].atMs, rig.nowMs, 'stamped with the injected clock');
  }
});

// ---------------------------------------------------------------------------
// QS-A6 — requested vs effective are both reported, and `effective` is READ
//         BACK, never echoed.
//
// This is the desync assertion in miniature. The rig's apply() deliberately
// quantises (0.05 steps, as PRO-9 describes the slider) so requested 1.73
// becomes an effective 1.70. A module that reports `effective: 1.73` has told
// you what it MEANT to do — CONTRACT §3.1's forbidden sentinel substitute
// "any value derived from what the code intended".
//
// Would catch: `return { requested: v, effective: v }`, which passes every test
// that only checks "the setting changed", and is exactly how a slider becomes a
// label.
// ---------------------------------------------------------------------------
test('QS-A6 a clamped request reports requested AND effective, and effective is read back', { skip: IMPL }, async () => {
  const { createQualitySettings, REQUEST_SOURCES } = await load();

  const rig = makeRig({
    // The live renderer can only take 0.05 steps and refuses anything over 1.7.
    // Both bounds are injected: PRO-9 is provisional and no test may fix it.
    quantise: (key, v) => (key === 'dpr' ? Math.round(Math.min(v, 1.7) * 20) / 20 : v),
  });
  const s = createQualitySettings(rig.deps);

  const record = s.request({ source: REQUEST_SOURCES.PANEL, key: 'dpr', value: 1.73 });

  assert.equal(record.requested, 1.73, 'the request is reported unmodified');
  assert.equal(record.effective, 1.7, 'the effective value is what the live object came back with');
  assert.notEqual(record.effective, record.requested,
    'requested and effective must be distinguishable — this programme exists because of one desync');
  assert.equal(record.clamped, true);
  assert.equal(record.changed, true, 'rendering work changed');
  assert.equal(record.applied, true);

  // The unclamped case must report clamped:false rather than "always true".
  const clean = s.request({ source: REQUEST_SOURCES.PANEL, key: 'dpr', value: 1.25 });
  assert.equal(clean.requested, 1.25);
  assert.equal(clean.effective, 1.25);
  assert.equal(clean.clamped, false);

  // And the snapshot carries the pair too — CTL-8 requires the export to hold
  // "requested/effective values", and reporting only one is how a desync hides.
  const values = s.snapshot().values;
  assert.equal(values.dpr.requested, 1.25);
  assert.equal(values.dpr.effective, 1.25);
  assert.ok('clamped' in values.dpr, 'the snapshot keeps the clamp flag per key');
});

// ---------------------------------------------------------------------------
// QS-A7 — "the slider moved" is not evidence that rendering work changed.
//
// A request whose read-back value is identical before and after must report
// `changed: false`. RL-2 verbatim: "A slider value changing is not evidence
// that rendering work changed."
//
// Would catch: a control wired to a label. This is the exact failure G2b exists
// to stop ("is each control wired to rendering work, or to a label?") and it is
// how a whole wave of quality controls can ship green.
// ---------------------------------------------------------------------------
test('QS-A7 a request that moves nothing reports changed:false', { skip: IMPL }, async () => {
  const { createQualitySettings, REQUEST_SOURCES } = await load();

  // A live object that ignores everything — the label case.
  const rig = makeRig({ quantise: () => 1.0 });
  const s = createQualitySettings(rig.deps);

  const first = s.request({ source: REQUEST_SOURCES.PANEL, key: 'dpr', value: 1.0 });
  assert.equal(first.effective, 1.0);

  const second = s.request({ source: REQUEST_SOURCES.PANEL, key: 'dpr', value: 2.0 });
  assert.equal(second.requested, 2.0, 'the slider moved');
  assert.equal(second.effective, 1.0, 'and the renderer did not');
  assert.equal(second.changed, false,
    'changed must be derived from the read-back pair, never from the request');
  assert.equal(second.clamped, true, 'and the gap between the two is reported as a clamp');
});

// ---------------------------------------------------------------------------
// QS-A8 — precedence: panel > adaptive > probe, and the probe is defaults-only.
//
// CONTRACT §7.1: "The capability probe supplies initial defaults only, never a
// per-frame value, and never overrides either layer above it after the first
// frame."
//
// Would catch: `isLowEnd` growing a new consumer. index.html:3578 still reads
// navigator.hardwareConcurrency, which iOS Safari does not expose at all — the
// single most expensive mistake in this repo's history, and it is still live.
// A probe that can write after init re-arms it.
// ---------------------------------------------------------------------------
test('QS-A8 the capability probe supplies defaults only and is refused after sealDefaults()', { skip: IMPL }, async () => {
  const { createQualitySettings, REQUEST_SOURCES } = await load();
  const rig = makeRig();
  const s = createQualitySettings(rig.deps);

  const boot = s.request({ source: REQUEST_SOURCES.PROBE, key: 'dpr', value: 1.0 });
  assert.equal(boot.rejected, false, 'before the first frame the probe supplies the default');
  assert.equal(rig.deps.readEffective('dpr'), 1.0);

  s.sealDefaults();
  assert.equal(s.snapshot().sealed, true);

  const n = rig.applied.length;
  const late = s.request({ source: REQUEST_SOURCES.PROBE, key: 'dpr', value: 0.85 });
  assert.equal(late.rejected, true, 'the probe never writes after the first frame');
  assert.equal(late.reason, 'probe-after-init');
  assert.equal(rig.applied.length, n);
  assert.equal(rig.deps.readEffective('dpr'), 1.0);

  // Adaptive still writes in Auto; panel still outranks it.
  s.request({ source: REQUEST_SOURCES.ADAPTIVE, key: 'dpr', value: 0.85 });
  assert.equal(rig.deps.readEffective('dpr'), 0.85, 'adaptive outranks the probe');

  const unknown = s.request({ source: 'tier-manager', key: 'dpr', value: 0.5 });
  assert.equal(unknown.rejected, true, 'REQUEST_SOURCES is a closed enum');
  assert.equal(unknown.reason, 'unknown-source');
  assert.equal(rig.deps.readEffective('dpr'), 0.85);
});

// ---------------------------------------------------------------------------
// QS-A9 — a mode is never inferred, and never persisted.
//
// TEL-15 verbatim: "Reporting `pinned === true` as 'Manual' is an inference and
// is forbidden — a harness pin and a user's Manual are different states with
// different exit paths." So NO request, from any source, may move the mode:
// only setMode does.
//
// CTL-8: "keep benchmark/manual locks session-scoped." A Manual lock written to
// storage is a game that boots degraded forever and cannot be talked out of it.
//
// Would catch: `if (tierPinned) mode = 'manual'`, and any localStorage write of
// the lock.
// ---------------------------------------------------------------------------
test('QS-A9 mode is moved only by setMode, and locks are session-scoped', { skip: IMPL }, async () => {
  const { createQualitySettings, QUALITY_MODES, REQUEST_SOURCES } = await load();
  const rig = makeRig();
  const s = createQualitySettings(rig.deps);

  for (const source of Object.values(REQUEST_SOURCES)) {
    s.request({ source, key: 'tier', value: 2 });
    assert.equal(s.mode, QUALITY_MODES.AUTO,
      `a ${source} request must not infer a mode — a pin is not Manual (TEL-15)`);
  }

  s.setMode(QUALITY_MODES.MANUAL);
  s.setMode(QUALITY_MODES.BENCHMARK);
  assert.deepEqual(rig.stored, [],
    'benchmark/manual locks are session-scoped: nothing about them is persisted (CTL-8)');

  // A fresh instance over the same storage boots in Auto.
  const fresh = createQualitySettings(rig.deps);
  assert.equal(fresh.mode, QUALITY_MODES.AUTO);
});

// ---------------------------------------------------------------------------
// QS-A10 — the reset-tag enum is closed, and `paused` is NOT in it.
//
// CONTRACT §2.2 (RUL-2), and the plan verbatim: "Mark paused measurements
// invalid for adaptive decisions" — not "discard them". A 900 ms frame while
// the tab was hidden is real data about the resume path; erasing it means the
// resume spike can never be studied, and the controller learns nothing about a
// boundary it crosses every session.
//
// Would catch: `setPaused(true) => resetHistory({tag:'paused'})`, which is both
// an out-of-enum tag AND the wrong behaviour, and is the single most natural
// thing for a cheap agent to write.
// ---------------------------------------------------------------------------
test('QS-A10 RESET_TAGS is closed, excludes "paused", and setPaused emits no reset', { skip: IMPL }, async () => {
  const { createQualitySettings, RESET_TAGS } = await load();

  assert.deepEqual(
    Object.values(RESET_TAGS).slice().sort(),
    ['contextRestore', 'environment', 'load', 'manual', 'orientation', 'resize', 'resume'],
    'the seven tags of CONTRACT §2.1, and only those',
  );
  assert.ok(!Object.values(RESET_TAGS).includes('paused'),
    'paused is a VALIDITY STATE, not a reset tag (RUL-2)');

  const rig = makeRig();
  const s = createQualitySettings(rig.deps);

  s.setPaused(true);
  assert.equal(s.snapshot().paused, true, 'the state is recorded…');
  assert.deepEqual(rig.resets, [], '…and no history is cleared: paused samples are kept, marked invalid');

  s.setPaused(false);
  assert.deepEqual(rig.resets, [], 'resuming from paused is not a reset either');
});

// ---------------------------------------------------------------------------
// QS-A11 — the snapshot reports the active mode as a first-class value, and
//          never as a sentinel once the module exists.
//
// TEL-15's sentinel (`not-implemented`) is correct for Waves 0–2 while nothing
// owns the mode. The moment this module exists, reporting the sentinel there
// instead of the mode would mean the panel shows "unavailable" for a fact it
// holds in a variable. A11 requires the reverse direction too: no sentinel
// field ever serialises a number.
// ---------------------------------------------------------------------------
test('QS-A11 snapshot() reports a real mode, never a sentinel object', { skip: IMPL }, async () => {
  const { createQualitySettings, QUALITY_MODES } = await load();
  const rig = makeRig();
  const s = createQualitySettings(rig.deps);

  for (const mode of Object.values(QUALITY_MODES)) {
    s.setMode(mode);
    const snap = s.snapshot();
    assert.equal(typeof snap.mode, 'string');
    assert.equal(snap.mode, mode);
    assert.ok(!('state' in Object(snap.mode)), 'the mode is a value, not a {state, reason} sentinel');
  }
});
