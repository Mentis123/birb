/**
 * air-field.js — air with structure.
 *
 * Until this module the air over the planet was a vacuum with a sink rate:
 * the stunt model's `sinkRate()` is what is left of gravity when the WING is
 * not carrying the bird, and nothing else moved it. Real air has structure —
 * columns of it rise off sunlit ground, it is shoved upward where a wind meets
 * a slope, and it never holds still — and all three are the free altitude a
 * bird actually flies on. The owner's own words set the tuning brief for this
 * whole controller ("it stalls way too much ... it's no longer a fun relaxing
 * experience", G-STUNT-1): rising air is the relaxed way UP.
 *
 * ONE FIELD, THREE READERS. The same object answers the flight ("how fast is
 * the air rising here"), the scenery ("how hard is the wind blowing the trees
 * this frame") and the pose ("is a gust hitting the wings"), so what the
 * player feels and what the canopy does cannot disagree about the weather.
 *
 *  - THERMALS — Allen 2006, NASA Dryden, "Updraft Model for Development of
 *    Autonomous Soaring Uninhabited Air Vehicles" (AIAA 2006-1510), Appendix
 *    B, line for line: the mean updraft w̄ = w*·(z/zi)^(1/3)·(1 − 1.1·z/zi),
 *    the outer radius r2 = max(10, 0.102·(z/zi)^(1/3)·(1 − 0.25·z/zi)·zi),
 *    r1/r2 from r2, the bell-shaped core from the paper's own shape table,
 *    the sinking ring at the edge of the upper half of the layer, and a sink
 *    between thermals — the paper's own formula in `allenUpdraftAt`, SOLVED
 *    for exact balance on this planet in the field (see "the sink between
 *    thermals", measured -0.017 -> 0.001 units/s planet mean). MAPPED onto
 *    a 120-radius planet: heights by `zi` (world units — the updraft reaches
 *    zero at 0.909·zi and is EXACTLY zero at and above zi), radii by
 *    `unitsPerMetre` against a `ziMetres` boundary layer, because the paper's
 *    thermals are 60-110 m across and this planet's horizon is 44 units away.
 *    Heights and radii are scaled separately on purpose: the flight band is
 *    sixty units deep, and a thermal squashed to fit it would be two units
 *    wide.
 *  - RIDGE LIFT — Bohrer et al. 2012 (Ecology Letters 15:96): orographic
 *    updraft w = U·sin(θ)·cos(α − β), wind speed times the slope's sine times
 *    the cosine between the wind and the slope's facing. In vectors that is
 *    (V · ∇h) / sqrt(1 + |∇h|²), which is what is computed, from finite
 *    differences of the SAME terrain sampler the flight floor uses. Windward
 *    lifts and the lee sinks by the same formula — the wind turns about an
 *    axis, so it is divergence-free on the sphere and the two cancel over any
 *    closed piece of ground (see `leeFactor` for the ratchet a damped lee
 *    measured). Both decay with height and are gone at `zi`.
 *  - GUSTS — Dryden-like: one first-order filtered white noise per axis
 *    (along-wind, cross-wind, vertical), discretised EXACTLY for any frame
 *    time (x ← a·x + σ·sqrt(1 − a²)·N(0,1), a = e^(−dt/τ), τ = L/U), so the
 *    statistics do not depend on the frame rate. Gusts drive VISUALS ONLY:
 *    the foliage wind uniform and a published gust value. They never touch
 *    the flight path — a gust that moved the bird would be a random input the
 *    player did not make, which on this stick is indistinguishable from lag.
 *
 * UP IS RADIAL. Every "vertical" here is along the planet's outward normal at
 * the point asked about, and the wind lives in the local tangent plane.
 *
 * NOTHING HERE TOUCHES THE FLOOR. The terrain floor is a gravity-less MINIMUM
 * radius that only ever carves down (CLAUDE.md, "Fly-INTO-valleys") and this
 * module never reads or writes it — it returns an air velocity and the flight
 * controller moves the bird by it, the same way it applies the sink. Every
 * NEGATIVE value is also tapered to zero at the floor's own clearance
 * (`floorClearance`), so sinking air can bring a bird DOWN toward the ground
 * but never push it into the floor, where the landing check is a coin toss
 * (CLAUDE.md, "A level bird cannot land").
 *
 * EVERYTHING IS BOUNDED: at most `maxUp` up, `maxDown` down, and exactly zero
 * at and above `zi` over the local ground — so a bird flying above sixty units
 * (every figure in tools/birb-stunt.mjs is flown at 220) is untouched.
 *
 * Pure: no THREE, no DOM. Zero allocation in `update()` and `sample()`:
 * scalars and pre-allocated state only.
 */

import { mulberry32, hashSeed } from '../environment/seeded-random.js';

/**
 * `?air=0` is the true before: no field, no sampler on the flight, no wind in
 * the mountain pines, the foliage uniform the bare decorative density. Same
 * convention as every other opt-out in this codebase (src/ui/boot-flags.js).
 */
export function airRequested(search) {
  return !/[?&]air=0(?:&|$)/.test(search || '');
}

/**
 * Allen 2006, Appendix B, `Kshape`: [r1/r2, k1, k2, k3, k4]. The paper's
 * fifth column is never read by its own code and is omitted. The profile is
 *   ws = 1 / (1 + (k1·|r/r2 + k3|)^k2) + k4·(r/r2),   clamped at 0.
 */
export const ALLEN_SHAPES = Object.freeze([
  Object.freeze([0.14, 1.5352, 2.5826, -0.0113, -0.1950]),
  Object.freeze([0.25, 1.5265, 3.6054, -0.0176, -0.1265]),
  Object.freeze([0.36, 1.4866, 4.8356, -0.0320, -0.0818]),
  Object.freeze([0.47, 1.2042, 7.7904, 0.0848, -0.0445]),
  Object.freeze([0.58, 0.8816, 13.9720, 0.3404, -0.0216]),
  Object.freeze([0.69, 0.7067, 23.9940, 0.5689, -0.0099]),
  Object.freeze([0.80, 0.6189, 42.7965, 0.7157, -0.0033]),
]);

