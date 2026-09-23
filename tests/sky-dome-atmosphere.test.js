// tests/sky-dome-atmosphere.test.js — the dome's physical-atmosphere tint.
//
// Two promises, both of the kind that fail silently:
//
//  - `?atmos=0` is the TRUE before. The dome built without `atmosphere`
//    must be the tinted shader with exactly the tint taken out — not "the new
//    shader at tint 1", which is a different program that happens to render
//    close. Stated as a RELATION (tinted minus the tint snippets == untinted)
//    rather than a hash, so a later, legitimate change to the dome's own
//    gradient does not trip it, while any change that leaks tint code into
//    the untinted path does.
//  - The three horizon samples land exactly where the model put them. The
//    shader reproduces the model's sunward / across / away ratios at 0, 90
//    and 180 degrees through a + b cos(phi) + c cos^2(phi), and is exactly 1
//    at identity. The GLSL is mirrored here and the mirror is pinned against
//    the shader source, so the two cannot drift apart unnoticed.
//
// sky-dome.js imports three from a CDN URL, which node cannot fetch; it is
// loaded here from a data: URL with that one import pointed at a stub.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STUB = `
export class Color {
  constructor(r = 1, g, b) { if (g === undefined) { this.setHex(r); } else { this.r = r; this.g = g; this.b = b; } }
  setHex(h) { this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; return this; }
  set(v) { if (typeof v === 'number') return this.setHex(v); this.r = v.r; this.g = v.g; this.b = v.b; return this; }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
}
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
}
export class SphereGeometry { dispose() {} }
export class ShaderMaterial { constructor(o) { Object.assign(this, o); } dispose() {} }
export class Mesh { constructor(g, m) { this.geometry = g; this.material = m; this.position = new Vector3(); } }
export const BackSide = 1;
`;

async function loadSkyDome() {
  const src = readFileSync(path.join(REPO_ROOT, 'src/environment/sky-dome.js'), 'utf8');
  const stubUrl = `data:text/javascript;base64,${Buffer.from(STUB).toString('base64')}`;
  const patched = src.replace('https://esm.sh/three@0.183.2', stubUrl);
  assert.notEqual(patched, src, 'sky-dome.js no longer imports the pinned three URL this test stubs');
  return import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
}

const dome = await loadSkyDome();

test('?atmos=0 is the tinted shader with EXACTLY the tint taken out — the true before', () => {
  const off = dome.createSkyDome();
  const offExplicit = dome.createSkyDome({ atmosphere: false });
  const on = dome.createSkyDome({ atmosphere: true });
  const fOff = off.mesh.material.fragmentShader;
  const fOn = on.mesh.material.fragmentShader;
  assert.equal(offExplicit.mesh.material.fragmentShader, fOff, 'the default IS atmosphere: false');
  assert.ok(fOn.includes(dome.ATMOSPHERE_TINT_GLSL) && fOn.includes(dome.ATMOSPHERE_TINT_APPLY_GLSL));
  const stripped = fOn
    .replace(dome.ATMOSPHERE_TINT_GLSL, '')
    .replace(dome.ATMOSPHERE_TINT_APPLY_GLSL, '')
    .replace('horizonBand * skyRoom * atmosTint;', 'horizonBand * skyRoom;')
    .replace('uSunColor * uAtmosDisc * (', 'uSunColor * (');
  assert.equal(stripped, fOff, 'removing the tint from the tinted shader gives the untinted one, byte for byte');
  assert.ok(!/uAtmos|atmosTint/.test(fOff), 'no tint code leaks into the untinted shader');
  assert.equal(off.mesh.material.vertexShader, on.mesh.material.vertexShader);
  const keysOff = Object.keys(off.mesh.material.uniforms);
  const keysOn = Object.keys(on.mesh.material.uniforms);
  assert.deepEqual(keysOn.filter((k) => !k.startsWith('uAtmos')), keysOff, 'the untinted dome carries no extra uniforms');
  // Off, the atmosphere API is inert rather than absent: index.html calls it
  // unconditionally through optional chaining.
  assert.equal(off.atmosphereState(), null);
  assert.equal(off.setAtmosphere({ horizonSun: [2, 2, 2] }), undefined);
});

// The GLSL, transcribed. Pinned against the source below.
function tintMirror(u, dir, up, sun) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const upDot = dot(dir, up);
  const sd = dot(sun, up);
  const sunFlat = [sun[0] - up[0] * sd, sun[1] - up[1] * sd, sun[2] - up[2] * sd];
  const dirFlat = [dir[0] - up[0] * upDot, dir[1] - up[1] * upDot, dir[2] - up[2] * upDot];
  const denom = Math.sqrt(dot(sunFlat, sunFlat) * dot(dirFlat, dirFlat));
  const cp = denom > 1e-6 ? dot(sunFlat, dirFlat) / denom : 0;
  const e = Math.min(1, Math.max(0, upDot));
  const v = e * e * Math.sqrt(e);
  const out = [];
  for (const [i, k] of [[0, 'x'], [1, 'y'], [2, 'z']]) {
    const horizon = u.uAtmosA.value[k] + (u.uAtmosB.value[k] + u.uAtmosC.value[k] * cp) * cp;
    out[i] = horizon + (u.uAtmosZenith.value[k] - horizon) * v;
  }
  return out;
}

test('the mirror above is the shader: the formula lines are verbatim in the GLSL', () => {
  const g = dome.ATMOSPHERE_TINT_GLSL;
  for (const line of [
    'float up = dot(dir, uSkyUp);',
    'vec3 sunFlat = uSunDirection - uSkyUp * dot(uSunDirection, uSkyUp);',
    'vec3 dirFlat = dir - uSkyUp * up;',
    'float denom = sqrt(dot(sunFlat, sunFlat) * dot(dirFlat, dirFlat));',
    'float cp = denom > 1e-6 ? dot(sunFlat, dirFlat) / denom : 0.0;',
    'vec3 horizon = uAtmosA + (uAtmosB + uAtmosC * cp) * cp;',
    'float e = clamp(up, 0.0, 1.0);',
    'float v = e * e * sqrt(e);',
    'return horizon + (uAtmosZenith - horizon) * v;',
  ]) assert.ok(g.includes(line), `GLSL lost: ${line}`);
  assert.ok(dome.ATMOSPHERE_TINT_APPLY_GLSL.includes('color *= atmosTint;'));
});

test('identity uniforms give EXACTLY 1 in every direction, not 0.99999994', () => {
  const on = dome.createSkyDome({ atmosphere: true });
  const u = on.mesh.material.uniforms;
  const up = [0.3, 0.9, -0.3].map((x, _, a) => x / Math.hypot(...a));
  const sun = [0.8, 0.5, 0.2].map((x, _, a) => x / Math.hypot(...a));
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let i = 0; i < 500; i += 1) {
    const d = [rnd(), rnd(), rnd()];
    const l = Math.hypot(...d) || 1;
    const t = tintMirror(u, d.map((x) => x / l), up, sun);
    assert.ok(t[0] === 1 && t[1] === 1 && t[2] === 1, `tint ${t}`);
  }
});

test('setAtmosphere puts the model\'s samples exactly where it took them', () => {
  const on = dome.createSkyDome({ atmosphere: true });
  const u = on.mesh.material.uniforms;
  const rel = {
    horizonSun: [1.5797, 1.1822, 0.9009],
    horizonSide: [0.7774, 0.7247, 0.652],
    horizonAway: [0.966, 0.8863, 0.7667],
    zenith: [0.6565, 0.6343, 0.6233],
    sun: [0.9196, 0.821, 0.685],
  };
  on.setAtmosphere(rel);
  const up = [0, 1, 0];
  const sun = [Math.cos(0.34), Math.sin(0.34), 0];   // the sun toward +X, 19.5 degrees up
  const near = (a, b, tol = 1e-12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  // On the horizon (e = 0 -> v = 0): toward, across and away from the sun.
  assert.ok(near(tintMirror(u, [1, 0, 0], up, sun), rel.horizonSun), 'toward the sun');
  assert.ok(near(tintMirror(u, [0, 0, 1], up, sun), rel.horizonSide), 'across');
  assert.ok(near(tintMirror(u, [0, 0, -1], up, sun), rel.horizonSide), 'across, the other side');
  assert.ok(near(tintMirror(u, [-1, 0, 0], up, sun), rel.horizonAway), 'away');
  // Straight up: the zenith, whatever the azimuth.
  assert.ok(near(tintMirror(u, [0, 1, 0], up, sun), rel.zenith), 'zenith');
  // The disc takes the sun's own transmittance ratio.
  assert.deepEqual([u.uAtmosDisc.value.x, u.uAtmosDisc.value.y, u.uAtmosDisc.value.z], rel.sun);
  // And the readback reconstructs the three horizon samples.
  const s = on.atmosphereState();
  assert.ok(near(s.horizonSun, rel.horizonSun, 1e-4) && near(s.horizonAway, rel.horizonAway, 1e-4));
});
