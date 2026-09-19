/**
 * Red-first oracle for the interval statistics Wave 2 (P2.1) will add to
 * `src/game/frame-metrics.js`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS BEFORE THE CODE DOES
 * ---------------------------------------------------------------------------
 * `docs/ULTRACODE_PERFORMANCE_PLAN.md` §4, Wave 1: oracles are bought in Wave 1
 * and spent in Wave 2. The eleven cheap-tier tasks in Wave 2 have no protection
 * except what is written here, and a cheap agent cannot tell "my code is wrong"
 * from "my oracle is wrong". So every expected value below is computed a second
 * way, in this file, from first principles — never by calling the helper under
 * test. A percentile checked against the implementation's own percentile helper
 * is not a check.
 *
 * The whole repo has already paid for the opposite habit twice: the 55/58
 * adaptive thresholds were tuned against an FPS sampler that could not run, and
 * the bloom pass was gated off on every iPhone by a capability probe nobody read
 * the return value of. Both were green the entire time.
 *
 * ---------------------------------------------------------------------------
 * R4 — WHY THE IMPORT IS DYNAMIC AND THE TESTS ARE SKIP-GATED
 * ---------------------------------------------------------------------------
 * A top-level `import` of a not-yet-existing export resolves BEFORE any skip
 * option is evaluated. `npm test` is `node --test` over the whole repository, so
 * a red module graph here turns `tests.yml` red for `humanoid/`, `gauntlet/`,
 * `sculpture/` and `icon3d/` as well. Every test below therefore
 *   (a) is gated `{ skip: !process.env.BIRB_PERF_IMPL }`, and
 *   (b) does its `import()` INSIDE the test body.
 *
 *   npm test                  -> this suite skips; the repo stays green.
 *   BIRB_PERF_IMPL=1 npm test -> this suite is red, because the API is absent.
 *
 * Red is the correct state until P2.1 lands. Do not weaken an assertion to make
 * it pass, and do not delete the skip gate.
 *
 * ---------------------------------------------------------------------------
 * THE API THIS SUITE PINS  (Wave 2 P2.1 implements exactly this)
 * ---------------------------------------------------------------------------
 * Added to `src/game/frame-metrics.js`, alongside the existing
 * `createFrameSampler` (which is untouched: it stays the 250 ms averaged-rate
 * source for TEL-1 / the shipped tier manager).
 *
 *   export const PERCENTILE_CONVENTION = 'nearest-rank';
 *   export const RESET_TAGS      = ['load','resume','resize','orientation',
 *                                   'contextRestore','environment','manual'];
 *   export const INVALID_REASONS = ['hidden','flightPaused','systemPaused',
 *                                   'contextLost','frozen','benchmarkHold','panelHold'];
 *   export const INTERVAL_CAPACITY  : number   // ring capacity, fixed
 *   export const HITCH_CAPACITY     : number   // recurrent-hitch ring capacity, fixed
 *   export const BOUNDARY_CAPACITY  : number   // reset-boundary ring capacity, fixed
 *   export const HITCH_THRESHOLD_MS = 50;
 *
 *   export function percentile(values, p) -> number | null
 *
 *   export function createIntervalRecorder({ capacity, targetFPS } = {}) -> {
 *     capacity, targetFPS, budgetMs,
 *     sample(timeMs, valid = true, invalidReason = null) -> record | null,
 *     stats()            -> { targetFPS, budgetMs, samples:{total,valid,invalid},
 *                             p50, p95, p99, missedTargetPct }   // each a "reading"
 *     exportIntervals()  -> Array<{dtMs,tMs,valid,invalidReason}>  // a COPY, chronological
 *     hitches()          -> Array<{dtMs,tMs}>                      // a COPY
 *     boundaries()       -> Array<{tag,tMs}>                       // a COPY
 *     reset(tag, timeMs = null) -> void,
 *     __buffers()        -> object whose values are the LIVE internal buffers
 *   }
 *
 * A "reading" is the sentinel-capable shape from CONTRACT.md §3.1, used
 * uniformly so the panel can forward it without inventing a plausible zero:
 *     { value: number|null, state: 'ok'|'unavailable', reason: string|null }
 *
 * `sample()` takes positional arguments, not an options object, because it is
 * called once per frame and CLAUDE.md house rule 4 forbids allocating in the
 * game loop. `__buffers()` exists because a structural zero-allocation check
 * that cannot reach the buffers is a check that passes vacuously (rule R8: a
 * check is not trusted until it has been watched failing) — see FM-A20.
 *
 * ---------------------------------------------------------------------------
 * THE PERCENTILE CONVENTION, NAMED AND PINNED:  NEAREST-RANK
 * ---------------------------------------------------------------------------
 * For values sorted ascending, length n, and p in (0,1]:
 *
 *     index = clamp(ceil(p * n) - 1, 0, n - 1)
 *     P(p)  = sorted[index]
 *
 * This is the classical nearest-rank method (NIST/ISO order-statistic
 * definition), not linear interpolation between order statistics (R-7, the
 * convention Excel's PERCENTILE and numpy's default `percentile` use).
 *
 * Cited because the original designs proposed FOUR separate percentile modules
 * with THREE different conventions (ULTRACODE §4 note; CONTRACT.md §1.3), which
 * means the number the controller fires on (PRO-1: "p95 interval > 1.2 x B")
 * and the number the acceptance gate scores (PRO-10: "p95 <= 18.5 ms") would
 * have been different numbers wearing the same name.
 *
 * Nearest-rank is the one chosen, for three reasons that are properties of THIS
 * programme and not of statistics in general:
 *
 *  1. It always returns a frame interval that actually occurred. The plan
 *     requires exporting raw intervals "so percentiles and misses can be
 *     checked" — an engineer holding an export must be able to FIND the p95
 *     frame in it. An interpolated p95 is a number no frame ever took.
 *  2. It is exactly reproducible in integer index arithmetic, so the panel
 *     (Wave 2), the controller (Wave 3) and the acceptance gate (Wave 4/5)
 *     cannot drift apart by a float ulp on different code paths.
 *  3. It is monotone under the ring buffer's own truncation, which an
 *     interpolating estimator is not at small n — and the controller evaluates
 *     one-second windows (~60 samples), which is small n.
 *
 * Wave 2 must not "improve" this to interpolation. FM-A3 pins the exact case
 * that separates the two conventions.
 *
 * ---------------------------------------------------------------------------
 * R8 — THESE ASSERTIONS HAVE BEEN WATCHED FAILING
 * ---------------------------------------------------------------------------
 * "An assertion nobody has watched fail is not an oracle, it is a hope."
 * Authoring this suite included building a throwaway reference implementation
 * of the API above OUTSIDE the repository (never committed), confirming all 19
 * assertions pass against it, and then mutating that implementation one defect
 * at a time. Every mutant exited 1 and turned exactly the listed assertions red:
 *
 *   mutant           defect introduced                                 flipped
 *   wrongconvention  PERCENTILE_CONVENTION reports 'linear'            FM-A2
 *   interp           linear interpolation instead of nearest-rank      FM-A3 A4 A7
 *   inplace          percentile() sorts the caller's array             FM-A5
 *   zeroempty        empty stats() reports 0 instead of the sentinel   FM-A6
 *   hardbudget       B hardcoded to 16.67 instead of 1000/targetFPS    FM-A7 A8 A9
 *   gte              a frame exactly on budget counts as missed        FM-A9
 *   allsamples       percentiles computed over paused samples too      FM-A10
 *   anyreason        invalid samples accept any reason string          FM-A11
 *   anytag           reset() accepts any tag, 'paused' included        FM-A12
 *   keepclock        reset() keeps the clock, so the gap is an interval FM-A13 A14
 *   wipehitches      reset() clears the recurrent-hitch log            FM-A15
 *   pausedhitch      a paused stall is logged as a gameplay hitch      FM-A15
 *   rearm            every event in a resize storm is a new boundary   FM-A16
 *   liveexport       exportIntervals() hands back the live array       FM-A17
 *   rawring          the export is in raw ring order, not chronological FM-A18
 *   unbounded        INTERVAL_CAPACITY raised to 65,536                FM-A19 A20
 *   growring         the export comes off an unbounded parallel Array  FM-A10 A13 A14 A18 A19
 *   parallel         a hidden unbounded Array of every sample ever     FM-A20
 *   nobuffers        __buffers() returns {} (the vacuity case)         FM-A20
 *
 * Two defects in THIS FILE were found by that exercise and fixed, which is the
 * argument for doing it: FM-A7 originally demanded that a delta recovered from
 * an accumulating float clock equal the fed value BIT for bit — an assertion no
 * real implementation can satisfy — and FM-A20's closing sanity check read the
 * decision window immediately after the soak's own final tagged reset had
 * emptied it, so it failed against a correct implementation.
 *
 * ---------------------------------------------------------------------------
 * ASSERTION IDS
 * ---------------------------------------------------------------------------
 * Ids are `FM-A<n>`, NOT bare `A<n>`. CONTRACT.md §12 keys the `A-n` namespace
 * to that document's §4 harness table (A1-A12, of which A2/A6/A7 are pinned by
 * the wave workflow), so reusing `A6` here would collide with "buffer coherence
 * across a resize while degraded" inside a binding namespace. Each FM id below
 * cites the CONTRACT.md row it derives from.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const IMPL = !!process.env.BIRB_PERF_IMPL;
const gate = { skip: !IMPL ? 'set BIRB_PERF_IMPL=1 to run the Wave 2 interval-statistics oracle' : false };

const MODULE_PATH = '../src/game/frame-metrics.js';

const REQUIRED_EXPORTS = [
  'percentile',
  'PERCENTILE_CONVENTION',
  'createIntervalRecorder',
  'RESET_TAGS',
  'INVALID_REASONS',
  'INTERVAL_CAPACITY',
  'HITCH_CAPACITY',
  'BOUNDARY_CAPACITY',
  'HITCH_THRESHOLD_MS',
];

/**
 * FM-A1. Load the module and fail with the ONE message that distinguishes
 * "the API is not written yet" (the expected red) from "the file blew up"
 * (a real regression in the shipped sampler). The distinction matters: this
 * suite must be red for the right reason, and `src/game/frame-metrics.js`
 * already exists and already ships `createFrameSampler`, so a bare import
 * error here would mean something else entirely.
 */
