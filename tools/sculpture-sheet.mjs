#!/usr/bin/env node
/**
 * sculpture-sheet.mjs — the matched-view contact sheet.
 *
 * Renders every pose in `sculpture-views.mjs` in ONE browser session and
 * composites each render beside the reference photograph it was matched to.
 *
 * Two reasons this exists rather than repeated `sculpture-shot.mjs` calls:
 *
 *   1. A LIKENESS JUDGEMENT NEEDS THE PAIR. Rendering the model and comparing it
 *      against a memory of the photo is how this model's proportion table got
 *      solved to green while the render got visibly worse. Side by side at the
 *      same scale, a difference of shape is obvious and takes one look.
 *   2. Each `sculpture-shot.mjs` invocation boots a browser, which cost roughly
 *      five seconds a look and, at ninety looks across one session, most of the
 *      iteration budget. The general, nine-view Phase 4, ten-view Phase 5
 *      and eight-angle identity sets each run in one browser boot.
 *
 * Exits non-zero on any page or console error, same contract as the shot tool,
 * so a produced sheet is evidence the code ran.
 *
 * Usage:
 *   node tools/sculpture-sheet.mjs --out shots/sculpt/sheet.png
 *   node tools/sculpture-sheet.mjs --out shots/sculpt/sheet.png --only a-front,c-under
 *   node tools/sculpture-sheet.mjs --out shots/sculpt/sheet.png --no-photos   # review poses only
 *   node tools/sculpture-sheet.mjs --out shots/sculpt/phase4.png --phase4     # nine defect views
 *   node tools/sculpture-sheet.mjs --out shots/sculpt/phase5.png --phase5     # eight detail/scene + two mobile
 *   node tools/sculpture-sheet.mjs --out shots/sculpt/identity.png --identity # neutral eight-angle audit
 *
 * Flags:
 *   --out     output PNG path                                (required)
 *   --only    comma-separated view ids to render      (default: all)
 *   --cell    height in px of one row of the sheet           (default 620)
 *   --dpr     device pixel ratio (default 2; Phase 4/5 default to 1)
 *   --wait    ms to wait for window.__SCULPT_READY           (default 60000)
 *   --settle  ms to wait after parking each camera           (default 350)
 *   --screenshot-timeout  max ms per rendered screenshot   (default 120000)
 *   --no-photos  skip the reference column
 *   --phase4  capture the nine desktop/mobile/detail acceptance views
 *   --phase5  capture the ten Phase 5 likeness acceptance views
 *   --identity  capture the neutral eight-angle identity audit
 *   --allow-console-errors
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    IDENTITY_AUDIT_VIEWS,
    PHASE4_ACCEPTANCE_VIEWS,
    PHASE5_ACCEPTANCE_VIEWS,
    REFERENCE_VIEWS,
    REVIEW_VIEWS,
} from './sculpture-views.mjs';

const { chromium } = await import(process.env.SCULPTURE_PLAYWRIGHT_MODULE || 'playwright');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'sculpture/index.html';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
};

function parseArgs(argv) {
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

function startServer(root) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            let filePath = path.join(root, urlPath);
            try {
                if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
            } catch { /* fall through to the 404 below */ }
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('not found'); return; }
                res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

