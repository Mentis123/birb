import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BirdFlight } from '../src/flight/bird-flight.js';

// The repo's minimal `three` test stub (node_modules/three/index.js) never
// needed Vector3.add until BirdFlight became the unit-under-test. Shim it here
// (additive, harmless to other suites) rather than depending on the full lib.
if (typeof THREE.Vector3.prototype.add !== 'function') {
  THREE.Vector3.prototype.add = function add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  };
}

const SPHERE_RADIUS = 100;

const makeBird = (opts = {}) =>
  new BirdFlight(THREE, {
    sphereRadius: SPHERE_RADIUS,
    speed: 11,
    position: new THREE.Vector3(0, SPHERE_RADIUS, 0),
    ...opts,
  });

// Distance via stub-supported ops (clone/sub/length) — the stub has no distanceTo.
const dist = (a, b) => a.clone().sub(b).length();

const pitchOf = (bird) => {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(bird.quaternion).normalize();
  const normal = bird.position.clone().sub(bird.sphereCenter).normalize();
  return Math.asin(Math.max(-1, Math.min(1, forward.dot(normal))));
};

test('tick clamps a huge delta so a hitch cannot teleport the bird', () => {
  const bird = makeBird();
  const before = bird.position.clone();
  bird.tick({ x: 0, y: 0 }, 5.0); // a 5s tab-restore / GC hitch
  const moved = dist(bird.position, before);
  // Unclamped this would move ~55m (speed 11 * 5s); clamped to 0.05s it is ~0.55m.
  assert.ok(moved < 1.0, `delta clamp should cap movement, moved=${moved}`);
});

test('setThrottle scales cruise speed and clamps to 0..1', () => {
  const bird = makeBird({ speed: 10 });
  bird.setThrottle(0.5);
  assert.equal(bird.throttle, 0.5);
  assert.equal(bird.speed, 5);
  bird.setThrottle(2); // out of range -> clamp
  assert.equal(bird.throttle, 1);
  assert.equal(bird.speed, 10);
});

test('reset restores the spawn pose, throttle and speed', () => {
  const bird = makeBird({ speed: 10 });
  const spawn = bird.position.clone();
  bird.setThrottle(0.3);
  bird.tick({ x: 1, y: 1 }, 0.05);
  bird.reset();
  assert.ok(dist(bird.position, spawn) < 1e-6, 'position restored');
  assert.equal(bird.throttle, 1);
  assert.equal(bird.speed, 10);
});

test('pitch is clamped so the bird can never invert', () => {
  const bird = makeBird();
  for (let i = 0; i < 200; i += 1) bird.tick({ x: 0, y: 1 }, 0.05); // hold full nose-up
  assert.ok(
    Math.abs(pitchOf(bird)) <= bird.maxPitch + 0.05,
    `pitch ${pitchOf(bird)} should stay within maxPitch ${bird.maxPitch}`,
  );
});

test('stays on or above the sphere surface while diving', () => {
  const bird = makeBird();
  for (let i = 0; i < 100; i += 1) bird.tick({ x: 0.5, y: -1 }, 0.05); // dive hard
  const radius = dist(bird.position, bird.sphereCenter);
  assert.ok(radius >= SPHERE_RADIUS - 1e-6, `radius ${radius} should not sink below the surface`);
});
