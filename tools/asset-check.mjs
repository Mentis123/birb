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
import { decodePng, analyse, inferKind, MEM_BUDGET_MB } from './lib/asset-analysis.mjs';

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

for (const file of files) {
  const kind = explicitKind || inferKind(path.basename(file));
  let r;
  try {
    r = analyse(decodePng(fs.readFileSync(file), file), kind);
  } catch (err) {
    results.push({ file, kind, fails: [err.message], notes: [], mb: 0 });
    failed += 1;
    continue;
  }
  totalMb += r.mb;
  if (r.fails.length) failed += 1;
  results.push({ file, ...r });
}

const overBudget = totalMb > MEM_BUDGET_MB;
if (overBudget) failed += 1;

if (asJson) {
  console.log(JSON.stringify({ results, totalMb: +totalMb.toFixed(3), budgetMb: MEM_BUDGET_MB, overBudget, failed }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.fails.length ? 'FAIL' : 'ok  '} ${r.file}  [${r.kind}]`);
    for (const n of r.notes) console.log(`       ${n}`);
    for (const f of r.fails) console.log(`       -> ${f}`);
  }
  console.log(`\n${files.length} asset(s), ~${totalMb.toFixed(2)} MB decoded with mips (budget ${MEM_BUDGET_MB} MB)`);
  if (overBudget) console.error(`OVER TEXTURE BUDGET by ${(totalMb - MEM_BUDGET_MB).toFixed(2)} MB`);
}

if (failed) {
  console.error(`\n${failed} check(s) failed structural acceptance`);
  process.exit(1);
}
console.log('all assets pass structural acceptance (this says NOTHING about whether they look right)');
