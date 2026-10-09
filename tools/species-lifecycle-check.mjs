#!/usr/bin/env node
/**
 * tools/species-lifecycle-check.mjs — the bird picker's LIFECYCLE, checked in
 * the real page (headless Chrome through SwiftShader), not reasoned about.
 *
 * The node tests (tests/species-lifecycle.test.js) prove the build unwinds and
 * the transaction's ORDER from the source; this proves the running game:
 *
 *   boots     default Birb, ?bird=crow|owl|v1, crow with ?aeropose=0, a SAVED
 *             owl, and crow/owl on Okay and Light — no console error or
 *             warning, the Birb boot never fetches species-bird.js, and a
 *             crow/owl boot BUILDS ONCE at the tier the boot settles on.
 *   swaps     Birb -> crow -> owl -> Birb, N cycles, with tier pins (0/1/2,
 *             each a deferred re-LOD) and a biome round trip inside each:
 *             renderer.info geometries / textures / programs PLATEAU across
 *             cycles and the shared feather textures hold 0 references on Birb.
 *   failure   __BIRB.speciesFault(): a staged bird that throws leaves the
 *             outgoing bird flying, the saved choice untouched, the GPU counts
 *             where they were, and the settings button never rejects.
 *   motion    prefers-reduced-motion on the owl: the gears and key hold under
 *             boost, and turn again once it is off.
 *
 * Usage: node tools/species-lifecycle-check.mjs [--base http://localhost:8765/]
 *        [--cycles 3] [--only boots|swaps|failure|motion] [--out file.json]
 * Exit 1 on any failed check. Needs puppeteer-core (env PUPPETEER_CORE, or the
 * operator's copy) and Chrome (env CHROME_PATH, default /usr/bin/google-chrome).
 * A run takes several minutes: SwiftShader draws a few frames a second.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8765/');
const CYCLES = Number(arg('--cycles', '3'));
const ONLY = arg('--only', null);
const OUT = arg('--out', null);

async function loadPuppeteer() {
  try { return (await import('puppeteer-core')).default; } catch (_) { /* fall through */ }
  const require = createRequire(import.meta.url);
  for (const p of [process.env.PUPPETEER_CORE, '/workspace/frontfootprep-launch/tools/node_modules/puppeteer-core'].filter(Boolean)) {
    try { return require(p); } catch (_) { /* next */ }
  }
  throw new Error('puppeteer-core not found (set PUPPETEER_CORE)');
}

const results = [];
let failed = 0;
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--user-data-dir=/tmp/birb-lifecycle' + process.pid],
});

async function boot(query, { ls = null, reduce = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = []; const warns = []; const fetched = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/vibrate/.test(t)) errs.push(t.slice(0, 200));
    if (m.type() === 'warn' || m.type() === 'warning') warns.push(t.slice(0, 200));
  });
  page.on('request', (r) => fetched.push(r.url()));
  if (ls) await page.evaluateOnNewDocument((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, ls);
  // Unhandled rejections surface as page errors in this harness.
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection: ' + (e.reason && e.reason.message)));
  });
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(BASE + '?debug=1' + (query ? '&' + query : ''), { waitUntil: 'networkidle2', timeout: 120000 });
  const deadline = Date.now() + 60000;
  for (;;) {
    const ready = await page.evaluate(() => { const s = document.querySelector('[data-title-start]'); const sc = document.querySelector('[data-title-screen]'); return !!s && !sc?.hidden; });
    if (ready) break;
    if (Date.now() > deadline) throw new Error('title never appeared');
    await page.evaluate(() => { document.querySelector('[data-splash-screen]')?.click(); document.querySelector('[data-vibe-splash]')?.click(); });
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.waitForFunction('window.__BIRB_READY === true', { timeout: 90000 });
  await page.evaluate(() => document.querySelector('[data-title-start]').click());
  await page.waitForFunction('window.__BIRB && window.__BIRB.stats().elapsed > 0.5', { timeout: 180000 });
  return { page, errs, warns, fetched };
}
const frames = (page, k = 3) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), k);
const info = (page) => page.evaluate(() => window.__BIRB.speciesInfo());

