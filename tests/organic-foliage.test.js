/**
 * Wave B of the organic pass — the leaf edge, snow on upward faces, and the
 * ground bump. Plus the two latent bugs building it exposed, which are the
 * tests most worth having:
 *
 *  - `addFoliageWind` ASSIGNED `onBeforeCompile` and set a CONSTANT
 *    `customProgramCacheKey`. Any patch already on a foliage material was
 *    erased, silently. Nothing caught it because the only other patch on
 *    those materials chains and happened to run afterwards.
 *  - `addAtmosphere` guarded its `varying` declaration but replaced
 *    <begin_vertex> unconditionally, so a second patch wanting the same
 *    world position declared `birbWorldPos` twice — 140 shader compile
 *    failures, and three draws NOTHING for a material whose shader fails,
 *    so the page still paints and a screenshot harness still exits zero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addFoliageWind, addAtmosphere, addLeafEdge, addUpwardSnow,
  leafEdgeRequested, upwardSnowRequested,
} from '../src/environment/visual-style.js';
import { addGroundDetail } from '../src/environment/ground-detail.js';
import { authoredGroundBumpRequested, GROUND_BUMP_STRENGTH } from '../src/environment/authored-textures.js';

const THREE = {
  Color: class { constructor(c) { this.hex = c; } },
  Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
};

// three's real chunk order: alphatest runs BEFORE normals, which is why the
// leaf edge cannot use `normal` and must carry its own normal varying.
const FRAG = [
  'void main() {',
  '#include <map_fragment>',
  '#include <color_fragment>',
  '#include <alphatest_fragment>',
  '#include <normal_fragment_begin>',
  '#include <opaque_fragment>',
  '}',
].join('\n');
const VERT = [
  'void main() {',
  '#include <beginnormal_vertex>',
  '#include <begin_vertex>',
  '#include <project_vertex>',
  '}',
].join('\n');

const mat = () => ({ userData: {} });
function compile(material) {
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: VERT };
  material.onBeforeCompile(shader, null);
  return shader;
}
const count = (hay, needle) => hay.split(needle).length - 1;

// ── flags ───────────────────────────────────────────────────────────────
test('each Wave B effect has its own escape hatch', () => {
  assert.equal(leafEdgeRequested(''), true);
  assert.equal(leafEdgeRequested('?leaves=0'), false);
  assert.equal(upwardSnowRequested('?snowline=0'), false);
  assert.equal(upwardSnowRequested('?leaves=0'), true, 'flags are independent');
  assert.equal(authoredGroundBumpRequested('?groundbump=0'), false);
  // The ground bump rides the authored ground map, so ?authored=0 takes it too.
  assert.equal(authoredGroundBumpRequested('?authored=0'), false);
});

// ── the latent bug: the wind used to erase whatever it landed on ────────
test('addFoliageWind CHAINS rather than replacing an existing patch', () => {
  const m = mat();
  let ranFirst = false;
  m.onBeforeCompile = () => { ranFirst = true; };
  m.customProgramCacheKey = () => 'earlier';
  addFoliageWind(m);
  compile(m);
  assert.ok(ranFirst, 'the patch that was already there still runs');
  assert.match(m.customProgramCacheKey(), /^earlier-/, 'and its cache key survives');
});

test('two foliage materials with different leaf settings cannot share a program', () => {
  const a = mat(); addFoliageWind(a); addLeafEdge(a, THREE, { key: 'canopy0' });
  const b = mat(); addFoliageWind(b); addLeafEdge(b, THREE, { key: 'cloudF', cut: 0.34 });
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
});

// ── the latent bug: two patches, one varying, 140 compile failures ──────
test('the shared world varying is declared exactly once however many patches want it', () => {
  for (const order of [['leaf', 'atmos'], ['atmos', 'leaf']]) {
    const m = mat();
    for (const which of order) {
      if (which === 'leaf') addLeafEdge(m, THREE, {});
      else addAtmosphere(m, THREE, { baseRadius: 120 });
    }
    const sh = compile(m);
    assert.equal(count(sh.vertexShader, 'varying vec3 vBirbWorld;'), 1, `${order}: one declaration`);
    assert.equal(count(sh.vertexShader, 'vec4 birbWorldPos'), 1, `${order}: one birbWorldPos`);
    assert.equal(count(sh.fragmentShader, 'varying vec3 vBirbWorld;'), 1, `${order}: one in the fragment`);
  }
});

test('the world position includes the instance transform', () => {
  // <begin_vertex> runs BEFORE <project_vertex>, where three applies the
  // instance matrix — so modelMatrix alone puts every instance of a tree at
  // the world origin, and every prop this patches is instanced.
  const m = mat(); addLeafEdge(m, THREE, {});
  assert.match(compile(m).vertexShader, /#ifdef USE_INSTANCING\s*\n\s*birbWorldPos = instanceMatrix \* birbWorldPos;/);
});

// ── B1 ──────────────────────────────────────────────────────────────────
test('the leaf edge goes through three\'s alpha test, not a bare discard', () => {
  const m = mat(); addLeafEdge(m, THREE, {});
  // USE_ALPHATEST is defined off material.alphaTest; without it
  // <alphatest_fragment> is a no-op and the erosion discards nothing.
  assert.equal(m.alphaTest, 0.5);
  assert.equal(m.alphaToCoverage, true);
  const f = compile(m).fragmentShader;
  assert.ok(f.indexOf('diffuseColor.a *=') < f.indexOf('#include <alphatest_fragment>'));
  assert.ok(!/\bdiscard\b/.test(f), 'no hand-rolled discard');
});

test('the leaf rim uses the GEOMETRY normal, never the facet normal', () => {
  // A lathe canopy has seven radial segments: a facet normal is constant
  // across a third of the crown, so thresholding on it dissolved whole
  // faces instead of cutting a band at the silhouette.
  const m = mat(); addLeafEdge(m, THREE, {});
  const sh = compile(m);
  assert.match(sh.fragmentShader, /vec3 leN = normalize\(vBirbNormalW\)/);
  assert.ok(!/leN = normalize\(cross\(dFdx/.test(sh.fragmentShader));
  assert.match(sh.vertexShader, /vBirbNormalW = mat3\(modelMatrix\) \* birbNrm/);
});

test('the leaf noise is in WORLD space, so it does not swim with the camera', () => {
  const f = compile(addLeafEdge(mat(), THREE, {})).fragmentShader;
  assert.match(f, /birbLeafNoise\(vBirbWorld \* uLeafScale\)/);
  assert.ok(!/gl_FragCoord/.test(f), 'nothing screen-space feeds the mask');
});

test('the leaf noise is continuous — every trilinear corner is a unit corner', () => {
  // One corner read vec3(1.0, 1.1, 1.0) and that is a seam, not a texture.
  const f = compile(addLeafEdge(mat(), THREE, {})).fragmentShader;
  const corners = [...f.matchAll(/birbLeafHash\(i \+ vec3\(([^)]*)\)\)/g)].map((m) => m[1]);
  assert.equal(corners.length, 8, 'eight corners');
  for (const c of corners) {
    for (const v of c.split(',').map((n) => Number(n.trim()))) {
      assert.ok(v === 0 || v === 1, `corner component ${v} is not 0 or 1`);
    }
  }
});

// ── B2 ──────────────────────────────────────────────────────────────────
test('snow is written before the lighting resolves, not after', () => {
  // Lambert folds diffuseColor into outgoingLight by <opaque_fragment>; a
  // write there changes nothing at all, which this repo has paid for once.
  const f = compile(addUpwardSnow(mat(), THREE, {})).fragmentShader;
  const at = f.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor');
  assert.ok(at > f.indexOf('#include <color_fragment>'), 'after the vertex colour');
  assert.ok(at < f.indexOf('#include <opaque_fragment>'), 'before the lighting');
});

test('"up" is radial, never world +Y — this is a planet', () => {
  const f = compile(addUpwardSnow(mat(), THREE, {})).fragmentShader;
  assert.match(f, /vec3 snUp = normalize\(vBirbWorld\)/);
});

test('snow and the leaf edge coexist on one material', () => {
  // Both want the same two varyings; both must chain.
  const m = mat();
  addFoliageWind(m);
  addUpwardSnow(m, THREE, { key: 'pine' });
  addLeafEdge(m, THREE, { key: 'pine' });
  const sh = compile(m);
  assert.equal(count(sh.vertexShader, 'varying vec3 vBirbWorld;'), 1);
  assert.equal(count(sh.vertexShader, 'varying vec3 vBirbNormalW;'), 1);
  assert.equal(count(sh.vertexShader, 'vec3 birbNrm = objectNormal;'), 1);
  assert.match(sh.fragmentShader, /uSnowColor/);
  assert.match(sh.fragmentShader, /uLeafCut/);
  assert.match(sh.vertexShader, /uBirbWind/);
});

// ── B3 ──────────────────────────────────────────────────────────────────
const groundMap = { tile: 18, sharpness: 4, gain: { r: 1, g: 1, b: 1 } };
function ground(opts) {
  const m = mat();
  addGroundDetail(m, THREE, { baseRadius: 120, biome: 'forest', ...opts });
  return { material: m, shader: compile(m) };
}

test('the bump reuses the colour fetches — three texture2D calls, not six', () => {
  const { shader } = ground({ groundMap, smooth: true, bump: GROUND_BUMP_STRENGTH });
  assert.equal(count(shader.fragmentShader, 'texture2D(uGroundMap'), 3);
});

test('the bump is inert on the flat path, where a facet normal would eat it', () => {
  const flat = ground({ groundMap, smooth: false, bump: GROUND_BUMP_STRENGTH });
  assert.equal(flat.shader.uniforms.uGroundBump.value, 0);
  const smooth = ground({ groundMap, smooth: true, bump: GROUND_BUMP_STRENGTH });
  assert.ok(smooth.shader.uniforms.uGroundBump.value > 0);
});

test('the bump fades with view distance before it can alias', () => {
  const { shader } = ground({ groundMap, smooth: true, bump: 7 });
  assert.match(shader.fragmentShader, /gdFade = exp\(-length\(cameraPosition - vBirbWorld\) \* 0\.08\)/);
  assert.match(shader.fragmentShader, /gdGrad \* uGroundBump \* gdFade/);
});

test('a bumped ground cannot share a program with an unbumped one', () => {
  assert.notEqual(
    ground({ groundMap, smooth: true, bump: 7 }).material.customProgramCacheKey(),
    ground({ groundMap, smooth: true, bump: 0 }).material.customProgramCacheKey(),
  );
});

test('a ground with no authored map emits no sampler and no bump at all', () => {
  const { shader } = ground({ smooth: true, bump: 7 });
  assert.ok(!/uGroundBump/.test(shader.fragmentShader));
  assert.ok(!/texture2D\(uGroundMap/.test(shader.fragmentShader));
});
