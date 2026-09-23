// tests/atmosphere-model.test.js — the compact physical sky, used as a ratio.
//
// The game never shows this model's absolute radiance: it multiplies each
// biome's AUTHORED palette by model(e_now) / model(e_ref). So the properties
// that matter are the ones pinned here — the ratio is exactly 1 at the
// authored elevation, it moves the way a real sky moves as the sun drops, it
// is finite and bounded across the whole cycle, and the default resolution
// agrees with a four-times-finer run of the same equations.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAtmosphereModel, createAtmosphereOutput, relativeInto, ratioInto,
  ATMOSPHERE_FIELDS, RATIO_BOUNDS, LUMA, EARTH_ATMOSPHERE,
} from '../src/environment/atmosphere-model.js';
import { SUN_CYCLE_DEFAULTS } from '../src/environment/sun-cycle.js';

// The forest's authored key light, world-shell.js: position [7.5, 8.2, 5.2].
const E_REF = Math.asin(8.2 / Math.hypot(7.5, 8.2, 5.2));
const lum = (v) => LUMA[0] * v[0] + LUMA[1] * v[1] + LUMA[2] * v[2];
const UNBOUNDED = { minLum: 0, maxLum: Infinity, minChannel: 0, maxChannel: Infinity };

const model = createAtmosphereModel();

test('the parameters are Hillaire 2020 / Bruneton Earth, in per-km units', () => {
  assert.deepEqual([...EARTH_ATMOSPHERE.rayleighScattering], [5.802e-3, 13.558e-3, 33.1e-3]);
  assert.equal(EARTH_ATMOSPHERE.rayleighScaleHeight, 8);
  assert.equal(EARTH_ATMOSPHERE.mieScattering, 3.996e-3);
  assert.equal(EARTH_ATMOSPHERE.mieExtinction, 4.40e-3);
  assert.equal(EARTH_ATMOSPHERE.mieScaleHeight, 1.2);
  assert.equal(EARTH_ATMOSPHERE.mieG, 0.8);
  assert.deepEqual([...EARTH_ATMOSPHERE.ozoneAbsorption], [0.650e-3, 1.881e-3, 0.085e-3]);
  assert.equal(EARTH_ATMOSPHERE.ozoneCenter, 25);
  assert.equal(EARTH_ATMOSPHERE.ozoneHalfWidth, 15);
  assert.equal(EARTH_ATMOSPHERE.groundRadius, 6360);
  assert.equal(EARTH_ATMOSPHERE.topRadius, 6460);
});

test('the sun gets redder and dimmer as it drops', () => {
  const out = createAtmosphereOutput();
  let prevLum = Infinity;
  let prevBlueOverRed = Infinity;
  for (let e = 1.10; e >= 0.30 - 1e-9; e -= 0.05) {
    model.evaluate(e, out);
    const t = out.sun;
    assert.ok(t[0] > t[1] && t[1] > t[2], `e=${e.toFixed(2)}: red transmits best (${[...t].map((v) => v.toFixed(3))})`);
    assert.ok(lum(t) < prevLum, `e=${e.toFixed(2)}: dimmer than the higher sun`);
    assert.ok(t[2] / t[0] < prevBlueOverRed, `e=${e.toFixed(2)}: redder than the higher sun`);
    prevLum = lum(t);
    prevBlueOverRed = t[2] / t[0];
  }
  // And the magnitude is Earth's, not a toy's: blue through ~1.5 air masses
  // at 42 degrees keeps roughly two thirds.
  model.evaluate(E_REF, out);
  assert.ok(out.sun[2] > 0.6 && out.sun[2] < 0.75, `blue transmittance at e_ref ${out.sun[2]}`);
});

