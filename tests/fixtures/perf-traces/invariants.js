/**
 * tests/fixtures/perf-traces/invariants.js — what a run of a trace has to show.
 *
 * Wave 3 / P3.1.
 *
 * Every function takes a result from ./driver.js and returns
 * `{ id, pass, message, detail }`. Nothing throws: a test asserts on `pass`
 * and prints `message`, so one failing scenario reports its own diagnosis
 * instead of an assertion stack.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THIS FILE OBEYS
 * ---------------------------------------------------------------------------
 * 1. **Percentiles and oscillation come from the SHARED modules.**
 *    `src/game/frame-metrics.js` owns `percentile`; `src/game/frame-stats.js`
 *    owns `evaluateAcceptanceGates` and `evaluateOscillation`. Nothing here
 *    recomputes any of them. docs/perf/gates/G2a.md §4.1: "the value the
 *    controller fires on and the value the acceptance gate scores must be
 *    computed by the same module, or the loop is closed against itself."
 *
 * 2. **No inlined thresholds.** Every deadline below is arithmetic on the
 *    PROVISIONAL table (CONTRACT §10 rule 1). A Wave 4 pass that halves
 *    PRO-3 tightens every deadline in the corpus automatically; nothing here
 *    has to be edited, and nothing here silently keeps the old number.
 */

import { evaluateAcceptanceGates, evaluateOscillation } from '../../../src/game/frame-stats.js';
import { PROVISIONAL } from '../../../src/game/perf-constants.js';

const ok = (id, message, detail) => ({ id, pass: true, message, detail });
const bad = (id, message, detail) => ({ id, pass: false, message, detail });

/**
 * The deadline for reacting to overload, derived rather than chosen.
 *
 * PRO-2 declares overload only after `overloadWindowCount` consecutive
 * evaluation windows. The controller cannot know it is in overload before
 * those windows have closed, and the first window can begin up to one window
 * late relative to onset. One further window is allowed for the decision and
 * its application, and PRO-6's settle hold is added because a controller that
 * has just adjusted is entitled to wait before adjusting again.
 */
export function overloadResponseDeadlineMs(K = PROVISIONAL) {
  return K.evaluationWindowMs * (K.overloadWindowCount + 2) + K.settleHoldMaxMs;
}

/** All applies after `tMs` whose kind is in `kinds`. */
export function appliesAfter(result, tMs, kinds = null) {
  return result.applies.filter((a) => !a.rejected && a.tMs >= tMs && (!kinds || kinds.includes(a.kind)));
}

/** The rung in force at time `tMs` (the last step at or before it). */
export function rungAt(result, tMs) {
  let r = result.startProfile.effective;
  for (const s of result.steps) {
    if (s.tMs > tMs) break;
    r = s.rung;
  }
  return r;
}

/* -------------------------------------------------------------------------- *
 * INV-1  no contract violations
 * -------------------------------------------------------------------------- */
export function noViolations(result, { codes = null } = {}) {
  const hits = codes ? result.violations.filter((v) => codes.includes(v.code)) : result.violations;
  if (hits.length === 0) return ok('INV-1', 'no contract violations recorded by the driver');
  return bad('INV-1',
    `${hits.length} contract violation(s):\n` +
    hits.map((v) => `    [${Math.round(v.tMs)}ms] ${v.code}: ${v.detail}`).join('\n'),
    hits);
}

/* -------------------------------------------------------------------------- *
 * INV-2  bounded response to overload
 *   SM step 2 / RL step 4 ("Emergency recovery takes priority while severe
 *   overload persists") and the plan's own required regression list:
 *   "Require bounded response".
 * -------------------------------------------------------------------------- */
export function boundedResponse(result, {
  onsetMs, K = PROVISIONAL, deadlineMs = null,
  // Where to start LOOKING for the reduction, and which rung counts as
  // "before". Both default to the onset, which is right for a step change in
  // capacity. They are separate parameters because of `delayed-regression`,
  // where capacity drifts continuously: a controller that reacts to the drift
  // slightly EARLY — which is better behaviour, not worse — would otherwise
  // have its own reduction counted as the baseline it then failed to beat.
  searchFromMs = null, baselineAtMs = null,
} = {}) {
  const deadline = onsetMs + (deadlineMs ?? overloadResponseDeadlineMs(K));
  const from = searchFromMs ?? onsetMs;
  const baseline = rungAt(result, baselineAtMs ?? onsetMs);
  const reductions = appliesAfter(result, from, ['downshift', 'emergency'])
    .filter((a) => a.effectiveRung > baseline);
  const first = reductions.find((a) => a.tMs <= deadline);
  if (first) {
    return ok('INV-2', `reduced quality from rung ${baseline} to ${first.effectiveRung} at ${Math.round(first.tMs)} ms (onset ${Math.round(onsetMs)} ms, deadline ${Math.round(deadline)} ms)`, first);
  }
  return bad('INV-2',
    `no quality reduction below rung ${baseline} between ${Math.round(from)} ms and the deadline at ${Math.round(deadline)} ms ` +
    `(overload onset ${Math.round(onsetMs)} ms). ` +
    `Applies in that span: ${JSON.stringify(appliesAfter(result, from).filter((a) => a.tMs <= deadline).map((a) => `${a.kind}->${a.effectiveRung}@${Math.round(a.tMs)}`))}. ` +
    `time outside budget = ${Math.round(result.metrics.timeOutsideBudgetMs)} ms of ${Math.round(result.metrics.validMs)} ms.`);
}

