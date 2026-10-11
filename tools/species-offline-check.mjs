#!/usr/bin/env node
/**
 * tools/species-offline-check.mjs — the bird picker with NO NETWORK, checked in
 * the real page (headless Chrome through SwiftShader) against the real service
 * worker, not reasoned about from sw.js's text.
 *
 * The node tests pin the worker's STRATEGY (tests/sw-modules.test.js) and its
 * manifest (tests/build-identity.test.js SW-3); this proves the running game
 * boots and swaps birds from Cache Storage alone:
 *
 *   warm      ONE profile, online. Visit 1 is uncontrolled: it registers sw.js,
 *             which precaches CORE_ASSETS and claims the page. Every CORE_ASSETS
 *             entry must then be in the core cache — the species modules
 *             included, though nothing has imported them yet. Visit 2 is a full
 *             DEFAULT boot under the worker's control, which is what runtime-
 *             would runtime-cache the esm.sh modules (three, BufferGeometryUtils,
 *             nipplejs) even without the install crawl that first-visit proves.
 *             It never fetches species-bird.js, so every offline crow/owl below
 *             takes the builders from the PRECACHE.
 *   offline   The browser HTTP cache is cleared (so nothing can be served from
 *             it by accident — that is how a phone that evicted it would boot),
 *             and both the page and the service worker's own target are put
 *             offline over CDP. Two probes prove it before any scenario counts:
 *             an uncached same-origin .js and an uncached esm.sh URL must both
 *             come back as the worker's 504 "Offline".
 *   default   saved choice cleared: Splash → Title → start flies the Pionus,
 *             then the FIRST-EVER lazy import offline, through a real click on
 *             the ⚙ panel's Bird button (Birb → Crow), then setSpecies('owl')
 *             and setSpecies('birb').
 *   crow      saved 'crow': boots the crow, then owl, then Birb.
 *   owl       saved 'owl': boots the owl, then the Bird button (Owl → Birb),
 *             then setSpecies('crow').
 *   Every scenario: the expected bird after each step (__BIRB.speciesInfo()),
 *   every species module answered 200 BY THE SERVICE WORKER, zero failed
 *   requests (each recorded with its URL and reason), zero console errors,
 *   zero console warnings, no page errors or unhandled rejections.
 *
 *   first-visit  a FRESH profile and ONE online visit only, HTTP cache cleared,
 *             offline: "playable after the first online visit". Visit 1
 *             imports the esm.sh modules before the worker exists, so this is
 *             what proves sw.js's install-time CDN_MODULES crawl; without it
 *             three answered 504 and the game never reached the title. Then
 *             the default boot and the first-ever owl/crow, as above.
 *
 * Usage: node tools/species-offline-check.mjs [--base http://localhost:8765/]
 *        [--only default|crow|owl|first-visit] [--out-dir dir] (JSON + PNGs)
 * Two browsers (fresh profiles): warm + default/crow/owl, then first-visit.
 * Exit 1 on any failed check. Needs puppeteer-core (env PUPPETEER_CORE, or the
 * operator's copy) and Chrome (env CHROME_PATH, default /usr/bin/google-chrome).
 * Service workers need a secure context; http://localhost qualifies. A run
 * takes several minutes: SwiftShader draws a few frames a second.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8765/');
const ONLY = arg('--only', null);
const OUT_DIR = arg('--out-dir', null);
if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });

// The worker's own manifest, read the way tests/build-identity.test.js does:
// what the precache must hold is whatever sw.js says, not a copy of it here.
const swText = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const CORE_ASSETS = [...(/const CORE_ASSETS = \[([\s\S]*?)\n\];/.exec(swText) || [, ''])[1]
  .matchAll(/^\s*'([^']+)',/gm)].map((m) => m[1]);
const SPECIES_MODULES = CORE_ASSETS.filter((p) => p.startsWith('./src/flight/species/'));
const PROBE_TAG = 'offline-probe';
const CDN_ENTRIES = [...(/const CDN_MODULES = \[([\s\S]*?)\];/.exec(swText) || [, ''])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

async function loadPuppeteer() {
  try { return (await import('puppeteer-core')).default; } catch (_) { /* fall through */ }
  const require = createRequire(import.meta.url);
  for (const p of [process.env.PUPPETEER_CORE, '/workspace/frontfootprep-launch/tools/node_modules/puppeteer-core'].filter(Boolean)) {
    try { return require(p); } catch (_) { /* next */ }
  }
  throw new Error('puppeteer-core not found (set PUPPETEER_CORE)');
}

