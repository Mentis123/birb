/**
 * tests/fixtures/perf-traces/holdout.js — traces the controller has never seen.
 *
 * Wave 3 / P3.1.
 *
 * ---------------------------------------------------------------------------
 * WHY A HOLDOUT EXISTS
 * ---------------------------------------------------------------------------
 * A controller tuned until the committed sixteen go green has learned the
 * committed sixteen. That is not a hypothetical: the whole reason Wave 1 buys
 * oracles for Wave 2 to spend is that an agent which writes both the code and
 * the check is a closed loop, and a fixed corpus is a check that can be
 * memorised even by an agent that never opens it — by iterating until it
 * passes. The holdout is the only thing in this programme that catches that.
 *
 * ---------------------------------------------------------------------------
 * THE SEED IS NOT IN THE WORKTREE, AND MUST NEVER BE
 * ---------------------------------------------------------------------------
 * `generateHoldout()` has NO default seed and throws without one. The gate
 * supplies it through the environment:
 *
 *     BIRB_PERF_IMPL=1 BIRB_PERF_HOLDOUT_SEED=<the gate's seed> \
 *       node --test tests/adaptive-quality-holdout.test.js
 *
 * Committing a seed — as a default argument, a fallback, a fixture file, a
 * comment showing "an example run", or a CI workflow default — converts the
 * holdout into seventeen more committed scenarios and deletes the only
 * anti-laundering check in the wave. `holdoutFingerprint()` exists so a gate
 * can RECORD which seed it used, in the gate file, without the seed itself
 * ever reaching the repository.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES IT HONEST RATHER THAN JUST RANDOM
 * ---------------------------------------------------------------------------
 * Four things the committed corpus does not contain, on purpose:
 *
 *  1. **Dead rungs.** A rung that costs the same as the one above it. Real:
 *     the source plan warns "Uniform intensity changes alone may leave the
 *     expensive shader work intact", and this repo has shipped exactly that
 *     (writing to `diffuseColor` at `<opaque_fragment>` changes nothing,
 *     because Lambert has already folded it into the lighting). A controller
 *     that assumes every downshift helps will descend the whole ladder here
 *     and score as maximally degraded for no benefit.
 *  2. **CPU-bound regimes.** Cost almost flat across the ladder, high
 *     cpuShare. Plan step 4: "if CPU work dominates and DPR changes do little,
 *     target decorative update rates, allocations or submission overhead."
 *     Nothing on this ladder helps, and the correct behaviour is to stop
 *     descending, not to keep paying visual cost for nothing.
 *  3. **Randomised event placement**, including boundaries that land inside a
 *     decision window and pauses that straddle a capacity change.
 *  4. **No expected outcome per trace.** Every check is either a contract
 *     violation, an oscillation count, or a comparison against the FIXED
 *     profiles run on the same trace — so nothing here can be satisfied by
 *     recognising the trace.
 *
 * No THREE, no DOM.
 */

import { mulberry32, hashSeed } from '../../../src/environment/seeded-random.js';
import { PROVISIONAL, budgetMs as budgetFor } from '../../../src/game/perf-constants.js';
import { syntheticLadder, rungKey } from './ladder.js';
import { assertValidScenario, feasibleRung, DEFAULT_CPU_SHARE } from './schema.js';

/** The environment variable the gate supplies the seed through. */
export const HOLDOUT_ENV_VAR = 'BIRB_PERF_HOLDOUT_SEED';

/**
 * A short, stable identifier for a seed. Lets a gate write
 * "holdout seed fingerprint 3f9c1a04" into docs/perf/gates/G3*.md — which is
 * enough to prove two runs used the same seed, and not enough to reproduce it.
 */
export function holdoutFingerprint(seed) {
  return (hashSeed(`birb-holdout:${String(seed)}`) >>> 0).toString(16).padStart(8, '0');
}