/**
 * One tuning table. Every number is a start point chosen against the stunt
 * model's own scales (cruise 11, a knife edge sinks 3.4, a 60-degree bank
 * sinks 1.4), not a measurement from the phone.
 */
export const AIR_FIELD_DEFAULTS = Object.freeze({
  // ---- the convective layer ----
  // Its depth in WORLD units above the local ground. The mean updraft is zero
  // at 0.909·zi, a weak sinking cap sits between that and zi, and at and
  // above zi everything is exactly zero — the stunt harness flies at 220.
  zi: 60,
  // The boundary layer the profile's SHAPE is taken from, in the paper's own
  // metres. Only radii and r1/r2 read it; heights are `zi`.
  ziMetres: 1200,
  // Allen's radii (metres) onto this world, SOLVED against the stunt law's
  // own turning circle rather than chosen. Measured on BirdFlightStunt: a
  // banked pull settles into a turn of radius 24-30 units at 0.3-0.5 of
  // stick and 19 at 0.6. At 0.36 (r2 = 26 fifteen units up) that circle rode
  // the thermal's rim, where Allen's bell has almost nothing left: +0.06 to
  // +0.46 units/s averaged round a 24-unit circle, 10-30 units up. At 0.45
  // (r2 = 33 at 15 up, 38 at 30) the same circle is inside the bell, +0.47
  // to +0.87, and a 20-unit one gets +0.90 to +1.28. A literal metre-for-
  // unit map would be a 10-unit pin nobody could circle in at an 11-unit
  // cruise.
  unitsPerMetre: 0.45,
  // Convective velocity scale, world units/s. The core peaks at about
  // 1.08·w* (at z ≈ 0.23·zi with this r1/r2), so 2.2 is a 2.4 core: enough
  // to out-climb a 45-degree bank's 0.57 sink, not enough to out-climb a
  // knife edge's 3.4.
  wstar: 2.2,
  // Eight, not ten, BECAUSE they are wider: what the thermals carry up the
  // environment carries down between them, so the sink between thermals
  // scales with the share of the planet they cover. Eight at 0.45 cover 16%
  // of it (ten at 0.36 covered 13%). Under a world-fixed sun about half of
  // them are lit — the far side is night — and the sink between measured
  // 0.05 units/s. Under the planet sun (sun-frame.js, the shipping default)
  // every thermal sees the sun at the bird's own elevation, so all eight are
  // lit and the sink between them measured 0.11-0.14 units/s at 10-30 up on
  // the real terrain: a sixth of the 0.76 G-STUNT-1 removed from relaxed
  // flight, and paid back in the cores. This, `wstar` and `unitsPerMetre`
  // are the knobs if it nags (`?airtune=`).
  thermalCount: 8,
  // Great-circle spacing between thermal sites, radians (0.8 rad is 96 units
  // of arc on a 120 planet, about two horizons). Only the NEAREST thermal is
  // ever evaluated, so the spacing has to clear a mean thermal's sinking
  // ring (2 r2 = 82 at the top of the layer): where two rings overlapped,
  // the handover at the bisector would be a step, not a blend.
  minSeparation: 0.8,
  candidates: 480,
  // Per-thermal perturbations, Allen's `wgain` / `rgain`.
  wgainMin: 0.8, wgainMax: 1.2,
  rgainMin: 0.85, rgainMax: 1.2,
  // Site choice. Depth below the plateau at which the ground counts as fully
  // sheltered: the forest's own tree line (spherical-world.js, `exposure`)
  // dwarfs and thins trees on the exposed tops and packs the valleys, so high
  // ground IS the low-canopy ground here, and it is decided by the terrain,
  // which is deterministic — the tree scatter is not, unless the world seed
  // is pinned.
  exposureDepth: 24,
  // Finite-difference spacing for a site's slope normal, world units.
  siteSpacing: 8,
  // Sun heating. A site's heat is its insolation (its own SLOPE normal
  // against the live sun, so a slope facing the sun is the stronger thermal
  // and one facing away goes quiet) through w* ∝ (heat flux)^(1/3), the
  // convective scaling w* = (g/θ · H · zi)^(1/3). `heatRef` is the
  // insolation that reads as 1.0 (a 55-degree sun on flat ground).
  heatRef: 0.82,
  heatFade: 0.12,
  heatMax: 1.15,
  // ---- ridge lift ----
  // Mean wind at the surface, world units/s (about a third of cruise).
  windSpeed: 3.2,
  // The prevailing wind turns about an axis that itself precesses, so the
  // wind at any spot VEERS slowly (by up to `windTilt` over `windVeerPeriod`
  // seconds). Within `calm` (sine of the angle) of the axis the wind dies to
  // nothing — two slow-moving calm eyes, the price of a smooth wind field on
  // a sphere (you cannot comb a hairy ball flat).
  windTilt: 0.5,
  windVeerPeriod: 1200,
  windBreathe: 0.15,
  windBreathePeriod: 170,
  calm: 0.35,
  ridgeSpacing: 5,
  // Ridge lift decays as e^(−z/ridgeDecay) with height above the slope.
  ridgeDecay: 12,
  // Lee-side sink, as a share of what Bohrer's signed formula gives there.
  // 1.0 IS the formula, and it is the only value that conserves mass: over
  // any closed piece of terrain V·∇h averages to zero, so the air near the
  // ground neither lifts nor sinks a bird on average. 0.35 was tried first
  // ("the lee is gentle") and measured, on the live page in all four
  // biomes, a planet MEAN of +0.12 to +0.20 units/s three units up and +0.07
  // to +0.11 at ten — an upward ratchet near the ground by another name.
  // Thermals are where free altitude comes from.
  leeFactor: 1.0,
  // ---- bounds ----
  maxUp: 2.5,
  maxDown: 1.5,
  // Sinking air fades to nothing at the floor's own clearance (the flight's
  // birdRadius) over `floorTaper` units, so it never presses a bird into the
  // floor. Rising air does not fade, so the lowest few units carry a small
  // net lift — measured +0.21 to +0.34 units/s one unit up, +0.04 to +0.06 at
  // three, nothing from six — a cushion, not a ratchet: it stops where the
  // taper does.
  floorClearance: 0.6,
  floorTaper: 3.4,
  // ---- gusts (visual only) ----
  // Dryden-style length scales, world units: τ = L / U.
  gustLengthU: 12,
  gustLengthV: 8,
  gustLengthW: 5,
  // Intensities as a share of the mean wind. Near the ground σu ≈ 2σw.
  gustSigmaU: 0.28,
  gustSigmaV: 0.24,
  gustSigmaW: 0.12,
  // Foliage sway added per sigma of along-wind gust (see windVisualFor).
  gustSway: 0.45,
});

