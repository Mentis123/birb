#!/usr/bin/env node
/**
 * asset-check.mjs — structural acceptance for authored textures.
 *
 * docs/realism/README.md approves "authored meshes and a small compressed
 * texture set for root Birb". This is the gate that keeps that permission from
 * becoming a way to smuggle in surfaces nobody checked.
 *
 * It exists because the ways a generated texture is wrong are MECHANICAL, and
 * therefore catchable without an eye:
 *
 *   - it does not tile, and the seam only shows once it is on a hillside
 *   - it has the sun baked into its albedo, which fights the renderer's own
 *     light and reads as "the materials look wrong" while every check passes
 *   - it is a roughness map that is not greyscale, or a "normal map" that is
 *     really a height field
 *   - it is not a power of two, so it cannot be mipped, so it aliases
 *   - it costs more decoded texture memory than a phone has to spare
 *
 * None of those needs a human. What DOES need a human is whether the rock looks
 * like rock, and this tool says nothing about that on purpose.
 *
 *   node tools/asset-check.mjs <file.png> [--kind albedo|normal|roughness|sky]
 *   node tools/asset-check.mjs assets/textures/            (whole directory, recursive)
 *   node tools/asset-check.mjs assets/textures/ --json     (machine-readable)
 *
 * Exits non-zero if any asset fails. Zero dependencies: PNG is parsed with
 * Node's own zlib, because this repo installs nothing to run its checks.
 * The measuring functions live in tools/lib/asset-analysis.mjs and are unit
 * tested in tests/asset-check.test.js — every threshold here has been watched
 * rejecting a texture built to violate it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, analyse, inferKind, MEM_BUDGET_MB } from './lib/asset-analysis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.error('usage: node tools/asset-check.mjs <file.png|dir> [--kind albedo|normal|roughness|sky] [--json]');
  process.exit(args.length ? 0 : 2);
}
const kindFlag = args.indexOf('--kind');
const explicitKind = kindFlag >= 0 ? args[kindFlag + 1] : null;
const asJson = args.includes('--json');
const target = args.find(a => !a.startsWith('--') && a !== explicitKind);

if (!target || !fs.existsSync(target)) {
  console.error(`asset-check: nothing to check at ${target || '(no path given)'}`);
  process.exit(2);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.toLowerCase().endsWith('.png')) out.push(full);
  }
  return out.sort();
}

const isDir = fs.statSync(target).isDirectory();
const files = isDir ? walk(target) : [target];
if (!files.length) {
  // An empty asset root is not an error: it is the state this repo is in until
  // the first authored texture lands, and CI wires this step up before then so
  // that the gate is live the moment one arrives. A missing PATH is still a 2.
  if (isDir) {
    console.log(`asset-check: no .png under ${target} yet — nothing to reject`);
    process.exit(0);
  }
  console.error(`asset-check: ${target} is not a .png`);
  process.exit(2);
}

const results = [];
let failed = 0;
let totalMb = 0;

/**
 * A normal map's convention (green-up vs green-down) is only decidable against
 * the height field it was derived from, and the sibling albedo is the closest
 * thing to that on disk. `bark_pine_normal.png` -> `bark_pine_albedo.png`.
 * Without it the check abstains, which is why a lone --kind normal run says
 * nothing about the one bug that renders as plausible material.
 */
