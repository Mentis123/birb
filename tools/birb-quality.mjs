#!/usr/bin/env node
/**
 * birb-quality.mjs — the performance-workbench harness.
 *
 * Wave 1 / task P1.3 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4. Authority:
 * docs/perf/CONTRACT.md (the assertion table, harness context, precedence),
 * docs/perf/EXPECTED-RED.md (what --check resize-restore must report on HEAD),
 * docs/perf/ASSERTIONS.md (the snapshot contract, the mutation catalogue).
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE FOR ANYONE EDITING THIS FILE
 * ---------------------------------------------------------------------------
 * This file TRANSCRIBES tools/lib/quality-assertions.mjs. It drives the real
 * page to build a snapshot object, hands that snapshot to ASSERTIONS[id].run,
 * and prints/exits on what comes back. It does not decide a comparator
 * direction, relax a threshold, or invent a state the library does not
 * already have. If an assertion looks wrong, say so in the task report — do
 * not "fix" it here (R5: no agent modifies its own oracle).
 *
 * ---------------------------------------------------------------------------
 * BOOT PATH — R7, one harness, reusing birb-shot.mjs rather than
 * reimplementing it
 * ---------------------------------------------------------------------------
 * The splash -> vibe -> title -> tap-to-start flow, the CDN cache, the
 * Chromium args, and the "did the page actually finish building its systems"
 * check all live in tools/birb-shot.mjs and are imported verbatim. The only
 * thing this file adds to that boot is the CONTRACT §5.1 pinned mobile
 * context (390x844 @ deviceScaleFactor 3, isMobile/hasTouch true), because
 * that is what makes the DPR discriminator alive (CONTRACT §5.2 SC-DPR) —
 * tools/birb-modes.mjs's deviceScaleFactor:1 context is the DEAD one and must
 * never be copied here.
 *
 * ---------------------------------------------------------------------------
 * NEVER A SILENT PASS FOR ABSENCE
 * ---------------------------------------------------------------------------
 * Six of the twelve assertions (A1, A2, A3, A5, A10, A11, A12) target a panel,
 * a gesture module, a DPR slider, a weather-density control or a build-
 * identity export that Wave 2/2.4 has not shipped yet. Every sub-mode below
 * detects that statically (a file-existence / source-grep check, no browser
 * needed) and reports EXIT 2 — skipped, not scored — rather than booting a
 * browser to rediscover what `fs.existsSync` already knows, and rather than
 * ever letting that absence read as a pass. This is the same failure this
 * repo shipped once already: a world that screenshotted perfectly with its
 * nesting and collectibles systems never created, and a modes harness whose
 * tail said "all 5 modes ok" on a run that was exiting 1.
 *
 * ---------------------------------------------------------------------------
 * SUB-MODES
 * ---------------------------------------------------------------------------
 *   --check <id|alias|all>   Run one assertion (or all twelve) against the
 *                            live page. "resize-restore" is the alias for A6
 *                            — CONTRACT.md and EXPECTED-RED.md both name it.
 *   --selftest               R8's proof: apply every catalogued mutation and
 *                            confirm it flips the assertion it targets. Prints
 *                            "mutations: N catalogued, M applicable, K detected".
 *                            Exits non-zero on any undetected APPLICABLE
 *                            mutation, or if the panel/gesture files exist on
 *                            disk yet applicable still undercounts catalogued
 *                            (a stale mutationCoverage() table).
 *   --hooks-only             Fast smoke test: which __BIRB.* hooks this
 *                            harness depends on actually exist on the live
 *                            page. No assertion is scored.
 *   --emit-samples           Dump the raw snapshot object for every assertion
 *                            id (as far as it can be captured today) to JSON,
 *                            for a gate or a human to inspect directly.
 *   --capture-intervals      TEL-2's raw per-frame interval buffer needs
 *                            src/game/frame-metrics.js extended (Wave 2
 *                            P2.1) — it is not implemented yet, so this is a
 *                            static, no-browser skip (EXIT 2).
 *
 * Every sub-mode prints a coverage line unconditionally. Only --selftest
 * actually attempts the mutations, so outside it the third ("detected")
 * number is omitted rather than fabricated as 0-of-something-untried.
 *
 * ---------------------------------------------------------------------------
 * FLAGS
 * ---------------------------------------------------------------------------
 *   --artefacts <dir>   where screenshots/JSON land on a failing run
 *                       (default: <repo>/.quality-artefacts)
 *   --out <path>        --emit-samples output path
 *                       (default: <repo>/.quality-artefacts/samples.json)
 *   --rays on           --check A7/frame-totals: sample the harder raysOn (8-
 *                       pass) branch via the documented sun-facing recipe,
 *                       instead of the default, robust rays-off (5-pass) one.
 */

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame,
} from './birb-shot.mjs';

import {
  ASSERTIONS, ASSERTION_IDS, MUTATIONS, mutationCoverage, exitCodeFor, matchesExpectedRed,
} from './lib/quality-assertions.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Static gap detection — no browser needed. These are the same surfaces
// docs/perf/ASSERTIONS.md §5 lists as GAP-A1/2, GAP-A3, GAP-A5, GAP-A11/12.
// ---------------------------------------------------------------------------

const FUTURE_FILES = Object.freeze(['src/ui/dev-quality-panel.js', 'src/ui/dev-gesture.js']);

export function existingFutureFiles() {
  return FUTURE_FILES.filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
}

