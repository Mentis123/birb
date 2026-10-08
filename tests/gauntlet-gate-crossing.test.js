/**
 * tests/gauntlet-gate-crossing.test.js — a gate counts when you fly THROUGH it.
 *
 * The bug this pins: a gate used to be filed the moment a racer came within
 * RACE_CONFIG.gateRadius (11) of its centre, up to 11 units BEFORE the gate
 * plane. recordGate then reset the sub-gate fraction to the credited gate,
 * but the racer was still short of it, so race-logic read it one whole gate
 * ahead until it actually crossed the plane, then dropped it back by a gate.
 * Measured in a headless race: credits a mean 9.3 units early, progress drops
 * of ~1 gate after almost every credit, the player's HUD place changing 22
 * times in 30 s.
 *
 * The rule now: a gate counts on the frame the racer's course t reaches or
 * passes the gate's t (a forward step, not a warp in t or in the world), and
 * only if the path crosses the plane inside gateRadius of the centre — the
 * crossing point interpolated along the step, not either sample. Grid slots
 * and warps start the history with seedGateCrossing. One pure helper, race-logic's
 * passGate, makes that call for the player (index.html) and the rivals
 * (ai-racer.js) alike.
 *
 * node --test, no DOM. The rival scenarios drive ai-racer's real update()
 * through the same hand-written THREE stub the bird tests use.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, Quaternion, Matrix4 } from 'three';

import * as RL from '../gauntlet/src/race/race-logic.js';
import { createAIRacers, AI_CONFIG } from '../gauntlet/src/race/ai-racer.js';
import { floorRadius } from '../gauntlet/src/core/terrain.js';

const { createRaceState, startRace, recordGate, updateRacerT, racerProgress, RACE_CONFIG } = RL;

const TAU = Math.PI * 2;
const G = 12;
/** Top speed 58 u/s at the 50 ms dt cap: the longest step a racer can take. */
const MAX_STEP = 58 * 0.05;

function needPassGate() {
    assert.equal(typeof RL.passGate, 'function',
        'race-logic must export passGate, the one gate-crossing rule both the player and the rivals use');
}

// ---------------------------------------------------------------------------
// A flat circular lap for the pure-helper tests: t -> angle, gate g at g/G.
// ---------------------------------------------------------------------------

const LAP = 640;
const RC = LAP / TAU;

function flatGates(n = G) {
    const out = new Float64Array(n * 3);
    for (let g = 0; g < n; g++) {
        const a = TAU * g / n;
        out[g * 3] = RC * Math.cos(a); out[g * 3 + 1] = 0; out[g * 3 + 2] = RC * Math.sin(a);
    }
    return out;
}

/** World position at lap-t, `lat` units outward from the centreline, `up` units above it. */
function flatPos(t, lat, up, out) {
    const a = TAU * t;
    out.x = (RC + lat) * Math.cos(a); out.y = up; out.z = (RC + lat) * Math.sin(a);
    return out;
}
const flatT = (p) => { const t = Math.atan2(p.z, p.x) / TAU; return t - Math.floor(t); };

/**
 * One frame for racer `i`, in the order both callers use: sub-gate progress
 * first, then the gate rule. Returns the gate that counted, or -1.
 */
function frame(s, i, p, nowMs, gates) {
    const t = flatT(p);
    updateRacerT(s, i, t);
    return RL.passGate(s, i, t, p.x, p.y, p.z, gates, nowMs);
}

/** Like frame(), but with an exact course t (atan2 does not round-trip g/G exactly). */
function frameT(s, i, t, lat, nowMs, gates) {
    const p = flatPos(t, lat, 0, { x: 0, y: 0, z: 0 });
    updateRacerT(s, i, t);
    return RL.passGate(s, i, t, p.x, p.y, p.z, gates, nowMs);
}

function race(racerCount = 1) {
    const s = createRaceState({ laps: 3, gateCount: G, racerCount });
    startRace(s, 0);
    return s;
}

// ---------------------------------------------------------------------------
// the rule itself
// ---------------------------------------------------------------------------

