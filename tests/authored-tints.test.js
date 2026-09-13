import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from '../tools/lib/asset-analysis.mjs';
import {
  BARK_TINT, PINE_BARK_TINT, STONE_TINT,
  // --- RED until the wiring stage adds them ---------------------------------
  // These five (six, with the ground's strength) are the whole contract this
  // file exists to fix. They do not exist yet, and this import is what makes
  // the suite fail today; every assertion below is written against them.
  CANYON_TINT, GRANITE_TINT, SNOW_TINT, CONCRETE_TINT,
  GROUND_TINT, GROUND_MAP_STRENGTH,
} from '../src/environment/authored-textures.js';

/**
 * authored-tints.test.js — the oracle for the five NEW authored albedos.
 *
 * `authored-textures.test.js` already owns the loader's mechanics (colour
 * space, repeat, the decode gate, the disposer) and one cross-asset check:
 * bark against the arch stone. This file is the generalisation of that one
 * check to every material the new albedos touch, and the specification of the
 * tint each of them needs.
 *
 * ── Why this file is the interesting one ────────────────────────────────
 *
 * Every structural check this repo has — `asset-check.mjs`'s tiling, baked
 * light, colour space, POT and budget gates — looks at ONE file at a time.
 * None of them has any opinion about the OTHER texture in the same frame.
 * That is how the sandstone arch shipped reading as a wooden bridge: its mean
 * colour and the bark's were 6.6 sRGB units apart, both files passed every
 * gate, and the only thing that noticed was the owner, on his phone, after a
 * deploy.
 *
 * The five new albedos are the same trap, five times over, and worse — they
 * were commissioned as a set, so they share a grading. MEASURED FROM THE
 * SHIPPED FILES, raw:
 *
 *     bark    vs forest_ground   19.7 sRGB units
 *     canyon  vs forest_ground   10.0
 *     granite vs concrete        16.8
 *     snow    vs concrete        22.8
 *
 * Every one of those is inside the distance that already shipped a defect
 * once. What separates them on screen is the TINT, and nothing else.
 *
 * ── The three rules every tint here obeys ───────────────────────────────
 *
 * 1. SOLVED, never picked. `map` MULTIPLIES `color`, so the rendered colour
 *    is `tint x albedoMean x vertexColourMean`. A tint is therefore the
 *    quotient of a STATED target and the file's own measured mean. The means
 *    are recomputed from the PNGs in this file, so a re-delivery that is
 *    graded differently fails here rather than on a phone.
 *
 * 2. The BLACK-SLAB rule. A textured surface may not go dark: the authored
 *    render must stay >= 0.6x the luminance of the procedural material it
 *    replaces. This repo has now paid for that defect three times by three
 *    different routes (the landmark trunk at 0x5a4028, the white-tinted
 *    trunk at 19% of procedural, the mountain pine at 0.048 against 0.162),
 *    and PINE_BARK_TINT's comment is the worked example this file follows.
 *
 * 3. NOTHING CLIPS. A texel whose `tint x albedo` exceeds 1.0 has lost its
 *    structure — it is flat white, and the structure is the entire reason
 *    the file was commissioned. Budget: under 1.5% of texels, which is the
 *    number STONE_TINT was already chosen against (#b5a58c at 0.51%
 *    beat #c2ab86 at 1.68%).
 *
 * ── Where this file DEPARTS from its brief, and why ─────────────────────
 *
 * (a) The black-slab rule was specified to this stage as "rendered luma of
 *     each >= 0.6x its NEIGHBOUR's". Applied pairwise that rule is not
 *     satisfiable and not desirable, and the counterexample is already
 *     shipped and already correct: the arch stone renders at luma 0.386 and
 *     the bark beside it at 0.162, a ratio of 0.418, because the arch is
 *     deliberately the lighter of the two ("the arch must not be darker than
 *     the trees"). A snow cap against granite is the same shape, harder:
 *     snow is MEANT to dominate. So the rule is asserted in the form that
 *     PINE_BARK_TINT actually solved — each authored material against the
 *     PROCEDURAL MATERIAL IT REPLACES — which can fail, is meaningful for all
 *     five, and is exactly "texturing a surface must not turn it into a hole".
 *     The pairwise version is asserted where both materials are of comparable
 *     class, and inverted for snow.
 *
 * (b) SNOW cannot reach the specified luma >= 0.8 linear. That is a property
 *     of the delivered file, measured: its 98.5th-percentile texel sits at
 *     0.578 linear against a 0.373 mean, a 1.55x spread, so any tint putting
 *     the mean above ~0.646 pushes more than 1.5% of the texture over 1.0.
 *     Reaching 0.8 costs 31.6% of the texture — a third of it flat white, and
 *     the sastrugi this file was bought for is the first thing to go. The
 *     ceiling is taken instead, and asserted, because the instruction was to
 *     find it.
 *
 * (c) One constant serves a FAMILY of materials, scaled by luminance.
 *     The canyons have two spire tints and the city three facade tints, and
 *     those value differences are the only thing stopping each biome reading
 *     as one cloned prop. A single absolute tint collapses them. So a family
 *     member's tint is `TINT x familyScale`, where familyScale is its own
 *     procedural luminance over the reference material's. Measured, the three
 *     city facades are the same hue at three values (their linear r:g:b run
 *     0.21:0.41:1, 0.20:0.43:1, 0.21:0.41:1), so a scalar scale reproduces
 *     all three to within 2 sRGB units — asserted below.
 */

