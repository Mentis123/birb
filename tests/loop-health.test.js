/**
 * tests/loop-health.test.js — RED-FIRST spec for `src/game/loop-health.js`,
 * step 6 of the MANDATORY RUNTIME LOOP: EVALUATE THE EVALUATOR.
 *
 * Wave 3 / task P3.2 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4, implementing
 * RL-6 of docs/PERFORMANCE_REALISM_PLAN.md, verbatim:
 *
 *   "Evaluate the evaluator: track adjustment frequency, reversals, time
 *    outside budget, time spent unnecessarily degraded, prediction error and
 *    recovery time. Excessive oscillation or repeated ineffective actions
 *    disables exploratory upgrades and selects the last stable profile while
 *    protective downshifts remain active. A STABLE FRAME RATE WITH PERMANENTLY
 *    POOR QUALITY IS NOT SUCCESS: schedule occasional safe recovery probes."
 *
 * That last sentence is the anti-success, and it is the reason this module is
 * not optional: every other check in the programme is satisfied by a game
 * pinned to the bottom rung forever.
 *
 * ---------------------------------------------------------------------------
 * R4 — red-first form
 * ---------------------------------------------------------------------------
 *   node --test tests/loop-health.test.js                  # skipped
 *   BIRB_PERF_IMPL=1 node --test tests/loop-health.test.js  # red until P3.2 builds it
 *
 * ---------------------------------------------------------------------------
 * THE SURFACE THIS SUITE PINS
 * ---------------------------------------------------------------------------
 *   createLoopHealth({ now, constants, targetFPS })
 *   -> {
 *     frame({ frameIndex, tMs, dtMs, valid, rung, depth, budgetMs })
 *     recordAdjustment({ tMs, from, to, kind, reason })     // kind ∈ APPLY_KINDS
 *     recordPrediction({ id, tMs, predictedBenefitMs })
 *     resolvePrediction({ id, tMs, observedBenefitMs, verdict })
 *     metrics()   -> the six RL-6 quantities + oscillation + connectivity
 *     policy()    -> { exploratoryUpgradesEnabled, protectiveDownshiftsEnabled,
 *                      selectedRung, reason }
 *     probeDue(tMs) -> { due, reason, nextEligibleMs }
 *     snapshot()
 *   }
 *
 * NOTE WHAT `frame()` IS NOT GIVEN. It gets what the running game actually
 * has — a delivered interval, a validity flag and the rung READ BACK off the
 * world. It is not given the capacity model, because the phone does not have
 * one. Everything below is computable from that.
 *
 * THE DEFINITIONS, pinned so they cannot be quietly widened. All thresholds
 * are read from the injected constants table (src/game/perf-constants.js),
 * never inlined — Wave 4 retunes them in one place (CONTRACT §10 rule 2).
 *
 *   missed frame    dtMs > budgetMs                       (frame-metrics' own rule)
 *   overloaded      over the trailing constants.evaluationWindowMs of VALID
 *                   frames: p95 > budgetMs * constants.overloadP95Multiplier
 *                   OR missed% > constants.overloadMissedTargetPct.
 *                   p95 is the SHARED nearest-rank `percentile` from
 *                   src/game/frame-metrics.js — never a second implementation.
 *   timeOutsideBudgetMs        valid dtMs summed while overloaded.
 *   timeUnnecessarilyDegradedMs valid dtMs summed while rung > 0 and NOT
 *                   overloaded. On a 60 Hz panel a delivered interval can
 *                   never reveal headroom — 4 ms and 16 ms are presented
 *                   identically — so this is an upper bound, and the fact that
 *                   it is an upper bound is exactly why a bounded probe has to
 *                   exist at all.
 *   adjustmentsPerMinute  recorded adjustments over VALID observed time.
 *                   Paused time is excluded: a backgrounded tab must not make
 *                   a thrashing controller look calm.
 *   reversals / oscillation   `evaluateOscillation(changeLog, { observedMs })`
 *                   from src/game/frame-stats.js, called with observedMs = the
 *                   span of observed time (last fed tMs − first fed tMs).
 *   meanPredictionErrorMs  mean |predicted − observed| over RESOLVED
 *                   predictions only.
 *   recoveryTimeMs  from the frame the run became overloaded to the frame it
 *                   stopped being overloaded. A sentinel while still
 *                   overloaded, and a sentinel when it never was.
 *   stable          the trailing constants.restoreStabilityMinMs of valid
 *                   frames contain no overloaded window and no adjustment.
 *   last stable profile  the most recent rung held continuously for at least
 *                   constants.restoreStabilityMinMs with no adjustment and no
 *                   overloaded window inside that stretch.
 *   ineffective streak   consecutive resolved predictions whose verdict is
 *                   'inconclusive' or 'regression'; at
 *                   constants.candidateRevisionsPerExperiment (PRO-15,
 *                   "initially allow three candidate revisions per
 *                   experiment") exploratory upgrades are disabled.
 *   probeDue        rung > 0 AND stable AND no outstanding probe AND at least
 *                   constants.probeIntervalMs since the last probe (PRO-8).
 *                   Its `reason` is decided in a FIXED precedence, so two
 *                   correct implementations cannot disagree about which of two
 *                   simultaneous blockers to report:
 *                     'already-top' > 'probe-outstanding' > 'probe-too-soon' >
 *                     'unstable' > 'insufficient-samples' > 'stuck' (due).
 *
 * With NOTHING observed all six quantities are sentinels, including the two
 * accumulators: `timeOutsideBudgetMs === 0` before a single frame has been fed
 * is not a measurement of a healthy run, it is the absence of one. Once frames
 * have been observed the accumulators are numbers and a 0 is then real.
 *
 * Every unmeasured quantity renders CONTRACT §3.1's sentinel —
 * { value: null, state: 'unavailable', reason } — and never 0. A prediction
 * error of 0 with nothing resolved reads as a perfect predictor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVISIONAL, withConstants, budgetMs, TARGET_FPS } from '../src/game/perf-constants.js';
import { evaluateOscillation } from '../src/game/frame-stats.js';
import { buildScenario } from './fixtures/perf-traces/index.js';
import { runTrace, APPLY_KINDS } from './fixtures/perf-traces/driver.js';
import { createFixedPolicy } from './fixtures/perf-traces/reference-policies.js';
import { buildLadder } from './fixtures/perf-traces/ladder.js';

const MODULE = '../src/game/loop-health.js';
const K = PROVISIONAL;
const B = budgetMs(TARGET_FPS);

const IMPL = process.env.BIRB_PERF_IMPL
  ? false
  : 'BIRB_PERF_IMPL unset — src/game/loop-health.js is a Wave 3 deliverable (P3.2)';

async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 3 P3.2 must create it.\n` +
      `  Its surface is pinned at the top of tests/loop-health.test.js.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

const SENTINEL_REASONS = ['not-implemented', 'no-extension', 'no-context', 'not-webgl2',
  'disjoint', 'insufficient-samples', 'paused', 'not-applicable', 'stale'];

function assertSentinel(v, what) {
  assert.ok(v && typeof v === 'object', `${what} must be a CONTRACT §3.1 sentinel, got ${JSON.stringify(v)}`);
  assert.equal(v.value, null, `${what}: a sentinel's value is null — 0 is a measurement`);
  assert.equal(v.state, 'unavailable', `${what}: state must be "unavailable"`);
  assert.ok(SENTINEL_REASONS.includes(v.reason), `${what}: reason "${v.reason}" is outside the CONTRACT §3.1 enum`);
}

/**
 * Feed a stretch of frames. `dtMs` may be a number or a function of the index.
 * Returns the time it stopped at, so stretches compose.
 */
