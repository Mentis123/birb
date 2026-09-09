/**
 * tests/perf-learning.test.js — RED-FIRST spec for `src/game/perf-learning.js`,
 * steps 1, 3, 4 and 5 of the MANDATORY RUNTIME LOOP.
 *
 * Wave 3 / task P3.2 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4 — which calls
 * this module out by name: "`perf-learning` (WITH ITS OWN AUTHORED SUITE —
 * three designs assigned the privacy deny-list, entry cap and age-out to a
 * module with no test file)". This is that file.
 *
 * Implements docs/PERFORMANCE_REALISM_PLAN.md's runtime loop:
 *   1. OBSERVE AND PREDICT — settings, distribution, timings, biome, gameplay
 *      state and load trend; ONE bounded adjustment, with expected benefit and
 *      confidence.
 *   3. EVALUATE — "compare equal-duration windows in comparable gameplay
 *      conditions. A FLIGHT INTO A QUIETER AREA MUST NOT BE CREDITED TO THE
 *      ADJUSTMENT. Mark changing scenes, unavailable evidence or differences
 *      within measured noise as inconclusive."
 *   4. KEEP OR ROLL BACK — "Roll back ineffective reductions and failed
 *      upgrades; an inconclusive probe returns to the prior stable state once
 *      safe. Emergency recovery takes priority while severe overload persists."
 *   5. LEARN — "maintain a small action history with predicted versus observed
 *      benefit, confidence, failed probes and cooldowns."
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS SUITE FORBIDS, LOUDLY
 * ---------------------------------------------------------------------------
 * DEF-1 DEFERS PERSISTENCE. There is no localStorage store here, in this wave,
 * at all — CONTRACT §9 DEF-1 ships "in-session action history, in memory" and
 * names what reopens the rest. A suite that demanded the deferred store would
 * force Wave 3B to build it.
 *
 * AND THE COARSE CAPABILITY BUCKET MUST NOT REACH FOR
 * `navigator.hardwareConcurrency`. That is this repository's most expensive
 * documented mistake — bloom was gated off on every iPhone ever made because
 * iOS Safari does not expose it and `undefined || 4` is 4 — and it is STILL
 * LIVE at index.html:3578. The plan's own instruction is to "learn a small
 * amount from local measurements rather than guessing device quality from a
 * user-agent or CPU-core count". PL-23 spies on the global and asserts zero
 * accesses.
 *
 * ---------------------------------------------------------------------------
 * R4 — red-first form
 * ---------------------------------------------------------------------------
 *   node --test tests/perf-learning.test.js                  # skipped
 *   BIRB_PERF_IMPL=1 node --test tests/perf-learning.test.js  # red until P3.2 builds it
 *
 * ---------------------------------------------------------------------------
 * THE SURFACE THIS SUITE PINS
 * ---------------------------------------------------------------------------
 *   createPerfLearning({
 *     now,            // () => ms          injected clock
 *     constants,      // PROVISIONAL-shaped table (src/game/perf-constants.js)
 *     targetFPS,      // default constants-derived; B = 1000 / targetFPS
 *     maxEntries,     // optional; the module's default must be FINITE
 *     minSamples,     // optional; defaults to constants.acceptanceMinSamples
 *   })
 *   -> {
 *     observe(context) -> record          // step 1, the baseline
 *     predict(candidate) -> { accepted, rejected, reason, id }
 *     evaluate({ id, before, after, verification }) ->
 *         { verdict, reason, deltaMs, predictionErrorMs, creditable }
 *     resolve({ id, verdict, emergency }) ->
 *         { decision, reason, nextEligibleMs, abandonedProbeId? }
 *     onBoundary(tag, tMs)                // a CONTRACT §2.1 reset tag
 *     setEnabled(on) / enabled            // PNL-5
 *     history() -> frozen array           // bounded, newest last
 *     reset()                             // PNL-5 "reset learned profile"
 *     snapshot()                          // PNL-1..4 + maxEntries
 *     capabilityBucket() -> { bucket, basis } | CONTRACT §3.1 sentinel
 *   }
 *
 * CONTEXT (step 1's seven recorded things):
 *   { tMs, rung, settings, distribution:{ p95Ms, medianMs, missedTargetPct },
 *     timings:{ cpuMs, updateMs, submitMs, gpu }, biome,
 *     gameplay:{ loading, inputActivity01, paused, sceneChanged },
 *     loadTrend }
 *
 * WINDOW (what `before`/`after` are — the same sample shape the trace driver
 * and frame-metrics already use, so a device capture drops straight in):
 *   { startMs, endMs, samples:[{ dtMs, tMs, valid, invalidReason, tag }],
 *     conditions:{ biome, rung, sceneChanged, loading, inputActivity01 } }
 *
 * EVALUATE's reason enum is closed:
 *   'ok' | 'unequal-windows' | 'scene-change' | 'paused' | 'input-heavy' |
 *   'insufficient-samples' | 'within-noise' | 'not-applied'
 * and only 'ok' may carry a verdict of 'benefit' or 'regression'. Anything
 * else is 'inconclusive' and NOT creditable.
 *
 * THE COMPARISON, pinned so it cannot be quietly widened: p95 over VALID
 * samples only, using the SHARED nearest-rank helper `percentile` from
 * src/game/frame-metrics.js — never a second percentile implementation. The
 * noise band is `max(p95 - median)` across the two windows; a |delta| inside
 * that band is 'within-noise'.
 *
 * `deltaMs` is `p95(before, valid) - p95(after, valid)` — positive means the
 * frames got faster — and IS REPORTED whenever the comparison got as far as
 * measuring, which includes 'within-noise'. It is null only when the
 * comparison never got that far: 'not-applied', 'unequal-windows',
 * 'scene-change', 'input-heavy', 'paused', 'insufficient-samples'. Reporting
 * the number even when the verdict is inconclusive is what lets a human see
 * that the evaluator measured 0.3 ms of nothing rather than nothing at all.
 *
 * The checks run in a FIXED order, so two correct implementations cannot
 * disagree about which reason to report for a doubly-confounded window:
 *   not-applied > unequal-windows > scene-change > input-heavy >
 *   paused / insufficient-samples > within-noise > ok.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVISIONAL, budgetMs, TARGET_FPS } from '../src/game/perf-constants.js';
import { percentile, RESET_TAGS } from '../src/game/frame-metrics.js';
import { APPLY_KINDS } from './fixtures/perf-traces/driver.js';

const MODULE = '../src/game/perf-learning.js';
const K = PROVISIONAL;
const B = budgetMs(TARGET_FPS);

const IMPL = process.env.BIRB_PERF_IMPL
  ? false
  : 'BIRB_PERF_IMPL unset — src/game/perf-learning.js is a Wave 3 deliverable (P3.2)';

async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 3 P3.2 must create it.\n` +
      `  Its surface is pinned at the top of tests/perf-learning.test.js.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

function clockFrom(t0 = 0) {
  const c = { t: t0, now: () => c.t };
  return c;
}

/** Five evaluation windows' worth of time. Long enough that even a window of
 *  33 ms frames clears `constants.acceptanceMinSamples`, so a row that is
 *  meant to fail on a CONFOUND is not quietly failing on sufficiency instead.
 *  Derived from the constants, never written down. */
