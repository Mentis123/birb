import test from 'node:test';
import assert from 'node:assert/strict';
import { blendToward, perchPose, tumbleFlap, tailPitchOffset } from '../src/flight/bird-pose.js';

test('a blend approaches its target without ever passing it', () => {
  let value = 0;
  for (let i = 0; i < 300; i++) value = blendToward(value, 1, 1 / 60, 5);
  assert.ok(value > 0.99 && value <= 1, `settled at ${value}`);
});

test('a long frame does not make the blend overshoot or oscillate', () => {
  // The exponential form exists for this case. A linear step would fly past
  // the target on a slow frame and ring, which on a throttled phone is
  // precisely when frames run long.
  let value = 0;
  for (const delta of [0.5, 1, 5, 100]) {
    value = blendToward(0, 1, delta, 12);
    assert.ok(value <= 1, `delta ${delta} overshot to ${value}`);
    assert.ok(value >= 0);
  }
});

test('blending is frame-rate independent', () => {
  let sixty = 0;
  for (let i = 0; i < 60; i++) sixty = blendToward(sixty, 1, 1 / 60, 5);
  let thirty = 0;
  for (let i = 0; i < 30; i++) thirty = blendToward(thirty, 1, 1 / 30, 5);
  assert.ok(Math.abs(sixty - thirty) < 0.01, `${sixty} vs ${thirty} after one second`);
});

test('a non-finite input leaves the blend where it was rather than poisoning it', () => {
  assert.equal(blendToward(0.5, NaN, 1 / 60, 5), 0.5);
  assert.ok(Number.isFinite(blendToward(NaN, 1, 1 / 60, 5)));
});

test('the perch pose folds the wings in and settles the tail', () => {
  const flying = perchPose(0);
  const perched = perchPose(1);
  assert.equal(flying.fold, 0);
  assert.equal(flying.span, 1);
  assert.ok(perched.fold > 0.5, 'wings must actually fold');
  assert.ok(perched.span < 0.7, 'wings must pull in, not just rotate');
  assert.ok(perched.tailPitch > 0 && perched.tailSpread < 1);
});

test('the perch pose is monotonic, so the fold never jitters mid-landing', () => {
  let previous = perchPose(0);
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const current = perchPose(t);
    assert.ok(current.fold >= previous.fold);
    assert.ok(current.span <= previous.span);
    previous = current;
  }
});

test('a blend outside 0..1 clamps instead of folding the wings inside out', () => {
  assert.deepEqual(perchPose(-3), perchPose(0));
  assert.deepEqual(perchPose(7), perchPose(1));
  assert.deepEqual(perchPose(undefined), perchPose(0));
});

test('the tumble is asymmetric, which is what makes a fall read as a fall', () => {
  // A symmetric flap reads as a controlled descent. The two wings must
  // disagree at essentially every moment of the knockdown.
  let agreements = 0;
  for (let t = 0; t < 3; t += 0.02) {
    const { left, right } = tumbleFlap(t);
    if (Math.abs(left - right) < 0.01) agreements++;
  }
  assert.ok(agreements < 8, `wings moved together on ${agreements} samples`);
});

test('tumble intensity scales and clamps', () => {
  assert.deepEqual(tumbleFlap(1, 0), { left: 0, right: 0 });
  const full = tumbleFlap(1, 1);
  const over = tumbleFlap(1, 5);
  assert.deepEqual(over, full, 'intensity above one must clamp');
});

test('the tail drops on a climb and lifts on a dive', () => {
  assert.ok(tailPitchOffset(1) < 0, 'climb should drop the tail');
  assert.ok(tailPitchOffset(-1) > 0, 'dive should lift the tail');
  assert.equal(tailPitchOffset(0), 0);
  // Level flight must be exactly neutral or the bird sits nose-up at rest.
  assert.equal(tailPitchOffset(NaN), 0);
});

test('tail pitch stays inside a readable range at full deflection', () => {
  for (const input of [-5, -1, 0, 1, 5]) {
    assert.ok(Math.abs(tailPitchOffset(input)) <= 0.16);
  }
});