test('the sky moves the way a sky moves: brighter overhead at noon, a warm glow on the sunward horizon when low', () => {
  const low = createAtmosphereOutput();
  const high = createAtmosphereOutput();
  model.evaluate(SUN_CYCLE_DEFAULTS.minElevation, low);
  model.evaluate(SUN_CYCLE_DEFAULTS.maxElevation, high);
  assert.ok(high.lum.zenith > low.lum.zenith * 1.5, `zenith ${low.lum.zenith} -> ${high.lum.zenith}`);
  assert.ok(high.lum.irradiance > low.lum.irradiance * 1.2, `sky irradiance ${low.lum.irradiance} -> ${high.lum.irradiance}`);
  // Low sun: the sunward horizon outshines the far side, and is warmer.
  assert.ok(low.lum.horizonSun > low.lum.horizonAway, 'sunward horizon is the bright one');
  assert.ok(low.horizonSun[0] / low.horizonSun[2] > low.horizonAway[0] / low.horizonAway[2], 'and the warm one');
  // The sky is blue: zenith blue beats red at every sun in the cycle.
  assert.ok(low.zenith[2] > low.zenith[0] && high.zenith[2] > high.zenith[0]);
});

test('the ratio is EXACTLY 1 at the authored elevation — the look at e_ref is the authored one', () => {
  const ref = createAtmosphereOutput();
  const cur = createAtmosphereOutput();
  const rel = createAtmosphereOutput();
  model.evaluate(E_REF, ref);
  // A different evaluation in between, so nothing is left over in scratch.
  model.evaluate(0.35, cur);
  model.evaluate(E_REF, cur);
  relativeInto(cur, ref, rel);
  for (const f of ATMOSPHERE_FIELDS) {
    for (let c = 0; c < 3; c += 1) assert.ok(rel[f][c] === 1, `${f}[${c}] = ${rel[f][c]}`);
  }
});

test('finite, positive and inside the sane bounds across the whole cycle (0.30 - 1.10 rad)', () => {
  const ref = createAtmosphereOutput();
  const cur = createAtmosphereOutput();
  const rel = createAtmosphereOutput();
  model.evaluate(E_REF, ref);
  for (let i = 0; i <= 80; i += 1) {
    const e = 0.30 + (0.80 * i) / 80;
    model.evaluate(e, cur);
    relativeInto(cur, ref, rel);
    for (const f of ATMOSPHERE_FIELDS) {
      for (let c = 0; c < 3; c += 1) {
        assert.ok(Number.isFinite(cur[f][c]) && cur[f][c] > 0, `e=${e.toFixed(3)} ${f}[${c}] = ${cur[f][c]}`);
        const r = rel[f][c];
        assert.ok(Number.isFinite(r) && r >= RATIO_BOUNDS.minChannel && r <= RATIO_BOUNDS.maxChannel, `ratio ${f}[${c}] = ${r}`);
      }
      assert.ok(rel.lum[f] >= RATIO_BOUNDS.minLum - 1e-12 && rel.lum[f] <= RATIO_BOUNDS.maxLum + 1e-12, `lum ${f} ${rel.lum[f]}`);
    }
  }
  // Nothing in the game's own range needs the clamp: the bounds are a net
  // for ?planetsun=0, where the local sun can sit on the horizon.
  const unb = createAtmosphereOutput();
  for (const e of [SUN_CYCLE_DEFAULTS.minElevation, SUN_CYCLE_DEFAULTS.maxElevation]) {
    model.evaluate(e, cur);
    relativeInto(cur, ref, rel);
    relativeInto(cur, ref, unb, UNBOUNDED);
    for (const f of ATMOSPHERE_FIELDS) for (let c = 0; c < 3; c += 1) assert.equal(rel[f][c], unb[f][c], `${f} clamped at e=${e}`);
  }
});

