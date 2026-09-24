/**
 * src/effects/exposure.js — exposure like an eye. OPT-IN: `?autoexp=1`
 * (eye adaptation) and `?localtm=1` (local tone mapping by exposure fusion).
 * With neither flag this module builds nothing: `bloom-pass.js` constructs
 * its composite from the untouched source and runs its untouched pass list.
 *
 * Why an eye now. Since the realism wave the frame's brightness genuinely
 * moves: the atmosphere model scales the key and sky with the LOCAL sun
 * elevation, Ultra hides the key while the shadow light is the sun (so
 * shadowed ground is really dark), and the horizon map puts whole valleys in
 * skyline shadow at every preset. A fixed per-biome exposure (1.008-1.254)
 * was right for one view of each biome and wrong for the rest. An eye does
 * two things about that, and this module does both, on the GPU, with no
 * readback in the frame loop:
 *
 * 1. EYE ADAPTATION (`?autoexp=1`). The log-average luminance of the HDR
 *    scene target, metered centre-weighted over a 64x64 grid whose mip chain
 *    IS the reduction (the 1x1 level is the weighted mean), drives an
 *    exposure that adapts through a 1x1 FloatType ping-pong: Pattanaik et
 *    al. 2000's exponential approach, in EV, with separate rates for the
 *    scene getting brighter (light adaptation, fast) and darker (dark
 *    adaptation, slow), from the frame's own dt, so it is frame-rate
 *    independent (exp(-a) exp(-b) = exp(-(a+b))). It multiplies the biome's
 *    AUTHORED exposure: EV = strength x (key - measured), clamped to +/-1.5,
 *    where `key` is the metered log-luminance of that biome's reference view
 *    — so at the reference view the multiplier is exactly 1 and the authored
 *    look is the centre of the range, not a thing the eye overrides.
 *
 * 2. LOCAL TONE MAPPING (`?localtm=1`), exposure fusion after Mertens,
 *    Kautz & Van Reeth 2007 as Bart Wronski (2022, "Local tone mapping by
 *    exposure fusion") adapts it to a real-time pipeline: three SYNTHETIC
 *    exposures of the one HDR frame (-0.35, 0, +1.5 EV) are pushed through
 *    the display model (Neutral + sRGB, the curve the composite applies),
 *    weighted by well-exposedness, and blended through Laplacian pyramids of
 *    the exposures and Gaussian pyramids of the weights at QUARTER
 *    resolution. The result is not an image but a LOCAL EXPOSURE (a gain
 *    map), fitted per window as a linear function of log-luminance and
 *    upsampled by the full-resolution luminance (guided upsampling, He et
 *    al. 2013), so the composite pays one extra bilinear fetch per pixel and
 *    edges stay where the full-resolution frame puts them.
 *
 * Every constant the GLSL uses is emitted from the tables below, and the
 * unit suite (tests/exposure.test.js) runs the SAME math in JS: adaptation,
 * clamp, key, the display model and its inverse, the fusion weights, and a
 * reference pyramid that shares the shaders' sampling rules.
 *
 * Zero allocation per frame: every target, material and uniform is built
 * once; `render()` assigns numbers and draws.
 */

// ---------------------------------------------------------------------------
// Flags — read with the URL-regex convention every other flag uses.
// ---------------------------------------------------------------------------

/** `?autoexp=1` — the eye adapts. Opt-in: absent (or anything else) is off. */
export function autoExposureRequested(search) {
  return /[?&]autoexp=1(?:&|$)/.test(typeof search === 'string' ? search : '');
}

/** `?localtm=1` — local tone mapping by exposure fusion. Opt-in. */
export function localToneRequested(search) {
  return /[?&]localtm=1(?:&|$)/.test(typeof search === 'string' ? search : '');
}

// ---------------------------------------------------------------------------
// Eye adaptation — the parameters, and the math the adapt shader runs.
// ---------------------------------------------------------------------------

export const AUTO_EXPOSURE = Object.freeze({
  // The range, in stops, the eye may move the authored exposure. Beyond it a
  // scene is simply darker or brighter, which is what the player should see.
  evMin: -1.5,
  evMax: 1.5,
  // How much of a luminance change is compensated. 1 would normalise every
  // view to the key (a dark valley would look like noon); an eye keeps some
  // of the difference, and so does this.
  strength: 0.7,
  // Time constants, seconds. The scene got BRIGHTER: light adaptation, fast.
  // The scene got DARKER: dark adaptation, slower. (Real dark adaptation
  // takes minutes; a game's has to finish inside the view that caused it.)
  tauBright: 0.5,
  tauDark: 1.1,
  // log2(0) is -Infinity, and one -Infinity in an average is the whole
  // average: a black pixel (a pupil, a shadowed crevice) would drive the
  // exposure to +Infinity and the HalfFloat composite to Inf/NaN, which
  // spreads through the bloom as a black block. Floor and ceiling in log2.
  logFloor: -12,
  logCeil: 12,
  // A step never integrates more than this much time (a tab restore).
  maxDt: 0.25,
  // The meter: a 64x64 grid (its mip chain is the reduction), four taps per
  // cell, centre-weighted like a camera's averaging meter — the field an eye
  // adapts to is the middle of the view, not the corners.
  meterSize: 64,
  centerSigma: 0.28,
  centerFloor: 0.25,
});

/**
 * log2 of the metered luminance at each biome's REFERENCE VIEW — level
 * flight 30 units over the ground, nose 0.1 rad down, chase camera, the sun
 * at the elevation the palette was authored at (t = 165 s, ~42 degrees: the
 * atmosphere model's own reference), world seed 16160, Amazing preset, the
 * meter above. The MEDIAN of 16 views per biome (8 spots x 2 headings),
 * because the mean is dragged by the one view that stares into a canyon wall
 * (canyons: median -2.48, mean -3.07, min -6.88). At the median view the
 * multiplier is exactly 1. Table and spread in
 * docs/perf/gates/G-REALISM-AUTO-EXPOSURE.md.
 */
