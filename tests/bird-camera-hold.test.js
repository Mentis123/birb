/**
 * The LIVE chase camera's stable-frame hold, for committed aerobatics.
 *
 * `BirdCamera` stands behind the bird along the bird's own forward. During a
 * loop that forward points up, then backwards, then down, so the camera
 * swings underneath the bird and out the far side and the world reads as
 * going backwards — reported from the phone as "climb up goes wild, maybe
 * backwards". Under a hold the stand-off runs along the level heading the
 * move began with, stretched so the loop stays in front of the lens.
 *
 * (follow-camera.js carries the same hold, and has its own test, but that
 * rig is parked at spawn on the shipping path: read back through a whole
 * loop its position never moved. This is the one that renders.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BirdCamera } from '../src/flight/bird-camera.js';

const V = THREE.Vector3.prototype;
if (typeof V.addScaledVector !== 'function') V.addScaledVector = function (v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; };
if (typeof V.lerp !== 'function') V.lerp = function (v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; };

const R = 100;
const makeCam = () => {
  const camera = { position: new THREE.Vector3(0, R + 2, 5), up: new THREE.Vector3(0, 1, 0), lookAt() {} };
  const rig = new BirdCamera(THREE, camera, { distance: 5, height: 2, lookAhead: 2, smoothing: 0.1, sphereCenter: new THREE.Vector3(0, 0, 0) });
  return { rig, camera };
};
/** A bird at the north pole flying -Z, pitched nose-up by `pitch` (about +X). */
const bird = (pitch) => ({
  position: new THREE.Vector3(0, R, 0),
  quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch),
});
const level = new THREE.Vector3(0, 0, -1);

test('without a hold the camera follows the nose over the top; with one it stays behind the level heading', () => {
  // Bird pointing straight UP (a quarter of the way round a loop).
  const b = bird(Math.PI / 2);
  const a = makeCam();
  a.rig.snap(b.position, b.quaternion);
  // Behind a bird whose forward is +Y is BELOW it: z stays ~0, y drops.
  assert.ok(a.camera.position.y < R, `unheld camera should be under a vertical bird, y=${a.camera.position.y}`);

  const h = makeCam();
  h.rig.setHold({ weight: 1, heading: level, distanceMul: 2 });
  h.rig.snap(b.position, b.quaternion);
  // Held: 2x stand-off along -heading (= +Z, behind), 2x height along radial.
  assert.ok(Math.abs(h.camera.position.z - 10) < 1e-6, `expected 10 behind along the held heading, got z=${h.camera.position.z}`);
  assert.ok(Math.abs(h.camera.position.y - (R + 4)) < 1e-6, `expected 4 above, got y=${h.camera.position.y}`);
});

test('the hold is a blend, so its ramp cannot snap the frame', () => {
  const b = bird(Math.PI / 2);
  const { rig, camera } = makeCam();
  rig.setHold({ weight: 0.5, heading: level, distanceMul: 2 });
  rig.snap(b.position, b.quaternion);
  // Halfway between "under the bird" and "10 behind": strictly between.
  assert.ok(camera.position.z > 0.5 && camera.position.z < 10, `z=${camera.position.z}`);
});

test('setHold clamps, copies, and releases; getHold reads back what the rig has', () => {
  const { rig } = makeCam();
  const h = new THREE.Vector3(1, 0, 0);
  assert.equal(rig.setHold({ weight: 5, heading: h, distanceMul: 3 }), 1);
  h.x = 0; h.z = -1;                       // mutate the caller's vector
  assert.equal(rig.getHold().heading.x, 1, 'heading must be copied, not retained');
  assert.equal(rig.getHold().distanceMul, 3);
  assert.equal(rig.setHold(), 0);
  assert.equal(rig.getHold().weight, 0);
});