const REGIMES = Object.freeze([
  'comfortable',   // every rung fits, with room
  'marginal',      // the top rung or two sit within a millisecond of the budget
  'overloaded',    // the top rungs are well over; a deep rung is required
  'cpu-bound',     // cost barely varies across the ladder and it is mostly CPU
  'collapsing',    // nothing on the ladder fits; the honest answer is the bottom rung
]);

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function between(rng, lo, hi) { return lo + rng() * (hi - lo); }
function intBetween(rng, lo, hi) { return Math.floor(between(rng, lo, hi + 1 - 1e-9)); }

/**
 * A cost curve down the ladder for one regime, in milliseconds.
 * `deadRungs` is a set of indices whose cost equals the rung above it.
 */
function costCurve(rng, depth, regime, B, deadRungs) {
  const out = new Array(depth);
  let top;
  let decay;
  switch (regime) {
    case 'comfortable': top = between(rng, B * 0.45, B * 0.80); decay = between(rng, 0.72, 0.90); break;
    case 'marginal':    top = between(rng, B * 0.98, B * 1.12); decay = between(rng, 0.80, 0.94); break;
    case 'overloaded':  top = between(rng, B * 1.45, B * 2.10); decay = between(rng, 0.58, 0.78); break;
    case 'cpu-bound':   top = between(rng, B * 1.05, B * 1.35); decay = between(rng, 0.96, 0.995); break;
    case 'collapsing':  top = between(rng, B * 2.60, B * 3.60); decay = between(rng, 0.80, 0.92); break;
    default:            top = B * 0.7; decay = 0.85; break;
  }
  out[0] = top;
  for (let r = 1; r < depth; r += 1) {
    out[r] = deadRungs.has(r) ? out[r - 1] : out[r - 1] * decay;
  }
  return out;
}

function cpuShareFor(rng, regime) {
  if (regime === 'cpu-bound') return between(rng, 0.78, 0.93);
  return between(rng, 0.28, 0.55);
}

/**
 * Generate one holdout scenario.
 * @param {number} seedInt   a 32-bit seed for THIS trace
 * @param {number} index     its position, used only for the name
 * @param {object} K         the provisional constants table
 */
