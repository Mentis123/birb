import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditInstancedLayer, auditLandmark, auditRoute, auditGeometryBuffers, layerRuleFor, summarise,
} from '../src/environment/world-audit.js';

// A flat-ish planet: ground radius 118 everywhere.
const R_GROUND = 118;
const ground = () => R_GROUND;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// A unit cylinder-ish box along +Y from y=0 to y=1 (8 corners, but 300 copies
// so it is judged in BASE mode like a lathed trunk).
function tallGeometry() {
  const a = [];
  for (let i = 0; i < 300; i++) a.push((i % 2) * 0.4 - 0.2, (i % 3) === 0 ? 0 : 1, ((i >> 1) % 2) * 0.4 - 0.2);
  return { array: new Float32Array(a), itemSize: 3 };
}
// A small rock: 8 corners of a cube from -1..1 (vertex mode).
function rockGeometry() {
  const a = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) a.push(x, y, z);
  return { array: new Float32Array(a), itemSize: 3 };
}
// An instance standing on the +Y pole at radius r, scaled s along all axes.
function instanceAt(r, s = 1) {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, r, 0, 1];
}

const trunkRule = layerRuleFor('forest-trunks');
const rockRule = layerRuleFor('forest-rocks');

test('layer rules: ground props are audited, things that hang in the air are not', () => {
  assert.ok(layerRuleFor('forest-trunks'));
  assert.ok(layerRuleFor('mountain-scree'));
  assert.ok(layerRuleFor('city-towers-0'));
  assert.equal(layerRuleFor('forest-canopies-0'), null);
  assert.equal(layerRuleFor('city-hover'), null);
  assert.equal(layerRuleFor('mountain-clouds'), null);
});

test('a trunk standing on the ground passes; floating or sunk ones fail', () => {
  const run = (radius) => auditInstancedLayer({
    name: 'forest-trunks', meshWorld: IDENTITY, instanceArray: new Float32Array(instanceAt(radius, 10)),
    count: 1, position: tallGeometry(), groundRadiusAt: ground, rule: trunkRule,
  });
  assert.equal(run(R_GROUND).pass, true);
  assert.equal(run(R_GROUND - 0.4).pass, true, 'a slight embed is fine');
  const floating = run(R_GROUND + 25);
  assert.equal(floating.pass, false);
  assert.equal(floating.failures[0].problem, 'floating');
  const sunk = run(R_GROUND - 60);
  assert.equal(sunk.pass, false);
  assert.equal(sunk.failures[0].problem, 'buried');
});

test('rocks are judged by their real vertices: a sunk-in rock passes, a fully buried one fails', () => {
  const run = (radius) => auditInstancedLayer({
    name: 'forest-rocks', meshWorld: IDENTITY, instanceArray: new Float32Array(instanceAt(radius, 2)),
    count: 1, position: rockGeometry(), groundRadiusAt: ground, rule: rockRule,
  });
  const half = run(R_GROUND);
  assert.equal(half.mode, 'vertices');
  assert.equal(half.pass, true, 'half in the soil is how rocks are meant to sit');
  assert.equal(run(R_GROUND - 3).failures[0].problem, 'buried', 'no vertex above ground');
  assert.equal(run(R_GROUND + 8).failures[0].problem, 'floating');
});

test('zero-scale instances (hidden slots) are skipped, not failed', () => {
  const arr = new Float32Array([...instanceAt(R_GROUND, 10), ...new Array(16).fill(0)]);
  const res = auditInstancedLayer({
    name: 'forest-trunks', meshWorld: IDENTITY, instanceArray: arr, count: 2,
    position: tallGeometry(), groundRadiusAt: ground, rule: trunkRule,
  });
  assert.equal(res.audited, 1);
  assert.equal(res.pass, true);
});

// A half ring of radius 17 built in local XY (feet at x = +-17, y = 0),
// placed at the pole on the ground — the shape TorusGeometry(…, PI) has.
function halfRing(standing) {
  const a = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * Math.PI;
    const x = 17 * Math.cos(t), up = 17 * Math.sin(t);
    // standing: arc rises along world +Y (radial at the pole); flat: along +Z.
    if (standing) a.push(x, R_GROUND + up, 0); else a.push(x, R_GROUND, up);
  }
  return { world: IDENTITY, position: { array: new Float32Array(a), itemSize: 3 } };
}

test('a landmark arch must rise to its apex: a flattened one fails', () => {
  const base = [0, R_GROUND, 0];
  const ok = auditLandmark({ id: 'arch', apex: 17, base, meshes: [halfRing(true)], groundRadiusAt: ground });
  assert.equal(ok.pass, true, JSON.stringify(ok.failures));
  const flat = auditLandmark({ id: 'arch', apex: 17, base, meshes: [halfRing(false)], groundRadiusAt: ground });
  assert.equal(flat.pass, false);
  assert.equal(flat.failures[0].problem, 'flattened-or-sunk');
});

test('a landmark whose lowest point never reaches the ground is floating', () => {
  const lifted = halfRing(true);
  for (let i = 1; i < lifted.position.array.length; i += 3) lifted.position.array[i] += 9;
  const res = auditLandmark({ id: 'arch', apex: 17, base: [0, R_GROUND + 9, 0], meshes: [lifted], groundRadiusAt: ground });
  assert.deepEqual(res.failures.map((f) => f.problem), ['floating']);
});

test('declared feet must each be on the ground', () => {
  const base = [0, R_GROUND, 0];
  const good = auditLandmark({ id: 'arch', apex: 17, base, meshes: [halfRing(true)], groundRadiusAt: ground, contacts: [[-17, R_GROUND, 0], [17, R_GROUND - 1, 0]] });
  assert.equal(good.pass, true);
  const dangling = auditLandmark({ id: 'arch', apex: 17, base, meshes: [halfRing(true)], groundRadiusAt: ground, contacts: [[-17, R_GROUND, 0], [17, R_GROUND + 6, 0]] });
  assert.equal(dangling.failures[0].problem, 'foot-floating');
});

test('routes ride inside their band', () => {
  const samples = [[0, R_GROUND + 2, 0], [0, R_GROUND + 2.2, 0]];
  assert.equal(auditRoute({ name: 'tram', samples, groundRadiusAt: ground, minClear: 1, maxClear: 3 }).pass, true);
  const low = auditRoute({ name: 'tram', samples: [[0, R_GROUND - 1, 0]], groundRadiusAt: ground, minClear: 1, maxClear: 3 });
  assert.equal(low.failures[0].problem, 'below-ride-band');
});

test('geometry buffers: NaN and out-of-range indices fail', () => {
  const ok = auditGeometryBuffers({ name: 'g', position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), itemSize: 3 }, index: { array: [0, 1, 2] } });
  assert.equal(ok.pass, true);
  const nan = auditGeometryBuffers({ name: 'g', position: { array: new Float32Array([0, NaN, 0]), itemSize: 3 } });
  assert.equal(nan.failures[0].problem, 'non-finite');
  const bad = auditGeometryBuffers({ name: 'g', position: { array: new Float32Array([0, 0, 0]), itemSize: 3 }, index: { array: [0, 4, 0] } });
  assert.equal(bad.failures[0].problem, 'bad-index');
});

test('summarise names every failed section', () => {
  const s = summarise([{ name: 'a', kind: 'layer', pass: true }, { name: 'b', kind: 'landmark', pass: false }]);
  assert.equal(s.pass, false);
  assert.deepEqual(s.failed, ['landmark:b']);
});
