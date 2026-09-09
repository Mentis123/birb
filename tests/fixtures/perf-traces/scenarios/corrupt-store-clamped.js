/**
 * Scenario: corrupt-store-clamped.
 * Wave 3 / P3.1.
 */
import { noViolations, startProfileClamped, settlesInsideBudget } from '../invariants.js';

export const name = 'corrupt-store-clamped';

export function build(K) {
  const W = K.evaluationWindowMs;
  return {
    name,
    title: 'The stored profile is nonsense and must be clamped, not obeyed',
    depicts:
      'A cold start whose stored profile says rung 97 on a three-rung ladder. Real causes, all of them ' +
      'ordinary: a build that shortened the ladder, a hand-edited localStorage entry, a URL flag typed ' +
      'wrong, a schema that changed under a value written by an older version. The plan is explicit ' +
      'that runtime learning is "restricted to approved settings ranges", and CONTRACT §9 DEF-1 is ' +
      'equally explicit that the store itself is deferred — so what is tested here is the CLAMP, at the ' +
      'boundary where untrusted input arrives, not a persistence layer.',
    whyCapacityModel:
      'Honestly: the clamp alone is representable as fixed intervals. The capacity model is needed for ' +
      'the second half — that after clamping, the run has to behave normally, at a rung whose cost the ' +
      'model supplies. A trace that only proved "it did not crash" would pass on a controller that ' +
      'clamped to the WRONG end of the ladder and ran the whole session on the bottom rung.',
    requires: ['RL-5', 'DEF-1', 'RUL-3', 'CTL-3'],
    ladder: 'compat',
    targetFPS: 60,
    // Deliberately far outside the ladder. This is the one scenario allowed to
    // do that, and schema.js requires the flag below rather than guessing.
    startRung: 97,
    allowOutOfRangeStart: true,
    presentation: { mode: 'vsync', hz: 60 },
    seed: 10013,
    jitterMs: 0.3,
    durationMs: 20 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: {},
    samples: [
      { atMs: 0, cpuShare: 0.40, note: 'every rung fits; the only question is which one the controller believes it is on', costMs: { rung0: 12.5, rung1: 9.5, rung2: 7.0 } },
    ],
    events: [],
  };
}

export function invariants(result, K) {
  return [
    startProfileClamped(result),
    noViolations(result),
    settlesInsideBudget(result, { fromMs: 0, K }),
  ];
}

export const discriminators = [
  { policy: 'naive-gpu', mustFail: ['INV-11', 'INV-1'], why: 'applies ctx.startProfile.rung verbatim: untrusted input straight through to the renderer' },
  { policy: 'fixed-0', mustPass: ['INV-11'], why: 'proves the invariant passes for a controller that names a rung inside the ladder' },
];
