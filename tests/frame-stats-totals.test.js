/**
 * tests/frame-stats-totals.test.js — RED-FIRST spec for `src/game/frame-stats.js`.
 *
 * Wave 1 / task P1.1b of docs/ULTRACODE_PERFORMANCE_PLAN.md §4. The module under
 * test DOES NOT EXIST YET; Wave 2 (P2.1) builds it. This file is the oracle.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BEING BOUGHT HERE
 * ---------------------------------------------------------------------------
 * The four acceptance gates, verbatim from docs/PERFORMANCE_REALISM_PLAN.md:
 *
 *   ACC-1  p95 frame interval <= 18.5 ms
 *   ACC-2  < 1% of intervals > 25 ms on the repeatable route
 *   ACC-3  no recurring unexplained > 50 ms spikes
 *   ACC-4  no persistent quality oscillation after settling
 *
 * followed immediately by: "These are proposed gates, not current measured
 * results." Every number in them is `provisional`/`unmeasured` (PRO-10…PRO-13)
 * and Wave 4 unlocks them. CONTRACT §10 rule 1 therefore binds this suite:
 * **no test below may treat 18.5, 25, 50 or 1% as fixed.** Thresholds are
 * injected; what is asserted is the SHAPE of the judgement, not where the line
 * sits. What IS asserted about the defaults is their provenance — a cheap agent
 * quietly promoting `unmeasured` to `measured` is the failure this programme was
 * written to prevent, and it is invisible in a diff of numbers.
 *
 * TWO STRUCTURAL RULINGS THIS SUITE PINS
 *
 * 1. **ACC-4 is not computable from an interval array.** It is a property of the
 *    tier CHANGE LOG. ULTRACODE §4 Wave 2 P2.1, verbatim: "with
 *    evaluateOscillation(tierChangeLog) SEPARATE from the interval maths — the
 *    fourth acceptance gate is a property of the change log, and a
 *    single-signature contract ships it as a hardcoded `true`." So
 *    `evaluateAcceptanceGates` must report ACC-4 as the §3.1 sentinel, ALWAYS,
 *    and never as a boolean. FS-A6 is that assertion, and it is the single most
 *    likely thing in this file to be "fixed" by someone who thinks a green gate
 *    is the goal.
 *
 * 2. **Tags explain spikes; validity excludes samples. They are different axes
 *    and must not be conflated.** A spike tagged `load` or `environment` is an
 *    explained boundary and does not count toward ACC-3. It is still a real
 *    interval, so it still counts toward p95 — otherwise ACC-1 can be made green
 *    by tagging. FS-A4b exists solely to close that laundering route.
 *
 * ---------------------------------------------------------------------------
 * THE API THIS SUITE PINS  (Wave 2 transcribes; it does not redesign)
 * ---------------------------------------------------------------------------
 *   Sample:  { dtMs:number, tMs:number, valid?:boolean=true,
 *              invalidReason?:string|null, tag?:string|null }
 *            `tag` ∈ the reset-tag enum of CONTRACT §2.1, or null.
 *            `invalidReason` ∈ { hidden, flightPaused, systemPaused, contextLost,
 *                                frozen, benchmarkHold, panelHold } or null.
 *
 *   export const ACCEPTANCE_THRESHOLDS  // ONE named constants object (CONTRACT §10 rule 2)
 *     { p95MaxMs, longIntervalMs, longIntervalMaxFraction, spikeMs,
 *       spikeRecurrenceCount, minSamples }
 *   export const ACCEPTANCE_PROVENANCE  // same keys; { provenance, provisional? }
 *   export const OSCILLATION_DEFAULTS   // { settleMs, windowMs, maxReversals }
 *   export const OSCILLATION_PROVENANCE
 *
 *   export function evaluateAcceptanceGates(samples, { targetFPS, thresholds })
 *     -> { targetBudgetMs, counts:{ total, valid, invalid },
 *          p50, p95, p99,            // number | sentinel
 *          missedTargetPct,          // number | sentinel
 *          unexplainedSpikes,        // number | sentinel
 *          gates: { 'ACC-1':gate, 'ACC-2':gate, 'ACC-3':gate, 'ACC-4':sentinel } }
 *     gate     = { pass:boolean, value:number, threshold:number }
 *     sentinel = { value:null, state:'unavailable', reason:<closed enum> }  (CONTRACT §3.1)
 *
 *   export function evaluateOscillation(tierChangeLog, { settleMs, windowMs,
 *                                                        observedMs, maxReversals })
 *     tierChangeLog entry: { tMs:number, from:number, to:number, reason?:string }
 *     -> { pass:boolean, reversals:number, window:{...} } | sentinel
 *
 * PERCENTILE CONVENTION, PINNED: **nearest-rank**. P_q is the smallest observed
 * value v such that at least q% of the (valid) samples are <= v. Pinned here and
 * pinned identically by P1.1a for src/game/frame-metrics.js — CONTRACT ACC-1
 * notes: "the value the controller fires on and the value the acceptance gate
 * scores must be computed by the same module, or the loop is closed against
 * itself." Wave 2 implements it ONCE and shares it; FS-A1b checks the two agree
 * whenever both exist.
 *
 * R4: dynamic import inside every test body, skipped unless BIRB_PERF_IMPL.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../src/game/frame-stats.js';
const METRICS_MODULE = '../src/game/frame-metrics.js';
const IMPL = process.env.BIRB_PERF_IMPL ? false
  : 'BIRB_PERF_IMPL unset — src/game/frame-stats.js is a Wave 2 deliverable (P2.1)';

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
// Independent references. These deliberately do NOT mirror a plausible
// implementation: the percentile is computed from its DEFINITION by counting,
// not by sorting and indexing, so an off-by-one in the implementation's rank
// arithmetic cannot be reproduced here by accident.
// ---------------------------------------------------------------------------

/** P_q by definition: the smallest observed value v with count(x <= v) >= q% of n. */
function refPercentile(values, q) {
  const n = values.length;
  if (n === 0) return null;
  const need = Math.ceil((q / 100) * n);
  const candidates = values.slice().sort((a, b) => a - b);
  for (const v of candidates) {
    let le = 0;
    for (const x of values) if (x <= v) le += 1;
    if (le >= need) return v;
  }
  return candidates[candidates.length - 1];
}

