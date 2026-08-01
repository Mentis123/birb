/**
 * rng.js — deterministic pseudo-random numbers.
 *
 * The whole planet, course and prop scatter are generated from seeds so every
 * player races the same circuit and the screenshot harness captures the same
 * frame twice. Never use Math.random() anywhere in VYOM.
 *
 * Pure JS, no THREE, no DOM — unit-testable under `node --test`.
 */

/** mulberry32 — tiny, fast, good enough distribution for scatter/jitter. */
export function makeRng(seed = 1) {
    let a = (seed >>> 0) || 1;
    return function rng() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Uniform float in [min, max). */
export function rngRange(rng, min, max) {
    return min + (max - min) * rng();
}

/** Integer in [min, max]. */
export function rngInt(rng, min, max) {
    return Math.floor(min + (max - min + 1) * rng()) | 0;
}

/**
 * Evenly distributed unit directions on a sphere (Fibonacci lattice) with an
 * optional per-point jitter. Writes into `out` (x,y,z) — zero allocation.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export function fibonacciDirection(i, count, out, jitterRng = null, jitterAmount = 0) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2; // 1 .. -1
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    let x = Math.cos(theta) * radius;
    let z = Math.sin(theta) * radius;
    let yy = y;
    if (jitterRng && jitterAmount > 0) {
        x += (jitterRng() - 0.5) * jitterAmount;
        yy += (jitterRng() - 0.5) * jitterAmount;
        z += (jitterRng() - 0.5) * jitterAmount;
    }
    const inv = 1 / Math.max(1e-6, Math.hypot(x, yy, z));
    out.x = x * inv;
    out.y = yy * inv;
    out.z = z * inv;
    return out;
}
