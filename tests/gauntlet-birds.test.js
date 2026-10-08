/**
 * Unit tests for Birb Gauntlet's bird roster: the five rival personalities,
 * the clockwork owl's mainspring, the crow's capped bonuses, the species
 * table, and the persisted bird choice.
 *
 * `node --test`, zero dependencies, no DOM. ai-racer.js and bird-anim.js take
 * THREE as an argument and only touch it inside their factories, so their
 * exported maths is importable here as-is; nothing below builds a mesh. The
 * slipstream tests drive the rivals' real `update()` through a stub THREE,
 * a stub bird and a stub circular course (see "the crow's slipstream").
 */

import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Matrix4 } from 'three';

import {
    PERSONALITIES, AI_CONFIG, RIVAL_COUNT,
    SPRING_UNWIND, SPRING_REWIND,
    createMainspring, resetMainspring, stepMainspring, mainspringPace, mainspringAverage,
    stepShinyNudge, cleverBonus, gridLayout, fineProgress, createAIRacers,
} from '../gauntlet/src/race/ai-racer.js';
import { floorRadius } from '../gauntlet/src/core/terrain.js';
import {
    RACE_CONFIG, createRaceState, startRace, recordGate, updateRacerT, racerProgress,
} from '../gauntlet/src/race/race-logic.js';
import { createBirdAnimator } from '../gauntlet/src/bird/bird-anim.js';
import {
    BIRD_SPECIES, DEFAULT_SPECIES, speciesById, parseSpecies, normaliseSpecies,
} from '../gauntlet/src/bird/species.js';
import {
    SETTINGS_KEY, defaultSettings, parseSettings, resolvePlayerSpecies,
} from '../gauntlet/src/game/settings.js';
import { BIRD_COLORS } from '../gauntlet/src/core/palette.js';

const byKey = (k) => PERSONALITIES.find((p) => p.key === k);
const CROW = byKey('clever');
const OWL = byKey('clockwork');
const TRIO = ['aggressive', 'clean', 'erratic'].map(byKey);

// ---------------------------------------------------------------------------
// the roster
// ---------------------------------------------------------------------------

test('five personalities, and the race fields the player plus all five', () => {
    assert.equal(PERSONALITIES.length, 5);
    assert.equal(RIVAL_COUNT, 5);
    assert.equal(RACE_CONFIG.racerCount, 1 + RIVAL_COUNT);
});

test('keys, names and colours are unique across the roster', () => {
    for (const field of ['key', 'name', 'color', 'uiColor']) {
        const seen = new Set(PERSONALITIES.map((p) => p[field]));
        assert.equal(seen.size, PERSONALITIES.length, field + ' must be unique');
    }
    assert.equal(CROW.name, 'Corvus');
    assert.equal(OWL.name, 'Tock');
});

test('the new rivals carry the same field set as the original trio', () => {
    const shared = Object.keys(TRIO[0]);
    for (const p of PERSONALITIES) {
        for (const k of shared) assert.ok(k in p, p.name + ' is missing ' + k);
    }
});

test('twists are capability blocks: only the crow is clever, only the owl has a spring', () => {
    for (const p of PERSONALITIES) {
        assert.equal(Boolean(p.clever), p === CROW, p.name + ' clever');
        assert.equal(Boolean(p.spring), p === OWL, p.name + ' spring');
    }
});

test('every rival species exists, and the species table points back at its rival', () => {
    for (const p of PERSONALITIES) assert.equal(parseSpecies(p.species), p.species, p.name);
    for (const s of BIRD_SPECIES) {
        if (!s.rivalKey) continue;
        assert.equal(byKey(s.rivalKey).species, s.id, s.id + ' -> ' + s.rivalKey);
    }
    assert.equal(CROW.species, 'crow');
    assert.equal(OWL.species, 'clockwork-owl');
});

test('a species clash has an alternate tint that matches nobody else', () => {
    const taken = new Set(PERSONALITIES.map((p) => p.color));
    for (const p of [CROW, OWL]) {
        assert.ok(Number.isInteger(p.altColor), p.name + ' has an altColor');
        assert.ok(!taken.has(p.altColor), p.name + "'s alt tint must not be any rival's colour");
        for (const c of BIRD_COLORS) assert.notEqual(p.altColor, c.body, 'alt vs plumage ' + c.id);
    }
});