/** Missed-target percentage against B = 1000/targetFPS, by direct count. */
function refMissedPct(values, targetFPS) {
  const B = 1000 / targetFPS;
  let missed = 0;
  for (const v of values) if (v > B) missed += 1;
  return values.length === 0 ? null : (missed / values.length) * 100;
}

/** mulberry32 — deterministic, so a failure is reproducible from the seed alone. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build tagged samples from an interval array. Times accumulate from the deltas. */
function samplesOf(intervals, { tags = null, valid = null } = {}) {
  let t = 0;
  return intervals.map((dtMs, i) => {
    t += dtMs;
    return {
      dtMs,
      tMs: t,
      valid: valid ? valid[i] !== false : true,
      invalidReason: valid && valid[i] === false ? 'hidden' : null,
      tag: tags ? (tags[i] ?? null) : null,
    };
  });
}

const isSentinel = (x) =>
  !!x && typeof x === 'object' && x.value === null && x.state === 'unavailable' && typeof x.reason === 'string';

const SENTINEL_REASONS = new Set([
  'not-implemented', 'no-extension', 'no-context', 'disjoint',
  'insufficient-samples', 'paused', 'not-applicable', 'stale',
]);

/**
 * Thresholds INJECTED by the tests that need a numeric result out of a short
 * fixture. Injecting is the point: CONTRACT §10 rule 1 forbids a test from
 * treating a provisional value as fixed, so these are inputs, never expectations
 * — no test below asserts that the module's own defaults equal them. `minSamples`
 * is lowered so a ten-sample fixture yields numbers rather than the
 * insufficient-samples sentinel; FS-A7 exercises that sentinel with the real
 * defaults instead.
 */
const T = {
  p95MaxMs: 18.5,
  longIntervalMs: 25,
  longIntervalMaxFraction: 0.01,
  spikeMs: 50,
  spikeRecurrenceCount: 3,
  minSamples: 3,
};

// ===========================================================================
// evaluateAcceptanceGates
// ===========================================================================