export const EXPOSURE_KEYS = Object.freeze({
  forest: -2.30,
  canyons: -2.48,
  mountain: -2.06,
  city: -3.49,
});
export const DEFAULT_EXPOSURE_KEY = -2.3;

/** The key (log2) for an environment id; an unknown id gets the default. */
export function exposureKeyFor(id) {
  const k = EXPOSURE_KEYS[id];
  return Number.isFinite(k) ? k : DEFAULT_EXPOSURE_KEY;
}

/**
 * log2 luminance with the floor and ceiling the shaders use. NaN, negative
 * and zero luminance meter as the floor; +Infinity (a HalfFloat overflow)
 * as the ceiling — never as a non-finite number.
 */
export function logLuminance(y, cfg = AUTO_EXPOSURE) {
  if (Number.isNaN(y) || !(y > 0)) return cfg.logFloor;
  if (y === Infinity) return cfg.logCeil;
  return Math.min(cfg.logCeil, Math.max(cfg.logFloor, Math.log2(y)));
}

/** The centre weight the meter gives a sample at uv (u, v). */
export function meterWeight(u, v, cfg = AUTO_EXPOSURE) {
  const du = u - 0.5; const dv = v - 0.5;
  return cfg.centerFloor + Math.exp(-(du * du + dv * dv) / (2 * cfg.centerSigma * cfg.centerSigma));
}

/**
 * The exposure (EV) the eye is heading for, given the metered log2
 * luminance and the biome's key. Exactly 0 at the key.
 */
export function targetEv(measuredLog2, keyLog2, cfg = AUTO_EXPOSURE) {
  if (!Number.isFinite(measuredLog2)) return 0;
  const ev = cfg.strength * (keyLog2 - measuredLog2);
  return Math.min(cfg.evMax, Math.max(cfg.evMin, ev));
}

/** The fraction of the remaining gap one step of `dt` seconds closes. */
export function adaptationAlpha(dt, tau) {
  if (!(dt > 0)) return 0;
  if (!(tau > 0)) return 1;
  return 1 - Math.exp(-dt / tau);
}

/**
 * One adaptation step, exactly as the adapt shader takes it. A target BELOW
 * the current EV means the scene got brighter (light adaptation, tauBright).
 * Never overshoots: alpha is in [0, 1).
 */
export function adaptEv(prevEv, target, dt, cfg = AUTO_EXPOSURE) {
  const step = Math.min(Math.max(dt, 0), cfg.maxDt);
  const alpha = adaptationAlpha(step, target < prevEv ? cfg.tauBright : cfg.tauDark);
  return prevEv + (target - prevEv) * alpha;
}

// ---------------------------------------------------------------------------
// Local tone mapping — the display model, the synthetic exposures, weights.
// ---------------------------------------------------------------------------

export const LOCAL_TONE = Object.freeze({
  // The synthetic exposures, in stops about the frame's own exposure. The
  // highlights one is deliberately small: a flat -1 (textbook Mertens) pulls
  // a 0.9 sky down to 0.70 and the frame's p99 with it; at -0.25 the sky of
  // a backlit forest view moved 1.4-3.0% (four seeded views), while
  // highlight DETAIL still reaches the fine levels. Shadows get two and a
  // half stops: fused in the log domain and kept local, that lifted the same
  // views' p10 by 3-14%.
  highlightsEv: -0.25,
  shadowsEv: 2.5,
  // Well-exposedness (Mertens: Gaussian about 0.5, sigma 0.2), with a wider
  // shoulder above the middle so a bright-but-fine sky is not "badly
  // exposed", and a preference for the frame as authored: the base exposure's
  // weight is multiplied by `basePreference`, so where the frame is already
  // well exposed it stays as it was and the fusion spends itself on the
  // shadows.
  mu: 0.5,
  sigmaLow: 0.2,
  sigmaHigh: 0.25,
  basePreference: 2,
  // Mertens' epsilon: an all-black block still has defined weights.
  weightEpsilon: 1e-4,
  // How much of the fused local exposure is applied (on the log gain), and
  // the range it may take, in stops. LIFT ONLY: the fusion's darkening half
  // is, beside a dark canopy, a halo in the sky — -1.2 stops at the worst
  // texel of the reference frame in tests/exposure.test.js — and darkening
  // a bright frame is the eye adaptation's job. With the floor at 0 the p99
  // of four backlit views moved +0.0 to +0.4% (it was -1.4 to -3.0%).
  strength: 1.5,
  gainMin: 0,
  gainMax: 1.5,
  // Guided upsampling: regulariser (log2 units squared — a 0.2-stop spread
  // inside a window is "flat") and the slope limit of the linear model.
  epsilon: 0.04,
  slopeMax: 1.5,
  // The guide's log-luminance is centred here before it is stored, so the
  // model's intercept stays small in HalfFloat.
  guideCenter: -2,
  // Fusion resolution: 1/4 of the scene target in each axis.
  downscale: 4,
  maxLevels: 14,
  // How LOCAL the adaptation is: pyramid levels finer than this fraction of
  // the frame's longer side are fused; coarser ones keep the base exposure.
  // >= 1 fuses the whole pyramid (textbook Mertens), whose residual moves the
  // frame's GLOBAL brightness — measured, p50 +24% and p99 +10.7% on a
  // backlit forest view — which is the eye adaptation's job, not this one's.
  // At 0.35 the kept residual is a few bands a third of the frame tall (1x3
  // at quarter-res 97x211), which is what holds the sky: 0.5 (only the 1x1
  // kept) let the same view's p99 fall 7.2%.
  localScale: 0.35,
});

/**
 * How many pyramid levels are fused for a fusion base `maxDim` texels on its
 * longer side: levels whose texel is finer than `localScale` of the frame.
 * Returns top + 1 (the whole pyramid) when localScale >= 1.
 */
