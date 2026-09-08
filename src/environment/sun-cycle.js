/**
 * A slow time of day.
 *
 * The key light and sky palette are fixed per biome, so a ten-minute session
 * looks identical at minute one and minute ten. Rotating the sun is the
 * cheapest way to make a world feel like a place rather than a diorama: one
 * light position per frame, no new geometry, no new pass.
 *
 * Everything downstream already follows the key light — the sky dome's sun
 * disc, the water's specular highlight, the mist tint — so they come free.
 *
 * Deliberately constrained:
 *
 *  - **Never below the horizon.** The elevation floor keeps the world lit.
 *    A night cycle sounds appealing and would leave a player unable to see
 *    the terrain they are flying into, on a phone, outdoors, in daylight.
 *  - **Azimuth only past the peak**, so the sun sweeps rather than bobbing
 *    up and down through the same arc.
 *  - **Slow enough to be felt, not watched.** A full cycle is minutes. If a
 *    player can see it moving, it reads as a broken clock rather than as
 *    time passing.
 *
 * Pure: no THREE, no DOM. The caller applies the returned direction.
 */

export const SUN_CYCLE_DEFAULTS = {
  // Seconds for a full revolution. Ten minutes: a session sees roughly one
  // sweep, two players a minute apart see slightly different worlds.
  periodSeconds: 600,
  // Radians above the horizon at the lowest point of the cycle. Below about
  // 0.30 the terrain's own slopes start falling into full shadow.
  minElevation: 0.34,
  maxElevation: 1.02,
};

/**
 * Sun direction at a given time, as a unit-ish vector in the same space the
 * key light's position uses (Three treats a directional light's position as
 * the direction it shines FROM).
 *
 * Returns plain numbers so the caller can copy them into a pre-allocated
 * vector without this module allocating anything.
 */
export function sunDirectionAt(seconds, options = {}) {
  const { periodSeconds, minElevation, maxElevation } = { ...SUN_CYCLE_DEFAULTS, ...options };
  const t = Number.isFinite(seconds) ? seconds : 0;
  const period = periodSeconds > 0 ? periodSeconds : SUN_CYCLE_DEFAULTS.periodSeconds;
  const phase = (t / period) * Math.PI * 2;

  // Elevation rides a raised cosine between the two limits, so the sun climbs
  // to a noon and settles back toward a low golden angle without ever setting.
  const climb = (1 - Math.cos(phase)) * 0.5;
  const elevation = minElevation + (maxElevation - minElevation) * climb;

  // Azimuth advances continuously; the sun sweeps around rather than
  // retracing the same arc back and forth.
  const azimuth = phase;

  const cosE = Math.cos(elevation);
  return {
    x: Math.cos(azimuth) * cosE,
    y: Math.sin(elevation),
    z: Math.sin(azimuth) * cosE,
    // 0 at the low golden angle, 1 at the top of the cycle. Callers use it to
    // lift ambient a little at noon and warm the key light near the horizon.
    height: climb,
  };
}

/**
 * Warmth multiplier for the key light: warmer and slightly dimmer when the
 * sun is low, cooler and brighter at the top of the cycle. Mirrors what real
 * light does without needing a colour temperature model.
 */
export function sunWarmth(height) {
  const h = Number.isFinite(height) ? Math.max(0, Math.min(1, height)) : 0;
  return {
    // Low sun is redder: the blue channel drops furthest.
    r: 1,
    g: 0.90 + 0.10 * h,
    b: 0.72 + 0.28 * h,
    intensity: 0.86 + 0.28 * h,
  };
}
