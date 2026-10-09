// A DOM-free stub THREE for the species birds (the same shape as
// tests/species-bird.test.js's), with two additions for the lifecycle tests:
//
// - every geometry, material, mesh, group, node and texture it CONSTRUCTS is
//   counted, and every one disposed is counted, so a test can say "everything
//   made was released" rather than "something was";
// - `failAt` makes the Nth construction of a class throw, so a test can walk a
//   build through every stage at which it could fail.
import { Vector3, Quaternion, Matrix4 } from 'three';

export function makeSpeciesStub({ failAt = {} } = {}) {
  const made = { BufferGeometry: 0, Material: 0, Mesh: 0, Group: 0, Object3D: 0, DataTexture: 0 };
  const live = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const log = { geometries: 0, materials: 0, textures: 0 };
  const fault = (kind) => {
    made[kind] += 1;
    if (failAt[kind] === made[kind]) throw new Error(`injected: ${kind} #${made[kind]}`);
  };
  class V3 extends Vector3 { get isVector3() { return true; } }
  class Euler {
    constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; }
    set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this; }
    clone() { return new Euler(this.x, this.y, this.z, this.order); }
  }
  class Object3D {
    constructor() {
      if (new.target === Object3D) fault('Object3D');
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
  class Group extends Object3D { constructor() { fault('Group'); super(); } get isGroup() { return true; } }
  class Mesh extends Object3D {
    constructor(geometry, material) { fault('Mesh'); super(); this.geometry = geometry; this.material = material; }
    get isMesh() { return true; }
  }
  class BufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  }
  class BufferGeometry {
    constructor() {
      fault('BufferGeometry');
      this.attributes = {}; this.index = null; this.disposed = false; this.boundingSphere = null;
      live.geometries.add(this);
    }
    setAttribute(n, a) { this.attributes[n] = a; return this; }
    getAttribute(n) { return this.attributes[n]; }
    setIndex(i) { this.index = i; return this; }
    computeBoundingSphere() { this.boundingSphere = { radius: 1 }; }
    dispose() { if (!this.disposed) { log.geometries++; live.geometries.delete(this); } this.disposed = true; }
  }
  class Material {
    constructor(p) {
      fault('Material');
      Object.assign(this, p);
      this.userData = {};
      this.envMap = null;
      this.envMapRotation = new Euler();
      const ns = { x: 1, y: 1 };
      ns.set = (a, b) => { ns.x = a; ns.y = b; return ns; };
      this.normalScale = ns;
      this.disposed = false;
      live.materials.add(this);
    }
    dispose() { if (!this.disposed) { log.materials++; live.materials.delete(this); } this.disposed = true; }
  }
  class MeshPhysicalMaterial extends Material { get isMeshPhysicalMaterial() { return true; } get isMeshStandardMaterial() { return true; } }
  class MeshStandardMaterial extends Material { get isMeshStandardMaterial() { return true; } }
  class MeshPhongMaterial extends Material { get isMeshPhongMaterial() { return true; } constructor(p) { super(p); delete this.normalScale; } }
  class DataTexture {
    constructor(data, width, height, format, type) {
      fault('DataTexture');
      this.image = { data, width, height }; this.format = format; this.type = type; this.disposed = false;
      live.textures.add(this);
    }
    dispose() { if (!this.disposed) { log.textures++; live.textures.delete(this); } this.disposed = true; }
  }
  const THREE = {
    Vector3: V3, Quaternion, Matrix4, Euler, Object3D, Group, Mesh, BufferAttribute, BufferGeometry,
    MeshPhysicalMaterial, MeshStandardMaterial, MeshPhongMaterial, DataTexture,
    FrontSide: 0, BackSide: 1, DoubleSide: 2, RepeatWrapping: 'repeat', ClampToEdgeWrapping: 'clamp',
    LinearFilter: 'linear', LinearMipmapLinearFilter: 'mip', RGBAFormat: 'rgba', FloatType: 'float', UnsignedByteType: 'ubyte',
    SRGBColorSpace: 'srgb', NoColorSpace: '',
    Color: class { constructor(h = 0) { this.h = h; } setHex(h) { this.h = h; return this; } },
  };
  return { THREE, log, made, live };
}
