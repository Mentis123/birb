/**
 * Burst signatures.
 *
 * Every event in this game used one of two bursts, so a ring pickup, a boost
 * and a drone kill all read as the same puff of dots and the frame never told
 * you which one just happened. These give each event its own shape, colour,
 * duration and gravity — WITHOUT growing the pool, which is fixed at 6 slots
 * on mobile precisely so a firefight cannot spike the heap.
 *
 * `lift` is along the surface normal, `speed` is in the tangent plane, and
 * `gravity` is the radial pull applied over the burst's life (negative falls
 * toward the planet). `arc` is the expanding ring: 0 disables it.
 */
export const BURST_SIGNATURES = {
  // A drone dies: wide, fast, falls, double ring pulse.
  explosion: { maxAge: 0.9, size: 0.85, speed: [3, 11], lift: [-2.1, 4.9], gravity: -4, arc: 9, arcPulses: 2 },
  // Generic sparkle, kept for callers that want the old feel.
  sparkle: { maxAge: 0.65, size: 0.4, speed: [3, 5], lift: [1, 1], gravity: 0, arc: 5, arcPulses: 1 },
  // A ring collected: tight gold spiral that RISES. Reward reads as upward.
  collect: { maxAge: 0.55, size: 0.5, speed: [2.4, 4.2], lift: [2.6, 5.4], gravity: 1.6, arc: 6.5, arcPulses: 1, spiral: 2.4 },
  // Boost engaged: a short backward flare, no ring, gone before it can hide
  // anything the player is flying at.
  boost: { maxAge: 0.34, size: 0.55, speed: [5, 9], lift: [-0.6, 0.6], gravity: 0, arc: 0, arcPulses: 0 },
};

