/**
 * tests/build-identity.test.js — CONTRACT §8.3 SW-1..SW-3 / task P2.1f.
 *
 * No build step (House Rule 5), so the "build identity" is two hand-written
 * literals that must never drift apart:
 *
 *   index.html:  const BIRB_BUILD = '<literal>';
 *   sw.js:       const CACHE_VERSION = '<literal>';
 *
 * SW-2 asserts they are the same string. SW-3 asserts sw.js's CORE_ASSETS
 * enumerates every `src/**\/*.js` module on disk (minus a commented
 * allow-list of deliberate omissions) — the row that makes a new module NOT
 * shipping offline (CONTRACT §8.2, the /AR blank-page failure) fail loudly
 * here instead of on a phone in a park.
 *
 * Reads both files as TEXT — no browser, no import of either — so this runs
 * under `node --test` against the tracked three-stub with no install step,
 * exactly like tests/quality-assertions.test.js's own text-based checks.
 *
 * Gated behind BIRB_PERF_IMPL for the same reason as every other Wave 2 test
 * in this repo (tests/quality-settings.test.js, tests/gpu-timer.test.js,
 * tests/frame-stats-totals.test.js): the SW-3 check enumerates `src/game/
 * frame-stats.js`, `src/game/gpu-timer.js`, `src/game/quality-settings.js`,
 * `src/ui/dev-quality-panel.js` and `src/ui/dev-gesture.js`, which are Wave 2
 * deliverables — running this unconditionally would move `npm test`'s
 * env-unset counts (460/378/0/82) as those files land mid-wave, which is
 * exactly the rollout hazard the BIRB_PERF_IMPL convention exists to avoid.
 *
 *   BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMPL = process.env.BIRB_PERF_IMPL ? false
  : 'BIRB_PERF_IMPL unset — build-identity coverage depends on Wave 2 src/ modules (P2.1f)';

// CONTRACT §8.1: deliberate, commented omissions from CORE_ASSETS.
const DELIBERATE_OMISSIONS = Object.freeze([
  'src/controls/simple-flight-controller.js',
  // The bird rig contract oracle (docs/realism/BIRD_PLAN.md Phase 0). It is
  // fetched with a dynamic import() only from the ?glb=1 A/B path and the
  // ?debug=1 __BIRB.contract() hook — never from the unconditional boot
  // sequence — specifically so a first offline load never needs it cached:
  // sw.js is owned by a concurrent workflow, and coordinating a CORE_ASSETS +
  // CACHE_VERSION bump into that file's next commit was judged costlier than
  // keeping this module fully optional. Revisit if it ever becomes a boot-path
  // import again.
  'src/flight/bird-contract.js',
]);

function readIndexHtml() {
  return fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
}

function readSwJs() {
  return fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');
}

function extractBirbBuild(html) {
  const m = html.match(/const\s+BIRB_BUILD\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

function extractCacheVersion(sw) {
  const m = sw.match(/const\s+CACHE_VERSION\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

function extractCoreAssets(sw) {
  const m = sw.match(/const\s+CORE_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  const body = m[1];
  const paths = [];
  const re = /'\.\/([^']+)'/g;
  let hit;
  while ((hit = re.exec(body))) paths.push(hit[1]);
  return paths;
}

function allSrcModules() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(REPO_ROOT, 'src'));
  return out.sort();
}

test('SW-1: index.html declares a BIRB_BUILD literal', { skip: IMPL }, () => {
  const build = extractBirbBuild(readIndexHtml());
  assert.ok(build, 'index.html has no `const BIRB_BUILD = \'...\'` literal (CONTRACT §8.3 SW-1).');
});

test('SW-2: BIRB_BUILD (index.html) === CACHE_VERSION (sw.js)', { skip: IMPL }, () => {
  const build = extractBirbBuild(readIndexHtml());
  const version = extractCacheVersion(readSwJs());
  assert.ok(build, 'index.html BIRB_BUILD literal missing.');
  assert.ok(version, 'sw.js CACHE_VERSION literal missing.');
  assert.equal(
    build, version,
    `BIRB_BUILD ("${build}") !== CACHE_VERSION ("${version}") — a device served by this sw.js would ` +
    'run a different src/** build than the index.html it just loaded (CONTRACT §8.2 measurement hazard).',
  );
});

test('SW-3: CORE_ASSETS covers every src/**/*.js module, minus the documented omissions', { skip: IMPL }, () => {
  const sw = readSwJs();
  const coreAssets = extractCoreAssets(sw);
  const coreSrcAssets = new Set(coreAssets.filter((p) => p.startsWith('src/')));
  const onDisk = allSrcModules();
  const missing = onDisk.filter((p) => !coreSrcAssets.has(p) && !DELIBERATE_OMISSIONS.includes(p));
  assert.deepEqual(
    missing, [],
    `CORE_ASSETS is missing: ${missing.join(', ')}. A src/ module absent from CORE_ASSETS is a blank ` +
    'page offline (CONTRACT §8.1/§8.2) — the /AR failure sw.js\'s own comment memorialises. Add it to ' +
    'CORE_ASSETS, or to DELIBERATE_OMISSIONS above with a reason, in the same commit as the module.',
  );
  // The inverse direction: every DELIBERATE_OMISSIONS entry must still exist
  // on disk and still be absent from CORE_ASSETS, or the allow-list is stale.
  for (const omitted of DELIBERATE_OMISSIONS) {
    assert.ok(onDisk.includes(omitted), `DELIBERATE_OMISSIONS lists "${omitted}", which no longer exists on disk — stale allow-list entry.`);
    assert.ok(!coreSrcAssets.has(omitted), `"${omitted}" is both in DELIBERATE_OMISSIONS and in CORE_ASSETS — pick one.`);
  }
});

test('SW-3b: CORE_ASSETS names no src/ module that does not exist on disk', { skip: IMPL }, () => {
  const coreAssets = extractCoreAssets(readSwJs());
  const onDisk = new Set(allSrcModules());
  const ghosts = coreAssets.filter((p) => p.startsWith('src/') && !onDisk.has(p));
  assert.deepEqual(ghosts, [], `CORE_ASSETS references src/ files that do not exist: ${ghosts.join(', ')}.`);
});