/* -------------------------------------------------------------------------- *
 * INV-3  the run actually gets back inside budget and stays there
 * -------------------------------------------------------------------------- */
/**
 * How long a controller is entitled to sit on a rung it is TESTING. A probe is
 * a deliberate, bounded excursion into a setting that may not fit — that is the
 * whole content of "without GPU timing use occasional bounded probes" — so the
 * time inside one cannot be scored as a failure to settle. The bound is the
 * judging window plus one settle hold, all from PROVISIONAL.
 */
export function probeJudgeWindowMs(K = PROVISIONAL) {
  return K.evaluationWindowMs * (K.overloadWindowCount + 1) + K.settleHoldMaxMs;
}

/**
 * The spans during which an upgrade probe was outstanding: from the `probe`
 * apply to whatever resolved it, capped at probeJudgeWindowMs so an
 * unresolved probe does not buy unlimited amnesty.
 */
export function probeSpans(result, K = PROVISIONAL) {
  const cap = probeJudgeWindowMs(K);
  const spans = [];
  for (let i = 0; i < result.applies.length; i += 1) {
    const a = result.applies[i];
    if (a.rejected || a.kind !== 'probe') continue;
    let end = a.tMs + cap;
    for (let j = i + 1; j < result.applies.length; j += 1) {
      const b = result.applies[j];
      if (b.rejected) continue;
      if (b.kind === 'probe-keep' || b.kind === 'probe-rollback' || b.kind === 'downshift' || b.kind === 'emergency') {
        end = Math.min(end, b.tMs);
        break;
      }
    }
    spans.push({ fromMs: a.tMs, toMs: end });
  }
  return spans;
}

export function settlesInsideBudget(result, { fromMs, toleranceMs = null, K = PROVISIONAL, allowProbes = true } = {}) {
  const tol = toleranceMs ?? K.evaluationWindowMs;
  const spans = allowProbes ? probeSpans(result, K) : [];
  const inProbe = (t) => spans.some((s) => t >= s.fromMs && t <= s.toMs);
  let outside = 0;
  let excused = 0;
  let total = 0;
  for (const s of result.steps) {
    if (s.tMs < fromMs || !s.valid) continue;
    total += s.dtMs;
    if (s.capacity[s.rung] > result.budgetMs + 1e-9) {
      if (inProbe(s.tMs)) excused += s.dtMs; else outside += s.dtMs;
    }
  }
  if (total === 0) return bad('INV-3', `no valid frames after ${fromMs} ms`);
  const note = excused > 0 ? ` (a further ${Math.round(excused)} ms was inside ${spans.length} bounded probe(s), which is what a probe is for)` : '';
  if (outside <= tol) return ok('INV-3', `only ${Math.round(outside)} ms outside budget after ${fromMs} ms, tolerance ${Math.round(tol)} ms${note}`);
  return bad('INV-3',
    `${Math.round(outside)} ms of ${Math.round(total)} ms after ${fromMs} ms was spent at a rung whose sustainable cost ` +
    `exceeds B=${result.budgetMs.toFixed(2)} ms, outside any bounded probe; tolerance is ${Math.round(tol)} ms${note}`);
}

/* -------------------------------------------------------------------------- *
 * INV-4  eventual recovery when capacity returns
 *   The plan's named regression: "eventual recovery when capacity returns".
 *   This is the one a fixed interval replay structurally cannot express.
 * -------------------------------------------------------------------------- */
