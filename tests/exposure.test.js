// tests/exposure.test.js — exposure like an eye (?autoexp=1, ?localtm=1).
//
// The math the shaders run, run here in JS from the SAME tables the GLSL is
// emitted from: the adaptation (converges, never overshoots, is frame-rate
// independent), the EV clamp, the per-biome key, the display model and its
// inverse, the fusion weights, and a reference pyramid that samples its
// levels the way the collapse shader does. The live page is
// tools/realism-checks/auto-exposure-*.mjs; this is the part a unit suite
// can be decisive about.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  autoExposureRequested, localToneRequested,
  AUTO_EXPOSURE, EXPOSURE_KEYS, DEFAULT_EXPOSURE_KEY, exposureKeyFor,
  logLuminance, meterWeight, targetEv, adaptationAlpha, adaptEv,
  LOCAL_TONE, neutralGray, neutralGrayInverse, srgbEncode, srgbDecode, toDisplay, fromDisplay,
  syntheticExposures, wellExposedness, fusionWeights, fuseFlat, logDisplay, LOG_DISPLAY_FLOOR,
  glslFloat, EYE_COMMON_GLSL, METER_FRAG, ADAPT_FRAG, FUSE_EXPOSURES_FRAG, FUSE_WEIGHTS_FRAG,
  COLLAPSE_FRAG, GUIDE_FRAG, patchComposite, mipLevels, fusedLevels,
  COMPOSITE_UNIFORM_ANCHOR, COMPOSITE_MAIN_ANCHOR, COMPOSITE_APPLY_ANCHOR,
} from '../src/effects/exposure.js';
import { COMPOSITE_FRAG } from '../src/effects/bloom-pass.js';
import { readBootFlag, bootFlagByKey } from '../src/ui/boot-flags.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

test('both flags are opt-in: only =1 turns them on', () => {
  for (const [search, want] of [
    ['', false], ['?debug=1', false], ['?autoexp=1', true], ['?debug=1&autoexp=1', true],
    ['?autoexp=0', false], ['?autoexp=10', false], ['?autoexp=1&x=2', true], ['?xautoexp=1', false],
  ]) {
    assert.equal(autoExposureRequested(search), want, `autoexp ${search}`);
    assert.equal(localToneRequested(search.replace(/autoexp/g, 'localtm')), want, `localtm ${search}`);
  }
  assert.equal(autoExposureRequested(undefined), false);
  assert.equal(localToneRequested(null), false);
});

