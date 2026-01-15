import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMERA_MODES } from '../src/camera/camera-state.js';

// Note: The createCameraState function requires browser APIs (window, URLSearchParams)
// and cannot be fully tested in Node.js. These tests cover the exported constants
// and any pure functions that don't depend on browser APIs.

// === CAMERA_MODES constant tests ===

test('CAMERA_MODES contains all expected modes', () => {
  assert.equal(CAMERA_MODES.FOLLOW, 'Follow');
  assert.equal(CAMERA_MODES.SEQUENCE, 'Sequence');
  assert.equal(CAMERA_MODES.FPV, 'FPV');
  assert.equal(CAMERA_MODES.FIXED, 'Fixed');
});

test('CAMERA_MODES is frozen', () => {
  assert.ok(Object.isFrozen(CAMERA_MODES), 'CAMERA_MODES should be frozen');
});

test('CAMERA_MODES has exactly 4 modes', () => {
  const modeCount = Object.keys(CAMERA_MODES).length;
  assert.equal(modeCount, 4, 'should have exactly 4 camera modes');
});

test('CAMERA_MODES values are all strings', () => {
  for (const [key, value] of Object.entries(CAMERA_MODES)) {
    assert.equal(typeof value, 'string', `${key} should be a string`);
  }
});

test('CAMERA_MODES values are unique', () => {
  const values = Object.values(CAMERA_MODES);
  const uniqueValues = new Set(values);
  assert.equal(uniqueValues.size, values.length, 'all mode values should be unique');
});

// Note: Full createCameraState tests would require:
// - Browser environment (or jsdom)
// - Mocking window.location
// - Mocking requestAnimationFrame
// These tests are better suited for integration/e2e testing in a browser environment.
