/**
 * Scenario: boundary-interleaved-with-recurrent-hitch.
 * Wave 3 / P3.1. CONTRACT §2.1 rule 1, verbatim from the source plan:
 * "Reset all relevant history after bounded, explicitly tagged
 *  loading/resume/resize events. DO NOT ERASE RECURRENT GAMEPLAY HITCHES."
 */
import { overloadResponseDeadlineMs, noViolations, boundedResponse, recurrentHitchesRemainUnexplained, settlesInsideBudget } from '../invariants.js';

export const name = 'boundary-interleaved-with-recurrent-hitch';

export function build(K) {
  const W = K.evaluationWindowMs;
  const D = overloadResponseDeadlineMs(K);
  const onsetMs = 2 * W;
  const stormFromMs = onsetMs + 0.5 * W;   // lands INSIDE the response window
  const stormEveryMs = 200;
  const stormCount = 8;
  const events = [
    // A real, repeating gameplay stall: a periodic decorative update that
    // allocates. It is UNTAGGED, because nothing in the game tags it — that is
    // the entire distinction this scenario turns on. It begins WITH the heavier
    // scene, not at t=0: an allocating update that only exists in the heavy
    // biome is the ordinary case, and starting it before the onset would let
    // any single-frame trigger reach the bottom rung before the scenario's
    // actual subject — the boundary storm — has even begun.
    { atMs: onsetMs, kind: 'recurrentHitch', everyMs: 300, dtMs: 46 },
  ];
  for (let i = 0; i < stormCount; i += 1) {
    events.push({ atMs: stormFromMs + i * stormEveryMs, kind: 'reset', tag: 'resize' });
  }
  const secondStormAt = onsetMs + D + 3 * W;
  for (let i = 0; i < stormCount; i += 1) {
    events.push({ atMs: secondStormAt + i * stormEveryMs, kind: 'reset', tag: 'orientation' });
  }
  return {
    name,
    title: 'A resize storm during a drag, on top of a hitch that never stops',
    depicts:
      'Two things at once, both arriving with a heavier scene. A recurrent gameplay hitch — a periodic ' +
      'decorative update that allocates, firing about three times a second — which is a genuine, ' +
      'actionable, recurring cost that no boundary explains. And a burst ' +
      'of `resize` boundaries 200 ms apart, because someone is dragging the window or the browser is ' +
      'animating its chrome, followed later by an `orientation` burst. CONTRACT §2.1 rule 3 says a ' +
      'reset is bounded and idempotent, "not re-armed per event"; rule 1 says it clears the decision ' +
      'windows and NOT the recurrent-hitch log. A controller that re-arms on each boundary never ' +
      'accumulates two consecutive windows of anything and therefore never acts, while the player ' +
      'keeps hitching.',
    whyCapacityModel:
      'The reduction has to be worth making. The recurring stall is real but the sustained cost is real ' +
      'too, and only a capacity model can show that dropping a rung genuinely brings the run back ' +
      'inside budget while the hitch continues unchanged — which is what separates "responded to the ' +
      'hitch" from "responded usefully". Replayed, the hitches would repeat identically whatever the ' +
      'controller did, and a controller that erased them and one that acted on them would score alike.',
    requires: ['SM-7', 'RUL-1', 'GAP-5', 'ACC-3', 'PRO-12'],
    ladder: 'compat',
    targetFPS: 60,
    presentation: { mode: 'vsync', hz: 60 },
    startRung: 0,
    seed: 10011,
    jitterMs: 0.3,
    durationMs: secondStormAt + D + 12 * W,
    instrumentation: { perFrameMs: 0.06, perUpdateMs: 1.2 },
    // `settledByMs` is TWO response deadlines, not one: only rung 2 fits after
    // the onset, and PRO-6 makes the controller hold between adjustments, so a
    // two-step descent legitimately takes two.
    marks: { onsetMs, stormFromMs, secondStormAt, respondByMs: onsetMs + D, settledByMs: onsetMs + 2 * D },
    samples: [
      { atMs: 0, cpuShare: 0.55, note: 'comfortable base cost', costMs: { rung0: 12.0, rung1: 9.0, rung2: 7.0 } },
      { atMs: onsetMs, cpuShare: 0.55, note: 'base cost rises past the budget at rung 0 AND rung 1; only rung 2 fits, and the hitch continues on top of all three', costMs: { rung0: 21.0, rung1: 17.6, rung2: 11.0 } },
    ],
    events,
  };
}

export function invariants(result, K) {
  const m = result.marks;
  return [
    noViolations(result),
    // The behavioural half: respond DESPITE the storm of boundaries.
    boundedResponse(result, { onsetMs: m.onsetMs, K }),
    settlesInsideBudget(result, { fromMs: m.settledByMs, toleranceMs: K.evaluationWindowMs * 2, K }),
    // The evidence half: the hitches are untagged and therefore still count as
    // unexplained spikes in the export, no matter how many tagged boundaries
    // were interleaved with them.
    recurrentHitchesRemainUnexplained(result, { atLeast: K.acceptanceSpikeRecurrenceCount, K }),
  ];
}

export const discriminators = [
  { policy: 'static', mustFail: ['INV-2'], why: 'never responds; the player hitches for the whole run' },
  { policy: 'twitchy', mustPass: ['INV-2'], why: 'proves a response is reachable through the boundary storm. `naive-gpu` is NOT the passing arm here: this scene is CPU-heavy (cpuShare 0.55), so the GPU reading at rung 1 looks healthy and it climbs straight back up — it never reaches the only rung that fits, which is the second thing this scenario is about' },
];
