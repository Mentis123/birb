// The crow's and the owl's wingtip ANCHOR (tipFeather, which the ribbon trail
// samples with getWorldPosition) must sit on the RENDERED wingtip — the vertex
// the shader bends — not on the hand node's rigid rotation.
//
// Ground truth here is independent of src/flight/species/wing-tip.js: the
// vertex nearest the builders' tip anchor is read from the REAL wing
// BufferGeometry the bird uploads, deformed by a straight transliteration of
// materials.js `realDeform` (every block, the gear spin and the tail too, fed
// the wing material's own uniform objects), and carried to world space by a
// port of three's Matrix4 compose / makeRotationFromEuler / matrixWorld chain
// (node_modules/three is the repo's hand stub, which has no matrixWorld). The
// tracker's tipFeather is carried to world space by the same chain, through
// whatever parent it has. Both wings: leftWing at +Z (the bird's right) and
// rightWing with scale.z = -1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { createSpeciesBird, buildSpeciesSpec, SPECIES_FORM } from '../src/flight/species/species-bird.js';
import {
  createWingTipTracker, findWingTipDef, deformWingPoint, meshToWingGroup, parentToLocal,
} from '../src/flight/species/wing-tip.js';
import { pionusStroke } from '../src/flight/aero-pose.js';

// --- the stub THREE (tests/species-bird.test.js's) ------------------------------
function makeStub() {
  class V3 extends Vector3 { get isVector3() { return true; } }
  class Euler {
    constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; }
    set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this; }
    clone() { return new Euler(this.x, this.y, this.z, this.order); }
  }
  class Object3D {
    constructor() {
      this.name = ''; this.children = []; this.parent = null; this.userData = {}; this.visible = true;
      this.position = new V3();
      this.quaternion = new Quaternion();
      this.rotation = new Euler();
      const s = { x: 1, y: 1, z: 1 };
      s.set = (x, y, z) => { s.x = x; s.y = y; s.z = z; return s; };
      s.setScalar = (k) => s.set(k, k, k);
      this.scale = s;
    }
    add(o) { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); return this; }
    remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
    traverse(fn) { fn(this); for (const c of this.children.slice()) c.traverse(fn); }
    getObjectByName(n) { let hit = null; this.traverse((o) => { if (!hit && o.name === n) hit = o; }); return hit; }
  }
  class Group extends Object3D { get isGroup() { return true; } }
  class Mesh extends Object3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
    get isMesh() { return true; }
  }
  class BufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; this.boundingSphere = null; }
    setAttribute(n, a) { this.attributes[n] = a; return this; }
    getAttribute(n) { return this.attributes[n]; }
    setIndex(i) { this.index = i; return this; }
    computeBoundingSphere() { this.boundingSphere = { radius: 1 }; }
    dispose() {}
  }
  class Material {
    constructor(p) {
      Object.assign(this, p);
      this.userData = {};
      this.envMap = null;
      this.envMapRotation = new Euler();
      const ns = { x: 1, y: 1 };
      ns.set = (a, b) => { ns.x = a; ns.y = b; return ns; };
      this.normalScale = ns;
    }
    dispose() {}
  }
  class MeshPhysicalMaterial extends Material { get isMeshPhysicalMaterial() { return true; } get isMeshStandardMaterial() { return true; } }
  class MeshStandardMaterial extends Material { get isMeshStandardMaterial() { return true; } }
  class MeshPhongMaterial extends Material { get isMeshPhongMaterial() { return true; } constructor(p) { super(p); delete this.normalScale; } }
  class DataTexture {
    constructor(data, width, height, format, type) { this.image = { data, width, height }; this.format = format; this.type = type; }
    dispose() {}
  }
  return {
    Vector3: V3, Quaternion, Matrix4, Euler, Object3D, Group, Mesh, BufferAttribute, BufferGeometry,
    MeshPhysicalMaterial, MeshStandardMaterial, MeshPhongMaterial, DataTexture,
    FrontSide: 0, BackSide: 1, DoubleSide: 2, RepeatWrapping: 'repeat', ClampToEdgeWrapping: 'clamp',
    LinearFilter: 'linear', LinearMipmapLinearFilter: 'mip', RGBAFormat: 'rgba', FloatType: 'float', UnsignedByteType: 'ubyte',
    SRGBColorSpace: 'srgb', NoColorSpace: '',
    Color: class { constructor(h = 0) { this.h = h; } setHex(h) { this.h = h; return this; } },
  };
}