// ------------------------------------------------------------------- boots
if (!ONLY || ONLY === 'boots') {
  const boots = [
    { q: '', species: 'birb', builds: 0, lazy: false },
    { q: 'bird=crow', species: 'crow', builds: 1, tier: 'high' },
    { q: 'bird=owl', species: 'owl', builds: 1, tier: 'high' },
    { q: 'bird=v1', species: 'birb', builds: 0, lazy: false },
    { q: 'bird=crow&aeropose=0', species: 'crow', builds: 1, tier: 'high' },
    { q: '', ls: { 'birb.species': 'owl' }, species: 'owl', builds: 1, tier: 'high', label: 'saved owl' },
    { q: 'bird=owl&quality=okay', species: 'owl', builds: 1, tier: 'mid' },
    { q: 'bird=crow&quality=light', species: 'crow', builds: 1, tier: 'low' },
    { q: 'bird=owl&quality=light', species: 'owl', builds: 1, tier: 'low' },
  ];
  for (const b of boots) {
    const label = b.label || b.q || 'default';
    const { page, errs, warns, fetched } = await boot(b.q, { ls: b.ls });
    await frames(page, 4);
    const i = await info(page);
    check(`boot ${label}: flies the ${b.species}`, i.species === b.species, i.species);
    check(`boot ${label}: crow/owl builds = ${b.builds}`, i.builds === b.builds, { builds: i.builds, retiers: i.retiers });
    if (b.tier) check(`boot ${label}: built at ${b.tier}`, i.tier === b.tier, i.tier);
    if (b.lazy === false) {
      check(`boot ${label}: species-bird.js never fetched`, !fetched.some((u) => /species-bird\.js/.test(u)) && !i.moduleLoaded);
    }
    check(`boot ${label}: no console errors`, errs.length === 0, errs);
    check(`boot ${label}: no console warnings`, warns.length === 0, warns);
    await page.close();
  }
}

// ------------------------------------------------------------------- swaps
if (!ONLY || ONLY === 'swaps') {
  const { page, errs, warns } = await boot('quality=amazing');
  // Two biomes that are NOT the boot biome: re-entering the boot biome by
  // setEnvironment requests a sky texture that does not exist (a 404 and an
  // [authored-textures] warning with the Pionus alone — not the picker's).
  const envs = await page.evaluate(() => window.__BIRB.environments());
  const boot0 = await page.evaluate(() => window.__BIRB.stats().environment);
  const [home, away] = envs.filter((e) => e !== boot0);
  await page.evaluate((id) => { window.__BIRB.setEnvironment(id); window.__BIRB.pinTier(0); }, home);
  // The bird held still: flying reveals world content that is drawn (and
  // counted by renderer.info) for the first time — measured, the Pionus alone
  // grows 35 -> 46 geometries and 44 -> 48 programs in 175 frames of flight.
  // Frozen, any growth across cycles is the picker's.
  await page.evaluate(() => window.__BIRB.freeze(true));
  await frames(page, 6);
  const ends = [];
  for (let c = 0; c < CYCLES; c++) {
    const step = async (js, n = 3) => { await page.evaluate(js); await frames(page, n); };
    await step('window.__BIRB.setSpecies("crow")');
    for (const t of [1, 2, 0]) {
      await step(`window.__BIRB.pinTier(${t})`, 4);
      const i = await info(page);
      const want = t === 0 ? 'high' : t === 1 ? 'mid' : 'low';
      check(`cycle ${c} crow: re-LOD to tier ${t} landed between frames`, i.tier === want && i.textureRefs === 1, { tier: i.tier, refs: i.textureRefs });
    }
    await step('window.__BIRB.setSpecies("owl")');
    await step(`window.__BIRB.setEnvironment(${JSON.stringify(away)})`, 4);
    await step('window.__BIRB.pinTier(2)', 4);
    await step(`window.__BIRB.setEnvironment(${JSON.stringify(home)})`, 4);
    await step('window.__BIRB.pinTier(0)', 4);
    const owl = await info(page);
    check(`cycle ${c} owl: one texture reference, sky bound`, owl.textureRefs === 1 && owl.env && owl.env.bound, { refs: owl.textureRefs, env: owl.env && owl.env.bound });
    await step('window.__BIRB.setSpecies("birb")', 4);
    const end = await info(page);
    check(`cycle ${c} Birb: shared feather textures back to 0 references`, end.species === 'birb' && end.textureRefs === 0, { species: end.species, refs: end.textureRefs });
    ends.push(end.gpu);
  }
  console.log('cycle-end GPU counts', JSON.stringify(ends));
  // Cycle 0 warms the program cache (each tier's and biome's variants
  // compile once); from cycle 1 on nothing may GROW. Geometries can fall
  // (terrain LODs dispose), so the test is "never above cycle 1", not "equal".
  check('swaps: at least 3 cycles to compare', ends.length >= 3, ends.length);
  const warm = ends[1];
  for (let c = 2; c < ends.length; c++) {
    check(`cycle ${c}: no growth over cycle 1 (geometries/textures/programs)`, ends[c].geometries <= warm.geometries
      && ends[c].textures <= warm.textures && ends[c].programs <= warm.programs, { warm, now: ends[c] });
  }
  check('swaps: no console errors', errs.length === 0, errs);
  check('swaps: no console warnings', warns.length === 0, warns);
  results.push({ name: 'swaps: cycle-end gpu', ok: true, detail: ends });
  await page.close();
}

