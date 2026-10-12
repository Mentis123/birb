#!/usr/bin/env node
/**
 * tools/species-frame-budget.mjs — the WHOLE-FRAME triangle and draw-call
 * budget, measured on the real page, for every bird the picker can fly.
 *
 * WHY. The bird picker (CLAUDE.md, "THE BIRD PICKER") swaps a 1.5k-triangle
 * Pionus for a 2-4k crow or clockwork owl inside a world that already costs
 * 75-77k triangles at the Ultra forest spawn, against an 80k budget. The unit
 * suite can count the bird's own triangles exactly, but only the page can
 * count the FRAME: the bird is drawn once into the scene and again into the
 * shadow map, the world's culling depends on where the camera points, and the
 * post pass adds its own quads. So this boots the game for real and reads it.
 *
 * WHAT IT READS, AND THE TWO BUDGETS. Two counts per frame, both gated:
 *
 *   SCENE (`frameTriangles`, `frameDrawCalls`) — `__BIRB.frameTotals()`, the
 *     per-frame accumulator presentFrame() resets once and tallies after EVERY
 *     renderer.render() call (index.html `frameRenderTotals` /
 *     `tallyRenderPass`): the scene pass, the bloom bright / blur / ray /
 *     composite quads at tier 0, the single scene render at tier >= 1. This is
 *     renderer.info, and it is what CLAUDE.md's "<100 draw calls, <80k
 *     triangles" has always been measured with (stats(), the TEL rows, every
 *     budget table in it). In three r183 it does NOT include the shadow map:
 *     render() draws the shadow casters BEFORE it resets renderer.info, so the
 *     shadow pass is gone from the count by the time tallyRenderPass reads it.
 *     Gated: < 80,000 triangles and < 100 draws on every row, and the 78,000
 *     headroom at the Ultra forest (below).
 *
 *   SHADOW-INCLUSIVE (`glTriangles`, `glDrawCalls`) — every draw the page hands
 *     WebGL in that frame (GL_COUNTER, wrapped around drawElements/drawArrays
 *     and their instanced forms before any page script): the scene, the post
 *     quads AND the shadow map's depth pass with the VSM blur. On Ultra (the
 *     shadows lever on) the shadow pass is ~33-35k triangles of world casters
 *     plus the bird drawn a second time; on Okay/Light it is identical to the
 *     scene count. Gated against LIMITS.inclusive (see there for why 120k):
 *     a bird that fits the scene budget may not push the frame's real GPU
 *     submission past it either (tests/species-frame-budget.test.js holds a
 *     row that passes the scene gate and fails this one).
 *
 * Each is a per-frame snapshot, so each row is the MAX over `--frames`
 * rendered frames, sampled on requestAnimationFrame after `--warm` frames
 * that absorb shader compiles. Beside them: the bird's own cost
 * (`__BIRB.birdStats()`, every mesh under the bird anchor) and the species
 * readout (`__BIRB.speciesInfo()`: which LOD tier the crow/owl was built at,
 * and `renderTier`, the `adaptiveTier.getTier()` that LOD follows).
 *
 * THE MATRIX. species (birb, crow, owl; chosen with `?bird=`, never written
 * to localStorage) x render tier (`?quality=ultra|okay|light`: each preset
 * PINS the adaptive tier at 0 / 1 / 2, so the SwiftShader frame rate cannot
 * downshift it — the recorded renderTier proves it) x scenario:
 *
 *   forest-spawn  the boot view: forest, chase cam, flying from the spawn.
 *                 The boot world is RANDOM (seeded-random.js falls back to
 *                 Math.random with no world seed), so this row moves by
 *                 several thousand triangles from boot to boot; it is what a
 *                 player gets. `--boot-seeds 1,2,...` boots once per seed with
 *                 the page's Math.random replaced (before any page script) by
 *                 a seeded generator: a random world, but one that can be
 *                 booted again. Each row records its `bootSeed` (null = a true
 *                 Math.random boot).
 *   forest-seeds  the comparable one: the forest rebuilt at fixed world
 *                 seeds (`--seeds`, default 16160,1,2; worldSeed +
 *                 setEnvironment), the bird restored to its spawn pose each
 *                 time, the MAX kept (and each seed listed in `perSeed`,
 *                 which the 78k headroom judges seed by seed). Comparable to
 *                 within a prop or two: drones, rings and nests still draw
 *                 on Math.random (measured: the seeded world read 74,774
 *                 with the Pionus, 74,228 with the crow/owl, v88).
 *                 Every scenario after it runs in the last seed's world.
 *   boost        `__BIRB.boost(true)` (the sprint: the species sees
 *                 `boosting`, the camera pulls back) in the forest.
 *   tumble        `__BIRB.setRecovery('falling')`: the knockdown FALL — the
 *                 tumbling bird and the follow cam that chases it down.
 *   stunt         APPROXIMATED: there is no "stunt camera" hook. The stunt
 *                 flight model's loop, the closest existing thing: 60 above
 *                 the ground, full climb stick (`setStick`, sign read from
 *                 flightProbe().tuning.invertPitch) and full throttle
 *                 (`setPad`), sampled while the camera holds through the
 *                 figure (birb-stunt.mjs drives the same hooks).
 *   biome-<id>    `__BIRB.setEnvironment(id)` (default: city and mountain),
 *                 the chase cam at that biome's spawn.
 *
 * One browser per species x tier; the scenarios run in order on its page
 * (forest first, untouched). SwiftShader renders an Ultra frame in ~1-1.5 s,
 * so the default matrix (no stunt) takes ~25-35 min; `--quick` runs only the
 * two forest rows at Ultra for each species (~6-10 min). `stunt` is opt-in
 * (`--scenarios ...,stunt`).
 *
 * FAILS (exit 1) when any row reaches the SCENE budget (80,000 triangles or
 * 100 draw calls) or the SHADOW-INCLUSIVE one (LIMITS.inclusive), when a
 * crow/owl row at the Ultra forest exceeds the 78,000 scene headroom IN A
 * WORLD WHERE THE PIONUS WOULD NOT (world + 1,518 <= 78,000: the species is
 * what broke it — see verdict()) on the fixed seeds (forest-seeds), or on a
 * random boot (forest-spawn) with `--strict-headroom` (without it those are
 * listed in `speciesHeadroomBreaches`, attributed and counted),
 * when a crow/owl row's bird leaves BIRD_BUDGET (8 draws / 4,000 triangles;
 * the Pionus is the 9-draw baseline that budget was written around and is
 * reported, not gated), or on ANY console error or warning (boot messages are
 * charged to the first row measured on that page). A world that is over the
 * headroom by itself (the Pionus rows, or a crow/owl row whose world alone
 * breaks it) is a WORLD breach: listed in `worldBreaches`, never "fixed" by
 * degrading the default bird.
 *
 * DISTRIBUTIONS. Every run (and `--merge`, which combines the JSON of several
 * runs — one command is capped at ~10 min here) reports per species x quality
 * x scenario the min / median / p95 / max of the scene and shadow-inclusive
 * triangles and of the world without the bird, over every boot and seed.
 *
 * THE SERVER. Without --url it serves THIS checkout itself (a tiny static
 * server on an ephemeral port that lives exactly as long as the run), so a
 * measurement never reads someone else's live tree and never depends on a
 * shared server staying up. That is not hypothetical: the first full run
 * (build v84) pointed --url at a shared :8771 server and recorded, on the
 * crow's Ultra city row only, three `504 (Offline)` errors and seven
 * `[authored-textures] ... failed to load` warnings. That is the exact
 * signature of the city's three un-precached files (concrete albedo, concrete
 * normal, city sky) being fetched while the server was unreachable: sw.js's
 * cacheFirst() answers a network failure with its 504 "Offline" fallback, as
 * designed. Reproduced by stopping a private server just before
 * setEnvironment('city') (net::ERR_CONNECTION_REFUSED in the worker, the same
 * 3 + 7 messages in the page), and refuted as a cache bug by the same switch
 * with the server up (no error, no warning).
 *
 * USAGE
 *   node tools/species-frame-budget.mjs [--quick] [--out <file>]
 *        [--url http://localhost:8765/] [--frames 12] [--warm 6]
 *        [--species birb,crow,owl] [--tiers ultra,okay,light]
 *        [--scenarios forest-spawn,forest-seeds,boost,tumble,stunt,biome-city,biome-mountain]
 *        [--seeds 16160,1,2] [--seed-frames 6] [--boot-seeds 1,2,3]
 *   node tools/species-frame-budget.mjs --merge a.json b.json ... [--out merged.json]
 *
 * Writes JSON to stdout (and to --out when given):
 *   { build, measuredAt, url, frames, rows: [{ species, renderTier,
 *     speciesTier, scenario, biome, frameTriangles, frameDrawCalls,
 *     birdTriangles, birdDrawCalls, errors: [], warnings: [], ... }] }
 * Progress and a summary table go to stderr.
 *
 * Needs puppeteer-core (resolved: `import('puppeteer-core')`, then
 * $PUPPETEER_CORE, then /workspace/frontfootprep-launch/tools/node_modules/
 * puppeteer-core) and Chrome at $CHROME_PATH || /usr/bin/google-chrome.
 * Viewport and flags match shots/harness/main.cjs: 390x844, DPR 2, mobile,
 * SwiftShader.
 */

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BIRD_BUDGET } from '../src/flight/bird-contract.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FALLBACK_PUPPETEERS = Object.freeze([
  '/workspace/frontfootprep-launch/tools/node_modules/puppeteer-core',
  '/workspace/birb/tools/node_modules/puppeteer-core',
]);