test('a racer inside the radius but short of the gate plane is not credited', () => {
    needPassGate();
    const s = race();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    const gateT = 1 / G;
    let insideBefore = 0, credit = -1, creditT = -1;
    for (let k = 0; k < 200 && credit < 0; k++) {
        const t = 0.02 + k * (MAX_STEP / LAP);
        flatPos(t, 0, 0, p);
        const before = RL.forwardT(t, gateT) > 0 && RL.forwardT(t, gateT) < 0.5;
        const dx = p.x - gates[3], dz = p.z - gates[5];
        if (before && dx * dx + dz * dz < RACE_CONFIG.gateRadius ** 2) insideBefore++;
        const g = frame(s, 0, p, k * 50, gates);
        if (g >= 0) { credit = g; creditT = t; }
        if (before) assert.equal(g, -1, `credited ${((gateT - t) * LAP).toFixed(1)} units before the plane`);
    }
    assert.ok(insideBefore >= 3, 'the approach really did spend frames inside the radius: ' + insideBefore);
    assert.equal(credit, 1, 'and the gate counts once the plane is crossed');
    assert.ok(RL.forwardT(gateT, creditT) * LAP <= MAX_STEP + 1e-9, 'on the crossing frame, not later');
    assert.equal(s.nextGate[0], 2);
});

test('progress is monotonic flying straight through several gates (no drop after a credit)', () => {
    needPassGate();
    const s = race();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    let last = racerProgress(s, 0), worstDrop = 0, credits = 0;
    for (let k = 0; k < Math.ceil(1.6 * LAP / MAX_STEP); k++) {
        flatPos(k * MAX_STEP / LAP, 3, 2, p);
        if (frame(s, 0, p, k * 50, gates) >= 0) credits++;
        const now = racerProgress(s, 0);
        worstDrop = Math.max(worstDrop, last - now);
        last = now;
    }
    assert.ok(worstDrop <= 1e-12, 'progress dropped by ' + (worstDrop * G).toFixed(3) + ' gate spans');
    assert.equal(credits, G + Math.floor(0.6 * G), 'every ring flown through counted, in order');
    assert.equal(s.lap[0], 2, 'and crossing gate 0 closed lap 1');
});

test('skipping a ring still does not count, and neither does the next one', () => {
    needPassGate();
    const s = race();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    // Around gate 1 twenty units wide of the centre (the ring is radius 9),
    // then dead through the middle of gate 2.
    for (let k = 0; k < Math.ceil(2.5 * LAP / G / MAX_STEP); k++) {
        const t = 0.02 + k * MAX_STEP / LAP;
        const lat = t < 1.5 / G ? 20 : 0;
        assert.equal(frame(s, 0, flatPos(t, lat, 0, p), k * 50, gates), -1, 'credited at t=' + t.toFixed(4));
    }
    assert.equal(s.gatesPassed[0], 0);
    assert.equal(s.nextGate[0], 1, 'still owes gate 1');
});

test('at top speed a ring flown through is never missed, at any frame phase', () => {
    needPassGate();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    // Lateral 10.5 / vertical 3 sit outside the visible ring (radius 9) but
    // inside the 11-unit counting radius: generous, as it was.
    for (const [lat, up] of [[0, 0], [5, -2], [9, 0], [0, 9], [10.5, 0], [6, 7]]) {
        for (let phase = 0; phase < 16; phase++) {
            const s = race();
            const t0 = 0.01 + (phase / 16) * MAX_STEP / LAP;
            for (let k = 0; k < Math.ceil(1.05 * LAP / MAX_STEP); k++) {
                frame(s, 0, flatPos(t0 + k * MAX_STEP / LAP, lat, up, p), k * 50, gates);
            }
            assert.equal(s.gatesPassed[0], G, `lat ${lat} up ${up} phase ${phase}: ${s.gatesPassed[0]} of ${G} rings`);
            assert.equal(s.lap[0], 2, 'gate 0 closed the lap');
        }
    }
});

