/**
 * Scenario: first-use-shader-compilation.
 * Wave 3 / P3.1.
 */
import { noViolations, eventualRecovery, settlesInsideBudget, recurrentHitchesRemainUnexplained } from '../invariants.js';

export const name = 'first-use-shader-compilation';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = 2 * W + K.settleHoldMaxMs;
  const compileAtMs = 6 * W;
  const recoverByMs = compileAtMs + D + K.restoreStabilityMaxMs + 6 * W;
  return {
    name,
    title: 'One 260 ms frame because a shader had never been used before',
    depicts:
      'Six seconds into a comfortable run the weather starts, and its material is compiled and linked ' +
      'for the first time. One frame costs 260 ms; the next costs 11 ms, and so does every frame after ' +
      'it. Nothing about the device changed. Experiment 5 in the source plan is precisely this class of ' +
      'spike ("Profile allocations, first-use shader compilation and periodic decorative updates"), and ' +
      'the correct response to it is to prepare variants outside flight — not to permanently reduce ' +
      'quality because of an event that has already finished happening. The spike lands INSIDE an ' +
      'evaluation window, which is what makes it dangerous: a window mean is wrecked by one 260 ms ' +
      'sample, and a p95 over sixty samples is not.',
    whyCapacityModel:
      'A single spike is representable as a fixed interval. What is not, is the consequence: whether ' +
      'the controller is still degraded twenty seconds later is a statement about the rung it is ' +
      'standing on and what that rung costs, and a replay would hand back the same cheap intervals ' +
      'whether it had shed the post pass or not — so "recovered" and "never noticed" are indistinguishable.',
    requires: ['EXP-5', 'RL-3', 'RL-6', 'ACC-3', 'PRO-12'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10015,
    jitterMs: 0.3,
    durationMs: recoverByMs + 6 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { compileAtMs, recoverByMs },
    samples: [
      { atMs: 0, cpuShare: 0.50, note: 'comfortable at every rung, before and after the compile', costMs: { rung0: 11.2, rung1: 8.6, rung2: 6.6 } },
    ],
    events: [
      // Untagged on purpose: nothing in the engine tags a first-use compile,
      // which is why it lands in the export as an UNEXPLAINED spike and why
      // ACC-3 counts it.
      { atMs: compileAtMs, kind: 'hitch', dtMs: 260 },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    // An emergency reduction on a 260 ms frame is defensible; NOT coming back
    // is not. This is deliberately weaker than "must not react at all".
    eventualRecovery(result, { fromMs: m.compileAtMs, toRungAtMost: 0, byMs: m.recoverByMs, K }),
    settlesInsideBudget(result, { fromMs: 0, K }),
    // The spike stays in the evidence: one occurrence, below the recurrence
    // threshold, so ACC-3 must still pass while the spike is still visible.
    recurrentHitchesRemainUnexplained(result, { atLeast: 1, K }),
  ];
}

export const discriminators = [
  { policy: 'twitchy', mustFail: ['INV-4'], why: 'permanently degrades the game because one shader compiled once' },
  { policy: 'static', mustPass: ['INV-4'], why: 'proves the invariant is satisfiable on a trace where nothing was ever wrong' },
];