function feed(health, { fromMs, toMs, dtMs, rung, depth = 3, valid = true, cursor }) {
  const interval = typeof dtMs === 'function' ? dtMs : () => dtMs;
  let t = fromMs;
  let i = 0;
  while (t < toMs) {
    const dt = interval(i);
    health.frame({
      frameIndex: cursor.frameIndex, tMs: t, dtMs: dt, valid, rung, depth, budgetMs: B,
    });
    cursor.frameIndex += 1;
    cursor.lastMs = t;          // the last tMs actually delivered, for observedMs
    t += dt;
    i += 1;
  }
  return t;
}

const newCursor = () => ({ frameIndex: 0, lastMs: 0 });

/** Drive a real capacity trace and hand loop-health only what a phone has. */
function feedTrace(health, result) {
  for (const s of result.steps) {
    health.frame({
      frameIndex: s.frameIndex, tMs: s.tMs, dtMs: s.dtMs, valid: s.valid,
      rung: s.rung, depth: result.depth, budgetMs: result.budgetMs,
    });
  }
  for (const c of result.tierChangeLog) {
    health.recordAdjustment({ tMs: c.tMs, from: c.from, to: c.to, kind: c.kind, reason: c.reason });
  }
}

const clockFrom = (t0 = 0) => { const c = { t: t0, now: () => c.t }; return c; };

