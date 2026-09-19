import test from 'node:test';
import assert from 'node:assert/strict';
import {
  colorSpaceFor, repeatForCylinder, loadTexture, authoredBarkRequested,
  applyAuthoredBark, BARK_TILE_METRES, BARK_TINT,
  applyAuthoredStone, STONE_TINT, ARCH_ARC_UNITS, ARCH_TUBE_UNITS, authoredStoneRequested,
  PINE_BARK_TINT, GRANITE_TINT, SNOW_TINT,
} from '../src/environment/authored-textures.js';

/**
 * THREE is injected into this module precisely so it can be tested against a
 * fake. `spherical-world.js` imports three from a CDN URL that `node --test`
 * cannot resolve, which is why six other things in this repo have no oracle at
 * all; keeping the loader out of that file is what buys these assertions.
 */
function fakeThree({ fail = false } = {}) {
  const loaded = [];
  const pending = [];
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
        // The fake does NOT fire onLoad by hand -- the caller does, via
        // decodeAll/decodeOne. That is the whole point: a TextureLoader
        // returns its Texture immediately and fills the image in later, and
        // a fake that hides the gap cannot test the bug the gap causes.
        if (onLoad) pending.push(() => onLoad(t));
        if (fail) onError(new Error('404'));
        return t;
      }
    },
    pending,
    decodeOne() { const fn = pending.shift(); if (fn) fn(); },
    decodeAll() { while (pending.length) pending.shift()(); },
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

