#!/usr/bin/env node
/**
 * birb-shot.mjs — the root game's screenshot harness.
 *
 * Birb Gauntlet has had `gauntlet-shot.mjs` since the day it shipped; the root
 * game never had an equivalent, so every visual claim about the BIRD — its
 * wings, its perch pose, its contact shadow — was judged from a description of
 * the code rather than from a frame the code produced. This is that harness.
 *
 * It serves the repo statically, drives a headless Chromium through the real
 * Splash -> Vibe -> Title -> Tap-to-Start flow, waits for the game to actually
 * be rendering, and captures. It exits non-zero on any page error or console
 * error, so "a PNG appeared" and "the game ran" cannot be confused.
 *
 * The page only exposes `window.__BIRB` when loaded with `?debug=1`, so
 * `--env` / `--nest` / `--stats` all require the flag; the harness adds it.
 *
 * Usage:
 *   node tools/birb-shot.mjs --out shots/forest.png --start
 *   node tools/birb-shot.mjs --out shots/nest.png --start --nest --env mountain
 *   node tools/birb-shot.mjs --out shots/wide.png --start --desktop --settle 2000
 *
 * Flags:
 *   --out      output PNG path                                    (required)
 *   --page     repo-relative HTML to load             (default index.html)
 *   --start    click through the splash flow and start the game
 *   --desktop  1280x800 @1x instead of 390x844 @3x (iPhone-class default)
 *   --w --h --dpr    explicit viewport overrides
 *   --env      forest|canyon|mountain|city — switch after start
 *   --nest     land on nest N (default 0) — implies --start
 *   --eval     JS evaluated in the page after start
 *   --settle   ms to wait before capture                    (default 1200)
 *   --wait     ms to wait for the game to be ready         (default 30000)
 *   --allow-console-errors   don't fail the run on console errors
 */

import { chromium, devices } from 'playwright';
import http from 'node:http';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.glb': 'model/gltf-binary',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ico': 'image/x-icon',
};

export function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) out[key] = true;
        else { out[key] = next; i++; }
    }
    return out;
}

export function startServer(root) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            let filePath = path.join(root, urlPath);
            try {
                if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
            } catch { /* fall through to 404 */ }
            if (!filePath.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + urlPath);
                    return;
                }
                res.writeHead(200, {
                    'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
                    'cache-control': 'no-store',
                });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

/** Locate a usable Chromium, ignoring playwright's expected build number. */
export function findChromium() {
    if (process.env.BIRB_CHROMIUM && fs.existsSync(process.env.BIRB_CHROMIUM)) return process.env.BIRB_CHROMIUM;
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { return undefined; }
    const candidates = entries
        .filter((name) => name.startsWith('chromium'))
        .sort().reverse()
        .flatMap((name) => [
            path.join(root, name, 'chrome-linux', 'chrome'),
            path.join(root, name, 'chrome-linux', 'headless_shell'),
        ]);
    return candidates.find((p) => fs.existsSync(p));
}

/**
 * The CDN modules the page imports (esm.sh) are unreachable from Chromium in
 * this sandbox: egress goes through a MITM proxy whose CA lives in a bundle
 * Node trusts and Chromium's (absent) NSS store does not. Rather than weaken
 * TLS in the browser, every CDN request is fulfilled from Node, which fetches
 * it correctly through the proxy, and cached on disk so later runs are offline
 * and fast. The page is served the byte-for-byte CDN response either way.
 */
const CDN_CACHE = path.join(REPO_ROOT, '.cdn-cache');

function cacheKey(url) {
    return url.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
}

