// The bird picker's GPU texture leak, and its fix (bird-shadow.js
// isolateBirdShadowDepth).
//
// Measured on build v85 with the shadows lever on (the default Ultra boot):
// renderer.info textures went 25 -> 27 -> 29 -> 31 over crow -> owl -> Birb
// rounds, one feather_contour_albedo and one 128-px species tile a round, each
// bound by WebGLShadowMap.render -> renderObject -> setTexture2D AFTER its own
// dispose (shots/main-species-final/leak/). three r183 draws every shadow
// caster with ONE shared MeshDepthMaterial and copies the caster's `map` onto
// it; that program is rebuilt only on a version or an instancing change, never
// because `map` changed, and the `map` uniform is written only when the caster
// HAS a map. So a map-less caster (the ground, which VSM draws as a receiver;
// the bird's eyes and feet) binds the last bird map the uniform held — and a
// disposed texture that is bound again is uploaded again, and never deleted.
//
// The renderer below is that path of three r183, line for line where it
// matters (getDepthMaterial, setProgram's program/refresh rules,
// refreshUniformsCommon, the texture-uniform upload, setTexture2D's version
// test, deallocate on dispose), over a fake GL texture registry. The birds are
// the real ones: createSpeciesBird for the crow and owl (their tiles come from
// the real refcounted feather-textures.js), and a v3-shaped Pionus whose
// authored sheets are disposed exactly as commitBird disposes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeSpeciesStub } from './helpers/species-three-stub.js';
import { createSpeciesBird } from '../src/flight/species/species-bird.js';
import { isolateBirdShadowDepth, birdShadowDepthSource } from '../src/effects/bird-shadow.js';

// ------------------------------------------------------------ the fake three

// The species stub plus what this path needs from three: EventDispatcher on
// materials and textures (dispose fires 'dispose', as three's does, every
// call), material ids and versions, and MeshDepthMaterial.
function makeThree() {
  const stub = makeSpeciesStub();
  const { THREE } = stub;
  const Material = Object.getPrototypeOf(THREE.MeshStandardMaterial);
  let nextId = 0;
  for (const C of [Material, THREE.DataTexture]) {
    const proto = C.prototype;
    const dispose = proto.dispose;
    proto.addEventListener = function (type, fn) {
      this._listeners = this._listeners || {};
      const list = (this._listeners[type] = this._listeners[type] || []);
      if (!list.includes(fn)) list.push(fn);
    };
    proto.removeEventListener = function (type, fn) {
      const list = this._listeners && this._listeners[type];
      const i = list ? list.indexOf(fn) : -1;
      if (i >= 0) list.splice(i, 1);
    };
    proto.dispose = function () {
      dispose.call(this);
      for (const fn of ((this._listeners && this._listeners.dispose) || []).slice()) fn({ type: 'dispose', target: this });
    };
  }
  // three: Material.id is a running counter, version starts at 0; a texture
  // with an image has version >= 1 (needsUpdate), which is what lets it upload.
  Object.defineProperty(Material.prototype, 'id', { get() { if (this._id === undefined) this._id = ++nextId; return this._id; } });
  Object.defineProperty(Material.prototype, 'version', { get() { return this._version || 0; }, set(v) { this._version = v; } });
  Object.defineProperty(THREE.DataTexture.prototype, 'version', { get() { return this._version || 1; }, set(v) { this._version = v; } });
  class MeshDepthMaterial extends Material {
    constructor() { super({}); this.name = ''; this.map = null; this.side = 0; }
    get isMeshDepthMaterial() { return true; }
  }
  THREE.MeshDepthMaterial = MeshDepthMaterial;
  class InstancedMesh extends THREE.Mesh { get isInstancedMesh() { return true; } }
  THREE.InstancedMesh = InstancedMesh;
  return stub;
}