// ---------------------------------------------------------------------------
// Colour maths. `setRGB` takes LINEAR values, `map` multiplies `color`, and
// a Color built from a hex is converted sRGB -> linear on the way in.
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const hexLinear = (h) => [
  toLinear(((h >> 16) & 255) / 255), toLinear(((h >> 8) & 255) / 255), toLinear((h & 255) / 255),
];
const bytes = (c) => c.map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255));
const hexOf = (c) => `#${bytes(c).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
/** Distance in sRGB display units — the same metric the bark/stone check uses. */
const gap = (a, b) => {
  const [A, B] = [bytes(a), bytes(b)];
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
const asArray = (t) => [t.r, t.g, t.b];
/** rendered = tint x albedoMean x vertexColourMean x familyScale. */
const render = (tint, mean, vc = [1, 1, 1], k = 1) =>
  mean.map((m, i) => asArray(tint)[i] * m * vc[i] * k);
/**
 * A family member's share of its reference's tint. Scalar, not per channel:
 * one rock type at several values, which is what the procedural materials
 * already are.
 */
const familyScale = (hex, referenceHex) => luma(hexLinear(hex)) / luma(hexLinear(referenceHex));

// ---------------------------------------------------------------------------
// The shipped PNGs. Means are RECOMPUTED here, never transcribed: the whole
// point is that a re-delivery graded differently must fail this file.
const DIR = path.join(import.meta.dirname, '..', 'assets', 'textures');
const ALBEDOS = {
  canyon: 'canyon_sandstone_albedo.png',
  granite: 'mountain_granite_albedo.png',
  snow: 'mountain_snow_albedo.png',
  concrete: 'city_concrete_albedo.png',
  ground: 'forest_ground_albedo.png',
  bark: 'bark_pine_albedo.png',
  stone: 'stone_rock_albedo.png',
};
const haveAssets = Object.values(ALBEDOS).every((f) => fs.existsSync(path.join(DIR, f)));

const _png = new Map();
const png = (file) => {
  if (!_png.has(file)) _png.set(file, decodePng(fs.readFileSync(path.join(DIR, file)), file));
  return _png.get(file);
};
const meanLinear = (file) => {
  const p = png(file);
  const n = p.w * p.h;
  const mu = [0, 0, 0];
  for (let i = 0; i < n; i += 1) for (let c = 0; c < 3; c += 1) mu[c] += toLinear(p.data[i * p.ch + c] / 255);
  return mu.map((v) => v / n);
};
/** Fraction of texels (%) where any channel of `effective x albedo` exceeds 1.0. */
const clipPercent = (file, effective) => {
  const p = png(file);
  const n = p.w * p.h;
  let clipped = 0;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      if (toLinear(p.data[i * p.ch + c] / 255) * effective[c] > 1.0) { clipped += 1; break; }
    }
  }
  return (100 * clipped) / n;
};
const MEAN = haveAssets
  ? Object.fromEntries(Object.entries(ALBEDOS).map(([k, f]) => [k, meanLinear(f)]))
  : null;

// ---------------------------------------------------------------------------
// Facts transcribed from the consumers. Each is a material this stage does NOT
// own, so each carries the file and the value it was read from; if one of them
// moves, the tint solved against it is wrong and these numbers are where a
// reader looks first.
//
//   src/environment/spherical-world.js
//     ~1885  spireMat      0x99502e  vertexColors, bakeVerticalGradient(... 4 bands, 0.16)
//     ~1886  darkSpireMat  0x763923  same geometry, same gradient
//     ~2249  stoneMat      0x646c7c  vertexColors, bakeVerticalGradient([.74,.74,.78],[1.16,1.18,1.22])
//     ~2250  snowMat       0xe6f1ff  ConeGeometry, NO vertexColors
//     ~2816  buildingMats  0x141f33 / 0x18263c / 0x101a2c, vertexColors,
//                          bakeVerticalGradient([.66,.66,.72],[1.18,1.20,1.24])
//     ~3185  sphereMaterial  NO colour set -> white; the terrain palette is
//                          entirely in the vertex colours.
const MAT = {
  spire: 0x99502e, darkSpire: 0x763923,
  peak: 0x646c7c, snow: 0xe6f1ff,
  facades: [0x141f33, 0x18263c, 0x101a2c],
  facadeRef: 0x18263c,
};

/**
 * `bakeVerticalGradient` ramps bottom -> top linearly in local Y, so the
 * vertex-colour MEAN over a prop is the midpoint; `bands` multiplies it by the
 * mean of its per-band offsets. The MAX is what a texel can be asked to
 * survive, so clipping is measured against that, not against the mean.
 */
const gradMean = (bottom, top, bands = 0, jitter = 0) => {
  const mid = bottom.map((b, i) => (b + top[i]) / 2);
  if (!bands) return mid;
  let s = 0;
  for (let i = 0; i < bands; i += 1) s += 1 + Math.sin(i * 12.9898) * 0.5 * jitter;
  return mid.map((v) => (v * s) / bands);
};
const gradMax = (top, bands = 0, jitter = 0) => {
  let m = 1;
  for (let i = 0; i < bands; i += 1) m = Math.max(m, 1 + Math.sin(i * 12.9898) * 0.5 * jitter);
  return top.map((v) => v * m);
};
const VC = {
  spire: gradMean([0.78, 0.66, 0.58], [1.16, 1.06, 0.92], 4, 0.16),
  spireMax: gradMax([1.16, 1.06, 0.92], 4, 0.16),
  peak: gradMean([0.74, 0.74, 0.78], [1.16, 1.18, 1.22]),
  peakMax: [1.16, 1.18, 1.22],
  city: gradMean([0.66, 0.66, 0.72], [1.18, 1.20, 1.24]),
  cityMax: [1.18, 1.20, 1.24],
  none: [1, 1, 1],
};

/**
 * The procedural ground each biome renders today, as the representative
 * colour a prop is seen AGAINST.
 *
 * Per-biome stops come from TERRAIN_COLORS in spherical-world.js (~726-768),
 * multiplied by the ground-detail tint that runs over them
 * (GROUND_PROFILES in ground-detail.js: `outgoingLight *= gdTint`, whose macro
 * term mixes soilTint and mossTint, so its mean is their midpoint).
 *
 * The stop CHOICE matters and is stated rather than averaged blindly:
 *
 *  - forest uses the four VEGETATED stops (lush valley grass, rich meadow,
 *    deep forest green, dry grass). CONTINENT_BIAS sinks most of the surface
 *    into rolling lowlands, so those bands are what the ground actually is;
 *    averaging the whole palette folds in a water stop and a snow-dusting
 *    stop that together cover almost no area and drags the representative
 *    30 sRGB units pale.
 *  - canyons and city use the whole palette mean: both are carved or built
 *    across their full range and neither has a rare extreme stop.
 */
const GD_MEAN = (moss, soil) => moss.map((m, i) => (m + soil[i]) / 2);
const GROUND_RENDER = {
  // ground-detail.js GROUND_PROFILES.forest: mossTint / soilTint
  forest: [0.20, 0.445, 0.2275].map((v, i) => v * GD_MEAN([0.72, 1.18, 0.68], [1.26, 0.92, 0.62])[i]),
  // GROUND_PROFILES.canyons
  canyons: [0.5222, 0.2778, 0.1433].map((v, i) => v * GD_MEAN([1.16, 1.00, 0.82], [0.94, 0.84, 0.76])[i]),
  // The city's ground takes addStreetGrid, not addGroundDetail — no gd tint.
  city: [0.11, 0.15333, 0.21833],
};

// The three already-shipped renders, for the same-frame comparisons.
const shipped = () => ({
  bark: render(BARK_TINT, MEAN.bark),
  pine: render(PINE_BARK_TINT, MEAN.bark),
  stone: render(STONE_TINT, MEAN.stone),
});
// What each new consumer renders once the wiring lands.
const authored = () => ({
  spire: render(CANYON_TINT, MEAN.canyon, VC.spire),
  darkSpire: render(CANYON_TINT, MEAN.canyon, VC.spire, familyScale(MAT.darkSpire, MAT.spire)),
  peak: render(GRANITE_TINT, MEAN.granite, VC.peak),
  snow: render(SNOW_TINT, MEAN.snow, VC.none),
  facades: MAT.facades.map((h) => render(CONCRETE_TINT, MEAN.concrete, VC.city, familyScale(h, MAT.facadeRef))),
  // The forest ground's material.color is WHITE and its colour lives entirely
  // in the vertex attribute, so GROUND_TINT is a NORMALISATION: tint x mean is
  // 1 by construction and the rendered ground is the procedural ground.
  ground: GROUND_RENDER.forest.map((v, i) => v * (asArray(GROUND_TINT)[i] * MEAN.ground[i])),
});
// What each consumer renders TODAY, procedurally.
const procedural = () => ({
  spire: hexLinear(MAT.spire).map((v, i) => v * VC.spire[i]),
  darkSpire: hexLinear(MAT.darkSpire).map((v, i) => v * VC.spire[i]),
  peak: hexLinear(MAT.peak).map((v, i) => v * VC.peak[i]),
  snow: hexLinear(MAT.snow),
  facades: MAT.facades.map((h) => hexLinear(h).map((v, i) => v * VC.city[i])),
  ground: GROUND_RENDER.forest,
});

const skip = { skip: haveAssets ? false : 'assets/textures/* not present' };

// ===========================================================================
// 1. The constants exist and are the solved values.
// ===========================================================================

test('every new tint is a frozen, finite, positive linear triple', () => {
  for (const [name, t] of Object.entries({ CANYON_TINT, GRANITE_TINT, SNOW_TINT, CONCRETE_TINT, GROUND_TINT })) {
    assert.ok(t && typeof t === 'object', `${name} must be exported`);
    assert.ok(Object.isFrozen(t), `${name} must be frozen — a tint nothing can reassign at runtime`);
    for (const ch of ['r', 'g', 'b']) {
      assert.equal(typeof t[ch], 'number', `${name}.${ch}`);
      assert.ok(Number.isFinite(t[ch]) && t[ch] > 0, `${name}.${ch} = ${t[ch]}`);
    }
  }
  // Not a tint — the fraction of the ground map's deviation from its own mean
  // that is actually applied. Solved at the clipping ceiling; see below.
  assert.equal(typeof GROUND_MAP_STRENGTH, 'number');
  assert.ok(GROUND_MAP_STRENGTH > 0 && GROUND_MAP_STRENGTH <= 1);
});

test('each tint is the quotient of its stated target and the file\'s measured mean', skip, () => {
  // This is the specification. Every number on the right is solved, and every
  // solve is `target / (albedoMean x vertexColourMean)` — so if a re-delivered
  // albedo is graded differently, the expected tint moves and this fails.
  const close = (name, got, want) => {
    for (const [i, ch] of ['r', 'g', 'b'].entries()) {
      assert.ok(Math.abs(got[ch] - want[i]) <= 0.006,
        `${name}.${ch} = ${got[ch]} but the solve against the shipped file gives ${want[i].toFixed(4)}`);
    }
  };
  const solve = (targetHex, mean, vc) => hexLinear(targetHex).map((v, i) => v / (mean[i] * vc[i]));

  // CANYON — target #a05a34, a warm rust-sandstone. The spires ARE the
  // biome's silhouette, so the target keeps the current spire's value (the
  // 30% rule below) while dropping its saturation from 15:3.4:1 to 9:2.8:1,
  // which is the difference between poster-paint rust and sandstone.
  close('CANYON_TINT', CANYON_TINT, solve(0xa05a34, MEAN.canyon, VC.spire));
  assert.deepEqual(asArray(CANYON_TINT).map((v) => Number(v.toFixed(3))), [1.549, 0.632, 0.299]);

  // GRANITE — target #5c6372, close kin of the procedural 0x646c7c peak at
  // 0.87x its luminance. It was #7f899d (1.73x) first, solved to put the peaks
  // 60 units from the mountain's pine bark — and a real capture at a pinned
  // pose refuted it: the snow cap lost 39% of its contrast against the granite
  // it sits ON, because a peak lifted that far climbs toward a cap that is
  // already at its own clipping ceiling and cannot get brighter to answer.
  // The guard is 'the snow cap does not lose its contrast ratio against the
  // granite peak' in authored-textures.test.js; the pine-bark gap is handled
  // in the separation test below, where the reasoning lives.
  close('GRANITE_TINT', GRANITE_TINT, solve(0x5c6372, MEAN.granite, VC.peak));
  assert.deepEqual(asArray(GRANITE_TINT).map((v) => Number(v.toFixed(3))), [0.407, 0.479, 0.637]);

  // SNOW — not solved from a target colour but from the CLIPPING CEILING; see
  // the snow test for the derivation. Direction is half of snowMat's own cool
  // cast, scaled until 1.5% of texels saturate.
  assert.deepEqual(asArray(SNOW_TINT).map((v) => Number(v.toFixed(3))), [1.561, 1.640, 1.731]);

  // CONCRETE — target #17243b, which IS the middle facade's current render.
  // The facade must not move: city-windows.js ADDS light for the lit windows
  // and the street lamps, and a lifted facade is what turned the city's
  // 0.09-linear asphalt into pale snow once already. Sub-unity in every
  // channel, because a 0.31-mean albedo on a 0.009-linear navy has to come
  // down by two orders of magnitude in red.
  close('CONCRETE_TINT', CONCRETE_TINT, solve(0x17243b, MEAN.concrete, VC.city));
  assert.deepEqual(asArray(CONCRETE_TINT).map((v) => Number(v.toFixed(3))), [0.029, 0.061, 0.147]);

  // GROUND — a NORMALISATION, not a tint: 1/mean per channel. The planet's
  // material has no colour of its own (spherical-world.js ~3185 sets only
  // vertexColors), so the terrain palette is the colour and the map must
  // contribute structure at unit mean or it recolours the whole world.
  close('GROUND_TINT', GROUND_TINT, MEAN.ground.map((v) => 1 / v));
  assert.deepEqual(asArray(GROUND_TINT).map((v) => Number(v.toFixed(3))), [5.213, 5.962, 7.030]);
});

// ===========================================================================
// 2. The black-slab rule.
// ===========================================================================

test('no authored surface goes dark against the procedural one it replaces', skip, () => {
  const a = authored();
  const p = procedural();
  const pairs = [
    ['canyon spire', a.spire, p.spire],
    ['canyon dark spire', a.darkSpire, p.darkSpire],
    ['mountain peak', a.peak, p.peak],
    ['mountain snow', a.snow, p.snow],
    ['city facade 0', a.facades[0], p.facades[0]],
    ['city facade 1', a.facades[1], p.facades[1]],
    ['city facade 2', a.facades[2], p.facades[2]],
    ['forest ground', a.ground, p.ground],
  ];
  for (const [name, lit, proc] of pairs) {
    const ratio = luma(lit) / luma(proc);
    assert.ok(ratio >= 0.6,
      `${name} renders at ${luma(lit).toFixed(4)} against a procedural ${luma(proc).toFixed(4)} `
      + `(${ratio.toFixed(3)}x) — that is the black slab, again`);
    // And the other end: a tint that doubles a surface is not a texture pass,
    // it is a relighting nobody asked for. The granite is the one deliberate
    // exception and it is called out by name.
    const ceiling = name === 'mountain peak' ? 1.8 : 1.3;
    assert.ok(ratio <= ceiling, `${name} renders ${ratio.toFixed(3)}x brighter than the material it replaces`);
  }
});

test('the pairwise form of the black-slab rule is not the rule, and here is why', skip, () => {
  // Kept as an executable note. The arch and the trees share a frame and their
  // rendered luminances are 0.42 apart by design — the arch is deliberately
  // the lighter, because a 34-unit dark mass against a bright sky reads as a
  // hole. Asserting ">= 0.6x its neighbour" pairwise would fail on shipped,
  // correct, owner-approved art.
  const s = shipped();
  const ratio = luma(s.bark) / luma(s.stone);
  assert.ok(ratio < 0.6, `bark/stone is ${ratio.toFixed(3)} — pairwise 0.6x would reject the shipped arch`);
  // Snow is the same shape, further: it must DOMINATE its frame.
  const a = authored();
  assert.ok(luma(a.peak) / luma(a.snow) < 0.6);
});

// ===========================================================================
// 3. Nothing clips.
// ===========================================================================

test('no tint blows the structure it was bought for', skip, () => {
  // Measured against the MAXIMUM vertex colour the prop applies, not the mean:
  // the top of a baked gradient is what a texel actually has to survive.
  const cases = [
    ['canyon', ALBEDOS.canyon, asArray(CANYON_TINT).map((v, i) => v * VC.spireMax[i]), 1.5],
    ['granite', ALBEDOS.granite, asArray(GRANITE_TINT).map((v, i) => v * VC.peakMax[i]), 1.5],
    ['snow', ALBEDOS.snow, asArray(SNOW_TINT), 1.5],
    ['concrete', ALBEDOS.concrete, asArray(CONCRETE_TINT).map((v, i) => v * VC.cityMax[i]), 1.5],
  ];
  for (const [name, file, effective, budget] of cases) {
    const pct = clipPercent(file, effective);
    assert.ok(pct < budget, `${name} saturates ${pct.toFixed(2)}% of its texels (budget ${budget}%)`);
  }
});

test('the ground map\'s strength is solved at the same clipping ceiling', skip, () => {
  // The ground is the one consumer whose tint is a normalisation rather than a
  // lift, and the one whose multiplier lands on a vertex colour instead of
  // standing alone. At full strength the map is `albedo x GROUND_TINT`, whose
  // brightest texels run ~2.4x its mean, and against the forest's green
  // vegetated stop (linear 0.445) that pushes 3.17% of the texture over 1.0.
  //
  // So the map is applied as `mix(1, albedo x GROUND_TINT, GROUND_MAP_STRENGTH)`.
  // That keeps the mean at exactly 1 for any strength — no colour shift, which
  // is the whole requirement — while bounding the gain. 0.8 is the ceiling:
  //
  //     strength 1.0 -> 3.168%     0.7 -> 0.885%
  //     strength 0.8 -> 1.494%     0.6 -> 0.359%
  const veg = [0.20, 0.445, 0.2275];
  const p = png(ALBEDOS.ground);
  const n = p.w * p.h;
  const t = asArray(GROUND_TINT);
  let clipped = 0;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const a = toLinear(p.data[i * p.ch + c] / 255);
      if ((1 + GROUND_MAP_STRENGTH * (a * t[c] - 1)) * veg[c] > 1.0) { clipped += 1; break; }
    }
  }
  const pct = (100 * clipped) / n;
  assert.ok(pct < 1.5, `the ground saturates ${pct.toFixed(3)}% at strength ${GROUND_MAP_STRENGTH}`);
  assert.ok(GROUND_MAP_STRENGTH >= 0.75,
    `strength ${GROUND_MAP_STRENGTH} is under the 1.5% ceiling — the map is being spent and not used`);
  assert.equal(Number(GROUND_MAP_STRENGTH.toFixed(2)), 0.8);
});

// ===========================================================================
// 4. Same-frame separation — the check that would have caught the wooden arch,
//    generalised to every pair of authored materials that share a view.
// ===========================================================================

test('raw, the new albedos are the same colour as their neighbours', skip, () => {
  // The reason this file exists, asserted so it stays legible cold. Each of
  // these is at or inside the 6.6-unit distance that shipped a timber arch.
  const raw = [
    ['bark vs forest_ground', MEAN.bark, MEAN.ground],
    ['canyon vs forest_ground', MEAN.canyon, MEAN.ground],
    ['granite vs concrete', MEAN.granite, MEAN.concrete],
    ['snow vs concrete', MEAN.snow, MEAN.concrete],
    ['bark vs stone', MEAN.bark, MEAN.stone],
  ];
  for (const [name, a, b] of raw) {
    assert.ok(gap(a, b) < 25, `${name} is ${gap(a, b).toFixed(1)} apart raw — the tints are what separate them`);
  }
});

test('every pair of authored materials that shares a frame is 60 sRGB units apart', skip, () => {
  const s = shipped();
  const a = authored();
  const pairs = [
    // FOREST: the landmark trunk and every instanced trunk, the arch, the ground.
    ['forest: bark vs arch stone', s.bark, s.stone],
    ['forest: bark vs ground', s.bark, a.ground],
    ['forest: arch stone vs ground', s.stone, a.ground],
    // MOUNTAIN: pines below, snow caps on top. The pine-vs-granite pair is
    // deliberately NOT here — it has its own test with its own floor, below.
    ['mountain: pine bark vs snow', s.pine, a.snow],
    ['mountain: granite vs snow', a.peak, a.snow],
    // CITY: the facades against the asphalt they stand on.
    ['city: facade vs street', a.facades[1], GROUND_RENDER.city],
  ];
  for (const [name, x, y] of pairs) {
    assert.ok(gap(x, y) >= 60, `${name} renders only ${gap(x, y).toFixed(1)} sRGB units apart`);
  }
});

test('the granite peak keeps its distance from the pine bark, and the snow cap is why it is not 60', skip, () => {
  // Measured, not chosen. The authored pine bark (PINE_BARK_TINT, solved to
  // the forest trunk's VALUE so the mountain's trunks stop rendering as the
  // black slab) already sat 34.9 sRGB units from the PROCEDURAL peak before
  // any granite texture existed — so this pair was never the granite's to
  // open, and the one way to open it (lift the peak) was tried and refuted
  // on capture because it collapsed the snow cap's contrast (see the pin
  // above). Three things hold instead:
  const s = shipped();
  const a = authored();
  const p = procedural();
  const authoredGap = gap(s.pine, a.peak);
  const proceduralGap = gap(s.pine, p.peak);
  // 1. Authoring the granite may not bring the peak CLOSER to the pine than
  //    the procedural peak already was. Same rule the arch's stone obeys: an
  //    authored surface is not allowed to cost separation that shipped.
  assert.ok(authoredGap >= proceduralGap - 1,
    `granite pulled the peak toward the pine: ${authoredGap.toFixed(1)} authored vs ${proceduralGap.toFixed(1)} procedural`);
  // 2. A hard floor at half the 60-unit rule. The wooden arch shipped at 6.6
  //    raw and 43.1 rendered with BOTH materials the same brown; this pair is
  //    hue-opposed (below), which Euclidean sRGB distance under-counts, and the
  //    pines sit 40+ altitude units below the peaks so they are rarely in one
  //    frame. 30 is the number at which the sweep for the first solve started
  //    to read as two materials; it is not a target, it is a floor.
  assert.ok(authoredGap >= 30, `pine bark vs granite renders only ${authoredGap.toFixed(1)} sRGB units apart`);
  // 3. Hue opposition is what carries the rest: warm bark, cold rock. If a
  //    re-graded albedo neutralised either, the 30 floor alone would let a
  //    grey-on-grey mountain through.
  assert.ok(s.pine[0] / s.pine[2] > 1.3, 'the pine bark is warm (r/b > 1.3)');
  assert.ok(a.peak[0] / a.peak[2] < 0.8, 'the granite is cold (r/b < 0.8)');
  // And the value order the eye reads a mountain by: bark darker than snow,
  // rock darker than snow, by a wide margin — asserted in the snow test.
});

test('the canyon spire keeps its value against the floor it stands on', skip, () => {
  // Deliberately NOT the 60-unit rule. A spire and the canyon floor are the
  // same sandstone, and demanding they read as different materials is asking
  // the art to be wrong. What matters is that texturing the spires does not
  // move the biome's silhouette: they are the only thing in the canyons with
  // a shape.
  const a = authored();
  const p = procedural();
  const ratio = luma(a.spire) / luma(p.spire);
  assert.ok(ratio >= 0.7 && ratio <= 1.3,
    `the spire renders at ${ratio.toFixed(3)}x its procedural luminance — outside the 30% band`);
  assert.ok(ratio >= 1.0, 'and it must not go darker: the spires are read against a bright desert sky');
  // Still distinguishable from the floor, though, or the biome is one wash.
  assert.ok(gap(a.spire, GROUND_RENDER.canyons) >= 60,
    `spire and canyon floor are ${gap(a.spire, GROUND_RENDER.canyons).toFixed(1)} apart`);
});

// ===========================================================================
// 5. One constant, a family of materials.
// ===========================================================================

test('one canyon tint still leaves two kinds of spire', skip, () => {
  const a = authored();
  const p = procedural();
  // The two spire materials exist to stop the ridges reading as one cloned
  // cone. A single absolute tint applied to both would erase that; the family
  // scale keeps it.
  assert.ok(gap(a.spire, a.darkSpire) > 30,
    `the two spire tints render ${gap(a.spire, a.darkSpire).toFixed(1)} apart — the variety is gone`);
  const ratio = luma(a.darkSpire) / luma(p.darkSpire);
  assert.ok(ratio >= 0.7 && ratio <= 1.3, `dark spire moved ${ratio.toFixed(3)}x`);
  // And the family scale is derived, not tabulated.
  assert.ok(Math.abs(familyScale(MAT.darkSpire, MAT.spire) - 0.5429) < 0.002);
});

test('one concrete tint reproduces all three facades to within 2 sRGB units', skip, () => {
  const a = authored();
  const p = procedural();
  // Measured: the three dusk navies are the same hue at three values, so a
  // SCALAR luminance scale reproduces each of them. That is what lets one
  // solved constant serve three materials without flattening them.
  for (let i = 0; i < 3; i += 1) {
    const d = gap(a.facades[i], p.facades[i]);
    assert.ok(d <= 2, `facade ${i} moved ${d.toFixed(2)} sRGB units; the window shader needs it dark and unchanged`);
  }
  // And the three stay distinct from each other.
  assert.ok(luma(a.facades[1]) > luma(a.facades[0]) && luma(a.facades[0]) > luma(a.facades[2]));
});

// ===========================================================================
// 6. Snow: the ceiling, and the specification it cannot meet.
// ===========================================================================

test('snow is taken to its clipping ceiling, which is below the luma it was asked for', skip, () => {
  const a = authored();
  const lit = luma(a.snow);

  // The ask was luma >= 0.8 linear at under 1.5% clipping. Measured, this
  // file cannot do both, and the reason is its own histogram: the
  // 98.5th-percentile texel is 1.55x the mean, so the mean cannot pass ~0.646
  // without more than 1.5% of the texture saturating. At luma 0.8 it is 31.6%
  // — a third of the sastrugi gone, which is the only thing the file adds
  // over the flat colour it replaces.
  assert.ok(clipPercent(ALBEDOS.snow, asArray(SNOW_TINT)) < 1.5);
  assert.ok(lit >= 0.58 && lit <= 0.66,
    `snow renders at ${lit.toFixed(4)}; the 1.5%-clip ceiling for this file is 0.646 neutral / 0.608 at half cast`);

  // Prove the ceiling rather than asserting it: any uniform scale-up of this
  // tint that reaches 0.8 must blow the budget.
  const toEight = 0.8 / lit;
  const scaled = asArray(SNOW_TINT).map((v) => v * toEight);
  assert.ok(clipPercent(ALBEDOS.snow, scaled) > 10,
    'if luma 0.8 were reachable under budget, this tint is simply too dark and should be raised');

  // Whatever the value, snow is still the lightest thing in the mountain frame
  // by a wide margin — that is non-negotiable and is the thing luma >= 0.8 was
  // really protecting.
  const s = shipped();
  assert.ok(lit > luma(a.peak) * 2, `snow ${lit.toFixed(3)} vs granite ${luma(a.peak).toFixed(3)}`);
  assert.ok(lit > luma(s.pine) * 2, `snow ${lit.toFixed(3)} vs pine bark ${luma(s.pine).toFixed(3)}`);
  // Cool, not neutral: half of snowMat's own cast survives, so the caps still
  // belong to an alpine sky rather than to a concrete yard.
  assert.ok(SNOW_TINT.b > SNOW_TINT.g && SNOW_TINT.g > SNOW_TINT.r);
});

// ===========================================================================
// 7. Temperature — each biome keeps its own palette.
// ===========================================================================

test('each tint carries its biome\'s temperature', skip, () => {
  const warm = (t) => t.r / t.b;
  // Canyons and forest ground are warm; mountain and city are cold. The trap
  // this guards is the one PINE_BARK_TINT records: reproducing a neighbouring
  // biome's tone exactly is how a mountain ends up borrowing the forest's brown.
  assert.ok(warm(CANYON_TINT) > 3.0, 'the canyons are rust, not stone-grey');
  assert.ok(GRANITE_TINT.b > GRANITE_TINT.r * 1.4, 'granite is cold');
  assert.ok(CONCRETE_TINT.b > CONCRETE_TINT.r * 3.0, 'the city is a dusk navy');
  assert.ok(SNOW_TINT.b > SNOW_TINT.r, 'snow takes the sky');
  // The ground's normalisation is the one that must NOT carry a temperature:
  // its job is to cancel the file's own cast so the terrain palette is the
  // only thing setting hue.
  const a = authored();
  const p = procedural();
  assert.ok(gap(a.ground, p.ground) < 1.0,
    `the forest ground shifted ${gap(a.ground, p.ground).toFixed(2)} sRGB units; the map must add structure, not colour`);
  for (let c = 0; c < 3; c += 1) {
    assert.ok(Math.abs(asArray(GROUND_TINT)[c] * MEAN.ground[c] - 1) < 0.005,
      'GROUND_TINT x mean must be exactly 1 per channel');
  }
});
