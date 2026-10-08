/**
 * tests/gauntlet-rubber-band.test.js — the rivals' rubber band compares like with like.
 *
 * The bug this pins: ai-racer measured each rival on its own kinematic lap
 * counter (`laps + t`, with `laps++` on every forward seam crossing). The
 * rivals line up a touch BEHIND the start line, at t ~0.98, so crossing t = 0
 * at the green light bumped them to lap 1 before they had flown any of it.
 * The player is measured on race-logic's racerProgress, which starts at ~0.
 * Every rival therefore read about one lap ahead of the player, so the band
 * sat clamped at -rubberMaxAhead and pack cohesion at -packMax for the whole
 * race (446 of 446 frames in a headless 30 s race): the band never pulled a
 * rival toward a player who was ahead.
 *
 * The rule now: given a race state, the band and the field mean read every
 * rival on race-logic's racerProgress, the same figure the player is read on.
 * Without one (dev probes, tests) the kinematic counter starts a grid slot
 * behind the line at -1 lap, so reaching the line does not gain a lap.
 *
 * Also pinned: the band's 7% cap on catch-up, and the crow's cleverMax.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Matrix4 } from 'three';

import * as AI from '../gauntlet/src/race/ai-racer.js';
import { createRaceState, startRace, racerProgress } from '../gauntlet/src/race/race-logic.js';
import { floorRadius } from '../gauntlet/src/core/terrain.js';

const { createAIRacers, AI_CONFIG } = AI;
const TAU = Math.PI * 2;
const G = 12;
const DT = 1 / 60;

// --- the same hand-written THREE stub the bird tests use --------------------
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

function field() {
    const ai = createAIRacers(STUB_THREE, { course: gatedCourse(), createBirdFn: stubBird });
    const s = createRaceState({ racerCount: ai.racers.length + 1 });
    startRace(s, 0);
    return { ai, s };
}

const meanRival = (ai, s) => ai.racers.reduce((m, r) => m + racerProgress(s, r.raceIndex), 0) / ai.racers.length;

/**
 * Race `seconds` with the player held `offset` laps from the rivals' mean race
 * progress (0 = level with the field). From `from` seconds on, averages each
 * rival's speed and band term and keeps the worst band and crow bonus seen.
 */
function run(seconds, offset, from = 3) {
    const { ai, s } = field();
    const stats = ai.racers.map(() => ({ speed: 0, band: 0, n: 0, bandMax: -Infinity, bandMin: Infinity, clever: 0, adjMax: -Infinity, sumMax: -Infinity }));
    for (let k = 0; k < seconds * 60; k++) {
        ai.update(DT, meanRival(ai, s) + offset, s);
        if (k < from * 60) continue;
        ai.racers.forEach((r, i) => {
            const st = stats[i];
            st.speed += r.speed; st.band += r.band; st.n++;
            st.bandMax = Math.max(st.bandMax, r.band);
            st.bandMin = Math.min(st.bandMin, r.band);
            st.clever = Math.max(st.clever, r.cleverBonus);
            st.adjMax = Math.max(st.adjMax, r.paceAdj);
            st.sumMax = Math.max(st.sumMax, r.band + r.pack + r.cleverBonus);
        });
    }
    for (const st of stats) { st.speed /= st.n; st.band /= st.n; }
    return { ai, s, stats };
}

// ---------------------------------------------------------------------------

test('the rivals line up behind the start line (the case the bug needs)', () => {
    const { ai } = field();
    for (const r of ai.racers) {
        assert.ok(r.t > 0.95 && r.t < 1, r.name + ' grid t ' + r.t.toFixed(4));
    }
});

test("given a race state, a rival's progress is race-logic's, before and after the line", () => {
    const { ai, s } = field();
    for (let k = 0; k < 4 * 60; k++) {
        ai.update(DT, meanRival(ai, s), s);
        if (k !== 5 && k !== 4 * 60 - 1) continue;
        for (const r of ai.racers) {
            const want = racerProgress(s, r.raceIndex);
            assert.ok(Math.abs(r.progress - want) < 0.01,
                `${r.name} at ${((k + 1) * DT).toFixed(2)} s: progress ${r.progress.toFixed(3)}, race-logic ${want.toFixed(3)}`);
        }
    }
    for (const r of ai.racers) assert.ok(s.gatesPassed[r.raceIndex] >= 1, r.name + ' crossed the line and kept racing');
});

test('without a race state, reaching the start line from the grid does not gain a lap', () => {
    const { ai } = field();
    for (let k = 0; k < 4 * 60; k++) ai.update(DT, 0);
    for (const r of ai.racers) {
        assert.ok(r.t < 0.5, r.name + ' crossed the line (t ' + r.t.toFixed(3) + ')');
        assert.ok(r.progress > 0 && r.progress < 0.25, `${r.name} progress ${r.progress.toFixed(3)} after 4 s from the grid`);
        assert.equal(r.lap, 1, r.name + ' is still on lap 1');
    }
});