export function eventualRecovery(result, { fromMs, toRungAtMost = 0, byMs = null, K = PROVISIONAL } = {}) {
  const deadline = byMs ?? (fromMs + K.restoreStabilityMaxMs + K.evaluationWindowMs * 2);
  const before = rungAt(result, fromMs);
  const after = rungAt(result, Math.min(deadline, result.observedMs));
  if (after <= toRungAtMost) {
    return ok('INV-4', `recovered from rung ${before} to rung ${after} by ${Math.round(Math.min(deadline, result.observedMs))} ms`);
  }
  return bad('INV-4',
    `capacity returned at ${fromMs} ms and the controller was still on rung ${after} (wanted <= ${toRungAtMost}) at ${Math.round(deadline)} ms. ` +
    `Rung was ${before} when capacity returned. Upshifts/probes since: ` +
    `${JSON.stringify(appliesAfter(result, fromMs, ['upshift', 'probe']).map((a) => `${a.kind}->${a.effectiveRung}@${Math.round(a.tMs)}`))}. ` +
    'A stable frame rate with permanently poor quality is not success.');
}

/* -------------------------------------------------------------------------- *
 * INV-5  no persistent oscillation  (ACC-4 / PRO-13, via the SHARED evaluator)
 * -------------------------------------------------------------------------- */
export function noPersistentOscillation(result, { K = PROVISIONAL } = {}) {
  const verdict = evaluateOscillation(result.tierChangeLog, {
    settleMs: K.oscillationSettleMs,
    windowMs: K.oscillationWindowMs,
    maxReversals: K.oscillationMaxReversals,
    observedMs: result.observedMs,
  });
  if (verdict.state === 'unavailable') {
    return bad('INV-5',
      `evaluateOscillation returned the sentinel (${verdict.reason}): the run is ${Math.round(result.observedMs)} ms, ` +
      `and PRO-13 needs at least settle(${K.oscillationSettleMs}) + window(${K.oscillationWindowMs}) = ` +
      `${K.oscillationSettleMs + K.oscillationWindowMs} ms. Lengthen the scenario rather than lowering the bar.`,
      verdict);
  }
  if (verdict.pass) return ok('INV-5', `${verdict.reversals} direction reversal(s) in the settled window (max ${K.oscillationMaxReversals})`, verdict);
  return bad('INV-5',
    `${verdict.reversals} direction reversals between ${verdict.window.startMs} and ${verdict.window.endMs} ms; ` +
    `PRO-13 allows fewer than ${K.oscillationMaxReversals}. Changes: ` +
    `${JSON.stringify(result.tierChangeLog.map((c) => `${c.from}->${c.to}@${Math.round(c.tMs)}`))}`,
    verdict);
}

/* -------------------------------------------------------------------------- *
 * INV-6  the acceptance gates  (ACC-1..3, via the SHARED evaluator)
 * -------------------------------------------------------------------------- */
export function acceptanceGates(result, { require: required = ['ACC-1', 'ACC-2'], K = PROVISIONAL } = {}) {
  const report = evaluateAcceptanceGates(result.samples, { targetFPS: result.targetFPS });
  const failures = [];
  for (const id of required) {
    const g = report.gates[id];
    if (!g || g.state === 'unavailable') { failures.push(`${id}: ${g ? g.reason : 'missing'}`); continue; }
    if (!g.pass) failures.push(`${id}: value ${typeof g.value === 'number' ? g.value.toFixed(2) : g.value} vs threshold ${g.threshold}`);
  }
  if (failures.length === 0) {
    return ok('INV-6', `acceptance gates ${required.join(', ')} pass (p95 ${Number(report.p95).toFixed(2)} ms vs PRO-10 ${K.acceptanceP95MaxMs})`, report);
  }
  return bad('INV-6', `acceptance gate failures: ${failures.join('; ')}`, report);
}

/* -------------------------------------------------------------------------- *
 * INV-7  bounded exploration  (PRO-8)
 * -------------------------------------------------------------------------- */
export function boundedProbes(result, { K = PROVISIONAL } = {}) {
  // 'unlabelled-probe' is here because of G3o BLOCKER 2: without it this
  // invariant filtered for a label the controller volunteers, so a policy that
  // climbed with kind:'upshift' scored ZERO probes and passed vacuously.
  const v = noViolations(result, { codes: ['probe-overlap', 'probe-too-soon', 'probe-resolution-without-probe', 'unlabelled-probe'] });
  if (!v.pass) return { ...v, id: 'INV-7' };
  const probes = result.applies.filter((a) => a.kind === 'probe' && !a.rejected);
  return ok('INV-7', `${probes.length} upgrade probe(s), each at least ${K.probeIntervalMs} ms apart and never overlapping`, probes);
}

/* -------------------------------------------------------------------------- *
 * INV-8  permanent degradation is the named anti-success
 *   RL-6: "A stable frame rate with permanently poor quality is not success:
 *   schedule occasional safe recovery probes."
 * -------------------------------------------------------------------------- */
