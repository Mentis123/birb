/**
 * tests/vyom-race-logic.test.js — unit tests for VYOM's pure race rules.
 *
 * node --test, zero dependencies. CI runs `npm test` without installing
 * anything, so nothing here may import THREE, the DOM, or a test framework.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    RACE_CONFIG,
    createRaceState,
    resetRaceState,
    startRace,
    recordGate,
    racerProgress,
    updateStandings,
    updateRacerT,
    isWrongWay,
    formatTime,
    formatDelta,
    lapSplit,
    bestLap,
    isFinished,
    isRaceOver,
    placeOf,
    deltaT,
    forwardT,
    wrapT,
    progressGap,
    elapsedMs,
} from '../vyom/src/race/race-logic.js';

const G = 12; // gates per lap in most fixtures

function grid(opts = {}) {
    const s = createRaceState({ laps: opts.laps ?? 2, gateCount: opts.gateCount ?? G, racerCount: opts.racerCount ?? 4 });
    startRace(s, 1000);
    return s;
}

/** Fly racer `i` cleanly through a whole lap starting at gate 1. */
function flyLap(state, i, t0, step = 100) {
    let t = t0;
    for (let g = 1; g < state.gateCount; g++) {
        recordGate(state, i, g, t);
        t += step;
    }
    recordGate(state, i, 0, t);
    return t + step;
}

// ---------------------------------------------------------------------------
// seam maths
// ---------------------------------------------------------------------------

test('wrapT normalises into [0,1)', () => {
    assert.equal(wrapT(0.25), 0.25);
    assert.equal(wrapT(1), 0);
    assert.equal(wrapT(1.25), 0.25);
    assert.ok(Math.abs(wrapT(-0.25) - 0.75) < 1e-12);
    assert.equal(wrapT(NaN), 0);
});

test('deltaT is seam-safe and signed', () => {
    assert.ok(Math.abs(deltaT(0.99, 0.01) - 0.02) < 1e-9, 'forward across the seam');
    assert.ok(Math.abs(deltaT(0.01, 0.99) + 0.02) < 1e-9, 'backward across the seam');
    assert.ok(Math.abs(deltaT(0.2, 0.3) - 0.1) < 1e-9);
    assert.ok(Math.abs(deltaT(0.3, 0.2) + 0.1) < 1e-9);
    // Exactly antipodal resolves to +0.5, never -0.5, so it is stable.
    assert.equal(deltaT(0, 0.5), 0.5);
});

test('forwardT is always non-negative and wraps', () => {
    assert.ok(Math.abs(forwardT(0.9, 0.1) - 0.2) < 1e-9);
    assert.ok(Math.abs(forwardT(0.1, 0.9) - 0.8) < 1e-9);
    assert.equal(forwardT(0.4, 0.4), 0);
});

// ---------------------------------------------------------------------------
// gate ordering
// ---------------------------------------------------------------------------

test('gates counted out of order must not advance', () => {
    const s = grid();
    // Racer starts on the line: gate 1 is due, gate 0 was the grid.
    assert.equal(s.nextGate[0], 1);

    assert.equal(recordGate(s, 0, 3, 1100), false, 'skipping ahead is rejected');
    assert.equal(recordGate(s, 0, 0, 1100), false, 'the line behind you is rejected');
    assert.equal(s.gatesPassed[0], 0);
    assert.equal(s.nextGate[0], 1);

    assert.equal(recordGate(s, 0, 1, 1200), true);
    assert.equal(s.nextGate[0], 2);
    assert.equal(recordGate(s, 0, 1, 1210), false, 're-triggering the same gate is rejected');
    assert.equal(s.gatesPassed[0], 1);

    assert.equal(recordGate(s, 0, 2, 1300), true);
    assert.equal(s.gatesPassed[0], 2);
});

test('recordGate is inert before the green light and after finishing', () => {
    const s = createRaceState({ laps: 1, gateCount: G, racerCount: 2 });
    assert.equal(recordGate(s, 0, 1, 0), false, 'no gates before startRace');
    startRace(s, 0);
    flyLap(s, 0, 100);
    assert.equal(isFinished(s, 0), true);
    assert.equal(recordGate(s, 0, 1, 99999), false, 'finished racers stop counting gates');
});

test('unknown racer indices are ignored, not crashes', () => {
    const s = grid();
    assert.equal(recordGate(s, 9, 1, 1100), false);
    assert.equal(recordGate(s, -1, 1, 1100), false);
    assert.equal(racerProgress(s, 9), 0);
    assert.equal(isFinished(s, 9), false);
    assert.equal(placeOf(s, 9), 0);
});

// ---------------------------------------------------------------------------
// laps
// ---------------------------------------------------------------------------

