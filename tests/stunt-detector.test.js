/**
 * tests/stunt-detector.test.js — naming the figure after the fact.
 *
 * The trap this file exists to pin is the one the first implementation had:
 * a full loop passes through PI on its way to 2PI, so a half-loop test that
 * CONSUMES the accumulator makes a full loop undetectable forever. The very
 * first check here is that a loop is a loop.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStuntDetector, STUNT_DETECTOR_DEFAULTS } from '../src/flight/stunt-detector.js';

const DT = 1 / 60;
const TAU = Math.PI * 2;

/** Fly `angle` radians on one axis over `seconds`, collecting every event. */
function sweep(det, axis, angle, seconds, extra = {}) {
  const steps = Math.max(1, Math.round(seconds / DT));
  const per = angle / steps;
  const events = [];
  for (let i = 0; i < steps; i += 1) {
    const sample = {
      rollDelta: axis === 'roll' ? per : 0,
      pitchDelta: axis === 'pitch' ? per : 0,
      cruise: 11, speed: 11, aboveGround: 100, bank: 0, pitch: 0,
      ...extra,
    };
    const e = det.update(sample, DT);
    if (e) events.push(e.id);
  }
  return events;
}

/** Hold both axes still for `seconds`, so a half-turn can settle. */
function quiet(det, seconds, extra = {}) {
  const steps = Math.max(1, Math.round(seconds / DT));
  const events = [];
  for (let i = 0; i < steps; i += 1) {
    const e = det.update({
      rollDelta: 0, pitchDelta: 0, cruise: 11, speed: 11,
      aboveGround: 100, bank: 0, pitch: 0, ...extra,
    }, DT);
    if (e) events.push(e.id);
  }
  return events;
}

test('a full loop is detected — passing through PI does not consume it', () => {
  const det = createStuntDetector();
  const events = sweep(det, 'pitch', TAU, 2.4);
  assert.ok(events.includes('loop'), `saw ${JSON.stringify(events)}`);
});

test('a full roll is detected', () => {
  const det = createStuntDetector();
  const events = sweep(det, 'roll', TAU, 1.2);
  assert.ok(events.includes('roll'), `saw ${JSON.stringify(events)}`);
});

test('three loops held continuously are three toasts, not one', () => {
  const det = createStuntDetector({ repeatCooldown: 0 });
  const events = sweep(det, 'pitch', TAU * 3, 7.2);
  assert.equal(events.filter((e) => e === 'loop').length, 3, `saw ${JSON.stringify(events)}`);
});

test('the repeat cooldown stops one long figure spamming the screen', () => {
  const det = createStuntDetector();
  const events = sweep(det, 'roll', TAU * 3, 3.6);
  assert.equal(events.filter((e) => e === 'roll').length, 1, `saw ${JSON.stringify(events)}`);
});

test('half a roll one way and half back is NOT a roll', () => {
  const det = createStuntDetector();
  const a = sweep(det, 'roll', Math.PI * 0.9, 0.6);
  const b = sweep(det, 'roll', -Math.PI * 0.9, 0.6);
  assert.ok(!a.includes('roll') && !b.includes('roll'),
    'a reversal restarts the accumulation');
});

test('a slow drift never becomes a figure', () => {
  const det = createStuntDetector();
  // A full turn, but spread over well past the window.
  const events = sweep(det, 'roll', TAU, STUNT_DETECTOR_DEFAULTS.rollWindow * 2);
  assert.ok(!events.includes('roll'), `saw ${JSON.stringify(events)}`);
});

test('half a loop UP then half a roll is an Immelmann', () => {
  const det = createStuntDetector();
  const events = [
    ...sweep(det, 'pitch', Math.PI, 1.2),
    ...quiet(det, 0.3),
    ...sweep(det, 'roll', Math.PI, 0.6),
    ...quiet(det, 0.3),
  ];
  assert.ok(events.includes('immelmann'), `saw ${JSON.stringify(events)}`);
});