// ---------------------------------------------------------------------------
// LH-0 — the factory shape.
// REJECTS: a module that reads a wall clock or the renderer. CONTRACT §11.
// ---------------------------------------------------------------------------
test('LH-0 createLoopHealth takes its side effects as injected callbacks', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  assert.equal(typeof createLoopHealth, 'function');
  const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  for (const m of ['frame', 'recordAdjustment', 'recordPrediction', 'resolvePrediction', 'metrics', 'policy', 'probeDue', 'snapshot']) {
    assert.equal(typeof H[m], 'function', `loop-health must expose ${m}()`);
  }
});

// ---------------------------------------------------------------------------
// LH-1 — all six RL-6 quantities exist, and an unmeasured one is a sentinel.
// REJECTS: reporting 0 for what has not been measured. A mean prediction error
//          of 0 with nothing resolved reads as a perfect predictor, and a
//          recovery time of 0 reads as an instant recovery from an overload
//          that never happened. Both are the shipped `0`-as-sentinel defect
//          this contract was written against.
// ---------------------------------------------------------------------------
test('LH-1 the six tracked quantities are present and unmeasured ones are sentinels', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const m = H.metrics();
  for (const field of ['adjustmentsPerMinute', 'reversals', 'timeOutsideBudgetMs',
    'timeUnnecessarilyDegradedMs', 'meanPredictionErrorMs', 'recoveryTimeMs']) {
    assert.ok(field in m, `RL-6 names ${field} — a missing field is an untracked evaluator`);
  }
  assertSentinel(m.meanPredictionErrorMs, 'meanPredictionErrorMs with nothing resolved');
  assertSentinel(m.recoveryTimeMs, 'recoveryTimeMs with no overload observed');
  assertSentinel(m.adjustmentsPerMinute, 'adjustmentsPerMinute with no observed time');
  assertSentinel(m.reversals, 'reversals with an empty change log and no observed time');
  assertSentinel(m.timeOutsideBudgetMs, 'timeOutsideBudgetMs before a single frame — the absence of a measurement, not a healthy run');
  assertSentinel(m.timeUnnecessarilyDegradedMs, 'timeUnnecessarilyDegradedMs before a single frame');
});

