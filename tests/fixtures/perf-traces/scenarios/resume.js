/**
 * Scenario: resume.
 * Wave 3 / P3.1.
 */
import { noViolations, noUnwarrantedAdjustment, settlesInsideBudget } from '../invariants.js';

export const name = 'resume';

export function build(K) {
  const W = K.evaluationWindowMs;
  const hideAtMs = 4 * W;
  const showAtMs = hideAtMs + 6 * W;
  return {
    name,
    title: 'The tab was hidden for six seconds and nothing is wrong',
    depicts:
      'Backgrounded app, or a tab switch. rAF stops or is throttled to a crawl; the intervals recorded ' +
      'across the gap are 900 ms each. On return there is one genuine spike — the first frame after a ' +
      'resume re-uploads and re-binds — and then the world is exactly as cheap as it was before. ' +
      'CONTRACT §2.2: those frames are marked `valid:false` with `invalidReason:"hidden"` and they are ' +
      'RETAINED, not deleted, because "a 900 ms frame while the tab was hidden is real data about the ' +
      'resume path". A controller that treats them as measurements has just permanently degraded a ' +
      'perfectly healthy device for the rest of the session.',
    whyCapacityModel:
      'Representable as fixed intervals only if the controller cannot react. It can: a downshift here ' +
      'must be visible as a permanent quality loss on a device that never needed one, and "permanent ' +
      'quality loss" is a statement about the rung the controller is standing on for the remaining ' +
      'twenty seconds — which is the capacity model, not the interval tape.',
    requires: ['RUL-2', 'SM-7', 'GAP-5', 'TEL-1'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10008,
    jitterMs: 0.3,
    durationMs: showAtMs + 20 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { hideAtMs, showAtMs },
    samples: [
      { atMs: 0, cpuShare: 0.40, note: 'comfortable, and it stays that way for the whole run', costMs: { rung0: 11.5, rung1: 8.8, rung2: 6.6 } },
    ],
    events: [
      { atMs: hideAtMs, kind: 'paused', paused: true, reason: 'hidden' },
      { atMs: showAtMs, kind: 'paused', paused: false },
      { atMs: showAtMs, kind: 'reset', tag: 'resume' },
      // The genuine resume spike, tagged, so ACC-3 can explain it. CONTRACT §2.1
      // notes the shipped code resets on HIDE rather than SHOW; the reset is
      // placed on the show edge here because that is where the plan puts it.
      { atMs: showAtMs, kind: 'hitch', dtMs: 240, tag: 'resume' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    noUnwarrantedAdjustment(result, {
      fromMs: 0,
      why: 'nothing in this trace ever exceeded the budget at any rung; every over-budget interval was either invalid (hidden) or the single tagged resume frame.',
    }),
    settlesInsideBudget(result, { fromMs: 0, K }),
  ];
}

export const discriminators = [
  { policy: 'twitchy', mustFail: ['INV-16'], why: 'downshifts on the first 900 ms hidden-tab frame — it never looks at `valid`' },
  { policy: 'static', mustPass: ['INV-16'], why: 'proves the invariant is satisfiable on this trace' },
];
