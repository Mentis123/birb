/**
 * Scenario: scene-change.
 * Wave 3 / P3.1.
 */
import { overloadResponseDeadlineMs, noViolations, boundedResponse, sceneChangeNotCredited, settlesInsideBudget } from '../invariants.js';

export const name = 'scene-change';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  const switchAtMs = 5 * W;
  return {
    name,
    title: 'A biome switch: hundreds of milliseconds of synchronous work, then a different world',
    depicts:
      'Forest to mountain. The rebuild is a single ~420 ms frame of synchronous construction — index.html ' +
      'already calls frameSampler.reset() there and says so in a comment — and on the other side of it ' +
      'the scene is genuinely more expensive: snow, more instanced peaks, a colder mist. Two separate ' +
      'obligations. The construction frame is a tagged boundary and must not be read as capacity. And ' +
      'no measurement may be compared ACROSS it: RL-3, "a flight into a quieter area must not be ' +
      'credited to the adjustment. Mark changing scenes ... as inconclusive."',
    whyCapacityModel:
      'The whole hazard is that the world changed under the measurement. A fixed interval replay has ' +
      'exactly one world in it — the one that was recorded — so "was this improvement mine or the ' +
      'scene\'s?" is a question it cannot pose, and every A/B in it is trivially attributable.',
    requires: ['SM-7', 'RL-3', 'GAP-5', 'CTL-1'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10009,
    jitterMs: 0.3,
    durationMs: switchAtMs + D + 10 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { switchAtMs, respondByMs: switchAtMs + D },
    samples: [
      { atMs: 0, cpuShare: 0.40, note: 'forest, comfortable at tier 0', costMs: { rung0: 11.0, rung1: 8.5, rung2: 6.5 } },
      { atMs: switchAtMs, cpuShare: 0.42, note: 'mountain: tier 0 no longer fits, tier 1 does', costMs: { rung0: 20.5, rung1: 13.0, rung2: 9.2 } },
    ],
    events: [
      { atMs: switchAtMs, kind: 'reset', tag: 'environment' },
      { atMs: switchAtMs, kind: 'hitch', dtMs: 420, tag: 'environment' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    sceneChangeNotCredited(result, { K }),
    boundedResponse(result, { onsetMs: m.switchAtMs, K }),
    settlesInsideBudget(result, { fromMs: m.respondByMs, K }),
  ];
}

/**
 * A function of K, not a constant, for the same reason everything else in this
 * package is: the boundary sits at 5 x PRO-3, so the beat that lands an upshift
 * inside the window straddling it has to be derived from PRO-3 too. `thrash`
 * alternates down/up, so its upshifts fall on EVEN multiples of its beat, and
 * 2 x 2.6W = 5.2W is inside [5W, 6W] for any value of W.
 */
export function discriminators(K) {
  return [
    { policy: 'thrash', opts: { everyMs: 2.6 * K.evaluationWindowMs }, mustFail: ['INV-15'], why: 'upshifts on its own beat, so one lands inside the window that straddles the boundary and is credited to evidence spanning two worlds' },
    { policy: 'static', mustPass: ['INV-15'], why: 'proves INV-15 is satisfiable' },
    { policy: 'static', mustFail: ['INV-2'], why: 'and that the response half is not vacuous' },
  ];
}