test('player level with the field: the band is live, not pinned at -rubberMaxAhead', () => {
    const { ai, stats } = run(8, 0);
    ai.racers.forEach((r, i) => {
        const st = stats[i];
        assert.equal(typeof r.band, 'number', r.name + ': ai-racer publishes the band term it applied');
        assert.ok(st.band > -AI_CONFIG.rubberMaxAhead + 0.01,
            `${r.name}: mean band ${st.band.toFixed(4)} with the player level`);
        assert.ok(st.bandMin > -AI_CONFIG.rubberMaxAhead,
            `${r.name}: band hit the -${AI_CONFIG.rubberMaxAhead} clamp (min ${st.bandMin.toFixed(4)})`);
        assert.ok(Math.abs(st.band) < 0.035, `${r.name}: mean band ${st.band.toFixed(4)} should be near 0 when level`);
    });
});

test('a rival speeds up when the player is ahead and eases off when the player is behind', () => {
    const level = run(8, 0).stats;
    const ahead = run(8, 0.05).stats;
    const behind = run(8, -0.05).stats;
    const names = run(1, 0).ai.racers.map((r) => r.name);
    names.forEach((name, i) => {
        const up = ahead[i].speed / level[i].speed - 1;
        const down = behind[i].speed / level[i].speed - 1;
        assert.ok(up > 0.03, `${name}: a 0.05-lap player lead changed its pace by ${(up * 100).toFixed(1)}%`);
        assert.ok(down < -0.02, `${name}: a 0.05-lap player deficit changed its pace by ${(down * 100).toFixed(1)}%`);
    });
});

test('the catch-up is capped at 7%, and the crow never exceeds cleverMax', () => {
    assert.equal(AI_CONFIG.rubberMaxBehind, 0.07, 'the documented 7% cap');
    assert.equal(typeof AI.rubberBand, 'function', 'ai-racer exports the band rule as a pure helper');
    assert.equal(AI.rubberBand(1), AI_CONFIG.rubberMaxBehind, 'a lap behind the player: exactly the cap');
    assert.equal(AI.rubberBand(1e6), AI_CONFIG.rubberMaxBehind, 'never more, however far');
    assert.equal(AI.rubberBand(-1e6), -AI_CONFIG.rubberMaxAhead);
    assert.equal(AI.rubberBand(0), 0);

    // In a live race with the player a whole lap up the road.
    const { ai, stats } = run(8, 1);
    ai.racers.forEach((r, i) => {
        assert.ok(stats[i].bandMax <= AI_CONFIG.rubberMaxBehind + 1e-12,
            `${r.name}: band peaked at ${stats[i].bandMax}`);
        assert.ok(stats[i].bandMax > AI_CONFIG.rubberMaxBehind - 1e-9, `${r.name}: and does reach it`);
        assert.ok(stats[i].clever <= AI_CONFIG.cleverMax + 1e-12, `${r.name}: clever bonus ${stats[i].clever}`);
    });
});

test('band + pack + crow bonus together are capped at assistMax (10%); slowdowns pass through', () => {
    assert.equal(AI_CONFIG.assistMax, 0.10, 'the total assistance ceiling');
    assert.equal(typeof AI.paceAdjust, 'function', 'ai-racer exports the combined pace term as a pure helper');
    assert.equal(AI.paceAdjust(AI_CONFIG.rubberMaxBehind, AI_CONFIG.packMax, AI_CONFIG.cleverMax), 0.10,
        'every term at its own maximum at once: exactly 10%, not 17.5%');
    assert.equal(AI.paceAdjust(AI_CONFIG.rubberMaxBehind, AI_CONFIG.packMax, 0), 0.10, 'band + pack alone (11.5%): 10%');
    assert.ok(Math.abs(AI.paceAdjust(0.02, 0.01, 0.005) - 0.035) < 1e-15, 'under the ceiling it is the plain sum');
    assert.ok(Math.abs(AI.paceAdjust(-AI_CONFIG.rubberMaxAhead, -AI_CONFIG.packMax, 0) + 0.095) < 1e-15,
        'a slowdown is not clamped');

    // Live: the player a lap up the road pins the band AND the pack at their
    // caps, and the crow drafts on top. The applied total never passes 10%.
    const { ai, stats } = run(8, 1);
    ai.racers.forEach((r, i) => {
        assert.equal(typeof r.paceAdj, 'number', r.name + ': ai-racer publishes the total it applied');
        assert.ok(stats[i].sumMax > AI_CONFIG.assistMax, `${r.name}: the raw terms did exceed it (${stats[i].sumMax.toFixed(3)})`);
        assert.ok(stats[i].adjMax <= AI_CONFIG.assistMax + 1e-12, `${r.name}: applied ${stats[i].adjMax}`);
        assert.ok(stats[i].adjMax > AI_CONFIG.assistMax - 1e-9, `${r.name}: and reached it`);
        assert.ok(stats[i].bandMax <= AI_CONFIG.rubberMaxBehind + 1e-12, `${r.name}: the band's own 7% cap still holds`);
    });
});
