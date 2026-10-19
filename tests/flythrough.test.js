import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EASE, actorFrame, resolveRef, solveStartSceneTime, compileShot, auditShot, planShot, buildOccluders, tangentFrame,
} from '../src/camera/flythrough.js';

// A fake THREE with just what the kernel uses: Vector3 and a
// CatmullRomCurve3 whose getPoint(u) passes exactly through its points at
// u = i/(n-1) (piecewise linear — the kernel's keyframe indexing is what is
// under test, not three's spline).
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Curve {
  constructor(pts) { this.pts = pts; }
  getPoint(u) {
    const n = this.pts.length - 1;
    const f = Math.min(n - 1e-12, Math.max(0, u * n));
    const i = Math.floor(f), w = f - i;
    const a = this.pts[i], b = this.pts[Math.min(n, i + 1)];
    return new V3(a.x + (b.x - a.x) * w, a.y + (b.y - a.y) * w, a.z + (b.z - a.z) * w);
  }
}
const THREE = { Vector3: V3, CatmullRomCurve3: Curve };
const R = 120;
const flatGround = () => R;

const ctx = (extra = {}) => ({
  THREE,
  landmark: (id) => (id === 'arch' ? { base: [0, R, 0], forward: [1, 0, 0], apex: 17 } : null),
  actors: {
    van: {
      cycle: 100,
      phases: [{ name: 'out', start: 0, length: 40 }, { name: 'back', start: 40, length: 60 }],
      stateAt: (t) => ({ position: [t, R + 1, 0], forward: [1, 0, 0] }),
    },
  },
  ...extra,
});

test('actor offsets are [along, up, side] in the actor\'s own frame, with up RADIAL', () => {
  // side = forward x up, the kit's convention ((sin h, 0, cos h) at heading 0).
  const p = actorFrame([0, R, 0], [1, 0, 0], [2, 3, 4]);
  assert.deepEqual(p.map((v) => +v.toFixed(9)), [2, R + 3, 4]);
  // At the equator, "up" is +X, not +Y.
  const q = actorFrame([R, 0, 0], [0, 1, 0], [0, 5, 0]);
  assert.deepEqual(q.map((v) => +v.toFixed(9)), [R + 5, 0, 0]);
});

test('landmark refs: offsets in its frame, around = a circle round its base, spin turns it', () => {
  assert.deepEqual(resolveRef({ landmark: 'arch', offset: [10, 5, 0] }, ctx(), 0).map((v) => +v.toFixed(6)), [10, R + 5, 0]);
  const a = resolveRef({ around: 'arch', radius: 40, height: 15, angle: 0 }, ctx(), 0);
  assert.ok(Math.abs(Math.hypot(a[0], a[2]) - 40) < 1e-9 && Math.abs(a[1] - (R + 15)) < 1e-9);
  const b = resolveRef({ around: 'arch', radius: 40, height: 15, angle: 0 }, ctx(), 0, { spin: Math.PI });
  assert.ok(Math.abs(a[0] + b[0]) < 1e-9 && Math.abs(a[2] + b[2]) < 1e-9, 'spin PI is the opposite side');
  assert.throws(() => resolveRef({ landmark: 'nope' }, ctx(), 0), /unknown landmark/);
});

test('tangent frame is orthonormal and honours a forward hint', () => {
  const { east, north } = tangentFrame([0, 1, 0], [1, 0.3, 0]);
  assert.ok(Math.abs(east[0] - 1) < 1e-9);
  assert.ok(Math.abs(east[0] * north[0] + east[1] * north[1] + east[2] * north[2]) < 1e-12);
});

test('a clock solves the start so the actor is in its phase on cue', () => {
  const start = solveStartSceneTime({ actor: 'van', phase: 'back', progress: 0.5, atShotTime: 10 }, ctx().actors);
  assert.equal(start, 40 + 30 - 10);
  assert.equal(solveStartSceneTime({ sceneTime: 7 }, {}), 7);
  assert.throws(() => solveStartSceneTime({ actor: 'van', phase: 'nope' }, ctx().actors), /no phase/);
});

const line = {
  name: 'line', fade: [[0, 1], [1, 0], [9, 0], [10, 1]],
  keys: [
    { t: 0, pos: [0, R + 20, 0], look: [50, R, 0] },
    { t: 4, pos: [20, R + 20, 0], look: [50, R, 0] },
    { t: 10, pos: [40, R + 20, 0], look: [50, R, 0], ease: 'inOut' },
  ],
};

test('key i is reached exactly at t_i, and the camera up is radial', () => {
  const c = compileShot(line, ctx());
  assert.equal(c.duration, 10);
  assert.deepEqual(c.sample(4).position.map((v) => +v.toFixed(9)), [20, R + 20, 0]);
  assert.deepEqual(c.sample(10).position.map((v) => +v.toFixed(9)), [40, R + 20, 0]);
  const s = c.sample(2);
  const L = Math.hypot(...s.position);
  assert.ok(Math.abs(s.up[0] - s.position[0] / L) < 1e-12);
  assert.equal(c.dynamic, false, 'fixed points: curves built once');
});

