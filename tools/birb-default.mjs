/**
 * Is the PRODUCTION default what the owner asked for — Ultra, every lever at
 * its ceiling — and is a preset switch reversible?
 *
 * Boots with NO quality flag and no stored preference: the path a fresh
 * install takes. Every other browser harness in this repo now boots at
 * `?quality=amazing` (the baseline preset) because under SwiftShader an
 * Ultra frame is about 2.6 s against Amazing's 0.13 s, and a harness that
 * counts frames or samples windows cannot run at that rate. That leaves the
 * default itself unproven by anything, which is exactly the class of gap
 * that let the adaptive tier ship unreachable and the bloom pass ship
 * gated off on every iPhone. This is the one check that pays the 2.6 s.
 *
 * Reads EFFECTIVE values through `__BIRB.qualityPreset()` — the same
 * panelGetControlState the panel shows — never the preset table. A preset
 * that did not reach the renderer must fail here.
 *
 * Exits non-zero on any mismatch, any page error, or any console error OR
 * warning (a warning is how the environment-setup bug announced itself).
 *
 * Usage: node tools/birb-default.mjs
 */
import { chromium, devices } from 'playwright';
import {
  startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame,
} from './birb-shot.mjs';

// What Ultra must be — transcribed from the owner's own MAX REALISM button,
// which is what he pressed and said looked better. `anisotropy` is the
// device maximum, read from the page rather than assumed.
const ULTRA = {
  postQuality: 'full',
  shadowsEnabled: true,
  shadowType: 'vsm',
  shadowMapSize: 'high',
  antialiasing: '4x',
  terrainResolution: 'high',
  decorativeDensity: 1,
};
// The baseline every lever is measured against: what a player who never
// opened any panel saw before Ultra became the default.
const AMAZING = {
  postQuality: 'half',
  shadowsEnabled: false,
  shadowType: 'pcf',
  shadowMapSize: 'medium',
  antialiasing: 'off',
  terrainResolution: 'standard',
};
const SHIPPING_BLOOM_STRENGTH = 0.78;
const DEVICE_DPR = 3;

const failures = [];
function expect(cond, what) {
  if (!cond) failures.push(what);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
}

