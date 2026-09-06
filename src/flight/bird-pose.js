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
