/**
 * tests/air-field.test.js — air with structure (src/flight/air-field.js) and
 * the one line of the stunt law that lets it move the bird.
 *
 * Three families of claim, each measured rather than read back:
 *
 *  1. The thermal IS Allen 2006: the core peaks low in the layer, crosses
 *     zero near 0.909·zi, sinks above that and is exactly nothing at and
 *     above zi; the sinking ring exists only in the upper half; and the field
 *     as a whole conserves mass — averaged over the planet the thermals and
 *     the sink between them come to zero. That last one is the property a
 *     plausible-looking bell curve would fail.
 *  2. Ridge lift is Bohrer's signed formula: windward up, lee down, gone by
 *     the top of the layer; the sun switches a thermal on and off by its OWN
 *     slope; gusts never reach the flight path; everything is bounded and
 *     deterministic per seed.
 *  3. The stunt controller WITHOUT a sampler is the controller that shipped,
 *     bit for bit: a 14-second replay through every term of the law, a floor
 *     included, lands on exactly the doubles the base commit produced. With
 *     one, the air moves position only, and never while the speed is
 *     commanded (walking, falling, a freeze, the nest's hand).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  ALLEN_SHAPES, AIR_FIELD_DEFAULTS, airRequested, allenCoreRatio, allenMeanRadius, allenMeanUpdraft,
  allenShapeIndex, allenUpdraft, createAirField, ridgeLiftRaw, sunHeat, thermalRadiusAt,
} from '../src/flight/air-field.js';
import { BirdFlightStunt } from '../src/flight/bird-flight-stunt.js';
import { bootFlagByKey, readBootFlag } from '../src/ui/boot-flags.js';

// Same additive shim the stunt suite installs (the tracked stub has these now;
// kept so this file also runs against an older checkout of it).
for (const [name, impl] of [
  ['add', function add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }],
  ['cross', function cross(v) { return this.crossVectors(this, v); }],
  ['distanceTo', function distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }],
]) {
  if (typeof THREE.Vector3.prototype[name] !== 'function') THREE.Vector3.prototype[name] = impl;
}

const ZI = AIR_FIELD_DEFAULTS.zi;
const AREA = 4 * Math.PI * 120 * 120;

// ---------------------------------------------------------------------------
// 1. Allen 2006
// ---------------------------------------------------------------------------

test('the mean updraft is Allen eq. 11: peaks at z/zi = 1/4.4, zero at 1/1.1', () => {
  // d/ds [s^(1/3)(1 - 1.1 s)] = 0  at  s = 1/4.4 = 0.227.
  let best = 0; let bestS = 0;
  for (let s = 0.001; s < 1; s += 0.001) {
    const w = allenMeanUpdraft(s, 1);
    if (w > best) { best = w; bestS = s; }
  }
  assert.ok(Math.abs(bestS - 1 / 4.4) < 0.002, `mean peaks at ${bestS.toFixed(3)}`);
  assert.ok(allenMeanUpdraft(0.90, 1) > 0 && allenMeanUpdraft(0.92, 1) < 0, 'crosses zero between 0.90 and 0.92');
  assert.equal(allenMeanUpdraft(0, 1), 0, 'nothing at the ground');
});

test('the thermal core peaks in the lower third of the layer, and it is exactly nothing at and above zi', () => {
  let best = -Infinity; let bestZ = 0;
  for (let z = 0.25; z < ZI; z += 0.25) {
    const w = allenUpdraft(0, z);
    if (w > best) { best = w; bestZ = z; }
  }
  const s = bestZ / ZI;
  assert.ok(s >= 0.2 && s <= 0.3, `core peaks at z/zi ${s.toFixed(3)}`);
  assert.ok(best > 2 && best <= AIR_FIELD_DEFAULTS.maxUp, `a real core: ${best.toFixed(2)} units/s`);
  // Sink in the cap above the zero crossing — the top of the thermal.
  assert.ok(allenUpdraft(0, 0.95 * ZI) < 0, 'the cap sinks');
  for (const z of [ZI, ZI + 0.01, ZI + 5, 220]) {
    for (const r of [0, 5, 20, 40, 80]) {
      assert.equal(allenUpdraft(r, z, { count: 10, area: AREA }), 0, `z ${z} r ${r}`);
    }
  }
});

test('the core is a bell: monotone out to r2, and nothing negative below the upper half without the environment', () => {
  const z = 0.25 * ZI;
  const r2 = thermalRadiusAt(z);
  let prev = Infinity;
  for (let r = 0; r <= r2; r += r2 / 40) {
    const w = allenUpdraft(r, z);
    assert.ok(w <= prev + 1e-12, `falls monotonically (r ${r.toFixed(1)})`);
    assert.ok(w >= 0, 'never below zero in the lower half');
    prev = w;
  }
  for (let r = r2; r < 4 * r2; r += 1) assert.ok(allenUpdraft(r, z) >= 0, 'no ring in the lower half');
});

test('the sinking ring lives at the edge of the upper half only (Allen eq. 16-17)', () => {
  const upper = 0.7 * ZI;
  const r2 = thermalRadiusAt(upper);
  let minRing = 0;
  for (let r = r2; r < 2 * r2; r += 0.5) minRing = Math.min(minRing, allenUpdraft(r, upper));
  assert.ok(minRing < -0.05, `a ring at 0.7 zi: ${minRing.toFixed(3)}`);
  for (let r = 2 * r2 + 0.5; r < 4 * r2; r += 1) assert.equal(allenUpdraft(r, upper), 0, 'and it ends at 2 r2');
});

test('the environment sink is gentle, below the layer only, and conserves mass', () => {
  const N = AIR_FIELD_DEFAULTS.thermalCount;
  const z = 0.3 * ZI;
  const far = allenUpdraft(300, z, { count: N, area: AREA });
  assert.ok(far < 0 && far > -0.3, `between thermals: ${far.toFixed(3)} units/s`);
  // Mass: the flux up through N thermals equals the flux down through the
  // rest. Integrated out to 2 r2, past which a lower-half thermal IS the
  // environment (no ring below 0.5 zi, and the bell is zero by 1.3 r2).
  const r2 = thermalRadiusAt(z);
  assert.equal(allenUpdraft(2 * r2, z, { count: N, area: AREA }), far, 'the environment by 2 r2');
  let up = 0; const dr = 0.05;
  for (let r = dr / 2; r < 2 * r2; r += dr) up += allenUpdraft(r, z, { count: N, area: AREA }) * 2 * Math.PI * r * dr;
  const rest = AREA - N * Math.PI * (2 * r2) ** 2;
  assert.ok(rest > 0.3 * AREA, 'the disks integrated over leave most of the planet outside them');
  const net = (N * up + far * rest) / AREA;
  assert.ok(Math.abs(net) < 0.02, `net vertical flux ${net.toFixed(4)} units/s averaged over the planet`);
});

test('the shape table and r1/r2 are the paper\'s own', () => {
  assert.equal(ALLEN_SHAPES.length, 7);
  assert.deepEqual(ALLEN_SHAPES[1], [0.25, 1.5265, 3.6054, -0.0176, -0.1265]);
  assert.equal(allenShapeIndex(0.14), 0);
  assert.equal(allenShapeIndex(0.22), 1, 'midpoint rule: 0.22 < (0.25 + 0.36) / 2');
  assert.equal(allenShapeIndex(0.9), 6);
  assert.ok(Math.abs(allenCoreRatio(100) - 0.25) < 1e-12);
  assert.equal(allenCoreRatio(700), 0.8);
  for (const [, k1, k2, k3, k4] of ALLEN_SHAPES) {
    const ws0 = 1 / (1 + (k1 * Math.abs(0 + k3)) ** k2) + k4 * 0;
    assert.ok(ws0 > 0.97 && ws0 <= 1, 'each shape is ~1 on the axis');
  }
  // The 10 m floor ("limit small updrafts to 20m diameter"), in world units.
  assert.ok(thermalRadiusAt(0.01) >= 10 * AIR_FIELD_DEFAULTS.unitsPerMetre - 1e-9);
  assert.ok(allenMeanRadius(0.5, 1000) > allenMeanRadius(0.1, 1000), 'the plume widens with height');
});

// ---------------------------------------------------------------------------
// 2. The field
// ---------------------------------------------------------------------------

/** A carved-down planet (<= 0): broad basins, a ridge band, small hills. */
const terrain = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  const nx = x / l; const ny = y / l; const nz = z / l;
  const basin = 16 * Math.sin(2.1 * nx + 0.3) * Math.cos(1.7 * nz) + 8 * Math.sin(2.9 * ny) - 10;
  const hills = 5 * Math.sin(9 * nx) * Math.sin(8 * ny + 1) * Math.cos(7 * nz);
  return Math.min(0, basin + hills);
};

