/**
 * terrain.js — the single source of truth for VYOM's planet surface.
 *
 * Everything that needs to know "how high is the ground in direction d?" reads
 * from here: the planet mesh, the prop scatter, the flight floor, the course
 * ribbon, the AI racers and the minimap. One sampler, no drift.
 *
 * ============================================================================
 * THE LOAD-BEARING INVARIANT — read before changing any constant
 * ============================================================================
 * VYOM's flight model has no gravity. The bird holds altitude inertially and
 * the radial clamp in bird-flight.js is a FLOOR, not a spring. If the floor
 * could rise above the baseline radius, a cruising bird would be ratcheted
 * upward every time it crossed a hill and could never come back down.
 *
 * So terrain is carved DOWNWARD only:
 *
 *     mesh height  <=  floor height  <=  0        (all relative to PLANET_RADIUS)
 *
 *   - `continentalHeight()` is the smooth flight floor. Always <= 0.
 *   - `surfaceHeight()` is what the mesh renders. It subtracts ridged detail,
 *     so it is always <= continentalHeight(). The bird therefore glides over
 *     the detail instead of clipping into it.
 *
 * Height above the baseline is expressed with instanced props (trees, spires,
 * peaks) which are visual-only and collider-free, so they can be as tall as
 * they like without ever touching the floor.
 *
 * CONTINENT_BIAS is deliberate, not a bug. It pushes the average ground below
 * the baseline so most of the planet reads as rolling lowland and only the
 * highest crests touch the baseline ceiling. Remove it and the world flattens
 * into a dead plateau with rare pits. (Birb Mobile learned this the hard way —
 * see the "rolling-world restore" note in CLAUDE.md.)
 *
 * Pure JS, no THREE, no DOM, zero allocation — unit-testable under `node --test`.
 */

/** Baseline sphere radius. The ceiling that terrain carves down from. */
export const PLANET_RADIUS = 100;

export const TERRAIN = {
    // Continental (flight floor) layer.
    continentScale: 1.05,       // noise frequency over the unit sphere
    continentOctaves: 4,
    continentBias: 0.34,        // >0 sinks the average ground. Load-bearing.
    continentSteepness: 1.35,   // tanh gain: higher = cliffier, lower = rollier
    continentAmplitude: 26,     // deepest carve, in world units

    // Ridged detail (visual only, subtractive). Kept low-frequency on purpose:
    // stepped lighting turns any detail finer than a few triangles into band
    // noise, so roughness has to read at the scale of a gully, not a pebble.
    detailScale: 2.9,
    detailOctaves: 3,
    detailAmplitude: 3.4,

    // Biome region selector.
    biomeScale: 0.78,
};

/** Biome ids. Kept as small ints so they can live in typed arrays. */
export const BIOME = {
    MEADOW: 0,   // lush green rolling lowland
    CANYON: 1,   // warm ochre rock, deep cuts
    ALPINE: 2,   // pale stone + snow caps on the high crests
};

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/** 32-bit integer hash -> [0,1). Deterministic across platforms. */
function hash3(i, j, k) {
    let n = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
}

/** Quintic smoothstep — C2 continuous, so fbm gradients stay smooth. */
function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Trilinearly interpolated 3D value noise -> [0,1]. */
function valueNoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);

    const c000 = hash3(xi, yi, zi);
    const c100 = hash3(xi + 1, yi, zi);
    const c010 = hash3(xi, yi + 1, zi);
    const c110 = hash3(xi + 1, yi + 1, zi);
    const c001 = hash3(xi, yi, zi + 1);
    const c101 = hash3(xi + 1, yi, zi + 1);
    const c011 = hash3(xi, yi + 1, zi + 1);
    const c111 = hash3(xi + 1, yi + 1, zi + 1);

    const x00 = c000 + (c100 - c000) * u;
    const x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u;
    const x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v;
    const y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
}

/** Fractional Brownian motion -> [0,1]. */
export function fbm(x, y, z, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise3(x * freq, y * freq, z * freq);
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return sum / norm;
}