/**
 * The runtime never holds more than one biome's world at once —
 * spherical-world.js disposes the previous environment's textures on every
 * switch — so summing every authored texture on disk is not the number the
 * MEM_BUDGET_MB was meant to bound. This reads the residency table from
 * assets/MANIFEST.md's "## Per-biome resident set" section (a `| \`file\` |
 * biome, biome |` markdown table) and returns { file -> [{biome, count}] },
 * or null if the section is absent — callers fall back to the plain
 * directory sum so a repo without the table yet (or a check of a lone file)
 * still works.
 *
 * Two things a plain biome list cannot say, both REFUTED findings on an
 * earlier pass of this table:
 *
 *   - A biome cell may repeat with `biome xN` (e.g. `canyons x2`) when more
 *     than one material in that biome loads its own copy of the same file.
 *     `loadTexture` creates a fresh `Texture` (a fresh GPU upload) per
 *     `apply*` call, so a file two materials each call it for really is
 *     resident twice, not once — canyon_sandstone (spireMat + darkSpireMat),
 *     city_concrete (three buildingMats) and bark_pine in forest (the
 *     landmark trunk + every instanced trunk) are the measured cases.
 *   - A cell of exactly `none` records a file that ships under `assets/` but
 *     is never fetched at runtime by anything (present, zero residency) —
 *     distinct from a file simply missing from this table, which is charged
 *     in EVERY biome on purpose (see the UNLISTED handling below). Without
 *     this a shipped-but-unused file (forest_ground_normal.png: the
 *     triplanar ground overlay has no normal slot to put it in) would have
 *     to be either omitted from the table — and silently over-charged to
 *     every biome — or given a biome it does not actually load in, which
 *     is the same kind of untrue number this table exists to stop.
 *   - Sky panoramas are a THIRD case this table has to get right and did
 *     not: `skyDome.setSkyTexture(null)` only nulls the uniform, it never
 *     disposes the outgoing texture, and the dome lives outside the world
 *     teardown `spherical-world.js` runs on every environment switch — so
 *     an env leak means all four skies can be simultaneously resident by
 *     the time a session has visited every biome once. Measured (hooking
 *     `createTexture`/`deleteTexture` across 12 switches): default holds 13
 *     live textures above a `?skytex=0` baseline after four biomes, ~34.7 MB
 *     of leaked panoramas. That fix belongs to `sky-dome.js`/`index.html`,
 *     outside this file's ownership — until it lands, each sky row below
 *     lists ALL FOUR biomes rather than one, so the worst-case number this
 *     gate reports is honest about what the runtime can actually accumulate
 *     today, not what it would hold if the leak were already fixed.
 */
function parseResidencyTable(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  const text = fs.readFileSync(manifestPath, 'utf8');
  const headingIdx = text.indexOf('## Per-biome resident set');
  if (headingIdx < 0) return null;
  const rest = text.slice(headingIdx);
  const nextHeading = rest.indexOf('\n## ', 1);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  const table = {};
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) continue;
    const file = m[1].trim();
    if (/^-+$/.test(file)) continue; // separator row
    const cell = m[2].trim();
    if (/^none$/i.test(cell)) { table[file] = []; continue; } // shipped, never fetched
    const entries = [];
    for (const token of cell.split(',')) {
      const tm = token.trim().match(/^([a-z][a-z0-9_-]*)\s*(?:[x×]\s*(\d+))?$/i);
      if (!tm) continue;
      entries.push({ biome: tm[1], count: tm[2] ? Number(tm[2]) : 1 });
    }
    if (entries.length) table[file] = entries;
  }
  return Object.keys(table).length ? table : null;
}

function siblingAlbedo(file) {
  const base = path.basename(file);
  const stem = base.replace(/_(normal|nrm)\.png$/i, '');
  if (stem === base) return null;
  for (const suffix of ['_albedo', '_basecolor', '_color', '_colour', '_diff']) {
    const candidate = path.join(path.dirname(file), `${stem}${suffix}.png`);
    if (fs.existsSync(candidate)) {
      try { return decodePng(fs.readFileSync(candidate), candidate); } catch { return null; }
    }
  }
  return null;
}

for (const file of files) {
  const kind = explicitKind || inferKind(path.basename(file));
  let r;
  try {
    const siblings = kind === 'normal' ? { albedo: siblingAlbedo(file) } : {};
    r = analyse(decodePng(fs.readFileSync(file), file), kind, siblings);
  } catch (err) {
    results.push({ file, kind, fails: [err.message], notes: [], mb: 0 });
    failed += 1;
    continue;
  }
  totalMb += r.mb;
  if (r.fails.length) failed += 1;
  results.push({ file, ...r });
}