const WINDOW_MS = 5 * K.evaluationWindowMs;

/**
 * A window of frames. `intervals` is a function of the frame index so a
 * distribution with a tail can be described without a literal array.
 */
function windowOf({ startMs = 0, durationMs = WINDOW_MS, interval, invalidEvery = 0,
  invalidMs = 900, conditions = {} } = {}) {
  const samples = [];
  let t = startMs;
  let i = 0;
  while (t < startMs + durationMs) {
    const paused = invalidEvery > 0 && i % invalidEvery === invalidEvery - 1;
    const dtMs = paused ? invalidMs : interval(i);
    samples.push({
      dtMs,
      tMs: t,
      valid: !paused,
      invalidReason: paused ? 'hidden' : null,
      tag: null,
    });
    t += dtMs;
    i += 1;
  }
  return {
    startMs,
    endMs: startMs + durationMs,
    samples,
    conditions: {
      biome: 'forest', rung: 0, sceneChanged: false, loading: false, inputActivity01: 0.1,
      ...conditions,
    },
  };
}

/** Steady frames at `ms`, with a small deterministic ripple so a window has a
 *  measurable spread rather than a single repeated number. */
const steady = (ms, ripple = 0.2) => (i) => ms + (i % 3) * ripple;

function validDts(w) {
  return w.samples.filter((s) => s.valid !== false).map((s) => s.dtMs);
}
function noiseBand(a, b) {
  const band = (w) => percentile(validDts(w), 0.95) - percentile(validDts(w), 0.5);
  return Math.max(band(a), band(b));
}

const SENTINEL_REASONS = ['not-implemented', 'no-extension', 'no-context', 'not-webgl2',
  'disjoint', 'insufficient-samples', 'paused', 'not-applicable', 'stale'];

function assertSentinel(v, what) {
  assert.ok(v && typeof v === 'object', `${what} must be a CONTRACT §3.1 sentinel object, got ${JSON.stringify(v)}`);
  assert.equal(v.value, null, `${what}: a sentinel's value is null — never 0, never a plausible default`);
  assert.equal(v.state, 'unavailable', `${what}: state must be "unavailable"`);
  assert.ok(SENTINEL_REASONS.includes(v.reason), `${what}: reason "${v.reason}" is not in the CONTRACT §3.1 closed enum`);
}

/** A baseline observation the module can predict from. */
function baseContext(tMs, over = {}) {
  return {
    tMs,
    rung: 0,
    settings: { dpr: K.dprDefaultCeilingMobile, post: 'half', shafts: true },
    distribution: { p95Ms: B, medianMs: B, missedTargetPct: 0 },
    timings: { cpuMs: 6.4, updateMs: 3.9, submitMs: 2.5, gpu: { value: null, state: 'unavailable', reason: 'no-extension' } },
    biome: 'forest',
    gameplay: { loading: false, inputActivity01: 0.1, paused: false, sceneChanged: false },
    loadTrend: 'flat',
    ...over,
  };
}

const candidate = (over = {}) => ({
  kind: 'probe',
  fromRung: 1,
  toRung: 0,
  keys: ['dpr'],
  expectedBenefitMs: 1.5,
  confidence: 0.4,
  reason: 'headroom suspected; no GPU timer on this device',
  ...over,
});

const APPLIED = { creditable: true, verdict: 'applied', state: 'resolved' };

// ===========================================================================
// STEP 1 — OBSERVE AND PREDICT
// ===========================================================================

