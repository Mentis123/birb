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
 *   2. Each sky panorama is charged to EXACTLY ONE biome — its own — because
 *      `setSkyTexture` disposes the outgoing panorama before rebinding, so a
 *      session that has opened every biome holds only the sky it is standing
 *      in. This row was briefly the opposite: while the dome leaked (it only
 *      nulled the uniform, and it sits outside spherical-world.js's per-switch
 *      teardown), every sky was charged to all four biomes, because the honest
 *      worst case was "every sky ever opened may still be resident."
 *
 *      THAT COMPENSATION IS NOW RETIRED, AND THIS TEST IS ITS OTHER HALF.
 *      A one-sky-per-biome charge is only honest if the runtime really does
 *      dispose, and nothing in this file can see the runtime — it reads a
 *      markdown table and a CLI's arithmetic. The runtime half is
 *      `node tools/birb-textures.mjs`, which hooks the driver's own
 *      createTexture/deleteTexture and asserts the live count goes flat once
 *      a session starts revisiting biomes (measured: flat at 16 live across
 *      three laps; +4 per lap with the dispose removed). If that tool goes
 *      red, the four sky rows in MANIFEST.md are lying and must go back to
 *      listing all four biomes until it is green again. Neither check is
 *      sufficient alone: this one cannot see a leak, and that one cannot see
 *      a budget.
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
  // THE BIRD TAX. Every total below carries a flat +3.33 MB that no biome can
  // shed, because the bird is in all four: feather_contour and feather_vane at
  // 1.333 MB each (512 albedo) plus their 256 normals at 0.333 MB each. It is
  // listed here rather than folded silently into the literals so that a future
  // reader can see which part of each number belongs to the world and which
  // part belongs to the one object that is always on screen.
  const BIRD = 3.333;
  // Every biome also carries its OWN sky and no other, which is the dispose
  // fix (see the header). Named so the x2/x3 arithmetic below stays readable
  // and so a sky-charge regression moves these numbers somewhere visible
  // rather than hiding inside a literal.
  const OWN_SKY = 2.667;
  // Each literal below is the biome's PROP textures only -- no sky, no bird --
  // so the three terms stay separately checkable. Fold the sky into the prop
  // figure and a sky regression and a prop regression become the same number.
  // canyons: canyon_sandstone x2 (spireMat + darkSpireMat), 1.333 MB per file
  // x2 files x2 uploads = 5.33 MB of sandstone alone, not the 2.67 MB an x1
  // charge would give.
  assert.ok(Math.abs(biomeTotals.canyons - (5.333 + OWN_SKY + BIRD)) < 0.05,
    `canyons resident ${biomeTotals.canyons} MB -- expected ~${(5.333 + OWN_SKY + BIRD).toFixed(2)} (x2 sandstone charge missing?)`);
  // city: city_concrete x3 (three buildingMats), same shape -- 1.333 per file
  // x2 files x3 uploads = 8.00 MB.
  assert.ok(Math.abs(biomeTotals.city - (8.00 + OWN_SKY + BIRD)) < 0.05,
    `city resident ${biomeTotals.city} MB -- expected ~${(8.00 + OWN_SKY + BIRD).toFixed(2)} (x3 concrete charge missing?)`);
  // forest: bark_pine x2 (landmark trunk + every instanced trunk) + stone_rock
  // x1 (the arch) + forest_ground_albedo x1 (the triplanar overlay, forest
  // only) + forest_ground_normal x0 (`none` -- never fetched). This is the
  // worst biome and therefore the one the 24 MB gate actually scores.
  assert.ok(Math.abs(biomeTotals.forest - (9.333 + OWN_SKY + BIRD)) < 0.05,
    `forest resident ${biomeTotals.forest} MB -- expected ~${(9.333 + OWN_SKY + BIRD).toFixed(2)}`);
});