async function loadIntervalStats() {
  let mod;
  try {
    mod = await import(MODULE_PATH);
  } catch (err) {
    assert.fail(
      `[FM-A1] src/game/frame-metrics.js failed to LOAD (${err && err.message}). ` +
      `That is not the expected Wave 1 red — the expected red is "the interval-statistics ` +
      `API is absent". This is a regression in the shipped 250 ms sampler.`
    );
  }
  const missing = REQUIRED_EXPORTS.filter((name) => mod[name] === undefined);
  if (missing.length > 0) {
    assert.fail(
      `[FM-A1] src/game/frame-metrics.js does not yet export the interval-statistics API ` +
      `required by ULTRACODE §4 Wave 2 P2.1 (CONTRACT.md TEL-2 / TEL-3). Missing: ` +
      `${missing.join(', ')}. This is the CORRECT state until P2.1 lands — this suite is ` +
      `the oracle P2.1 is written against, not a report of a broken build.`
    );
  }
  return mod;
}

/* -------------------------------------------------------------------------
 * INDEPENDENT REFERENCE IMPLEMENTATIONS
 *
 * Deliberately written a different way from any plausible implementation:
 * copy, sort numerically ascending, index. No shared helper, no import from
 * src/. If these and the module agree, they agree by arithmetic and not by
 * construction.
 * ------------------------------------------------------------------------- */

/** Nearest-rank percentile, by sort-and-index. The oracle. */
function refNearestRank(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b); // numeric, not lexicographic
  const n = sorted.length;
  let index = Math.ceil(p * n) - 1;
  if (index < 0) index = 0;
  if (index > n - 1) index = n - 1;
  return sorted[index];
}

/**
 * Linear interpolation between order statistics (R-7 / numpy default).
 * Present ONLY so the corpus can prove it actually discriminates between the
 * two conventions — if every seeded array happened to give the same answer
 * under both, FM-A4 would be green against an implementation that used the
 * wrong one. See the discrimination count assertion in FM-A4.
 */