// ---------------------------------------------------------------------------
// PL-0 — the factory shape. CONTRACT §11: injected side effects or it is not
// testable here at all.
// REJECTS: a module that imports THREE, reads a wall clock, or reaches for the
//          renderer.
// ---------------------------------------------------------------------------
test('PL-0 createPerfLearning takes its side effects as injected callbacks', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  assert.equal(typeof createPerfLearning, 'function');
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  for (const m of ['observe', 'predict', 'evaluate', 'resolve', 'onBoundary', 'setEnabled', 'history', 'reset', 'snapshot', 'capabilityBucket']) {
    assert.equal(typeof L[m], 'function', `perf-learning must expose ${m}()`);
  }
});

// ---------------------------------------------------------------------------
// PL-1 — observe() records all seven things step 1 names.
// REJECTS: an action log that records what was done and not what it was done
//          from — which makes every later "was that a good idea" unanswerable.
// ---------------------------------------------------------------------------
test('PL-1 observe() records settings, distribution, timings, biome, gameplay state and load trend', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const rec = L.observe(baseContext(clock.t));
  for (const field of ['tMs', 'rung', 'settings', 'distribution', 'timings', 'biome', 'gameplay', 'loadTrend']) {
    assert.ok(field in rec, `the observation must record ${field}`);
  }
  assert.deepEqual(rec.timings.gpu, { value: null, state: 'unavailable', reason: 'no-extension' },
    'an unavailable GPU time is carried through verbatim, never flattened to a number');
});

// ---------------------------------------------------------------------------
// PL-2 — a missing source becomes a sentinel, never a zero.
// REJECTS: `updateMs || 0`. A zero CPU update time is indistinguishable from a
//          measurement, and this repo has already shipped two systems whose
//          "measurement" was a default (the dead FPS sampler; the bloom probe).
// ---------------------------------------------------------------------------
test('PL-2 an unsupplied observation field is a sentinel, not 0', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const rec = L.observe(baseContext(clock.t, {
    timings: { cpuMs: 6.4, updateMs: null, submitMs: null, gpu: { value: null, state: 'unavailable', reason: 'not-webgl2' } },
    biome: undefined,
  }));
  assertSentinel(rec.timings.updateMs, 'timings.updateMs');
  assertSentinel(rec.timings.submitMs, 'timings.submitMs');
  assertSentinel(rec.biome, 'biome');
  assert.equal(rec.timings.cpuMs, 6.4, 'a field that DOES have a source stays a number');
});

// ---------------------------------------------------------------------------
// PL-3 — a prediction needs a baseline to be a prediction.
// REJECTS: predicting from nothing, which produces a "benefit" that can never
//          be scored because there is no before.
// ---------------------------------------------------------------------------
test('PL-3 predict() with no prior observation is rejected', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const r = L.predict(candidate({ tMs: clock.t }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'no-observation');
});

// ---------------------------------------------------------------------------
// PL-4 — expected benefit AND confidence are mandatory.
// REJECTS: a history with no predicted column, which makes RL-6's "prediction
//          error" permanently unmeasurable while looking complete.
// ---------------------------------------------------------------------------
test('PL-4 an adjustment with no expected benefit or no confidence is rejected', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));

  const noBenefit = L.predict(candidate({ tMs: clock.t, expectedBenefitMs: undefined }));
  assert.equal(noBenefit.accepted, false);
  assert.equal(noBenefit.reason, 'no-prediction');

  const noConfidence = L.predict(candidate({ tMs: clock.t, confidence: undefined }));
  assert.equal(noConfidence.accepted, false);
  assert.equal(noConfidence.reason, 'no-prediction');

  const ok = L.predict(candidate({ tMs: clock.t }));
  assert.equal(ok.accepted, true, 'a fully specified candidate is accepted — otherwise this row is passable by rejecting everything');
});

// ---------------------------------------------------------------------------
// PL-5 — ONE outstanding adjustment (PRO-8, "one outstanding probe").
// REJECTS: two probes in flight, whose effects cannot be attributed to either.
// ---------------------------------------------------------------------------
test('PL-5 a second probe while one is outstanding is rejected', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  assert.equal(L.predict(candidate({ tMs: clock.t })).accepted, true);
  clock.t += K.settleHoldMs;
  const second = L.predict(candidate({ tMs: clock.t }));
  assert.equal(second.accepted, false);
  assert.equal(second.reason, 'probe-overlap');
  assert.equal(K.maxOutstandingProbes, 1, 'PRO-8 as imported; if Wave 4 raises it this row is what says so');
});

// ---------------------------------------------------------------------------
// PL-6 — no probing during loading or high-input gameplay (PRO-8's other half).
// REJECTS: an exploratory probe fired while the world is still building, whose
//          measured "regression" is the loading spike and gets learned as a
//          fact about the setting.
// ---------------------------------------------------------------------------
test('PL-6 probes are refused during loading and during high-input gameplay', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });

  L.observe(baseContext(clock.t, { gameplay: { loading: true, inputActivity01: 0.1, paused: false, sceneChanged: false } }));
  const whileLoading = L.predict(candidate({ tMs: clock.t }));
  assert.equal(whileLoading.accepted, false);
  assert.equal(whileLoading.reason, 'not-probeable');

  L.observe(baseContext(clock.t, { gameplay: { loading: false, inputActivity01: 0.9, paused: false, sceneChanged: false } }));
  const whileFlying = L.predict(candidate({ tMs: clock.t }));
  assert.equal(whileFlying.accepted, false);
  assert.equal(whileFlying.reason, 'not-probeable');
});

