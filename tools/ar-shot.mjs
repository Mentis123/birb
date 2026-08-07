#!/usr/bin/env node
/**
 * ar-shot.mjs — screenshot harness for Birb AR (`/gauntlet/ar/`).
 *
 * The gauntlet harness cannot drive this page: Birb AR opens behind a
 * permission gate that must be crossed by a real tap, needs a camera stream,
 * and needs a gyroscope that a desktop Chromium does not have. This harness
 * supplies all three:
 *
 *   - `--use-fake-device-for-media-stream` gives getUserMedia a synthetic
 *     rolling-pattern video track, so the camera path executes for real rather
 *     than being stubbed out. A stub would hide exactly the bugs worth finding
 *     (a video element that never plays, a stream that is never attached).
 *   - Camera permission is granted through the CDP permission API, so the
 *     prompt never blocks.
 *   - DeviceOrientationEvent is synthesised: the page is fed a stream of
 *     attitudes so the gyro path produces real quaternions. Without this
 *     `hasReading` stays false and the screen never appears — a black frame
 *     that looks like a rendering bug and is not.
 *
 * Exits non-zero on any page error or console error, so a zero exit is proof
 * the page actually ran.
 *
 * Usage:
 *   node tools/ar-shot.mjs --out /tmp/shots/ar.png
 *   node tools/ar-shot.mjs --out /tmp/shots/ar-fly.png --go --wait 30000
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function parseArgs(argv) {
    const out = {
        page: 'gauntlet/ar/index.html',
        out: 'shots/ar.png',
        w: 390, h: 844, dpr: 3,
        wait: 25000,
        go: false,
        settle: 1200,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--go') { out.go = true; continue; }
        const key = a.replace(/^--/, '');
        if (key in out) out[key] = a.startsWith('--') ? argv[++i] : out[key];
    }
    ['w', 'h', 'dpr', 'wait', 'settle'].forEach((k) => { out[k] = Number(out[k]); });
    return out;
}

const args = parseArgs(process.argv);

// --- static server ---------------------------------------------------------
const server = createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p.endsWith('/')) p += 'index.html';
        const file = join(ROOT, p);
        if (!file.startsWith(ROOT) || !existsSync(file)) {
            console.log('  [404] ' + p);
            res.writeHead(404); res.end('not found'); return;
        }
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch (err) {
        res.writeHead(500); res.end(String(err));
    }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/${args.page}?three=local`;

const errors = [];
let exitCode = 0;

/**
 * Some environments ship a pre-installed Chromium whose build number does not
 * match the playwright package's expectation. Prefer whatever is on disk; fall
 * back to playwright's own resolution. Mirrors tools/gauntlet-shot.mjs.
 */
function findChromium() {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    if (!existsSync(root)) return undefined;
    const names = readdirSync(root).filter((n) => n.startsWith('chromium'));
    const candidates = names.flatMap((name) => [
        join(root, name, 'chrome-linux', 'chrome'),
        join(root, name, 'chrome-linux', 'headless_shell'),
    ]);
    return candidates.find((p) => existsSync(p));
}

const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
        // A synthetic camera, so the getUserMedia path runs for real.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        // Headless Chromium needs a real GL backend for WebGL. SwiftShader is
        // software but renders identically enough for art review.
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
    ],
});

try {
    const context = await browser.newContext({
        viewport: { width: args.w, height: args.h },
        deviceScaleFactor: args.dpr,
        hasTouch: true,
        isMobile: true,
        permissions: ['camera'],
    });

    // Synthetic gyroscope. Installed BEFORE any page script runs so the page's
    // own listener is registered against a window that will actually deliver.
    await context.addInitScript(() => {
        let t = 0;
        setInterval(() => {
            t += 0.05;
            const e = new Event('deviceorientation');
            // A slow sweep rather than a fixed attitude: a static reading would
            // pass even if update() never recomputed anything.
            // Amplitude is deliberately small. A wide sweep proves the gyro
            // path works but walks the pinned screen straight off the edge of
            // the capture, so every art review is of a sliver of bezel. Small
            // and slow still exercises update() while keeping the subject in
            // frame — the capture has to be judgeable to be worth taking.
            Object.defineProperties(e, {
                alpha: { value: 20 + Math.sin(t * 0.35) * 3 },
                beta: { value: 78 + Math.cos(t * 0.3) * 2 },
                gamma: { value: Math.sin(t * 0.25) * 2 },
                absolute: { value: false },
            });
            window.dispatchEvent(e);
        }, 50);
    });

    const page = await context.newPage();
    page.on('pageerror', (err) => { errors.push('pageerror: ' + err.message); });
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
    });
    // A bare "404 (Not Found)" console line names no URL, which makes a missing
    // module indistinguishable from a missing favicon. Name it.
    page.on('response', (res) => {
        if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Cross the permission gate with a real tap.
    await page.waitForSelector('#btnEnable', { timeout: 10000 });
    await page.click('#btnEnable');

    await page.waitForFunction(() => window.__AR_READY === true, null, { timeout: args.wait });

    if (args.go) {
        await page.waitForSelector('#btnGo', { state: 'visible', timeout: 10000 });
        await page.click('#btnGo');
        // The game view builds a planet; give it room, then let it fly a little
        // so the capture shows a bird in motion rather than a spawn pose.
        await page.waitForFunction(
            () => window.__AR_STATS && window.__AR_STATS().phase === 'flying',
            null, { timeout: args.wait }
        );
        await page.waitForTimeout(2500);
    }

    await page.waitForTimeout(args.settle);

    const stats = await page.evaluate(() => (window.__AR_STATS ? window.__AR_STATS() : null));
    console.log('__AR_STATS:', JSON.stringify(stats, null, 2));

    await mkdir(dirname(resolve(ROOT, args.out)), { recursive: true });
    await page.screenshot({ path: resolve(ROOT, args.out) });
    console.log('wrote', args.out);

    // Assertions that turn a pretty PNG into evidence.
    if (!stats) { errors.push('no __AR_STATS'); }
    else {
        if (!stats.hasReading) errors.push('gyro never produced a reading');
        if (!stats.cameraActive) errors.push('camera stream not active');
        if (args.go && stats.phase !== 'flying') errors.push('never reached flying phase');
        if (args.go && !stats.gameRunning) errors.push('game view not built');
        if (stats.drawCalls === 0) errors.push('zero draw calls — nothing rendered');
    }
} catch (err) {
    errors.push('harness: ' + (err && err.message ? err.message : String(err)));
} finally {
    await browser.close();
    server.close();
}

if (errors.length) {
    console.error('\nFAILED:');
    errors.forEach((e) => console.error('  - ' + e));
    exitCode = 1;
} else {
    console.log('\nOK — no page or console errors.');
}
process.exit(exitCode);