export function attemptsRecoveryWhenStuck(result, { afterMs, K = PROVISIONAL, byMs = null } = {}) {
  const deadline = byMs ?? (afterMs + K.restoreStabilityMaxMs + K.probeIntervalMs + K.evaluationWindowMs * 2);
  const attempts = result.applies.filter((a) => !a.rejected && a.tMs >= afterMs && a.tMs <= deadline && (a.kind === 'probe' || a.kind === 'upshift'));
  if (attempts.length > 0) {
    return ok('INV-8', `${attempts.length} recovery attempt(s) after ${afterMs} ms; first at ${Math.round(attempts[0].tMs)} ms (${attempts[0].kind})`, attempts);
  }
  return bad('INV-8',
    `stable and degraded from ${afterMs} ms with no upgrade probe by ${Math.round(deadline)} ms. ` +
    `Final rung ${result.finalRung}; the capacity model says rung ${result.steps.length ? result.steps[result.steps.length - 1].feasibleRung : '?'} would have fitted. ` +
    'Permanent degradation is the plan\'s named anti-success.');
}

/* -------------------------------------------------------------------------- *
 * INV-9  a failed upgrade is rolled back and its retry cooldown lengthened
 *   RL-4: "Roll back ineffective reductions and failed upgrades."
 *   SM-3:  "If an upgrade regresses, roll back and lengthen its retry cooldown."
 * -------------------------------------------------------------------------- */
export function failedProbeRollsBack(result, { K = PROVISIONAL, withinMs = null } = {}) {
  const window = withinMs ?? (K.evaluationWindowMs * (K.overloadWindowCount + 1) + K.settleHoldMaxMs);
  const probes = result.applies.filter((a) => a.kind === 'probe' && !a.rejected);
  if (probes.length === 0) {
    return bad('INV-9', 'no upgrade probe was ever attempted, so nothing could be rolled back — see INV-8');
  }
  const problems = [];
  for (const probe of probes) {
    const infeasible = result.steps.some((s) => s.tMs >= probe.tMs && s.tMs <= probe.tMs + window && s.rung === probe.effectiveRung && s.capacity[s.rung] > result.budgetMs + 1e-9);
    if (!infeasible) continue;   // that probe genuinely fitted; nothing to roll back
    const rollback = result.applies.find((a) => !a.rejected && a.tMs > probe.tMs && a.tMs <= probe.tMs + window && (a.kind === 'probe-rollback' || (a.kind === 'downshift' && a.effectiveRung > probe.effectiveRung)));
    if (!rollback) {
      problems.push(`probe to rung ${probe.effectiveRung} at ${Math.round(probe.tMs)} ms did not fit and was not rolled back within ${Math.round(window)} ms`);
    }
  }
  if (problems.length === 0) return ok('INV-9', `every failed probe was rolled back within ${Math.round(window)} ms`, probes);
  return bad('INV-9', problems.join('; '));
}

/* -------------------------------------------------------------------------- *
 * INV-10  a recurrent gameplay hitch survives a boundary reset
 *   CONTRACT §2.1 rule 1: a reset "does not clear the action history, the
 *   evidence record, or the recurrent-hitch log."
 *   Checked in the DATA (the spikes are untagged, so ACC-3 still sees them)
 *   and behaviourally (the controller still responds despite the resets).
 * -------------------------------------------------------------------------- */
export function recurrentHitchesRemainUnexplained(result, { atLeast = 3, K = PROVISIONAL } = {}) {
  const report = evaluateAcceptanceGates(result.samples, { targetFPS: result.targetFPS });
  const spikes = typeof report.unexplainedSpikes === 'number' ? report.unexplainedSpikes : -1;
  if (spikes >= atLeast) {
    return ok('INV-10', `${spikes} unexplained spike(s) > ${K.acceptanceSpikeMs} ms survive the tagged boundaries`, report);
  }
  return bad('INV-10',
    `only ${spikes} unexplained spike(s) > ${K.acceptanceSpikeMs} ms in the export, expected at least ${atLeast}. ` +
    'A boundary reset that swallows the recurrent gameplay hitch is exactly what CONTRACT §2.1 rule 1 forbids: ' +
    'tags EXPLAIN spikes, validity EXCLUDES samples, and neither may DELETE one.',
    report);
}

/* -------------------------------------------------------------------------- *
 * INV-11  the cold-start profile is clamped to the approved range
 *   RL-5: "All runtime learning is local, deterministic and restricted to
 *   approved settings ranges."
 * -------------------------------------------------------------------------- */
