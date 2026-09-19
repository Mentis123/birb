import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { birdRigContract, BIRD_BUDGET } from '../src/flight/bird-contract.js';

// ---------------------------------------------------------------------------
// Fakes. Duck-typed Object3D-alikes — `children`, `name`, `userData`, `scale`.
// The validator imports no THREE on purpose, so these are the whole world.
// ---------------------------------------------------------------------------

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });

const node = (name, extra = {}) => ({
  name,
  children: [],
  position: vec(),
  rotation: vec(),
  scale: vec(1, 1, 1),
  userData: {},
  ...extra,
});

const featherEmpty = (name) => node(name);

/** A wing group shaped exactly like `buildWing()` in index.html. */
function wing(name, mirrored) {
  const tip = featherEmpty(`${name}Tip`);
  const secondary = featherEmpty(`${name}Secondary`);
  const g = node(name);
  g.children.push(node(`${name}Blade`), secondary, tip);
  g.userData.baseRotation = mirrored ? vec(0.1, 0.35, 0.18) : vec(-0.1, -0.35, 0.18);
  g.userData.tipFeather = tip;
  g.userData.secondaryFeather = secondary;
  g.scale = vec(1, 1, mirrored ? -1 : 1);
  return g;
}

/**
 * Shaped like the CURRENT procedural bird: a `birbModel` group holding loose
 * body meshes plus the five named rig groups.
 */
function proceduralBirdFake() {
  const model = node('birbModel');
  const tail = node('tail');
  tail.userData.baseRotation = vec(0, 0, -0.12);
  for (let i = 0; i < 5; i++) tail.children.push(node(`tailFeather${i}`));

  model.children.push(
    node('body'),
    node('head'),
    node('beak'),
    wing('leftWing', false),
    wing('rightWing', true),
    tail,
    node('leftFoot', { children: [node('leftToe')] }),
    node('rightFoot', { children: [node('rightToe')] }),
  );
  return model;
}

/**
 * Shaped like the shipped `birb.glb`: a scene with ONE unnamed mesh under it.
 * 10,000 triangles, one baked JPEG, no rig. This is the model the project
 * could not tell apart from a working bird until this validator existed.
 */
function statueGlbFake() {
  const scene = node('Scene');
  const mesh = node('', { isMesh: true, geometry: {}, material: {} });
  scene.children.push(mesh);
  return scene;
}

const failuresMentioning = (result, needle) =>
  result.failures.filter((f) => f.includes(needle));

// ---------------------------------------------------------------------------
// (a) the current procedural bird passes
// ---------------------------------------------------------------------------

test('a model shaped like the current procedural bird satisfies the rig contract', () => {
  const result = birdRigContract(proceduralBirdFake());
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test('the contract does not care where in the tree the rig groups hang', () => {
  // A rebuilt bird is free to nest its groups (wings under a shoulder girdle,
  // feet under a pelvis). The rig finds them with getObjectByName, which is a
  // full-tree search, so the validator must be one too.
  const model = proceduralBirdFake();
  const girdle = node('shoulders');
  girdle.children.push(...model.children.splice(3, 2)); // both wings
  model.children.push(girdle);
  assert.equal(birdRigContract(model).ok, true);
});

// ---------------------------------------------------------------------------
// (b) the shipped GLB statue fails, naming every missing group
// ---------------------------------------------------------------------------

test('a statue shaped like the shipped birb.glb fails and names every missing group', () => {
  const result = birdRigContract(statueGlbFake());
  assert.equal(result.ok, false);

  for (const name of ['leftWing', 'rightWing', 'tail', 'leftFoot', 'rightFoot']) {
    assert.equal(
      failuresMentioning(result, `"${name}"`).length, 1,
      `expected exactly one "no node named ${name}" failure, got: ${result.failures.join(' | ')}`,
    );
  }
  // Five missing groups is the whole report — the validator must not also
  // invent baseRotation/tipFeather failures for nodes that do not exist, or a
  // real diagnosis drowns in noise.
  assert.equal(result.failures.length, 5, result.failures.join('\n'));
});

test('a nullish or non-object model is a failure, not a crash', () => {
  for (const bad of [null, undefined, 42, 'birb']) {
    const result = birdRigContract(bad);
    assert.equal(result.ok, false);
    assert.ok(result.failures.length > 0);
  }
});

// ---------------------------------------------------------------------------
// (c) the mirror rule, specifically
// ---------------------------------------------------------------------------

test('a right wing mirrored with a POSITIVE scale.z fails on the mirror rule alone', () => {
  const model = proceduralBirdFake();
  const rightWing = model.children.find((c) => c.name === 'rightWing');
  rightWing.scale.z = 1;

  const result = birdRigContract(model);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1, result.failures.join('\n'));

  const [failure] = result.failures;
  assert.ok(failure.includes('rightWing'), failure);
  assert.ok(/scale\.z/.test(failure), failure);
  assert.ok(/negative/i.test(failure), failure);
});

test('a left wing with a negative scale.z fails too — the sides are not interchangeable', () => {
  const model = proceduralBirdFake();
  model.children.find((c) => c.name === 'leftWing').scale.z = -1;
  const result = birdRigContract(model);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1, result.failures.join('\n'));
  assert.ok(result.failures[0].includes('leftWing'));
});