// three r183's shadow depth pass over a fake GL texture registry.
function makeShadowRenderer(THREE) {
  const gl = { live: new Map(), made: 0 };         // GL id -> the three texture it was uploaded from
  const textureProperties = new Map();              // WebGLProperties for textures
  const materialProperties = new Map();             // ... and for materials
  const programs = new Map();                       // WebGLPrograms' cache, by key
  const depthMaterial = new THREE.MeshDepthMaterial(); // WebGLShadowMap's _depthMaterial
  const sharedMaps = [];                            // every map the SHARED material was handed
  let currentMaterialId = -1;
  let currentProgram = null;

  // WebGLTextures: dispose deletes the GL texture and forgets the properties.
  function onTextureDispose(event) {
    const texture = event.target;
    texture.removeEventListener('dispose', onTextureDispose);
    const p = textureProperties.get(texture);
    if (p) gl.live.delete(p.glId);
    textureProperties.delete(texture);
  }
  // WebGLTextures.setTexture2D: `version > 0 && __version !== version` uploads.
  // A disposed texture has no properties, so binding it again uploads it again.
  function setTexture2D(texture) {
    if (!texture) return;
    let p = textureProperties.get(texture);
    if (texture.version > 0 && (!p || p.version !== texture.version)) {
      if (!p) {
        p = { glId: ++gl.made, version: 0 };
        textureProperties.set(texture, p);
        gl.live.set(p.glId, texture);
        texture.addEventListener('dispose', onTextureDispose);
      }
      p.version = texture.version;
    }
  }
  function onMaterialDispose(event) {
    event.target.removeEventListener('dispose', onMaterialDispose);
    materialProperties.delete(event.target);
  }
  // WebGLShadowMap.getDepthMaterial (no alpha test, clipping or displacement
  // on any bird material): the custom material if the object has one, else
  // the shared one — and the caster's map is copied onto it either way.
  function getDepthMaterial(object, material) {
    const result = object.customDepthMaterial !== undefined ? object.customDepthMaterial : depthMaterial;
    result.map = material.map;
    if (result === depthMaterial && material.map) sharedMaps.push(material.map);
    return result;
  }
  // WebGLRenderer.setProgram, the part that decides this path.
  function renderBufferDirect(object, material) {
    let props = materialProperties.get(material);
    if (!props) {
      props = { version: -1, program: null, uniforms: { map: { value: null } } };
      materialProperties.set(material, props);
      material.addEventListener('dispose', onMaterialDispose);
    }
    let needsProgramChange = false;
    if (material.version === props.version) {
      // The checks that can fire for a depth material here: instancing.
      // Nothing in the list looks at `map`.
      if (!!object.isInstancedMesh !== props.program.instancing) needsProgramChange = true;
    } else {
      needsProgramChange = true;
      props.version = material.version;
    }
    if (needsProgramChange) {
      // getProgram: the parameters (HAS_MAP among them) read NOW.
      const key = `depth|map=${!!material.map}|inst=${!!object.isInstancedMesh}`;
      if (!programs.has(key)) programs.set(key, { key, map: !!material.map, instancing: !!object.isInstancedMesh });
      props.program = programs.get(key);
    }
    let refreshMaterial = false;
    if (props.program !== currentProgram) { currentProgram = props.program; refreshMaterial = true; } // state.useProgram
    if (material.id !== currentMaterialId) { currentMaterialId = material.id; refreshMaterial = true; }
    if (refreshMaterial) {
      // WebGLMaterials.refreshUniformsCommon: `if ( material.map )` only.
      if (material.map) props.uniforms.map.value = material.map;
      // WebGLUniforms.upload: the sampler is uploaded if the PROGRAM has it.
      if (props.program.map) setTexture2D(props.uniforms.map.value);
    }
  }
  function renderObject(object) {
    if (object.visible === false) return;
    if (object.isMesh && (object.castShadow || object.receiveShadow)) { // VSM draws receivers too
      renderBufferDirect(object, getDepthMaterial(object, object.material));
    }
    for (const child of object.children) renderObject(child);
  }
  return {
    gl, depthMaterial, sharedMaps, programs,
    // One frame's shadow pass. render() resets the material id; the main pass
    // ran other programs since, so the first shadow draw switches program.
    renderShadows(scene) { currentMaterialId = -1; currentProgram = null; renderObject(scene); },
  };
}

// ------------------------------------------------------------------ the world

function makeWorld(THREE) {
  const scene = new THREE.Group();
  // The ground: map-less, a shadow RECEIVER, first in the traversal.
  const ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: null }));
  ground.receiveShadow = true;
  // The nest-host proxy: an instanced map-less caster, drawn before the bird.
  const proxy = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: null }));
  proxy.castShadow = true;
  const anchor = new THREE.Group();
  scene.add(ground); scene.add(proxy); scene.add(anchor);
  return { scene, anchor };
}

