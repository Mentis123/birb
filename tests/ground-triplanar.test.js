import test from 'node:test';
import assert from 'node:assert/strict';
import { addGroundDetail } from '../src/environment/ground-detail.js';

/**
 * ground-triplanar.test.js — mechanics of the optional authored-texture
 * overlay `addGroundDetail`'s `groundMap` option adds to the forest ground.
 *
 * The tint contract (GROUND_TINT, GROUND_MAP_STRENGTH, the loader, the real
 * decode gate) lives in src/environment/authored-textures.js and is pinned by
 * tests/authored-tints.test.js — a different stage's file, not this one. This
 * file is the shader/uniform mechanics `addGroundDetail` itself owns: that the
 * feature is emitted ONLY when asked for, that the projection shape is really
 * triplanar (three samples, three axis-pair UVs, weights renormalised to sum
 * to 1), and that the uniforms it exposes default to a no-op mix so nothing
 * downstream needs a recompile to turn it on.
 *
 * THREE is injected (same reason as every other fake-THREE suite in this
 * repo: spherical-world.js imports three from a CDN URL `node --test` cannot
 * resolve) so this needs only the two vector classes addGroundDetail touches.
 */
function fakeThree() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  }
  class Vector2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  }
  return { Vector3, Vector2 };
}

const THREE = fakeThree();

function fakeMaterial() {
  return {
    userData: undefined,
    onBeforeCompile: undefined,
    customProgramCacheKey: undefined,
    needsUpdate: false,
  };
}

/** A fake shader object shaped like the one Three hands onBeforeCompile. */
function fakeShader() {
  return {
    uniforms: {},
    vertexShader: 'void main() {\n\t#include <begin_vertex>\n}',
    fragmentShader: 'void main() {\n\t#include <opaque_fragment>\n}',
  };
}

/** Build a material, run addGroundDetail, and simulate one compile. */
function build(opts) {
  const material = fakeMaterial();
  addGroundDetail(material, THREE, opts);
  const shader = fakeShader();
  material.onBeforeCompile(shader, {});
  return { material, shader };
}

const VALID_MAP = { tile: 3.0, sharpness: 4.0, gain: { r: 5.213, g: 5.962, b: 7.030 } };

// ===========================================================================
// T1 — off-path purity: no groundMap, nothing new is emitted.
// ===========================================================================

test('with no groundMap, the shader is byte-for-byte what it always was', () => {
  const { shader } = build({ biome: 'forest' });
  assert.equal((shader.fragmentShader.match(/uGroundMap/g) || []).length, 0);
  assert.equal((shader.fragmentShader.match(/texture2D/g) || []).length, 0);
  assert.equal(shader.uniforms.uGroundMap, undefined);
  assert.equal(shader.uniforms.uGroundMix, undefined);
});

test('with no groundMap, the cache key carries no -tex suffix, and no tex uniforms are exposed', () => {
  const material = fakeMaterial();
  addGroundDetail(material, THREE, { biome: 'canyons' });
  assert.equal(material.customProgramCacheKey(), 'birb-ground-canyons');
  assert.equal(material.userData.birbGroundTexUniforms, undefined);
});

// This is the one that would fail if T1's purity were broken — watched: with
// the feature emitted unconditionally, this assertion is the one that trips.
test('sanity: a material actually gets a *different* shader when groundMap IS passed', () => {
  const off = build({ biome: 'forest' });
  const on = build({ biome: 'forest', groundMap: VALID_MAP });
  assert.notEqual(off.shader.fragmentShader, on.shader.fragmentShader);
});

// ===========================================================================
// Validation — every field is required once groundMap is truthy at all.
// ===========================================================================

test('groundMap with a missing field throws rather than silently defaulting', () => {
  const material = fakeMaterial();
  assert.throws(
    () => addGroundDetail(material, THREE, { biome: 'forest', groundMap: { tile: 3, sharpness: 4 } }),
    /groundMap\.gain is required/,
  );
});

test('groundMap: null (the default) and groundMap: undefined are both the off-path', () => {
  for (const groundMap of [null, undefined]) {
    const material = fakeMaterial();
    addGroundDetail(material, THREE, { biome: 'forest', groundMap });
    assert.equal(material.userData.birbGroundTexUniforms, undefined);
  }
});

// ===========================================================================
// T2 — on-path shape: really triplanar, not a duplicated single projection.
// ===========================================================================

