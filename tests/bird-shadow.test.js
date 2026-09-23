/**
 * The bird's analytic sun shadow (src/effects/bird-shadow.js): three
 * ellipsoids, a closed-form soft shadow each. The JS mirror is the GLSL line
 * for line, so the geometry is pinned here without a GPU.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ellipsoidVisibility, ellipsoidRows, BIRD_SHADOW_GLSL, BIRD_SHADOW_DEFAULTS,
  birdShadowUniforms, ensureBirdShadowUniforms,
} from '../src/effects/bird-shadow.js';

const up = [0, 1, 0];
// A wing-like ellipsoid: 1.6 half-span along X, 0.3 half-chord along Z,
// 0.08 half-thickness along Y, centred 6 units above the origin.
const C = [0, 6, 0];
const wing = (thick = 0.08) => ellipsoidRows([[1, 0, 0], [0, 0, 1], [0, 1, 0]], [1.6, 0.3, thick]);
const sunOverhead = [0, 1, 0];
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

test('an occluder between the point and the sun shadows it', () => {
  assert.equal(ellipsoidVisibility([0, 0, 0], sunOverhead, C, wing()), 0);
  // Under the wing's outer half too, not only under its centre.
  assert.equal(ellipsoidVisibility([1.2, 0, 0], sunOverhead, C, wing()), 0);
});

test('a point the sun ray misses by a wide margin is lit', () => {
  assert.equal(ellipsoidVisibility([5, 0, 0], sunOverhead, C, wing()), 1, 'well past the wingtip');
  assert.equal(ellipsoidVisibility([0, 0, 3], sunOverhead, C, wing()), 1, 'well ahead of the leading edge');
});

test('an occluder on the far side of the point from the sun casts nothing on it', () => {
  // The point is ABOVE the wing and the sun is overhead: the wing is behind it.
  assert.equal(ellipsoidVisibility([0, 12, 0], sunOverhead, C, wing()), 1);
});

test('the shadow falls along the SUN, not straight down', () => {
  // A 30-degree sun from +X puts the shadow of a wing 6 units up about
  // 6 / tan(30) = 10.4 units toward -X.
  const sun = norm([Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]);
  assert.equal(ellipsoidVisibility([-10.4, 0, 0], sun, C, wing()), 0, 'the projected spot is dark');
  assert.equal(ellipsoidVisibility([0, 0, 0], sun, C, wing()), 1, 'straight below is not');
});

test('contact hardening: the same miss is lit close up and in penumbra far away', () => {
  // A point whose sun ray passes 0.4 units beyond the wingtip. Near the
  // wing that is outside the penumbra; far below it the penumbra has widened.
  const tipMiss = 1.6 + 0.4;
  const near = ellipsoidVisibility([tipMiss, 5, 0], sunOverhead, C, wing());   // 1 unit below
  const far = ellipsoidVisibility([tipMiss, -14, 0], sunOverhead, C, wing());  // 20 units below
  assert.equal(near, 1);
  assert.ok(far < 0.9 && far > 0, `far below it is partly shaded (${far.toFixed(3)})`);
});

test('the penumbra is measured in WORLD units: a thinner wing does not smear its shadow sideways', () => {
  // The first cut took d / t in the unit sphere's space. The ray's distance
  // there is scaled by 1 / thickness, so a thin wing's penumbra spread over
  // metres. Same span, same miss past the tip, different thickness: the
  // answer must not move.
  const p = [1.6 + 0.6, -8, 0];
  const thin = ellipsoidVisibility(p, sunOverhead, C, wing(0.03));
  const thick = ellipsoidVisibility(p, sunOverhead, C, wing(0.3));
  assert.ok(Math.abs(thin - thick) < 0.02, `thin ${thin.toFixed(3)} vs thick ${thick.toFixed(3)}`);
});

test('rows are axis / half-extent, and zero rows are an inert slot', () => {
  const rows = ellipsoidRows([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [2, 4, 8]);
  assert.deepEqual(rows, [[0.5, 0, 0], [0, 0.25, 0], [0, 0, 0.125]]);
  assert.equal(ellipsoidVisibility([0, 0, 0], sunOverhead, [0, 5, 0], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]), 1);
});

test('the uniforms start inert: strength 0 until the driver writes a bird', () => {
  ensureBirdShadowUniforms(null);
  assert.equal(birdShadowUniforms.uBirdShadowE.value.length, 36);
  assert.ok(birdShadowUniforms.uBirdShadowE.value.every((v) => v === 0));
  assert.equal(birdShadowUniforms.uBirdShadowP.value.x, 0);
  assert.equal(birdShadowUniforms.uBirdShadowP.value.z, BIRD_SHADOW_DEFAULTS.fadeEnd);
});

test('the GLSL early-outs beyond the fade and mirrors the JS reference', () => {
  assert.match(BIRD_SHADOW_GLSL, /if \( far >= uBirdShadowP\.z \) return 1\.0;/);
  assert.match(BIRD_SHADOW_GLSL, /float missW = \( dist - 1\.0 \) \* length\( u \* inv \);/);
  assert.match(BIRD_SHADOW_GLSL, /float alongW = -b \/ rl;/);
  // Three solids, the darkest wins (min), so an overlap cannot double-darken.
  assert.equal(BIRD_SHADOW_GLSL.split('v = min( v, birbEllipsoidVis(').length - 1, 2);
});
