import test from 'node:test';
import assert from 'node:assert/strict';
import { createColliderGrid } from '../src/environment/collider-grid.js';

// Deterministic PRNG (mulberry32) so failures reproduce exactly.
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mirror the real world: colliders scattered on/above a radius-120 shell with
// the radii the env builders actually use (trunks ~1, canopies ~6, clouds ~18).
function makeWorldColliders(random, count) {
  const colliders = [];
  for (let i = 0; i < count; i++) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * random());
    const altitude = 120 + random() * 18 - 9;
    colliders.push({
      position: {
        x: altitude * Math.sin(phi) * Math.cos(theta),
        y: altitude * Math.cos(phi),
        z: altitude * Math.sin(phi) * Math.sin(theta),
      },
      radius: 0.5 + random() * 17.5,
      type: 'test',
    });
  }
  return colliders;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

test('grid candidates are complete vs brute force for entityRadius <= cellSize', () => {
  const random = makeRandom(0xb1bb);
  const grid = createColliderGrid(14);
  const colliders = makeWorldColliders(random, 1200);
  for (const c of colliders) grid.insert(c);

  const entityRadius = 0.6; // the bird's actual collision radius
  let totalHits = 0;
  for (let q = 0; q < 500; q++) {
    // Query points hover in the bird's flight band around the shell.
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * random());
    const altitude = 118 + random() * 14;
    const p = {
      x: altitude * Math.sin(phi) * Math.cos(theta),
      y: altitude * Math.cos(phi),
      z: altitude * Math.sin(phi) * Math.sin(theta),
    };

    const expected = colliders.filter(
      (c) => distance(p, c.position) < c.radius + entityRadius
    );
    const candidates = new Set(grid.query(p.x, p.y, p.z));
    for (const c of expected) {
      assert.ok(
        candidates.has(c),
        `collider at distance ${distance(p, c.position).toFixed(2)} ` +
          `(radius ${c.radius.toFixed(2)}) missing from candidate set`
      );
    }
    totalHits += expected.length;
  }
  // Sanity: the scenario must actually exercise hits, or the test proves nothing.
  assert.ok(totalHits > 0, 'expected at least one true collision across queries');
});

test('query prunes heavily compared to the full collider list', () => {
  const random = makeRandom(0xcafe);
  const grid = createColliderGrid(14);
  const colliders = makeWorldColliders(random, 1200);
  for (const c of colliders) grid.insert(c);

  let totalCandidates = 0;
  const queries = 200;
  for (let q = 0; q < queries; q++) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * random());
    const p = {
      x: 121 * Math.sin(phi) * Math.cos(theta),
      y: 121 * Math.cos(phi),
      z: 121 * Math.sin(phi) * Math.sin(theta),
    };
    totalCandidates += grid.query(p.x, p.y, p.z).length;
  }
  const avg = totalCandidates / queries;
  // The whole point: a neighborhood query must test far fewer than all 1,200.
  assert.ok(avg < 120, `average candidate count ${avg.toFixed(1)} is not a meaningful prune`);
});

test('clear() empties the grid and reused result array does not leak stale entries', () => {
  const grid = createColliderGrid(14);
  grid.insert({ position: { x: 0, y: 0, z: 0 }, radius: 2 });
  assert.equal(grid.query(0, 0, 0).length, 1);
  grid.clear();
  assert.equal(grid.query(0, 0, 0).length, 0);
});