test('fade: held, smoothstepped, black at both ends', () => {
  const c = compileShot(line, ctx());
  assert.equal(c.sample(0).fade, 1);
  assert.equal(c.sample(5).fade, 0);
  assert.equal(c.sample(10).fade, 1);
  assert.ok(c.sample(0.5).fade > 0 && c.sample(0.5).fade < 1);
});

test('an actor ref chases the actor at SCENE time', () => {
  const shot = { name: 'chase', clock: { sceneTime: 50 }, keys: [
    { t: 0, pos: { actor: 'van', offset: [-10, 5, 0] }, look: { actor: 'van' } },
    { t: 5, pos: { actor: 'van', offset: [-10, 5, 0] }, look: { actor: 'van' } },
  ] };
  const c = compileShot(shot, ctx());
  assert.equal(c.dynamic, true);
  const s = c.sample(3);
  assert.equal(s.sceneTime, 53);
  const van = [53, R + 1, 0];
  const d = Math.hypot(s.position[0] - van[0], s.position[1] - van[1], s.position[2] - van[2]);
  assert.ok(Math.abs(d - Math.hypot(10, 5)) < 1e-9, 'offset from where the van IS at t=53');
  assert.ok(s.position[0] < van[0], 'behind it');
});

test('a lead bird flies the path ahead of the lens, and the lens rides `lift` above it', () => {
  const c = compileShot({ ...line, bird: { lead: 2, lift: 3 }, keys: line.keys.map(({ look, ...k }) => k) }, ctx());
  const s = c.sample(0);
  assert.deepEqual(s.lead, [10, R + 20, 0]);
  assert.ok(Math.abs(Math.hypot(...s.position) - Math.hypot(0, R + 20, 0) - 3) < 1e-9);
  assert.deepEqual(s.lookAt, s.lead, 'with no look keys the lens looks at the bird');
});

test('pinned keys are exact under a raise', () => {
  const pinned = { ...line, keys: line.keys.map((k, i) => (i === 1 ? { ...k, pin: true } : k)) };
  const c = compileShot(pinned, ctx(), { raise: 10 });
  assert.deepEqual(c.sample(4).position.map((v) => +v.toFixed(9)), [20, R + 20, 0]);
  assert.ok(Math.hypot(...c.sample(10).position) > Math.hypot(40, R + 20, 0) + 9.9, 'raised away from the pin');
});

test('audit: catches the ground, the speed and a camera inside a solid', () => {
  const c = compileShot(line, ctx());
  assert.equal(auditShot(c, { groundRadiusAt: flatGround }).pass, true);
  const under = auditShot(c, { groundRadiusAt: () => R + 30 });
  assert.equal(under.checks.find((x) => x.name === 'clearance').pass, false);
  assert.equal(auditShot(c, { groundRadiusAt: flatGround, maxSpeed: 2 }).checks.find((x) => x.name === 'speed').pass, false);
  const solid = auditShot(c, { groundRadiusAt: flatGround, obstacleAt: (x) => (x > 15 && x < 25 ? 'tree' : null) });
  assert.match(solid.checks.find((x) => x.name === 'obstacles').detail, /tree/);
});

test('planShot raises the path until the world is clear, nearest variant first', () => {
  const plan = planShot(line, ctx(), { groundRadiusAt: () => R + 28, minClearance: 2 });
  assert.equal(plan.audit.pass, true);
  assert.equal(plan.raise, 12, 'the smallest raise that clears 28 + 2 from 20');
  const hopeless = planShot(line, ctx(), { groundRadiusAt: () => R + 500 }, { budgetMs: 50 });
  assert.equal(hopeless.audit.pass, false, 'a world nothing clears is refused, not faked');
});

test('occluders: inside a capsule, sight through it blocked, the subject\'s own body ignored', () => {
  // One upright capsule 10 tall, radius 1, at x = 20 (local box -1..1 x 0..10).
  const occ = buildOccluders([{ name: 'pole', box: { min: [-1, 0, -1], max: [1, 10, 1] }, matrices: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 20, 0, 0, 1]] }]);
  assert.equal(occ.inside(20, 5, 0), 'pole');
  assert.equal(occ.inside(25, 5, 0), null);
  assert.equal(occ.blocks([0, 5, 0], [40, 5, 0]), 'pole');
  assert.equal(occ.blocks([0, 5, 0], [40, 50, 0]), false);
  assert.equal(occ.blocks([0, 5, 0], [20, 5, 0]), false, 'looking AT the pole is not blocked by the pole');
});

test('easings are anchored', () => {
  for (const f of Object.values(EASE)) {
    assert.ok(Math.abs(f(0)) < 1e-12);
    assert.ok(Math.abs(f(1) - 1) < 1e-12);
  }
});
