import test from 'node:test';
import assert from 'node:assert/strict';
import { laneAt, streetLanes, STREET_BLOCK, livingWorldRequested, _boxSoup, _shuttle } from '../src/environment/living-world.js';

const R = 120;

test('every street lane lies ON the shader grid (where lon*cos(lat)*R/44 or lat*R/44 is an integer)', () => {
  const p = { x: 0, y: 0, z: 0 };
  for (const lane of streetLanes(R)) {
    for (const u of [0.03, 0.21, 0.5, 0.77]) {
      laneAt(lane, u, R + 30, R, p);
      const r = Math.hypot(p.x, p.y, p.z);
      assert.ok(Math.abs(r - (R + 30)) < 1e-9, 'rides at its own radius');
      const lat = Math.asin(p.y / r);
      const lon = Math.atan2(p.z, p.x) * Math.cos(lat);
      const street = lane.kind === 'lat' ? lat * R / STREET_BLOCK : lon * R / STREET_BLOCK;
      assert.ok(Math.abs(street - Math.round(street)) < 1e-6, `${lane.kind}${lane.index} u=${u} street=${street}`);
    }
  }
});

test('lanes are continuous: a small step in u is a small step in space', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
  for (const lane of streetLanes(R)) {
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      laneAt(lane, k / 400, R, R, a);
      laneAt(lane, (k + 1) / 400, R, R, b);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    assert.ok(worst < 6, `${lane.kind}${lane.index} jumps ${worst.toFixed(2)}`);
  }
});

test('a skyway is a great circle: constant radius, closes on itself', () => {
  const lane = { kind: 'arc', a: [1, 0, 0], b: [0, Math.SQRT1_2, Math.SQRT1_2] };
  const p = { x: 0, y: 0, z: 0 }, q = { x: 0, y: 0, z: 0 };
  for (const u of [0, 0.13, 0.5, 0.91]) {
    laneAt(lane, u, 150, R, p);
    assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 150) < 1e-9);
  }
  laneAt(lane, 0, 150, R, p); laneAt(lane, 1, 150, R, q);
  assert.ok(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-9, 'u and u+1 are the same point: no end to turn round at');
});

test('the shuttle dwells at both ends and is continuous', () => {
  assert.equal(_shuttle(0), 0);
  assert.equal(_shuttle(0.5), 1);
  assert.ok(Math.abs(_shuttle(1) - _shuttle(0)) < 1e-12);
  assert.ok(_shuttle(0.01) < 0.002, 'eases out of the end');
});

test('?living=0 turns the layer off; anything else leaves it on', () => {
  assert.equal(livingWorldRequested('?living=0'), false);
  assert.equal(livingWorldRequested('?debug=1&living=0'), false);
  assert.equal(livingWorldRequested('?living=1'), true);
  assert.equal(livingWorldRequested(''), true);
});

test('box soup faces wind OUTWARD (an inward box renders as nothing under FrontSide)', () => {
  // A fake THREE with just enough BufferGeometry to read the positions back.
  let positions = null;
  const THREE = {
    BufferGeometry: class { setAttribute(_, a) { positions = a.array; } computeVertexNormals() {} computeBoundingSphere() {} },
    Float32BufferAttribute: class { constructor(arr) { this.array = arr; } },
  };
  _boxSoup(THREE, [[1, 2, 3, 2, 4, 6]]);
  assert.equal(positions.length, 6 * 2 * 9);
  for (let t = 0; t < positions.length; t += 9) {
    const A = positions.slice(t, t + 3), B = positions.slice(t + 3, t + 6), C = positions.slice(t + 6, t + 9);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const ctr = [(A[0] + B[0] + C[0]) / 3 - 1, (A[1] + B[1] + C[1]) / 3 - 2, (A[2] + B[2] + C[2]) / 3 - 3];
    assert.ok(n[0] * ctr[0] + n[1] * ctr[1] + n[2] * ctr[2] > 0, `triangle ${t / 9} faces inward`);
  }
});