export function fusedLevels(maxDim, localScale) {
  const top = mipLevels(maxDim, maxDim) - 1;
  if (!(localScale < 1)) return top + 1;
  const b = Math.round(Math.log2(Math.max(1, localScale * maxDim)));
  return Math.max(1, Math.min(top + 1, b));
}

/** three.js NeutralToneMapping (Khronos PBR Neutral) for a GREY input. */
export function neutralGray(x) {
  const v = Math.max(0, x);
  const offset = v < 0.08 ? v - 6.25 * v * v : 0.04;
  const y = v - offset;
  return y < 0.76 ? y : 1 - 0.0576 / (y - 0.52);
}

/** Exact inverse of neutralGray on [0, 1). */
export function neutralGrayInverse(y) {
  if (!(y > 0)) return 0;
  if (y < 0.04) return Math.sqrt(y / 6.25);
  if (y < 0.76) return y + 0.04;
  return 0.56 + 0.0576 / Math.max(1 - y, 1e-4);
}

export function srgbEncode(x) {
  const v = Math.min(1, Math.max(0, x));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function srgbDecode(y) {
  const v = Math.min(1, Math.max(0, y));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Exposed scene luminance -> the display value the composite would show. */
export function toDisplay(x) { return srgbEncode(neutralGray(x)); }
/** Display value -> the exposed scene luminance that would show it. */
export function fromDisplay(y) { return neutralGrayInverse(srgbDecode(y)); }

/** The three synthetic exposures of one exposed luminance, as display values. */
export function syntheticExposures(exposedL, cfg = LOCAL_TONE) {
  return [
    toDisplay(exposedL * 2 ** cfg.highlightsEv),
    toDisplay(exposedL),
    toDisplay(exposedL * 2 ** cfg.shadowsEv),
  ];
}

/** Well-exposedness of one display value (un-normalised, un-preferenced). */
export function wellExposedness(y, cfg = LOCAL_TONE) {
  const d = y - cfg.mu;
  const s = d < 0 ? cfg.sigmaLow : cfg.sigmaHigh;
  return Math.exp(-(d * d) / (2 * s * s)) + cfg.weightEpsilon;
}

/** Normalised fusion weights for (highlights, base, shadows). Sum to 1. */
export function fusionWeights(yHighlights, yBase, yShadows, cfg = LOCAL_TONE) {
  const a = wellExposedness(yHighlights, cfg);
  const b = wellExposedness(yBase, cfg) * cfg.basePreference;
  const c = wellExposedness(yShadows, cfg);
  const s = a + b + c;
  return [a / s, b / s, c / s];
}

/**
 * The pyramids hold log2 of the display values, floored here. Fused in the
 * LOG domain, the Laplacian of exposure k minus the base's is the Laplacian
 * of log(Y_k / Y_0) — a per-pixel ratio that is large in the shadows and
 * small in the highlights — so a dark region beside a bright sky is lifted
 * rather than pushed darker (see fuseFlat and the gate doc for the failure
 * the display domain produced on the live page).
 */
export const LOG_DISPLAY_FLOOR = 1e-4;
export function logDisplay(y) { return Math.log2(Math.max(y, LOG_DISPLAY_FLOOR)); }

/**
 * What the fusion does to a LARGE UNIFORM region (every pyramid level sees
 * the same value): the weighted GEOMETRIC mean of the three exposures (the
 * log-domain blend), and the local exposure it implies, in stops.
 */
export function fuseFlat(yBase, cfg = LOCAL_TONE) {
  const L = fromDisplay(yBase);
  const ys = syntheticExposures(L, cfg);
  const w = fusionWeights(ys[0], ys[1], ys[2], cfg);
  const fused = 2 ** (w[0] * logDisplay(ys[0]) + w[1] * logDisplay(ys[1]) + w[2] * logDisplay(ys[2]));
  const gainEv = Math.log2(Math.max(fromDisplay(fused), 1e-6) / Math.max(L, 1e-6));
  return { fused, gainEv };
}

// ---------------------------------------------------------------------------
// GLSL — emitted from the tables above, so the shaders and the unit suite
// cannot disagree about a constant.
// ---------------------------------------------------------------------------

/** A GLSL float literal (always carries a decimal point or an exponent). */
export function glslFloat(x) {
  const s = Number(x).toPrecision(9);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

const F = glslFloat;

/** Luminance, the NaN/Inf scrub, and the clamped log — shared by every pass. */
export const EYE_COMMON_GLSL = `
  const vec3 EYE_LUMA = vec3(0.2126, 0.7152, 0.0722);
  const float EYE_LOG_FLOOR = ${F(AUTO_EXPOSURE.logFloor)};
  const float EYE_LOG_CEIL = ${F(AUTO_EXPOSURE.logCeil)};
  float eyeLuma(vec3 c) {
    float y = dot(c, EYE_LUMA);
    // A NaN or Inf in the HalfFloat scene must never reach a log or an
    // average: it would poison every mip above it and, through the
    // ping-pong, every frame after it.
    if (isnan(y) || isinf(y) || !(y > 0.0)) return 0.0;
    return y;
  }
  float eyeLogLuma(float y) {
    return clamp(log2(max(y, exp2(EYE_LOG_FLOOR))), EYE_LOG_FLOOR, EYE_LOG_CEIL);
  }
  float eyeSafeEv(float ev) {
    return (isnan(ev) || isinf(ev) || !(abs(ev) < 8.0)) ? 0.0 : ev;
  }
`;

/** The display model (Neutral for grey + sRGB) and its inverse. */
export const EYE_DISPLAY_GLSL = `
  float eyeNeutral(float x) {
    x = max(x, 0.0);
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    float y = x - offset;
    return y < 0.76 ? y : 1.0 - 0.0576 / (y - 0.52);
  }
  float eyeNeutralInv(float y) {
    if (!(y > 0.0)) return 0.0;
    if (y < 0.04) return sqrt(y * 0.16);
    if (y < 0.76) return y + 0.04;
    return 0.56 + 0.0576 / max(1.0 - y, 1e-4);
  }
  float eyeSrgb(float x) {
    x = clamp(x, 0.0, 1.0);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 0.41666667) - 0.055;
  }
  float eyeSrgbInv(float y) {
    y = clamp(y, 0.0, 1.0);
    return y <= 0.04045 ? y / 12.92 : pow((y + 0.055) / 1.055, 2.4);
  }
  float eyeDisplay(float x) { return eyeSrgb(eyeNeutral(x)); }
  float eyeScene(float y) { return eyeNeutralInv(eyeSrgbInv(y)); }
  const float EYE_LOG_DISPLAY_FLOOR = ${F(LOG_DISPLAY_FLOOR)};
`;

/** Metering: centre-weighted log-luminance, four taps per 64x64 cell. */
export const METER_FRAG = `
  uniform sampler2D tScene;
  uniform float uCell;
  varying vec2 vUv;
  ${EYE_COMMON_GLSL}
  const float EYE_CENTER_K = ${F(1 / (2 * AUTO_EXPOSURE.centerSigma * AUTO_EXPOSURE.centerSigma))};
  const float EYE_CENTER_FLOOR = ${F(AUTO_EXPOSURE.centerFloor)};
  void main() {
    float q = uCell * 0.25;
    float l = eyeLogLuma(eyeLuma(texture2D(tScene, vUv + vec2(-q, -q)).rgb))
            + eyeLogLuma(eyeLuma(texture2D(tScene, vUv + vec2( q, -q)).rgb))
            + eyeLogLuma(eyeLuma(texture2D(tScene, vUv + vec2(-q,  q)).rgb))
            + eyeLogLuma(eyeLuma(texture2D(tScene, vUv + vec2( q,  q)).rgb));
    vec2 d = vUv - 0.5;
    float w = EYE_CENTER_FLOOR + exp(-dot(d, d) * EYE_CENTER_K);
    // r / g at the 1x1 mip is the weighted mean of log2 luminance.
    gl_FragColor = vec4(0.25 * l * w, w, 0.0, 1.0);
  }
`;

/**
 * Adaptation: one fragment. r = the adapted EV the frame uses, g = what was
 * metered (log2), b = where the eye is heading (EV).
 *   uMode 0: adapt from last frame.   1: snap to the target (a cut).
 *         2: restart from EV 0 — the authored exposure the no-post path was
 *            just showing — and adapt from there (the tier restored the pass).
 */
export const ADAPT_FRAG = `
  uniform sampler2D tMeter;
  uniform float uMeterLod;
  uniform sampler2D tPrev;
  uniform float uMode;
  uniform float uAlphaBright;
  uniform float uAlphaDark;
  uniform float uKey;
  uniform float uStrength;
  uniform float uEvMin;
  uniform float uEvMax;
  varying vec2 vUv;
  ${EYE_COMMON_GLSL}
  void main() {
    vec4 m = textureLod(tMeter, vec2(0.5), uMeterLod);
    float measured = m.r / max(m.g, 1e-6);
    // An unusable meter reading means "as authored", never a wild exposure.
    if (isnan(measured) || isinf(measured) || !(abs(measured) < 30.0)) measured = uKey;
    float target = clamp(uStrength * (uKey - measured), uEvMin, uEvMax);
    float prev = eyeSafeEv(texture2D(tPrev, vec2(0.5)).r);
    if (uMode > 1.5) prev = 0.0;
    float ev = uMode > 0.5 && uMode < 1.5
      ? target
      : prev + (target - prev) * (target < prev ? uAlphaBright : uAlphaDark);
    gl_FragColor = vec4(ev, measured, target, 1.0);
  }
`;

/**
 * Fusion inputs, quarter resolution: log2 of the block's three synthetic
 * exposures as display values (rgb) and its mean log2 luminance, centred (a,
 * the guide). Four bilinear taps cover the 4x4 full-resolution block.
 */
export const FUSE_EXPOSURES_FRAG = `
  uniform sampler2D tScene;
  uniform vec2 uSceneTexel;
  uniform sampler2D tEyeExposure;
  uniform float uUseAuto;
  uniform float uAuthored;
  uniform vec2 uStops;
  uniform float uGuideCenter;
  varying vec2 vUv;
  ${EYE_COMMON_GLSL}
  ${EYE_DISPLAY_GLSL}
  void main() {
    vec2 o = uSceneTexel;
    float y0 = eyeLuma(texture2D(tScene, vUv + vec2(-o.x, -o.y)).rgb);
    float y1 = eyeLuma(texture2D(tScene, vUv + vec2( o.x, -o.y)).rgb);
    float y2 = eyeLuma(texture2D(tScene, vUv + vec2(-o.x,  o.y)).rgb);
    float y3 = eyeLuma(texture2D(tScene, vUv + vec2( o.x,  o.y)).rgb);
    float L = 0.25 * (y0 + y1 + y2 + y3);
    float guide = 0.25 * (eyeLogLuma(y0) + eyeLogLuma(y1) + eyeLogLuma(y2) + eyeLogLuma(y3));
    float ev = uUseAuto > 0.5 ? eyeSafeEv(texture2D(tEyeExposure, vec2(0.5)).r) : 0.0;
    float x = L * uAuthored * exp2(ev);
    gl_FragColor = vec4(
      log2(max(eyeDisplay(x * exp2(uStops.x)), EYE_LOG_DISPLAY_FLOOR)),
      log2(max(eyeDisplay(x), EYE_LOG_DISPLAY_FLOOR)),
      log2(max(eyeDisplay(x * exp2(uStops.y)), EYE_LOG_DISPLAY_FLOOR)),
      guide - uGuideCenter);
  }
`;

/** Normalised well-exposedness weights of the three exposures. */
export const FUSE_WEIGHTS_FRAG = `
  uniform sampler2D tExposures;
  uniform float uMu;
  uniform float uInvLow;
  uniform float uInvHigh;
  uniform float uBase;
  uniform float uEps;
  varying vec2 vUv;
  vec3 eyeWell(vec3 y) {
    vec3 d = y - uMu;
    // Below the middle: sigmaLow. At or above it: sigmaHigh (the JS rule).
    vec3 k = mix(vec3(uInvLow), vec3(uInvHigh), step(vec3(0.0), d));
    return exp(-d * d * k) + uEps;
  }
  void main() {
    // The pyramid stores log2 of the display values; well-exposedness is
    // judged on the display values themselves.
    vec3 w = eyeWell(exp2(textureLod(tExposures, vUv, 0.0).rgb)) * vec3(1.0, uBase, 1.0);
    gl_FragColor = vec4(w / (w.x + w.y + w.z), 1.0);
  }
`;

/**
 * The pyramid collapse, evaluated directly at each quarter-res texel, in
 * log2 display units (Y = log2 of each exposure's display value):
 *   fused = sum_{l<B} W_l . (Y_l - Y_{l+1})  +  Y0_B
 * with every level sampled by textureLod at the same uv, and the residual at
 * level B the BASE exposure's (B = uFuse; past the top, the textbook
 * weighted residual). With the base's weight 1 at every level the sum
 * telescopes to Y0 exactly, so a frame the fusion leaves alone comes back
 * bit for bit. Out: r = local exposure (stops), g = the centred guide.
 */
export const COLLAPSE_FRAG = `
  uniform sampler2D tExposures;
  uniform sampler2D tWeights;
  uniform float uTop;
  uniform float uFuse;
  uniform float uStrength;
  uniform float uGainMin;
  uniform float uGainMax;
  varying vec2 vUv;
  ${EYE_DISPLAY_GLSL}
  const int EYE_MAX_LEVELS = ${LOCAL_TONE.maxLevels};
  vec3 eyeNorm(vec3 w) { return w / max(w.x + w.y + w.z, 1e-4); }
  void main() {
    vec4 base = textureLod(tExposures, vUv, 0.0);
    vec3 yPrev = base.rgb;
    float fused = 0.0;
    // Levels below uFuse are fused; the residual at uFuse is the BASE
    // exposure's (uFuse > uTop: the whole pyramid, textbook Mertens).
    float stop = min(uTop, uFuse);
    for (int i = 0; i < EYE_MAX_LEVELS; i++) {
      float lvl = float(i);
      if (lvl >= stop) break;
      vec3 yNext = textureLod(tExposures, vUv, lvl + 1.0).rgb;
      fused += dot(eyeNorm(textureLod(tWeights, vUv, lvl).rgb), yPrev - yNext);
      yPrev = yNext;
    }
    fused += uFuse > uTop ? dot(eyeNorm(textureLod(tWeights, vUv, uTop).rgb), yPrev) : yPrev.g;
    // Back from log2 display to the exposed scene luminance each would need.
    float yFused = exp2(clamp(fused, log2(EYE_LOG_DISPLAY_FLOOR), log2(0.999)));
    float g = log2(max(eyeScene(yFused), 1e-6)) - log2(max(eyeScene(exp2(base.g)), 1e-6));
    gl_FragColor = vec4(clamp(g * uStrength, uGainMin, uGainMax), base.a, 0.0, 1.0);
  }
`;

/**
 * Guided upsampling coefficients (He, Sun & Tang 2013): over each 3x3 window
 * of the local exposure g and the guide l, fit g = a l + b. The composite
 * evaluates it with the FULL-RESOLUTION l, so the exposure changes exactly
 * where the frame's own luminance does. Statistics in fp32 registers, never
 * stored: E[l^2] - E[l]^2 in HalfFloat would cancel to noise.
 */
export const GUIDE_FRAG = `
  uniform sampler2D tGain;
  uniform vec2 uTexel;
  uniform float uEpsilon;
  uniform float uSlopeMax;
  varying vec2 vUv;
  void main() {
    float sl = 0.0; float sg = 0.0; float sll = 0.0; float slg = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 v = texture2D(tGain, vUv + vec2(float(i), float(j)) * uTexel).rg;
        sl += v.y; sg += v.x; sll += v.y * v.y; slg += v.y * v.x;
      }
    }
    sl /= 9.0; sg /= 9.0; sll /= 9.0; slg /= 9.0;
    float variance = max(sll - sl * sl, 0.0);
    float a = clamp((slg - sl * sg) / (variance + uEpsilon), -uSlopeMax, uSlopeMax);
    gl_FragColor = vec4(a, sg - a * sl, 0.0, 1.0);
  }
`;

// The two places the composite is patched. Both are lines of the REAL
// composite source in bloom-pass.js; tests/exposure.test.js applies the
// patch to that exported string, not to a convenient copy of it.
export const COMPOSITE_UNIFORM_ANCHOR = '  uniform float uDebug;\n';
export const COMPOSITE_MAIN_ANCHOR = '  void main() {\n    vec2 d = vUv - 0.5;\n';
export const COMPOSITE_APPLY_ANCHOR = '    float v = 1.0 - dot(d, d) * (uVignette + uSpeed * 0.85);\n';

/**
 * The composite with the eye in it. Only what the flags ask for is emitted,
 * and the untouched source is what ships with neither — so the default
 * program is byte-identical to the one before this module existed.
 *
 * Throws if an anchor is missing: a patch that silently no-ops is how a
 * feature ships invisible (installFeatherDetail did exactly that).
 */
export function patchComposite(source, { autoExposure = false, localTone = false } = {}) {
  if (!autoExposure && !localTone) return source;
  for (const anchor of [COMPOSITE_UNIFORM_ANCHOR, COMPOSITE_MAIN_ANCHOR, COMPOSITE_APPLY_ANCHOR]) {
    if (source.indexOf(anchor) < 0) throw new Error(`exposure: composite anchor not found: ${JSON.stringify(anchor)}`);
  }
  const uniforms = [
    '  uniform float uEyeDebug;',
    autoExposure ? '  uniform sampler2D tEyeExposure;\n  uniform float uEyeAuto;' : '',
    localTone ? '  uniform sampler2D tEyeLocal;\n  uniform float uEyeLocal;\n  uniform vec2 uEyeGainRange;\n  uniform float uEyeGuideCenter;' : '',
  ].filter(Boolean).join('\n');
  const helpers = `
  ${EYE_COMMON_GLSL}
  // Stops the eye adds to the authored exposure at this pixel. which: 1 the
  // local exposure only, 2 eye adaptation only, 3 both (what is applied).
  float eyeStops(vec3 scene, float which) {
    float e = 0.0;
    ${autoExposure ? `if (which > 1.5 && uEyeAuto > 0.5) e += eyeSafeEv(texture2D(tEyeExposure, vec2(0.5)).r);` : ''}
    ${localTone ? `if ((which < 1.5 || which > 2.5) && uEyeLocal > 0.001) {
      vec2 ab = texture2D(tEyeLocal, vUv).rg;
      float l = eyeLogLuma(eyeLuma(scene)) - uEyeGuideCenter;
      e += uEyeLocal * clamp(ab.x * l + ab.y, uEyeGainRange.x, uEyeGainRange.y);
    }` : ''}
    return e;
  }
`;
  const debugView = `
    // Eye debug views: 1 the local exposure, 2 the adaptation, 3 both, as
    // grey (0.5 = no change, one stop per quarter).
    if (uEyeDebug > 0.5) {
      float stops = eyeStops(texture2D(tScene, vUv).rgb, uEyeDebug);
      gl_FragColor = vec4(vec3(clamp(0.5 + 0.25 * stops, 0.0, 1.0)), 1.0);
      #include <colorspace_fragment>
      return;
    }
`;
  // Uniforms beside the pass's own; helpers just above main(), where vUv is
  // declared; the multiply after bloom and shafts, before the vignette and the
  // tone curve — so the authored exposure and the eye's multiply one frame.
  // (Function replacers: a `$` in a replacement string is a pattern.)
  return source
    .replace(COMPOSITE_UNIFORM_ANCHOR, () => `${COMPOSITE_UNIFORM_ANCHOR}${uniforms}\n`)
    .replace(COMPOSITE_MAIN_ANCHOR, () => `${helpers}${COMPOSITE_MAIN_ANCHOR}${debugView}`)
    .replace(COMPOSITE_APPLY_ANCHOR, () => `    c *= exp2(eyeStops(scene, 3.0));\n${COMPOSITE_APPLY_ANCHOR}`);
}

// ---------------------------------------------------------------------------
// The stage: targets, materials, the per-frame passes.
// ---------------------------------------------------------------------------

const MODE_ADAPT = 0;
const MODE_SNAP = 1;
const MODE_RESTART = 2;

/** Number of mip levels three allocates for a (w, h) render target. */
export function mipLevels(width, height) {
  return Math.floor(Math.log2(Math.max(1, width, height))) + 1;
}

/**
 * Build the eye. `vertexShader` is the pass's own full-screen triangle
 * shader; `drawWith(material, target)` (handed to render()) draws it.
 */
export function createExposureStage(THREE, renderer, {
  autoExposure = false,
  localTone = false,
  vertexShader,
  environment = null,
} = {}) {
  const auto = !!autoExposure;
  const local = !!localTone;
  const cfg = { ...AUTO_EXPOSURE };
  const lcfg = { ...LOCAL_TONE };

  // 32-bit float for the adaptation state: at 60 fps a 1.1 s time constant
  // closes 1.5% of the gap per frame, and in HalfFloat (spacing 0.002 near 1)
  // the last tenth of a stop would never be closed. Needs a renderable
  // RGBA32F, which three enables at init via EXT_color_buffer_float.
  const floatState = !!renderer.extensions?.has?.('EXT_color_buffer_float');
  const halfTarget = {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const mipTarget = {
    ...halfTarget,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  };
  const stateTarget = {
    format: THREE.RGBAFormat,
    type: floatState ? THREE.FloatType : THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  };

  const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false,
  });

  // ---- eye adaptation ----
  let meter = null; let stateA = null; let stateB = null; let current = null;
  let meterMaterial = null; let adaptMaterial = null;
  if (auto) {
    meter = new THREE.WebGLRenderTarget(cfg.meterSize, cfg.meterSize, mipTarget);
    stateA = new THREE.WebGLRenderTarget(1, 1, stateTarget);
    stateB = new THREE.WebGLRenderTarget(1, 1, stateTarget);
    current = stateA;
    meterMaterial = material(METER_FRAG, {
      tScene: { value: null },
      uCell: { value: 1 / cfg.meterSize },
    });
    adaptMaterial = material(ADAPT_FRAG, {
      tMeter: { value: meter.texture },
      uMeterLod: { value: mipLevels(cfg.meterSize, cfg.meterSize) - 1 },
      tPrev: { value: stateB.texture },
      uMode: { value: MODE_SNAP },
      uAlphaBright: { value: 0 },
      uAlphaDark: { value: 0 },
      uKey: { value: exposureKeyFor(environment) },
      uStrength: { value: cfg.strength },
      uEvMin: { value: cfg.evMin },
      uEvMax: { value: cfg.evMax },
    });
  }

  // ---- local tone mapping ----
  let exposures = null; let weights = null; let gain = null; let guide = null;
  let exposuresMaterial = null; let weightsMaterial = null; let collapseMaterial = null; let guideMaterial = null;
  if (local) {
    exposures = new THREE.WebGLRenderTarget(1, 1, mipTarget);
    weights = new THREE.WebGLRenderTarget(1, 1, mipTarget);
    gain = new THREE.WebGLRenderTarget(1, 1, {
      ...halfTarget, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    guide = new THREE.WebGLRenderTarget(1, 1, {
      ...halfTarget, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    exposuresMaterial = material(FUSE_EXPOSURES_FRAG, {
      tScene: { value: null },
      uSceneTexel: { value: new THREE.Vector2(1, 1) },
      tEyeExposure: { value: current ? current.texture : null },
      uUseAuto: { value: auto ? 1 : 0 },
      uAuthored: { value: 1 },
      uStops: { value: new THREE.Vector2(lcfg.highlightsEv, lcfg.shadowsEv) },
      uGuideCenter: { value: lcfg.guideCenter },
    });
    weightsMaterial = material(FUSE_WEIGHTS_FRAG, {
      tExposures: { value: exposures.texture },
      uMu: { value: lcfg.mu },
      uInvLow: { value: 1 / (2 * lcfg.sigmaLow * lcfg.sigmaLow) },
      uInvHigh: { value: 1 / (2 * lcfg.sigmaHigh * lcfg.sigmaHigh) },
      uBase: { value: lcfg.basePreference },
      uEps: { value: lcfg.weightEpsilon },
    });
    collapseMaterial = material(COLLAPSE_FRAG, {
      tExposures: { value: exposures.texture },
      tWeights: { value: weights.texture },
      uTop: { value: 0 },
      uFuse: { value: 1 },
      uStrength: { value: lcfg.strength },
      uGainMin: { value: lcfg.gainMin },
      uGainMax: { value: lcfg.gainMax },
    });
    guideMaterial = material(GUIDE_FRAG, {
      tGain: { value: gain.texture },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uEpsilon: { value: lcfg.epsilon },
      uSlopeMax: { value: lcfg.slopeMax },
    });
  }

  // The composite's extra uniforms, merged into its uniform table by the
  // pass (the objects are shared, so render() below updates them in place).
  const compositeUniforms = { uEyeDebug: { value: 0 } };
  if (auto) {
    compositeUniforms.tEyeExposure = { value: current.texture };
    compositeUniforms.uEyeAuto = { value: 1 };
  }
  if (local) {
    compositeUniforms.tEyeLocal = { value: guide.texture };
    compositeUniforms.uEyeLocal = { value: 1 };
    compositeUniforms.uEyeGainRange = { value: new THREE.Vector2(lcfg.gainMin, lcfg.gainMax) };
    compositeUniforms.uEyeGuideCenter = { value: lcfg.guideCenter };
  }

  let mode = MODE_SNAP;          // the very first frame is a cut
  let previousTime = null;
  let lastDt = 0;
  let frames = 0;
  let fuseWidth = 1; let fuseHeight = 1; let fuseTop = 0;
  let sceneWidth = 1; let sceneHeight = 1;
  let passes = 0;

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function setSize(width, height) {
    sceneWidth = Math.max(1, Math.floor(width) || 1);
    sceneHeight = Math.max(1, Math.floor(height) || 1);
    if (!local) return;
    fuseWidth = Math.max(1, Math.floor(sceneWidth / lcfg.downscale));
    fuseHeight = Math.max(1, Math.floor(sceneHeight / lcfg.downscale));
    exposures.setSize(fuseWidth, fuseHeight);
    weights.setSize(fuseWidth, fuseHeight);
    gain.setSize(fuseWidth, fuseHeight);
    guide.setSize(fuseWidth, fuseHeight);
    fuseTop = mipLevels(fuseWidth, fuseHeight) - 1;
    collapseMaterial.uniforms.uTop.value = fuseTop;
    collapseMaterial.uniforms.uFuse.value = fusedLevels(Math.max(fuseWidth, fuseHeight), lcfg.localScale);
    exposuresMaterial.uniforms.uSceneTexel.value.set(1 / sceneWidth, 1 / sceneHeight);
    guideMaterial.uniforms.uTexel.value.set(1 / fuseWidth, 1 / fuseHeight);
  }

  /**
   * The eye's passes for one frame. `sceneTexture` is the resolved HDR scene;
   * `drawWith` is the pass's own full-screen draw; `tally` its observability
   * hook. Allocates nothing.
   */
  function render(sceneTexture, drawWith, tally) {
    const t = now();
    const dt = previousTime === null ? 0 : Math.min(Math.max((t - previousTime) * 0.001, 0), cfg.maxDt);
    previousTime = t;
    lastDt = dt;
    frames += 1;
    passes = 0;

    if (auto) {
      meterMaterial.uniforms.tScene.value = sceneTexture;
      drawWith(meterMaterial, meter);
      if (tally) tally(false);
      const next = current === stateA ? stateB : stateA;
      const u = adaptMaterial.uniforms;
      u.tPrev.value = current.texture;
      u.uMode.value = mode;
      u.uAlphaBright.value = adaptationAlpha(dt, cfg.tauBright);
      u.uAlphaDark.value = adaptationAlpha(dt, cfg.tauDark);
      drawWith(adaptMaterial, next);
      if (tally) tally(false);
      current = next;
      compositeUniforms.tEyeExposure.value = current.texture;
      if (local) exposuresMaterial.uniforms.tEyeExposure.value = current.texture;
      passes += 2;
    }
    mode = MODE_ADAPT;

    if (local) {
      const eu = exposuresMaterial.uniforms;
      eu.tScene.value = sceneTexture;
      eu.uAuthored.value = renderer.toneMappingExposure;
      eu.uUseAuto.value = auto && compositeUniforms.uEyeAuto.value > 0.5 ? 1 : 0;
      drawWith(exposuresMaterial, exposures);
      if (tally) tally(false);
      drawWith(weightsMaterial, weights);
      if (tally) tally(false);
      drawWith(collapseMaterial, gain);
      if (tally) tally(false);
      drawWith(guideMaterial, guide);
      if (tally) tally(false);
      passes += 4;
    }
  }

  /** A cut (environment switch): the next frame snaps to its own target. */
  function snap() { mode = MODE_SNAP; }

  /**
   * The post pass did not run this frame (the adaptive tier shed it, or the
   * panel turned it off): the screen showed the AUTHORED exposure. When the
   * pass comes back the eye restarts from there and adapts, rather than
   * reappearing at whatever it had adapted to before — a stale value would
   * light the frame for seconds, a snap would pop.
   */
  function skipFrame() { if (mode !== MODE_SNAP) mode = MODE_RESTART; }

  function setEnvironment(id) {
    if (auto) adaptMaterial.uniforms.uKey.value = exposureKeyFor(id);
    snap();
  }

  /** Live tuning and the A/B switches (debug hook only). */
  function configure(opts = {}) {
    if (!opts || typeof opts !== 'object') return;
    if (opts.snap) snap();
    if (opts.restart && mode !== MODE_SNAP) mode = MODE_RESTART;
    if (Number.isFinite(opts.debug)) compositeUniforms.uEyeDebug.value = opts.debug;
    if (auto) {
      const u = adaptMaterial.uniforms;
      if (opts.auto !== undefined) compositeUniforms.uEyeAuto.value = opts.auto ? 1 : 0;
      for (const k of ['strength', 'tauBright', 'tauDark', 'evMin', 'evMax', 'maxDt']) {
        if (Number.isFinite(opts[k])) cfg[k] = opts[k];
      }
      u.uStrength.value = cfg.strength;
      u.uEvMin.value = cfg.evMin;
      u.uEvMax.value = cfg.evMax;
      if (Number.isFinite(opts.key)) u.uKey.value = opts.key;
    }
    if (local) {
      if (opts.local !== undefined) compositeUniforms.uEyeLocal.value = Math.max(0, Math.min(1, Number(opts.local) || 0));
      for (const k of ['highlightsEv', 'shadowsEv', 'mu', 'sigmaLow', 'sigmaHigh', 'basePreference',
        'strength', 'gainMin', 'gainMax', 'epsilon', 'slopeMax', 'localScale']) {
        const key = k === 'strength' ? 'localStrength' : k;
        if (Number.isFinite(opts[key])) lcfg[k] = opts[key];
      }
      collapseMaterial.uniforms.uFuse.value = fusedLevels(Math.max(fuseWidth, fuseHeight), lcfg.localScale);
      exposuresMaterial.uniforms.uStops.value.set(lcfg.highlightsEv, lcfg.shadowsEv);
      const w = weightsMaterial.uniforms;
      w.uMu.value = lcfg.mu;
      w.uInvLow.value = 1 / (2 * lcfg.sigmaLow * lcfg.sigmaLow);
      w.uInvHigh.value = 1 / (2 * lcfg.sigmaHigh * lcfg.sigmaHigh);
      w.uBase.value = lcfg.basePreference;
      const c = collapseMaterial.uniforms;
      c.uStrength.value = lcfg.strength;
      c.uGainMin.value = lcfg.gainMin;
      c.uGainMax.value = lcfg.gainMax;
      compositeUniforms.uEyeGainRange.value.set(lcfg.gainMin, lcfg.gainMax);
      guideMaterial.uniforms.uEpsilon.value = lcfg.epsilon;
      guideMaterial.uniforms.uSlopeMax.value = lcfg.slopeMax;
    }
  }

  /** Bytes of GPU memory the stage's targets hold (mip chains at 4/3). */
  function memoryBytes() {
    let bytes = 0;
    const px = (w, h) => w * h;
    if (auto) {
      bytes += px(cfg.meterSize, cfg.meterSize) * 8 * (4 / 3);
      bytes += 2 * (floatState ? 16 : 8);
    }
    if (local) {
      bytes += 2 * px(fuseWidth, fuseHeight) * 8 * (4 / 3);
      bytes += 2 * px(fuseWidth, fuseHeight) * 8;
    }
    return Math.round(bytes);
  }

  /**
   * What the eye is doing — a DEBUG readback of the 1x1 state, ASYNC (a
   * pixel-pack buffer and a fence, so the GPU never stalls and Chrome never
   * logs "GPU stall due to ReadPixels"). Never called by the frame loop.
   */
  async function read() {
    const out = {
      autoexp: auto,
      localtm: local,
      frames,
      dt: lastDt,
      passes,
      memoryBytes: memoryBytes(),
      sizes: {
        meter: auto ? { width: meter.width, height: meter.height } : null,
        state: auto ? { width: 1, height: 1, type: floatState ? 'float' : 'half' } : null,
        fusion: local ? {
          width: fuseWidth, height: fuseHeight, levels: fuseTop + 1, fused: collapseMaterial.uniforms.uFuse.value,
        } : null,
        scene: { width: sceneWidth, height: sceneHeight },
      },
      runtime: {
        auto: auto ? compositeUniforms.uEyeAuto.value > 0.5 : false,
        local: local ? compositeUniforms.uEyeLocal.value : 0,
        debug: compositeUniforms.uEyeDebug.value,
      },
      params: { ...cfg },
      localParams: { ...lcfg },
      key: auto ? adaptMaterial.uniforms.uKey.value : null,
      ev: null, measured: null, target: null,
    };
    if (auto) {
      try {
        const buf = floatState ? new Float32Array(4) : new Uint16Array(4);
        await renderer.readRenderTargetPixelsAsync(current, 0, 0, 1, 1, buf);
        const val = (i) => (floatState ? buf[i] : THREE.DataUtils.fromHalfFloat(buf[i]));
        out.ev = val(0);
        out.measured = val(1);
        out.target = val(2);
      } catch (e) {
        out.readError = String(e && e.message || e);
      }
    }
    return out;
  }

  function dispose() {
    for (const t of [meter, stateA, stateB, exposures, weights, gain, guide]) if (t) t.dispose();
    for (const m of [meterMaterial, adaptMaterial, exposuresMaterial, weightsMaterial, collapseMaterial, guideMaterial]) {
      if (m) m.dispose();
    }
  }

  return {
    autoExposure: auto,
    localTone: local,
    compositeUniforms,
    patchComposite: (source) => patchComposite(source, { autoExposure: auto, localTone: local }),
    setSize,
    render,
    snap,
    skipFrame,
    setEnvironment,
    configure,
    read,
    memoryBytes,
    dispose,
  };
}
