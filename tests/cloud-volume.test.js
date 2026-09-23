/**
 * Clouds with volume, at mesh cost — src/environment/cloud-volume.js.
 *
 * The integral is tested against brute-force numerical integration, because
 * a closed form that is subtly wrong looks exactly as soft as one that is
 * right. The patches are tested against three's REAL chunk order (the
 * include lines, not an expanded shader — see the feather-sheet note in
 * CLAUDE.md for what a more convenient fake costs), and against the real
 * addAtmosphere, since the two share the world-position varying and a
 * double declaration is a shader that draws nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cloudVolumeRequested, CLOUD_VOLUME, CLOUD_SHADOW, chordDepth, sphereDepthFrom,
  cloudShadowVisibility, cloudImmersion, cloudShadowSphere, extraCloudPuffs,
  setCloudShadowSpheres, cloudShadowUniforms, cloudVolumeUniforms, setCloudVolumeTuning,
  addCloudVolume, addCloudShadow, createCloudImmersion, createCloudsInfo, CLOUD_CHORD_GLSL,
  createCloudSorter, countSlotInversions, setCloudFocusObject, updateCloudFocus, CLOUD_OWN_ATTRIBUTE,
} from '../src/environment/cloud-volume.js';
import { addAtmosphere, visualUniforms } from '../src/environment/visual-style.js';

const THREE = {
  DoubleSide: 2,
  FrontSide: 0,
  Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } },
  Color: class { constructor() { this.r = 1; this.g = 1; this.b = 1; } },
};

// three 0.183's meshlambert_frag / _vert include order, as onBeforeCompile
// receives them (includes NOT expanded).
const FRAG = [
  '#define LAMBERT',
  'uniform vec3 diffuse;',
  '#include <common>',
  '#include <lights_pars_begin>',
  'void main() {',
  '\tvec4 diffuseColor = vec4( diffuse, opacity );',
  '\t#include <clipping_planes_fragment>',
  '\t#include <map_fragment>',
  '\t#include <color_fragment>',
  '\t#include <alphatest_fragment>',
  '\t#include <normal_fragment_begin>',
  '\t#include <lights_fragment_begin>',
  '\t#include <lights_fragment_end>',
  '\t#include <aomap_fragment>',
  '\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
  '\t#include <opaque_fragment>',
  '\t#include <tonemapping_fragment>',
  '\t#include <colorspace_fragment>',
  '\t#include <fog_fragment>',
  '}',
].join('\n');
const VERT = [
  '#define LAMBERT',
  'void main() {',
  '\t#include <beginnormal_vertex>',
  '\t#include <begin_vertex>',
  '\t#include <project_vertex>',
  '}',
].join('\n');

const lambert = () => ({ isMeshLambertMaterial: true, userData: {}, transparent: false, opacity: 0.7, side: 0 });
function compile(material) {
  const shader = { uniforms: {}, fragmentShader: FRAG, vertexShader: VERT };
  material.onBeforeCompile(shader, null);
  return shader;
}
const count = (hay, needle) => hay.split(needle).length - 1;

// ── the flag ───────────────────────────────────────────────────────────────
test('?cloudvol=0 is the only way off', () => {
  assert.equal(cloudVolumeRequested(''), true);
  assert.equal(cloudVolumeRequested('?debug=1'), true);
  assert.equal(cloudVolumeRequested('?cloudvol=0'), false);
  assert.equal(cloudVolumeRequested('?debug=1&cloudvol=0&env=mountain'), false);
  assert.equal(cloudVolumeRequested('?cloudvol=1'), true);
  assert.equal(cloudVolumeRequested('?leaves=0'), true, 'flags are independent');
});

// ── the integral ───────────────────────────────────────────────────────────
// Brute force: integrate 1 - |o + t d|^2 over the part of the ray inside the
// unit sphere with t >= 0, scaled by 3/4 so a full diameter reads 1.
function numericDepth(o, d, steps = 40000) {
  let s = 0;
  const T = 6;
  const dt = T / steps;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const x = o[0] + d[0] * t; const y = o[1] + d[1] * t; const z = o[2] + d[2] * t;
    const rho = 1 - (x * x + y * y + z * z);
    if (rho > 0) s += rho * dt;
  }
  return 0.75 * s;
}
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

test('the chord integral: 1 through the centre, 0 at a graze, 1/2 from the centre out', () => {
  assert.ok(Math.abs(chordDepth(1, -1) - 1) < 1e-12);
  assert.equal(chordDepth(0, 0), 0);
  assert.ok(Math.abs(chordDepth(1, 0) - 0.5) < 1e-12);
  // Full chord at impact parameter p is (1 - p^2)^1.5: soft to exactly zero.
  for (const p of [0, 0.3, 0.6, 0.9, 0.99]) {
    const h = Math.sqrt(1 - p * p);
    assert.ok(Math.abs(chordDepth(h, -h) - h ** 3) < 1e-12, `p=${p}`);
  }
});

test('the closed form matches brute-force integration, from outside and from inside', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 40; k++) {
    const inside = k % 2 === 0;
    const r = inside ? 0.95 * rnd() : 1.05 + 2 * rnd();
    const o = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]).map((v) => v * r);
    // Aim roughly at the sphere so most rays hit it.
    const aim = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]).map((v) => v * 0.8 * rnd());
    const d = unit([aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]]);
    const exact = sphereDepthFrom(o[0], o[1], o[2], d[0], d[1], d[2]);
    const brute = numericDepth(o, d);
    assert.ok(Math.abs(exact - brute) < 2e-4, `ray ${k}: closed form ${exact} vs numeric ${brute}`);
  }
});

test('a sphere behind the eye or off to the side contributes nothing', () => {
  assert.equal(sphereDepthFrom(0, 0, 3, 0, 0, 1), 0, 'behind');
  assert.equal(sphereDepthFrom(0, 2, 3, 0, 0, -1), 0, 'missed');
  assert.ok(sphereDepthFrom(0, 0, 3, 0, 0, -1) > 0.999, 'straight through');
});

// ── real cloud shadows ────────────────────────────────────────────────────
test('a cloud shadow is dark under the cloud, absent beside it and soft between', () => {
  const spheres = new Float32Array([0, 50, 0, 10]);
  const sun = [0, 1, 0];
  const s = CLOUD_SHADOW.strength; const k = CLOUD_SHADOW.opacity;
  const under = cloudShadowVisibility(0, 0, 0, sun, spheres, 1);
  assert.ok(Math.abs(under - (1 - s * (1 - Math.exp(-k)))) < 1e-9, `under the centre: ${under}`);
  assert.equal(cloudShadowVisibility(30, 0, 0, sun, spheres, 1), 1, 'beside it');
  assert.equal(cloudShadowVisibility(0, 70, 0, sun, spheres, 1), 1, 'above it: the cloud is behind as seen from the sun');
  // Walk out from under the centre: monotonic, and never a step.
  let prev = under;
  for (let x = 0.2; x <= 10.4; x += 0.2) {
    const v = cloudShadowVisibility(x, 0, 0, sun, spheres, 1);
    assert.ok(v >= prev - 1e-12, `monotonic at x=${x}`);
    assert.ok(v - prev < 0.08, `no hard edge at x=${x.toFixed(1)}: ${prev.toFixed(3)} -> ${v.toFixed(3)}`);
    prev = v;
  }
  // The soft band is wide: between 10% and 90% of the full darkening spans
  // well over a tenth of the radius.
  const depth = (x) => 1 - cloudShadowVisibility(x, 0, 0, sun, spheres, 1);
  const full = depth(0);
  let x90 = 0; let x10 = 0;
  for (let x = 0; x <= 10; x += 0.01) { if (depth(x) >= 0.9 * full) x90 = x; if (depth(x) >= 0.1 * full) x10 = x; }
  assert.ok(x10 - x90 > 2, `penumbra ${(x10 - x90).toFixed(2)} of a 10-unit radius`);
});

test('the shadow follows the sun, and the atmosphere switch still turns it off', () => {
  const spheres = new Float32Array([0, 50, 0, 10]);
  const slant = [Math.sin(0.6), Math.cos(0.6), 0];
  const along = 50 * Math.tan(0.6);
  assert.ok(cloudShadowVisibility(-along, 0, 0, slant, spheres, 1) < 0.2, 'downwind of the cloud');
  assert.equal(cloudShadowVisibility(0, 0, 0, slant, spheres, 1) > 0.9, true, 'no longer straight under it');
  assert.equal(cloudShadowVisibility(0, 0, 0, [0, 1, 0], spheres, 1, CLOUD_SHADOW.strength, CLOUD_SHADOW.opacity, 0), 1);
  assert.equal(cloudShadowVisibility(0, 0, 0, [0, 1, 0], spheres, 0), 1, 'count 0 is no clouds');
});

test('setCloudShadowSpheres fills the shared array, caps at the uniform size, and clears', () => {
  const many = Array.from({ length: CLOUD_SHADOW.max + 5 }, (_, i) => ({ x: i, y: 2, z: 3, r: 4 }));
  assert.equal(setCloudShadowSpheres(many), CLOUD_SHADOW.max);
  assert.equal(cloudShadowUniforms.count.value, CLOUD_SHADOW.max);
  assert.deepEqual(Array.from(cloudShadowUniforms.spheres.value.slice(4, 8)), [1, 2, 3, 4]);
  assert.equal(setCloudShadowSpheres(null), 0);
  assert.equal(cloudShadowUniforms.spheres.value.every((v) => v === 0), true);
});

test('one sphere per cloud: exact for one puff, covering for a cluster', () => {
  const dr = CLOUD_VOLUME.densityRadius;
  const one = cloudShadowSphere([{ x: 1, y: 2, z: 3, r: 10 }]);
  assert.deepEqual(one, { x: 1, y: 2, z: 3, r: 10 * dr });
  const cluster = [{ x: -8, y: 0, z: 0, r: 6 }, { x: 8, y: 0, z: 0, r: 6 }, { x: 0, y: 3, z: 0, r: 8 }];
  const s = cloudShadowSphere(cluster);
  assert.ok(Math.abs(s.x) < 1e-9, 'symmetric cluster, centred');
  for (const p of cluster) {
    const reach = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) + p.r * dr;
    assert.ok(s.r >= 0.85 * reach - 1e-9, 'reaches most of every puff');
  }
});

// ── immersion ────────────────────────────────────────────────────────────
test('camera immersion is 1 at a puff centre, 0 at its density edge and outside', () => {
  const puffs = new Float32Array([0, 0, 0, 10, 50, 0, 0, 5]);
  const dr = CLOUD_VOLUME.densityRadius;
  assert.equal(cloudImmersion(0, 0, 0, puffs, 2), 1);
  assert.ok(Math.abs(cloudImmersion(10 * dr, 0, 0, puffs, 2)) < 1e-9);
  assert.equal(cloudImmersion(0, 30, 0, puffs, 2), 0);
  assert.ok(cloudImmersion(50, 0, 0, puffs, 2) === 1, 'the deepest puff wins');
});

test('the in-cloud fog rises inside a puff, is zero outside it, and resets', () => {
  const puffs = new Float32Array([0, 0, 0, 10]);
  const imm = createCloudImmersion(puffs, 1);
  imm.update(0, 30, 0);
  assert.equal(cloudShadowUniforms.fog.value[0], 0);
  imm.update(0, 0, 0);
  assert.ok(cloudShadowUniforms.fog.value[0] > 0.5);
  imm.update(0, 0, 0.5);
  imm.reset();
  assert.equal(cloudShadowUniforms.fog.value[0], 0);
  assert.equal(imm.immersion, 0);
});

// ── back to front ────────────────────────────────────────────────────────
// The builders' own matrix for a puff: position, uniform scale, no rotation.
function builderMatrices(puffs, count) {
  const m = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const s = puffs[i * 4 + 3];
    m.set([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, puffs[i * 4], puffs[i * 4 + 1], puffs[i * 4 + 2], 1], i * 16);
  }
  return m;
}

test('the sorter draws the farthest puff first and rewrites nothing when nothing moved', () => {
  // Four puffs on a line; the camera walks along it and back.
  const puffs = new Float32Array([0, 0, 0, 3, 10, 0, 0, 4, 20, 0, 0, 5, 30, 0, 0, 6]);
  const m = builderMatrices(puffs, 4);
  const s = createCloudSorter(puffs, 4, m);
  // Camera before puff 0: the build order (0..3) draws nearest first, which
  // is exactly wrong — every neighbouring pair is inverted.
  assert.equal(countSlotInversions(m, 4, -10, 0, 0), 3);
  assert.equal(s.update(-10, 0, 0), true);
  assert.deepEqual(Array.from(s.order), [3, 2, 1, 0]);
  assert.equal(countSlotInversions(m, 4, -10, 0, 0), 0);
  // Camera past the far end: the build order is right again.
  assert.equal(s.update(40, 0, 0), true);
  assert.deepEqual(Array.from(s.order), [0, 1, 2, 3]);
  assert.equal(countSlotInversions(m, 4, 40, 0, 0), 0);
  // A small step that swaps nothing rewrites nothing.
  const writes = s.writes;
  assert.equal(s.update(39, 0.5, 0), false);
  assert.equal(s.writes, writes);
  // Every slot holds a matrix bit-identical to one the builder wrote.
  assert.equal(s.update(-10, 0, 0), true);
  const built = builderMatrices(puffs, 4);
  for (let k = 0; k < 4; k++) {
    assert.deepEqual(Array.from(m.subarray(k * 16, k * 16 + 16)), Array.from(built.subarray(s.order[k] * 16, s.order[k] * 16 + 16)));
  }
  // Reset is the build order again, and says whether it changed anything.
  assert.equal(s.reset(), true);
  assert.deepEqual(Array.from(m), Array.from(built));
  assert.equal(s.reset(), false);
});

test('a per-instance attribute moves with its puff through every re-sort', () => {
  const puffs = new Float32Array([0, 0, 0, 3, 10, 0, 0, 4, 20, 0, 0, 5]);
  const m = builderMatrices(puffs, 3);
  // Each puff's "own cloud" sphere, tagged by index so a mix-up shows.
  const own = new Float32Array([100, 0, 0, 1, 200, 0, 0, 2, 300, 0, 0, 3]);
  const out = own.slice();
  const s = createCloudSorter(puffs, 3, m, { perPuff: own, perPuffOut: out });
  assert.equal(s.update(-10, 0, 0), true);
  for (let k = 0; k < 3; k++) {
    const i = s.order[k];
    assert.equal(m[k * 16 + 12], puffs[i * 4], 'matrix slot k holds puff i');
    assert.deepEqual(Array.from(out.subarray(k * 4, k * 4 + 4)), Array.from(own.subarray(i * 4, i * 4 + 4)), 'and so does the attribute');
  }
  s.reset();
  assert.deepEqual(Array.from(out), Array.from(own));
});

test('the sorter agrees with a full sort from anywhere, and a disabled one holds still', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const n = 80;
  const puffs = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) puffs.set([rnd() * 200 - 100, 150 + rnd() * 40, rnd() * 200 - 100, 4 + rnd() * 10], i * 4);
  const m = builderMatrices(puffs, n);
  const s = createCloudSorter(puffs, n, m);
  for (let k = 0; k < 30; k++) {
    const x = rnd() * 400 - 200; const y = 100 + rnd() * 120; const z = rnd() * 400 - 200;
    s.update(x, y, z);
    const d = (i) => (puffs[i * 4] - x) ** 2 + (puffs[i * 4 + 1] - y) ** 2 + (puffs[i * 4 + 2] - z) ** 2;
    const expected = Array.from({ length: n }, (_, i) => i).sort((a, b) => d(b) - d(a));
    assert.deepEqual(Array.from(s.order).map(d), expected.map(d), `camera ${k}`);
    assert.equal(countSlotInversions(m, n, x, y, z), 0);
  }
  s.enabled = false;
  s.reset();
  assert.equal(s.update(0, 400, 0), false, 'a disabled sorter writes nothing');
  assert.deepEqual(Array.from(m), Array.from(builderMatrices(puffs, n)));
});

test('switching the sort off puts BOTH per-instance buffers back, and flags both for upload', () => {
  const puffs = new Float32Array([0, 0, 0, 3, 10, 0, 0, 4, 20, 0, 0, 5]);
  const matrices = builderMatrices(puffs, 3);
  const own = new Float32Array([100, 0, 0, 1, 200, 0, 0, 2, 300, 0, 0, 3]);
  const ownAttr = { array: own.slice(), needsUpdate: false };
  const instanceMatrix = { array: matrices, needsUpdate: false };
  const sorter = createCloudSorter(puffs, 3, matrices, { perPuff: own, perPuffOut: ownAttr.array });
  assert.equal(sorter.update(-10, 0, 0), true, 'reversed');
  const mesh = {
    visible: true,
    instanceMatrix,
    material: { transparent: true, depthWrite: false, side: 2, forceSinglePass: true, alphaTest: 0 },
    geometry: { attributes: { position: { count: 240 } }, getAttribute: (n) => (n === CLOUD_OWN_ATTRIBUTE ? ownAttr : undefined) },
  };
  const info = createCloudsInfo(THREE, { volumetric: true, clouds: [{ x: 0, y: 0, z: 0, collider: 6 }], puffs, sorter, mesh });
  info.report({ sort: false });
  assert.equal(instanceMatrix.needsUpdate, true);
  assert.equal(ownAttr.needsUpdate, true, 'a stale cloud sphere would light a puff through ANOTHER cloud');
  assert.deepEqual(Array.from(matrices), Array.from(builderMatrices(puffs, 3)));
  assert.deepEqual(Array.from(ownAttr.array), Array.from(own));
  assert.equal(info.report().sort.enabled, false);
  info.report({ sort: true });
  assert.equal(sorter.enabled, true);
});

test('the focus is the bird when there is one, and far away when there is not', () => {
  const f = cloudVolumeUniforms.focus.value;
  const bird = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 130, -2, 1] } };
  setCloudFocusObject(bird);
  updateCloudFocus();
  assert.deepEqual(Array.from(f), [7, 130, -2]);
  bird.matrixWorld.elements[13] = 140;
  updateCloudFocus();
  assert.equal(f[1], 140, 'read live every frame, not captured once');
  setCloudFocusObject(null);
  updateCloudFocus();
  assert.ok(f[0] > 1e8 && f[1] > 1e8 && f[2] > 1e8, 'no bird: nothing is near a puff but the camera');
});

// ── extra puffs never touch the world's stream ──────────────────────────
test('extra puffs are deterministic, local to the cloud, and draw nothing from Math.random', () => {
  const center = { x: 0, y: 160, z: 0 };
  const real = Math.random;
  Math.random = () => { throw new Error('Math.random called'); };
  try {
    const a = extraCloudPuffs({ center, up: center, cloudScale: 2, count: 3 });
    const b = extraCloudPuffs({ center, up: center, cloudScale: 2, count: 3 });
    assert.deepEqual(a, b, 'same cloud, same puffs');
    const c = extraCloudPuffs({ center: { x: 5, y: 160, z: 0 }, up: { x: 5, y: 160, z: 0 }, cloudScale: 2, count: 3 });
    assert.notDeepEqual(a, c, 'a different cloud gets different puffs');
    for (const p of a) {
      const off = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
      assert.ok(off < 4 * 2 * 1.3, `within the cloud's spread (${off.toFixed(2)})`);
      assert.ok(p.y - center.y > -0.6 * 2 - 1e-9 && p.y - center.y < 1.8 * 2 + 1e-9, 'a little up or down, mostly sideways');
      assert.ok(p.r >= 2.4 * 2 && p.r <= 4.6 * 2);
    }
  } finally {
    Math.random = real;
  }
  assert.deepEqual(extraCloudPuffs({ center, up: center, cloudScale: 2, count: 0 }), []);
});

// ── the geometry the soft edge depends on ────────────────────────────────
test('the lumpy density never reaches the hull: the edge cannot come back hard', () => {
  // IcosahedronGeometry(1, 1): its faces come no closer than 0.9342 to the
  // centre. Density past that would be clipped by a facet.
  assert.ok(CLOUD_VOLUME.densityRadius * (1 + CLOUD_VOLUME.lump) < 0.9342);
});

// ── the puff patch ───────────────────────────────────────────────────────
test('addCloudVolume: transparent, double-sided in ONE pass, no depth write, chained', () => {
  const m = lambert();
  let ranFirst = false;
  m.onBeforeCompile = () => { ranFirst = true; };
  m.customProgramCacheKey = () => 'earlier';
  addCloudVolume(m, THREE);
  assert.equal(m.transparent, true);
  assert.equal(m.depthWrite, false);
  assert.equal(m.side, THREE.DoubleSide);
  assert.equal(m.forceSinglePass, true, 'or three draws a transparent DoubleSide material twice');
  assert.equal(m.opacity, 1);
  const shader = compile(m);
  assert.ok(ranFirst, 'the earlier patch still runs');
  assert.equal(m.customProgramCacheKey(), 'earlier-cloudvol-v1');
  const f = shader.fragmentShader; const v = shader.vertexShader;
  assert.equal(count(v, 'varying vec3 vBirbWorld;'), 1);
  assert.equal(count(v, 'vBirbWorld ='), 1);
  assert.equal(count(f, 'varying vec3 vBirbWorld;'), 1);
  assert.equal(count(v, 'varying vec4 vCloudSphere;'), 1);
  assert.equal(count(f, 'varying vec4 vCloudSphere;'), 1);
  assert.ok(v.indexOf('vCloudSphere = ') > v.indexOf('#include <begin_vertex>'));
  assert.ok(v.includes('instanceMatrix'), 'the per-puff centre comes from the INSTANCE matrix');
  // The cluster term reads the puff's OWN cloud sphere, a per-instance
  // attribute — not a loop over every cloud on the planet per fragment.
  assert.equal(count(v, `attribute vec4 ${CLOUD_OWN_ATTRIBUTE};`), 1);
  assert.equal(count(v, 'varying vec4 vCloudOwn;'), 1);
  assert.equal(count(f, 'varying vec4 vCloudOwn;'), 1);
  assert.ok(v.indexOf('vCloudOwn = ') > v.indexOf('#include <begin_vertex>'));
  assert.ok(!f.includes('uCloudShadowSpheres'), 'no per-fragment loop over every cloud');
  // One face per pixel, chosen by where the camera AND the bird are, and no
  // fade at the hand-over (the chord is from the camera on either face).
  assert.ok(f.includes('gl_FrontFacing == ( cvNear < vCloudSphere.w + uCloudShape.w )'));
  assert.ok(/cvNear = min\( length\( cameraPosition - vCloudSphere\.xyz \), length\( uCloudFocus - vCloudSphere\.xyz \) \)/.test(f));
  assert.equal(shader.uniforms.uCloudFocus, cloudVolumeUniforms.focus);
  assert.ok(!/smoothstep\( 1\.0, 1\.0 [+-] uCloudShape\.w/.test(f), 'no dip at the hull');
  // A ray past the biggest lump leaves before the six sines of the lump.
  const lumpFree = f.indexOf('if ( cvP >= 1.0 + uCloudCluster.z ) discard;');
  assert.ok(lumpFree > 0 && lumpFree < f.indexOf('birbCloudLump( cvM'), 'the lump-free discard runs first');
  // The early block (every discard) runs before three lights anything.
  const early = f.indexOf('float cvTau');
  assert.ok(early > f.indexOf('#include <clipping_planes_fragment>') && early < f.indexOf('#include <map_fragment>'));
  // The lighting replaces the hull's, just ahead of <opaque_fragment>.
  const light = f.indexOf('outgoingLight = diffuseColor.rgb * cvIrr');
  assert.ok(light > f.indexOf('vec3 outgoingLight =') && light < f.indexOf('#include <opaque_fragment>'));
  assert.equal(count(f, '#include <opaque_fragment>'), 1);
  // Radial up, never world +Y.
  assert.ok(f.includes('vec3 cvUp = birbCloudUnit( vCloudSphere.xyz )'));
  // No bare normalize(): normalize(0) is NaN, and one NaN pixel is a black
  // block after the half-res bloom blur. Every unit vector goes through
  // birbCloudUnit, which returns zero for zero.
  assert.equal(count(f, 'normalize('), 0, 'every normalize is guarded');
  assert.ok(f.includes('float d = max( 1.0 + g * g - 2.0 * g * mu, 1e-4 );'), 'HG never divides by zero');
  assert.ok(f.includes('float cvR = max( vCloudSphere.w * uCloudShape.x, 1e-4 );'));
  assert.ok(f.includes('cvRe = max( cvRe, 0.05 );'));
  // Shared uniforms: one object, every puff material.
  assert.equal(shader.uniforms.uCloudShape, cloudVolumeUniforms.shape);
  assert.equal(shader.uniforms.uCloudShadowSpheres, undefined);
  assert.equal(shader.uniforms.uCloudSun, visualUniforms.sunDir);
  // Idempotent.
  const again = m.onBeforeCompile;
  addCloudVolume(m, THREE);
  assert.equal(m.onBeforeCompile, again);
});

// ── the world patch ──────────────────────────────────────────────────────
test('addCloudShadow patches lit materials only', () => {
  const basic = { isMeshBasicMaterial: true, userData: {} };
  assert.equal(addCloudShadow(basic, THREE), basic);
  assert.equal(basic.onBeforeCompile, undefined);
  const shaderMat = { isShaderMaterial: true, isMeshLambertMaterial: true, userData: {} };
  addCloudShadow(shaderMat, THREE);
  assert.equal(shaderMat.onBeforeCompile, undefined);
});

test('cloud shadows and the atmosphere share ONE world varying, in either order', () => {
  for (const order of ['shadow-first', 'atmosphere-first']) {
    const m = lambert();
    if (order === 'shadow-first') { addCloudShadow(m, THREE); addAtmosphere(m, THREE, { cloudStrength: 0 }); }
    else { addAtmosphere(m, THREE, { cloudStrength: 0 }); addCloudShadow(m, THREE); }
    const s = compile(m);
    assert.equal(count(s.vertexShader, 'varying vec3 vBirbWorld;'), 1, order);
    assert.equal(count(s.vertexShader, 'vBirbWorld ='), 1, order);
    assert.equal(count(s.fragmentShader, 'varying vec3 vBirbWorld;'), 1, order);
    assert.equal(count(s.fragmentShader, '#include <aomap_fragment>'), 1, order);
    assert.equal(count(s.fragmentShader, '#include <fog_fragment>'), 1, order);
    assert.equal(count(s.fragmentShader, 'float birbCloudChord'), 1, order);
    // The shadow scales the SUN's light, inside three's light loop, and a
    // share of the sky light ahead of three's AO step — never the summed
    // direct light, which carries the rim and fill as well.
    const f = s.fragmentShader;
    assert.ok(!f.includes('reflectedLight.directDiffuse *='), order);
    const occ = f.indexOf('birbSunVis *= 1.0 - csOcc;');
    assert.ok(occ > 0 && occ < f.indexOf('#include <lights_fragment_begin>'), order);
    assert.equal(count(f, 'birbSkyVis *= 1.0 - csOcc * uCloudShadowParams.z;'), 1, order);
    assert.equal(count(f, 'reflectedLight.indirectDiffuse *= birbSkyVis;'), 1, order);
    assert.ok(f.indexOf('reflectedLight.indirectDiffuse *= birbSkyVis;') < f.indexOf('#include <aomap_fragment>'), order);
    // The in-cloud fog lands after three's own fog, in the output colour
    // space the fragment is already in there.
    const fog = s.fragmentShader.indexOf('linearToOutputTexel( vec4( max( uCloudShadowFog, vec3( 0.0 ) ), 1.0 ) )');
    assert.ok(fog > s.fragmentShader.indexOf('#include <fog_fragment>'), order);
    assert.match(m.customProgramCacheKey(), /cloudshadow-v2/);
    assert.match(m.customProgramCacheKey(), /atmos-v6/);
  }
});

test('a cloud shadow takes the SUN, once, by direction: not the rim, the fill or the sky', () => {
  const m = lambert();
  addCloudShadow(m, THREE);
  const f = compile(m).fragmentShader;
  // One set of globals, one wrapper, one macro span around the light loop.
  assert.equal(count(f, 'float birbSunVis = 1.0;'), 1);
  assert.equal(count(f, 'float birbSkyVis = 1.0;'), 1);
  assert.equal(count(f, 'void birbCloudDirInfo('), 1);
  assert.ok(f.indexOf('void birbCloudDirInfo(') > f.indexOf('#include <lights_pars_begin>'));
  assert.ok(/dot\( light\.direction, birbSunView \) > 0\.9999 \) light\.color \*= birbSunVis;/.test(f),
    'the light scaled is the one shining from the sun');
  const def = f.indexOf('#define getDirectionalLightInfo( dl, l ) birbCloudDirInfo( dl, l )');
  const inc = f.indexOf('#include <lights_fragment_begin>');
  const undef = f.indexOf('#undef getDirectionalLightInfo');
  assert.ok(def > 0 && def < inc && inc < undef, 'the macro covers exactly three\'s light loop');
  // The sun's direction in VIEW space, the space light.direction is in.
  assert.ok(f.includes('birbSunView = birbCloudUnit( ( viewMatrix * vec4( uCloudShadowSun, 0.0 ) ).xyz );'));
  // Clamped, so a raised atmosphere lever cannot drive the sun negative.
  assert.ok(f.includes('return clamp( uCloudShadowParams.x * uCloudShadowAtmos'));
  assert.equal(count(f, 'normalize('), 0, 'every normalize is guarded');
  assert.ok(f.includes('max( uCloudShadowFog, vec3( 0.0 ) )'), 'no negative into the sRGB pow()');
});

test('behind a patch that already owns the sun visibility, the cloud JOINS it', () => {
  // A stand-in for horizon-shadow.js: its globals, wrapper and sky multiply,
  // chained BEFORE the cloud. The cloud must multiply into them (one loss of
  // the sun's Lambert term, by the product) and add no second wrapper, no
  // second macro and no second sky multiply.
  const m = lambert();
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = 'float birbSunVis = 1.0;\nfloat birbSkyVis = 1.0;\nvec3 birbSunView = vec3( 0.0, 0.0, 1.0 );\n'
      + shader.fragmentShader
        .replace('#include <lights_fragment_begin>', '{ birbSunVis = 0.5; }\n#define getDirectionalLightInfo( dl, l ) other( dl, l )\n#include <lights_fragment_begin>\n#undef getDirectionalLightInfo')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= birbSkyVis;\n#include <aomap_fragment>');
  };
  addCloudShadow(m, THREE);
  const f = compile(m).fragmentShader;
  assert.equal(count(f, 'float birbSunVis'), 1);
  assert.equal(count(f, 'void birbCloudDirInfo('), 0);
  assert.equal(count(f, '#define getDirectionalLightInfo'), 1);
  assert.equal(count(f, 'reflectedLight.indirectDiffuse *= birbSkyVis;'), 1);
  const theirs = f.indexOf('{ birbSunVis = 0.5; }');
  const ours = f.indexOf('birbSunVis *= 1.0 - csOcc;');
  assert.ok(theirs > 0 && ours > theirs && ours < f.indexOf('#include <lights_fragment_begin>'),
    'the cloud scales the visibility after the other patch set it and before the light loop reads it');
  assert.ok(!f.includes('birbSunView = birbCloudUnit'), 'the other patch owns the sun direction');
});

test('switching the sine field off is a uniform, not a new program', () => {
  const a = lambert(); addAtmosphere(a, THREE);
  const b = lambert(); addAtmosphere(b, THREE, { cloudStrength: 0 });
  const sa = compile(a); const sb = compile(b);
  assert.equal(sa.fragmentShader, sb.fragmentShader);
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey());
  assert.equal(sa.uniforms.uBirbCloud.value, 0.42);
  assert.equal(sb.uniforms.uBirbCloud.value, 0);
});

test('the chord GLSL is guarded, so two patches on one program cannot redeclare it', () => {
  assert.match(CLOUD_CHORD_GLSL, /#ifndef BIRB_CLOUD_CHORD/);
  assert.equal(count(CLOUD_CHORD_GLSL + CLOUD_CHORD_GLSL, '#define BIRB_CLOUD_CHORD'), 2);
});

// ── tuning and the capture hooks ─────────────────────────────────────────
test('tuning: a partial override changes only what it names; null restores the table', () => {
  const t = setCloudVolumeTuning({ opacity: 3 });
  assert.equal(t.opacity, 3);
  assert.equal(cloudVolumeUniforms.shape.value[1], 3);
  assert.equal(t.sunGain, CLOUD_VOLUME.sunGain);
  const u = setCloudVolumeTuning({ shadowStrength: 0.5 });
  assert.equal(u.opacity, 3, 'the earlier override survives');
  assert.equal(cloudShadowUniforms.params.value[0], 0.5);
  const r = setCloudVolumeTuning(null);
  assert.equal(r.opacity, CLOUD_VOLUME.opacity);
  assert.equal(cloudShadowUniforms.params.value[0], Math.fround(CLOUD_SHADOW.strength));
  assert.equal(cloudShadowUniforms.params.value[2], Math.fround(CLOUD_SHADOW.sky));
});

test('the flat capture mode restores the solid puffs exactly', () => {
  const hex = { color: 0xdfeeff, emissive: 0x000000 };
  const colorObj = (key) => ({
    getHex: () => hex[key],
    setHex: (h) => { hex[key] = h; },
    setRGB: (r, g, b) => { hex[key] = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255); },
  });
  const material = { color: colorObj('color'), emissive: colorObj('emissive'), fog: true, transparent: false };
  const mesh = { visible: true, material, geometry: { attributes: { position: { count: 240 } } } };
  const info = createCloudsInfo(THREE, {
    volumetric: false, clouds: [{ x: 0, y: 1, z: 0, collider: 6 }], puffs: new Float32Array([0, 1, 0, 3]), mesh,
  });
  info.report({ flat: true });
  assert.equal(material.fog, false);
  assert.equal(hex.color, 0);
  info.report({ flat: false });
  assert.equal(hex.color, 0xdfeeff);
  assert.equal(hex.emissive, 0);
  assert.equal(material.fog, true);
  const r = info.report({ visible: false });
  assert.equal(mesh.visible, false);
  assert.equal(r.volumetric, false);
  assert.equal(r.triangles, 80, 'one icosphere puff');
  assert.equal(r.tuning, null, 'the solid path has no volume tuning');
});