// --- three's matrices, ported (column-major, as three.js stores them) ----------
// Object3D.updateMatrix = Matrix4.compose(position, quaternion(rotation), scale);
// for an 'XYZ' Euler that rotation is makeRotationFromEuler's XYZ branch.
function localMatrix(o) {
  const r = o.rotation;
  assert.equal(r.order || 'XYZ', 'XYZ', `${o.name}: the rig's Eulers are XYZ`);
  const a = Math.cos(r.x), b = Math.sin(r.x), c = Math.cos(r.y), d = Math.sin(r.y), e = Math.cos(r.z), f = Math.sin(r.z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m = new Float64Array(16);
  m[0] = c * e; m[4] = -c * f; m[8] = d;
  m[1] = af + be * d; m[5] = ae - bf * d; m[9] = -b * c;
  m[2] = bf - ae * d; m[6] = be + af * d; m[10] = a * c;
  const s = o.scale;
  for (let i = 0; i < 3; i++) { m[i] *= s.x; m[4 + i] *= s.y; m[8 + i] *= s.z; }
  m[12] = o.position.x; m[13] = o.position.y; m[14] = o.position.z; m[15] = 1;
  return m;
}
function mul(a, b) {
  const o = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + row] * b[col * 4 + k];
      o[col * 4 + row] = v;
    }
  }
  return o;
}
function matrixWorld(o) {
  const l = localMatrix(o);
  return o.parent ? mul(matrixWorld(o.parent), l) : l;
}
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
const worldOf = (node) => apply(matrixWorld(node), [0, 0, 0]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// --- materials.js realDeform, transliterated (position path) --------------------
function cross(k, v) { return [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; }
function realRot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2], x = cross(k, v);
  return [0, 1, 2].map((i) => v[i] * c + x[i] * s + k[i] * kv * (1 - c));
}
function shaderDeform(geo, i, U) {
  const at = (name, n) => { const a = geo.getAttribute(name); return a ? Array.from(a.array.slice(i * n, i * n + n)) : null; };
  const position = at('position', 3);
  const aDef = at('aDef', 4);
  const p = position.slice();
  // #ifdef REAL_MECH (the owl's materials carry the gear uniforms)
  if (U.uGearAngle) {
    const aAxis = at('aAxis', 4), aGear = at('aGear', 4);
    if (aAxis[3] > 0.5) {
      const ang = aAxis[3] > 1.5 ? U.uKeyAngle.value : U.uGearAngle.value * aGear[3];
      const l = Math.hypot(aAxis[0], aAxis[1], aAxis[2]);
      const k = [aAxis[0] / l, aAxis[1] / l, aAxis[2] / l];
      const r = realRot([p[0] - aGear[0], p[1] - aGear[1], p[2] - aGear[2]], k, ang);
      p[0] = aGear[0] + r[0]; p[1] = aGear[1] + r[1]; p[2] = aGear[2] + r[2];
    }
  }
  if (aDef[1] !== 0) {
    const sa = aDef[1] * U.uSplay.value;
    const c = Math.cos(sa), s = Math.sin(sa);
    const dx = p[0] - aDef[2], dz = p[2] - aDef[3];
    p[0] = aDef[2] + dx * c + dz * s;
    p[2] = aDef[3] - dx * s + dz * c;
  }
  {
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const w = clamp01((p[2] - U.uTailZ.value) * U.uTailInv.value);
    const ya = U.uTailYaw.value * w, pa = U.uTailPitch.value * w;
    const ca = Math.cos(ya), sa = Math.sin(ya), cb = Math.cos(pa), sb = Math.sin(pa);
    p[0] *= 1 + (U.uTailFan.value - 1) * w;
    const dz = p[2] - U.uTailZ.value;
    const rx = p[0] * ca + dz * sa;
    const rz = -p[0] * sa + dz * ca;
    p[0] = rx;
    const ry = p[1] * cb - rz * sb;
    const rz2 = p[1] * sb + rz * cb;
    p[1] = ry;
    p[2] = U.uTailZ.value + rz2;
  }
  {
    const uCurl = U.uCurl.value, uWristX = U.uWristX.value;
    const sx = position[0] < 0 ? -1 : 1;
    const ah = uCurl * 0.75 * aDef[0] * sx;
    const ch = Math.cos(ah), sh = Math.sin(ah);
    let px = p[0] - sx * uWristX, py = p[1];
    p[0] = sx * uWristX + px * ch - py * sh;
    p[1] = px * sh + py * ch;
    const t = Math.min(1, Math.max(0, Math.abs(position[0]) / Math.max(uWristX, 1e-3)));
    const aa = uCurl * 0.25 * t * t * sx;
    const ca = Math.cos(aa), sa = Math.sin(aa);
    px = p[0]; py = p[1];
    p[0] = px * ca - py * sa;
    p[1] = px * sa + py * ca;
    const s2 = Math.min(1, Math.max(0, Math.abs(position[0]) * U.uSpanInv.value));
    p[2] += U.uSweep.value * s2 * s2;
  }
  return p;
}

