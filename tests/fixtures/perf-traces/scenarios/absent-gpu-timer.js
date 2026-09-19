/**
 * Scenario: absent-gpu-timer.
 * Wave 3 / P3.1.
 */
import { overloadResponseDeadlineMs, noViolations, boundedProbes, boundedResponse, attemptsRecoveryWhenStuck, eventualRecovery, settlesInsideBudget } from '../invariants.js';

export const name = 'absent-gpu-timer';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  // One probe's worth of patience, plus the stability window that precedes it.
  const discoverByMs = K.probeIntervalMs + K.restoreStabilityMaxMs + 4 * W;
  const degradeMs = discoverByMs + 4 * W;
  return {
    name,
    title: 'No GPU timer at all — which is every iPhone, and CI',
    depicts:
      'Safari exposes no EXT_disjoint_timer_query_webgl2, so every GPU reading in this run is the ' +
      'sentinel {value:null, state:"unavailable", reason:"no-extension"}. The device starts one rung ' +
      'down and genuinely has room for the rung above; nothing in the delivered rate can say so, and ' +
      'there is no GPU number to consult. CONTRACT §9 DEF-2: the query lifecycle is deferred exactly ' +
      'because it ships on its null branch here, and "the bounded-probe fallback has to work anyway ' +
      'and is what will actually run — it is NOT deferred."',
    whyCapacityModel:
      'The probe is the only instrument left, and a probe is a question about a rung the controller is ' +
      'not standing on. A recorded array has no answer to it: replayed, the intervals after the probe ' +
      'are the intervals that were recorded before it, so the probe always "succeeds" and the corpus ' +
      'cannot tell a controller that discovered headroom from one that hallucinated it.',
    requires: ['DEF-2', 'TEL-5', 'SM-3', 'RL-6', 'PRO-8'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 1,
    seed: 10005,
    jitterMs: 0.3,
    gpuInitial: 'no-extension',
    durationMs: degradeMs + D + 8 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { discoverByMs, degradeMs, respondByMs: degradeMs + D },
    samples: [
      { atMs: 0, cpuShare: 0.35, note: 'rung0 fits with 2.5 ms to spare — a probe upward SUCCEEDS here', costMs: { rung0: 14.1, rung1: 10.0, rung2: 7.2 } },
      { atMs: degradeMs, cpuShare: 0.35, note: 'weather rolls in; rung0 no longer fits', costMs: { rung0: 22.5, rung1: 13.2, rung2: 9.4 } },
    ],
    events: [
      { atMs: 0, kind: 'gpu', state: 'no-extension' },
      { atMs: degradeMs, kind: 'note', text: 'capacity degrades; the earlier upgrade must now come back off' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    boundedProbes(result, { K }),
    attemptsRecoveryWhenStuck(result, { afterMs: 0, byMs: m.discoverByMs, K }),
    eventualRecovery(result, { fromMs: 0, toRungAtMost: 0, byMs: m.discoverByMs, K }),
    boundedResponse(result, { onsetMs: m.degradeMs, K }),
    settlesInsideBudget(result, { fromMs: m.respondByMs, K }),
  ];
}

export const discriminators = [
  { policy: 'static', mustFail: ['INV-8', 'INV-4'], why: 'never probes, so the available rung is never found and the game stays degraded for the session' },
  { policy: 'naive-gpu', mustPass: ['INV-8'], why: 'proves an upgrade attempt is reachable here — though it reaches it for the wrong reason (`gpu.value || 0`), which disjoint-gpu-results punishes' },
];