function hasQualityExport() {
  // __BIRB.quality() has no file of its own — CONTRACT §8.3 SW-4 puts it
  // straight on the debug object in index.html — so the presence check is a
  // source grep rather than fs.existsSync. Matches the object-literal key
  // shape every other __BIRB method uses ("quality: (" or "quality: () =>").
  let html;
  try { html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8'); } catch { return false; }
  return /\bquality:\s*\(/.test(html);
}

const REQUIRES = Object.freeze({
  A1: FUTURE_FILES,
  A2: FUTURE_FILES,
  A3: ['src/ui/dev-quality-panel.js'],
  A4: [],
  A5: ['src/ui/dev-quality-panel.js (weather-density control independent of the tier)'],
  A6: [],
  A7: [],
  A8: [],
  A9: [],
  A10: ['src/ui/dev-quality-panel.js'],
  A11: ['__BIRB.quality() in index.html'],
  A12: ['__BIRB.quality() in index.html'],
});

/** Returns { available, requires } without touching a browser. */
export function checkStaticAvailability(id) {
  if (id === 'A1' || id === 'A2') {
    return { available: FUTURE_FILES.every((f) => fs.existsSync(path.join(REPO_ROOT, f))), requires: REQUIRES[id] };
  }
  if (id === 'A3' || id === 'A5' || id === 'A10') {
    return { available: fs.existsSync(path.join(REPO_ROOT, 'src/ui/dev-quality-panel.js')), requires: REQUIRES[id] };
  }
  if (id === 'A11' || id === 'A12') {
    return { available: hasQualityExport(), requires: REQUIRES[id] };
  }
  return { available: true, requires: [] };
}

/**
 * The most accurate snapshot this harness can supply WITHOUT the surface
 * that does not exist yet. Every field left out is left ABSENT, never
 * defaulted — that is the sentinel protocol's whole point (CONTRACT §3.1).
 * A1 is the one exception worth a comment: passed {} it would evaluate its
 * debugParamPresent guard first and report "invalid" rather than the more
 * informative "unavailable, no panel" — so it is told the one fact this
 * harness DOES already know (this run loaded with ?debug, so a real A1
 * attempt would need a second, non-debug boot the harness has not done).
 */
function bestKnownPartial(id) {
  if (id === 'A1') return { debugParamPresent: false };
  return {};
}

// ---------------------------------------------------------------------------
// Check id / alias resolution
// ---------------------------------------------------------------------------

export const CHECK_ALIASES = Object.freeze({
  'resize-restore': 'A6',
  'buffer-coherence': 'A6',
  'post-consistency': 'A4',
  'bloom-sizing': 'A4',
  'frame-totals': 'A7',
  'whole-frame-totals': 'A7',
  'degraded-totals': 'A8',
  'tier-totals': 'A8',
  'shafts-toggle': 'A9',
  'rays-toggle': 'A9',
  'gesture-panel': 'A1',
  'sprint-survives': 'A2',
  'sprint-gesture': 'A2',
  'dpr-control': 'A3',
  'weather-density': 'A5',
  'panel-persistence': 'A10',
  'sentinel-fields': 'A11',
  'build-identity': 'A12',
});

export function resolveCheckId(name) {
  if (!name) return null;
  const upper = String(name).toUpperCase();
  if (ASSERTIONS[upper]) return upper;
  const lower = String(name).toLowerCase();
  if (CHECK_ALIASES[lower]) return CHECK_ALIASES[lower];
  return null;
}

// ---------------------------------------------------------------------------
// Boot — CONTRACT §5.1's pinned context, built on birb-shot.mjs's own helpers
// ---------------------------------------------------------------------------

async function boot() {
  const { server, port } = await startServer(REPO_ROOT);
  const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
  // CONTRACT §5.1, verbatim: { viewport: 390x844, deviceScaleFactor: 3,
  // isMobile: true, hasTouch: true }. isMobile selects DPR_CAP=1.7 over 1.8
  // (index.html ~3568) and hasTouch is what makes the three-finger gesture
  // synthesisable at all once A1/A2 land. deviceScaleFactor MUST be > the
  // 1.7 cap or SC-DPR (§5.2) goes dead — never copy birb-modes.mjs's dsf:1.
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'no-preference',
  });
  await installCdnCache(context);

  const consoleErrors = [];
  const pageErrors = [];
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String((err && err.stack) || err)));
  page.on('requestfailed', (req) => {
    consoleErrors.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
  });

  const url = `http://127.0.0.1:${port}/index.html?debug=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await startGame(page, 30000);

  const close = async () => { await browser.close(); server.close(); };
  return { page, consoleErrors, pageErrors, close };
}

async function saveArtefacts(page, dir, label) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${label}.png`) });
  } catch { /* best-effort diagnostic; never let artefact capture mask the real failure */ }
}

function artefactsDirFrom(args) {
  return path.resolve(REPO_ROOT, String(args.artefacts || '.quality-artefacts'));
}

// ---------------------------------------------------------------------------
// SC-DPR — CONTRACT §5.2, the self-check that must FAIL rather than pass
// silently. Run once per booted page before any assertion that reads
// effective() is trusted.
// ---------------------------------------------------------------------------