// ---------------------------------------------------------------------------
// FS-A1 — percentiles match the definitional reference over seeded arrays, and
//         the convention is nearest-rank.
//
// Would catch: linear interpolation (numpy's default), which on a 200-sample
// heavy-tailed array differs from nearest-rank by a whole millisecond near p99 —
// enough to move a gate whose whole margin is 18.5 vs 16.7. And it would catch
// the classic `sorted[Math.floor(0.95*n)]` off-by-one, which reports p95 as the
// 96th-smallest on some lengths and the 95th on others.
//
// Oracle independence: refPercentile() counts, it does not index.
// ---------------------------------------------------------------------------
test('FS-A1 p50/p95/p99 are nearest-rank and match an independent definitional reference', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();

  for (let seed = 1; seed <= 40; seed += 1) {
    const rand = rng(seed);
    const n = 20 + Math.floor(rand() * 240);
    const intervals = [];
    for (let i = 0; i < n; i += 1) {
      // A heavy tail on purpose: a distribution whose mean is fine and whose
      // p95 is not is the exact case the controller has to see.
      intervals.push(rand() < 0.08 ? 20 + rand() * 90 : 12 + rand() * 6);
    }
    const out = evaluateAcceptanceGates(samplesOf(intervals), { targetFPS: 60, thresholds: T });

    assert.equal(out.p50, refPercentile(intervals, 50), `p50 mismatch at seed ${seed} (n=${n})`);
    assert.equal(out.p95, refPercentile(intervals, 95), `p95 mismatch at seed ${seed} (n=${n})`);
    assert.equal(out.p99, refPercentile(intervals, 99), `p99 mismatch at seed ${seed} (n=${n})`);
  }

  // Pin the convention with a hand-checkable case: 100 values 1..100.
  // Nearest-rank p95 is the 95th smallest = 95. Linear interpolation gives 95.05.
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  const out = evaluateAcceptanceGates(samplesOf(hundred), { targetFPS: 60, thresholds: T });
  assert.equal(out.p95, 95, 'nearest-rank, not interpolated — an interpolating implementation returns 95.05');
  assert.equal(out.p50, 50);
  assert.equal(out.p99, 99);
});

// ---------------------------------------------------------------------------
// FS-A1b — cross-module consistency. Skipped, never failed, while P1.1a's
// frame-metrics percentile helper does not exist: CONTRACT requires the two to
// be the SAME code, and this check goes live the moment it is.
// ---------------------------------------------------------------------------
test('FS-A1b the acceptance gate and the controller share one percentile implementation', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();
  let metrics = null;
  try { metrics = await import(METRICS_MODULE); } catch { metrics = null; }
  const helper = metrics && (metrics.percentile || metrics.intervalPercentile);
  if (typeof helper !== 'function') {
    // Not a pass and not a failure: P1.1a owns that helper. Recorded so the gap
    // is visible in the log rather than silently absent.
    console.error('FS-A1b: frame-metrics exports no percentile helper yet — cross-check deferred to P1.1a');
    return;
  }
  const intervals = Array.from({ length: 137 }, (_, i) => 10 + ((i * 7) % 43));
  const out = evaluateAcceptanceGates(samplesOf(intervals), { targetFPS: 60, thresholds: T });
  assert.equal(out.p95, helper(intervals, 95),
    'one convention, one implementation — otherwise the loop is closed against itself');
});

// ---------------------------------------------------------------------------
// FS-A2 — invalid samples are excluded from the statistics and PRESENT in the
//         counts.
//
// CONTRACT §2.2: "Percentiles reported to the controller are computed over
// valid === true only. Percentiles reported in the export state both counts."
// The plan: "Mark paused measurements invalid for adaptive decisions" — not
// discard them.
//
// Would catch BOTH failure directions, which is why the identical-tail
// construction is used: an implementation that averages the 900 ms hidden-tab
// frames in (p95 explodes, the controller downshifts a device that was fine),
// and one that deletes them (counts.total drops, and the resume spike can never
// be studied).
// ---------------------------------------------------------------------------
test('FS-A2 invalid samples are excluded from percentiles but retained in the counts', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();

  const good = Array.from({ length: 120 }, (_, i) => 14 + (i % 5));
  const clean = evaluateAcceptanceGates(samplesOf(good), { targetFPS: 60, thresholds: T });

  // The same run, plus eight backgrounded frames of 900 ms marked invalid.
  const withHidden = good.concat([900, 900, 900, 900, 900, 900, 900, 900]);
  const validFlags = good.map(() => true).concat([false, false, false, false, false, false, false, false]);
  const dirty = evaluateAcceptanceGates(samplesOf(withHidden, { valid: validFlags }), { targetFPS: 60, thresholds: T });

  assert.equal(dirty.p95, clean.p95, 'a hidden-tab stall must not move p95');
  assert.equal(dirty.p99, clean.p99);
  assert.equal(dirty.counts.total, 128, 'the invalid samples are still there…');
  assert.equal(dirty.counts.valid, 120);
  assert.equal(dirty.counts.invalid, 8, '…and are counted as invalid, not erased');
  assert.equal(dirty.gates['ACC-1'].pass, clean.gates['ACC-1'].pass);
});

