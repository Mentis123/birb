/**
 * tools/birb-auto-quality.mjs — the Auto graphics chip, on the real page.
 *
 * Asserts behaviour, not paint:
 *   1. A fresh boot (no flag, no preference) is Auto, on Ultra, chip hidden.
 *   2. Under SwiftShader (single-digit fps) an Auto boot on Amazing raises the
 *      chip by itself — no forcing — and it offers the next preset down.
 *   3. Tapping the chip steps down ONE preset, stays on Auto, remembers the
 *      new level, and hides the chip.
 *   4. A forced yellow and red each render with the right class and text
 *      (captured to --out-dir for an eye).
 *   5. A manual preset turns Auto off and the chip with it; at Light there is
 *      nothing left to offer, so no chip.
 *   6. No console warning or error anywhere.
 *
 * Booted at Amazing rather than Ultra for the natural-trigger step because an
 * Ultra frame under SwiftShader is ~2.6 s (G-ULTRA-DEFAULT).
 *
 * Usage: node tools/birb-auto-quality.mjs [--out-dir dir]
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
  startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame,
} from './birb-shot.mjs';

const outIdx = process.argv.indexOf('--out-dir');
const OUT_DIR = outIdx > 0 ? process.argv[outIdx + 1] : null;

const failures = [];
function expect(cond, what) {
  if (!cond) failures.push(what);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
}

async function newPage(browser, { storage = null } = {}) {
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  await installCdnCache(context);
  if (storage) {
    await context.addInitScript((entries) => {
      for (const [k, v] of entries) window.localStorage.setItem(k, v);
    }, Object.entries(storage));
  }
  const page = await context.newPage();
  const noise = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));
  return { context, page, noise };
}

async function shot(page, name) {
  if (!OUT_DIR) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, name) });
}

async function main() {
  const { server, port } = await startServer(process.cwd());
  const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
  const base = `http://127.0.0.1:${port}/index.html?debug=1`;
  try {
    console.log('fresh boot (no flag, no preference):');
    {
      const { context, page, noise } = await newPage(browser);
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await startGame(page, 120000);
      const q = await page.evaluate(() => window.__BIRB.qualityPreset());
      expect(q.id === 'ultra' && q.auto === true, `Auto on Ultra (got ${q.id}, auto ${q.auto})`);
      expect(q.pinned === true && q.tier === 0, `Ultra's pin is unchanged (pinned ${q.pinned}, tier ${q.tier})`);
      const label = await page.textContent('[data-quality-label]');
      expect(label.trim() === 'Auto · Ultra', `gear label reads "Auto · Ultra" (got "${label.trim()}")`);
      expect(noise.length === 0, `no console noise (${noise.join(' | ') || 'none'})`);
      await context.close();
    }

    console.log('Auto on Amazing under SwiftShader:');
    const { context, page, noise } = await newPage(browser, {
      storage: { birbQuality2: 'auto', birbQualityAutoLevel: 'amazing' },
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await startGame(page, 120000);
    const boot = await page.evaluate(() => window.__BIRB.qualityPreset());
    expect(boot.id === 'amazing' && boot.auto === true, `remembered Auto level (got ${boot.id}, auto ${boot.auto})`);

    // The chip must raise ITSELF from real samples: grace 4 s + hold 3 s.
    const t0 = Date.now();
    let adv = null;
    while (Date.now() - t0 < 60000) {
      adv = await page.evaluate(() => window.__BIRB.perfAdvisor());
      if (adv.chipVisible) break;
      await page.waitForTimeout(500);
    }
    expect(adv.chipVisible === true, `chip appeared on its own in ${((Date.now() - t0) / 1000).toFixed(1)} s (level ${adv.level}, avg ${adv.avgFps} fps)`);
    expect(adv.forced === null, 'not forced');
    const action = (await page.textContent('[data-perf-chip-action]')).trim();
    expect(action === 'Tap for Okay', `offers the next preset down (got "${action}")`);
    await shot(page, 'auto-chip-natural.png');

    console.log('tap the chip:');
    await page.tap('[data-perf-chip]');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      q: window.__BIRB.qualityPreset(),
      a: window.__BIRB.perfAdvisor(),
      saved: [window.localStorage.getItem('birbQuality2'), window.localStorage.getItem('birbQualityAutoLevel')],
    }));
    expect(after.q.id === 'okay' && after.q.auto === true, `stepped ONE preset down and stayed Auto (got ${after.q.id}, auto ${after.q.auto})`);
    expect(after.a.level === 'ok' && after.a.chipVisible === false, `chip cleared (level ${after.a.level}, visible ${after.a.chipVisible})`);
    expect(after.saved[0] === 'auto' && after.saved[1] === 'okay', `remembered (${after.saved.join(', ')})`);
    const label = (await page.textContent('[data-quality-label]')).trim();
    expect(label === 'Auto · Okay', `gear label follows (got "${label}")`);

    console.log('forced yellow and red:');
    const warn = await page.evaluate(() => window.__BIRB.perfAdvisor('warn'));
    await page.waitForTimeout(1500); // past the fade-in, at a few fps
    const warnCls = await page.getAttribute('[data-perf-chip]', 'class');
    expect(warn.chipVisible && !/perf-chip--bad/.test(warnCls), `yellow chip (class "${warnCls}")`);
    await shot(page, 'auto-chip-yellow.png');
    const bad = await page.evaluate(() => window.__BIRB.perfAdvisor('bad'));
    const badCls = await page.getAttribute('[data-perf-chip]', 'class');
    await page.waitForTimeout(1500);
    const badTitle = (await page.textContent('[data-perf-chip-title]')).trim();
    expect(bad.chipVisible && /perf-chip--bad/.test(badCls), `red chip (class "${badCls}")`);
    expect(badTitle === 'Frame rate struggling', `red title (got "${badTitle}")`);
    expect((await page.textContent('[data-perf-chip-action]')).trim() === 'Tap for Light', 'red offers Light from Okay');
    await shot(page, 'auto-chip-red.png');

    console.log('Light has nothing left to offer:');
    await page.tap('[data-perf-chip]');
    await page.waitForTimeout(200);
    const light = await page.evaluate(() => ({ q: window.__BIRB.qualityPreset(), a: window.__BIRB.perfAdvisor('bad') }));
    expect(light.q.id === 'light' && light.q.auto === true, `stepped to Light on Auto (got ${light.q.id})`);
    expect(light.a.chipVisible === false, 'no chip at Light even when red');

    console.log('a manual preset turns Auto off:');
    const manual = await page.evaluate(() => {
      window.__BIRB.perfAdvisor(null);
      window.__BIRB.qualityPreset('amazing');
      return { q: window.__BIRB.qualityPreset(), a: window.__BIRB.perfAdvisor('bad') };
    });
    expect(manual.q.auto === false, 'Auto off after a manual pick');
    expect(manual.a.chipVisible === false, 'no chip without Auto, even forced red');
    await page.evaluate(() => window.__BIRB.perfAdvisor(null));

    expect(noise.length === 0, `no console noise (${noise.join(' | ') || 'none'})`);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nauto quality: all checks ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
