/**
 * The horizon/bird shadow material patch (src/environment/horizon-shadow.js).
 *
 * Three failure modes this repo has already paid for, each pinned here:
 *
 *  - A patch that ASSIGNS onBeforeCompile erases whatever was there
 *    (addFoliageWind did, silently, for months). This one chains.
 *  - Two patches that both declare one varying do not compile, and three then
 *    draws NOTHING for that material (140 failures, once). The world varying
 *    is declared once however many patches want it.
 *  - An escape hatch that is not a true before is not evidence (the smooth
 *    splice once emitted one extra blank line). With both flags off the patch
 *    is not applied at all, and the atmosphere's output is byte-identical to
 *    the atmosphere alone.
 *
 * The fragment template below is three r183's MeshLambertMaterial chunk
 * ORDER (the real anchors, unexpanded, as onBeforeCompile receives them).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addHorizonShadow, horizonShadowRequested, horizonUniforms, setHorizonStrength,
  ensureHorizonUniforms, HORIZON_SHADOW_DEFAULTS,
} from '../src/environment/horizon-shadow.js';
import { birdShadowRequested } from '../src/effects/bird-shadow.js';
import { addAtmosphere, addLeafEdge, addUpwardSnow, addFoliageWind } from '../src/environment/visual-style.js';

const THREE = {
  Color: class { constructor(c) { this.hex = c; } },
  Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } },
  Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } },
  Vector4: class { constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; } },
};

const FRAG = [
  '#define LAMBERT',
  'uniform vec3 diffuse;',
  '#include <common>',
  '#include <bsdfs>',
  '#include <lights_pars_begin>',
  '#include <normal_pars_fragment>',
  '#include <lights_lambert_pars_fragment>',
  '#include <shadowmap_pars_fragment>',
  'void main() {',
  '\tvec4 diffuseColor = vec4( diffuse, opacity );',
  '\t#include <map_fragment>',
  '\t#include <color_fragment>',
  '\t#include <alphatest_fragment>',
  '\t#include <normal_fragment_begin>',
  '\t#include <lights_lambert_fragment>',
  '\t#include <lights_fragment_begin>',
  '\t#include <lights_fragment_maps>',
  '\t#include <lights_fragment_end>',
  '\t#include <aomap_fragment>',
  '\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
  '\t#include <envmap_fragment>',
  '\t#include <opaque_fragment>',
  '}',
].join('\n');
const VERT = [
  'void main() {',
  '#include <beginnormal_vertex>',
  '#include <begin_vertex>',
  '#include <project_vertex>',
  '}',
].join('\n');

const lambert = () => ({ isMeshLambertMaterial: true, userData: {} });
function compile(material) {
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: VERT };
  material.onBeforeCompile(shader, null);
  return shader;
}
const count = (hay, needle) => hay.split(needle).length - 1;

test('each shadow has its own escape hatch, read the way every other opt-out is', () => {
  assert.equal(horizonShadowRequested(''), true);
  assert.equal(horizonShadowRequested('?debug=1'), true);
  assert.equal(horizonShadowRequested('?horizon=0'), false);
  assert.equal(horizonShadowRequested('?debug=1&horizon=0&env=city'), false);
  assert.equal(horizonShadowRequested('?horizon=0.5'), true, 'only an exact 0 opts out');
  assert.equal(birdShadowRequested('?birdshadow=0'), false);
  assert.equal(birdShadowRequested('?horizon=0'), true, 'the flags are independent');
});

test('with both shadows off the patch is not applied at all', () => {
  const m = lambert();
  addHorizonShadow(m, THREE, { horizon: false, birdShadow: false });
  assert.equal(m.onBeforeCompile, undefined);
  assert.equal(m.customProgramCacheKey, undefined);
  assert.equal(m.userData.birbHorizon, undefined);
});

test('the atmosphere is byte-identical with the patch off, and its rim only reads the sun visibility when the patch ran first', () => {
  const alone = lambert(); addAtmosphere(alone, THREE, { baseRadius: 120 });
  const off = lambert();
  addHorizonShadow(off, THREE, { horizon: false, birdShadow: false });
  addAtmosphere(off, THREE, { baseRadius: 120 });
  const a = compile(alone); const b = compile(off);
  assert.equal(b.fragmentShader, a.fragmentShader);
  assert.equal(b.vertexShader, a.vertexShader);
  assert.match(a.fragmentShader, /uBirbSunRim \* uBirbAtmos\);/, 'the rim as it always was');
  assert.ok(!a.fragmentShader.includes('birbSunVis'));

  const on = lambert();
  addHorizonShadow(on, THREE, { receiver: 'ground' });
  addAtmosphere(on, THREE, { baseRadius: 120 });
  assert.match(compile(on).fragmentShader, /uBirbSunRim \* uBirbAtmos \* birbSunVis\);/,
    'a rim in a ridge\'s shadow is not lit by the sun');
});

test('the patch CHAINS: what was already on the material still runs, and its cache key survives', () => {
  const m = lambert();
  let ran = 0;
  m.onBeforeCompile = () => { ran += 1; };
  m.customProgramCacheKey = () => 'earlier';
  addHorizonShadow(m, THREE, { receiver: 'prop' });
  compile(m);
  assert.equal(ran, 1);
  assert.match(m.customProgramCacheKey(), /^earlier-horizon-/);
});

test('the sun visibility is applied INSIDE three\'s light loop, to the light that is the sun', () => {
  const m = lambert();
  addHorizonShadow(m, THREE, { receiver: 'ground' });
  const f = compile(m).fragmentShader;
  // The wrapper exists after lights_pars_begin (where DirectionalLight and
  // IncidentLight are defined) and multiplies the matched light's colour.
  const wrapper = f.indexOf('void birbHorizonDirInfo');
  assert.ok(wrapper > f.indexOf('#include <lights_pars_begin>'));
  assert.ok(wrapper < f.indexOf('void main()'));
  assert.match(f, /getDirectionalLightInfo\( dl, light \);\s*if \( dot\( light\.direction, birbSunView \) > uHorizonParams\.w \) light\.color \*= birbSunVis;/);
  // The macro spans exactly the light loop: defined before the include,
  // undefined straight after it, so nothing else is rewritten.
  const def = f.indexOf('#define getDirectionalLightInfo( dl, l ) birbHorizonDirInfo( dl, l )');
  const loop = f.indexOf('#include <lights_fragment_begin>');
  const undef = f.indexOf('#undef getDirectionalLightInfo');
  assert.ok(def > 0 && def < loop && loop < undef, 'define, loop, undef — in that order');
  // The visibility is computed before the loop reads it.
  assert.ok(f.indexOf('birbSunVis = mix( 1.0, hzLit, hzStrength );') < def);
  // Before the shadow map multiplies the same light (it does so inside the
  // loop, after getDirectionalLightInfo), so the two compose by product —
  // never a subtraction that can take the sun away twice.
  assert.ok(!/outgoingLight\s*-=/.test(f), 'no after-the-fact subtraction');
});

test('the sky visibility scales the indirect light where three applies its own AO', () => {
  const f = compile(addHorizonShadow(lambert(), THREE, { receiver: 'ground' })).fragmentShader;
  const sky = f.indexOf('reflectedLight.indirectDiffuse *= birbSkyVis;');
  const ao = f.indexOf('#include <aomap_fragment>');
  assert.ok(sky > f.indexOf('#include <lights_fragment_end>') && sky < ao && ao - sky < 60);
  assert.ok(sky < f.indexOf('vec3 outgoingLight'), 'before the light is summed');
});

test('ground and props read their own sets; props shed a skyline they stand above', () => {
  ensureHorizonUniforms(THREE);
  const g = compile(addHorizonShadow(lambert(), THREE, { receiver: 'ground' }));
  const p = compile(addHorizonShadow(lambert(), THREE, { receiver: 'prop' }));
  assert.equal(g.uniforms.uHorizonA, horizonUniforms.groundA);
  assert.equal(g.uniforms.uHorizonB, horizonUniforms.groundB);
  assert.equal(p.uniforms.uHorizonA, horizonUniforms.propA);
  assert.equal(p.uniforms.uHorizonB, horizonUniforms.propB);
  assert.ok(p.fragmentShader.includes('#define BIRB_HORIZON_LIFT'));
  assert.ok(!g.fragmentShader.includes('#define BIRB_HORIZON_LIFT'), 'the ground IS the envelope');
  const gm = addHorizonShadow(lambert(), THREE, { receiver: 'ground' });
  const pm = addHorizonShadow(lambert(), THREE, { receiver: 'prop' });
  assert.notEqual(gm.customProgramCacheKey(), pm.customProgramCacheKey(),
    'different GLSL, different program');
});

test('the uv and frame in the GLSL are horizon-map.js\'s conventions, letter for letter', () => {
  const f = compile(addHorizonShadow(lambert(), THREE, { receiver: 'ground' })).fragmentShader;
  assert.match(f, /atan\( hzUp\.z, -hzUp\.x \) \* 0\.15915494/, 'u = atan2(z, -x) / 2PI');
  assert.match(f, /acos\( clamp\( hzUp\.y, -1\.0, 1\.0 \) \) \* 0\.31830989/, 'v = acos(y) / PI');
  assert.match(f, /vec3 hzE = vec3\( hzUp\.z, 0\.0, -hzUp\.x \)/, 'East = Y x up');
  assert.match(f, /vec3 hzN = cross\( hzUp, hzE \)/, 'North = up x East');
  assert.match(f, /\( texture2D\( uHorizonA, hzUv \) - 0\.5 \) \* 3\.14159265/, 'byte -> angle');
  // Up is RADIAL on this planet, never world +Y.
  assert.match(f, /vec3 hzUp = normalize\( vBirbWorld \)/);
});

test('one world varying however many patches want it, in either order', () => {
  for (const order of [['horizon', 'atmos', 'leaf', 'snow'], ['leaf', 'snow', 'horizon', 'atmos']]) {
    const m = lambert();
    addFoliageWind(m);
    for (const which of order) {
      if (which === 'horizon') addHorizonShadow(m, THREE, { receiver: 'prop' });
      else if (which === 'atmos') addAtmosphere(m, THREE, { baseRadius: 120 });
      else if (which === 'leaf') addLeafEdge(m, THREE, {});
      else addUpwardSnow(m, THREE, {});
    }
    const sh = compile(m);
    assert.equal(count(sh.vertexShader, 'varying vec3 vBirbWorld;'), 1, `${order}: vertex`);
    assert.equal(count(sh.fragmentShader, 'varying vec3 vBirbWorld;'), 1, `${order}: fragment`);
    assert.equal(count(sh.vertexShader, 'vec4 birbWorldPos'), 1, `${order}: one write`);
    assert.equal(count(sh.fragmentShader, 'float birbSunVis'), 1);
  }
});

test('the bird-only path carries no horizon map, and the horizon-only path no ellipsoids', () => {
  const bird = compile(addHorizonShadow(lambert(), THREE, { horizon: false, birdShadow: true })).fragmentShader;
  assert.ok(bird.includes('#define BIRB_BIRD_SHADOW'));
  assert.ok(!bird.includes('#define BIRB_HORIZON_MAP'));
  assert.ok(bird.includes('float birbBirdShadow('));
  const hz = compile(addHorizonShadow(lambert(), THREE, { horizon: true, birdShadow: false })).fragmentShader;
  assert.ok(hz.includes('#define BIRB_HORIZON_MAP'));
  assert.ok(!hz.includes('#define BIRB_BIRD_SHADOW'));
  assert.ok(!hz.includes('float birbBirdShadow('), 'no ellipsoid code is even declared');
  assert.ok(!hz.includes('uniform vec3 uBirdShadowE'));
});

test('a fragment that already receives the real shadow map does not get a second bird shadow', () => {
  const f = compile(addHorizonShadow(lambert(), THREE, { receiver: 'ground' })).fragmentShader;
  assert.match(f, /#ifdef USE_SHADOWMAP\s*\/\/[^\n]*\n[^\n]*\n\s*if \( receiveShadow \) hzBird = 1\.0;/);
});

test('only lit, non-shader materials are patched', () => {
  const basic = { isMeshBasicMaterial: true, userData: {} };
  addHorizonShadow(basic, THREE, {});
  assert.equal(basic.onBeforeCompile, undefined);
  const shaderMat = { isShaderMaterial: true, isMeshLambertMaterial: true, userData: {} };
  addHorizonShadow(shaderMat, THREE, {});
  assert.equal(shaderMat.onBeforeCompile, undefined);
  // And a lit material missing the light anchors is left alone, not
  // half-patched (three draws nothing for a shader that fails).
  const odd = lambert();
  addHorizonShadow(odd, THREE, {});
  const sh = { uniforms: {}, fragmentShader: 'void main() {}', vertexShader: VERT };
  odd.onBeforeCompile(sh, null);
  assert.equal(sh.fragmentShader, 'void main() {}');
});

test('the live strength clamps to 0..1 and 0 is the old light', () => {
  ensureHorizonUniforms(THREE);
  assert.equal(setHorizonStrength(0), 0);
  assert.equal(setHorizonStrength(3), 1);
  assert.equal(setHorizonStrength(-1), 0);
  assert.equal(setHorizonStrength(NaN), HORIZON_SHADOW_DEFAULTS.strength);
  setHorizonStrength(1);
});