function refLinearInterpolation(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** Missed-target count, by direct filter. B = 1000 / targetFPS; strictly greater. */
function refMissedPct(values, budgetMs) {
  if (!Array.isArray(values) || values.length === 0) return null;
  let missed = 0;
  for (const v of values) if (v > budgetMs) missed += 1;
  return (missed / values.length) * 100;
}

/** mulberry32 — seeded, deterministic, no dependency. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ~200 seeded interval arrays covering the shapes a real device produces:
 * steady vsync, a struggling device, bimodal (a hitch every so often), a
 * constant array (every value identical — percentiles must not divide by a
 * spread of zero), and a single sample.
 */
function seededCorpus(count = 200) {
  const rand = mulberry32(0x8EEF11);
  const arrays = [];
  for (let i = 0; i < count; i += 1) {
    const shape = i % 5;
    const n = shape === 4 ? 1 : 3 + Math.floor(rand() * 498); // 1, or 3..500
    const values = new Array(n);
    for (let k = 0; k < n; k += 1) {
      if (shape === 0) values[k] = 16.5 + rand() * 0.9;                       // steady 60
      else if (shape === 1) values[k] = 20 + rand() * 18;                     // struggling
      else if (shape === 2) values[k] = rand() < 0.08 ? 55 + rand() * 700     // bimodal
                                                      : 16 + rand() * 2;
      else if (shape === 3) values[k] = 16.666666666666668;                   // constant
      else values[k] = 12 + rand() * 40;                                      // n === 1
    }
    arrays.push(values);
  }
  return arrays;
}

/** Drive a recorder with an explicit fake clock over a list of intervals. */
function feed(recorder, intervals, startAt = 1000, valid = true, invalidReason = null) {
  let t = startAt;
  recorder.sample(t); // first call starts the clock and records nothing
  for (const dt of intervals) {
    t += dt;
    recorder.sample(t, valid, invalidReason);
  }
  return t;
}

/** Assert a "reading" is a live measurement, and pull its number out. */
function readingValue(reading, id, label) {
  assert.equal(typeof reading, 'object', `[${id}] ${label} must be a reading object, got ${typeof reading}`);
  assert.notEqual(reading, null, `[${id}] ${label} must not be a bare null`);
  assert.equal(reading.state, 'ok', `[${id}] ${label} state`);
  assert.equal(reading.reason, null, `[${id}] ${label} reason must be null when state is ok`);
  assert.equal(typeof reading.value, 'number', `[${id}] ${label} value must be a number when ok`);
  assert.ok(Number.isFinite(reading.value), `[${id}] ${label} value must be finite`);
  return reading.value;
}

/* =========================================================================
 * FM-A2 / FM-A3 — the convention itself
 * ========================================================================= */

test('FM-A2: the percentile convention is named in the module, not implied by its code', gate, async () => {
  // CONTRACT.md §1.3 + ULTRACODE §4 P1.1a: four modules, three conventions.
  // The convention has to be READABLE at the call site, or the controller
  // (Wave 3, PRO-1) and the acceptance gate (PRO-10) drift apart silently
  // while both remain green.
  const { PERCENTILE_CONVENTION } = await loadIntervalStats();
  assert.equal(
    PERCENTILE_CONVENTION,
    'nearest-rank',
    '[FM-A2] the pinned convention is nearest-rank (see this file\'s header for why); ' +
    'changing it is a gate decision recorded in docs/perf/gates/, not an implementation choice'
  );
});

test('FM-A3: nearest-rank, on the exact cases that separate it from interpolation', gate, async () => {
  const { percentile } = await loadIntervalStats();

  // THE discriminating case. Two samples, p50.
  //   nearest-rank : ceil(0.5 * 2) - 1 = 0        -> 10
  //   interpolation: 10 + 0.5 * (20 - 10)         -> 15
  // If this returns 15, the implementation interpolates. There is no third
  // answer, and no rounding story that explains 15.
  assert.equal(
    percentile([10, 20], 0.5), 10,
    '[FM-A3] p50 of [10,20] is 10 under nearest-rank; 15 means linear interpolation shipped'
  );

  // 1..100, p99: ceil(99) - 1 = 98 -> 99. R-7 gives 99.01.
  const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(oneToHundred, 0.99), 99, '[FM-A3] p99 of 1..100');
  assert.equal(percentile(oneToHundred, 0.95), 95, '[FM-A3] p95 of 1..100');
  assert.equal(percentile(oneToHundred, 0.5), 50, '[FM-A3] p50 of 1..100');

  // n = 20, p95: ceil(19) - 1 = 18 -> the 19th value.
  const twenty = Array.from({ length: 20 }, (_, i) => (i + 1) * 3);
  assert.equal(percentile(twenty, 0.95), 57, '[FM-A3] p95 of 20 samples is the 19th');

  // n = 1: every percentile is that sample. No interpolation partner exists.
  assert.equal(percentile([41.5], 0.5), 41.5, '[FM-A3] n=1 p50');
  assert.equal(percentile([41.5], 0.99), 41.5, '[FM-A3] n=1 p99');

  // p = 1 is the maximum, and must not index off the end.
  assert.equal(percentile(oneToHundred, 1), 100, '[FM-A3] p100 is the maximum, not undefined');

  // Unsorted input must not be trusted to arrive sorted, and must not be
  // sorted lexicographically ("100" < "20" as strings would give 20 here).
  assert.equal(percentile([20, 100, 3], 1), 100, '[FM-A3] input is sorted numerically, not lexicographically');
});

/* =========================================================================
 * FM-A4 / FM-A5 / FM-A6 — the helper against an independent reference
 * ========================================================================= */

test('FM-A4: percentiles match an independent sort-and-index reference over 200 seeded arrays', gate, async () => {
  const { percentile } = await loadIntervalStats();
  const corpus = seededCorpus(200);

  let discriminating = 0;
  for (let i = 0; i < corpus.length; i += 1) {
    const values = corpus[i];
    for (const p of [0.5, 0.95, 0.99]) {
      const expected = refNearestRank(values, p);
      const actual = percentile(values, p);
      assert.equal(
        actual, expected,
        `[FM-A4] array #${i} (n=${values.length}) p${p * 100}: ` +
        `module ${actual} vs independent sort-and-index reference ${expected}`
      );
      if (refLinearInterpolation(values, p) !== expected) discriminating += 1;
    }
  }

  // Non-vacuity (rule R8). If nearest-rank and interpolation agreed on every
  // case in the corpus, the loop above would be green against an
  // implementation using the wrong convention, and this suite would be a hope
  // rather than an oracle. Assert the corpus really does separate them.
  assert.ok(
    discriminating > 50,
    `[FM-A4] the corpus must actually discriminate between the two conventions; ` +
    `only ${discriminating} of ${corpus.length * 3} cases differ under interpolation`
  );
});

