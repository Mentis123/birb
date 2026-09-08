import test from 'node:test';
import assert from 'node:assert/strict';
import { addEnergyRing, ENERGY_RING_DEFAULTS } from '../src/effects/energy-ring.js';
import { DRONE_LOOK } from '../src/nesting/drone-look.js';

const THREE = {
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
};

function compile(options = {}) {
  const material = { userData: {} };
  addEnergyRing(material, THREE, { value: 0 }, options);
  const shader = {
    uniforms: {},
    vertexShader: 'void main() {\n#include <begin_vertex>\n}',
    fragmentShader: 'void main() {\n#include <opaque_fragment>\n}',
  };
  material.onBeforeCompile(shader, {});
  return { material, shader };
}

test('the ring REPLACES outgoingLight rather than adding to it', () => {
  // It is emitted light with no surface to shade. Adding would leave whatever
  // the base material computed underneath, which for a MeshBasicMaterial is
  // its flat colour — the thing this replaced.
  const { shader } = compile();
  assert.ok(/outgoingLight = uRingGlow/.test(shader.fragmentShader));
});

test('the opaque_fragment include survives the injection', () => {
  const { shader } = compile();
  assert.ok(shader.fragmentShader.includes('#include <opaque_fragment>'),
    'dropping it removes the fragment output entirely');
});

test('the shader source carries no backtick and no reserved word', () => {
  const { shader } = compile();
  const src = `${shader.vertexShader}\n${shader.fragmentShader}`;
  assert.ok(!src.includes('`'), 'a backtick ends the JS template literal');
  for (const word of ['half', 'fixed', 'input', 'output', 'flat', 'long', 'short', 'double']) {
    assert.ok(!new RegExp(`\\b(vec[234]|float|int|bool)\\s+${word}\\b`).test(src),
      `declares "${word}", reserved in GLSL ES`);
  }
});

test('the glow is HDR, or it will not bloom', () => {
  // The bloom pass thresholds the TONE-MAPPED frame, so a ring at 1.0 rolls
  // back under the knee and glows by nothing.
  assert.ok(Math.max(...ENERGY_RING_DEFAULTS.glow) > 1.5);
  assert.ok(Math.max(...DRONE_LOOK.ringGlow) > 1.5);
});

test('the ring is never mostly dark between pulses', () => {
  // These rings are what the player has to see and steer through. Two earlier
  // passes went too far in both directions: a 50/50 duty cycle at full
  // brightness is a barber's pole, and near-black between pulses is a
  // readability regression wearing an art department's clothes.
  assert.ok(ENERGY_RING_DEFAULTS.base >= 0.25,
    `base ${ENERGY_RING_DEFAULTS.base} leaves the ring mostly unlit`);
  assert.ok(ENERGY_RING_DEFAULTS.base <= 0.6,
    'with the base this high there is no pulse left to see');
});

test('the pulse count and speed reach the shader as usable uniforms', () => {
  const { shader } = compile({ pulses: 12, speed: 0.75 });
  // Pre-divided by 2*PI so the shader turns an angle straight into segments.
  assert.ok(Math.abs(shader.uniforms.uRingCount.value - 12 / (Math.PI * 2)) < 1e-9);
  assert.equal(shader.uniforms.uRingSpeed.value, 0.75);
});

test('two rings with different settings do not share a compiled program', () => {
  const a = compile({ tag: 'drone' }).material.customProgramCacheKey();
  const b = compile({ tag: 'slalom-gate' }).material.customProgramCacheKey();
  assert.notEqual(a, b, 'both call sites would inherit whichever compiled first');
});

test('applying it twice is a no-op', () => {
  const material = { userData: {} };
  addEnergyRing(material, THREE, { value: 0 });
  const first = material.onBeforeCompile;
  addEnergyRing(material, THREE, { value: 0 });
  assert.equal(material.onBeforeCompile, first);
});

test('the time uniform is shared, not copied', () => {
  // A copy would freeze the pulses at whatever the value was on the frame the
  // material happened to compile.
  const shared = { value: 0 };
  const material = { userData: {} };
  addEnergyRing(material, THREE, shared);
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <opaque_fragment>' };
  material.onBeforeCompile(shader, {});
  shared.value = 42;
  assert.equal(shader.uniforms.uRingTime.value, 42);
});
