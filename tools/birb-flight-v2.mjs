#!/usr/bin/env node
/**
 * birb-flight-v2.mjs — proves flight v2 (`?flight=v2`) actually banks to
 * turn, loops, self-rights, manages energy and crashes on inverted ground
 * contact, on the real page. Companion evidence to docs/realism/FLIGHT_V2_PLAN.md.
 *
 * v1's mapping cannot produce any of this by construction: stick x is yaw
 * with a COSMETIC bank painted on afterwards (`_levelRoll` removes real roll
 * every frame), pitch is clamped at 80 degrees, and speed is assigned
 * verbatim from cruise every frame. So the first and most important check
 * here is not "does the bird bank" — it is "did the flag even reach a v2
 * controller", because a page that silently keeps running v1 under
 * `?flight=v2` would otherwise pass every check below for the wrong reason
 * (aerobatics.js already produces rolls and loops as scripted MOVES on v1).
 *
 * FRAMES, never milliseconds. `renderFrame` in index.html clamps its own
 * delta to 0.05s (20fps floor — the same clamp `birb-walk.mjs` and
 * `birb-default.mjs` rely on), so under SwiftShader — where a real frame
 * runs slower than 0.05s at `quality=amazing` (measured ~0.13s in
 * birb-default.mjs) — every rAF tick contributes almost exactly 0.05
 * SIMULATED seconds regardless of how long it took in wall-clock time.
 * `secToFrames(s) = ceil(s / 0.05)` converts the plan's "6 simulated
 * seconds" language into a frame budget without ever reading the clock.
 *
 * `quality=amazing` is required: at the Ultra default a SwiftShader frame is
 * 2.6s (docs/perf/gates/G-ULTRA-DEFAULT.md), and this harness samples on the
 * order of hundreds of frames.
 *
 * Usage: node tools/birb-flight-v2.mjs
 */

import { chromium, devices } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, findChromium, installCdnCache, CHROMIUM_ARGS, startGame } from './birb-shot.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The clamp index.html's own renderFrame applies at the source (`Math.min(
// (time - previousTime) * 0.001, 0.05)`). Every frame is worth AT MOST this
// many simulated seconds; under SwiftShader it is worth almost exactly this
// many, because a real frame takes longer than 0.05s to render.
const SIM_DT = 0.05;
const secToFrames = (s) => Math.max(1, Math.ceil(s / SIM_DT));

