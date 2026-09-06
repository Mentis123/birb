#!/usr/bin/env node
/**
 * birb-modes.mjs — every game mode, entered and left, with its state checked.
 *
 * The root game had no end-to-end check that a mode can be started, reports
 * sane state, and can be exited. The sibling repo shipped a Ring Rush whose
 * win condition was a hardcoded 10 against 18 spawned rings, so the mode could
 * not be completed at all — a bug that no unit test and no screenshot catches,
 * because the code is correct in isolation and the frame looks right.
 *
 * This drives the real mode entry points through the ?debug=1 handle and
 * asserts the invariants that matter:
 *
 *   - every mode starts and reports itself active
 *   - Ring Rush's total is read from the SPAWNER, never a constant
 *   - Turret Defense actually puts the player on a nest
 *   - no mode leaves a console or page error behind
 *
 * Usage: node tools/birb-modes.mjs [--env forest]
 */

import { chromium, devices } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
    const args = parseArgs(process.argv);
    const env = String(args.env || 'forest');

    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
    });
    await installCdnCache(context);

    const noise = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => noise.push('page: ' + String((e && e.message) || e)));
    page.on('console', (m) => {
        // Warnings matter here too: initial environment setup catches its own
        // throw and only warns, so a warning is how a half-built game reports
        // itself. Treating it as noise is how that shipped once already.
        if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });

    await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`, { waitUntil: 'domcontentloaded' });
    await startGame(page, 45000);
    if (env !== 'forest') {
        await page.evaluate((id) => window.__BIRB.setEnvironment(id), env);
        await page.waitForTimeout(1200);
    }

    const failures = [];
    const modes = await page.evaluate(() => window.__BIRB.modes());
    for (const mode of modes) {
        const active = await page.evaluate((m) => window.__BIRB.startMode(m), mode);
        await page.waitForTimeout(2600);
        const state = await page.evaluate(() => window.__BIRB.modeState());
        const detail = `rings ${state.ringsTotal}/${state.ringsSpawned}, lives ${state.lives}, nesting ${state.nesting}`;

        if (!active || !state.active) failures.push(`${mode}: did not become active`);
        if (state.mode !== mode) failures.push(`${mode}: reports mode ${state.mode}`);
        if (mode === 'ring_rush') {
            if (!state.ringsSpawned) failures.push('ring_rush: no rings spawned');
            else if (state.ringsTotal !== state.ringsSpawned) {
                failures.push(`ring_rush: win condition wants ${state.ringsTotal} of ${state.ringsSpawned} spawned rings`);
            }
        }
        if (mode === 'turret_defense' && state.nesting !== 'nested' && state.nesting !== 'landing') {
            failures.push(`turret_defense: player is ${state.nesting}, not on the gun`);
        }
        // Turret Defense's whole loop is aim and fire. A rocket system that
        // constructs correctly and never launches from a perch is invisible to
        // every other check, so fire through the real launch handler — aim
        // assist, cooldown gate and all — and require a rocket to appear.
        let fired = '';
        if (mode === 'turret_defense') {
            await page.waitForFunction('window.__BIRB.stats().nesting === "nested"', null, { timeout: 20000 })
                .catch(() => failures.push('turret_defense: never reached the nest to fire from'));
            let launches = 0;
            for (let shot = 0; shot < 3; shot++) {
                const r = await page.evaluate(() => window.__BIRB.fire());
                if (r.after > r.before) launches++;
                // The launcher has a two second cooldown; firing faster than
                // that is correctly refused and would read as a failure.
                await page.waitForTimeout(2200);
            }
            if (!launches) failures.push('turret_defense: fired three times, no rocket launched');
            fired = `, launched ${launches}/3`;
        }
        console.log(`  ${mode}: ${state.active ? 'ok' : 'FAILED'} — ${detail}${fired}`);

        await page.evaluate(() => window.__BIRB.endMode(false));
        await page.waitForTimeout(900);
    }

    await browser.close();
    server.close();

    if (noise.length) console.error('CONSOLE NOISE:\n  ' + noise.slice(0, 10).join('\n  '));
    if (failures.length) console.error('FAILURES:\n  ' + failures.join('\n  '));
    else console.log(`all ${modes.length} modes ok in ${env}`);
    process.exit(failures.length || noise.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
