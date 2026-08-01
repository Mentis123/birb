/**
 * Unit tests for gauntlet/src/game/modes.js — the pure mode system.
 *
 * No dependencies and no THREE import, because CI runs `npm test` with nothing
 * installed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MODES, MODE_ORDER, MODE_DEFS, DEFAULT_MODE, modeDef, isMode,
    DRONE_HUNTER_DURATION, COMBO_MAX, COMBO_DECAY_SECONDS, TURRET_LIVES,
    formatTime, createRunState, resetRunState,
    ringRushWon, droneHunterRemaining, droneHunterTimeUp,
    turretDefenseLost, nextWaveSpawnCount, runIsOver, runResult,
    applyKillScore, decayCombo,
    bestKey, evaluateBest, formatBest,
    advanceStreak,
} from '../gauntlet/src/game/modes.js';

// ---------------------------------------------------------------------------
// mode table
// ---------------------------------------------------------------------------

test('Casual is the default and Zen no longer exists', () => {
    assert.equal(DEFAULT_MODE, MODES.CASUAL);
    assert.equal(MODE_ORDER[0], MODES.CASUAL);
    assert.ok(!('zen' in MODE_DEFS), 'Zen was merged into Casual');
});

test('Casual keeps ambient drones and nesting, and cannot be failed', () => {
    const d = modeDef(MODES.CASUAL);
    assert.equal(d.drones, 'ambient', 'the world reads dead without drones in it');
    assert.equal(d.nesting, true);
    assert.equal(d.canFail, false);
    assert.equal(d.timed, false);
    assert.equal(d.gentle, true, 'Casual carries the tuning Zen used to provide');
});

test('every mode in MODE_ORDER has a descriptor, and vice versa', () => {
    for (const m of MODE_ORDER) assert.ok(isMode(m), m + ' has no descriptor');
    assert.equal(MODE_ORDER.length, Object.keys(MODE_DEFS).length);
});

test('every descriptor is complete — a missing flag reads as a disabled system', () => {
    const required = ['id', 'label', 'blurb', 'hint', 'course', 'laps', 'rivals',
        'drones', 'nesting', 'rings', 'timed', 'canFail', 'gentle',
        'scoreKind', 'lowerIsBetter'];
    for (const [id, def] of Object.entries(MODE_DEFS)) {
        for (const k of required) {
            assert.ok(k in def, `${id} is missing "${k}"`);
        }
        assert.equal(def.id, id, 'descriptor id must match its key');
        assert.ok(['off', 'ambient', 'hunt', 'waves'].includes(def.drones),
            `${id} has an unknown drones setting`);
    }
});

test('modeDef never returns undefined', () => {
    assert.equal(modeDef('not_a_mode').id, DEFAULT_MODE);
    assert.equal(modeDef(undefined).id, DEFAULT_MODE);
    assert.equal(modeDef(null).id, DEFAULT_MODE);
});

test('only the race uses the course, and only the race has rivals', () => {
    for (const [id, def] of Object.entries(MODE_DEFS)) {
        if (id === MODES.RACE) continue;
        assert.equal(def.course, false, id + ' should not show the ribbon');
        assert.equal(def.rivals, false, id + ' should not spawn rivals');
    }
    assert.equal(MODE_DEFS[MODES.RACE].laps, 3);
});

// ---------------------------------------------------------------------------
// time
// ---------------------------------------------------------------------------

test('formatTime matches the original M:SS.cc', () => {
    assert.equal(formatTime(0), '0:00.00');
    assert.equal(formatTime(9.5), '0:09.50');
    assert.equal(formatTime(61.23), '1:01.23');
    assert.equal(formatTime(600), '10:00.00');
});

test('formatTime does not lose a centisecond to float truncation', () => {
    // The original did Math.floor((seconds % 1) * 100). 61.23 % 1 is
    // 0.2299999999999969, so it rendered "1:01.22". Every mode's clock and
    // every personal best ran a centisecond light.
    assert.equal(formatTime(61.23), '1:01.23');
    assert.equal(formatTime(1.07), '0:01.07');
    assert.equal(formatTime(2.29), '0:02.29');
    // ...and the rollover comes out right instead of "0:59.100".
    assert.equal(formatTime(59.999), '1:00.00');
});

test('formatTime survives junk rather than rendering NaN:NaN', () => {
    assert.equal(formatTime(NaN), '0:00.00');
    assert.equal(formatTime(-4), '0:00.00');
    assert.equal(formatTime(undefined), '0:00.00');
});

// ---------------------------------------------------------------------------
// run state
// ---------------------------------------------------------------------------

test('reset clears a dirty run but preserves ringsTotal', () => {
    const s = createRunState();
    s.score = 999; s.combo = 4; s.wave = 7; s.lives = 0;
    s.ringsCollected = 12; s.finished = true;
    s.ringsTotal = 18;                       // synced from the real spawner

    resetRunState(s, MODES.DRONE_HUNTER);

    assert.equal(s.mode, MODES.DRONE_HUNTER);
    assert.equal(s.active, true);
    assert.equal(s.score, 0);
    assert.equal(s.combo, 1);
    assert.equal(s.wave, 1);
    assert.equal(s.lives, TURRET_LIVES);
    assert.equal(s.ringsCollected, 0);
    assert.equal(s.finished, false);
    // The bug this guards: Birb Mobile reset this to a hardcoded 10 while 18
    // rings actually spawned, so Ring Rush could never be won.
    assert.equal(s.ringsTotal, 18, 'ringsTotal is owned by the spawner, not the reset');
});

test('reset falls back to the default mode for junk input', () => {
    const s = resetRunState(createRunState(), 'nonsense');
    assert.equal(s.mode, DEFAULT_MODE);
});

// ---------------------------------------------------------------------------
// win / lose
// ---------------------------------------------------------------------------

test('Ring Rush needs every spawned ring, and zero rings is not a win', () => {
    const s = createRunState();
    s.ringsTotal = 18;
    s.ringsCollected = 17;
    assert.equal(ringRushWon(s), false);
    s.ringsCollected = 18;
    assert.equal(ringRushWon(s), true);

    // A run whose spawner produced nothing must not instantly "win".
    const empty = createRunState();
    empty.ringsTotal = 0;
    empty.ringsCollected = 0;
    assert.equal(ringRushWon(empty), false);
});

test('Drone Hunter counts down 60s and clamps at zero', () => {
    assert.equal(DRONE_HUNTER_DURATION, 60);
    assert.equal(droneHunterRemaining(0), 60);
    assert.equal(droneHunterRemaining(59.5), 0.5);
    assert.equal(droneHunterRemaining(75), 0);

    const s = createRunState();
    s.time = 59.9;
    assert.equal(droneHunterTimeUp(s), false);
    s.time = 60;
    assert.equal(droneHunterTimeUp(s), true);
});

test('Turret Defense loses at zero lives and follows the 2+wave curve', () => {
    const s = createRunState();
    assert.equal(turretDefenseLost(s), false);
    s.lives = 0;
    assert.equal(turretDefenseLost(s), true);

    assert.equal(nextWaveSpawnCount(1), 3);
    assert.equal(nextWaveSpawnCount(2), 4);
    assert.equal(nextWaveSpawnCount(9), 11);
});

test('runIsOver routes per mode, and Casual never ends', () => {
    const casual = resetRunState(createRunState(), MODES.CASUAL);
    casual.time = 99999;
    assert.equal(runIsOver(casual), false, 'Casual has no fail and no clock');

    const rr = resetRunState(createRunState(), MODES.RING_RUSH);
    rr.ringsTotal = 3; rr.ringsCollected = 3;
    assert.equal(runIsOver(rr), true);

    const dh = resetRunState(createRunState(), MODES.DRONE_HUNTER);
    dh.time = 60;
    assert.equal(runIsOver(dh), true);

    const td = resetRunState(createRunState(), MODES.TURRET_DEFENSE);
    td.lives = 0;
    assert.equal(runIsOver(td), true);
});

test('runResult reports the quantity its mode is scored on', () => {
    const rr = resetRunState(createRunState(), MODES.RING_RUSH);
    rr.time = 42.5;
    assert.equal(runResult(rr), 42.5);

    const dh = resetRunState(createRunState(), MODES.DRONE_HUNTER);
    dh.score = 1200;
    assert.equal(runResult(dh), 1200);

    const td = resetRunState(createRunState(), MODES.TURRET_DEFENSE);
    td.wave = 6;
    assert.equal(runResult(td), 6);

    assert.equal(runResult(resetRunState(createRunState(), MODES.CASUAL)), null);
});

// ---------------------------------------------------------------------------
// combo
// ---------------------------------------------------------------------------

test('kills scale by combo and the combo caps', () => {
    const s = resetRunState(createRunState(), MODES.DRONE_HUNTER);

    let r = applyKillScore(s, 100);
    assert.equal(s.score, 100, 'first kill is at 1.0x');
    assert.equal(s.dronesDestroyed, 1);
    assert.equal(s.combo, 1.25);
    assert.equal(s.comboTimer, COMBO_DECAY_SECONDS);
    assert.deepEqual(r, { before: 1, after: 1 }, 'no whole-number combo step yet');

    applyKillScore(s, 100);  // 1.25x -> 125
    applyKillScore(s, 100);  // 1.50x -> 150
    r = applyKillScore(s, 100);  // 1.75x -> 175, combo crosses to 2
    assert.equal(s.score, 100 + 125 + 150 + 175);
    assert.deepEqual(r, { before: 1, after: 2 }, 'combo-up VFX fires on the whole step');

    for (let i = 0; i < 100; i++) applyKillScore(s, 1);
    assert.equal(s.combo, COMBO_MAX, 'combo is capped');
});

test('combo decays after the idle window and only reports the lapse once', () => {
    const s = resetRunState(createRunState(), MODES.DRONE_HUNTER);
    applyKillScore(s, 100);
    assert.equal(s.combo, 1.25);

    assert.equal(decayCombo(s, 1), false);
    assert.equal(decayCombo(s, 1), false);
    assert.equal(decayCombo(s, 1.5), true, 'lapses when the timer runs out');
    assert.equal(s.combo, 1);
    assert.equal(decayCombo(s, 1), false, 'an already-expired combo does not re-fire');
});

// ---------------------------------------------------------------------------
// personal bests
// ---------------------------------------------------------------------------

test('best keys are namespaced per mode', () => {
    assert.equal(bestKey(MODES.RING_RUSH), 'gauntlet.best.ring_rush');
    assert.notEqual(bestKey(MODES.RACE), bestKey(MODES.RING_RUSH));
});

test('a first run is always a record', () => {
    const r = evaluateBest(null, 30, MODES.RING_RUSH);
    assert.equal(r.isNewBest, true);
    assert.equal(r.bestValue, 30);
});

test('lower is better for timed modes, higher for scored modes', () => {
    // Ring Rush: faster wins.
    assert.equal(evaluateBest('30', 25, MODES.RING_RUSH).isNewBest, true);
    assert.equal(evaluateBest('30', 35, MODES.RING_RUSH).isNewBest, false);
    assert.equal(evaluateBest('30', 35, MODES.RING_RUSH).bestValue, 30,
        'a losing run still reports the standing best');

    // Drone Hunter: higher wins.
    assert.equal(evaluateBest('1000', 1200, MODES.DRONE_HUNTER).isNewBest, true);
    assert.equal(evaluateBest('1000', 900, MODES.DRONE_HUNTER).isNewBest, false);

    // Turret Defense: further wave wins.
    assert.equal(evaluateBest('4', 6, MODES.TURRET_DEFENSE).isNewBest, true);
});

test('a corrupt saved value is treated as no record, not as zero', () => {
    // The original coerced junk through parseFloat||fallback, so a corrupt
    // entry silently became 0 and every subsequent run "beat" it.
    const r = evaluateBest('not-a-number', 30, MODES.RING_RUSH);
    assert.equal(r.isNewBest, true);
    assert.equal(r.bestValue, 30);
});

test('a non-finite run value can never overwrite a good best', () => {
    const r = evaluateBest('30', NaN, MODES.RING_RUSH);
    assert.equal(r.isNewBest, false);
    assert.equal(r.bestValue, null);
});

test('formatBest speaks each mode language', () => {
    assert.equal(formatBest(MODES.RING_RUSH, 61.23), '1:01.23');
    assert.equal(formatBest(MODES.DRONE_HUNTER, 1234.6), '1235');
    assert.equal(formatBest(MODES.TURRET_DEFENSE, 6), 'Wave 6');
    assert.equal(formatBest(MODES.CASUAL, 5), null, 'Casual is not scored');
    assert.equal(formatBest(MODES.RING_RUSH, null), null);
});

// ---------------------------------------------------------------------------
// streak
// ---------------------------------------------------------------------------

test('streak extends on consecutive days, holds same-day, resets on a gap', () => {
    let s = advanceStreak(null, '2026-08-01');
    assert.deepEqual(s, { count: 1, last: '2026-08-01' });

    s = advanceStreak(s, '2026-08-01');
    assert.equal(s.count, 1, 'playing twice in a day does not double-count');

    s = advanceStreak(s, '2026-08-02');
    assert.equal(s.count, 2);

    s = advanceStreak(s, '2026-08-04');
    assert.equal(s.count, 1, 'a missed day resets the streak');
});

test('streak crosses a month boundary', () => {
    const s = advanceStreak({ count: 4, last: '2026-08-31' }, '2026-09-01');
    assert.equal(s.count, 5, 'Aug 31 -> Sep 1 is consecutive');
});
