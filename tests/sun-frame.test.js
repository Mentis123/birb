// tests/sun-frame.test.js — the sun's tangent frame on a planet.
//
// The sun used to be copied from sun-cycle.js's horizon components straight
// into WORLD space, which is a horizon frame only at the +Y pole. These pin
// the frame that replaces that: exact at the pole, genuinely parallel-
// transported everywhere else (the holonomy test is the one a frame built
// from a fixed world axis cannot pass), reset deterministically on a jump,
// and orthonormal after ten thousand steps.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSunFrame, sunCycleInto, sunWarmthInto, SUN_FRAME_DEFAULTS,
} from '../src/environment/sun-frame.js';
import { sunDirectionAt, sunWarmth } from '../src/environment/sun-cycle.js';

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a) => { const l = len(a); return { x: a.x / l, y: a.y / l, z: a.z / l }; };

function assertOrthonormal(frame, tol, label = '') {
  const { east: e, up: u, north: n } = frame;
  for (const [name, v] of [['east', e], ['up', u], ['north', n]]) {
    assert.ok(Math.abs(len(v) - 1) <= tol, `${label}|${name}| = ${len(v)}`);
    assert.ok([v.x, v.y, v.z].every(Number.isFinite), `${label}${name} finite`);
  }
  assert.ok(Math.abs(dot(e, n)) <= tol, `${label}E.N = ${dot(e, n)}`);
  assert.ok(Math.abs(dot(e, u)) <= tol, `${label}E.U = ${dot(e, u)}`);
  assert.ok(Math.abs(dot(n, u)) <= tol, `${label}N.U = ${dot(n, u)}`);
  // Right-handed the way sun-cycle.js's components need it: E = U x N.
  const c = cross(u, n);
  assert.ok(Math.abs(c.x - e.x) + Math.abs(c.y - e.y) + Math.abs(c.z - e.z) <= 3 * tol, `${label}E = U x N`);
}

test('at the +Y pole the mapping is EXACTLY the identity — the spawn looks as it always did', () => {
  const f = createSunFrame();
  assert.equal(f.update(0, 123, 0), true, 'the first update is a reset');
  assert.ok(f.east.x === 1 && f.east.y === 0 && f.east.z === 0, `east ${JSON.stringify(f.east)}`);
  assert.ok(f.up.x === 0 && f.up.y === 1 && f.up.z === 0, `up ${JSON.stringify(f.up)}`);
  assert.ok(f.north.x === 0 && f.north.y === 0 && f.north.z === 1, `north ${JSON.stringify(f.north)}`);
  const out = { x: 0, y: 0, z: 0 };
  for (let t = 0; t < 600; t += 37) {
    const s = sunDirectionAt(t);
    f.toWorld(s.x, s.y, s.z, out);
    // Bit-for-bit: the pole is where the old world-fixed sun was right.
    assert.ok(out.x === s.x && out.y === s.y && out.z === s.z, `t=${t}: ${JSON.stringify(out)} vs ${JSON.stringify(s)}`);
  }
  // Standing still at the pole keeps it exact: no re-normalisation drift.
  for (let i = 0; i < 100; i += 1) f.update(0, 123, 0);
  assert.ok(f.east.x === 1 && f.north.z === 1 && f.up.y === 1, 'a hovering bird keeps a bit-stable frame');
});

test('sunCycleInto / sunWarmthInto match sun-cycle.js bit for bit (no allocation, same numbers)', () => {
  const out = { x: 0, y: 0, z: 0, height: 0, elevation: 0 };
  const w = { r: 0, g: 0, b: 0, intensity: 0 };
  for (let t = -50; t < 1300; t += 3.7) {
    const s = sunDirectionAt(t);
    const r = sunCycleInto(t, out);
    assert.equal(r, out, 'returns the object it was given');
    assert.ok(out.x === s.x && out.y === s.y && out.z === s.z && out.height === s.height, `t=${t}`);
    assert.ok(Math.abs(Math.sin(out.elevation) - s.y) < 1e-15, `t=${t}: elevation matches y`);
    const a = sunWarmth(s.height);
    sunWarmthInto(s.height, w);
    assert.ok(w.r === a.r && w.g === a.g && w.b === a.b && w.intensity === a.intensity, `warmth t=${t}`);
  }
  // Non-finite input falls back exactly as the original does.
  const s = sunDirectionAt(NaN);
  sunCycleInto(NaN, out);
  assert.ok(out.x === s.x && out.y === s.y && out.z === s.z);
});

