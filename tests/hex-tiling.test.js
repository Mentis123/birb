import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  addGroundDetail, setGroundHexTile, hexTileRequested, HEX_TILE_DEFAULTS,
  hexTileHash, hexTileCell, hexTileUv, hexTileWeights, biplanarProjections,
} from '../src/environment/ground-detail.js';
import { BOOT_FLAGS, bootFlagByKey, readBootFlag, withBootFlag } from '../src/ui/boot-flags.js';
import { decodePng } from '../tools/lib/asset-analysis.mjs';

/**
 * hex-tiling.test.js — `groundMap.hexTile` (?hextile=1): the forest ground
 * map laid as Mikkelsen 2022 hex tiles on Quilez's two dominant projections.
 *
 * Three promises are pinned here. OFF IS THE TRUE BEFORE: without the option,
 * and with it switched off at runtime, addGroundDetail emits the default
 * shader byte for byte (the frozen suites pin its three-fetch budget). ON IS
 * WHAT IT CLAIMS: two projections, three textureGrad tiles each, gradients
 * rotated with the tile, weights renormalised, the bump reading the same
 * fetches. And the MATHS HOLDS on the JS mirror the GLSL is written from:
 * weights sum to 1, every seam is continuous, the projection swap is
 * seamless, the repeat disappears and the mean does not move.
 */

function fakeThree() {
  class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
  class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
  class Vector4 {
    constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; }
  }
  return { Vector2, Vector3, Vector4 };
}
const THREE = fakeThree();

const fakeMaterial = () => ({ userData: undefined, onBeforeCompile: undefined, customProgramCacheKey: undefined, needsUpdate: false });
// The chunks three hands onBeforeCompile, includes still unexpanded.
const fakeShader = () => ({
  uniforms: {},
  vertexShader: 'void main() {\n\t#include <begin_vertex>\n\t#include <project_vertex>\n}',
  fragmentShader: 'void main() {\n\t#include <normal_fragment_begin>\n\t#include <opaque_fragment>\n}',
});

function compile(material) {
  const shader = fakeShader();
  material.onBeforeCompile(shader, {});
  return shader;
}
function build(opts, after) {
  const material = fakeMaterial();
  addGroundDetail(material, THREE, { baseRadius: 120, biome: 'forest', ...opts });
  if (after) after(material);
  return { material, shader: compile(material), key: material.customProgramCacheKey() };
}

const MAP = { tile: 18, sharpness: 4, gain: { r: 5.213, g: 5.962, b: 7.03 } };
const HEX_MAP = { ...MAP, hexTile: true };
const count = (s, needle) => s.split(needle).length - 1;
const PATHS = [
  { smooth: false, bump: 0 },
  { smooth: true, bump: 0 },
  { smooth: true, bump: 7 },
];

// ===========================================================================
// OFF IS THE TRUE BEFORE
// ===========================================================================

test('without hexTile the ground shader carries no trace of it', () => {
  for (const p of PATHS) {
    const { shader, key, material } = build({ ...p, groundMap: MAP });
    for (const token of ['textureGrad', 'uGroundHex', 'gtHex', 'hxW']) {
      assert.equal(count(shader.fragmentShader, token), 0, `${JSON.stringify(p)}: found ${token}`);
    }
    assert.equal(count(shader.fragmentShader, 'texture2D(uGroundMap'), 3);
    assert.ok(!/-hex/.test(key), key);
    assert.equal(material.userData.birbGroundHex, undefined);
    assert.equal(shader.uniforms.uGroundHex, undefined);
  }
});

test('hexTile: false is the same shader as no hexTile at all', () => {
  for (const p of PATHS) {
    const a = build({ ...p, groundMap: MAP });
    const b = build({ ...p, groundMap: { ...MAP, hexTile: false } });
    assert.equal(b.shader.fragmentShader, a.shader.fragmentShader);
    assert.equal(b.shader.vertexShader, a.shader.vertexShader);
    assert.equal(b.key, a.key);
  }
});

test('switched OFF at runtime, a hex-capable ground compiles the default program byte for byte', () => {
  for (const biome of ['forest', 'canyons', 'mountain']) {
    for (const p of PATHS) {
      const plain = build({ ...p, biome, groundMap: MAP });
      const off = build({ ...p, biome, groundMap: HEX_MAP }, (m) => setGroundHexTile(m, false));
      assert.equal(off.shader.fragmentShader, plain.shader.fragmentShader, `${biome} ${JSON.stringify(p)}`);
      assert.equal(off.shader.vertexShader, plain.shader.vertexShader);
      assert.equal(off.key, plain.key, 'the off program must be the SAME program, cache key and all');
    }
  }
});