// ---------------------------------------------------------------------------
// FS-A3 — missed-target percentage against B = 1000 / targetFPS.
//
// Would catch a budget hardcoded to 16.67: the plan's CTL-2 offers an explicit
// 30 FPS option, and a gate that scores a 30 FPS profile against a 60 FPS budget
// reports every single frame as missed. It would also catch `>=` for `>`, which
// on a vsynced 60 Hz panel marks a perfect 16.667 ms frame as a miss and makes
// a healthy device look like it is failing 100% of frames.
// ---------------------------------------------------------------------------
test('FS-A3 missed-target percentage uses B = 1000/targetFPS and a strict >', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();

  const intervals = [10, 16, 16.6, 16.7, 17, 20, 33, 34, 50, 12];

  const at60 = evaluateAcceptanceGates(samplesOf(intervals), { targetFPS: 60, thresholds: T });
  assert.equal(at60.targetBudgetMs, 1000 / 60);
  assert.equal(at60.missedTargetPct, refMissedPct(intervals, 60));

  const at30 = evaluateAcceptanceGates(samplesOf(intervals), { targetFPS: 30, thresholds: T });
  assert.equal(at30.targetBudgetMs, 1000 / 30);
  assert.equal(at30.missedTargetPct, refMissedPct(intervals, 30));
  assert.ok(at30.missedTargetPct < at60.missedTargetPct,
    'the same run misses fewer frames against a 30 FPS budget — the budget must come from targetFPS');

  // Exactly-at-budget is not a miss.
  const exact = evaluateAcceptanceGates(samplesOf([1000 / 60, 1000 / 60, 1000 / 60]), { targetFPS: 60, thresholds: T });
  assert.equal(exact.missedTargetPct, 0, 'a frame delivered exactly on budget is not a missed frame');
});

// ---------------------------------------------------------------------------
// FS-A4 — ACC-3: a spike carrying a boundary TAG is explained; an untagged one
//         is not; and "recurring" is a count, not a single occurrence.
//
// The two runs below have BYTE-IDENTICAL interval arrays. Only the tags differ.
// That is what makes this oracle independent of the implementation: nothing
// about the timings can be used to satisfy it.
//
// Would catch: (a) an implementation that ignores tags entirely, so every world
// rebuild and every Tap-to-Start fails ACC-3 forever and the gate is
// permanently red and therefore permanently ignored; (b) one that treats a
// single spike as "recurring", same outcome.
// ---------------------------------------------------------------------------
test('FS-A4 ACC-3 counts only UNTAGGED spikes, and only when they recur', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();
  const thresholds = T;

  const base = Array.from({ length: 200 }, () => 14);
  const intervals = base.slice();
  const spikeAt = [10, 50, 90, 130, 170];
  for (const i of spikeAt) intervals[i] = 900;

  // Explained: every spike sits on a tagged boundary.
  const tags = intervals.map((_, i) => (spikeAt.includes(i) ? 'environment' : null));
  const explained = evaluateAcceptanceGates(samplesOf(intervals, { tags }), { targetFPS: 60, thresholds });
  assert.equal(explained.unexplainedSpikes, 0);
  assert.equal(explained.gates['ACC-3'].pass, true,
    'five 900 ms world rebuilds are five explained boundaries, not a controller failure');

  // Identical timings, no tags.
  const unexplained = evaluateAcceptanceGates(samplesOf(intervals), { targetFPS: 60, thresholds });
  assert.equal(unexplained.unexplainedSpikes, 5);
  assert.equal(unexplained.gates['ACC-3'].pass, false,
    'the same five spikes with nothing to explain them are a recurring unexplained spike');

  // One unexplained spike is not "recurring".
  const once = base.slice();
  once[77] = 900;
  const single = evaluateAcceptanceGates(samplesOf(once), { targetFPS: 60, thresholds });
  assert.equal(single.unexplainedSpikes, 1);
  assert.equal(single.gates['ACC-3'].pass, true,
    'ACC-3 says "no RECURRING unexplained spikes" — one is not a recurrence');
});

