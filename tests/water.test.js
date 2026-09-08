import test from 'node:test';
import assert from 'node:assert/strict';
import { createWater, WATER_LEVELS, WATER_PALETTE } from '../src/environment/water.js';

/**
 * A THREE stand-in with just enough surface for createWater. The repo's
 * node_modules/three is a hand-written stub and the water builder only needs
 * buffer attributes and a mesh, so this stays local and explicit.
 */
function fakeThree() {
  class Float32BufferAttribute {
    constructor(array, itemSize) {
      this.array = Float32Array.from(array);
      this.itemSize = itemSize;
      this.count = this.array.length / itemSize;
    }
    getX(i) { return this.array[i * this.itemSize]; }
    getY(i) { return this.array[i * this.itemSize + 1]; }
    getZ(i) { return this.array[i * this.itemSize + 2]; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; this.disposed = false; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    setIndex(list) { this.index = { array: list, count: list.length }; }
    computeBoundingSphere() { this.boundingSphere = { radius: 1 }; }
    dispose() { this.disposed = true; }
  }
  class Color {
    constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
    copy(o) { this.r = o.r; this.g = o.g; this.b = o.b; return this; }
    clone() { return new Color(this.r, this.g, this.b); }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    normalize() {
      const l = Math.hypot(this.x, this.y, this.z) || 1;
      this.x /= l; this.y /= l; this.z /= l; return this;
    }
  }
  class ShaderMaterial {
    constructor(opts) { Object.assign(this, opts); this.disposed = false; }
    dispose() { this.disposed = true; }
  }
  class Mesh {
    constructor(geometry, material) { this.geometry = geometry; this.material = material; }
  }
  return {
    Float32BufferAttribute, BufferGeometry, Color, Vector3, ShaderMaterial, Mesh,
    FrontSide: 0,
    UniformsLib: { fog: {} },
    UniformsUtils: {
      merge(list) {
        const out = {};
        for (const group of list) {
          for (const [k, v] of Object.entries(group)) {
            out[k] = { value: v && v.clone ? v.clone() : v?.value?.clone?.() ?? v?.value ?? v };
          }
        }
        // The real merge preserves {value} wrappers; mirror that shape.
        for (const group of list) {
          for (const [k, v] of Object.entries(group)) {
            if (v && typeof v === 'object' && 'value' in v) {
              out[k] = { value: v.value && v.value.clone ? v.value.clone() : v.value };
            }
          }
        }
        return out;
      },
    },
  };
}

/**
 * A bowl centred on +X: deep in the middle, rising linearly to zero at the
 * rim. Linear rather than squared on purpose — a squared bowl 30 deep only
 * gets 20 under water within a couple of degrees of its centre, which floods
 * two tenths of a per cent of the sphere and makes "only the flooded part is
 * emitted" indistinguishable from "nothing was emitted".
 */
function bowl(depth = 30, radiusAng = 1.5) {
  return (nx, ny, nz) => {
    const ang = Math.acos(Math.max(-1, Math.min(1, nx)));
    if (ang >= radiusAng) return 0;
    return -depth * (1 - ang / radiusAng);
  };
}

test('a world with no basin below sea level builds no water at all', () => {
  const water = createWater(fakeThree(), {
    level: -20,
    terrainHeightAt: () => 0,
    segmentsU: 40,
    segmentsV: 20,
  });
  // Not an empty mesh: null. An empty geometry is still a draw call, and a
  // biome with no lakes should cost nothing.
  assert.equal(water, null);
});

test('only the flooded part of the sphere becomes geometry', () => {
  const THREE = fakeThree();
  const field = bowl(30);
  const water = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: field, segmentsU: 120, segmentsV: 60,
  });
  assert.ok(water, 'the bowl floods, so there must be a mesh');
  // The bowl's flooded cap is a small fraction of the sphere. If the builder
  // emitted the whole sphere this would be 120*60*2 = 14400 triangles.
  assert.ok(water.triangles < 1400, `emitted the whole sphere: ${water.triangles}`);
  assert.ok(water.triangles > 40, `emitted almost nothing: ${water.triangles}`);
});