// ---------------------------------------------------------------------------
// PL-7 — but a PROTECTIVE reduction is never blocked by any of that.
// REJECTS: the most likely wrong reading of PL-5/PL-6 — a blanket gate that
//          also refuses to shed work during loading or while a probe is
//          outstanding, stranding the device in overload for the one stretch
//          where overload is most likely. CONTRACT §7.1: emergency downshifts
//          are the one documented exception.
// ---------------------------------------------------------------------------
test('PL-7 downshifts and emergencies are accepted while loading, under input, and mid-probe', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  assert.equal(L.predict(candidate({ tMs: clock.t })).accepted, true, 'a probe is now outstanding');

  L.observe(baseContext(clock.t, {
    distribution: { p95Ms: B * K.overloadP95Multiplier * 2, medianMs: B * 2, missedTargetPct: K.overloadMissedTargetPct * 10 },
    gameplay: { loading: true, inputActivity01: 0.95, paused: false, sceneChanged: false },
  }));
  for (const kind of ['downshift', 'emergency']) {
    const r = L.predict(candidate({ kind, tMs: clock.t, fromRung: 0, toRung: 1 }));
    assert.equal(r.accepted, true, `a ${kind} must never be gated by loading, input activity or an outstanding probe`);
  }
});

// ---------------------------------------------------------------------------
// PL-8 — the probe rate limit is PRO-8's, imported.
// REJECTS: an inlined 30 s, and a rate limit that does not move when Wave 4
//          retunes the table.
// ---------------------------------------------------------------------------
test('PL-8 at most one upgrade probe per constants.probeIntervalMs', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  const first = L.predict(candidate({ tMs: clock.t }));
  assert.equal(first.accepted, true);
  L.resolve({ id: first.id, verdict: 'inconclusive' });

  clock.t += K.probeIntervalMs - 1;
  L.observe(baseContext(clock.t));
  const tooSoon = L.predict(candidate({ tMs: clock.t }));
  assert.equal(tooSoon.accepted, false);
  assert.equal(tooSoon.reason, 'probe-too-soon');

  clock.t += 1;
  L.observe(baseContext(clock.t));
  assert.equal(L.predict(candidate({ tMs: clock.t })).accepted, true,
    'exactly one interval later the probe is allowed again');
});

// ---------------------------------------------------------------------------
// PL-9 — the kind is the driver's closed set, not a second enum.
// REJECTS: a private vocabulary that PRO-8's probe budget cannot be enforced
//          against from outside (the routing point's whole purpose).
// ---------------------------------------------------------------------------
test('PL-9 predict() accepts only APPLY_KINDS', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  const bogus = L.predict(candidate({ kind: 'turn-it-down-a-bit', tMs: clock.t }));
  assert.equal(bogus.accepted, false);
  assert.equal(bogus.reason, 'unknown-kind');
  assert.ok(APPLY_KINDS.includes('probe') && APPLY_KINDS.includes('emergency'));
});

// ===========================================================================
// STEP 3 — EVALUATE.  The rows most likely to be written vacuously.
// ===========================================================================

async function armed(L, clock) {
  L.observe(baseContext(clock.t));
  const p = L.predict(candidate({ tMs: clock.t }));
  assert.equal(p.accepted, true);
  return p.id;
}

// ---------------------------------------------------------------------------
// PL-10 — equal-duration windows.
// REJECTS: "compare the last N samples with the previous N samples". At 60 fps
//          against 30 fps the same N spans twice the wall time and twice the
//          world, and the comparison is between two different flights.
// ---------------------------------------------------------------------------
test('PL-10 unequal-duration windows are inconclusive', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const id = await armed(L, clock);

  const before = windowOf({ startMs: 0, durationMs: WINDOW_MS, interval: steady(B * 1.25) });
  const after = windowOf({ startMs: WINDOW_MS, durationMs: WINDOW_MS * 2, interval: steady(B) });
  const r = L.evaluate({ id, before, after, verification: APPLIED });

  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.reason, 'unequal-windows');
  assert.equal(r.creditable, false);
});

// ---------------------------------------------------------------------------
// PL-11 — THE flight into a quieter area.
// REJECTS: the single most likely wrong implementation in the whole loop —
//          crediting a large, real, measured improvement that a scene change
//          fully explains. The plan's own sentence: "A flight into a quieter
//          area must not be credited to the adjustment."
// ---------------------------------------------------------------------------
test('PL-11 a confounded window is inconclusive however large the improvement', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const id = await armed(L, clock);

  const before = windowOf({ startMs: 0, interval: steady(B * 2), conditions: { biome: 'forest' } });
  // Same duration, same rung, enormously better — and the bird left the valley.
  const after = windowOf({
    startMs: WINDOW_MS, interval: steady(B * 0.5),
    conditions: { biome: 'mountain', sceneChanged: true },
  });
  const delta = percentile(validDts(before), 0.95) - percentile(validDts(after), 0.95);
  assert.ok(delta > noiseBand(before, after) * 4, 'the fixture must present a genuinely large improvement, or this row proves nothing');

  const r = L.evaluate({ id, before, after, verification: APPLIED });
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.reason, 'scene-change');
  assert.equal(r.creditable, false,
    'the improvement is real and it is not evidence about the adjustment');
});

