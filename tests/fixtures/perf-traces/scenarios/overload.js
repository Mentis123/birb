/**
 * Scenario: overload.
 * Wave 3 / P3.1. See ../README.md for the shape and ../schema.js for the fields.
 */
import { overloadResponseDeadlineMs, noViolations, boundedResponse, settlesInsideBudget } from '../invariants.js';

export const name = 'overload';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  const onsetMs = 4 * W;
  return {
    name,
    title: 'Sustained overload arrives and the controller has to shed something',
    depicts:
      'Level flight in the forest at full quality, then a boost burst down into a carved valley: ' +
      'the waterfall mist, the wet ground shader and three times the overdraw all arrive at once and ' +
      'the frame stops fitting. Nothing recovers on its own. This is the base case of the whole programme.',
    whyCapacityModel:
      'The reduction has to make the NEXT frame cheaper, and only a capacity model can say by how much. ' +
      'Replayed as a recorded interval array the trace would deliver 33 ms whether the controller shed ' +
      'the post pass, shed nothing, or turned everything up — so "it responded" and "it responded ' +
      'usefully" would be indistinguishable, and settlesInsideBudget would be unwritable.',
    requires: ['SM-2', 'SM-5', 'RL-1', 'RL-2', 'RL-4', 'GAP-2'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10001,
    jitterMs: 0.35,
    durationMs: onsetMs + D + 6 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { onsetMs, respondByMs: onsetMs + D },
    samples: [
      { atMs: 0, cpuShare: 0.40, note: 'level flight, everything fits at tier 0', costMs: { rung0: 11.0, rung1: 8.6, rung2: 6.4 } },
      { atMs: onsetMs, cpuShare: 0.35, note: 'valley dive: fill rate triples, tier 0 no longer fits', costMs: { rung0: 26.0, rung1: 14.4, rung2: 10.2 } },
    ],
    events: [
      { atMs: onsetMs, kind: 'note', text: 'overload onset' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    boundedResponse(result, { onsetMs: m.onsetMs, K }),
    settlesInsideBudget(result, { fromMs: m.respondByMs, K }),
  ];
}

export const discriminators = [
  { policy: 'static', mustFail: ['INV-2', 'INV-3'], why: 'a controller whose decisions never reach the renderer — this repo shipped exactly that' },
  { policy: 'twitchy', mustPass: ['INV-2'], why: 'proves the deadline is reachable, so INV-2 is not vacuously failing' },
];