/**
 * Ridged fbm -> [0,1]. Used for erosion detail.
 *
 * The `r * r` is load-bearing, not decoration. Raw ridged noise (1 - |2n-1|)
 * has a derivative discontinuity exactly at the ridge, and a displaced mesh
 * built on it gets a hard crease in its vertex normals there. Under a stepped
 * toon ramp that crease flips whole triangles into the next band, which reads
 * as white static shards scattered over the terrain — the single worst
 * artifact in the first captured frame of this project. Squaring sends the
 * derivative to zero at the crease, so the ridges stay but the normals go
 * smooth through them.
 */
function ridged(x, y, z, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
        const n = valueNoise3(x * freq, y * freq, z * freq);
        const r = 1 - Math.abs(n * 2 - 1);
        sum += amp * r * r;
        norm += amp;
        amp *= 0.5;
        freq *= 2.07;
    }
    return sum / norm;
}

// ---------------------------------------------------------------------------
// Height sampling
// ---------------------------------------------------------------------------

/**
 * Smooth continental height for a unit direction. This IS the flight floor.
 * Always <= 0 (carve down from the baseline). Zero allocation.
 */
export function continentalHeight(nx, ny, nz) {
    const s = TERRAIN.continentScale;
    // Offset the sample point off the origin so the noise lattice isn't
    // symmetric about (0,0,0) — otherwise antipodal points share a cell.
    const raw = fbm(nx * s + 11.3, ny * s + 5.7, nz * s + 23.1, TERRAIN.continentOctaves);
    const signed = raw * 2 - 1;                       // [-1, 1]
    const biased = signed - TERRAIN.continentBias;    // sink the average
    const carve = Math.tanh(biased * TERRAIN.continentSteepness);
    const clamped = carve > 0 ? 0 : (carve < -1 ? -1 : carve);
    return clamped * TERRAIN.continentAmplitude;      // [-amplitude, 0]
}

/**
 * Rendered surface height: continental floor minus ridged erosion detail.
 * Always <= continentalHeight(), so the mesh can never poke through the floor
 * the bird flies on. Zero allocation.
 */
export function surfaceHeight(nx, ny, nz) {
    const cont = continentalHeight(nx, ny, nz);
    const d = TERRAIN.detailScale;
    const cut = ridged(nx * d + 3.1, ny * d + 17.9, nz * d + 41.5, TERRAIN.detailOctaves);
    return cont - cut * TERRAIN.detailAmplitude;
}

/** World-space radius of the rendered surface along a unit direction. */
export function surfaceRadius(nx, ny, nz) {
    return PLANET_RADIUS + surfaceHeight(nx, ny, nz);
}

/** World-space radius of the flight floor along a unit direction. */
export function floorRadius(nx, ny, nz) {
    return PLANET_RADIUS + continentalHeight(nx, ny, nz);
}

/**
 * How deep the floor sits below the baseline, normalised to [0,1].
 * 0 = crest touching the ceiling, 1 = deepest canyon. Drives biome blending,
 * prop scatter density and the tree line.
 */
export function depthAt(nx, ny, nz) {
    return -continentalHeight(nx, ny, nz) / TERRAIN.continentAmplitude;
}

/**
 * Which biome region a direction belongs to. Large low-frequency regions so
 * the planet reads as a handful of distinct lands rather than noise soup.
 */
export function biomeAt(nx, ny, nz) {
    const s = TERRAIN.biomeScale;
    const n = fbm(nx * s + 71.2, ny * s + 13.8, nz * s + 97.4, 2);
    if (n < 0.42) return BIOME.MEADOW;
    if (n < 0.68) return BIOME.CANYON;
    return BIOME.ALPINE;
}

/**
 * Continuous blend weight for the biome noise, so the mesh can fade between
 * regions instead of hard-switching at the boundary. Returns [0,1].
 */
export function biomeNoise(nx, ny, nz) {
    const s = TERRAIN.biomeScale;
    return fbm(nx * s + 71.2, ny * s + 13.8, nz * s + 97.4, 2);
}