// ---------------------------------------------------------------------------
// PL-12 — paused frames are excluded, and their absence can make a window
//         insufficient rather than clean.
// REJECTS: scoring a window that contains 900 ms hidden-tab frames. CONTRACT
//          §2.2: paused samples are "excluded from adaptive decisions" and
//          RETAINED in evidence — both properties, not one.
// ---------------------------------------------------------------------------
test('PL-12 paused frames are excluded from the comparison, and a mostly-paused window is inconclusive', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();

  // (a) A minority of invalid frames — enough to dominate a p95 that counts
  //     them, not enough to starve the window of valid evidence. Excluding
  //     them, the two windows are identical. INCLUDING them, the "before" is a
  //     catastrophe and the adjustment looks like a triumph.
  const La = createPerfLearning({ now: clock.now, constants: K });
  const idA = await armed(La, clock);
  const before = windowOf({ startMs: 0, interval: steady(B), invalidEvery: 5, invalidMs: 100, conditions: { } });
  const after = windowOf({ startMs: WINDOW_MS, interval: steady(B) });
  assert.ok(validDts(before).length >= K.acceptanceMinSamples,
    'the fixture must clear the sufficiency floor on VALID frames alone, or the row passes for the wrong reason');
  const p95Counting = percentile(before.samples.map((s) => s.dtMs), 0.95);
  const p95Excluding = percentile(validDts(before), 0.95);
  assert.ok(p95Counting > p95Excluding * 2,
    'the fixture must be one where counting the invalid frames changes the answer');

  const a = La.evaluate({ id: idA, before, after, verification: APPLIED });
  assert.equal(a.verdict, 'inconclusive');
  assert.equal(a.reason, 'within-noise',
    'excluding the invalid frames the two windows are the same window; there is nothing here to credit');
  assert.equal(a.creditable, false);
  assert.ok(Math.abs(a.deltaMs) < 1e-6,
    `deltaMs is the p95 difference over VALID samples, which for these two windows is exactly 0. ` +
    `A scorer that counts the invalid frames reports about ${(p95Counting - p95Excluding).toFixed(1)} ms instead — ` +
    `got ${a.deltaMs}. CONTRACT §2.2: "Percentiles reported to the controller are computed over valid === true only."`);

  // (b) A window whose evidence is mostly 900 ms hidden-tab frames has nothing
  //     left to compare once they are excluded.
  const Lb = createPerfLearning({ now: clock.now, constants: K });
  const idB = await armed(Lb, clock);
  const starved = windowOf({ startMs: 0, interval: steady(B), invalidEvery: 2 });
  const b = Lb.evaluate({ id: idB, before: starved, after, verification: APPLIED });
  assert.equal(b.verdict, 'inconclusive');
  assert.equal(b.creditable, false);
  assert.ok(['paused', 'insufficient-samples'].includes(b.reason),
    `expected a paused/insufficient reason, got ${JSON.stringify(b.reason)}`);
});

// ---------------------------------------------------------------------------
// PL-13 — input-heavy windows are inconclusive.
// REJECTS: crediting a reduction measured while the player was hauling the
//          stick around, which changes camera, culling and drone AI load.
// ---------------------------------------------------------------------------
test('PL-13 an input-heavy window is inconclusive', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const id = await armed(L, clock);

  const before = windowOf({ startMs: 0, interval: steady(B * 1.4), conditions: { inputActivity01: 0.05 } });
  const after = windowOf({ startMs: WINDOW_MS, interval: steady(B), conditions: { inputActivity01: 0.9 } });
  const r = L.evaluate({ id, before, after, verification: APPLIED });

  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.reason, 'input-heavy');
  assert.equal(r.creditable, false);
});

// ---------------------------------------------------------------------------
// PL-14 — a difference inside the measured noise is not a difference.
// REJECTS: comparing two means and calling the smaller one a win, which is how
//          a controller learns to keep a reduction that bought nothing.
// ---------------------------------------------------------------------------
test('PL-14 a delta inside the noise band is inconclusive', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const id = await armed(L, clock);

  // A wide, ragged distribution that improves by far less than its own spread.
  const ragged = (base) => (i) => base + (i % 7) * 1.1;
  const before = windowOf({ startMs: 0, interval: ragged(B) });
  const after = windowOf({ startMs: WINDOW_MS, interval: ragged(B - 0.3) });
  const band = noiseBand(before, after);
  const delta = percentile(validDts(before), 0.95) - percentile(validDts(after), 0.95);
  assert.ok(Math.abs(delta) < band, 'the fixture must sit inside its own noise, or this row proves nothing');

  const r = L.evaluate({ id, before, after, verification: APPLIED });
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.reason, 'within-noise');
  assert.equal(r.creditable, false);
});

// ---------------------------------------------------------------------------
// PL-15 — an adjustment whose rendering work never changed cannot be credited,
//         whatever the frames did. Step 2 feeding step 3.
// REJECTS: crediting a no-op apply with an improvement that something else
//          caused. "A slider value changing is not evidence that rendering
//          work changed."
// ---------------------------------------------------------------------------
test('PL-15 a non-creditable verification forces inconclusive', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const id = await armed(L, clock);

  const before = windowOf({ startMs: 0, interval: steady(B * 2) });
  const after = windowOf({ startMs: WINDOW_MS, interval: steady(B) });
  const r = L.evaluate({ id, before, after, verification: { creditable: false, verdict: 'no-op', state: 'resolved' } });

  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.reason, 'not-applied');
  assert.equal(r.creditable, false);
});

