/**
 * Seeded world RNG (P2R.5).
 *
 * Every environment builder (spherical-world.js, world-shell.js, weather.js,
 * collectibles.js) used raw `Math.random()` for prop placement — 76 calls
 * across the four files. That meant every page load built a different
 * world, so quality-settings.js's `freeze('seed', true)` on entering
 * Benchmark mode was freezing a mechanism that did not exist: no two runs
 * could ever be compared against the same geometry. See docs/perf/gates/
 * G2a.md §4.2.
 *
 * This module is deliberately tiny and self-contained — no THREE, no DOM,
 * no imports — so it is unit-testable under plain `node --test` and safe to
 * import from every builder without touching any zero-allocation game-loop
 * path (it is setup-time code, not per-frame code).
 *
 * ── Design ──────────────────────────────────────────────────────────────
 *
 * `mulberry32` is the generator: a fast, deterministic 32-bit PRNG. Given
 * the same seed it produces the same sequence forever, on every platform —
 * unlike `Math.random()`, which has no seed at all.
 *
 * A single shared stream is NOT used across builders. If spherical-world,
 * world-shell, weather and collectibles all pulled from one generator, then
 * adding a single new random() call to any one builder would shift every
 * draw that comes after it — including calls belonging to a DIFFERENT
 * subsystem that happens to run later. That turns every future edit into an
 * unrelated world change. Instead, `createRngPool(seed)` hands out one
 * independent generator per NAMED stream: each stream's seed is derived
 * from `(worldSeed, name)` alone, never from call order, so requesting
 * streams "forest-trees" then "canyon-spires" produces exactly the same two
 * sequences as requesting them in the other order, and adding calls to one
 * stream never perturbs another.
 *
 * `setWorldSeed` / `getWorldSeed` / `worldRng` are the surface a debug hook
 * (e.g. `__BIRB.worldSeed(n)`) needs to actually pin a world: call
 * `setWorldSeed(n)` before building an environment, and every builder that
 * asks `worldRng('<its-own-name>')` gets a deterministic generator seeded
 * from `n`. Calling `setWorldSeed(null)` (or never calling it) restores the
 * exact previous behaviour — `worldRng()` falls back to `Math.random`, so
 * an unseeded world is exactly as nondeterministic as it always was.
 */

/**
 * mulberry32 — deterministic 32-bit PRNG.
 *
 * Given the same `seed` (any 32-bit integer, including 0), returns a
 * function that produces the same infinite sequence of floats in [0, 1)
 * every time. Independent of `Math.random()` and of any other generator
 * created by this module.
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 32-bit string hash (FNV-1a). Used to derive a per-stream
 * seed from a stream name without ever needing a lookup table of names.
 * Two different strings collide only by chance (32-bit space); the same
 * string always hashes to the same value, on any platform, forever.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalizeSeed(seed) {
  if (seed === null || seed === undefined) return null;
  if (typeof seed === 'string') return hashSeed(seed);
  return (seed >>> 0);
}

/**
 * Factory for independent named RNG streams sharing one world seed.
 *
 * `pool.stream(name)` returns a memoized `mulberry32` generator whose seed
 * is `worldSeed XOR hashSeed(name)`. Two pools built from the same seed
 * hand out identical streams for identical names, in any request order —
 * that is what makes streams "independent": none of them derive from a
 * running counter or from each other, only from `(seed, name)`.
 *
 * @param {number|string} seed
 * @returns {{ seed: number, stream: (name: string) => () => number }}
 */
export function createRngPool(seed) {
  const base = normalizeSeed(seed) ?? 0;
  const streams = new Map();
  return {
    seed: base,
    stream(name) {
      const key = String(name);
      let rng = streams.get(key);
      if (!rng) {
        const streamSeed = (base ^ hashSeed(key)) >>> 0;
        rng = mulberry32(streamSeed);
        streams.set(key, rng);
      }
      return rng;
    },
  };
}

/**
 * Convenience: a single generator, no named streams. Equivalent to
 * `mulberry32(normalizeSeed(seed))`; kept separate so callers that just
 * want "one deterministic sequence from one seed" don't need to think
 * about pools.
 *
 * @param {number|string} seed
 * @returns {() => number}
 */
export function createRng(seed) {
  return mulberry32(normalizeSeed(seed) ?? 0);
}

// ── World-seed registry ────────────────────────────────────────────────
//
// Module-level by design, matching the pattern spherical-world.js already
// uses for `_activeTerrainProfile` / `_activeWaterLevel`: the environment
// builders reach the active seed through a free function rather than
// through a constructor argument threaded across four independent files
// and (eventually) index.html's debug hooks.
let _worldSeed = null;

/**
 * Pin (or clear) the world seed used by `worldRng()`.
 *
 * This is the surface `__BIRB.worldSeed(n)` needs: wiring a debug/menu hook
 * to call `setWorldSeed(n)` before the next environment build makes that
 * build — and every subsystem stream drawn from it — fully reproducible.
 * Passing `null` or `undefined` clears it, restoring the unseeded default
 * (`worldRng()` then returns `Math.random` and the world is exactly as
 * nondeterministic as it was before this module existed).
 *
 * @param {number|string|null} [seed]
 * @returns {number|null} the normalized seed now in effect
 */
export function setWorldSeed(seed) {
  _worldSeed = normalizeSeed(seed);
  return _worldSeed;
}

/** @returns {number|null} the current world seed, or null if unseeded. */
export function getWorldSeed() {
  return _worldSeed;
}

/**
 * Get the RNG a builder should use for its own named stream, drawn from the
 * current world seed. Call once per environment build and reuse the
 * returned function for every draw that build needs — that single
 * generator's advancing state IS the determinism; calling `worldRng` again
 * mid-build would hand back a fresh, unadvanced stream instead of
 * continuing the one already in use.
 *
 * @param {string} name subsystem/stream name, e.g. `spherical-world:forest`
 * @returns {() => number} `Math.random` when unseeded; a seeded generator otherwise
 */
export function worldRng(name) {
  if (_worldSeed === null) return Math.random;
  return createRngPool(_worldSeed).stream(name);
}