test('every vertex sits exactly at sea level', () => {
  const THREE = fakeThree();
  const water = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: bowl(), segmentsU: 80, segmentsV: 40,
  });
  const pos = water.mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    assert.ok(Math.abs(r - 100) < 1e-3, `vertex ${i} is at radius ${r}, not 100`);
  }
});

test('the depth attribute is the water depth and never negative', () => {
  const THREE = fakeThree();
  const field = bowl(30);
  const water = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: field, segmentsU: 120, segmentsV: 60,
  });
  const depth = water.mesh.geometry.attributes.aDepth;
  let deepest = 0;
  for (let i = 0; i < depth.count; i++) {
    assert.ok(depth.array[i] >= 0, `negative depth at ${i}: ${depth.array[i]}`);
    deepest = Math.max(deepest, depth.array[i]);
  }
  // The bowl bottoms out 30 below the baseline and the surface is 20 below,
  // so the deepest water is 10.
  assert.ok(deepest > 8 && deepest <= 10.001, `deepest water is ${deepest}, expected ~10`);
});

test('quads that only partly flood are kept, so the sheet runs under the bank', () => {
  const THREE = fakeThree();
  const water = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: bowl(30), segmentsU: 120, segmentsV: 60,
  });
  const depth = water.mesh.geometry.attributes.aDepth;
  let dry = 0;
  for (let i = 0; i < depth.count; i++) if (depth.array[i] === 0) dry++;
  // Some vertices must be on dry land: that overhang is what lets the depth
  // buffer cut the shoreline instead of a polygon edge doing it.
  assert.ok(dry > 0, 'the sheet stops exactly at the waterline, leaving a seam');
});

test('the flood mask can be driven by a different field from the depth', () => {
  const THREE = fakeThree();
  // A smooth basin says "flood here"; a rough bed says how deep. This split is
  // the whole reason lakes are visible at all — flooding from the rough field
  // finds pits the coarse ground mesh never renders, and the ground then hides
  // its own water.
  const smooth = bowl(30);
  const rough = (nx, ny, nz) => smooth(nx, ny, nz) - 6 * Math.abs(Math.sin(nx * 40));
  const fromSmooth = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: rough, basinHeightAt: smooth,
    segmentsU: 160, segmentsV: 80,
  });
  const fromRough = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: rough,
    segmentsU: 160, segmentsV: 80,
  });
  assert.ok(fromRough.triangles > fromSmooth.triangles,
    'the rough field should flood strictly more cells than the smooth one');
});

test('winding advances in theta before phi, so the sheet faces the sky', () => {
  const THREE = fakeThree();
  const water = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: bowl(), segmentsU: 80, segmentsV: 40,
  });
  const pos = water.mesh.geometry.attributes.position;
  const idx = water.mesh.geometry.index.array;
  const get = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  // Reversed winding makes every lake back-facing, and FrontSide culls the
  // lot — which looks exactly like water that was never built.
  let outward = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = get(idx[t]); const b = get(idx[t + 1]); const c = get(idx[t + 2]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    if (n[0] * a[0] + n[1] * a[1] + n[2] * a[2] > 0) outward++;
  }
  assert.equal(outward * 3, idx.length, 'some triangles face into the planet');
});

test('the sheet is one mesh, one material — one draw call', () => {
  const THREE = fakeThree();
  const water = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: bowl(), segmentsU: 80, segmentsV: 40,
  });
  assert.ok(water.mesh.geometry.index, 'must be indexed');
  assert.equal(water.mesh.name, 'water');
  assert.ok(water.mesh.renderOrder > 0, 'must draw after the opaque terrain');
});

test('every biome has both a sea level and a palette, and every level is negative', () => {
  for (const [biome, level] of Object.entries(WATER_LEVELS)) {
    assert.ok(level < 0,
      `${biome} sea level ${level} is not below the base radius; a positive level would `
      + 'lift the flight floor into the cruise band and ratchet the bird upward');
    assert.ok(WATER_PALETTE[biome], `${biome} has a sea level but no colours`);
  }
});

test('disposing releases the geometry and the material', () => {
  const THREE = fakeThree();
  const water = createWater(THREE, {
    sphereRadius: 120, level: -20, terrainHeightAt: bowl(), segmentsU: 60, segmentsV: 30,
  });
  water.dispose();
  assert.ok(water.mesh.geometry.disposed);
  assert.ok(water.mesh.material.disposed);
});
