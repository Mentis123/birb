/**
 * tests/stunt-pad.test.js — the BOOST pill as a throttle/rudder pad.
 *
 * The thing that must not regress is the BOOST. It is the control the game
 * already had and the only one a player already knows; if adding two axes to
 * the pill costs a reliable tap, the pad is a net loss however good the
 * rudder is. So most of this file is about tap-versus-drag.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStuntPadState, STUNT_PAD_DEFAULTS } from '../src/flight/stunt-pad.js';

const D = STUNT_PAD_DEFAULTS;

test('a quick press with no travel is a TAP — the boost still works', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  const { tap } = pad.up(60);
  assert.equal(tap, true);
});

test('a press that travels is never a tap, however quickly it is released', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  pad.move(100 + D.tapSlop + 1, 100, 10);
  const { tap } = pad.up(20);
  assert.equal(tap, false, 'a drag must not fire the boost on release');
});

test('a press held past the tap window is not a tap even if it never moved', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  pad.move(100, 100, D.tapTime + 10);
  const { tap } = pad.up(D.tapTime + 20);
  assert.equal(tap, false, 'a held thumb is a throttle input, not a boost');
});

test('a press inside the slop is still a tap — a thumb is not a stylus', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  pad.move(100 + D.tapSlop - 2, 100 + 2, 30);
  const { tap } = pad.up(50);
  assert.equal(tap, true);
});

test('once a press is a drag it can never become a tap again', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  pad.move(200, 100, 10);   // clearly a drag
  pad.move(100, 100, 20);   // ...and back to where it started
  const { tap } = pad.up(30);
  assert.equal(tap, false);
});

test('dragging UP is more throttle, dragging DOWN is less', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  // Screen y grows downward, so "up" is a NEGATIVE dy. Getting this backwards
  // is the kind of thing that is obvious on a phone and invisible in code.
  pad.move(100, 100 - D.range, 300);
  assert.ok(Math.abs(pad.throttle - D.throttleFull) < 1e-9, `full up is ${pad.throttle}`);
  pad.move(100, 100 + D.range, 320);
  assert.ok(Math.abs(pad.throttle - D.throttleIdle) < 1e-9, `full down is ${pad.throttle}`);
});

test('the throttle is clamped and the rudder is bounded to -1..1', () => {
  const pad = createStuntPadState();
  pad.down(0, 0, 0);
  pad.move(10 * D.range, -10 * D.range, 300);
  assert.ok(pad.throttle <= D.throttleFull + 1e-9, 'throttle clamped');
  assert.ok(pad.rudder <= 1 + 1e-9 && pad.rudder >= -1 - 1e-9, `rudder bounded (${pad.rudder})`);
  pad.move(-10 * D.range, 10 * D.range, 320);
  assert.ok(pad.throttle >= D.throttleIdle - 1e-9, 'throttle clamped the other way');
  assert.ok(pad.rudder >= -1 - 1e-9, 'rudder bounded the other way');
});

test('right is positive rudder, left is negative, and they are symmetric', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  pad.move(100 + D.range / 2, 100, 300);
  const right = pad.rudder;
  pad.move(100 - D.range / 2, 100, 320);
  const left = pad.rudder;
  assert.ok(right > 0 && left < 0, `right ${right}, left ${left}`);
  assert.ok(Math.abs(right + left) < 1e-9, 'symmetric');
});

test('release springs both axes back to neutral', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  pad.move(160, 40, 300);
  assert.ok(pad.rudder !== 0 && pad.throttle !== 1, 'deflected');
  pad.up(400);
  assert.equal(pad.rudder, 0, 'rudder springs back');
  assert.equal(pad.throttle, 1, 'throttle springs back');
  assert.equal(pad.active, false);
});

test('a cancelled press is never a tap and leaves nothing deflected', () => {
  const pad = createStuntPadState();
  pad.down(100, 100, 0);
  pad.move(160, 40, 300);
  pad.cancel();
  assert.equal(pad.rudder, 0);
  assert.equal(pad.throttle, 1);
  assert.equal(pad.active, false);
});

test('moves without a press do nothing at all', () => {
  const pad = createStuntPadState();
  assert.equal(pad.move(500, 500, 0), false);
  assert.equal(pad.rudder, 0);
  assert.equal(pad.throttle, 1);
  const { tap } = pad.up(10);
  assert.equal(tap, false, 'a release with no press is not a boost');
});
