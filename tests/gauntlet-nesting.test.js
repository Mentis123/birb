/**
 * tests/gauntlet-nesting.test.js — the PURE half of Birb Gauntlet's nesting
 * system. node --test, zero dependencies (CI runs `npm test` with nothing
 * installed), no THREE, no DOM.
 *
 * The cases marked [ported] come from Birb Mobile's
 * `tests/nesting-system.test.js` and are kept because they still describe real
 * behaviour: a forced landing that starts out of proximity, and a landing that
 * survives a target which keeps moving until it finally arrives. The original's
 * THREE-shaped scaffolding is gone — here the wrapper measures the distance and
 * the core is handed the number, so the same behaviour is testable without a
 * renderer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    NESTING_STATES,
    NESTING_CONFIG,
    createNestingCore,
    approachThrottle,
    glideSpeedCap,
    takeOffImpulse,
    steerFromError,
    stateDrivesFlight,
    stateIsFreeFlight,
    clamp,
} from '../gauntlet/src/nesting/nesting-system.js';

const DT = 1 / 60;
const S = NESTING_STATES;

/** Run the core forward with a constant nearest-index and distance. */
function run(core, steps, near = -1, distance = Infinity, dt = DT) {
    for (let i = 0; i < steps; i++) core.update(dt, near, distance);
    return core.state;
}

// ---------------------------------------------------------------------------
// The transitions the brief names
// ---------------------------------------------------------------------------

test('proximity enters APPROACHING and leaving it exits', () => {
    const core = createNestingCore();
    assert.equal(core.state, S.FLYING);

    core.update(DT, 3, Infinity);
    assert.equal(core.state, S.APPROACHING);
    assert.equal(core.nearNest, 3);

    // Still in range: stays put, does not oscillate.
    assert.equal(run(core, 30, 3), S.APPROACHING);

    core.update(DT, -1, Infinity);
    assert.equal(core.state, S.FLYING);
    assert.equal(core.nearNest, -1);
});

test('landing completes and reaches NESTED', () => {
    const core = createNestingCore();
    core.update(DT, 0, Infinity);
    assert.equal(core.requestLand(0), true);
    assert.equal(core.state, S.LANDING);
    assert.equal(core.activeNest, 0);

    // Closing in: still landing until inside the arrival threshold.
    let d = 40;
    for (let i = 0; i < 200 && core.state === S.LANDING; i++) {
        d = Math.max(0, d - 0.35);
        core.update(DT, 0, d);
    }
    assert.equal(core.state, S.NESTED);
    assert.equal(core.stalled, false, 'arrival should be earned, not forced');
    assert.ok(core.isNested());
    assert.equal(core.drivesFlight(), true);
});

test('takeoff returns to FLYING after exactly takeOffDuration', () => {
    const core = createNestingCore();
    core.requestLand(2);
    core.update(DT, 2, 0.1);
    assert.equal(core.state, S.NESTED);

    assert.equal(core.takeOff(), true);
    assert.equal(core.state, S.TAKING_OFF);
    assert.equal(core.takeOffTimer, NESTING_CONFIG.takeOffDuration);

    // Not done a hair early...
    const steps = Math.floor(NESTING_CONFIG.takeOffDuration / DT);
    assert.equal(run(core, steps - 1, -1), S.TAKING_OFF);
    assert.ok(core.takeOffTimer > 0);
    // ...and done at the end of the window.
    run(core, 2, -1);
    assert.equal(core.state, S.FLYING);
    assert.equal(core.takeOffTimer, 0);
    assert.equal(core.activeNest, -1, 'the nest is released on take-off');
});

test('a landing in progress is not restarted by re-entering proximity', () => {
    const core = createNestingCore();
    core.requestLand(1);
    run(core, 20, 1, 30);
    const t = core.landingTime;
    assert.ok(t > 0);

    // Another nest comes into range and the player mashes Land again.
    assert.equal(core.requestLand(5), false, 'requestLand is illegal while LANDING');
    assert.equal(core.requestLand(1), false);
    assert.equal(core.activeNest, 1, 'target must not change mid-glide');
    assert.equal(core.state, S.LANDING);

    run(core, 20, 5, 30);
    assert.ok(core.landingTime > t, 'the timer kept running, i.e. no restart');
    assert.equal(core.activeNest, 1);
});

test('takeOff cannot fire while already FLYING (or approaching, or landing)', () => {
    const core = createNestingCore();
    assert.equal(core.takeOff(), false);
    assert.equal(core.state, S.FLYING);

    core.update(DT, 0, Infinity);
    assert.equal(core.state, S.APPROACHING);
    assert.equal(core.takeOff(), false);
    assert.equal(core.state, S.APPROACHING);

    core.requestLand(0);
    assert.equal(core.takeOff(), false);
    assert.equal(core.state, S.LANDING);

    core.update(DT, 0, 0.05);
    assert.equal(core.state, S.NESTED);
    assert.equal(core.takeOff(), true);
    // ...and not twice.
    assert.equal(core.takeOff(), false);
});