// ---------------------------------------------------------------------------
// PL-16 — the positive control, and the prediction error.
// REJECTS: satisfying PL-10..PL-15 by returning 'inconclusive' unconditionally.
//          A loop that can never conclude anything learns nothing and rolls
//          back every reduction it ever makes.
// ---------------------------------------------------------------------------
test('PL-16 a clean, comparable, decisive comparison IS credited, with prediction error', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  const p = L.predict(candidate({ tMs: clock.t, expectedBenefitMs: 2.0 }));

  const before = windowOf({ startMs: 0, interval: steady(B * 1.4) });
  const after = windowOf({ startMs: WINDOW_MS, interval: steady(B) });
  const observed = percentile(validDts(before), 0.95) - percentile(validDts(after), 0.95);
  const r = L.evaluate({ id: p.id, before, after, verification: APPLIED });

  assert.equal(r.verdict, 'benefit');
  assert.equal(r.reason, 'ok');
  assert.equal(r.creditable, true);
  assert.ok(Math.abs(r.deltaMs - observed) < 1e-6,
    `deltaMs must be the p95 difference over VALID samples computed with the shared nearest-rank helper (expected ${observed}, got ${r.deltaMs})`);
  assert.ok(Math.abs(r.predictionErrorMs - Math.abs(2.0 - observed)) < 1e-6,
    'predictionErrorMs is |predicted - observed|, which is what RL-6 aggregates');
});

// ---------------------------------------------------------------------------
// PL-17 — a clean comparison that got WORSE is a regression, not an
//         inconclusive.
// REJECTS: an evaluator with only two outcomes, which cannot tell "this did
//          nothing" from "this made it worse" and so never lengthens a
//          cooldown.
// ---------------------------------------------------------------------------
test('PL-17 a clean comparison that regressed is reported as a regression', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  const id = await armed(L, clock);

  const before = windowOf({ startMs: 0, interval: steady(B) });
  const after = windowOf({ startMs: WINDOW_MS, interval: steady(B * 1.5) });
  const r = L.evaluate({ id, before, after, verification: APPLIED });

  assert.equal(r.verdict, 'regression');
  assert.equal(r.reason, 'ok');
  assert.ok(r.deltaMs < 0, 'a regression carries a negative delta, so the sign is not lost');
});

// ===========================================================================
// STEP 4 — KEEP OR ROLL BACK
// ===========================================================================

// ---------------------------------------------------------------------------
// PL-18 — keep only for a measurable benefit; inconclusive returns to the
//         prior stable state; a regression rolls back AND lengthens the retry.
// REJECTS: keeping whatever is currently applied because nothing said
//          otherwise, which is how permanent degradation accumulates one
//          unscored reduction at a time.
// ---------------------------------------------------------------------------
test('PL-18 keep on benefit, roll back on inconclusive, roll back and lengthen on regression', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });

  L.observe(baseContext(clock.t));
  const a = L.predict(candidate({ tMs: clock.t }));
  const kept = L.resolve({ id: a.id, verdict: 'benefit' });
  assert.equal(kept.decision, 'keep');

  clock.t += K.probeIntervalMs;
  L.observe(baseContext(clock.t));
  const b = L.predict(candidate({ tMs: clock.t }));
  const rolled = L.resolve({ id: b.id, verdict: 'inconclusive' });
  assert.equal(rolled.decision, 'rollback');
  const inconclusiveCooldownMs = rolled.nextEligibleMs - clock.t;
  assert.ok(inconclusiveCooldownMs > 0, 'a rollback names the time the same action may be retried');

  clock.t += K.probeIntervalMs;
  L.observe(baseContext(clock.t));
  const c = L.predict(candidate({ tMs: clock.t }));
  const regressed = L.resolve({ id: c.id, verdict: 'regression' });
  assert.equal(regressed.decision, 'rollback');
  const regressionCooldownMs = regressed.nextEligibleMs - clock.t;
  assert.ok(regressionCooldownMs > inconclusiveCooldownMs,
    `a failed upgrade LENGTHENS its retry cooldown ("If an upgrade regresses, roll back and lengthen its retry cooldown") — ` +
    `inconclusive gave ${inconclusiveCooldownMs} ms, the regression gave ${regressionCooldownMs} ms`);
});

// ---------------------------------------------------------------------------
// PL-19 — emergency recovery takes priority over the outstanding probe.
// REJECTS: enforcing "one outstanding probe" so literally that a severe
//          overload has to wait for a probe to finish before anything is shed.
// ---------------------------------------------------------------------------
test('PL-19 an emergency abandons the outstanding probe rather than queueing behind it', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  const probe = L.predict(candidate({ tMs: clock.t }));
  assert.equal(probe.accepted, true);

  clock.t += K.settleHoldMs;
  const emergency = L.resolve({ id: null, verdict: 'regression', emergency: true });
  assert.equal(emergency.decision, 'emergency-downshift');
  assert.equal(emergency.abandonedProbeId, probe.id,
    'the outstanding probe is abandoned and recorded as failed, not silently left in flight');

  const entry = L.history().find((h) => h.id === probe.id);
  assert.ok(entry && entry.failed === true, 'the abandoned probe is a failed probe in the action history');
});