export function fetchThroughProxy(url) {
    return new Promise((resolve, reject) => {
        const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        const options = { headers: { 'user-agent': 'Mozilla/5.0 birb-shot' } };
        if (proxy) options.agent = new HttpsProxyAgent(proxy);
        https.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                resolve(fetchThroughProxy(next));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`${url} -> HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                body: Buffer.concat(chunks),
                contentType: res.headers['content-type'] || 'application/octet-stream',
            }));
        }).on('error', reject);
    });
}

/**
 * Serve every CDN request from the on-disk cache, filling it on a miss.
 *
 * ONLY for immutable, version-pinned CDN URLs. Never pass the host you are
 * testing: caching the site under test means the next run verifies a
 * deployment against a copy of the previous one and reports it healthy. That
 * happened once here, checking production after a fix and being handed the
 * pre-fix page from a 102-entry cache. To check a live site, route it through
 * `fetchThroughProxy` directly with no cache.
 */
export async function installCdnCache(context, hosts = ['esm.sh', 'cdn.jsdelivr.net', 'unpkg.com']) {
    fs.mkdirSync(CDN_CACHE, { recursive: true });
    for (const host of hosts) {
        await context.route(`https://${host}/**`, async (route) => {
            const url = route.request().url();
            const file = path.join(CDN_CACHE, cacheKey(url));
            const meta = file + '.type';
            try {
                const body = fs.readFileSync(file);
                const contentType = fs.readFileSync(meta, 'utf8');
                await route.fulfill({ status: 200, contentType, body });
                return;
            } catch { /* cache miss */ }
            try {
                const { body, contentType } = await fetchThroughProxy(url);
                fs.writeFileSync(file, body);
                fs.writeFileSync(meta, contentType);
                await route.fulfill({ status: 200, contentType, body });
            } catch (err) {
                await route.abort();
            }
        });
    }
}

export const CHROMIUM_ARGS = [
    // Headless Chromium needs a real GL backend for WebGL. SwiftShader is
    // software, but it renders the same scene — enough for art review, and
    // NOT enough to certify frame times. Never quote its FPS as a device result.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
];