const makeField = (extra = {}) => createAirField({
  seed: 'forest', sphereRadius: 120, terrainHeight: terrain, waterLevel: -22, ...extra,
});

/** Deterministic points on the sphere. */
function* spherePoints(n, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < n; i += 1) {
    const u = rnd() * 2 - 1; const p = rnd() * Math.PI * 2; const r = Math.sqrt(1 - u * u);
    yield [r * Math.cos(p), u, r * Math.sin(p)];
  }
}

const at = (dir, agl) => {
  const r = 120 + terrain(dir[0], dir[1], dir[2]) + agl;
  return [dir[0] * r, dir[1] * r, dir[2] * r];
};

test('same seed, same terrain: the same thermals and the same air, to the bit', () => {
  const a = makeField(); const b = makeField();
  assert.equal(a.count, b.count);
  assert.deepEqual(a.thermals.map((t) => t.dir), b.thermals.map((t) => t.dir));
  for (let i = 0; i < 90; i += 1) { a.update(1 / 60, 0.2, 1, 0.3); b.update(1 / 60, 0.2, 1, 0.3); }
  for (const d of spherePoints(200)) {
    const p = at(d, 12);
    assert.ok(a.sample(...p) === b.sample(...p));
  }
  assert.deepEqual(a.gustComponents(), b.gustComponents(), 'gusts are seeded too');
  const other = makeField({ seed: 'canyons' });
  assert.notDeepEqual(other.thermals.map((t) => t.dir), a.thermals.map((t) => t.dir), 'another biome, other thermals');
});