// ===========================================================================
// STEP 5 — LEARN.  In-session only (DEF-1).
// ===========================================================================

// ---------------------------------------------------------------------------
// PL-20 — the history is bounded, and its default bound is finite.
// REJECTS: an array that grows for the length of a session on a phone, which
//          is a leak in the module whose job is to protect the frame budget.
// ---------------------------------------------------------------------------
test('PL-20 the action history is bounded and drops the oldest entries', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const cap = 8;
  const L = createPerfLearning({ now: clock.now, constants: K, maxEntries: cap });

  const ids = [];
  for (let i = 0; i < cap * 3; i += 1) {
    L.observe(baseContext(clock.t));
    const p = L.predict(candidate({ kind: 'downshift', tMs: clock.t, fromRung: 0, toRung: 1 }));
    ids.push(p.id);
    L.resolve({ id: p.id, verdict: 'benefit' });
    clock.t += K.probeIntervalMs;
  }
  const h = L.history();
  assert.ok(h.length <= cap, `history must be bounded by maxEntries (${cap}), got ${h.length}`);
  assert.equal(h[h.length - 1].id, ids[ids.length - 1], 'the newest entry is retained');
  assert.ok(!h.some((e) => e.id === ids[0]), 'the oldest entry is dropped');

  const dflt = createPerfLearning({ now: clock.now, constants: K }).snapshot();
  assert.ok(Number.isInteger(dflt.maxEntries) && dflt.maxEntries > 0 && dflt.maxEntries <= 1024,
    `the DEFAULT bound must be a finite, phone-sized integer, got ${dflt.maxEntries}`);
});

// ---------------------------------------------------------------------------
// PL-21 — what a history entry has to carry.
// REJECTS: a decision log. RL-5 names predicted-versus-observed, confidence,
//          failed probes and cooldowns, and RL-6 aggregates exactly those.
// ---------------------------------------------------------------------------
test('PL-21 every history entry carries predicted vs observed, confidence, failure and cooldown', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  const p = L.predict(candidate({ tMs: clock.t, expectedBenefitMs: 1.5, confidence: 0.4 }));
  const before = windowOf({ startMs: 0, interval: steady(B * 1.4) });
  const after = windowOf({ startMs: WINDOW_MS, interval: steady(B) });
  const ev = L.evaluate({ id: p.id, before, after, verification: APPLIED });
  L.resolve({ id: p.id, verdict: ev.verdict });

  const entry = L.history().find((e) => e.id === p.id);
  assert.ok(entry, 'the resolved action is in the history');
  for (const field of ['kind', 'tMs', 'predictedBenefitMs', 'observedBenefitMs', 'confidence', 'verdict', 'decision', 'failed', 'cooldownMs']) {
    assert.ok(field in entry, `a history entry must carry ${field}`);
  }
  assert.equal(entry.predictedBenefitMs, 1.5);
  assert.ok(Math.abs(entry.observedBenefitMs - ev.deltaMs) < 1e-6);
});

// ---------------------------------------------------------------------------
// PL-22 — DEF-1: no persistence, at all, this wave.
// REJECTS: the deferred cross-session store arriving anyway. CONTRACT §9
//          DEF-1 names what reopens it: a Wave 4 device session AND an
//          authored suite covering deny-list, entry cap and age-out.
// ---------------------------------------------------------------------------
test('PL-22 nothing is persisted — no storage global is touched (DEF-1)', { skip: IMPL }, async () => {
  const hits = [];
  const saved = [];
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'document', 'window']) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, name);
    if (desc && desc.configurable === false) continue;
    saved.push([name, desc]);
    Object.defineProperty(globalThis, name, { configurable: true, get() { hits.push(name); return undefined; } });
  }
  try {
    const { createPerfLearning } = await load();
    const clock = clockFrom();
    const L = createPerfLearning({ now: clock.now, constants: K });
    L.observe(baseContext(clock.t));
    const p = L.predict(candidate({ tMs: clock.t }));
    L.evaluate({
      id: p.id,
      before: windowOf({ startMs: 0, interval: steady(B * 1.4) }),
      after: windowOf({ startMs: WINDOW_MS, interval: steady(B) }),
      verification: APPLIED,
    });
    L.resolve({ id: p.id, verdict: 'benefit' });
    L.snapshot();
    L.history();
    L.capabilityBucket();
    L.onBoundary('resume', clock.t);
    L.reset();
    assert.deepEqual(hits, [], `perf-learning touched storage/DOM globals: ${hits.join(', ')}`);
  } finally {
    for (const [name, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, name, desc);
      else delete globalThis[name];
    }
  }
});