test('no allocation: evaluate and relativeInto fill the objects they are given', () => {
  const out = createAtmosphereOutput();
  const arrays = ATMOSPHERE_FIELDS.map((f) => out[f]);
  const lumObj = out.lum;
  const keys = Object.keys(out).join();
  for (let i = 0; i < 5; i += 1) assert.equal(model.evaluate(0.4 + i * 0.1, out), out);
  ATMOSPHERE_FIELDS.forEach((f, i) => assert.equal(out[f], arrays[i], `${f} is the same array`));
  assert.equal(out.lum, lumObj);
  assert.equal(Object.keys(out).join(), keys, 'no fields added');
  const ref = createAtmosphereOutput();
  model.evaluate(E_REF, ref);
  const rel = createAtmosphereOutput();
  const relArrays = ATMOSPHERE_FIELDS.map((f) => rel[f]);
  assert.equal(relativeInto(out, ref, rel), rel);
  ATMOSPHERE_FIELDS.forEach((f, i) => assert.equal(rel[f], relArrays[i]));
  const t = new Float64Array(3);
  assert.equal(model.sunTransmittance(0.5, t), t);
  assert.equal(model.skyRadiance(0.3, 1, t), t);
});

test('the default resolution agrees with a 4x-finer run of the same equations to within 3% on every ratio', () => {
  const fine = createAtmosphereModel({}, {
    transmittanceWidth: 128, transmittanceHeight: 64, transmittanceSteps: 96,
    msHeights: [0, 0.6, 1.2, 2.5, 4, 6, 8, 11, 14, 19, 25, 35, 45, 60],
    msBands: 12, msAzimuths: 16, msSteps: 32,
    irradianceBands: 12, irradianceAzimuths: 12, irradianceSteps: 64, viewSteps: 96,
  });
  const refF = createAtmosphereOutput(); const refD = createAtmosphereOutput();
  fine.evaluate(E_REF, refF); model.evaluate(E_REF, refD);
  const cF = createAtmosphereOutput(); const cD = createAtmosphereOutput();
  const rF = createAtmosphereOutput(); const rD = createAtmosphereOutput();
  let worst = 0; let where = '';
  for (let e = 0.30; e <= 1.1001; e += 0.1) {
    fine.evaluate(e, cF); model.evaluate(e, cD);
    relativeInto(cF, refF, rF, UNBOUNDED); relativeInto(cD, refD, rD, UNBOUNDED);
    for (const f of ATMOSPHERE_FIELDS) {
      for (let c = 0; c < 3; c += 1) {
        const err = Math.abs(rD[f][c] / rF[f][c] - 1);
        if (err > worst) { worst = err; where = `${f}[${c}] at e=${e.toFixed(2)}`; }
      }
    }
  }
  assert.ok(worst < 0.03, `worst ratio error ${(worst * 100).toFixed(2)}% (${where})`);
});

test('ratioInto: inside the bounds untouched, outside clamped by luminance with the hue kept, zero-safe', () => {
  const out = new Float64Array(3);
  ratioInto([1.1, 1.0, 0.9], [1, 1, 1], out);
  assert.deepEqual([...out], [1.1, 1.0, 0.9]);
  // 4x brighter: luminance clamps to maxLum, channels keep their proportion.
  ratioInto([4, 4, 4], [1, 1, 1], out);
  for (const v of out) assert.ok(Math.abs(v - RATIO_BOUNDS.maxLum) < 1e-12);
  ratioInto([0.1, 0.2, 0.2], [1, 1, 1], out);
  assert.ok(Math.abs(lum(out) - RATIO_BOUNDS.minLum) < 0.06, `clamped up toward minLum: ${lum(out)}`);
  assert.ok(out[0] < out[1], 'hue survives the luminance clamp');
  // A zero denominator is "no information", i.e. 1 — never Infinity or NaN.
  ratioInto([1, 1, 1], [0, 1, 1], out);
  assert.equal(out[0], 1);
  // Elevations outside the model's range are clamped, not extrapolated.
  const a = createAtmosphereOutput(); const b = createAtmosphereOutput();
  model.evaluate(-0.5, a); model.evaluate(0.02, b);
  assert.deepEqual([...a.sun], [...b.sun]);
  model.evaluate(NaN, a);
  assert.ok(ATMOSPHERE_FIELDS.every((f) => [...a[f]].every(Number.isFinite)));
});