// ---------------------------------------------------------------------------
// the clockwork owl
// ---------------------------------------------------------------------------

const SP = OWL.spring;

/** Step a fresh spring for `seconds` and record every phase transition. */
function runSpring(seconds, dt) {
    const m = createMainspring();
    const events = [];
    const paces = [];
    let lastPhase = m.phase;
    for (let t = 0, i = 0; t < seconds - 1e-9; i++, t = i * dt) {
        const pace = stepMainspring(m, SP, dt);
        paces.push(pace);
        const now = (i + 1) * dt;
        if (m.phase !== lastPhase) {
            events.push({ t: now, phase: m.phase });
            lastPhase = m.phase;
        }
        if (m.released) events.push({ t: now, released: true });
    }
    return { m, events, paces };
}

test('the mainspring runs unwind -> rewind -> release, on the documented clock', () => {
    const { events, m } = runSpring(30, 1 / 60);
    const rewinds = events.filter((e) => e.phase === SPRING_REWIND).map((e) => e.t);
    const releases = events.filter((e) => e.released).map((e) => e.t);
    const period = SP.unwindTime + SP.rewindTime;
    assert.equal(rewinds.length, 3, 'three rewinds in 30 s');
    assert.equal(releases.length, 3, 'each rewind releases exactly once');
    for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(rewinds[k] - (SP.unwindTime + k * period)) < 1 / 30, 'rewind ' + k);
        assert.ok(Math.abs(releases[k] - (k + 1) * period) < 1 / 30, 'release ' + k);
    }
    assert.equal(m.cycles, 3);
    assert.ok(SP.unwindTime >= 7 && SP.unwindTime <= 9, 'unwinds over ~7-9 s');
    assert.ok(Math.abs(SP.rewindTime - 1) < 0.25, 'rewinds for ~1 s');
});

test('the mainspring is deterministic and frame-rate independent', () => {
    const a = runSpring(20, 1 / 60);
    const b = runSpring(20, 1 / 60);
    assert.deepEqual(a.paces, b.paces, 'same input, same pace, every step');
    const slow = runSpring(20, 1 / 30).events.filter((e) => e.phase === SPRING_REWIND);
    const fast = runSpring(20, 1 / 120).events.filter((e) => e.phase === SPRING_REWIND);
    assert.equal(slow.length, fast.length);
    for (let k = 0; k < slow.length; k++) assert.ok(Math.abs(slow[k].t - fast[k].t) < 1 / 30 + 1e-9);
});

test('pace eases down as the spring runs low, stalls on the rewind, releases above cruise', () => {
    const m = createMainspring();
    const at = (energy) => { m.phase = SPRING_UNWIND; m.energy = energy; return mainspringPace(m, SP); };
    assert.equal(at(1), SP.paceTop);
    assert.ok(SP.paceTop > 1 && SP.paceTop < 1.1, 'a little above cruise on release');
    assert.ok(at(1) > at(0.5) && at(0.5) > at(0.2) && at(0.2) > at(0), 'monotonic ease-down');
    // Most of the slow-down arrives late: the first half of the run loses
    // less pace than the second half.
    assert.ok(at(1) - at(0.5) < at(0.5) - at(0));
    m.phase = SPRING_REWIND;
    assert.equal(mainspringPace(m, SP), SP.rewindPace);
    assert.ok(SP.rewindPace < SP.paceFloor, 'the stall is the slowest it ever goes');
});

test('pace stays bounded every step, and the owl never exceeds the speed envelope', () => {
    const { paces } = runSpring(40, 1 / 60);
    for (const p of paces) {
        assert.ok(p >= SP.rewindPace - 1e-12 && p <= SP.paceTop + 1e-12, 'pace ' + p);
    }
    assert.ok(AI_CONFIG.baseSpeed * OWL.speedMul * SP.paceTop
        * (1 + AI_CONFIG.rubberMaxBehind + AI_CONFIG.packMax) <= AI_CONFIG.maxSpeed);
});

