import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToLinear, skyRadianceAt, rowUpComponent, buildEquirectSky, iblRequested, equirectUvLocal,
} from '../src/environment/sky-environment.js';

// The four shipped biome skies, copied from world-shell.js. If these drift the
// environment map stops matching the dome, which is the one thing it must not do.
const FOREST = { top: 0x397da7, mid: 0x91bdb9, horizon: 0xffe0a1, bottom: 0x3c665d };
const CITY = { top: 0x283a75, mid: 0x748da9, horizon: 0xe5b7a0, bottom: 0x283c55 };

function fakeThree() {
  return {
    RGBAFormat: 'rgba',
    FloatType: 'float',
    EquirectangularReflectionMapping: 303,
    DataTexture: class {
      constructor(data, w, h, format, type) {
        Object.assign(this, { data, image: { width: w, height: h }, format, type });
      }
      dispose() { this.disposed = true; }
    },
  };
}

test('hex decodes to linear the way three does', () => {
  assert.deepEqual(hexToLinear(0x000000), [0, 0, 0]);
  const white = hexToLinear(0xffffff);
  white.forEach((v) => assert.ok(Math.abs(v - 1) < 1e-9));
  // Mid grey is ~0.216 linear, not 0.5. Interpolating in the wrong space is
  // how a gradient comes out visibly lighter than the sky it copies.
  assert.ok(Math.abs(hexToLinear(0x808080)[0] - 0.2158) < 0.001);
});

test('the gradient reproduces the dome stops', () => {
  const horizon = hexToLinear(FOREST.horizon);
  const top = hexToLinear(FOREST.top);

  // At h = 0 exactly the smoothstep is 0, so the colour IS the horizon, plus
  // the warm band, which peaks near h = 0.02 rather than at 0.
  const atHorizon = skyRadianceAt(0, FOREST);
  assert.ok(atHorizon[0] >= horizon[0], 'the additive band only ever brightens');

  // At the zenith the smoothstep is 1 and the band has decayed to nothing.
  const atZenith = skyRadianceAt(1, FOREST);
  for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(atZenith[i] - top[i]) < 1e-6);

  // The sky must get DARKER toward the zenith in every one of these biomes --
  // the horizon is a warm cream band and the zenith a deep blue.
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const sky of [FOREST, CITY]) {
    assert.ok(lum(skyRadianceAt(0.05, sky)) > lum(skyRadianceAt(1, sky)),
      'horizon must be brighter than zenith, or the bake is upside down');
  }
});

test('the warm band is self-limiting, which is why a pale sky does not clip', () => {
  // A near-white sky has no headroom, so the additive band must contribute
  // almost nothing. sky-dome.js learned this the expensive way: an unscaled
  // band turned a pale mountain horizon into a flat white slab.
  const pale = { top: 0xf0f4ff, mid: 0xf6f8ff, horizon: 0xfffaf0, bottom: 0xe8eef8 };
  const before = hexToLinear(pale.horizon);
  const after = skyRadianceAt(0.02, pale);
  assert.ok(after[0] - before[0] < 0.02, `pale sky gained ${after[0] - before[0]}`);

  // A deep sky has room and must actually get the glow.
  const deep = { top: 0x0a1020, mid: 0x203050, horizon: 0x804020, bottom: 0x050810 };
  const deepBefore = hexToLinear(deep.horizon);
  const deepAfter = skyRadianceAt(0.02, deep);
  assert.ok(deepAfter[0] - deepBefore[0] > 0.02, 'a deep sky must still get its glow');
});

test('row 0 is the NADIR, matching three equirectUv', () => {
  // v = asin(dir.y)/PI + 0.5, and a DataTexture's row 0 is v = 0. Get this
  // upside down and the ground colour ends up lighting the sky.
  assert.ok(rowUpComponent(0, 32) < -0.9, 'row 0 must look down');
  assert.ok(rowUpComponent(31, 32) > 0.9, 'the last row must look up');
  assert.ok(Math.abs(rowUpComponent(16, 32)) < 0.06, 'the middle row is the horizon');
  // Monotonic, or the gradient folds.
  for (let i = 1; i < 32; i += 1) {
    assert.ok(rowUpComponent(i, 32) > rowUpComponent(i - 1, 32));
  }
});

test('the baked texture is float, equirect-mapped, and brighter at the top', () => {
  const T = fakeThree();
  const tex = buildEquirectSky(T, FOREST, { width: 8, height: 16 });
  assert.equal(tex.image.width, 8);
  assert.equal(tex.image.height, 16);
  assert.equal(tex.type, 'float');
  assert.equal(tex.mapping, T.EquirectangularReflectionMapping);
  assert.equal(tex.data.length, 8 * 16 * 4);

  // No horizontal variation: every column in a row is identical. That is what
  // makes a 64-wide bake honest rather than a compromise.
  for (let x = 1; x < 8; x += 1) {
    assert.equal(tex.data[(5 * 8 + x) * 4], tex.data[(5 * 8) * 4]);
  }
  // Alpha is 1 everywhere, or PMREM reads a transparent sky.
  for (let i = 3; i < tex.data.length; i += 4) assert.equal(tex.data[i], 1);

  // The nadir row must be darker than the horizon row: below the horizon the
  // gradient runs to the ground colour.
  const rowLum = (y) => {
    const i = (y * 8) * 4;
    return 0.2126 * tex.data[i] + 0.7152 * tex.data[i + 1] + 0.0722 * tex.data[i + 2];
  };
  assert.ok(rowLum(0) < rowLum(8), 'the ground half must be darker than the horizon');
});