test('with groundMap, the fragment carries exactly three uGroundMap samples on three distinct axis pairs', () => {
  const { shader } = build({ biome: 'forest', groundMap: VALID_MAP });
  const samples = shader.fragmentShader.match(/texture2D\(uGroundMap,\s*(\w+)\)/g) || [];
  assert.equal(samples.length, 3, `expected 3 texture2D(uGroundMap, ...) calls, found ${samples.length}`);
  // Three DISTINCT uv variables -- the classic triplanar typo is sampling the
  // same projection three times, which this would catch.
  const uvVars = samples.map((s) => s.match(/texture2D\(uGroundMap,\s*(\w+)\)/)[1]);
  assert.equal(new Set(uvVars).size, 3, `expected 3 distinct uv expressions, got ${uvVars.join(', ')}`);
  assert.match(shader.fragmentShader, /gtUvX\s*=\s*gdP\.zy\s*\/\s*uGroundTile/);
  assert.match(shader.fragmentShader, /gtUvY\s*=\s*gdP\.xz\s*\/\s*uGroundTile/);
  assert.match(shader.fragmentShader, /gtUvZ\s*=\s*gdP\.xy\s*\/\s*uGroundTile/);
});

test('the triplanar weights are renormalised to sum to 1 before use', () => {
  const { shader } = build({ biome: 'forest', groundMap: VALID_MAP });
  // FAILS if the normalisation line is dropped -- a weighted average of three
  // samples of the same texture only preserves the texture's own mean when
  // the weights sum to 1, which is the entire mean-preservation argument for
  // uGroundGain.
  assert.match(shader.fragmentShader, /gtW\s*\/=\s*max\(gtW\.x\s*\+\s*gtW\.y\s*\+\s*gtW\.z,/);
});

test('blending uses the sphere normal (gdUp) by default, with gdN mixed in only via uGroundFacet', () => {
  const { shader } = build({ biome: 'forest', groundMap: VALID_MAP });
  assert.match(shader.fragmentShader, /normalize\(mix\(gdUp,\s*gdN,\s*uGroundFacet\)\)/);
});

test('the overlay multiplies gdTint and runs before outgoingLight *= gdTint', () => {
  const { shader } = build({ biome: 'forest', groundMap: VALID_MAP });
  const mixIdx = shader.fragmentShader.indexOf('gdTint *= mix(vec3(1.0), gtTex * uGroundGain, uGroundMix)');
  const outIdx = shader.fragmentShader.indexOf('outgoingLight *= gdTint;');
  assert.ok(mixIdx >= 0, 'the overlay multiply is missing');
  assert.ok(outIdx > mixIdx, 'the overlay must land on gdTint before it tints outgoingLight');
});

test('the vBirbWorld varying is declared once even with groundMap on', () => {
  const { shader } = build({ biome: 'forest', groundMap: VALID_MAP });
  assert.equal((shader.vertexShader.match(/varying vec3 vBirbWorld;/g) || []).length, 1);
  assert.equal((shader.fragmentShader.match(/varying vec3 vBirbWorld;/g) || []).length, 1);
});

test('the cache key gains a -tex suffix only with groundMap', () => {
  const material = fakeMaterial();
  addGroundDetail(material, THREE, { biome: 'forest', groundMap: VALID_MAP });
  assert.equal(material.customProgramCacheKey(), 'birb-ground-forest-tex');
});

// ===========================================================================
// T3-shaped — the gate default, and live rebinding without recompile.
//
// The real decode gate (commitWhenDecoded) lives in authored-textures.js and
// is out of this file's ownership; what this module is responsible for is
// that its own uniforms START at the no-op value and that they are the SAME
// object a caller can mutate later with no needsUpdate.
// ===========================================================================

test('the tex uniforms default to the no-op mix: uGroundMix 0, uGroundMap null', () => {
  const { material, shader } = build({ biome: 'forest', groundMap: VALID_MAP });
  assert.equal(shader.uniforms.uGroundMix.value, 0);
  assert.equal(shader.uniforms.uGroundMap.value, null);
  assert.equal(material.userData.birbGroundTexUniforms.uGroundMix.value, 0);
});

test('userData.birbGroundTexUniforms IS shader.uniforms\' tex entries, not a copy', () => {
  const { material, shader } = build({ biome: 'forest', groundMap: VALID_MAP });
  const exposed = material.userData.birbGroundTexUniforms;
  // Mutate through the exposed handle, as a loader's decode callback would.
  exposed.uGroundMix.value = 0.8;
  exposed.uGroundMap.value = { fake: 'texture' };
  assert.equal(shader.uniforms.uGroundMix.value, 0.8, 'shader.uniforms did not see the mutation -- it is a copy');
  assert.equal(shader.uniforms.uGroundMap.value.fake, 'texture');
});

test('groundMap.tile/sharpness/gain reach the uniforms unchanged', () => {
  const map = { tile: 5.5, sharpness: 2.0, gain: { r: 1, g: 2, b: 3 } };
  const { shader } = build({ biome: 'canyons', groundMap: map });
  assert.equal(shader.uniforms.uGroundTile.value, 5.5);
  assert.equal(shader.uniforms.uGroundSharp.value, 2.0);
  assert.deepEqual(
    [shader.uniforms.uGroundGain.value.x, shader.uniforms.uGroundGain.value.y, shader.uniforms.uGroundGain.value.z],
    [1, 2, 3],
  );
  assert.equal(shader.uniforms.uGroundFacet.value, 0.0);
});

// ===========================================================================
// T5-shaped — the mean-preservation property, checked algebraically.
//
// authored-tints.test.js checks this against the real PNG mean; this checks
// the WEIGHT MATH itself is what mean-preservation actually depends on: for
// any set of per-axis weights that sum to 1, a weighted average of three
// equal-mean samples has that same mean. This is what T1/T2 prove is really
// what's in the shader; this proves the arithmetic those lines perform is
// correct.
// ===========================================================================

test('weight math: pow(|N|,k) renormalised sums to 1 for arbitrary normals and sharpness', () => {
  const normals = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1, 1, 1], [0.5, 0.5, 0.707], [0.2, 0.9, 0.38], [-0.4, 0.6, -0.69],
  ];
  for (const n of normals) {
    const len = Math.hypot(...n) || 1;
    const N = n.map((v) => v / len);
    for (const sharp of [1, 2, 4, 8]) {
      const w = N.map((v) => Math.abs(v) ** sharp);
      const sum = Math.max(w[0] + w[1] + w[2], 1e-4);
      const wn = w.map((v) => v / sum);
      const total = wn[0] + wn[1] + wn[2];
      assert.ok(Math.abs(total - 1) < 1e-9, `weights summed to ${total}, not 1, for N=${N} sharp=${sharp}`);
    }
  }
});