test("the owl's average pace is comparable to the other rivals (beatable, not a rocket)", () => {
    const { paces } = runSpring(SP.unwindTime * 10 + SP.rewindTime * 10, 1 / 120);
    const mean = paces.reduce((s, p) => s + p, 0) / paces.length;
    assert.ok(Math.abs(mean - mainspringAverage(SP)) < 0.004, 'closed form matches stepping');
    const owl = OWL.speedMul * mean;
    const trio = TRIO.reduce((s, p) => s + p.speedMul, 0) / TRIO.length;
    assert.ok(Math.abs(owl - trio) / trio < 0.03, `owl ${owl.toFixed(4)} vs trio ${trio.toFixed(4)}`);
    assert.ok(owl <= Math.max(...TRIO.map((p) => p.speedMul)), 'never quicker than the quickest of the trio');
});

test('the owl is metronomic: no wander, no mistakes', () => {
    assert.equal(OWL.wanderAmp, 0);
    assert.equal(OWL.mistakeEvery, null);
    assert.equal(OWL.mistakeTumble, 0);
    const zeta = OWL.latDamp / (2 * Math.sqrt(OWL.latStiff));
    assert.ok(zeta >= 0.99, 'critically damped lateral spring (zeta ' + zeta.toFixed(3) + ')');
});

test('resetMainspring returns a spring to fully wound', () => {
    const m = createMainspring();
    for (let i = 0; i < 700; i++) stepMainspring(m, SP, 1 / 60);
    resetMainspring(m);
    assert.deepEqual(m, createMainspring());
});

// ---------------------------------------------------------------------------
// the crow
// ---------------------------------------------------------------------------

const CL = CROW.clever;

test('the shiny nudge never exceeds its cap, however many rings are threaded', () => {
    let n = 0;
    for (let i = 0; i < 2000; i++) {
        n = stepShinyNudge(n, true, 1 / 60, CL);
        assert.ok(n <= CL.shinyMax + 1e-12, 'step ' + i + ': ' + n);
        assert.ok(n >= 0);
    }
    assert.equal(n, CL.shinyMax);
    for (let i = 0; i < 60 * 12; i++) n = stepShinyNudge(n, false, 1 / 60, CL);
    assert.ok(n < CL.shinyMax * 0.01, 'and it decays away once the crow stops catching');
    assert.ok(stepShinyNudge(0, true, 1 / 60, CL) > 0, 'a single catch does nudge');
});

test("the crow's bonuses sit under the rubber-band cap, which sits under a boost", () => {
    assert.ok(CL.shinyMax <= AI_CONFIG.cleverMax);
    assert.ok(AI_CONFIG.cleverMax < AI_CONFIG.rubberMaxBehind, 'cleverMax < the ~7% band');
    assert.ok(AI_CONFIG.rubberMaxBehind <= 0.07 + 1e-12);
    // Everything at once — tucked in, mid-slingshot, a full shiny — is still capped.
    assert.ok(cleverBonus(true, 1, CL.shinyMax, CL) <= AI_CONFIG.cleverMax + 1e-12);
    assert.ok(cleverBonus(true, 1, 10, CL) <= AI_CONFIG.cleverMax + 1e-12, 'even with a bogus shiny');
    assert.equal(cleverBonus(false, 0, 0, CL), 0);
    // And the worst-case crow target pace still clears the envelope.
    const worst = AI_CONFIG.baseSpeed * CROW.speedMul
        * (1 + AI_CONFIG.rubberMaxBehind + AI_CONFIG.packMax + AI_CONFIG.cleverMax);
    assert.ok(worst <= AI_CONFIG.maxSpeed, 'worst-case crow ' + worst.toFixed(2));
});