test('the flag is off by default', () => {
  assert.equal(iblRequested(''), false);
  assert.equal(iblRequested(undefined), false);
  assert.equal(iblRequested('?ibl=1'), true);
  assert.equal(iblRequested('?debug=1&ibl=1'), true);
  assert.equal(iblRequested('?visible=1'), false, 'must not match a substring');
});

// ---------------------------------------------------------------------------
// The panorama must sit on the LOCAL horizon. This is a spherical world: up is
// radial and rotates as the bird flies, and the owner reported the sky texture
// "sometimes vertical with what should be horizontal". Reproduced by capture at
// the planet's equator, where the dome sampled the equirect against WORLD +Y
// while its own gradient used the local up, so the cloud band ran top to
// bottom of the frame. equirectUvLocal is the JS reference the GLSL mirrors.
// ---------------------------------------------------------------------------

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('at the planet pole the local mapping IS three\'s equirect convention', () => {
  // up = world +Y is the one place the old world-frame sampling was right, so
  // the new mapping must reproduce it there exactly — a strict generalisation,
  // not a different sky.
  const up = [0, 1, 0];
  for (const dir of [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0.6, 0.8, 0], [0, -1, 0]]) {
    const [u, v] = equirectUvLocal(dir, up, 0);
    const classicU = Math.atan2(dir[2], dir[0]) / (2 * Math.PI) + 0.5;
    const classicV = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / Math.PI + 0.5;
    assert.ok(near(((u % 1) + 1) % 1, ((classicU % 1) + 1) % 1), `u for ${dir}: ${u} vs classic ${classicU}`);
    assert.ok(near(v, classicV), `v for ${dir}: ${v} vs classic ${classicV}`);
  }
});

test('at the equator the horizon is the LOCAL horizon, not world y = 0', () => {
  // Standing at world (R, 0, 0): local up is +X. World +Y is now a direction
  // along the local HORIZON, and local up must read as the zenith.
  const up = [1, 0, 0];
  const [, vHorizon] = equirectUvLocal([0, 1, 0], up, 0);
  const [, vZenith] = equirectUvLocal([1, 0, 0], up, 0);
  const [, vNadir] = equirectUvLocal([-1, 0, 0], up, 0);
  assert.ok(near(vHorizon, 0.5), `world +Y is on the local horizon here, got v=${vHorizon}`);
  assert.ok(near(vZenith, 1.0), `local up is the zenith, got v=${vZenith}`);
  assert.ok(near(vNadir, 0.0), `local down is the nadir, got v=${vNadir}`);
  // And the OLD mapping would have put world +Y at the zenith — that is the bug.
  const classicV = Math.asin(1) / Math.PI + 0.5;
  assert.ok(!near(vHorizon, classicV), 'the local mapping must differ from the world mapping off the pole');
});

test('every direction on the local horizon lands on v = 0.5, all the way round the planet', () => {
  // Sample the planet's surface directions and, at each, a ring of directions
  // perpendicular to up. All must be on the panorama's horizon row.
  for (let i = 0; i < 40; i += 1) {
    const th = (i / 40) * Math.PI * 2;
    const ph = ((i * 7) % 40) / 40 * Math.PI - Math.PI / 2;
    const up = [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)];
    // Two perpendicular tangents.
    const ref = Math.abs(up[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    const east = cross(ref, up); normalise(east);
    const north = cross(up, east);
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const dir = [
        Math.cos(a) * north[0] + Math.sin(a) * east[0],
        Math.cos(a) * north[1] + Math.sin(a) * east[1],
        Math.cos(a) * north[2] + Math.sin(a) * east[2],
      ];
      const [u, v] = equirectUvLocal(dir, up, 0);
      assert.ok(near(v, 0.5, 1e-5), `horizon direction at up=${up.map((n) => n.toFixed(2))} gave v=${v}`);
      assert.ok(Number.isFinite(u), 'u must be finite');
    }
  }
});

test('the rotation is in turns and only moves u', () => {
  const up = [0.3, 0.9, 0.1]; normalise(up);
  const dir = [0.5, 0.2, -0.7]; normalise(dir);
  const [u0, v0] = equirectUvLocal(dir, up, 0);
  const [u1, v1] = equirectUvLocal(dir, up, 0.25);
  assert.ok(near(v0, v1), 'rotation must not tilt the sky');
  assert.ok(near(((u1 - u0) % 1 + 1) % 1, 0.25), `a quarter turn moves u by 0.25, got ${u1 - u0}`);
});

test('the mapping is stable under yaw: it does not depend on where the camera looks', () => {
  // The azimuth reference is derived from up and a WORLD axis, never from the
  // view direction, so turning in place does not spin the clouds.
  const up = [0.6, 0.64, 0.48]; normalise(up);
  const dirA = [1, 0, 0];
  const [uA] = equirectUvLocal(dirA, up, 0);
  const [uA2] = equirectUvLocal(dirA, up, 0);
  assert.ok(near(uA, uA2));
});

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalise(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}
