/**
 * Satisfiability instrument for the Wave 3 controller oracles.
 *
 * G3o established the principle and BLOCKER 4 asked for this to be kept:
 * BEFORE SHIPPING AN ORACLE, PROVE A CONFORMING IMPLEMENTATION CAN SATISFY IT.
 *
 * It runs a CLAIRVOYANT controller — one that reads `feasibleRung` straight out
 * of the capacity model, an upper bound no real controller can ever beat —
 * while obeying the contract: one rung per move, PRO-6 hold between moves, and
 * PRO-8's probe budget on every upward move. Whatever this controller cannot
 * satisfy, nothing can, and an oracle it fails is an unsatisfiable oracle
 * rather than a demanding one.
 *
 * That distinction is not academic. G3o measured 11 of 120 holdout traces
 * failing this upper bound, 9 of which passed the moment PRO-8 was ignored —
 * an oracle set quietly pushing every implementer toward the one behaviour the
 * contract forbids, while every other check scored them clean.
 *
 * ---------------------------------------------------------------------------
 * WHY IT ASKS TWO CONTROLLERS, AND WHY THE POLICY LIVES IN THE FIXTURE
 * ---------------------------------------------------------------------------
 * Satisfiability is "SOME conforming controller can do it", so the instrument
 * runs every strategy in CLAIRVOYANT_STRATEGIES and a trace fails only if all
 * of them fail. The strategies differ in one decision — whether to keep
 * descending through a regime where NOTHING on the ladder meets the budget —
 * and neither dominates the other. The residual 4 of 120 that survived G3o's
 * first remediation were entirely the greedy one's: it walked to the bottom of
 * the ladder during a collapse, where both scored metrics are rung-independent
 * and the move buys nothing, then could not climb back at PRO-8's one rung per
 * thirty seconds. It was modelling the exact controller the holdout exists to
 * catch. See createClairvoyantPolicy's header.
 *
 * The policy itself lives in tests/fixtures/perf-traces/reference-policies.js
 * because there were three divergent copies of it — this tool, TC-15, and the
 * gate's own driver — and only one of them was right at any given moment.
 *
 * The guard it verifies (INV-18's `collectableGainMs`) is computed from the
 * CAPACITY MODEL, never from a controller run. That is what keeps this an
 * independent check: were the guard defined as "whatever this instrument can
 * win", the instrument would pass by construction and measure nothing.
 *
 *   node tools/perf-satisfiability.mjs [--seed N] [--count N] [--seeds N]
 *
 * Exits non-zero if the clairvoyant upper bound fails any invariant.
 */
import { generateHoldout } from '../tests/fixtures/perf-traces/holdout.js';
import { runTrace } from '../tests/fixtures/perf-traces/driver.js';
import { createFixedPolicy, createClairvoyantPolicy, CLAIRVOYANT_STRATEGIES } from '../tests/fixtures/perf-traces/reference-policies.js';
import * as INV from '../tests/fixtures/perf-traces/invariants.js';
import { PROVISIONAL as K } from '../src/game/perf-constants.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true]; }));
const SEED = Number(args.seed ?? 20260909);
const COUNT = Number(args.count ?? 12);
const SEEDS = Number(args.seeds ?? 10);

/**
 * Every check the holdout suite applies, for one controller run on one trace.
 * Kept here rather than inline so both strategies are judged identically.
 */
function checkAll(adaptive, fixed, scenario) {
  const gt = scenario.groundTruth;
  return [
    INV.noViolations(adaptive),
    INV.boundedProbes(adaptive, { K }),
    INV.noPersistentOscillation(adaptive, { K }),
    INV.notDominatedByFixedProfile(adaptive, fixed, {
      K, decisiveMs: gt.decisiveMs, regimeChanges: gt.regimeChanges,
      upwardSteps: gt.upwardSteps, downwardSteps: gt.downwardSteps,
    }),
    INV.beatsStandingStill(adaptive, fixed[scenario.startRung], {
      gainAvailableMs: gt.gainAvailableMs, decisiveMs: gt.decisiveMs, K,
      collectableGainMs: gt.collectableGainMs, allFixed: fixed,
    }),
  ];
}

let traces = 0;
let scored = 0;
let idleFailures = 0;
const winsBy = Object.fromEntries(CLAIRVOYANT_STRATEGIES.map((s) => [s, 0]));
const failures = [];

for (let s = 0; s < SEEDS; s += 1) {
  for (const scenario of generateHoldout(SEED + s, { count: COUNT, K })) {
    traces += 1;
    const fixed = scenario.ladder.map((_, r) => runTrace(scenario, { policy: createFixedPolicy(r), K }));

    // The IDLE arm is the other half of the bar and is measured on every run:
    // an oracle nothing can fail is exactly as broken as one nothing can pass.
    // A controller that never applies anything is byte-identical to
    // fixed(startRung), so wherever INV-18 SCORES a trace it must fail here.
    const idle = runTrace(scenario, { policy: { frame() {} }, K });
    const idleCheck = INV.beatsStandingStill(idle, fixed[scenario.startRung], {
      gainAvailableMs: scenario.groundTruth.gainAvailableMs, decisiveMs: scenario.groundTruth.decisiveMs,
      K, collectableGainMs: scenario.groundTruth.collectableGainMs, allFixed: fixed,
    });
    if (!idleCheck.skipped) {
      scored += 1;
      if (!idleCheck.pass) idleFailures += 1;
      else failures.push(`${scenario.name}: INV-18 SCORED this trace and a controller that never moves PASSED it — the guard is too wide`);
    }

    const perStrategy = {};
    for (const chase of CLAIRVOYANT_STRATEGIES) {
      let adaptive;
      try {
        adaptive = runTrace(scenario, { policy: createClairvoyantPolicy(scenario, { K, chase }), K });
      } catch (err) {
        perStrategy[chase] = [`${scenario.name} [${chase}]: driver threw — ${err.message}`];
        continue;
      }
      const bad = checkAll(adaptive, fixed, scenario).filter((c) => !c.pass);
      perStrategy[chase] = bad.map((c) => `${scenario.name} [${chase}] ${c.id}: ${c.message}`);
      if (bad.length === 0) winsBy[chase] += 1;
    }
    // Satisfiable means SOME conforming controller satisfies it.
    if (CLAIRVOYANT_STRATEGIES.every((c) => perStrategy[c].length > 0)) {
      failures.push(...CLAIRVOYANT_STRATEGIES.flatMap((c) => perStrategy[c]));
    }
  }
}

console.log(`clairvoyant upper bound over ${traces} holdout traces (seeds ${SEED}..${SEED + SEEDS - 1})`);
console.log(`  strategies satisfying every invariant: ` +
  CLAIRVOYANT_STRATEGIES.map((c) => `${c} ${winsBy[c]}/${traces}`).join(', '));
console.log(`  INV-18 scored ${scored}/${traces} traces; a never-moving controller failed ${idleFailures} of those ${scored}`);
if (failures.length) {
  console.error(`UNSATISFIABLE: ${failures.length} invariant failures by a controller that cannot be bettered`);
  for (const f of failures.slice(0, 20)) console.error('  ' + f);
  if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more`);
  process.exit(1);
}
if (scored === 0 || idleFailures !== scored) {
  console.error(`DISCRIMINATION LOST: ${scored} traces scored, ${idleFailures} idle failures. ` +
    'A guard wide enough to hide an unsatisfiable trace is wide enough to hide a bad controller.');
  process.exit(1);
}
console.log('SATISFIABLE: every invariant is reachable by a conforming controller, ' +
  `and all ${scored} scored traces still fail a controller that never adapts`);
