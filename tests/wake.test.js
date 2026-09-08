import test from 'node:test';
import assert from 'node:assert/strict';
import { rippleAt, WAKE_DEFAULTS } from '../src/effects/wake.js';

test('a ripple expands over its life and then stops existing', () => {
  assert.equal(rippleAt(0).alive, true);
  assert.equal(rippleAt(WAKE_DEFAULTS.life).alive, false);
  assert.equal(rippleAt(WAKE_DEFAULTS.life * 2).alive, false);
  const early = rippleAt(0.2);
  const late = rippleAt(1.5);
  assert.ok(late.radius > early.radius, 'a ring wave only ever spreads');
});

test('the spread eases out, the way a real ring wave does', () => {
  // Equal time slices must cover unequal distance, fast first.
  const a = rippleAt(0.0).radius;
  const b = rippleAt(0.6).radius;
  const c = rippleAt(1.2).radius;
  assert.ok(b - a > c - b, 'the ripple is accelerating, which water does not do');
});

test('the radius stays inside the configured bounds', () => {
  for (let t = 0; t < WAKE_DEFAULTS.life; t += 0.05) {
    const r = rippleAt(t).radius;
    assert.ok(r >= WAKE_DEFAULTS.startRadius - 1e-6, `radius ${r} below start at t=${t}`);
    assert.ok(r <= WAKE_DEFAULTS.endRadius + 1e-6, `radius ${r} past end at t=${t}`);
  }
});

test('the alpha fades in as well as out', () => {
  // A ripple that starts at full strength pops, and a pop reads as a sprite
  // appearing rather than as water moving.
  assert.ok(rippleAt(0).alpha < rippleAt(0.25).alpha, 'no attack: the ripple pops in');
  assert.ok(rippleAt(WAKE_DEFAULTS.life * 0.98).alpha < 0.02, 'the ripple pops out');
  let peak = 0;
  for (let t = 0; t < WAKE_DEFAULTS.life; t += 0.02) peak = Math.max(peak, rippleAt(t).alpha);
  assert.ok(peak <= WAKE_DEFAULTS.opacity + 1e-6, `alpha exceeded the configured opacity: ${peak}`);
});

test('a negative or non-finite age is dead, not a giant ring at the origin', () => {
  assert.equal(rippleAt(-1).alive, false);
  assert.equal(rippleAt(Infinity).alive, false);
  assert.equal(rippleAt(NaN).alive, false);
});

test('the reach is generous enough to be seen in normal flight', () => {
  // Cruising sits 8-15 units over terrain in this world. A reach of one or
  // two units is a feature nobody ever triggers.
  assert.ok(WAKE_DEFAULTS.reach >= 5, `reach ${WAKE_DEFAULTS.reach} is too tight to ever fire`);
});

test('the lift clears the surface without floating', () => {
  assert.ok(WAKE_DEFAULTS.lift > 0, 'coplanar with the water means z-fighting');
  assert.ok(WAKE_DEFAULTS.lift < 1, 'a ripple a metre above the lake is a hoop, not a wake');
});