test('thermals are spread out, dry, and never more than asked for', () => {
  const f = makeField();
  assert.equal(f.count, AIR_FIELD_DEFAULTS.thermalCount);
  const cosSep = Math.cos(AIR_FIELD_DEFAULTS.minSeparation);
  for (let i = 0; i < f.count; i += 1) {
    const t = f.thermals[i];
    assert.ok(t.ground > -22 + 0.25, `thermal ${i} is not on the lake`);
    for (let j = i + 1; j < f.count; j += 1) {
      const u = f.thermals[j];
      assert.ok(t.dir[0] * u.dir[0] + t.dir[1] * u.dir[1] + t.dir[2] * u.dir[2] <= cosSep + 1e-12, `${i} and ${j} are apart`);
    }
  }
});

test('the sun switches a thermal on by its own slope: facing away is dead, facing it is lifting', () => {
  const f = makeField();
  const t = f.thermals[0];
  const [sx, sy, sz] = t.normal;
  // Sun straight down the slope's own normal: full heat.
  f.update(0, sx, sy, sz);
  const core = at(t.dir, 12);
  const lit = f.sample(...core);
  assert.ok(f.heat(0) > 0.95, `heat ${f.heat(0).toFixed(3)}`);
  assert.ok(lit > 1.5, `a lit thermal lifts: ${lit.toFixed(3)}`);
  // Sun behind the slope: no heat, and no lift left in the core.
  f.update(0, -sx, -sy, -sz);
  assert.equal(f.heat(0), 0);
  const dark = f.sample(...core);
  assert.ok(dark <= 0.3, `a dark thermal is just air: ${dark.toFixed(3)} (ridge only)`);
  assert.ok(Math.abs(dark - f.state.ridge) < 0.2, 'what is left is the ridge and the environment');
  assert.equal(sunHeat(0), 0);
  assert.ok(sunHeat(0.82) > 0.999 && sunHeat(0.82) < 1.001, 'a 55-degree sun on flat ground is the reference');
});

test('averaged over the planet, the thermals and the sink between them come to nothing', () => {
  const f = makeField();
  f.update(0, 0.1, 1, 0.2);
  for (const agl of [5, 15, 30]) {
    let sum = 0; let n = 0; let peak = 0;
    for (const d of spherePoints(20000, 11)) {
      f.sample(...at(d, agl));
      sum += f.state.thermal; n += 1; peak = Math.max(peak, f.state.thermal);
    }
    assert.ok(peak > 1, `there is a thermal to find at ${agl}`);
    // Measured -0.008 / -0.012 / -0.009 with the solved sink; the paper's own
    // sink read -0.033 at 30 on this terrain, which is what this guards.
    assert.ok(Math.abs(sum / n) < 0.02, `mean thermal term at ${agl} AGL: ${(sum / n).toFixed(4)}`);
  }
});

test('on flat ground the solved sink balances the thermals to a thousandth, lit or dark', () => {
  // The paper's sink assumes each thermal carries its mean updraft over a
  // mean-radius disk. The bell carries ~13% more, the sink cannot reach
  // inside r1, and dead thermals are plain environment — evaluated as this
  // field evaluates it, the paper's own sink left -0.017 units/s at half
  // the layer. The field solves its sink from the integrated bell instead.
  const N = 40000; const golden = Math.PI * (3 - Math.sqrt(5));
  const flat = createAirField({ seed: 'forest', sphereRadius: 120, terrainHeight: () => -5 });
  for (const sun of [[0, 1, 0], [1, 0.2, 0], [-0.3, -1, 0.4]]) {
    flat.update(0, ...sun);
    let lit = 0;
    for (let i = 0; i < flat.count; i += 1) if (flat.heat(i) > 0) lit += 1;
    assert.ok(lit > 0 && lit < flat.count, `some thermals lit and some dark (${lit} of ${flat.count})`);
    for (const agl of [5, 15, 30, 45]) {
      let s = 0;
      for (let i = 0; i < N; i += 1) {
        const y = 1 - (2 * (i + 0.5)) / N; const r = Math.sqrt(1 - y * y); const t = golden * i;
        const rad = 115 + agl;
        flat.sample(Math.cos(t) * r * rad, y * rad, Math.sin(t) * r * rad);
        s += flat.state.thermal;
      }
      assert.ok(Math.abs(s / N) < 0.002, `sun ${sun}: planet mean at ${agl} AGL is ${(s / N).toFixed(5)}`);
    }
  }
});

