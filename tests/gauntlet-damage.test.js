import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_PIPS, CONTACT_INTERVAL, HEAL_DELAY, HEAL_INTERVAL,
    createDamageState, resetDamage, updateDamage,
    damageVisible, damage01, reviveDamage,
} from '../gauntlet/src/game/damage.js';

/** Run `seconds` of frames at 60Hz with a constant contact flag. */
function run(s, seconds, touching) {
    const step = 1 / 60;
    let hits = 0;
    for (let t = 0; t < seconds - 1e-9; t += step) {
        if (updateDamage(s, step, touching)) hits++;
    }
    return hits;
}

test('starts full, hidden, and undamaged', () => {
    const s = createDamageState();
    assert.equal(s.pips, MAX_PIPS);
    assert.equal(damageVisible(s), false);
    assert.equal(damage01(s), 1);
});

test('the ring stays hidden while nothing is touched', () => {
    const s = createDamageState();
    run(s, 30, false);
    assert.equal(damageVisible(s), false);
    assert.equal(s.pips, MAX_PIPS);
});

test('first contact costs a pip immediately, not after a delay', () => {
    const s = createDamageState();
    const lost = updateDamage(s, 1 / 60, true);
    assert.equal(lost, true, 'the very first frame of contact must register');
    assert.equal(s.pips, MAX_PIPS - 1);
    assert.equal(damageVisible(s), true, 'the ring appears on the first hit');
    assert.equal(damage01(s), 0.75);
});

test('a single collision spanning many frames only costs one pip', () => {
    // The bug this guards: 50ms of overlap at 60fps is 3 frames, and without
    // the cooldown that is 3 pips gone from brushing one branch.
    const s = createDamageState();
    run(s, 0.05, true);
    assert.equal(s.pips, MAX_PIPS - 1);
});

test('sustained contact costs one pip per contact interval', () => {
    const s = createDamageState();
    // 1 immediate + 1 per interval. Just under 3 intervals => 3 total.
    const hits = run(s, CONTACT_INTERVAL * 3 - 0.05, true);
    assert.equal(hits, 3);
    assert.equal(s.pips, 1);
});

test('four contacts down the bird', () => {
    const s = createDamageState();
    let downedAt = -1;
    const step = 1 / 60;
    for (let i = 0; i < 60 * 10; i++) {
        updateDamage(s, step, true);
        if (s.downed) { downedAt = i * step; break; }
    }
    assert.equal(s.pips, 0);
    assert.ok(downedAt >= 0, 'must report downed');
    // 3 intervals after the free first hit, within a frame.
    assert.ok(Math.abs(downedAt - CONTACT_INTERVAL * 3) < 0.05,
        `downed at ${downedAt}s, expected ~${CONTACT_INTERVAL * 3}s`);
});

test('downed is a single-frame edge, not a latched flag', () => {
    const s = createDamageState();
    run(s, CONTACT_INTERVAL * 3 + 0.1, true);
    assert.equal(s.pips, 0);
    updateDamage(s, 1 / 60, true);
    assert.equal(s.downed, false, 'downed must not re-fire every frame at zero');
});

test('healing does not start until the heal delay has elapsed', () => {
    const s = createDamageState();
    updateDamage(s, 1 / 60, true);
    assert.equal(s.pips, 3);
    run(s, HEAL_DELAY - 0.1, false);
    assert.equal(s.pips, 3, 'no free heal during the delay window');
});

test('pips come back one per heal interval after the delay', () => {
    const s = createDamageState();
    run(s, CONTACT_INTERVAL * 2 + 0.05, true);   // 3 pips spent
    assert.equal(s.pips, 1);
    run(s, HEAL_DELAY + HEAL_INTERVAL + 0.05, false);
    assert.equal(s.pips, 2);
    run(s, HEAL_INTERVAL, false);
    assert.equal(s.pips, 3);
});

test('healing to full hides the ring again', () => {
    const s = createDamageState();
    updateDamage(s, 1 / 60, true);
    assert.equal(damageVisible(s), true);
    run(s, HEAL_DELAY + HEAL_INTERVAL * MAX_PIPS + 1, false);
    assert.equal(s.pips, MAX_PIPS);
    assert.equal(damageVisible(s), false, 'a healthy bird needs no health ring');
});

test('healing never overshoots full', () => {
    const s = createDamageState();
    updateDamage(s, 1 / 60, true);
    run(s, 600, false);
    assert.equal(s.pips, MAX_PIPS);
});

test('breaking contact for one frame does not refund the cooldown', () => {
    // A drone clipping in and out of the hit radius at 60fps must not strip
    // the whole ring in a quarter of a second.
    const s = createDamageState();
    const step = 1 / 60;
    let hits = 0;
    for (let i = 0; i < 30; i++) {                 // 0.5s of alternating frames
        if (updateDamage(s, step, i % 2 === 0)) hits++;
    }
    assert.equal(hits, 1, `flicker contact cost ${hits} pips, expected 1`);
    assert.equal(s.pips, MAX_PIPS - 1);
});

test('flying away from a drone is a real escape', () => {
    const s = createDamageState();
    run(s, CONTACT_INTERVAL + 0.05, true);        // 2 pips gone
    assert.equal(s.pips, 2);
    run(s, HEAL_DELAY + HEAL_INTERVAL * 2 + 0.1, false);
    assert.equal(s.pips, MAX_PIPS);
    assert.equal(damageVisible(s), false);
});

test('revive returns half a ring and a grace cooldown', () => {
    const s = createDamageState();
    run(s, CONTACT_INTERVAL * 3 + 0.1, true);
    assert.equal(s.pips, 0);
    reviveDamage(s);
    assert.equal(s.pips, 2);
    assert.equal(damageVisible(s), true);
    // The tree you fell into is still there; it must not immediately re-hit.
    assert.equal(updateDamage(s, 1 / 60, true), false);
    assert.equal(s.pips, 2);
});

test('reset clears everything', () => {
    const s = createDamageState();
    run(s, CONTACT_INTERVAL * 2, true);
    resetDamage(s);
    assert.equal(s.pips, MAX_PIPS);
    assert.equal(damageVisible(s), false);
    assert.equal(s.cooldown, 0);
});

test('zero and negative dt are inert', () => {
    const s = createDamageState();
    updateDamage(s, 0, true);
    assert.equal(s.pips, MAX_PIPS - 1, 'a hit still lands on a zero-dt frame');
    const before = s.cooldown;
    updateDamage(s, -1, true);
    assert.equal(s.cooldown, before, 'negative dt must not advance the cooldown');
    assert.equal(s.pips, MAX_PIPS - 1);
});