// A v3-shaped Pionus: body (contour sheet), wings (vane sheet), eyes and feet
// with no map. The sheets are per-build, as applyAuthoredFeathers loads them,
// and the teardown is commitBird's: the feathers disposer (maps off the
// materials, textures disposed), then every geometry and material.
function makePionus(THREE) {
  const model = new THREE.Group();
  const contour = new THREE.DataTexture(new Uint8Array(4), 512, 512);
  contour.name = 'feather_contour_albedo';
  const vane = new THREE.DataTexture(new Uint8Array(4), 512, 512);
  vane.name = 'feather_vane_albedo';
  const contourMat = new THREE.MeshPhysicalMaterial({ map: contour });
  const vaneMat = new THREE.MeshPhysicalMaterial({ map: vane });
  const eyeMat = new THREE.MeshStandardMaterial({ map: null });
  const footMat = new THREE.MeshStandardMaterial({ map: null });
  const parts = [['birbBody', contourMat], ['birbEyes', eyeMat], ['birbWingArm', vaneMat], ['birbWingHand', vaneMat],
    ['birbWingArm', vaneMat], ['birbWingHand', vaneMat], ['birbTail', vaneMat], ['birbFootMesh', footMat], ['birbFootMesh', footMat]];
  for (const [name, m] of parts) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    mesh.name = name;
    model.add(mesh);
  }
  return {
    model,
    dispose() {
      for (const m of [contourMat, vaneMat]) m.map = null;
      contour.dispose(); vane.dispose();
      model.traverse((o) => { if (!o.isMesh) return; o.geometry.dispose(); o.material.dispose(); });
      if (model.parent) model.parent.remove(model);
    },
  };
}

function makeBird(THREE, id) {
  if (id === 'birb') return makePionus(THREE);
  const sb = createSpeciesBird(THREE, { species: id, quality: 'high' });
  return { model: sb.model, dispose: () => sb.dispose() };
}

// stageBird -> commitBird -> syncSwappedBird, as index.html runs them.
function runPicker(THREE, renderer, world, { isolate, rounds, pattern }) {
  const prepare = (model) => { if (isolate) isolateBirdShadowDepth(THREE, model); };
  const mount = (bird) => {
    for (const c of world.anchor.children.slice()) world.anchor.remove(c);
    world.anchor.add(bird.model);
    bird.model.traverse((o) => { if (o.isMesh) o.castShadow = true; }); // the lever, on
  };
  const frames = (n) => { for (let i = 0; i < n; i++) renderer.renderShadows(world.scene); };
  let current = makeBird(THREE, 'birb');
  prepare(current.model);
  mount(current);
  frames(3);
  const ends = [];
  for (let r = 0; r < rounds; r++) {
    for (const id of pattern) {
      const next = makeBird(THREE, id);
      prepare(next.model);
      mount(next);
      current.dispose();
      current = next;
      frames(3);
    }
    ends.push(renderer.gl.live.size);
  }
  return { ends, current };
}

// ----------------------------------------------------------------- the tests

test('the mechanism: through three\'s SHARED depth material, every picker round re-uploads the outgoing bird\'s disposed maps', () => {
  for (const pattern of [['crow', 'owl', 'birb'], ['crow', 'birb']]) {
    const { THREE } = makeThree();
    const renderer = makeShadowRenderer(THREE);
    const disposed = new Set();
    const DataTexture = THREE.DataTexture.prototype;
    const dispose = DataTexture.dispose;
    DataTexture.dispose = function () { disposed.add(this); return dispose.call(this); };
    const { ends } = runPicker(THREE, renderer, makeWorld(THREE), { isolate: false, rounds: 6, pattern });
    for (let r = 1; r < ends.length; r++) {
      assert.equal(ends[r] - ends[r - 1], 2, `${pattern.join('->')} round ${r}: ${ends}`);
    }
    // Every GL texture still alive at the end that was uploaded from a
    // DISPOSED texture is a leak; each round's are one contour sheet (the
    // last map the uniform held: the wings share the material id, so their
    // vane sheet never refreshes it) and one species tile.
    const leaked = [...renderer.gl.live.values()].filter((t) => disposed.has(t));
    assert.equal(leaked.length, 2 * 6, `${pattern.join('->')}: ${leaked.length} leaked`);
    assert.equal(leaked.filter((t) => t.name === 'feather_contour_albedo').length, 6);
    assert.equal(leaked.filter((t) => !t.name).length, 6, 'one 128-px species tile a round');
  }
});