test('flying a great circle keeps the sun at its elevation AND at its bearing to the path', () => {
  const f = createSunFrame();
  const R = 140;
  const N = 3000;
  const sun = { x: 0, y: 0, z: 0, height: 0, elevation: 0 };
  sunCycleInto(137, sun);   // an arbitrary hour: elevation ~0.58 rad
  const w = { x: 0, y: 0, z: 0 };
  let bearing0 = null;
  let worstElev = 0;
  let worstBearing = 0;
  // A great circle through (1,0,0) tilted off every axis, so no coordinate
  // plane makes the test easy.
  const a = unit({ x: 1, y: 0.2, z: -0.3 });
  const b0 = unit({ x: 0.1, y: 1, z: 0.4 });
  const b = unit({ x: b0.x - dot(a, b0) * a.x, y: b0.y - dot(a, b0) * a.y, z: b0.z - dot(a, b0) * a.z });
  for (let i = 0; i <= N; i += 1) {
    const s = (i / N) * Math.PI * 2;
    const p = { x: a.x * Math.cos(s) + b.x * Math.sin(s), y: a.y * Math.cos(s) + b.y * Math.sin(s), z: a.z * Math.cos(s) + b.z * Math.sin(s) };
    f.update(p.x * R, p.y * R, p.z * R);
    f.toWorld(sun.x, sun.y, sun.z, w);
    const elev = Math.asin(dot(unit(w), f.up));
    worstElev = Math.max(worstElev, Math.abs(elev - sun.elevation));
    // Direction of travel (the geodesic's tangent) and the sun's bearing to it.
    const T = { x: -a.x * Math.sin(s) + b.x * Math.cos(s), y: -a.y * Math.sin(s) + b.y * Math.cos(s), z: -a.z * Math.sin(s) + b.z * Math.cos(s) };
    const side = cross(f.up, T);
    const bearing = Math.atan2(dot(w, side), dot(w, T));
    if (bearing0 === null) bearing0 = bearing;
    let d = bearing - bearing0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    worstBearing = Math.max(worstBearing, Math.abs(d));
  }
  assert.ok(worstElev < 1e-9, `elevation drifted by ${worstElev} rad`);
  assert.ok(worstBearing < 1e-6, `bearing to the path drifted by ${worstBearing} rad`);
  // A great circle encloses a hemisphere: 2PI of holonomy, i.e. none.
  assertOrthonormal(f, 1e-12, 'after the circle: ');
  const g = createSunFrame();
  g.update(a.x * R, a.y * R, a.z * R);
  const err = Math.abs(f.east.x - g.east.x) + Math.abs(f.east.y - g.east.y) + Math.abs(f.east.z - g.east.z);
  assert.ok(err < 1e-6, `a full great circle comes home unrotated (east off by ${err})`);
});

test('a small circle comes home turned by the solid angle it enclosed — it is REAL parallel transport', () => {
  // A frame built from cross(worldAxis, up) would come back exactly as it
  // left; parallel transport comes back rotated by Omega = 2PI(1 - cos theta).
  for (const theta of [0.3, 0.5236, 1.0]) {
    const f = createSunFrame();
    const N = 4000;
    const at = (phi) => ({ x: Math.sin(theta) * Math.cos(phi), y: Math.cos(theta), z: Math.sin(theta) * Math.sin(phi) });
    const p0 = at(0);
    f.update(p0.x, p0.y, p0.z);
    const e0 = { ...f.east };
    for (let i = 1; i <= N; i += 1) {
      const p = at((i / N) * Math.PI * 2);
      assert.equal(f.update(p.x, p.y, p.z), false, 'small steps transport, never reset');
    }
    const angle = Math.atan2(dot(cross(e0, f.east), f.up), dot(e0, f.east));
    const omega = 2 * Math.PI * (1 - Math.cos(theta));
    const expected = Math.atan2(Math.sin(omega), Math.cos(omega));
    assert.ok(Math.abs(Math.abs(angle) - Math.abs(expected)) < 2e-3,
      `theta ${theta}: turned ${angle.toFixed(5)} rad, holonomy says ${expected.toFixed(5)}`);
    assert.ok(Math.abs(angle) > 0.05, 'and it did turn');
  }
});