async function main() {
  const { server, port } = await startServer(process.cwd());
  const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 },
    deviceScaleFactor: DEVICE_DPR, isMobile: true, hasTouch: true,
  });
  await installCdnCache(context);
  const page = await context.newPage();
  const noise = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));

  // No quality flag, no stored preference: the production boot.
  await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil: 'domcontentloaded' });
  await startGame(page, 120000);
  const read = () => page.evaluate(() => window.__BIRB.qualityPreset());
  const apply = (id) => page.evaluate((i) => window.__BIRB.qualityPreset(i), id);
  const oneFrame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  console.log('boot (no flag, no preference):');
  const boot = await read();
  expect(boot.id === 'ultra', `preset is ultra (got ${boot.id})`);
  expect(boot.pinned === true && boot.tier === 0, `tier pinned at 0 (pinned ${boot.pinned}, tier ${boot.tier})`);
  expect(boot.pixelRatio === DEVICE_DPR, `native DPR ${DEVICE_DPR} (got ${boot.pixelRatio})`);
  for (const [k, v] of Object.entries(ULTRA)) {
    expect(boot.effective[k] === v, `${k} = ${JSON.stringify(v)} (got ${JSON.stringify(boot.effective[k])})`);
  }
  // The lever requests renderer.capabilities.getMaxAnisotropy() itself, so
  // "at the device max" is: requested is a real level, and effective (the
  // minimum over every texture, read back) equals it.
  expect(boot.requested.anisotropy >= 1 && boot.effective.anisotropy === boot.requested.anisotropy,
    `anisotropy at the device max (requested ${boot.requested.anisotropy}, effective ${boot.effective.anisotropy})`);
  expect(boot.shadowMapSize === 2048, `shadow map 2048 (got ${boot.shadowMapSize})`);
  expect(Math.abs(boot.bloomStrength - SHIPPING_BLOOM_STRENGTH) < 1e-6, `bloom strength ${SHIPPING_BLOOM_STRENGTH} (got ${boot.bloomStrength})`);
  // The tier still owns the pixel ratio (no dpr OVERRIDE): this is the
  // precondition the frozen A3 oracle's self-check needs on a fresh boot.
  expect(boot.requested.dpr === null, `no dpr override on the boot path (requested ${boot.requested.dpr})`);
  await page.evaluate(() => window.__BIRB.pinTier(1));
  await page.waitForTimeout(150);
  const atTier1 = await page.evaluate(() => window.__BIRB.effective().rendererPixelRatio);
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await page.waitForTimeout(150);
  const atTier0 = await page.evaluate(() => window.__BIRB.effective().rendererPixelRatio);
  expect(atTier1 !== atTier0, `pinning the tier still moves the drawing buffer (tier1 ${atTier1} / tier0 ${atTier0})`);
  const t0 = Date.now();
  await oneFrame();
  console.log(`  (one Ultra frame rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  console.log('switch -> amazing:');
  const amazing = await apply('amazing');
  expect(amazing.id === 'amazing', 'preset is amazing');
  expect(amazing.pinned === false, `tier handed back to the controller (pinned ${amazing.pinned})`);
  for (const [k, v] of Object.entries(AMAZING)) {
    expect(amazing.effective[k] === v, `${k} = ${JSON.stringify(v)} (got ${JSON.stringify(amazing.effective[k])})`);
  }
  expect(Math.abs(amazing.bloomStrength - SHIPPING_BLOOM_STRENGTH) < 1e-6, `bloom strength back at ${SHIPPING_BLOOM_STRENGTH} (got ${amazing.bloomStrength})`);
  expect(amazing.shadowMapType === 1, `shadowMap.type back at PCFShadowMap=1 (got ${amazing.shadowMapType})`);
  expect(amazing.groundResolution === 'standard', `ground mesh back at standard (got ${amazing.groundResolution})`);
  // targetRate and surfaceDetail are DISABLED controls (DEF-3 / DEF-4) whose
  // "requested" is a constant, not a panel override; everything else must be null.
  const overrides = Object.entries(amazing.requested)
    .filter(([k, v]) => !['targetRate', 'surfaceDetail'].includes(k) && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  expect(overrides.length === 0, `every override cleared (left: ${overrides.join(', ') || 'none'})`);

  console.log('switch -> ultra again:');
  const again = await apply('ultra');
  const drift = [];
  for (const k of Object.keys(boot.effective)) {
    if (JSON.stringify(again.effective[k]) !== JSON.stringify(boot.effective[k])) drift.push(`${k}: ${JSON.stringify(boot.effective[k])} -> ${JSON.stringify(again.effective[k])}`);
  }
  for (const k of ['pixelRatio', 'shadowMapType', 'shadowMapSize', 'bloomStrength', 'groundResolution', 'tier', 'pinned']) {
    if (JSON.stringify(again[k]) !== JSON.stringify(boot[k])) drift.push(`${k}: ${JSON.stringify(boot[k])} -> ${JSON.stringify(again[k])}`);
  }
  expect(drift.length === 0, `ultra -> amazing -> ultra equals boot (${drift.join('; ') || 'every field'})`);

  // `?quality=` is a boot override that is NOT remembered. The Ultra page is
  // closed first: left running, its 2.6 s SwiftShader frames starve the
  // second page's boot and Tap-to-Start times out (measured — the first run
  // of this gate did exactly that).
  await page.close();
  console.log('boot ?quality=amazing:');
  const page2 = await context.newPage();
  page2.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') noise.push(`[flag] ${m.type()}: ${m.text().slice(0, 300)}`); });
  page2.on('pageerror', (e) => noise.push(`[flag] pageerror: ${e.message}`));
  await page2.goto(`http://127.0.0.1:${port}/index.html?debug=1&quality=amazing`, { waitUntil: 'domcontentloaded' });
  await startGame(page2, 120000);
  const flagged = await page2.evaluate(() => window.__BIRB.qualityPreset());
  expect(flagged.id === 'amazing', `?quality=amazing boots amazing (got ${flagged.id})`);
  const stored = await page2.evaluate(() => { try { return localStorage.getItem('birbQuality2'); } catch (_) { return 'unreadable'; } });
  expect(stored === null, `the flag is not remembered as a preference (stored ${JSON.stringify(stored)})`);

  await browser.close();
  server.close();

  if (noise.length) {
    failures.push(`console noise (${noise.length})`);
    console.error('CONSOLE:\n  ' + noise.slice(0, 12).join('\n  '));
  }
  if (failures.length) {
    console.error(`FAILED: ${failures.length} check(s):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('production default is Ultra at its ceiling, and reversible');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