/** Click through Splash -> Vibe -> Title -> Tap-to-Start and wait for frames. */
export async function startGame(page, timeout = 30000) {
    // The splash chain is time-driven: the Vibe page only becomes clickable
    // once the first splash has finished fading, so a fixed pair of clicks
    // races it and lands on nothing. Poll instead — click whichever splash is
    // currently up until the Title's own button is actually visible.
    const deadline = Date.now() + timeout;
    for (;;) {
        const ready = await page.evaluate(() => {
            const start = document.querySelector('[data-title-start]');
            const screen = document.querySelector('[data-title-screen]');
            return !!start && !screen?.hidden;
        });
        if (ready) break;
        if (Date.now() > deadline) throw new Error('title screen never appeared');
        // Dispatched on the elements themselves, not at coordinates. The Vibe
        // page sits over the first splash as a full-screen div at opacity 0,
        // so a positional click — force:true included — is delivered to the
        // topmost element and the splash underneath never hears it.
        await page.evaluate(() => {
            document.querySelector('[data-splash-screen]')?.click();
            document.querySelector('[data-vibe-splash]')?.click();
        });
        await page.waitForTimeout(250);
    }
    // The button self-disables and reads "Loading…" if the scene module has
    // not finished importing. Waiting for __BIRB_READY avoids that race.
    await page.waitForFunction('window.__BIRB_READY === true', null, { timeout });
    await page.click('[data-title-start]', { timeout: 5000 });
    // A revealed <main> is not a rendered frame. The elapsed clock only
    // advances inside renderFrame, so this waits for real animation frames.
    await page.waitForFunction(
        'window.__BIRB && window.__BIRB.stats().elapsed > 0.5', null, { timeout },
    );

    // A rendering world is not a WORKING world. Initial environment setup runs
    // inside a try/catch that logs a warning and continues, so a throw part way
    // through it leaves the terrain built and looking perfectly normal while
    // nest points, the collectibles system and the rocket collision targets
    // were never created. That shipped once, undetected, because every capture
    // switched environment first and so re-ran the setup successfully. This is
    // the check that would have caught it: assert the systems a player needs
    // exist on the path a player actually takes.
    const health = await page.evaluate(() => ({
        nesting: window.__BIRB.stats().nesting,
        rings: window.__BIRB.modeState ? window.__BIRB.modeState().ringsSpawned : null,
    }));
    if (health.nesting === null) {
        throw new Error('initial setup incomplete: no nesting system (check console warnings)');
    }
    if (health.rings === null) {
        throw new Error('initial setup incomplete: no collectibles system (check console warnings)');
    }
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.out) {
        console.error('usage: birb-shot.mjs --out <png> [--start] [--env forest] [--nest] [--desktop]');
        process.exit(2);
    }

    const desktop = Boolean(args.desktop);
    const width = Number(args.w || (desktop ? 1280 : 390));
    const height = Number(args.h || (desktop ? 800 : 844));
    const dpr = Number(args.dpr || (desktop ? 1 : 3));
    const settle = Number(args.settle || 1200);
    const readyTimeout = Number(args.wait || 30000);
    const wantsGame = Boolean(args.start || args.nest || args.env || args.stats);

    const { server, port } = await startServer(REPO_ROOT);
    const pagePath = String(args.page || 'index.html').replace(/^\/+/, '');
    const url = `http://127.0.0.1:${port}/${pagePath}?debug=1`;

    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    // The iPhone descriptor carries the UA and touch flags the game's own
    // isMobile check reads, so --desktop vs default exercises different code.
    const context = await browser.newContext({
        ...(desktop ? {} : devices['iPhone 13']),
        viewport: { width, height },
        deviceScaleFactor: dpr,
        hasTouch: !desktop,
        isMobile: !desktop,
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

    let ok = true;
    let failure = '';
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (wantsGame) await startGame(page, readyTimeout);
    } catch (err) {
        ok = false;
        failure = String((err && err.message) || err);
    }

    if (ok && args.env) {
        await page.evaluate((id) => window.__BIRB.setEnvironment(id), String(args.env));
        await page.waitForTimeout(900);
    }
    if (ok && args.nest) {
        const index = args.nest === true ? 0 : Number(args.nest);
        const landed = await page.evaluate((i) => window.__BIRB.forceNest(i), index);
        if (!landed) { ok = false; failure = 'forceNest returned false — no landable nest'; }
        // The landing is an animated approach, not a teleport; let it complete.
        // Generous on purpose. The landing auto-flies at 16 units per SIMULATED
        // second, and headless software rendering here runs at 2-9 fps, so a
        // four second landing can cost forty seconds of wall clock. A tight
        // timeout here does not measure the game, it measures the renderer.
        else await page.waitForFunction(
            'window.__BIRB.stats().nesting === "nested"', null, { timeout: 90000 },
        ).catch(() => { consoleErrors.push('landing did not reach NESTED'); });
    }
    if (ok && args.eval) {
        try { await page.evaluate(String(args.eval)); }
        catch (err) { pageErrors.push('eval failed: ' + String((err && err.message) || err)); }
    }

    await page.waitForTimeout(settle);
    const stats = await page.evaluate(() => (window.__BIRB ? window.__BIRB.stats() : null)).catch(() => null);

    const outPath = path.resolve(REPO_ROOT, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath });

    await browser.close();
    server.close();

    console.log(`shot: ${outPath}  (${width}x${height} @${dpr}x${desktop ? ' desktop' : ' mobile'})`);
    if (stats) console.log('stats: ' + JSON.stringify(stats));
    if (!ok) console.error('FAILED: ' + failure);
    if (pageErrors.length) console.error('PAGE ERRORS:\n  ' + pageErrors.join('\n  '));
    if (consoleErrors.length) console.error('CONSOLE ERRORS:\n  ' + consoleErrors.join('\n  '));

    const allowConsole = Boolean(args['allow-console-errors']);
    process.exit(!ok || pageErrors.length || (!allowConsole && consoleErrors.length) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error(err); process.exit(1); });
}