// ---------------------------------------------------------------------------
// FS-A4b — a tag explains a spike; it does not delete the interval.
//
// This closes the laundering route opened by FS-A4. If tagging removed the
// sample from the statistics, ACC-1 and ACC-2 could be made green by tagging
// every bad frame — and a cheap agent reaching for a green gate will find that
// move immediately. The tagged and untagged runs must have IDENTICAL p95.
// ---------------------------------------------------------------------------
test('FS-A4b tagging a spike explains ACC-3 without changing p95 or the >25 ms fraction', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();

  const intervals = Array.from({ length: 200 }, (_, i) => (i % 20 === 0 ? 900 : 14));
  const tags = intervals.map((v) => (v === 900 ? 'load' : null));

  const tagged = evaluateAcceptanceGates(samplesOf(intervals, { tags }), { targetFPS: 60, thresholds: T });
  const untagged = evaluateAcceptanceGates(samplesOf(intervals), { targetFPS: 60, thresholds: T });

  assert.equal(tagged.p95, untagged.p95, 'a tag is an explanation, not an eraser');
  assert.equal(tagged.p99, untagged.p99);
  assert.equal(tagged.missedTargetPct, untagged.missedTargetPct);
  assert.equal(tagged.counts.valid, untagged.counts.valid);
  assert.notEqual(tagged.gates['ACC-3'].pass, untagged.gates['ACC-3'].pass,
    'the ONLY gate a tag may move is ACC-3');
});

// ---------------------------------------------------------------------------
// FS-A5 — the tag vocabulary is the closed reset-tag enum of CONTRACT §2.1.
//
// Would catch the obvious laundering: `tag: 'busy'`, `tag: 'gameplay'`,
// `tag: 'whatever'`. If any string explains a spike then ACC-3 is a formality.
// `paused` is explicitly NOT a tag (RUL-2) — it is a validity state, carried on
// `valid`/`invalidReason`, and accepting it as a tag would collapse the two axes
// FS-A2 and FS-A4 exist to keep apart.
// ---------------------------------------------------------------------------
test('FS-A5 an out-of-enum tag is rejected, and "paused" is not a tag', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();

  for (const tag of ['busy', 'gameplay', 'paused', 'Load', '', 42]) {
    assert.throws(
      () => evaluateAcceptanceGates(
        samplesOf([14, 900, 14], { tags: [null, tag, null] }),
        { targetFPS: 60, thresholds: T },
      ),
      RangeError,
      `tag ${JSON.stringify(tag)} must be rejected — an arbitrary string cannot explain a spike`,
    );
  }

  // Every legitimate tag is accepted.
  for (const tag of ['load', 'resume', 'resize', 'orientation', 'contextRestore', 'environment', 'manual']) {
    assert.doesNotThrow(() => evaluateAcceptanceGates(
      samplesOf([14, 900, 14], { tags: [null, tag, null] }),
      { targetFPS: 60, thresholds: T },
    ), `tag ${tag} is in the enum and must be accepted`);
  }
});

// ---------------------------------------------------------------------------
// FS-A6 — ACC-4 is NEVER a boolean here. THE assertion of this file.
//
// ULTRACODE §4 Wave 2 P2.1: "a single-signature contract ships it as a hardcoded
// true." An interval array contains no information about whether quality
// oscillated; a function handed only intervals that reports "no oscillation" is
// not measuring, it is asserting. And it is green, which is worse than red.
//
// Would catch: `gates['ACC-4'] = { pass: true }`, `= true`, and the subtler
// `= { pass: intervals.length > 0 }`.
// ---------------------------------------------------------------------------
test('FS-A6 evaluateAcceptanceGates reports ACC-4 as a sentinel, never a pass', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();

  const cases = [
    samplesOf(Array.from({ length: 400 }, () => 14)),          // a flawless run
    samplesOf(Array.from({ length: 400 }, () => 40)),          // a terrible one
    samplesOf([16, 16, 16]),                                    // too few
    samplesOf([]),                                              // none at all
  ];

  for (const samples of cases) {
    const out = evaluateAcceptanceGates(samples, { targetFPS: 60 });
    const acc4 = out.gates['ACC-4'];
    assert.ok(isSentinel(acc4),
      'ACC-4 must serialise as { value:null, state:"unavailable", reason } — it is a property of the tier CHANGE LOG');
    assert.equal(acc4.reason, 'not-applicable',
      'and the reason names WHY: these are intervals, and oscillation is not in them');
    assert.ok(SENTINEL_REASONS.has(acc4.reason), 'from the closed enum of CONTRACT §3.1');
    assert.ok(!('pass' in acc4), 'no pass field — a sentinel that also claims to pass is a hardcoded true');
  }
});