test('ridge lift is Bohrer\'s signed formula: windward up, lee down, across nothing', () => {
  // Wind 3 along +x; a 30-degree slope rising toward +x (the wind blows UP it).
  const slope = Math.tan(Math.PI / 6);
  assert.ok(Math.abs(ridgeLiftRaw(3, 0, 0, slope, 0, 0) - 3 * Math.sin(Math.PI / 6)) < 1e-12, 'U sin(theta)');
  assert.ok(ridgeLiftRaw(3, 0, 0, -slope, 0, 0) < 0, 'lee sinks');
  assert.ok(Math.abs(ridgeLiftRaw(0, 0, 3, slope, 0, 0)) < 1e-12, 'a wind along the contour does nothing');
  assert.ok(Math.abs(ridgeLiftRaw(3 * Math.SQRT1_2, 0, 3 * Math.SQRT1_2, slope, 0, 0)
    - 3 * Math.sin(Math.PI / 6) * Math.SQRT1_2) < 1e-12, 'cos(alpha - beta)');
});

test('in the field, ridge lift follows the wind over the slope and decays to nothing by the top of the layer', () => {
  const f = makeField();
  f.update(0.5, 0.1, 1, 0.2);
  const wind = { x: 0, y: 0, z: 0 };
  let windward = 0; let lee = 0;
  for (const d of spherePoints(3000, 5)) {
    const p = at(d, 4);
    f.sample(...p);
    const ridge = f.state.ridge;
    if (Math.abs(ridge) < 0.05) continue;
    // Independent slope estimate along the wind.
    f.windAt(...p, wind);
    const sp = Math.hypot(wind.x, wind.y, wind.z);
    if (sp < 0.5) continue;
    const step = 0.02;
    const ahead = [d[0] + wind.x / sp * step, d[1] + wind.y / sp * step, d[2] + wind.z / sp * step];
    const behind = [d[0] - wind.x / sp * step, d[1] - wind.y / sp * step, d[2] - wind.z / sp * step];
    const rise = terrain(...ahead) - terrain(...behind);
    if (Math.abs(rise) < 0.2) continue;
    assert.equal(Math.sign(ridge), Math.sign(rise), 'lift where the ground rises downwind, sink where it falls');
    if (ridge > 0) windward += 1; else lee += 1;
    // And the same spot higher up: smaller, then nothing.
    const up = (h) => { f.sample(...at(d, h)); return f.state.ridge; };
    assert.ok(Math.abs(up(20)) < Math.abs(ridge), 'weaker higher up');
    assert.ok(Math.abs(up(ZI)) < 1e-9 && up(ZI + 0.001) === 0, 'nothing at zi');
  }
  assert.ok(windward > 20 && lee > 20, `both sides were tested (${windward} windward, ${lee} lee)`);
});

test('ridge lift conserves mass too: the lee pays for the windward, so low flight has no ratchet', () => {
  // The wind turns about an axis, so it is divergence-free on the sphere and
  // V·∇h integrates to zero over any closed terrain. A damped lee breaks that:
  // measured on the real forest at leeFactor 0.35, +0.10 units/s at ten up —
  // a slow upward ratchet for every bird that flies low, which is exactly
  // what the gravity-less floor was built never to do.
  for (const [lee, expectBalanced] of [[1, true], [0.35, false]]) {
    const f = makeField({ options: { leeFactor: lee } });
    f.update(0.5, 0.1, 1, 0.2);
    for (const agl of [5, 10]) {
      let sum = 0; let abs = 0; let n = 0;
      for (const d of spherePoints(20000, 13)) {
        f.sample(...at(d, agl));
        sum += f.state.ridge; abs += Math.abs(f.state.ridge); n += 1;
      }
      const bias = sum / abs;   // the mean as a share of the mean magnitude
      if (expectBalanced) assert.ok(Math.abs(bias) < 0.08, `signed lee at ${agl}: bias ${bias.toFixed(3)}`);
      else assert.ok(bias > 0.2, `a damped lee at ${agl} is a ratchet: bias ${bias.toFixed(3)}`);
    }
  }
});