test('the overtake measure has no phantom gate jump, so the crow cannot caw at nothing', () => {
    const G = 14;
    const s = createRaceState({ laps: 3, gateCount: G, racerCount: 2 });
    startRace(s, 0);
    // Racer 1 sits just behind the start line (as every rival does on the
    // grid); racer 0 sits on it. Racer 1 is behind, on any honest measure.
    updateRacerT(s, 0, 0.0);
    updateRacerT(s, 1, 0.988);
    assert.ok(fineProgress(s, 1, 0.988) < fineProgress(s, 0, 0.0));
    // Racer 1 has gate 1 on its books while still short of it (t 0.06 < gate
    // t 0.0714) — gates now count at the plane, but recordGate itself does
    // not know where a racer is — while racer 0 is already past the gate.
    recordGate(s, 0, 1, 1000); updateRacerT(s, 0, 0.074);
    recordGate(s, 1, 1, 1000); updateRacerT(s, 1, 0.060);
    assert.ok(racerProgress(s, 1) < racerProgress(s, 0), 'race-logic no longer reads the short racer a gate ahead');
    assert.ok(fineProgress(s, 1, 0.060) < fineProgress(s, 0, 0.074), 'nor does fineProgress');
    assert.ok(Math.abs(fineProgress(s, 1, 0.060) - 0.060) < 1e-9, 'and equals the true distance');
});

test('the crow covets just above the ribbon, inside the counting radius', () => {
    assert.ok(CL.covetAlt > 0.75, 'clears the 1.5-deep ribbon beam');
    assert.ok(Math.hypot(CL.shinyCatch, CL.covetAlt) < RACE_CONFIG.gateRadius);
    assert.ok(CL.draftRange > 0 && CL.draftLat > 0 && CL.slingTime > 0);
});

// ---------------------------------------------------------------------------
// the crow's slipstream, through update()
//
// Each scenario re-poses the field every frame before update() runs: the
// other rivals are parked well behind the crow (never a draft target), and
// the probe target is placed so that the selector's own projections — onto
// the crow's heading, its side, and the radial up through its position —
// come out at the requested (ahead, lat, up). The pre-fix selector read only
// the first two, so every rejected case below is one it would have accepted.
// ---------------------------------------------------------------------------