// ---------------------------------------------------------------------------
// FS-A7 — too few samples produce sentinels, never zeros, and never a pass.
//
// This is the failure mode this whole repo is built around: `p95 = 0` on an
// empty buffer reads as a magnificent frame time and passes every gate. The FPS
// sampler that could not run was green for months for exactly this reason. An
// absent measurement must be loud.
//
// Would catch: `p95 ?? 0`, `Math.max(...[])` → -Infinity, and a gate that
// defaults to pass when there is nothing to judge.
// ---------------------------------------------------------------------------
test('FS-A7 an empty or under-filled buffer reports sentinels, not zeros and not passes', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates, ACCEPTANCE_THRESHOLDS } = await load();

  for (const samples of [samplesOf([]), samplesOf([16, 16])]) {
    const out = evaluateAcceptanceGates(samples, { targetFPS: 60 });

    for (const key of ['p50', 'p95', 'p99', 'missedTargetPct']) {
      assert.ok(isSentinel(out[key]), `${key} must be a sentinel, not a number, with ${samples.length} samples`);
      assert.equal(out[key].reason, 'insufficient-samples');
      assert.notEqual(out[key].value, 0, 'never 0 — a zero p95 reads as a perfect frame');
    }
    for (const id of ['ACC-1', 'ACC-2', 'ACC-3']) {
      const gate = out.gates[id];
      assert.ok(isSentinel(gate), `${id} must be a sentinel when there is nothing to judge`);
      assert.notEqual(gate.pass, true, `${id} must never pass by vacuity`);
    }
    assert.equal(out.counts.total, samples.length, 'the counts are still honest');
  }

  assert.ok(Number.isFinite(ACCEPTANCE_THRESHOLDS.minSamples) && ACCEPTANCE_THRESHOLDS.minSamples > 2,
    'the sufficiency floor is a named constant, not a literal buried in a branch');
});

// ---------------------------------------------------------------------------
// FS-A8 — the input is TAGGED SAMPLES, not raw numbers.
//
// Would catch an implementation that quietly accepts `[16.6, 17.1, …]`. It would
// work, it would be convenient, and it would make FS-A2 (validity) and FS-A4
// (tags) structurally unreachable, because a number carries neither. The type
// error is what forces the caller to carry the two fields the gates depend on.
// ---------------------------------------------------------------------------
test('FS-A8 raw number arrays are rejected — the gates need validity and tags', { skip: IMPL }, async () => {
  const { evaluateAcceptanceGates } = await load();

  assert.throws(() => evaluateAcceptanceGates([16.6, 17.1, 18.0], { targetFPS: 60, thresholds: T }), TypeError);
  assert.throws(() => evaluateAcceptanceGates(null, { targetFPS: 60 }), TypeError);
  assert.throws(() => evaluateAcceptanceGates(samplesOf([16, 17]).concat([{ tMs: 5 }]), { targetFPS: 60 }), TypeError);
  assert.throws(() => evaluateAcceptanceGates(samplesOf([16, 17]), {}), TypeError,
    'targetFPS is required — a default budget is how a 30 FPS profile gets scored against 60');
});

// ---------------------------------------------------------------------------
// FS-A9 — every threshold is a named constant with declared provenance, and
//         none of the four gate thresholds claims to be `measured` yet.
//
// CONTRACT §10 rule 2: "Every provisional value is read from ONE named constant
// object … so a Wave 4 device pass changes numbers in one place and nothing else
// moves." Rule 4: "`shipped-unvalidated` ≠ `measured`."
//
// Deliberately NOT asserted: that p95MaxMs is 18.5. Rule 1 forbids a test from
// treating a provisional value as fixed, and a test that pins 18.5 is precisely
// the thing that makes a Wave 4 measurement expensive to act on.
//
// Would catch: a threshold inlined at its use site (invisible to Wave 4), and a
// number quietly relabelled `measured` before a phone ever ran the route.
// ---------------------------------------------------------------------------
test('FS-A9 thresholds are one named object with unmeasured provenance until Wave 4', { skip: IMPL }, async () => {
  const { ACCEPTANCE_THRESHOLDS, ACCEPTANCE_PROVENANCE } = await load();

  const keys = ['p95MaxMs', 'longIntervalMs', 'longIntervalMaxFraction', 'spikeMs', 'spikeRecurrenceCount', 'minSamples'];
  for (const key of keys) {
    assert.ok(Number.isFinite(ACCEPTANCE_THRESHOLDS[key]), `ACCEPTANCE_THRESHOLDS.${key} must exist and be finite`);
    const prov = ACCEPTANCE_PROVENANCE[key];
    assert.ok(prov, `every threshold declares its provenance; ${key} does not`);
    assert.ok(
      ['unmeasured', 'shipped-unvalidated', 'shipped-validated', 'measured'].includes(prov.provenance),
      `${key} provenance must come from the closed vocabulary of CONTRACT §0`,
    );
  }

  for (const key of ['p95MaxMs', 'longIntervalMs', 'longIntervalMaxFraction', 'spikeMs']) {
    assert.equal(ACCEPTANCE_PROVENANCE[key].provenance, 'unmeasured',
      `${key} is one of the plan's own "proposed gates, not current measured results" — Wave 4 unlocks it`);
  }
  assert.equal(ACCEPTANCE_PROVENANCE.p95MaxMs.provisional, 'PRO-10',
    'and it cites its row in the provisional register, so the device pass can find it');
});

