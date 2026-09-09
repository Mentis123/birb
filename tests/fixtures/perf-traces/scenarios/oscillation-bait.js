/**
 * Scenario: oscillation-bait.
 * Wave 3 / P3.1.
 */
import { noViolations, noPersistentOscillation, settlesInsideBudget } from '../invariants.js';

export const name = 'oscillation-bait';

export function build(K) {
  const W = K.evaluationWindowMs;
  const settleFromMs = K.oscillationSettleMs + K.restoreStabilityMaxMs;
  return {
    name,
    title: 'The top rung misses the refresh by half a millisecond, forever',
    depicts:
      'City perch at dusk with the lit-window shader and the street grid running. Tier 0 costs 17.2 ms ' +
      'against a 16.67 ms refresh — it misses by a hair, so every frame is presented twice and the ' +
      'delivered rate is a clean 30. Tier 1 costs 15.8 ms and delivers a clean 60. The bait is that ' +
      'tier 1 then looks PERFECT, which is precisely the evidence a restore rule asks for.',
    whyCapacityModel:
      'The bait only exists if going up actually costs more. A recorded array replays the same intervals ' +
      'no matter which rung the controller chose, so the "restore, regret, restore" cycle — the exact ' +
      'failure this scenario is named for — cannot occur in it at all. The corpus would then certify a ' +
      'controller that oscillates on the phone as oscillation-free.',
    requires: ['ACC-4', 'RL-6', 'SM-3', 'PRO-13'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10003,
    // Jitter is load-bearing here: without it the boundary is a clean step and
    // the trap is easier than the real thing, where a marginal frame sometimes
    // makes it and sometimes does not.
    jitterMs: 0.5,
    durationMs: K.oscillationSettleMs + K.oscillationWindowMs + 5 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { settleFromMs },
    samples: [
      { atMs: 0, cpuShare: 0.45, note: 'rung0 misses vsync by 0.5 ms; rung1 makes it with 0.9 ms to spare', costMs: { rung0: 17.2, rung1: 15.8, rung2: 11.0 } },
    ],
    events: [],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    noPersistentOscillation(result, { K }),
    settlesInsideBudget(result, { fromMs: m.settleFromMs, toleranceMs: K.evaluationWindowMs * 3, K }),
  ];
}

export const discriminators = [
  { policy: 'thrash', mustFail: ['INV-5'], why: 'changes rung on a fixed beat: the definition of persistent oscillation' },
  { policy: 'compat', mustFail: ['INV-5'], why: 'the SHIPPED 55/58 policy: 30 fps at rung 0 downshifts it, 60 fps at rung 1 restores it, and it has no memory of the failure' },
  { policy: 'static', mustPass: ['INV-5'], why: 'proves INV-5 is satisfiable on this trace' },
];
