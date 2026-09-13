/**
 * The organic pass — smooth soil, pointy rocks, trees that grew.
 *
 * What these pin, and why each one is here rather than being obvious:
 *
 *  - `?smooth=0` must be a TRUE before. The flat path has to emit the exact
 *    shader this module shipped with, or the A/B compares the new world
 *    against something that never existed.
 *  - The slope that decides soil against rock must move WITH the shading. It
 *    was deliberately taken from the facet normal, which is right for a
 *    flat-shaded surface and wrong the moment the surface is lit per
 *    fragment: a boundary constant per triangle painted across smooth
 *    lighting snaps at every triangle edge.
 *  - A tree that hosts a nest must NOT lean. The nest is placed radially
 *    above the trunk base, so a tilted champion walks its own perch out of
 *    its crown — and nothing else in the codebase would notice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { smoothShadingRequested, treeLean, rockShape } from '../src/environment/visual-style.js';
import { addGroundDetail, GROUND_PROFILES } from '../src/environment/ground-detail.js';

const THREE = {
  Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
};
// The chunks three actually hands onBeforeCompile: INCLUDES, unexpanded.
// Faking an expanded shader is how the feather-detail patch shipped green
// against a string three never passes.
const FRAG = [
  'void main() {',
  '#include <normal_fragment_begin>',
  '#include <normal_fragment_maps>',
  '#include <opaque_fragment>',
  '}',
].join('\n');
const VERT = ['void main() {', '#include <begin_vertex>', '}'].join('\n');

function compile(opts) {
  const material = { userData: {} };
  addGroundDetail(material, THREE, { baseRadius: 120, biome: 'forest', ...opts });
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: VERT };
  material.onBeforeCompile(shader, null);
  return { frag: shader.fragmentShader, key: material.customProgramCacheKey() };
}

// ── the flag ────────────────────────────────────────────────────────────
test('smooth shading is the default and ?smooth=0 is the only way off', () => {
  assert.equal(smoothShadingRequested(''), true);
  assert.equal(smoothShadingRequested('?debug=1'), true);
  assert.equal(smoothShadingRequested('?smooth=0'), false);
  assert.equal(smoothShadingRequested('?debug=1&smooth=0'), false);
  assert.equal(smoothShadingRequested('?smooth=1'), true);
  // Not fooled by a longer key that merely starts the same way.
  assert.equal(smoothShadingRequested('?smoothness=0'), true);
});

// ── the ground shader ───────────────────────────────────────────────────
test('the flat path touches only <opaque_fragment>, exactly as it always has', () => {
  const flat = compile({ smooth: false });
  assert.ok(!/gdShadeSlope/.test(flat.frag), 'no smooth-path symbols leak into flat');
  // The facet cross product is still computed in the tint block, which is
  // where it belongs when the surface is flat-shaded.
  assert.match(flat.frag, /vec3 gdN = normalize\(cross\(dFdx\(gdP\), dFdy\(gdP\)\)\)/);
  // <normal_fragment_begin> is left alone: nothing is injected after it.
  assert.match(flat.frag, /#include <normal_fragment_begin>\n#include <normal_fragment_maps>/);
});

test('the smooth path bends the LIGHTING normal, which only works before lighting', () => {
  const smooth = compile({ smooth: true });
  // At <opaque_fragment> three has already folded diffuse into the lighting,
  // so a normal written there changes nothing. It must land here.
  const atBegin = smooth.frag.indexOf('#include <normal_fragment_begin>');
  const blend = smooth.frag.indexOf('normal = normalize(mix(');
  const atOpaque = smooth.frag.indexOf('#include <opaque_fragment>');
  assert.ok(atBegin >= 0 && blend > atBegin, 'blend sits after normal_fragment_begin');
  assert.ok(blend < atOpaque, 'blend sits BEFORE the lighting is resolved');
});

test('the smooth path reads the slope before it overwrites the normal', () => {
  // Otherwise the slope measures its own output and the rock term runs away.
  const f = compile({ smooth: true }).frag;
  assert.ok(f.indexOf('float gdShadeSlope') < f.indexOf('normal = normalize(mix('));
});

test('the smooth path takes its slope from the smooth normal, not the facet', () => {
  const f = compile({ smooth: true }).frag;
  assert.match(f, /vec3 gdSmoothW = inverseTransformDirection\(normal, viewMatrix\)/);
  assert.match(f, /float gdShadeSlope = 1\.0 - clamp\(dot\(gdSmoothW, gdUpW\)/);
  // …and does NOT recompute a facet slope in the tint block.
  assert.ok(!/float gdSlope = 1\.0 - clamp\(dot\(gdN, gdUp\)/.test(f));
  assert.match(f, /float gdSlope = gdShadeSlope/);
});

test('the facet normal survives — rock has to keep its facets', () => {
  const f = compile({ smooth: true }).frag;
  assert.match(f, /vec3 gdFacetW = normalize\(cross\(dFdx\(vBirbWorld\), dFdy\(vBirbWorld\)\)\)/);
  // Blended in by the SAME slope range the tint uses for rock, so the
  // shading boundary and the material boundary cannot drift apart.
  assert.match(f, /smoothstep\(uGdSlopeRange\.x, uGdSlopeRange\.y, gdShadeSlope\)/);
});

test('the two paths cannot share a compiled program', () => {
  // Identical onBeforeCompile closures share a program and every material
  // gets whichever variant compiled first.
  assert.notEqual(compile({ smooth: true }).key, compile({ smooth: false }).key);
  assert.match(compile({ smooth: true }).key, /-smooth$/);
});

test('every biome profile has a slope range the blend can actually use', () => {
  for (const [biome, p] of Object.entries(GROUND_PROFILES)) {
    assert.ok(p.slopeEnd > p.slopeStart, `${biome}: slopeEnd must exceed slopeStart`);
    assert.ok(p.slopeStart > 0 && p.slopeEnd < 1, `${biome}: slope range within (0,1)`);
  }
});

// ── the lean ────────────────────────────────────────────────────────────
test('a nest host never leans, and costs no draws from the stream', () => {
  let draws = 0;
  const rng = () => { draws += 1; return 0.5; };
  assert.equal(treeLean(rng, true), null);
  assert.equal(draws, 0);
});

test('a decorative tree leans between 1 and 3 degrees, in some bearing', () => {
  let seed = 1;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i += 1) {
    const lean = treeLean(rng, false);
    const angle = Math.hypot(lean.x, lean.z);
    assert.ok(angle >= 0.017 - 1e-9 && angle <= 0.052 + 1e-9, `angle ${angle} out of 1-3 degrees`);
  }
});

test('the lean is deterministic in the RNG it is handed', () => {
  const stream = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
  assert.deepEqual(treeLean(stream(7), false), treeLean(stream(7), false));
  assert.notDeepEqual(treeLean(stream(7), false), treeLean(stream(8), false));
});

test('treeLean always draws exactly two values when it leans', () => {
  // The seeded world stream must advance identically whether a given tree
  // ends up leaning or not... except for nest hosts, which draw none. Pin
  // the leaning count so a future third draw is a deliberate choice.
  let draws = 0;
  treeLean(() => { draws += 1; return 0.25; }, false);
  assert.equal(draws, 2);
});

// ── the rocks ───────────────────────────────────────────────────────────
test('a rock gets three independent axes, and max is the longest of them', () => {
  let seed = 99;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i += 1) {
    const r = rockShape(rng, 3);
    assert.equal(r.max, Math.max(r.x, r.y, r.z));
    assert.ok(r.max >= 3 * 0.60, 'never collapses below the flattest draw');
    assert.ok(r.max <= 3 * 1.30 + 1e-9, 'never exceeds the longest draw');
    assert.ok(r.sink > 0, 'always sits into the ground rather than on it');
  }
});

test('the collider must use max, not the uniform scale it replaced', () => {
  // The forest rock collider was exactly `1.0 * s` — the dodecahedron's true
  // extent under a uniform scale. The long axis now reaches up to 1.30 s, so
  // a collider left at s would be escaped by the rock's own geometry.
  const r = rockShape(() => 1, 2);          // every draw at its maximum
  assert.ok(r.max > 2, 'the long axis really does exceed the old radius');
  assert.ok(Math.abs(r.max - 2.6) < 1e-9, `max ${r.max} should be 1.30x the scale`);
});

test('rockShape draws exactly three values', () => {
  let draws = 0;
  rockShape(() => { draws += 1; return 0.5; }, 1);
  assert.equal(draws, 3);
});