// The node_modules `three` is a hand-written stub; these are the few extra
// pieces the rivals' factory and update() reach for.
class V3 extends Vector3 {
    get isVector3() { return true; }   // update() only accepts a draft target that says so
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

/** An equatorial great circle riding the real terrain floor. */
function stubCourse() {
    const TAU = Math.PI * 2;
    const at = (t, out) => {
        const a = TAU * t, x = Math.cos(a), z = Math.sin(a);
        return out.set(x, 0, z).multiplyScalar(floorRadius(x, 0, z) + AI_CONFIG.floorClear);
    };
    const a = new V3(), b = new V3();
    return {
        length: TAU * 100,
        gateCount: 0,
        sampleAt: at,
        tangentAt(t, out) { at(t + 1e-4, a); at(t - 1e-4, b); return out.subVectors(a, b).normalize(); },
        nearestT(x, y, z) { const t = Math.atan2(z, x) / TAU; return t - Math.floor(t); },
    };
}

let slip = null;
function slipField() {
    if (!slip) {
        const ai = createAIRacers(STUB_THREE, { course: stubCourse(), createBirdFn: stubBird });
        const crow = ai.racers.find((r) => r.personality === 'clever');
        slip = { ai, crow, up: new V3(), c: new V3() };
    }
    slip.ai.reset();
    return slip;
}

/**
 * out = crow.position + rel, with rel·dir = ahead, rel·side = lat and
 * rel·radialUp = upAmt: the inverse of the 3x3 whose rows are those axes has
 * columns (side×up, up×dir, dir×side) / det.
 */
function placeInCrowFrame(f, out, ahead, lat, upAmt) {
    const { crow, up, c } = f;
    const d = crow.dir, s = crow._side;
    up.copy(crow.position).normalize();
    const det = d.dot(c.crossVectors(s, up));
    out.set(0, 0, 0)
        .addScaledVector(c.crossVectors(s, up), ahead / det)
        .addScaledVector(c.crossVectors(up, d), lat / det)
        .addScaledVector(c.crossVectors(d, s), upAmt / det);
    return out.add(crow.position);
}

/**
 * Run `frames` updates. `decoy` (optional) is a rival moved to that crow-frame
 * offset each frame; `target` is the player position offered for drafting
 * (null = none). Returns the peak draft meter and whether it ever drafted.
 */
function runSlip(f, frames, target, decoy) {
    const { ai, crow } = f;
    const tp = new V3();
    let peak = 0, drafted = false, maxAltBias = 0;
    for (let k = 0; k < frames; k++) {
        const others = ai.racers.filter((r) => r !== crow);
        for (const r of others) r.position.copy(crow.position).addScaledVector(crow.dir, -60);
        if (decoy) placeInCrowFrame(f, others[0].position, decoy[0], decoy[1], decoy[2]);
        if (target) placeInCrowFrame(f, tp, target[0], target[1], target[2]);
        ai.update(0.05, undefined, undefined, undefined, target ? tp : undefined);
        peak = Math.max(peak, crow.draft01);
        drafted = drafted || crow.drafting;
        maxAltBias = Math.max(maxAltBias, Math.abs(crow.altBias));
    }
    return { peak, drafted, maxAltBias };
}

test('the crow drafts a bird properly ahead on its own line (control)', () => {
    const f = slipField();
    const s = runSlip(f, 10, [10, 0, 0]);
    assert.ok(s.drafted, 'tucked in');
    assert.ok(s.peak > 0.2, 'the meter charges: ' + s.peak);
});

test('a bird far above or below the crow cannot charge its slipstream', () => {
    assert.ok(CL.draftUp > 0 && CL.draftUp < 6, 'the vertical wake is bounded, about two lanes');
    for (const upAmt of [12, -12, CL.draftUp + 0.5, -(CL.draftUp + 0.5)]) {
        const f = slipField();
        const s = runSlip(f, 10, [10, 0, upAmt]);
        assert.equal(s.peak, 0, 'no charge from ' + upAmt + ' units off the line');
        assert.ok(!s.drafted, 'never drafting at ' + upAmt);
        assert.equal(s.maxAltBias, 0, 'and not dragged toward its altitude');
    }
});

test('a bird on the far side of the planet cannot charge the slipstream', () => {
    const f = slipField();
    // Ahead and sideways both inside the window; radially, one diameter away
    // (the target sits beyond the planet's centre from the crow).
    const across = -2 * f.crow.position.length();
    const s = runSlip(f, 10, [10, 0, across]);
    assert.equal(s.peak, 0);
    assert.ok(!s.drafted);
});

test('an out-of-wake bird cannot displace a legitimate target or pull the crow off its altitude', () => {
    const f = slipField();
    // The decoy is NEARER (ahead 8) but 12 units overhead; the real tail is at 12.
    const s = runSlip(f, 10, [12, 0, 0], [8, 0, 12]);
    assert.ok(s.drafted && s.peak > 0.2, 'drafts the legitimate target');
    assert.ok(s.maxAltBias < 1, 'altitude bias follows the real tail, not the decoy: ' + s.maxAltBias);
});

// ---------------------------------------------------------------------------
// the grid
// ---------------------------------------------------------------------------

test('a three-bird grid is exactly the original layout', () => {
    const o = {};
    for (let i = 0; i < 3; i++) {
        gridLayout(i, 3, o);
        assert.equal(o.lat, (i - 1) * 4.4);
        assert.equal(o.t, -0.0022 * i - 0.0018);
        assert.equal(o.altLane, (i - 1) * AI_CONFIG.altLane);
    }
});

test('a five-bird grid stays in the lane and clear of the ribbon', () => {
    const o = {};
    const lats = [], alts = [], ts = [];
    for (let i = 0; i < 5; i++) {
        gridLayout(i, 5, o);
        lats.push(o.lat); alts.push(AI_CONFIG.altAbove + o.altLane); ts.push(o.t);
    }
    for (const l of lats) assert.ok(Math.abs(l) <= AI_CONFIG.laneMax, 'lat ' + l);
    assert.ok(Math.min(...alts) >= 1.7 - 1e-9, 'lowest bird ' + Math.min(...alts));
    assert.equal(new Set(lats).size, 5);
    for (let i = 1; i < 5; i++) {
        assert.ok(alts[i] > alts[i - 1] && ts[i] < ts[i - 1] && lats[i] > lats[i - 1]);
    }
    for (const t of ts) assert.ok(t < 0, 'behind the line, so gate 0 is crossed first');
});

// ---------------------------------------------------------------------------
// the clockwork rig (bird-anim.js) against a fake bird — no THREE needed
// ---------------------------------------------------------------------------

function fakeNode() {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, order: 'XYZ' },
        scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    };
}
function fakeBird(withMech) {
    const u = () => ({ value: 0 });
    const head = fakeNode();
    head.position.y = 0.28; head.position.z = -0.31;
    return {
        parts: { body: fakeNode(), head, leftWing: fakeNode(), rightWing: fakeNode() },
        uniforms: {
            blink: u(), tailYaw: u(), tailPitch: u(), tailFan: u(),
            leftCurl: u(), leftSweep: u(), rightCurl: u(), rightSweep: u(),
        },
        mech: withMech ? { key: fakeNode(), gear: fakeNode() } : null,
    };
}
function animState(extra) {
    return Object.assign({
        speed01: 0.5, turn: 0, pitch: 0, boosting: false, flapImpulse: 1,
        tumbling: false, grounded: false, celebrating: false, phase: 0,
    }, extra);
}