// ===========================================================================
// evaluateOscillation — ACC-4, and a SEPARATE function by contract
// ===========================================================================

/** Build a tier change log: entries alternate or descend per `pattern`. */
function changeLog(pattern, { startMs = 0, stepMs = 1000 } = {}) {
  const log = [];
  let t = startMs;
  for (let i = 1; i < pattern.length; i += 1) {
    t += stepMs;
    log.push({ tMs: t, from: pattern[i - 1], to: pattern[i], reason: 'overload' });
  }
  return log;
}

// ---------------------------------------------------------------------------
// FS-OSC-1 — oscillation is REVERSALS, not the number of changes.
//
// The two logs below contain the SAME NUMBER OF CHANGES over the same duration.
// One walks down 0→1→2 and stays; the other flaps 0→1→0→1. Only the second is
// oscillation. If the same count produces the same verdict, the function is
// counting activity, and a controller that correctly walks a struggling phone
// down through its tiers gets reported as unstable.
// ---------------------------------------------------------------------------
test('FS-OSC-1 alternation is oscillation; the same number of monotone changes is not', { skip: IMPL }, async () => {
  const { evaluateOscillation } = await load();
  const opts = { settleMs: 5000, windowMs: 30000, observedMs: 60000, maxReversals: 3 };

  const monotone = changeLog([0, 1, 2, 3, 4, 5, 6, 7], { startMs: 6000 });
  const flapping = changeLog([0, 1, 0, 1, 0, 1, 0, 1], { startMs: 6000 });
  assert.equal(monotone.length, flapping.length, 'the construction is only fair if the counts match');

  const steady = evaluateOscillation(monotone, opts);
  assert.equal(steady.pass, true, 'walking down and staying down is the controller working');
  assert.equal(steady.reversals, 0);

  const unstable = evaluateOscillation(flapping, opts);
  assert.equal(unstable.pass, false, 'flapping between two tiers is what ACC-4 forbids');
  assert.ok(unstable.reversals >= opts.maxReversals);
});

// ---------------------------------------------------------------------------
// FS-OSC-2 — "after settling". Changes inside the settle window do not count.
//
// ACC-4 verbatim: "no persistent quality oscillation AFTER SETTLING." The first
// seconds of a session are warm-up: shader compilation, world build, the first
// bloom target allocation. A controller hunting during that is doing its job.
// ---------------------------------------------------------------------------
test('FS-OSC-2 reversals inside the settle window are excluded', { skip: IMPL }, async () => {
  const { evaluateOscillation } = await load();
  const opts = { settleMs: 5000, windowMs: 30000, observedMs: 60000, maxReversals: 3 };

  const early = changeLog([0, 1, 0, 1, 0, 1, 0, 1], { startMs: 0, stepMs: 400 }); // all < 5000 ms
  assert.ok(early.every((e) => e.tMs < opts.settleMs), 'construction check');
  assert.equal(evaluateOscillation(early, opts).pass, true, 'warm-up hunting is not persistent oscillation');

  const late = changeLog([0, 1, 0, 1, 0, 1, 0, 1], { startMs: 20000, stepMs: 400 });
  assert.equal(evaluateOscillation(late, opts).pass, false, 'the same pattern after settling is');
});

