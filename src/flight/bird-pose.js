/**
 * Pose blending for the bird's procedural rig.
 *
 * The rig itself lives in index.html and drives named groups directly. What
 * lives here is the pure arithmetic behind the poses — the perch fold, the
 * tumble during a knockdown, the tail's pitch response — so the timing can be
 * tested without a renderer and so the frame loop only has to read numbers.
 *
 * Nothing in this file touches THREE, the DOM, or flight physics.
 */

/**
 * Ease a 0..1 blend toward a target at a frame-rate independent rate.
 *
 * The exponential form matters: a plain `value += (target - value) * rate *
 * delta` overshoots and oscillates whenever a frame runs long, which on a
 * thermally throttled phone is exactly when it will happen.
 */
export function blendToward(current, target, delta, rate) {
  if (!Number.isFinite(current)) current = 0;
  if (!Number.isFinite(target)) return current;
  const dt = Math.max(0, Math.min(delta || 0, 0.1));
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

/**
 * The perch pose, as a fraction of the way from flying to fully folded.
 *
 * Wings fold IN and shorten, and the fold has to be gradual: snapping the
 * wings closed on the frame the nesting state flips reads as a dropped frame
 * rather than as a bird settling.
 */
export function perchPose(blend) {
  const t = Math.max(0, Math.min(1, blend || 0));
  return {
    // Radians added to each wing's base rotation, mirror-signed by the caller.
    fold: t * 0.95,
    // Wings pull in against the body rather than staying spread.
    span: 1 - t * 0.42,
    // The tail drops and narrows as the bird settles onto the nest.
    tailPitch: t * 0.28,
    tailSpread: 1 - t * 0.18,
  };
}

/**
 * Wing offset during a committed knockdown.
 *
 * A falling bird held the same steady glide posture as a cruising one, so the
 * most dramatic thing in the game read as the calmest. This is deliberately
 * ASYMMETRIC — a struggle, not a flap — and returns the two wings separately
 * because a symmetric fall looks like a controlled descent.
 */
export function tumbleFlap(elapsed, intensity = 1) {
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  const amount = Math.max(0, Math.min(1, intensity));
  // The `|| 0` normalises -0, which callers compare against 0 and which
  // Object.is — and therefore strict assertion — does not treat as equal.
  return {
    left: (Math.sin(t * 9.1) * 0.42 * amount) || 0,
    // Offset in phase and slightly different in frequency, so the two wings
    // never agree and the bird reads as out of control.
    right: (Math.sin(t * 8.3 + 2.1) * 0.36 * amount) || 0,
  };
}

/**
 * Tail pitch response, in radians.
 *
 * A real bird's tail is an elevator: it drops on a climb and lifts on a dive.
 * Positive input is a climb.
 */
export function tailPitchOffset(pitchInput) {
  const p = Number.isFinite(pitchInput) ? Math.max(-1, Math.min(1, pitchInput)) : 0;
  return (p >= 0 ? -p * 0.16 : -p * 0.12) || 0;
}

/**
 * The wing-beat cycle.
 *
 * The old flap was a symmetric sine at a fixed 6.8 Hz that ran only while
 * climbing. Nothing alive moves like that. Three things separate a bird from
 * an oscillator, and all three are cheap:
 *
 *  1. **The stroke is asymmetric.** The downstroke is the power stroke and is
 *     FAST; the upstroke is a slower recovery. A sine spends equal time in
 *     both and reads as a machine.
 *  2. **The wing folds on the way up.** A bird that kept its wing fully
 *     extended on the upstroke would push itself back down. Span pulls in on
 *     recovery and extends again for the next beat.
 *  3. **Birds flap in BURSTS.** A few beats, then a glide. Continuous
 *     flapping at a constant rate is the single most artificial thing a
 *     procedural bird can do.
 *
 * `phase01` is where we are in one beat, 0 at the top of the downstroke.
 * Returns the wing angle offset and a span multiplier.
 */
export function wingBeat(phase01) {
  const p = Number.isFinite(phase01) ? phase01 - Math.floor(phase01) : 0;
  // Downstroke occupies the first 38% of the beat and covers the full sweep;
  // the remaining 62% returns the wing more gently.
  const DOWN = 0.38;
  let sweep;
  let folding;
  if (p < DOWN) {
    // Fast power stroke, eased so it starts and ends smoothly rather than
    // snapping at the turnaround.
    const t = p / DOWN;
    sweep = -Math.sin(t * Math.PI) * 1.0;
    folding = 0;
  } else {
    // Slow recovery, and the wing draws in while it rises.
    const t = (p - DOWN) / (1 - DOWN);
    sweep = Math.sin(t * Math.PI) * 0.55;
    folding = Math.sin(t * Math.PI);
  }
  // TWIST — pronation through the downstroke, supination through the recovery.
  //
  // This is the term that separates a wing from a board, and it is the one a
  // single shoulder rotation cannot express. A real wing rotates about its own
  // long axis: leading edge DOWN on the power stroke so the surface bites, and
  // UP on the recovery so the primaries part and spill air instead of pushing
  // the bird back down.
  //
  // It deliberately does NOT track `sweep`. Twist LEADS the stroke — the wing
  // is already pronating as it starts down and is back to neutral before the
  // bottom — so the two are a quarter-beat out of phase with each other. A
  // twist proportional to sweep is the same animation under a second name and
  // could be folded into the shoulder angle; the ratio test in
  // tests/bird-pose.test.js is what holds that line.
  //
  // Peak 0.30 rad (17 degrees). Bounded well inside a right angle, because a
  // wing that rotates further than that is a propeller.
  const twist = p < DOWN
    ? Math.sin((p / DOWN) * Math.PI + Math.PI * 0.35) * 0.30
    : -Math.sin(((p - DOWN) / (1 - DOWN)) * Math.PI) * 0.22;

  // THE HAND — the outer wing, from the wrist out through the primaries.
  //
  // It trails the shoulder. A bird's wing does not swing as one piece: the
  // shoulder drives, the hand follows a fraction of a beat later, and that lag
  // is most of what the eye reads as "jointed". Modelled as the same stroke
  // shape evaluated at a retarded phase, so it cannot drift out of step with
  // the shoulder however the beat is retimed.
  //
  // 0.08 of a beat, which at the climbing rate of 4.4 beats/sec is about 18 ms
  // — small in time, clearly visible in silhouette. The lag test asserts the
  // hand's extremum lands after the shoulder's and by less than a third of a
  // beat, because a lag that large is a broken wing rather than a trailing one.
  const HAND_LAG = 0.08;
  const lagged = p - HAND_LAG - Math.floor(p - HAND_LAG);
  const handSweep = lagged < DOWN
    ? -Math.sin((lagged / DOWN) * Math.PI) * 1.0
    : Math.sin(((lagged - DOWN) / (1 - DOWN)) * Math.PI) * 0.55;

  return {
    // Radians, added to the wing's base rotation with the mirror sign rule.
    angle: sweep * 0.52,
    // Multiplier on wing span: pulled in during recovery.
    span: 1 - folding * 0.22,
    // Radians about the wing's own long axis. Positive is leading-edge-down.
    twist,
    // Radians for the outer wing group, if the model has one. A model without
    // a `hand` group ignores this and loses the articulation, not the beat —
    // which is why bird-contract.js treats `hand` as optional.
    handAngle: handSweep * 0.34,
  };
}

/**
 * Burst-and-glide cadence: how hard the bird should be beating right now.
 *
 * Returns 0 during a glide and 1 mid-burst, with short ramps so a burst does
 * not start or stop on a single frame. Deterministic in `elapsed` so it needs
 * no state and cannot drift between the two wings.
 */
export function beatEnvelope(elapsed, { burst = 1.55, glide = 1.15, ramp = 0.22 } = {}) {
  const t = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const period = burst + glide;
  const inCycle = t % period;
  if (inCycle >= burst) return 0;
  // Ramp in at the start of the burst and out at its end.
  const up = Math.min(1, inCycle / ramp);
  const down = Math.min(1, (burst - inCycle) / ramp);
  return Math.max(0, Math.min(up, down));
}
