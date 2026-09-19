import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32,
  hashSeed,
  createRng,
  createRngPool,
  setWorldSeed,
  getWorldSeed,
  worldRng,
} from '../src/environment/seeded-random.js';

// Always leave the module-level world seed clear when this file is done, so
// other test files (run in the same node --test process) never observe a
// seed this file set.
test.after(() => setWorldSeed(null));

test('mulberry32 is deterministic — same seed, same sequence, forever', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('mulberry32 produces values in [0, 1)', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('mulberry32 handles seed 0 without degenerating', () => {
  const rng = mulberry32(0);
  const values = Array.from({ length: 20 }, () => rng());
  // Not all identical, not all zero — a broken LCG-style bug would collapse
  // to a fixed point or a short cycle starting from 0.
  assert.ok(new Set(values).size > 1);
  assert.ok(values.some((v) => v !== 0));
});

test('different seeds produce different sequences', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test('hashSeed is deterministic and sensitive to its input', () => {
  assert.equal(hashSeed('forest'), hashSeed('forest'));
  assert.notEqual(hashSeed('forest'), hashSeed('canyons'));
  assert.equal(typeof hashSeed('anything'), 'number');
  assert.ok(hashSeed('anything') >= 0);
});

test('createRng(seed) matches mulberry32(seed) for numeric seeds', () => {
  const a = createRng(999);
  const b = mulberry32(999);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('createRng accepts a string seed deterministically', () => {
  const a = createRng('birb-world');
  const b = createRng('birb-world');
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.deepEqual(seqA, seqB);
});

// ── createRngPool: independent named streams ────────────────────────────

test('createRngPool: the same stream name always returns the same generator instance', () => {
  const pool = createRngPool(42);
  const s1 = pool.stream('forest');
  const s2 = pool.stream('forest');
  assert.equal(s1, s2, 'stream() should memoize by name');
});

test('createRngPool: two named streams from one seed are independent sequences', () => {
  const pool = createRngPool(42);
  const forest = Array.from({ length: 30 }, () => pool.stream('forest')());
  const canyons = Array.from({ length: 30 }, () => pool.stream('canyons')());
  assert.notDeepEqual(forest, canyons);
});

test('createRngPool: two pools built from the same seed reproduce the same named streams', () => {
  const poolA = createRngPool(42);
  const poolB = createRngPool(42);
  const a = Array.from({ length: 30 }, () => poolA.stream('spherical-world:forest')());
  const b = Array.from({ length: 30 }, () => poolB.stream('spherical-world:forest')());
  assert.deepEqual(a, b);
});

test('createRngPool: streams are not order-coupled to their siblings', () => {
  // Request 'a' then 'b' from one pool; request 'b' then 'a' from another
  // pool at the same seed. Each named stream's own sequence must be
  // identical regardless of what else was requested first — a stream drawn
  // from a running counter (rather than seeded independently from its own
  // name) would fail this.
  const poolOrderAB = createRngPool(7);
  const a1 = poolOrderAB.stream('alpha');
  const b1 = poolOrderAB.stream('beta');
  const alphaFirst = Array.from({ length: 15 }, () => a1());
  const betaFirst = Array.from({ length: 15 }, () => b1());

  const poolOrderBA = createRngPool(7);
  const b2 = poolOrderBA.stream('beta');
  const a2 = poolOrderBA.stream('alpha');
  const betaSecondPool = Array.from({ length: 15 }, () => b2());
  const alphaSecondPool = Array.from({ length: 15 }, () => a2());

  assert.deepEqual(alphaFirst, alphaSecondPool, "'alpha' stream must not depend on request order");
  assert.deepEqual(betaFirst, betaSecondPool, "'beta' stream must not depend on request order");
});

test('createRngPool: adding a new stream never perturbs an existing one', () => {
  // The whole reason independent streams exist: adding a call to one
  // builder must not reshuffle another builder's world. Simulate that by
  // drawing from 'forest', THEN introducing a brand-new stream ('newbuilder')
  // and interleaving draws — 'forest' must continue exactly as it would have
  // alone.
  const poolBaseline = createRngPool(7);
  const forestBaseline = Array.from({ length: 10 }, () => poolBaseline.stream('forest')());

  const poolWithExtra = createRngPool(7);
  const forestStream = poolWithExtra.stream('forest');
  const draws = [];
  for (let i = 0; i < 10; i++) {
    draws.push(forestStream());
    poolWithExtra.stream('newbuilder')(); // a sibling subsystem drawing concurrently
  }
  assert.deepEqual(draws, forestBaseline, 'a sibling stream drawing values must not shift this one');
});

test('createRngPool: different seeds produce different streams for the same name', () => {
  const poolA = createRngPool(1);
  const poolB = createRngPool(2);
  const a = Array.from({ length: 20 }, () => poolA.stream('forest')());
  const b = Array.from({ length: 20 }, () => poolB.stream('forest')());
  assert.notDeepEqual(a, b);
});

// ── World-seed registry / worldRng() ────────────────────────────────────

test('setWorldSeed / getWorldSeed round-trip a numeric seed', () => {
  setWorldSeed(555);
  assert.equal(getWorldSeed(), 555);
  setWorldSeed(null);
  assert.equal(getWorldSeed(), null);
});

test('setWorldSeed normalizes a string seed to a stable number', () => {
  setWorldSeed('my-seed');
  const first = getWorldSeed();
  setWorldSeed('my-seed');
  const second = getWorldSeed();
  assert.equal(first, second);
  assert.equal(typeof first, 'number');
  setWorldSeed(null);
});

test('worldRng falls back to Math.random when unseeded — the default, unchanged behaviour', () => {
  setWorldSeed(null);
  assert.equal(getWorldSeed(), null);
  assert.equal(worldRng('spherical-world:forest'), Math.random);
});

test('worldRng returns a deterministic generator once a seed is set', () => {
  setWorldSeed(2026);
  const rngA = worldRng('spherical-world:forest');
  assert.notEqual(rngA, Math.random);
  const seqA = Array.from({ length: 20 }, () => rngA());

  // Re-fetching the stream (as a second call to worldRng with the same name
  // would, e.g. from a second build at the same seed) reproduces the same
  // sequence from the start.
  const rngB = worldRng('spherical-world:forest');
  const seqB = Array.from({ length: 20 }, () => rngB());
  assert.deepEqual(seqA, seqB);
  setWorldSeed(null);
});

test('worldRng: independent subsystem names do not affect each other at one world seed', () => {
  setWorldSeed(2026);
  const forest = Array.from({ length: 12 }, () => worldRng('spherical-world:forest')());
  const shell = Array.from({ length: 12 }, () => worldRng('world-shell:forest')());
  const weather = Array.from({ length: 12 }, () => worldRng('weather:default')());
  const rings = Array.from({ length: 12 }, () => worldRng('collectibles:forest')());
  assert.notDeepEqual(forest, shell);
  assert.notDeepEqual(forest, weather);
  assert.notDeepEqual(forest, rings);
  assert.notDeepEqual(shell, weather);
  setWorldSeed(null);
});

// ── The actual deliverable: reproducible world geometry ─────────────────
//
// Simulates what a real builder does: fetch worldRng(name) ONCE per build,
// then pull many values from it for prop placement (position/rotation/
// scale draws, exactly the shape spherical-world.js's builders use). Two
// "builds" at the same seed must sum to the identical total; two builds at
// different seeds must not.

function fakeBuildInstancedTranslations(seedName, propCount) {
  const rng = worldRng(seedName);
  let sumX = 0, sumY = 0, sumZ = 0;
  const placements = [];
  for (let i = 0; i < propCount; i++) {
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * rng());
    const radius = 100 + rng() * 20;
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    sumX += x; sumY += y; sumZ += z;
    placements.push({ x, y, z });
  }
  return { sum: { x: sumX, y: sumY, z: sumZ }, placements };
}

test('two builds at the SAME seed produce IDENTICAL instanced-mesh translations', () => {
  setWorldSeed(31337);
  const buildA = fakeBuildInstancedTranslations('spherical-world:forest', 500);
  setWorldSeed(31337); // fresh "page load" at the same seed
  const buildB = fakeBuildInstancedTranslations('spherical-world:forest', 500);

  assert.deepEqual(buildA.placements, buildB.placements);
  const dx = Math.abs(buildA.sum.x - buildB.sum.x);
  const dy = Math.abs(buildA.sum.y - buildB.sum.y);
  const dz = Math.abs(buildA.sum.z - buildB.sum.z);
  assert.equal(dx, 0, `sum.x differs by ${dx}`);
  assert.equal(dy, 0, `sum.y differs by ${dy}`);
  assert.equal(dz, 0, `sum.z differs by ${dz}`);
  setWorldSeed(null);
});

test('two builds at DIFFERENT seeds produce DIFFERENT instanced-mesh translations', () => {
  setWorldSeed(31337);
  const buildA = fakeBuildInstancedTranslations('spherical-world:forest', 500);
  setWorldSeed(90210);
  const buildB = fakeBuildInstancedTranslations('spherical-world:forest', 500);

  assert.notDeepEqual(buildA.placements, buildB.placements);
  const dx = Math.abs(buildA.sum.x - buildB.sum.x);
  const dy = Math.abs(buildA.sum.y - buildB.sum.y);
  const dz = Math.abs(buildA.sum.z - buildB.sum.z);
  // A real difference, not float noise — different seeds should diverge by
  // a substantial amount across 500 draws, not by an epsilon.
  assert.ok(dx + dy + dz > 1, `builds at different seeds should diverge, got dx=${dx} dy=${dy} dz=${dz}`);
  setWorldSeed(null);
});

test('a build for one biome does not perturb a concurrent build for another biome at the same seed', () => {
  setWorldSeed(2026);
  const forestOnly = fakeBuildInstancedTranslations('spherical-world:forest', 40);

  setWorldSeed(2026);
  // Interleave an unrelated subsystem's draws in between this subsystem's —
  // exactly the "adding a call to one builder" scenario the independent
  // per-subsystem streams exist to protect against.
  const forestRng = worldRng('spherical-world:forest');
  const otherRng = worldRng('world-shell:forest');
  const interleaved = [];
  for (let i = 0; i < 40; i++) {
    const theta = forestRng() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * forestRng());
    const radius = 100 + forestRng() * 20;
    otherRng(); otherRng(); otherRng(); // a sibling subsystem drawing concurrently
    interleaved.push({
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.cos(phi),
      z: radius * Math.sin(phi) * Math.sin(theta),
    });
  }

  assert.deepEqual(interleaved, forestOnly.placements);
  setWorldSeed(null);
});