/** The Pionus v3's own cost (CLAUDE.md, THE BIRD PICKER): the world's reference bird. */
export const PIONUS_TRIANGLES = 1518;

export const LIMITS = Object.freeze({
  // SCENE: renderer.info over every renderer.render() of the frame — the
  // budget CLAUDE.md states ("<100 draw calls, <80k triangles").
  triangles: 80000, drawCalls: 100, forestUltra: 78000,
  // SHADOW-INCLUSIVE: every draw WebGL receives in the frame. 120,000
  // triangles: the Pionus's worst Ultra frame measured with the shadow pass
  // in it (113.8k on a random v86 boot; the world casts ~33-35k into the
  // shadow map) plus the bird budget drawn twice (scene + shadow map) over the
  // Pionus: 113,768 + 2 x (4,000 - 1,518) = 118,732 — so any bird inside
  // BIRD_BUDGET fits in the worst world seen, and a world that grows past it
  // shows up. Draws stay under the same 100 (measured <= 50 with shadows).
  inclusive: Object.freeze({ triangles: 120000, drawCalls: 100 }),
  // BIRD_BUDGET (src/flight/bird-contract.js), gated on the crow and the owl.
  birdTriangles: BIRD_BUDGET.maxTriangles, birdDrawCalls: BIRD_BUDGET.maxDrawCalls,
});
const QUALITY_IDS = Object.freeze({ ultra: 'ultra', okay: 'okay', light: 'light' });
const EXPECTED_TIER = Object.freeze({ ultra: 0, okay: 1, light: 2 });
const ALL_SCENARIOS = Object.freeze(['forest-spawn', 'forest-seeds', 'boost', 'tumble', 'stunt', 'biome-city', 'biome-mountain']);
const DEFAULT_SCENARIOS = Object.freeze(ALL_SCENARIOS.filter((s) => s !== 'stunt'));
const DEFAULT_SEEDS = Object.freeze([16160, 1, 2]);

