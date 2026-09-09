/**
 * Scenario: instrumentation-pair.
 * Wave 3 / P3.1.
 *
 * "Measure with telemetry and the panel both enabled and disabled so
 *  instrumentation does not manufacture the bottleneck."
 *
 * This is the one scenario that is RUN TWICE. See driver.runPair(), and
 * invariants INV-12 / INV-13.
 */
import { overloadResponseDeadlineMs, noViolations, boundedResponse, settlesInsideBudget } from '../invariants.js';

export const name = 'instrumentation-pair';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  const onsetMs = 5 * W;
  return {
    name,
    title: 'The same world, once with the workbench closed and once with it open',
    depicts:
      'An ordinary run with a mild degradation part-way through, so the controller has something to do. ' +
      'The two arms use an IDENTICAL capacity model; the only difference is that in the second the ' +
      'three-finger panel is open, costing a fraction of a millisecond every frame and about a ' +
      'millisecond on each of its four updates a second (PRO-14 supplies the cadence; the two costs ' +
      'are properties of this depicted device and live in the trace). Two things must hold. The panel ' +
      'must cost SOMETHING measurable — a panel whose overhead is unmeasurable is a panel nobody is ' +
      'actually measuring, and CONTRACT §3.4 makes "no per-frame DOM write" a hard rule precisely ' +
      'because this cost is real. And it must not change the DECISION, or every number ever read off ' +
      'the panel is a number about the panel.',
    whyCapacityModel:
      'The pair is a comparison of two runs of the same world, and "the same world" is only definable ' +
      'if the world is a model rather than a recording of one particular run. With recorded intervals ' +
      'the arms would be identical by construction — the panel could cost a full millisecond a frame ' +
      'and the replay would still hand back the same numbers — so the check would pass on a panel that ' +
      'halves the frame rate.',
    requires: ['DL-4', 'PRO-14', 'TEL-4', 'RUL-6'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10016,
    jitterMs: 0.25,
    durationMs: onsetMs + D + 10 * W,
    // Deliberately small: the panel is not supposed to be the bottleneck, and a
    // pair that only passes because the panel is ruinous proves nothing.
    instrumentation: { perFrameMs: 0.09, perUpdateMs: 1.6 },
    marks: { onsetMs, respondByMs: onsetMs + D },
    samples: [
      { atMs: 0, cpuShare: 0.45, note: 'comfortable', costMs: { rung0: 11.0, rung1: 8.4, rung2: 6.4 } },
      { atMs: onsetMs, cpuShare: 0.45, note: 'mild degradation: rung 0 stops fitting, rung 1 has room', costMs: { rung0: 18.5, rung1: 12.0, rung2: 9.0 } },
    ],
    events: [],
  };
}

/** Per-arm invariants. INV-12 / INV-13 are pair-level; see corpus tests. */
export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    boundedResponse(result, { onsetMs: m.onsetMs, K }),
    settlesInsideBudget(result, { fromMs: m.respondByMs, K }),
  ];
}

export const pair = true;

export const discriminators = [
  { policy: 'static', mustFail: ['INV-2'], why: 'the per-arm half is not vacuous' },
  { policy: 'twitchy', mustPass: ['INV-2'], why: 'and it is reachable' },
];
