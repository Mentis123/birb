/**
 * Unit tests for Birb Gauntlet's flight math.
 *
 * `node --test`, zero dependencies, no THREE import — CI runs `npm test`
 * without installing anything, so anything imported here must be pure JS.
 * gauntlet/src/bird/flight.js takes THREE as a constructor argument and imports
 * nothing, which is exactly what makes its exported math testable from here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FLIGHT_CONFIG,
    FLIGHT_STATE,
    FALL_RAMP_DURATION,
    FALL_RAMP_MAX_MULT,
    clamp,
    floorRadiusAt,
    fallRampMultiplier,
    stepAirSpeed,
    turnRateScale,
    createBoostState,
    stepBoostState,
    addBoostCharge,
    airSpeed01,
    speed01,
} from '../gauntlet/src/bird/flight.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// basics
// ---------------------------------------------------------------------------

test('clamp', () => {
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-5, 0, 1), 0);
    assert.equal(clamp(0.4, 0, 1), 0.4);
});

test('speed envelope constants are internally consistent', () => {
    const c = FLIGHT_CONFIG;
    assert.ok(c.minSpeed < c.cruiseSpeed, 'cruise must sit above the stall floor');
    assert.ok(c.cruiseSpeed < c.maxSpeed, 'a dive must have somewhere to go');
    assert.ok(c.maxSpeed < c.boostMaxSpeed, 'boost must beat the best dive');
    assert.ok(c.maxPitch < Math.PI / 2, 'pitch clamp must forbid vertical/inverted');
});

test('flight states are the three the animator branches on', () => {
    assert.deepEqual(Object.values(FLIGHT_STATE).sort(),
        ['flying', 'launching', 'tumbling']);
});

// ---------------------------------------------------------------------------
// floor clamping against a stub terrain sampler
// ---------------------------------------------------------------------------

test('floorRadiusAt never rises above the baseline (the anti-ratchet invariant)', () => {
    // The gravity-less bird would be pushed permanently upward by a floor that
    // could exceed sphereRadius. Positive heights MUST be ignored.
    assert.equal(floorRadiusAt(100, 0, 0), 100);
    assert.equal(floorRadiusAt(100, -20, 0), 80);
    assert.equal(floorRadiusAt(100, 37, 0), 100, 'positive terrain must clamp to 0');
});

test('floorRadiusAt adds bird clearance as a flat offset', () => {
    assert.equal(floorRadiusAt(100, 0, 1.5), 101.5);
    assert.equal(floorRadiusAt(100, -10, 1.5), 91.5);
    // Clearance is constant, not slope-following: the gap over a valley floor
    // is the same as the gap over flat ground.
    const flat = floorRadiusAt(100, 0, 2) - floorRadiusAt(100, 0, 0);
    const valley = floorRadiusAt(100, -26, 2) - floorRadiusAt(100, -26, 0);
    assert.equal(flat, valley);
});

test('floor tracks a stub terrain sampler downward only', () => {
    // Stub "planet": a canyon on one side, a (illegal, deliberately) rise on
    // the other. The rise must not lift the floor.
    const sample = (nx) => (nx > 0 ? -24 : 18);
    const R = 100, br = 1.2;
    const canyonFloor = floorRadiusAt(R, sample(1), br);
    const riseFloor = floorRadiusAt(R, sample(-1), br);
    assert.equal(canyonFloor, 77.2);
    assert.equal(riseFloor, 101.2);
    assert.ok(canyonFloor < R, 'canyon lets the bird descend below the baseline');
    assert.ok(riseFloor <= R + br, 'a rise can never push the floor past baseline+clearance');
});

test('a bird cruising level over rolling terrain never ratchets upward', () => {
    // Walk a stub terrain profile that oscillates, clamping altitude to the
    // floor each step the way _applyFloor does. Altitude must be unchanged.
    const R = 100, br = 1.2;
    let radius = R + br;
    let maxRadius = radius;
    for (let i = 0; i < 2000; i++) {
        const h = -13 + 13 * Math.cos(i * 0.05); // in [-26, 0]
        const floor = floorRadiusAt(R, h, br);
        if (radius < floor) radius = floor;
        if (radius > maxRadius) maxRadius = radius;
    }
    assert.equal(maxRadius, R + br, 'altitude must be bit-identical after 2000 steps');
});

test('a diving bird can reach the bottom of a canyon', () => {
    const R = 100, br = 1.2;
    let radius = R + br;
    for (let i = 0; i < 600; i++) {
        radius -= 0.2;                                  // dive
        const floor = floorRadiusAt(R, -26, br);        // deepest carve
        if (radius < floor) radius = floor;
    }
    assert.equal(radius, 75.2);
    assert.ok(radius < R, 'the bird must end up BELOW the baseline, inside the canyon');
});

// ---------------------------------------------------------------------------
// energy trade
// ---------------------------------------------------------------------------

test('diving builds speed, climbing bleeds it', () => {
    const c = FLIGHT_CONFIG;
    const dive = stepAirSpeed(c.cruiseSpeed, -0.4, 1, DT, c.maxSpeed);
    const climb = stepAirSpeed(c.cruiseSpeed, 0.4, 1, DT, c.maxSpeed);
    assert.ok(dive > c.cruiseSpeed, 'dive must accelerate');
    assert.ok(climb < c.cruiseSpeed, 'climb must decelerate');
    // Symmetric about cruise, to within the drag term.
    assert.ok(Math.abs((dive - c.cruiseSpeed) - (c.cruiseSpeed - climb)) < 0.02);
});

test('a sustained dive is clamped by the ceiling, not unbounded', () => {
    const c = FLIGHT_CONFIG;
    let s = c.cruiseSpeed;
    for (let i = 0; i < 1200; i++) s = stepAirSpeed(s, -1, 1, DT, c.maxSpeed);
    assert.equal(s, c.maxSpeed);
});

test('a sustained climb is clamped by the stall floor', () => {
    const c = FLIGHT_CONFIG;
    let s = c.cruiseSpeed;
    for (let i = 0; i < 1200; i++) s = stepAirSpeed(s, 1, 1, DT, c.maxSpeed);
    assert.equal(s, c.minSpeed, 'a climb must never park or reverse the bird');
});

test('level flight converges on cruise from either side', () => {
    const c = FLIGHT_CONFIG;
    let fast = c.maxSpeed, slow = c.minSpeed;
    for (let i = 0; i < 4000; i++) {
        fast = stepAirSpeed(fast, 0, 1, DT, c.maxSpeed);
        slow = stepAirSpeed(slow, 0, 1, DT, c.maxSpeed);
    }
    assert.ok(Math.abs(fast - c.cruiseSpeed) < 0.01);
    assert.ok(Math.abs(slow - c.cruiseSpeed) < 0.01);
});

test('throttle scales the cruise target', () => {
    const c = FLIGHT_CONFIG;
    let s = c.cruiseSpeed;
    for (let i = 0; i < 4000; i++) s = stepAirSpeed(s, 0, 0.5, DT, c.maxSpeed);
    // The stall floor wins if half cruise is below it, which is the point of
    // having a floor at all.
    assert.equal(s, Math.max(c.minSpeed, c.cruiseSpeed * 0.5));
});

test('energy trade is frame-rate independent to within a few percent', () => {
    const c = FLIGHT_CONFIG;
    let a = c.cruiseSpeed, b = c.cruiseSpeed;
    for (let i = 0; i < 120; i++) a = stepAirSpeed(a, -0.35, 1, 1 / 60, c.maxSpeed);
    for (let i = 0; i < 60; i++) b = stepAirSpeed(b, -0.35, 1, 1 / 30, c.maxSpeed);
    assert.ok(Math.abs(a - b) / a < 0.02, `60Hz ${a} vs 30Hz ${b}`);
});

// ---------------------------------------------------------------------------
// turn tightening
// ---------------------------------------------------------------------------

test('turn rate rises with speed so the radius does not blow out', () => {
    assert.equal(turnRateScale(0), 1);
    assert.ok(turnRateScale(1) > turnRateScale(0.5));
    assert.ok(turnRateScale(0.5) > turnRateScale(0));
    assert.equal(turnRateScale(1), 1 + FLIGHT_CONFIG.turnTighten);
    assert.equal(turnRateScale(4), turnRateScale(1), 'clamped above 1');
    assert.equal(turnRateScale(-3), turnRateScale(0), 'clamped below 0');
});

test('turn radius still grows with speed, just more slowly', () => {
    // Sanity check on the tuning: tightening must not be so aggressive that a
    // fast bird turns tighter than a slow one (that reads as ice skating).
    const c = FLIGHT_CONFIG;
    const radiusAt = (s01) => {
        const v = c.cruiseSpeed * 0.6 + s01 * (c.boostMaxSpeed - c.cruiseSpeed * 0.6);
        return v / (c.yawRate * turnRateScale(s01));
    };
    assert.ok(radiusAt(1) > radiusAt(0));
});

// ---------------------------------------------------------------------------
// boost
// ---------------------------------------------------------------------------

test('boost charges only while diving', () => {
    const st = createBoostState();
    for (let i = 0; i < 60; i++) stepBoostState(st, false, 0, DT);
    assert.equal(st.meter, 0, 'level flight charges nothing');
    for (let i = 0; i < 60; i++) stepBoostState(st, false, 0.5, DT);
    assert.equal(st.meter, 0, 'climbing charges nothing');
    for (let i = 0; i < 60; i++) stepBoostState(st, false, -1, DT);
    assert.ok(st.meter > 0.2, `a full dive should bank meter, got ${st.meter}`);
});

test('boost meter never exceeds 1', () => {
    const st = createBoostState();
    for (let i = 0; i < 2000; i++) stepBoostState(st, false, -1, DT);
    assert.equal(st.meter, 1);
});

test('an empty meter cannot start a burst', () => {
    const st = createBoostState();
    const started = stepBoostState(st, true, 0, DT);
    assert.equal(started, false);
    assert.equal(st.boosting, false);
});

test('a charged meter starts a burst, drains, then locks out for a cooldown', () => {
    const st = createBoostState();
    addBoostCharge(st, 1);

    assert.equal(stepBoostState(st, true, 0, DT), true, 'burst starts');
    assert.equal(st.boosting, true);

    let ticks = 1;
    while (st.boosting && ticks < 1000) { stepBoostState(st, true, 0, DT); ticks++; }
    assert.ok(ticks < 1000, 'burst must end');
    assert.equal(st.meter, 0);
    assert.ok(st.cooldown > 0, 'cooldown must be armed on burnout');

    // Immediately re-tapping with a fresh meter must be refused.
    addBoostCharge(st, 1);
    assert.equal(stepBoostState(st, true, 0, DT), false, 'cooldown blocks a re-tap');

    // ... and allowed again once it expires.
    for (let i = 0; i < 200 && st.cooldown > 0; i++) stepBoostState(st, false, 0, DT);
    assert.equal(st.cooldown, 0);
    assert.equal(stepBoostState(st, true, 0, DT), true);
});

test('burst duration matches the drain rate', () => {
    const st = createBoostState();
    addBoostCharge(st, 1);
    stepBoostState(st, true, 0, DT);
    let t = 0;
    while (st.boosting && t < 20) { stepBoostState(st, true, 0, DT); t += DT; }
    const expected = 1 / FLIGHT_CONFIG.boostDrain;
    assert.ok(Math.abs(t - expected) < 0.1, `burst ran ${t}s, expected ~${expected}s`);
});

test('releasing early stops the burst and still pays the cooldown', () => {
    const st = createBoostState();
    addBoostCharge(st, 1);
    stepBoostState(st, true, 0, DT);
    for (let i = 0; i < 10; i++) stepBoostState(st, true, 0, DT);
    assert.ok(st.meter > 0.5);
    stepBoostState(st, false, 0, DT);
    assert.equal(st.boosting, false);
    assert.ok(st.meter > 0.5, 'unspent meter is kept');
    assert.equal(st.cooldown, FLIGHT_CONFIG.boostCooldown, 'feathering is not free');
});

test('a boosting bird cannot also be charging', () => {
    const st = createBoostState();
    addBoostCharge(st, 1);
    stepBoostState(st, true, 0, DT);
    const before = st.meter;
    stepBoostState(st, true, -1, DT); // diving hard while boosting
    assert.ok(st.meter < before, 'meter must only fall while boosting');
});

test('addBoostCharge clamps both ends', () => {
    const st = createBoostState();
    assert.equal(addBoostCharge(st, 5), 1);
    assert.equal(addBoostCharge(st, -9), 0);
    assert.equal(addBoostCharge(st, FLIGHT_CONFIG.boostGateCharge), FLIGHT_CONFIG.boostGateCharge);
});

// ---------------------------------------------------------------------------
// knockdown ramp
// ---------------------------------------------------------------------------

test('knockdown fall ramps 1x -> 3x and then holds', () => {
    assert.equal(fallRampMultiplier(0), 1);
    assert.equal(fallRampMultiplier(FALL_RAMP_DURATION), FALL_RAMP_MAX_MULT);
    assert.equal(fallRampMultiplier(FALL_RAMP_DURATION * 10), FALL_RAMP_MAX_MULT);
    assert.equal(fallRampMultiplier(FALL_RAMP_DURATION / 2), 2);
    assert.equal(fallRampMultiplier(-5), 1, 'negative timers must not invert the fall');
});

test('the fall ramp is monotonic — a knockdown never slows down', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 5; t += 0.05) {
        const m = fallRampMultiplier(t);
        assert.ok(m >= prev, `ramp went backwards at t=${t}`);
        prev = m;
    }
});

test('the ramped fall covers the drop height in a readable time', () => {
    // From cruise altitude the tumble should read as a moment (~1-2s), not as
    // a teleport and not as a lift ride.
    const c = FLIGHT_CONFIG;
    let dropped = 0, t = 0;
    while (dropped < 26 && t < 10) {
        dropped += c.knockFallSpeed * fallRampMultiplier(t) * DT;
        t += DT;
    }
    assert.ok(t > 0.6 && t < 2.5, `26 units of fall took ${t.toFixed(2)}s`);
});

test('committed knockdown: the ramp is a pure function of elapsed time', () => {
    // Regression guard against a "self arrest" creeping back in. The fall
    // multiplier must depend on NOTHING but the clock — same t, same answer,
    // whatever order it is asked in.
    const forward = [];
    for (let t = 0; t <= 4; t += 0.25) forward.push(fallRampMultiplier(t));
    const backward = [];
    for (let t = 4; t >= 0; t -= 0.25) backward.unshift(fallRampMultiplier(t));
    assert.deepEqual(forward, backward);
});

// ---------------------------------------------------------------------------
// HUD normalisation
// ---------------------------------------------------------------------------

test('airSpeed01 spans the un-boosted envelope', () => {
    const c = FLIGHT_CONFIG;
    assert.equal(airSpeed01(c.minSpeed), 0);
    assert.equal(airSpeed01(c.maxSpeed), 1);
    assert.equal(airSpeed01(c.boostMaxSpeed), 1, 'clamped, not overshooting');
    assert.ok(airSpeed01(c.cruiseSpeed) > 0 && airSpeed01(c.cruiseSpeed) < 1);
});

test('speed01 spans the full envelope so boost visibly exceeds the best dive', () => {
    const c = FLIGHT_CONFIG;
    assert.equal(speed01(c.boostMaxSpeed), 1);
    assert.ok(speed01(c.maxSpeed) < 1, 'a pure dive must not max the FOV kick');
    assert.equal(speed01(0), 0);
    assert.ok(speed01(c.cruiseSpeed) < speed01(c.maxSpeed));
});

test('both normalisations are monotonic', () => {
    let a = -1, b = -1;
    for (let v = 0; v <= 100; v += 1) {
        const na = airSpeed01(v), nb = speed01(v);
        assert.ok(na >= a && nb >= b, `non-monotonic at v=${v}`);
        a = na; b = nb;
    }
});