test('with no ground map at all, hexTile cannot attach (it re-samples the map)', () => {
  const { material, shader } = build({ smooth: true, groundMap: null });
  assert.equal(material.userData.birbGroundHex, undefined);
  assert.equal(count(shader.fragmentShader, 'textureGrad'), 0);
  assert.equal(setGroundHexTile(material, true), null);
});

// ===========================================================================
// ON IS WHAT IT CLAIMS
// ===========================================================================

/** The body of a GLSL function (braces balanced), or null. */
function glslBody(src, name) {
  const start = src.search(new RegExp(`\\bvec3 ${name}\\(`));
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

test('hex on: no triplanar fetch survives, three textureGrad tiles, fetched for TWO projections', () => {
  for (const p of PATHS) {
    const { shader, key } = build({ ...p, groundMap: HEX_MAP });
    const fs = shader.fragmentShader;
    assert.equal(count(fs, 'texture2D(uGroundMap'), 0, 'the triplanar fetches must be gone');
    assert.match(key, /-hex$/);
    const tile = glslBody(fs, 'gtHexTile');
    const bi = glslBody(fs, 'gtHexBiplanar');
    assert.ok(tile && bi, 'both functions are emitted');
    // Three textureGrad fetches, all in the tile function, each at its own
    // rotated/offset uv with the gradients rotated by the SAME matrix.
    assert.equal(count(fs, 'textureGrad(uGroundMap'), 3);
    assert.equal(count(tile, 'textureGrad(uGroundMap'), 3);
    for (const i of [1, 2, 3]) {
      assert.match(tile, new RegExp(`textureGrad\\(uGroundMap, hxR${i} \\* \\(st - hxC${i}\\) \\+ hxC${i} \\+ hxH${i}\\.xy, hxR${i} \\* dx, hxR${i} \\* dy\\)`));
    }
    // The biplanar function fetches the tile set twice — once per kept
    // projection — and the second is the one it may skip.
    assert.equal(count(bi, 'gtHexTile('), 2);
    assert.match(bi, /if \(hxW\.y <= 0\.0\) return hxA;/);
    // The projections are the triplanar's own axis pairs, with their own
    // world-space derivatives (Quilez: textureGrad with proper derivatives).
    for (const pair of ['zy', 'xz', 'xy']) {
      assert.match(bi, new RegExp(`p\\.${pair}`));
      assert.match(bi, new RegExp(`dpx\\.${pair}`));
      assert.match(bi, new RegExp(`dpy\\.${pair}`));
    }
    // Called once per fragment, from main, with dFdx/dFdy of the world position.
    assert.equal(count(fs, 'gtHexBiplanar('), 2, 'one definition + one call');
    assert.match(fs, /gtHexBiplanar\((vBirbWorld|gdP), gtN0?, dFdx\((vBirbWorld|gdP)\), dFdy\((vBirbWorld|gdP)\)\)/);
  }
});

test('hex on: projections are chosen by the smooth surface normal where one exists, the radial where not', () => {
  // Two projections cannot hide one that lies along a valley wall the way
  // three averaged into blur did, so the smooth path chooses by the smooth
  // (continuous) surface normal. The flat path has none and keeps the radial.
  const smooth = build({ smooth: true, bump: 7, groundMap: HEX_MAP }).shader.fragmentShader;
  assert.match(smooth, /vec3 gtN0 = normalize\(mix\(gdSmoothW, gdFacetW, uGroundFacet\)\);/);
  const flat = build({ smooth: false, groundMap: HEX_MAP }).shader.fragmentShader;
  assert.match(flat, /vec3 gtN = normalize\(mix\(gdUp, gdN, uGroundFacet\)\);/);
  // gdSmoothW is read before the bump rewrites the shading normal.
  assert.ok(smooth.indexOf('vec3 gdSmoothW =') < smooth.indexOf('vec3 gtN0 ='));
  assert.ok(smooth.indexOf('vec3 gdTex =') < smooth.indexOf('if (uGroundBump > 0.0)'));
});

test('hex on: both blends are renormalised to sum to 1', () => {
  const fs = build({ smooth: true, bump: 7, groundMap: HEX_MAP }).shader.fragmentShader;
  const tile = glslBody(fs, 'gtHexTile');
  const bi = glslBody(fs, 'gtHexBiplanar');
  assert.match(tile, /hxW \/= hxW\.x \+ hxW\.y \+ hxW\.z;/);
  assert.match(tile, /return hxW\.x \* hxT1 \+ hxW\.y \* hxT2 \+ hxW\.z \* hxT3;/);
  assert.match(bi, /return \(hxA \* hxW\.x \+ hxQ \* hxW\.y\) \/ \(hxW\.x \+ hxW\.y\);/);
});

test('hex on, smooth path: the bump still reads the colour fetches — no second set', () => {
  const fs = build({ smooth: true, bump: 7, groundMap: HEX_MAP }).shader.fragmentShader;
  // gdTex is produced once, by the hex call, and the bump's height is its luminance.
  assert.equal(count(fs, 'vec3 gdTex ='), 1);
  assert.match(fs, /vec3 gdTex = gtHexBiplanar\(/);
  assert.match(fs, /float gdH = dot\(gdTex, vec3\(0\.299, 0\.587, 0\.114\)\);/);
  assert.match(fs, /gdTint \*= mix\(vec3\(1\.0\), gdTex \* uGroundGain, uGroundMix\);/);
  assert.equal(count(fs, 'textureGrad('), 3);
});

test('hex on: the procedural detail and everything outside the fetch are untouched', () => {
  // Strip the hex function block and the fetch; what is left must be the
  // default shader with the triplanar fetch stripped the same way.
  for (const p of PATHS) {
    const on = build({ ...p, groundMap: HEX_MAP }).shader.fragmentShader;
    const off = build({ ...p, groundMap: MAP }).shader.fragmentShader;
    const onRest = on.slice(on.indexOf('float gdHash('));
    const offRest = off.slice(off.indexOf('float gdHash('));
    const cut = (s) => s.replace(/vec3 gtN0?[\s\S]*?(gdTex|gtTex) = [^;]*(\n[^;]*)*;/, 'FETCH;')
      .replace(/\n\s*\/\/[^\n]*/g, '');
    assert.equal(cut(onRest), cut(offRest), JSON.stringify(p));
  }
});

test('hex uniforms: one vec4, the SAME object the runtime handle holds, defaults from HEX_TILE_DEFAULTS', () => {
  const { material, shader } = build({ smooth: true, groundMap: HEX_MAP });
  const u = shader.uniforms.uGroundHex;
  assert.ok(u, 'uGroundHex is bound');
  assert.equal(u, material.userData.birbGroundHex.uniform, 'a copy would not see a runtime retune');
  assert.deepEqual([u.value.x, u.value.y, u.value.z, u.value.w],
    [HEX_TILE_DEFAULTS.rotation, HEX_TILE_DEFAULTS.falloff, HEX_TILE_DEFAULTS.exponent, HEX_TILE_DEFAULTS.cells]);
  assert.match(shader.fragmentShader, /uniform vec4 uGroundHex;/);
  assert.equal(count(shader.fragmentShader, 'uniform vec4 uGroundHex;'), 1);
  const tuned = build({ smooth: true, groundMap: { ...MAP, hexTile: { falloff: 0, exponent: 3 } } }).shader.uniforms.uGroundHex.value;
  assert.deepEqual([tuned.x, tuned.y, tuned.z, tuned.w], [HEX_TILE_DEFAULTS.rotation, 0, 3, HEX_TILE_DEFAULTS.cells]);
});

test('HEX_TILE_DEFAULTS are Mikkelsen\'s: falloff 0.6, exponent 7, a 2*sqrt(3) grid, full rotation', () => {
  assert.equal(HEX_TILE_DEFAULTS.falloff, 0.6);
  assert.equal(HEX_TILE_DEFAULTS.exponent, 7);
  assert.ok(Math.abs(HEX_TILE_DEFAULTS.cells - 2 * Math.sqrt(3)) < 1e-12);
  assert.equal(HEX_TILE_DEFAULTS.rotation, 1);
  assert.ok(Object.isFrozen(HEX_TILE_DEFAULTS));
});

test('setGroundHexTile flips the program: define, cache key, needsUpdate, and the shader it compiles', () => {
  const material = fakeMaterial();
  addGroundDetail(material, THREE, { baseRadius: 120, biome: 'forest', smooth: true, bump: 7, groundMap: HEX_MAP });
  assert.match(material.customProgramCacheKey(), /-bump-hex$/);
  // The define is what reaches three's program cache in the real chain:
  // addAtmosphere freezes the custom key at patch time (see markHexProgram).
  assert.deepEqual(material.defines, { BIRB_GROUND_HEX: '' });
  material.needsUpdate = false;
  assert.equal(setGroundHexTile(material, false), false);
  assert.equal(material.needsUpdate, true, 'a flip must ask three for a new program');
  assert.deepEqual(material.defines, {}, 'an empty defines object adds nothing to the key or the source');
  assert.ok(!/-hex/.test(material.customProgramCacheKey()));
  assert.equal(count(compile(material).fragmentShader, 'textureGrad'), 0);
  material.needsUpdate = false;
  assert.equal(setGroundHexTile(material, false), false);
  assert.equal(material.needsUpdate, false, 'no change, no recompile');
  assert.equal(setGroundHexTile(material, true), true);
  assert.deepEqual(material.defines, { BIRB_GROUND_HEX: '' });
  assert.match(material.customProgramCacheKey(), /-hex$/);
  assert.equal(count(compile(material).fragmentShader, 'textureGrad(uGroundMap'), 3);
  assert.equal(setGroundHexTile({ userData: {} }, true), null);
  assert.equal(setGroundHexTile(null, true), null);
});

test('uGroundHex is bound in EVERY compile of a hex-capable ground, the off one included', () => {
  // Three runs a program it reuses from its cache with the uniforms object
  // of the program it compiled LAST. Flip on -> off -> on: the second "on"
  // reuses the boot program but uploads from the OFF compile's uniforms, so
  // a uniform the off compile did not bind would never be uploaded again.
  const material = fakeMaterial();
  addGroundDetail(material, THREE, { baseRadius: 120, biome: 'forest', smooth: true, groundMap: HEX_MAP });
  setGroundHexTile(material, false);
  const off = compile(material);
  assert.equal(off.uniforms.uGroundHex, material.userData.birbGroundHex.uniform);
  assert.equal(count(off.fragmentShader, 'uGroundHex'), 0, 'bound, but not in the off source');
});

test('the define rides alongside any defines the material already had, and leaves them alone', () => {
  const material = { ...fakeMaterial(), defines: { SOMETHING: '1' } };
  addGroundDetail(material, THREE, { baseRadius: 120, biome: 'forest', smooth: true, groundMap: HEX_MAP });
  assert.deepEqual(material.defines, { SOMETHING: '1', BIRB_GROUND_HEX: '' });
  setGroundHexTile(material, false);
  assert.deepEqual(material.defines, { SOMETHING: '1' });
  // And a default ground never touches defines at all.
  const plain = fakeMaterial();
  addGroundDetail(plain, THREE, { baseRadius: 120, biome: 'forest', smooth: true, groundMap: MAP });
  assert.equal(plain.defines, undefined);
});

test('city stays a no-op with hexTile, like everything else', () => {
  const material = fakeMaterial();
  addGroundDetail(material, THREE, { biome: 'city', groundMap: HEX_MAP });
  assert.equal(material.onBeforeCompile, undefined);
  assert.equal(material.userData, undefined);
});

// ===========================================================================
// THE MATHS, on the JS mirror the GLSL is written from
// ===========================================================================

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('hex cell: barycentric weights are in [0,1] and sum to 1; vertices are three distinct lattice neighbours', () => {
  const rnd = lcg(7);
  for (let i = 0; i < 5000; i++) {
    const st = [(rnd() - 0.5) * 40, (rnd() - 0.5) * 40];
    const { weights, vertices } = hexTileCell(st[0], st[1]);
    const sum = weights[0] + weights[1] + weights[2];
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum ${sum} at ${st}`);
    for (const w of weights) assert.ok(w >= 0 && w <= 1 + 1e-12);
    const keys = new Set(vertices.map((v) => v.join(',')));
    assert.equal(keys.size, 3);
    for (const v of vertices) for (const c of v) assert.ok(Number.isInteger(c));
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        const d = [vertices[a][0] - vertices[b][0], vertices[a][1] - vertices[b][1]];
        assert.ok(Math.max(Math.abs(d[0]), Math.abs(d[1])) === 1, 'triangle vertices are lattice neighbours');
      }
    }
  }
});

test('hex cell: every vertex weighs 1 at its own centre and 0 on its tile edge — so tiles meet without a seam', () => {
  // Continuity of the per-VERTEX weight field: walk segments long enough to
  // cross several triangle edges, in steps of 5e-5 of a repeat, and require
  // every vertex's weight — including the ones entering and leaving the
  // triangle — to move by no more than the field's own slope allows. A seam
  // would jump by the weight a vertex still had when it left: O(0.1-1).
  const step = 5e-5;
  const slope = 2.5 * HEX_TILE_DEFAULTS.cells; // |d weight / d st| bound on this skewed grid
  const rnd = lcg(11);
  let crossings = 0;
  for (let trial = 0; trial < 120; trial++) {
    let st = [(rnd() - 0.5) * 20, (rnd() - 0.5) * 20];
    const dir = [Math.cos(rnd() * 6.283), Math.sin(rnd() * 6.283)];
    let prev = null;
    for (let k = 0; k < 6000; k++) {
      const { weights, vertices } = hexTileCell(st[0], st[1]);
      const map = new Map(vertices.map((v, i) => [v.join(','), weights[i]]));
      if (prev) {
        for (const id of new Set([...map.keys(), ...prev.keys()])) {
          if (!map.has(id) || !prev.has(id)) crossings++;
          const jump = Math.abs((map.get(id) || 0) - (prev.get(id) || 0));
          assert.ok(jump <= slope * step + 1e-9, `weight of ${id} jumped ${jump} across a step of ${step}`);
        }
      }
      prev = map;
      st = [st[0] + dir[0] * step, st[1] + dir[1] * step];
    }
  }
  assert.ok(crossings > 100, `the walk must actually cross triangle edges (${crossings})`);
  // At a vertex's own lattice point it owns the whole weight.
  const c = hexTileCell(0.0001 / HEX_TILE_DEFAULTS.cells, 0.0001 / HEX_TILE_DEFAULTS.cells);
  assert.ok(Math.max(...c.weights) > 0.999);
});

test('hex blend: Mikkelsen weights sum to 1, favour the brighter sample, and reduce to w^7 with no falloff', () => {
  const rnd = lcg(3);
  for (let i = 0; i < 2000; i++) {
    const b = [rnd(), rnd(), rnd()]; const s = b[0] + b[1] + b[2];
    const bary = b.map((x) => x / s);
    const lum = [rnd(), rnd(), rnd()];
    const W = hexTileWeights(bary, lum);
    assert.ok(Math.abs(W[0] + W[1] + W[2] - 1) < 1e-9);
    for (const w of W) assert.ok(w >= 0);
  }
  const even = [1 / 3, 1 / 3, 1 / 3];
  const W = hexTileWeights(even, [0.8, 0.2, 0.2]);
  assert.ok(W[0] > W[1] && Math.abs(W[1] - W[2]) < 1e-12, 'the bright sample wins a tie');
  const plain = hexTileWeights([0.5, 0.3, 0.2], [0.9, 0.1, 0.4], { falloff: 0 });
  const p7 = [0.5, 0.3, 0.2].map((x) => x ** 7); const t = p7[0] + p7[1] + p7[2];
  plain.forEach((w, i) => assert.ok(Math.abs(w - p7[i] / t) < 1e-12));
});

test('hex tile uv: a random offset and rotation per vertex, the same for every point of that tile', () => {
  const v = [3, -2];
  const a = hexTileUv(0.10, 0.20, v);
  const b = hexTileUv(0.11, 0.20, v);
  // A rotation: moving st by 0.01 moves the tile's uv by exactly 0.01.
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.01) < 1e-9);
  // Different vertices, different placements.
  const other = hexTileUv(0.10, 0.20, [4, -2]);
  assert.ok(Math.hypot(other[0] - a[0], other[1] - a[1]) > 1e-3);
  // With rotation 0 the tile is only offset.
  const r0 = hexTileUv(0.10, 0.20, v, { rotation: 0 });
  const h = hexTileHash(3, -2);
  assert.ok(Math.abs(r0[0] - (0.10 + h[0])) < 1e-9 && Math.abs(r0[1] - (0.20 + h[1])) < 1e-9);
  for (const x of hexTileHash(-17, 23)) assert.ok(x >= 0 && x < 1);
});

test('the vertex hash does not repeat along the lattice — above all not one tile along', () => {
  // At the paper's 2*sqrt(3) density one texture repeat along v IS a lattice
  // vector, (-2, 4): if the hash correlated across it, tiles one repeat apart
  // would share their placement and the repeat would come straight back.
  // Over every vertex the planet uses (|i|, |j| <= 40, 6,561 of them).
  const corr = (a, b) => {
    const n = a.length; const ma = a.reduce((s, v) => s + v, 0) / n; const mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0; let da = 0; let db = 0;
    for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return num / Math.sqrt(da * db);
  };
  for (const shift of [[-2, 4], [1, 0], [0, 1], [-1, 2], [-4, 8]]) {
    const a = [[], [], []]; const b = [[], [], []];
    for (let i = -40; i <= 40; i++) {
      for (let j = -40; j <= 40; j++) {
        const h = hexTileHash(i, j); const g = hexTileHash(i + shift[0], j + shift[1]);
        for (let k = 0; k < 3; k++) { a[k].push(h[k]); b[k].push(g[k]); }
      }
    }
    for (let k = 0; k < 3; k++) {
      const r = corr(a[k], b[k]);
      assert.ok(Math.abs(r) < 0.05, `hash component ${k} correlates ${r.toFixed(3)} across shift ${shift}`);
    }
  }
});

test('biplanar: two axes, the minor dropped, weights summing to 1', () => {
  const rnd = lcg(5);
  for (let i = 0; i < 5000; i++) {
    const n = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    const { axes, weights } = biplanarProjections(...n);
    assert.equal(axes.length, 2);
    assert.notEqual(axes[0], axes[1]);
    const an = n.map(Math.abs);
    const minor = 'xyz'[an.indexOf(Math.min(...an))];
    assert.ok(!axes.includes(minor), `kept the minor axis ${minor} for ${n}`);
    assert.ok(Math.abs(weights[0] + weights[1] - 1) < 1e-9);
    assert.ok(weights[0] >= weights[1] - 1e-12, 'major first');
  }
});

/** Angle (rad) from n to the nearest of the eight directions where |x|=|y|=|z|. */
function cornerDistance(n) {
  const an = n.map(Math.abs);
  const c = (an[0] + an[1] + an[2]) / Math.sqrt(3) / Math.hypot(...an);
  return Math.acos(Math.min(1, c));
}
const fullWeights = (n) => {
  const { axes, weights } = biplanarProjections(...n);
  const w = { x: 0, y: 0, z: 0 };
  axes.forEach((a, i) => { w[a] = weights[i]; });
  return w;
};

test('biplanar: the weight of every axis is continuous over the sphere — the swap is seamless', () => {
  // Walk great circles in small steps; the full three-axis weight vector
  // (zero for the dropped axis) must never jump. The one place it cannot
  // be smooth is the eight points where all three axes tie (see the next
  // test), so their 0.05-rad neighbourhoods — six units of ground each, on
  // a 754-unit planet — are measured separately.
  const rnd = lcg(9);
  const change = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
  let worst = { d: 0 }; let steps = 0;
  for (let c = 0; c < 60; c++) {
    const a = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const b = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const la = Math.hypot(...a); const A = a.map((v) => v / la);
    const d = b[0] * A[0] + b[1] * A[1] + b[2] * A[2];
    const Bv = b.map((v, i) => v - d * A[i]); const lb = Math.hypot(...Bv); const B = Bv.map((v) => v / lb);
    const at = (t) => A.map((v, i) => Math.cos(t) * v + Math.sin(t) * B[i]);
    let prev = null;
    for (let k = 0; k <= 20000; k++) {
      const t = (k / 20000) * 2 * Math.PI;
      const n = at(t);
      const w = fullWeights(n);
      if (prev && cornerDistance(n) > 0.05) {
        const dw = change(w, prev);
        if (dw > worst.d) worst = { d: dw, t0: ((k - 1) / 20000) * 2 * Math.PI, t1: t, at };
        steps++;
      }
      prev = w;
    }
  }
  // Step is 2*pi/20000 = 3.1e-4 rad. The steepest step anywhere (it is next
  // to a tie point, where the weights are steepest) must be a SLOPE, not a
  // jump: cut it into 1000 pieces and no piece may carry more than a few
  // thousandths of it. A seam would put all of it in one piece.
  assert.ok(steps > 1e6);
  assert.ok(worst.d < 0.05, `largest step-to-step weight change ${worst.d}`);
  let piece = 0; let before = fullWeights(worst.at(worst.t0));
  for (let k = 1; k <= 1000; k++) {
    const w = fullWeights(worst.at(worst.t0 + (worst.t1 - worst.t0) * (k / 1000)));
    piece = Math.max(piece, change(w, before));
    before = w;
  }
  assert.ok(piece < worst.d / 100, `the steepest step (${worst.d.toFixed(4)}) hides a jump of ${piece.toFixed(5)}`);
});

test('biplanar: at the eight three-way ties the weights stay finite and sum to 1 (the one unavoidable pinch)', () => {
  // Two projections cannot represent a point where all three are equal, so
  // any biplanar scheme hands weight between them over a short distance
  // there: within ~0.01 rad (about a unit of ground) of each tie point. The
  // early-out keeps the exact tie finite — major projection, full weight.
  for (const s of [[1, 1, 1], [-1, 1, 1], [1, -1, -1], [-1, -1, -1]]) {
    const n = s.map((v) => v / Math.sqrt(3));
    const { weights } = biplanarProjections(...n);
    assert.deepEqual(weights, [1, 0]);
    for (const eps of [1e-3, 1e-2, 5e-2]) {
      const m = [n[0] + eps, n[1] - eps / 2, n[2]];
      const w = biplanarProjections(...m).weights;
      assert.ok(w.every(Number.isFinite) && Math.abs(w[0] + w[1] - 1) < 1e-9, `${m}: ${w}`);
    }
  }
});

test('biplanar: away from the blend bands only ONE projection weighs anything (the three-fetch path)', () => {
  // Near an axis — most of the planet — the median axis sits under 1/sqrt(3).
  for (const n of [[1, 0.1, 0.05], [0.2, -0.95, 0.1], [0.3, 0.4, 0.86]]) {
    const { weights } = biplanarProjections(...n);
    assert.deepEqual(weights, [1, 0]);
  }
  // On a diagonal band both do.
  const { weights } = biplanarProjections(0.7071, 0.7071, 0.02);
  assert.ok(Math.abs(weights[0] - 0.5) < 1e-3);
});

// ---- the repeat, and the mean, on reference renders ----

/** A seeded single-channel noise texture with some low-frequency structure. */
function noiseTexture(size = 64, seed = 1) {
  const rnd = lcg(seed);
  const base = new Float32Array(size * size).map(() => rnd());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += base[((y + dy + size) % size) * size + ((x + dx + size) % size)];
      out[y * size + x] = 0.05 + 0.35 * (s / 9);
    }
  }
  return { size, data: out };
}
function bilinear(tex, u, v) {
  const { size, data } = tex;
  const fx = (u - Math.floor(u)) * size - 0.5; const fy = (v - Math.floor(v)) * size - 0.5;
  const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
  const at = (x, y) => data[((y % size) + size) % size * size + ((x % size) + size) % size];
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}
function hexSample(tex, s, t) {
  const { weights, vertices } = hexTileCell(s, t);
  const c = vertices.map((v) => { const uv = hexTileUv(s, t, v); return bilinear(tex, uv[0], uv[1]); });
  const W = hexTileWeights(weights, c);
  return W[0] * c[0] + W[1] * c[1] + W[2] * c[2];
}
function render(tex, hex, n = 256, perRepeat = 64) {
  const img = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = 0.37 + x / perRepeat; const t = -0.81 + y / perRepeat;
      img[y * n + x] = hex ? hexSample(tex, s, t) : bilinear(tex, s, t);
    }
  }
  return img;
}
function ncc(img, n, dx, dy) {
  let sa = 0; let sb = 0; let k = 0;
  for (let y = 0; y < n - dy; y++) for (let x = 0; x < n - dx; x++) { sa += img[y * n + x]; sb += img[(y + dy) * n + x + dx]; k++; }
  const ma = sa / k; const mb = sb / k;
  let num = 0; let da = 0; let db = 0;
  for (let y = 0; y < n - dy; y++) {
    for (let x = 0; x < n - dx; x++) {
      const a = img[y * n + x] - ma; const b = img[(y + dy) * n + x + dx] - mb;
      num += a * b; da += a * a; db += b * b;
    }
  }
  return num / Math.sqrt(da * db);
}

test('the repeat: a plain tiling correlates perfectly at one repeat; the hex tiling does not correlate at all', () => {
  const tex = noiseTexture(64, 21);
  const period = 64;
  const plain = render(tex, false);
  const hex = render(tex, true);
  const rPlain = [ncc(plain, 256, period, 0), ncc(plain, 256, 0, period)];
  const rHex = [ncc(hex, 256, period, 0), ncc(hex, 256, 0, period)];
  const control = [ncc(plain, 256, 29, 0), ncc(hex, 256, 29, 0)];
  for (const r of rPlain) assert.ok(r > 0.999, `plain tiling at its period: ${r}`);
  for (const r of rHex) assert.ok(Math.abs(r) < 0.1, `hex tiling at the period: ${r}`);
  for (const r of control) assert.ok(Math.abs(r) < 0.15, `off-period control: ${r}`);
});

test('the mean and the contrast of the REAL forest ground survive the hex blend', () => {
  // uGroundGain is 1/mean of this file, so a blend that moved the mean would
  // shift the whole forest floor's value. Measured on the authored albedo in
  // linear light, 60k samples across ~2,500 hex tiles.
  const png = decodePng(fs.readFileSync(new URL('../assets/textures/forest_ground_albedo.png', import.meta.url)));
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
  const lumTex = new Float32Array(png.w * png.h);
  for (let i = 0; i < png.w * png.h; i++) {
    lumTex[i] = 0.2126 * lin[png.data[i * png.ch]] + 0.7152 * lin[png.data[i * png.ch + 1]] + 0.0722 * lin[png.data[i * png.ch + 2]];
  }
  const tex = { size: png.w, data: lumTex };
  // The reference is the PLAIN tiling sampled the same way (bilinear at
  // random positions): bilinear filtering alone takes variance out of a
  // pixel-scale gravel texture, and that is not the blend's doing.
  const stats = (fn, seed) => {
    const rnd = lcg(seed);
    let m = 0; let m2 = 0; const N = 60000;
    for (let i = 0; i < N; i++) { const v = fn((rnd() - 0.5) * 14, (rnd() - 0.5) * 14); m += v; m2 += v * v; }
    m /= N;
    return { mean: m, sd: Math.sqrt(m2 / N - m * m) };
  };
  const plain = stats((s, t) => bilinear(tex, s, t), 13);
  const hex = stats((s, t) => hexSample(tex, s, t), 13);
  const shift = hex.mean / plain.mean - 1;
  const kept = hex.sd / plain.sd;
  assert.ok(Math.abs(shift) < 0.01, `mean moved ${(shift * 100).toFixed(2)}%`);
  assert.ok(kept > 0.9, `contrast kept ${kept.toFixed(3)}`);
});

// ===========================================================================
// The flag
// ===========================================================================

test('?hextile=1 turns it on; anything else is the default (off)', () => {
  assert.equal(hexTileRequested('?hextile=1'), true);
  assert.equal(hexTileRequested('?debug=1&hextile=1&env=forest'), true);
  assert.equal(hexTileRequested('?debug=1&hextile=1#x'), true);
  for (const s of ['', '?hextile=0', '?hextile=10', '?hextile=', '?nohextile=1', null, undefined]) {
    assert.equal(hexTileRequested(s), false, String(s));
  }
});

test('the Flags tab offers hextile as an opt-in select: Off (the default) and On', () => {
  const flag = bootFlagByKey('hextile');
  assert.ok(flag, 'no hextile flag');
  assert.equal(flag.kind, 'select');
  assert.equal(flag.group, 'Surfaces');
  assert.deepEqual(flag.options.map((o) => o.value), [null, '1']);
  assert.deepEqual(readBootFlag('', 'hextile'), { value: null });
  assert.deepEqual(readBootFlag('?hextile=1', 'hextile'), { value: '1' });
  assert.equal(withBootFlag('?debug=1', 'hextile', '1'), 'debug=1&hextile=1');
  // The panel's reading and the game's reader agree on every option.
  for (const o of flag.options) {
    const s = withBootFlag('', 'hextile', o.value);
    assert.equal(hexTileRequested(s ? `?${s}` : ''), o.value === '1');
  }
  assert.equal(BOOT_FLAGS.filter((f) => f.key === 'hextile').length, 1);
});

test('spherical-world.js passes the flag into the forest ground map', () => {
  const src = fs.readFileSync(new URL('../src/environment/spherical-world.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ addGroundDetail, hexTileRequested \} from "\.\/ground-detail\.js";/);
  assert.match(src, /hexTile: hexTileRequested\(window\.location\?\.search\)/);
});
