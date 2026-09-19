/**
 * The chase rig's stable-frame hold, for committed aerobatics.
 *
 * Without it the rig derives its up AND its offset direction from the bird's
 * own orientation. That is right for flying and wrong for a manoeuvre: a
 * barrel roll rolls the camera too, so the bird never visibly inverts, and a
 * loop swings the offset round behind the inverted bird as the nose comes
 * over the top, so the world reads as going backwards. Both were reported
 * from the phone in one message.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFollowCameraRig } from '../src/camera/follow-camera.js';

// The tracked stub lacks a few Vector3 ops the rig uses; shim additively.
const V = THREE.Vector3.prototype;
if (typeof V.add !== 'function') V.add = function (v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; };
if (typeof V.addScaledVector !== 'function') V.addScaledVector = function (v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; };
if (typeof V.lerp !== 'function') V.lerp = function (v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; };
if (typeof V.divideScalar !== 'function') V.divideScalar = function (s) { this.x /= s; this.y /= s; this.z /= s; return this; };
if (typeof V.crossVectors !== 'function') V.crossVectors = function (a, b) { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; this.x = x; this.y = y; this.z = z; return this; };
if (typeof V.subVectors !== 'function') V.subVectors = function (a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; };
if (typeof V.distanceTo !== 'function') V.distanceTo = function (v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); };

// reset() builds a look matrix and reads a quaternion off it; the stub has
// neither. The rig's OUTPUT under test is desiredPosition, which is computed
// before either, so inert shims are enough and cannot mask a wrong answer.
if (THREE.Matrix4 && typeof THREE.Matrix4.prototype.lookAt !== 'function') THREE.Matrix4.prototype.lookAt = function () { return this; };
if (typeof THREE.Quaternion.prototype.setFromRotationMatrix !== 'function') THREE.Quaternion.prototype.setFromRotationMatrix = function () { return this; };
if (typeof THREE.Quaternion.prototype.slerp !== 'function') THREE.Quaternion.prototype.slerp = function () { return this; };

const R = 100;
const makeRig = () => {
  const three = { ...THREE };
  if (!three.PerspectiveCamera) {
    three.PerspectiveCamera = class { constructor() { this.isPerspectiveCamera = true; this.position = new THREE.Vector3(); this.quaternion = new THREE.Quaternion(); this.up = new THREE.Vector3(0, 1, 0); this.fov = 60; } lookAt() {} updateProjectionMatrix() {} };
  }
  if (!three.Matrix4) three.Matrix4 = class { lookAt() { return this; } };
  const rig = createFollowCameraRig(three, { sphereCenter: new THREE.Vector3(0, 0, 0), offset: new THREE.Vector3(0, 2, 6) });
  // The rig type-checks its camera with `instanceof` against the class it
  // was handed, so the camera must come from THIS rig's namespace.
  return { rig, three, camera: new three.PerspectiveCamera() };
};

/** A bird at the north pole, rolled by `roll` about its forward (-Z). */
const poseRolled = (roll) => ({
  position: new THREE.Vector3(0, R, 0),
  quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll),
});

test('setHold exists, clamps its weight, and releases at zero', () => {
  const { rig } = makeRig();
  assert.equal(typeof rig.setHold, 'function');
  assert.equal(rig.setHold({ weight: 7 }), 1);
  assert.equal(rig.setHold({ weight: -1 }), 0);
  assert.equal(rig.setHold(), 0);
});

test('without a hold the rig rolls with the bird; with one, it does not', () => {
  // The rig's "up" is what its debug state cannot show directly, so measure
  // through the desired camera position: the height term is added along
  // state.up, so a rolled up moves the camera sideways in world space.
  const world = new THREE.Vector3(0, 1, 0);
  const sideways = ({ rig, camera }, pose) => {
    rig.reset({ camera, pose });
    const p = rig.getDebugState().position;
    return Math.abs(p.x);   // x is off-axis at the pole: a level camera has none
  };
  const a = makeRig();
  const rolledNoHold = sideways(a, poseRolled(Math.PI / 2));
  const b = makeRig();
  b.rig.setHold({ weight: 1, heading: new THREE.Vector3(0, 0, -1), up: world });
  const rolledHold = sideways(b, poseRolled(Math.PI / 2));
  assert.ok(rolledNoHold > 1.0, `expected the unheld rig to follow the roll sideways, got ${rolledNoHold}`);
  assert.ok(rolledHold < 0.05, `held rig still moved sideways by ${rolledHold}`);
});
