#!/usr/bin/env node
/**
 * birb-stunt.mjs — the stunt flight model, on the real page.
 *
 * The unit suite proves the control law; this proves the WIRING, which is a
 * different thing and is where every previous flight feature broke. A
 * controller can be perfect and still never reach the bird because the pad
 * was never attached, the cruise handover went to the wrong property, or the
 * camera hold landed on a rig that is parked. Each of those has happened in
 * this repo, and each looked exactly like "the feature does not work".
 *
 * IT BOOTS WITH NO FLIGHT FLAG. That is the point: it asserts that the
 * PRODUCTION DEFAULT is the stunt model. A harness that passes `?flight=stunt`
 * would still pass on a build whose default had silently reverted.
 *
 * FRAMES, NEVER MILLISECONDS. Under SwiftShader this page runs at a few
 * frames a second, and every rate in the controller advances per frame
 * against a delta clamped to 50 ms. A wall-clock wait measures the harness,
 * not the bird — which is exactly how "forest: landing never reached NESTED"
 * was mis-diagnosed as a collider bug when it was a clock.
 *
 *   node tools/birb-stunt.mjs
 *
 * Needs: npm install --no-save playwright https-proxy-agent
 *        git checkout -- node_modules/three/index.js
 */

import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
import {
  startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame,
} from './birb-shot.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
let checks = 0;
function check(ok, label) {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
}

