/**
 * Scenario: misleading-plateau.
 * Wave 3 / P3.1. Called out by name in docs/ULTRACODE_PERFORMANCE_PLAN.md §4 Wave 3.
 */
import { noViolations, boundedProbes, failedProbeRollsBack, noPersistentOscillation, settlesInsideBudget } from '../invariants.js';

export const name = 'misleading-plateau';

export function build(K) {
  const W = K.evaluationWindowMs;
  return {
    name,
    title: 'A flat, perfect 60 that says nothing whatever about headroom',
    depicts:
      'The controller is sitting one rung down after an earlier emergency. At that rung the frame costs ' +
      '12 ms on a 60 Hz panel, so it is presented every refresh and the delivered rate is 60.0 with no ' +
      'variance at all. The rung above costs 19.5 ms and would deliver a clean 30. There is no GPU timer ' +
      'on this device, so the ONLY evidence available says "everything is perfect" — and it is the same ' +
      'evidence a device with real headroom would produce. ' +
      'The plan: "Delivered 60 FPS alone does not reveal spare GPU capacity on a 60 Hz display; without ' +
      'GPU timing use occasional bounded probes and learn from their result."',
    whyCapacityModel:
      'A recorded array of 16.67 ms intervals IS the plateau, and that is the problem: replayed, the ' +
      'probe upward reads back 16.67 ms as well, so every probe succeeds and the trace certifies a ' +
      'controller that would have halved the frame rate on the device. The failure of the probe is a ' +
      'fact about capacity at the rung the controller moved to, and only a capacity model holds it.',
    requires: ['SM-3', 'RL-1', 'RL-4', 'RL-6', 'DEF-2', 'PRO-8', 'TEL-5'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 1,
    seed: 10004,
    jitterMs: 0.3,
    // No GPU timing at all: this is the device the plan is written for.
    gpuInitial: 'no-extension',
    durationMs: K.oscillationSettleMs + K.oscillationWindowMs + 2 * K.probeIntervalMs,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { plateauFromMs: 0 },
    samples: [
      { atMs: 0, cpuShare: 0.30, note: 'rung1 delivers a flawless 60; rung0 would deliver 30; rung2 is cheaper still and pointless', costMs: { rung0: 19.5, rung1: 12.0, rung2: 8.5 } },
    ],
    events: [],
  };
}

export function invariants(result, K) {
  // Probes are ALLOWED to spend time outside budget — that is what a probe is.
  // The allowance is three response deadlines' worth, derived, not chosen.
  const probeAllowanceMs = 3 * (K.evaluationWindowMs * (K.overloadWindowCount + 1) + K.settleHoldMaxMs);
  return [
    noViolations(result),
    boundedProbes(result, { K }),
    failedProbeRollsBack(result, { K }),
    noPersistentOscillation(result, { K }),
    settlesInsideBudget(result, { fromMs: 0, toleranceMs: probeAllowanceMs, K }),
  ];
}

export const discriminators = [
  { policy: 'compat', mustFail: ['INV-5'], why: 'the shipped policy reads the plateau as headroom, restores, gets 30 fps, downshifts, and repeats forever — it has no failed-probe memory' },
  { policy: 'static', mustFail: ['INV-9'], why: 'never probes, so it can never discover whether the plateau hides headroom' },
  { policy: 'probe-only', mustPass: ['INV-9', 'INV-7'], why: 'proves a bounded probe that rolls back and lengthens its cooldown satisfies INV-9 and INV-7 on this trace' },
];