function generateOne(seedInt, index, K) {
  const rng = mulberry32(seedInt);
  const B = budgetFor(60);
  const W = K.evaluationWindowMs;

  const depth = intBetween(rng, 3, 6);
  const ladder = syntheticLadder(depth, K);

  // Dead rungs: a setting that costs what the one above it costs. At most
  // depth-2 of them, so the ladder is never entirely inert.
  const deadRungs = new Set();
  const deadCount = rng() < 0.45 ? intBetween(rng, 1, Math.max(1, depth - 2)) : 0;
  while (deadRungs.size < deadCount) deadRungs.add(intBetween(rng, 1, depth - 1));

  // Phases. Long enough in total that PRO-13's oscillation window is
  // evaluable, which is settle + window; anything shorter and INV-5 returns a
  // sentinel and the holdout silently checks less than it says it does.
  const minTotal = K.oscillationSettleMs + K.oscillationWindowMs + 10 * W;
  const phases = [];
  let t = 0;
  const phaseCount = intBetween(rng, 3, 6);
  for (let i = 0; i < phaseCount; i += 1) {
    const regime = pick(rng, REGIMES);
    const durMs = Math.round(between(rng, 6 * W, 22 * W));
    phases.push({ atMs: t, regime, durMs });
    t += durMs;
  }
  // Guarantee the run is long enough to evaluate, by extending the LAST phase
  // rather than by appending a comfortable tail — appending one would make
  // every holdout trace end recoverable, which is a shape a controller could
  // learn.
  if (t < minTotal) {
    phases[phases.length - 1].durMs += minTotal - t;
    t = minTotal;
  }
  let durationMs = t;


  const samples = phases.map((p) => {
    const curve = costCurve(rng, depth, p.regime, B, deadRungs);
    const costMs = {};
    for (let r = 0; r < depth; r += 1) costMs[rungKey(r)] = Math.round(curve[r] * 100) / 100;
    return {
      atMs: p.atMs,
      cpuShare: Math.round(cpuShareFor(rng, p.regime) * 1000) / 1000,
      note: `${p.regime}${deadRungs.size ? ` (dead rungs: ${[...deadRungs].sort().join(',')})` : ''}`,
      costMs,
    };
  });

  // Chosen here rather than below because the climb budget depends on it: the
  // first leg of any climb is from the STARTING rung to the first feasible one,
  // and computing the budget without it under-extended the trace.
  const startRung = intBetween(rng, 0, depth - 1);

  // G3o BLOCKER 1, fixed at the layer that causes it.
  //
  // The comment further down already knew PRO-8 caps upgrade probes at one per
  // 30 s, so an N-rung climb costs N x 30 s NO MATTER HOW GOOD THE CONTROLLER
  // IS. Nothing enforced it, so the generator produced traces demanding six
  // rungs of climb inside 78 s — and G3o measured a CLAIRVOYANT controller, one
  // reading feasibleRung straight out of the capacity model, failing 11 of 120
  // traces. Nine of the eleven passed the moment PRO-8 was ignored, so the
  // oracle was quietly pushing every implementer toward the one behaviour the
  // contract forbids while every other check scored them clean.
  //
  // Fixed HERE, not by widening INV-18's skip. That was tried: "skip when the
  // climb does not fit" skipped 10 of 12 traces and TC-15 caught it within the
  // minute, by finding that a controller which never adapts passed everything.
  // A guard wide enough to hide an unsatisfiable trace is wide enough to hide a
  // bad controller. Generate satisfiable traces; let the invariant score all of
  // them. The TAIL is extended rather than the regime changes thinned —
  // thinning would make holdout traces systematically calmer than the committed
  // corpus, which is a shape a controller could learn.
  {
    let climbSteps = 0;
    let prev = startRung;
    for (const smp of samples) {
      const costs = [];
      for (let r = 0; r < depth; r += 1) costs.push(smp.costMs[rungKey(r)]);
      const f = feasibleRung(costs, B);
      if (prev !== null && f < prev) climbSteps += prev - f;
      prev = f;
    }
    const needMs = climbSteps * K.probeIntervalMs;
    const haveMs = durationMs - (phases[0]?.durMs ?? 0);
    if (needMs > haveMs) {
      const shortfall = needMs - haveMs;
      phases[phases.length - 1].durMs += shortfall;
      durationMs += shortfall;
    }
  }

  // ---- events -------------------------------------------------------------
  const events = [];
  const tags = ['resize', 'orientation', 'environment', 'contextRestore'];
  const resetCount = intBetween(rng, 0, 4);
  for (let i = 0; i < resetCount; i += 1) {
    const at = Math.round(between(rng, W, durationMs - W));
    events.push({ atMs: at, kind: 'reset', tag: pick(rng, tags) });
    if (rng() < 0.6) events.push({ atMs: at, kind: 'hitch', dtMs: Math.round(between(rng, 120, 520)) });
  }
  if (rng() < 0.45) {
    const from = Math.round(between(rng, 2 * W, durationMs - 8 * W));
    const to = from + Math.round(between(rng, 2 * W, 8 * W));
    events.push({ atMs: from, kind: 'paused', paused: true, reason: pick(rng, ['hidden', 'flightPaused', 'frozen']) });
    events.push({ atMs: to, kind: 'paused', paused: false });
    events.push({ atMs: to, kind: 'reset', tag: 'resume' });
  }
  if (rng() < 0.5) {
    events.push({ atMs: 0, kind: 'gpu', state: pick(rng, ['no-extension', 'not-webgl2']) });
  } else if (rng() < 0.5) {
    const at = Math.round(between(rng, 3 * W, durationMs - 5 * W));
    events.push({ atMs: at, kind: 'gpu', state: 'disjoint' });
    events.push({ atMs: at + Math.round(between(rng, 2 * W, 10 * W)), kind: 'gpu', state: 'ok' });
  }
  if (rng() < 0.4) {
    events.push({ atMs: Math.round(between(rng, W, 4 * W)), kind: 'recurrentHitch', everyMs: Math.round(between(rng, 250, 1400)), dtMs: Math.round(between(rng, 40, 90)) });
  }
  if (rng() < 0.4) {
    events.push({ atMs: Math.round(between(rng, 2 * W, durationMs - 2 * W)), kind: 'hitch', dtMs: Math.round(between(rng, 150, 400)) });
  }
  events.sort((a, b) => a.atMs - b.atMs);

  const gpuAtZero = events.find((e) => e.kind === 'gpu' && e.atMs === 0);
  const vsync = rng() < 0.8;
  const regimeList = phases.map((p) => p.regime).join(' -> ');

  const scenario = {
    name: `holdout-${index}`,
    title: `Holdout ${index}: ${regimeList}`,
    depicts:
      `A generated device-and-scene history the controller has never seen: ${phaseCount} regimes ` +
      `(${regimeList}) on a ${depth}-rung ladder` +
      (deadRungs.size ? `, with rung(s) ${[...deadRungs].sort().join(', ')} costing exactly what the rung above costs` : '') +
      `, starting on rung ${startRung}, presented ${vsync ? 'on a 60 Hz panel' : 'without vsync'}.`,
    whyCapacityModel:
      'Generated as a capacity model for the same reason the committed corpus is one: the checks applied ' +
      'to it compare the controller against FIXED profiles run on the identical world, and a fixed ' +
      'interval replay would hand every arm the same numbers, making the comparison vacuous.',
    requires: ['DL-4', 'RL-6', 'ACC-4'],
    ladder,
    targetFPS: 60,
    presentation: vsync ? { mode: 'vsync', hz: 60 } : { mode: 'free' },
    startRung,
    seed: seedInt | 0,
    jitterMs: Math.round(between(rng, 0, 0.8) * 100) / 100,
    gpuInitial: gpuAtZero ? gpuAtZero.state : 'ok',
    durationMs,
    instrumentation: { perFrameMs: 0.07, perUpdateMs: 1.3 },
    marks: {},
    samples,
    events,
  };

  scenario.groundTruth = computeGroundTruth(scenario, depth, B, K);
  scenario.holdout = true;
  return scenario;
}

