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

// ── the dive that used to turn into a spiral ────────────────────────────
//
// Held (x 0.25, y -1) from 200 units up, the shipped model rolled the bird
// from 0.5 to 40 degrees, swung its heading through more than a full turn,
// and carried the pitch from -70 degrees round to +55 — it pulled out of its
// own dive and started climbing. The cause was the turn axis: yawing about
// the bird's OWN up is a world-space roll once the nose is steeply down, and
// nothing outside Zen mode ever took roll back out.

/** Roll: the planet's up projected onto the bird's own right. 0 is level. */
const rollOf = (bird) => {
  const up = bird.position.clone().normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(bird.quaternion).normalize();
  return Math.asin(Math.max(-1, Math.min(1, up.dot(right))));
};
// Pitch (positive is nose-up away from the planet) is `pitchOf` above.
const fly = (bird, input, seconds, step = 1 / 60) => {
  for (let t = 0; t < seconds; t += step) bird.tick(input, step);
  return bird;
};

test('a diving turn holds its dive instead of rolling out of it', () => {
  const bird = makeBird({ position: new THREE.Vector3(0, SPHERE_RADIUS + 200, 0) });
  fly(bird, { x: 0.25, y: -1 }, 4);
  // The whole defect in one number: roll must not accumulate.
  assert.ok(Math.abs(rollOf(bird)) < 0.09,
    `rolled ${(rollOf(bird) * 180 / Math.PI).toFixed(1)} degrees into a held diving turn`);
  // And the dive must still be a dive four seconds later, not a climb.
  assert.ok(pitchOf(bird) < -1.0,
    `pitch came out to ${(pitchOf(bird) * 180 / Math.PI).toFixed(1)} degrees — the bird left its own dive`);
});

test('the legacy model really does roll out — this is a true before', () => {
  // Without this the test above proves only that the current code is
  // self-consistent, not that it fixed anything.
  const legacy = makeBird({ position: new THREE.Vector3(0, SPHERE_RADIUS + 200, 0), levelTurns: false });
  fly(legacy, { x: 0.25, y: -1 }, 4);
  assert.ok(Math.abs(rollOf(legacy)) > 0.3,
    `legacy only rolled ${(rollOf(legacy) * 180 / Math.PI).toFixed(1)} degrees; the defect is not being reproduced`);
});

test('a turn about the planet-up is still a turn when level, and costs nothing', () => {
  // In level flight the bird's own up and the planet's coincide, so the new
  // axis must be a no-op there: this change may only bite where the old one
  // was already wrong.
  const a = makeBird();
  const b = makeBird({ levelTurns: false });
  fly(a, { x: 1, y: 0 }, 1.5);
  fly(b, { x: 1, y: 0 }, 1.5);
  assert.ok(dist(a.position, b.position) < 1.0,
    `level turns diverged by ${dist(a.position, b.position).toFixed(2)} units`);
});

test('roll levelling brings a rolled bird back and does not overshoot', () => {
  const bird = makeBird();
  // Roll it hard by hand, then fly straight.
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.9);
  bird.quaternion.multiply(roll);
  const before = Math.abs(rollOf(bird));
  fly(bird, { x: 0, y: 0 }, 3);
  const after = Math.abs(rollOf(bird));
  assert.ok(after < before * 0.35, `roll went ${before.toFixed(3)} -> ${after.toFixed(3)}`);
  // Overshoot would read as a wobble on screen, which is worse than the tilt.
  for (let i = 0; i < 120; i += 1) {
    bird.tick({ x: 0, y: 0 }, 1 / 60);
    assert.ok(Math.abs(rollOf(bird)) <= after + 1e-6, 'roll levelling oscillated past level');
  }
});

test('a dive can reach 80 degrees and is still clamped short of vertical', () => {
  // Short of 90 on purpose: at exactly vertical the tangent-plane heading is
  // undefined and the auto-level term has no sign to work with.
  const bird = makeBird({ position: new THREE.Vector3(0, SPHERE_RADIUS + 300, 0) });
  fly(bird, { x: 0, y: -1 }, 4);
  const deg = pitchOf(bird) * 180 / Math.PI;
  assert.ok(deg < -79.5 && deg > -80.5, `deepest dive measured ${deg.toFixed(2)} degrees`);
});

// ── aerobatics on the flight frame ──────────────────────────────────────
test('a positive aerobatic roll drops the RIGHT wing — into a right bank', () => {
  // Shipped the other way. Forward is local -Z, so a positive rotation about
  // +Z carries +X (the right wing) UP: a hard right bank rolled the bird
  // LEFT, against the visual bank the model was already holding. Reported
  // from the phone as "hard bank left then does a right roll".
  const bird = makeBird();
  bird.aerobatic(0.4, 0);
  const rightWing = new THREE.Vector3(1, 0, 0).applyQuaternion(bird.quaternion);
  const up = bird.position.clone().normalize();
  assert.ok(rightWing.dot(up) < -0.3, `right wing went ${rightWing.dot(up) > 0 ? 'UP' : 'down'} (${rightWing.dot(up).toFixed(3)})`);
});

test('a positive aerobatic pitch is nose-UP, the same sense as pitch()', () => {
  const a = makeBird(); a.aerobatic(0, 0.4);
  const b = makeBird(); b.pitch(1, 0.4 / b.pitchRate);
  assert.ok(Math.abs(pitchOf(a) - pitchOf(b)) < 1e-6, `${pitchOf(a)} vs ${pitchOf(b)}`);
  assert.ok(pitchOf(a) > 0.3, 'must be nose-up');
});

test('while a move is active, tick() applies neither the stick nor any stabiliser', () => {
  const bird = makeBird();
  // Pitch it past the 80-degree ceiling, as the first quarter of a loop
  // does. (Not a full PI: that lands the nose level-and-backwards, where
  // asin-measured pitch reads 0 and proves nothing about the clamp.)
  bird.aerobatic(0, 1.5);
  const before = bird.quaternion.clone();
  bird.tick({ x: 1, y: -1 }, 1 / 60);   // hard stick, both axes
  // Only the sphere transport may have touched the orientation, and at
  // cruise that is a fraction of a degree per frame.
  const dq = Math.abs(before.x - bird.quaternion.x) + Math.abs(before.y - bird.quaternion.y)
    + Math.abs(before.z - bird.quaternion.z) + Math.abs(before.w - bird.quaternion.w);
  assert.ok(dq < 0.01, `orientation moved ${dq} in one frame under a suspended stick`);
  assert.ok(pitchOf(bird) > 1.45, `the 80-degree clamp must not fire mid-loop (pitch ${pitchOf(bird)})`);
  bird.endAerobatic();
  bird.tick({ x: 0, y: 0 }, 1 / 60);
  assert.ok(Math.abs(pitchOf(bird)) <= bird.maxPitch + 0.05, 'the clamp resumes once the move ends');
});