// --------------------------------------------------------------------- args

function parseArgs(argv) {
  const o = {
    quick: false, out: null, url: null,
    frames: 12, warm: 6, species: ['birb', 'crow', 'owl'], tiers: ['ultra', 'okay', 'light'],
    scenarios: DEFAULT_SCENARIOS.slice(), seeds: DEFAULT_SEEDS.slice(), seedFrames: 6,
    bootSeeds: [null], merge: null, strictHeadroom: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--quick') o.quick = true;
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--url') o.url = next();
    else if (a === '--frames') o.frames = Math.max(1, Number(next()) | 0);
    else if (a === '--warm') o.warm = Math.max(0, Number(next()) | 0);
    else if (a === '--species') o.species = next().split(',').filter(Boolean);
    else if (a === '--tiers') o.tiers = next().split(',').filter((t) => QUALITY_IDS[t]);
    else if (a === '--scenarios') o.scenarios = next().split(',').filter(Boolean);
    else if (a === '--seeds') o.seeds = next().split(',').map(Number).filter(Number.isFinite);
    else if (a === '--seed-frames') o.seedFrames = Math.max(1, Number(next()) | 0);
    else if (a === '--strict-headroom') o.strictHeadroom = true;
    // Positive integers: SEED_MATH_RANDOM maps 0 onto 1's stream, and an
    // empty list (no boots) fails the run as "no rows".
    else if (a === '--boot-seeds') o.bootSeeds = next().split(',').filter((s) => s.trim() !== '').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    else if (a === '--merge') { o.merge = []; while (argv[i + 1] && !argv[i + 1].startsWith('--')) o.merge.push(path.resolve(next())); }
    else if (a === '--help' || a === '-h') { process.stderr.write(HELP); process.exit(0); }
    else throw new Error('unknown argument ' + a);
  }
  if (o.quick) { o.tiers = ['ultra']; o.scenarios = ['forest-spawn', 'forest-seeds']; }
  return o;
}

const HELP = 'node tools/species-frame-budget.mjs [--quick] [--out file] [--url base] [--frames N] [--warm N]\n'
  + '  [--species birb,crow,owl] [--tiers ultra,okay,light] [--scenarios ' + ALL_SCENARIOS.join(',') + ']\n'
  + '  [--seeds ' + DEFAULT_SEEDS.join(',') + '] [--seed-frames 6] [--boot-seeds 1,2,3] [--strict-headroom]\n'
  + 'node tools/species-frame-budget.mjs --merge a.json b.json ... [--out merged.json]\n';

// ---------------------------------------------------------------- puppeteer

async function loadPuppeteer() {
  try {
    const m = await import('puppeteer-core');
    return m.default || m;
  } catch (_) { /* not installed here */ }
  const require = createRequire(import.meta.url);
  for (const p of [process.env.PUPPETEER_CORE, ...FALLBACK_PUPPETEERS]) {
    if (!p) continue;
    try { return require(p); } catch (_) { /* next */ }
  }
  throw new Error('puppeteer-core not found (npm-resolvable, $PUPPETEER_CORE, or ' + FALLBACK_PUPPETEERS.join(' / ') + ')');
}

// ------------------------------------------------------------ static server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

/**
 * `sw.js` is served from a snapshot taken when the run starts. index.html
 * polls reg.update() every minute and RELOADS the page when a new worker
 * installs, so a sw.js edited mid-run (this tree is shared) destroyed the
 * page mid-measurement ("Execution context was destroyed"). Everything else
 * is read live.
 */
