#!/usr/bin/env node
/**
 * sculpture-shot.mjs — the screenshot harness.
 *
 * Every visual claim about the sculpture study gets verified against a real captured frame,
 * never against an assumption about what the code does. This spins up a static
 * server on an ephemeral port, drives a headless Chromium to the page, waits for
 * the page to signal readiness, optionally runs an expression to drive the game
 * to a specific moment, then captures at retina resolution.
 *
 * It exits non-zero on any page error or console error, so "the screenshot
 * rendered" and "the module actually loaded" cannot be confused.
 *
 * Usage:
 *   node tools/sculpture-shot.mjs --page gauntlet/dev/planet.html --out shots/planet.png
 *   node tools/sculpture-shot.mjs --page gauntlet/index.html --out shots/race.png \
 *        --w 390 --h 844 --dpr 3 --wait 4000 \
 *        --eval "window.__gauntlet.debugJumpTo(0.42)" --settle 800
 *
 * Flags:
 *   --page    repo-relative path to the HTML file            (required)
 *   --out     output PNG path                                (required)
 *   --w --h   CSS viewport size            (default 390x844, iPhone 14 Pro)
 *   --dpr     device pixel ratio                             (default 3)
 *   --wait    ms to wait for window.__SCULPT_READY             (default 15000)
 *   --eval    JS expression evaluated in the page after ready
 *   --settle  ms to wait after --eval before capturing       (default 400)
 *   --query   query string appended to the URL (e.g. "mode=zen")
 *   --allow-console-errors   don't fail the run on console errors
 */

import { chromium } from 'playwright';
import http from 'node:http';
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
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.glb': 'model/gltf-binary',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            out[key] = true;
        } else {
            out[key] = next;
            i++;
        }
    }
    return out;
}

function startServer(root) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            let filePath = path.join(root, urlPath);
            // Directory -> index.html, matching Vercel's static behaviour.
            try {
                if (fs.statSync(filePath).isDirectory()) {
                    filePath = path.join(filePath, 'index.html');
                }
            } catch { /* fall through to the 404 below */ }

            if (!filePath.startsWith(root)) {
                res.writeHead(403).end('forbidden');
                return;
            }
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
function findChromium() {
    if (process.env.GAUNTLET_CHROMIUM && fs.existsSync(process.env.GAUNTLET_CHROMIUM)) {
        return process.env.GAUNTLET_CHROMIUM;
    }
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH
        || (process.platform === 'win32'
            ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
            : '/opt/pw-browsers');
    let entries = [];
    try {
        entries = fs.readdirSync(root);
    } catch {
        return undefined; // let playwright resolve it itself
    }
    const candidates = entries
        .filter((name) => name.startsWith('chromium'))
        .sort()
        .reverse()
        .flatMap((name) => [
            path.join(root, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
            path.join(root, name, 'chrome-win64', 'chrome.exe'),
            path.join(root, name, 'chrome-linux', 'chrome'),
            path.join(root, name, 'chrome-linux', 'headless_shell'),
        ]);
    return candidates.find((p) => fs.existsSync(p));
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.page || !args.out) {
        console.error('usage: sculpture-shot.mjs --page <html> --out <png> [--w 390 --h 844 --dpr 3]');
        process.exit(2);
    }

    const width = Number(args.w || 390);
    const height = Number(args.h || 844);
    const dpr = Number(args.dpr || 3);
    const readyTimeout = Number(args.wait || 15000);
    const settle = Number(args.settle || 400);

    const { server, port } = await startServer(REPO_ROOT);
    const query = args.query ? (String(args.query).startsWith('?') ? args.query : '?' + args.query) : '';
    const url = `http://127.0.0.1:${port}/${String(args.page).replace(/^\/+/, '')}${query}`;

    // Some environments ship a pre-installed Chromium whose build number does
    // not match the playwright package's expectation. Prefer whatever is
    // actually on disk; fall back to playwright's own resolution.
    const preinstalled = findChromium();

    const browser = await chromium.launch({
        executablePath: preinstalled,
        args: [
            // Headless Chromium needs a real GL backend for WebGL. SwiftShader
            // is software but renders identically enough for art review.
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
        ],
    });

    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: dpr,
        hasTouch: true,
        isMobile: width < 700,
        reducedMotion: 'no-preference',
    });

    const consoleErrors = [];
    const pageErrors = [];
    const page = await context.newPage();
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.stack || err)));
    page.on('requestfailed', (req) => {
        consoleErrors.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
    });

    let readyOk = true;
    let readyErr = '';
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction('window.__SCULPT_READY === true', null, { timeout: readyTimeout });
    } catch (err) {
        readyOk = false;
        readyErr = String(err && err.message || err);
    }

    if (args.eval) {
        try {
            await page.evaluate(String(args.eval));
        } catch (err) {
            pageErrors.push('eval failed: ' + String(err && err.message || err));
        }
    }

    await page.waitForTimeout(settle);

    // Report the page's own perf counters if it publishes them.
    const stats = await page.evaluate(() => (window.__SCULPT_STATS ? window.__SCULPT_STATS() : null)).catch(() => null);

    // Read the live WebGL framebuffer immediately after a render. A successful
    // page load can still produce an all-black canvas, so file existence is not
    // a visual assertion. Sampling the luminance distribution catches blank,
    // transparent and severely crushed frames without prescribing the artwork.
    const pixelStats = await page.evaluate(() => {
        const state = window.__SCULPT || window.__PROBE;
        if (!state?.renderer || !state.scene || !state.camera) return null;
        state.renderer.render(state.scene, state.camera);
        const gl = state.renderer.getContext();
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const rgba = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        const pixelCount = width * height;
        const step = Math.max(1, Math.floor(pixelCount / 4096));
        let samples = 0, opaque = 0, min = 255, max = 0, sum = 0, sumSq = 0;
        for (let pixel = 0; pixel < pixelCount; pixel += step) {
            const offset = pixel * 4;
            const lum = rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722;
            if (rgba[offset + 3] > 240) opaque++;
            min = Math.min(min, lum);
            max = Math.max(max, lum);
            sum += lum;
            sumSq += lum * lum;
            samples++;
        }
        const mean = sum / samples;
        return { width, height, samples, opaque, min, max, mean,
            deviation: Math.sqrt(Math.max(0, sumSq / samples - mean * mean)) };
    }).catch(() => null);
    const pixelOk = Boolean(pixelStats
        && pixelStats.samples >= 100
        && pixelStats.opaque / pixelStats.samples > 0.90
        && pixelStats.max - pixelStats.min > 12
        && pixelStats.deviation > 4);

    const outPath = path.resolve(REPO_ROOT, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath });

    await browser.close();
    server.close();

    console.log(`shot: ${outPath}  (${width}x${height} @${dpr}x)`);
    if (stats) console.log('stats: ' + JSON.stringify(stats));
    if (pixelStats) console.log('pixels: ' + JSON.stringify(pixelStats));
    if (!pixelOk) console.error('PIXEL CHECK FAILED: canvas is blank, transparent or crushed');
    if (!readyOk) console.error('NOT READY: ' + readyErr);
    if (pageErrors.length) console.error('PAGE ERRORS:\n  ' + pageErrors.join('\n  '));
    if (consoleErrors.length) console.error('CONSOLE ERRORS:\n  ' + consoleErrors.join('\n  '));

    const allowConsole = Boolean(args['allow-console-errors']);
    const failed = !readyOk || !pixelOk || pageErrors.length > 0 || (!allowConsole && consoleErrors.length > 0);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
