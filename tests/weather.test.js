import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeather, WEATHER_PROFILES } from '../src/environment/weather.js';

function fakeThree() {
  class Float32BufferAttribute {
    constructor(array, itemSize) {
      this.array = array instanceof Float32Array ? array : Float32Array.from(array);
      this.itemSize = itemSize;
      this.count = this.array.length / itemSize;
    }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.disposed = false; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    dispose() { this.disposed = true; }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
    normalize() {
      const l = Math.hypot(this.x, this.y, this.z) || 1;
      this.x /= l; this.y /= l; this.z /= l; return this;
    }
    crossVectors(a, b) {
      const x = a.y * b.z - a.z * b.y;
      const y = a.z * b.x - a.x * b.z;
      const z = a.x * b.y - a.y * b.x;
      this.x = x; this.y = y; this.z = z; return this;
    }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
  }
  class Sphere { constructor(c, r) { this.center = c; this.radius = r; } }
  class Color { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } }
  class ShaderMaterial {
    constructor(opts) { Object.assign(this, opts); this.disposed = false; }
    dispose() { this.disposed = true; }
  }
  class Points {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material; this.visible = true;
    }
  }
  return { Float32BufferAttribute, BufferGeometry, Vector3, Sphere, Color, ShaderMaterial, Points };
}

function build(overrides = {}) {
  return createWeather(fakeThree(), { profile: WEATHER_PROFILES.mountain, ...overrides });
}

test('every biome has a complete weather profile', () => {
  for (const [biome, p] of Object.entries(WEATHER_PROFILES)) {
    for (const key of ['count', 'color', 'size', 'fall', 'drift', 'sway', 'box', 'opacity']) {
      assert.ok(p[key] !== undefined, `${biome} is missing ${key}`);
    }
    assert.equal(p.color.length, 3, `${biome} colour must be rgb`);
    assert.equal(p.box.length, 3, `${biome} box must be a volume`);
    assert.ok(p.count > 0 && p.fall > 0, `${biome} weather does not move or exist`);
  }
});

test('the four biomes have genuinely different air, not one effect recoloured', () => {
  const { forest, canyons, mountain, city } = WEATHER_PROFILES;
  // Rain falls far faster than pollen hangs; dust blows sideways faster than
  // it falls. If these ever converge the weather stops saying where you are.
  assert.ok(city.fall > mountain.fall * 3, 'drizzle must fall much faster than snow');
  assert.ok(forest.fall < mountain.fall, 'pollen must hang relative to snow');
  assert.ok(canyons.drift > canyons.fall, 'canyon dust must blow sideways, not down');
  assert.ok(city.stretch > mountain.stretch, 'rain must streak more than snow does');
});

test('the shader source has no backtick in it', () => {
  // The whole shader is a JS template literal. A backtick inside a GLSL
  // comment ends the string and takes the module out with it — which is a
  // parse error at import time, not a render bug, so nothing draws at all.
  const src = build().points.material;
  for (const key of ['vertexShader', 'fragmentShader']) {
    assert.ok(!src[key].includes('`'), `${key} contains a backtick`);
  }
});

test('the shader avoids GLSL ES reserved words', () => {
  const m = build().points.material;
  const src = `${m.vertexShader}\n${m.fragmentShader}`;
  // `half` is the one that bit: reserved in GLSL ES 1.00, so the shader fails
  // to compile and Three silently draws nothing for the material.
  for (const word of ['half', 'fixed', 'input', 'output', 'flat', 'long', 'short', 'double']) {
    const declared = new RegExp(`\\b(vec[234]|float|int|bool)\\s+${word}\\b`);
    assert.ok(!declared.test(src), `declares a variable named "${word}", a reserved word`);
  }
});

test('one particle per seed, four seed components each', () => {
  const w = build({ count: 250 });
  assert.equal(w.count, 250);
  assert.equal(w.points.geometry.attributes.aSeed.count, 250);
  assert.equal(w.points.geometry.attributes.position.count, 250);
});

test('seeds stay inside the unit cube so the box scaling is the only extent', () => {
  const seeds = build({ count: 500 }).points.geometry.attributes.aSeed.array;
  for (let i = 0; i < seeds.length; i++) {
    assert.ok(seeds[i] >= 0 && seeds[i] < 1, `seed ${i} out of range: ${seeds[i]}`);
  }
});

test('density zero hides the field rather than drawing invisible points', () => {
  const w = build();
  w.setDensity(0);
  assert.equal(w.points.visible, false);
  w.setDensity(1);
  assert.equal(w.points.visible, true);
  assert.equal(w.points.material.uniforms.uOpacity.value, WEATHER_PROFILES.mountain.opacity);
});

test('density is clamped, so a tier calculation cannot over-drive the opacity', () => {
  const w = build();
  w.setDensity(4);
  assert.equal(w.points.material.uniforms.uOpacity.value, WEATHER_PROFILES.mountain.opacity);
  w.setDensity(-1);
  assert.equal(w.points.material.uniforms.uOpacity.value, 0);
});

test('update builds an orthonormal frame from the local up, even over a pole', () => {
  const THREE = fakeThree();
  const w = createWeather(THREE, { profile: WEATHER_PROFILES.mountain, count: 8 });
  for (const up of [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0.6, y: 0.2, z: -0.77 }]) {
    w.update(1, { x: 10, y: 20, z: 30 }, up);
    const { uUp, uSide, uFwd } = w.points.material.uniforms;
    // A degenerate basis at the poles is how "snow falls sideways" bugs start.
    for (const v of [uUp.value, uSide.value, uFwd.value]) {
      assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-5, 'basis vector is not unit length');
    }
    assert.ok(Math.abs(uUp.value.dot(uSide.value)) < 1e-5, 'up and side are not perpendicular');
    assert.ok(Math.abs(uUp.value.dot(uFwd.value)) < 1e-5, 'up and forward are not perpendicular');
    assert.ok(Math.abs(uSide.value.dot(uFwd.value)) < 1e-5, 'side and forward are not perpendicular');
  }
});

test('the material tests depth but does not write it', () => {
  const m = build().points.material;
  // Depth test so a flake behind a mountain is behind it; no depth write so
  // flakes do not punch hard-edged holes in each other.
  assert.equal(m.depthTest, true);
  assert.equal(m.depthWrite, false);
  assert.equal(m.transparent, true);
});

test('disposing releases the geometry and the material', () => {
  const w = build();
  w.dispose();
  assert.ok(w.points.geometry.disposed);
  assert.ok(w.points.material.disposed);
});
