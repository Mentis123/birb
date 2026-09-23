/**
 * The horizon bake (src/environment/horizon-map.js), on synthetic planets.
 *
 * Every number the runtime shadow reads comes out of this bake, and the bake
 * has three conventions that must agree with the shader to the letter: which
 * texel is where on the sphere, which way azimuth 0 points, and how an angle
 * becomes a byte. A convention that is off by a mirror renders a shadow on
 * the wrong side of every ridge and still LOOKS like a shadow, so each is
 * pinned here by a case whose right answer is known in closed form.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HORIZON_AZIMUTHS, HORIZON_MAP_DEFAULTS,
  encodeHorizonAngle, decodeHorizonByte, encodeEnvelopeHeight, decodeEnvelopeByte,
  horizonTexelDirection, horizonUv, horizonFrame, horizonSteps, sampleGrid, fillHeightGrid,
  frustumProfile, latheProfile, domeProfile, splatProp, createGridTrig, PROFILE_SAMPLES,
  createHorizonBake, texelAngles, horizonAt, sunVisibility, skyVisibility,
} from '../src/environment/horizon-map.js';
import { evaluateSunElevationAzimuth } from '../src/environment/horizon-shadow.js';

const R = 120;
const W = 128;
const H = 64;
const TAU = Math.PI * 2;

function bakeOf(terrainFn, occluderFn = terrainFn, opts = {}) {
  const terrain = new Float32Array(W * H);
  const occluder = new Float32Array(W * H);
  fillHeightGrid(terrain, W, H, terrainFn, 1);
  fillHeightGrid(occluder, W, H, occluderFn, 1);
  for (let n = 0; n < W * H; n++) occluder[n] = Math.max(occluder[n], terrain[n]);
  const bake = createHorizonBake({ radius: R, width: W, height: H, terrain, occluder, ...opts });
  bake.step(H);
  return bake;
}

// A ridge along the meridian at longitude PI (u = 0.5): height H0 on the
// crest, falling linearly to 0 at `half` units either side.
const RIDGE_H = 20;
const RIDGE_HALF = 6;
function ridge(x, y, z) {
  // Meridian plane through +Y and longitude PI: its normal is (0, 0, -1).
  const s = -z;
  const dist = Math.abs(Math.asin(Math.max(-1, Math.min(1, s)))) * R;
  return RIDGE_H * Math.max(0, 1 - dist / RIDGE_HALF) - 10;
}

test('an angle survives the byte within half a step', () => {
  for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.0137) {
    const back = decodeHorizonByte(encodeHorizonAngle(a));
    assert.ok(Math.abs(back - a) / Math.PI <= 0.5 / 255 + 1e-12, `${a} -> ${back}`);
  }
  assert.equal(encodeHorizonAngle(-10), 0);
  assert.equal(encodeHorizonAngle(10), 255);
  // Zero bytes are the "fully open" placeholder: 90 degrees below the horizon.
  assert.equal(decodeHorizonByte(0), -Math.PI / 2);
});

test('the envelope byte round-trips within half a step', () => {
  for (let h = -80; h <= 120; h += 1.37) {
    assert.ok(Math.abs(decodeEnvelopeByte(encodeEnvelopeHeight(h)) - h) <= 200 / 255 / 2 + 1e-9);
  }
});

test('a texel centre maps back to its own uv — the shader\'s lookup is the bake\'s layout', () => {
  const uv = {};
  for (const [i, j] of [[0, 0], [5, 7], [63, 31], [127, 63], [100, 12]]) {
    const d = horizonTexelDirection(i, j, W, H);
    horizonUv(d.x, d.y, d.z, uv);
    assert.ok(Math.abs(uv.u - (i + 0.5) / W) < 1e-9, `u at ${i},${j}`);
    assert.ok(Math.abs(uv.v - (j + 0.5) / H) < 1e-9, `v at ${i},${j}`);
  }
  // Row 0 is the +Y pole, as in three's SphereGeometry.
  assert.ok(horizonTexelDirection(0, 0, W, H).y > 0.99);
});

test('the local frame is orthonormal and East points toward increasing u', () => {
  const f = {}; const uv0 = {}; const uv1 = {};
  for (const [i, j] of [[3, 9], [40, 32], [90, 50], [120, 20]]) {
    const d = horizonTexelDirection(i, j, W, H);
    horizonFrame(d.x, d.y, d.z, f);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const E = [f.ex, f.ey, f.ez]; const N = [f.nx, f.ny, f.nz]; const U = [d.x, d.y, d.z];
    assert.ok(Math.abs(dot(E, U)) < 1e-9 && Math.abs(dot(N, U)) < 1e-9 && Math.abs(dot(E, N)) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...E) - 1) < 1e-9 && Math.abs(Math.hypot(...N) - 1) < 1e-9);
    horizonUv(d.x, d.y, d.z, uv0);
    const e = 1e-3;
    horizonUv(d.x + E[0] * e, d.y + E[1] * e, d.z + E[2] * e, uv1);
    let du = uv1.u - uv0.u; if (du < -0.5) du += 1; if (du > 0.5) du -= 1;
    assert.ok(du > 0, 'East increases u');
    // North points toward the +Y pole (decreasing v).
    horizonUv(d.x + N[0] * e, d.y + N[1] * e, d.z + N[2] * e, uv1);
    assert.ok(uv1.v < uv0.v, 'North decreases v');
  }
});

test('the shader\'s sun frame agrees with the bake\'s azimuths', () => {
  // Azimuth a is cos(a PI/4) East + sin(a PI/4) North. Handing the shader's
  // own frame mirror that exact direction must read back azimuth a at zero
  // elevation — a mirrored frame reads -a and shadows the wrong side.
  const f = {};
  for (const [i, j] of [[10, 20], [70, 40], [33, 5]]) {
    const d = horizonTexelDirection(i, j, W, H);
    horizonFrame(d.x, d.y, d.z, f);
    for (let a = 0; a < HORIZON_AZIMUTHS; a++) {
      const al = (a * TAU) / HORIZON_AZIMUTHS;
      const dir = [
        Math.cos(al) * f.ex + Math.sin(al) * f.nx,
        Math.cos(al) * f.ey + Math.sin(al) * f.ny,
        Math.cos(al) * f.ez + Math.sin(al) * f.nz,
      ];
      const { elevation, azimuth } = evaluateSunElevationAzimuth([d.x, d.y, d.z], dir);
      let diff = azimuth - al; diff -= Math.round(diff / TAU) * TAU;
      assert.ok(Math.abs(diff) < 1e-9, `azimuth ${a}: ${azimuth}`);
      assert.ok(Math.abs(elevation) < 1e-9);
    }
  }
});

test('a flat planet\'s skyline is the geometric horizon dip, curvature exact', () => {
  const bias = HORIZON_MAP_DEFAULTS.eyeBias;
  const dip = -Math.acos(R / (R + bias));      // about -7 degrees
  const bake = bakeOf(() => 0);
  const angles = new Float64Array(8);
  for (const [i, j] of [[10, 32], [64, 20], [100, 44], [5, 10]]) {
    texelAngles(bake.ground, W, i, j, angles);
    for (let a = 0; a < 8; a++) {
      assert.ok(Math.abs(angles[a] - dip) < 0.015,
        `texel ${i},${j} az ${a}: ${(angles[a] * 180 / Math.PI).toFixed(2)} vs dip ${(dip * 180 / Math.PI).toFixed(2)} deg`);
    }
    assert.equal(skyVisibility(angles), 1, 'a flat planet leaves the whole sky open');
  }
});

test('a single ridge shadows its lee side for a low sun and not for a high one', () => {
  const bake = bakeOf(ridge);
  // Equator row, a column ~22 units WEST of the crest (u = 0.5 is the crest).
  const j = H / 2;
  const unitsPerColumn = (TAU * R) / W;           // at the equator
  const i = Math.round(W / 2 - 0.5 - 22 / unitsPerColumn);
  const d = horizonTexelDirection(i, j, W, H);
  const angles = texelAngles(bake.ground, W, i, j);
  // The crest is due EAST (azimuth 0) and stands 20 units over a floor at
  // -10: from 22 units that is roughly 25-35 degrees, minus the curvature.
  const east = angles[0];
  assert.ok(east > 0.35 && east < 0.62, `skyline toward the ridge ${(east * 180 / Math.PI).toFixed(1)} deg`);
  const west = angles[4];
  assert.ok(west < 0, `skyline away from the ridge ${(west * 180 / Math.PI).toFixed(1)} deg`);

  const f = horizonFrame(d.x, d.y, d.z, {});
  const sunFrom = (azimuth, elevation) => {
    const c = Math.cos(elevation);
    return [
      c * (Math.cos(azimuth) * f.ex + Math.sin(azimuth) * f.nx) + Math.sin(elevation) * d.x,
      c * (Math.cos(azimuth) * f.ey + Math.sin(azimuth) * f.ny) + Math.sin(elevation) * d.y,
      c * (Math.cos(azimuth) * f.ez + Math.sin(azimuth) * f.nz) + Math.sin(elevation) * d.z,
    ];
  };
  const visFor = (sun) => {
    const { elevation, azimuth } = evaluateSunElevationAzimuth([d.x, d.y, d.z], sun);
    return sunVisibility(angles, azimuth, elevation);
  };
  assert.ok(visFor(sunFrom(0, 0.2)) < 0.05, 'a low sun behind the ridge is hidden');
  assert.ok(visFor(sunFrom(0, 0.95)) > 0.95, 'a high sun clears it');
  assert.ok(visFor(sunFrom(Math.PI, 0.2)) > 0.95, 'the same low sun from the open side is not');
  // The windward side of the crest (east of it) sees the low eastern sun.
  const iEast = Math.round(W / 2 - 0.5 + 22 / unitsPerColumn);
  const east2 = texelAngles(bake.ground, W, iEast, j)[0];
  assert.ok(east2 < 0.05, `the far side has open sky to the east (${(east2 * 180 / Math.PI).toFixed(1)} deg)`);
  // And the valley below a ridge sees less sky than a flat plain does.
  assert.ok(skyVisibility(angles) < 0.97);
});

test('the bake is deterministic: same inputs, same bytes', () => {
  const a = bakeOf(ridge);
  const b = bakeOf(ridge);
  for (let k = 0; k < 2; k++) {
    assert.deepEqual(a.ground[k], b.ground[k]);
    assert.deepEqual(a.prop[k], b.prop[k]);
  }
});

test('slicing the bake changes nothing: 3 rows at a time equals all at once', () => {
  const terrain = new Float32Array(W * H);
  fillHeightGrid(terrain, W, H, ridge, 1);
  const whole = createHorizonBake({ radius: R, width: W, height: H, terrain, occluder: terrain });
  whole.step(H);
  const sliced = createHorizonBake({ radius: R, width: W, height: H, terrain, occluder: terrain });
  let guard = 0;
  while (!sliced.step(3) && guard++ < 100);
  assert.ok(sliced.done);
  assert.deepEqual(sliced.ground[0], whole.ground[0]);
  assert.deepEqual(sliced.ground[1], whole.ground[1]);
});

test('the prop set looks out from the TOP of what stands there; the ground set from under it', () => {
  // A 30-unit column, ~4 units across, on a flat plain.
  const centre = horizonTexelDirection(W / 2, H / 2, W, H);
  const column = (x, y, z) => {
    const c = x * centre.x + y * centre.y + z * centre.z;
    return Math.acos(Math.min(1, c)) * R < 4.5 ? 30 : 0;
  };
  const bake = bakeOf(() => 0, column);
  const onTop = texelAngles(bake.prop, W, W / 2, H / 2);
  const under = texelAngles(bake.ground, W, W / 2, H / 2);
  for (let a = 0; a < 8; a++) {
    assert.ok(under[a] > 0.8, `from the ground inside the column, az ${a} is walled in (${under[a].toFixed(2)})`);
    assert.ok(onTop[a] < 0, `from its top, az ${a} is open sky (${onTop[a].toFixed(2)})`);
  }
  // Next door, the column is a skyline in exactly one direction: the texel
  // two columns WEST sees it due EAST.
  const west = texelAngles(bake.ground, W, W / 2 - 2, H / 2);
  assert.ok(west[0] > 0.6, `the column casts toward the west (${west[0].toFixed(2)})`);
  assert.ok(west[4] < 0.05, 'and not away from itself');
  // Where nothing stands, the two sets are the same bytes.
  const px = ((H / 2 - 10) * W + 5) * 4;
  assert.equal(bake.prop[0][px], bake.ground[0][px]);
});

test('the skyline between two azimuths is the tent-weighted blend of both', () => {
  const angles = [0.5, 0, 0, 0, 0, 0, 0, 0.3];
  assert.ok(Math.abs(horizonAt(angles, 0) - 0.5) < 1e-12);
  assert.ok(Math.abs(horizonAt(angles, Math.PI / 8) - 0.25) < 1e-12);
  assert.ok(Math.abs(horizonAt(angles, -Math.PI / 8) - 0.4) < 1e-12, 'wraps from azimuth 0 back to 7');
  assert.ok(Math.abs(horizonAt(angles, TAU - Math.PI / 8) - 0.4) < 1e-12);
});

test('sky visibility is the cosine-weighted share of the dome left open', () => {
  assert.equal(skyVisibility(new Float64Array(8).fill(-0.2)), 1, 'a skyline below the horizon leaves it all');
  const h = 0.4;
  assert.ok(Math.abs(skyVisibility(new Float64Array(8).fill(h)) - Math.cos(h) ** 2) < 1e-12);
  assert.ok(Math.abs(skyVisibility(new Float64Array(8).fill(Math.PI / 2))) < 1e-12, 'a well sees none');
});

test('the penumbra is a smoothstep across the skyline, a few degrees wide', () => {
  const angles = new Float64Array(8).fill(0.4);
  assert.equal(sunVisibility(angles, 1, 0.4 - 0.06), 0);
  assert.equal(sunVisibility(angles, 1, 0.4 + 0.06), 1);
  assert.ok(Math.abs(sunVisibility(angles, 1, 0.4) - 0.5) < 1e-12);
});

test('the march is dense near the eye and reaches the configured distance', () => {
  const steps = horizonSteps(HORIZON_MAP_DEFAULTS);
  assert.ok(steps[0] <= 1.5, 'a canopy edge a texel away is seen');
  assert.ok(steps[steps.length - 1] >= HORIZON_MAP_DEFAULTS.maxDistance - 1e-9);
  for (let k = 1; k < steps.length; k++) assert.ok(steps[k] > steps[k - 1]);
});

test('a strided terrain fill is a faithful upsample of a smooth field', () => {
  const smooth = (x, y, z) => 8 * Math.sin(x * 3) * Math.cos(z * 2) + 4 * y;
  const exact = new Float32Array(W * H);
  fillHeightGrid(exact, W, H, smooth, 1);
  // 2, and the shipping stride; W = 128 is not a multiple of 3, so the last
  // coarse column wraps over a SHORTER span, which is the case to get right.
  for (const stride of [2, HORIZON_MAP_DEFAULTS.terrainStride]) {
    const coarse = new Float32Array(W * H);
    fillHeightGrid(coarse, W, H, smooth, stride);
    let worst = 0;
    for (let n = 0; n < W * H; n++) worst = Math.max(worst, Math.abs(exact[n] - coarse[n]));
    assert.ok(worst < 0.25 * stride * stride, `stride ${stride} differs by ${worst.toFixed(3)} units`);
    // Coarse lattice points are exact samples.
    assert.equal(coarse[5 * stride * W + 2 * stride], exact[5 * stride * W + 2 * stride]);
  }
});

test('bilinear grid sampling wraps in longitude and clamps at the poles', () => {
  const g = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) g[j * W + i] = i === W - 1 ? 10 : i === 0 ? 20 : 0;
  assert.equal(sampleGrid(g, W, H, W - 0.5, 5), 15, 'halfway across the seam');
  assert.equal(sampleGrid(g, W, H, -0.5, 5), 15);
  assert.equal(sampleGrid(g, W, H, 3, -4), sampleGrid(g, W, H, 3, 0));
});

test('prop profiles: a cone is a cone, a frustum has a flat top, a lathe follows its own outline', () => {
  const cone = frustumProfile(0, 1);
  assert.equal(cone[0], 1);
  assert.ok(Math.abs(cone[(PROFILE_SAMPLES - 1) / 2] - 0.5) < 1e-6);
  assert.equal(cone[PROFILE_SAMPLES - 1], 0);
  const spire = frustumProfile(0.3, 1);
  assert.equal(spire[0], 1);
  assert.equal(spire[Math.floor(0.25 * (PROFILE_SAMPLES - 1))], 1, 'inside the top radius the top is flat');
  const lathe = latheProfile([{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 0, y: 1 }]);
  assert.equal(lathe[0], 1);
  assert.ok(Math.abs(lathe[PROFILE_SAMPLES - 1] - 0.2) < 1e-6, 'the rim is at the widest point\'s height');
  const dome = domeProfile();
  assert.equal(dome[0], 1);
  assert.equal(dome[PROFILE_SAMPLES - 1], 0);
});

test('splatting a cone raises its footprint and nothing else', () => {
  const g = new Float32Array(W * H);
  const dir = horizonTexelDirection(W / 2, H / 2, W, H);
  const f = horizonFrame(dir.x, dir.y, dir.z, {});
  const trig = createGridTrig(W, H);
  const raised = splatProp(g, W, H, R, {
    dir: [dir.x, dir.y, dir.z], ex: [f.ex, f.ey, f.ez], ez: [f.nx, f.ny, f.nz],
    halfX: 12, halfZ: 12, base: 2, span: 30, profile: frustumProfile(0, 1),
  }, trig);
  assert.ok(raised > 10);
  const top = g[(H / 2) * W + W / 2];
  assert.ok(top > 2 + 30 * 0.8 && top <= 32 + 1e-6, `the apex texel stands ${top.toFixed(1)}`);
  // Far outside the 12-unit footprint nothing moved.
  assert.equal(g[(H / 2) * W + W / 2 + 12], 0);
  assert.equal(g[(H / 2 - 8) * W + W / 2], 0);
});

test('a footprint edge is anti-aliased: a texel it half covers is raised by its coverage', () => {
  // A hard in/out test stands every canopy on a staircase of 1.5-unit steps,
  // and a shadow is that outline projected along the sun. A box whose edge
  // sits a quarter texel past the neighbours' centres must raise them by
  // about three quarters, and not touch the texel beyond.
  const g = new Float32Array(W * H);
  const i0 = W / 2; const j0 = H / 2;
  const dir = horizonTexelDirection(i0, j0, W, H);
  const f = horizonFrame(dir.x, dir.y, dir.z, {});
  const texel = (Math.PI * R) / H;
  splatProp(g, W, H, R, {
    dir: [dir.x, dir.y, dir.z], ex: [f.ex, f.ey, f.ez], ez: [f.nx, f.ny, f.nz],
    halfX: 1.25 * texel, halfZ: 1.25 * texel, base: 0, span: 10, profile: null,
  }, createGridTrig(W, H));
  const at = (i, j) => g[j * W + i];
  assert.equal(at(i0, j0), 10, 'the covered centre stands at the top');
  for (const [i, j] of [[i0 + 1, j0], [i0 - 1, j0], [i0, j0 + 1], [i0, j0 - 1]]) {
    const v = at(i, j);
    assert.ok(v > 6.5 && v < 8.5, `an edge texel stands at its coverage, not the top (${v.toFixed(2)})`);
  }
  assert.equal(at(i0 + 2, j0), 0, 'past the edge nothing moved');
  assert.equal(at(i0, j0 + 2), 0);
});