// ---------------------------------------------------------------------------
// Allen 2006, as plain functions (the unit tests read these directly)
// ---------------------------------------------------------------------------

/** Allen eq. 11: mean updraft at z/zi, in the units of `wstar`. */
export function allenMeanUpdraft(zzi, wstar = 1) {
  if (!(zzi > 0)) return 0;
  return Math.cbrt(zzi) * (1 - 1.1 * zzi) * wstar;
}

/** Allen eq. 12: mean outer radius at z/zi, in the units of `zi`. */
export function allenMeanRadius(zzi, zi) {
  if (!(zzi > 0)) return 0;
  return 0.102 * Math.cbrt(zzi) * (1 - 0.25 * zzi) * zi;
}

/** r1/r2 from the outer radius in METRES (Allen's rule, as written). */
export function allenCoreRatio(r2Metres) {
  return r2Metres < 600 ? 0.0011 * r2Metres + 0.14 : 0.8;
}

/** Which row of ALLEN_SHAPES the paper picks for this r1/r2 (midpoint rule). */
export function allenShapeIndex(r1r2) {
  for (let i = 0; i < ALLEN_SHAPES.length - 1; i += 1) {
    if (r1r2 < 0.5 * (ALLEN_SHAPES[i][0] + ALLEN_SHAPES[i + 1][0])) return i;
  }
  return ALLEN_SHAPES.length - 1;
}

/**
 * What the last `thermalUpdraftAt` call worked out on the way, for the one
 * caller that needs more than the answer (the field's mass balance, at build
 * time). A module-level scratch rather than a returned object: the per-frame
 * path must not allocate.
 */
const THERMAL_LAST = { w2: 0, wc: 0, r1: 0, r2: 0 };

/**
 * One thermal, Allen 2006 Appendix B `run_model2_3`, with the world map, and
 * the environment's sink `we` GIVEN rather than derived:
 *
 *   r        horizontal distance from the thermal's axis, world units
 *   z        height above the local ground, world units
 *   wstar    w* for THIS thermal (already times its gain and its sun heat)
 *   rgain    this thermal's radius perturbation
 *   we       the sink between thermals at this height (<= 0), units/s
 *
 * The paper's own `we` is `allenUpdraftAt` below; the field solves its own
 * so that mass balances on a planet (see `createAirField`, "the sink between
 * thermals"). Positional on purpose: the field calls this every frame and an
 * options object would be an allocation.
 */
export function thermalUpdraftAt(r, z, zi, ziMetres, unitsPerMetre, wstar, rgain, we) {
  THERMAL_LAST.w2 = 0; THERMAL_LAST.wc = 0; THERMAL_LAST.r1 = 0; THERMAL_LAST.r2 = 0;
  if (!(z > 0) || !(zi > 0)) return 0;          // the ground: w = 0 at the surface
  const zzi = z / zi;
  if (zzi >= 1) return 0;                       // above the layer: ws = wd = we = 0
  const c = Math.cbrt(zzi);
  let r2m = 0.102 * c * (1 - 0.25 * zzi) * ziMetres * rgain;
  if (r2m < 10) r2m = 10;                       // "limit small updrafts to 20m diameter"
  const r1r2 = r2m < 600 ? 0.0011 * r2m + 0.14 : 0.8;
  const r2 = r2m * unitsPerMetre;
  const r1 = r1r2 * r2;
  const wt = c * (1 - 1.1 * zzi) * wstar;
  // wc = 3·wt·(r2³ − r2²·r1) / (r2³ − r1³), divided through by r2³.
  const wc = (3 * wt * (1 - r1r2)) / (1 - r1r2 * r1r2 * r1r2);
  const rr2 = r / r2;
  const k = ALLEN_SHAPES[allenShapeIndex(r1r2)];
  let ws = 1 / (1 + Math.pow(k[1] * Math.abs(rr2 + k[3]), k[2])) + k[4] * rr2;
  if (ws < 0) ws = 0;                           // "no neg updrafts"
  // The sinking ring at the edge, upper half of the layer only.
  let wd = 0;
  if (zzi > 0.5 && zzi <= 0.9 && r > r1 && rr2 < 2) {
    wd = 2.5 * (zzi - 0.5) * (Math.PI / 6) * Math.sin(Math.PI * rr2);
    if (wd > 0) wd = 0;
  }
  const w2 = ws * wc + wd * wt;
  THERMAL_LAST.w2 = w2; THERMAL_LAST.wc = wc; THERMAL_LAST.r1 = r1; THERMAL_LAST.r2 = r2;
  // A thermal with no heat in it is just environment air, everywhere —
  // Allen's stretch divides by wc, and blending by it would put a step at r1.
  if (Math.abs(wc) < 1e-9) return w2 + we;
  // "Stretch updraft to blend with sink at edge".
  return r > r1 ? w2 * (1 - we / wc) + we : w2;
}

/**
 * One thermal exactly as the paper writes it, environment sink included:
 * `count` thermals of the mean radius on `area` square units, their mean
 * strength `envStrength` (a multiple of `baseWstar`); count 0 turns the sink
 * off (the paper's sflag 0). `allenUpdraft` below is the readable form.
 */