test('bounded everywhere, exactly still at and above zi, and never pushes into the floor', () => {
  const f = makeField({ options: { wstar: 6, windSpeed: 12 } });   // a storm, to hit the clamps
  f.update(0.3, 0.2, 1, 0.1);
  const { maxUp, maxDown, floorClearance } = f.config;
  let hitTop = false;
  for (const d of spherePoints(4000, 3)) {
    for (const agl of [0.6, 1, 3, 8, 20, 45, 59.9]) {
      const w = f.sample(...at(d, agl));
      assert.ok(Number.isFinite(w) && w <= maxUp + 1e-12 && w >= -maxDown - 1e-12, `bounded: ${w}`);
      if (w === maxUp) hitTop = true;
      if (agl === floorClearance) assert.ok(w >= -1e-9, `no sinking air at the floor clearance (${w})`);
    }
    for (const agl of [ZI + 0.001, 61, 220]) assert.ok(f.sample(...at(d, agl)) === 0, 'still air above the layer');
  }
  assert.ok(hitTop, 'the storm really did reach the ceiling, so the clamp was exercised');
  // No terrain at all is a smooth sphere, not a crash.
  const flat = createAirField({ seed: 'city', sphereRadius: 120 });
  flat.update(0.1, 0, 1, 0);
  assert.ok(Number.isFinite(flat.sample(0, 130, 0)));
});

test('gusts move the trees and never the bird', () => {
  const calm = makeField({ options: { gustSigmaU: 0, gustSigmaV: 0, gustSigmaW: 0 } });
  const gusty = makeField();
  const visual = [];
  for (let i = 0; i < 600; i += 1) {
    calm.update(1 / 60, 0.2, 1, 0.1);
    gusty.update(1 / 60, 0.2, 1, 0.1);
    if (i % 25 !== 0) continue;
    for (const d of spherePoints(20, i)) {
      const p = at(d, 10);
      assert.ok(calm.sample(...p) === gusty.sample(...p), 'the vertical air is identical with and without gusts');
    }
    gusty.sample(...at([0, 1, 0], 10));
    visual.push(gusty.state.windVisual);
    assert.ok(Math.abs(gusty.state.gust) <= 1 && Math.abs(gusty.state.gustSide) <= 1, 'published gusts are -1..1');
  }
  const sd = Math.sqrt(visual.reduce((s, v) => s + (v - visual.reduce((a, b) => a + b, 0) / visual.length) ** 2, 0) / visual.length);
  assert.ok(sd > 0.05, `the foliage sway moves with the gusts (sd ${sd.toFixed(3)})`);
});

test('the gust filter is Dryden-like: the right variance at any frame rate', () => {
  const sigmaU = AIR_FIELD_DEFAULTS.gustSigmaU * AIR_FIELD_DEFAULTS.windSpeed;
  for (const dt of [1 / 120, 1 / 30]) {
    const f = makeField();
    const xs = [];
    for (let t = 0; t < 1500; t += dt) { f.update(dt, 0, 1, 0); xs.push(f.gustComponents()[0]); }
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    assert.ok(Math.abs(sd / sigmaU - 1) < 0.2, `dt ${dt.toFixed(4)}: sd ${sd.toFixed(3)} against ${sigmaU.toFixed(3)}`);
  }
});

test('?air=0 is the only off switch, and the Flags tab offers it', () => {
  assert.equal(airRequested(''), true);
  assert.equal(airRequested('?debug=1'), true);
  assert.equal(airRequested('?air=1'), true);
  assert.equal(airRequested('?air=0'), false);
  assert.equal(airRequested('?debug=1&air=0&env=forest'), false);
  assert.equal(airRequested('?fair=0'), true, 'the key is exact');
  const flag = bootFlagByKey('air');
  assert.ok(flag && flag.kind === 'toggle', 'a toggle, ON by default');
  assert.deepEqual(readBootFlag('?air=0', 'air'), { on: false, forcedOff: false });
});

// ---------------------------------------------------------------------------
// 3. The stunt law with and without the air
// ---------------------------------------------------------------------------