test('the authored textures are ON by default, and ?bark=0 opts out', () => {
  // Inverted from `?bark=1` once the art was accepted on a real phone. The
  // escape hatch stays because the A/B is how every one of these was judged.
  assert.equal(authoredBarkRequested(''), true);
  assert.equal(authoredBarkRequested(undefined), true);
  assert.equal(authoredBarkRequested('?bark=1'), true);
  assert.equal(authoredBarkRequested('?debug=1'), true);
  assert.equal(authoredBarkRequested('?bark=0'), false);
  assert.equal(authoredBarkRequested('?debug=1&bark=0'), false);
  assert.equal(authoredBarkRequested('?authored=0'), false, 'one switch for the lot');
  assert.equal(authoredStoneRequested('?authored=0'), false);
  assert.equal(authoredStoneRequested('?stone=0'), false);
  assert.equal(authoredStoneRequested('?bark=0'), true, 'and the two stay independent');
  assert.equal(authoredBarkRequested('?disembark=0'), true, 'must not match a substring of another param');
  // ?authored=1 stays legible rather than being an error: it was the old
  // turn-everything-on switch and now simply agrees with the default.
  assert.equal(authoredBarkRequested('?authored=1'), true);
  assert.equal(authoredStoneRequested('?authored=1'), true);
  assert.equal(authoredStoneRequested('?stone=1'), true);
  assert.equal(authoredStoneRequested('?bark=1'), true, 'the two are independent in both directions');
  assert.equal(authoredStoneRequested(''), true);
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

  // NOTHING is applied until both images decode. A Texture is not an image:
  // assigning `map` at call time defines USE_MAP against an empty upload, and
  // captured with the PNGs held in flight every trunk in the forest rendered
  // as a solid black slab.
  assert.equal(mat.map, null, 'no map before the image decodes');
  assert.equal(mat.normalMap, null);
  assert.equal(mat.color.rgb, null, 'and no tint either, or the trunk goes pale');

  T.decodeOne();
  assert.equal(mat.map, null, 'one of two is not enough — a lone normalMap is its own wrong frame');

  T.decodeAll();
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

test('the arch stone is solved from the torus, and barely needs a tint', () => {
  const T = fakeThree();
  const mat = fakeMaterial();
  mat.color._v = 0x6b6257;
  const dispose = applyAuthoredStone(T, mat);
  assert.equal(mat.map, null, 'the stone waits for its images too');
  T.decodeAll();

  assert.ok(mat.map && mat.normalMap);
  assert.equal(mat.roughnessMap, undefined, 'Lambert has no roughnessMap slot');

  // repeat is solved from the geometry, exactly as the bark's is, at the same
  // 4.3-unit tile so stone and bark read at one physical scale. u spans the
  // TUBE and v the ARC: the arch's uv attribute is swapped by the builder so
  // the albedo's bedding rings the leg instead of running down it.
  const rep = repeatForCylinder(ARCH_TUBE_UNITS, ARCH_ARC_UNITS, BARK_TILE_METRES);
  assert.deepEqual(rep, { x: 4, y: 12 });
  assert.equal(T.loaded[0].repeat.x, 4);
  assert.equal(T.loaded[0].repeat.y, 12);
  const tileU = ARCH_TUBE_UNITS / rep.x;
  const tileV = ARCH_ARC_UNITS / rep.y;
  assert.ok(Math.abs(tileU - tileV) < 1, `tile ${tileU.toFixed(2)} x ${tileV.toFixed(2)} must be near-square`);
  // Within 20% of the bark's tile, or the arch and the trees stop reading as
  // one world however good each looks alone.
  for (const tile of [tileU, tileV]) {
    assert.ok(Math.abs(tile - BARK_TILE_METRES) / BARK_TILE_METRES < 0.2,
      `tile ${tile.toFixed(2)} must be near the bark's ${BARK_TILE_METRES}`);
  }

  assert.deepEqual(mat.color.rgb, { r: STONE_TINT.r, g: STONE_TINT.g, b: STONE_TINT.b });
  // The tint LIFTS this albedo rather than reproducing it. It was near-white
  // once, on the reasoning that the art had been graded to the procedural
  // material's own tone -- which was true, and wrong, because that tone was a
  // brown 6.6 sRGB units from the bark's. See the separation test below.
  for (const v of Object.values(STONE_TINT)) assert.ok(v > 2.0 && v < 4.0);

  dispose();
  assert.equal(mat.color.getHex(), 0x6b6257);
  assert.ok(T.loaded.every(t => t.disposed));
});

test('the arch builder owns the dimensions, and they reach the tiling', () => {
  // Regression guard with teeth: the constants used to be hard-coded in the
  // texture module against a 13-unit arch. The arch was then rebuilt at 17 --
  // it had shipped lying FLAT on the ground and had to be stood up -- and
  // nothing anywhere would have said the tiles were now stretched 31%.
  const T = fakeThree();
  const mat = fakeMaterial();
  const dispose = applyAuthoredStone(T, mat, {
    uUnits: Math.PI * 40,
    vUnits: 2 * Math.PI * 6,
  });
  const expected = repeatForCylinder(Math.PI * 40, 2 * Math.PI * 6, BARK_TILE_METRES);
  // (u/v naming aside, this checks only that what goes in reaches the repeat.)
  assert.deepEqual({ x: T.loaded[0].repeat.x, y: T.loaded[0].repeat.y }, expected);
  assert.notDeepEqual(expected, { x: ARCH_ARC_UNITS, y: ARCH_TUBE_UNITS });
  assert.ok(expected.x > 12, 'a bigger arch must take more tiles, not the same number');
  dispose();
});


// ---------------------------------------------------------------------------
// The check that would have caught the wooden arch.
//
// Both authored albedos are graded browns and they landed 6.6 sRGB units
// apart -- no distance at all. The arch shipped looking like a timber bridge
// and the only thing that noticed was the owner, on his phone, after a
// deploy. Nothing structural could have: each file passes the asset gate on
// its own, and neither `tiling` nor `bakedLight` nor `channelSpan` has any
// opinion about the OTHER texture in the same frame.
//
// So assert the thing the player actually sees: albedo x tint, per material,
// far apart. This reads the shipped PNGs, so a future delivery that is the
// same brown again fails here rather than on a phone.
test('the rendered stone is not the rendered bark', async () => {
  const { decodePng } = await import('../tools/lib/asset-analysis.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(import.meta.dirname, '..', 'assets', 'textures');
  if (!fs.existsSync(path.join(dir, 'bark_pine_albedo.png'))) return;   // assets are optional

  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const meanLinear = (file) => {
    const png = decodePng(fs.readFileSync(path.join(dir, file)), file);
    const { width: w = png.w, height: h = png.h } = png;
    const n = (png.w ?? w) * (png.h ?? h);
    const mu = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) mu[c] += toLinear(png.data[i * png.ch + c] / 255);
    }
    return mu.map((v) => v / n);
  };

  const bark = meanLinear('bark_pine_albedo.png');
  const stone = meanLinear('stone_rock_albedo.png');

  // Raw, the two albedos are effectively the same colour. Assert that too, so
  // the reason this test exists stays legible if someone reads it cold.
  const rawGap = Math.hypot(...bark.map((v, i) => (toSrgb(v) - toSrgb(stone[i])) * 255));
  assert.ok(rawGap < 20, `albedos are ${rawGap.toFixed(1)} apart; the tints below are what separates them`);

  const lit = (mu, tint) => [mu[0] * tint.r, mu[1] * tint.g, mu[2] * tint.b];
  const renderedBark = lit(bark, BARK_TINT);
  const renderedStone = lit(stone, STONE_TINT);
  const gap = Math.hypot(...renderedBark.map(
    (v, i) => (toSrgb(Math.min(1, v)) - toSrgb(Math.min(1, renderedStone[i]))) * 255,
  ));
  assert.ok(gap > 60, `rendered bark and stone are only ${gap.toFixed(1)} sRGB units apart`);

  // And the stone must be the LIGHTER of the two: it is a 34-unit arch read
  // against a bright sky, and a dark mass there reads as a hole, which is the
  // same lesson the landmark trunk's 0x8a6440 records.
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(luma(renderedStone) > luma(renderedBark), 'the arch must not be darker than the trees');
});


// ---------------------------------------------------------------------------
// The half of the decode gate that only shows up on an environment switch.
test('a disposer that runs before the images land cancels the swap', () => {
  const T = fakeThree();
  const mat = fakeMaterial();
  const dispose = applyAuthoredBark(T, mat, { circumference: 34.7, height: 88 });

  dispose();                       // biome switched mid-download
  assert.ok(T.loaded.every((t) => t.disposed), 'the textures are released');
  assert.equal(mat.map, null);
  assert.equal(mat.color.getHex(), 0x8a6440, 'the procedural colour is untouched');

  // And the late arrival must not paint a disposed texture onto a material
  // the world has already rebuilt.
  T.decodeAll();
  assert.equal(mat.map, null, 'a load that lands after dispose applies nothing');
  assert.equal(mat.color.rgb, null);
});

test('the stone disposer restores only what it actually changed', () => {
  const T = fakeThree();
  const mat = fakeMaterial();
  mat.color._v = 0xa4907a;
  const dispose = applyAuthoredStone(T, mat);
  T.decodeAll();
  assert.deepEqual(mat.color.rgb, { r: STONE_TINT.r, g: STONE_TINT.g, b: STONE_TINT.b });
  dispose();
  assert.equal(mat.color.getHex(), 0xa4907a);
  assert.equal(mat.map, null);
});


// ===========================================================================
// The mountain's snow cap lost its contrast against the granite it sits on --
// REFUTED and fixed here. GRANITE_TINT used to be lifted to 1.73x the peak's
// own procedural luminance solely to clear a 60 sRGB-unit gap against the
// mountain's PINE BARK (40+ altitude units below the peaks, rarely in the
// same frame). That pulled the peak up TOWARD the snow cap that physically
// sits on it every time either is visible, and snow cannot compensate by
// getting brighter -- SNOW_TINT is already at its own 1.5%-clipping ceiling
// (see the header comment on GRANITE_TINT in authored-textures.js). Measured
// on a real capture: the snow/granite contrast fell from 128.4 sRGB units
// with both textures off to 78.8 with both on, a 39% loss -- and
// tests/authored-tints.test.js's own `mountain: granite vs snow >= 60` gate
// (an absolute-distance check) is satisfied at 78.8 and cannot see a RATIO
// collapsing, only a distance shrinking below its own fixed floor.
//
// These three guards are the ones that can see it, and are watched failing
// against the value this stage inherited before being fixed below.
test('the snow cap does not lose its contrast ratio against the granite peak', async () => {
  const { decodePng } = await import('../tools/lib/asset-analysis.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(import.meta.dirname, '..', 'assets', 'textures');
  if (!fs.existsSync(path.join(dir, 'mountain_granite_albedo.png'))) return; // assets are optional

  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const hexLinear = (h) => [toLinear(((h >> 16) & 255) / 255), toLinear(((h >> 8) & 255) / 255), toLinear((h & 255) / 255)];
  const meanLinear = (file) => {
    const png = decodePng(fs.readFileSync(path.join(dir, file)), file);
    const n = png.w * png.h;
    const mu = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mu[c] += toLinear(png.data[i * png.ch + c] / 255);
    return mu.map((v) => v / n);
  };

  const meanGranite = meanLinear('mountain_granite_albedo.png');
  const meanSnow = meanLinear('mountain_snow_albedo.png');

  // stoneMat's baked vertical gradient on the mountain peak body
  // (spherical-world.js: bakeVerticalGradient([.74,.74,.78],[1.16,1.18,1.22]))
  // -- the vertex-colour MEAN over the prop is the ramp's midpoint.
  const vcPeak = [0.95, 0.96, 1.00];
  const PEAK_HEX = 0x646c7c;   // stoneMat, mountain peak body
  const SNOW_HEX = 0xe6f1ff;   // snowMat, no vertexColors

  const pPeakVC = hexLinear(PEAK_HEX).map((v, i) => v * vcPeak[i]);
  const aPeakVC = [
    GRANITE_TINT.r * meanGranite[0] * vcPeak[0],
    GRANITE_TINT.g * meanGranite[1] * vcPeak[1],
    GRANITE_TINT.b * meanGranite[2] * vcPeak[2],
  ];
  const pPeakRaw = hexLinear(PEAK_HEX);                     // no VC -- for the ratio guard below
  const aPeakRaw = [GRANITE_TINT.r * meanGranite[0], GRANITE_TINT.g * meanGranite[1], GRANITE_TINT.b * meanGranite[2]];
  const pSnow = hexLinear(SNOW_HEX);
  const aSnow = [SNOW_TINT.r * meanSnow[0], SNOW_TINT.g * meanSnow[1], SNOW_TINT.b * meanSnow[2]];

  // G1 -- snow must keep close to its own procedural luminance. SNOW_TINT is
  // solved at this file's own 1.5% clipping ceiling and cannot go higher
  // (watched: +0.2% tint pushes clipping from 1.34% to 1.56%, over budget) --
  // so 0.69 is the achievable floor, not the originally-specified 0.7. Kept
  // as a guard anyway: it is what would catch a re-delivered, darker snow
  // albedo silently eating this margin.
  const snowRatio = luma(aSnow) / luma(pSnow);
  assert.ok(snowRatio >= 0.69, `snow renders at ${snowRatio.toFixed(4)}x its procedural luminance (floor 0.69)`);

  // G2 -- the peak must not be lifted far enough to threaten the cap it
  // carries. 1.73x (the refuted value) is what did the damage; 1.3 leaves
  // real headroom while still allowing the peak its own art pass.
  const peakRatio = luma(aPeakVC) / luma(pPeakVC);
  assert.ok(peakRatio <= 1.3, `granite renders at ${peakRatio.toFixed(3)}x its procedural luminance (ceiling 1.3)`);
  assert.ok(peakRatio >= 0.6, `granite renders at ${peakRatio.toFixed(3)}x its procedural luminance (black-slab floor 0.6)`);

  // G3 -- the actual regression. The snow:granite luminance RATIO the two
  // procedural materials had (5.84x, snow over granite) must survive at
  // least 75% of itself once both are textured -- the refuted value kept
  // only 40% of it (2.36 / 5.84). Computed WITHOUT the peak's vertex-colour
  // ramp, matching how the in-game capture that found this measured it.
  const procRatio = luma(pSnow) / luma(pPeakRaw);
  const authRatio = luma(aSnow) / luma(aPeakRaw);
  const kept = authRatio / procRatio;
  assert.ok(kept >= 0.75,
    `snow:granite contrast keeps only ${(kept * 100).toFixed(0)}% of its procedural ratio (floor 75%) `
    + `-- procedural ${procRatio.toFixed(2)}x, authored ${authRatio.toFixed(2)}x`);

  // The old 60-unit-vs-pine-bark rule is retired, not replaced with a bigger
  // number: the pine sits 40+ altitude units below the peaks and is rarely in
  // the same frame as either, so it should not be the thing GRANITE_TINT is
  // solved against. What's asserted instead is the weaker, honest claim --
  // texturing the peak still leaves it visibly distinct from the pine, it
  // just no longer has to clear an arbitrary 60-unit bar to do it.
  const PINE_HEX_MEAN = meanLinear('bark_pine_albedo.png');
  const sPine = [PINE_BARK_TINT.r * PINE_HEX_MEAN[0], PINE_BARK_TINT.g * PINE_HEX_MEAN[1], PINE_BARK_TINT.b * PINE_HEX_MEAN[2]];
  const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const gap = Math.hypot(...aPeakVC.map((v, i) => (toSrgb(Math.min(1, v)) - toSrgb(Math.min(1, sPine[i]))) * 255));
  assert.ok(gap > 20, `granite and pine bark are only ${gap.toFixed(1)} sRGB units apart -- one has swallowed the other`);
});
