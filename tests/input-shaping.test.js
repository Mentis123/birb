import assert from 'node:assert/strict';
import test from 'node:test';
import { inputShaping } from '../src/controls/virtual-thumbstick.js';

const { applyDeadzone, applyExpo, shapeAxis } = inputShaping;

test('deadzone removes drift and rescales remaining input', () => {
  assert.equal(applyDeadzone(-0.05, 0.1), 0);
  assert.ok(Math.abs(applyDeadzone(0.6, 0.2) - 0.5) < 1e-10);
});

test('expo preserves sign while smoothing mid-stick travel', () => {
  assert.equal(applyExpo(0.5, 0.5), 0.3125);
  assert.equal(applyExpo(-0.5, 0.5), -0.3125);
});

test('shapeAxis combines deadzone and expo before clamping', () => {
  const shaped = shapeAxis(-0.2, { deadzone: 0.1, expo: 0.3 });
  assert.ok(Math.abs(shaped + 0.0781893) < 1e-6);
  assert.equal(shapeAxis(2, { deadzone: 0, expo: 0 }), 1);
});
