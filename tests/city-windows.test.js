import test from 'node:test';
import assert from 'node:assert/strict';
import { addWindowLights, addStreetGrid, WINDOW_DEFAULTS } from '../src/environment/city-windows.js';

/** Enough of THREE for the injectors, plus a shader recorder. */
function fakeThree() {
  return {
    Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
    Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    Color: class { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } },
  };
}

/** A material stub that captures what the injection produced. */
function compile(apply, { vertex, fragment } = {}) {
  const THREE = fakeThree();
  const material = { userData: {} };
  apply(material, THREE);
  const shader = {
    uniforms: {},
    vertexShader: vertex ?? 'void main() {\n#include <begin_vertex>\n}',
    fragmentShader: fragment ?? 'void main() {\n#include <opaque_fragment>\n}',
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('neither injection contains a backtick', () => {
  // The shaders are JS template literals. A backtick inside a GLSL comment
  // ends the string and takes the whole module out with a parse error — which
  // is not a render bug, it is an import failure, so nothing draws at all.
  for (const apply of [addWindowLights, addStreetGrid]) {
    const shader = compile(apply);
    for (const key of ['vertexShader', 'fragmentShader']) {
      const injected = shader[key];
      assert.ok(!/`/.test(injected), `${apply.name} ${key} contains a backtick`);
    }
  }
});

test('neither injection declares a GLSL ES reserved word', () => {
  for (const apply of [addWindowLights, addStreetGrid]) {
    const shader = compile(apply);
    const src = `${shader.vertexShader}\n${shader.fragmentShader}`;
    for (const word of ['half', 'fixed', 'input', 'output', 'flat', 'long', 'short', 'double']) {
      const declared = new RegExp(`\\b(vec[234]|float|int|bool)\\s+${word}\\b`);
      assert.ok(!declared.test(src), `${apply.name} declares "${word}", a reserved word`);
    }
  }
});

test('windows are injected at opaque_fragment and keep the include', () => {
  const shader = compile(addWindowLights);
  assert.ok(shader.fragmentShader.includes('#include <opaque_fragment>'),
    'dropping the include removes the fragment output entirely');
  assert.ok(shader.fragmentShader.includes('outgoingLight +='),
    'windows must ADD light; diffuseColor is already folded in by this point');
});

test('the street grid writes outgoingLight, never diffuseColor', () => {
  const shader = compile(addStreetGrid);
  const body = shader.fragmentShader;
  // By <opaque_fragment> Lambert has already folded diffuseColor into the
  // lighting, so writing it there is computed correctly and invisible. That
  // is exactly what the first version of the roads did.
  assert.ok(!/diffuseColor\.rgb\s*=/.test(body),
    'assigns diffuseColor at opaque_fragment, where nothing will see it');
  assert.ok(/outgoingLight\s*=\s*mix/.test(body), 'roads must modify outgoingLight');
});

test('the shared world-position varying is declared at most once', () => {
  // The street grid and the atmosphere both want vBirbWorld and either can
  // run first. Declared twice the shader does not compile, and Three then
  // silently draws nothing — which is how the city lost its entire ground.
  const shader = compile(addStreetGrid, {
    vertex: 'varying vec3 vBirbWorld;\nvoid main() {\n#include <begin_vertex>\n}',
    fragment: 'varying vec3 vBirbWorld;\nvoid main() {\n#include <opaque_fragment>\n}',
  });
  const count = (s) => (s.match(/varying vec3 vBirbWorld;/g) || []).length;
  assert.equal(count(shader.vertexShader), 1, 'vertex declares vBirbWorld twice');
  assert.equal(count(shader.fragmentShader), 1, 'fragment declares vBirbWorld twice');
});

test('the shared varying IS declared when nothing else provides it', () => {
  const shader = compile(addStreetGrid);
  assert.ok(shader.vertexShader.includes('varying vec3 vBirbWorld;'));
  assert.ok(shader.fragmentShader.includes('varying vec3 vBirbWorld;'));
});

test('applying an injection twice is a no-op', () => {
  const THREE = fakeThree();
  const material = { userData: {} };
  addWindowLights(material, THREE);
  const first = material.onBeforeCompile;
  addWindowLights(material, THREE);
  assert.equal(material.onBeforeCompile, first, 'double-injected shaders declare everything twice');
});

test('window light colours are HDR, or they will not bloom', () => {
  // The bloom pass thresholds the TONE-MAPPED frame, and Neutral tone mapping
  // rolls anything near 1.0 back under the knee. A window at 1.0 does not
  // glow; it is just a pale square.
  assert.ok(Math.max(...WINDOW_DEFAULTS.warm) > 1.5, 'warm windows are not over 1.0');
  assert.ok(Math.max(...WINDOW_DEFAULTS.cool) > 1.5, 'cool windows are not over 1.0');
});

test('roughly half the windows are lit', () => {
  // At 0.9 the facade reads as one glowing slab and the grid — which is what
  // gives the building its scale — disappears.
  assert.ok(WINDOW_DEFAULTS.litFraction > 0.2 && WINDOW_DEFAULTS.litFraction < 0.7,
    `litFraction ${WINDOW_DEFAULTS.litFraction} loses the grid`);
});

test('the window pitch is in world units and human-sized', () => {
  const [w, h] = WINDOW_DEFAULTS.pitch;
  assert.ok(w > 0.8 && w < 4, `window pitch ${w} across is not a window`);
  assert.ok(h > w, 'floors should be taller than windows are wide');
});
