#!/usr/bin/env node
/**
 * birb-lighting.mjs — palette comparison sheets.
 *
 * The visual brief rates "tune lighting and palette on physical phones" as the
 * highest remaining payoff, and says to do it with side-by-side FIXED views.
 * That is a decision the owner has to make on real glass, but making it is
 * much easier from a set of candidates than from a blank slider.
 *
 * This holds the camera and the world completely still — one browser, one
 * world build, one bird position — and varies ONLY the lighting between
 * frames. Anything else moving between two tiles would make the comparison
 * worthless, which is why it does not re-navigate or re-seed per variant.
 *
 * Usage:
 *   node tools/birb-lighting.mjs --out docs/visual-upgrade/lighting.png
 *   node tools/birb-lighting.mjs --out l.png --env canyons --view nest
 */

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Candidates, each a single coherent intent rather than one slider nudged.
 * `current` must stay first and must stay untouched — a comparison without
 * the status quo in it cannot tell you whether a change is an improvement.
 */
const VARIANTS = [
  { name: 'current', note: 'shipped today', settings: {} },
  { name: 'warmer sun', note: 'key +25%, ambient -15%', settings: { key: 1.56, ambient: 0.89 } },
  { name: 'deeper air', note: 'fog 0.006 to 0.0095', settings: { fog: 0.0095 } },
  { name: 'brighter', note: 'exposure 1.12 to 1.32', settings: { exposure: 1.32 } },
  { name: 'moodier', note: 'exposure 0.96, rim +50%', settings: { exposure: 0.96, rim: 0.72 } },
  { name: 'flat light', note: 'ambient +40%, key -30%', settings: { ambient: 1.47, key: 0.88 } },
];

async function main() {
    const args = parseArgs(process.argv);
    if (!args.out) {
        console.error('usage: birb-lighting.mjs --out <png> [--env forest] [--view flight|nest]');
        process.exit(2);
    }
    const env = String(args.env || 'forest');
    const view = String(args.view || 'flight');
    const width = Number(args.w || 390);
    const height = Number(args.h || 620);

    const tileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birb-light-'));
    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({
        ...devices['iPhone 13'],
        viewport: { width, height },
        deviceScaleFactor: 1,
        reducedMotion: 'no-preference',
    });
    await installCdnCache(context);

    const problems = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push('page: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

    await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil: 'domcontentloaded' });
    await startGame(page, 45000);
    // Full quality, or the comparison is between two degraded frames.
    await page.evaluate(() => window.__BIRB.pinTier(0));
    if (env !== 'forest') {
        const ok = await page.evaluate((id) => window.__BIRB.setEnvironment(id), env);
        if (!ok) { console.error(`unknown environment: ${env}`); process.exit(2); }
        await page.waitForTimeout(1200);
    }
    if (view === 'nest') {
        await page.evaluate(() => window.__BIRB.forceNest());
        await page.waitForFunction('window.__BIRB.stats().nesting === "nested"', null, { timeout: 20000 })
            .catch(() => problems.push('landing never completed'));
    }
    // Pin the viewpoint by SNAPSHOT, not by asking the bird to stop. Zeroing
    // speed does not hold — the flight system rewrites it every frame — and a
    // sheet whose tiles differ by viewpoint as well as by light is worse than
    // no sheet, because the difference it shows is not the one it claims.
    await page.evaluate(() => window.__BIRB.setSprint(false));
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__BIRB.capturePose());

    // Capture the baseline settings so each variant is applied to the same
    // starting point rather than accumulating onto the previous one.
    const baseline = await page.evaluate(() => window.__BIRB.setLighting({}));

    const tiles = [];
    for (const variant of VARIANTS) {
        await page.evaluate((b) => window.__BIRB.setLighting(b), baseline);
        await page.evaluate((s) => window.__BIRB.setLighting(s), variant.settings);
        // Put the bird back, then let the damped chase camera reconverge on
        // it, so every tile is shot from the same place.
        await page.evaluate(() => window.__BIRB.restorePose());
        await page.waitForTimeout(140);
        await page.evaluate(() => window.__BIRB.restorePose());
        await page.waitForTimeout(600);
        await page.evaluate(() => window.__BIRB.restorePose());
        await page.waitForTimeout(220);
        const file = path.join(tileDir, `${variant.name.replace(/\s+/g, '-')}.png`);
        await page.screenshot({ path: file });
        tiles.push({ ...variant, file });
        console.log(`  ${variant.name}: ${variant.note}`);
    }

    const cols = 3;
    const sheet = path.join(tileDir, 'sheet.html');
    fs.writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#12151b;font:13px/1.45 system-ui,sans-serif;color:#dfe6f0}
      h1{font-size:15px;margin:14px 12px 2px;font-weight:600}
      p{margin:0 12px 10px;color:#8b97a8}
      .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:0 12px 14px}
      figure{margin:0}
      img{width:100%;display:block;border-radius:6px;border:1px solid #2b3240}
      figcaption{padding:5px 2px 0}
      b{color:#9fd7ff}
      span{color:#8b97a8}
    </style>
    <h1>Lighting candidates — ${env}, ${view} view</h1>
    <p>Same world, same camera, same bird. Only the light differs. "current" is what ships today.</p>
    <div class="grid">${tiles.map((t) => `<figure>
      <img src="file://${t.file}">
      <figcaption><b>${t.name}</b><br><span>${t.note}</span></figcaption>
    </figure>`).join('')}</div>`);

    const sheetPage = await context.newPage();
    await sheetPage.setViewportSize({ width: cols * (width + 12) + 24, height: 200 });
    await sheetPage.goto('file://' + sheet, { waitUntil: 'load' });
    await sheetPage.waitForTimeout(400);
    const outPath = path.resolve(REPO_ROOT, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await sheetPage.screenshot({ path: outPath, fullPage: true });

    await browser.close();
    server.close();
    console.log(`lighting sheet: ${outPath}`);
    if (problems.length) console.error('PROBLEMS:\n  ' + problems.join('\n  '));
    process.exit(problems.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
