/**
 * Scenario: cold-start-from-persisted-profile.
 * Wave 3 / P3.1.
 *
 * CONTRACT §9 DEF-1 defers the persisted learning store itself. This models
 * the COLD START — the controller being handed a conservative last-known-stable
 * profile at t=0 and having to warm up before it trusts anything — NOT the
 * store. Nothing here reads or writes localStorage, and nothing here assumes
 * the profile came from disk rather than from a URL flag or a default table.
 */
import { noViolations, noUnwarrantedAdjustment, attemptsRecoveryWhenStuck, eventualRecovery } from '../invariants.js';

export const name = 'cold-start-from-persisted-profile';

export function build(K) {
  const W = K.evaluationWindowMs;
  const warmUpMs = W;
  const recoverByMs = K.probeIntervalMs + K.restoreStabilityMaxMs + 6 * W;
  return {
    name,
    title: 'First frames of a session, starting one rung down on yesterday\'s advice',
    depicts:
      'Tap-to-Start. The controller opens on a conservative profile — one rung below the top, because ' +
      'that is what the last session settled on — and the first frames of the run are not frame rate at ' +
      'all: module evaluation, world construction, the first compile of every material. index.html\'s ' +
      'own sampler discards its first interval for exactly this reason. Once the loop is really running, ' +
      'this device turns out to have room for the top rung.',
    whyCapacityModel:
      'Two decisions have to be scoreable. Not reacting to the load spike, which needs the spike to be ' +
      'distinguishable from capacity — a replay cannot make that distinction, because in a replay a ' +
      '380 ms interval IS the capacity. And discovering the better rung, which is a question about a ' +
      'rung the run never started on.',
    requires: ['SM-2', 'DEF-1', 'RUL-1', 'RL-6', 'TEL-13'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 1,
    seed: 10012,
    jitterMs: 0.3,
    gpuInitial: 'no-extension',
    durationMs: recoverByMs + 6 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    marks: { warmUpMs, recoverByMs },
    samples: [
      { atMs: 0, cpuShare: 0.65, note: 'first second: caches cold, everything is slower than it will be', costMs: { rung0: 15.5, rung1: 12.0, rung2: 9.0 } },
      { atMs: warmUpMs, cpuShare: 0.35, note: 'warm: the top rung fits with 3 ms to spare', costMs: { rung0: 13.5, rung1: 10.0, rung2: 7.5 } },
    ],
    events: [
      { atMs: 0, kind: 'reset', tag: 'load' },
      // The load spike itself: world construction on the first frame.
      { atMs: 0, kind: 'hitch', dtMs: 380, tag: 'load' },
    ],
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    // "a short warm-up" (SM-2). Expressed as PRO-3, not as a new number: the
    // controller cannot have a full evaluation window of evidence before one
    // evaluation window has passed, so a reduction inside it is not a decision.
    noUnwarrantedAdjustment(result, {
      fromMs: 0, toMs: m.warmUpMs,
      why: 'the only over-budget frame here is the tagged `load` construction spike, and SM-2 requires a short warm-up before the first decision.',
    }),
    attemptsRecoveryWhenStuck(result, { afterMs: m.warmUpMs, K }),
    eventualRecovery(result, { fromMs: m.warmUpMs, toRungAtMost: 0, byMs: m.recoverByMs, K }),
  ];
}

export const discriminators = [
  { policy: 'twitchy', mustFail: ['INV-16'], why: 'downshifts on the 380 ms construction frame, which is not a frame rate' },
  { policy: 'static', mustPass: ['INV-16'], why: 'proves the warm-up half is satisfiable' },
  { policy: 'static', mustFail: ['INV-8', 'INV-4'], why: 'and that a controller which never probes stays on yesterday\'s profile all session' },
];