test('the Flags tab offers both as Off/On selects, and reads back what the game reads', () => {
  for (const key of ['autoexp', 'localtm']) {
    const flag = bootFlagByKey(key);
    assert.ok(flag, `no boot flag ${key}`);
    assert.equal(flag.kind, 'select');
    assert.deepEqual(flag.options.map((o) => o.value), [null, '1']);
    const reader = key === 'autoexp' ? autoExposureRequested : localToneRequested;
    for (const search of ['', `?${key}=1`, `?debug=1&${key}=1`, `?${key}=0`, `?${key}=2`]) {
      assert.equal(readBootFlag(search, key).value === '1', reader(search), `${key} ${search}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Eye adaptation
// ---------------------------------------------------------------------------

test('log luminance is floored and ceilinged, never non-finite', () => {
  assert.equal(logLuminance(0), AUTO_EXPOSURE.logFloor, 'log2(0) = -Infinity must meter as the floor');
  assert.equal(logLuminance(-1), AUTO_EXPOSURE.logFloor);
  assert.equal(logLuminance(Number.NaN), AUTO_EXPOSURE.logFloor);
  assert.equal(logLuminance(Infinity), AUTO_EXPOSURE.logCeil, 'a HalfFloat overflow meters as the ceiling');
  assert.equal(logLuminance(1), 0);
  assert.equal(logLuminance(0.25), -2);
  assert.equal(logLuminance(1e9), AUTO_EXPOSURE.logCeil);
  assert.ok(Number.isFinite(logLuminance(Number.MIN_VALUE)));
});

test('the meter is centre-weighted but never blind at the corners', () => {
  const centre = meterWeight(0.5, 0.5);
  const corner = meterWeight(0, 0);
  assert.ok(centre > 2 * corner, `centre ${centre} vs corner ${corner}`);
  assert.ok(corner >= AUTO_EXPOSURE.centerFloor);
  assert.equal(meterWeight(0.2, 0.3), meterWeight(0.8, 0.7), 'symmetric about the centre');
});

test('at the key the eye leaves the authored exposure alone — exactly', () => {
  for (const key of [...Object.values(EXPOSURE_KEYS), DEFAULT_EXPOSURE_KEY]) {
    assert.equal(targetEv(key, key), 0);
  }
  // Darker than the key lifts, brighter lowers, by strength x the difference.
  assert.equal(targetEv(-3, -2), AUTO_EXPOSURE.strength * 1);
  assert.equal(targetEv(-1, -2), -AUTO_EXPOSURE.strength * 1);
  assert.equal(targetEv(Number.NaN, -2), 0, 'an unusable reading means as authored');
});

test('the EV is clamped to +/-1.5 stops of the authored exposure', () => {
  assert.equal(AUTO_EXPOSURE.evMin, -1.5);
  assert.equal(AUTO_EXPOSURE.evMax, 1.5);
  assert.equal(targetEv(-12, -2), 1.5, 'a black frame lifts 1.5 stops, no more');
  assert.equal(targetEv(8, -2), -1.5, 'a blown-out frame lowers 1.5 stops, no more');
  for (let m = -14; m <= 14; m += 0.37) {
    const ev = targetEv(m, -2);
    assert.ok(ev >= -1.5 && ev <= 1.5, `measured ${m} -> ${ev}`);
  }
});

test('every biome has a calibrated key; an unknown one gets the default', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src/environment/world-shell.js'), 'utf8');
  const ids = [...src.matchAll(/^ {4}id: "(\w+)"/gm)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), ['canyons', 'city', 'forest', 'mountain']);
  for (const id of ids) {
    assert.ok(Number.isFinite(EXPOSURE_KEYS[id]), `no key for ${id}`);
    assert.equal(exposureKeyFor(id), EXPOSURE_KEYS[id]);
    assert.ok(EXPOSURE_KEYS[id] > -6 && EXPOSURE_KEYS[id] < 2, `${id} key ${EXPOSURE_KEYS[id]} is not a lit scene`);
  }
  assert.equal(exposureKeyFor('nowhere'), DEFAULT_EXPOSURE_KEY);
  assert.equal(exposureKeyFor(undefined), DEFAULT_EXPOSURE_KEY);
});

test('adaptation alpha is the exact exponential: 1 - 1/e after one time constant', () => {
  assert.equal(adaptationAlpha(0, 1), 0);
  assert.equal(adaptationAlpha(-1, 1), 0);
  assert.ok(Math.abs(adaptationAlpha(1.1, 1.1) - (1 - Math.exp(-1))) < 1e-15);
  assert.equal(adaptationAlpha(0.1, 0), 1, 'a zero time constant is an instant eye');
  for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.25]) {
    const a = adaptationAlpha(dt, AUTO_EXPOSURE.tauDark);
    assert.ok(a > 0 && a < 1, `dt ${dt}: alpha ${a}`);
  }
});

function simulate(fps, seconds, from, target, cfg = AUTO_EXPOSURE) {
  let ev = from;
  const steps = Math.round(fps * seconds);
  const trace = [ev];
  for (let i = 0; i < steps; i++) {
    ev = adaptEv(ev, target, 1 / fps, cfg);
    trace.push(ev);
  }
  return trace;
}

test('adaptation converges on the target and never overshoots it, either way', () => {
  for (const [from, target] of [[0, 1.2], [1.2, -0.8], [-1.5, 1.5], [1.5, -1.5], [0.3, 0.31]]) {
    const trace = simulate(60, 12, from, target);
    for (let i = 1; i < trace.length; i++) {
      const before = target - trace[i - 1];
      const after = target - trace[i];
      assert.ok(Math.abs(after) <= Math.abs(before) + 1e-15, `step ${i} moved away from the target`);
      assert.ok(Math.sign(after) === Math.sign(before) || after === 0, `step ${i} crossed the target (${from} -> ${target})`);
    }
    assert.ok(Math.abs(trace[trace.length - 1] - target) < 1e-3 * Math.max(1, Math.abs(target - from)),
      `12 s did not converge: ${trace[trace.length - 1]} vs ${target}`);
  }
});

test('adaptation is frame-rate independent: 30, 60, 120 and 144 fps agree', () => {
  for (const [from, target] of [[0, 1.3], [1.1, -0.9]]) {
    const ends = [30, 60, 120, 144].map((fps) => simulate(fps, 1.5, from, target).at(-1));
    for (const e of ends) assert.ok(Math.abs(e - ends[0]) < 1e-12, `fps disagree: ${ends.join(', ')}`);
  }
  // And a hitch longer than maxDt is clamped, not integrated.
  const hitched = adaptEv(0, 1, 5);
  assert.ok(Math.abs(hitched - (1 - Math.exp(-AUTO_EXPOSURE.maxDt / AUTO_EXPOSURE.tauDark))) < 1e-15);
});

test('light adaptation is faster than dark adaptation, at the stated time constants', () => {
  // The scene got brighter -> the target EV is LOWER -> tauBright.
  const brighter = simulate(60, AUTO_EXPOSURE.tauBright, 1, 0).at(-1);
  assert.ok(Math.abs(brighter - Math.exp(-1)) < 1e-9, `one tauBright left ${brighter} of a 1-stop gap`);
  const darker = simulate(60, AUTO_EXPOSURE.tauDark, 0, 1).at(-1);
  assert.ok(Math.abs(1 - darker - Math.exp(-1)) < 1e-9, `one tauDark left ${1 - darker}`);
  const halfSecondUp = simulate(60, 0.5, 1, 0).at(-1);
  const halfSecondDown = simulate(60, 0.5, 0, 1).at(-1);
  assert.ok(1 - halfSecondUp > halfSecondDown, 'in the same half second, adapting to a brighter scene covers more of the gap');
  assert.ok(AUTO_EXPOSURE.tauBright >= 0.3 && AUTO_EXPOSURE.tauDark <= 1.5, 'an eye in a game adapts in about a second');
});

// ---------------------------------------------------------------------------
// The display model
// ---------------------------------------------------------------------------

// three.js r183 NeutralToneMapping, transcribed from the chunk the composite
// compiles (tonemapping_pars_fragment), for an RGB input.
function threeNeutral([r, g, b], exposure = 1) {
  let c = [r * exposure, g * exposure, b * exposure];
  const start = 0.8 - 0.04;
  const desat = 0.15;
  const x = Math.min(c[0], c[1], c[2]);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c = c.map((v) => v - offset);
  const peak = Math.max(c[0], c[1], c[2]);
  if (peak < start) return c;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  c = c.map((v) => v * (newPeak / peak));
  const gg = 1 - 1 / (desat * (peak - newPeak) + 1);
  return c.map((v) => v * (1 - gg) + newPeak * gg);
}

test('neutralGray is three.js NeutralToneMapping for a grey input', () => {
  for (let x = 0; x <= 24; x += 0.013) {
    const want = threeNeutral([x, x, x])[0];
    assert.ok(Math.abs(neutralGray(x) - want) < 1e-12, `x ${x}: ${neutralGray(x)} vs ${want}`);
  }
});

test('the display model inverts exactly and is monotonic', () => {
  let prev = -1;
  for (let x = 0; x <= 30; x += 0.0071) {
    const y = neutralGray(x);
    assert.ok(y >= prev - 1e-15, `not monotonic at ${x}`);
    prev = y;
    assert.ok(Math.abs(neutralGrayInverse(y) - x) < 1e-9 * Math.max(1, x), `inverse at ${x}`);
  }
  for (let y = 0; y <= 0.99; y += 0.013) {
    assert.ok(Math.abs(toDisplay(fromDisplay(y)) - y) < 1e-9, `display round trip at ${y}`);
    assert.ok(Math.abs(srgbDecode(srgbEncode(y)) - y) < 1e-12);
  }
  assert.equal(fromDisplay(0), 0);
});

// ---------------------------------------------------------------------------
// Fusion weights and the flat response
// ---------------------------------------------------------------------------

test('fusion weights are positive and sum to 1, for any input', () => {
  const samples = [0, 1e-6, 0.03, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1];
  for (const a of samples) for (const b of samples) for (const c of samples) {
    const w = fusionWeights(a, b, c);
    assert.ok(w.every((v) => v > 0 && Number.isFinite(v)), `${a},${b},${c}: ${w}`);
    assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-12, `${a},${b},${c} sum ${w[0] + w[1] + w[2]}`);
  }
  // Equally exposed, the authored (base) exposure is preferred.
  const eq = fusionWeights(0.5, 0.5, 0.5);
  assert.ok(Math.abs(eq[1] / eq[0] - LOCAL_TONE.basePreference) < 1e-12);
  assert.ok(wellExposedness(0.5) > wellExposedness(0.2) && wellExposedness(0.5) > wellExposedness(0.95));
});

test('the synthetic exposures bracket the frame: highlights <= base <= shadows', () => {
  for (const L of [0, 0.001, 0.02, 0.2, 0.8, 3, 40]) {
    const [h, b, s] = syntheticExposures(L);
    assert.ok(h <= b && b <= s, `L ${L}: ${h} ${b} ${s}`);
  }
  assert.ok(LOCAL_TONE.highlightsEv < 0 && LOCAL_TONE.shadowsEv > 0);
});

test('a large flat region: shadows come up, the middle and the highlights hold', () => {
  const at = (y) => fuseFlat(y).gainEv;
  assert.ok(at(0.1) > 0.5, `a 0.1 shadow lifts only ${at(0.1)} stops`);
  assert.ok(at(0.2) > 0.3, `a 0.2 shadow lifts only ${at(0.2)} stops`);
  assert.ok(Math.abs(at(0.5)) < 0.15, `the middle moves ${at(0.5)} stops`);
  assert.ok(Math.abs(at(0.9)) < 0.15, `a 0.9 highlight moves ${at(0.9)} stops`);
  // A 0.9 display value moves a few percent at most.
  const hi = fuseFlat(0.9).fused;
  assert.ok(Math.abs(hi / 0.9 - 1) < 0.04, `0.9 -> ${hi}`);
  assert.ok(Number.isFinite(at(0)), 'black stays finite');
});

// ---------------------------------------------------------------------------
// A reference pyramid: the collapse shader's sampling rules in JS
// ---------------------------------------------------------------------------

function downsample(img) {
  const w2 = Math.max(1, Math.floor(img.w / 2)); const h2 = Math.max(1, Math.floor(img.h / 2));
  const d = new Float64Array(w2 * h2 * img.ch);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < img.ch; c++) {
    let s = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      s += img.d[(Math.min(img.h - 1, 2 * y + dy) * img.w + Math.min(img.w - 1, 2 * x + dx)) * img.ch + c];
    }
    d[(y * w2 + x) * img.ch + c] = s / 4;
  }
  return { d, w: w2, h: h2, ch: img.ch };
}
function pyramid(img) {
  const out = [img];
  while (out.at(-1).w > 1 || out.at(-1).h > 1) out.push(downsample(out.at(-1)));
  return out;
}
/** Bilinear, clamp-to-edge: textureLod at one level. */
function sample(img, u, v, c) {
  const x = u * img.w - 0.5; const y = v * img.h - 0.5;
  const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  const at = (xx, yy) => img.d[(Math.min(img.h - 1, Math.max(0, yy)) * img.w + Math.min(img.w - 1, Math.max(0, xx))) * img.ch + c];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}
/** The fusion's local exposure (stops) at every texel of an exposed-luminance frame. */
function fuseFrame(L, w, h, { cfg = LOCAL_TONE, domain = 'log', localScale = cfg.localScale } = {}) {
  const Y = { d: new Float64Array(w * h * 3), w, h, ch: 3 };
  const W = { d: new Float64Array(w * h * 3), w, h, ch: 3 };
  const fwd = domain === 'log' ? logDisplay : (y) => y;
  const inv = domain === 'log' ? (y) => 2 ** y : (y) => y;
  for (let i = 0; i < w * h; i++) {
    const ys = syntheticExposures(L[i], cfg);
    const ws = fusionWeights(ys[0], ys[1], ys[2], cfg);
    for (let k = 0; k < 3; k++) { Y.d[i * 3 + k] = fwd(ys[k]); W.d[i * 3 + k] = ws[k]; }
  }
  const PY = pyramid(Y); const PW = pyramid(W);
  const top = PY.length - 1;
  assert.equal(top, mipLevels(w, h) - 1, 'the reference pyramid has three\'s level count');
  const fuse = fusedLevels(Math.max(w, h), localScale);
  const stop = Math.min(top, fuse);
  const gain = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w; const v = (y + 0.5) / h;
    let prev = [0, 1, 2].map((c) => sample(PY[0], u, v, c));
    let fused = 0;
    for (let l = 0; l < stop; l++) {
      const next = [0, 1, 2].map((c) => sample(PY[l + 1], u, v, c));
      const wl = [0, 1, 2].map((c) => sample(PW[l], u, v, c));
      const s = wl[0] + wl[1] + wl[2];
      for (let k = 0; k < 3; k++) fused += (wl[k] / s) * (prev[k] - next[k]);
      prev = next;
    }
    if (fuse > top) {
      const wl = [0, 1, 2].map((c) => sample(PW[top], u, v, c));
      const s = wl[0] + wl[1] + wl[2];
      for (let k = 0; k < 3; k++) fused += (wl[k] / s) * prev[k];
    } else fused += prev[1];
    const yf = Math.min(0.999, Math.max(LOG_DISPLAY_FLOOR, inv(fused)));
    const y0 = inv(Y.d[(y * w + x) * 3 + 1]);
    gain[y * w + x] = Math.log2(Math.max(fromDisplay(yf), 1e-6) / Math.max(fromDisplay(y0), 1e-6));
  }
  return gain;
}

// A backlit frame at quarter res, portrait: bright sky over the top 60%, a
// dark canopy in its top-left corner, mid ground below with a shadow patch.
function backlitFrame(w = 48, h = 104) {
  const L = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let d = y < 0.6 * h ? 0.85 : 0.3;
    if (y < 0.3 * h && x < 0.55 * w) d = 0.05;
    if (y > 0.75 * h && x > 0.5 * w) d = 0.1;
    L[y * w + x] = fromDisplay(d);
  }
  return { L, w, h };
}
const at = (g, w, x, y) => g[y * w + x];
/** What the collapse shader writes: the raw fused exposure, scaled and clamped. */
const applied = (raw, cfg = LOCAL_TONE) => raw.map((g) => Math.min(cfg.gainMax, Math.max(cfg.gainMin, g * cfg.strength)));

test('the collapse telescopes: a fusion that prefers nothing but the base changes nothing', () => {
  const { L, w, h } = backlitFrame();
  const baseOnly = { ...LOCAL_TONE, basePreference: 1e12 };
  for (const localScale of [0.35, 1]) {
    const g = fuseFrame(L, w, h, { cfg: baseOnly, localScale });
    for (let i = 0; i < g.length; i++) assert.ok(Math.abs(g[i]) < 1e-6, `texel ${i}: ${g[i]} (localScale ${localScale})`);
  }
});

test('log-domain fusion lifts the shadows beside a bright sky and holds the sky', () => {
  const { L, w, h } = backlitFrame();
  const raw = fuseFrame(L, w, h);
  const g = applied(raw);
  const canopy = at(g, w, 6, 12);
  const shadow = at(g, w, 36, 96);
  const sky = at(g, w, 36, 40);
  const ground = at(g, w, 8, 72);
  assert.ok(canopy > 0.2, `canopy interior ${canopy}`);
  assert.ok(shadow > 0.3, `shadow interior ${shadow}`);
  assert.ok(sky >= 0 && sky < 0.05, `sky ${sky}`);
  assert.ok(ground >= 0 && ground < 0.3, `mid ground ${ground}`);
  let worst = 0;
  for (let i = 0; i < L.length; i++) if (L[i] <= fromDisplay(0.12)) worst = Math.min(worst, raw[i]);
  assert.ok(worst > -0.05, `a dark texel was pushed DARKER by ${worst} stops`);
});

test('the fusion\'s darkening half is a halo in the sky, and the shipped floor removes it', () => {
  // Beside a dark canopy the coarse weights prefer the shadows exposure, in
  // which the sky's step up from the canopy is SMALLER — so the sky next to
  // the tree is pulled down. That is local contrast compression doing what
  // it does, and on a sky it reads as a dark ring round every backlit tree.
  const { L, w, h } = backlitFrame();
  const raw = fuseFrame(L, w, h);
  let rawSkyMin = 0; let appliedSkyMin = 0;
  const g = applied(raw);
  for (let y = 0; y < Math.floor(0.3 * h); y++) {
    for (let x = Math.ceil(0.6 * w); x < w; x++) {
      rawSkyMin = Math.min(rawSkyMin, at(raw, w, x, y));
      appliedSkyMin = Math.min(appliedSkyMin, at(g, w, x, y));
    }
  }
  assert.ok(rawSkyMin < -0.3, `raw halo ${rawSkyMin} (the reason for the floor)`);
  assert.equal(LOCAL_TONE.gainMin, 0, 'the local exposure only ever lifts');
  assert.equal(appliedSkyMin, 0, `applied halo ${appliedSkyMin}`);
});

test('why the log domain: in display values the same frame reverses at an edge', () => {
  // Fused on display values, a dark region's fine levels take their step
  // from the brightest exposure — the one in which the sky beside it is
  // brightest — and the shadow side of the edge goes DOWN. On the live page
  // that pushed a canopy to the -1 stop clamp. Pinned so nobody "simplifies"
  // the log back out.
  const { L, w, h } = backlitFrame();
  const display = fuseFrame(L, w, h, { domain: 'display' });
  const log = fuseFrame(L, w, h, { domain: 'log' });
  let displayWorst = 0; let logWorst = 0;
  for (let i = 0; i < L.length; i++) {
    if (L[i] > fromDisplay(0.12)) continue;
    displayWorst = Math.min(displayWorst, display[i]);
    logWorst = Math.min(logWorst, log[i]);
  }
  assert.ok(displayWorst < -0.1, `display domain worst ${displayWorst}`);
  assert.ok(logWorst > displayWorst + 0.1, `log ${logWorst} vs display ${displayWorst}`);
});

test('fusing the whole pyramid moves the frame globally; the local scale keeps that out', () => {
  const { L, w, h } = backlitFrame();
  const whole = fuseFrame(L, w, h, { localScale: 1 });
  const local = fuseFrame(L, w, h);
  const sky = (g) => at(g, w, 36, 40);
  assert.ok(sky(whole) > sky(local) + 0.1, `whole-pyramid sky ${sky(whole)} vs local ${sky(local)}`);
});

test('pyramid level counts match three\'s allocation, and the local scale picks the fused ones', () => {
  assert.equal(mipLevels(64, 64), 7);
  assert.equal(mipLevels(97, 211), 8);
  assert.equal(mipLevels(1, 1), 1);
  assert.equal(mipLevels(234, 506), 9);
  assert.equal(fusedLevels(211, 0.35), 6, 'quarter-res iPhone portrait at DPR 1: residual at 1x3');
  assert.equal(fusedLevels(211, 0.5), 7, 'only the 1x1 residual kept');
  assert.equal(fusedLevels(211, 1), 8, 'past the top: the whole pyramid');
  assert.equal(fusedLevels(506, 0.35), 7, 'Ultra DPR 2.4: the same fraction of the frame');
  assert.equal(fusedLevels(1, 0.35), 1);
});

// ---------------------------------------------------------------------------
// GLSL: emitted from the tables; the composite patch on the REAL composite
// ---------------------------------------------------------------------------

test('GLSL float literals always carry a point or an exponent', () => {
  for (const v of [0, 1, -12, 12, 0.5, 1e-4, 6.377551, -0.25]) {
    const s = glslFloat(v);
    assert.match(s, /[.eE]/, `${v} -> ${s}`);
    assert.equal(Number(s), Number(v.toPrecision(9)));
  }
});

test('the shaders carry the tables\' constants, not copies of them', () => {
  assert.ok(EYE_COMMON_GLSL.includes(`EYE_LOG_FLOOR = ${glslFloat(AUTO_EXPOSURE.logFloor)}`));
  assert.ok(EYE_COMMON_GLSL.includes(`EYE_LOG_CEIL = ${glslFloat(AUTO_EXPOSURE.logCeil)}`));
  assert.ok(METER_FRAG.includes(glslFloat(AUTO_EXPOSURE.centerFloor)));
  assert.ok(METER_FRAG.includes(glslFloat(1 / (2 * AUTO_EXPOSURE.centerSigma ** 2))));
  assert.ok(COLLAPSE_FRAG.includes(`EYE_MAX_LEVELS = ${LOCAL_TONE.maxLevels}`));
  assert.ok(FUSE_EXPOSURES_FRAG.includes(glslFloat(LOG_DISPLAY_FLOOR)));
  // The NaN/Inf scrub is in every pass that reads the scene or the state.
  for (const [name, src] of [['meter', METER_FRAG], ['adapt', ADAPT_FRAG], ['fuse', FUSE_EXPOSURES_FRAG]]) {
    assert.ok(src.includes('isnan') && src.includes('isinf'), `${name} has no NaN/Inf guard`);
  }
  // The adapt pass reads the meter's 1x1 level, never a CPU readback.
  assert.ok(ADAPT_FRAG.includes('textureLod(tMeter'));
  assert.ok(FUSE_WEIGHTS_FRAG.includes('exp2('), 'weights judge display values, not their logs');
  assert.ok(GUIDE_FRAG.includes('uEpsilon'));
});

test('off, the composite is the untouched source — the same string, not an equal one', () => {
  assert.equal(patchComposite(COMPOSITE_FRAG, {}), COMPOSITE_FRAG);
  assert.equal(patchComposite(COMPOSITE_FRAG, { autoExposure: false, localTone: false }), COMPOSITE_FRAG);
  assert.ok(!COMPOSITE_FRAG.includes('Eye'), 'the shipping composite has no eye in it');
});

test('the patch applies to the real composite, once per anchor, in the right order', () => {
  for (const opts of [{ autoExposure: true }, { localTone: true }, { autoExposure: true, localTone: true }]) {
    const src = patchComposite(COMPOSITE_FRAG, opts);
    assert.notEqual(src, COMPOSITE_FRAG);
    const count = (s) => src.split(s).length - 1;
    assert.equal(count('c *= exp2(eyeStops(scene, 3.0));'), 1);
    assert.equal(count('float eyeStops('), 1);
    assert.equal(count('uniform float uEyeDebug;'), 1);
    assert.equal(count('uniform sampler2D tEyeExposure;'), opts.autoExposure ? 1 : 0);
    assert.equal(count('uniform sampler2D tEyeLocal;'), opts.localTone ? 1 : 0);
    const iApply = src.indexOf('c *= exp2(eyeStops(scene, 3.0));');
    assert.ok(iApply > src.indexOf('c += texture2D(tRays, vUv).rgb * uRays;'), 'after bloom and shafts');
    assert.ok(iApply < src.indexOf(COMPOSITE_APPLY_ANCHOR), 'before the vignette');
    assert.ok(iApply < src.lastIndexOf('#include <tonemapping_fragment>'), 'before the tone curve');
    assert.ok(src.indexOf('float eyeStops(') > src.indexOf('varying vec2 vUv;'), 'helpers see vUv');
    assert.ok(src.indexOf('float eyeStops(') < src.indexOf('void main()'), 'helpers precede main');
    // Everything the original had is still there.
    for (const line of COMPOSITE_FRAG.split('\n').filter((l) => l.trim())) {
      assert.ok(src.includes(line), `lost a line: ${line}`);
    }
  }
});

test('a composite that has moved on fails loudly instead of shipping the eye invisible', () => {
  for (const anchor of [COMPOSITE_UNIFORM_ANCHOR, COMPOSITE_MAIN_ANCHOR, COMPOSITE_APPLY_ANCHOR]) {
    assert.ok(COMPOSITE_FRAG.includes(anchor), `anchor missing from the real composite: ${anchor}`);
    const moved = COMPOSITE_FRAG.replace(anchor, anchor.replace(/ {2,}/, ' '));
    assert.throws(() => patchComposite(moved, { autoExposure: true }), /anchor not found/);
  }
});