export function startProfileClamped(result) {
  const v = result.violations.filter((x) => x.code === 'out-of-range-rung' || x.code === 'non-integer-rung');
  if (v.length === 0) {
    return ok('INV-11', `start profile ${JSON.stringify(result.startProfile)} was clamped by the controller before it reached apply()`);
  }
  return bad('INV-11',
    `the controller passed an out-of-range profile straight through to apply(): ` +
    v.map((x) => `[${Math.round(x.tMs)}ms] ${x.detail}`).join('; '));
}

/* -------------------------------------------------------------------------- *
 * INV-12  instrumentation must not be free, and must not be the bottleneck
 *   "Measure with telemetry and the panel both enabled and disabled so
 *    instrumentation does not manufacture the bottleneck."
 * -------------------------------------------------------------------------- */
export function instrumentationPair(pair) {
  const { off, on } = pair;
  const detail = {
    offMeanCpuMs: off.metrics.meanCpuMs,
    onMeanCpuMs: on.metrics.meanCpuMs,
    offFrames: off.frames,
    onFrames: on.frames,
  };
  if (!(on.metrics.meanCpuMs > off.metrics.meanCpuMs)) {
    return bad('INV-12',
      `panel-on mean CPU ${on.metrics.meanCpuMs.toFixed(3)} ms is not strictly greater than panel-off ` +
      `${off.metrics.meanCpuMs.toFixed(3)} ms. Either the panel costs nothing (in which case it is not being ` +
      'measured) or the two arms did not run the same capacity model.', detail);
  }
  return ok('INV-12',
    `panel-on mean CPU ${on.metrics.meanCpuMs.toFixed(3)} ms > panel-off ${off.metrics.meanCpuMs.toFixed(3)} ms ` +
    `(+${((on.metrics.meanCpuMs / off.metrics.meanCpuMs - 1) * 100).toFixed(1)}%)`, detail);
}

/**
 * INV-13  the decision itself must not change when the panel is open.
 * The pair's whole purpose: if the controller ends up somewhere different
 * merely because it was being watched, every measurement taken with the panel
 * open is about the panel.
 */
export function instrumentationDoesNotChangeTheDecision(pair, { toleranceRungs = 0 } = {}) {
  const { off, on } = pair;
  const delta = Math.abs(on.finalRung - off.finalRung);
  if (delta <= toleranceRungs) {
    return ok('INV-13', `both arms finished on rung ${off.finalRung}/${on.finalRung}`);
  }
  return bad('INV-13',
    `panel-off finished on rung ${off.finalRung}, panel-on on rung ${on.finalRung}. ` +
    'Instrumentation changed the outcome, so every number taken with the panel open describes the panel.');
}

/* -------------------------------------------------------------------------- *
 * INV-14  adaptation earns its overhead — the holdout's core check.
 *   DL: "Compare Auto with the current controller and fixed reference profiles
 *   to verify that adaptation earns its overhead."
 *
 *   Threshold-free by construction: the controller fails only if some FIXED
 *   profile is at least as good on BOTH of the plan's own evaluator metrics
 *   (time outside budget, time spent unnecessarily degraded) and strictly
 *   better on one. That is Pareto domination — no weights, no invented
 *   trade-off, and it is exactly the question "was adapting worth it".
 *
 *   The tolerance is one evaluation window (PRO-3), so a tie decided by a
 *   single window is not a failure.
 * -------------------------------------------------------------------------- */