// ---------------------------------------------------------------------------
// FS-OSC-3 — an empty change log is not automatically a pass.
//
// A log with no entries has two completely different meanings: the controller
// was stable, or the controller never ran / the log was never wired. This repo
// has shipped the second one twice — the FPS sampler behind `if (!fpsMetric)
// return;`, and the bloom pass gated off on every iPhone. Both were green the
// whole time. So sufficiency must be established by an OBSERVED DURATION, not by
// the absence of evidence.
//
// Would catch: `return { pass: log.length === 0 || … }`.
// ---------------------------------------------------------------------------
test('FS-OSC-3 an empty log with no observed duration is insufficient-samples, not a pass', { skip: IMPL }, async () => {
  const { evaluateOscillation } = await load();
  const opts = { settleMs: 5000, windowMs: 30000, maxReversals: 3 };

  const noDuration = evaluateOscillation([], { ...opts });
  assert.ok(isSentinel(noDuration), 'no observed duration means nothing has been established');
  assert.equal(noDuration.reason, 'insufficient-samples');
  assert.notEqual(noDuration.pass, true);

  const tooShort = evaluateOscillation([], { ...opts, observedMs: 6000 });
  assert.ok(isSentinel(tooShort),
    'observing for less than settle + one window cannot show the absence of oscillation');
  assert.equal(tooShort.reason, 'insufficient-samples');

  const enough = evaluateOscillation([], { ...opts, observedMs: 5000 + 30000 });
  assert.equal(enough.pass, true, 'a genuinely quiet controller, watched long enough, passes');
  assert.equal(enough.reversals, 0);
});

// ---------------------------------------------------------------------------
// FS-OSC-4 — the signature is the CHANGE LOG, and it cannot be fed intervals.
//
// This is the structural half of FS-A6. If evaluateOscillation accepts an
// interval array, the "separate function" ruling has been satisfied in name
// only: a caller can hand it the same data the other gates use and get a green
// ACC-4 out of a source that does not contain the answer.
// ---------------------------------------------------------------------------
test('FS-OSC-4 evaluateOscillation rejects interval arrays and malformed entries', { skip: IMPL }, async () => {
  const { evaluateOscillation } = await load();
  const opts = { settleMs: 5000, windowMs: 30000, observedMs: 60000 };

  assert.throws(() => evaluateOscillation([16.6, 17.1, 18.0], opts), TypeError,
    'an interval array is not a tier change log');
  assert.throws(() => evaluateOscillation(samplesOf([16, 17, 18]), opts), TypeError,
    'nor is a frame-sample array — the shapes must not be interchangeable');
  assert.throws(() => evaluateOscillation([{ tMs: 1000, to: 1 }], opts), TypeError,
    'an entry without `from` cannot yield a direction');
  assert.throws(() => evaluateOscillation([{ from: 0, to: 1 }], opts), TypeError,
    'an entry without `tMs` cannot be placed relative to the settle window');
  assert.throws(() => evaluateOscillation(null, opts), TypeError);
});

// ---------------------------------------------------------------------------
// FS-OSC-5 — the oscillation thresholds are named constants with declared
//            provenance too, and PRO-13 records that even the DEFINITION of
//            "persistent" is unmeasured.
// ---------------------------------------------------------------------------
test('FS-OSC-5 oscillation defaults are named, injectable and marked unmeasured', { skip: IMPL }, async () => {
  const { evaluateOscillation, OSCILLATION_DEFAULTS, OSCILLATION_PROVENANCE } = await load();

  for (const key of ['settleMs', 'windowMs', 'maxReversals']) {
    assert.ok(Number.isFinite(OSCILLATION_DEFAULTS[key]), `OSCILLATION_DEFAULTS.${key} must exist`);
    assert.equal(OSCILLATION_PROVENANCE[key].provenance, 'unmeasured',
      'PRO-13: the definition of "persistent" is itself unmeasured until a device says otherwise');
  }
  assert.equal(OSCILLATION_PROVENANCE.maxReversals.provisional, 'PRO-13');

  // The defaults must actually be USED when the caller omits them — an exported
  // constant nothing reads is decoration.
  const flapping = changeLog(
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    { startMs: OSCILLATION_DEFAULTS.settleMs + 1000, stepMs: 500 },
  );
  const observedMs = OSCILLATION_DEFAULTS.settleMs + OSCILLATION_DEFAULTS.windowMs + 1000;
  assert.equal(evaluateOscillation(flapping, { observedMs }).pass, false,
    'omitting the options must fall back to OSCILLATION_DEFAULTS, not to permissive literals');
});
