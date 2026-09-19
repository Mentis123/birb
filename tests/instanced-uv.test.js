import test from 'node:test';
import assert from 'node:assert/strict';
import { addInstancedUvScale } from '../src/environment/authored-textures.js';

/**
 * addInstancedUvScale never touches THREE directly -- it only reads/writes
 * plain fields on the material and shader objects three's WebGLProgram
 * machinery would otherwise provide. So the fake here is smaller than
 * authored-textures.test.js's: no TextureLoader, no Texture, just a material
 * that can carry an onBeforeCompile closure and a shader object shaped like
 * the one three hands that closure (uniforms + a vertexShader string with the
 * two include markers the function replaces).
 */
function fakeMaterial() {
  return { onBeforeCompile: undefined, customProgramCacheKey: undefined };
}

function fakeShader() {
  return {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() {\n\t#include <uv_vertex>\n}\n',
  };
}

function compile(material) {
  const shader = fakeShader();
  material.onBeforeCompile(shader, {});
  return shader;
}

test('cylinder shape (the default) is unchanged: formula present, box branch absent', () => {
  const material = fakeMaterial();
  addInstancedUvScale(material, {}); // shape omitted -> 'cylinder'
  const shader = compile(material);

  assert.match(shader.vertexShader, /6\.28318530718 \* uBirbUnitRadius/,
    'the circumference formula must still be emitted for the default shape');
  assert.doesNotMatch(shader.vertexShader, /birbSz/,
    'the box branch (which needs the Z instance-scale axis) must not appear on the cylinder path');
  assert.ok(shader.uniforms.uBirbUnitRadius, 'cylinder path needs the unit-radius uniform');
  assert.equal(shader.uniforms.uBirbUnitRadius.value, 1);
});

test('explicit shape: "cylinder" matches the default', () => {
  const material = fakeMaterial();
  addInstancedUvScale(material, {}, { shape: 'cylinder', unitRadius: 0.6 });
  const shader = compile(material);
  assert.match(shader.vertexShader, /6\.28318530718 \* uBirbUnitRadius/);
  assert.equal(shader.uniforms.uBirbUnitRadius.value, 0.6);
});

test('box shape emits the face-normal branch and not the circumference formula', () => {
  const material = fakeMaterial();
  addInstancedUvScale(material, {}, { shape: 'box' });
  const shader = compile(material);

  assert.doesNotMatch(shader.vertexShader, /6\.28318530718/,
    'a box face is not a circumference -- the cylinder constant must not leak in');
  assert.match(shader.vertexShader, /birbSz/, 'the box branch needs all three instance-scale axes');
  assert.match(shader.vertexShader, /\babs\(\s*normal\s*\)/,
    'the box branch must read the raw normal ATTRIBUTE, not objectNormal (uv_vertex runs before beginnormal_vertex)');
  assert.doesNotMatch(shader.vertexShader, /objectNormal/,
    'objectNormal does not exist yet at <uv_vertex> in the meshlambert template; using it would be a ReferenceError at shader compile time');
  // The box path has no meaning for unitRadius, so it must not declare the
  // uniform the cylinder path needs -- a stray declared-but-unused uniform is
  // harmless in GLSL, but its absence is the cheapest proof the box branch
  // really took a different path through the function, not just a different
  // string spliced into the same one.
  assert.equal(shader.uniforms.uBirbUnitRadius, undefined);
});

test('cache keys differ by shape (and everything else the key is built from)', () => {
  const cylMat = fakeMaterial();
  addInstancedUvScale(cylMat, {}, { shape: 'cylinder', tileMetres: 4.3, unitRadius: 1 });
  const boxMat = fakeMaterial();
  addInstancedUvScale(boxMat, {}, { shape: 'box', tileMetres: 4.3, unitRadius: 1 });

  const cylKey = cylMat.customProgramCacheKey();
  const boxKey = boxMat.customProgramCacheKey();
  assert.notEqual(cylKey, boxKey,
    'a cylinder-shaped and a box-shaped material must never share a compiled program -- one branch is dead code in the other');
  assert.match(cylKey, /cylinder/);
  assert.match(boxKey, /box/);
});

test('an existing onBeforeCompile and customProgramCacheKey are chained, not replaced', () => {
  const material = fakeMaterial();
  let previousRan = false;
  material.onBeforeCompile = (shader) => {
    previousRan = true;
    shader.uniforms.uPrevious = { value: 42 };
  };
  material.customProgramCacheKey = () => 'previous-key';

  addInstancedUvScale(material, {}, { shape: 'box' });
  const shader = compile(material);

  assert.equal(previousRan, true, 'the prior onBeforeCompile must still run');
  assert.equal(shader.uniforms.uPrevious.value, 42, 'its uniforms must survive');
  assert.match(material.customProgramCacheKey(), /^previous-key-instuv-box-/,
    'the prior cache key must be the base the new one extends, not discarded');
});

test('an unknown shape throws rather than silently using the wrong formula', () => {
  const material = fakeMaterial();
  assert.throws(() => addInstancedUvScale(material, {}, { shape: 'sphere' }), /unknown shape/);
});

test('USE_MAP / USE_NORMALMAP gating survives the injection on both shapes', () => {
  for (const shape of ['cylinder', 'box']) {
    const material = fakeMaterial();
    addInstancedUvScale(material, {}, { shape });
    const shader = compile(material);
    assert.match(shader.vertexShader, /#ifdef USE_MAP[\s\S]*?vMapUv \*= birbRepeat;/,
      `${shape}: map UVs must still be scaled behind USE_MAP`);
    assert.match(shader.vertexShader, /#ifdef USE_NORMALMAP[\s\S]*?vNormalMapUv \*= birbRepeat;/,
      `${shape}: normal-map UVs must still be scaled behind USE_NORMALMAP`);
    assert.match(shader.vertexShader, /#ifdef USE_INSTANCING/,
      `${shape}: the whole injection must stay gated behind USE_INSTANCING`);
  }
});
