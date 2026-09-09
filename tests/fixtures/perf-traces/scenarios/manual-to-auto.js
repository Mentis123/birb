/**
 * Scenario: manual-to-auto.
 * Wave 3 / P3.1.
 */
import { overloadResponseDeadlineMs, noViolations, boundedResponse, noUnwarrantedAdjustment, settlesInsideBudget } from '../invariants.js';

export const name = 'manual-to-auto';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  const manualAtMs = 3 * W;
  const onsetMs = 4 * W;
  const resumeAutoAtMs = onsetMs + D + 4 * W;
  return {
    name,
    title: 'A human takes the panel, and the adaptive layer must keep its hands off',
    depicts:
      'Someone opens the three-finger workbench mid-flight, switches to Manual and pins the look they ' +
      'want to compare. One second later the world gets expensive. Auto is suspended, so it may not ' +
      'write — not once, not on the next frame — no matter how bad the numbers get. Later they press ' +
      'Resume Auto, which clears stale history with the `manual` reset tag, and only then may the ' +
      'controller act; and it must act on evidence gathered AFTER the reset, not on the window it was ' +
      'quietly accumulating while locked out.',
    whyCapacityModel:
      'Two halves need it. The overload the controller must not react to has to be a real overload, ' +
      'which means the cost at the pinned rung has to exceed the budget while it is pinned there. And ' +
      'after Resume Auto the response has to be scored on whether the world got cheaper, which only ' +
      'the capacity model can say. A replay would deliver its recorded 33 ms during Manual regardless ' +
      'of what the panel pinned, so pinning would be untestable.',
    requires: ['CTL-1', 'RUL-4', 'A10', 'SM-7', 'GAP-5'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10007,
    jitterMs: 0.3,
    durationMs: resumeAutoAtMs + D + 6 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { manualAtMs, onsetMs, resumeAutoAtMs, respondByMs: resumeAutoAtMs + D },
    samples: [
      { atMs: 0, cpuShare: 0.40, note: 'comfortable', costMs: { rung0: 11.0, rung1: 8.5, rung2: 6.5 } },
      { atMs: onsetMs, cpuShare: 0.35, note: 'expensive — and the panel is locked', costMs: { rung0: 27.0, rung1: 14.0, rung2: 10.0 } },
    ],
    events: [
      { atMs: manualAtMs, kind: 'mode', mode: 'manual' },
      { atMs: onsetMs, kind: 'note', text: 'overload begins while Manual holds the lock' },
      { atMs: resumeAutoAtMs, kind: 'mode', mode: 'auto' },
      { atMs: resumeAutoAtMs, kind: 'reset', tag: 'manual' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    // Includes `adaptive-write-while-locked`, which is the headline.
    noViolations(result),
    noUnwarrantedAdjustment(result, {
      fromMs: m.manualAtMs, toMs: m.resumeAutoAtMs,
      kinds: ['downshift', 'emergency', 'upshift', 'probe'],
      why: 'CONTRACT §7.1: "Once Manual is active, the adaptive tier must not write the quantities the panel owns."',
    }),
    boundedResponse(result, { onsetMs: m.resumeAutoAtMs, K }),
    settlesInsideBudget(result, { fromMs: m.respondByMs, K }),
  ];
}

export const discriminators = [
  { policy: 'compat', mustFail: ['INV-1'], why: 'the shipped policy has no mode concept at all, so it writes straight through the panel lock' },
  { policy: 'twitchy', mustFail: ['INV-1'], why: 'same, and it tries on the very first over-budget frame. Note it does NOT fail INV-16: the driver REJECTS the locked write, so nothing was adjusted — the attempt is the violation, and only INV-1 sees an attempt' },
  { policy: 'static', mustPass: ['INV-1', 'INV-16'], why: 'proves the lock half is satisfiable' },
  { policy: 'static', mustFail: ['INV-2'], why: 'and that the post-resume half is not vacuous' },
];
