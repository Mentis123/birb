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
 *   failure   __BIRB.speciesFault(stage), at EVERY stage of the transaction.
 *             Before the mount ('stage', 'feathers', 'mount'): the outgoing
 *             bird keeps flying, the saved choice untouched, the GPU counts
 *             where they were. A sky ('sky'): lights only. After the mount
 *             ('dispose', 'audio', 'sync'): the new bird flies and is saved.
 *             Each: exactly ONE warning (its own), the bird on the anchor is
 *             the one reported, feather texture refs right, and a clean swap
 *             back lands on the warm baseline's GPU counts (nothing leaked).
 *             The settings button never rejects.
 *   motion    prefers-reduced-motion on the owl: the gears and key hold under
 *             boost, and turn again once it is off.
 *   leak      the DEFAULT boot (Ultra, so the shadows lever is ON), bird and
 *             camera held, tier and biome fixed: --rounds (default 10) of
 *             crow -> owl -> Birb, then of crow <-> Birb. renderer.info
 *             geometries / textures / programs are IDENTICAL at the end of
 *             every round to round 1's end — flat, not a plateau. Round 0 is
 *             the warm-up. This is the section that caught the shadow-depth
 *             leak (bird-shadow.js isolateBirdShadowDepth): +2 textures a round.
 *
 * Usage: node tools/species-lifecycle-check.mjs [--base http://localhost:8765/]
 *        [--cycles 3] [--rounds 10] [--only boots|swaps|failure|motion|leak]
 *        [--out file.json]
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
const ROUNDS = Number(arg('--rounds', '10'));
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
  // Held still, as in `leak`: flying reveals world content, and drones and
  // rings respawn, which moves the GPU counts on its own (measured here
  // without the studio latch: +10 geometries over the section).
  await page.evaluate(() => {
    window.__BIRB.pinTier(0);
    window.__BIRB.freeze(true);
    window.__BIRB.birdStudio(true, { world: true });
  });
  await frames(page, 3);
  const expected = []; // every warning this section provokes, in order
  // The bird ON THE ANCHOR, measured (birdStats traverses it), against the
  // bird the page says is flying: a crow/owl's own counts, or the Pionus's
  // as it booted.
  const pionus = await page.evaluate(() => window.__BIRB.birdStats());
  const flying = async () => {
    const [i, a, saved] = await Promise.all([info(page), page.evaluate(() => window.__BIRB.birdStats()),
      page.evaluate(() => localStorage.getItem('birb.species'))]);
    const anchorOk = i.species === 'birb'
      ? a.meshes === pionus.meshes && a.triangles === pionus.triangles && i.tier === null
      : a.triangles === i.triangles && a.drawCalls === i.drawCalls && i.tier === 'high';
    return { i, saved, anchorOk, anchor: { meshes: a.meshes, triangles: a.triangles } };
  };
  // One swap, with the fault armed (or not): what it resolved to, what flies
  // now, and exactly the warnings it raised.
  const swapTo = async (id, fault = null) => {
    const w0 = warns.length;
    const r = await page.evaluate((s, f) => {
      if (f) window.__BIRB.speciesFault(f);
      return window.__BIRB.setSpecies(s, { persist: true });
    }, id, fault);
    await frames(page, 3);
    return { r, ...(await flying()), warned: warns.slice(w0) };
  };
  const refsFor = (s) => (s === 'birb' ? 0 : 1);
  const counts = (i) => ({ geometries: i.gpu.geometries, textures: i.gpu.textures });
  const sameCounts = (a, b) => a.gpu.geometries === b.gpu.geometries && a.gpu.textures === b.gpu.textures;

  // BEFORE the mount, from the Pionus (the first one also loads the module):
  // the Pionus stays, nothing is saved, nothing staged survives.
  const birb0 = (await flying()).i;
  for (const [stage, to] of [['stage', 'owl'], ['mount', 'crow'], ['feathers', 'owl']]) {
    const s = await swapTo(to, stage);
    const msg = new RegExp(`^\\[species\\] could not build the ${to}; keeping the birb`);
    expected.push(msg);
    check(`failure '${stage}' Birb->${to}: the Pionus keeps flying (and is on the anchor)`, s.r === 'birb' && s.i.species === 'birb' && s.anchorOk, { r: s.r, species: s.i.species, anchor: s.anchor });
    check(`failure '${stage}' Birb->${to}: saved choice untouched, 0 texture refs, GPU counts unchanged`, s.saved === 'birb' && s.i.textureRefs === 0
      && sameCounts(s.i, birb0), { saved: s.saved, refs: s.i.textureRefs, before: counts(birb0), after: counts(s.i) });
    check(`failure '${stage}' Birb->${to}: exactly its one warning`, s.warned.length === 1 && msg.test(s.warned[0]), s.warned);
  }

  // Warm-up: every bird and its sky once, so later counts compare like with
  // like (first compiles, the shared generator, the first probe target).
  for (const id of ['crow', 'owl', 'birb', 'crow']) {
    const s = await swapTo(id);
    check(`failure warm-up -> ${id}: clean`, s.r === id && s.i.species === id && s.anchorOk && s.warned.length === 0 && s.i.textureRefs === refsFor(id), { r: s.r, warned: s.warned });
  }
  const base = (await flying()).i; // the crow, warm

  // BEFORE the mount, from the crow: the crow stays, saved stays crow.
  for (const stage of ['stage', 'feathers', 'mount']) {
    for (const to of ['owl', 'birb']) {
      const s = await swapTo(to, stage);
      const msg = new RegExp(`^\\[species\\] could not build the ${to}; keeping the crow`);
      expected.push(msg);
      check(`failure '${stage}' crow->${to}: the crow keeps flying (and is on the anchor), saved stays crow`,
        s.r === 'crow' && s.i.species === 'crow' && s.anchorOk && s.saved === 'crow', { r: s.r, species: s.i.species, saved: s.saved, anchor: s.anchor });
      check(`failure '${stage}' crow->${to}: one texture reference, GPU counts unchanged`, s.i.textureRefs === 1 && sameCounts(s.i, base),
        { refs: s.i.textureRefs, before: counts(base), after: counts(s.i) });
      check(`failure '${stage}' crow->${to}: exactly its one warning`, s.warned.length === 1 && msg.test(s.warned[0]), s.warned);
    }
  }

  // A SKY, and everything AFTER the mount: the new bird flies, is saved and
  // fully alive; one warning; and a clean swap back to the crow lands on the
  // counts of the same round run CLEAN just before (whatever the faulted
  // transaction held was released). Same route, because the counts depend on
  // it: an owl leaves the shared feather set's owl-only textures uploaded
  // while the crow keeps the set alive (+3 over a round through the Pionus).
  const after = [
    ['sky', 'owl', /^\[species\] bird sky failed; the bird keeps its lights only/],
    ['sky', 'birb', /^\[plumage\] bird sky failed; the feathers keep their lights only/],
    ['dispose', 'owl', /^\[species\] the outgoing bird did not tear down cleanly; the owl flies on/],
    ['dispose', 'birb', /^\[species\] the outgoing bird did not tear down cleanly; the birb flies on/],
    ['audio', 'owl', /^\[species\] the flight audio did not switch to the owl/],
    ['sync', 'owl', /^\[species\] the owl did not inherit the shadow lever or rim tint/],
    ['sync', 'birb', /^\[species\] the birb did not inherit the shadow lever or rim tint/],
  ];
  for (const [stage, to, msg] of after) {
    const control = await swapTo(to);
    const controlBack = await swapTo('crow');
    check(`failure '${stage}' crow->${to}: the clean control round is clean`, control.r === to && controlBack.r === 'crow'
      && control.warned.length === 0 && controlBack.warned.length === 0, { warned: [...control.warned, ...controlBack.warned] });
    const s = await swapTo(to, stage);
    expected.push(msg);
    check(`failure '${stage}' crow->${to}: the ${to} flies (and is on the anchor), and is saved`,
      s.r === to && s.i.species === to && s.anchorOk && s.saved === to, { r: s.r, species: s.i.species, saved: s.saved, anchor: s.anchor });
    check(`failure '${stage}' crow->${to}: texture refs ${refsFor(to)}, sky ${stage === 'sky' ? 'absent (lights only)' : 'bound'}`,
      s.i.textureRefs === refsFor(to) && (stage === 'sky' ? s.i.env === null : !!(s.i.env && s.i.env.bound)), { refs: s.i.textureRefs, env: s.i.env && s.i.env.bound });
    check(`failure '${stage}' crow->${to}: exactly its one warning`, s.warned.length === 1 && msg.test(s.warned[0]), s.warned);
    const back = await swapTo('crow');
    check(`failure '${stage}' crow->${to}, then a clean swap back: the crow, no warning, GPU counts = the clean round's`,
      back.r === 'crow' && back.anchorOk && back.warned.length === 0 && back.i.textureRefs === 1 && !!(back.i.env && back.i.env.bound)
      && sameCounts(back.i, controlBack.i), { warned: back.warned, clean: counts(controlBack.i), faulted: counts(back.i) });
  }

  // The settings button with a failing mount: no rejection reaches the page.
  await page.evaluate(() => document.querySelector('[data-control="settings-open"]')?.click());
  await frames(page, 2);
  await page.evaluate(() => { window.__BIRB.speciesFault('mount'); document.querySelector('[data-control="species"]').click(); });
  expected.push(/^\[species\] could not build the owl; keeping the crow/);
  await new Promise((r) => setTimeout(r, 1500));
  await frames(page, 3);
  const a3 = await flying();
  check('failure via the Bird button: the crow keeps flying (and is on the anchor)', a3.i.species === 'crow' && a3.anchorOk && a3.saved === 'crow', { species: a3.i.species, saved: a3.saved });
  // A re-LOD that fails blocks only ITS request: the next tier asked for is
  // tried, and so is the failed one after a user action (re-choosing the bird).
  const relod = async (js, fault = null) => {
    const w0 = warns.length;
    await page.evaluate((src, f) => { if (f) window.__BIRB.speciesFault(f); return (0, eval)(src); }, js, fault);
    await frames(page, 4);
    const i = await info(page);
    return { tier: i.tier, blocked: i.retierBlocked, species: i.species, refs: i.textureRefs, warned: warns.slice(w0) };
  };
  const reMsg = /^\[species\] re-LOD failed; keeping the high bird/;
  const f1 = await relod('window.__BIRB.pinTier(1)', 'stage');
  expected.push(reMsg);
  check('failure re-LOD high->mid: the high crow stays, mid blocked, one warning', f1.species === 'crow' && f1.tier === 'high' && f1.refs === 1
    && f1.blocked && f1.blocked.species === 'crow' && f1.blocked.tier === 'mid' && f1.warned.length === 1 && reMsg.test(f1.warned[0]), f1);
  const f2 = await relod('window.__BIRB.pinTier(2)');
  check('failure re-LOD: a DIFFERENT tier is tried (low lands), the block lifted', f2.tier === 'low' && f2.blocked === null && f2.warned.length === 0, f2);
  const f3 = await relod('window.__BIRB.pinTier(0)');
  const f4 = await relod('window.__BIRB.pinTier(1)', 'stage');
  expected.push(reMsg);
  const f5 = await relod('window.__BIRB.setSpecies("crow")');
  check('failure re-LOD: blocked again at mid, then re-choosing the crow (a user action) retries it and mid lands',
    f3.tier === 'high' && f4.tier === 'high' && f4.blocked && f4.blocked.tier === 'mid' && f5.tier === 'mid' && f5.blocked === null && f5.warned.length === 0,
    { f3: f3.tier, f4, f5 });
  check('failure: nothing left armed', await page.evaluate(() => window.__BIRB.speciesFault(null)) === null);
  check('failure: no page errors or unhandled rejections', errs.length === 0, errs);
  check(`failure: exactly the ${expected.length} expected warnings, in order`, warns.length === expected.length
    && expected.every((re, k) => re.test(warns[k])), { warns });
  results.push({ name: 'failure: warm-baseline gpu', ok: true, detail: counts(base) });
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

// -------------------------------------------------------------------- leak
// `swaps` boots on Amazing, where the shadows lever is OFF, and asks only for
// a plateau after a warm cycle — and the leak it missed was +2 textures every
// round, forever, on the DEFAULT boot (Ultra, lever on): three's shared shadow
// depth material re-uploaded the outgoing bird's disposed `map`. So this runs
// the default boot and asks for FLAT: every round ends on exactly round 1's
// counts. Round 0 is the warm-up, and only because a first crow and a first
// owl compile programs and the sky probe allocates its targets once.
//
// The world is held still, or it moves the counts on its own: measured with
// the bird frozen, drones and rings respawn (new geometries) and landmarks
// and nest markers come into view about a minute in. So: freeze, pin tier 0,
// the studio latch with { world: true } (drones, rings and weather hidden,
// world and sky kept, so the ground still draws in the VSM depth pass — part
// of the leak's path) and a fixed orbit camera. The biome is never switched.
if (!ONLY || ONLY === 'leak') {
  const { page, errs, warns } = await boot('');
  const held = await page.evaluate(() => {
    const B = window.__BIRB;
    B.pinTier(0);
    B.freeze(true);
    B.birdStudio(true, { world: true });
    B.orbitBird(0, 0.25, 3);
    return { shadows: B.qualityPreset().effective.shadowsEnabled, env: B.stats().environment, tier: B.stats().tier };
  });
  check('leak: default boot has the shadows lever on (the path that leaked)', held.shadows === true, held);
  await frames(page, 6);
  const patterns = [['crow -> owl -> Birb', ['crow', 'owl', 'birb']], ['crow <-> Birb', ['crow', 'birb']]];
  const record = {};
  for (const [label, ids] of patterns) {
    const ends = [];
    for (let r = 0; r <= ROUNDS; r++) {
      for (const id of ids) {
        // The camera is re-placed after each swap: orbitBird is relative to the
        // bird on the anchor, and the anchor never moves while frozen.
        await page.evaluate((s) => window.__BIRB.setSpecies(s), id);
        await page.evaluate(() => window.__BIRB.orbitBird(0, 0.25, 3));
        await frames(page, 4);
      }
      await frames(page, 4);
      const i = await info(page);
      const st = await page.evaluate(() => ({ env: window.__BIRB.stats().environment, tier: window.__BIRB.stats().tier }));
      ends.push({ round: r, ...i.gpu, refs: i.textureRefs, species: i.species, env: st.env, tier: st.tier });
    }
    console.log(`${label} round-end GPU counts`, JSON.stringify(ends.map((e) => [e.round, e.textures, e.geometries, e.programs])));
    record[label] = ends;
    check(`leak ${label}: ${ROUNDS} rounds after the warm-up`, ends.length === ROUNDS + 1, ends.length);
    check(`leak ${label}: every round ends on Birb with 0 texture refs, biome and tier unmoved`,
      ends.every((e) => e.species === 'birb' && e.refs === 0 && e.env === held.env && e.tier === held.tier), ends);
    const one = ends[1];
    for (let r = 2; r < ends.length; r++) {
      const e = ends[r];
      check(`leak ${label} round ${r}: textures/geometries/programs identical to round 1`,
        e.textures === one.textures && e.geometries === one.geometries && e.programs === one.programs,
        { round1: [one.textures, one.geometries, one.programs], now: [e.textures, e.geometries, e.programs] });
    }
  }
  check('leak: no console errors', errs.length === 0, errs);
  check('leak: no console warnings', warns.length === 0, warns);
  results.push({ name: 'leak: round-end gpu', ok: true, detail: record });
  await page.close();
}

await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, cycles: CYCLES, results }, null, 2));
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