test('isolateBirdShadowDepth: 10 rounds of crow -> owl -> Birb and of crow <-> Birb leave the GL textures FLAT', () => {
  for (const pattern of [['crow', 'owl', 'birb'], ['crow', 'birb']]) {
    const { THREE, live } = makeThree();
    const renderer = makeShadowRenderer(THREE);
    const disposed = new Set();
    const DataTexture = THREE.DataTexture.prototype;
    const dispose = DataTexture.dispose;
    DataTexture.dispose = function () { disposed.add(this); return dispose.call(this); };
    const { ends, current } = runPicker(THREE, renderer, makeWorld(THREE), { isolate: true, rounds: 10, pattern });
    assert.deepEqual(ends, ends.map(() => ends[0]), `${pattern.join('->')}: ${ends}`);
    assert.equal([...renderer.gl.live.values()].filter((t) => disposed.has(t)).length, 0, 'nothing alive was disposed');
    // The shared depth material never carried a bird's map; only the bird's
    // own depth materials did, and each died with its source material.
    assert.equal(renderer.sharedMaps.length, 0, 'the shared depth material saw no map');
    const depths = [...live.materials].filter((m) => m.isMeshDepthMaterial && m !== renderer.depthMaterial);
    const meshes = []; current.model.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const sources = new Set(meshes.map((o) => o.material));
    assert.equal(depths.length, sources.size, 'one live depth material per live bird material, none left over');
    for (const o of meshes) assert.equal(birdShadowDepthSource(o.customDepthMaterial), o.material);
  }
});

test('isolateBirdShadowDepth: one per source material, shared by its meshes, idempotent, and disposed with that material', () => {
  const { THREE, live } = makeThree();
  const bird = makePionus(THREE);
  const before = live.materials.size;
  assert.equal(isolateBirdShadowDepth(THREE, bird.model), 4, 'contour, vane, eye, foot');
  assert.equal(live.materials.size, before + 4);
  assert.equal(isolateBirdShadowDepth(THREE, bird.model), 0, 'a second prepare makes nothing');
  const wings = [];
  bird.model.traverse((o) => { if (o.isMesh && /Wing|Tail/.test(o.name)) wings.push(o.customDepthMaterial); });
  assert.equal(new Set(wings).size, 1, 'the vane meshes share one depth material');
  assert.ok(wings[0].isMeshDepthMaterial && wings[0].map === null, 'a plain depth material: nothing copied until a draw');
  // three's Material.copy (every material.clone()) and toJSON JSON-serialise
  // userData; the pairing once lived there as a source <-> depth cycle, and
  // cloning any prepared bird material threw.
  bird.model.traverse((o) => {
    if (!o.isMesh) return;
    assert.doesNotThrow(() => JSON.stringify(o.material.userData), 'source userData serialises');
    assert.doesNotThrow(() => JSON.stringify(o.customDepthMaterial.userData), 'depth userData serialises');
    assert.equal(birdShadowDepthSource(o.customDepthMaterial), o.material);
  });
  bird.dispose();
  assert.equal(live.materials.size, 0, 'every bird material AND its depth material released');
  assert.equal(isolateBirdShadowDepth(THREE, null), 0, 'no model, nothing');
});

test('index.html: every bird goes through prepareBirbModel, and it isolates the shadow depth', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(/var \{[^}]*\bisolateBirdShadowDepth\b[^}]*\} = await import\("\.\/src\/effects\/bird-shadow\.js"\)/.test(html), 'imported');
  const start = html.indexOf('const prepareBirbModel = (model, isGLB = false) => {');
  const end = html.indexOf('const mountBirbModel = (model) => {');
  assert.ok(start > 0 && end > start);
  assert.ok(/^\s*isolateBirdShadowDepth\(THREE, model\);/m.test(html.slice(start, end)), 'prepareBirbModel calls it');
  // The ways a bird reaches the anchor: positionBirbModel (prepare + mount)
  // at boot, and commitBird mounting what stageBird prepared.
  const position = html.slice(html.indexOf('const positionBirbModel = '), start);
  assert.ok(/prepareBirbModel\(model, isGLB\);\s*mountBirbModel\(model\);/.test(position));
  const stage = html.slice(html.indexOf('const stageBird = '), html.indexOf('const syncSwappedBird = '));
  assert.equal(stage.split('prepareBirbModel(staged.model)').length - 1, 2, 'the Pionus and the crow/owl branch');
  assert.equal(html.split('mountBirbModel(').length - 1, 2, 'called from positionBirbModel and the bird transaction\'s mount only');
  // commitBird is the transaction's commit, which mounts through this hook
  // (src/flight/species/bird-transaction.js; tests/species-transaction.test.js).
  assert.ok(stage.includes('mount: (model) => mountBirbModel(model),'));
  assert.ok(html.includes('const commitBird = (staged) => birdTransaction.commit(staged);'));
});