const results = [];
const record = {};
let failed = 0;
const check = (name, ok, detail, { info = false } = {}) => {
  results.push({ name, ok: !!ok, info, detail });
  if (!ok && !info) failed += 1;
  console.log(`${ok ? 'ok  ' : info ? 'INFO' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

const puppeteer = await loadPuppeteer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (page, k = 3) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), k);
const info = (page) => page.evaluate(() => window.__BIRB.speciesInfo());

// A fresh profile per browser, so Cache Storage and the registration start
// empty: a worker left over from another run would make "warm" a no-op.
async function launch(tag) {
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required', `--user-data-dir=/tmp/birb-offline-${tag}-${process.pid}-${Date.now()}`],
  });
}

// Offline is applied to the PAGE and to every service-worker TARGET: page
// emulation alone does not reach the worker's own fetch() calls, and a worker
// that still has the network would turn every check below into a lie. A worker
// restarted while offline is a new target, so new ones are caught as they
// appear. The probes in goOffline() prove the cut instead of assuming it.
//
// The cut is applied while a controlled page is still open and has just
// woken the worker (a fetch), so its target exists to be cut; a DevTools
// session on it then keeps it from being stopped for idleness. `restarts`
// counts any worker target that appears AFTER the cut (cut on arrival, but a
// request could race it) — the run asserts it stays 0.
function offlineSwitch(browser) {
  let offline = false;
  let restarts = 0;
  const sessions = [];
  const cut = async (target) => {
    if (target.type() !== 'service_worker') return;
    const s = await target.createCDPSession();
    await s.send('Network.enable');
    await s.send('Network.setCacheDisabled', { cacheDisabled: true });
    await s.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    sessions.push(s);
  };
  browser.on('targetcreated', (t) => {
    if (!offline || t.type() !== 'service_worker') return;
    restarts += 1;
    cut(t).catch((e) => console.log('sw target cut failed', e.message));
  });
  return {
    get offline() { return offline; },
    get restarts() { return restarts; },
    async on(page) {
      // Wake the worker through the controlled page so its target is live.
      await page.evaluate(() => fetch('./manifest.webmanifest').then((r) => r.status, () => 0));
      await sleep(250);
      offline = true;
      const sw = browser.targets().filter((t) => t.type() === 'service_worker');
      for (const t of sw) await cut(t);
      return sw.length;
    },
  };
}

async function clearHttpCache(browser) {
  const page = await browser.newPage();
  const s = await page.createCDPSession();
  await s.send('Network.clearBrowserCache');
  await page.close();
}

async function openPage(browser, { ls = null, clearSpecies = false, offline = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const log = { errs: [], warns: [], failedRequests: [], served: [], fetched: [] };
  page.on('pageerror', (e) => log.errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    // The probes' own 504s are expected and are not the game's: they are the
    // only messages whose source URL carries PROBE_TAG, and they are dropped.
    const at = (m.location() && m.location().url) || '';
    if (at.includes(PROBE_TAG)) return;
    if (m.type() === 'error' && !/vibrate/.test(t)) log.errs.push(t.slice(0, 240) + (at ? ' @ ' + at : ''));
    if (m.type() === 'warn' || m.type() === 'warning') log.warns.push(t.slice(0, 240));
  });
  page.on('request', (r) => log.fetched.push(r.url()));
  page.on('requestfailed', (r) => {
    if (!r.url().includes(PROBE_TAG)) log.failedRequests.push({ url: r.url(), type: r.resourceType(), reason: (r.failure() && r.failure().errorText) || 'failed' });
  });
  page.on('response', (r) => {
    const url = r.url();
    if (url.includes(PROBE_TAG)) return;
    if (r.status() >= 400) log.failedRequests.push({ url, type: r.request().resourceType(), reason: `HTTP ${r.status()} ${r.statusText()}`, fromServiceWorker: r.fromServiceWorker() });
    if (/\/src\/flight\/species\/|esm\.sh/.test(url)) log.served.push({ url, status: r.status(), fromServiceWorker: r.fromServiceWorker() });
  });
  if (clearSpecies) await page.evaluateOnNewDocument(() => localStorage.removeItem('birb.species'));
  if (ls) await page.evaluateOnNewDocument((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, ls);
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection: ' + (e.reason && e.reason.message)));
  });
  if (offline) await page.setOfflineMode(true);
  return { page, log };
}

// Splash → Title → Tap to Start, as tools/species-lifecycle-check.mjs boots.
async function boot(page, query = '') {
  const doc = await page.goto(BASE + '?debug=1' + (query ? '&' + query : ''), { waitUntil: 'networkidle2', timeout: 120000 });
  const deadline = Date.now() + 60000;
  for (;;) {
    const ready = await page.evaluate(() => { const s = document.querySelector('[data-title-start]'); const sc = document.querySelector('[data-title-screen]'); return !!s && !sc?.hidden; });
    if (ready) break;
    if (Date.now() > deadline) throw new Error('title never appeared');
    await page.evaluate(() => { document.querySelector('[data-splash-screen]')?.click(); document.querySelector('[data-vibe-splash]')?.click(); });
    await sleep(250);
  }
  await page.waitForFunction('window.__BIRB_READY === true', { timeout: 90000 });
  await page.evaluate(() => document.querySelector('[data-title-start]').click());
  await page.waitForFunction('window.__BIRB && window.__BIRB.stats().elapsed > 0.5', { timeout: 180000 });
  return doc ? { status: doc.status(), fromServiceWorker: doc.fromServiceWorker() } : null;
}

// The worker installed, activated, controlling this page, and its precache
// holding every CORE_ASSETS entry (install puts them all before it resolves,
// and activation waits on install, so "activated" means the puts are done).
async function waitForWorker(page) {
  const deadline = Date.now() + 90000;
  let last = null;
  for (;;) {
    last = await page.evaluate(async (core) => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      const coreKey = keys.find((k) => k.startsWith('birb-core-')) || null;
      let missing = core;
      if (coreKey) {
        const c = await caches.open(coreKey);
        missing = [];
        for (const p of core) if (!(await c.match(new URL(p, location.origin + '/').href))) missing.push(p);
      }
      return {
        controlled: !!navigator.serviceWorker.controller,
        active: reg && reg.active ? reg.active.state : null,
        installing: !!(reg && reg.installing), keys, coreKey, missing,
      };
    }, CORE_ASSETS);
    if (last.controlled && last.active === 'activated' && !last.installing && last.missing.length === 0) return last;
    if (Date.now() > deadline) return last;
    await sleep(500);
  }
}

const cacheListing = (page) => page.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => r.url);
  return out;
});

async function shoot(page, name) {
  if (!OUT_DIR) return null;
  const path = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

// The worker answers 504 "Offline" for a same-origin .js or an esm.sh URL it
// has not cached, once fetch() fails. 200 here means the network is still up.
// Run before the bird swaps and again after them: the worker stays cut.
const probe = (page) => page.evaluate(async (tag) => {
  const one = async (u) => { try { const r = await fetch(u, { cache: 'no-store' }); return r.status + ' ' + r.statusText; } catch (e) { return 'threw ' + e.message; } };
  const t = tag + '=' + Date.now();
  return {
    sameOrigin: await one('/src/flight/species/species-select.js?' + t),
    cdn: await one('https://esm.sh/three@0.183.2?' + t),
  };
}, PROBE_TAG);
const probeOk = (pr) => /^504/.test(pr.sameOrigin) && /^504/.test(pr.cdn);

const MATTERS = /\/src\/|esm\.sh|index\.html|\/assets\/|\/sound\/|\.(js|mjs|png|jpg|mp3|wav|webmanifest|svg)(\?|$)/;

async function scenario(browser, sw, label, { ls, clearSpecies, expectBoot, steps }) {
  const { page, log } = await openPage(browser, { ls, clearSpecies, offline: true });
  const out = { label, steps: [] };
  try {
    const doc = await boot(page);
    out.document = doc;
    check(`${label}: the shell came from the service worker`, doc && doc.status === 200 && doc.fromServiceWorker, doc);
    await frames(page, 4);
    const pr = await probe(page);
    out.probe = { before: pr };
    check(`${label}: offline is real (worker's 504 for uncached same-origin and esm.sh)`, probeOk(pr), pr);
    const i0 = await info(page);
    out.boot = { species: i0.species, tier: i0.tier, builds: i0.builds };
    check(`${label}: boots offline flying the ${expectBoot}`, i0.species === expectBoot, i0.species);
    out.shots = [await shoot(page, `${label}-boot-${i0.species}`)];
    for (const st of steps) {
      let got;
      if (st.click) {
        await page.evaluate(() => document.querySelector('[data-control="settings-open"]')?.click());
        await frames(page, 2);
        await page.evaluate(() => document.querySelector('[data-control="species"]').click());
        try { await page.waitForFunction((want) => window.__BIRB.speciesInfo().species === want, { timeout: 90000 }, st.to); } catch (_) { /* checked below */ }
        await frames(page, 3);
        out.shots.push(await shoot(page, `${label}-button-${st.to}`));
        await page.evaluate(() => document.querySelector('[data-control="settings-close"]')?.click());
        got = (await info(page)).species;
      } else {
        got = await page.evaluate((s) => window.__BIRB.setSpecies(s), st.to);
      }
      await frames(page, 4);
      const i = await info(page);
      out.steps.push({ to: st.to, via: st.click ? 'Bird button' : 'setSpecies', got, species: i.species, tier: i.tier, textureRefs: i.textureRefs });
      check(`${label}: ${st.click ? 'Bird button' : 'setSpecies'} -> ${st.to} offline`, got === st.to && i.species === st.to, { got, species: i.species });
      if (st.shot) out.shots.push(await shoot(page, `${label}-swap-${st.to}`));
    }
    out.probe.after = await probe(page);
    check(`${label}: still offline after the swaps`, probeOk(out.probe.after), out.probe.after);
    const species = log.served.filter((s) => /\/src\/flight\/species\//.test(s.url));
    const bad = species.filter((s) => s.status !== 200 || !s.fromServiceWorker);
    check(`${label}: every species module answered 200 by the service worker`, species.length > 0 && bad.length === 0, { n: species.length, bad });
    const builders = SPECIES_MODULES.filter((p) => p !== './src/flight/species/species-select.js');
    const notLoaded = builders.filter((p) => !species.some((s) => s.url.endsWith(p.slice(1))));
    check(`${label}: the lazy builders (${builders.length}) all loaded offline`, notLoaded.length === 0, notLoaded);
  } catch (e) {
    check(`${label}: ran to completion offline`, false, e.message);
    out.shots = [...(out.shots || []), await shoot(page, `${label}-stuck`).catch(() => null)];
  }
  const mattering = log.failedRequests.filter((f) => MATTERS.test(f.url));
  out.failedRequests = log.failedRequests;
  out.served = log.served;
  out.errs = log.errs;
  out.warns = log.warns;
  check(`${label}: zero failed requests that matter`, mattering.length === 0, mattering);
  check(`${label}: zero failed requests at all`, log.failedRequests.length === 0, log.failedRequests, { info: true });
  check(`${label}: no console errors, page errors or unhandled rejections`, log.errs.length === 0, log.errs);
  check(`${label}: no console warnings`, log.warns.length === 0, log.warns);
  record[label] = out;
  await page.close();
}

const SCENARIOS = {
  default: { clearSpecies: true, expectBoot: 'birb',
    steps: [{ to: 'crow', click: true }, { to: 'owl', shot: true }, { to: 'birb' }] },
  crow: { ls: { 'birb.species': 'crow' }, expectBoot: 'crow',
    steps: [{ to: 'owl', shot: true }, { to: 'birb' }] },
  owl: { ls: { 'birb.species': 'owl' }, expectBoot: 'owl',
    steps: [{ to: 'birb', click: true }, { to: 'crow', shot: true }] },
};

check('sw.js: CORE_ASSETS parsed, species modules listed', CORE_ASSETS.length > 50 && SPECIES_MODULES.length >= 11,
  { core: CORE_ASSETS.length, species: SPECIES_MODULES.length });

if (ONLY !== 'first-visit') {
  const browser = await launch('main');
  const sw = offlineSwitch(browser);
  try {
    // ------------------------------------------------------------- warm
    const v1 = await openPage(browser, { clearSpecies: true });
    await v1.page.goto(BASE + '?debug=1', { waitUntil: 'networkidle2', timeout: 120000 });
    const w = await waitForWorker(v1.page);
    record.warm = { visit1: { controlled: w.controlled, active: w.active, coreKey: w.coreKey, missing: w.missing } };
    check('warm visit 1: worker activated and controlling', w.controlled && w.active === 'activated', { controlled: w.controlled, active: w.active });
    check(`warm visit 1: precache holds all ${CORE_ASSETS.length} CORE_ASSETS (the species modules too)`, w.missing.length === 0, w.missing);
    await v1.page.close();

    const v2 = await openPage(browser, { clearSpecies: true });
    await boot(v2.page);
    await frames(v2.page, 4);
    const ctl = await v2.page.evaluate(() => !!navigator.serviceWorker.controller);
    check('warm visit 2: the default boot runs under the worker', ctl);
    check('warm visit 2: species-bird.js never fetched (offline swaps rely on the precache)',
      !v2.log.fetched.some((u) => /species-bird\.js/.test(u)));
    check('warm visit 2: no console errors', v2.log.errs.length === 0, v2.log.errs);
    check('warm visit 2: no console warnings', v2.log.warns.length === 0, v2.log.warns);
    await sleep(1500); // let cacheFirst's background put()s land
    const listing = await cacheListing(v2.page);
    record.warm.caches = listing;
    const runtime = Object.entries(listing).filter(([k]) => k.startsWith('birb-runtime-')).flatMap(([, v]) => v);
    const cdn = runtime.filter((u) => /esm\.sh/.test(u));
    record.warm.runtimeCdn = cdn;
    for (const entry of CDN_ENTRIES) {
      check(`warm visit 2: runtime cache holds ${entry}`, cdn.includes(entry), cdn.length);
    }

    // ---------------------------------------------------------- offline
    await clearHttpCache(browser);
    const nsw = await sw.on(v2.page);
    check('offline: the service worker target was cut too', nsw >= 1, nsw);
    await v2.page.close();
    for (const [label, sc] of Object.entries(SCENARIOS)) {
      if (ONLY && ONLY !== label) continue;
      await scenario(browser, sw, label, sc);
    }
    check('offline: the worker was never restarted uncut mid-run', sw.restarts === 0, sw.restarts);
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------- first-visit
// A FRESH profile and ONE online visit, nothing else: visit 1 imports three
// and nipplejs from esm.sh BEFORE sw.js is even registered (it registers on
// window load), so runtime caching never sees the entry modules. Before sw.js
// crawled CDN_MODULES at install, this offline boot answered
// `https://esm.sh/three@0.183.2` with the worker's 504 and never reached the
// title (shots/main-species-final/offline/first-visit-BEFORE-sw-fix.json).
// Then the first-ever crow and owl, from the precache.
if (!ONLY || ONLY === 'first-visit') {
  const browser = await launch('first');
  const sw = offlineSwitch(browser);
  try {
    const v1 = await openPage(browser, { clearSpecies: true });
    await v1.page.goto(BASE + '?debug=1', { waitUntil: 'networkidle2', timeout: 120000 });
    const w = await waitForWorker(v1.page);
    const listing = await cacheListing(v1.page);
    const cdn = Object.entries(listing).filter(([k]) => k.startsWith('birb-runtime-')).flatMap(([, v]) => v).filter((u) => /esm\.sh/.test(u));
    record.firstVisit = { controlled: w.controlled, missing: w.missing, runtimeCdn: cdn };
    check('first visit: worker controlling, precache complete', w.controlled && w.missing.length === 0, { controlled: w.controlled, missing: w.missing });
    const crawled = CDN_ENTRIES.filter((u) => !cdn.includes(u));
    check(`first visit: install crawled the ${CDN_ENTRIES.length} esm.sh entries into the runtime cache`, crawled.length === 0, { missing: crawled, cached: cdn });
    await clearHttpCache(browser);
    const nsw = await sw.on(v1.page);
    check('first visit offline: the service worker target was cut too', nsw >= 1, nsw);
    await v1.page.close();
    await scenario(browser, sw, 'first-visit', { clearSpecies: true, expectBoot: 'birb',
      steps: [{ to: 'owl', click: false }, { to: 'crow', shot: true }, { to: 'birb' }] });
    check('first visit offline: the worker was never restarted uncut mid-run', sw.restarts === 0, sw.restarts);
  } finally {
    await browser.close();
  }
}

if (OUT_DIR) writeFileSync(`${OUT_DIR}/${ONLY || 'offline'}-results.json`, JSON.stringify({ base: BASE, coreAssets: CORE_ASSETS.length, results, record }, null, 2));
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