// ---- BEGIN REPLAY (identical to the script that produced GOLDEN on e252ca1) ----
const REPLAY_RADIUS = 100;
const replayTerrain = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  const nx = x / l; const ny = y / l; const nz = z / l;
  return -6 - 4 * Math.sin(3 * nx + 1) * Math.cos(2 * nz - 0.5) - 2 * Math.sin(5 * ny);
};
function makeReplayBird(site, extra = {}) {
  const up = site === 'pole' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const hint = site === 'pole' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const bird = new BirdFlightStunt(THREE, {
    sphereRadius: REPLAY_RADIUS,
    speed: 11,
    birdRadius: 0.6,
    terrainHeightAt: replayTerrain,
    position: up.clone().multiplyScalar(REPLAY_RADIUS + 9),
    ...extra,
  });
  const fwd = hint.clone().addScaledVector(up, -hint.dot(up)).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  bird.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
  return bird;
}
/** 14 s of everything the stunt law does, with a floor to hit. */
function replay(bird) {
  const DT = 1 / 60;
  const out = [];
  let x = 0; let y = 0; let rudder = 0; let throttle = 1;
  for (let i = 0; i < 840; i += 1) {
    const t = i * DT;
    if (t < 1) { x = 0; y = 0; rudder = 0; throttle = 1; }
    else if (t < 2) { x = 0.6; y = 0; }
    else if (t < 3.5) { x = 0; y = -0.5; }
    else if (t < 4.5) { x = -0.3; y = 0.4; rudder = 0.5; }
    else if (t < 6) { x = 0; y = 0; rudder = 0; throttle = 0.55; }
    else if (t < 7) { x = 0.2; y = -0.9; throttle = 1.35; }
    else if (t < 9) { x = 0; y = 0.8; throttle = 1; }
    else if (t < 11) { x = 0.9; y = 0; }
    else { x = 0; y = 0; }
    bird.tick({ x, y, active: x !== 0 || y !== 0, rudder, throttle }, DT);
    if (i === 600) bird.speed = 4;
    if (i === 660) bird.cruise = 11;
    if (i % 60 === 59) {
      out.push(bird.position.x, bird.position.y, bird.position.z,
        bird.quaternion.x, bird.quaternion.y, bird.quaternion.z, bird.quaternion.w, bird.speed);
    }
  }
  return out;
}
// ---- END REPLAY ----

// Produced by the replay above against src/flight/bird-flight-stunt.js at
// e252ca1, BEFORE the air sampler existed. The pole run touches the floor on
// 305 frames and the equator run on 174, so the clamp and the terrain
// deflection are inside the proof, not beside it. Rows are one per second:
// position xyz, quaternion xyzw, speed.
const GOLDEN = {
  pole: [
    [0, 108.45467562694365, -10.981803190782966, -0.050435156144855754, 0, 0, 0.9987273376776309, 11],
    [2.9570709614835217e-16, 106.22545990421374, -21.744681816770044, -0.07818207616354136, -0.06360239144491076, -0.6278540966125691, 0.7717781625156667, 11],
    [3.9497822241408422, 102.05262726121789, -30.94326851888283, 0.17214157252613843, -0.3249518864264215, -0.5351689368221139, 0.7605049372468415, 10.994728417621008],
    [12.843289836930687, 98.51526120518533, -35.9965724694213, 0.03737238272515994, -0.5225364606187377, -0.45266602117622523, 0.7215624890513436, 11.06759103147514],
    [20.393619675210726, 90.37290032269024, -39.31645616381365, -0.32127463927751104, -0.5191311777866116, -0.16498398902970368, 0.774639083554939, 10.979288108499349],
    [27.814039558670153, 84.46399379664561, -42.11237619304445, -0.2902868765398608, -0.5033163959721496, -0.04049487384161842, 0.8128753287232225, 8.775114680499202],
    [35.66506847928982, 85.67127726224749, -46.524552665610294, 0.22852261830829745, -0.4638116380384902, 0.22808797693798455, 0.8250042739997828, 10.542570704670183],
    [42.69122615031422, 81.91323023123243, -50.67524502303002, -0.49811536859010835, -0.40325506885843615, -0.2748335486536259, 0.7167516651873047, 11.01961659729774],
    [42.30844179643254, 69.55864739547668, -49.89016527835954, -0.7024381413780233, -0.3231595186258774, -0.269101765133956, 0.5742236698888967, 14.509469164124607],
    [47.40128141426674, 63.07083333487759, -53.02025261362158, 0.6519452285100116, -0.44899951240702446, -0.3051834718965877, -0.5293674577856485, 15.946606720335893],
    [48.7008565857343, 61.18406917420073, -53.77423975592017, 0.11824140738226352, 0.7876274747473726, 0.6039894325034636, -0.02930351561652794, 4],
    [50.55690158513058, 56.96306776457198, -56.06905245992168, 0.14020221003197533, 0.7050077092596254, 0.6950702598541068, 0.013594265445198258, 11.463501871944361],
    [50.98465259459611, 48.598580466143275, -62.303873478961854, 0.10806549895781305, 0.5723875741110814, 0.8125477202962889, 0.021459617413569266, 13.563311550575957],
    [51.82425257930086, 37.25642213699821, -68.29353037706969, -0.09492412008416781, 0.5650061786923014, 0.8133181793065822, -0.10134578765394765, 12.45262855114749],
  ],
  equator: [
    [108.45467562694365, 10.981803190782966, 2.0354088784794538e-17, -0.4741460907663874, -0.5245812469112434, 0.4741460907663874, -0.5245812469112434, 11],
    [106.22545990421375, 21.744681816770044, -4.3658876323844954e-15, -0.0010697991473226675, -0.7071059719234332, 0.6925262872048028, -0.1428542667557742, 11],
    [102.0526272612179, 30.94326851888283, -3.9497822241408587, -0.036262843262223086, -0.3992902075581968, 0.8963836665107576, -0.18907315716250608, 10.994728417621006],
    [98.51526120518535, 35.99657246942129, -12.843289836930705, 0.10813380500922955, -0.30715983344183523, 0.8670686767857334, -0.37703027288434815, 11.067591031475137],
    [90.37290032269027, 39.31645616381361, -20.393619675210754, 0.11537536126944498, -0.37088326703776975, 0.5687398055468729, -0.725030455794678, 10.979288108499347],
    [84.46399379664564, 42.11237619304441, -27.81403955867019, 0.010611408815204133, -0.3201703415662747, 0.5331998609985658, -0.7829918636968076, 8.775114680499199],
    [85.67127726224753, 46.52455266561021, -35.665068479289886, -0.40890161560378624, 0.047708979642497575, 0.6446252767042931, -0.6441906353339829, 10.542570704670185],
    [81.9132302312325, 50.675245023029916, -42.69122615031433, 0.22972616045743469, -0.5432227567863002, 0.4483624570546327, -0.6716442769911112, 11.01961659729774],
    [68.97357764770241, 49.44392121168792, -41.74713893852886, 0.3967093559188952, -0.6697361776895765, 0.20011468498871113, -0.595003573159057, 14.542286526447501],
    [65.65537054742872, 42.514670360834515, -50.47082827072008, -0.04391355508402799, 0.5236632156566047, 0.7475264230511419, 0.4062667634552963, 14.773191817229602],
    [65.31056325103684, 39.46080237337437, -53.001033044572765, -0.3820054551868721, -0.33933888793863726, -0.6692225217685459, 0.539501777288824, 4],
    [65.85173831368537, 33.60552300109388, -55.864108853277756, -0.2594068139933643, -0.459581065674742, -0.5411794381273751, 0.6546893650237731, 8.360152867906715],
    [67.30042113395122, 25.203345698482686, -59.113853019246335, -0.44735748270906767, -0.33133968711048944, -0.4108243627232575, 0.7220170617116812, 9.91453074718865],
    [67.65046777236641, 15.482923053538952, -62.44032262303424, -0.5512103042613916, -0.23991565970024523, -0.33457255547076853, 0.7257195614233033, 10.561465187001602],
  ],
};