function findChromium() {
    if (process.env.GAUNTLET_CHROMIUM && fs.existsSync(process.env.GAUNTLET_CHROMIUM)) {
        return process.env.GAUNTLET_CHROMIUM;
    }
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH
        || (process.platform === 'win32'
            ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
            : '/opt/pw-browsers');
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { return undefined; }
    return entries
        .filter((n) => n.startsWith('chromium')).sort().reverse()
        .flatMap((n) => [
            path.join(root, n, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
            path.join(root, n, 'chrome-win64', 'chrome.exe'),
            path.join(root, n, 'chrome-linux', 'chrome'),
            path.join(root, n, 'chrome-linux', 'headless_shell'),
        ])
        .find((p) => fs.existsSync(p));
}

/** Use the platform Python name without hiding real Pillow/script failures. */
function runPython(args, options) {
    let missing = null;
    const commands = [
        process.env.SCULPTURE_PYTHON,
        process.platform === 'win32' && process.env.USERPROFILE
            ? path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes',
                'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
            : null,
        ...(process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']),
    ].filter(Boolean);
    commands.sort((a, b) => Number(fs.existsSync(b)) - Number(fs.existsSync(a)));
    for (const command of commands) {
        try {
            return execFileSync(command, args, options);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            missing = error;
        }
    }
    throw missing || new Error('Python is required to composite the sculpture sheet');
}

/**
 * Park the camera at an exact pose, including field of view.
 *
 * FOV is part of the pose and not a constant: these are phone frames, and the
 * crop of one covers 44 to 49 degrees vertically against the page's own 40.
 * Comparing a 40 deg render with a 49 deg photograph makes the model look wrong
 * in its perspective rather than in its shape, which is the opposite of useful.
 *
 * Passed as a real function, NOT as a source string. Playwright treats a string
 * as an expression to evaluate and quietly drops the argument alongside it, so
 * the first version of this sheet rendered all seven views at the page's default
 * camera — seven identical pictures under seven different labels, which is worse
 * than no sheet at all because it looks like evidence.
 */
async function park(page, view) {
    await page.evaluate((v) => {
        const S = window.__SCULPT;
        S.camera.fov = v.fov;
        S.camera.updateProjectionMatrix();
        const target = v.target || [0, v.targetY, 0];
        S.orbit.setTarget(...target, true);
        S.setView(v.yaw, v.pitch, v.distance);
        S.renderer.render(S.scene, S.camera);
    }, view);
}

/** Read the live framebuffer so a valid PNG cannot hide a failed 3D render. */
async function framebufferStats(page) {
    return page.evaluate(() => {
        const state = window.__SCULPT;
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
            const lum = rgba[offset] * 0.2126
                + rgba[offset + 1] * 0.7152
                + rgba[offset + 2] * 0.0722;
            if (rgba[offset + 3] > 240) opaque++;
            min = Math.min(min, lum);
            max = Math.max(max, lum);
            sum += lum;
            sumSq += lum * lum;
            samples++;
        }
        const mean = sum / samples;
        return {
            width, height, samples, opaque, min, max, mean,
            deviation: Math.sqrt(Math.max(0, sumSq / samples - mean * mean)),
        };
    });
}

/**
 * Composite the sheet with Python + Pillow.
 *
 * Written out as a script rather than pulled in as a Node image library for the
 * same reason the artefact itself ships no assets: this repo has no build step
 * and every npm install here has already pruned the hand-written Three stub in
 * node_modules once. Pillow is present and this is thirty lines.
 */
function composite(rows, outPath, cellH) {
    const script = `
import json, sys
from PIL import Image, ImageDraw

rows = json.loads(sys.argv[1])
out_path, cell_h = sys.argv[2], int(sys.argv[3])
BG, INK, DIM = (26, 30, 38), (236, 231, 220), (141, 135, 121)
PAD, LABEL = 14, 26

panels = []
for row in rows:
    imgs = []
    for p in row['images']:
        im = Image.open(p).convert('RGB')
        w = max(1, round(im.width * cell_h / im.height))
        imgs.append(im.resize((w, cell_h), Image.LANCZOS))
    panels.append((row, imgs))

row_w = [sum(i.width for i in imgs) + PAD * (len(imgs) + 1) for _, imgs in panels]
sheet_w = max(row_w)
sheet_h = sum(cell_h + LABEL + PAD for _ in panels) + PAD

sheet = Image.new('RGB', (sheet_w, sheet_h), BG)
draw = ImageDraw.Draw(sheet)
y = PAD
for row, imgs in panels:
    draw.text((PAD, y), row['label'], fill=INK)
    if row.get('note'):
        draw.text((PAD + 260, y), row['note'][:120], fill=DIM)
    y += LABEL
    x = PAD
    for im in imgs:
        sheet.paste(im, (x, y))
        x += im.width + PAD
    y += cell_h + PAD

sheet.save(out_path)
print(f'{sheet.width}x{sheet.height}')
`;
    const tmp = path.join(os.tmpdir(), `sculpt-sheet-${process.pid}.py`);
    fs.writeFileSync(tmp, script);
    try {
        return runPython([tmp, JSON.stringify(rows), outPath, String(cellH)], {
            encoding: 'utf8',
        }).trim();
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.out) {
        console.error('usage: sculpture-sheet.mjs --out <png> [--only id,id] [--cell 620] [--phase4|--phase5|--identity]');
        process.exit(2);
    }

    const only = args.only ? String(args.only).split(',').map((s) => s.trim()) : null;
    const phase4 = Boolean(args.phase4);
    const phase5 = Boolean(args.phase5);
    const identity = Boolean(args.identity);
    if ([phase4, phase5, identity].filter(Boolean).length > 1) {
        throw new Error('--phase4, --phase5 and --identity are mutually exclusive');
    }
    const acceptance = phase4 || phase5 || identity;
    const withPhotos = !args['no-photos'] && !phase4 && !identity;
    const cellH = Number(args.cell || (acceptance ? 400 : 620));
    const dpr = Number(args.dpr || (acceptance ? 1 : 2));
    const settle = Number(args.settle || 350);
    const screenshotTimeout = Number(args['screenshot-timeout'] || 120000);

    const views = (phase4
        ? PHASE4_ACCEPTANCE_VIEWS
        : phase5
            ? PHASE5_ACCEPTANCE_VIEWS
            : identity
                ? IDENTITY_AUDIT_VIEWS
                : [...(withPhotos ? REFERENCE_VIEWS : []), ...REVIEW_VIEWS]
    ).filter((v) => !only || only.includes(v.id));

    if (!views.length) {
        console.error('no views selected');
        process.exit(2);
    }

    const { server, port } = await startServer(REPO_ROOT);
    const url = `http://127.0.0.1:${port}/${PAGE}?three=local`;

    const browser = await chromium.launch({
        executablePath: findChromium(),
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });

    // The viewport is resized per view, so it starts at whatever the first view
    // wants; `isMobile` is off because these are review renders, not device
    // captures, and the mobile flag forces a touch-emulation path we do not want
    // interfering with the camera.
    const context = await browser.newContext({
        viewport: { width: 800, height: 1000 },
        deviceScaleFactor: dpr,
    });

    const consoleErrors = [];
    const pageErrors = [];
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(String(e && e.stack || e)));
    page.on('requestfailed', (r) => consoleErrors.push(`request failed: ${r.url()}`));

    let readyOk = true, readyErr = '';
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction('window.__SCULPT_READY === true', null, { timeout: Number(args.wait || 60000) });
    } catch (err) {
        readyOk = false;
        readyErr = String(err && err.message || err);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sculpt-sheet-'));
    const rows = [];
    const pixelFailures = [];
    let stats = null;

    for (const view of views) {
        const crop = view.crop || null;
        // Match the render's aspect to the photo crop's, so the pair sits at
        // the same scale once both are scaled to the sheet's row height.
        let vw, vh;
        if (view.viewport) {
            [vw, vh] = view.viewport;
        } else {
            const aspect = crop ? crop[2] / crop[3] : 0.82;
            vh = 900;
            vw = Math.round(vh * aspect);
        }
        await page.setViewportSize({ width: vw, height: vh });
        await park(page, view);
        await page.waitForTimeout(settle);
        // Re-park after the settle: the page's own frame loop keeps damping and,
        // after nine idle seconds, starts the slow idle spin. A multi-view
        // sheet takes longer than that.
        await park(page, view);

        const pixels = await framebufferStats(page);
        const render = await page.evaluate(() => (
            window.__SCULPT_STATS ? window.__SCULPT_STATS() : null
        )).catch(() => null);
        const pixelOk = Boolean(pixels
            && pixels.samples >= 100
            && pixels.opaque / pixels.samples > 0.90
            && pixels.max - pixels.min > 12
            && pixels.deviation > 4);
        if (!pixelOk) pixelFailures.push({ view: view.id, pixels });
        console.log(`${view.id}: ${JSON.stringify({ pixels, render })}`);

        const renderPath = path.join(tmpDir, `${view.id}-render.png`);
        // The current mesh is roughly 515k triangles. On software-rendered
        // CI Chromium, readback can legitimately exceed Playwright's 30s
        // default even after the frame itself is ready. Keep readiness and
        // screenshot deadlines separate so a slow PNG readback is not reported
        // as a sculpture failure.
        await page.screenshot({ path: renderPath, timeout: screenshotTimeout });

        const images = [];
        if (crop) {
            const photoPath = path.join(tmpDir, `${view.id}-photo.png`);
            cropPhoto(path.join(REPO_ROOT, 'sculpture/reference', view.photo), crop, photoPath);
            images.push(photoPath);
        }
        images.push(renderPath);

        rows.push({
            label: crop ? `${view.id}   photo | model` : `${view.id}   model only`,
            note: view.note || '',
            images,
        });
    }

    stats = await page.evaluate(() => (window.__SCULPT_STATS ? window.__SCULPT_STATS() : null)).catch(() => null);

    await browser.close();
    server.close();

    const outPath = path.resolve(REPO_ROOT, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const size = composite(rows, outPath, cellH);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(`sheet: ${outPath}  (${size}, ${rows.length} views)`);
    if (stats) console.log('stats: ' + JSON.stringify(stats));
    if (!readyOk) console.error('NOT READY: ' + readyErr);
    if (pageErrors.length) console.error('PAGE ERRORS:\n  ' + pageErrors.join('\n  '));
    if (consoleErrors.length) console.error('CONSOLE ERRORS:\n  ' + consoleErrors.join('\n  '));
    if (pixelFailures.length) console.error('PIXEL CHECK FAILURES: ' + JSON.stringify(pixelFailures));

    const allowConsole = Boolean(args['allow-console-errors']);
    process.exit(!readyOk || pixelFailures.length || pageErrors.length
        || (!allowConsole && consoleErrors.length) ? 1 : 0);
}

function cropPhoto(src, [x, y, w, h], dest) {
    runPython(['-c',
        'import sys;from PIL import Image;'
        + 'Image.open(sys.argv[1]).crop(tuple(int(v) for v in sys.argv[3:7])).save(sys.argv[2])',
        src, dest, String(x), String(y), String(x + w), String(y + h)]);
}

main().catch((err) => { console.error(err); process.exit(1); });
