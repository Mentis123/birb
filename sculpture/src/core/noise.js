/**
 * core/noise.js — deterministic value noise for surface displacement.
 *
 * The sculpture is hand-modelled bronze: nothing on it is a mathematically
 * clean surface. Every generated primitive gets pushed around by this before it
 * is allowed on screen, which is most of what separates "3D model of a statue"
 * from "3D model of a cylinder".
 *
 * Value noise rather than simplex, deliberately: it is a dozen lines, it is
 * seeded and therefore identical between the browser and the screenshot
 * harness, and at the frequencies used here (surface lumps, not terrain) the
 * grid artefacts of value noise are invisible under a fractal sum.
 */

/** Integer hash → [0,1). No allocation, no table. */
function hash3(x, y, z, seed) {
    let h = seed | 0;
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h = Math.imul(h ^ (y | 0), 0x85ebca6b);
    h = Math.imul(h ^ (z | 0), 0xc2b2ae35);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Value noise in [-1, 1]. */
export function noise3(x, y, z, seed = 1) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);

    const c000 = hash3(xi, yi, zi, seed);
    const c100 = hash3(xi + 1, yi, zi, seed);
    const c010 = hash3(xi, yi + 1, zi, seed);
    const c110 = hash3(xi + 1, yi + 1, zi, seed);
    const c001 = hash3(xi, yi, zi + 1, seed);
    const c101 = hash3(xi + 1, yi, zi + 1, seed);
    const c011 = hash3(xi, yi + 1, zi + 1, seed);
    const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);

    const x00 = lerp(c000, c100, xf);
    const x10 = lerp(c010, c110, xf);
    const x01 = lerp(c001, c101, xf);
    const x11 = lerp(c011, c111, xf);
    return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf) * 2 - 1;
}

/**
 * Fractal sum. `octaves` doublings of frequency at halving amplitude.
 *
 * Two octaves is the working default: one for the broad "this was pushed by a
 * thumb" undulation, one for the finer tooling. A third reads as sandpaper at
 * this scale and costs vertices for nothing.
 */
export function fbm3(x, y, z, seed = 1, octaves = 2, lacunarity = 2.3, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x, fy = y, fz = z;
    for (let i = 0; i < octaves; i++) {
        sum += noise3(fx, fy, fz, seed + i * 101) * amp;
        norm += amp;
        amp *= gain;
        fx *= lacunarity; fy *= lacunarity; fz *= lacunarity;
    }
    return sum / norm;
}

export default fbm3;