function nearestVertex(geo, tip) {
  const P = geo.getAttribute('position').array;
  let best = -1, bd = Infinity;
  for (let i = 0; i < P.length / 3; i++) {
    const d = Math.hypot(P[i * 3] - tip[0], P[i * 3 + 1] - tip[1], P[i * 3 + 2] - tip[2]);
    if (d < bd) { bd = d; best = i; }
  }
  return { index: best, distance: bd };
}

// --- the bird under a tracker ---------------------------------------------------
const CASES = [['crow', 'high'], ['crow', 'low'], ['owl', 'high'], ['owl', 'low']];

function setup(species, quality, parentAnchor = true) {
  const THREE = makeStub();
  const b = createSpeciesBird(THREE, { species, quality });
  const spec = buildSpeciesSpec(species, quality);
  // Somewhere off the origin, turned, so "world" is not the model frame.
  if (parentAnchor) {
    const anchor = new THREE.Group();
    anchor.position.set(3.2, -1.7, 5.5);
    anchor.rotation.set(0.31, 1.13, -0.42);
    anchor.scale.set(0.52, 0.52, 0.52);
    anchor.add(b.model);
  }
  const wingData = spec.meshes.find((m) => m.role === 'wing').data;
  const found = findWingTipDef(wingData.arrays.position, wingData.arrays.aDef, spec.anchors.wingTip, wingData.arrays.aAxis);
  const tracker = createWingTipTracker({ tip: spec.anchors.wingTip, def: found.def });
  const rig = spec.rig;
  const wristRoot = [0.04, 0, rig.wristX];                      // toRoot([wristX, 0, -0.04])
  const tipRoot = [-spec.anchors.wingTip[2], spec.anchors.wingTip[1], spec.anchors.wingTip[0]];
  const wings = ['leftWing', 'rightWing'].map((name) => {
    const g = b.model.getObjectByName(name);
    const mesh = g.children.find((o) => o.isMesh);
    const hand = g.userData.hand;
    // A group-parented probe (the re-parented form) and the OLD rigid anchor:
    // a child of the hand at (tip - wrist) with y = 0, as species-bird.js
    // built it before this module.
    const probe = new THREE.Object3D();
    g.add(probe);
    const old = new THREE.Object3D();
    old.position.set(tipRoot[0] - wristRoot[0], 0, tipRoot[2] - wristRoot[2]);
    hand.add(old);
    return { g, mesh, hand, tip: g.userData.tipFeather, probe, old, U: mesh.material.userData.realistic.uniforms };
  });
  const v = nearestVertex(wings[0].mesh.geometry, spec.anchors.wingTip);
  const spanWorld = rig.wingSpan * SPECIES_FORM[species].scale * (parentAnchor ? 0.52 : 1);
  return { b, spec, found, tracker, wings, vertex: v.index, vertexDistance: v.distance, spanWorld };
}