test('FM-A5: percentile() does not sort the caller\'s array in place', gate, async () => {
  const { percentile } = await loadIntervalStats();

  // The recorder's ring is handed to this helper. An in-place sort would
  // reorder live measurement state, and the export — which the plan requires
  // for offline checking — would then be in a different order every time the
  // panel refreshed.
  const values = [30, 10, 50, 20, 40];
  const before = values.slice();
  percentile(values, 0.95);
  assert.deepEqual(values, before, '[FM-A5] input array was reordered');

  // And prove it structurally: a frozen array cannot be sorted in place at
  // all, so an implementation that does will throw here rather than quietly
  // pass the deepEqual above on some future refactor.
  const frozen = Object.freeze([30, 10, 50, 20, 40]);
  assert.equal(percentile(frozen, 1), 50, '[FM-A5] percentile must work on a frozen (non-sortable) array');
});

test('FM-A6: no samples reports the sentinel, never a plausible zero', gate, async () => {
  // CONTRACT.md §3.1: forbidden sentinel substitutes include `0`, `-1`, bare
  // `null` in a display slot and NaN. A zero p95 reads as a perfect frame
  // budget; that is exactly how a dead measurement survives review.
  const { percentile, createIntervalRecorder } = await loadIntervalStats();

  assert.equal(percentile([], 0.5), null, '[FM-A6] percentile of an empty array is null, not 0');

  const recorder = createIntervalRecorder({ targetFPS: 60 });
  const empty = recorder.stats();

  for (const field of ['p50', 'p95', 'p99', 'missedTargetPct']) {
    const reading = empty[field];
    assert.equal(typeof reading, 'object', `[FM-A6] ${field} must be a reading object`);
    assert.notEqual(reading, null, `[FM-A6] ${field} must not be a bare null`);
    assert.equal(reading.value, null, `[FM-A6] ${field}.value must be null with no samples`);
    assert.notEqual(reading.value, 0, `[FM-A6] ${field} reported 0 for "no measurement"`);
    assert.equal(reading.state, 'unavailable', `[FM-A6] ${field}.state`);
    assert.equal(reading.reason, 'insufficient-samples', `[FM-A6] ${field}.reason must come from the §3.1 enum`);
  }

  assert.equal(empty.samples.total, 0, '[FM-A6] sample counts are still reported');
  assert.equal(empty.samples.valid, 0);
  assert.equal(empty.samples.invalid, 0);

  // The first sample() call only starts the clock — it is an instant, not an
  // interval. It must not manufacture a measurement.
  recorder.sample(5000);
  const stillEmpty = recorder.stats();
  assert.equal(stillEmpty.samples.total, 0, '[FM-A6] the clock-starting call is not an interval');
  assert.equal(stillEmpty.p95.value, null, '[FM-A6] still no percentile after one timestamp');
});

/* =========================================================================
 * FM-A7 / FM-A8 / FM-A9 — the pipeline, and the budget
 * ========================================================================= */

test('FM-A7: stats() over fed samples matches the reference — the pipeline, not just the helper', gate, async () => {
  // FM-A4 checks the helper. This checks that sample() actually records the
  // DELTA between timestamps and that stats() runs the helper over those
  // deltas. A recorder that stored timestamps instead of intervals would pass
  // FM-A4 and be completely wrong here.
  const { createIntervalRecorder } = await loadIntervalStats();
  const corpus = seededCorpus(200);

  for (let i = 0; i < corpus.length; i += 1) {
    const intervals = corpus[i];
    const recorder = createIntervalRecorder({ capacity: 600, targetFPS: 60 });
    feed(recorder, intervals);

    const s = recorder.stats();
    assert.equal(s.samples.total, intervals.length, `[FM-A7] array #${i}: recorded count`);
    assert.equal(s.samples.valid, intervals.length, `[FM-A7] array #${i}: valid count`);

    // The recorder subtracts consecutive timestamps off an accumulating clock,
    // so a recovered delta agrees with the fed one to float precision and not
    // to the bit. Demanding bit equality here would be an oracle asserting
    // something no real implementation driven by a real clock can satisfy —
    // so the delta semantics are pinned to a tolerance, and the percentile
    // comparison is then exact over the values the recorder actually holds.
    const recorded = recorder.exportIntervals().map((r) => r.dtMs);
    assert.equal(recorded.length, intervals.length, `[FM-A7] array #${i}: exported count`);
    for (let k = 0; k < intervals.length; k += 1) {
      assert.ok(
        Math.abs(recorded[k] - intervals[k]) <= 1e-9 * Math.max(1, intervals[k]),
        `[FM-A7] array #${i} interval ${k}: recorded ${recorded[k]} for a fed delta of ${intervals[k]} ` +
        `— sample() must store the DELTA between timestamps, not the timestamp`
      );
    }

    assert.equal(readingValue(s.p50, 'FM-A7', `array #${i} p50`), refNearestRank(recorded, 0.5));
    assert.equal(readingValue(s.p95, 'FM-A7', `array #${i} p95`), refNearestRank(recorded, 0.95));
    assert.equal(readingValue(s.p99, 'FM-A7', `array #${i} p99`), refNearestRank(recorded, 0.99));
    assert.equal(
      readingValue(s.missedTargetPct, 'FM-A7', `array #${i} missed`),
      refMissedPct(recorded, 1000 / 60),
      `[FM-A7] array #${i}: missed-target percentage`
    );
  }

  // And the intervals themselves are deltas, in order, with their timestamps.
  const recorder = createIntervalRecorder({ capacity: 16, targetFPS: 60 });
  feed(recorder, [10, 20, 30], 1000);
  const out = recorder.exportIntervals();
  assert.deepEqual(out.map((r) => r.dtMs), [10, 20, 30], '[FM-A7] sample() records deltas');
  assert.deepEqual(out.map((r) => r.tMs), [1010, 1030, 1060], '[FM-A7] each interval carries the time it ENDED at');
});

