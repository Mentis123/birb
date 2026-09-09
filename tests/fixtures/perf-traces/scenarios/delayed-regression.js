/**
 * Scenario: delayed-regression.
 * Wave 3 / P3.1.
 *
 * "Continue a longer watchdog after accepting a change: improved average
 *  timing must not conceal worse tail latency, input responsiveness, resource
 *  growth or visible instability. Revoke acceptance if delayed regressions
 *  appear."
 */
import { budgetMs } from '../../../../src/game/perf-constants.js';
import { overloadResponseDeadlineMs, noViolations, attemptsRecoveryWhenStuck, boundedResponse, settlesInsideBudget } from '../invariants.js';

export const name = 'delayed-regression';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  const B = budgetMs(60);

  // The upgrade must have time to be found and accepted before the world
  // starts drifting, or the scenario tests the upgrade rather than the
  // watchdog. One probe interval plus a stability window.
  const acceptByMs = K.probeIntervalMs + K.restoreStabilityMaxMs + 4 * W;
  const rampFromMs = acceptByMs + 4 * W;
  const rampToMs = rampFromMs + 5 * K.restoreStabilityMaxMs / 3;   // a slow thermal drift
  const rung0From = 13.0;
  const rung0To = 24.0;

  // Where the top rung stops fitting. COMPUTED from the model, never written
  // down: a hand-typed crossing time silently becomes wrong the moment either
  // endpoint or the target rate is retuned.
  const f = (B - rung0From) / (rung0To - rung0From);
  const regressionMs = rampFromMs + f * (rampToMs - rampFromMs);

  return {
    name,
    title: 'The upgrade was right when it was made and wrong twenty seconds later',
    depicts:
      'A cool device with room to spare. The controller finds the top rung, probes into it, and the ' +
      'probe is genuinely correct — for a while. Then the phone warms up in a pocket-warm hand and the ' +
      'same rendering work slowly gets more expensive, crossing the budget with no event, no boundary ' +
      'and no discontinuity to notice. Nothing here is a mistake at the moment it is made; the failure ' +
      'is only visible to something that kept watching after it said yes. And the plan is emphatic ' +
      'about what may NOT be reported: "sustained slowdown", not a claimed temperature measurement.',
    whyCapacityModel:
      'The regression IS a change in the cost of the rung the controller chose. Expressed as recorded ' +
      'intervals the drift is inseparable from the choice: a controller that had stayed one rung down ' +
      'would replay the same rising intervals and be blamed for a regression it never caused, and one ' +
      'that upgraded would be credited with the identical numbers.',
    requires: ['RL-4', 'RL-6', 'DL-4', 'SM-7'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 1,
    seed: 10014,
    jitterMs: 0.3,
    gpuInitial: 'no-extension',
    // The ramp's far end must be inside the run, or the last capacity sample is
    // dead data the trace never reaches. It is a max() rather than a sum
    // because which of the two is later depends on the constants: retune PRO-4
    // and the crossing moves relative to the end of the drift.
    durationMs: Math.max(regressionMs + D, rampToMs) + 10 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { acceptByMs, rampFromMs, rampToMs, regressionMs, respondByMs: regressionMs + D },
    samples: [
      { atMs: 0, cpuShare: 0.35, note: 'cool: the top rung fits with 3.6 ms to spare', costMs: { rung0: rung0From, rung1: 9.8, rung2: 7.4 } },
      { atMs: rampFromMs, interpolate: true, cpuShare: 0.35, note: 'thermal drift begins — linear, silent, no event', costMs: { rung0: rung0From, rung1: 9.8, rung2: 7.4 } },
      { atMs: rampToMs, cpuShare: 0.35, note: 'warm: the top rung is 24 ms and the rung below is still fine', costMs: { rung0: rung0To, rung1: 14.2, rung2: 10.0 } },
    ],
    events: [
      { atMs: rampFromMs, kind: 'note', text: 'sustained slowdown begins (NOT a temperature claim)' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    // Half one: it has to have gone up in the first place, or there is no
    // acceptance to revoke and the scenario passes for the wrong reason.
    attemptsRecoveryWhenStuck(result, { afterMs: 0, byMs: m.acceptByMs, K }),
    // Half two: the watchdog.
    // Baseline and search window both start where the drift starts: reacting a
    // little before the nominal crossing is BETTER behaviour, and must not be
    // read as "the rung it was already on" and then held against it.
    boundedResponse(result, { onsetMs: m.regressionMs, searchFromMs: m.rampFromMs, baselineAtMs: m.rampFromMs, K }),
    settlesInsideBudget(result, { fromMs: m.respondByMs, K }),
  ];
}

export const discriminators = [
  { policy: 'fixed-0', mustFail: ['INV-2', 'INV-3'], why: 'accepted the top rung and stopped watching: the classic missing post-acceptance watchdog' },
  { policy: 'static', mustFail: ['INV-8'], why: 'never went up, so it never had an acceptance to revoke — the scenario must not pass by never trying' },
  { policy: 'naive-gpu', mustPass: ['INV-2'], why: 'proves the revocation deadline is reachable. `twitchy` is not usable as the passing arm: the drift crosses the budget so gradually that its single-frame trigger fires at the crossing itself, which is the onset, and boundedResponse measures from the rung in force AT the onset' },
  { policy: 'probe-only', mustPass: ['INV-8'], why: 'proves the acceptance half is reachable inside acceptByMs' },
];