/**
 * How much of standing-still's loss a CONFORMING controller could actually
 * collect — the number INV-18 needs and did not have.
 *
 * ---------------------------------------------------------------------------
 * WHY gainAvailableMs IS THE WRONG NUMBER
 * ---------------------------------------------------------------------------
 * `gainAvailableMs` counts every millisecond whose feasible rung differs from
 * the starting rung. That over-counts in two directions at once, and every
 * residual G3o failure was one of them:
 *
 *  - A segment where NOTHING on the ladder meets the budget reports
 *    `feasibleRung = depth - 1` (schema.js: "the honest answer is the cheapest
 *    setting"), so it counts as gain — while on BOTH scored metrics every rung
 *    is identical there. Time outside budget accrues at every rung, and
 *    nothing can be "unnecessarily degraded" below the deepest rung. A trace
 *    ending in a 147-second collapse reported 217 s of gain available and had
 *    exactly 18 s.
 *  - It costs nothing to reach. It is a duration, and the contract's rates are
 *    not free: PRO-8 allows one upgrade probe per 30 s, so a three-rung climb
 *    takes ninety seconds however good the controller is, and PRO-6 holds
 *    2-3 s between ordinary adjustments. A 20-second window wanting a rung
 *    three climbs away offers no gain at all.
 *
 * And the metric is a PREDICATE, not a magnitude: `rung > feasibleRung` scores
 * the same at one rung out as at four, so a partial climb earns literally
 * nothing. Measured, on a clairvoyant reference: 4 -> 3 -> 2 across a
 * 33-second window whose feasible rung was 0 reduced timeUnnecessarilyDegraded
 * by 0 ms.
 *
 * So the gain a controller can collect is, per opportunity,
 * `duration - toll`, and the toll is the contract's own rate limit.
 *
 * Derived from the capacity model alone, like everything else here. That
 * matters: it is what keeps `tools/perf-satisfiability.mjs` an INDEPENDENT
 * check. If this guard were computed by running the reference controller, the
 * reference would satisfy it by construction and the instrument would be
 * measuring itself.
 */