test('FM-A8: the target budget is B = 1000 / targetFPS, from the plan, not a constant', gate, async () => {
  // PERFORMANCE_REALISM_PLAN.md §"How intelligent up/down shifting should work"
  // step 2: "Use a target budget B = 1000 / targetFPS." A hardcoded 16.67 is a
  // fabricated constant the moment DEF-3's 30 FPS row is ever reopened.
  const { createIntervalRecorder } = await loadIntervalStats();

  const sixty = createIntervalRecorder({ targetFPS: 60 });
  assert.equal(sixty.budgetMs, 1000 / 60, '[FM-A8] B at 60 FPS');
  assert.equal(sixty.stats().budgetMs, 1000 / 60, '[FM-A8] stats() reports the budget it scored against');
  assert.equal(sixty.stats().targetFPS, 60, '[FM-A8] stats() reports the target it was given');

  const thirty = createIntervalRecorder({ targetFPS: 30 });
  assert.equal(thirty.budgetMs, 1000 / 30, '[FM-A8] B at 30 FPS');

  const fifty = createIntervalRecorder({ targetFPS: 50 });
  assert.equal(fifty.budgetMs, 20, '[FM-A8] B at 50 FPS is exactly 20 ms');
});

test('FM-A9: a missed frame is STRICTLY over budget, and the figure is a percentage', gate, async () => {
  // TEL-3. targetFPS 50 is used deliberately: B is exactly 20, so ">" and ">="
  // are separable in exact float arithmetic. At 60 FPS, B = 16.666...,
  // and no test can distinguish the two comparators without relying on a
  // representation accident.
  const { createIntervalRecorder } = await loadIntervalStats();

  const onBudget = createIntervalRecorder({ capacity: 64, targetFPS: 50 });
  feed(onBudget, new Array(40).fill(20));
  assert.equal(
    readingValue(onBudget.stats().missedTargetPct, 'FM-A9', 'exactly-on-budget'), 0,
    '[FM-A9] a frame that lands exactly on the budget MET it; ">=" would report 100%'
  );

  const overBudget = createIntervalRecorder({ capacity: 64, targetFPS: 50 });
  feed(overBudget, new Array(40).fill(20.0001));
  assert.equal(
    readingValue(overBudget.stats().missedTargetPct, 'FM-A9', 'just-over-budget'), 100,
    '[FM-A9] a frame a tenth of a microsecond over budget missed it'
  );

  // A percentage, not a fraction and not a count. 5 of 20 over budget = 25.
  const mixed = createIntervalRecorder({ capacity: 64, targetFPS: 50 });
  feed(mixed, [...new Array(15).fill(12), ...new Array(5).fill(48)]);
  assert.equal(
    readingValue(mixed.stats().missedTargetPct, 'FM-A9', 'mixed'), 25,
    '[FM-A9] 5 missed of 20 is 25 (a percentage), not 0.25 and not 5'
  );
});

/* =========================================================================
 * FM-A10 / FM-A11 — paused is a validity state, not a reset
 * ========================================================================= */

test('FM-A10: paused samples are excluded from the statistics and retained in the export', gate, async () => {
  // CONTRACT.md §2.2, verbatim: "Mark paused measurements invalid for adaptive
  // decisions" — not "discard them". A 900 ms frame while the tab was hidden is
  // real data about the resume path; deleting it means the resume spike can
  // never be studied. Invalid-for-decisions and present-in-evidence are
  // different properties and the implementation must carry both.
  const { createIntervalRecorder } = await loadIntervalStats();
  const recorder = createIntervalRecorder({ capacity: 256, targetFPS: 60 });

  let t = 1000;
  recorder.sample(t);
  for (let i = 0; i < 100; i += 1) { t += 16; recorder.sample(t); }
  for (let i = 0; i < 20; i += 1) { t += 900; recorder.sample(t, false, 'hidden'); }

  const s = recorder.stats();
  assert.equal(s.samples.total, 120, '[FM-A10] every sample is counted');
  assert.equal(s.samples.valid, 100, '[FM-A10] valid count');
  assert.equal(s.samples.invalid, 20, '[FM-A10] invalid count');

  // The whole point: 20 of 120 samples are 900 ms, so a naive p99 over all
  // samples is 900. Over valid samples only it is 16.
  assert.equal(readingValue(s.p99, 'FM-A10', 'p99'), 16,
    '[FM-A10] percentiles are computed over valid === true only (a hidden-tab frame is not a frame rate)');
  assert.equal(readingValue(s.missedTargetPct, 'FM-A10', 'missed'), 0,
    '[FM-A10] a paused frame did not miss the budget; it was not being measured');

  // ...and they are still all there, with their reason, for the export.
  const out = recorder.exportIntervals();
  assert.equal(out.length, 120, '[FM-A10] the export retains invalid samples');
  const hidden = out.filter((r) => r.valid === false);
  assert.equal(hidden.length, 20, '[FM-A10] invalid samples keep their flag');
  for (const r of hidden) {
    assert.equal(r.invalidReason, 'hidden', '[FM-A10] invalid samples keep their reason');
    assert.equal(r.dtMs, 900, '[FM-A10] the paused interval itself is preserved, not zeroed');
  }
  for (const r of out.filter((x) => x.valid === true)) {
    assert.equal(r.invalidReason, null, '[FM-A10] a valid sample carries no reason');
  }
});

test('FM-A11: the invalid-reason enum is closed, and an unexplained invalid sample is refused', gate, async () => {
  // A typo'd reason string silently becomes an unexplained spike in Wave 3's
  // acceptance gate ("no recurring unexplained >50 ms spikes"), which is the
  // one gate that distinguishes an explained boundary from a real regression.
  const { createIntervalRecorder, INVALID_REASONS } = await loadIntervalStats();

  assert.deepEqual(
    [...INVALID_REASONS].sort(),
    ['benchmarkHold', 'contextLost', 'flightPaused', 'frozen', 'hidden', 'panelHold', 'systemPaused'],
    '[FM-A11] the closed set from CONTRACT.md §2.2'
  );

  const recorder = createIntervalRecorder({ capacity: 32, targetFPS: 60 });
  recorder.sample(1000);
  assert.throws(
    () => recorder.sample(1900, false, 'backgrounded'),
    '[FM-A11] an invalid reason outside the enum must be refused, not stored'
  );
  assert.throws(
    () => recorder.sample(1900, false, null),
    '[FM-A11] valid === false with no reason must be refused — "invalid, cause unknown" is unusable evidence'
  );
});

/* =========================================================================
 * FM-A12 .. FM-A16 — the tagged reset enum
 * ========================================================================= */