export function notDominatedByFixedProfile(result, fixedResults, {
  K = PROVISIONAL,
  toleranceMs = null,
  // Both come from the trace's own ground truth, computed from the capacity
  // model and never from a controller run.
  decisiveMs = null,      // time in segments where the LADDER decides whether the budget is met
  regimeChanges = null,   // how many times the correct rung changed
  upwardSteps = null,     // how many rungs the trace requires the controller to CLIMB
  minDecisiveMs = null,
} = {}) {
  // A trace in which every segment either fits at every rung or fits at none
  // has no decision in it. Every profile then scores identically on
  // time-outside-budget, and the only thing left to measure is the discovery
  // lag an adaptive controller pays and a clairvoyant fixed profile does not —
  // so the check would punish adaptation for existing. Measured: a controller
  // handed the capacity model itself fails this on such traces.
  const floor = minDecisiveMs ?? K.restoreStabilityMaxMs;
  if (decisiveMs !== null && decisiveMs < floor) {
    return { id: 'INV-14', pass: true, skipped: true,
      message: `only ${Math.round(decisiveMs)} ms of this trace had a rung choice that changed whether the budget was met (< ${floor} ms): nothing for adaptation to win` };
  }
  // The discovery allowance, and there are TWO of them because the two metrics
  // are not symmetric.
  //
  // Outside-budget: every change in the correct rung costs at least one
  // detection window plus one settle, because the controller has to measure a
  // world a fixed profile was simply born knowing. One response deadline per
  // change, plus one for the start of the run.
  //
  // Unnecessarily-degraded: the same, PLUS one PRO-8 probe interval for every
  // rung the trace requires the controller to CLIMB. Measured, and it is not a
  // nicety: at one probe per thirty seconds a three-rung climb takes ninety
  // seconds however good the controller is, and all of it scores as degraded
  // time a fixed profile never pays. Without this term the check demands
  // behaviour PRO-8 forbids, and the first controller written against this
  // corpus failed traces it could not possibly have passed.
  const base = (regimeChanges === null) ? K.evaluationWindowMs : (1 + regimeChanges) * overloadResponseDeadlineMs(K);
  const tolOutside = toleranceMs ?? base;
  const tolDegraded = toleranceMs ?? (base + (upwardSteps ?? 0) * K.probeIntervalMs);
  const tol = tolOutside;
  const a = result.metrics;
  const dominators = [];
  fixedResults.forEach((f, i) => {
    const b = f.metrics;
    const betterOutside = b.timeOutsideBudgetMs + tolOutside < a.timeOutsideBudgetMs;
    const betterDegraded = b.timeUnnecessarilyDegradedMs + tolDegraded < a.timeUnnecessarilyDegradedMs;
    const noWorseOutside = b.timeOutsideBudgetMs <= a.timeOutsideBudgetMs + tolOutside;
    const noWorseDegraded = b.timeUnnecessarilyDegradedMs <= a.timeUnnecessarilyDegradedMs + tolDegraded;
    if (noWorseOutside && noWorseDegraded && (betterOutside || betterDegraded)) {
      dominators.push({ rung: i, ...b });
    }
  });
  if (dominators.length === 0) {
    return ok('INV-14',
      `not dominated (allowance ${Math.round(tolOutside)} ms outside / ${Math.round(tolDegraded)} ms degraded): adaptive spent ${Math.round(a.timeOutsideBudgetMs)} ms outside budget and ` +
      `${Math.round(a.timeUnnecessarilyDegradedMs)} ms unnecessarily degraded`,
      { adaptive: a, fixed: fixedResults.map((f) => f.metrics) });
  }
  return bad('INV-14',
    `a FIXED profile dominates the adaptive controller on this trace, beyond the discovery allowance ` +
    `(${Math.round(tolOutside)} ms outside / ${Math.round(tolDegraded)} ms degraded, for ${regimeChanges} regime change(s) and ${upwardSteps ?? 0} upward step(s)). ` +
    `Adaptive: outside=${Math.round(a.timeOutsideBudgetMs)} ms, degraded=${Math.round(a.timeUnnecessarilyDegradedMs)} ms. Dominated by: ` +
    dominators.map((d) => `fixed(rung ${d.rung}) outside=${Math.round(d.timeOutsideBudgetMs)} degraded=${Math.round(d.timeUnnecessarilyDegradedMs)}`).join('; ') +
    '. Adaptation did not earn its overhead here.',
    dominators);
}

/* -------------------------------------------------------------------------- *
 * INV-15  a scene change is not credited to the adjustment
 *   RL-3: "compare equal-duration windows in comparable gameplay conditions.
 *   A flight into a quieter area must not be credited to the adjustment. Mark
 *   changing scenes, unavailable evidence or differences within measured noise
 *   as inconclusive."
 *
 *   Observable from outside: no upshift may be applied inside the settling
 *   period that straddles a tagged `environment` boundary, because the only
 *   evidence available there spans two different worlds.
 * -------------------------------------------------------------------------- */
export function sceneChangeNotCredited(result, { K = PROVISIONAL } = {}) {
  const problems = [];
  for (const r of result.resets) {
    if (r.tag !== 'environment' && r.tag !== 'resize' && r.tag !== 'orientation') continue;
    // FORWARD ONLY. An upgrade decided before the boundary was decided on
    // evidence entirely inside one world, and a controller cannot be asked to
    // foresee a biome switch. What RL-3 forbids is CREDITING evidence that
    // spans the change, which can only happen after it.
    const window = K.evaluationWindowMs;
    const credited = result.applies.filter((a) => !a.rejected && (a.kind === 'upshift' || a.kind === 'probe-keep')
      && a.tMs >= r.tMs && a.tMs <= r.tMs + window);
    for (const c of credited) {
      problems.push(`${c.kind} at ${Math.round(c.tMs)} ms is inside the evaluation window that straddles the '${r.tag}' boundary at ${Math.round(r.tMs)} ms`);
    }
  }
  if (problems.length === 0) return ok('INV-15', 'no upgrade was credited across a scene-change boundary');
  return bad('INV-15', `evidence spanning a scene change was credited: ${problems.join('; ')}`);
}

