#!/usr/bin/env node
/**
 * birb-sheet.mjs — the contact sheet.
 *
 * Building this should have been the first thing done on the visual pass, not
 * the last. Ninety renders can be judged against a MEMORY of the previous
 * render and every one of those judgements is worthless; a sheet puts the
 * views side by side and the regressions become obvious in seconds.
 *
 * It boots ONE browser, walks all four biomes in both flight and perch views,
 * captures the real root game (bird, HUD and all), then composites the frames
 * into a single labelled PNG. That composite is what gets compared before and
 * after a change, and what the owner opens on a phone.
 *
 * Usage:
 *   node tools/birb-sheet.mjs --out docs/visual-upgrade/before.png
 *   node tools/birb-sheet.mjs --out after.png --views flight     (skip perches)
 *   node tools/birb-sheet.mjs --out after.png --desktop
 */

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The canyon variant's id is 'canyons', plural. Getting it wrong makes
// setEnvironment a silent no-op and the sheet quietly renders forest twice.
const BIOMES = ['forest', 'canyons', 'mountain', 'city'];

async function main() {
    const args = parseArgs(process.argv);
    if (!args.out) {
        console.error('usage: birb-sheet.mjs --out <png> [--views flight,nest] [--desktop]');
        process.exit(2);
    }
    const desktop = Boolean(args.desktop);
    const width = Number(args.w || (desktop ? 900 : 390));
    const height = Number(args.h || (desktop ? 600 : 844));
    // The tiles are captured at 1x: a sheet is for comparing composition and
    // colour across many views, and a 3x sheet of eight phone frames is a
    // 30-megapixel image nothing can open comfortably.
    const dpr = Number(args.dpr || 1);
    const views = String(args.views || 'flight,nest').split(',').map((v) => v.trim()).filter(Boolean);
    const settle = Number(args.settle || 1400);

    const tileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birb-sheet-'));
    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({
        ...(desktop ? {} : devices['iPhone 13']),
        viewport: { width, height },
        deviceScaleFactor: dpr,
        hasTouch: !desktop,
        isMobile: !desktop,
        reducedMotion: 'no-preference',
    });
    await installCdnCache(context);

    const problems = [];
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', (e) => problems.push('page: ' + String((e && e.message) || e)));

    await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil: 'domcontentloaded' });
    await startGame(page, 45000);
    // Pin full quality unless asked otherwise. Software rendering here runs at
    // a few frames per second, so the (correctly working) adaptive tier drops
    // to its lowest setting within seconds and the sheet would show degraded
    // output that no target device produces. Pass --tier N to capture a
    // specific quality tier deliberately.
    const pinned = args.tier === undefined ? 0 : Number(args.tier);
    if (pinned >= 0) await page.evaluate((t) => window.__BIRB.pinTier(t), pinned);

    const tiles = [];
    for (const biome of BIOMES) {
        const switched = await page.evaluate((id) => window.__BIRB.setEnvironment(id), biome);
        if (!switched) { problems.push(`unknown environment id: ${biome}`); continue; }
        await page.waitForTimeout(1100);
        for (const view of views) {
            if (view === 'nest') {
                const landed = await page.evaluate(() => window.__BIRB.forceNest(0));
                if (!landed) { problems.push(`${biome}: no landable nest`); continue; }
                // The landing auto-flies in a straight line at 16 units per
                // second and the nearest nest can still be most of a 754-unit
                // circumference away, so this needs real headroom.
                await page.waitForFunction('window.__BIRB.stats().nesting === "nested"', null, { timeout: 90000 })
                    .catch(() => problems.push(`${biome}: landing never reached NESTED`));
            }
            await page.waitForTimeout(settle);
            const stats = await page.evaluate(() => window.__BIRB.stats());
            const file = path.join(tileDir, `${biome}-${view}.png`);
            await page.screenshot({ path: file });
            tiles.push({ file, label: `${biome} · ${view}`, stats });
            console.log(`  ${biome} ${view}: ${stats.calls} calls, ${stats.triangles} tris`);
            if (view === 'nest') {
                // Return to flight so the next biome starts from the air; a
                // world rebuilt underneath a perched bird is not a clean view.
                await page.evaluate(() => window.__BIRB.takeOff && window.__BIRB.takeOff());
                await page.waitForTimeout(600);
            }
        }
    }

    // Composite by rendering the tiles into a grid page and shooting that. No
    // image library needed, and the labels come out as real text.
    const cols = Math.min(4, tiles.length);
    const sheet = path.join(tileDir, 'sheet.html');
    fs.writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#12151b;font:13px/1.4 system-ui,sans-serif;color:#dfe6f0}
      .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:12px}
      figure{margin:0}
      img{width:100%;display:block;border-radius:6px;border:1px solid #2b3240}
      figcaption{padding:5px 2px 0;font-variant-numeric:tabular-nums}
      b{color:#9fd7ff;font-weight:600}
      span{color:#8b97a8}
    </style><div class="grid">${tiles.map((t) => `<figure>
      <img src="file://${t.file}">
      <figcaption><b>${t.label}</b><br><span>${t.stats.calls} calls · ${(t.stats.triangles / 1000).toFixed(1)}k tris · tier ${t.stats.tier}</span></figcaption>
    </figure>`).join('')}</div>`);

    const sheetPage = await context.newPage();
    await sheetPage.setViewportSize({ width: cols * (width + 12) + 12, height: 100 });
    await sheetPage.goto('file://' + sheet, { waitUntil: 'load' });
    await sheetPage.waitForTimeout(400);
    const outPath = path.resolve(REPO_ROOT, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await sheetPage.screenshot({ path: outPath, fullPage: true });

    await browser.close();
    server.close();

    console.log(`sheet: ${outPath}  (${tiles.length} views)`);
    if (problems.length) console.error('PROBLEMS:\n  ' + problems.join('\n  '));
    process.exit(problems.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