function assertBitIdentical(actual, site, label) {
  const expected = GOLDEN[site].flat();
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    // `===`, not assert.strictEqual: SameValue would call -0 and 0 different,
    // and a golden printed by toString() cannot tell them apart either.
    assert.ok(actual[i] === expected[i],
      `${label} ${site}: value ${i} (second ${Math.floor(i / 8) + 1}, field ${i % 8}) is ${actual[i]}, the base gave ${expected[i]}`);
  }
}

for (const site of ['pole', 'equator']) {
  test(`${site}: with no air sampler the stunt law is the base commit's, to the last bit`, () => {
    assertBitIdentical(replay(makeReplayBird(site)), site, 'no sampler');
  });

  test(`${site}: a sampler that returns still air changes nothing either`, () => {
    const bird = makeReplayBird(site, { airSampler: () => 0 });
    assertBitIdentical(replay(bird), site, 'zero sampler');
    assert.equal(bird.lastAir, 0);
  });
}

const DT = 1 / 60;
function levelBird({ sampler = null, model, center = new THREE.Vector3(0, 0, 0) } = {}) {
  const up = new THREE.Vector3(0, 1, 0);
  const bird = new BirdFlightStunt(THREE, {
    sphereRadius: 100, speed: 11, sphereCenter: center,
    position: center.clone().addScaledVector(up, 130),
    ...(sampler ? { airSampler: sampler } : {}),
    ...(model ? { model } : {}),
  });
  return bird;   // identity: nose along -Z, wings level at the +Y pole
}
const radiusOf = (b) => b.position.distanceTo(b.sphereCenter);

test('rising air lifts a hands-off level bird by exactly w·t, along the radial, without turning it', () => {
  const still = levelBird();
  const lifted = levelBird({ sampler: () => 1.5 });
  for (let i = 0; i < 180; i += 1) {
    still.tick({ x: 0, y: 0, active: false }, DT);
    lifted.tick({ x: 0, y: 0, active: false }, DT);
  }
  const gain = radiusOf(lifted) - radiusOf(still);
  assert.ok(Math.abs(gain - 1.5 * 3) < 0.05, `3 s at 1.5 units/s: +${gain.toFixed(3)}`);
  assert.equal(lifted.lastAir, 1.5);
  const nose = (b) => b.pitchAngle() * 180 / Math.PI;
  assert.ok(Math.abs(nose(lifted) - nose(still)) < 0.5, 'position, never the orientation: the nose stays level');
});