/** Pose both wings: `l`/`r` are { rx, ry, rz, span, hx, hy, hs } offsets. */
function pose(ctx, l, r) {
  const [L, R] = ctx.wings;
  const bl = L.g.userData.baseRotation, br = R.g.userData.baseRotation;
  L.g.rotation.set(bl.x + (l.rx || 0), bl.y + (l.ry || 0), bl.z + (l.rz || 0));
  R.g.rotation.set(br.x + (r.rx || 0), br.y + (r.ry || 0), br.z + (r.rz || 0));
  L.g.scale.z = l.span ?? 1;
  R.g.scale.z = -(r.span ?? 1);
  L.hand.rotation.set(l.hx || 0, l.hy || 0, 0);
  R.hand.rotation.set(r.hx || 0, r.hy || 0, 0);
  L.hand.scale.x = l.hs ?? 1;
  R.hand.scale.x = r.hs ?? 1;
  // The rig's featherFlex lands in tipFeather.position.y every frame.
  L.tip.position.y = 0.02; R.tip.position.y = -0.03;
}

/** The rig states the test sweeps, as [label, left, right, splay]. */
function rigStates() {
  const out = [['rest', {}, {}, 0]];
  const s = {};
  for (let k = 0; k < 24; k++) {
    const ph = k / 24;
    pionusStroke(ph, 1, s);
    // The aero rig's mirror rule: wing x opposite-signed, twist and hand same-signed.
    const wing = { rz: s.twist, span: s.span, hx: s.hand, hy: s.handSweep, hs: 1 + 0.08 * Math.sin(ph * 6.283) };
    out.push([`flap ${ph.toFixed(3)}`, { ...wing, rx: s.angle }, { ...wing, rx: -s.angle }, 0]);
  }
  for (const hy of [-1.0, -0.6, -0.25, 0, 0.3, 0.55]) {
    for (const hx of [-0.7, -0.3, 0.2, 0.6]) {
      out.push([`tuck hx ${hx} hy ${hy}`, { ry: -0.45, span: 0.78, hx, hy, hs: 0.85 }, { ry: 0.45, span: 0.78, hx, hy, hs: 0.85 }, 0]);
    }
  }
  out.push(['bank left', { rx: 0.42, rz: 0.1, hx: 0.35, hy: -0.2 }, { rx: 0.18, rz: -0.05, hx: -0.25, hy: 0.15, hs: 1.1 }, 0]);
  out.push(['bank right', { rx: -0.3, hx: -0.45, hy: 0.1, span: 0.9 }, { rx: -0.5, rz: 0.2, hx: 0.5, hy: -0.4 }, 0]);
  for (const splay of [0.3, 0.7, 1]) {
    pionusStroke(0.18, 1, s);
    const wing = { rz: s.twist, span: s.span, hx: s.hand, hy: s.handSweep };
    out.push([`downstroke splay ${splay}`, { ...wing, rx: s.angle }, { ...wing, rx: -s.angle, hx: s.hand * 0.7 }, splay]);
  }
  return out;
}

// ---------------------------------------------------------------------------------