// The runtime holds one biome's textures at a time (spherical-world.js
// disposes the previous environment's on every switch), so the directory
// SUM is not the number MEM_BUDGET_MB was meant to bound — the worst single
// biome's resident set is. Score that when assets/MANIFEST.md's residency
// table is available; fall back to the plain sum (old behaviour) otherwise,
// so a lone-file check or a repo without the table yet still works.
const manifestPath = path.join(__dirname, '..', 'assets', 'MANIFEST.md');
const residency = parseResidencyTable(manifestPath);

let biomeTotals = null;
let worstBiome = null;
let worstMb = totalMb;
let unlisted = [];

if (residency) {
  const biomeSet = new Set();
  for (const entries of Object.values(residency)) for (const e of entries) biomeSet.add(e.biome);
  biomeTotals = {};
  for (const b of biomeSet) biomeTotals[b] = 0;
  for (const r of results) {
    const rel = r.file.replace(/^.*?assets[\\/]/, '');
    const listed = residency[rel];
    if (listed) {
      // Each entry's `count` is how many separate GPU uploads that biome
      // actually makes of this one file — loadTexture() creates a fresh
      // Texture per apply* call, so two materials sharing a file really do
      // cost it twice. An empty array (a `none` cell: shipped, never
      // fetched) correctly adds nothing to any biome.
      for (const e of listed) biomeTotals[e.biome] += r.mb * e.count;
    } else {
      unlisted.push(rel);
      // Unlisted is charged in EVERY biome — conservative, so a table that
      // fell behind the files on disk fails loud instead of under-counting.
      for (const b of biomeSet) biomeTotals[b] += r.mb;
    }
  }
  const ranked = Object.entries(biomeTotals).sort((a, b) => b[1] - a[1]);
  if (ranked.length) { [worstBiome, worstMb] = ranked[0]; }
}

const overBudget = worstMb > MEM_BUDGET_MB;
if (overBudget) failed += 1;

if (asJson) {
  console.log(JSON.stringify({
    results, totalMb: +totalMb.toFixed(3), budgetMb: MEM_BUDGET_MB,
    biomeTotals: biomeTotals ? Object.fromEntries(Object.entries(biomeTotals).map(([k, v]) => [k, +v.toFixed(3)])) : null,
    worstBiome, worstMb: +worstMb.toFixed(3), unlisted, overBudget, failed,
  }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.fails.length ? 'FAIL' : 'ok  '} ${r.file}  [${r.kind}]`);
    for (const n of r.notes) console.log(`       ${n}`);
    for (const f of r.fails) console.log(`       -> ${f}`);
  }
  console.log(`\n${files.length} asset(s), ~${totalMb.toFixed(2)} MB decoded with mips if all resident at once (directory sum, NOT the budget gate)`);
  if (biomeTotals) {
    if (unlisted.length) console.log(`  UNLISTED in the residency table (charged in every biome): ${unlisted.join(', ')}`);
    for (const [b, mb] of Object.entries(biomeTotals).sort((a, b2) => b2[1] - a[1])) {
      console.log(`  biome ${b}: ~${mb.toFixed(2)} MB resident`);
    }
    console.log(`  worst biome: ${worstBiome} at ~${worstMb.toFixed(2)} MB (budget ${MEM_BUDGET_MB} MB)`);
  } else {
    console.log(`  (no residency table found at ${manifestPath} — scoring the directory sum against the budget instead)`);
  }
  if (overBudget) console.error(`OVER TEXTURE BUDGET: worst biome ${worstBiome ?? '(directory sum)'} is ${(worstMb - MEM_BUDGET_MB).toFixed(2)} MB over`);
}

if (failed) {
  console.error(`\n${failed} check(s) failed structural acceptance`);
  process.exit(1);
}
console.log('all assets pass structural acceptance (this says NOTHING about whether they look right)');
