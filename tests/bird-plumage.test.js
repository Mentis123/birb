/**
 * The Bronze-winged Pionus plumage.
 *
 * What is pinned here is the part that can break silently. A wrong colour is
 * loud — you open the game and the bird is the wrong bird. A shader patch that
 * stops running is not: three logs nothing when an onBeforeCompile is
 * overwritten by a later one, and a material that quietly shares a compiled
 * program with a different material renders the OTHER material's shader with
 * no error at all. Both have happened in this repo, to `addFoliageWind` and to
 * `addRimLight`'s constant cache key respectively.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { addFeatherSheen, pionusPlumageRequested, addRimLight } from '../src/environment/visual-style.js';

const THREE = {
  Color: class { constructor(hex) { this.hex = hex; } },
  Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
};
// The chunks three actually hands onBeforeCompile: INCLUDES, unexpanded.
const FRAG = ['void main() {', '#include <opaque_fragment>', '}'].join('\n');
const lit = () => ({ isMeshStandardMaterial: true, userData: {} });

test('the flag defaults on and only ?pionus=0 turns it off', () => {
  assert.equal(pionusPlumageRequested(''), true);
  assert.equal(pionusPlumageRequested('?debug=1'), true);
  assert.equal(pionusPlumageRequested('?pionus=0'), false);
  assert.equal(pionusPlumageRequested('?debug=1&pionus=0'), false);
  assert.equal(pionusPlumageRequested('?pionus=1'), true);
  // Not fooled by a longer key that merely starts the same way.
  assert.equal(pionusPlumageRequested('?pionuses=0'), true);
});

test('the sheen lands before the lighting is resolved, not after', () => {
  const m = lit();
  addFeatherSheen(m, THREE);
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: '' };
  m.onBeforeCompile(shader, null);
  const write = shader.fragmentShader.indexOf('outgoingLight +=');
  const anchor = shader.fragmentShader.indexOf('#include <opaque_fragment>');
  assert.ok(write >= 0 && anchor > write, 'the sheen must be added before outgoingLight becomes gl_FragColor');
});

test('the sheen MULTIPLIES the light rather than adding a flat term', () => {
  // A flat additive lifts a dark material far more than a bright one, which
  // would wash the dark flight feathers to grey while doing nothing on the
  // bronze it exists for.
  const m = lit();
  addFeatherSheen(m, THREE);
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: '' };
  m.onBeforeCompile(shader, null);
  assert.match(shader.fragmentShader, /outgoingLight \+= outgoingLight \* sheenTint/);
});

test('the sheen CHAINS whatever patch is already on the material', () => {
  // The rim light registers first and must survive. addFoliageWind assigned
  // onBeforeCompile outright and erased an existing patch silently; nothing
  // caught it because the only other patch there happened to run second.
  const m = lit();
  addRimLight(m, THREE);
  addFeatherSheen(m, THREE);
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: '' };
  m.onBeforeCompile(shader, null);
  assert.match(shader.fragmentShader, /uBirbRimColor/, 'the rim light was erased');
  assert.match(shader.fragmentShader, /uSheenWarm/, 'the sheen did not run');
  assert.ok(shader.uniforms.uBirbRimColor && shader.uniforms.uSheenWarm,
    'both patches must contribute their uniforms');
});

test('a sheened material cannot share a program with a rim-only one', () => {
  // addRimLight returns a CONSTANT key, so without this the wing and the body
  // would compile once and one of them would render the other`s shader.
  const wing = lit(); addRimLight(wing, THREE); addFeatherSheen(wing, THREE);
  const body = lit(); addRimLight(body, THREE);
  assert.notEqual(wing.customProgramCacheKey(), body.customProgramCacheKey());
  assert.match(wing.customProgramCacheKey(), /-sheen$/);
});

test('the sheen refuses a material that has no normal to work with', () => {
  // MeshBasicMaterial has no vNormal and no vViewPosition: this would not look
  // wrong, it would fail to COMPILE, and three then draws nothing at all.
  assert.equal(addFeatherSheen({ isMeshBasicMaterial: true, userData: {} }, THREE), null);
  assert.equal(addFeatherSheen(null, THREE), null);
});

test('installing the sheen twice does not double-inject it', () => {
  const m = lit();
  const first = addFeatherSheen(m, THREE);
  assert.equal(addFeatherSheen(m, THREE), first);
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: '' };
  m.onBeforeCompile(shader, null);
  assert.equal((shader.fragmentShader.match(/uniform vec3 uSheenWarm/g) || []).length, 1);
});
