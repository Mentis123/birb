import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPointSize } from '../src/environment/visual-style.js';

function compile(maxPixels) {
  const material = { userData: {} };
  clampPointSize(material, {}, maxPixels);
  const shader = {
    uniforms: {},
    vertexShader: 'void main() {\n\tgl_PointSize = size;\n\t#include <logdepthbuf_vertex>\n}',
  };
  material.onBeforeCompile(shader, {});
  return { material, shader };
}

test('the clamp is injected AFTER gl_PointSize is assigned', () => {
  const { shader } = compile(40);
  const assign = shader.vertexShader.indexOf('gl_PointSize = size;');
  const clamp = shader.vertexShader.indexOf('gl_PointSize = min(gl_PointSize');
  assert.ok(assign >= 0 && clamp > assign,
    'clamping before the assignment silently does nothing');
});

test('the clamp runs before the chunks that read gl_PointSize', () => {
  const { shader } = compile(40);
  const clamp = shader.vertexShader.indexOf('gl_PointSize = min(gl_PointSize');
  const logdepth = shader.vertexShader.indexOf('#include <logdepthbuf_vertex>');
  assert.ok(clamp < logdepth);
  assert.ok(shader.vertexShader.includes('#include <logdepthbuf_vertex>'),
    'the chunk must survive the replacement');
});

test('the ceiling is a uniform, and it is the value asked for', () => {
  const { shader } = compile(64);
  assert.equal(shader.uniforms.uBirbMaxPoint.value, 64);
  assert.ok(shader.vertexShader.includes('uniform float uBirbMaxPoint;'));
});

test('two ceilings do not share one compiled program', () => {
  // Three caches programs; identical onBeforeCompile closures would make every
  // particle system inherit whichever ceiling compiled first.
  const a = compile(40).material.customProgramCacheKey();
  const b = compile(64).material.customProgramCacheKey();
  assert.notEqual(a, b);
});

test('applying it twice is a no-op', () => {
  const material = { userData: {} };
  clampPointSize(material, {}, 40);
  const first = material.onBeforeCompile;
  clampPointSize(material, {}, 40);
  assert.equal(material.onBeforeCompile, first,
    'double injection declares the uniform twice and the shader stops compiling');
});

test('an existing onBeforeCompile is chained, not replaced', () => {
  const material = { userData: {} };
  let ran = false;
  material.onBeforeCompile = () => { ran = true; };
  clampPointSize(material, {}, 40);
  material.onBeforeCompile({ uniforms: {}, vertexShader: '#include <logdepthbuf_vertex>' }, {});
  assert.ok(ran, 'the previous injection was dropped');
});
