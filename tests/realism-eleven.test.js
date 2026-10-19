// tests/realism-eleven.test.js — "visual realism to 11" (2026-10-19).
//
// Two pure pieces: realism-defaults.js (which boots build which realism
// package — an ULTRA boot builds them all, every other boot none, the URL
// overrides either way) and ambient-occlusion.js's maths and composite
// patch. The live page is checked by tools/birb-default.mjs (Ultra, no flag)
// and tools/birb-shaders.mjs (every program compiles).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootPresetId, realismOn, currentBootPreset, ULTRA_REALISM,
  QUALITY_STORAGE_KEY, QUALITY_AUTO_LEVEL_KEY,
} from '../src/ui/realism-defaults.js';
import {
  ambientOcclusionRequested, AO_DEFAULTS, spiralTap, aoScreenRadius, aoTapWeight,
  patchCompositeAO, AO_COMPOSITE_APPLY_ANCHOR,
} from '../src/effects/ambient-occlusion.js';
import { COMPOSITE_FRAG } from '../src/effects/bloom-pass.js';
import { patchComposite as patchEye } from '../src/effects/exposure.js';

test('boot preset: nothing chosen is Ultra (Auto starts there)', () => {
  assert.equal(bootPresetId('', null, null), 'ultra');
  assert.equal(bootPresetId('?quality=auto', null, null), 'ultra');
  assert.equal(bootPresetId('', 'auto', null), 'ultra');
});

test('boot preset: Auto resumes the level it settled on', () => {
  assert.equal(bootPresetId('', 'auto', 'okay'), 'okay');
  assert.equal(bootPresetId('', null, 'amazing'), 'amazing');
  assert.equal(bootPresetId('', null, 'garbage'), 'ultra');
});

test('boot preset: the URL beats the saved choice, a fixed choice beats Auto', () => {
  assert.equal(bootPresetId('?quality=amazing', 'ultra', null), 'amazing');
  assert.equal(bootPresetId('?debug=1&quality=light', 'ultra', 'ultra'), 'light');
  assert.equal(bootPresetId('', 'okay', 'ultra'), 'okay');
});

test('every frozen-harness boot (&quality=amazing) builds no realism package', () => {
  for (const key of ULTRA_REALISM) {
    assert.equal(realismOn(key, '?debug=1&quality=amazing&flight=classic'), false, key);
  }
});

test('an Ultra boot builds every package; ?key=0 opts one out', () => {
  for (const key of ULTRA_REALISM) assert.equal(realismOn(key, '?quality=ultra'), true, key);
  assert.equal(realismOn('ao', '?quality=ultra&ao=0'), false);
  assert.equal(realismOn('autoexp', '?quality=ultra&ao=0'), true);
  assert.equal(realismOn('hextile', '', 'ultra'), true);
});

test('?realism=0 is the Ultra before; a package\'s own =1 still wins', () => {
  for (const key of ULTRA_REALISM) assert.equal(realismOn(key, '?quality=ultra&realism=0'), false, key);
  assert.equal(realismOn('ao', '?realism=0&ao=1', 'ultra'), true);
});

test('?key=1 forces a package on at any preset; unknown keys stay off', () => {
  assert.equal(realismOn('ao', '?quality=light&ao=1'), true);
  assert.equal(realismOn('ibl', '?quality=ultra'), false);
  assert.equal(realismOn('erosion', '?quality=light&erosion=1'), true);
  assert.equal(realismOn('erosion', '?quality=ultra'), true);
});

test('currentBootPreset reads the same keys index.html writes, and survives a throwing store', () => {
  const store = { getItem: (k) => ({ [QUALITY_STORAGE_KEY]: 'auto', [QUALITY_AUTO_LEVEL_KEY]: 'okay' })[k] ?? null };
  assert.equal(currentBootPreset('', store), 'okay');
  assert.equal(currentBootPreset('', { getItem() { throw new Error('blocked'); } }), 'ultra');
  assert.equal(currentBootPreset('?quality=amazing', null), 'amazing');
});

test('?ao= parses to true / false / null', () => {
  assert.equal(ambientOcclusionRequested('?ao=1'), true);
  assert.equal(ambientOcclusionRequested('?x=1&ao=0'), false);
  assert.equal(ambientOcclusionRequested('?aox=1'), null);
  assert.equal(ambientOcclusionRequested(''), null);
});

test('spiral taps are spread in radius and never repeat a direction', () => {
  const n = AO_DEFAULTS.samples;
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const t = spiralTap(i);
    assert.ok(t.radius > 0 && t.radius < 1);
    seen.add((t.angle % 1).toFixed(4));
  }
  assert.equal(seen.size, n);
});

test('screen radius: a fixed WORLD reach, shrinking with depth, clamped near the lens', () => {
  const near = aoScreenRadius(3.2, 1.2, 2.6, 4);
  const mid = aoScreenRadius(3.2, 1.2, 2.6, 80);
  const far = aoScreenRadius(3.2, 1.2, 2.6, 160);
  assert.ok(Math.max(near.x, near.y) <= AO_DEFAULTS.maxScreen + 1e-12, 'clamped');
  assert.ok(Math.abs(mid.y / far.y - 2) < 1e-9, 'halves with doubled depth');
  // The clamp keeps the aspect.
  assert.ok(Math.abs(near.x / near.y - 1.2 / 2.6) < 1e-9);
});

test('a tap occludes from above the surface, never from behind it or past the radius', () => {
  const r = AO_DEFAULTS.radius;
  // Normal +z. A tap straight up the normal, inside the radius, occludes.
  assert.ok(aoTapWeight(0, 0, 1, 0, 0, 1, r) > 0.5);
  // Behind the surface: nothing.
  assert.equal(aoTapWeight(0, 0, -1, 0, 0, 1, r), 0);
  // In the tangent plane (a flat facet's own neighbour): under the bias.
  assert.equal(aoTapWeight(1, 0, 0.05, 0, 0, 1, r), 0);
  // Past the radius (a valley floor far below a silhouette): nothing — the halo rule.
  assert.equal(aoTapWeight(0, 0, r * 1.01, 0, 0, 1, r), 0);
});

test('the AO patch lands before the bloom add, and composes with the eye', () => {
  const ao = patchCompositeAO(COMPOSITE_FRAG);
  const apply = ao.indexOf('scene *= mix(1.0, texture2D(tAO, vUv).r, uAO);');
  assert.ok(apply > 0);
  assert.ok(apply < ao.indexOf(AO_COMPOSITE_APPLY_ANCHOR), 'multiplied into the scene before bloom is added');
  assert.ok(ao.includes('uniform sampler2D tAO;'));
  const both = patchCompositeAO(patchEye(COMPOSITE_FRAG, { autoExposure: true, localTone: true }));
  assert.ok(both.includes('eyeStops(scene, 3.0)') && both.includes('uniform float uAODebug;'));
  assert.throws(() => patchCompositeAO('void main() {}'), /anchor not found/);
});