// ----------------------------------------------------------------- failure
if (!ONLY || ONLY === 'failure') {
  const { page, errs, warns } = await boot('quality=amazing', { ls: { 'birb.species': 'birb' } });
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await frames(page, 3);
  const before = await info(page);
  // Birb -> owl fails: Birb keeps flying, nothing saved, nothing leaked.
  const r1 = await page.evaluate(async () => { window.__BIRB.speciesFault(true); return window.__BIRB.setSpecies('owl', { persist: true }); });
  await frames(page, 3);
  const a1 = await info(page);
  const saved1 = await page.evaluate(() => localStorage.getItem('birb.species'));
  check('failure Birb->owl: resolves to the bird still flying', r1 === 'birb' && a1.species === 'birb', { r1, species: a1.species });
  check('failure Birb->owl: saved choice untouched', saved1 === 'birb', saved1);
  check('failure Birb->owl: no texture reference held, GPU counts unchanged', a1.textureRefs === 0
    && a1.gpu.geometries === before.gpu.geometries && a1.gpu.textures === before.gpu.textures, { before: before.gpu, after: a1.gpu });
  // A real crow, then crow -> Birb and crow -> owl both fail: the crow stays.
  await page.evaluate(() => window.__BIRB.setSpecies('crow', { persist: true }));
  await frames(page, 4);
  const crow = await info(page);
  for (const to of ['birb', 'owl']) {
    const r = await page.evaluate(async (id) => { window.__BIRB.speciesFault(true); return window.__BIRB.setSpecies(id, { persist: true }); }, to);
    await frames(page, 3);
    const a = await info(page);
    const saved = await page.evaluate(() => localStorage.getItem('birb.species'));
    check(`failure crow->${to}: the crow keeps flying, saved stays crow`, r === 'crow' && a.species === 'crow' && saved === 'crow', { r, species: a.species, saved });
    check(`failure crow->${to}: one texture reference, GPU counts unchanged`, a.textureRefs === 1
      && a.gpu.geometries === crow.gpu.geometries && a.gpu.textures === crow.gpu.textures, { before: crow.gpu, after: a.gpu });
  }
  // The settings button with a failing stage: no rejection reaches the page.
  await page.evaluate(() => document.querySelector('[data-control="settings-open"]')?.click());
  await frames(page, 2);
  await page.evaluate(() => { window.__BIRB.speciesFault(true); document.querySelector('[data-control="species"]').click(); });
  await new Promise((r) => setTimeout(r, 1500));
  await frames(page, 3);
  const a3 = await info(page);
  check('failure via the Bird button: the crow keeps flying', a3.species === 'crow', a3.species);
  check('failure: no page errors or unhandled rejections', errs.length === 0, errs);
  const unexpected = warns.filter((w) => !/\[species\] could not build/.test(w));
  check('failure: only the expected "could not build" warnings', unexpected.length === 0 && warns.length === 4, { warns });
  await page.evaluate(() => localStorage.removeItem('birb.species'));
  await page.close();
}

// ------------------------------------------------------------------ motion
if (!ONLY || ONLY === 'motion') {
  const { page, errs, warns } = await boot('bird=owl&quality=amazing', { reduce: true });
  await page.evaluate(() => { window.__BIRB.pinTier(0); window.__BIRB.boost(true); });
  await frames(page, 3);
  const m0 = (await info(page)).mech;
  await frames(page, 12);
  const m1 = (await info(page)).mech;
  check('reduced motion: the owl\'s gears and key hold under boost', m0.gear === m1.gear && m0.key === m1.key, { m0, m1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await frames(page, 12);
  const m2 = (await info(page)).mech;
  check('reduced motion off: the key turns again', m2.key !== m1.key, { m1, m2 });
  check('motion: no console errors', errs.length === 0, errs);
  check('motion: no console warnings', warns.length === 0, warns);
  await page.close();
}

await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, cycles: CYCLES, results }, null, 2));
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