// ---------------------------------------------------------------------------
// LH-2 — "outside budget" and "unnecessarily degraded" are different failures,
//         and the second one is the anti-success.
// REJECTS: an evaluator that scores "inside budget" as success. Driven by two
//          REAL capacity traces run against fixed reference profiles, so the
//          numbers come from the corpus rather than from this file's opinion.
// ---------------------------------------------------------------------------
test('LH-2 a degraded-but-smooth run scores as unnecessarily degraded, not as healthy', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();

  // (a) stuck-quality, pinned to the bottom rung: every rung fits, the panel
  //     shows a flat 60 for the whole run, and the game is ugly the entire time.
  const stuck = buildScenario('stuck-quality', K);
  const bottom = buildLadder(stuck.ladder, K).length - 1;
  const stuckRun = runTrace(stuck, { policy: createFixedPolicy(bottom), K });
  const Ha = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: stuckRun.targetFPS });
  feedTrace(Ha, stuckRun);
  const a = Ha.metrics();

  assert.equal(a.timeOutsideBudgetMs, 0,
    'nothing about this run is outside budget — a flat 60 for the whole session is exactly the trap');
  assert.ok(a.timeUnnecessarilyDegradedMs > stuckRun.observedMs / 2,
    `most of a stable run spent below the top rung is time unnecessarily degraded (got ${a.timeUnnecessarilyDegradedMs} of ${stuckRun.observedMs} ms)`);

  // (b) overload, pinned to the top rung: the mirror image.
  const overload = buildScenario('overload', K);
  const overRun = runTrace(overload, { policy: createFixedPolicy(0), K });
  const Hb = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: overRun.targetFPS });
  feedTrace(Hb, overRun);
  const b = Hb.metrics();

  assert.ok(b.timeOutsideBudgetMs > 0, 'the overload trace spends real time outside budget');
  assert.equal(b.timeUnnecessarilyDegradedMs, 0,
    'a run held at the top rung is never unnecessarily degraded — the two metrics must not be aliases of one another');
});

// ---------------------------------------------------------------------------
// LH-3 — oscillation comes from the SHARED helper.
// REJECTS: a second, hand-rolled reversal counter. CONTRACT §10 PRO-13 makes
//          oscillation a property of the CHANGE LOG evaluated by
//          evaluateOscillation, separate from the interval maths; two
//          implementations disagree at the boundary and the disagreement is
//          invisible until a device session.
// ---------------------------------------------------------------------------
test('LH-3 the oscillation verdict is frame-stats.evaluateOscillation, not a re-implementation', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const settle = K.oscillationSettleMs;
  const endMs = settle + K.oscillationWindowMs + K.evaluationWindowMs;

  // Exactly maxReversals, then one more: the boundary a re-implementation
  // gets wrong by one.
  for (const extra of [0, 1]) {
    const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
    const cursor = newCursor();
    feed(H, { fromMs: 0, toMs: endMs, dtMs: B, rung: 1, cursor });
    const observedMs = cursor.lastMs; // the span of observed time, first fed tMs being 0

    const log = [];
    let t = settle + K.evaluationWindowMs;
    let cur = 0;
    for (let i = 0; i < K.oscillationMaxReversals + 1 + extra; i += 1) {
      const next = cur === 0 ? 1 : 0;
      log.push({ tMs: t, from: cur, to: next, reason: 'synthetic', kind: next > cur ? 'downshift' : 'upshift' });
      cur = next;
      t += K.evaluationWindowMs;
    }
    for (const c of log) H.recordAdjustment(c);

    const expected = evaluateOscillation(log, { observedMs });
    const got = H.metrics().oscillation;
    assert.deepEqual(got, expected,
      `loop-health must call the shared evaluateOscillation (log of ${log.length} changes, observedMs ${observedMs})`);
  }
});

