import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import {
  minimapGroundDist2,
  clampMinimapPoint,
  projectMinimapPoint,
} from '../src/ui/minimap.js';

const SPHERE_RADIUS = 120;

test('minimapGroundDist2 is altitude-invariant', () => {
  const birdUp = new Vector3(0, 1, 0);
  // Same ground direction, wildly different altitudes.
  const low = new Vector3(10, 119, 0);
  const high = new Vector3(10 * 1.4, 119 * 1.4, 0); // same direction, 1.4x radius
  const dLow = minimapGroundDist2(low, birdUp, SPHERE_RADIUS);
  const dHigh = minimapGroundDist2(high, birdUp, SPHERE_RADIUS);
  assert.ok(Math.abs(dLow - dHigh) < 1e-6, `altitude leaked into ground distance: ${dLow} vs ${dHigh}`);
});

test('minimapGroundDist2 grows with great-circle separation', () => {
  const birdUp = new Vector3(0, 1, 0);
  const near = new Vector3(5, 120, 0);
  const far = new Vector3(60, 100, 0);
  assert.ok(
    minimapGroundDist2(near, birdUp, SPHERE_RADIUS) < minimapGroundDist2(far, birdUp, SPHERE_RADIUS)
  );
});

test('clampMinimapPoint passes through interior points and clamps rim points', () => {
  const half = 100;
  const out = { x: 0, y: 0, clamped: false };

  clampMinimapPoint({ x: 110, y: 95 }, half, out);
  assert.equal(out.clamped, false);
  assert.equal(out.x, 110);
  assert.equal(out.y, 95);

  clampMinimapPoint({ x: 300, y: 100 }, half, out);
  assert.equal(out.clamped, true);
  // Clamped onto the rim circle of radius half - 10, in the same direction.
  const dist = Math.hypot(out.x - half, out.y - half);
  assert.ok(Math.abs(dist - (half - 10)) < 1e-9);
  assert.ok(out.x > half && Math.abs(out.y - half) < 1e-9);
});

test('projectMinimapPoint is altitude-invariant and direction-correct', () => {
  // Bird at the north pole of the sphere, facing -Z: forward = (0,0,-1),
  // right = (1,0,0)? right = forward x up = (0,0,-1)x(0,1,0) = (1,0,0)...
  // cross((0,0,-1),(0,1,0)) = (0*0 - (-1)*1, (-1)*0 - 0*0, 0*1 - 0*0) = (1,0,0).
  const birdPos = new Vector3(0, SPHERE_RADIUS, 0);
  const forward = new Vector3(0, 0, -1);
  const right = new Vector3(1, 0, 0);
  const half = 100;
  const scale = 1;
  const surf = new Vector3();
  const delta = new Vector3();
  const out = { x: 0, y: 0 };

  // A target straight ahead (toward -Z) should land above center (y < half).
  const ahead = new Vector3(0, 119, -15);
  projectMinimapPoint(ahead, birdPos, right, forward, half, scale, SPHERE_RADIUS, surf, delta, out);
  assert.ok(out.y < half, 'target ahead should draw above center');
  assert.ok(Math.abs(out.x - half) < 1.0, 'target ahead should be horizontally centered');

  // The same ground direction at high altitude must project to (nearly) the
  // same radar position — altitude must not push targets outward.
  const aheadHigh = new Vector3(0, 119 * 1.5, -15 * 1.5);
  const out2 = { x: 0, y: 0 };
  projectMinimapPoint(aheadHigh, birdPos, right, forward, half, scale, SPHERE_RADIUS, surf, delta, out2);
  assert.ok(Math.abs(out.x - out2.x) < 1e-6 && Math.abs(out.y - out2.y) < 1e-6,
    `altitude changed radar position: (${out.x},${out.y}) vs (${out2.x},${out2.y})`);

  // A target to the bird's right (+X) should land right of center.
  const rightTarget = new Vector3(15, 119, 0);
  projectMinimapPoint(rightTarget, birdPos, right, forward, half, scale, SPHERE_RADIUS, surf, delta, out);
  assert.ok(out.x > half, 'target to the right should draw right of center');
});
