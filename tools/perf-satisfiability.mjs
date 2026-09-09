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
 *   node tools/perf-satisfiability.mjs [--seed N] [--count N]
 *
 * Exits non-zero if the clairvoyant upper bound fails any invariant.
 */
import { generateHoldout } from '../tests/fixtures/perf-traces/holdout.js';
import { runTrace } from '../tests/fixtures/perf-traces/driver.js';
import { createFixedPolicy } from '../tests/fixtures/perf-traces/reference-policies.js';
import * as INV from '../tests/fixtures/perf-traces/invariants.js';
import { PROVISIONAL as K } from '../src/game/perf-constants.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true]; }));
const SEED = Number(args.seed ?? 20260909);
const COUNT = Number(args.count ?? 12);
const SEEDS = 10;

/**
 * The upper bound. Knows the right answer at every instant and still plays by
 * the rules — so a failure here is the oracle's, not the controller's.
 */
function createClairvoyant(scenario) {
  const timeline = scenario.groundTruth.timeline;
  let rung = null;
  let lastMoveAt = -Infinity;
  let lastProbeAt = -Infinity;
  let probeOutstanding = false;
  let apply = null;

  function feasibleAt(tMs) {
    let f = timeline[0].feasibleRung;
    for (const seg of timeline) if (tMs >= seg.fromMs) f = seg.feasibleRung;
    return f;
  }

  return {
    start(ctx) { apply = ctx.apply; rung = ctx.rung; },
    frame(f) {
      rung = f.rung;
      const want = feasibleAt(f.tMs);

      // Resolve an outstanding probe FIRST, always. Leaving it open was a real
      // bug in this instrument: the climb path returned early while a probe was
      // outstanding, so after the first probe the controller never moved again
      // and scored identically to standing still (measured: degraded 132653 vs
      // 132653 ms). An instrument that cannot move is not an upper bound.
      if (probeOutstanding && f.tMs - lastProbeAt >= K.settleHoldMs) {
        const stillFits = want <= rung;
        apply({ kind: stillFits ? 'probe-keep' : 'probe-rollback',
                rung: stillFits ? rung : rung + 1,
                reason: 'clairvoyant-resolve' });
        probeOutstanding = false;
        if (!stillFits) { rung += 1; lastMoveAt = f.tMs; }
        return;
      }
      if (probeOutstanding) return;
      if (want === rung) return;
      if (f.tMs - lastMoveAt < K.settleHoldMs) return;

      if (want > rung) {
        // Down is the overload path and is not probe-governed.
        apply({ kind: 'downshift', rung: rung + 1, reason: 'clairvoyant-down' });
        lastMoveAt = f.tMs;
        return;
      }
      // Up: PRO-8 governs it — one probe per 30 s, one outstanding.
      if (f.tMs - lastProbeAt < K.probeIntervalMs) return;
      apply({ kind: 'probe', rung: rung - 1, reason: 'clairvoyant-up' });
      lastProbeAt = f.tMs;
      lastMoveAt = f.tMs;
      probeOutstanding = true;
    },
  };
}

let traces = 0;
const failures = [];
for (let s = 0; s < SEEDS; s += 1) {
  for (const scenario of generateHoldout(SEED + s, { count: COUNT, K })) {
    traces += 1;
    const gt = scenario.groundTruth;
    let adaptive;
    try {
      adaptive = runTrace(scenario, { policy: createClairvoyant(scenario), K });
    } catch (err) {
      failures.push(`${scenario.name}: driver threw — ${err.message}`);
      continue;
    }
    const fixed = scenario.ladder.map((_, r) => runTrace(scenario, { policy: createFixedPolicy(r), K }));
    const checks = [
      INV.noViolations(adaptive),
      INV.boundedProbes(adaptive, { K }),
      INV.noPersistentOscillation(adaptive, { K }),
      INV.notDominatedByFixedProfile(adaptive, fixed, {
        K, decisiveMs: gt.decisiveMs, regimeChanges: gt.regimeChanges, upwardSteps: gt.upwardSteps,
        climbBudgetMs: gt.climbBudgetMs, climbWindowMs: gt.climbWindowMs,
      }),
      INV.beatsStandingStill(adaptive, fixed[scenario.startRung], {
        gainAvailableMs: gt.gainAvailableMs, decisiveMs: gt.decisiveMs, K,
        climbBudgetMs: gt.climbBudgetMs, climbWindowMs: gt.climbWindowMs, allFixed: fixed,
      }),
    ];
    for (const c of checks) {
      if (!c.pass) failures.push(`${scenario.name} ${c.id}: ${c.message}`);
    }
  }
}

console.log(`clairvoyant upper bound over ${traces} holdout traces (seeds ${SEED}..${SEED + SEEDS - 1})`);
if (failures.length) {
  console.error(`UNSATISFIABLE: ${failures.length} invariant failures by a controller that cannot be bettered`);
  for (const f of failures.slice(0, 20)) console.error('  ' + f);
  if (failures.length > 20) console.error(`  ... and ${failures.length - 20} more`);
  process.exit(1);
}
console.log('SATISFIABLE: every invariant is reachable by a conforming controller');