test('the owl key turns at the spin it is given, and runs backwards on a rewind', () => {
    const bird = fakeBird(true);
    const anim = createBirdAnimator(null, bird);
    const s = animState({ keySpin: 1.4 });
    for (let i = 0; i < 30; i++) anim.update(1 / 60, s);
    assert.ok(Math.abs(bird.mech.key.rotation.y - 0.7) < 1e-9, 'key ' + bird.mech.key.rotation.y);
    const g0 = bird.mech.gear.rotation.y;
    assert.ok(g0 > 0, 'gear turns forward in flight');
    s.keySpin = -26; s.rewinding = true;
    anim.update(1 / 60, s);
    assert.ok(bird.mech.key.rotation.y < 0.7, 'key spins back while winding');
    assert.ok(bird.mech.gear.rotation.y < g0, 'gear reverses while winding');
});

test('a rewinding owl stalls its wingbeat to a small ratchet tick', () => {
    const range = (rewinding) => {
        const bird = fakeBird(true);
        const anim = createBirdAnimator(null, bird);
        const s = animState({ rewinding, flapImpulse: 1, pitch: 0.6 });
        for (let i = 0; i < 30; i++) anim.update(1 / 60, s);   // settle
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < 60; i++) {
            anim.update(1 / 60, s);
            lo = Math.min(lo, bird.parts.rightWing.rotation.z);
            hi = Math.max(hi, bird.parts.rightWing.rotation.z);
        }
        return { span: hi - lo, stroking: anim.stroking };
    };
    const flying = range(false);
    const winding = range(true);
    assert.ok(flying.span > 0.5, 'a climbing owl beats (' + flying.span.toFixed(3) + ' rad)');
    assert.ok(winding.span < 0.2, 'a rewinding owl only ticks (' + winding.span.toFixed(3) + ' rad)');
    assert.equal(winding.stroking, false);
});

test('a bird without a mechanism ignores the clockwork fields entirely', () => {
    const run = (extra) => {
        const bird = fakeBird(false);
        const anim = createBirdAnimator(null, bird);
        const s = animState(extra);
        const out = [];
        for (let i = 0; i < 90; i++) {
            anim.update(1 / 60, s);
            out.push(bird.parts.rightWing.rotation.z, bird.uniforms.rightCurl.value, bird.parts.body.rotation.z);
        }
        return out;
    };
    assert.deepEqual(run({}), run({ rewinding: true, keySpin: 99 }));
});

// ---------------------------------------------------------------------------
// species + persisted choice
// ---------------------------------------------------------------------------

