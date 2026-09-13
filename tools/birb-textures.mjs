#!/usr/bin/env node
/**
 * birb-textures.mjs — does a session that revisits biomes accumulate GL textures?
 *
 * WHY THIS EXISTS: `skyDome.mesh` is added straight to `scene`, not to the
 * per-switch world `spherical-world.js` tears down, so nothing in the teardown
 * path has ever had an opinion about the dome's bound panorama. A leak there is
 * invisible to every other check in this repo: the frame renders, the draw-call
 * budget does not move (it is the same one dome), `asset-check.mjs` reasons about
 * the files on disk rather than the uploads in the driver, and the heap grows in
 * GPU memory that `performance.memory` does not report. The only thing that can
 * see it is the driver's own texture ledger, so that is what this hooks.
 *
 * HOW: `createTexture`/`deleteTexture` are wrapped on BOTH WebGLRenderingContext
 * and WebGL2RenderingContext prototypes in an init script — before any page
 * script runs, because three grabs its context during module evaluation and a
 * hook installed after that point sees none of the world's own uploads. Live =
 * created - deleted. Then the game is driven through every biome for several
 * laps and the live count is sampled at the end of each.
 *
 * SAMPLED AT REST, NEVER MID-LOAD. The ledger moves for several hundred ms after
 * a switch — the new biome's maps upload, the old biome's are disposed, and a sky
 * is still in flight — so a single reading taken at a fixed delay reports whatever
 * that transient happened to be doing. Measured: at `--dwell 120` a fixed sample
 * reported `+7` between two laps and `-7` back again on the next, on a run whose
 * resting depth was 9 every single lap. Each lap therefore ends by polling until
 * the ledger stops moving, and the verdict only ever compares resting depths.
 * (Same trap as the A5 draw-call gate in CLAUDE.md: a check whose signal is a few
 * units and whose window is seconds long is not measuring what it names unless
 * something proves the scene had stopped changing.)
 *
 * THE ASSERTION: lap 1 is allowed to grow — it is the session populating itself,
 * and each biome's first visit legitimately uploads that biome's maps. Every lap
 * after it revisits biomes already seen, so a correctly-disposing runtime returns
 * to the same ledger depth and `live` goes FLAT. Growth that continues past lap 1
 * is unbounded accumulation by definition: nothing about lap 3 differs from lap 2
 * except how long the session has been open.
 *
 * Usage:
 *   node tools/birb-textures.mjs                      # 3 laps, fails on growth
 *   node tools/birb-textures.mjs --laps 4 --verbose
 *   node tools/birb-textures.mjs --query skytex=0     # the skies-off control
 *   node tools/birb-textures.mjs --tolerance 2
 *
 * Flags:
 *   --laps       laps through all four biomes                    (default 3)
 *   --tolerance  live textures a post-lap-1 lap may add and still pass (default 0)
 *   --dwell      ms to hold each biome, so its sky can decode  (default 1500)
 *   --quiesce    ms to wait for the ledger to stop moving before sampling a lap
 *                (default 12000; 0 disables and samples immediately)
 *   --query      extra query string (?debug=1 is always added)
 *   --desktop    1280x800 @1x instead of the iPhone-class default
 *   --verbose    print the per-biome ledger, not just per-lap
 *   --json       write the measurement to this path
 *   --wait       ms to wait for the game to be ready          (default 60000)
 *   --allow-console-errors   don't fail the run on console errors
 */

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
    parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame,
} from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** The four on-sphere biomes, in the order a session would wander them. */
export const BIOMES = ['forest', 'canyons', 'mountain', 'city'];

/**
 * Verdict from a ledger of per-lap live-texture counts.
 *
 * Pure, and exported, so the decision this tool fails on is unit-testable
 * without a browser — the thing that goes wrong with a leak check is the
 * arithmetic around "which growth is legitimate", not the hooking.
 */
export function judge(laps, tolerance = 0) {
    // laps: [{ lap, live }, ...], lap 1 first.
    const growth = [];
    for (let i = 1; i < laps.length; i++) {
        growth.push({
            lap: laps[i].lap,
            from: laps[i - 1].live,
            to: laps[i].live,
            delta: laps[i].live - laps[i - 1].live,
        });
    }
    const offenders = growth.filter((g) => g.delta > tolerance);
    return { growth, offenders, ok: offenders.length === 0 };
}

/**
 * Installed with `addInitScript`, so it runs in every frame before page script.
 * Counts only — it must not keep references to the WebGLTexture objects, or the
 * check itself would pin every texture the page ever made and turn a leak report
 * into a leak.
 */
function textureLedgerInit() {
    window.__TEXLEDGER = { created: 0, deleted: 0 };
    const protos = [
        typeof WebGLRenderingContext !== 'undefined' && WebGLRenderingContext.prototype,
        typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext.prototype,
    ].filter(Boolean);
    for (const proto of protos) {
        const create = proto.createTexture;
        const del = proto.deleteTexture;
        if (typeof create === 'function') {
            proto.createTexture = function patchedCreateTexture(...args) {
                const tex = create.apply(this, args);
                if (tex) window.__TEXLEDGER.created += 1;
                return tex;
            };
        }
        if (typeof del === 'function') {
            proto.deleteTexture = function patchedDeleteTexture(tex, ...rest) {
                // Count only deletions the driver will honour. GL silently
                // ignores deleteTexture(null), and three calls it on materials
                // whose map was never uploaded; counting those would let a
                // no-op cancel a real leak out of the ledger.
                if (tex) window.__TEXLEDGER.deleted += 1;
                return del.call(this, tex, ...rest);
            };
        }
    }
}