test('a jump resets deterministically from the pole frame; ordinary flight never does', () => {
  const f = createSunFrame();
  f.update(0, 130, 0);
  // Fly a curvy path far from the pole.
  for (let i = 1; i <= 800; i += 1) {
    const s = i * 0.002;
    f.update(Math.sin(s) * 130, Math.cos(s) * 130, Math.sin(3 * s) * 20);
  }
  const resetsBefore = f.resets;
  // 5 degrees in one update is still flight (a very slow frame), not a jump.
  const p = { x: f.up.x, y: f.up.y, z: f.up.z };
  const q = unit({ x: p.x + 0.08, y: p.y, z: p.z });
  assert.ok(Math.acos(dot(p, q)) < SUN_FRAME_DEFAULTS.resetAngle);
  assert.equal(f.update(q.x * 125, q.y * 125, q.z * 125), false);
  assert.equal(f.resets, resetsBefore, 'no reset under the threshold');
  // A teleport: the same place always gets the same frame, whatever route.
  const target = { x: 0.3, y: -0.6, z: 0.742 };
  assert.equal(f.update(target.x * 140, target.y * 140, target.z * 140), true, 'a 90-degree jump resets');
  const fresh = createSunFrame();
  fresh.update(target.x, target.y, target.z);
  for (const k of ['east', 'up', 'north']) {
    for (const c of ['x', 'y', 'z']) {
      assert.ok(Math.abs(f[k][c] - fresh[k][c]) < 1e-15, `${k}.${c}: ${f[k][c]} vs ${fresh[k][c]}`);
    }
  }
  assertOrthonormal(f, 1e-14, 'after reset: ');
});

test('ten thousand small steps: still orthonormal, still exact about elevation', () => {
  const f = createSunFrame();
  let x = 0.2; let y = 1; let z = -0.1;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const sun = { x: 0, y: 0, z: 0, height: 0, elevation: 0 };
  const w = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (let i = 0; i < 10000; i += 1) {
    // A random walk ON the unit sphere: each step is under ~1.2 degrees.
    x += rnd() * 0.02; y += rnd() * 0.02; z += rnd() * 0.02;
    const l = Math.sqrt(x * x + y * y + z * z);
    x /= l; y /= l; z /= l;
    const r = 120 + 30 * Math.sin(i * 0.01);   // altitude changes too
    f.update(x * r, y * r, z * r);
    sunCycleInto(i * 0.06, sun);
    f.toWorld(sun.x, sun.y, sun.z, w);
    worst = Math.max(worst, Math.abs(dot(w, f.up) / len(w) - sun.y));
  }
  assertOrthonormal(f, 1e-12, 'after 10k steps: ');
  assert.ok(worst < 1e-12, `sine of elevation drifted by ${worst}`);
  assert.equal(f.resets, 1, 'only the first update reset');
});

test('the exact south pole has a fixed, finite frame; a near-antipodal jump resets instead of transporting', () => {
  const f = createSunFrame();
  f.update(0, -150, 0);
  assert.ok(f.up.x === 0 && f.up.y === -1 && f.up.z === 0);
  assert.ok(f.east.x === 1 && Math.abs(f.east.y) === 0 && Math.abs(f.east.z) === 0, JSON.stringify(f.east));
  assert.ok(Math.abs(f.north.x) === 0 && Math.abs(f.north.y) === 0 && f.north.z === -1, JSON.stringify(f.north));
  assertOrthonormal(f, 0, 'south pole: ');
  // Within float noise of the pole takes the same fallback.
  const g = createSunFrame();
  g.update(1e-14, -1, -1e-14);
  assertOrthonormal(g, 1e-12, 'near the south pole: ');
  // From the north pole straight to the south: a jump, never a transport
  // through the singular 1 + cos = 0.
  const h = createSunFrame();
  h.update(0, 1, 0);
  assert.equal(h.update(0, -1, 0), true);
  assertOrthonormal(h, 0, 'pole to pole: ');
  // A sun mapped at the south pole is above the south pole's horizon.
  const sun = sunDirectionAt(0);
  const w = h.toWorld(sun.x, sun.y, sun.z, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(Math.asin(-w.y) - Math.asin(sun.y)) < 1e-12, 'elevation preserved at the south pole');
});

test('a degenerate position leaves the frame alone; toLocal inverts toWorld; elevationOf reads the local horizon', () => {
  const f = createSunFrame();
  assert.equal(f.update(0, 0, 0), false);
  assert.equal(f.update(NaN, 1, 0), false);
  assert.equal(f.initialized, false);
  f.update(0.6, 0.1, -0.8);
  const before = JSON.stringify([f.east, f.up, f.north]);
  f.update(0, 0, 0);
  assert.equal(JSON.stringify([f.east, f.up, f.north]), before);
  const w = f.toWorld(0.3, 0.4, -0.5, { x: 0, y: 0, z: 0 });
  const l = f.toLocal(w.x, w.y, w.z, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(l.x - 0.3) < 1e-14 && Math.abs(l.y - 0.4) < 1e-14 && Math.abs(l.z + 0.5) < 1e-14);
  assert.ok(Math.abs(f.elevationOf(f.up.x, f.up.y, f.up.z) - Math.PI / 2) < 1e-7);
  assert.ok(Math.abs(f.elevationOf(f.east.x, f.east.y, f.east.z)) < 1e-12);
  assert.equal(f.elevationOf(0, 0, 0), 0);
});
