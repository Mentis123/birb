import test from 'node:test';
import assert from 'node:assert/strict';
import { horizonDipAngle, restingPitchForAltitude, AIM_RIG_DEFAULTS } from '../src/nesting/aim-rig.js';

const deg = (radians) => (radians * 180) / Math.PI;

test('the horizon dips further the higher the perch sits', () => {
  assert.equal(horizonDipAngle(120, 0), 0);
  const low = horizonDipAngle(120, 10);
  const mid = horizonDipAngle(120, 40);
  const high = horizonDipAngle(120, 90);
  assert.ok(low < mid && mid < high, 'dip must grow with altitude');
  // The number that made every perch render as sky: a 40-unit forest crown on
  // this planet puts the horizon 41 degrees below "level".
  assert.ok(Math.abs(deg(mid) - 41.4) < 0.5, `expected ~41.4 degrees, got ${deg(mid)}`);
});

test('a real planet would not need this fix at all', () => {
  // Same 40-unit perch on an Earth-scale radius: the dip is negligible, which
  // is why level is the right rest angle everywhere except a toy planet.
  assert.ok(deg(horizonDipAngle(6371000, 40)) < 0.25);
});

test('resting pitch looks down, stays above the true horizon, and is bounded', () => {
  const rest = restingPitchForAltitude(120, 40);
  assert.ok(rest < 0, 'rest pitch must look down');
  // Above the true horizon so sky still frames the shot, but well below level.
  assert.ok(Math.abs(rest) < horizonDipAngle(120, 40), 'must not aim at or below the horizon');
  assert.ok(deg(rest) < -25, `expected a meaningful dip, got ${deg(rest)}`);
  assert.ok(deg(rest) > -AIM_RIG_DEFAULTS.maxPitch * 180 / Math.PI);
});

test('degenerate altitudes and radii rest at level rather than NaN', () => {
  for (const [radius, altitude] of [[120, 0], [120, -5], [0, 40], [NaN, 40], [120, NaN]]) {
    const value = restingPitchForAltitude(radius, altitude);
    assert.ok(Number.isFinite(value), `radius ${radius} altitude ${altitude} produced ${value}`);
    assert.equal(value, 0);
  }
});

test('the resting pitch never exceeds the rig limit it is given', () => {
  // A perch absurdly high above a tiny planet asks for a dip approaching 90
  // degrees; the limit keeps the turret out of the look-axis singularity.
  const limit = (85 * Math.PI) / 180;
  const value = restingPitchForAltitude(10, 100000, limit);
  assert.ok(value >= -limit, `${value} exceeded the limit ${-limit}`);
});
