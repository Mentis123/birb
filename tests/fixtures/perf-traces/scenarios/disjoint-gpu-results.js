/**
 * Scenario: disjoint-gpu-results.
 * Wave 3 / P3.1.
 */
import { noViolations, settlesInsideBudget, eventualRecovery } from '../invariants.js';

export const name = 'disjoint-gpu-results';

export function build(K) {
  const W = K.evaluationWindowMs;
  const disjointFromMs = 4 * W;
  const disjointToMs = disjointFromMs + K.restoreStabilityMaxMs;
  // Two probe intervals, not one. A controller that probed upward during the
  // disjoint window found a rung that did not fit and, per SM-3, "roll back and
  // LENGTHEN its retry cooldown" — so a recovery deadline shorter than two
  // PRO-8 intervals would forbid the very behaviour the plan requires. Measured:
  // at one interval a correct controller fails this and the naive one passes.
  const recoverByMs = disjointToMs + 2 * K.probeIntervalMs + K.restoreStabilityMaxMs + 4 * W;
  return {
    name,
    title: 'The GPU timer answers, and the answer must be thrown away',
    depicts:
      'The extension is present and returning results, then the driver raises GPU_DISJOINT_EXT — a ' +
      'context switch, a thermal event, another tab compositing. Per the Khronos specification the ' +
      'timing for that period is meaningless and must be discarded, which src/game/gpu-timer.js does: ' +
      'it reports {value:null, state:"unavailable", reason:"disjoint"}. During exactly that window the ' +
      'top rung stops fitting. The trap is `const gpuMs = gpu.value || 0`, which turns "I do not know" ' +
      'into "zero milliseconds of GPU work" — infinite headroom — and upshifts into the overload. ' +
      'That is `(navigator.hardwareConcurrency || 4)` wearing a different hat, and this repo gated ' +
      'bloom off on every iPhone ever made with it.',
    whyCapacityModel:
      'The defect only shows if acting on the phantom headroom COSTS something. Under a replay the ' +
      'controller can upshift on a null-read-as-zero and the intervals do not move, so the corpus ' +
      'certifies the bug. Here the rung it moves to is 21 ms and the panel starts presenting every ' +
      'other refresh.',
    requires: ['DEF-2', 'TEL-5', 'RL-1', 'RL-3'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 1,
    seed: 10006,
    jitterMs: 0.3,
    gpuInitial: 'ok',
    durationMs: recoverByMs + 4 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { disjointFromMs, disjointToMs, recoverByMs },
    samples: [
      { atMs: 0, cpuShare: 0.35, note: 'rung0 does not fit yet either; rung1 is correct', costMs: { rung0: 19.0, rung1: 11.5, rung2: 8.0 } },
      { atMs: disjointFromMs, cpuShare: 0.35, note: 'DISJOINT window: rung0 is 21 ms and the GPU timer is telling you nothing', costMs: { rung0: 21.0, rung1: 12.2, rung2: 8.4 } },
      { atMs: disjointToMs, cpuShare: 0.35, note: 'timer trustworthy again AND rung0 now genuinely fits', costMs: { rung0: 11.0, rung1: 8.4, rung2: 6.5 } },
    ],
    events: [
      { atMs: disjointFromMs, kind: 'gpu', state: 'disjoint' },
      { atMs: disjointToMs, kind: 'gpu', state: 'ok' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    // Nothing legitimises standing on rung 0 before the disjoint window closes:
    // it never fitted, and during the window there was no evidence at all.
    settlesInsideBudget(result, { fromMs: 0, toleranceMs: K.evaluationWindowMs * 2, K }),
    eventualRecovery(result, { fromMs: m.disjointToMs, toRungAtMost: 0, byMs: m.recoverByMs, K }),
  ];
}

export const discriminators = [
  { policy: 'naive-gpu', mustFail: ['INV-3'], why: 'reads a discarded result as 0 ms of GPU work and upshifts into the overload it cannot see' },
  { policy: 'static', mustPass: ['INV-3'], why: 'proves rung 1 was inside budget throughout, so INV-3 is satisfiable' },
  { policy: 'static', mustFail: ['INV-4'], why: 'and proves the recovery half is not vacuous either' },
];