function collectableGainMs(timeline, startRung, K) {
  // Consecutive segments that want the same rung are ONE opportunity: the toll
  // is paid on entry, not again at every capacity change that does not move
  // the answer. Without this merge, two adjacent 15-second segments both
  // wanting rung 0 are each charged the full climb and both score zero.
  const runs = [];
  for (const seg of timeline) {
    const last = runs[runs.length - 1];
    if (last && last.feasibleRung === seg.feasibleRung && last.anyFits === seg.anyFits) {
      last.toMs = seg.toMs;
    } else {
      runs.push({ fromMs: seg.fromMs, toMs: seg.toMs, feasibleRung: seg.feasibleRung, anyFits: seg.anyFits });
    }
  }
  let total = 0;
  for (const run of runs) {
    const durMs = run.toMs - run.fromMs;
    const f = run.feasibleRung;
    if (f < startRung) {
      // Standing still is UNNECESSARILY DEGRADED here and only a climb fixes
      // it. PRO-8: one upgrade probe per 30 s. The first may be immediate, so
      // N rungs cost (N-1) intervals of WAITING, not N.
      total += Math.max(0, durMs - (startRung - f - 1) * K.probeIntervalMs);
    } else if (f > startRung && run.anyFits) {
      // Standing still is OUTSIDE BUDGET here and a descent fixes it. PRO-6
      // holds after each adjustment; same (N-1) arithmetic, at the FASTEST
      // hold the contract permits, because the question is what SOME
      // conforming controller could do, not what a particular one does.
      total += Math.max(0, durMs - (f - startRung - 1) * K.settleHoldMinMs);
    }
    // f === startRung: standing still is already on the right rung.
    // !anyFits: no rung meets the budget, so both metrics are rung-independent
    // here and there is no gain for any controller, however clairvoyant.
  }
  return total;
}

/**
 * Ground truth derived from the capacity model alone — never from a controller
 * run. This is what lets the holdout ask questions of a controller that has
 * never seen the trace without also telling it the answer.
 */
