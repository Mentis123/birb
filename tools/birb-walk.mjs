#!/usr/bin/env node
/**
 * birb-walk.mjs — the bird on its feet: does it walk, steer, reverse, stand
 * still, and does it LOOK like it is doing any of that.
 *
 * The grounded state had a walk cycle and walk controls for months and
 * nothing in the repo drove them. What that cost, found the moment something
 * did:
 *
 *   - The wings never folded. `perchBlend` targeted `isNested` alone, so the
 *     fold, the pulled-in span and the dropped tail existed in the pose
 *     table, were unit-tested in `bird-pose.js`, and could not run outside a
 *     nest. A bird walking on the ground held the full spread-wing glide.
 *   - The body bob moved along WORLD +Y. This is a planet: `position.y` is
 *     only "up" within sight of the north pole, and everywhere else the bob
 *     was a sideways shuffle that got more sideways the further the bird
 *     walked from it.
 *
 * Neither is visible in a screenshot of a bird that happens to be flying, and
 * neither is reachable from a unit test — the rig lives in index.html and the
 * state only exists after a real ground collision. So: drive it.
 *
 * Usage: node tools/birb-walk.mjs [--env forest]
 */

import { chromium, devices } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Frames, never milliseconds. The grounded walk advances per FRAME, and this
// harness runs at a few frames a second under SwiftShader — waiting on the
// wall clock measures the renderer, which is the mistake that made a 3-second
// landing look like a 90-second one.
async function frames(page, n) {
    await page.evaluate((count) => new Promise((resolve) => {
        let seen = 0;
        const tick = () => { seen += 1; if (seen >= count) resolve(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    }), n);
}

const pose = (page) => page.evaluate(() => window.__BIRB.birdPose());
const stick = (page, x, y) => page.evaluate(([a, b]) => window.__BIRB.setStick(a, b), [x, y]);

/** Great-circle distance between two world positions on the planet. */
function arc(a, b) {
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    if (!la || !lb) return 0;
    const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    return Math.acos(Math.max(-1, Math.min(1, dot))) * ((la + lb) / 2);
}

async function main() {
    const args = parseArgs(process.argv);
    const env = String(args.env || 'forest');

    const { server, port } = await startServer(REPO_ROOT);
    const browser = await chromium.launch({ executablePath: findChromium(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({
        ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
    });
    await installCdnCache(context);

    const noise = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => noise.push('page: ' + String((e && e.message) || e)));
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });

    // `quality=amazing`: the baseline preset — this harness counts FRAMES, and at the
    // Ultra default a SwiftShader frame is 2.6 s. See docs/perf/gates/G-ULTRA-DEFAULT.md.
    await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&quality=amazing`, { waitUntil: 'domcontentloaded' });
    await startGame(page, 45000);
    if (env !== 'forest') {
        await page.evaluate((id) => window.__BIRB.setEnvironment(id), env);
        await frames(page, 8);
    }

    const failures = [];
    const check = (ok, msg) => { if (!ok) failures.push(msg); return ok; };

    // ── get on the ground ───────────────────────────────────────────────
    // Drop the bird onto the surface and let checkGroundCollision do the
    // real transition, rather than setting the state directly: the point is
    // to exercise the path a player takes.
    const airborne = await pose(page);
    await page.evaluate(() => window.__BIRB.setAltitude(0.2));
    let grounded = null;
    for (let i = 0; i < 40 && !grounded; i += 1) {
        await frames(page, 3);
        const p = await pose(page);
        if (p && p.recovery === 'grounded') grounded = p;
    }
    if (!check(grounded, 'the bird never reached GROUNDED after being put on the surface')) {
        console.error('FAILED: ' + failures.join('\n  '));
        await browser.close(); server.close(); process.exit(1);
    }
    console.log(`  grounded: recovery=${grounded.recovery} radius=${grounded.radius}`);

    // ── the wings must fold ─────────────────────────────────────────────
    await frames(page, 30);          // perchBlend eases in at ~5/sec
    const settled = await pose(page);
    console.log(`  perchBlend airborne ${airborne.perchBlend} -> grounded ${settled.perchBlend}`);
    check(settled.perchBlend > 0.8,
        `wings did not fold on the ground: perchBlend ${settled.perchBlend} (want > 0.8)`);
    const foldDelta = Math.abs(settled.leftWing.x - airborne.leftWing.x);
    console.log(`  left wing rotation.x ${airborne.leftWing.x} -> ${settled.leftWing.x} (delta ${foldDelta.toFixed(3)})`);
    check(foldDelta > 0.3, `the wing barely moved on landing: delta ${foldDelta.toFixed(3)} rad`);
    check(settled.leftWingSpanZ < 0.75,
        `wing span did not pull in: scale.z ${settled.leftWingSpanZ} (want < 0.75)`);
    // A fold alone is a wide V pointing at the ground. The sweep is what
    // lays the wing back along the body, and it is the half that is easy to
    // drop in a refactor because nothing else in the rig writes rotation.y.
    const sweepDelta = Math.abs(settled.leftWing.y - airborne.leftWing.y);
    console.log(`  left wing rotation.y ${airborne.leftWing.y} -> ${settled.leftWing.y} (sweep ${sweepDelta.toFixed(3)})`);
    check(sweepDelta > 0.3, `the wing did not sweep back on the ground: ${sweepDelta.toFixed(3)} rad`);
    // Mirror rule: the two wings must sweep the same way in world terms,
    // which with the right wing's scale.z = -1 means opposite signs here.
    check(Math.abs((settled.leftWing.y + settled.rightWing.y)) < 1e-3,
        `the wings swept asymmetrically: ${settled.leftWing.y} vs ${settled.rightWing.y}`);

    // ── standing still must not drift ───────────────────────────────────
    await stick(page, null);
    await frames(page, 20);
    const idleA = await pose(page);
    await frames(page, 20);
    const idleB = await pose(page);
    const drift = arc(idleA.position, idleB.position);
    console.log(`  idle drift over 20 frames: ${drift.toFixed(3)} units`);
    check(drift < 0.5, `a bird with no input drifted ${drift.toFixed(3)} units`);

    // ── walking forward must move it, and animate the feet ──────────────
    await stick(page, 0, 1);
    const beforeWalk = await pose(page);
    const footSamples = [];
    for (let i = 0; i < 6; i += 1) { await frames(page, 4); footSamples.push((await pose(page)).leftFoot.x); }
    const afterWalk = await pose(page);
    const walked = arc(beforeWalk.position, afterWalk.position);
    const footSwing = Math.max(...footSamples) - Math.min(...footSamples);
    console.log(`  walked forward ${walked.toFixed(2)} units; foot swing ${footSwing.toFixed(3)} rad`);
    check(walked > 0.8, `pushing the stick forward moved the bird only ${walked.toFixed(2)} units`);
    check(footSwing > 0.15, `the feet did not animate while walking: swing ${footSwing.toFixed(3)} rad`);
    // CLEARANCE, not radius. The raw radius conflates "walked up a hill" with
    // "took off": this world's terrain rolls, the landing spot is unseeded and
    // so differs every run, and a run that landed at radius 105.86 (three
    // consecutive runs either side of it landed at 104.96-105.01) walked 2.5
    // units uphill for a 2.75 rise and failed a 2.5-unit radius tolerance
    // while never leaving the ground. `aboveGround` is sampled from the same
    // carved-terrain function the flight floor and the landing check use, so
    // walking up any slope holds it constant and only actually leaving the
    // surface moves it. See docs/perf/gates/G-WALK-SLOPE.md.
    const clearanceRise = (Number.isFinite(afterWalk.aboveGround) && Number.isFinite(beforeWalk.aboveGround))
        ? afterWalk.aboveGround - beforeWalk.aboveGround
        : null;
    console.log(`  clearance above ground ${beforeWalk.aboveGround} -> ${afterWalk.aboveGround}`
        + ` (radius ${beforeWalk.radius} -> ${afterWalk.radius})`);
    check(clearanceRise !== null,
        'birdPose().aboveGround is missing — the check cannot tell a hill from a takeoff without it');
    check(clearanceRise === null || Math.abs(clearanceRise) < 1.0,
        `the bird left the surface while walking: clearance ${beforeWalk.aboveGround} -> ${afterWalk.aboveGround}`);

    // ── the feet must settle when it stops ──────────────────────────────
    await stick(page, null);
    await frames(page, 24);
    const stopped = await pose(page);
    console.log(`  foot at rest: ${stopped.leftFoot.x}`);
    check(Math.abs(stopped.leftFoot.x) < 0.05, `the feet kept swinging after the stick released: ${stopped.leftFoot.x}`);

    // ── reversing must go the other way ─────────────────────────────────
    await stick(page, 0, 1);
    const fwdA = await pose(page);
    await frames(page, 16);
    const fwdB = await pose(page);
    await stick(page, 0, -1);
    await frames(page, 16);
    const backC = await pose(page);
    // Compare against the forward heading: reversing should take the bird
    // back toward where it came from, so its distance to fwdA must shrink.
    const outbound = arc(fwdA.position, fwdB.position);
    const returned = arc(fwdB.position, backC.position);
    const netFromStart = arc(fwdA.position, backC.position);
    console.log(`  forward ${outbound.toFixed(2)} then back ${returned.toFixed(2)}; net from start ${netFromStart.toFixed(2)}`);
    check(returned > 0.5, `pulling the stick back moved the bird only ${returned.toFixed(2)} units`);
    check(netFromStart < outbound, 'reversing did not bring the bird back toward where it started');

    // ── steering must change the heading ────────────────────────────────
    await stick(page, 1, 1);
    const turnA = await pose(page);
    await frames(page, 20);
    const turnB = await pose(page);
    console.log(`  steering moved the bird ${arc(turnA.position, turnB.position).toFixed(2)} units`);
    check(arc(turnA.position, turnB.position) > 0.3, 'steering while grounded did not move the bird at all');

    await stick(page, null);
    await browser.close();
    server.close();

    if (noise.length) failures.push(`console noise:\n    ${noise.slice(0, 6).join('\n    ')}`);
    if (failures.length) {
        console.error(`FAILED: ${failures.length} problem(s)\n  ` + failures.join('\n  '));
        process.exit(1);
    }
    console.log(`walk ok in ${env}: folds, stands, walks, stops, reverses and steers`);
}

main().catch((err) => { console.error(err); process.exit(1); });