test('the sampler is asked about the sphere-centred position, before the frame moves the bird', () => {
  const center = new THREE.Vector3(5, -3, 2);
  const seen = [];
  const bird = levelBird({ center, sampler: (x, y, z) => { seen.push([x, y, z]); return 0; } });
  const before = bird.position.clone().sub(center);
  bird.tick({ x: 0, y: 0, active: false }, DT);
  assert.equal(seen.length, 1, 'once per frame');
  assert.deepEqual(seen[0], [before.x, before.y, before.z]);
});

test('a commanded speed is never carried by the air: walking, falling, a freeze, the nest', () => {
  const bird = levelBird({ sampler: () => 2 });
  bird.setSpeed(0);   // what __BIRB.freeze(true) and the nest do
  const r0 = radiusOf(bird);
  for (let i = 0; i < 60; i += 1) bird.tick({ x: 0, y: 0, active: false }, DT);
  assert.equal(radiusOf(bird), r0, 'held exactly');
  assert.equal(bird.lastAir, 0);
  bird.speed = 2.1;   // the walk writes speed directly
  for (let i = 0; i < 60; i += 1) bird.tick({ x: 0, y: 0, active: false }, DT);
  assert.equal(bird.lastAir, 0, 'walking');
  bird.cruise = 11;   // the handover back to flight
  bird.tick({ x: 0, y: 0, active: false }, DT);
  assert.equal(bird.lastAir, 2, 'flying again, carried again');
});

test('the classic model never sees the air', () => {
  const plain = levelBird({ model: 'classic' });
  const withAir = levelBird({ model: 'classic', sampler: () => 2 });
  for (let i = 0; i < 120; i += 1) {
    plain.tick({ x: 0.2, y: 0.1, active: true }, DT);
    withAir.tick({ x: 0.2, y: 0.1, active: true }, DT);
  }
  assert.ok(plain.position.x === withAir.position.x && plain.position.y === withAir.position.y
    && plain.position.z === withAir.position.z, 'identical to the bit');
  assert.equal(withAir.lastAir, 0);
});

test('sinking air cannot take the bird through the floor, and nonsense from a sampler is ignored', () => {
  const bird = new BirdFlightStunt(THREE, {
    sphereRadius: 100, speed: 11, birdRadius: 0.6, terrainHeightAt: replayTerrain,
    position: new THREE.Vector3(0, 108, 0), airSampler: () => -40,
  });
  for (let i = 0; i < 240; i += 1) {
    bird.tick({ x: 0, y: 0, active: false }, DT);
    const p = bird.position;
    const floor = 100 + replayTerrain(p.x, p.y, p.z) + 0.6;
    assert.ok(p.length() >= floor - 1e-9, 'never below the floor');
  }
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    const b = levelBird({ sampler: () => bad });
    const control = levelBird();
    for (let i = 0; i < 30; i += 1) {
      b.tick({ x: 0, y: 0, active: false }, DT);
      control.tick({ x: 0, y: 0, active: false }, DT);
    }
    assert.ok(b.position.x === control.position.x && b.position.y === control.position.y
      && b.position.z === control.position.z, `${bad} is still air`);
    assert.equal(b.lastAir, 0);
  }
});

test('a hands-off level bird flown through a real thermal climbs, and without the field holds', () => {
  const field = createAirField({ seed: 'forest', sphereRadius: 100, terrainHeight: replayTerrain });
  // Sun on the strongest thermal's own slope.
  const t = field.thermals[0];
  field.update(0, ...t.normal);
  const make = (sampler) => {
    const up = new THREE.Vector3(...t.dir);
    const agl = 15;
    const r = 100 + replayTerrain(up.x, up.y, up.z) + agl;
    const bird = new BirdFlightStunt(THREE, {
      sphereRadius: 100, speed: 11, birdRadius: 0.6, terrainHeightAt: replayTerrain,
      position: up.clone().multiplyScalar(r), ...(sampler ? { airSampler: sampler } : {}),
    });
    const ref = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const fwd = ref.addScaledVector(up, -ref.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    bird.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
    return bird;
  };
  const still = make(null);
  const soaring = make(field.sampler);
  const r0 = still.position.length();
  for (let i = 0; i < 90; i += 1) {
    still.tick({ x: 0, y: 0, active: false }, DT);
    soaring.tick({ x: 0, y: 0, active: false }, DT);
  }
  const held = still.position.length() - r0;
  const climbed = soaring.position.length() - r0;
  assert.ok(Math.abs(held) < 0.05, `no field: ${held.toFixed(3)}`);
  assert.ok(climbed > 1.5, `through the core for 1.5 s: +${climbed.toFixed(2)}`);
});
