import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from '../tools/lib/asset-analysis.mjs';
import {
  FEATHER_CONTOUR_TINT, FEATHER_VANE_TINT, FEATHER_MAP_STRENGTH,
  authoredFeathersRequested, authoredFeatherNormalsRequested, applyAuthoredFeathers,
} from '../src/environment/authored-textures.js';

// ---------------------------------------------------------------------------
// The bird's two feather sheets are DETAIL maps, clamped at 1, and this file
// is why that is not a matter of taste. See the constants' own comment.
// ---------------------------------------------------------------------------

const DIR = path.join(import.meta.dirname, '..', 'assets', 'textures');
const FILES = { contour: 'feather_contour_albedo.png', vane: 'feather_vane_albedo.png' };
const haveAssets = Object.values(FILES).every((f) => fs.existsSync(path.join(DIR, f)));
const skip = { skip: haveAssets ? false : 'assets/textures/feather_* not present' };

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const LUMA = [0.2126, 0.7152, 0.0722];
function linearPixels(file) {
  const p = decodePng(fs.readFileSync(path.join(DIR, file)), file);
  const n = p.w * p.h;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) for (let c = 0; c < 3; c += 1) out[i * 3 + c] = toLinear(p.data[i * p.ch + c] / 255);
  return { n, out };
}

test('each feather tint is the reciprocal of its shipped sheet\'s linear mean', skip, () => {
  for (const [key, tint] of [['contour', FEATHER_CONTOUR_TINT], ['vane', FEATHER_VANE_TINT]]) {
    const { n, out } = linearPixels(FILES[key]);
    const mean = [0, 0, 0];
    for (let i = 0; i < n; i += 1) for (let c = 0; c < 3; c += 1) mean[c] += out[i * 3 + c];
    for (let c = 0; c < 3; c += 1) mean[c] /= n;
    for (const [i, ch] of ['r', 'g', 'b'].entries()) {
      assert.ok(Math.abs(tint[ch] * mean[i] - 1) < 0.01,
        `${key}.${ch}: tint ${tint[ch]} x mean ${mean[i].toFixed(4)} = ${(tint[ch] * mean[i]).toFixed(4)}, not 1 — a re-delivered sheet graded differently must fail here`);
    }
  }
});

test('clamped at 1, the map cannot brighten any vertex colour and still holds the value', skip, () => {
  // eff = min(1, mix(1, a*t, s)). By construction max(eff) <= 1, so a vertex
  // colour with a channel at 255 (the belly, the wingtips) cannot clip. What
  // has to be CHECKED is the other side: that the darkening it introduces
  // stays above the black-slab floor and still carries visible detail.
  for (const [key, tint] of [['contour', FEATHER_CONTOUR_TINT], ['vane', FEATHER_VANE_TINT]]) {
    const { n, out } = linearPixels(FILES[key]);
    const t = [tint.r, tint.g, tint.b];
    let sumL = 0; let maxL = 0; const lumas = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      let l = 0;
      for (let c = 0; c < 3; c += 1) {
        const eff = Math.min(1, 1 + FEATHER_MAP_STRENGTH * (out[i * 3 + c] * t[c] - 1));
        l += eff * LUMA[c];
      }
      lumas[i] = l; sumL += l; if (l > maxL) maxL = l;
    }
    const mean = sumL / n;
    const sorted = Float32Array.from(lumas).sort();
    const darkest1 = sorted[Math.floor(n * 0.01)];
    assert.ok(maxL <= 1 + 1e-6, `${key}: effective luma exceeds 1 (${maxL})`);
    assert.ok(mean >= 0.90, `${key}: mean effective luma ${mean.toFixed(3)} — the bird would darken past what was measured (0.93)`);
    assert.ok(1 - darkest1 >= 0.25, `${key}: detail depth ${((1 - darkest1) * 100).toFixed(0)}% — the sheet is being spent and not used`);
  }
});

test('the flags: on by default, ?feathers=0 and ?authored=0 opt out, normals separately', () => {
  assert.equal(authoredFeathersRequested(''), true);
  assert.equal(authoredFeathersRequested('?bird=v3'), true);
  assert.equal(authoredFeathersRequested('?feathers=0'), false);
  assert.equal(authoredFeathersRequested('?bird=v3&authored=0'), false);
  assert.equal(authoredFeatherNormalsRequested('?bird=v3'), true);
  assert.equal(authoredFeatherNormalsRequested('?bird=v3&feathernormals=0'), false);
  // The normals flag is NOT the feathers flag: dropping normals keeps the albedo.
  assert.equal(authoredFeathersRequested('?feathernormals=0'), true);
});