export function allenUpdraftAt(r, z, zi, ziMetres, unitsPerMetre, wstar, rgain,
  baseWstar, count, area, envStrength) {
  if (!(z > 0) || !(zi > 0)) return 0;
  const zzi = z / zi;
  if (zzi >= 1) return 0;
  // Environment sink: what goes up in the thermals comes down between them.
  let we = 0;
  if (count > 0 && area > 0) {
    const c = Math.cbrt(zzi);
    const rbar = 0.102 * c * (1 - 0.25 * zzi) * ziMetres * unitsPerMetre;
    const At = count * Math.PI * rbar * rbar;
    const swd = (zzi > 0.5 && zzi <= 0.9) ? 2.5 * (zzi - 0.5) : 0;
    if (At < area) {
      we = -(At * c * (1 - 1.1 * zzi) * baseWstar * envStrength * (1 - swd)) / (area - At);
      if (we > 0) we = 0;                       // "don't allow positive sink"
    }
  }
  return thermalUpdraftAt(r, z, zi, ziMetres, unitsPerMetre, wstar, rgain, we);
}

/** Readable wrapper for tests and tools. */
export function allenUpdraft(r, z, {
  zi = AIR_FIELD_DEFAULTS.zi,
  ziMetres = AIR_FIELD_DEFAULTS.ziMetres,
  unitsPerMetre = AIR_FIELD_DEFAULTS.unitsPerMetre,
  wstar = AIR_FIELD_DEFAULTS.wstar,
  rgain = 1,
  count = 0,
  area = 0,
  envStrength = 1,
} = {}) {
  return allenUpdraftAt(r, z, zi, ziMetres, unitsPerMetre, wstar, rgain, wstar, count, area, envStrength);
}

/** Outer radius r2 (world units) at height z, for a thermal with `rgain`. */
export function thermalRadiusAt(z, {
  zi = AIR_FIELD_DEFAULTS.zi,
  ziMetres = AIR_FIELD_DEFAULTS.ziMetres,
  unitsPerMetre = AIR_FIELD_DEFAULTS.unitsPerMetre,
  rgain = 1,
} = {}) {
  const zzi = z / zi;
  if (!(zzi > 0) || zzi >= 1) return 0;
  return Math.max(10, allenMeanRadius(zzi, ziMetres) * rgain) * unitsPerMetre;
}

/**
 * Bohrer et al. 2012: orographic updraft w = U·sin(θ)·cos(α − β), written as
 * (V · ∇h) / sqrt(1 + |∇h|²). `V` is the wind in the tangent plane, `∇h` the
 * terrain gradient (rise per unit run, pointing uphill), both world vectors.
 * Positive when the wind blows UP the slope.
 */
export function ridgeLiftRaw(vx, vy, vz, gx, gy, gz) {
  const g2 = gx * gx + gy * gy + gz * gz;
  return (vx * gx + vy * gy + vz * gz) / Math.sqrt(1 + g2);
}

const smoothstep = (a, b, x) => {
  if (x <= a) return 0;
  if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/**
 * Heat factor for an insolation (the cosine of the sun on the surface):
 * w* ∝ H^(1/3), and nothing at all once the sun is on or behind the slope.
 */
function sunHeatAt(insolation, heatRef, heatFade, heatMax) {
  if (!(insolation > 0)) return 0;
  return Math.min(heatMax, Math.cbrt(insolation / heatRef)) * smoothstep(0, heatFade, insolation);
}

/** Readable form of the heat factor, for tests and tools. */
export function sunHeat(insolation, { heatRef = AIR_FIELD_DEFAULTS.heatRef,
  heatFade = AIR_FIELD_DEFAULTS.heatFade, heatMax = AIR_FIELD_DEFAULTS.heatMax } = {}) {
  return sunHeatAt(insolation, heatRef, heatFade, heatMax);
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * Build the air over one biome.
 *
 *   seed           string or number; the biome id. Same seed + same terrain
 *                  → same thermals, forever.
 *   sphereRadius   the planet's base radius (the ground's zero).
 *   terrainHeight  (x, y, z) -> signed height <= 0 at a direction, the FLIGHT
 *                  FLOOR's own sampler (spherical-world.js
 *                  `sampleTerrainHeight`), so "above ground" here means what
 *                  it means to the floor. Null = a smooth sphere.
 *   waterLevel     < 0 when this biome has standing water; thermals are never
 *                  sited on it (water is the coldest surface there is).
 *   options        overrides for AIR_FIELD_DEFAULTS.
 */