// ---------------------------------------------------------------------------
// LH-4 / LH-5 / LH-6 — what excessive oscillation must and must not do.
//
// LH-4 REJECTS: an evaluator that watches the controller thrash and changes
//               nothing, which is a report rather than a loop.
// LH-5 REJECTS: "oscillation detected, freeze everything" — which strands a
//               device in overload with no way to shed work. The plan is
//               explicit: "while PROTECTIVE DOWNSHIFTS REMAIN ACTIVE."
// LH-6 REJECTS: selecting the safest rung and calling it stable. That is
//               permanent degradation wearing an art department's clothes, and
//               it is the same anti-success as LH-2. The last stable profile
//               is a thing that was OBSERVED to be stable.
// ---------------------------------------------------------------------------
test('LH-4..6 excessive oscillation disables exploration, keeps protection, and selects the last STABLE profile', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const cursor = newCursor();

  const stableFromMs = K.evaluationWindowMs * 3;
  const stableToMs = stableFromMs + K.restoreStabilityMinMs * 1.5;

  // A brief overloaded opening at rung 0 ...
  feed(H, { fromMs: 0, toMs: stableFromMs, dtMs: B * 2, rung: 0, cursor });
  H.recordAdjustment({ tMs: stableFromMs, from: 0, to: 1, kind: 'downshift', reason: 'overload' });
  // ... a long, quiet, adjustment-free stretch at rung 1 — the last stable profile ...
  feed(H, { fromMs: stableFromMs, toMs: stableToMs, dtMs: B, rung: 1, cursor });
  // ... then a thrash between rung 1 and rung 2 that never settles.
  let t = stableToMs;
  let cur = 1;
  const thrashEndMs = K.oscillationSettleMs + K.oscillationWindowMs;
  while (t < thrashEndMs) {
    const next = cur === 1 ? 2 : 1;
    H.recordAdjustment({ tMs: t, from: cur, to: next, kind: next > cur ? 'downshift' : 'upshift', reason: 'thrash' });
    cur = next;
    t = feed(H, { fromMs: t, toMs: t + K.evaluationWindowMs / 2, dtMs: B, rung: cur, cursor });
  }
  // End on a rung that is NOT the stable one, so "the last stable profile" and
  // "wherever we happen to be standing" cannot be the same answer.
  if (cur !== 2) {
    H.recordAdjustment({ tMs: t, from: cur, to: 2, kind: 'downshift', reason: 'thrash' });
    cur = 2;
    t = feed(H, { fromMs: t, toMs: t + K.evaluationWindowMs / 2, dtMs: B, rung: cur, cursor });
  }

  const p = H.policy();
  assert.equal(p.exploratoryUpgradesEnabled, false, 'LH-4: excessive oscillation disables exploratory upgrades');
  assert.equal(p.protectiveDownshiftsEnabled, true, 'LH-5: protective downshifts remain active — a device in overload still needs them');
  assert.equal(p.selectedRung, 1,
    `LH-6: the last stable profile is rung 1 — held for ${K.restoreStabilityMinMs * 1.5} ms with no adjustment and no overload. ` +
    `The current rung is ${cur} and the cheapest rung visited is 2; neither is evidence of stability.`);
});

// ---------------------------------------------------------------------------
// LH-7 — repeated ineffective actions also disable exploration.
// REJECTS: an implementation that reads only the change log. The plan says
//          "excessive oscillation OR REPEATED INEFFECTIVE ACTIONS", and a
//          controller can probe the same useless upgrade forever without ever
//          producing a reversal.
// ---------------------------------------------------------------------------
test('LH-7 a streak of ineffective probes disables exploration, one short of it does not', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const streak = K.candidateRevisionsPerExperiment;
  assert.ok(streak >= 2, 'PRO-15 as imported');

  for (const [count, expected] of [[streak - 1, true], [streak, false]]) {
    const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
    const cursor = newCursor();
    let t = 0;
    for (let i = 0; i < count; i += 1) {
      t = feed(H, { fromMs: t, toMs: t + K.probeIntervalMs, dtMs: B, rung: 1, cursor });
      H.recordAdjustment({ tMs: t, from: 1, to: 0, kind: 'probe', reason: 'headroom probe' });
      H.recordPrediction({ id: `p${i}`, tMs: t, predictedBenefitMs: 1.5 });
      H.resolvePrediction({ id: `p${i}`, tMs: t + K.settleHoldMs, observedBenefitMs: 0, verdict: 'inconclusive' });
      H.recordAdjustment({ tMs: t + K.settleHoldMs, from: 0, to: 1, kind: 'probe-rollback', reason: 'inconclusive' });
    }
    assert.equal(H.policy().exploratoryUpgradesEnabled, expected,
      `${count} consecutive ineffective probes: exploration should be ${expected ? 'still enabled' : 'disabled'} (PRO-15 = ${streak})`);
  }
});