/** Advance N RENDERED frames. The only unit of time this harness trusts. */
const frames = (page, n) => page.evaluate((count) => new Promise((resolve) => {
  let seen = 0;
  const step = () => { seen += 1; if (seen >= count) resolve(seen); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), n);

/** Hold the stick (and optionally the pad) for N frames, sampling the probe. */
async function hold(page, { x = 0, y = 0, rudder = 0, throttle = 1 }, n, sampleEvery = 1) {
  return page.evaluate(async ({ x, y, rudder, throttle, n, sampleEvery }) => {
    const B = window.__BIRB;
    B.setStick(x, y);
    B.setPad(rudder, throttle);
    const samples = [];
    for (let i = 0; i < n; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      if (i % sampleEvery === 0) samples.push(B.flightProbe());
    }
    return samples;
  }, { x, y, rudder, throttle, n, sampleEvery });
}

const release = (page) => page.evaluate(() => { window.__BIRB.setStick(0, 0); window.__BIRB.setPad(null); });

/**
 * The shipping pitch axis PULLS BACK for nose up (see `invertPitch`), so a
 * climb command is a NEGATIVE stick y. Read from the live probe rather than
 * assumed, so this harness follows the build instead of encoding one side of
 * the preference — and so flipping the default cannot silently turn the loop
 * check into a dive check that still passes.
 */
const pitchSign = (page) => page.evaluate(() => {
  const t = window.__BIRB.flightProbe()?.tuning;
  return t && t.invertPitch === false ? 1 : -1;
});

/**
 * Get well clear of the ground, level, at cruise.
 *
 * NOT optional, and the first run of this harness is why. The stunt model
 * SINKS whenever the wing is not carrying the bird — 8 units/s inverted — so
 * a roll test that starts at spawn height ends with the bird on the ground,
 * and every check after it measures a walking bird: the throttle check read
 * 2.1 (the walk speed) against a 2.1 cruise, the loop never happened because
 * a grounded bird's stick is zeroed, and the camera hold read weight 0
 * because it is released on the ground. One landing silently invalidated six
 * checks, and every one of them failed for a reason that had nothing to do
 * with what it was testing.
 */
async function reset(page, altitude = 220) {
  await release(page);
  await page.evaluate((alt) => { window.__BIRB.setAltitude(alt); }, altitude);
  await frames(page, 20);
}

async function main() {
  // Every boot helper is birb-shot.mjs's, so this harness starts the game the
  // same way every other one does — including the CDN cache, without which
  // the page cannot import three at all in a sandbox with no network.
  const { server, port } = await startServer(REPO_ROOT);
  const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  });
  await installCdnCache(context);

  const warnings = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => warnings.push('page: ' + String((e && e.message) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') warnings.push(`${m.type()}: ${m.text().slice(0, 200)}`);
  });

  try {
    // `quality=amazing`: the baseline preset — at the Ultra default a
    // SwiftShader frame is 2.6 s and this harness counts frames.
    // NO flight flag. That is the point: this asserts the PRODUCTION DEFAULT
    // is the stunt model. A harness passing `?flight=stunt` would still pass
    // on a build whose default had silently reverted.
    await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&quality=amazing`,
      { waitUntil: 'domcontentloaded' });
    await startGame(page, 60000);
    await frames(page, 20);
    await reset(page);

    // ---- 1. the default --------------------------------------------------
    const boot = await page.evaluate(() => window.__BIRB.flightProbe());
    check(boot.controller === 'stunt',
      `the production default is the stunt model (got ${boot.controller})`);
    check(boot.tuning && Number.isFinite(boot.tuning.rollMax),
      'and it reports its own tuning table');
    check(boot.maxPitchDeg > 170,
      `there is no pitch clamp (maxPitchDeg ${boot.maxPitchDeg})`);
    check(Number.isFinite(boot.lift) && Number.isFinite(boot.sink),
      'the wing model is live (lift and sink are numbers, not nulls)');

    // ---- 2. the pad is attached to the BOOST pill ------------------------
    const padWired = await page.evaluate(() => {
      const s = window.__BIRB.stuntState();
      return { has: !!s, pad: s?.pad };
    });
    check(padWired.has, 'the trick detector exists');
    check(padWired.pad && padWired.pad.throttle === 1 && padWired.pad.rudder === 0,
      'the pad rests at neutral throttle and no rudder');

    // A tap on the pill must still BOOST. This is the control the game
    // already had; if two axes on the pill cost a reliable tap, the pad is a
    // net loss however good the rudder is.
    const boosted = await page.evaluate(async () => {
      const pill = document.querySelector('[data-boost]');
      if (!pill) return 'no pill';
      const before = window.__BIRB.flightProbe().cruise;
      const box = pill.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: cx, clientY: cy };
      pill.dispatchEvent(new PointerEvent('pointerdown', opts));
      pill.dispatchEvent(new PointerEvent('pointerup', opts));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      return { before, after: window.__BIRB.flightProbe().cruise };
    });
    check(typeof boosted === 'object' && boosted.after > boosted.before,
      `a tap on the pill still boosts (cruise ${JSON.stringify(boosted)})`);
    await frames(page, 90); // let the boost expire before anything is measured

    // ---- 3. the stick ROLLS the flight frame -----------------------------
    await reset(page);
    const rollSamples = await hold(page, { x: 1 }, 24);
    const peakBank = Math.max(...rollSamples.map((s) => Math.abs(s.bankDeg)));
    check(peakBank > 60,
      `a held stick rolls the FLIGHT frame, not just the model (peak |bank| ${peakBank.toFixed(1)})`);
    const rightWingDown = rollSamples.some((s) => s.bankDeg < -20);
    check(rightWingDown, 'and a right stick puts the right wing down');

    // ---- 4. hands off, the wings level -----------------------------------
    await release(page);
    const levelled = await hold(page, {}, 150, 6);
    const endBank = Math.abs(levelled[levelled.length - 1].bankDeg);
    check(endBank < 30, `hands-off the wings come level (|bank| ${endBank.toFixed(1)})`);

    // ---- 5. the rudder reaches the bird ----------------------------------
    const rudderSamples = await hold(page, { rudder: 1 }, 24);
    const rudderSeen = rudderSamples.some((s) => Math.abs(s.rudder) > 0.5);
    check(rudderSeen, 'the pad rudder reaches the controller');
    await reset(page);

    // ---- 6. the throttle moves the energy target -------------------------
    const idleSamples = await hold(page, { throttle: 0.55 }, 90, 6);
    const slowest = Math.min(...idleSamples.map((s) => s.speed));
    const cruiseNow = idleSamples[idleSamples.length - 1].cruise;
    check(slowest < cruiseNow,
      `idle throttle slows the bird below cruise (${slowest.toFixed(1)} vs ${cruiseNow.toFixed(1)})`);
    // ---- 7. a loop, and the detector names it ----------------------------
    await reset(page);
    const up = await pitchSign(page);
    check(up === -1, `the shipping pitch axis pulls back for nose up (sign ${up})`);
    const loopSamples = await hold(page, { y: up }, 220, 4);
    const wentOver = loopSamples.some((s) => Math.abs(s.pitchFullDeg ?? s.pitchDeg) > 110)
      || loopSamples.some((s) => s.pitchDeg > 70);
    check(wentOver, 'a held pull takes the nose past the old 80-degree ceiling');
    const named = await page.evaluate(() => window.__BIRB.stuntState().lastFigure);
    check(named !== null, `the detector named a figure (${named})`);

    // ---- 8. the camera hold is on the LIVE rig ---------------------------
    await reset(page);
    // A hold that arrives at the parked follow rig is indistinguishable from
    // one that does not work, unless it is read back from the rig that
    // renders. That mistake cost a whole round once already.
    const holdState = await page.evaluate(() => window.__BIRB.cameraHold());
    check(holdState.live && holdState.live.weight > 0.5,
      `the chase hold is on the LIVE rig (${JSON.stringify(holdState.live)})`);

    // ---- 9. the model toggle is live -------------------------------------
    const toggled = await page.evaluate(async () => {
      const to = window.__BIRB.setFlightModel('classic');
      await new Promise((r) => requestAnimationFrame(r));
      const probe = window.__BIRB.flightProbe();
      window.__BIRB.setFlightModel('stunt');
      await new Promise((r) => requestAnimationFrame(r));
      return { to, controller: probe.controller, maxPitch: probe.maxPitchDeg, back: window.__BIRB.flightProbe().controller };
    });
    check(toggled.controller === 'classic', `the toggle switches live (got ${toggled.controller})`);
    check(toggled.maxPitch < 100, `and classic brings v1's pitch clamp back (${toggled.maxPitch})`);
    check(toggled.back === 'stunt', 'and switches back');

    // The gear menu has the control, with a label.
    const menu = await page.evaluate(() => {
      const b = document.querySelector('[data-control="flight-model"]');
      return b ? { present: true, disabled: b.disabled, label: b.querySelector('[data-flight-model-label]')?.textContent } : { present: false };
    });
    check(menu.present && !menu.disabled, 'the gear menu carries the flight-model toggle');
    check(menu.label === 'Stunt' || menu.label === 'Classic', `and it is labelled (${menu.label})`);

    // ---- 10. still flying, and quiet -------------------------------------
    await release(page);
    await frames(page, 20);
    const end = await page.evaluate(() => window.__BIRB.flightProbe());
    check(end.recovery === 'flying', `the bird is still flying at the end (${end.recovery})`);
    check(Number.isFinite(end.radius) && end.radius > 0, 'and its position is finite');
    check(warnings.length === 0, `no console warnings or errors (${warnings.slice(0, 3).join(' | ')})`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