test('FM-A12: the reset tag enum is closed, and "paused" is not in it', gate, async () => {
  // CONTRACT.md §2.1: "Every history reset carries exactly one tag from this
  // set. An untagged reset is a contract violation." §2.2: "`paused` is not in
  // the enum above and must never be implemented as one."
  const { createIntervalRecorder, RESET_TAGS } = await loadIntervalStats();

  assert.deepEqual(
    [...RESET_TAGS].sort(),
    ['contextRestore', 'environment', 'load', 'manual', 'orientation', 'resize', 'resume'],
    '[FM-A12] the closed set from CONTRACT.md §2.1'
  );
  assert.ok(!RESET_TAGS.includes('paused'), '[FM-A12] paused is a validity state, never a reset tag');

  const recorder = createIntervalRecorder({ capacity: 32, targetFPS: 60 });
  feed(recorder, [16, 16, 16]);

  assert.throws(() => recorder.reset(), '[FM-A12] an untagged reset is a contract violation');
  assert.throws(() => recorder.reset('paused'), '[FM-A12] reset("paused") must be refused (§2.2)');
  assert.throws(() => recorder.reset('startup'), '[FM-A12] an unknown tag must be refused');

  // A refused reset must not half-happen.
  assert.equal(recorder.stats().samples.total, 3, '[FM-A12] a refused reset must not clear the buffer');

  for (const tag of RESET_TAGS) {
    const r = createIntervalRecorder({ capacity: 32, targetFPS: 60 });
    feed(r, [16, 16]);
    r.reset(tag, 5000);
    assert.equal(r.stats().samples.total, 0, `[FM-A12] reset("${tag}") clears the decision window`);
  }
});

test('FM-A13: an interval before a tagged boundary is gone; one after it survives', gate, async () => {
  const { createIntervalRecorder } = await loadIntervalStats();
  const recorder = createIntervalRecorder({ capacity: 256, targetFPS: 60 });

  // Before: a world rebuild's worth of terrible frames.
  feed(recorder, [420, 380, 350], 1000);
  assert.equal(recorder.stats().samples.total, 3);

  recorder.reset('environment', 3000);

  // After: an ordinary flight.
  let t = 3000;
  recorder.sample(t);
  for (let i = 0; i < 50; i += 1) { t += 16; recorder.sample(t); }

  const s = recorder.stats();
  assert.equal(s.samples.total, 50, '[FM-A13] only post-boundary intervals remain in the window');
  assert.equal(readingValue(s.p99, 'FM-A13', 'p99'), 16,
    '[FM-A13] the biome-switch stall must not survive into the decision window as a p99');

  const out = recorder.exportIntervals();
  assert.ok(!out.some((r) => r.dtMs >= 350),
    '[FM-A13] the pre-boundary intervals are absent after the reset');
  assert.equal(out.length, 50);
});

test('FM-A14: a reset restarts the clock, so the gap across it is not recorded as one huge frame', gate, async () => {
  // The trap this catches is concrete and has already been solved once in this
  // module for `createFrameSampler`: if the recorder keeps its last timestamp
  // across the boundary, the FIRST sample after a 30-second backgrounded tab
  // records a 30,000 ms interval, which is the single worst possible value to
  // hand a controller that fires on p95. The reset cleared the buffer and then
  // immediately refilled it with the very stall it existed to discard.
  const { createIntervalRecorder } = await loadIntervalStats();
  const recorder = createIntervalRecorder({ capacity: 256, targetFPS: 60 });

  feed(recorder, [16, 16, 16], 1000);
  recorder.reset('resume', 1048);

  assert.equal(recorder.sample(31000), null,
    '[FM-A14] the first sample after a reset restarts the clock and records nothing');

  let t = 31000;
  for (let i = 0; i < 30; i += 1) { t += 16; recorder.sample(t); }

  const out = recorder.exportIntervals();
  assert.equal(out.length, 30, '[FM-A14] exactly the post-resume frames');
  const worst = Math.max(...out.map((r) => r.dtMs));
  assert.equal(worst, 16, `[FM-A14] the 30-second gap leaked in as a ${worst} ms interval`);
});

test('FM-A15: a recurrent gameplay hitch is NOT erased by a reset', gate, async () => {
  // PERFORMANCE_REALISM_PLAN.md, step 7, verbatim: "Reset all relevant history
  // after bounded, explicitly tagged loading/resume/resize events. Do not erase
  // recurrent gameplay hitches." CONTRACT.md §2.1 rule 1 makes it explicit: a
  // reset clears the decision windows and does NOT clear the recurrent-hitch
  // log. A hitch that recurs every lap around the planet is the single most
  // valuable thing this module can record, and a resize storm during a drag
  // would otherwise delete it every time.
  const { createIntervalRecorder, HITCH_THRESHOLD_MS } = await loadIntervalStats();

  // 50 ms is transcribed from the acceptance sentence: "no recurring
  // unexplained >50 ms spikes" (PERFORMANCE_REALISM_PLAN.md acceptance, ACC-3).
  assert.equal(HITCH_THRESHOLD_MS, 50, '[FM-A15] the hitch threshold is the acceptance sentence\'s 50 ms');

  const recorder = createIntervalRecorder({ capacity: 128, targetFPS: 60 });

  let t = 1000;
  recorder.sample(t);
  for (let lap = 0; lap < 4; lap += 1) {
    for (let i = 0; i < 20; i += 1) { t += 16; recorder.sample(t); }
    t += 140; recorder.sample(t);            // the same hitch, once a lap
  }

  const before = recorder.hitches();
  assert.equal(before.length, 4, '[FM-A15] four laps, four recurrences');
  for (const h of before) assert.equal(h.dtMs, 140, '[FM-A15] the hitch keeps its magnitude');

  recorder.reset('resize', t);
  assert.equal(recorder.stats().samples.total, 0, '[FM-A15] the decision window did clear');
  assert.deepEqual(recorder.hitches(), before, '[FM-A15] the recurrent-hitch log survived the reset');

  // A 50.0 ms frame is not over 50 ms. The acceptance sentence says ">50 ms".
  const edge = createIntervalRecorder({ capacity: 32, targetFPS: 60 });
  feed(edge, [50, 50, 50.0001], 1000);
  assert.equal(edge.hitches().length, 1, '[FM-A15] the threshold is strictly greater than 50 ms');

  // A paused frame is an explained stall, not a gameplay hitch. Logging it
  // would make the resume path look like a recurring regression forever.
  const paused = createIntervalRecorder({ capacity: 32, targetFPS: 60 });
  paused.sample(1000);
  paused.sample(1900, false, 'hidden');
  assert.equal(paused.hitches().length, 0, '[FM-A15] an invalid sample is not a recurrent gameplay hitch');
  assert.equal(paused.exportIntervals().length, 1, '[FM-A15] ...but it is still in the export');
});

