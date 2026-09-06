import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNestPlacements } from '../src/nesting/nest-placement.js';
import { getQualityPixelRatio } from '../src/environment/visual-style.js';

function placement(angle, altitude = 145, extra = {}) {
  return { position: { x: Math.sin(angle) * altitude, y: Math.cos(angle) * altitude, z: 0 },
    surfaceNormal: { x: Math.sin(angle), y: Math.cos(angle), z: 0 }, ...extra };
}

test('a crowded grove retains only its highest crown even when hosts are different', () => {
  const a = placement(0, 145, { hostId: 'a', groveId: 'grove' });
  const b = placement(0.2, 170, { hostId: 'b', groveId: 'grove' });
  const c = placement(0.4, 155, { hostId: 'c', groveId: 'grove' });
  assert.deepEqual(selectNestPlacements([a, b, c], 120), [b]);
});

test('duplicate host identity is removed even if misplaced candidates are far apart', () => {
  const a = placement(0, 145, { hostId: 'same-tree' });
  const b = placement(1, 160, { hostId: 'same-tree' });
  assert.deepEqual(selectNestPlacements([a, b], 120), [b]);
});

test('surface spacing rejects vertically stacked nests but preserves distant null hosts', () => {
  const a = placement(0, 150, { hostObject: null });
  const b = placement(0.03, 190, { hostObject: null });
  const c = placement(0.5, 160, { hostObject: null });
  assert.deepEqual(selectNestPlacements([a, b, c], 120), [b, c]);
});

test('placement selection rejects corrupt positions and normals without mutating input', () => {
  const good = placement(0);
  const input = [good, null, placement(1, NaN), { ...placement(2), surfaceNormal: { x: 0, y: 0, z: 0 } }];
  assert.deepEqual(selectNestPlacements(input, 120), [good]);
  assert.equal(input.length, 4);
  assert.equal(input[0], good);
});

test('quality resolution survives rotation and respects low-DPR devices', () => {
  for (const dpr of [1, 2, 3]) {
    assert.equal(getQualityPixelRatio(dpr, 1.2, 1), 1);
    assert.equal(getQualityPixelRatio(dpr, 1.2, 2), 0.85);
    assert.equal(getQualityPixelRatio(dpr, 1.2, 0), Math.min(dpr, 1.2));
  }
  assert.equal(getQualityPixelRatio(0.75, 1.2, 1), 0.75);
});