/** Convenience: fold a list of invariant results into one assertable report. */
export function summarise(name, checks) {
  const failed = checks.filter((c) => !c.pass);
  return {
    name,
    pass: failed.length === 0,
    checks,
    message: failed.length === 0
      ? `${name}: ${checks.length} invariant(s) hold`
      : `${name}: ${failed.length} of ${checks.length} invariant(s) FAILED\n` +
        failed.map((c) => `  ${c.id} ${c.message}`).join('\n'),
  };
}

/* -------------------------------------------------------------------------- *
 * INV-16  no unwarranted adjustment
 *   Two of the plan's required regressions reduce to this: a resume spike and
 *   a first-use shader compilation are single events, not capacity changes,
 *   and CONTRACT §2.2 is explicit that a paused frame is invalid FOR
 *   DECISIONS. A controller that downshifts on a 900 ms hidden-tab frame has
 *   read a measurement it was told not to.
 *
 *   `kinds` defaults to the reductions only: applying the stored cold-start
 *   profile ('startup') and a panel request ('manual') are always legitimate.
 * -------------------------------------------------------------------------- */
export function noUnwarrantedAdjustment(result, { fromMs = 0, toMs = Infinity, kinds = ['downshift', 'emergency'], why = '' } = {}) {
  const hits = result.applies.filter((a) => !a.rejected && a.tMs >= fromMs && a.tMs <= toMs && kinds.includes(a.kind));
  if (hits.length === 0) {
    return ok('INV-16', `no ${kinds.join('/')} between ${fromMs} and ${Number.isFinite(toMs) ? toMs : 'end'} ms`);
  }
  return bad('INV-16',
    `${hits.length} unwarranted ${kinds.join('/')} between ${fromMs} and ${Number.isFinite(toMs) ? toMs : 'end'} ms: ` +
    hits.map((h) => `${h.kind}->${h.effectiveRung}@${Math.round(h.tMs)} (${h.reason})`).join(', ') +
    (why ? `. ${why}` : ''),
    hits);
}

/* -------------------------------------------------------------------------- *
 * INV-17  the controller's own record keeps what the boundary did not erase.
 *   OPTIONAL: only evaluated when the adapter exposes snapshot().hitches.
 *   CONTRACT §2.1 rule 1 names three things a reset must not clear — the
 *   action history, the evidence record and the recurrent-hitch log — and
 *   only the controller can be asked about its own.
 * -------------------------------------------------------------------------- */
export function controllerRetainsHitches(snapshot, { atLeast = 3 } = {}) {
  if (!snapshot || !Array.isArray(snapshot.hitches)) {
    return { id: 'INV-17', pass: true, skipped: true, message: 'adapter exposes no snapshot().hitches — not evaluated' };
  }
  if (snapshot.hitches.length >= atLeast) {
    return ok('INV-17', `controller retained ${snapshot.hitches.length} hitch record(s) across the tagged boundaries`);
  }
  return bad('INV-17',
    `controller retained only ${snapshot.hitches.length} hitch record(s), expected at least ${atLeast}. ` +
    'CONTRACT §2.1 rule 1: a reset clears the decision windows and NOT the recurrent-hitch log.');
}

/* -------------------------------------------------------------------------- *
 * INV-18  adaptation must beat standing still, WHEN there was something to gain
 *
 *   INV-14 (Pareto non-domination) has one hole: a controller that never moves
 *   ties with the fixed profile at its own start rung on both metrics, so it is
 *   not dominated and passes. This closes it, and closes it only where closing
 *   it is fair — the capacity model itself says how long the correct rung
 *   differed from the starting rung, and if that stretch is shorter than one
 *   probe interval plus one stability window there was genuinely nothing to
 *   win and doing nothing was right.
 *
 *   `fixedAtStart` is the result of running createFixedPolicy(startRung) on
 *   the identical trace.
 * -------------------------------------------------------------------------- */