test('FM-A16: a reset is a recorded, idempotent boundary — a resize storm is one boundary, not forty', gate, async () => {
  // CONTRACT.md §2.1 rule 3: "A reset is a bounded event. If the tagged
  // condition persists (a resize storm during a drag), the reset is idempotent,
  // not re-armed per event." And §2.2's table: for a reset tag, the effect on
  // the export is "recorded as a boundary".
  const { createIntervalRecorder, BOUNDARY_CAPACITY } = await loadIntervalStats();
  const recorder = createIntervalRecorder({ capacity: 256, targetFPS: 60 });

  feed(recorder, [16, 16, 16], 1000);

  for (let i = 0; i < 40; i += 1) recorder.reset('resize', 1048 + i);
  assert.equal(recorder.boundaries().length, 1,
    '[FM-A16] forty resize events with no frames between them are one boundary');
  assert.equal(recorder.boundaries()[0].tag, 'resize', '[FM-A16] the boundary carries its tag');
  assert.equal(recorder.boundaries()[0].tMs, 1048, '[FM-A16] and the time it happened');

  // Frames resume; the next reset is a genuinely new boundary.
  let t = 2000;
  recorder.sample(t);
  for (let i = 0; i < 5; i += 1) { t += 16; recorder.sample(t); }
  recorder.reset('orientation', t);

  const boundaries = recorder.boundaries();
  assert.equal(boundaries.length, 2, '[FM-A16] a boundary after new samples is a new boundary');
  assert.deepEqual(boundaries.map((b) => b.tag), ['resize', 'orientation'],
    '[FM-A16] boundaries are history: the earlier one survived the later reset');

  assert.ok(Number.isInteger(BOUNDARY_CAPACITY) && BOUNDARY_CAPACITY > 0,
    '[FM-A16] the boundary log is a bounded ring, not an unbounded session log');
});

/* =========================================================================
 * FM-A17 / FM-A18 — the export is a copy, and it is in order
 * ========================================================================= */

test('FM-A17: exportIntervals() returns a copy a caller cannot use to corrupt live state', gate, async () => {
  const { createIntervalRecorder } = await loadIntervalStats();
  const recorder = createIntervalRecorder({ capacity: 64, targetFPS: 60 });
  feed(recorder, [16, 16, 16, 16, 16], 1000);

  const a = recorder.exportIntervals();
  const b = recorder.exportIntervals();
  assert.notEqual(a, b, '[FM-A17] each export is its own array');
  assert.deepEqual(a, b, '[FM-A17] ...with the same contents');

  const live = recorder.__buffers();
  for (const value of Object.values(live)) {
    assert.notEqual(a, value, '[FM-A17] the export is never the live ring itself');
  }

  // The panel refreshes four times a second and the evidence export is JSON
  // the user can edit. Neither may reach into the measurement.
  a.push({ dtMs: 9999, tMs: 0, valid: true, invalidReason: null });
  a.length = 2;
  const beforeElementMutation = recorder.stats();
  const first = recorder.exportIntervals()[0];
  first.dtMs = 9999;
  first.valid = false;
  first.invalidReason = 'frozen';

  const after = recorder.stats();
  assert.equal(after.samples.total, 5, '[FM-A17] mutating the export did not change the sample count');
  assert.equal(after.samples.valid, 5, '[FM-A17] ...nor flip a sample to invalid');
  assert.equal(readingValue(after.p99, 'FM-A17', 'p99'), 16,
    '[FM-A17] ...nor inject a 9999 ms frame into the controller\'s p99');
  assert.equal(
    readingValue(after.p99, 'FM-A17', 'p99'),
    readingValue(beforeElementMutation.p99, 'FM-A17', 'p99 before'),
    '[FM-A17] the records are copies too, not live entries handed out'
  );

  // Same rule for the other two logs.
  const hitchRecorder = createIntervalRecorder({ capacity: 32, targetFPS: 60 });
  feed(hitchRecorder, [16, 120, 16], 1000);
  const hitches = hitchRecorder.hitches();
  hitches.length = 0;
  assert.equal(hitchRecorder.hitches().length, 1, '[FM-A17] hitches() returns a copy');

  hitchRecorder.reset('manual', 2000);
  const bounds = hitchRecorder.boundaries();
  bounds.length = 0;
  assert.equal(hitchRecorder.boundaries().length, 1, '[FM-A17] boundaries() returns a copy');
});

test('FM-A18: after the ring wraps, the export is still oldest-to-newest', gate, async () => {
  // A ring exported in raw storage order is chronologically scrambled at the
  // write head. Percentiles do not care; a human reading an evidence file, and
  // any "what happened just before the spike" question, care completely.
  const { createIntervalRecorder } = await loadIntervalStats();
  const capacity = 32;
  const recorder = createIntervalRecorder({ capacity, targetFPS: 60 });

  const intervals = [];
  for (let i = 0; i < capacity * 3 + 7; i += 1) intervals.push(10 + i);
  feed(recorder, intervals, 1000);

  const out = recorder.exportIntervals();
  assert.equal(out.length, capacity, '[FM-A18] the export is bounded by the ring capacity');

  for (let i = 1; i < out.length; i += 1) {
    assert.ok(out[i].tMs > out[i - 1].tMs,
      `[FM-A18] out-of-order at index ${i}: ${out[i - 1].tMs} then ${out[i].tMs} (raw ring order?)`);
  }
  assert.deepEqual(
    out.map((r) => r.dtMs),
    intervals.slice(-capacity),
    '[FM-A18] the export holds the newest `capacity` intervals, in the order they happened'
  );
});

/* =========================================================================
 * FM-A19 / FM-A20 — the structural zero-allocation assertions
 * ========================================================================= */

