#!/usr/bin/env node
/**
 * birb-audit.mjs — is every prop standing on its ground, in every biome?
 *
 * Every floating, flattened or buried prop this game shipped was found by eye
 * on the owner's phone (floating canyon tori, a forest arch laid flat, an arch
 * buried 20 units in a pit). Each was a number the whole time. This boots the
 * real page, visits all four biomes, and runs `__BIRB.auditWorld()`
 * (src/environment/world-audit.js): instanced ground layers, every landmark's
 * own meshes, every geometry buffer, and every living-world actor route.
 *
 * It then PLANTS three defects (a floating trunk, a buried trunk, an arch laid
 * flat) and requires the audit to fail on each. A check that cannot fail is
 * not evidence.
 *
 * Each biome is built under three FIXED world seeds plus one unseeded (random)
 * world, because the scatter is random per boot: a check that only ever saw
 * one world proves nothing about the next player's.
 *
 * Routes: when the living world is on (the default), every actor route
 * (city hover lanes, the sky-tram, the mountain cable car) is checked too.
 *
 * Usage: node tools/birb-audit.mjs [--json out.json] [--env forest,city] [--seeds 16160,2,7,random]
 * Exits 1 on any audit failure, any planted defect that passes, or any page
 * error / console error / console warning.
 */

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIOMES = ['forest', 'canyons', 'mountain', 'city'];

async function main() {
    const args = parseArgs(process.argv);
    const envs = args.env ? String(args.env).split(',') : BIOMES;
    const seeds = String(args.seeds || '16160,2,7,random').split(',').map((x) => (x === 'random' ? null : Number(x)));
    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await installCdnCache(context);
    const noise = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => noise.push('page: ' + String((e && e.message) || e)));
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });

    const failures = [];
    const report = { biomes: {} };
    try {
        await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&quality=amazing&flight=classic`, { waitUntil: 'domcontentloaded' });
        await startGame(page, 60000);
        for (const seed of seeds) for (const envId of envs) {
            const env = `${envId}@${seed ?? 'random'}`;
            await page.evaluate((n) => window.__BIRB.worldSeed(n), seed);
            await page.evaluate((id) => window.__BIRB.setEnvironment(id), envId);
            await page.waitForTimeout(1200);
            const res = await page.evaluate(() => window.__BIRB.auditWorld({}));
            if (!res) { failures.push(`${env}: auditWorld returned nothing`); continue; }
            report.biomes[env] = res;
            const layers = res.sections.filter((s) => s.kind === 'layer');
            const marks = res.sections.filter((s) => s.kind === 'landmark');
            const routes = res.sections.filter((s) => s.kind === 'route');
            console.log(`${env}: ${res.checked} checks (${layers.length} layers, ${marks.length} landmarks, ${routes.length} routes) — ${res.pass ? 'PASS' : 'FAIL'}`);
            for (const s of res.sections) {
                const tag = s.pass ? 'ok  ' : 'FAIL';
                if (s.kind === 'layer') console.log(`  ${tag} layer ${s.name}: ${s.audited}/${s.count} base clearance min ${s.clearance.min} med ${s.clearance.median} max ${s.clearance.max}${s.pass ? '' : ' — ' + s.failureCount + ' bad, e.g. ' + JSON.stringify(s.failures[0])}`);
                else if (s.kind === 'landmark') console.log(`  ${tag} landmark ${s.name}: lowest ${s.lowest} highest ${s.highest} (rise ${s.rise}, apex ${s.apex}) under ${s.buriedShare} feet ${JSON.stringify(s.feet)}${s.pass ? '' : ' — ' + JSON.stringify(s.failures)}`);
                else if (s.kind === 'route') console.log(`  ${tag} route ${s.name}: ${s.samples} samples, ride ${s.lowest}..${s.highest}${s.pass ? '' : ' — ' + JSON.stringify(s.failures[0])}`);
                else console.log(`  ${tag} ${s.kind} ${s.name}: ${JSON.stringify(s.failures)}`);
            }
            if (!res.pass) failures.push(`${env}: ${res.failed.join(', ')}`);
            if (!layers.length) failures.push(`${env}: no ground layers audited (the rules matched nothing — a vacuous pass)`);
            if (!marks.length) failures.push(`${env}: no landmark audited`);
        }

        // Planted defects: each must turn the audit red. Run in the forest
        // (it has trunks and an arch).
        await page.evaluate(() => window.__BIRB.worldSeed(16160));
        await page.evaluate(() => window.__BIRB.setEnvironment('forest'));
        await page.waitForTimeout(1500);
        for (const plant of ['float', 'bury', 'flat-arch']) {
            const res = await page.evaluate((p) => window.__BIRB.auditWorld({ plant: p }), plant);
            const caught = res && !res.pass;
            console.log(`planted ${plant}: ${caught ? 'caught (' + res.failed.join(', ') + ')' : 'NOT CAUGHT'}`);
            if (!caught) failures.push(`planted defect '${plant}' passed the audit`);
        }
        const after = await page.evaluate(() => window.__BIRB.auditWorld({}));
        if (!after?.pass) failures.push('the forest audit stayed red after the planted defects were undone');
    } catch (err) {
        failures.push('harness: ' + String(err?.stack || err));
    } finally {
        if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(report, null, 1));
        await browser.close();
        server.close();
    }
    for (const n of noise) failures.push(n);
    if (failures.length) {
        console.error(`\nbirb-audit: ${failures.length} failure(s)`);
        for (const f of failures) console.error('  - ' + f);
        process.exit(1);
    }
    console.log('\nbirb-audit: every biome passes, every planted defect caught');
}

main().catch((e) => { console.error(e); process.exit(1); });