export function beatsStandingStill(result, fixedAtStart, { gainAvailableMs, decisiveMs = null, K = PROVISIONAL, toleranceMs = null, climbBudgetMs = null, climbWindowMs = null, allFixed = null } = {}) {
  // ONE tolerance, and a small one: a window of noise. INV-14's climb allowance
  // deliberately does NOT appear here. There it excuses the adaptive
  // controller's extra cost; here it would become a HURDLE the controller has
  // to clear, which is the same number pointing the wrong way. Measured: with
  // the climb allowance applied here, a controller that beat standing still by
  // twenty-three seconds of degraded time was recorded as having failed.
  const tol = toleranceMs ?? K.evaluationWindowMs;
  const threshold = K.probeIntervalMs + K.restoreStabilityMaxMs;

  // G3o BLOCKER 1. This invariant demanded a climb that PRO-8 makes physically
  // impossible inside the trace's own lifetime, and a CLAIRVOYANT controller —
  // one reading feasibleRung straight out of the capacity model, an upper bound
  // no real controller can beat — failed 11 of 120 holdout traces. Nine of the
  // eleven passed the instant PRO-8's budget was ignored, so the oracle was
  // pushing every implementer toward the one behaviour the contract forbids,
  // while every other check in the wave scored them clean.
  //
  // PRO-8 allows one upgrade probe per 30 s, so an N-rung climb costs
  // N x probeIntervalMs NO MATTER HOW GOOD THE CONTROLLER IS. Where that
  // exceeds the time available, "beat standing still" is not a demanding
  // oracle, it is an unsatisfiable one. Decline to score it and say so.
  if (!(gainAvailableMs > threshold)) {
    return { id: 'INV-18', pass: true, skipped: true,
      message: `the correct rung differed from the starting rung for only ${Math.round(gainAvailableMs)} ms (< ${threshold} ms): nothing to gain, standing still was right` };
  }
  // Same guard as INV-14, for the same measured reason: a "better" rung that
  // changes neither metric is not a gain. A trace can want a different rung
  // (gainAvailableMs is large) while every segment either fits at every rung
  // or fits at none, and a controller handed the capacity model itself fails
  // this without the guard.
  const floor = K.restoreStabilityMaxMs;
  if (decisiveMs !== null && decisiveMs < floor) {
    return { id: 'INV-18', pass: true, skipped: true,
      message: `only ${Math.round(decisiveMs)} ms of this trace had a rung choice that changed whether the budget was met (< ${floor} ms): moving could not have shown up in either metric` };
  }
  // G3o BLOCKER 1, final form. Where the STARTING rung is already the best of
  // every fixed profile, "beat standing still" is asking the controller to beat
  // the optimum, and no controller can. Measured with a CLAIRVOYANT policy —
  // one reading feasibleRung out of the capacity model, an upper bound nothing
  // can better — this was every residual failure after the generator was fixed:
  // 6 of 120 traces, each with the start rung tied for best (e.g. 165667 vs
  // best 165667). Standing still WAS right, which is exactly what the guards
  // above already say in other words.
  //
  // Narrow on purpose. Two wider guards were tried and both gutted the holdout:
  // "skip when the climb does not fit" skipped 10 of 12 traces, and "skip when
  // gain minus climb toll is small" skipped 12 of 12. TC-15 caught both within
  // the minute by finding that a controller which never adapts passed
  // everything. A guard wide enough to hide an unsatisfiable trace is wide
  // enough to hide a bad controller.
  if (Array.isArray(allFixed) && allFixed.length > 0) {
    const cost = (r) => r.metrics.timeOutsideBudgetMs + r.metrics.timeUnnecessarilyDegradedMs;
    const best = Math.min(...allFixed.map(cost));
    if (cost(fixedAtStart) <= best + tol) {
      return { id: 'INV-18', pass: true, skipped: true,
        message: `the starting rung is already the best fixed profile on this trace `
          + `(${Math.round(cost(fixedAtStart))} ms vs best ${Math.round(best)} ms): standing still `
          + `was optimal, so nothing can beat it` };
    }
  }
  const a = result.metrics;
  const b = fixedAtStart.metrics;
  const betterOutside = a.timeOutsideBudgetMs + tol < b.timeOutsideBudgetMs;
  const betterDegraded = a.timeUnnecessarilyDegradedMs + tol < b.timeUnnecessarilyDegradedMs;
  if (betterOutside || betterDegraded) {
    return ok('INV-18',
      `beat standing still: outside ${Math.round(a.timeOutsideBudgetMs)} vs ${Math.round(b.timeOutsideBudgetMs)} ms, ` +
      `degraded ${Math.round(a.timeUnnecessarilyDegradedMs)} vs ${Math.round(b.timeUnnecessarilyDegradedMs)} ms`);
  }
  return bad('INV-18',
    `${Math.round(gainAvailableMs)} ms of this trace wanted a different rung than the one it started on, and the ` +
    `controller did no better than never moving: outside ${Math.round(a.timeOutsideBudgetMs)} vs ` +
    `${Math.round(b.timeOutsideBudgetMs)} ms, degraded ${Math.round(a.timeUnnecessarilyDegradedMs)} vs ` +
    `${Math.round(b.timeUnnecessarilyDegradedMs)} ms (tolerance ${Math.round(tol)} ms). ` +
    'Adaptation has to earn its overhead.',
    { adaptive: a, standingStill: b });
}