test('FM-A19: capacity is fixed and honoured across a soak', gate, async () => {
  // At 60 fps a 15-minute soak is ~54,000 intervals. The failure this pins is
  // not hypothetical: exportIntervals() invites an implementation that keeps a
  // parallel plain Array of every sample ever taken so the export is easy, and
  // that array is invisible until a phone runs out of memory in the twelfth
  // minute of a session nobody is watching.
  const { createIntervalRecorder, INTERVAL_CAPACITY, HITCH_CAPACITY, BOUNDARY_CAPACITY } =
    await loadIntervalStats();

  for (const [name, value] of Object.entries({ INTERVAL_CAPACITY, HITCH_CAPACITY, BOUNDARY_CAPACITY })) {
    assert.ok(Number.isInteger(value) && value > 0, `[FM-A19] ${name} must be a positive integer`);
    assert.ok(value <= 4096,
      `[FM-A19] ${name} is ${value}; a 15-minute soak reaches ~54,000 intervals, so any cap ` +
      `in that range is not a cap`);
  }

  const recorder = createIntervalRecorder({ targetFPS: 60 });
  assert.equal(recorder.capacity, INTERVAL_CAPACITY, '[FM-A19] the default recorder honours the exported capacity');

  let t = 0;
  recorder.sample(t);
  for (let i = 0; i < 54000; i += 1) {
    t += (i % 97 === 0) ? 140 : 16;   // a hitch every 97 frames, ~556 of them
    recorder.sample(t);
    if (i % 5000 === 4999) recorder.reset('manual', t);
  }

  assert.equal(recorder.capacity, INTERVAL_CAPACITY, '[FM-A19] capacity did not grow to fit');
  assert.ok(recorder.exportIntervals().length <= INTERVAL_CAPACITY,
    '[FM-A19] the export is bounded by the ring, 54,000 samples later');
  assert.ok(recorder.hitches().length <= HITCH_CAPACITY,
    `[FM-A19] the hitch log is bounded (~557 hitches occurred, cap is ${HITCH_CAPACITY})`);
  assert.ok(recorder.boundaries().length <= BOUNDARY_CAPACITY,
    '[FM-A19] the boundary log is bounded');
});

/**
 * Walk everything reachable from `root` and collect every array-like, by path.
 * Array-likes are recorded but not descended into: a parallel unbounded log of
 * sample objects hangs off its own property and is found there, and descending
 * into 54,000 elements would make this check cost more than the soak.
 */
function reachableBuffers(root, maxDepth = 5) {
  const found = new Map();
  const seen = new Set();
  const queue = [[root, 'root', 0]];
  while (queue.length > 0) {
    const [node, path, depth] = queue.shift();
    if (node === null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node) || ArrayBuffer.isView(node)) {
      found.set(path, node);
      continue;
    }
    if (depth >= maxDepth) continue;
    for (const key of Object.keys(node)) {
      let value;
      try { value = node[key]; } catch { continue; }
      if (typeof value === 'function') continue;
      queue.push([value, `${path}.${key}`, depth + 1]);
    }
  }
  return found;
}

test('FM-A20: no array reachable from the recorder grows while it is sampled', gate, async () => {
  // The STRUCTURAL assertion. "The ring buffer is still the same object" is not
  // enough: the object that ruins a soak is the SECOND one, added later, in a
  // commit that only meant to make exportIntervals() simpler.
  //
  // This walks the recorder — its own properties, and the live internals
  // `__buffers()` hands over — snapshots every array-like it can reach, soaks,
  // and walks again. A new array-valued path, or an old one that got longer, is
  // the failure. `__buffers()` exists for exactly this: a reachability check
  // that cannot reach anything passes vacuously, and rule R8 says a check is not
  // an oracle until it has been watched failing.
  const { createIntervalRecorder, INTERVAL_CAPACITY, HITCH_CAPACITY, BOUNDARY_CAPACITY } =
    await loadIntervalStats();
  const recorder = createIntervalRecorder({ targetFPS: 60 });

  const roots = () => ({ recorder, buffers: recorder.__buffers() });
  const cap = Math.max(INTERVAL_CAPACITY, HITCH_CAPACITY, BOUNDARY_CAPACITY);

  // Warm up well past every ring's capacity, so steady state is reached and any
  // later growth is real growth and not a ring still filling.
  let t = 0;
  recorder.sample(t);
  for (let i = 0; i < cap * 3; i += 1) {
    t += (i % 50 === 0) ? 120 : 16;
    recorder.sample(t);
  }

  const before = reachableBuffers(roots());
  assert.ok(before.size > 0,
    '[FM-A20] no array-like is reachable from the recorder or __buffers(), so this check would ' +
    'pass no matter what the implementation allocates. __buffers() must return the LIVE internal ' +
    'buffers (CONTRACT.md §2.2 also needs them for the evidence export).');

  const snapshot = new Map();
  for (const [path, buf] of before) snapshot.set(path, buf.length);

  // The soak: 60,000 further intervals, ~1,200 hitches, 12 tagged resets.
  for (let i = 0; i < 60000; i += 1) {
    t += (i % 50 === 0) ? 120 : 16;
    recorder.sample(t);
    if (i % 5000 === 4999) recorder.reset('manual', t);
  }

  const after = reachableBuffers(roots());

  for (const path of after.keys()) {
    assert.ok(snapshot.has(path),
      `[FM-A20] a new array appeared at ${path} during the soak — this is the parallel ` +
      `unbounded log the check exists to catch`);
  }
  for (const [path, length] of snapshot) {
    assert.ok(after.has(path), `[FM-A20] ${path} vanished during the soak`);
    assert.ok(after.get(path).length <= length,
      `[FM-A20] ${path} grew from ${length} to ${after.get(path).length} entries while sampling`);
    assert.ok(after.get(path).length <= 4096,
      `[FM-A20] ${path} holds ${after.get(path).length} entries; nothing here may be unbounded`);
  }

  // And the ring is the same object throughout — it is written through, never
  // reallocated, which is the zero-allocation half of CLAUDE.md house rule 4.
  const afterBuffers = recorder.__buffers();
  for (const [path, buf] of before) {
    if (!path.startsWith('root.buffers.')) continue;
    const key = path.slice('root.buffers.'.length);
    assert.equal(afterBuffers[key], buf, `[FM-A20] the live buffer at ${key} was reallocated`);
  }

  // Sanity: the recorder still measures correctly after all of that. (The soak
  // ends on one of its own tagged resets, so the decision window is empty by
  // construction — feed it a fresh second of flight and check that.)
  let t2 = t;
  recorder.sample(t2);
  for (let i = 0; i < 200; i += 1) { t2 += 16; recorder.sample(t2); }
  assert.equal(readingValue(recorder.stats().p50, 'FM-A20', 'p50'), 16,
    '[FM-A20] the recorder still reports a correct p50 after a 114,000-sample soak');
});