// ---------------------------------------------------------------------------
// [ported] from Birb Mobile's tests
// ---------------------------------------------------------------------------

test('[ported] a forced landing starts even with no nest in proximity', () => {
    const core = createNestingCore();
    core.update(DT, -1, Infinity);
    assert.equal(core.state, S.FLYING);
    assert.equal(core.nearNest, -1);

    assert.equal(core.requestLand(7), true);
    assert.equal(core.state, S.LANDING);
    assert.equal(core.activeNest, 7);
});

test('[ported] a landing whose target keeps moving still reaches NESTED', () => {
    const core = createNestingCore();
    core.requestLand(0);

    // The target runs away for a while — the original's "nest attached to
    // rotating geometry" case — and the glide must neither give up nor arrive.
    let d = 12;
    for (let i = 0; i < 120; i++) {
        d += 0.02;
        core.update(DT, 0, d);
        assert.equal(core.state, S.LANDING);
    }
    // Then it settles and the bird catches it.
    while (core.state === S.LANDING && d > 0) {
        d = Math.max(0, d - 0.4);
        core.update(DT, 0, d);
    }
    assert.equal(core.state, S.NESTED);
});

// ---------------------------------------------------------------------------
// Timers, safety valve, welcome, reset
// ---------------------------------------------------------------------------

test('the landing safety valve seats a glide that never arrives', () => {
    const core = createNestingCore();
    core.requestLand(0);
    // Distance never shrinks. The original had no valve here and hovered forever.
    const steps = Math.ceil(NESTING_CONFIG.landingMaxDuration / DT) + 2;
    run(core, steps, 0, 500);
    assert.equal(core.state, S.NESTED);
    assert.equal(core.stalled, true, 'the valve must be distinguishable from a real arrival');
});

test('arrived is true for exactly one frame', () => {
    const core = createNestingCore();
    core.requestLand(0);
    core.update(DT, 0, 40);
    assert.equal(core.arrived, false);
    core.update(DT, 0, 0.1);
    assert.equal(core.arrived, true);
    core.update(DT, 0, 0.1);
    assert.equal(core.arrived, false);
});

test('shouldShowWelcome fires once per landing and re-arms after take-off', () => {
    const core = createNestingCore();
    assert.equal(core.shouldShowWelcome(), false, 'not while flying');
    core.requestLand(0);
    core.update(DT, 0, 0);
    assert.equal(core.shouldShowWelcome(), true);
    assert.equal(core.shouldShowWelcome(), false);

    core.takeOff();
    run(core, 40, -1);
    assert.equal(core.state, S.FLYING);
    core.requestLand(0);
    core.update(DT, 0, 0);
    assert.equal(core.shouldShowWelcome(), true);
});

test('onStateChange reports every transition with the previous state', () => {
    const seen = [];
    const core = createNestingCore({
        onStateChange(next, prev, index) { seen.push([prev, next, index]); },
    });
    core.update(DT, 4, Infinity);      // FLYING -> APPROACHING
    core.requestLand(4);               // -> LANDING
    core.update(DT, 4, 0);             // -> NESTED
    core.takeOff();                    // -> TAKING_OFF
    run(core, 40, -1);                 // -> FLYING

    assert.deepEqual(seen.map((s) => s[1]), [
        S.APPROACHING, S.LANDING, S.NESTED, S.TAKING_OFF, S.FLYING,
    ]);
    assert.equal(seen[0][0], S.FLYING);
    assert.equal(seen[2][2], 4, 'the nest index rides along with the change');
});

test('reset clears state, timers and the occupied nest', () => {
    const core = createNestingCore();
    core.requestLand(3);
    run(core, 10, 3, 20);
    core.reset();
    assert.equal(core.state, S.FLYING);
    assert.equal(core.activeNest, -1);
    assert.equal(core.nearNest, -1);
    assert.equal(core.landingTime, 0);
    assert.equal(core.takeOffTimer, 0);
    assert.equal(core.takeOff(), false);
});

test('requestLand rejects a negative index and defaults to the nest in range', () => {
    const core = createNestingCore();
    assert.equal(core.requestLand(-1), false);
    assert.equal(core.requestLand(), false, 'nothing in range, nothing to land on');
    core.update(DT, 6, Infinity);
    assert.equal(core.requestLand(), true);
    assert.equal(core.activeNest, 6);
});

test('a zero or negative dt advances no timer', () => {
    const core = createNestingCore();
    core.requestLand(0);
    core.update(0, 0, 50);
    core.update(-1, 0, 50);
    assert.equal(core.landingTime, 0);
    core.update(DT, 0, 0);
    core.takeOff();
    core.update(-5, -1, Infinity);
    assert.equal(core.takeOffTimer, NESTING_CONFIG.takeOffDuration);
    assert.equal(core.state, S.TAKING_OFF);
});