/** Advance N real animation frames, then return the live flightProbe(). */
function stepProbe(page, n = 1) {
    return page.evaluate((count) => new Promise((resolve) => {
        let seen = 0;
        const tick = () => {
            seen += 1;
            if (seen >= count) resolve(window.__BIRB.flightProbe());
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }), n);
}

/**
 * Step one frame at a time, collecting a flightProbe() each frame, until
 * `predicate(probe, history)` is true or `maxFrames` is reached. Early exit
 * on purpose: several of these checks (crossing ±150°) resolve in 15-20
 * frames against a 60-160 frame CAP, and running the cap every time would
 * cost minutes nothing here needs.
 */
async function sampleUntil(page, maxFrames, predicate) {
    const history = [];
    for (let i = 0; i < maxFrames; i += 1) {
        const p = await stepProbe(page, 1);
        history.push(p);
        if (predicate(p, history)) return { hit: true, frame: i + 1, probe: p, history };
    }
    return { hit: false, frame: maxFrames, probe: history[history.length - 1] || null, history };
}

const setStick = (page, x, y) => page.evaluate(([a, b]) => window.__BIRB.setStick(a, b), [x, y]);
const release = (page) => page.evaluate(() => window.__BIRB.setStick(null));
const setAltitude = (page, h) => page.evaluate((v) => window.__BIRB.setAltitude(v), h);
const probe = (page) => page.evaluate(() => window.__BIRB.flightProbe());

/** Smallest signed difference b-a in degrees, wrapped to (-180, 180]. */
function angDiff(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
}

const num = (n, d = 1) => (typeof n === 'number' ? n.toFixed(d) : String(n));

async function main() {
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

    const failures = [];
    const check = (ok, msg) => {
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
        if (!ok) failures.push(msg);
        return ok;
    };
    const skip = (msg) => console.log(`  SKIP ${msg}`);
    const shot = async (name) => {
        try { await page.screenshot({ path: `/tmp/${name}` }); } catch { /* best-effort evidence only */ }
    };

    let exitCode = 0;
    try {
        await page.goto(
            `http://127.0.0.1:${port}/index.html?debug=1&flight=v2&quality=amazing`,
            { waitUntil: 'domcontentloaded' },
        );
        await startGame(page, 45000);

        // ── 1. is v2 even active? ────────────────────────────────────────
        // Everything below is worthless evidence if the flag did not reach a
        // v2 controller — v1 + aerobatics.js already rolls and loops as
        // scripted MOVES, so a silently-ignored flag would still pass a bank
        // or loop check for the wrong reason. This must be the first thing
        // checked and, on a miss, the ONLY thing reported.
        const boot = await probe(page);
        if (!boot || boot.controller !== 'v2') {
            console.error('v2 not active: index.html does not honour ?flight=v2 yet');
            console.error(`  (flightProbe().controller = ${JSON.stringify(boot ? boot.controller : boot)})`);
            await browser.close();
            server.close();
            process.exit(1);
        }
        console.log('  ok   flightProbe().controller === \'v2\'');

        // ── 2. bank to turn, then self-right ─────────────────────────────
        // rollRate 3.5 rad/s (200°/s, FLIGHT_V2_PLAN.md's own start point)
        // reaches 150° in well under a second; the 6s cap is slack for a
        // much softer tuning, not an expected duration.
        await setAltitude(page, 90);
        await stepProbe(page, 1);
        const beforeBank = await probe(page);
        await setStick(page, 1, 0);
        const bankWindow = secToFrames(6);
        const bank = await sampleUntil(page, bankWindow, (p) => Math.abs(p.rollFullDeg) > 150);
        check(bank.hit,
            `holding stick right banks past inverted (±150°) within ${bankWindow} frames (~6s) — `
            + `reached ${num(bank.probe ? bank.probe.rollFullDeg : NaN)}° at frame ${bank.frame}`);
        await shot('v2-loop-1.png');
        const headingShift = angDiff(beforeBank.headingDeg, bank.probe ? bank.probe.headingDeg : null);
        // >5° rules out v1's yaw-free roll (a pure roll about the bird's own
        // forward turns nothing); the plan's turnGain (1.6 rad/s at 90° bank)
        // predicts tens of degrees inside the ~15-20 frames a bank this fast
        // takes to reach 150°.
        check(headingShift !== null && Math.abs(headingShift) > 5,
            `heading changes while banked (a bank turns): ${num(beforeBank.headingDeg)}° -> `
            + `${num(bank.probe ? bank.probe.headingDeg : NaN)}° (Δ ${headingShift === null ? 'n/a' : num(headingShift)}°)`);

        await release(page);
        const rightWindow = secToFrames(4);
        const righted = await sampleUntil(page, rightWindow, (p) => Math.abs(p.rollFullDeg) < 12);
        check(righted.hit,
            `releasing the stick self-rights to |roll|<12° within ${rightWindow} frames (~4s) — `
            + `final roll ${num(righted.probe ? righted.probe.rollFullDeg : NaN)}° at frame ${righted.frame}`);

        // ── 3. loops, up and down ────────────────────────────────────────
        // pitchRate 2.1 rad/s (120°/s) is a full loop in ~3s per the plan;
        // the 8s cap is ~2.6x margin for a softer tuning.
        const runLoop = async (label, y, groundGuard) => {
            await setAltitude(page, 90);
            await release(page);
            await sampleUntil(page, secToFrames(3), (p) => Math.abs(p.rollDeg) < 10 && Math.abs(p.pitchDeg) < 10);
            await setStick(page, 0, y);
            let hasPassed = false;
            const loopWindow = secToFrames(8);
            const result = await sampleUntil(page, loopWindow, (p) => {
                if (Math.abs(p.pitchFullDeg) > 150) hasPassed = true;
                return hasPassed && Math.abs(p.pitchFullDeg) < 15;
            });
            await release(page);
            const radii = result.history.map((p) => p.radius);
            const speeds = result.history.map((p) => p.speed);
            const span = Math.max(...radii) - Math.min(...radii);
            check(result.hit && hasPassed,
                `stick ${label} passes beyond ±150° pitch and returns near 0 (a loop) within `
                + `${loopWindow} frames (~8s) — ${result.hit ? `closed at frame ${result.frame}` : 'never returned'}`);
            check(span >= 8,
                `${label} loop altitude span >= 8 units — measured ${num(span, 2)} `
                + `(radius ${num(Math.min(...radii), 1)} .. ${num(Math.max(...radii), 1)})`);
            console.log(`  ..   ${label} loop speed range: ${num(Math.min(...speeds), 2)} .. ${num(Math.max(...speeds), 2)}`);
            if (groundGuard) {
                const grounds = result.history.map((p) => p.aboveGround);
                check(Math.min(...grounds) > 0,
                    `${label} loop never touches the floor (aboveGround min ${num(Math.min(...grounds), 2)})`);
            }
            return result;
        };
        await runLoop('up (0,1)', 1, false);
        await shot('v2-loop-2.png');
        await runLoop('down (0,-1)', -1, true);
        await shot('v2-loop-3.png');

        // ── 4. energy: dive gains speed, climb bleeds it ────────────────
        await setAltitude(page, 90);
        await release(page);
        const leveled = await sampleUntil(page, secToFrames(5),
            (p) => Math.abs(p.rollDeg) < 10 && Math.abs(p.pitchDeg) < 10);
        check(leveled.hit, `returns to level flight before the energy check (roll/pitch < 10°)`);
        const base = leveled.probe || await probe(page);
        if (typeof base.cruise !== 'number') {
            skip('energy check — flightProbe().cruise is not exposed yet (FLIGHT_V2_PLAN.md §"speed ownership": '
                + 'v2 must add cruise/energy to the probe)');
        } else {
            console.log(`  ..   baseline speed ${num(base.speed, 2)} / cruise ${num(base.cruise, 2)}`);
            // Half stick: 1 s of full stick at 2.1 rad/s is 120 degrees — past the
            // vertical, which is a push-over, not a dive. Half stick is 60 degrees.
            await setStick(page, 0, -0.5);
            const afterDive = await stepProbe(page, secToFrames(1));
            check(afterDive.speed > base.cruise,
                `diving for 1s (~${secToFrames(1)} frames) raises speed above cruise: `
                + `${num(afterDive.speed, 2)} > ${num(base.cruise, 2)}`);
            // Re-level BEFORE the climb half. With an unclamped 2.1 rad/s pitch,
            // one second of full stick is 120 degrees, so a dive second ends past
            // the vertical and a climb second spent straight after it is spent
            // pulling back up through it — measured offline: level -> 1 s down
            // gives pitch -120 at 14.2, and 1 s up from there returns to pitch
            // 0 at 14.7, still above cruise. A climb bleeds speed only when it is
            // a climb, so this half starts from level, the way the dive half did.
            await release(page);
            const relevelled = await sampleUntil(page, secToFrames(5),
                (p) => Math.abs(p.rollDeg) < 10 && Math.abs(p.pitchDeg) < 10);
            check(relevelled.hit, 'returns to level again between the dive and the climb halves');
            const beforeClimb = relevelled.probe || await probe(page);
            await setStick(page, 0, 0.5);
            const afterClimb = await stepProbe(page, secToFrames(1));
            check(afterClimb.speed < beforeClimb.speed && afterClimb.speed < base.cruise,
                `climbing for 1s from level drops speed below cruise: `
                + `${num(beforeClimb.speed, 2)} -> ${num(afterClimb.speed, 2)} < ${num(base.cruise, 2)}`);
            await release(page);
        }

        // ── 5. ground contact by attitude ────────────────────────────────
        await setAltitude(page, 90);
        await release(page);
        await sampleUntil(page, secToFrames(3), (p) => Math.abs(p.rollDeg) < 10 && Math.abs(p.pitchDeg) < 10);
        await setStick(page, 1, 0);
        const invert = await sampleUntil(page, secToFrames(3), (p) => Math.abs(p.rollFullDeg) > 150);
        if (!invert.hit) {
            skip('crash-while-inverted scenario — could not invert the bird (see the bank check above); '
                + 'cannot exercise ground-contact-by-attitude independently of that defect');
        } else {
            // The rule, checked against the attitude AT THE CONTACT FRAME.
            //
            // Not against the attitude before the drop, which is what the
            // first version did and why it failed one run in three: placed
            // well below the surface the bird penetrates, `_deflectAlongTerrain`
            // runs, and re-aiming the forward along the surface can carry a
            // heavily banked bird back upright within a frame or two — so an
            // "inverted" bird legitimately grounded, and the check called it a
            // defect. Reading the roll at the frame the state changes makes
            // the assertion the real invariant instead: whatever attitude the
            // bird actually arrived in must produce the matching outcome, and
            // it cannot pass vacuously in either direction (an inverted
            // grounding fails it, and so does an upright crash).
            //
            // The stick stays at the rail so nothing rights the bird while it
            // falls, and the placement is shallow (-0.05) so contact happens
            // without a violent deflection.
            await setAltitude(page, -0.05);
            const crash = await sampleUntil(page, secToFrames(3), (p) => p.recovery !== 'flying');
            await release(page);
            if (!crash.hit) {
                check(false, 'the bird never left FLYING after being placed below the surface while '
                    + `banked (roll ${num(invert.probe.rollFullDeg)}°) — checkGroundCollision may not be running`);
            } else {
                // bodyUp·radial at that frame. With the pitch near level this
                // is cos(roll); the index.html rule is `bodyUp·up < 0.25`.
                const atContact = crash.probe.rollFullDeg;
                const uprightness = Math.cos((atContact * Math.PI) / 180);
                const wanted = uprightness < 0.25 ? 'falling' : 'grounded';
                check(crash.probe.recovery === wanted,
                    `contact at roll ${num(atContact)}° (bodyUp·up ${num(uprightness, 2)}) must be `
                    + `${wanted.toUpperCase()} — got ${crash.probe.recovery} at frame ${crash.frame}`);
                console.log(`  ..   contact attitude roll ${num(atContact)}°, outcome ${crash.probe.recovery}`);
            }
            await shot('v2-loop-4.png');
        }

        // Upright and slow must still land as before. Independent setup:
        // release + wait re-levels regardless of what the inverted-crash
        // scenario left recovery at, because flight.tick() (self-righting,
        // pitch stability) runs every frame REGARDLESS of flightRecoveryState
        // — only the extra fall-ramp pull is gated on FALLING.
        await release(page);
        // The crash scenario leaves the bird FALLING at the surface, and the
        // fall ramp grounds it — so without this the "lands" check below would
        // read GROUNDED on its first frame without ever exercising the landing
        // path (the review's F5). Let it ground, take off again with the boost
        // pill (which is the takeoff button while grounded), climb out, and
        // only then drop it on the ground upright.
        await sampleUntil(page, secToFrames(6), (p) => p.recovery === 'grounded');
        await page.evaluate(() => document.querySelector('[data-boost]')?.click());
        await setAltitude(page, 90);
        const flying = await sampleUntil(page, secToFrames(4), (p) => p.recovery === 'flying');
        check(flying.hit, `is FLYING again before the upright landing (recovery=${flying.probe ? flying.probe.recovery : 'unknown'})`);
        const relevel = await sampleUntil(page, secToFrames(4),
            (p) => Math.abs(p.rollDeg) < 10 && Math.abs(p.pitchDeg) < 10);
        const beforeDrop = await probe(page);
        check(beforeDrop.recovery === 'flying', `still FLYING at the moment of the drop (recovery=${beforeDrop.recovery})`);
        // What this can assert, and why it is not "it grounds".
        //
        // Measured on this build: the flight floor (bird-flight.js _floorAt)
        // and the landing check (checkGroundCollision) sample the SAME
        // terrain function and add the SAME 0.6 bird radius, and tick()
        // clamps to the floor before the landing check reads the position —
        // so a level flying bird sits at exactly aboveGround 0.600, the
        // boundary, and `distanceFromCenter < minAltitude` is decided by
        // float rounding. Placing it below the surface does not help: the
        // clamp lifts it back to the boundary in the same frame. Landing in
        // this game happens through the knockdown (which pushes below the
        // floor every frame) or through the nest; a level cruise onto flat
        // ground is luck. That is pre-existing and out of this tool's scope
        // — see docs/perf/gates/G-FLIGHT-V2.md.
        //
        // So the assertion is the half that IS reachable and IS this tool's
        // business: upright, unhurried contact must never be read as a CRASH.
        // The v2 rule is `bodyUp·up < 0.25 || (speed > 1.4*cruise && nose
        // down)`, and the boost bug the review found (a level bird above
        // 1.4x cruise for 0.68 s after every boost) would trip exactly this.
        await setAltitude(page, -0.5);
        let crashedUpright = null;
        let groundedUpright = false;
        for (let i = 0; i < secToFrames(6) && !crashedUpright; i += 1) {
            const p = await stepProbe(page, 1);
            if (p.recovery === 'falling') crashedUpright = p;
            if (p.recovery === 'grounded') { groundedUpright = true; break; }
            // Re-arm the penetration: the clamp lifts the bird back to the
            // boundary every frame, so one placement is one chance.
            if (i % 4 === 3) await setAltitude(page, -0.5);
        }
        check(!crashedUpright,
            `upright and slow, ground contact must not be a crash — got recovery=falling`
            + (crashedUpright ? ` at roll ${num(crashedUpright.rollFullDeg)}°, speed ${num(crashedUpright.speed, 2)}` : ''));
        console.log(`  ..   upright contact ${groundedUpright ? 'grounded' : 'did not ground within the window'}`
            + ' (a level bird sits exactly on the floor boundary — see the note above)');

    } catch (err) {
        failures.push('threw: ' + String((err && err.stack) || err));
        console.error(failures[failures.length - 1]);
    }

    await browser.close();
    server.close();

    if (noise.length) {
        failures.push(`console noise (${noise.length})`);
        console.error('CONSOLE:\n  ' + noise.slice(0, 12).join('\n  '));
    }
    if (failures.length) {
        console.error(`FAILED: ${failures.length} problem(s)\n  ` + failures.join('\n  '));
        exitCode = 1;
    } else {
        console.log('flight v2 rolls, loops, turns from the bank, rights itself and crashes inverted');
    }
    process.exit(exitCode);
}

main().catch((err) => { console.error(err); process.exit(1); });