// ---------------------------------------------------------------------------
// PL-23 — the coarse capability bucket is MEASURED, never guessed.
// REJECTS: this repository's most expensive documented mistake, repeated. On
//          iOS Safari `navigator.hardwareConcurrency` is undefined, `undefined
//          || 4` is 4, and the bloom pass written for this game never once ran
//          on the device the game is built for. The plan: "Learn a small
//          amount from local measurements rather than guessing device quality
//          from a user-agent or CPU-core count."
// ---------------------------------------------------------------------------
test('PL-23 the capability bucket reads no navigator field and is a sentinel until measured', { skip: IMPL }, async () => {
  const touched = [];
  const fakeNavigator = {};
  for (const prop of ['hardwareConcurrency', 'deviceMemory', 'userAgent', 'platform', 'gpu', 'connection']) {
    Object.defineProperty(fakeNavigator, prop, {
      configurable: true,
      get() { touched.push(prop); return prop === 'hardwareConcurrency' ? 4 : 'trap'; },
    });
  }
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const canTrap = !desc || desc.configurable !== false;
  if (canTrap) Object.defineProperty(globalThis, 'navigator', { configurable: true, get() { return fakeNavigator; } });
  try {
    const { createPerfLearning } = await load();
    const clock = clockFrom();
    const L = createPerfLearning({ now: clock.now, constants: K });

    // With nothing measured, the bucket is the sentinel — not "mid", not 4.
    assertSentinel(L.capabilityBucket(), 'capabilityBucket() before any measurement');

    const slow = createPerfLearning({ now: clock.now, constants: K });
    const fast = createPerfLearning({ now: clock.now, constants: K });
    for (let i = 0; i < K.acceptanceMinSamples; i += 1) {
      slow.observe(baseContext(clock.t + i, { distribution: { p95Ms: B * 2, medianMs: B * 2, missedTargetPct: 100 }, timings: { cpuMs: B * 1.5, updateMs: B, submitMs: B * 0.5, gpu: { value: null, state: 'unavailable', reason: 'no-extension' } } }));
      fast.observe(baseContext(clock.t + i, { distribution: { p95Ms: B * 0.5, medianMs: B * 0.4, missedTargetPct: 0 }, timings: { cpuMs: B * 0.2, updateMs: B * 0.1, submitMs: B * 0.1, gpu: { value: null, state: 'unavailable', reason: 'no-extension' } } }));
    }
    const slowBucket = slow.capabilityBucket();
    const fastBucket = fast.capabilityBucket();
    assert.notDeepEqual(slowBucket, fastBucket,
      'two materially different measured devices must land in different buckets, or the bucket is not derived from measurement');
    assert.ok(slowBucket.basis && slowBucket.basis !== 'navigator',
      'the bucket must name the MEASUREMENT it was derived from');

    assert.deepEqual(touched, [],
      `perf-learning read navigator.${touched.join(', navigator.')} — device quality is measured here, never guessed`);
  } finally {
    if (canTrap) {
      if (desc) Object.defineProperty(globalThis, 'navigator', desc);
      else delete globalThis.navigator;
    }
  }
});

// ---------------------------------------------------------------------------
// PL-24 — a boundary clears the decision windows and NOT the action history.
// REJECTS: wiring the reset tags straight through to the learned history, so
//          every resize, orientation change and biome switch throws away
//          everything the session learned. CONTRACT §2.1 rule 1: "A reset
//          clears the adaptive decision windows ... It does NOT clear the
//          action history, the evidence record, or the recurrent-hitch log."
// ---------------------------------------------------------------------------
test('PL-24 onBoundary() clears the pending decision but keeps the action history; reset() clears the history', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.observe(baseContext(clock.t));
  const done = L.predict(candidate({ kind: 'downshift', tMs: clock.t, fromRung: 0, toRung: 1 }));
  L.resolve({ id: done.id, verdict: 'benefit' });
  clock.t += K.probeIntervalMs;
  L.observe(baseContext(clock.t));
  const outstanding = L.predict(candidate({ tMs: clock.t }));
  assert.equal(outstanding.accepted, true);

  clock.t += K.settleHoldMs;
  L.onBoundary('environment', clock.t);

  assert.equal(L.snapshot().pendingId, null,
    'the in-flight probe cannot be scored across a boundary — the world it was measured against is gone');
  assert.ok(L.history().some((e) => e.id === done.id),
    'the action history survives a boundary: "Do not erase recurrent gameplay hitches" and do not erase what the session learned');

  assert.throws(() => L.onBoundary('vibes', clock.t), RangeError,
    'the tag must come from frame-metrics RESET_TAGS — an untagged or invented reset is a contract violation');
  assert.ok(RESET_TAGS.includes('environment'));

  L.reset();
  assert.deepEqual(L.history(), [], 'the explicit PNL-5 reset is the ONE thing that clears the learned history');
});

// ---------------------------------------------------------------------------
// PL-25 — learning off (PNL-5; Manual and Benchmark suspend learning-driven
//         changes) stops exploration and stops recording, and does NOT stop
//         protection.
// REJECTS: a learning switch that also disables the emergency path — a device
//          in overload with the panel open would then have nothing shedding
//          work for it.
// ---------------------------------------------------------------------------
test('PL-25 with learning disabled, probes stop and emergencies do not', { skip: IMPL }, async () => {
  const { createPerfLearning } = await load();
  const clock = clockFrom();
  const L = createPerfLearning({ now: clock.now, constants: K });
  L.setEnabled(false);
  assert.equal(L.enabled, false);
  L.observe(baseContext(clock.t));

  const probe = L.predict(candidate({ tMs: clock.t }));
  assert.equal(probe.accepted, false);
  assert.equal(probe.reason, 'learning-disabled');
  assert.deepEqual(L.history(), [], 'nothing is learned while learning is off');

  const emergency = L.resolve({ id: null, verdict: 'regression', emergency: true });
  assert.equal(emergency.decision, 'emergency-downshift',
    'protection is not a learning-driven change and is never suspended by PNL-5');
});