// ---------------------------------------------------------------------------
// LH-8 — THE ANTI-SUCCESS. "A stable frame rate with permanently poor quality
//        is not success: schedule occasional safe recovery probes."
// REJECTS: both failure modes at once — a probe that is never due (the game
//          stays ugly for the rest of the session, and every other check in
//          the programme is still green), and a probe that is always due
//          (which is the thrash this module exists to damp).
// ---------------------------------------------------------------------------
test('LH-8 stable-and-degraded schedules a recovery probe; stable-and-top does not', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const runMs = K.restoreStabilityMinMs * 2;

  const degraded = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const endA = feed(degraded, { fromMs: 0, toMs: runMs, dtMs: B, rung: 2, cursor: newCursor() });
  const dueA = degraded.probeDue(endA);
  assert.equal(dueA.due, true,
    'a flat 60 at the bottom rung is exactly the state that no overload rule will ever fire on — without a deliberate probe it lasts the whole session');
  assert.equal(dueA.reason, 'stuck');

  const top = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const endB = feed(top, { fromMs: 0, toMs: runMs, dtMs: B, rung: 0, cursor: newCursor() });
  const dueB = top.probeDue(endB);
  assert.equal(dueB.due, false, 'there is nothing above the top rung to recover to');
  assert.equal(dueB.reason, 'already-top');

  const unstable = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const endC = feed(unstable, { fromMs: 0, toMs: runMs, dtMs: B * 2, rung: 2, cursor: newCursor() });
  const dueC = unstable.probeDue(endC);
  assert.equal(dueC.due, false, 'a device that is still missing frames is not a device to go probing on');
  assert.equal(dueC.reason, 'unstable');
});

// ---------------------------------------------------------------------------
// LH-9 — the probe budget is PRO-8's, imported.
// REJECTS: unbounded exploration, and an inlined 30 s that Wave 4's retune
//          leaves behind.
// ---------------------------------------------------------------------------
test('LH-9 one outstanding probe, and at most one per constants.probeIntervalMs', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const cursor = newCursor();
  let t = feed(H, { fromMs: 0, toMs: K.restoreStabilityMinMs * 2, dtMs: B, rung: 2, cursor });
  assert.equal(H.probeDue(t).due, true);

  H.recordAdjustment({ tMs: t, from: 2, to: 1, kind: 'probe', reason: 'recovery probe' });
  assert.equal(H.probeDue(t).due, false, 'one outstanding probe (PRO-8)');
  assert.equal(H.probeDue(t).reason, 'probe-outstanding');

  const settleEnd = feed(H, { fromMs: t, toMs: t + K.settleHoldMs, dtMs: B, rung: 1, cursor });
  H.recordAdjustment({ tMs: settleEnd, from: 1, to: 1, kind: 'probe-keep', reason: 'held up' });
  const soon = H.probeDue(settleEnd);
  assert.equal(soon.due, false, 'the probe resolved, but the rate limit has not elapsed');
  assert.equal(soon.reason, 'probe-too-soon',
    'the rate limit outranks the stability check in the fixed precedence at the top of this file — a just-probed run is also not yet "stable", and two correct implementations must not be free to disagree about which blocker to name');
  assert.ok(soon.nextEligibleMs >= t + K.probeIntervalMs,
    'the next eligible time is one PRO-8 interval after the probe, read from the constants table');

  const later = feed(H, { fromMs: settleEnd, toMs: t + K.probeIntervalMs + K.restoreStabilityMinMs, dtMs: B, rung: 1, cursor });
  assert.equal(H.probeDue(later).due, true, 'after the interval, a stable degraded run is probeable again');
});

