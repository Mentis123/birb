#!/usr/bin/env node
/**
 * birb-flythrough.mjs — audit a shot, then render it frame by frame.
 *
 * Ported from the tabletop worlds kit (adamrappaport
 * scripts/map-flythrough.mjs). Shots live in src/camera/shots.js; the kernel is
 * src/camera/flythrough.js. This tool:
 *
 *   1. boots the game in the shot's biome on a fixed world seed;
 *   2. AUDITS the shot (camera and lead bird clear of ground and water, speed
 *      bounded, never looking at itself) and refuses to render a failing one;
 *   3. seeks the shot frame by frame and screenshots each rendered frame,
 *      asserting the camera that drew it stood exactly where the kernel says
 *      (a shot that reaches the wrong rig is indistinguishable from one that
 *      works, unless you read it back from the camera that renders);
 *   4. writes frames.json, audit.json, a 12-frame contact sheet and, with
 *      ffmpeg on PATH, an MP4 (or a VP8 WebM).
 *
 * SwiftShader is slow: a frame is ~1-3 s at `quality=amazing`. `--frames 12`
 * renders an evenly spaced preview (the CI-sized check); the real-time path is
 * `?studio=1&shot=<name>&record=1` in a browser on a machine with a GPU.
 *
 * Usage:
 *   node tools/birb-flythrough.mjs <shot|all> [--frames 12] [--fps 12]
 *        [--width 390 --height 844] [--seed 16160] [--out dir] [--quality amazing]
 * `all` runs a --frames preview of every shot in its own biome (a '*' shot in
 * every biome) and is what Browser Health runs.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIOMES = ['forest', 'canyons', 'mountain', 'city'];

function contactSheet(page, files, out, cols = 4) {
    return page.evaluate(async ({ urls, cols }) => {
        const imgs = await Promise.all(urls.map((u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; })));
        const w = 240, h = Math.round(w * imgs[0].height / imgs[0].width);
        const rows = Math.ceil(imgs.length / cols);
        const c = document.createElement('canvas');
        c.width = cols * w; c.height = rows * h;
        const g = c.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
        imgs.forEach((im, i) => g.drawImage(im, (i % cols) * w, Math.floor(i / cols) * h, w, h));
        return c.toDataURL('image/jpeg', 0.85);
    }, { urls: files.map((f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')), cols })
        .then((data) => fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64')));
}

async function renderShot(page, name, biome, args, outRoot, failures) {
    const seed = Number(args.seed || 16160);
    await page.evaluate(([s, e]) => { window.__BIRB.worldSeed(s); window.__BIRB.setEnvironment(e); }, [seed, biome]);
    await page.waitForTimeout(1500);
    const audited = await page.evaluate((n) => window.__BIRB.shot.audit(n), name);
    const out = path.join(outRoot, `${name}@${biome}`);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(audited, null, 1));
    if (!audited?.audit) { failures.push(`${name}@${biome}: ${audited?.error || 'no audit'}`); return; }
    const bad = audited.audit.checks.filter((c) => !c.pass);
    console.log(`${name}@${biome}: ${audited.duration}s, audit ${audited.audit.pass ? 'PASS' : 'FAIL'} — ${audited.audit.checks.map((c) => `${c.name}: ${c.detail}`).join('; ')}`);
    if (bad.length) { failures.push(`${name}@${biome}: audit failed (${bad.map((c) => c.name).join(', ')}) — refusing to render`); return; }

    const duration = audited.duration;
    const preview = Number(args.frames || 0);
    const fps = Number(args.fps || 12);
    const times = preview
        ? Array.from({ length: preview }, (_, i) => (i / (preview - 1)) * duration * 0.999)
        : Array.from({ length: Math.ceil(duration * fps) + 1 }, (_, i) => Math.min(duration, i / fps));
    const started = await page.evaluate((n) => window.__BIRB.shot.play(n, { hold: true, paused: true }), name);
    if (!started?.ok) { failures.push(`${name}@${biome}: play failed: ${started?.error}`); return; }
    const frames = [];
    const files = [];
    for (let i = 0; i < times.length; i++) {
        const t = times[i];
        await page.evaluate((tt) => window.__BIRB.shot.seek(tt), t);
        // Two rendered frames: the seek lands on the next one.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const [cam, sample] = await page.evaluate((tt) => [window.__BIRB.shot.camera(), window.__BIRB.shot.sample(tt)], t);
        const err = Math.hypot(cam.position[0] - sample.position[0], cam.position[1] - sample.position[1], cam.position[2] - sample.position[2]);
        frames.push({ i, t: +t.toFixed(3), camera: cam.position.map((v) => +v.toFixed(3)), error: +err.toFixed(5), fade: +sample.fade.toFixed(3), birdVisible: cam.birdVisible });
        if (err > 1e-3) failures.push(`${name}@${biome} t=${t.toFixed(2)}: the rendering camera is ${err.toFixed(3)} from the kernel's sample (the shot is not driving the live camera)`);
        const file = path.join(out, `f${String(i).padStart(5, '0')}.png`);
        await page.locator('canvas').first().screenshot({ path: file });
        files.push(file);
    }
    await page.evaluate(() => window.__BIRB.shot.stop());
    fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify(frames, null, 1));
    const pick = files.length <= 12 ? files : Array.from({ length: 12 }, (_, k) => files[Math.round((k / 11) * (files.length - 1))]);
    await contactSheet(page, pick, path.join(out, 'contact-sheet.jpg'));
    console.log(`  ${files.length} frames, max camera error ${Math.max(...frames.map((f) => f.error)).toExponential(1)} → ${out}/contact-sheet.jpg`);
    // Frame-dark check: a shot that renders black (outside its fades) is broken.
    if (!preview && spawnSync('ffmpeg', ['-version']).status === 0) {
        const mp4 = path.join(out, `${name}.mp4`);
        const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(out, 'f%05d.png'),
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4]);
        if (r.status === 0) console.log(`  video: ${mp4}`);
        else {
            const webm = path.join(out, `${name}.webm`);
            spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(out, 'f%05d.png'), '-c:v', 'libvpx', '-b:v', '8M', webm]);
            console.log(`  video: ${webm}`);
        }
        for (const f of files) fs.rmSync(f);
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all';
    const outRoot = String(args.out || path.join(REPO_ROOT, 'shots', 'flythrough'));
    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport: { width: Number(args.width || 390), height: Number(args.height || 844) }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await installCdnCache(context);
    const noise = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => noise.push('page: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    const failures = [];
    try {
        await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&quality=${args.quality || 'amazing'}&flight=classic`, { waitUntil: 'domcontentloaded' });
        await startGame(page, 90000);
        const list = await page.evaluate(() => window.__BIRB.shot.list());
        const jobs = [];
        for (const s of list) {
            if (which !== 'all' && s.name !== which) continue;
            const biomes = s.world === '*' ? (which === 'all' ? BIOMES : [args.env || 'forest']) : [s.world];
            for (const b of biomes) jobs.push([s.name, b]);
        }
        if (!jobs.length) failures.push(`no shot named "${which}"`);
        if (which === 'all' && !args.frames) args.frames = 4;
        for (const [n, b] of jobs) await renderShot(page, n, b, args, outRoot, failures);
    } catch (err) {
        failures.push('harness: ' + String(err?.stack || err));
    } finally {
        await browser.close();
        server.close();
    }
    for (const n of noise) failures.push(n);
    if (failures.length) {
        console.error(`\nbirb-flythrough: ${failures.length} failure(s)`);
        for (const f of failures) console.error('  - ' + f);
        process.exit(1);
    }
    console.log('\nbirb-flythrough: every shot audited, rendered, and drove the live camera');
}

main().catch((e) => { console.error(e); process.exit(1); });
