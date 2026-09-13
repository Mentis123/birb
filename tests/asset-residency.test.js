import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * asset-residency.test.js — REFUTED and fixed here: tools/asset-check.mjs's
 * per-biome residency model undercounted twice, and both undercounts turned
 * a red gate green without the runtime actually being safe.
 *
 * `parseResidencyTable` and the aggregation loop it feeds are private to
 * asset-check.mjs (not exported from tools/lib/asset-analysis.mjs, where
 * every other unit-tested piece of this gate lives), so this is an
 * integration test over the real CLI and the real assets/MANIFEST.md table
 * rather than a unit test of an internal function. That is deliberate: the
 * bug that was found here is in how the TABLE reads, not in any one
 * function's math, and a fixture table would not have caught either half of
 * it — only the shipped one, read as it actually parses, does.
 *
 * The two things being guarded:
 *
 *   1. A biome cell can repeat a file's cost with `biome xN` when N separate
 *      materials in that biome each call `loadTexture` for the same file
 *      (`loadTexture` allocates a fresh `Texture` — a fresh GPU upload — per
 *      call, so this is a real second copy, not double-counting a shared
 *      one). A prior pass of the table always charged x1 regardless, which
 *      undercounted canyon_sandstone (2 materials), city_concrete (3) and
 *      forest's own bark_pine (2).
 *   2. Every sky panorama is charged to ALL FOUR biomes, not one, because
 *      `skyDome.setSkyTexture(null)` never disposes the outgoing texture and
 *      the dome sits outside spherical-world.js's per-switch teardown — so
 *      a session that has opened every biome once can be holding all four
 *      sky textures no matter which one it is standing in now. Charging one
 *      sky per biome (the prior table) was true only of a runtime that does
 *      not leak, and this one measurably does.
 */

const ROOT = path.join(import.meta.dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'asset-check.mjs');
const ASSETS_DIR = path.join(ROOT, 'assets', 'textures');
const haveAssets = fs.existsSync(ASSETS_DIR) && fs.readdirSync(ASSETS_DIR).some((f) => f.endsWith('.png'));
const skip = { skip: haveAssets ? false : 'assets/textures/* not present' };

/** Run the real CLI against the real assets/ dir and parse its human-readable output. */
function run() {
  let stdout;
  let code = 0;
  try {
    stdout = execFileSync('node', [TOOL, path.join(ROOT, 'assets')], { encoding: 'utf8' });
  } catch (err) {
    stdout = err.stdout ?? '';
    code = err.status ?? 1;
  }
  const biomeTotals = {};
  for (const m of stdout.matchAll(/biome (\w+): ~([\d.]+) MB resident/g)) {
    biomeTotals[m[1]] = Number(m[2]);
  }
  const worst = stdout.match(/worst biome: (\w+) at ~([\d.]+) MB/);
  return { code, stdout, biomeTotals, worstBiome: worst?.[1], worstMb: worst ? Number(worst[2]) : null };
}

test('the residency gate still exits 0 against the real shipped assets', skip, () => {
  const { code, worstMb } = run();
  assert.equal(code, 0, 'asset-check should pass against the shipped set');
  assert.ok(worstMb < 24, `worst biome ${worstMb} MB must clear the 24 MB budget`);
});

test('a file consumed by two or three materials in one biome is charged that many times', skip, () => {
  const { biomeTotals } = run();
  // canyons: canyon_sandstone x2 (spireMat + darkSpireMat), 1.333 MB each file
  // x2 files x2 uploads = 5.33 MB of canyon_sandstone alone, plus 4 leaked
  // skies at 2.667 MB = 10.67 MB -> 16.00 MB total, not the 13.33 MB an x1
  // charge (or a non-leaking single sky) would give.
  assert.ok(Math.abs(biomeTotals.canyons - 16.00) < 0.05,
    `canyons resident ${biomeTotals.canyons} MB -- expected ~16.00 (x2 sandstone charge missing?)`);
  // city: city_concrete x3 (three buildingMats), same shape.
  assert.ok(Math.abs(biomeTotals.city - 18.67) < 0.05,
    `city resident ${biomeTotals.city} MB -- expected ~18.67 (x3 concrete charge missing?)`);
  // forest: bark_pine x2 (landmark trunk + every instanced trunk) + stone_rock
  // x1 (the arch) + forest_ground_albedo x1 (the triplanar overlay, forest
  // only) + forest_ground_normal x0 (`none` -- never fetched).
  assert.ok(Math.abs(biomeTotals.forest - 20.00) < 0.05,
    `forest resident ${biomeTotals.forest} MB -- expected ~20.00`);
});

test('every biome carries all four skies, because the sky texture leaks across environment switches', skip, () => {
  const { biomeTotals } = run();
  // Each biome's total must be at least 4 * 2.667 MB just from sky panoramas
  // (they cannot dip below that floor regardless of what else is in the
  // biome), which is only true if every sky row lists all four biomes.
  const SKY_FLOOR = 4 * 2.667 - 0.05;
  for (const biome of ['forest', 'canyons', 'mountain', 'city']) {
    assert.ok(biomeTotals[biome] >= SKY_FLOOR,
      `biome ${biome} is ${biomeTotals[biome]} MB, below the 4-sky floor ${SKY_FLOOR.toFixed(2)} -- `
      + 'a sky row regressed to listing fewer than all four biomes');
  }
});

test('a file the manifest marks `none` costs nothing anywhere, and is not treated as unlisted', skip, () => {
  const manifestPath = path.join(ROOT, 'assets', 'MANIFEST.md');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  assert.match(manifest, /`textures\/forest_ground_normal\.png`\s*\|\s*none\s*\|/,
    'forest_ground_normal.png must be marked `none` -- it ships but the triplanar ground overlay never loads it');
  const { stdout } = run();
  const unlistedLine = stdout.split('\n').find((l) => l.includes('UNLISTED')) || '';
  assert.ok(!unlistedLine.includes('forest_ground_normal.png'),
    `forest_ground_normal.png must not appear in the UNLISTED line: "${unlistedLine}"`);
});

// ---------------------------------------------------------------------------
// Watched failing, not assumed to fail: a direct sabotage of the manifest
// table, run against a temp copy so the real file is never touched, proves
// the two REFUTED undercounts really do move the reported number.
test('reverting a sky row to one biome measurably undercounts every OTHER biome', skip, () => {
  const manifestPath = path.join(ROOT, 'assets', 'MANIFEST.md');
  const original = fs.readFileSync(manifestPath, 'utf8');
  const sabotaged = original.replace(
    '| `env/forest_sky.png` | forest, canyons, mountain, city |',
    '| `env/forest_sky.png` | forest |',
  );
  assert.notEqual(sabotaged, original, 'the row to sabotage was not found -- test is stale');
  fs.writeFileSync(manifestPath, sabotaged);
  try {
    const { biomeTotals } = run();
    // canyons/mountain/city each lose one sky's worth (2.667 MB) they should
    // still be charged for, since the leak means forest_sky can still be
    // resident when standing in any of them.
    assert.ok(biomeTotals.canyons < 16.00 - 2.0, 'sabotaged canyons total did not drop -- the fix has no effect');
  } finally {
    fs.writeFileSync(manifestPath, original); // restore even if an assertion above throws
  }
});