// ---------------------------------------------------------------------------
// The applier, against a fake THREE whose TextureLoader lets the test decide
// when each image "lands" — the same shape authored-textures.test.js uses.
// ---------------------------------------------------------------------------
function fakeThree() {
  const pending = [];
  class Texture { constructor(url) { this.url = url; this.disposed = false; } dispose() { this.disposed = true; } }
  return {
    SRGBColorSpace: 'srgb', NoColorSpace: '', RepeatWrapping: 1000,
    Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    TextureLoader: class {
      load(url, onLoad, _p, onError) { const t = new Texture(url); pending.push({ t, onLoad, onError }); return t; }
    },
    _pending: pending,
    _landAll() { for (const p of pending.splice(0)) p.onLoad?.(p.t); },
  };
}
function fakeMaterial(name) {
  return {
    name, map: null, normalMap: null, needsUpdate: false,
    onBeforeCompile(shader) { shader.log.push(`rim:${name}`); },
    customProgramCacheKey() { return `rim-${name}`; },
  };
}
// What three ACTUALLY hands onBeforeCompile: the include, unexpanded. The
// first version of this file faked the EXPANDED chunk here, so the test
// passed while the real material was skipped on every device.
const FRAG = 'uniform vec3 diffuse;\n#include <map_fragment>\n#include <alphamap_fragment>\n';

test('nothing is touched until EVERY image has decoded', () => {
  const T = fakeThree();
  const contour = fakeMaterial('contour'); const vane = fakeMaterial('vane');
  applyAuthoredFeathers(T, { contour, vane }, 'x');
  assert.equal(T._pending.length, 4, 'two albedos and two normals requested');
  // Land three of four: still nothing applied — a normalMap over a
  // still-procedural albedo is a different wrong frame, not fewer.
  for (let i = 0; i < 3; i += 1) { const p = T._pending.shift(); p.onLoad(p.t); }
  assert.equal(contour.map, null); assert.equal(vane.map, null);
  const last = T._pending.shift(); last.onLoad(last.t);
  assert.ok(contour.map && contour.normalMap && vane.map && vane.normalMap, 'all four assigned together');
  assert.equal(contour.needsUpdate, true);
});

test('the shader patch CHAINS the rim light and extends its cache key', () => {
  const T = fakeThree();
  const contour = fakeMaterial('contour');
  applyAuthoredFeathers(T, { contour }, 'x');
  T._landAll();
  const shader = { uniforms: {}, fragmentShader: FRAG, log: [] };
  contour.onBeforeCompile(shader, null);
  assert.deepEqual(shader.log, ['rim:contour'], 'the previous onBeforeCompile still ran, first');
  assert.ok(shader.uniforms.uFeatherTint && shader.uniforms.uFeatherStrength, 'feather uniforms installed');
  assert.ok(!shader.fragmentShader.includes('#include <map_fragment>'), 'the include was replaced, not left alongside');
  assert.ok(shader.fragmentShader.includes('min(vec3(1.0), mix(vec3(1.0), featherSample.rgb * uFeatherTint, uFeatherStrength))'),
    'the clamped detail form is in');
  assert.ok(shader.fragmentShader.includes('#include <alphamap_fragment>'), 'other includes are untouched');
  assert.equal(contour.customProgramCacheKey(), 'rim-contour|authored-feathers');
});

test('a missing map_fragment anchor leaves the material UNPATCHED and warns, never multiplies raw', () => {
  const T = fakeThree();
  const contour = fakeMaterial('contour');
  applyAuthoredFeathers(T, { contour }, 'x');
  T._landAll();
  const warnings = [];
  const prevWarn = console.warn; console.warn = (m) => warnings.push(String(m));
  try {
    const shader = { uniforms: {}, fragmentShader: 'uniform vec3 diffuse;\nsomething else entirely', log: [] };
    contour.onBeforeCompile(shader, null);
    assert.equal(warnings.length, 1, 'one warning, which birb-modes treats as a failure');
    assert.ok(!shader.fragmentShader.includes('uFeatherTint'), 'no partial patch');
  } finally { console.warn = prevWarn; }
});

test('the disposer cancels a pending swap, and restores only what it actually changed', () => {
  // Pending: nothing was applied, so nothing is restored — but every texture
  // is released, so a load landing later paints nothing onto a rebuilt bird.
  let T = fakeThree(); let contour = fakeMaterial('contour');
  const rimBefore = contour.onBeforeCompile;
  let dispose = applyAuthoredFeathers(T, { contour }, 'x');
  const texs = T._pending.map((p) => p.t);
  dispose();
  T._landAll();
  assert.equal(contour.map, null, 'a cancelled swap never lands');
  assert.equal(contour.onBeforeCompile, rimBefore, 'the rim hook was never replaced');
  assert.ok(texs.every((t) => t.disposed), 'every requested texture released');
  // Applied: restored to exactly the prior hooks and maps.
  T = fakeThree(); contour = fakeMaterial('contour');
  const rim2 = contour.onBeforeCompile; const key2 = contour.customProgramCacheKey;
  dispose = applyAuthoredFeathers(T, { contour }, 'x');
  T._landAll();
  assert.notEqual(contour.onBeforeCompile, rim2);
  dispose();
  assert.equal(contour.map, null); assert.equal(contour.normalMap, null);
  assert.equal(contour.onBeforeCompile, rim2); assert.equal(contour.customProgramCacheKey, key2);
});

test('normals: false requests two images, gates on two, and leaves normalMap alone', () => {
  const T = fakeThree(); const contour = fakeMaterial('contour'); const vane = fakeMaterial('vane');
  applyAuthoredFeathers(T, { contour, vane }, 'x', { normals: false });
  assert.equal(T._pending.length, 2);
  T._landAll();
  assert.ok(contour.map && vane.map);
  assert.equal(contour.normalMap, null); assert.equal(vane.normalMap, null);
});