test('mean preservation: a weighted average of three equal-mean samples keeps that mean, for ANY normalised weights', () => {
  // Stand-in for "three texture2D samples of the same file, gain = 1/mean".
  // If gain*mean == 1 per channel and the weights sum to 1, mix must land on
  // exactly 1 regardless of which weights won -- that is the entire point of
  // the renormalisation this design insists on.
  const meanNormalisedSample = 1.0; // gain * (a texel whose expectation is 1)
  const weightTriples = [[1, 0, 0], [0.5, 0.5, 0], [1 / 3, 1 / 3, 1 / 3], [0.7, 0.2, 0.1]];
  for (const [wx, wy, wz] of weightTriples) {
    const blended = meanNormalisedSample * wx + meanNormalisedSample * wy + meanNormalisedSample * wz;
    assert.ok(Math.abs(blended - 1) < 1e-9, `blended mean ${blended} moved for weights ${wx},${wy},${wz}`);
  }
});

// ===========================================================================
// Regression guard for the profile-driven no-op path: forest/canyons/mountain
// all still get their existing procedural detail regardless of groundMap.
// ===========================================================================

test('groundMap does not disturb the existing per-biome procedural detail', () => {
  for (const biome of ['forest', 'canyons', 'mountain']) {
    const withMap = build({ biome, groundMap: VALID_MAP }).shader.fragmentShader;
    const withoutMap = build({ biome }).shader.fragmentShader;
    // Strip the inserted block and confirm what's left matches the no-map
    // shader exactly -- the overlay must be a pure addition, not a rewrite.
    const stripped = withMap
      .replace(/\n\s*\/\/ Authored ground overlay[\s\S]*?uGroundMix\);\n/, '\n')
      .replace(/uniform sampler2D uGroundMap;[^\n]*\n/, '')
      .replace(/uniform float uGroundFacet;[^\n]*\n/, '');
    assert.equal(stripped, withoutMap, `${biome}: groundMap changed the existing procedural shader`);
  }
});

test('city has no ground profile at all, groundMap or not -- addGroundDetail stays a no-op there', () => {
  const material = fakeMaterial();
  const result = addGroundDetail(material, THREE, { biome: 'city', groundMap: VALID_MAP });
  assert.equal(material.onBeforeCompile, undefined, 'city has no GROUND_PROFILES entry; nothing should attach');
  assert.equal(result, material);
});
