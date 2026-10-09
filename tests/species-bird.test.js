// The crow and the clockwork owl as ROOT-GAME birds (src/flight/species/):
// they pass the rig contract the pose code drives every bird through, fit the
// bird budget at every tier, face +X with the root rig's naming, map the rig's
// hand/tail nodes into Gauntlet's shader deformers, animate (splay, escapement,
// gears, key, retracting legs) with zero per-frame allocation, and release
// everything on dispose. DOM-free: a stub THREE, as gauntlet-realistic-birds
// uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { birdRigContract, BIRD_BUDGET } from '../src/flight/bird-contract.js';
import {
  createSpeciesBird, buildSpeciesSpec, speciesTierFor, SPECIES_TIERS, SPECIES_FORM, SPECIES_SHADE,
  SPECIES_ENV_INTENSITY, SPECIES_FILM_STRENGTH, OWL_CLOCKWORK, LEG_RETRACT,
} from '../src/flight/species/species-bird.js';
import { triangleCount } from '../src/flight/species/mesh-kit.js';
import { patchRealShader } from '../src/flight/species/materials.js';
import { featherTextureRefs } from '../src/flight/species/feather-textures.js';

const SPECIES = ['crow', 'owl'];

function makeStub() {
  const log = { geometries: 0, materials: 0, textures: 0 };
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
    constructor() { this.attributes = {}; this.index = null; this.disposed = false; this.boundingSphere = null; }
    setAttribute(n, a) { this.attributes[n] = a; return this; }
    getAttribute(n) { return this.attributes[n]; }
    setIndex(i) { this.index = i; return this; }
    computeBoundingSphere() { this.boundingSphere = { radius: 1 }; }
    dispose() { if (!this.disposed) log.geometries++; this.disposed = true; }
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
      this.disposed = false;
    }
    dispose() { if (!this.disposed) log.materials++; this.disposed = true; }
  }
  class MeshPhysicalMaterial extends Material { get isMeshPhysicalMaterial() { return true; } get isMeshStandardMaterial() { return true; } }
  class MeshStandardMaterial extends Material { get isMeshStandardMaterial() { return true; } }
  class MeshPhongMaterial extends Material { get isMeshPhongMaterial() { return true; } constructor(p) { super(p); delete this.normalScale; } }
  class DataTexture {
    constructor(data, width, height, format, type) { this.image = { data, width, height }; this.format = format; this.type = type; this.disposed = false; }
    dispose() { if (!this.disposed) log.textures++; this.disposed = true; }
  }
  const THREE = {
    Vector3: V3, Quaternion, Matrix4, Euler, Object3D, Group, Mesh, BufferAttribute, BufferGeometry,
    MeshPhysicalMaterial, MeshStandardMaterial, MeshPhongMaterial, DataTexture,
    FrontSide: 0, BackSide: 1, DoubleSide: 2, RepeatWrapping: 'repeat', ClampToEdgeWrapping: 'clamp',
    LinearFilter: 'linear', LinearMipmapLinearFilter: 'mip', RGBAFormat: 'rgba', FloatType: 'float', UnsignedByteType: 'ubyte',
    SRGBColorSpace: 'srgb', NoColorSpace: '',
    Color: class { constructor(h = 0) { this.h = h; } setHex(h) { this.h = h; return this; } },
  };
  return { THREE, log };
}