function computeGroundTruth(scenario, depth, B, K) {
  const timeline = scenario.samples.map((s, i) => {
    const costs = [];
    for (let r = 0; r < depth; r += 1) costs.push(s.costMs[rungKey(r)]);
    const next = scenario.samples[i + 1];
    const anyFits = costs.some((c) => c <= B);
    const allFit = costs.every((c) => c <= B);
    return {
      fromMs: s.atMs,
      toMs: next ? next.atMs : scenario.durationMs,
      feasibleRung: feasibleRung(costs, B),
      anyFits,
      // DECISIVE: some rung meets the budget and some does not, so which rung
      // the controller stands on determines whether the frame fits. When every
      // rung fits (or none does) the ladder decides nothing and no controller,
      // however good, can beat a fixed profile on this segment.
      decisive: anyFits && !allFit,
    };
  });
  // How long the correct rung differs from the one the run starts on. When
  // this is short there was nothing to gain and the controller must not be
  // asked to beat standing still.
  let gainAvailableMs = 0;
  for (const seg of timeline) {
    if (seg.feasibleRung !== scenario.startRung) gainAvailableMs += seg.toMs - seg.fromMs;
  }
  let decisiveMs = 0;
  for (const seg of timeline) if (seg.decisive) decisiveMs += seg.toMs - seg.fromMs;
  let regimeChanges = 0;
  for (let i = 1; i < timeline.length; i += 1) if (timeline[i].feasibleRung !== timeline[i - 1].feasibleRung) regimeChanges += 1;
  // UPWARD steps: rungs the controller must CLIMB, counted from where the run
  // starts. Downward steps are cheap — the overload rule fires in two windows.
  // Upward ones are not: PRO-8 caps optional upgrade probes at one per 30 s, so
  // a three-rung climb takes ninety seconds NO MATTER HOW GOOD THE CONTROLLER
  // IS, and every millisecond of it scores as time unnecessarily degraded. An
  // oracle that ignores that is asking for something the contract forbids.
  let upwardSteps = Math.max(0, scenario.startRung - timeline[0].feasibleRung);
  for (let i = 1; i < timeline.length; i += 1) {
    upwardSteps += Math.max(0, timeline[i - 1].feasibleRung - timeline[i].feasibleRung);
  }
  // G3o BLOCKER 1, residual. DOWNWARD steps, the symmetric quantity, and it
  // was simply missing — the comment above says "downward steps are cheap",
  // which is true per rung and false per DESCENT. PRO-6 holds 2-3 s after an
  // ordinary adjustment, so an N-rung descent costs (N-1) holds of waiting
  // however good the controller is, and every millisecond of it scores as
  // time outside budget that a fixed profile born on the right rung never
  // pays. Measured: a conforming reference starting on rung 0 of a five-rung
  // ladder whose very first segment needs rung 4 was recorded by INV-14 as
  // DOMINATED — 29283 ms outside against fixed(4)'s 21717 — for spending ten
  // seconds descending at exactly the rate PRO-6 mandates.
  let downwardSteps = Math.max(0, timeline[0].feasibleRung - scenario.startRung);
  for (let i = 1; i < timeline.length; i += 1) {
    downwardSteps += Math.max(0, timeline[i].feasibleRung - timeline[i - 1].feasibleRung);
  }
  const last = timeline[timeline.length - 1];
  return {
    timeline,
    decisiveMs,
    regimeChanges,
    upwardSteps,
    downwardSteps,
    // How much of standing still's loss a conforming controller could actually
    // collect. This — not gainAvailableMs — is what "there was something to
    // gain" has to mean once PRO-8 is in force. See collectableGainMs().
    collectableGainMs: collectableGainMs(timeline, scenario.startRung, K),
    // G3o BLOCKER 1. The comment above already knew a climb costs
    // upwardSteps x probeIntervalMs under PRO-8; nothing computed it, so
    // nothing could tell a demanding trace from an impossible one. These two
    // numbers are what INV-14 and INV-18 need to decline the impossible ones.
    climbBudgetMs: upwardSteps * K.probeIntervalMs,
    // The time the controller actually has to spend that budget in: from the
    // first regime change to the end. Before the first change there is nothing
    // to climb towards.
    climbWindowMs: Math.max(0, scenario.durationMs - (timeline[0]?.toMs ?? 0)),
    gainAvailableMs,
    finalFeasibleRung: last.feasibleRung,
    tailStableFromMs: last.fromMs,
    tailMs: last.toMs - last.fromMs,
    // The threshold at which "beat standing still" becomes a fair demand:
    // long enough for a downshift AND an upgrade probe to have happened.
    gainMattersAboveMs: K.probeIntervalMs + K.restoreStabilityMaxMs,
  };
}

/**
 * generateHoldout(seed, opts) -> scenario[]
 *
 * @param {string|number} seed  supplied by the gate through HOLDOUT_ENV_VAR.
 *                              THERE IS NO DEFAULT and there must never be one.
 * @param {object} [opts]
 * @param {number} [opts.count] how many traces (default 12)
 * @param {object} [opts.K]     a PROVISIONAL-shaped constants table
 */
export function generateHoldout(seed, { count = 12, K = PROVISIONAL } = {}) {
  if (seed === undefined || seed === null || seed === '') {
    throw new RangeError(
      `generateHoldout requires a seed and has no default. The gate supplies it through ` +
      `${HOLDOUT_ENV_VAR}; a seed committed to the worktree — as a default, a fallback, a fixture or ` +
      `an "example" in a comment — turns the holdout into more committed scenarios and deletes the ` +
      `only check in this wave that catches a controller tuned to the corpus.`,
    );
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  const root = hashSeed(`birb-holdout:${String(seed)}`) >>> 0;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // Each trace gets its own derived seed rather than sharing one stream, so
    // adding a random draw to the generator does not reshuffle every trace
    // after it — the same reasoning as createRngPool in seeded-random.js.
    const seedInt = hashSeed(`birb-holdout-trace:${root}:${i}`) >>> 0;
    const scenario = generateOne(seedInt, i, K);
    assertValidScenario(scenario, { K });
    out.push(scenario);
  }
  return out;
}

export { DEFAULT_CPU_SHARE };
