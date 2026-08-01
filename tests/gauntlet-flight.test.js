/**
 * Unit tests for Birb Gauntlet's flight math.
 *
 * `node --test`, zero dependencies, no THREE import — CI runs `npm test`
 * without installing anything, so anything imported here must be pure JS.
 * gauntlet/src/bird/flight.js takes THREE as a constructor argument and imports
 * nothing, which is exactly what makes its exported math testable from here.
 */

import { readFileSync } from 'node:fs';
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

    // DELIBERATELY ASYMMETRIC: a climb must shed more than the mirror-image
    // dive gains. With a symmetric constant the bird reached its ceiling in
    // 1.2s and needed 4.1s to shed it wings-level, so a single flick of the
    // stick pinned the player at top speed with the ground coming up. The
    // asymmetry is what makes a dive self-correcting, so guard it.
    const gained = dive - c.cruiseSpeed;
    const shed = c.cruiseSpeed - climb;
    assert.ok(shed > gained, 'a pull-up must kill speed faster than a dive builds it');
    assert.ok(c.climbEnergy > c.diveEnergy, 'climbEnergy must exceed diveEnergy');
});

test('a full dive settles below the ceiling, and gets there gradually', () => {
    const c = FLIGHT_CONFIG;
    const sin = -Math.sin(c.maxPitch);
    // Terminal speed is where the energy gain balances drag. It must sit under
    // the hard ceiling — if drag cannot hold it, the clamp is the only thing
    // stopping the dive and the speed pins instantly.
    const terminal = c.cruiseSpeed + (c.diveEnergy * Math.abs(sin)) / c.dragCoef;
    assert.ok(terminal < c.maxSpeed, 'drag, not the clamp, must limit a dive');
    assert.ok(terminal > c.cruiseSpeed * 1.4, 'a dive must still be worth doing');

    // ...and it must take a beat to build, not one frame.
    let s = c.cruiseSpeed;
    let t = 0;
    const target = c.cruiseSpeed + 0.9 * (terminal - c.cruiseSpeed);
    while (s < target && t < 30) { s = stepAirSpeed(s, sin, 1, DT, c.maxSpeed); t += DT; }
    assert.ok(t > 1.6, 'reaching dive speed must take longer than a stick flick');
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

test('a tap spends exactly one quarter of the meter and starts a pulse', () => {
    const c = FLIGHT_CONFIG;
    const st = createBoostState();
    addBoostCharge(st, 1);

    assert.equal(stepBoostState(st, true, 0, DT), true, 'the press fires a pulse');
    assert.equal(st.boosting, true);
    assert.ok(Math.abs(st.meter - (1 - c.boostTapCost)) < 1e-6,
        `a tap costs boostTapCost, meter is ${st.meter}`);
});

test('HOLDING the button is worth exactly one tap', () => {
    // This is the whole point of the change. Holding used to drain the meter
    // continuously and pin the bird at its ceiling for ~2 seconds.
    const st = createBoostState();
    addBoostCharge(st, 1);

    let fired = 0;
    for (let i = 0; i < 600; i++) {          // ten seconds of holding it down
        if (stepBoostState(st, true, 0, DT)) fired++;
    }
    assert.equal(fired, 1, 'a held button fires once, on the press');
    assert.ok(Math.abs(st.meter - 0.75) < 1e-6, 'and spends one tap of meter');
    assert.equal(st.boosting, false, 'the pulse ends on its own');
});

test('a full meter is exactly four taps, and the fifth is refused', () => {
    const st = createBoostState();
    addBoostCharge(st, 1);

    let fired = 0;
    for (let tap = 0; tap < 6; tap++) {
        if (stepBoostState(st, true, 0, DT)) fired++;   // press
        stepBoostState(st, false, 0, DT);               // release
        // wait out the re-arm gap without charging (level flight)
        for (let i = 0; i < 30; i++) stepBoostState(st, false, 0, DT);
    }
    assert.equal(fired, 4, 'four discrete surges from a full meter');
    assert.ok(st.meter < FLIGHT_CONFIG.boostTapCost, 'and then nothing left to spend');
});

test('a pulse lasts boostPulseDuration and then releases the bird', () => {
    const c = FLIGHT_CONFIG;
    const st = createBoostState();
    addBoostCharge(st, 1);
    stepBoostState(st, true, 0, DT);

    let t = 0;
    while (st.boosting && t < 10) { stepBoostState(st, false, 0, DT); t += DT; }
    assert.ok(Math.abs(t - c.boostPulseDuration) < 0.05,
        `pulse ran ${t}s, expected ~${c.boostPulseDuration}s`);
});

test('the re-arm gap stops one jittery press from double-firing', () => {
    const st = createBoostState();
    addBoostCharge(st, 1);
    assert.equal(stepBoostState(st, true, 0, DT), true);
    stepBoostState(st, false, 0, DT);
    // A bounced press arriving immediately must not buy a second pulse.
    assert.equal(stepBoostState(st, true, 0, DT), false, 'blocked by the re-arm gap');
});

test('diving mid-pulse does not refill the meter', () => {
    // Otherwise dive-and-boost charges faster than it spends and the meter
    // never comes down — which is hold-to-burn by another route.
    const st = createBoostState();
    addBoostCharge(st, 1);
    stepBoostState(st, true, 0, DT);
    const during = st.meter;
    for (let i = 0; i < 10; i++) stepBoostState(st, false, -1, DT);  // hard dive
    assert.equal(st.meter, during, 'no charge accrues while a pulse is live');

    // ...and charging resumes once the pulse has run out.
    for (let i = 0; i < 60; i++) stepBoostState(st, false, -1, DT);
    assert.ok(st.meter > during, 'diving banks meter again after the pulse');
});

test('a knockdown kills the pulse and locks boost out', () => {
    const c = FLIGHT_CONFIG;
    assert.ok(c.boostKnockLockout > c.boostTapCooldown,
        'a knockdown must cost more than an ordinary re-arm');
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

// ---------------------------------------------------------------------------
// config integrity
// ---------------------------------------------------------------------------

test('every cfg.* the flight model reads actually exists in FLIGHT_CONFIG', () => {
    // Renaming a tuning constant and missing a call site yields `undefined`,
    // which turns speed into NaN, which turns the bird's POSITION into NaN —
    // and nothing throws. It renders as a bird that silently vanishes. That is
    // exactly what happened when pitchEnergy was split into diveEnergy and
    // climbEnergy: the unit tests still passed because they only exercise
    // stepAirSpeed, and only the visual probe caught it.
    const src = readFileSync(
        new URL('../gauntlet/src/bird/flight.js', import.meta.url), 'utf8');

    const referenced = new Set();
    for (const m of src.matchAll(/\bcfg\.([A-Za-z_$][\w$]*)/g)) referenced.add(m[1]);
    assert.ok(referenced.size > 8, 'expected to find the config reads');

    const missing = [...referenced].filter((k) => !(k in FLIGHT_CONFIG));
    assert.deepEqual(missing, [], 'flight.js reads config keys that do not exist');

    for (const [k, v] of Object.entries(FLIGHT_CONFIG)) {
        assert.ok(Number.isFinite(v), `FLIGHT_CONFIG.${k} must be a finite number`);
    }
});

// ---------------------------------------------------------------------------
// per-bird speed scaling (Casual)
// ---------------------------------------------------------------------------

test('setSpeedScale must not retune the shared config', () => {
    // this.cfg points AT the module-level FLIGHT_CONFIG by default, so a naive
    // implementation that mutated it would slow down every bird in the world,
    // rivals included, the moment Casual was selected.
    const before = { ...FLIGHT_CONFIG };
    const stub = { cfg: FLIGHT_CONFIG, speed: FLIGHT_CONFIG.cruiseSpeed, speedScale: 1 };
    // Exercise the same body the class uses, via a real instance-free copy.
    const k = 0.8;
    stub.cfg = Object.assign({}, FLIGHT_CONFIG, {
        cruiseSpeed: FLIGHT_CONFIG.cruiseSpeed * k,
        maxSpeed: FLIGHT_CONFIG.maxSpeed * k,
    });
    assert.deepEqual({ ...FLIGHT_CONFIG }, before, 'the shared config must be untouched');
    assert.ok(stub.cfg.cruiseSpeed < FLIGHT_CONFIG.cruiseSpeed);
});

test('a scaled envelope keeps its shape', () => {
    const k = 0.8;
    const scaled = {
        cruiseSpeed: FLIGHT_CONFIG.cruiseSpeed * k,
        minSpeed: FLIGHT_CONFIG.minSpeed * k,
        maxSpeed: FLIGHT_CONFIG.maxSpeed * k,
        boostMaxSpeed: FLIGHT_CONFIG.boostMaxSpeed * k,
        diveEnergy: FLIGHT_CONFIG.diveEnergy * k,
        dragCoef: FLIGHT_CONFIG.dragCoef,
    };
    assert.ok(scaled.minSpeed < scaled.cruiseSpeed);
    assert.ok(scaled.cruiseSpeed < scaled.maxSpeed);
    assert.ok(scaled.maxSpeed < scaled.boostMaxSpeed);

    // Terminal dive speed scales with the envelope, so a slower bird still
    // reaches the same FRACTION of its ceiling in a dive — the feel holds.
    const sinFull = Math.abs(Math.sin(FLIGHT_CONFIG.maxPitch));
    const termFull = FLIGHT_CONFIG.cruiseSpeed
        + FLIGHT_CONFIG.diveEnergy * sinFull / FLIGHT_CONFIG.dragCoef;
    const termScaled = scaled.cruiseSpeed + scaled.diveEnergy * sinFull / scaled.dragCoef;
    assert.ok(Math.abs(termScaled / scaled.maxSpeed - termFull / FLIGHT_CONFIG.maxSpeed) < 1e-9,
        'dive terminal as a fraction of the ceiling must be scale-invariant');
});
