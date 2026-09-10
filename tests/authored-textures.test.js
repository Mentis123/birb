import test from 'node:test';
import assert from 'node:assert/strict';
import {
  colorSpaceFor, repeatForCylinder, loadTexture, authoredBarkRequested,
  applyAuthoredBark, BARK_TILE_METRES, BARK_TINT,
} from '../src/environment/authored-textures.js';

/**
 * THREE is injected into this module precisely so it can be tested against a
 * fake. `spherical-world.js` imports three from a CDN URL that `node --test`
 * cannot resolve, which is why six other things in this repo have no oracle at
 * all; keeping the loader out of that file is what buys these assertions.
 */
function fakeThree({ fail = false } = {}) {
  const loaded = [];
  class Texture {
    constructor(url) {
      this.url = url;
      this.repeat = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } };
      this.disposed = false;
    }
    dispose() { this.disposed = true; }
  }
  return {
    SRGBColorSpace: 'srgb',
    NoColorSpace: '',
    RepeatWrapping: 1000,
    loaded,
    TextureLoader: class {
      load(url, onLoad, onProgress, onError) {
        const t = new Texture(url);
        loaded.push(t);
        if (fail) onError(new Error('404'));
        return t;
      }
    },
  };
}

const fakeMaterial = () => ({
  color: {
    _v: 0x8a6440,
    rgb: null,
    getHex() { return this._v; },
    setHex(v) { this._v = v; this.rgb = null; },
    setRGB(r, g, b) { this.rgb = { r, g, b }; },
  },
  map: null,
  normalMap: null,
  needsUpdate: false,
});

test('colour space comes from the filename suffix, never a default', () => {
  const T = fakeThree();
  assert.equal(colorSpaceFor('bark_pine_albedo.png', T), 'srgb');
  assert.equal(colorSpaceFor('rock_basecolor.png', T), 'srgb');
  // A normal map is DATA. Decoding it as sRGB bends every slope and detaches
  // the lighting from the geometry without ever announcing itself.
  assert.equal(colorSpaceFor('bark_pine_normal.png', T), '');
  assert.equal(colorSpaceFor('bark_pine_rough.png', T), '');
  assert.equal(colorSpaceFor('mystery.png', T), '', 'unknown suffixes are treated as data, the safe side');
});

test('repeat is solved from the geometry so the tile stays square', () => {
  // The landmark trunk: 34.7 around at the nest, 88 tall.
  const r = repeatForCylinder(34.7, 88, BARK_TILE_METRES);
  assert.deepEqual(r, { x: 8, y: 20 });
  const tileU = 34.7 / r.x;
  const tileV = 88 / r.y;
  assert.ok(Math.abs(tileU - tileV) < 0.3,
    `tile ${tileU.toFixed(2)} x ${tileV.toFixed(2)} must be near-square or the bark smears`);

  // The same material also dresses a 34-unit log, and a CylinderGeometry's UVs
  // are 0..1 regardless of world size — which is exactly why this is solved per
  // mesh rather than hardcoded once.
  const log = repeatForCylinder(2 * Math.PI * 2.45, 34, BARK_TILE_METRES);
  assert.notDeepEqual(log, r);
  assert.ok(log.x >= 1 && log.y >= 1);

  // Never zero: a repeat of 0 collapses the UVs onto one texel.
  assert.deepEqual(repeatForCylinder(0.5, 0.5, BARK_TILE_METRES), { x: 1, y: 1 });
});

test('the flag is off by default and matches the ?glb=1 precedent', () => {
  assert.equal(authoredBarkRequested(''), false);
  assert.equal(authoredBarkRequested(undefined), false);
  assert.equal(authoredBarkRequested('?bark=1'), true);
  assert.equal(authoredBarkRequested('?debug=1&bark=1'), true);
  assert.equal(authoredBarkRequested('?bark=0'), false);
  assert.equal(authoredBarkRequested('?embark=1'), false, 'must not match a substring of another param');
});

test('a loaded texture carries every convention', () => {
  const T = fakeThree();
  const t = loadTexture(T, './assets/textures/bark_pine_albedo.png', { repeat: { x: 8, y: 20 } });
  assert.equal(t.colorSpace, 'srgb');
  assert.equal(t.wrapS, T.RepeatWrapping);
  assert.equal(t.wrapT, T.RepeatWrapping);
  assert.equal(t.repeat.x, 8);
  assert.equal(t.repeat.y, 20);
  assert.equal(t.generateMipmaps, true);
  // Over-asked on purpose: three clamps to the device maximum on upload, and
  // grazing-angle filtering on a near-vertical trunk is the largest quality
  // win available here for zero memory.
  assert.equal(t.anisotropy, 16);
});

test('applying the bark whitens the colour, because map MULTIPLIES it', () => {
  const T = fakeThree();
  const mat = fakeMaterial();
  const dispose = applyAuthoredBark(T, mat, { circumference: 34.7, height: 88 });

  assert.ok(mat.map && mat.normalMap);
  assert.equal(mat.needsUpdate, true);
  // Keeping 0x8a6440 would land the trunk at ~14% of its brightness (two
  // albedos multiplied); pure white measured 19% in a real capture, which is
  // the "black slab" defect the material's own comment memorialises. The tint
  // is solved so colour x map reproduces the procedural tone.
  assert.deepEqual(mat.color.rgb, { r: BARK_TINT.r, g: BARK_TINT.g, b: BARK_TINT.b });
  // roughnessMap is NOT set: MeshLambertMaterial has no such slot, and
  // assigning one uploads a texture and samples nothing.
  assert.equal(mat.roughnessMap, undefined);

  dispose();
  assert.equal(mat.color.getHex(), 0x8a6440, 'the procedural colour comes back');
  assert.equal(mat.color.rgb, null, 'and the tint is cleared, not left multiplying');
  assert.equal(mat.map, null);
  assert.equal(mat.normalMap, null);
  assert.ok(T.loaded.every(t => t.disposed), 'both textures released, or the world leaks one per env switch');
});

test('a failed load warns and leaves the game playable', () => {
  const T = fakeThree({ fail: true });
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const mat = fakeMaterial();
    assert.doesNotThrow(() => applyAuthoredBark(T, mat, { circumference: 34.7, height: 88 }));
    assert.ok(warnings.some(w => /failed to load/.test(w)));
  } finally {
    console.warn = realWarn;
  }
});
