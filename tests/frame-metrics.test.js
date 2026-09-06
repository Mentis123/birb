import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameSampler, FRAME_SAMPLE_WINDOW_MS } from '../src/game/frame-metrics.js';

/** Drive the sampler at a steady rate for a number of milliseconds. */
function run(sampler, fps, durationMs, startAt = 0) {
  const step = 1000 / fps;
  const results = [];
  for (let t = startAt; t <= startAt + durationMs; t += step) {
    const value = sampler.sample(t);
    if (value !== null) results.push(value);
  }
  return results;
}

test('a steady sixty frames per second measures as sixty', () => {
  const sampler = createFrameSampler();
  const samples = run(sampler, 60, 2000);
  assert.ok(samples.length >= 6, `expected several windows, got ${samples.length}`);
  for (const value of samples) {
    assert.ok(Math.abs(value - 60) < 4, `measured ${value}`);
  }
});

test('a struggling thirty frames per second is reported as such', () => {
  // This is the case the whole adaptive tier exists for, and until now it
  // could never happen: the sampler was unreachable behind a missing element.
  const sampler = createFrameSampler();
  const samples = run(sampler, 30, 2000);
  assert.ok(samples.length > 0);
  for (const value of samples) {
    assert.ok(Math.abs(value - 30) < 4, `measured ${value}`);
  }
});

test('the first call starts the clock and reports nothing', () => {
  // Time between page load and first frame covers module imports and world
  // construction. Reporting that as a frame rate downshifts a healthy device
  // before it has drawn anything.
  const sampler = createFrameSampler();
  assert.equal(sampler.sample(5000), null);
  assert.equal(sampler.value, 0);
});

test('no sample is produced before the window closes', () => {
  const sampler = createFrameSampler();
  sampler.sample(0);
  for (let t = 16; t < FRAME_SAMPLE_WINDOW_MS; t += 16) {
    assert.equal(sampler.sample(t), null, `reported early at ${t}ms`);
  }
  assert.ok(sampler.sample(FRAME_SAMPLE_WINDOW_MS + 16) !== null);
});

test('reset discards the window so a stall is not read as a frame rate', () => {
  const sampler = createFrameSampler();
  run(sampler, 60, 1000);
  sampler.reset();
  // A backgrounded tab: thirty seconds pass, then frames resume normally.
  assert.equal(sampler.sample(31000), null, 'the gap itself must not be a sample');
  const after = run(sampler, 60, 1000, 31000);
  for (const value of after) {
    assert.ok(Math.abs(value - 60) < 4, `stall leaked into ${value}`);
  }
});

test('a non-finite or backwards clock cannot produce Infinity', () => {
  // An Infinity handed to the tier manager reads as a wonderful frame rate
  // and would upshift quality on a device that had just stalled.
  const sampler = createFrameSampler();
  assert.equal(sampler.sample(NaN), null);
  assert.equal(sampler.sample(undefined), null);
  sampler.sample(1000);
  sampler.sample(1300);
  const backwards = sampler.sample(500);
  assert.ok(backwards === null || Number.isFinite(backwards), `got ${backwards}`);
});

test('the last measured value is readable between windows', () => {
  const sampler = createFrameSampler();
  run(sampler, 60, 1000);
  const held = sampler.value;
  assert.ok(held > 50 && held < 70, `held ${held}`);
  sampler.sample(1016);
  assert.equal(sampler.value, held, 'value should hold until the next window closes');
});