// ---------------------------------------------------------------------------
// LH-10 — recovery time is measured, and is a sentinel while unrecovered.
// REJECTS: reporting 0 during an ongoing overload, which is the single most
//          flattering number this module could produce and is indistinguishable
//          from an instant recovery.
// ---------------------------------------------------------------------------
test('LH-10 recovery time is a sentinel while still overloaded and a duration once recovered', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const cursor = newCursor();
  const W = K.evaluationWindowMs;

  let t = feed(H, { fromMs: 0, toMs: 4 * W, dtMs: B, rung: 0, cursor });
  const overloadStart = t;
  t = feed(H, { fromMs: t, toMs: t + 4 * W, dtMs: B * 2, rung: 0, cursor });
  assertSentinel(H.metrics().recoveryTimeMs, 'recoveryTimeMs during an ongoing overload');

  H.recordAdjustment({ tMs: t, from: 0, to: 1, kind: 'downshift', reason: 'overload' });
  t = feed(H, { fromMs: t, toMs: t + 6 * W, dtMs: B, rung: 1, cursor });
  const recovery = H.metrics().recoveryTimeMs;

  assert.equal(typeof recovery, 'number', 'once the run is back inside budget, recovery time is a measured duration');
  const trueSpanMs = 4 * W;
  assert.ok(Math.abs(recovery - trueSpanMs) <= 2 * W,
    `recovery time must match the observed overload span within the detection window (span ${trueSpanMs} ms, reported ${recovery} ms)`);
});

// ---------------------------------------------------------------------------
// LH-11 — prediction error aggregates RESOLVED predictions only.
// REJECTS: counting an outstanding prediction as either a zero error (a
//          flattering lie) or a full-magnitude error (a punishing one). Neither
//          is a measurement; the prediction has not been scored yet.
// ---------------------------------------------------------------------------
test('LH-11 an outstanding prediction contributes nothing to prediction error', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const cursor = newCursor();
  const t = feed(H, { fromMs: 0, toMs: K.evaluationWindowMs * 4, dtMs: B, rung: 1, cursor });

  H.recordPrediction({ id: 'a', tMs: t, predictedBenefitMs: 2.0 });
  H.resolvePrediction({ id: 'a', tMs: t + K.settleHoldMs, observedBenefitMs: 1.0, verdict: 'benefit' });
  H.recordPrediction({ id: 'b', tMs: t + K.settleHoldMs, predictedBenefitMs: 9.0 }); // never resolved

  const m = H.metrics();
  assert.equal(typeof m.meanPredictionErrorMs, 'number');
  assert.ok(Math.abs(m.meanPredictionErrorMs - 1.0) < 1e-6,
    `mean |predicted - observed| over resolved predictions is 1.0; got ${m.meanPredictionErrorMs} (an outstanding 9.0 must not be scored)`);
});

// ---------------------------------------------------------------------------
// LH-12 — adjustment frequency is measured over VALID time.
// REJECTS: dividing by wall-clock time, so a session spent half backgrounded
//          reports half the churn it actually produced. CONTRACT §2.2: paused
//          samples are excluded from adaptive decisions and retained in
//          evidence.
// ---------------------------------------------------------------------------
test('LH-12 paused time is excluded from adjustment frequency', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const H = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const cursor = newCursor();
  const activeMs = K.evaluationWindowMs * 12;

  let t = feed(H, { fromMs: 0, toMs: activeMs / 2, dtMs: B, rung: 0, cursor });
  H.recordAdjustment({ tMs: t, from: 0, to: 1, kind: 'downshift', reason: 'overload' });
  // A stretch of hidden-tab frames: real data about the resume path, and not
  // time in which the controller was deciding anything.
  t = feed(H, { fromMs: t, toMs: t + activeMs, dtMs: 900, rung: 1, valid: false, cursor });
  t = feed(H, { fromMs: t, toMs: t + activeMs / 2, dtMs: B, rung: 1, cursor });
  H.recordAdjustment({ tMs: t, from: 1, to: 0, kind: 'upshift', reason: 'recovered' });

  const m = H.metrics();
  const perMinuteOverValid = 2 / (activeMs / 60000);
  const perMinuteOverWall = 2 / ((activeMs * 2) / 60000);
  assert.ok(Math.abs(m.adjustmentsPerMinute - perMinuteOverValid) < perMinuteOverValid * 0.2,
    `adjustments per minute must be measured over valid observed time (expected about ${perMinuteOverValid}, got ${m.adjustmentsPerMinute})`);
  assert.ok(m.adjustmentsPerMinute > perMinuteOverWall * 1.5,
    'a backgrounded tab must not make a thrashing controller look calm');
});