/**
 * Poll until the ledger stops moving, so a lap is sampled at its resting depth
 * rather than part way through an upload-and-dispose transient.
 *
 * Requires TWO consecutive identical readings, not one: `created` and `deleted`
 * can both be mid-flight, and a single match against the previous poll is
 * satisfied by a pause between two uploads as readily as by the end of them.
 * Returns the last reading either way — a timeout here is a slow load, not a
 * failure, and the verdict still has a number to compare.
 */
export async function quiesce(page, read, { timeout = 12000, interval = 250, needed = 2 } = {}) {
    const deadline = Date.now() + timeout;
    let last = await read();
    let stable = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(interval);
        const next = await read();
        if (next.created === last.created && next.deleted === last.deleted) {
            stable += 1;
            if (stable >= needed) return { ...next, settled: true };
        } else {
            stable = 0;
        }
        last = next;
    }
    return { ...last, settled: false };
}

const args = parseArgs(process.argv);
const laps = Math.max(2, Number(args.laps ?? 3));
const tolerance = Number(args.tolerance ?? 0);
const dwell = Number(args.dwell ?? 1500);
const quiesceMs = Number(args.quiesce ?? 12000);
const waitMs = Number(args.wait ?? 60000);

async function main() {
    const { server, port } = await startServer(REPO_ROOT);
    const executablePath = findChromium();
    const browser = await chromium.launch({ args: CHROMIUM_ARGS, executablePath });
    const profile = args.desktop
        ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
        : devices['iPhone 14 Pro'];
    const context = await browser.newContext(profile);
    await installCdnCache(context);
    await context.addInitScript(textureLedgerInit);

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    const extra = typeof args.query === 'string' ? `&${args.query.replace(/^[?&]/, '')}` : '';
    const url = `http://127.0.0.1:${port}/index.html?debug=1${extra}`;
    console.log(`[textures] ${url}`);

    let failure = null;
    const record = { url, laps: [], biomes: [], tolerance, dwell };
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await startGame(page, waitMs);

        const ledger = () => page.evaluate(() => ({
            created: window.__TEXLEDGER.created,
            deleted: window.__TEXLEDGER.deleted,
            live: window.__TEXLEDGER.created - window.__TEXLEDGER.deleted,
            sky: window.__BIRB?.skyTextureState ? window.__BIRB.skyTextureState() : null,
        }));

        const atStart = await ledger();
        console.log(`[textures] after start: created ${atStart.created}, live ${atStart.live}`);

        for (let lap = 1; lap <= laps; lap++) {
            for (const biome of BIOMES) {
                await page.evaluate((id) => window.__BIRB.setEnvironment(id), biome);
                // A switch is not a frame, and an upload does not happen until
                // the renderer draws with the material. Dwell long enough for
                // the biome's authored maps to fetch, decode, commit and be
                // rasterised — otherwise the run measures the load race rather
                // than the teardown.
                await page.waitForTimeout(dwell);
                const snap = await ledger();
                record.biomes.push({ lap, biome, ...snap });
                if (args.verbose) {
                    console.log(`  lap ${lap} ${biome.padEnd(8)} created ${String(snap.created).padStart(4)}`
                        + ` deleted ${String(snap.deleted).padStart(4)} live ${String(snap.live).padStart(4)}`
                        + (snap.sky ? `  sky mix ${snap.sky.mix}` : ''));
                }
            }
            // The lap's verdict reading. Taken at rest — see the header.
            const snap = quiesceMs > 0
                ? await quiesce(page, ledger, { timeout: quiesceMs })
                : { ...(await ledger()), settled: null };
            record.laps.push({ lap, ...snap });
            console.log(`[textures] lap ${lap}: created ${snap.created}, deleted ${snap.deleted},`
                + ` live ${snap.live}${snap.settled === false ? '  (NOT settled — ledger still moving)' : ''}`);
        }

        const verdict = judge(record.laps, tolerance);
        record.verdict = verdict;
        for (const g of verdict.growth) {
            const mark = g.delta > tolerance ? 'GREW' : 'flat';
            console.log(`[textures] lap ${g.lap - 1} -> ${g.lap}: ${g.from} -> ${g.to} live (${g.delta >= 0 ? '+' : ''}${g.delta})  ${mark}`);
        }
        if (!verdict.ok) {
            failure = `live GL textures kept growing after lap 1: `
                + verdict.offenders.map((g) => `lap ${g.lap} +${g.delta}`).join(', ')
                + ` (tolerance ${tolerance})`;
        }
    } catch (err) {
        failure = err.message;
    }

    if (!failure && consoleErrors.length && !args['allow-console-errors']) {
        failure = `console errors: ${consoleErrors.slice(0, 5).join(' | ')}`;
    }
    record.consoleErrors = consoleErrors;
    if (typeof args.json === 'string') {
        fs.writeFileSync(args.json, JSON.stringify(record, null, 2));
        console.log(`[textures] wrote ${args.json}`);
    }

    await browser.close();
    server.close();

    if (failure) {
        console.error(`[textures] FAIL — ${failure}`);
        process.exitCode = 1;
    } else {
        console.log(`[textures] ok — live texture count is flat across ${laps - 1} revisit lap(s)`);
    }
}

// Guarded, like birb-shot.mjs. `judge` and `quiesce` are exported for
// tests/texture-ledger.test.js, and an unguarded main() would launch a browser
// the moment the unit suite imported this file.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error(err); process.exit(1); });
}