// ---------------------------------------------------------------------------
// (d) tipFeather — and the reason it is required
// ---------------------------------------------------------------------------

test('a wing missing only tipFeather fails, and the message says why the ribbon needs it', () => {
  const model = proceduralBirdFake();
  const leftWing = model.children.find((c) => c.name === 'leftWing');
  delete leftWing.userData.tipFeather;

  const result = birdRigContract(model);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1, result.failures.join('\n'));

  const [failure] = result.failures;
  assert.ok(failure.includes('leftWing'), failure);
  assert.ok(failure.includes('tipFeather'), failure);
  // The whole point of naming it: a missing tip does not look broken, the
  // boost ribbon just never appears. The failure has to say so.
  assert.ok(/ribbon/i.test(failure), failure);
});

test('a tipFeather that is not an object with a position is as useless as a missing one', () => {
  const model = proceduralBirdFake();
  model.children.find((c) => c.name === 'rightWing').userData.tipFeather = 'wingtip';
  const result = birdRigContract(model);
  assert.equal(result.ok, false);
  assert.ok(failuresMentioning(result, 'tipFeather').length === 1, result.failures.join('\n'));
});

test('a wing missing secondaryFeather fails on the follow-through', () => {
  const model = proceduralBirdFake();
  delete model.children.find((c) => c.name === 'rightWing').userData.secondaryFeather;
  const result = birdRigContract(model);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1, result.failures.join('\n'));
  assert.ok(result.failures[0].includes('secondaryFeather'));
});

// ---------------------------------------------------------------------------
// baseRotation
// ---------------------------------------------------------------------------

test('each animated group must carry a numeric baseRotation', () => {
  for (const name of ['leftWing', 'rightWing', 'tail']) {
    const model = proceduralBirdFake();
    delete model.children.find((c) => c.name === name).userData.baseRotation;
    const result = birdRigContract(model);
    assert.equal(result.ok, false, `${name} without baseRotation should fail`);
    assert.equal(result.failures.length, 1, result.failures.join('\n'));
    assert.ok(result.failures[0].includes(name));
    assert.ok(result.failures[0].includes('baseRotation'));
  }
});

test('a baseRotation with a non-numeric component fails rather than poisoning the pose with NaN', () => {
  const model = proceduralBirdFake();
  model.children.find((c) => c.name === 'tail').userData.baseRotation = { x: 0, y: undefined, z: -0.12 };
  const result = birdRigContract(model);
  assert.equal(result.ok, false);
  assert.ok(result.failures[0].includes('tail'), result.failures[0]);
});

// ---------------------------------------------------------------------------
// The budget, checked against the plan document itself.
//
// Deliberate: if BIRD_PLAN.md's Phase 0 gate is retuned and this constant is
// not (or the reverse), this test goes red. The doc and the number must move
// together or neither is the authority.
// ---------------------------------------------------------------------------

const PLAN_PATH = fileURLToPath(new URL('../docs/realism/BIRD_PLAN.md', import.meta.url));

function phaseZeroSection() {
  const doc = readFileSync(PLAN_PATH, 'utf8');
  const start = doc.indexOf('### Phase 0');
  assert.ok(start >= 0, 'BIRD_PLAN.md has no "### Phase 0" section');
  const end = doc.indexOf('### Phase 1', start);
  assert.ok(end > start, 'BIRD_PLAN.md has no "### Phase 1" section to bound Phase 0');
  return doc.slice(start, end);
}

const numbers = (section, pattern) =>
  [...section.matchAll(pattern)].map((m) => Number(m[1].replace(/,/g, '')));

test('BIRD_BUDGET.maxDrawCalls is the number BIRD_PLAN.md Phase 0 states', () => {
  const stated = numbers(phaseZeroSection(), /≤\s*\**\s*([\d,]+)\s*(?:draw\s+)?calls?/gi);
  assert.ok(stated.length >= 2, `expected the draw-call budget stated in the target AND the gate, found ${stated.length}`);
  for (const n of stated) {
    assert.equal(n, BIRD_BUDGET.maxDrawCalls,
      `BIRD_PLAN.md Phase 0 states ${n} draw calls, BIRD_BUDGET says ${BIRD_BUDGET.maxDrawCalls}`);
  }
});

test('BIRD_BUDGET.maxTriangles is the number BIRD_PLAN.md Phase 0 states', () => {
  const stated = numbers(phaseZeroSection(), /≤\s*\**\s*([\d,]+)\s*(?:triangles|tris)\b/gi);
  assert.ok(stated.length >= 2, `expected the triangle budget stated in the target AND the gate, found ${stated.length}`);
  for (const n of stated) {
    assert.equal(n, BIRD_BUDGET.maxTriangles,
      `BIRD_PLAN.md Phase 0 states ${n} triangles, BIRD_BUDGET says ${BIRD_BUDGET.maxTriangles}`);
  }
});
