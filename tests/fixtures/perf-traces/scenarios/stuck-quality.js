/**
 * Scenario: stuck-quality.
 * Wave 3 / P3.1. Named in docs/ULTRACODE_PERFORMANCE_PLAN.md §4 Wave 3:
 * "30 s stable-but-degraded must produce a bounded probe — permanent
 *  degradation is the plan's named anti-success".
 */
import { noViolations, boundedProbes, attemptsRecoveryWhenStuck, eventualRecovery, noPersistentOscillation } from '../invariants.js';

export const name = 'stuck-quality';

export function build(K) {
  const W = K.evaluationWindowMs;
  // Two rungs to climb; PRO-4 says one small step at a time and PRO-8 caps the
  // probe rate, so the deadline is two probe intervals plus a stability window.
  const recoverByMs = 2 * K.probeIntervalMs + K.restoreStabilityMaxMs + 4 * W;
  return {
    name,
    title: 'Stable, degraded, and nothing will ever ask whether it still needs to be',
    depicts:
      'The controller is on the bottom rung — put there by an emergency during a loading spike thirty ' +
      'seconds ago, or by a stale cold-start profile. Since then the device has been idle-cool and every ' +
      'rung fits with room to spare. Delivered frame rate is a flat 60 and has been for the whole run, ' +
      'so no overload rule will ever fire, no timer disagrees, and there is no GPU query on this device ' +
      'to reveal the headroom. Without a deliberate, bounded probe the game simply stays ugly for the ' +
      'rest of the session. RL-6: "A stable frame rate with permanently poor quality is not success: ' +
      'schedule occasional safe recovery probes."',
    whyCapacityModel:
      'The probe has to be able to SUCCEED, and success means the frame at the better rung still fits. ' +
      'A recorded array cannot express "rung 0 would have cost 12 ms", so a corpus built from one can ' +
      'only ever check that a probe was ISSUED, never that issuing it was right — and a controller that ' +
      'probes into an overload every thirty seconds passes that check.',
    requires: ['RL-6', 'SM-3', 'PRO-8', 'DEF-2', 'PNL-4'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 2,
    seed: 10010,
    jitterMs: 0.25,
    gpuInitial: 'no-extension',
    durationMs: recoverByMs + 6 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { recoverByMs },
    samples: [
      { atMs: 0, cpuShare: 0.35, note: 'every rung fits, comfortably, for the entire run', costMs: { rung0: 12.0, rung1: 9.0, rung2: 6.8 } },
    ],
    events: [],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    boundedProbes(result, { K }),
    attemptsRecoveryWhenStuck(result, { afterMs: 0, K }),
    eventualRecovery(result, { fromMs: 0, toRungAtMost: 0, byMs: m.recoverByMs, K }),
    noPersistentOscillation(result, { K }),
  ];
}

export const discriminators = [
  { policy: 'static', mustFail: ['INV-8', 'INV-4'], why: 'the anti-success itself: stable, degraded, and never asks again' },
  { policy: 'probe-only', mustPass: ['INV-8', 'INV-7', 'INV-4'], why: 'proves a PRO-8-rate-limited probe can climb both rungs inside the deadline' },
];