test('the builders\' wing-tip anchor IS a vertex of the wing geometry, on a primary with no gear spin', () => {
  for (const [s, q] of CASES) {
    const ctx = setup(s, q);
    // On the vertex: exactly in the builder's arrays, to float32 rounding in
    // the uploaded Float32Array.
    assert.ok(ctx.found.distance < 1e-12, `${s}/${q}: anchor ${ctx.found.distance} from the nearest MeshData vertex`);
    assert.ok(ctx.vertexDistance < 1e-6, `${s}/${q}: anchor ${ctx.vertexDistance} from the nearest uploaded vertex`);
    assert.equal(ctx.found.def.hand, 1, 'the tip is on the hand (aDef.x = 1)');
    assert.ok(ctx.found.def.splay > 0, 'the outer primary splays');
    assert.ok(!(ctx.found.mech > 0.5), 'no gear spin on the tip vertex');
    // The geometry the bird uploaded carries the same attributes as the spec.
    const D = ctx.wings[0].mesh.geometry.getAttribute('aDef').array;
    const i = ctx.vertex;
    assert.deepEqual([D[i * 4], D[i * 4 + 1], D[i * 4 + 2], D[i * 4 + 3]].map(Math.fround),
      [ctx.found.def.hand, ctx.found.def.splay, ctx.found.def.pivotX, ctx.found.def.pivotZ].map(Math.fround));
    ctx.b.dispose();
  }
});

test('the shader this test transliterates is the one materials.js ships (drift guard)', () => {
  const src = readFileSync(new URL('../src/flight/species/materials.js', import.meta.url), 'utf8');
  for (const line of [
    'float sa = aDef.y * uSplay;',
    'p.x = aDef.z + dx * c + dz * s;',
    'p.z = aDef.w - dx * s + dz * c;',
    'float sx = position.x < 0.0 ? -1.0 : 1.0;',
    'float ah = uCurl * 0.75 * aDef.x * sx;',
    'p.x = sx * uWristX + px * ch - py * sh;',
    'p.y = px * sh + py * ch;',
    'float t = clamp( abs( position.x ) / max( uWristX, 1e-3 ), 0.0, 1.0 );',
    'float aa = uCurl * 0.25 * t * t * sx;',
    'float s2 = clamp( abs( position.x ) * uSpanInv, 0.0, 1.0 );',
    'p.z += uSweep * s2 * s2;',
  ]) assert.ok(src.includes(line), `materials.js still has: ${line}`);
  // The wing mesh's turn into its group, which meshToWingGroup assumes.
  const bird = readFileSync(new URL('../src/flight/species/species-bird.js', import.meta.url), 'utf8');
  assert.ok(bird.includes('if (rotateIn) mesh.rotation.y = -Math.PI / 2;'));
});

test('tipFeather follows the RENDERED wingtip through flap, tuck, bank and splay, on both wings (and the old rigid anchor did not)', () => {
  // Of the wing's world span. The tracker and the transliteration do the same
  // arithmetic on the same float32 inputs; what is left is double rounding
  // through two different transform chains (measured ~1e-15).
  const TOL = 1e-12;
  const report = [];
  for (const [s, q] of CASES) {
    const ctx = setup(s, q);
    let maxErr = 0, maxProbe = 0, maxOld = 0, oldRest = 0, oldFlap = 0, worst = '';
    for (const [label, l, r, splay] of rigStates()) {
      pose(ctx, l, r);
      ctx.b.uniforms.splay.value = splay;
      for (const w of ctx.wings) {
        const truth = apply(matrixWorld(w.mesh), shaderDeform(w.mesh.geometry, ctx.vertex, w.U));
        // The bird's own tipFeather, under the parent species-bird.js gives
        // it (the wing group; the hand form is covered by parentToLocal).
        ctx.tracker.update(w.U, w.tip, w.hand);
        const e = dist(worldOf(w.tip), truth) / ctx.spanWorld;
        if (e > maxErr) maxErr = e;
        // The group-parented form.
        ctx.tracker.update(w.U, w.probe);
        maxProbe = Math.max(maxProbe, dist(worldOf(w.probe), truth) / ctx.spanWorld);
        const eo = dist(worldOf(w.old), truth) / ctx.spanWorld;
        if (eo > maxOld) { maxOld = eo; worst = `${w.g.name} ${label}`; }
        if (label === 'rest') oldRest = Math.max(oldRest, eo);
        if (label.startsWith('flap')) oldFlap = Math.max(oldFlap, eo);
      }
    }
    report.push(`${s}/${q}: tracker ${maxErr.toExponential(2)} of span (group-parented ${maxProbe.toExponential(2)}); `
      + `old rigid anchor ${(oldRest * 100).toFixed(1)}% at rest, ${(oldFlap * 100).toFixed(1)}% worst in the flap, `
      + `${(maxOld * 100).toFixed(1)}% worst overall (${worst})`);
    assert.ok(maxErr < TOL, `${s}/${q}: tracker off the rendered tip by ${maxErr} of the span`);
    assert.ok(maxProbe < TOL, `${s}/${q}: group-parented tracker off by ${maxProbe} of the span`);
    // The bug this replaces: the hand's rigid anchor misses by a lot somewhere.
    assert.ok(maxOld > 0.05, `${s}/${q}: the old anchor's worst miss ${maxOld} (the test would catch it)`);
    ctx.b.dispose();
  }
  console.log(report.join('\n'));
});