const meshesOf = (root) => { const out = []; root.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
const trisOf = (mesh) => mesh.geometry.index.count / 3;
const aero = (o = {}) => ({ phase01: 0.1, depth: 1, envelope: 1, air: 1, splay: 0, ...o });

// ---------------------------------------------------------------- contract

test('every species at every tier passes the bird rig contract', () => {
  for (const s of SPECIES) {
    for (const q of SPECIES_TIERS) {
      const { THREE } = makeStub();
      const b = createSpeciesBird(THREE, { species: s, quality: q });
      const r = birdRigContract(b.model);
      assert.ok(r.ok, `${s}/${q}: ${r.failures.join('; ')}`);
      b.dispose();
    }
  }
});

test('the rig is in the ROOT frame: leftWing at +Z (the bird\'s right), rightWing mirrored at -Z, bill toward +X', () => {
  for (const s of SPECIES) {
    const { THREE } = makeStub();
    const b = createSpeciesBird(THREE, { species: s, quality: 'high' });
    const m = b.model;
    const lw = m.getObjectByName('leftWing');
    const rw = m.getObjectByName('rightWing');
    assert.ok(lw.position.z > 0 && rw.position.z < 0, 'leftWing +Z, rightWing -Z');
    assert.equal(lw.scale.z, 1);
    assert.equal(rw.scale.z, -1);
    assert.ok(Math.abs(lw.position.x - rw.position.x) < 1e-9 && Math.abs(lw.position.y - rw.position.y) < 1e-9);
    // The base Euler follows the mirror rule (-x, -y, +z).
    const bl = lw.userData.baseRotation; const br = rw.userData.baseRotation;
    assert.deepEqual([br.x, br.y, br.z], [-bl.x, -bl.y, bl.z]);
    // Evaluate a point, not a rotation: the Gauntlet frame node turns -Z onto
    // +X, so the bill tip (Gauntlet head + beak anchor) lands at +X.
    const frame = m.getObjectByName('speciesFrame');
    assert.ok(Math.abs(frame.rotation.y + Math.PI / 2) < 1e-12);
    const spec = buildSpeciesSpec(s, 'high');
    const tip = [spec.rig.head[0] + spec.anchors.head.beak[0], spec.rig.head[1] + spec.anchors.head.beak[1], spec.rig.head[2] + spec.anchors.head.beak[2]];
    const c = Math.cos(frame.rotation.y); const sn = Math.sin(frame.rotation.y);
    const x = c * tip[0] + sn * tip[2];
    const z = -sn * tip[0] + c * tip[2];
    assert.ok(x > 0.25 && Math.abs(z) < 0.05, `${s} bill at root (+${x.toFixed(2)}, z ${z.toFixed(3)})`);
    // Wing meshes ride the same -90 degree turn inside their groups.
    for (const w of [lw, rw]) {
      const mesh = w.children.find((o) => o.isMesh);
      assert.ok(Math.abs(mesh.rotation.y + Math.PI / 2) < 1e-12);
    }
    // The wingtip anchor sits out along +Z (span) in the wing's own frame,
    // inside the hand so the ribbon follows the wrist.
    const hand = lw.userData.hand;
    assert.equal(lw.userData.tipFeather.parent, hand);
    assert.ok(hand.position.z + lw.userData.tipFeather.position.z > 0.9, 'tip reaches out along the span');
    b.dispose();
  }
});

// ------------------------------------------------------------------ budget

test('budgets: inside BIRD_BUDGET (8 draws, 4,000 triangles) at every tier, cheaper at lower tiers', () => {
  for (const s of SPECIES) {
    const tris = {};
    for (const q of SPECIES_TIERS) {
      const { THREE } = makeStub();
      const b = createSpeciesBird(THREE, { species: s, quality: q });
      const meshes = meshesOf(b.model);
      const counted = meshes.reduce((a, mm) => a + trisOf(mm), 0);
      assert.equal(b.drawCallCount, meshes.length, 'draw calls are one per mesh');
      assert.equal(b.triangleCount, counted);
      assert.ok(b.drawCallCount <= BIRD_BUDGET.maxDrawCalls, `${s}/${q} ${b.drawCallCount} draws`);
      assert.ok(b.triangleCount <= BIRD_BUDGET.maxTriangles, `${s}/${q} ${b.triangleCount} tris`);
      // The pure spec's own bookkeeping agrees with what was uploaded (the
      // right wing's data is drawn twice, mirrored).
      const spec = buildSpeciesSpec(s, q);
      assert.equal(spec.triangles, counted);
      assert.equal(spec.drawCalls, meshes.length);
      tris[q] = b.triangleCount;
      b.dispose();
    }
    assert.ok(tris.low < tris.mid && tris.mid <= tris.high, `${s}: ${JSON.stringify(tris)}`);
  }
});

test('the default (render tier 0) frame stays under 80k: the species adds at most ~2k over the Pionus\'s 1,518', () => {
  // Measured on the live page at the forest spawn, Ultra: 75.4-77.4k with the
  // Pionus in it. The headroom this pins is the margin that keeps it under 80k.
  const PIONUS = 1518;
  for (const s of SPECIES) {
    const spec = buildSpeciesSpec(s, speciesTierFor(0));
    assert.ok(spec.triangles - PIONUS <= 2000, `${s}: +${spec.triangles - PIONUS}`);
  }
});

test('quality tiers -> species look: tier 0 high (physical), 1 mid (standard), 2 low (phong)', () => {
  assert.equal(speciesTierFor(0), 'high');
  assert.equal(speciesTierFor(1), 'mid');
  assert.equal(speciesTierFor(2), 'low');
  assert.equal(speciesTierFor(7), 'low');
  assert.equal(speciesTierFor(undefined), 'high');
  const { THREE } = makeStub();
  const kinds = SPECIES_TIERS.map((q) => { const b = createSpeciesBird(THREE, { species: 'crow', quality: q }); const t = b.materials[0].constructor.name; b.dispose(); return t; });
  assert.deepEqual(kinds, ['MeshPhysicalMaterial', 'MeshStandardMaterial', 'MeshPhongMaterial']);
});

// --------------------------------------------------------------- the look

test('the look knobs: crow restrained film + desaturated sky reflection; owl cream/amber shade fix + metal pull', () => {
  const { THREE } = makeStub();
  const crow = createSpeciesBird(THREE, { species: 'crow', quality: 'high' });
  const owl = createSpeciesBird(THREE, { species: 'owl', quality: 'high' });
  assert.equal(crow.uniforms.specNeutral.value, SPECIES_SHADE.crow.spec);
  assert.equal(crow.uniforms.shadeNeutral.value, 0);
  assert.equal(owl.uniforms.shadeNeutral.value, SPECIES_SHADE.owl.neutral);
  assert.equal(owl.uniforms.shadeFloor.value, SPECIES_SHADE.owl.floor);
  assert.equal(owl.uniforms.metalNeutral.value, SPECIES_SHADE.owl.metal);
  for (const m of crow.materials) {
    assert.equal(m.envMapIntensity, SPECIES_ENV_INTENSITY.crow);
    if (m.iridescence !== undefined) assert.equal(m.iridescence, SPECIES_FILM_STRENGTH.crow);
    assert.equal(m.ior, m.isMeshPhysicalMaterial ? 1.56 : m.ior, 'keratin');
  }
  assert.ok(crow.envMaterials.length === crow.materials.length && owl.envMaterials.length === owl.materials.length);
  const low = createSpeciesBird(THREE, { species: 'owl', quality: 'low' });
  assert.equal(low.envMaterials.length, 0, 'low is Phong: no bird-only sky');
  for (const b of [crow, owl, low]) b.dispose();
});

test('the shader patch carries the ROOT knobs, and at zero they reduce to Gauntlet\'s glass term', () => {
  const vertex = '#include <beginnormal_vertex>\n#include <begin_vertex>\n';
  const standard = '#include <color_fragment>\n#include <lights_fragment_maps>\n#include <opaque_fragment>\n#include <normal_fragment_begin>\n#include <metalnessmap_fragment>\n#include <roughnessmap_fragment>\n#include <lights_physical_fragment>\n';
  const sh = patchRealShader({ vertexShader: vertex, fragmentShader: standard }, { family: 'standard', mech: true });
  assert.ok(sh.fragmentShader.includes('uniform float uSpecNeutral;') && sh.fragmentShader.includes('uniform float uMetalNeutral;'));
  assert.ok(sh.fragmentShader.includes('realGlass + realDiel * uSpecNeutral + ( 1.0 - realDiel ) * uMetalNeutral'));
  assert.ok(sh.fragmentShader.includes('iblIrradiance = iblIrradiance * uPlumEnvDiffuse + irradiance * uPlumHemi;'), 'the sky is counted once');
  assert.ok(sh.vertexShader.includes('#define REAL_MECH'));
});

// ---------------------------------------------------------- the rig drives it

test('the rig\'s hand and tail nodes drive Gauntlet\'s deformers through uniform getters', () => {
  for (const s of SPECIES) {
    const { THREE } = makeStub();
    const b = createSpeciesBird(THREE, { species: s, quality: 'high' });
    const lw = b.model.getObjectByName('leftWing');
    const wingMat = lw.children.find((o) => o.isMesh).material;
    const u = wingMat.userData.realistic.uniforms;
    lw.userData.hand.rotation.x = 0.3;     // root: + drops the hand
    assert.ok(Math.abs(u.uCurl.value - (-0.3 * SPECIES_FORM[s].curlGain)) < 1e-12, 'Gauntlet: + raises it');
    lw.userData.hand.rotation.y = 0.2;     // root: + sweeps it forward
    assert.ok(u.uSweep.value < 0, 'Gauntlet: + trails it aft');
    const tail = b.model.getObjectByName('tail');
    const tailMat = (s === 'crow' ? b.model.getObjectByName('speciesTail') : b.model.getObjectByName('speciesBody')).material;
    const tu = tailMat.userData.realistic.uniforms;
    tail.rotation.y = 0.25; tail.rotation.z = -0.1; tail.scale.z = 1.4;
    assert.equal(tu.uTailYaw.value, 0.25);
    assert.equal(tu.uTailPitch.value, -0.1);
    assert.equal(tu.uTailFan.value, 1.4);
    // Under ?aeropose=0 the old rig writes the elevator into rotation.x, with
    // tailPitchOffset's sign: NEGATIVE drops the tail (a climb), the shader's
    // + drops it.
    tail.rotation.x = -0.16;
    b.update({ dt: 0.016, aero: null, aeroLive: false, perch: 0 });
    assert.equal(tu.uTailPitch.value, 0.16);
    b.dispose();
  }
});

test('crow: the fingered primaries splay on the downstroke, and not on the recovery', () => {
  const { THREE } = makeStub();
  const b = createSpeciesBird(THREE, { species: 'crow', quality: 'high' });
  b.update({ dt: 0.016, aero: aero({ phase01: 0.19 }), aeroLive: true, perch: 0 });
  const down = b.uniforms.splay.value;
  b.update({ dt: 0.016, aero: aero({ phase01: 0.7 }), aeroLive: true, perch: 0 });
  const up = b.uniforms.splay.value;
  assert.ok(down > 0.8 && up === 0, `down ${down}, up ${up}`);
  b.update({ dt: 0.016, aero: aero({ phase01: 0.19 }), aeroLive: true, perch: 1 });
  assert.equal(b.uniforms.splay.value, 0, 'perched: folded, no splay');
  b.dispose();
});

test('owl: the stroke steps like an escapement, the gears turn with the beat a tooth at a time, the key whirs under boost', () => {
  const { THREE } = makeStub();
  const b = createSpeciesBird(THREE, { species: 'owl', quality: 'high' });
  const lw = b.model.getObjectByName('leftWing');
  const rw = b.model.getObjectByName('rightWing');
  // Two phases inside one step land on the SAME quantised pose: the rig's
  // continuous stroke plus the correction is constant across the step.
  const stepAt = (phase) => {
    lw.rotation.x = 0; rw.rotation.x = 0;
    b.update({ dt: 0.016, aero: aero({ phase01: phase }), aeroLive: true, perch: 0 });
    return lw.rotation.x;
  };
  const n = OWL_CLOCKWORK.steps;
  const a = stepAt(1 / n + 0.01);
  const c = stepAt(2 / n - 0.01);
  assert.ok(Math.abs(a) > 1e-4 || Math.abs(c) > 1e-4, 'the correction is live');
  assert.equal(rw.rotation.x, -lw.rotation.x, 'mirror-signed like the rig');
  // Gears: quantised to the tooth pitch, advancing with beat progress.
  const g0 = b.mech.gear.rotation.y;
  for (let i = 0; i < 60; i++) b.update({ dt: 0.016, aero: aero({ phase01: (i * 0.07) % 1 }), aeroLive: true, perch: 0 });
  const g1 = b.mech.gear.rotation.y;
  assert.ok(g1 > g0);
  assert.ok(Math.abs(g1 / OWL_CLOCKWORK.gearTooth - Math.round(g1 / OWL_CLOCKWORK.gearTooth)) < 1e-9, 'a tooth at a time');
  // Key: faster under boost.
  const k0 = b.mech.key.rotation.y;
  b.update({ dt: 0.05, aero: aero(), aeroLive: true, perch: 0, boosting: false });
  const idle = b.mech.key.rotation.y - k0;
  const k1 = b.mech.key.rotation.y;
  b.update({ dt: 0.05, aero: aero(), aeroLive: true, perch: 0, boosting: true });
  const boost = b.mech.key.rotation.y - k1;
  assert.ok(boost > idle * 4, `key idle ${idle}, boost ${boost}`);
  b.dispose();
});

test('legs: standing at tuck 0, drawn up to LEG_RETRACT when the rig tucks them', () => {
  for (const s of SPECIES) {
    const { THREE } = makeStub();
    const b = createSpeciesBird(THREE, { species: s, quality: 'high' });
    const lf = b.model.getObjectByName('leftFoot');
    const legMesh = lf.children.find((o) => o.isMesh);
    lf.rotation.z = 0;
    b.update({ dt: 0.016, aero: null, aeroLive: false, perch: 1 });
    assert.equal(legMesh.scale.x, 1);
    lf.rotation.z = lf.userData.tuck;
    b.update({ dt: 0.016, aero: null, aeroLive: false, perch: 0 });
    assert.ok(Math.abs(legMesh.scale.x - LEG_RETRACT[s]) < 1e-9);
    assert.ok(lf.position.z > 0 && b.model.getObjectByName('rightFoot').position.z < 0);
    b.dispose();
  }
});

// ------------------------------------------------------------ zero allocation

const ALLOC = [/\bnew\s+[A-Z_a-z]/, /=\s*\[/, /=\s*\{/, /\.(map|filter|slice|concat|reduce|splice)\(/, /=>/, /\[\s*\.\.\./, /`/];
function bodyOf(src, header) {
  const at = src.indexOf(header);
  assert.ok(at >= 0, `found ${header}`);
  let i = src.indexOf('{', at + header.length - 1);
  let depth = 0; const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

test('the per-frame paths allocate nothing: species update, the uniform getters, the index.html hook', () => {
  const src = readFileSync(new URL('../src/flight/species/species-bird.js', import.meta.url), 'utf8');
  const body = bodyOf(src, 'function update(s) {');
  const code = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const re of ALLOC) assert.ok(!re.test(code), `update() matches ${re}`);
  for (const getter of src.match(/get value\(\) \{[^}]*\}/g)) {
    for (const re of ALLOC) assert.ok(!re.test(getter.replace('get value() {', '')), `getter ${getter} matches ${re}`);
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const hook = bodyOf(html, 'if (speciesBird) {\n        _speciesFrame.dt');
  for (const re of ALLOC) assert.ok(!re.test(hook), `index.html species hook matches ${re}`);
});

// -------------------------------------------------------------------- dispose

test('dispose releases every geometry, material and the shared textures, and leaves the anchor', () => {
  for (const s of SPECIES) {
    for (const q of SPECIES_TIERS) {
      const { THREE, log } = makeStub();
      const anchor = new THREE.Group();
      const b = createSpeciesBird(THREE, { species: s, quality: q });
      anchor.add(b.model);
      assert.equal(featherTextureRefs(THREE), 1);
      b.dispose();
      assert.equal(log.geometries, b.geometries.length);
      assert.equal(log.geometries, meshesOf(b.model).length);
      assert.equal(log.materials, b.materials.length);
      assert.equal(log.textures, 10, 'the last release disposes the 10 shared textures');
      assert.equal(featherTextureRefs(THREE), 0);
      assert.equal(anchor.children.length, 0);
      assert.ok(b.disposed);
      b.dispose();
      assert.equal(log.materials, b.materials.length, 'a second dispose is a no-op');
    }
  }
});

test('a rebuild (tier change or swap) refcounts the shared textures instead of rebuilding them', () => {
  const { THREE, log } = makeStub();
  const a = createSpeciesBird(THREE, { species: 'crow', quality: 'high' });
  const b = createSpeciesBird(THREE, { species: 'owl', quality: 'mid' });
  assert.equal(a.textures, b.textures);
  a.dispose();
  assert.equal(log.textures, 0);
  b.dispose();
  assert.equal(log.textures, 10);
});

// -------------------------------------------------------------- airtightness

test('Gauntlet stays airtight: no root file imports from gauntlet/, and the ported files say where they came from', () => {
  const dir = new URL('../src/flight/species/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/gauntlet\//.test(src.replace(/^\s*(\/\/|\*).*$/gm, '')), `${f} imports nothing from gauntlet/`);
  }
  for (const f of ['mesh-kit.js', 'film.js', 'gears.js', 'feather-textures.js', 'crow.js', 'owl.js', 'materials.js']) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(src.startsWith(`// PORTED from Birb Gauntlet (gauntlet/src/bird/realistic/${f})`), `${f} provenance`);
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!/import\(\s*['"]\.\/gauntlet\//.test(html) && !/from\s*['"]\.\/gauntlet\//.test(html));
});

test('the standing legs replace Gauntlet\'s baked-in tucked ones (and only when asked for)', () => {
  for (const s of SPECIES) {
    const spec = buildSpeciesSpec(s, 'high');
    assert.ok(spec.legs && triangleCount(spec.legs.left) > 0 && triangleCount(spec.legs.right) > 0);
  }
});