async function serve(root) {
  let swSnapshot = null;
  try { swSnapshot = await readFile(path.join(root, 'sw.js')); } catch (_) { /* served live (404) */ }
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/sw.js' && swSnapshot) {
          res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
          res.end(swSnapshot);
          return;
        }
        if (p.endsWith('/')) p += 'index.html';
        const file = path.join(root, path.normalize(p));
        if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const s = await stat(file);
        if (!s.isFile()) throw new Error('not a file');
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(await readFile(file));
      } catch (_) {
        res.writeHead(404); res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

// ---------------------------------------------------------------- the page

const LAUNCH_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required'];

/** Splash -> Vibe -> Title -> Tap to start, exactly as shots/harness/main.cjs. */
async function startGame(page) {
  const deadline = Date.now() + 90000;
  for (;;) {
    const ready = await page.evaluate(() => {
      const s = document.querySelector('[data-title-start]');
      const sc = document.querySelector('[data-title-screen]');
      return !!s && !sc?.hidden;
    });
    if (ready) break;
    if (Date.now() > deadline) throw new Error('title never appeared');
    await page.evaluate(() => {
      document.querySelector('[data-splash-screen]')?.click();
      document.querySelector('[data-vibe-splash]')?.click();
    });
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.waitForFunction('window.__BIRB_READY === true', { timeout: 180000 });
  await page.evaluate(() => document.querySelector('[data-title-start]').click());
  await page.waitForFunction('window.__BIRB && window.__BIRB.stats().elapsed > 0.5', { timeout: 300000, polling: 250 });
}

/**
 * Installed before any page script: counts every draw call and triangle the
 * page hands WebGL (TRIANGLES and TRIANGLE_STRIP/FAN; instanced draws times
 * their instance count) in `window.__fbGL`. The sampler zeroes it per frame.
 */
function GL_COUNTER() {
  const C = { calls: 0, tris: 0, lastFrame: null };
  window.__fbGL = C;
  // Per GAME FRAME: every requestAnimationFrame callback is bracketed, and a
  // callback that drew (the game loop's: its renderer.render, shadow map
  // included, runs inside it) leaves its own totals in `lastFrame`. Counting
  // between two of the sampler's callbacks instead (v88's first version)
  // read 14,844 against a 30,748-triangle scene on one mountain row: the
  // window did not always hold one whole frame.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    const c0 = C.calls, t0 = C.tris;
    try { return cb(t); } finally {
      if (C.calls > c0) C.lastFrame = { calls: C.calls - c0, tris: C.tris - t0 };
    }
  });
  const tri = (mode, count, inst) => {
    if (mode === 4) C.tris += Math.floor(count / 3) * inst;
    else if (mode === 5 || mode === 6) C.tris += Math.max(0, count - 2) * inst;
  };
  for (const P of [window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, window.WebGLRenderingContext && WebGLRenderingContext.prototype]) {
    if (!P) continue;
    const de = P.drawElements, da = P.drawArrays;
    P.drawElements = function (mode, count) { C.calls++; tri(mode, count, 1); return de.apply(this, arguments); };
    P.drawArrays = function (mode, first, count) { C.calls++; tri(mode, count, 1); return da.apply(this, arguments); };
    if (P.drawElementsInstanced) {
      const dei = P.drawElementsInstanced;
      P.drawElementsInstanced = function (mode, count, type, offset, inst) { C.calls++; tri(mode, count, inst); return dei.apply(this, arguments); };
    }
    if (P.drawArraysInstanced) {
      const dai = P.drawArraysInstanced;
      P.drawArraysInstanced = function (mode, first, count, inst) { C.calls++; tri(mode, count, inst); return dai.apply(this, arguments); };
    }
    if (P.drawRangeElements) {
      const dre = P.drawRangeElements;
      P.drawRangeElements = function (mode, start, end, count) { C.calls++; tri(mode, count, 1); return dre.apply(this, arguments); };
    }
  }
}

/**
 * Installed before any page script when the boot is seeded: Math.random is a
 * mulberry32 stream from `seed`, so the boot's random world (and sky hour,
 * drones, ...) is one particular random world that can be booted again.
 */
function SEED_MATH_RANDOM(seed) {
  let a = (seed >>> 0) || 1;
  Math.random = function seededRandom() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Advance N rendered frames (the only clock that means anything under SwiftShader). */
const advance = (page, n) => page.evaluate((count) => new Promise((resolve) => {
  let seen = 0;
  const step = () => { seen += 1; if (seen >= count) resolve(seen); else requestAnimationFrame(step); };
  if (count <= 0) resolve(0); else requestAnimationFrame(step);
}), n);

/**
 * Sample `n` rendered frames: frameTotals() read on each rAF (it describes
 * the frame presented just before), plus the bird readouts at the end.
 */
const sample = (page, n) => page.evaluate(async (count) => {
  const B = window.__BIRB;
  const tris = [], calls = [], scene = [], passes = [], paths = [], pitch = [], glTris = [], glCalls = [];
  const G = window.__fbGL;
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    if (G) G.lastFrame = null;
    await new Promise((r) => requestAnimationFrame(r));
    // The last game frame that drew (GL_COUNTER brackets each rAF callback):
    // the same frame frameTotals() describes, whichever callback ran first.
    if (G && G.lastFrame) { glTris.push(G.lastFrame.tris); glCalls.push(G.lastFrame.calls); }
    const f = B.frameTotals();
    tris.push(f.triangles); calls.push(f.calls); scene.push(f.scene.triangles); passes.push(f.passes);
    const e = B.effective ? B.effective().statsPath : null;
    if (e && !paths.includes(e)) paths.push(e);
    const p = B.flightProbe ? B.flightProbe() : null;
    if (p && Number.isFinite(p.pitchFullDeg)) pitch.push(p.pitchFullDeg);
  }
  const ms = (performance.now() - t0) / Math.max(1, count);
  const si = B.speciesInfo ? B.speciesInfo() : null;
  const bs = B.birdStats ? B.birdStats() : null;
  const st = B.stats();
  return {
    tris, calls, scene, passes, paths, glTris, glCalls, msPerFrame: Math.round(ms),
    pitchRangeDeg: pitch.length ? [Math.round(Math.min(...pitch)), Math.round(Math.max(...pitch))] : null,
    speciesInfo: si ? { species: si.species, tier: si.tier, renderTier: si.renderTier, triangles: si.triangles, drawCalls: si.drawCalls } : null,
    bird: bs ? { triangles: bs.triangles, drawCalls: bs.drawCalls } : null,
    stats: { tier: st.tier, pinned: st.pinned, environment: st.environment, recovery: st.recovery, sprintActive: st.sprintActive, altitudeAboveGround: st.altitudeAboveGround },
  };
}, n);

