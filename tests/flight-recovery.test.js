import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLIGHT_RECOVERY_STATES,
  FLIGHT_RECOVERY_CONFIG,
  FALL_RAMP_DURATION,
  FALL_RAMP_MAX_MULT,
  fallRampMultiplier,
  createFlightRecovery,
} from '../src/flight/flight-recovery.js';

test('config constants preserved verbatim from index.html', () => {
  assert.equal(FLIGHT_RECOVERY_STATES.FLYING, 'flying');
  assert.equal(FLIGHT_RECOVERY_STATES.FALLING, 'falling');
  assert.equal(FLIGHT_RECOVERY_STATES.GROUNDED, 'grounded');
  assert.equal(FLIGHT_RECOVERY_CONFIG.birdRadius, 0.6);
  assert.equal(FLIGHT_RECOVERY_CONFIG.walkSpeed, 2.1);
  assert.equal(FLIGHT_RECOVERY_CONFIG.walkBackThreshold, 0.3);
  assert.equal(FLIGHT_RECOVERY_CONFIG.walkBackMult, 0.7);
  assert.equal(FLIGHT_RECOVERY_CONFIG.knockbackFallSpeed, 5.0);
  assert.equal(FLIGHT_RECOVERY_CONFIG.minFlightResumeSpeed, 3.5);
  assert.equal(FLIGHT_RECOVERY_CONFIG.launchBoostSpeed, 6.0);
  assert.equal(FLIGHT_RECOVERY_CONFIG.launchBoostDuration, 0.4);
  assert.equal(FALL_RAMP_DURATION, 3.0);
  assert.equal(FALL_RAMP_MAX_MULT, 3.0);
});

test('fall ramp goes 1x -> 3x linearly over 3s, then holds', () => {
  assert.equal(fallRampMultiplier(0), 1);            // first frame
  assert.equal(fallRampMultiplier(1.5), 2);          // halfway = 2x
  assert.equal(fallRampMultiplier(3.0), 3);          // full = 3x
  assert.equal(fallRampMultiplier(6.0), 3);          // clamps, holds at 3x
  // Quarter point = 1 + 0.25*(3-1) = 1.5
  assert.equal(fallRampMultiplier(0.75), 1.5);
});

test('transition table: FLYING -> FALLING -> GROUNDED -> FLYING with callbacks', () => {
  const calls = [];
  const fr = createFlightRecovery({ onEnter: ({ next, prev }) => calls.push([prev, next]) });

  assert.equal(fr.state, FLIGHT_RECOVERY_STATES.FLYING);
  assert.ok(fr.isFlying());

  assert.equal(fr.transitionTo(FLIGHT_RECOVERY_STATES.FALLING), true);
  assert.ok(fr.isFalling());

  assert.equal(fr.transitionTo(FLIGHT_RECOVERY_STATES.GROUNDED), true);
  assert.ok(fr.isGrounded());

  assert.equal(fr.transitionTo(FLIGHT_RECOVERY_STATES.FLYING), true);
  assert.ok(fr.isFlying());

  assert.deepEqual(calls, [
    ['flying', 'falling'],
    ['falling', 'grounded'],
    ['grounded', 'flying'],
  ]);
});

test('transitionTo is a no-op when already in the target state (no callback)', () => {
  let fired = 0;
  const fr = createFlightRecovery({ onEnter: () => fired++ });
  assert.equal(fr.transitionTo(FLIGHT_RECOVERY_STATES.FLYING), false); // already flying
  assert.equal(fired, 0);
  fr.transitionTo(FLIGHT_RECOVERY_STATES.FALLING);
  assert.equal(fired, 1);
  assert.equal(fr.transitionTo(FLIGHT_RECOVERY_STATES.FALLING), false); // repeat
  assert.equal(fired, 1);
});

test('entering FALLING resets the fall clock', () => {
  const fr = createFlightRecovery();
  fr.transitionTo(FLIGHT_RECOVERY_STATES.FALLING);
  fr.advanceFall(2.0);
  assert.equal(fr.fallTimer, 2.0);
  // go grounded then fall again -> clock must reset to 0
  fr.transitionTo(FLIGHT_RECOVERY_STATES.GROUNDED);
  fr.transitionTo(FLIGHT_RECOVERY_STATES.FALLING);
  assert.equal(fr.fallTimer, 0);
});

test('advanceFall accumulates and returns the matching ramp multiplier', () => {
  const fr = createFlightRecovery();
  fr.transitionTo(FLIGHT_RECOVERY_STATES.FALLING);
  let mult = fr.advanceFall(1.5);
  assert.equal(fr.fallTimer, 1.5);
  assert.equal(mult, 2); // halfway
  mult = fr.advanceFall(1.5);
  assert.equal(fr.fallTimer, 3.0);
  assert.equal(mult, 3); // full
});

test('launch boost arms to the configured duration and ticks down to zero', () => {
  const fr = createFlightRecovery();
  assert.equal(fr.advanceLaunchBoost(0.1), false); // not armed yet
  fr.armLaunchBoost();
  assert.equal(fr.launchBoostTimer, FLIGHT_RECOVERY_CONFIG.launchBoostDuration);
  assert.equal(fr.advanceLaunchBoost(0.2), true);
  assert.ok(Math.abs(fr.launchBoostTimer - 0.2) < 1e-9);
  assert.equal(fr.advanceLaunchBoost(0.5), true); // overshoots, clamps to 0
  assert.equal(fr.launchBoostTimer, 0);
  assert.equal(fr.advanceLaunchBoost(0.1), false); // exhausted
});
