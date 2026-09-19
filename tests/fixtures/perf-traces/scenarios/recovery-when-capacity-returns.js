/**
 * Scenario: recovery-when-capacity-returns.
 * Wave 3 / P3.1. The regression a fixed interval replay structurally cannot express.
 */
import { overloadResponseDeadlineMs, noViolations, boundedResponse, eventualRecovery } from '../invariants.js';

export const name = 'recovery-when-capacity-returns';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  const onsetMs = 3 * W;
  const returnMs = onsetMs + D + 4 * W;
  const recoverByMs = returnMs + K.restoreStabilityMaxMs + 4 * W;
  return {
    name,
    title: 'Capacity comes back, and the quality has to come back with it',
    depicts:
      'The same valley dive as `overload`, but the bird climbs out again. Once the mist and the wet ' +
      'ground are behind it the device has headroom to spare, and a controller that shed the post pass ' +
      'and never restored it has quietly made the game worse for the rest of the session.',
    whyCapacityModel:
      'This is the scenario that proves the point. Under a recorded interval replay the intervals after ' +
      'the climb-out are whatever was recorded, so a controller that restored and one that did not both ' +
      'read the same numbers — the trace has no way to say "you are now paying 26 ms again because you ' +
      'went back up". Restoration can only be scored against a model that knows the cost at every rung.',
    requires: ['SM-3', 'RL-4', 'RL-6', 'ACC-4'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10002,
    jitterMs: 0.35,
    durationMs: recoverByMs + 4 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { onsetMs, returnMs, recoverByMs },
    samples: [
      { atMs: 0, cpuShare: 0.40, note: 'comfortable', costMs: { rung0: 10.5, rung1: 8.2, rung2: 6.2 } },
      { atMs: onsetMs, cpuShare: 0.35, note: 'overload', costMs: { rung0: 26.5, rung1: 14.0, rung2: 10.0 } },
      { atMs: returnMs, cpuShare: 0.40, note: 'climbed out; every rung fits again, with room', costMs: { rung0: 10.0, rung1: 7.8, rung2: 6.0 } },
    ],
    events: [
      { atMs: onsetMs, kind: 'note', text: 'capacity collapses' },
      { atMs: returnMs, kind: 'note', text: 'capacity returns' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    boundedResponse(result, { onsetMs: m.onsetMs, K }),
    eventualRecovery(result, { fromMs: m.returnMs, toRungAtMost: 0, byMs: m.recoverByMs, K }),
  ];
}

export const discriminators = [
  { policy: 'twitchy', mustFail: ['INV-4'], why: 'downshifts and never restores: permanent degradation, the plan\'s named anti-success' },
  { policy: 'naive-gpu', mustPass: ['INV-4'], why: 'proves recovery is reachable inside the deadline' },
  { policy: 'static', mustFail: ['INV-2'], why: 'never responds at all' },
];
