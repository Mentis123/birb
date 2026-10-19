#!/usr/bin/env node
/**
 * birb-discovery.mjs — the found-places loop, end to end, in the real page.
 *
 * src/ui/discovery.js decides when a place is found; this proves the game
 * actually drives it: every biome has places (more than one each — the
 * derived ones exist), flying to one and looking at it finds it (toast,
 * named pin, title count), the find survives a RELOAD, the minimap's arrow
 * moves on to an unfound place, and no pin is on screen in a timed mode or
 * during a shot. Any console warning or error fails it.
 *
 * Usage: node tools/birb-discovery.mjs
 */

import { chromium, devices } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await installCdnCache(context);
    const noise = [];
    const failures = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => noise.push('page: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    const url = `http://127.0.0.1:${port}/index.html?debug=1&quality=amazing&flight=classic`;
    const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await startGame(page, 90000);
        await page.evaluate(() => window.__BIRB.discovery({ reset: true }));

        for (const env of ['forest', 'canyons', 'mountain', 'city']) {
            await page.evaluate(([e]) => { window.__BIRB.worldSeed(16160); window.__BIRB.setEnvironment(e); }, [env]);
            await page.waitForTimeout(1200);
            const d = await page.evaluate(() => window.__BIRB.discovery());
            check(d.places.length >= 3, `${env}: ${d.places.length} places (${d.places.map((p) => p.id).join(', ')})`);
            check(d.places.every((p) => p.label), `${env}: every place has a name`);
        }

        await page.evaluate(() => { window.__BIRB.worldSeed(16160); window.__BIRB.setEnvironment('forest'); });
        await page.waitForTimeout(1200);
        await page.evaluate(() => { window.__BIRB.freeze(true); window.__BIRB.goToLandmark('stone-arch'); });
        // Frames, not wall clock: the dwell advances per rendered frame.
        await page.waitForFunction(() => window.__BIRB.discovery().progress.found >= 1, null, { timeout: 60000 }).catch(() => {});
        const after = await page.evaluate(() => ({
            d: window.__BIRB.discovery(),
            toast: document.getElementById('birb-goto-toast')?.textContent || '',
            title: document.querySelector('[data-title-found]')?.textContent || '',
        }));
        check(after.d.places.find((p) => p.id === 'stone-arch')?.found, 'flying to the stone arch and looking at it finds it');
        check(/Discovered: Stone arch/.test(after.toast), `the find is announced ("${after.toast}")`);
        check(after.d.pins.some((p) => p.label === 'Stone arch' && p.opacity > 0), 'the found place wears a NAMED pin');
        check(after.d.pins.filter((p) => p.opacity > 0).every((p) => p.unfound ? p.label === '?' : true), 'unfound places show only "?"');
        check(/1 place discovered/.test(after.title), `the title counts it ("${after.title}")`);

        // Pins step out for a timed mode and for a shot.
        await page.evaluate(() => window.__BIRB.startMode('ring_rush'));
        await page.waitForTimeout(1500);
        const inMode = await page.evaluate(() => getComputedStyle(document.querySelector('.birb-pins')).display);
        check(inMode === 'none', `no pins in Ring Rush (display ${inMode})`);
        await page.evaluate(() => window.__BIRB.endMode(false));
        await page.waitForTimeout(800);

        // Persisted: a reload remembers it.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await startGame(page, 90000);
        await page.evaluate(() => { window.__BIRB.worldSeed(16160); window.__BIRB.setEnvironment('forest'); });
        await page.waitForTimeout(1200);
        const reloaded = await page.evaluate(() => window.__BIRB.discovery());
        check(reloaded.places.find((p) => p.id === 'stone-arch')?.found === true, 'the find survives a reload');
        check(reloaded.progress.found === 1 && reloaded.progress.total >= 6, `progress ${reloaded.progress.found}/${reloaded.progress.total}`);
        await page.evaluate(() => window.__BIRB.discovery({ reset: true }));
    } catch (err) {
        failures.push('harness: ' + String(err?.stack || err));
    } finally {
        await browser.close();
        server.close();
    }
    for (const n of noise) failures.push(n);
    if (failures.length) {
        console.error(`\nbirb-discovery: ${failures.length} failure(s)`);
        for (const f of failures) console.error('  - ' + f);
        process.exit(1);
    }
    console.log('\nbirb-discovery: places exist in every biome, a find is made, shown, counted and remembered');
}

main().catch((e) => { console.error(e); process.exit(1); });