test('lap rolls over at the start/finish line, not at the last gate', () => {
    const s = grid({ laps: 3 });
    for (let g = 1; g < G; g++) recordGate(s, 0, g, 1000 + g * 100);
    assert.equal(s.lap[0], 1, 'still on lap 1 with the line ahead');
    assert.equal(s.gatesPassed[0], G - 1);

    assert.equal(recordGate(s, 0, 0, 1000 + G * 100), true);
    assert.equal(s.lap[0], 2, 'crossing the line starts lap 2');
    assert.equal(s.gatesPassed[0], G);
    assert.equal(s.nextGate[0], 1, 'and the next gate wraps back to 1');
    assert.ok(Math.abs(racerProgress(s, 0) - 1) < 1e-9, 'one full lap of progress');
});

test('lap splits are per-lap, not cumulative, and best lap picks the quickest', () => {
    const s = grid({ laps: 3 });
    let t = flyLap(s, 0, 1100, 100);        // lap 1: ends at 1000 + 12*100 = 2200
    assert.equal(lapSplit(s, 0, 1), 1200);
    assert.equal(lapSplit(s, 0, 2), null, 'lap 2 not set yet');

    // Lap 2 restarts at 2300 (flyLap leaves a one-step gap after the line) and
    // ends 11*50 later at 2850, so the split is 650.
    t = flyLap(s, 0, t, 50);
    assert.equal(lapSplit(s, 0, 2), 650);
    assert.equal(bestLap(s, 0), 650);

    assert.equal(lapSplit(s, 0, 0), null, 'lap numbers are 1-based');
    assert.equal(lapSplit(s, 0, 4), null, 'beyond the race length');
});

test('finish detection fires on the final line crossing and clamps the lap display', () => {
    const s = grid({ laps: 2 });
    let t = flyLap(s, 0, 1100);
    assert.equal(isFinished(s, 0), false, 'one lap of two');
    assert.equal(s.lap[0], 2);

    flyLap(s, 0, t);
    assert.equal(isFinished(s, 0), true);
    assert.equal(s.lap[0], 2, 'lap display clamps to the race length');
    assert.equal(s.finishMs[0] > 0, true);
    assert.equal(s.finishOrder[0], 0);
    assert.equal(isRaceOver(s), false, 'three racers still out there');
    assert.ok(Math.abs(racerProgress(s, 0) - 2) < 1e-9, 'a finisher reports full distance');
});

test('everyone finishing ends the race, in the order they crossed', () => {
    const s = createRaceState({ laps: 1, gateCount: G, racerCount: 3 });
    startRace(s, 0);
    flyLap(s, 2, 10, 10);   // fastest
    flyLap(s, 0, 10, 20);
    flyLap(s, 1, 10, 30);
    assert.equal(isRaceOver(s), true);
    assert.deepEqual(Array.from(s.finishOrder), [2, 0, 1]);
});

// ---------------------------------------------------------------------------
// wrong way
// ---------------------------------------------------------------------------

test('t=0.99 -> t=0.01 is the RIGHT way (the seam bug)', () => {
    const s = grid();
    updateRacerT(s, 0, 0.99);
    for (let k = 1; k <= 20; k++) {
        // Keep flying forward straight through the seam.
        const t = 0.99 + k * 0.01;
        assert.equal(isWrongWay(s, 0, t), false, `forward at t=${t.toFixed(2)} must not read as wrong way`);
    }
    assert.equal(s.wrongAccum[0], 0);
});

test('t=0.01 -> t=0.99 IS the wrong way (the same seam, reversed)', () => {
    const s = grid();
    updateRacerT(s, 0, 0.02);
    assert.equal(isWrongWay(s, 0, 0.99), true, 'a 0.03 backward step trips the threshold');
});

test('wrong way needs sustained reversal, then clears with hysteresis', () => {
    const s = grid();
    updateRacerT(s, 0, 0.50);
    // A single tiny backward twitch is below the enter threshold.
    assert.equal(isWrongWay(s, 0, 0.4990), false);
    assert.ok(s.wrongAccum[0] > 0, 'but it is remembered');
    // Keep reversing: it trips.
    let t = 0.4990;
    for (let k = 0; k < 20 && !s.wrongWay[0]; k++) { t -= 0.001; isWrongWay(s, 0, t); }
    assert.equal(s.wrongWay[0], 1, 'sustained reversal trips it');

    // Turning around clears it — but not on the first forward frame.
    isWrongWay(s, 0, t + 0.001);
    assert.equal(s.wrongWay[0], 1, 'hysteresis: one good frame is not enough');
    for (let k = 0; k < 40 && s.wrongWay[0]; k++) { t += 0.002; isWrongWay(s, 0, t); }
    assert.equal(s.wrongWay[0], 0, 'flying forward clears it');
});

test('a teleport-sized jump is never judged as wrong way', () => {
    const s = grid();
    updateRacerT(s, 0, 0.60);
    const jump = 0.60 - (RACE_CONFIG.wrongWayJumpT + 0.05);
    assert.equal(isWrongWay(s, 0, jump), false);
    assert.equal(s.wrongAccum[0], 0, 'the accumulator is untouched by a respawn');
});

