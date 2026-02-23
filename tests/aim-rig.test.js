import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { AimRig } from '../src/nesting/aim-rig.js';

const UP = new THREE.Vector3(0, 1, 0);

const directionFromQuaternion = (quaternion) =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();

test('AimRig keeps horizon as lowest angle by default', () => {
  const aimRig = new AimRig(THREE);
  aimRig.setActive(true);
  aimRig.setReferenceFromVectors(new THREE.Vector3(0, 0, -1), UP);

  // Pull down hard for multiple frames; default minPitch should prevent dipping below horizon.
  for (let i = 0; i < 20; i++) {
    aimRig.update({ axisX: 0, axisY: -1 }, 0.05);
  }

  const lookDir = directionFromQuaternion(aimRig.getQuaternion());
  assert.ok(lookDir.y > -1e-6, `look direction should not dip below horizon, y=${lookDir.y}`);
});

test('AimRig rotates smoothly through full yaw turns while elevated', () => {
  const aimRig = new AimRig(THREE);
  aimRig.setActive(true);
  aimRig.setReferenceFromVectors(new THREE.Vector3(0, 0, -1), UP);

  // Elevate above horizon.
  for (let i = 0; i < 12; i++) {
    aimRig.update({ axisX: 0, axisY: 1 }, 0.05);
  }

  // Rotate continuously past 360° at fixed elevation and track heading sweep.
  let minHeading = Infinity;
  let maxHeading = -Infinity;
  for (let i = 0; i < 80; i++) {
    aimRig.update({ axisX: 1, axisY: 0 }, 0.05);
    const stepDir = directionFromQuaternion(aimRig.getQuaternion());
    const heading = Math.atan2(stepDir.x, -stepDir.z);
    minHeading = Math.min(minHeading, heading);
    maxHeading = Math.max(maxHeading, heading);
  }

  const after = directionFromQuaternion(aimRig.getQuaternion());
  assert.ok(after.y > 0.01, `elevation should remain above horizon while yawing, y=${after.y}`);
  assert.ok(maxHeading - minHeading > Math.PI, 'yaw should sweep broadly without stalling');
});