// ---------------------------------------------------------------------------
// LH-13 — connectivity: the 4 Hz cadence bug is visible from inside.
// REJECTS: the defect this repo actually shipped — the adaptive controller fed
//          from a 250 ms window sampler rather than per frame, so it decided on
//          averages of averages and percentiles over it were meaningless
//          (CONTRACT §1.3). G3b asks for exactly this check: "samplesObserved
//          within an order of magnitude of frames rendered".
// ---------------------------------------------------------------------------
test('LH-13 a controller fed at the 250 ms cadence reports itself as cadence-suspect', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const runMs = K.evaluationWindowMs * 20;

  const perFrame = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const cursor = newCursor();
  feed(perFrame, { fromMs: 0, toMs: runMs, dtMs: B, rung: 0, cursor });
  const good = perFrame.metrics();
  assert.equal(good.cadenceSuspect, false);
  assert.ok(Math.abs(good.samplesObserved - good.framesObserved) <= 1,
    'fed per frame, samples and frames agree');

  // The shipped path: one call per 250 ms window, frameIndex advancing by the
  // frames that really happened in between.
  const throttled = createLoopHealth({ now: clockFrom().now, constants: K, targetFPS: TARGET_FPS });
  const perWindow = Math.round(K.compatSampleWindowMs / B);
  let frameIndex = 0;
  for (let t = 0; t < runMs; t += K.compatSampleWindowMs) {
    frameIndex += perWindow;
    throttled.frame({ frameIndex, tMs: t, dtMs: K.compatSampleWindowMs, valid: true, rung: 0, depth: 3, budgetMs: B });
  }
  const bad = throttled.metrics();
  assert.ok(bad.framesObserved > bad.samplesObserved * 10,
    'the fixture must really be an order of magnitude short, or this row proves nothing');
  assert.equal(bad.cadenceSuspect, true,
    'a controller that sees one sample per fifteen frames must say so rather than report percentiles over averages');
});

// ---------------------------------------------------------------------------
// LH-14 — thresholds come from the injected table.
// REJECTS: numbers written into the module. Wave 4 retunes PROVISIONAL in one
//          place and every deadline, window and rate limit must move with it —
//          the 55/58 thresholds were tuned against a sampler that could not
//          run, and the whole point of §10 is that this cannot happen twice.
// ---------------------------------------------------------------------------
test('LH-14 retuning the constants table moves the probe rate limit', { skip: IMPL }, async () => {
  const { createLoopHealth } = await load();
  const retuned = withConstants({ probeIntervalMs: K.probeIntervalMs * 2 });
  const H = createLoopHealth({ now: clockFrom().now, constants: retuned, targetFPS: TARGET_FPS });
  const cursor = newCursor();

  let t = feed(H, { fromMs: 0, toMs: retuned.restoreStabilityMinMs * 2, dtMs: B, rung: 2, cursor });
  H.recordAdjustment({ tMs: t, from: 2, to: 1, kind: 'probe', reason: 'recovery probe' });
  H.recordAdjustment({ tMs: t, from: 1, to: 1, kind: 'probe-keep', reason: 'held up' });
  const probedAt = t;

  t = feed(H, { fromMs: t, toMs: t + K.probeIntervalMs + K.restoreStabilityMinMs, dtMs: B, rung: 1, cursor });
  assert.equal(H.probeDue(t).due, false,
    'under the retuned table the original interval is no longer enough — a module with 30000 written into it would say due');
  assert.ok(H.probeDue(t).nextEligibleMs >= probedAt + retuned.probeIntervalMs);

  t = feed(H, { fromMs: t, toMs: probedAt + retuned.probeIntervalMs + K.evaluationWindowMs, dtMs: B, rung: 1, cursor });
  assert.equal(H.probeDue(t).due, true);
  assert.ok(APPLY_KINDS.includes('probe-keep'), 'the kinds are the driver\'s closed set, not a second vocabulary');
});
