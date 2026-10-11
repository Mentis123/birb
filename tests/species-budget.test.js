// The crow's and the owl's cost, pinned (src/flight/species/, CLAUDE.md "THE
// BIRD PICKER", Budget). Built with the real builders in node, the same pure
// spec createSpeciesBird uploads. The whole-frame side of the budget is
// tools/species-frame-budget.mjs (the real page); this pins the bird's half of
// it, so a change that grows a bird shows up here and not first on a phone.
//
// 2026-10-09 geometry trim (geometry only, every tier): the crow 2,722 -> 2,604
// (high, mid) and 1,690 -> 1,614 (low); the owl 3,461 -> 2,911 (high, mid) and
// 2,404 -> 2,080 (low). What went: zero-area pole/tip triangles (minTriArea),
// three-sided toes and a leaner standing gear (legLean), the gears' rim face
// from 6 triangles a tooth (gearRimRoots), the owl's body/head triangles
// buried inside the two shells (dropHidden), and on the owl's high/mid mesh
// 3-sided rivet domes and 4-sided gear hubs (~2 px at the chase camera).
// Draw calls unchanged. Evidence: shots/main-species-final/look/ (before/after
// pixel diffs, deterministic harness).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIRD_BUDGET } from '../src/flight/bird-contract.js';
import { buildSpeciesSpec, SPECIES_TIERS, SPECIES_FORM } from '../src/flight/species/species-bird.js';
import { buildCrow, CROW_LOD } from '../src/flight/species/crow.js';
import { buildOwl, OWL_LOD } from '../src/flight/species/owl.js';
import { triangleCount, dropSlivers, dropInside, loftInside } from '../src/flight/species/mesh-kit.js';

/** Per (species, look tier): [triangles, draw calls]. */
const PINNED = Object.freeze({
  crow: { high: [2604, 7], mid: [2604, 7], low: [1614, 6] },
  owl: { high: [2911, 6], mid: [2911, 6], low: [2080, 6] },
});

/**
 * The SEEDED Ultra forest spawn without a bird: tools/species-frame-budget.mjs
 * `forest-seeds` (max over world seeds 16160, 1, 2), which measured 74,620 for
 * all three birds on 2026-10-09 (frame minus bird: Pionus 76,138 - 1,518,
 * crow 77,224 - 2,604, owl 77,531 - 2,911). The boot's RANDOM world is not
 * pinnable — 73.3k-77.5k measured, so the 1,518-triangle Pionus itself read
 * 79,000 on one boot — and is held to the 80k budget, not this headroom.
 */
const FOREST_ULTRA_WORLD_SEEDED = 74620;
const FOREST_ULTRA_GATE = 78000;

function cost(spec) {
  let tris = 0;
  for (const m of spec.meshes) tris += triangleCount(m.data);
  const wing = spec.meshes.find((m) => m.role === 'wing');
  tris += triangleCount(wing.data);                       // the mirrored wing
  tris += triangleCount(spec.legs.left) + triangleCount(spec.legs.right);
  return { tris, draws: spec.meshes.length + 1 + 2 };
}

test('per-tier triangles and draw calls are pinned, and inside BIRD_BUDGET', () => {
  for (const species of ['crow', 'owl']) {
    for (const q of SPECIES_TIERS) {
      const spec = buildSpeciesSpec(species, q);
      const c = cost(spec);
      assert.equal(c.tris, spec.triangles, `${species}/${q}: the spec's own count`);
      assert.deepEqual([c.tris, c.draws], PINNED[species][q], `${species}/${q}`);
      assert.ok(c.tris <= BIRD_BUDGET.maxTriangles && c.draws <= BIRD_BUDGET.maxDrawCalls, `${species}/${q} in BIRD_BUDGET`);
    }
  }
});

test('the seeded Ultra forest spawn keeps its headroom with every bird (world + the tier-0 bird)', () => {
  for (const species of ['crow', 'owl']) {
    const [tris] = PINNED[species].high;
    assert.ok(FOREST_ULTRA_WORLD_SEEDED + tris <= FOREST_ULTRA_GATE,
      `${species}: ${FOREST_ULTRA_WORLD_SEEDED} + ${tris} > ${FOREST_ULTRA_GATE}`);
  }
});

test("the trim is root-only: Gauntlet's own LOD tables build Gauntlet's mesh", () => {
  for (const k of ['minTriArea', 'legLean', 'gearRimRoots', 'dropHidden', 'discInner']) {
    for (const q of ['high', 'mid', 'low']) {
      assert.equal(OWL_LOD[q][k], undefined, `OWL_LOD.${q}.${k}`);
      assert.equal(CROW_LOD[q][k], undefined, `CROW_LOD.${q}.${k}`);
    }
  }
  // Gauntlet's meshes with the root's standing legs, no root LOD: the counts
  // from before the trim (the crow's mid and the owl's low were the shipped
  // 2,722 and 2,404).
  const owlLegs = { len: SPECIES_FORM.owl.legLen }, crowLegs = { len: SPECIES_FORM.crow.legLen };
  assert.equal(buildOwl({ quality: 'mid', legs: owlLegs }).triangles, 4958);
  assert.equal(buildOwl({ quality: 'low', legs: owlLegs }).triangles, 2404);
  assert.equal(buildCrow({ quality: 'mid', legs: crowLegs }).triangles, 2722);
  assert.equal(buildCrow({ quality: 'low', legs: crowLegs }).triangles, 1690);
});

test('the trims drop index entries only: every vertex attribute is untouched', () => {
  const legs = { len: SPECIES_FORM.owl.legLen };
  const plain = buildOwl({ quality: 'mid', legs });
  const lean = buildOwl({ quality: 'mid', legs, lod: { minTriArea: 1e-6, gearRimRoots: false, dropHidden: 0.7 } });
  for (let i = 0; i < plain.meshes.length; i++) {
    const a = plain.meshes[i].data, b = lean.meshes[i].data;
    assert.deepEqual(b.arrays.position, a.arrays.position, a.name + ' positions');
    assert.deepEqual(b.arrays.uv, a.arrays.uv, a.name + ' uvs');
    assert.ok(b.index.length <= a.index.length, a.name);
  }
});

test('dropSlivers removes exactly the zero-area triangles', () => {
  const md = {
    arrays: { position: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0] },
    index: [0, 1, 2, 0, 3, 1],      // a real triangle, then one with two coincident corners
  };
  assert.equal(dropSlivers(md, 1e-6), 1);
  assert.deepEqual(md.index, [0, 1, 2]);
});

test('dropInside drops a triangle only when ALL of it is inside one volume, and never a moving one', () => {
  const rows = [{ z: -1, y: 0, w: 1, t: 1, b: 1 }, { z: 1, y: 0, w: 1, t: 1, b: 1 }];
  const inside = loftInside(rows, { level: 0.7 });
  const md = {
    arrays: {
      position: [
        0, 0, 0, 0.1, 0, 0, 0, 0.1, 0,          // deep inside
        0, 0, 0, 0.99, 0, 0, 0, 0.1, 0,         // one corner on the shell
        0, 0, 0.5, 0.1, 0, 0.5, 0, 0.1, 0.5,    // inside, but flagged moving
      ],
    },
    index: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  };
  const dropped = dropInside(md, [inside], (i) => i >= 6);
  assert.equal(dropped, 1);
  assert.deepEqual(md.index, [3, 4, 5, 6, 7, 8]);
});