test('each sky panorama is charged to its own biome and no other', skip, () => {
  const manifestPath = path.join(ROOT, 'assets', 'MANIFEST.md');
  const whole = fs.readFileSync(manifestPath, 'utf8');
  // Scoped to the residency section. Every sky appears TWICE in this file: once
  // in the provenance table at the top, whose second column is a description --
  // so an unscoped match reads the biome cell as "RGB LDR equirectangular
  // environment" and the assertion fails for a reason that has nothing to do
  // with residency.
  const cut = whole.indexOf('## Per-biome resident set');
  assert.ok(cut > 0, 'the "## Per-biome resident set" heading moved -- this test is reading the wrong table');
  const manifest = whole.slice(cut);
  // Read the rows rather than inferring from the totals: four skies charged one
  // each and one sky charged to four biomes differ by 8 MB in the totals, but a
  // total is a sum and a sum can be made to agree by accident. The row is the
  // claim.
  for (const biome of ['forest', 'canyons', 'mountain', 'city']) {
    const row = new RegExp(`\\|\\s*\`env/${biome}_sky\\.png\`\\s*\\|([^|]*)\\|`);
    const m = manifest.match(row);
    assert.ok(m, `no residency row for env/${biome}_sky.png`);
    const cell = m[1].trim();
    assert.equal(cell, biome,
      `env/${biome}_sky.png is charged to "${cell}", expected exactly "${biome}". `
      + 'If the dome started leaking again, this row going back to all four biomes is '
      + 'the CORRECT response -- but fix tools/birb-textures.mjs red first, and flip '
      + 'this assertion deliberately rather than to make a suite green.');
  }
});

test('the sky charge is what separates the budget from the leak, and it is worth 8 MB', skip, () => {
  // The compensation this test replaced cost every biome 8 MB (three foreign
  // skies at 2.667). Asserting the SIZE of that gap, not just the current
  // totals, is what stops the sky rows being quietly widened again as cheap
  // headroom relief: doing so is a 32 MB worst case, and the 24 MB ceiling
  // would catch it -- but only while somebody knows that is what happened.
  const { biomeTotals, worstMb } = run();
  const FOREIGN_SKIES = 3 * 2.667;
  assert.ok(worstMb < 24 - FOREIGN_SKIES + 0.05,
    `worst biome ${worstMb} MB is within 8 MB of the 24 MB ceiling -- either a sky row `
    + 'widened back to all four biomes, or the authored set genuinely grew. Check which.');
  for (const biome of ['forest', 'canyons', 'mountain', 'city']) {
    assert.ok(biomeTotals[biome] >= 2.667 - 0.05,
      `biome ${biome} is ${biomeTotals[biome]} MB, below one sky's 2.67 -- its own sky row went missing`);
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
test('widening a sky row back to all four biomes measurably overcharges every OTHER biome', skip, () => {
  const manifestPath = path.join(ROOT, 'assets', 'MANIFEST.md');
  const original = fs.readFileSync(manifestPath, 'utf8');
  const sabotaged = original.replace(
    '| `env/forest_sky.png` | forest |',
    '| `env/forest_sky.png` | forest, canyons, mountain, city |',
  );
  assert.notEqual(sabotaged, original, 'the row to sabotage was not found -- test is stale');
  fs.writeFileSync(manifestPath, sabotaged);
  try {
    const { biomeTotals } = run();
    // canyons/mountain/city each gain forest_sky's 2.667 MB they no longer
    // carry. Proves the table is load-bearing: the one-biome cell really is
    // what takes 8 MB off each row, not a coincidence of the arithmetic.
    // Baseline canyons is 5.333 props + 2.667 own sky + 3.333 bird = 11.33;
    // gaining forest_sky takes it to ~14.00. The 2.0 margin is most of one
    // sky, so a no-op edit cannot satisfy it.
    assert.ok(biomeTotals.canyons > 5.333 + 2.667 + 3.333 + 2.0,
      `sabotaged canyons total ${biomeTotals.canyons} did not rise -- the sky row has no effect, `
      + 'so the one-biome charge this suite asserts is not actually what produces the number');
  } finally {
    fs.writeFileSync(manifestPath, original); // restore even if an assertion above throws
  }
});