export function createAirField({
  seed = 'forest',
  sphereRadius = 120,
  terrainHeight = null,
  waterLevel = 0,
  options = {},
} = {}) {
  const o = { ...AIR_FIELD_DEFAULTS };
  for (const key of Object.keys(options || {})) {
    if (Object.prototype.hasOwnProperty.call(AIR_FIELD_DEFAULTS, key) && Number.isFinite(options[key])) {
      o[key] = options[key];
    }
  }
  const R = sphereRadius;
  const heightAt = (typeof terrainHeight === 'function')
    ? terrainHeight
    : () => 0;
  const area = 4 * Math.PI * R * R;
  const seedValue = typeof seed === 'number' ? (seed >>> 0) : hashSeed(`air-field:${seed}`);
  const rng = mulberry32(seedValue);

  // ---- tangent basis at a unit direction, into a scratch triple ----------
  // e1 = normalize(ref × n), e2 = n × e1, ref = +Y unless n is near a pole.
  const _e1 = { x: 0, y: 0, z: 0 };
  const _e2 = { x: 0, y: 0, z: 0 };
  function basis(nx, ny, nz) {
    let rx = 0; let ry = 1; let rz = 0;
    if (Math.abs(ny) > 0.9) { rx = 1; ry = 0; }
    // e1 = ref × n
    let ax = ry * nz - rz * ny;
    let ay = rz * nx - rx * nz;
    let az = rx * ny - ry * nx;
    const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= al; ay /= al; az /= al;
    _e1.x = ax; _e1.y = ay; _e1.z = az;
    // e2 = n × e1
    _e2.x = ny * az - nz * ay;
    _e2.y = nz * ax - nx * az;
    _e2.z = nx * ay - ny * ax;
  }

  // Height of the floor at the direction n + (a·e1 + b·e2) (re-normalised).
  function heightOffset(nx, ny, nz, a, b) {
    const px = nx + a * _e1.x + b * _e2.x;
    const py = ny + a * _e1.y + b * _e2.y;
    const pz = nz + a * _e1.z + b * _e2.z;
    const l = Math.sqrt(px * px + py * py + pz * pz) || 1;
    return heightAt(px / l * R, py / l * R, pz / l * R);
  }

  // ---- the thermal sites (build time: allocation is fine here) -----------
  const sites = [];
  const dryMargin = 0.25;
  for (let i = 0; i < o.candidates; i += 1) {
    // Uniform on the sphere.
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const nx = s * Math.cos(phi);
    const ny = u;
    const nz = s * Math.sin(phi);
    const jitter = rng();
    const wgain = o.wgainMin + (o.wgainMax - o.wgainMin) * rng();
    const rgain = o.rgainMin + (o.rgainMax - o.rgainMin) * rng();
    const h = heightAt(nx * R, ny * R, nz * R);
    // Never on water: the floor sampler returns the water level over a lake.
    if (waterLevel < 0 && h <= waterLevel + dryMargin) continue;
    basis(nx, ny, nz);
    const d = o.siteSpacing / R;
    const hA = heightOffset(nx, ny, nz, d, 0);
    const hB = heightOffset(nx, ny, nz, -d, 0);
    const hC = heightOffset(nx, ny, nz, 0, d);
    const hD = heightOffset(nx, ny, nz, 0, -d);
    if (waterLevel < 0 && Math.min(hA, hB, hC, hD) <= waterLevel + dryMargin) continue;
    const g1 = (hA - hB) / (2 * o.siteSpacing);
    const g2 = (hC - hD) / (2 * o.siteSpacing);
    // Slope normal: radial tilted away from uphill.
    let sx = nx - g1 * _e1.x - g2 * _e2.x;
    let sy = ny - g1 * _e1.y - g2 * _e2.y;
    let sz = nz - g1 * _e1.z - g2 * _e2.z;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    // Exposure (low canopy, see `exposureDepth`) and crest (convex ground,
    // where thermals break away), from the same five samples.
    const exposure = Math.max(0, Math.min(1, 1 + h / o.exposureDepth));
    const lap = (hA + hB + hC + hD - 4 * h) / (o.siteSpacing * o.siteSpacing);
    const crest = Math.max(0, Math.min(1, -lap * 4));
    const score = 0.6 * exposure + 0.25 * crest + 0.15 * jitter;
    sites.push({ nx, ny, nz, sx, sy, sz, h, wgain, rgain, score, exposure, crest });
  }
  sites.sort((a, b) => (b.score - a.score) || (a.nx - b.nx));
  const cosSep = Math.cos(o.minSeparation);
  const picked = [];
  for (const site of sites) {
    if (picked.length >= o.thermalCount) break;
    let ok = true;
    for (const p of picked) {
      if (p.nx * site.nx + p.ny * site.ny + p.nz * site.nz > cosSep) { ok = false; break; }
    }
    if (ok) picked.push(site);
  }
  const count = picked.length;
  // Flat typed arrays: the per-frame loop reads these and nothing else.
  const tDir = new Float64Array(count * 3);
  const tNormal = new Float64Array(count * 3);
  const tWgain = new Float64Array(count);
  const tRgain = new Float64Array(count);
  const tHeat = new Float64Array(count);
  const thermals = picked.map((p, i) => {
    tDir[i * 3] = p.nx; tDir[i * 3 + 1] = p.ny; tDir[i * 3 + 2] = p.nz;
    tNormal[i * 3] = p.sx; tNormal[i * 3 + 1] = p.sy; tNormal[i * 3 + 2] = p.sz;
    tWgain[i] = p.wgain;
    tRgain[i] = p.rgain;
    tHeat[i] = 1;
    return Object.freeze({
      index: i,
      dir: Object.freeze([p.nx, p.ny, p.nz]),
      normal: Object.freeze([p.sx, p.sy, p.sz]),
      ground: p.h,
      wgain: p.wgain,
      rgain: p.rgain,
      exposure: p.exposure,
      crest: p.crest,
    });
  });

  // ---- the sink between thermals, solved for balance (build time) ---------
  // Allen's own sink, −At·w̄·(1 − swd)/(A − At), balances the paper's
  // model on the paper's terms: a thermal's flux taken as the mean updraft
  // over a mean-radius disk. Evaluated the way this field evaluates it — the
  // bell's real flux, the sink everywhere outside each r1, the stretch
  // between r1 and the rim, dead thermals as plain environment, all of it on
  // a sphere — it measured a planet-wide mean of −0.017 units/s at half the
  // layer on flat ground, and −0.023 to −0.037 thirty units up on the real
  // terrain of the four biomes. Small, and it is a sink with nothing to pay
  // for it. So the field solves the sink instead: within ±0.001 on flat
  // ground, −0.001 to −0.009 on the real terrain.
  //
  // Per thermal: F0 = ∫ w2 dA (its own flux, no environment) and
  // a = π r1² + (1/wc) ∫_{r>r1} w2 dA (the area the sink does NOT reach,
  // because inside r1 there is none and the stretch cancels it by the rim).
  // Both are linear in the rest of the field, so mass balances exactly when
  //     we = −Σ F0_i / (A − Σ_lit a_i),   A = 4π r² at the height asked about.
  // F0 scales with w*·gain·heat·rgain² and a with rgain², so ONE thermal of
  // unit w* and unit rgain, integrated here once per height, is the whole
  // table; `refreshHeat` supplies the two sums.
  //
  // Chord distance from the axis is exact for this on a sphere:
  // ρ = 2r·sin(θ/2) gives ρ dρ = r² sinθ dθ, the sphere's own area element.
  const BAL_LEVELS = 120;
  const balF0 = new Float64Array(BAL_LEVELS + 1);
  const balArea = new Float64Array(BAL_LEVELS + 1);
  {
    // Simpson over [a, b] of w2(r)·2πr dr, split at r1 by the caller: the
    // ring switches on there, and a rule that straddles a kink loses order.
    const SIMPSON = 96;   // even
    const radial = (a, b, z) => {
      if (!(b > a)) return 0;
      const h = (b - a) / SIMPSON;
      let s = 0;
      for (let j = 0; j <= SIMPSON; j += 1) {
        const r = a + j * h;
        thermalUpdraftAt(r, z, o.zi, o.ziMetres, o.unitsPerMetre, 1, 1, 0);
        const wgt = (j === 0 || j === SIMPSON) ? 1 : (j % 2 ? 4 : 2);
        s += wgt * THERMAL_LAST.w2 * 2 * Math.PI * r;
      }
      return (s * h) / 3;
    };
    for (let k = 1; k < BAL_LEVELS; k += 1) {
      const z = (k / BAL_LEVELS) * o.zi;
      thermalUpdraftAt(0, z, o.zi, o.ziMetres, o.unitsPerMetre, 1, 1, 0);
      const { r1, r2, wc } = THERMAL_LAST;
      // The bell is zero by ~1.5 r2 and the ring ends at 2 r2.
      const inner = radial(0, r1, z);
      const rim = radial(r1, 2.05 * r2, z);
      balF0[k] = inner + rim;
      balArea[k] = Math.abs(wc) > 1e-9 ? Math.PI * r1 * r1 + rim / wc : 0;
    }
  }
  let balUp = 0;     // Σ gain·heat·rgain² over all thermals
  let balLit = 0;    // Σ rgain² over the thermals with any heat in them

  // ---- the wind's veering axis (seeded) -----------------------------------
  // k: the axis the circulation turns about, on average; (i, j) span the
  // plane it precesses in.
  let kx; let ky; let kz;
  {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    kx = s * Math.cos(phi); ky = u; kz = s * Math.sin(phi);
  }
  basis(kx, ky, kz);
  const ix = _e1.x; const iy = _e1.y; const iz = _e1.z;
  const jx = _e2.x; const jy = _e2.y; const jz = _e2.z;
  const veerPhase = rng() * Math.PI * 2;
  const breathePhase = rng() * Math.PI * 2;
  const gustRng = mulberry32((seedValue ^ 0x9e3779b9) >>> 0);

  // ---- live state (all pre-allocated) ------------------------------------
  let time = 0;
  let ax = kx; let ay = ky; let az = kz;   // current wind axis
  let windU = o.windSpeed;                // current mean wind speed
  let sunX = 0; let sunY = 1; let sunZ = 0;
  // Where the sun above was measured from, when it is a LOCAL sun (see
  // `update`): the unit direction of the observer, or none.
  let obsX = 0; let obsY = 1; let obsZ = 0; let hasObserver = false;
  let envStrength = 1;                    // mean over thermals of wgain·heat
  let gu = 0; let gv = 0; let gw = 0;      // gust components
  let spare = 0; let hasSpare = false;

  /** Published every sample/observe. Read-only for everyone else. */
  const state = {
    updraft: 0, thermal: 0, ridge: 0, agl: 0,
    nearest: -1, nearestDistance: 0,
    wind: 0, windVisual: 1,
    gust: 0, gustSide: 0, gustAlong: 0,
    // The vertical gust itself, world units/s (unclamped; `gust` is it
    // normalised to -1..1). See `verticalGust` for the value the pose reads.
    gustW: 0,
    time: 0,
  };

  function gaussian() {
    if (hasSpare) { hasSpare = false; return spare; }
    let u1 = gustRng();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = gustRng();
    const m = Math.sqrt(-2 * Math.log(u1));
    spare = m * Math.sin(2 * Math.PI * u2);
    hasSpare = true;
    return m * Math.cos(2 * Math.PI * u2);
  }

  /** One exact first-order (Ornstein-Uhlenbeck) step. */
  function ou(x, dt, tau, sigma) {
    const a = Math.exp(-dt / Math.max(1e-3, tau));
    return a * x + sigma * Math.sqrt(Math.max(0, 1 - a * a)) * gaussian();
  }

  function refreshHeat() {
    let sum = 0;
    let up = 0;
    let lit = 0;
    for (let i = 0; i < count; i += 1) {
      let lx = sunX; let ly = sunY; let lz = sunZ;
      if (hasObserver) {
        // The observer's sun, carried to this thermal along the great circle
        // between them. On a sphere that transport IS the rotation about the
        // two points' common normal, so (Rodrigues, k = b × t, c = b · t):
        //   R v = v c + k × v + k (k · v) / (1 + c),   R b = t exactly.
        // The thermal then sees the sun at the observer's own elevation over
        // ITS horizon, whatever the arc between them. At the antipode the
        // great circle is undefined and the world direction stands.
        const tx = tDir[i * 3]; const ty = tDir[i * 3 + 1]; const tz = tDir[i * 3 + 2];
        const c = obsX * tx + obsY * ty + obsZ * tz;
        if (c > -0.999) {
          const kx = obsY * tz - obsZ * ty;
          const ky = obsZ * tx - obsX * tz;
          const kz = obsX * ty - obsY * tx;
          const f = (kx * sunX + ky * sunY + kz * sunZ) / (1 + c);
          lx = sunX * c + (ky * sunZ - kz * sunY) + kx * f;
          ly = sunY * c + (kz * sunX - kx * sunZ) + ky * f;
          lz = sunZ * c + (kx * sunY - ky * sunX) + kz * f;
        }
      }
      const ins = tNormal[i * 3] * lx + tNormal[i * 3 + 1] * ly + tNormal[i * 3 + 2] * lz;
      const heat = sunHeatAt(ins, o.heatRef, o.heatFade, o.heatMax);
      tHeat[i] = heat;
      sum += heat * tWgain[i];
      const g2 = tRgain[i] * tRgain[i];
      up += tWgain[i] * heat * g2;
      if (heat * tWgain[i] > 0) lit += g2;
    }
    envStrength = count ? sum / count : 0;
    balUp = up;
    balLit = lit;
  }

  /**
   * The sink between thermals at `agl` over ground whose sphere-centred
   * radius there is `r` (see "the sink between thermals" above). Never
   * positive: in the cap above 0.909 zi the thermals themselves sink, and
   * the paper does not let the environment rise to pay for it either.
   */
  function environmentSink(agl, r) {
    if (!(agl > 0) || !(agl < o.zi) || !(balUp > 0)) return 0;
    const f = (agl / o.zi) * BAL_LEVELS;
    const k = Math.min(BAL_LEVELS - 1, Math.floor(f));
    const t = f - k;
    const f0 = balF0[k] + (balF0[k + 1] - balF0[k]) * t;
    const a = balArea[k] + (balArea[k + 1] - balArea[k]) * t;
    const free = 4 * Math.PI * r * r - balLit * a;
    if (!(free > 0.05 * area)) return 0;
    const we = -(o.wstar * balUp * f0) / free;
    return we < 0 ? we : 0;
  }

  /**
   * Advance the air by `dt` seconds under a sun shining FROM (sx, sy, sz)
   * (any length; the key light's position is fine). Veers the wind, breathes
   * its speed, steps the gust filters and re-reads every thermal's heat.
   *
   * (ox, oy, oz), optional, says the sun is LOCAL: measured in the frame of
   * an observer at that point (any length; the bird's position is fine), as
   * src/environment/sun-frame.js maps the key light through the bird's own
   * horizon frame. Each thermal then gets that sun carried to it along the
   * great circle, so it sees the same elevation over its own horizon that
   * the bird sees over its — and its heat does not swing as the bird flies
   * toward it, away from it or round it. Omitted, the sun is one world
   * direction for the whole planet (a world-fixed sun: the far side is
   * night), which is what `?planetsun=0` hands in.
   */
  function update(dt, sx = sunX, sy = sunY, sz = sunZ, ox, oy, oz) {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    time += step;
    state.time = time;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (sl > 1e-9) { sunX = sx / sl; sunY = sy / sl; sunZ = sz / sl; }
    const ol = Number.isFinite(ox) && Number.isFinite(oy) && Number.isFinite(oz)
      ? Math.sqrt(ox * ox + oy * oy + oz * oz) : 0;
    hasObserver = ol > 1e-9;
    if (hasObserver) { obsX = ox / ol; obsY = oy / ol; obsZ = oz / ol; }
    const veer = veerPhase + (2 * Math.PI * time) / o.windVeerPeriod;
    const ct = Math.cos(o.windTilt); const st = Math.sin(o.windTilt);
    const cv = Math.cos(veer); const sv = Math.sin(veer);
    ax = ct * kx + st * (cv * ix + sv * jx);
    ay = ct * ky + st * (cv * iy + sv * jy);
    az = ct * kz + st * (cv * iz + sv * jz);
    windU = o.windSpeed * (1 + o.windBreathe * Math.sin(breathePhase + (2 * Math.PI * time) / o.windBreathePeriod));
    if (step > 0) {
      const U = Math.max(0.5, windU);
      gu = ou(gu, step, o.gustLengthU / U, o.gustSigmaU * o.windSpeed);
      gv = ou(gv, step, o.gustLengthV / U, o.gustSigmaV * o.windSpeed);
      gw = ou(gw, step, o.gustLengthW / U, o.gustSigmaW * o.windSpeed);
    }
    const sigU = o.gustSigmaU * o.windSpeed;
    const sigV = o.gustSigmaV * o.windSpeed;
    const sigW = o.gustSigmaW * o.windSpeed;
    state.gustAlong = sigU > 0 ? Math.max(-1, Math.min(1, gu / (2.5 * sigU))) : 0;
    state.gustSide = sigV > 0 ? Math.max(-1, Math.min(1, gv / (2.5 * sigV))) : 0;
    state.gust = sigW > 0 ? Math.max(-1, Math.min(1, gw / (2.5 * sigW))) : 0;
    state.gustW = gw;
    refreshHeat();
  }

  /**
   * The vertical gust the WING meets `agl` units above the ground, world
   * units/s: the filtered vertical turbulence, faded out with the convective
   * layer it belongs to (the ridge lift's own 0.7·zi..zi fade), so a bird
   * above the layer meets exactly none — the same height at which the air
   * that carries the flight is exactly zero. NaN or no height is still air.
   * VISUAL ONLY: src/flight/aero-pose.js flicks the wings by it; nothing
   * moves the bird by it. Scalar in, scalar out.
   */
  function verticalGust(agl) {
    if (!(agl < o.zi)) return 0;
    return gw * (1 - smoothstep(0.7 * o.zi, o.zi, agl));
  }

  /**
   * How hard the foliage sways, as a multiple of the shipping sway: 1.0 at
   * the mean wind, less toward a calm eye, and the along-wind gust on top —
   * a one-sigma gust is +45%, a lull takes some away. Bounded 0.2..2.2 so a
   * freak draw can neither freeze a crown nor fold it.
   */
  function windVisualFor(wind) {
    const sigU = o.gustSigmaU * o.windSpeed;
    const g = sigU > 0 ? Math.max(-1.5, Math.min(2.5, gu / sigU)) : 0;
    const mean = 0.35 + 0.65 * wind / Math.max(0.1, o.windSpeed);
    return Math.max(0.2, Math.min(2.2, mean * (1 + o.gustSway * g)));
  }

  // Wind at a unit direction, into (_wx, _wy, _wz). Tangent by construction.
  let _wx = 0; let _wy = 0; let _wz = 0;
  function windDir(nx, ny, nz) {
    // a × n
    let cx = ay * nz - az * ny;
    let cy = az * nx - ax * nz;
    let cz = ax * ny - ay * nx;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const scale = windU / Math.max(cl, o.calm);
    cx *= scale; cy *= scale; cz *= scale;
    _wx = cx; _wy = cy; _wz = cz;
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  /** Index of the thermal nearest the direction of (x, y, z); -1 if none. */
  function nearest(x, y, z) {
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l < 1e-9 || count === 0) return -1;
    const nx = x / l; const ny = y / l; const nz = z / l;
    let best = -1; let bestDot = -2;
    for (let i = 0; i < count; i += 1) {
      const d = tDir[i * 3] * nx + tDir[i * 3 + 1] * ny + tDir[i * 3 + 2] * nz;
      if (d > bestDot) { bestDot = d; best = i; }
    }
    return best;
  }

  /**
   * Vertical air velocity (world units/s, positive UP along the local
   * radial) at the world point (x, y, z), sphere-centred. Fills `state`.
   * Thermal + ridge + environment sink; never a gust.
   */
  function sample(x, y, z) {
    state.updraft = 0; state.thermal = 0; state.ridge = 0;
    state.nearest = -1; state.nearestDistance = 0;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r < 1e-6) { state.agl = 0; state.wind = 0; return 0; }
    const nx = x / r; const ny = y / r; const nz = z / r;
    const wind = windDir(nx, ny, nz);
    state.wind = wind;
    state.windVisual = windVisualFor(wind);
    const ground = heightAt(x, y, z);
    const agl = r - (R + ground);
    state.agl = agl;
    if (!(agl < o.zi)) return 0;                 // above the layer: exactly still air

    // ---- thermal ----
    let thermal = 0;
    const i = nearest(x, y, z);
    if (i >= 0) {
      const d = tDir[i * 3] * nx + tDir[i * 3 + 1] * ny + tDir[i * 3 + 2] * nz;
      const dist = r * Math.sqrt(Math.max(0, 2 - 2 * d));   // chord at the bird's radius
      state.nearest = i;
      state.nearestDistance = dist;
      thermal = thermalUpdraftAt(dist, agl, o.zi, o.ziMetres, o.unitsPerMetre,
        o.wstar * tWgain[i] * tHeat[i], tRgain[i], environmentSink(agl, r));
    }

    // ---- ridge ----
    let ridge = 0;
    if (agl > 0 && wind > 1e-6 && typeof terrainHeight === 'function') {
      basis(nx, ny, nz);
      const dd = o.ridgeSpacing / R;
      const g1 = (heightOffset(nx, ny, nz, dd, 0) - heightOffset(nx, ny, nz, -dd, 0)) / (2 * o.ridgeSpacing);
      const g2 = (heightOffset(nx, ny, nz, 0, dd) - heightOffset(nx, ny, nz, 0, -dd)) / (2 * o.ridgeSpacing);
      const gx = g1 * _e1.x + g2 * _e2.x;
      const gy = g1 * _e1.y + g2 * _e2.y;
      const gz = g1 * _e1.z + g2 * _e2.z;
      let wr = ridgeLiftRaw(_wx, _wy, _wz, gx, gy, gz);
      if (wr < 0) wr *= o.leeFactor;
      ridge = wr * Math.exp(-agl / o.ridgeDecay) * (1 - smoothstep(0.7 * o.zi, o.zi, agl));
    }

    let w = thermal + ridge;
    if (w < 0) w *= smoothstep(o.floorClearance, o.floorClearance + o.floorTaper, agl);
    if (w > o.maxUp) w = o.maxUp;
    else if (w < -o.maxDown) w = -o.maxDown;
    if (!Number.isFinite(w)) w = 0;
    state.thermal = thermal;
    state.ridge = ridge;
    state.updraft = w;
    return w;
  }

  /**
   * A thermal's current size and strength at height `z` above ITS ground:
   * { radius, core, heat }. `core` is the centre updraft Allen's wc gives,
   * before the environment blend.
   */
  function thermalAt(index, z, out = { radius: 0, core: 0, heat: 0 }) {
    if (index < 0 || index >= count) { out.radius = 0; out.core = 0; out.heat = 0; return out; }
    out.radius = thermalRadiusAt(z, { zi: o.zi, ziMetres: o.ziMetres, unitsPerMetre: o.unitsPerMetre, rgain: tRgain[index] });
    out.core = allenUpdraftAt(0, z, o.zi, o.ziMetres, o.unitsPerMetre,
      o.wstar * tWgain[index] * tHeat[index], tRgain[index], o.wstar, 0, 0, 0);
    out.heat = tHeat[index];
    return out;
  }

  /** The wind vector at (x, y, z) into `out` ({x, y, z}); returns its speed. */
  function windAt(x, y, z, out) {
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r < 1e-6) { if (out) { out.x = 0; out.y = 0; out.z = 0; } return 0; }
    const s = windDir(x / r, y / r, z / r);
    if (out) { out.x = _wx; out.y = _wy; out.z = _wz; }
    return s;
  }

  refreshHeat();
  // A stable function for the flight controller to hold: created once, here.
  const sampler = (x, y, z) => sample(x, y, z);

  return {
    config: Object.freeze({ ...o }),
    seed: seedValue,
    sphereRadius: R,
    count,
    thermals,
    state,
    update,
    sample,
    sampler,
    verticalGust,
    nearest,
    thermalAt,
    windAt,
    /** Current heat (0..heatMax) of thermal `i`. */
    heat: (i) => (i >= 0 && i < count ? tHeat[i] : 0),
    /** Mean strength (wgain·heat) the environment sink balances against. */
    envStrength: () => envStrength,
    /** Current gust components, world units/s: [along, side, vertical]. */
    gustComponents: () => [gu, gv, gw],
  };
}