/** Scenario setup on the live page; returns { biome, note }. */
async function setupScenario(page, scenario, warm) {
  if (scenario === 'forest-spawn') {
    await advance(page, warm);
    return { biome: 'forest', note: null };
  }
  if (scenario === 'boost') {
    await page.evaluate(() => { window.__BIRB.setRecovery('flying'); window.__BIRB.boost(true); });
    await advance(page, warm);
    return { biome: 'forest', note: '__BIRB.boost(true)' };
  }
  if (scenario === 'tumble') {
    await page.evaluate(() => { const B = window.__BIRB; B.boost(false); B.setAltitude(40); B.setRecovery('falling'); });
    await advance(page, Math.min(warm, 3));
    return { biome: 'forest', note: "__BIRB.setRecovery('falling') from 40 above ground" };
  }
  if (scenario === 'stunt') {
    await page.evaluate(() => {
      const B = window.__BIRB;
      B.boost(false);
      B.setRecovery('flying');
      B.setAltitude(60);
      const t = B.flightProbe()?.tuning;
      const climb = t && t.invertPitch === false ? 1 : -1;
      B.setStick(0, climb);
      B.setPad(0, 1);
    });
    // Frames are 50 ms of game time each here: let the pull-up get going so
    // the sampled frames run through the vertical part of the figure.
    await advance(page, Math.max(warm, 16));
    return { biome: 'forest', note: 'APPROXIMATION: no stunt-camera hook; the stunt model\'s loop (setStick climb + setPad throttle 1) from 60 above ground' };
  }
  if (scenario.startsWith('biome-')) {
    const id = scenario.slice(6);
    const ok = await page.evaluate((env) => {
      const B = window.__BIRB;
      B.setStick(null); B.setPad(null); B.boost(false);
      const r = B.setEnvironment(env);
      B.setRecovery('flying');
      return r;
    }, id);
    if (!ok) throw new Error('setEnvironment(' + id + ') refused');
    await advance(page, warm + 4);
    return { biome: id, note: '__BIRB.setEnvironment(' + JSON.stringify(id) + ')' };
  }
  throw new Error('unknown scenario ' + scenario);
}

async function readBuild(page) {
  try {
    return await page.evaluate(async () => {
      const t = await (await fetch('index.html', { cache: 'no-store' })).text();
      const m = /const BIRB_BUILD = '([^']+)'/.exec(t);
      return m ? m[1] : null;
    });
  } catch (_) { return null; }
}

// ------------------------------------------------------------------- main