test('finishing silences the wrong-way warning', () => {
    const s = createRaceState({ laps: 1, gateCount: G, racerCount: 1 });
    startRace(s, 0);
    updateRacerT(s, 0, 0.5);
    isWrongWay(s, 0, 0.4);
    assert.equal(s.wrongWay[0], 1);
    flyLap(s, 0, 100);
    isWrongWay(s, 0, 0.3);
    assert.equal(s.wrongWay[0], 0);
});

// ---------------------------------------------------------------------------
// progress + standings
// ---------------------------------------------------------------------------

test('sub-gate progress advances between gates and never overshoots', () => {
    const s = grid();
    recordGate(s, 0, 1, 1100);                     // sitting on gate 1 -> t = 1/12
    const atGate = racerProgress(s, 0);
    assert.ok(Math.abs(atGate - 1 / G) < 1e-9);

    updateRacerT(s, 0, 1 / G + 0.5 / G);           // halfway to gate 2
    const half = racerProgress(s, 0);
    assert.ok(half > atGate && half < 2 / G, `expected between gates, got ${half}`);

    // Overshooting gate 2 without triggering it must not exceed the gate span.
    updateRacerT(s, 0, 2.5 / G);
    assert.ok(racerProgress(s, 0) < 2 / G, 'progress is capped until the gate counts');
});

test('standings order by progress, finishers first, finishers by time', () => {
    const s = grid({ laps: 2, racerCount: 4 });
    // 0: two gates. 1: five gates. 2: nothing. 3: finished.
    recordGate(s, 0, 1, 1100); recordGate(s, 0, 2, 1200);
    for (let g = 1; g <= 5; g++) recordGate(s, 1, g, 1000 + g * 10);
    let t = flyLap(s, 3, 1100); flyLap(s, 3, t);

    updateStandings(s);
    assert.deepEqual(Array.from(s.order), [3, 1, 0, 2]);
    assert.equal(placeOf(s, 3), 1);
    assert.equal(placeOf(s, 2), 4);

    // Racer 1 now finishes, slower than racer 3 — still classified behind.
    t = flyLap(s, 1, 5000); flyLap(s, 1, t);
    updateStandings(s);
    assert.deepEqual(Array.from(s.order.slice(0, 2)), [3, 1]);
    assert.equal(placeOf(s, 1), 2);
});

test('standings are deterministic on an exact tie', () => {
    const s = grid({ racerCount: 3 });
    updateStandings(s);
    assert.deepEqual(Array.from(s.order), [0, 1, 2]);
    // Reversing the stored order must still resolve back to index order.
    s.order[0] = 2; s.order[1] = 1; s.order[2] = 0;
    updateStandings(s);
    assert.deepEqual(Array.from(s.order), [0, 1, 2]);
});

test('progressGap is signed laps of advantage', () => {
    const s = grid();
    for (let g = 1; g <= 6; g++) recordGate(s, 0, g, 1000 + g * 10);
    assert.ok(Math.abs(progressGap(s, 0, 1) - 6 / G) < 1e-9);
    assert.ok(progressGap(s, 1, 0) < 0);
});

// ---------------------------------------------------------------------------
// reset + formatting
// ---------------------------------------------------------------------------

test('resetRaceState returns everything to the grid', () => {
    const s = grid({ laps: 2 });
    flyLap(s, 0, 1100);
    updateRacerT(s, 0, 0.3);
    resetRaceState(s);
    assert.equal(s.running, false);
    assert.equal(s.gatesPassed[0], 0);
    assert.equal(s.lap[0], 1);
    assert.equal(s.nextGate[0], 1);
    assert.equal(lapSplit(s, 0, 1), null);
    assert.equal(bestLap(s, 0), null);
    assert.equal(s.finishedCount, 0);
    assert.equal(elapsedMs(s, 9999), 0);
});

test('a one-gate circuit still completes laps', () => {
    const s = createRaceState({ laps: 2, gateCount: 1, racerCount: 1 });
    startRace(s, 0);
    assert.equal(s.nextGate[0], 0, 'the only gate is the line');
    assert.equal(recordGate(s, 0, 0, 100), true);
    assert.equal(s.lap[0], 2);
    assert.equal(recordGate(s, 0, 0, 200), true);
    assert.equal(isFinished(s, 0), true);
});

test('formatTime', () => {
    assert.equal(formatTime(0), '0:00.00');
    assert.equal(formatTime(83450), '1:23.45');
    assert.equal(formatTime(9999), '0:09.99');
    assert.equal(formatTime(60000), '1:00.00');
    assert.equal(formatTime(3599990), '59:59.99');
    assert.equal(formatTime(null), '--:--.--');
    assert.equal(formatTime(-1), '--:--.--');
    assert.equal(formatTime(NaN), '--:--.--');
});

test('formatDelta', () => {
    assert.equal(formatDelta(1240), '+1.24');
    assert.equal(formatDelta(-310), '-0.31');
    assert.equal(formatDelta(0), '+0.00');
    assert.equal(formatDelta(null), '--');
});