test('the species table: three birds, unique ids and query aliases, birb by default', () => {
    assert.deepEqual(BIRD_SPECIES.map((s) => s.id), ['birb', 'crow', 'clockwork-owl']);
    assert.equal(new Set(BIRD_SPECIES.map((s) => s.query)).size, BIRD_SPECIES.length);
    assert.equal(DEFAULT_SPECIES, 'birb');
    assert.equal(speciesById('nope').id, 'birb', 'never undefined');
    assert.equal(parseSpecies('owl'), 'clockwork-owl');
    assert.equal(parseSpecies(' CROW '), 'crow');
    assert.equal(parseSpecies('dragon'), null);
    assert.equal(parseSpecies(undefined), null);
    assert.equal(normaliseSpecies(42), 'birb');
});

test('settings default to the Birb, under the unchanged storage key', () => {
    assert.equal(SETTINGS_KEY, 'gauntlet.settings.v1', 'an additive field never bumps the key');
    const d = defaultSettings();
    assert.equal(d.bird, 'birb');
    assert.equal(d.birdColor, BIRD_COLORS[0].id);
    assert.equal(d.music, true);
    for (const raw of [null, undefined, '', 'not json', '[]', 'null', '7', '"crow"']) {
        assert.deepEqual(parseSettings(raw), d, 'bad save ' + JSON.stringify(raw));
    }
});

test('a save from before the bird picker still loads, and gains the default bird', () => {
    const old = JSON.stringify({ music: false, sfx: true, haptics: false, birdColor: 'ember' });
    const s = parseSettings(old);
    assert.equal(s.music, false);
    assert.equal(s.haptics, false);
    assert.equal(s.birdColor, 'ember');
    assert.equal(s.bird, 'birb');
});

test('a stored bird round-trips; aliases normalise; junk falls back; unknown keys survive', () => {
    assert.equal(parseSettings(JSON.stringify({ bird: 'crow' })).bird, 'crow');
    assert.equal(parseSettings(JSON.stringify({ bird: 'owl' })).bird, 'clockwork-owl');
    assert.equal(parseSettings(JSON.stringify({ bird: 'dragon' })).bird, 'birb');
    assert.equal(parseSettings(JSON.stringify({ bird: 3 })).bird, 'birb');
    assert.equal(parseSettings(JSON.stringify({ futureThing: 'x' })).futureThing, 'x');
    const saved = defaultSettings();
    saved.bird = 'clockwork-owl';
    assert.deepEqual(parseSettings(JSON.stringify(saved)), saved);
});

test('?bird= overrides the saved choice for the run; an invalid one is ignored', () => {
    const crowSave = parseSettings(JSON.stringify({ bird: 'crow' }));
    assert.equal(resolvePlayerSpecies(crowSave, 'owl'), 'clockwork-owl');
    assert.equal(resolvePlayerSpecies(crowSave, 'birb'), 'birb');
    assert.equal(resolvePlayerSpecies(crowSave, 'dragon'), 'crow');
    assert.equal(resolvePlayerSpecies(crowSave, null), 'crow');
    assert.equal(resolvePlayerSpecies(null, null), 'birb');
    assert.equal(crowSave.bird, 'crow', 'the override is never written back');
});

// ---------------------------------------------------------------------------
// zero allocation in the per-frame paths (source inspection, like the
// erosion tests: allocation shows up as syntax)
// ---------------------------------------------------------------------------

const ALLOC = [/\bnew\s/, /=>/, /\[\s*\]/, /\.(map|filter|slice|concat|forEach)\(/, /ctx\.create/];

function assertNoAlloc(name, src) {
    for (const re of ALLOC) assert.ok(!re.test(src), name + ' must not match ' + re);
}

test('the per-frame twist maths allocates nothing', () => {
    for (const fn of [stepMainspring, mainspringPace, stepShinyNudge, cleverBonus, gridLayout, fineProgress]) {
        assertNoAlloc(fn.name, fn.toString());
    }
});

test("the owl's per-frame tick entry points allocate nothing (nodes only when a tick lands)", () => {
    const src = readFileSync(new URL('../gauntlet/src/audio/audio.js', import.meta.url), 'utf8');
    for (const name of ['owlTick', 'playerTick', 'stepTicker']) {
        const start = src.indexOf('function ' + name + '(');
        assert.ok(start >= 0, name + ' exists');
        const body = src.slice(start, src.indexOf('\n    }\n', start));
        assertNoAlloc(name, body);
    }
});