test('half a roll then half a loop is a split-S — the ORDER is what tells them apart', () => {
  const det = createStuntDetector();
  const events = [
    ...sweep(det, 'roll', Math.PI, 0.6),
    ...quiet(det, 0.3),
    ...sweep(det, 'pitch', Math.PI, 1.2),
    ...quiet(det, 0.3),
  ];
  assert.ok(events.includes('splitS'), `saw ${JSON.stringify(events)}`);
  assert.ok(!events.includes('immelmann'), 'and not the other one');
});

test('two halves too far apart do not link into a combination figure', () => {
  const det = createStuntDetector();
  const events = [
    ...sweep(det, 'pitch', Math.PI, 1.2),
    ...quiet(det, STUNT_DETECTOR_DEFAULTS.linkWindow + 0.6),
    ...sweep(det, 'roll', Math.PI, 0.6),
    ...quiet(det, 0.3),
  ];
  assert.ok(!events.includes('immelmann'), `saw ${JSON.stringify(events)}`);
});

test('a knife edge has to be HELD to count', () => {
  const det = createStuntDetector();
  const brief = quiet(det, 0.5, { bank: Math.PI / 2 });
  assert.ok(!brief.includes('knife'), 'half a second is not a knife edge');
  const held = quiet(det, 1.2, { bank: Math.PI / 2 });
  assert.ok(held.includes('knife'), `saw ${JSON.stringify(held)}`);
});

test('inverted is detected either way round the circle', () => {
  for (const bank of [Math.PI, -Math.PI]) {
    const det = createStuntDetector();
    const events = quiet(det, 2.5, { bank });
    assert.ok(events.includes('inverted'), `bank ${bank}: ${JSON.stringify(events)}`);
  }
});

test('a low pass needs to be low AND fast AND not on its side', () => {
  const low = createStuntDetector();
  assert.ok(quiet(low, 1.5, { aboveGround: 2, speed: 13 }).includes('lowPass'));

  const slow = createStuntDetector();
  assert.ok(!quiet(slow, 1.5, { aboveGround: 2, speed: 4 }).includes('lowPass'),
    'a slow potter along the deck is not a low pass');

  const high = createStuntDetector();
  assert.ok(!quiet(high, 1.5, { aboveGround: 40, speed: 13 }).includes('lowPass'));
});

test('the hammerhead is nose-up and out of speed, then nose-down', () => {
  const det = createStuntDetector();
  const events = [
    ...quiet(det, 0.8, { pitch: 1.45, speed: 4, stalled: true }),
    ...quiet(det, 0.8, { pitch: -1.2, speed: 8 }),
  ];
  assert.ok(events.includes('hammerhead'), `saw ${JSON.stringify(events)}`);
});

test('a fast vertical climb followed by a dive is NOT a hammerhead', () => {
  const det = createStuntDetector();
  const events = [
    ...quiet(det, 0.8, { pitch: 1.45, speed: 12 }),
    ...quiet(det, 0.8, { pitch: -1.2, speed: 14 }),
  ];
  assert.ok(!events.includes('hammerhead'),
    `a hammerhead is running out of speed, not pointing up (${JSON.stringify(events)})`);
});

test('reset clears everything, for a knockdown or a teleport', () => {
  const det = createStuntDetector();
  sweep(det, 'roll', Math.PI * 0.9, 0.6);
  det.reset();
  const s = det.state();
  assert.equal(s.rollAcc, 0);
  assert.equal(s.pitchAcc, 0);
  assert.equal(s.halfKind, null);
});

test('the event object is reused — the loop allocates nothing to be told it looped', () => {
  const det = createStuntDetector({ repeatCooldown: 0 });
  const seen = new Set();
  const steps = Math.round(4.8 / DT);
  const per = (TAU * 2) / steps;
  for (let i = 0; i < steps; i += 1) {
    const e = det.update({ rollDelta: per, pitchDelta: 0, cruise: 11, speed: 11, aboveGround: 100, bank: 0, pitch: 0 }, DT);
    if (e) seen.add(e);
  }
  assert.equal(seen.size, 1, 'the same pre-allocated event object every time');
});