test('state predicates agree with the machine', () => {
    assert.equal(stateIsFreeFlight(S.FLYING), true);
    assert.equal(stateIsFreeFlight(S.APPROACHING), true);
    assert.equal(stateIsFreeFlight(S.LANDING), false);
    assert.equal(stateDrivesFlight(S.LANDING), true);
    assert.equal(stateDrivesFlight(S.NESTED), true);
    assert.equal(stateDrivesFlight(S.TAKING_OFF), true);
    assert.equal(stateDrivesFlight(S.FLYING), false);
    assert.equal(stateDrivesFlight(S.APPROACHING), false);

    const core = createNestingCore();
    assert.equal(core.isFlying(), true);
    core.requestLand(0);
    assert.equal(core.isFlying(), false, 'a glide is not free flight');
    core.update(DT, 0, 0);
    assert.equal(core.isFlying(), false);
    core.takeOff();
    assert.equal(core.isFlying(), true, 'take-off counts as flying, as in the original');
});

// ---------------------------------------------------------------------------
// The pure glide math
// ---------------------------------------------------------------------------

test('glideSpeedCap keeps Birb Mobile\'s overshoot guard', () => {
    // Far out: capped by autoFlySpeed, verbatim 16.
    assert.equal(glideSpeedCap(500, DT), 16.0);
    // The guard: never step further than the remaining distance.
    const C = NESTING_CONFIG;
    assert.equal(glideSpeedCap(0.1, DT),
        Math.min(C.autoFlySpeed, 0.1 / DT, Math.max(C.flareMinSpeed, 0.1 * C.flareRate)));
    assert.ok(glideSpeedCap(0.1, DT) * DT <= 0.1 + 1e-12, 'a step may never overshoot');
    for (let d = 0; d <= 60; d += 0.13) {
        assert.ok(glideSpeedCap(d, DT) * DT <= d + 1e-12, 'overshoot at d=' + d);
    }
});

test('glideSpeedCap flares monotonically toward the bowl', () => {
    let prev = Infinity;
    for (let d = NESTING_CONFIG.flareRadius; d >= 0; d -= 0.05) {
        const v = glideSpeedCap(d, DT);
        assert.ok(v <= prev + 1e-9, 'speed rose while closing in at d=' + d);
        prev = v;
    }
    assert.ok(glideSpeedCap(0, DT) >= 0);
    // The floor is what stops arrival being an asymptote.
    assert.equal(glideSpeedCap(0.2, 1),
        Math.min(NESTING_CONFIG.autoFlySpeed, 0.2, NESTING_CONFIG.flareMinSpeed));
});

test('glideSpeedCap tolerates a zero dt', () => {
    assert.equal(Number.isFinite(glideSpeedCap(50, 0)), true);
    assert.equal(glideSpeedCap(50, 0), 16.0);
});

test('approachThrottle eases from cruise to the autoFlySpeed ratio', () => {
    const cruise = 27;
    assert.equal(approachThrottle(200, cruise), 1);
    const near = approachThrottle(NESTING_CONFIG.flareRadius, cruise);
    assert.ok(Math.abs(near - 16 / 27) < 1e-9, 'settles at autoFlySpeed/cruise');
    // Monotonic, so the bird never speeds up as it closes.
    let prev = -1;
    for (let d = 0; d <= 120; d += 1) {
        const t = approachThrottle(d, cruise);
        assert.ok(t >= prev - 1e-9, 'throttle dipped and rose again at d=' + d);
        assert.ok(t >= 0 && t <= 1);
        prev = t;
    }
    // A slow-cruising controller is never throttled UP past 1.
    assert.equal(approachThrottle(0, 10), 1);
    assert.equal(approachThrottle(0, 0), 1);
});

test('takeOffImpulse decays linearly over the window', () => {
    const c = NESTING_CONFIG;
    assert.equal(takeOffImpulse(c.takeOffDuration), c.takeOffBoost);
    assert.equal(takeOffImpulse(c.takeOffDuration / 2), c.takeOffBoost / 2);
    assert.equal(takeOffImpulse(0), 0);
    assert.equal(takeOffImpulse(-1), 0);
    assert.equal(takeOffImpulse(99), c.takeOffBoost, 'clamped, never superboosted');
});

test('steerFromError is a clamped proportional stick', () => {
    assert.equal(steerFromError(0, 2.4), 0);
    assert.equal(steerFromError(0.1, 2.4), 0.24);
    assert.equal(steerFromError(2, 2.4), 1);
    assert.equal(steerFromError(-2, 2.4), -1);
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-5, 0, 1), 0);
});

test('the feel constants are Birb Mobile\'s, verbatim', () => {
    assert.equal(NESTING_CONFIG.autoFlySpeed, 16.0);
    assert.equal(NESTING_CONFIG.arrivalThreshold, 0.3);
    assert.equal(NESTING_CONFIG.takeOffDuration, 0.5);
    assert.equal(NESTING_CONFIG.takeOffBoost, 3.0);
    assert.equal(NESTING_CONFIG.takeOffSpeed, 4.0);
    assert.equal(NESTING_CONFIG.landRange, 24.0);
});