test('the bird\'s own motion (crow splay on the downstroke, owl escapement) is tracked too', () => {
  for (const s of ['crow', 'owl']) {
    const ctx = setup(s, 'high');
    let maxErr = 0, sawSplay = false;
    for (let k = 0; k < 40; k++) {
      const ph = k / 40;
      const st = {};
      pionusStroke(ph, 1, st);
      const wing = { rz: st.twist, span: st.span, hx: st.hand, hy: st.handSweep };
      pose(ctx, { ...wing, rx: st.angle }, { ...wing, rx: -st.angle });
      ctx.b.update({ dt: 0.016, aero: { phase01: ph, depth: 1, envelope: 1, air: 1, splay: 0 }, aeroLive: true, perch: 0 });
      if (ctx.b.uniforms.splay.value > 0.5) sawSplay = true;
      for (const w of ctx.wings) {
        // No tracker call here: species-bird.js's own update() placed the
        // tip (overwriting the rig's flex that pose() wrote into position.y).
        assert.equal(w.tip.parent, w.g, 'tipFeather is the wing group\'s child');
        const truth = apply(matrixWorld(w.mesh), shaderDeform(w.mesh.geometry, ctx.vertex, w.U));
        maxErr = Math.max(maxErr, dist(worldOf(w.tip), truth) / ctx.spanWorld);
      }
    }
    if (s === 'crow') assert.ok(sawSplay, 'the crow splayed during the sweep');
    assert.ok(maxErr < 1e-12, `${s}: ${maxErr}`);
    ctx.b.dispose();
  }
});

test('mirror: the right wing is the same geometry under scale.z = -1, so its group-local tip is the left\'s and the world tips mirror', () => {
  for (const s of ['crow', 'owl']) {
    const ctx = setup(s, 'high', false);       // model frame = world, to see the mirror plane
    const [L, R] = ctx.wings;
    const st = {};
    pionusStroke(0.3, 1, st);
    const wing = { rz: st.twist, span: st.span, hx: st.hand, hy: st.handSweep, hs: 0.9 };
    pose(ctx, { ...wing, rx: st.angle, ry: -0.2 }, { ...wing, rx: -st.angle, ry: 0.2 });
    ctx.b.uniforms.splay.value = s === 'crow' ? 0.8 : 0;
    ctx.tracker.update(L.U, L.probe);
    const pl = { ...ctx.tracker.point };
    ctx.tracker.update(R.U, R.probe);
    const pr = { ...ctx.tracker.point };
    assert.deepEqual(pl, pr, 'same group-local point on both wings');
    const wl = worldOf(L.probe), wr = worldOf(R.probe);
    assert.ok(Math.abs(wl[0] - wr[0]) < 1e-12 && Math.abs(wl[1] - wr[1]) < 1e-12 && Math.abs(wl[2] + wr[2]) < 1e-12,
      `${s}: tips mirror about the model's XY plane (${wl.map((v) => v.toFixed(4))} vs ${wr.map((v) => v.toFixed(4))})`);
    assert.ok(wl[2] > 0.5 && wr[2] < -0.5, 'leftWing\'s tip at +Z, rightWing\'s at -Z');
    ctx.b.dispose();
  }
});