test('a teleport or a backward pass across a plane is not a crossing', () => {
    needPassGate();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    const gateT = 1 / G;

    // Teleport: from a third of a span short of gate 1 to one unit past it.
    let s = race();
    frame(s, 0, flatPos(gateT - 0.3 / G, 0, 0, p), 0, gates);
    assert.equal(frame(s, 0, flatPos(gateT + 1 / LAP, 0, 0, p), 50, gates), -1);
    assert.equal(s.gatesPassed[0], 0, 'a jump that skips the approach does not count');

    // Backwards through the plane, then forwards again: only the forward pass counts.
    s = race();
    frame(s, 0, flatPos(gateT + 2 / LAP, 0, 0, p), 0, gates);
    assert.equal(frame(s, 0, flatPos(gateT - 1 / LAP, 0, 0, p), 50, gates), -1, 'reversing through it');
    assert.equal(frame(s, 0, flatPos(gateT + 1 / LAP, 0, 0, p), 100, gates), 1, 'flying back through it forwards');
});

/** Distance from `p` to gate `g`'s centre. */
function gateDist(p, gates, g) {
    const dx = p.x - gates[g * 3], dy = p.y - gates[g * 3 + 1], dz = p.z - gates[g * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

test('the radius is judged where the path crosses the plane, not at either frame endpoint', () => {
    needPassGate();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    const gateT = 1 / G;
    const r = RACE_CONFIG.gateRadius;

    // A legal top-speed step straddling the plane 10.99 out: both endpoints
    // sit just outside 11, the crossing itself just inside. It counts.
    let s = race();
    const half = (MAX_STEP / 2) / LAP;
    frame(s, 0, flatPos(gateT - half, 10.99, 0, p), 0, gates);
    assert.ok(gateDist(p, gates, 1) > r, 'the sample before the plane is outside the radius: ' + gateDist(p, gates, 1));
    const g = frame(s, 0, flatPos(gateT + half, 10.99, 0, p), 50, gates);
    assert.ok(gateDist(p, gates, 1) > r, 'so is the sample after it: ' + gateDist(p, gates, 1));
    assert.equal(g, 1, 'a ring flown through 10.99 out counts');

    // Starting inside the radius but drifting out as it goes: the crossing is
    // 11.8 out. One endpoint inside is not enough; it does not count.
    s = race();
    frame(s, 0, flatPos(gateT - 2.0 / LAP, 10.5, 0, p), 0, gates);
    assert.ok(gateDist(p, gates, 1) < r, 'the sample before the plane is inside the radius');
    assert.equal(frame(s, 0, flatPos(gateT + 0.9 / LAP, 12.4, 0, p), 50, gates), -1,
        'crossing the plane 11.8 out does not count');
    assert.equal(s.gatesPassed[0], 0);
});

test('a warp is never a crossing: a short step in t is not a short step in the world', () => {
    needPassGate();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    const gateT = 1 / G;

    // From dead centre, two units short of the plane, to 200 units straight up.
    let s = race();
    frame(s, 0, flatPos(gateT - 1 / LAP, 0, 0, p), 0, gates);
    assert.equal(frame(s, 0, flatPos(gateT + 1 / LAP, 0, 200, p), 50, gates), -1, 'a warp straight up out of the ring');

    // From 40 out on one side to 40 out on the other in one frame: the
    // straight line between them crosses the plane dead centre.
    s = race();
    frame(s, 0, flatPos(gateT - 1 / LAP, -40, 0, p), 0, gates);
    assert.equal(frame(s, 0, flatPos(gateT + 1 / LAP, 40, 0, p), 50, gates), -1, 'an 80-unit jump across the ring');
    assert.equal(s.gatesPassed[0], 0);
});

test('the step limits are derived from the 50 ms dt cap, which the player and the rivals both use', () => {
    needPassGate();
    assert.equal(RACE_CONFIG.maxDt, 0.05, 'race-logic knows the frame-loop dt cap');
    assert.ok(RACE_CONFIG.maxRacerSpeed >= 54, 'and a top speed at or above the player boost ceiling (54)');
    const legal = RACE_CONFIG.maxRacerSpeed * RACE_CONFIG.maxDt;
    assert.ok(RACE_CONFIG.gateCrossMaxStep >= 2 * legal, `world step bound ${RACE_CONFIG.gateCrossMaxStep} vs a legal ${legal}`);
    assert.ok(RACE_CONFIG.gateCrossMaxStep < 2 * RACE_CONFIG.gateRadius, 'but too short to jump a ring');
    // The worst legal step in lap-t: a capped step on the inside of the
    // hairpin (laneMax off-line at kappaNorm curvature) on a 600-unit lap.
    const worstT = legal / (1 - AI_CONFIG.laneMax * AI_CONFIG.kappaNorm) / 600;
    assert.ok(RACE_CONFIG.gateCrossMaxT >= 2 * worstT, `gateCrossMaxT ${RACE_CONFIG.gateCrossMaxT} vs a legal ${worstT.toFixed(4)}`);

    const html = readFileSync(new URL('../gauntlet/index.html', import.meta.url), 'utf8');
    const playerCap = html.match(/Math\.min\(Math\.max\(rawDt, 0\), ([\d.]+)\)/);
    assert.ok(playerCap, 'index.html caps the frame dt');
    assert.equal(Number(playerCap[1]), RACE_CONFIG.maxDt, 'at maxDt');
    const ai = readFileSync(new URL('../gauntlet/src/race/ai-racer.js', import.meta.url), 'utf8');
    const aiCap = ai.match(/if \(dt > ([\d.]+)\) dt = ([\d.]+);/);
    assert.ok(aiCap && aiCap[1] === aiCap[2], 'ai-racer caps its dt');
    assert.equal(Number(aiCap[1]), RACE_CONFIG.maxDt, 'at maxDt too');
    assert.match(html, /ai\.update\(dt,/, 'and the rivals are stepped with the capped frame dt');
});

test('a long but legal capped step through a ring counts, on the inside line and out wide', () => {
    needPassGate();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    const gateT = 1 / G;
    const legal = RACE_CONFIG.maxRacerSpeed * RACE_CONFIG.maxDt;
    for (const lat of [-7.6, 0, 7.6, 10.5]) {
        // A step of exactly `legal` world units along an arc `lat` off the
        // centreline, landing a hair past the plane.
        const dtStep = legal / (TAU * (RC + lat));
        const s = race();
        frame(s, 0, flatPos(gateT - dtStep + 1e-6, lat, 0, p), 0, gates);
        assert.equal(frame(s, 0, flatPos(gateT + 1e-6, lat, 0, p), 50, gates), 1, `lat ${lat}: a ${legal.toFixed(2)}-unit step`);
    }
});

test('seedGateCrossing: the first racing step can cross a due gate, even landing exactly on its t', () => {
    needPassGate();
    assert.equal(typeof RL.seedGateCrossing, 'function', 'race-logic exports seedGateCrossing');
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    const gateT = 1 / G;
    for (const landT of [gateT, gateT + 1 / LAP]) {
        const s = createRaceState({ laps: 3, gateCount: G, racerCount: 1 });
        // Countdown: the racer holds a grid slot two units short of gate 1
        // (contrived, so a due gate is one step away), jittering backwards.
        flatPos(gateT - 2 / LAP, 0, 0, p);
        RL.seedGateCrossing(s, 0, gateT - 2 / LAP + 0.003, p.x, p.y, p.z);
        RL.seedGateCrossing(s, 0, gateT - 2 / LAP, p.x, p.y, p.z);
        assert.equal(s.wrongAccum[0], 0, 'seeding never feeds the wrong-way accumulator');
        assert.equal(s.wrongWay[0], 0);
        assert.equal(s.gatesPassed[0], 0, 'nor awards a gate');
        startRace(s, 1000);
        // The very first movement step lands on (or just past) the gate.
        assert.equal(frameT(s, 0, landT, 0, 1016, gates), 1,
            'first step to t ' + (landT === gateT ? 'exactly on the gate' : 'just past the gate'));
        assert.equal(s.wrongWay[0], 0);
    }
});

// ---------------------------------------------------------------------------
// gate edge cases
// ---------------------------------------------------------------------------

/** Fly racer 0 forward from t0 to t1 in legal steps at `lat`. Returns the credits. */
function fly(s, gates, t0, t1, lat = 0, nowMs = 0) {
    const p = { x: 0, y: 0, z: 0 };
    const out = [];
    const n = Math.ceil((t1 - t0) * LAP / MAX_STEP);
    for (let k = 0; k <= n; k++) {
        const t = t0 + (t1 - t0) * k / n;
        const g = frame(s, 0, flatPos(t, lat, 0, p), nowMs + k * 50, gates);
        if (g >= 0) out.push(g);
    }
    return out;
}

test('gate 0 while gate 1 is due: leaving the grid across the line is no lap credit', () => {
    const gates = flatGates();
    const s = race();
    assert.deepEqual(fly(s, gates, 0.97, 1.03), [], 'crossing the start line off the grid counts nothing');
    assert.equal(s.lap[0], 1);
    assert.equal(s.gatesPassed[0], 0);
    assert.equal(s.lapTimes[0], -1, 'no lap split');
    assert.equal(s.nextGate[0], 1);
});

test('a due gate 0 counts across the lap seam, and when a step lands exactly on t = 0', () => {
    const gates = flatGates();
    for (const land of [0, 0.002]) {
        const s = race();
        for (let g = 1; g < G; g++) recordGate(s, 0, g, 100 * g);
        assert.equal(s.nextGate[0], 0);
        frameT(s, 0, 1 - 1.5 / LAP, 0, 5000, gates);
        assert.equal(frameT(s, 0, land, 0, 5050, gates), 0, 'landing at t ' + land);
        assert.equal(s.lap[0], 2, 'lap 1 closed');
        assert.equal(s.lapTimes[0], 5050);
    }
});

test('the final gate 0 finishes the race exactly once; nothing counts after it', () => {
    const gates = flatGates();
    const s = createRaceState({ laps: 1, gateCount: G, racerCount: 1 });
    startRace(s, 0);
    const credits = fly(s, gates, 0.01, 1.005);
    assert.equal(credits.length, G);
    assert.equal(credits[G - 1], 0);
    assert.equal(s.finished[0], 1);
    assert.equal(s.finishedCount, 1);
    const finishMs = s.finishMs[0];
    const passed = s.gatesPassed[0];
    // A second lap after the flag.
    assert.deepEqual(fly(s, gates, 1.005, 2.01, 0, 1e6), [], 'no credits after finishing');
    assert.equal(s.finishedCount, 1, 'one finish');
    assert.equal(s.finishMs[0], finishMs, 'finish time fixed');
    assert.equal(s.gatesPassed[0], passed);
});

test('an already-credited gate crossed backwards and then forwards again is not counted twice', () => {
    const gates = flatGates();
    const s = race();
    const gateT = 1 / G;
    assert.deepEqual(fly(s, gates, 0.02, gateT + 3 / LAP), [1]);
    // Back through gate 1 and forward through it again.
    assert.deepEqual(fly(s, gates, gateT + 3 / LAP, gateT - 3 / LAP), []);
    assert.deepEqual(fly(s, gates, gateT - 3 / LAP, gateT + 3 / LAP), []);
    assert.equal(s.gatesPassed[0], 1);
    assert.equal(s.nextGate[0], 2);
});

test('a due gate flown through forwards while WRONG WAY is still showing counts', () => {
    const gates = flatGates();
    const s = race();
    const g2 = 2 / G;
    const p = { x: 0, y: 0, z: 0 };
    // Through gate 1, then twenty units wide of gate 2: it is skipped.
    fly(s, gates, 0.02, g2 - 0.03);
    fly(s, gates, g2 - 0.03, g2 + 0.02, 20);
    assert.equal(s.nextGate[0], 2, 'gate 2 was skipped');
    // Turn round and fly back across its plane (backwards does not count).
    let k = 0;
    for (let t = g2 + 0.02; t > g2 - 0.002; t -= 0.001) {
        assert.equal(frame(s, 0, flatPos(t, t > g2 + 0.005 ? 20 : 0, 0, p), 1e4 + 50 * k++, gates), -1);
    }
    assert.equal(s.wrongWay[0], 1, 'WRONG WAY is up');
    // And forward again, straight through it.
    let credited = -1, wrongAtCredit = -1;
    for (let t = g2 - 0.002; t < g2 + 0.003 && credited < 0; t += 0.0007) {
        credited = frame(s, 0, flatPos(t, 0, 0, p), 1e4 + 50 * k++, gates);
        if (credited >= 0) wrongAtCredit = s.wrongWay[0];
    }
    assert.equal(credited, 2, 'the due gate counts');
    assert.equal(wrongAtCredit, 1, 'while the wrong-way hysteresis is still holding');
});

test('reset and warps reseed the crossing history', () => {
    needPassGate();
    const gates = flatGates();
    const p = { x: 0, y: 0, z: 0 };
    const gateT = 1 / G;

    // A sample just short of gate 1, then the race is reset and restarted.
    let s = race();
    frame(s, 0, flatPos(gateT - 1 / LAP, 0, 0, p), 0, gates);
    RL.resetRaceState(s);
    startRace(s, 1000);
    assert.equal(frame(s, 0, flatPos(gateT + 1 / LAP, 0, 0, p), 1050, gates), -1,
        'the pre-reset sample is forgotten: the first one after it only seeds');
    assert.equal(s.gatesPassed[0], 0);

    // After a finish: reset, seed on the grid, race again.
    s = createRaceState({ laps: 1, gateCount: G, racerCount: 1 });
    startRace(s, 0);
    fly(s, gates, 0.01, 1.005);
    assert.equal(s.finished[0], 1);
    RL.resetRaceState(s);
    flatPos(0.98, 0, 0, p);
    RL.seedGateCrossing(s, 0, flatT(p), p.x, p.y, p.z);
    startRace(s, 0);
    assert.deepEqual(fly(s, gates, -0.02, gateT + 2 / LAP), [1], 'a fresh race counts from gate 1');
    assert.equal(s.finished[0], 0);

    // A warp BACK from beyond gate 1 (never credited) to just short of it,
    // reseeded there, then one ordinary step through it. That step counts,
    // and the 0.07-lap jump backwards was never read as wrong-way travel.
    s = race();
    frame(s, 0, flatPos(0.15, 0, 0, p), 0, gates);
    flatPos(gateT - 1 / LAP, 0, 0, p);
    RL.seedGateCrossing(s, 0, flatT(p), p.x, p.y, p.z);
    assert.equal(s.wrongAccum[0], 0);
    assert.equal(frame(s, 0, flatPos(gateT + 1 / LAP, 0, 0, p), 100, gates), 1, 'flying on from the warp');
    // And a warp straight past the due gate, reseeded, is no credit.
    s = race();
    frame(s, 0, flatPos(gateT - 1 / LAP, 0, 0, p), 0, gates);
    flatPos(gateT + 1 / LAP, 0, 0, p);
    RL.seedGateCrossing(s, 0, flatT(p), p.x, p.y, p.z);
    assert.equal(frame(s, 0, flatPos(gateT + 2 / LAP, 0, 0, p), 100, gates), -1, 'warped past it');
    assert.equal(s.nextGate[0], 1);
});

test('sub-gate fraction boundaries: within one span behind the last gate reads 0, the next gate itself holds', () => {
    const span = 1 / G;
    const s = race(1);
    recordGate(s, 0, 1, 100);                    // last gate 1 (t = span), next gate 2
    const at = (t) => { updateRacerT(s, 0, t); return s.subT[0]; };
    assert.equal(at(span), 0, 'on the last gate');
    assert.ok(Math.abs(at(span + span / 2) - span / 2) < 1e-12, 'half a span past it');
    assert.equal(at(2 * span), span * 0.999, 'exactly on the next gate, not yet counted: held just under it');
    assert.equal(at(2.5 * span), span * 0.999, 'overshot it: held');
    assert.equal(at(span - 1e-6), 0, 'a hair behind the last gate: 0');
    assert.equal(at(0), 0, 'exactly one span behind (fwd === 1 - span): 0');
    assert.equal(at(1 - span / 2), span * 0.999, 'more than a span behind: held, as any far-off reading is');
});

test('a racer slightly behind its last credited gate reads 0 past it, never a full span', () => {
    const s = race(2);
    // Racer 0 on the grid, a touch behind the start line (as the rivals line up).
    updateRacerT(s, 0, 1 - 0.004);
    assert.ok(racerProgress(s, 0) < 1e-9,
        'behind the line on the grid reads ' + (racerProgress(s, 0) * G).toFixed(3) + ' gate spans, not 0');
    // Racer 1 credited gate 1 and then reads a few units short of it.
    recordGate(s, 1, 1, 100);
    updateRacerT(s, 1, 1 / G - 3 / LAP);
    const p = racerProgress(s, 1);
    assert.ok(Math.abs(p - 1 / G) < 1e-9,
        'short of its last gate it reads ' + ((p - 1 / G) * G).toFixed(3) + ' spans past it, not 0');
    // Overshooting the next gate without it counting still holds below it.
    updateRacerT(s, 1, 2.5 / G);
    assert.ok(racerProgress(s, 1) < 2 / G);
});

// ---------------------------------------------------------------------------
// the rivals, through ai-racer's real update()
// ---------------------------------------------------------------------------

class V3 extends Vector3 {
    get isVector3() { return true; }
    subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
}
class Group {
    constructor() { this.name = ''; this.position = new V3(); this.quaternion = new Quaternion(); this.children = []; }
    add(o) { this.children.push(o); }
}
class Color {
    setHex(h) { this.r = (h >> 16 & 255) / 255; this.g = (h >> 8 & 255) / 255; this.b = (h & 255) / 255; return this; }
    lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
    getHex() { return (Math.round(this.r * 255) << 16) | (Math.round(this.g * 255) << 8) | Math.round(this.b * 255); }
    constructor(h = 0) { this.setHex(h); }
}
const STUB_THREE = { Vector3: V3, Quaternion, Matrix4, Group, Color };

function stubBird() {
    const node = () => ({ position: new V3(), rotation: { x: 0, y: 0, z: 0 }, scale: new V3(1, 1, 1) });
    const uniforms = new Proxy({}, { get: (u, k) => (u[k] ??= { value: 0 }) });
    return {
        group: new Group(),
        parts: { body: node(), head: node(), leftWing: node(), rightWing: node() },
        uniforms,
        dispose() {},
    };
}

/** An equatorial great circle riding the real terrain floor, with 12 gates on it. */
function gatedCourse() {
    const at = (t, out) => {
        const a = TAU * t, x = Math.cos(a), z = Math.sin(a);
        return out.set(x, 0, z).multiplyScalar(floorRadius(x, 0, z) + AI_CONFIG.floorClear);
    };
    const a = new V3(), b = new V3();
    const gateT = new Float32Array(G), gatePositions = new Float32Array(G * 3);
    for (let g = 0; g < G; g++) {
        gateT[g] = g / G;
        at(g / G, a);
        gatePositions[g * 3] = a.x; gatePositions[g * 3 + 1] = a.y; gatePositions[g * 3 + 2] = a.z;
    }
    return {
        length: TAU * 100,
        gateCount: G,
        gateT,
        gatePositions,
        sampleAt: at,
        tangentAt(t, out) { at(t + 1e-4, a); at(t - 1e-4, b); return out.subVectors(a, b).normalize(); },
        nearestT(x, y, z) { const t = Math.atan2(z, x) / TAU; return t - Math.floor(t); },
    };
}

/**
 * Race the five rivals for `seconds` with the player level with the field.
 * Logs every credit with how far the rival was from the gate plane (signed,
 * negative = still short of it) and every drop in race-logic progress.
 */
function raceRivals(seconds) {
    const course = gatedCourse();
    const ai = createAIRacers(STUB_THREE, { course, createBirdFn: stubBird });
    const s = createRaceState({ racerCount: ai.racers.length + 1 });
    startRace(s, 0);
    const passed = ai.racers.map((r) => s.gatesPassed[r.raceIndex]);
    const last = ai.racers.map((r) => racerProgress(s, r.raceIndex));
    const credits = [], drops = [];
    for (let k = 0; k < seconds * 60; k++) {
        let mean = 0;
        for (const r of ai.racers) mean += racerProgress(s, r.raceIndex);
        ai.update(1 / 60, mean / ai.racers.length, s);
        ai.racers.forEach((r, i) => {
            const gp = s.gatesPassed[r.raceIndex];
            if (gp !== passed[i]) {
                // Signed course distance past the gate, on the course's own t
                // (the stub circle rides the terrain floor, so a tangent-plane
                // projection would tilt with the ground).
                const g = (s.nextGate[r.raceIndex] - 1 + G) % G;
                const along = RL.deltaT(g / G, course.nearestT(r.position.x, r.position.y, r.position.z)) * course.length;
                credits.push({ name: r.name, gate: g, along });
                passed[i] = gp;
            }
            const now = racerProgress(s, r.raceIndex);
            if (now < last[i] - 1e-9) drops.push({ name: r.name, by: (last[i] - now) * G });
            last[i] = now;
        });
    }
    return { credits, drops, s, ai };
}

test('rivals are credited at the gate plane, never before it', () => {
    const { credits } = raceRivals(12);
    assert.ok(credits.length >= 5 * 6, 'the field filed its gates: ' + credits.length);
    const early = credits.filter((c) => c.along < -0.05);
    const worst = early.reduce((m, c) => Math.min(m, c.along), 0);
    assert.equal(early.length, 0,
        `${early.length} of ${credits.length} credits came before the plane, worst ${(-worst).toFixed(1)} units early`);
    for (const c of credits) assert.ok(c.along <= MAX_STEP + 0.5, `${c.name} gate ${c.gate} credited ${c.along.toFixed(1)} past the plane`);
});

test("rivals' race progress never drops after a credit", () => {
    const { drops } = raceRivals(12);
    const worst = drops.reduce((m, d) => Math.max(m, d.by), 0);
    assert.equal(drops.length, 0, `${drops.length} progress drops, worst ${worst.toFixed(2)} gate spans`);
});

test('during the countdown the rivals feed race-logic nothing; at the green light they are seeded from the grid', () => {
    const course = gatedCourse();
    const ai = createAIRacers(STUB_THREE, { course, createBirdFn: stubBird });
    const s = createRaceState({ racerCount: ai.racers.length + 1 });
    for (let k = 0; k < 60; k++) ai.update(1 / 60, 0, s);
    for (const r of ai.racers) {
        assert.equal(s.hasT[r.raceIndex], 0, r.name + ': no countdown samples reach updateRacerT');
        assert.equal(s.crossHas[r.raceIndex], 0, r.name + ': or passGate');
        assert.equal(s.wrongAccum[r.raceIndex], 0);
    }
    startRace(s, 0);
    ai.update(1 / 60, 0, s);
    for (const r of ai.racers) {
        assert.equal(s.crossHas[r.raceIndex], 1, r.name + ' seeded at the green light');
        assert.ok(s.crossT[r.raceIndex] > 0.95, r.name + ' from its grid slot behind the line: ' + s.crossT[r.raceIndex]);
        assert.equal(s.gatesPassed[r.raceIndex], 0);
    }
    // And the player: index.html seeds at the countdown -> racing switch and after a debug warp.
    const html = readFileSync(new URL('../gauntlet/index.html', import.meta.url), 'utf8');
    const go = html.indexOf('if (countdown <= 0) {');
    assert.ok(go > 0);
    assert.match(html.slice(go, html.indexOf('}', go)), /raceLogic\.seedGateCrossing\(race, 0,/,
        'the player is seeded from the grid at the green light, before the first flight step');
    const adv = html.indexOf('debugAdvance(seconds');
    assert.match(html.slice(adv, html.indexOf('\n        },', adv)), /seedGateCrossing\(/, 'and after a debug warp');
});

// ---------------------------------------------------------------------------
// one rule, both callers
// ---------------------------------------------------------------------------

test('the player (index.html) and the rivals (ai-racer.js) share the one gate rule', () => {
    const html = readFileSync(new URL('../gauntlet/index.html', import.meta.url), 'utf8');
    const start = html.indexOf('function checkGates(');
    assert.ok(start > 0, 'index.html still has checkGates');
    const body = html.slice(start, html.indexOf('\n    }\n', start));
    assert.match(body, /raceLogic\.passGate\(/, 'checkGates asks race-logic whether a gate was crossed');
    assert.doesNotMatch(body, /gateRadius/, 'and does not run its own radius test');
    // Everything a counted gate does for the player still happens there.
    for (const fx of ['audio.gate(', 'flight.chargeBoost(', 'feathers.burst(', 'course.setNextGate(', 'raceLogic.isFinished(race, 0)']) {
        assert.ok(body.includes(fx), 'checkGates still fires ' + fx);
    }

    const ai = readFileSync(new URL('../gauntlet/src/race/ai-racer.js', import.meta.url), 'utf8');
    assert.match(ai, /passGate\(raceState,/, 'the rivals file gates through passGate');
    assert.doesNotMatch(ai, /recordGate\(raceState,/, 'and never directly');
});