async function selfCheckDpr(page) {
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await page.waitForTimeout(200);
  const r0 = (await page.evaluate(() => window.__BIRB.effective())).rendererPixelRatio;
  await page.evaluate(() => window.__BIRB.pinTier(1));
  await page.waitForTimeout(200);
  const r1 = (await page.evaluate(() => window.__BIRB.effective())).rendererPixelRatio;
  const dsf = await page.evaluate(() => window.devicePixelRatio);
  if (r0 === r1) {
    console.error(
      `SC-DPR FAILED: tier 0 and tier 1 pixel ratios are both ${r0} at deviceScaleFactor=${dsf} — ` +
      'the DPR discriminator is dead in this context (CONTRACT §5.2). Fixing the context, not proceeding.',
    );
    return false;
  }
  console.log(`SC-DPR ok: tier0=${r0} tier1=${r1}`);
  return true;
}

// ---------------------------------------------------------------------------
// In-page frame sampling — collects consecutive frames inside ONE
// page.evaluate call so no Playwright round-trip latency falls between them.
// That matters specifically because faceSun() does not latch (the flight
// system rewrites the quaternion every simulated frame) and raysDirty's
// clearing frame is exactly one frame wide either way.
// ---------------------------------------------------------------------------

async function sampleFrames(page, count) {
  return page.evaluate((n) => new Promise((resolve) => {
    const out = [];
    function tick() {
      out.push(window.__BIRB.frameTotals());
      if (out.length >= n) resolve(out);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), count);
}

/**
 * Like sampleFrames, but also reads stats().sunUv on each sampled frame.
 *
 * A real bug this fixed while writing this harness: reading sunUv right
 * after faceSun() reports whatever the LAST RENDERED frame's projection was,
 * not the reoriented one — the projection is recomputed inside the render
 * loop, one rAF after the quaternion changes. So a raysOn capture that took
 * sunVisible from putSunOnScreen()'s own return value (measured before
 * setBloom + before sampling) reported sunVisible<=0.001 while the actually
 * SAMPLED frames were genuinely rendering the 8-pass branch — computeRaysOn
 * then said "rays off" about a frame that was rendering rays on. Read sunUv
 * on the SAME frame frameTotals() is read from, always.
 */
async function sampleFramesWithSun(page, count) {
  return page.evaluate((n) => new Promise((resolve) => {
    const out = [];
    function tick() {
      out.push({ frameTotals: window.__BIRB.frameTotals(), sunUv: window.__BIRB.stats().sunUv });
      if (out.length >= n) resolve(out);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), count);
}

/**
 * CONTRACT §4.1 / ASSERTIONS.md §2's measured recipe, transcribed exactly.
 * Three traps recorded there, all real: setSunTime() is inert while the
 * cycle is disabled (enable -> set -> one frame -> disable, in that order);
 * faceSun(0.22) only works on a low sun (t=0's ~19deg elevation), so this
 * retries with a growing pitch-up rather than assuming the first value
 * works; faceSun() does not latch, so the caller must sample immediately.
 */
async function putSunOnScreen(page) {
  await page.evaluate(() => {
    window.__BIRB.setSunEnabled(true);
    window.__BIRB.setSunTime(0);
  });
  await page.waitForTimeout(50);
  let visible = 0;
  for (const pitch of [0.22, 0.35, 0.5, 0.65, 0.8]) {
    visible = await page.evaluate((p) => {
      window.__BIRB.setSunEnabled(false);
      window.__BIRB.faceSun(p);
      return window.__BIRB.stats().sunUv[2];
    }, pitch);
    if (visible > 0.001) break;
  }
  return visible;
}

// ---------------------------------------------------------------------------
// Live snapshot capture, one function per assertion available on HEAD
// ---------------------------------------------------------------------------

async function captureA4(page) {
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await page.waitForTimeout(150);
  return { effective: await page.evaluate(() => window.__BIRB.effective()) };
}

/**
 * The check this whole wave exists for. CONTRACT §4 A6 / EXPECTED-RED.md.
 * All four steps, in the exact order and with the exact "no resize at 2/4,
 * one real resize between 2 and 3" shape assertA6 itself checks for — see
 * EXPECTED-RED.md §1's own table, transcribed here as the sequence of calls.
 */
async function captureResizeRestore(page, opts = {}) {
  const resizeWidth = opts.resizeWidth ?? 360;
  const resizeHeight = opts.resizeHeight ?? 780;
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const steps = [];

  const record = async (id, requestedTier) => {
    const effective = await page.evaluate(() => window.__BIRB.effective());
    const css = await page.evaluate(() => ({
      cssWidth: document.documentElement.clientWidth,
      cssHeight: document.documentElement.clientHeight,
    }));
    steps.push({ id, requestedTier, cssWidth: css.cssWidth, cssHeight: css.cssHeight, effective });
  };

  // Step 1 — tier0. pinTier(n) is a no-op when n already equals the current
  // tier, so this does not RELY on causing a resize; the boot's own
  // scheduleRendererResize(true) already sized everything at tier 0.
  const t1 = await page.evaluate(() => window.__BIRB.pinTier(0));
  await page.waitForTimeout(250);
  await record('tier0', t1);

  // Step 2 — degrade. No resize. applyTier moves renderer.setPixelRatio only.
  const t2 = await page.evaluate(() => window.__BIRB.pinTier(2));
  await page.waitForTimeout(200);
  await record('degraded', t2);

  // Step 3 — resize WHILE degraded. Wait for the drawing buffer to actually
  // move rather than reading effective() in the same tick, which would
  // report the pre-resize state and manufacture a false step-3 failure.
  const beforeResizeDBW = steps[1].effective.drawingBufferWidth;
  await page.setViewportSize({ width: resizeWidth, height: resizeHeight });
  await page.waitForFunction(
    (prev) => window.__BIRB && window.__BIRB.effective().drawingBufferWidth !== prev,
    beforeResizeDBW,
    { timeout: 8000 },
  ).catch(() => { /* report whatever actually happened; assertA6 will call it out */ });
  await page.waitForTimeout(250);
  const t3 = await page.evaluate(() => window.__BIRB.stats().tier);
  await record('resizedWhileDegraded', t3);

  // Step 4 — restore. No resize.
  const t4 = await page.evaluate(() => window.__BIRB.pinTier(0));
  await page.waitForTimeout(200);
  await record('restored', t4);

  // dprCap derived from the live tier-0 reading rather than hard-coded: at
  // tier 0, getQualityPixelRatio returns min(devicePixelRatio, cap), and the
  // pinned CONTRACT §5.1 context always has devicePixelRatio(3) > cap(1.7),
  // so the observed ratio IS the cap. This still reads a live object, same
  // as every other effective() field — it does not recompute from intent.
  const dprCap = steps[0].effective.rendererPixelRatio;
  return { steps, context: { devicePixelRatio, dprCap } };
}

async function captureA7(page, { raysOn = false } = {}) {
  await page.evaluate(() => window.__BIRB.pinTier(0));
  if (raysOn) await putSunOnScreen(page);
  await page.evaluate((r) => window.__BIRB.setBloom({ rays: r }), raysOn ? 1 : 0);
  const frames = await sampleFramesWithSun(page, 3);
  const last = frames[frames.length - 1];
  const prev = frames[frames.length - 2];
  return {
    frameTotals: last.frameTotals,
    frameTotalsPrev: prev.frameTotals,
    raysStrength: raysOn ? 1 : 0,
    sunVisible: last.sunUv[2],
    bloomEnabled: true,
  };
}

async function captureA8(page, tier = 1) {
  await page.evaluate((t) => window.__BIRB.pinTier(t), tier);
  const frames = await sampleFrames(page, 2);
  return { frameTotals: frames[frames.length - 1] };
}

async function captureA9(page) {
  await page.evaluate(() => window.__BIRB.pinTier(0));
  const sunVisible = await putSunOnScreen(page);
  await page.evaluate(() => window.__BIRB.setBloom({ rays: 1 }));
  const beforeFrames = await sampleFrames(page, 2);
  const before = {
    passes: beforeFrames[beforeFrames.length - 1].passes,
    tier: beforeFrames[beforeFrames.length - 1].tier,
  };
  // The toggle and the post-toggle sampling happen in ONE evaluate call, on
  // purpose: faceSun() does not latch and the flight system keeps rewriting
  // the quaternion every simulated frame, so a Playwright round-trip between
  // "toggle" and "sample" is exactly the gap that let the sun drift off
  // screen in three earlier attempts (CLAUDE.md's own recorded trap).
  const samplesAfter = await page.evaluate(() => new Promise((resolve) => {
    window.__BIRB.setBloom({ rays: 0 });
    const out = [];
    function tick() {
      out.push({ passes: window.__BIRB.frameTotals().passes });
      if (out.length >= 4) resolve(out);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }));
  return { before, samplesAfter, sunVisible };
}

const LIVE_CAPTURES = Object.freeze({
  A4: captureA4,
  A6: captureResizeRestore,
  A7: captureA7,
  A8: captureA8,
  A9: captureA9,
});

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function printVerdict(result) {
  console.log(`${result.id} state=${result.state}`);
  console.log(`  ${result.message}`);
  if (result.state === 'unavailable') console.log(`  reason=${result.reason}`);
}

function printA6(result) {
  console.log(`A6 state=${result.state}`);
  if (Array.isArray(result.steps)) {
    for (const s of result.steps) {
      const ratio = s.requestedPixelRatio ?? '?';
      console.log(
        `   ${s.step.padEnd(22)} ratio=${ratio}  coherent=${s.coherent}  mismatches=${s.mismatches.length}` +
        (s.mismatches.length ? ` [${s.mismatches.join(', ')}]` : ''),
      );
    }
    console.log(`   restoredCoherent: ${result.restoredCoherent}`);
  } else {
    console.log(`  ${result.message}`);
  }
}

function printCoverageLine(detected = null) {
  const existing = existingFutureFiles();
  const { catalogued, applicable } = mutationCoverage(existing);
  if (detected === null) {
    console.log(`mutations: ${catalogued} catalogued, ${applicable} applicable  (flip-testing runs under --selftest)`);
  } else {
    console.log(`mutations: ${catalogued} catalogued, ${applicable} applicable, ${detected} detected`);
  }
}

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------

async function runOneCheck(page, id, args) {
  const gap = checkStaticAvailability(id);
  if (!gap.available) {
    const result = ASSERTIONS[id].run(bestKnownPartial(id));
    printVerdict(result);
    console.log(`  requires: ${gap.requires.join(', ')} (not yet on disk — skipped, not scored)`);
    return result;
  }
  // G1/F2. checkStaticAvailability() flips an assertion to available on mere
  // file existence, while LIVE_CAPTURES covers only a subset. Reaching this
  // point with no capturer used to throw "LIVE_CAPTURES[id] is not a function",
  // which took the whole `--check all` board down with a stack trace instead of
  // a finding. Fail on the assertion, name the gap, and let the rest run.
  if (id !== 'A7' && typeof LIVE_CAPTURES[id] !== 'function') {
    const result = {
      id,
      state: 'fail',
      message:
        `${id} reports available (${(gap.requires || []).join(', ') || 'no gating file'} on disk) but this ` +
        'harness has no live capturer for it. The Wave 2 task that created that file must ship its ' +
        'capturer in the same change — see docs/perf/gates/G1.md F2.',
    };
    printVerdict(result);
    return result;
  }
  let snapshot;
  if (id === 'A7') snapshot = await captureA7(page, { raysOn: String(args.rays || '').toLowerCase() === 'on' });
  else snapshot = await LIVE_CAPTURES[id](page);
  const result = ASSERTIONS[id].run(snapshot);
  if (id === 'A6') {
    printA6(result);
    const diff = matchesExpectedRed(result);
    console.log(`   matchesExpectedRed: ${diff.matches} ${JSON.stringify(diff.differences)}`);
  } else {
    printVerdict(result);
  }
  return result;
}

async function doCheck(args) {
  const raw = args.check === true ? 'all' : String(args.check);
  const ids = raw.toLowerCase() === 'all' ? [...ASSERTION_IDS] : [resolveCheckId(raw)];
  if (ids.includes(null)) {
    console.error(`unknown check id/alias: "${raw}"`);
    console.error(`known ids: ${ASSERTION_IDS.join(', ')}`);
    console.error(`known aliases: ${Object.keys(CHECK_ALIASES).join(', ')}`);
    return 2;
  }

  const dir = artefactsDirFrom(args);
  const session = await boot();
  try {
    const dprOk = await selfCheckDpr(session.page);
    if (!dprOk) {
      await saveArtefacts(session.page, dir, 'sc-dpr-failed');
      return 1; // exit 1, not a skip — CONTRACT §5.2 is explicit about this
    }

    const results = [];
    for (const id of ids) {
      console.log(`\n--- ${id} (${ASSERTIONS[id].title}) ---`);
      results.push(await runOneCheck(session.page, id, args));
    }
    printCoverageLine();

    let code = exitCodeFor(results);
    if (session.pageErrors.length || session.consoleErrors.length) {
      console.error('PAGE ERRORS:\n  ' + session.pageErrors.join('\n  '));
      console.error('CONSOLE ERRORS:\n  ' + session.consoleErrors.join('\n  '));
      code = 1;
    }
    if (code !== 0) await saveArtefacts(session.page, dir, `check-${raw.replace(/[^a-z0-9-]/gi, '_')}`);
    return code;
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// --selftest — R8's proof. Two mutation classes need no browser at all
// (pure data over transcribed MEASURED fixtures); two need the live page
// specifically to exercise the harness's own read path.
// ---------------------------------------------------------------------------

function measuredEffective(rpr, dbw, dbh, sw, sh, bw, bh, wpr, rspr) {
  return {
    rendererPixelRatio: rpr,
    drawingBufferWidth: dbw,
    drawingBufferHeight: dbh,
    bloom: {
      sceneTarget: { width: sw, height: sh },
      blurA: { width: bw, height: bh },
      blurB: { width: bw, height: bh },
      rayTarget: { width: bw, height: bh },
      downscale: 2,
    },
    weatherPixelRatio: wpr,
    resizeStatePixelRatio: rspr,
    statsPath: rpr >= 1.7 ? 'bloom-frameStats' : 'renderer-info',
  };
}

/**
 * The POST-FIX shape, transcribed from EXPECTED-RED.md §4 ("after the Wave 2
 * sizing fix lands"). A6 is EXPECTED to fail on HEAD (that is the whole
 * point of this wave), so it cannot supply its own green baseline the way
 * A4/A7/A8/A9 can — the flip test needs a green fixture to mutate away from,
 * and this is the only honest source for one before the fix actually ships.
 */
function fixedResizeRestoreFixture() {
  return {
    context: { devicePixelRatio: 3, dprCap: 1.7 },
    steps: [
      { id: 'tier0', requestedTier: 0, cssWidth: 390, cssHeight: 844, effective: measuredEffective(1.7, 663, 1434, 663, 1434, 331, 717, 1.7, 1.7) },
      { id: 'degraded', requestedTier: 2, cssWidth: 390, cssHeight: 844, effective: measuredEffective(0.85, 331, 717, 331, 717, 165, 358, 0.85, 0.85) },
      { id: 'resizedWhileDegraded', requestedTier: 2, cssWidth: 360, cssHeight: 780, effective: measuredEffective(0.85, 306, 663, 306, 663, 153, 331, 0.85, 0.85) },
      { id: 'restored', requestedTier: 0, cssWidth: 360, cssHeight: 780, effective: measuredEffective(1.7, 612, 1326, 612, 1326, 306, 663, 1.7, 1.7) },
    ],
  };
}

/**
 * MEASURED constants (A4/A6/A7/A8/A9), transcribed from ASSERTIONS.md §2 /
 * EXPECTED-RED.md, PLUS synthetic fixtures for the six assertions whose real
 * surface (panel, gesture, DPR slider, weather-density control, quality())
 * does not exist yet. The synthetic ones prove nothing about the product —
 * there is no product there — but they are what a comparator flip test needs
 * to run at all, and QA-FLIP in tests/quality-assertions.test.js uses exactly
 * this shape for exactly this reason. Marked SYNTHETIC, never MEASURED.
 */
function staticGreenFixtures() {
  return {
    A4: { effective: measuredEffective(1.7, 663, 1434, 663, 1434, 331, 717, 1.7, 1.7) },
    A6: fixedResizeRestoreFixture(),
    A7: {
      frameTotals: { calls: 74, passes: 5, scene: { calls: 70 }, tier: 0 },
      frameTotalsPrev: { calls: 74, passes: 5, scene: { calls: 70 }, tier: 0 },
      raysStrength: 0, sunVisible: 0, bloomEnabled: true,
    },
    A8: { frameTotals: { calls: 87, passes: 1, scene: { calls: 87 }, tier: 1 } },
    A9: {
      before: { passes: 8, tier: 0 },
      samplesAfter: [{ passes: 6 }, { passes: 5 }, { passes: 5 }, { passes: 5 }],
    },
    // SYNTHETIC — the surfaces below do not exist until Wave 2.
    // A1 green: a production-path load (no ?debug) where the three-finger
    // hold-and-release DID open the panel. Added for G1/F3 so A1 has a
    // runnable flip rather than a hand-driven one.
    A1: {
      debugParamPresent: false,
      panel: { present: true, openedAfterGesture: true },
      gesture: { performed: 'three-finger-hold-release' },
    },
    A2: {
      panel: { present: true, openedAfterGesture: false },
      gesture: { performed: 'two-finger-hold' },
      sprintActive: true,
    },
    A3: {
      selfCheckDprPassed: true, requestedDpr: 1.2,
      before: { effective: measuredEffective(1.7, 663, 1434, 663, 1434, 331, 717, 1.7, 1.7) },
      after: { effective: measuredEffective(1.2, 468, 1012, 468, 1012, 234, 506, 1.2, 1.2) },
    },
    A5: {
      densityOne: { tier: 0, weather: { visible: true }, frameTotals: { scene: { calls: 70 } } },
      densityZero: { tier: 0, weather: { visible: false }, frameTotals: { scene: { calls: 69 } } },
    },
    A10: {
      request: { dpr: 1.2 },
      atN: { tier: 1, rendererPixelRatio: 1.2, weatherPixelRatio: 1.2, windValue: 1, weatherVisible: true },
      atN2: { tier: 1, rendererPixelRatio: 1.2, weatherPixelRatio: 1.2, windValue: 1, weatherVisible: true },
    },
    A11: {
      sentinelFields: ['cooldown', 'lastAdjustment.reason', 'activeMode'],
      quality: {
        cooldown: { value: null, state: 'unavailable', reason: 'not-implemented' },
        lastAdjustment: { reason: { value: null, state: 'unavailable', reason: 'not-implemented' } },
        activeMode: { value: null, state: 'unavailable', reason: 'not-implemented' },
      },
    },
    A12: {
      panelShowsStaleWarning: false,
      quality: { build: { requested: 'v42-2026-09-08-ground-and-ribbons', serving: 'v42-2026-09-08-ground-and-ribbons', stale: false } },
    },
  };
}

/**
 * The two page-hook mutations, each verified against the LIVE page rather
 * than a generic "did the overall state flip" comparison. A6 specifically
 * cannot use a generic comparison: its overall verdict is already `fail` on
 * HEAD (the restore-step desync), so "state stays fail after the mutation"
 * would trivially look like a detection even if the pageScript did nothing.
 * The real, non-trivial proof — matching the precedent already captured in
 * EXPECTED-RED.md §3 — is that the previously-COHERENT tier0 step becomes
 * incoherent, with the specific mismatched field the hook injected.
 */
const PAGE_HOOK_VERIFIERS = {
  // Manages its own single boot: A4's capture never touches the viewport, so
  // reusing one page for before/after is safe.
  'M-A4-blurA-odd': async (mutation) => {
    const session = await boot();
    try {
      const dprOk = await selfCheckDpr(session.page);
      if (!dprOk) return { ok: false, note: 'SC-DPR failed on this boot' };
      const before = ASSERTIONS.A4.run(await captureA4(session.page));
      if (before.state !== 'pass') return { ok: false, note: `A4 baseline was not green (${before.state})` };
      await session.page.evaluate(mutation.pageScript);
      const after = ASSERTIONS.A4.run(await captureA4(session.page));
      return { ok: after.state === mutation.detects, note: `A4 after hook: ${after.state}` };
    } finally {
      await session.close();
    }
  },
  // TWO FRESH boots, not one page reused. captureResizeRestore is stateful
  // about the CURRENT viewport size (step 3 resizes it), so running it twice
  // on the same page makes the second run's "resize" a no-op — the viewport
  // is already at the target size from the first run, no resize event fires,
  // and assertA6 correctly reports `invalid` for an unrelated reason ("no
  // resize happened while degraded"), which has no `.steps` in its result.
  // That is a harness bug, not evidence about the mutation — found by running
  // this exact verifier and getting `coherent=undefined`.
  'M-A6-desync-scene-target': async (mutation) => {
    const baseline = await boot();
    let before;
    try {
      const dprOk = await selfCheckDpr(baseline.page);
      if (!dprOk) return { ok: false, note: 'SC-DPR failed on the baseline boot' };
      before = ASSERTIONS.A6.run(await captureResizeRestore(baseline.page));
    } finally {
      await baseline.close();
    }
    const beforeTier0 = before.steps?.find((s) => s.step === 'tier0');
    if (!beforeTier0?.coherent) {
      return {
        ok: false,
        note: `tier0 step was not coherent before the mutation (state=${before.state}) — cannot prove a flip from it`,
      };
    }
    const mutatedSession = await boot();
    try {
      const dprOk = await selfCheckDpr(mutatedSession.page);
      if (!dprOk) return { ok: false, note: 'SC-DPR failed on the mutated boot' };
      await mutatedSession.page.evaluate(mutation.pageScript);
      const after = ASSERTIONS.A6.run(await captureResizeRestore(mutatedSession.page));
      const afterTier0 = after.steps?.find((s) => s.step === 'tier0');
      const ok = !!afterTier0 && afterTier0.coherent === false
        && afterTier0.mismatches.includes('bloom.sceneTarget.width');
      return {
        ok,
        note: `tier0 step after hook: coherent=${afterTier0?.coherent} mismatches=${JSON.stringify(afterTier0?.mismatches)}`,
      };
    } finally {
      await mutatedSession.close();
    }
  },
};

async function doSelftest(args) {
  const existing = existingFutureFiles();
  const { catalogued, applicable } = mutationCoverage(existing);
  const snapshotMutations = MUTATIONS.filter((m) => m.class === 'snapshot');
  const pageHookMutations = MUTATIONS.filter((m) => m.class === 'page-hook');
  const pageRealMutations = MUTATIONS.filter((m) => m.class === 'page-real');

  const fixtures = staticGreenFixtures();
  const failures = [];
  let detected = 0;

  console.log(`-- snapshot-class mutations (${snapshotMutations.length}, no browser needed) --`);
  for (const m of snapshotMutations) {
    const base = fixtures[m.targets];
    if (!base) { failures.push(`${m.id}: no fixture for ${m.targets}`); continue; }
    const before = ASSERTIONS[m.targets].run(base);
    if (before.state !== 'pass') {
      failures.push(`${m.id}: fixture for ${m.targets} was not green to begin with (${before.state})`);
      continue;
    }
    const mutated = m.apply(JSON.parse(JSON.stringify(base)));
    const after = ASSERTIONS[m.targets].run(mutated);
    if (after.state === m.detects) {
      detected++;
      console.log(`  OK   ${m.id} -> ${after.state}`);
    } else {
      failures.push(`${m.id} (${m.why}): expected "${m.detects}", got "${after.state}"`);
      console.log(`  FAIL ${m.id} -> ${after.state}, expected ${m.detects}`);
    }
  }

  console.log(`-- page-hook mutations (${pageHookMutations.length}, live page, own isolated boot(s) each) --`);
  for (const m of pageHookMutations) {
    const verifier = PAGE_HOOK_VERIFIERS[m.id];
    if (!verifier) { failures.push(`${m.id}: no page-hook verifier implemented in this harness`); continue; }
    const { ok, note } = await verifier(m);
    if (ok) { detected++; console.log(`  OK   ${m.id} -> ${note}`); }
    else { failures.push(`${m.id} (${m.why}): ${note}`); console.log(`  FAIL ${m.id} -> ${note}`); }
  }

  console.log(`-- page-real mutations (${pageRealMutations.length}, need Wave 2 files) --`);
  for (const m of pageRealMutations) {
    const reqOk = !m.requires || existing.includes(m.requires);
    if (!reqOk) {
      console.log(`  SKIP ${m.id} — inapplicable, requires ${m.requires}, not yet on disk`);
      continue;
    }
    // G1/F1. This branch used to print a sentence and move on, so the moment a
    // Wave 2 task created the file that makes a mutation applicable, --selftest
    // reported "24 catalogued, 24 applicable, 22 detected" and EXITED 0. The
    // only guard fired on `applicable < catalogued`, which is false at exactly
    // that moment. Both uncounted mutations were the production-path ones —
    // gesture-behind-debug and panel-opens-on-any-touch — so the check that
    // guards the ruling the whole workbench depends on was the check that went
    // quiet. That is this repo's "all 5 modes ok on a run exiting 1", inverted:
    // a summary that says covered when nothing ran. An applicable mutation with
    // no verifier is now a FAILURE, which is what line 56 always claimed.
    failures.push(
      `${m.id} (${m.why}): APPLICABLE (${m.requires} is on disk) but this harness has no live ` +
      `verifier for it. The task that created ${m.requires} must ship its verifier in the same change.`,
    );
    console.log(`  FAIL ${m.id} -> applicable, no live verifier`);
  }

  printCoverageLine(detected);
  if (failures.length) {
    console.error('SELFTEST FAILURES:\n  ' + failures.join('\n  '));
  }

  // G1/F2. checkStaticAvailability() flips an assertion to available on mere
  // file existence, but LIVE_CAPTURES covers A4/A6/A7/A8/A9 only — so once a
  // Wave 2 task landed a gating file, `--check all` died with
  // "LIVE_CAPTURES[id] is not a function" and the whole board went dark. It
  // failed loudly, so it could not launder a green, but a TypeError is not a
  // diagnosis. Name it here, while --selftest is the thing being read.
  for (const id of Object.keys(ASSERTIONS)) {
    if (!checkStaticAvailability(id).available) continue;
    if (typeof LIVE_CAPTURES[id] === 'function') continue;
    failures.push(
      `${id}: reported available (its gating file is on disk) but LIVE_CAPTURES has no capturer, ` +
      `so \`--check ${id}\` and \`--check all\` cannot run it. Ship the capturer with the file.`,
    );
  }

  let code = failures.length ? 1 : 0;
  const panelFilesExist = existing.length > 0;
  if (panelFilesExist && applicable < catalogued) {
    console.error(
      'SELFTEST FAILED: panel/gesture files exist on disk but mutationCoverage() still reports fewer ' +
      'applicable than catalogued mutations — tools/lib/quality-assertions.mjs was not updated to match.',
    );
    code = 1;
  }
  return code;
}

// ---------------------------------------------------------------------------
// --hooks-only
// ---------------------------------------------------------------------------

const REQUIRED_HOOKS_ON_HEAD = Object.freeze([
  'effective', 'frameTotals', 'stats', 'pinTier', 'setBloom',
  'setSunEnabled', 'setSunTime', 'faceSun', 'setEnvironment', 'forceNest',
]);
const FUTURE_HOOKS = Object.freeze(['quality']);

async function doHooksOnly(args) {
  const dir = artefactsDirFrom(args);
  const session = await boot();
  try {
    const present = await session.page.evaluate(
      (names) => names.map((n) => ({ name: n, ok: typeof window.__BIRB[n] === 'function' })),
      REQUIRED_HOOKS_ON_HEAD,
    );
    const future = await session.page.evaluate(
      (names) => names.map((n) => ({ name: n, ok: typeof window.__BIRB[n] === 'function' })),
      FUTURE_HOOKS,
    );
    console.log('required (availableOnHead) hooks:');
    for (const p of present) console.log(`  ${p.ok ? 'OK     ' : 'MISSING'} __BIRB.${p.name}`);
    console.log('future (Wave 2+) surfaces:');
    for (const f of future) console.log(`  ${f.ok ? 'present (ahead of schedule)' : 'absent (expected on HEAD)'.padEnd(28)} __BIRB.${f.name}`);
    printCoverageLine();

    const missing = present.filter((p) => !p.ok);
    let code = missing.length ? 1 : 0;
    if (session.pageErrors.length || session.consoleErrors.length) {
      console.error('PAGE ERRORS:\n  ' + session.pageErrors.join('\n  '));
      console.error('CONSOLE ERRORS:\n  ' + session.consoleErrors.join('\n  '));
      code = 1;
    }
    if (code !== 0) await saveArtefacts(session.page, dir, 'hooks-only');
    return code;
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// --emit-samples
// ---------------------------------------------------------------------------

async function doEmitSamples(args) {
  const dir = artefactsDirFrom(args);
  const session = await boot();
  try {
    const dprOk = await selfCheckDpr(session.page);
    if (!dprOk) { await saveArtefacts(session.page, dir, 'sc-dpr-failed'); return 1; }

    const samples = {};
    const results = [];
    for (const id of ASSERTION_IDS) {
      const gap = checkStaticAvailability(id);
      if (!gap.available) {
        samples[id] = { unavailable: true, requires: gap.requires };
        results.push(ASSERTIONS[id].run(bestKnownPartial(id)));
        continue;
      }
      const snapshot = await LIVE_CAPTURES[id](session.page);
      samples[id] = snapshot;
      results.push(ASSERTIONS[id].run(snapshot));
    }

    const outPath = path.resolve(REPO_ROOT, String(args.out || path.join('.quality-artefacts', 'samples.json')));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(samples, null, 2));
    console.log(`samples written: ${outPath}`);
    for (const r of results) console.log(`  ${r.id}: ${r.state}`);
    printCoverageLine();

    let code = exitCodeFor(results);
    if (session.pageErrors.length || session.consoleErrors.length) {
      console.error('PAGE ERRORS:\n  ' + session.pageErrors.join('\n  '));
      console.error('CONSOLE ERRORS:\n  ' + session.consoleErrors.join('\n  '));
      code = 1;
    }
    if (code !== 0) await saveArtefacts(session.page, dir, 'emit-samples');
    return code;
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// --capture-intervals — TEL-2 needs src/game/frame-metrics.js extended with a
// raw per-frame interval buffer (Wave 2 P2.1). It does not exist yet, so this
// is a static, no-browser skip rather than a browser boot that discovers the
// same absence the hard way.
// ---------------------------------------------------------------------------

function doCaptureIntervals() {
  let src = '';
  try { src = fs.readFileSync(path.join(REPO_ROOT, 'src/game/frame-metrics.js'), 'utf8'); } catch { /* absent entirely */ }
  const hasRawIntervals = /exportIntervals|rawIntervals|percentile/i.test(src);
  if (!hasRawIntervals) {
    console.log(
      'skip: --capture-intervals — src/game/frame-metrics.js has no raw per-frame interval export yet ' +
      '(TEL-2 needs Wave 2 P2.1). createFrameSampler() returns one averaged rate per 250ms window; ' +
      'percentiles over that are meaningless (CONTRACT §1.3), so there is nothing honest to capture.',
    );
  } else {
    console.log(
      'skip: --capture-intervals — a raw-interval export was detected in src/game/frame-metrics.js, but ' +
      'this harness has no live capture wired to it yet. Implement once P2.1 lands; do not report success ' +
      'for a source that exists but is not actually read.',
    );
  }
  printCoverageLine();
  return 2;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  let code;
  if (args.check !== undefined) code = await doCheck(args);
  else if (args.selftest) code = await doSelftest(args);
  else if (args['hooks-only']) code = await doHooksOnly(args);
  else if (args['emit-samples']) code = await doEmitSamples(args);
  else if (args['capture-intervals']) code = doCaptureIntervals();
  else {
    console.error('usage: birb-quality.mjs --check <id|alias|all> | --selftest | --hooks-only | --emit-samples | --capture-intervals');
    console.error(`known ids: ${ASSERTION_IDS.join(', ')}`);
    console.error(`known aliases: ${Object.keys(CHECK_ALIASES).join(', ')}`);
    code = 2;
  }
  process.exit(code);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