test('the pure pieces: rest is the anchor, meshToWingGroup is species-bird\'s toRoot, parentToLocal inverts a TRS in any Euler order', () => {
  const out = { x: 0, y: 0, z: 0 };
  const zero = { curl: 0, sweep: 0, spanInv: 1 / 1.3, wristX: 0.6, splay: 0 };
  deformWingPoint(out, 1.2, -0.03, 0.1, { hand: 1, splay: 0.05, pivotX: 0.8, pivotZ: -0.05 }, zero);
  assert.ok(Math.hypot(out.x - 1.2, out.y + 0.03, out.z - 0.1) < 1e-15, 'no rig, no splay: the rest point');
  meshToWingGroup(out, { x: 1, y: 2, z: 3 });
  assert.deepEqual(out, { x: -3, y: 2, z: 1 });
  const THREE = makeStub();
  for (const order of ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY']) {
    const n = new THREE.Object3D();
    n.position.set(0.3, -0.2, 0.7);
    n.rotation.set(0.4, -0.9, 0.25, order);
    n.scale.set(0.8, 1.2, -1);
    // Forward with an explicit R_A R_B R_C built from axis rotations.
    const rot = (axis, a, v) => {
      const c = Math.cos(a), s = Math.sin(a);
      if (axis === 'X') return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
      if (axis === 'Y') return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
      return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
    };
    const local = [0.11, -0.52, 0.93];
    let v = [local[0] * 0.8, local[1] * 1.2, -local[2]];
    for (let i = 2; i >= 0; i--) v = rot(order[i], n.rotation[order[i].toLowerCase()], v);
    const parent = { x: v[0] + 0.3, y: v[1] - 0.2, z: v[2] + 0.7 };
    parentToLocal(out, parent, n);
    assert.ok(Math.hypot(out.x - local[0], out.y - local[1], out.z - local[2]) < 1e-12, order);
  }
});

// ------------------------------------------------------------ zero allocation

const ALLOC = [/\bnew\s+[A-Z_a-z]/, /=\s*\[/, /[=(,:]\s*\{/, /return\s*\{/, /\.(map|filter|slice|concat|reduce|splice)\(/, /=>/, /\[\s*\.\.\./, /`/];
function bodyOf(src, header) {
  const at = src.indexOf(header);
  assert.ok(at >= 0, `found ${header}`);
  let i = src.indexOf('{', at + header.length - 1);
  let depth = 0; const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start + 1, i);
}

test('the per-frame path allocates nothing (source) and is stable over 10k updates', () => {
  const src = readFileSync(new URL('../src/flight/species/wing-tip.js', import.meta.url), 'utf8');
  for (const header of [
    'function update(uniforms, tipNode, handNode) {',
    'export function deformWingPoint(out, px, py, pz, def, u) {',
    'export function meshToWingGroup(out, p) {',
    'export function parentToLocal(out, p, node) {',
  ]) {
    const code = bodyOf(src, header).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const re of ALLOC) assert.ok(!re.test(code), `${header} matches ${re}`);
  }
  const ctx = setup('crow', 'high');
  const [L] = ctx.wings;
  pose(ctx, { rx: 0.3, hx: 0.4, hy: -0.3, hs: 0.9 }, {});
  ctx.b.uniforms.splay.value = 0.6;
  ctx.tracker.update(L.U, L.tip, L.hand);
  const first = { x: L.tip.position.x, y: L.tip.position.y, z: L.tip.position.z };
  const pos = L.tip.position;
  const point = ctx.tracker.point;
  for (let i = 0; i < 10000; i++) assert.equal(ctx.tracker.update(L.U, L.tip, L.hand), undefined);
  assert.equal(L.tip.position, pos, 'writes into the node\'s own position');
  assert.equal(ctx.tracker.point, point, 'reuses its scratch');
  assert.deepEqual({ x: pos.x, y: pos.y, z: pos.z }, first);
  ctx.b.dispose();
});