async function measureCombo(puppeteer, chrome, base, species, tier, opts, log, bootSeed = null) {
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: 'new', protocolTimeout: 0,
    args: [...LAUNCH_ARGS, `--user-data-dir=/tmp/birb-frame-budget-${process.pid}-${species}-${tier}-${bootSeed}`],
  });
  const rows = [];
  let build = null;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(0);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    let errors = [], warnings = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' && !/vibrate/.test(t)) errors.push('console: ' + t.slice(0, 300));
      if (m.type() === 'warn' || m.type() === 'warning') warnings.push(t.slice(0, 300));
    });
    await page.evaluateOnNewDocument(GL_COUNTER);
    if (bootSeed !== null) await page.evaluateOnNewDocument(SEED_MATH_RANDOM, bootSeed);
    const url = new URL(base);
    url.searchParams.set('debug', '1');
    url.searchParams.set('bird', species);
    url.searchParams.set('quality', QUALITY_IDS[tier]);
    log(`[${species}/${tier}] boot ${url.href}${bootSeed !== null ? ' (Math.random seed ' + bootSeed + ')' : ''}`);
    await page.goto(url.href, { waitUntil: 'networkidle2', timeout: 180000 });
    build = await readBuild(page);
    await startGame(page);
    // A reload mid-run (the service worker's update path) would measure a
    // fresh boot under the wrong row; record it as an error, never silently.
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) errors.push('tool: the page navigated/reloaded mid-run'); });
    const spawnPose = await page.evaluate(() => window.__BIRB.capturePose());
    for (const scenario of opts.scenarios) {
      const t0 = Date.now();
      let s, biome, note, perSeed = null;
      if (scenario === 'forest-seeds') {
        // The boot world is randomly seeded (seeded-random.js: no seed ->
        // Math.random), and the forest frame moves by ~1k triangles between
        // seeds. Rebuild the forest at fixed seeds, the bird back at its
        // spawn pose each time, and keep the worst: comparable across runs.
        perSeed = [];
        for (const seed of opts.seeds) {
          await page.evaluate((sd, pose) => {
            const B = window.__BIRB;
            B.setStick(null); B.setPad(null); B.boost(false);
            B.worldSeed(sd);
            B.setEnvironment('forest');
            B.restorePose(pose);
            B.setRecovery('flying');
          }, seed, spawnPose);
          await advance(page, opts.warm + 4);
          const one = await sample(page, opts.seedFrames);
          perSeed.push({
            seed, frameTriangles: Math.max(...one.tris), frameDrawCalls: Math.max(...one.calls),
            glTriangles: one.glTris.length ? Math.max(...one.glTris) : null,
            glDrawCalls: one.glCalls.length ? Math.max(...one.glCalls) : null,
            birdTriangles: one.bird ? one.bird.triangles : null, one,
          });
        }
        const pick = (k) => perSeed.reduce((a, p) => a.concat(p.one[k]), []);
        const last = perSeed[perSeed.length - 1].one;
        s = Object.assign({}, last, {
          tris: pick('tris'), calls: pick('calls'), scene: pick('scene'), passes: pick('passes'),
          glTris: pick('glTris'), glCalls: pick('glCalls'),
        });
        for (const p of perSeed) delete p.one;
        biome = 'forest';
        note = 'max over forest rebuilds at world seeds ' + opts.seeds.join(',') + ' (worldSeed + setEnvironment, spawn pose restored)';
      } else {
        ({ biome, note } = await setupScenario(page, scenario, opts.warm));
        s = await sample(page, opts.frames);
      }
      await page.evaluate(() => { const B = window.__BIRB; B.setStick(null); B.setPad(null); });
      const row = {
        species,
        quality: tier,
        bootSeed,
        renderTier: s.speciesInfo ? s.speciesInfo.renderTier : s.stats.tier,
        renderTierPinned: s.stats.pinned,
        speciesTier: s.speciesInfo ? s.speciesInfo.tier : null,
        scenario,
        biome,
        environment: s.stats.environment,
        frameTriangles: Math.max(...s.tris),
        frameDrawCalls: Math.max(...s.calls),
        frameTrianglesMin: Math.min(...s.tris),
        sceneTrianglesMax: Math.max(...s.scene),
        // Every draw the GPU received, shadow-map passes included (three
        // renders the shadow map BEFORE renderer.info resets, so frameTotals
        // never sees it): the SHADOW-INCLUSIVE budget, LIMITS.inclusive.
        glTriangles: s.glTris.length ? Math.max(...s.glTris) : null,
        glDrawCalls: s.glCalls.length ? Math.max(...s.glCalls) : null,
        passes: Math.max(...s.passes),
        statsPath: s.paths.join(','),
        birdTriangles: s.bird ? s.bird.triangles : null,
        birdDrawCalls: s.bird ? s.bird.drawCalls : null,
        // What the frame costs without the bird (the world + the post quads).
        worldTriangles: s.bird ? Math.max(...s.tris) - s.bird.triangles : null,
        speciesTriangles: s.speciesInfo ? s.speciesInfo.triangles : null,
        frames: s.tris.length,
        msPerFrame: s.msPerFrame,
        pitchRangeDeg: s.pitchRangeDeg,
        recovery: s.stats.recovery,
        aboveGround: s.stats.altitudeAboveGround,
        note,
        perSeed,
        errors,
        warnings,
      };
      if (row.renderTier !== EXPECTED_TIER[tier]) {
        row.errors = row.errors.concat([`tool: render tier ${row.renderTier}, expected ${EXPECTED_TIER[tier]} for ?quality=${tier}`]);
      }
      errors = []; warnings = [];
      rows.push(row);
      log(`[${species}/${tier}${bootSeed !== null ? '/seed ' + bootSeed : ''}] ${scenario}: frame ${row.frameTriangles} tris / ${row.frameDrawCalls} draws `
        + `[gl ${row.glTriangles}/${row.glDrawCalls}] (bird ${row.birdTriangles}/${row.birdDrawCalls}, speciesTier ${row.speciesTier}, renderTier ${row.renderTier}) `
        + `${s.msPerFrame} ms/frame, ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  } finally {
    await browser.close();
  }
  return { rows, build };
}

const rowId = (r) => `${r.species}/${r.quality}/${r.scenario}${r.bootSeed !== null && r.bootSeed !== undefined ? '@seed' + r.bootSeed : ''}`
  + (r.worldSeed !== undefined ? '@world' + r.worldSeed : '');

/**
 * What the 78k headroom judges: a row, or for forest-seeds EACH world seed
 * (its own frame and its own world) — the row's max would pair one seed's
 * frame with that seed's world and miss a species breach at another seed.
 */
const headroomSamples = (r) => (r.scenario === 'forest-seeds' && Array.isArray(r.perSeed) && r.perSeed.length
  ? r.perSeed.map((p) => Object.assign({}, r, {
    worldSeed: p.seed, frameTriangles: p.frameTriangles,
    worldTriangles: p.frameTriangles - (Number.isFinite(p.birdTriangles) ? p.birdTriangles : (r.birdTriangles || 0)),
  }))
  : [r]);

/** A row the 78k scene headroom applies to: the Ultra forest spawn, random boot or fixed seeds. */
const headroomRow = (r) => r.renderTier === 0 && (r.scenario === 'forest-spawn' || r.scenario === 'forest-seeds');

/**
 * The world's own share of a row's scene count: the frame minus the bird on
 * the anchor. With the Pionus in that world instead, the frame would read
 * world + PIONUS_TRIANGLES.
 */
const worldOf = (r) => (Number.isFinite(r.worldTriangles) ? r.worldTriangles : r.frameTriangles - (r.birdTriangles || 0));

/**
 * The 78k headroom breaches that are the WORLD's, not a species': every
 * Pionus row over it, and every crow/owl row whose world alone would put the
 * Pionus over it. Reported (precisely: the world's own count), never fixed by
 * changing the default bird.
 */
export function worldBreaches(rows) {
  const out = [];
  for (const r of rows.flatMap(headroomSamples)) {
    if (!headroomRow(r) || r.frameTriangles <= LIMITS.forestUltra) continue;
    const world = worldOf(r);
    if (r.species === 'birb' || world + PIONUS_TRIANGLES > LIMITS.forestUltra) {
      out.push({ id: rowId(r), species: r.species, scenario: r.scenario, bootSeed: r.bootSeed ?? null, frameTriangles: r.frameTriangles, worldTriangles: world, pionusWouldRead: world + PIONUS_TRIANGLES });
    }
  }
  return out;
}

/**
 * The 78k headroom breaches the SPECIES owns: a crow/owl row at the Ultra
 * forest over 78,000 in a world where the Pionus would fit (world + 1,518 <=
 * 78,000). On the fixed seeds (forest-seeds) verdict() fails them; on random
 * boots (forest-spawn) they are listed here and fail only with
 * `--strict-headroom` (2026-10-11: the invisible trims are spent — see
 * CLAUDE.md "Species leftovers" for the measured gap and what closing it
 * would cost to look at).
 */
export function speciesHeadroomBreaches(rows) {
  return rows.flatMap(headroomSamples).filter((r) => headroomRow(r) && r.species !== 'birb' && r.frameTriangles > LIMITS.forestUltra
    && worldOf(r) + PIONUS_TRIANGLES <= LIMITS.forestUltra)
    .map((r) => ({ id: rowId(r), species: r.species, scenario: r.scenario, bootSeed: r.bootSeed ?? null, frameTriangles: r.frameTriangles, over: r.frameTriangles - LIMITS.forestUltra, worldTriangles: worldOf(r), pionusWouldRead: worldOf(r) + PIONUS_TRIANGLES }));
}

export function verdict(rows, { strictHeadroom = false } = {}) {
  const fails = [];
  if (!rows.length) fails.push('no rows: nothing was measured (or merged), so nothing passed');
  for (const r0 of rows) {
    const r = Object.assign({ errors: [], warnings: [] }, r0);
    const id = rowId(r);
    // SCENE: CLAUDE.md's budget, renderer.info over the frame's renders.
    if (r.frameTriangles >= LIMITS.triangles) fails.push(`${id}: scene ${r.frameTriangles} tris >= ${LIMITS.triangles}`);
    if (r.frameDrawCalls >= LIMITS.drawCalls) fails.push(`${id}: scene ${r.frameDrawCalls} draws >= ${LIMITS.drawCalls}`);
    // SHADOW-INCLUSIVE: everything WebGL drew, the shadow map included. A row
    // with no GL count cannot be judged, which is a failure, not a pass.
    if (!Number.isFinite(r.glTriangles) || !Number.isFinite(r.glDrawCalls)) fails.push(`${id}: no shadow-inclusive (GL) count`);
    else if (r.glTriangles < r.frameTriangles) {
      // Everything WebGL drew can never be less than what renderer.info
      // counted: the counter missed a frame, so the row proves nothing.
      fails.push(`${id}: shadow-inclusive ${r.glTriangles} < scene ${r.frameTriangles}: the GL counter missed the frame`);
    } else {
      if (r.glTriangles >= LIMITS.inclusive.triangles) fails.push(`${id}: shadow-inclusive ${r.glTriangles} tris >= ${LIMITS.inclusive.triangles}`);
      if (r.glDrawCalls >= LIMITS.inclusive.drawCalls) fails.push(`${id}: shadow-inclusive ${r.glDrawCalls} draws >= ${LIMITS.inclusive.drawCalls}`);
    }
    // The 78k scene headroom at the Ultra forest: a crow/owl over it where
    // the Pionus, in the same world, would not be (world + 1,518 <= 78,000)
    // — the species broke it. FAILS on the fixed seeds; on random boots only
    // with strictHeadroom (speciesHeadroomBreaches() lists them either way).
    // A world over it by itself is worldBreaches()' to report.
    if (headroomRow(r) && (r.scenario === 'forest-seeds' || strictHeadroom) && r.species !== 'birb') {
      for (const s of headroomSamples(r)) {
        if (s.frameTriangles > LIMITS.forestUltra && worldOf(s) + PIONUS_TRIANGLES <= LIMITS.forestUltra) {
          fails.push(`${rowId(s)}: Ultra forest ${s.frameTriangles} tris > ${LIMITS.forestUltra} where the Pionus would read ${worldOf(s) + PIONUS_TRIANGLES}`);
        }
      }
    }
    if (r.species !== 'birb') {
      // A missing count is a failure: `null <= 4000` would pass.
      if (!(Number.isFinite(r.birdTriangles) && r.birdTriangles <= LIMITS.birdTriangles)) fails.push(`${id}: bird ${r.birdTriangles} tris > BIRD_BUDGET ${LIMITS.birdTriangles} (or missing)`);
      if (!(Number.isFinite(r.birdDrawCalls) && r.birdDrawCalls <= LIMITS.birdDrawCalls)) fails.push(`${id}: bird ${r.birdDrawCalls} draws > BIRD_BUDGET ${LIMITS.birdDrawCalls} (or missing)`);
    }
    for (const e of r.errors) fails.push(`${id}: error ${e}`);
    for (const w of r.warnings) fails.push(`${id}: warning ${w}`);
  }
  return fails;
}

/** min / median / p95 / max (nearest rank) of a list of numbers, or null. */
export function spread(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = (q) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
  return { n: v.length, min: v[0], median: rank(0.5), p95: rank(0.95), max: v[v.length - 1] };
}

/**
 * Per species x quality x scenario, over every boot (and, for forest-seeds,
 * every world seed): the scene count, the shadow-inclusive count, the world
 * without the bird, and the draws.
 */
export function distributions(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.species}/${r.quality}/${r.scenario}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = {};
  for (const [k, rs] of groups) {
    // forest-seeds: one sample per world seed (perSeed), not the row's max.
    const samples = rs.flatMap((r) => (r.scenario === 'forest-seeds' && Array.isArray(r.perSeed) && r.perSeed.length ? r.perSeed : [r]));
    out[k] = {
      boots: rs.length,
      samples: samples.length,
      bootSeeds: rs.map((r) => r.bootSeed ?? null),
      scene: spread(samples.map((s) => s.frameTriangles)),
      sceneDraws: spread(samples.map((s) => s.frameDrawCalls)),
      inclusive: spread(samples.map((s) => s.glTriangles)),
      inclusiveDraws: spread(samples.map((s) => s.glDrawCalls)),
      world: spread(samples.map(worldOf)),
      bird: spread(samples.map((s) => s.birdTriangles)),
    };
  }
  return out;
}

export function distributionTable(dist) {
  const f = (s) => (s ? `${s.min}/${s.median}/${s.p95}/${s.max}` : '-');
  const head = ['group', 'n', 'scene min/med/p95/max', 'incl min/med/p95/max', 'world min/med/p95/max', 'draws max (incl)'];
  const body = Object.entries(dist).map(([k, d]) => [k, String(d.samples), f(d.scene), f(d.inclusive), f(d.world),
    `${d.sceneDraws ? d.sceneDraws.max : '-'} (${d.inclusiveDraws ? d.inclusiveDraws.max : '-'})`]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  return [head, ...body].map((c) => c.map((x, i) => x.padEnd(w[i])).join('  ')).join('\n');
}

/** The short human table: one line per row. */
export function table(rows) {
  const head = ['species', 'quality', 'tier', 'scenario', 'seed', 'sceneTris', 'sceneDraws', 'inclTris', 'inclDraws', 'birdTris', 'birdDraws', 'err', 'warn'];
  const body = rows.map((r) => [
    r.species, r.quality, r.speciesTier || '-', r.scenario, r.bootSeed ?? '-', r.frameTriangles, r.frameDrawCalls,
    r.glTriangles ?? '-', r.glDrawCalls ?? '-', r.birdTriangles, r.birdDrawCalls, (r.errors || []).length, (r.warnings || []).length,
  ].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => (i >= 5 ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  return [line(head), ...body.map(line)].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (s) => process.stderr.write(s + '\n');
  if (opts.merge) return merge(opts, log);
  const puppeteer = await loadPuppeteer();
  const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
  let server = null;
  let base = opts.url;
  if (!base) {
    const s = await serve(REPO_ROOT);
    server = s.server;
    base = s.url;
    log('serving ' + REPO_ROOT + ' at ' + base);
  }
  const started = Date.now();
  const rows = [];
  let build = null;
  try {
    for (const bootSeed of opts.bootSeeds) {
      for (const species of opts.species) {
        for (const tier of opts.tiers) {
          const r = await measureCombo(puppeteer, chrome, base, species, tier, opts, log, bootSeed);
          rows.push(...r.rows);
          build = build || r.build;
          // A command here is time-capped: what has been measured is on disk
          // after every boot (`partial: true`), for --merge, if the run is cut.
          if (opts.out) {
            await mkdir(path.dirname(opts.out), { recursive: true });
            await writeFile(opts.out, JSON.stringify({ build, partial: true, rows }, null, 2) + '\n');
          }
        }
      }
    }
  } finally {
    if (server) server.close();
  }
  if (!build) {
    try { build = (/const BIRB_BUILD = '([^']+)'/.exec(await readFile(path.join(REPO_ROOT, 'index.html'), 'utf8')) || [])[1] || null; } catch (_) { build = null; }
  }
  await report({
    build,
    measuredAt: new Date().toISOString(),
    url: opts.url || '(self-served checkout)',
    frames: opts.frames,
    warm: opts.warm,
    runSeconds: Math.round((Date.now() - started) / 1000),
  }, rows, opts, log);
}

/** The JSON (with the verdict, the world breaches and the distributions), the tables, the exit code. */
async function report(meta, rows, opts, log) {
  const fails = verdict(rows, { strictHeadroom: opts.strictHeadroom });
  const out = Object.assign({}, meta, {
    limits: LIMITS,
    strictHeadroom: !!opts.strictHeadroom,
    pass: fails.length === 0,
    failures: fails,
    worldBreaches: worldBreaches(rows),
    speciesHeadroomBreaches: speciesHeadroomBreaches(rows),
    distributions: distributions(rows),
    rows,
  });
  const json = JSON.stringify(out, null, 2);
  if (opts.out) {
    await mkdir(path.dirname(opts.out), { recursive: true });
    await writeFile(opts.out, json + '\n');
  } else {
    process.stdout.write(json + '\n');
  }
  log(table(rows));
  log(distributionTable(out.distributions));
  if (out.worldBreaches.length) {
    log('WORLD over the 78k headroom by itself (reported, not a species failure):\n  '
      + out.worldBreaches.map((b) => `${b.id}: frame ${b.frameTriangles}, world ${b.worldTriangles} (the Pionus would read ${b.pionusWouldRead})`).join('\n  '));
  }
  if (out.speciesHeadroomBreaches.length) {
    log(`SPECIES over the 78k headroom where the Pionus fits (${opts.strictHeadroom ? 'FAILING: --strict-headroom' : 'reported; --strict-headroom gates it'}):\n  `
      + out.speciesHeadroomBreaches.map((b) => `${b.id}: frame ${b.frameTriangles} (+${b.over}), world ${b.worldTriangles} (the Pionus would read ${b.pionusWouldRead})`).join('\n  '));
  }
  log(`${rows.length} rows${meta.runSeconds !== undefined ? ' in ' + meta.runSeconds + ' s' : ''}${opts.out ? ' -> ' + opts.out : ''}`);
  if (fails.length) {
    log('FAIL:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  log('PASS');
}

/** --merge: several runs' JSON (one command is time-capped) judged as one. */
async function merge(opts, log) {
  const rows = [];
  const builds = new Set();
  for (const f of opts.merge) {
    const j = JSON.parse(await readFile(f, 'utf8'));
    if (j.build) builds.add(j.build);
    rows.push(...j.rows);
  }
  if (builds.size > 1) log('WARNING: merging runs of different builds: ' + [...builds].join(', '));
  await report({ build: [...builds].join(',') || null, mergedAt: new Date().toISOString(), mergedFrom: opts.merge.map((f) => path.relative(REPO_ROOT, f)) }, rows, opts, log);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(2); });
}
