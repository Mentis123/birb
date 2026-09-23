/**
 * atmosphere-model.js — a compact physical sky, used as a RATIO.
 *
 * The biomes' palettes are authored: a forest key light of #ffdfab, a sky
 * panorama somebody painted, a fog colour taken from that sky. What they are
 * not is RESPONSIVE: before this module the sun swept from 19 to 58 degrees
 * and the sky rendered pixel-identical at both ends (measured on 54b1961),
 * because nothing in the palette knew where the sun was. The key light had a
 * warmth heuristic and nothing else did.
 *
 * So this is a small physical atmosphere evaluated on the CPU, and the game
 * uses only its RATIOS: `model(e_now) / model(e_ref)`, where e_ref is the
 * elevation the biome's palette was authored at (the authored key light sits
 * at ~42 degrees). At e_ref every ratio is exactly 1 and the frame is the
 * authored one; everywhere else the palette moves the way a real sky moves —
 * the sun reddens and dims toward the horizon, the zenith deepens and darkens,
 * the sunward horizon keeps its glow while the far side goes cold.
 *
 * Parameters are Earth's, as published for Hillaire 2020 ("A Scalable and
 * Production Ready Sky and Atmosphere Rendering Technique", EGSR) and
 * Bruneton's 2017 reference implementation:
 *
 *   Rayleigh scattering  (5.802, 13.558, 33.1) e-6 /m, scale height 8 km
 *   Mie scattering 3.996e-6 /m, extinction 4.40e-6 /m, scale height 1.2 km,
 *     Cornette-Shanks phase with g = 0.8
 *   Ozone absorption (0.650, 1.881, 0.085) e-6 /m, a tent centred at 25 km
 *     with a 15 km half-width
 *   Ground radius 6360 km, top of atmosphere 6460 km
 *
 * Birb's planet is 120 units across; its sky is NOT that planet's sky. The
 * Earth model supplies how light changes with the sun's elevation, and the
 * authored art supplies what that light looks like — which is also why a
 * ratio, not an absolute radiance, is the output (and why the solar spectrum
 * is left white: it cancels in every ratio).
 *
 * What is computed, per evaluate():
 *  - sun:        transmittance from the observer toward the sun (the key light's colour)
 *  - zenith:     sky radiance straight up
 *  - horizonSun / horizonSide / horizonAway: sky radiance 3 degrees above the
 *                horizon toward the sun, at 90 degrees to it, and away from it
 *  - horizonMean: the azimuthal average of the horizon (fog, mist)
 *  - irradiance: diffuse sky irradiance on a horizontal surface (the hemisphere light)
 * Single scattering is ray-marched against a transmittance table built once at
 * construction (Bruneton's parameterisation); multiple scattering uses
 * Hillaire's closed form Psi_ms = L2 / (1 - f_ms), evaluated at four heights for
 * the current sun per evaluate() instead of as a texture.
 *
 * Cost: construction builds a 64x32 transmittance table (~2k texels x 40
 * steps, a few milliseconds, once). One evaluate() is a few thousand march
 * steps; the game calls it a few times a second at most, and only when the
 * sun's elevation actually moved. Zero allocation after construction: every
 * array is owned by the model or by an output object from createOutput().
 *
 * Pure: no THREE, no DOM.
 */

export const EARTH_ATMOSPHERE = Object.freeze({
  groundRadius: 6360, // km
  topRadius: 6460, // km
  rayleighScattering: Object.freeze([5.802e-3, 13.558e-3, 33.1e-3]), // per km
  rayleighScaleHeight: 8, // km
  mieScattering: 3.996e-3, // per km
  mieExtinction: 4.40e-3, // per km
  mieScaleHeight: 1.2, // km
  mieG: 0.8,
  ozoneAbsorption: Object.freeze([0.650e-3, 1.881e-3, 0.085e-3]), // per km
  ozoneCenter: 25, // km
  ozoneHalfWidth: 15, // km
  groundAlbedo: 0.3,
  // The bird flies above the ground; a few hundred metres keeps the horizon
  // samples from grazing the planet.
  observerAltitude: 0.3, // km
  // "The horizon" is 3 degrees above it, where the sky dome's warm band sits.
  horizonElevation: (3 * Math.PI) / 180,
});

/** Photopic luminance weights (Rec. 709 / sRGB primaries, linear). */
export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

/** Sane bounds for a relative modulation. Luminance first, then per channel. */
export const RATIO_BOUNDS = Object.freeze({ minLum: 0.5, maxLum: 1.6, minChannel: 0.35, maxChannel: 1.9 });

const OUTPUT_FIELDS = Object.freeze(['sun', 'zenith', 'horizonSun', 'horizonSide', 'horizonAway', 'horizonMean', 'irradiance']);
export { OUTPUT_FIELDS as ATMOSPHERE_FIELDS };

const PI = Math.PI;
const INV_4PI = 1 / (4 * PI);
const RAYLEIGH_PHASE_K = 3 / (16 * PI);

/**
 * Resolution of the tables and quadratures. The defaults were chosen against
 * a reference run at 4-8x every count (tests/atmosphere-model.test.js keeps
 * the comparison): every RATIO the game uses lands within 1% of it.
 */
export const ATMOSPHERE_RESOLUTION = Object.freeze({
  // Transmittance table: mu axis, r axis, integration steps per texel.
  transmittanceWidth: 32,
  transmittanceHeight: 16,
  transmittanceSteps: 32,
  // Multiple scattering: heights (km) where Psi_ms is evaluated per call, and
  // the sphere of directions it integrates over.
  msHeights: Object.freeze([0, 2.5, 8, 25]),
  msBands: 4,
  msAzimuths: 8,
  msSteps: 12,
  // Sky irradiance over the upper hemisphere (symmetric about the sun's
  // vertical plane, so azimuth runs 0..PI and is doubled).
  irradianceBands: 5,
  irradianceAzimuths: 6,
  irradianceSteps: 20,
  viewSteps: 32,
});

/**
 * @param {Partial<typeof EARTH_ATMOSPHERE>} [overrides]
 * @param {Partial<typeof ATMOSPHERE_RESOLUTION>} [resolution]
 */
export function createAtmosphereModel(overrides = {}, resolution = {}) {
  const P = { ...EARTH_ATMOSPHERE, ...overrides };
  const Q = { ...ATMOSPHERE_RESOLUTION, ...resolution };
  const T_W = Q.transmittanceWidth;
  const T_H = Q.transmittanceHeight;
  const T_STEPS = Q.transmittanceSteps;
  const MS_HEIGHTS = Q.msHeights;
  const MS_BANDS = Q.msBands;
  const MS_AZIMUTHS = Q.msAzimuths;
  const MS_STEPS = Q.msSteps;
  const IRR_BANDS = Q.irradianceBands;
  const IRR_AZIMUTHS = Q.irradianceAzimuths;
  const IRR_STEPS = Q.irradianceSteps;
  const VIEW_STEPS = Q.viewSteps;
  const Rg = P.groundRadius;
  const Rt = P.topRadius;
  const H = Math.sqrt(Rt * Rt - Rg * Rg);
  const bR0 = P.rayleighScattering[0];
  const bR1 = P.rayleighScattering[1];
  const bR2 = P.rayleighScattering[2];
  const bMs = P.mieScattering;
  const bMe = P.mieExtinction;
  const aO0 = P.ozoneAbsorption[0];
  const aO1 = P.ozoneAbsorption[1];
  const aO2 = P.ozoneAbsorption[2];
  const invHR = 1 / P.rayleighScaleHeight;
  const invHM = 1 / P.mieScaleHeight;
  const g = P.mieG;
  const g2 = g * g;
  const mieK = (3 / (8 * PI)) * (1 - g2) / (2 + g2);
  const r0 = Rg + P.observerAltitude;

  // ---- media ---------------------------------------------------------
  // Written by density(h): the two exponential densities and the ozone tent.
  const med = { dR: 0, dM: 0, dO: 0 };
  function density(h) {
    med.dR = Math.exp(-h * invHR);
    med.dM = Math.exp(-h * invHM);
    const o = 1 - Math.abs(h - P.ozoneCenter) / P.ozoneHalfWidth;
    med.dO = o > 0 ? o : 0;
  }

  function distanceToTop(r, mu) {
    const disc = r * r * (mu * mu - 1) + Rt * Rt;
    const d = -r * mu + Math.sqrt(disc > 0 ? disc : 0);
    return d > 0 ? d : 0;
  }
  function distanceToGround(r, mu) {
    const disc = r * r * (mu * mu - 1) + Rg * Rg;
    const d = -r * mu - Math.sqrt(disc > 0 ? disc : 0);
    return d > 0 ? d : 0;
  }
  function hitsGround(r, mu) {
    return mu < 0 && r * r * (mu * mu - 1) + Rg * Rg >= 0;
  }

  // ---- transmittance table (Bruneton 2017 parameterisation) -----------
  const tLut = new Float64Array(T_W * T_H * 3);
  for (let j = 0; j < T_H; j += 1) {
    const xr = j / (T_H - 1);
    const rho = H * xr;
    const r = Math.sqrt(rho * rho + Rg * Rg);
    for (let i = 0; i < T_W; i += 1) {
      const xmu = i / (T_W - 1);
      const dMin = Rt - r;
      const dMax = rho + H;
      const d = dMin + xmu * (dMax - dMin);
      let mu = d === 0 ? 1 : (H * H - rho * rho - d * d) / (2 * r * d);
      mu = mu > 1 ? 1 : mu < -1 ? -1 : mu;
      const len = distanceToTop(r, mu);
      const dt = len / T_STEPS;
      let t0 = 0; let t1 = 0; let t2 = 0;
      for (let k = 0; k < T_STEPS; k += 1) {
        const t = (k + 0.5) * dt;
        const rr = Math.sqrt(r * r + t * t + 2 * r * mu * t);
        density(rr - Rg);
        t0 += bR0 * med.dR + bMe * med.dM + aO0 * med.dO;
        t1 += bR1 * med.dR + bMe * med.dM + aO1 * med.dO;
        t2 += bR2 * med.dR + bMe * med.dM + aO2 * med.dO;
      }
      const idx = (j * T_W + i) * 3;
      tLut[idx] = Math.exp(-t0 * dt);
      tLut[idx + 1] = Math.exp(-t1 * dt);
      tLut[idx + 2] = Math.exp(-t2 * dt);
    }
  }

  /** Transmittance from radius r along cosine mu to the top, into out[o..o+2]. */
  function transmittance(r, mu, out, o) {
    if (hitsGround(r, mu)) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; return; }
    const rr = r < Rg ? Rg : r > Rt ? Rt : r;
    const rho = Math.sqrt(rr * rr - Rg * Rg);
    const d = distanceToTop(rr, mu);
    const dMin = Rt - rr;
    const dMax = rho + H;
    let xmu = dMax > dMin ? (d - dMin) / (dMax - dMin) : 0;
    let xr = rho / H;
    xmu = xmu < 0 ? 0 : xmu > 1 ? 1 : xmu;
    xr = xr < 0 ? 0 : xr > 1 ? 1 : xr;
    const fi = xmu * (T_W - 1);
    const fj = xr * (T_H - 1);
    let i0 = Math.floor(fi); let j0 = Math.floor(fj);
    if (i0 >= T_W - 1) i0 = T_W - 2;
    if (j0 >= T_H - 1) j0 = T_H - 2;
    const ai = fi - i0; const aj = fj - j0;
    const a00 = (j0 * T_W + i0) * 3;
    const a10 = a00 + 3;
    const a01 = a00 + T_W * 3;
    const a11 = a01 + 3;
    for (let c = 0; c < 3; c += 1) {
      const top = tLut[a00 + c] + (tLut[a10 + c] - tLut[a00 + c]) * ai;
      const bot = tLut[a01 + c] + (tLut[a11 + c] - tLut[a01 + c]) * ai;
      out[o + c] = top + (bot - top) * aj;
    }
  }

  // ---- scratch (all owned here; nothing below allocates) ----------------
  const tSun = new Float64Array(3);
  const ms = new Float64Array(MS_HEIGHTS.length * 3); // Psi_ms per height
  const L = new Float64Array(3); // ray-march accumulators
  const Lf = new Float64Array(3);
  const thr = new Float64Array(3);
  const psi = new Float64Array(3);
  const tGround = new Float64Array(3);
  // The sun, in the model's local frame at the observer: +Z up, the sun in
  // the XZ plane at +X.
  let sunX = 0; let sunZ = 1;

  function msAt(h, out) {
    // Piecewise-linear in height between the evaluated levels.
    const n = MS_HEIGHTS.length;
    if (h <= MS_HEIGHTS[0]) { out[0] = ms[0]; out[1] = ms[1]; out[2] = ms[2]; return; }
    for (let k = 1; k < n; k += 1) {
      if (h <= MS_HEIGHTS[k]) {
        const a = (h - MS_HEIGHTS[k - 1]) / (MS_HEIGHTS[k] - MS_HEIGHTS[k - 1]);
        const p = (k - 1) * 3; const q = k * 3;
        out[0] = ms[p] + (ms[q] - ms[p]) * a;
        out[1] = ms[p + 1] + (ms[q + 1] - ms[p + 1]) * a;
        out[2] = ms[p + 2] + (ms[q + 2] - ms[p + 2]) * a;
        return;
      }
    }
    // Above the last level the scattering medium is thin; hold the top value.
    const q = (n - 1) * 3;
    out[0] = ms[q]; out[1] = ms[q + 1]; out[2] = ms[q + 2];
  }

  /**
   * March one ray from a point at (0, 0, rs) in direction (vx, vy, vz), with
   * the sun at (sunX, 0, sunZ). Accumulates into L (radiance) and Lf (the
   * f_ms transfer). `mode` 0: the sky (real phases + Psi_ms); 1: the multiple
   * scattering integrand (isotropic phase, no Psi_ms, plus the ground bounce).
   */
  function march(rs, vx, vy, vz, steps, mode) {
    L[0] = 0; L[1] = 0; L[2] = 0;
    Lf[0] = 0; Lf[1] = 0; Lf[2] = 0;
    thr[0] = 1; thr[1] = 1; thr[2] = 1;
    const mu = vz;
    const ground = hitsGround(rs, mu);
    const tMax = ground ? distanceToGround(rs, mu) : distanceToTop(rs, mu);
    if (!(tMax > 0)) return;
    const nu = vx * sunX + vz * sunZ;   // scattering angle cosine
    const phaseR = mode === 0 ? RAYLEIGH_PHASE_K * (1 + nu * nu) : INV_4PI;
    const phaseM = mode === 0 ? mieK * (1 + nu * nu) / Math.pow(1 + g2 - 2 * g * nu, 1.5) : INV_4PI;
    let tPrev = 0;
    for (let k = 0; k < steps; k += 1) {
      // Quadratic spacing: dense near the observer, where the air is.
      const a1 = (k + 1) / steps;
      const t1 = tMax * a1 * a1;
      const dt = t1 - tPrev;
      const t = tPrev + dt * 0.5;
      tPrev = t1;
      // The sample point, and its own up and sun cosine.
      const px = vx * t;
      const py = vy * t;
      const pz = rs + vz * t;
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const h = r - Rg;
      const muS = (px * sunX + pz * sunZ) / r;
      density(h > 0 ? h : 0);
      const sR = med.dR;
      const sM = med.dM;
      const s0 = bR0 * sR; const s1 = bR1 * sR; const s2 = bR2 * sR;
      const sm = bMs * sM;
      const e0 = s0 + bMe * sM + aO0 * med.dO;
      const e1 = s1 + bMe * sM + aO1 * med.dO;
      const e2 = s2 + bMe * sM + aO2 * med.dO;
      transmittance(r, muS, tSun, 0);
      let m0 = 0; let m1 = 0; let m2 = 0;
      if (mode === 0) { msAt(h, psi); m0 = psi[0]; m1 = psi[1]; m2 = psi[2]; }
      // In-scattered radiance per unit length at the sample.
      const S0 = (s0 * phaseR + sm * phaseM) * tSun[0] + (s0 + sm) * m0;
      const S1 = (s1 * phaseR + sm * phaseM) * tSun[1] + (s1 + sm) * m1;
      const S2 = (s2 * phaseR + sm * phaseM) * tSun[2] + (s2 + sm) * m2;
      // Energy-conserving integration over the step (Hillaire 2015/2020).
      const T0 = Math.exp(-e0 * dt); const T1 = Math.exp(-e1 * dt); const T2 = Math.exp(-e2 * dt);
      const i0 = e0 > 0 ? (1 - T0) / e0 : dt;
      const i1 = e1 > 0 ? (1 - T1) / e1 : dt;
      const i2 = e2 > 0 ? (1 - T2) / e2 : dt;
      L[0] += thr[0] * S0 * i0; L[1] += thr[1] * S1 * i1; L[2] += thr[2] * S2 * i2;
      Lf[0] += thr[0] * (s0 + sm) * i0; Lf[1] += thr[1] * (s1 + sm) * i1; Lf[2] += thr[2] * (s2 + sm) * i2;
      thr[0] *= T0; thr[1] *= T1; thr[2] *= T2;
    }
    if (ground && mode === 1) {
      // Light bounced off the ground where the ray lands (Lambertian).
      const px = vx * tMax; const py = vy * tMax; const pz = rs + vz * tMax;
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const nDotL = (px * sunX + pz * sunZ) / r;
      if (nDotL > 0) {
        transmittance(Rg, nDotL, tGround, 0);
        const k = nDotL * P.groundAlbedo / PI;
        L[0] += thr[0] * tGround[0] * k;
        L[1] += thr[1] * tGround[1] * k;
        L[2] += thr[2] * tGround[2] * k;
      }
    }
  }

  /** Psi_ms at each MS height for the current sun (Hillaire 2020 eq. 5-10). */
  function computeMultipleScattering() {
    const nDir = MS_BANDS * MS_AZIMUTHS;
    for (let hIdx = 0; hIdx < MS_HEIGHTS.length; hIdx += 1) {
      const rs = Rg + MS_HEIGHTS[hIdx] + 1e-3;
      let l0 = 0; let l1 = 0; let l2 = 0;
      let f0 = 0; let f1 = 0; let f2 = 0;
      for (let b = 0; b < MS_BANDS; b += 1) {
        const vz = 1 - (2 * (b + 0.5)) / MS_BANDS;   // uniform in cos(theta)
        const sinT = Math.sqrt(Math.max(0, 1 - vz * vz));
        for (let a = 0; a < MS_AZIMUTHS; a += 1) {
          const phi = (2 * PI * (a + 0.5)) / MS_AZIMUTHS;
          march(rs, sinT * Math.cos(phi), sinT * Math.sin(phi), vz, MS_STEPS, 1);
          l0 += L[0]; l1 += L[1]; l2 += L[2];
          f0 += Lf[0]; f1 += Lf[1]; f2 += Lf[2];
        }
      }
      // Mean over the sphere == integral against the isotropic phase.
      // L already carries the isotropic phase from march(); Lf is the pure
      // transfer and takes it here (f_ms = integral of Lf * p_u).
      // Uniform directions: the sphere integral against p_u = 1/(4 PI) is the
      // plain mean. L already carries p_u for the sun-to-ray scatter (march
      // mode 1), exactly as Hillaire's LUT pass does.
      const inv = 1 / nDir;
      l0 *= inv; l1 *= inv; l2 *= inv;
      f0 *= inv; f1 *= inv; f2 *= inv;
      // The infinite series of higher orders, 1 + f + f^2 + ... = 1/(1 - f).
      ms[hIdx * 3] = l0 / (1 - Math.min(0.99, f0));
      ms[hIdx * 3 + 1] = l1 / (1 - Math.min(0.99, f1));
      ms[hIdx * 3 + 2] = l2 / (1 - Math.min(0.99, f2));
    }
  }

  function skyInto(elevation, azimuth, out) {
    const ce = Math.cos(elevation);
    march(r0, ce * Math.cos(azimuth), ce * Math.sin(azimuth), Math.sin(elevation), VIEW_STEPS, 0);
    out[0] = L[0]; out[1] = L[1]; out[2] = L[2];
  }

  function luminance(v) { return LUMA[0] * v[0] + LUMA[1] * v[1] + LUMA[2] * v[2]; }

  const model = {
    params: P,

    /** A fresh output record. Allocate these at setup, then reuse them. */
    createOutput() {
      return createAtmosphereOutput();
    },

    /**
     * Fill `out` for a sun `elevation` radians above the observer's horizon.
     * Clamped to [0.02, PI/2]: the game's sun never sets, and a model asked
     * about a sun below the horizon would answer "black", which is correct
     * and useless.
     */
    evaluate(elevation, out) {
      let e = Number.isFinite(elevation) ? elevation : 0.7;
      e = e < 0.02 ? 0.02 : e > PI / 2 ? PI / 2 : e;
      out.elevation = e;
      sunX = Math.cos(e);
      sunZ = Math.sin(e);
      transmittance(r0, sunZ, out.sun, 0);
      computeMultipleScattering();
      skyInto(PI / 2, 0, out.zenith);
      const hz = P.horizonElevation;
      skyInto(hz, 0, out.horizonSun);
      skyInto(hz, PI / 2, out.horizonSide);
      skyInto(hz, PI, out.horizonAway);
      for (let c = 0; c < 3; c += 1) {
        // Azimuthal mean of a + b cos(phi) + c cos^2(phi) through the three samples.
        out.horizonMean[c] = 0.25 * out.horizonSun[c] + 0.5 * out.horizonSide[c] + 0.25 * out.horizonAway[c];
      }
      // Sky irradiance on a horizontal surface: E = integral of L cos(theta) dw
      // over the upper hemisphere, midpoint in u = cos(theta) and in azimuth.
      const irr = out.irradiance;
      irr[0] = 0; irr[1] = 0; irr[2] = 0;
      const du = 1 / IRR_BANDS;
      const dphi = PI / IRR_AZIMUTHS;
      for (let b = 0; b < IRR_BANDS; b += 1) {
        const u = (b + 0.5) * du;
        const el = Math.asin(u);
        for (let a = 0; a < IRR_AZIMUTHS; a += 1) {
          const phi = (a + 0.5) * dphi;
          const ce = Math.cos(el);
          march(r0, ce * Math.cos(phi), ce * Math.sin(phi), u, IRR_STEPS, 0);
          const w = u * du * dphi * 2;   // x2: the other half of the azimuths
          irr[0] += L[0] * w; irr[1] += L[1] * w; irr[2] += L[2] * w;
        }
      }
      for (let i = 0; i < OUTPUT_FIELDS.length; i += 1) {
        const f = OUTPUT_FIELDS[i];
        out.lum[f] = luminance(out[f]);
      }
      return out;
    },

    /**
     * Sky radiance for a view `elevation` / `azimuth` (radians; azimuth 0 is
     * toward the sun) under the sun of the LAST evaluate() call, into `out`.
     * For tests and calibration; the game reads the fields evaluate() fills.
     */
    skyRadiance(elevation, azimuth, out) {
      skyInto(elevation, azimuth, out);
      return out;
    },

    /** Direct transmittance only (cheap): from the observer toward elevation e. */
    sunTransmittance(elevation, out) {
      transmittance(r0, Math.sin(elevation), out, 0);
      return out;
    },
  };
  return model;
}

/** A fresh output record for evaluate() / relativeInto(). Setup-time only. */
export function createAtmosphereOutput() {
  const out = { elevation: 0, lum: {} };
  for (let i = 0; i < OUTPUT_FIELDS.length; i += 1) {
    out[OUTPUT_FIELDS[i]] = new Float64Array(3);
    out.lum[OUTPUT_FIELDS[i]] = 0;
  }
  return out;
}

/**
 * `num / den`, per channel, bounded: the ratio's LUMINANCE is clamped to
 * [minLum, maxLum] with its chromaticity kept, then each channel is clamped
 * to [minChannel, maxChannel]. A ratio inside the bounds passes through
 * untouched, so `ratioInto(x, x)` is exactly (1, 1, 1).
 */
export function ratioInto(num, den, out, bounds = RATIO_BOUNDS) {
  for (let c = 0; c < 3; c += 1) {
    const d = den[c];
    out[c] = d > 0 && Number.isFinite(num[c]) ? num[c] / d : 1;
  }
  const y = LUMA[0] * out[0] + LUMA[1] * out[1] + LUMA[2] * out[2];
  if (y > 0 && (y < bounds.minLum || y > bounds.maxLum)) {
    const k = (y < bounds.minLum ? bounds.minLum : bounds.maxLum) / y;
    out[0] *= k; out[1] *= k; out[2] *= k;
  }
  for (let c = 0; c < 3; c += 1) {
    const v = out[c];
    out[c] = v < bounds.minChannel ? bounds.minChannel : v > bounds.maxChannel ? bounds.maxChannel : v;
  }
  return out;
}

/**
 * Every field of `cur / ref` into the matching field of `out` (all three from
 * createOutput()). `out.lum` receives each ratio's luminance.
 */
export function relativeInto(cur, ref, out, bounds = RATIO_BOUNDS) {
  for (let i = 0; i < OUTPUT_FIELDS.length; i += 1) {
    const f = OUTPUT_FIELDS[i];
    ratioInto(cur[f], ref[f], out[f], bounds);
    const v = out[f];
    out.lum[f] = LUMA[0] * v[0] + LUMA[1] * v[1] + LUMA[2] * v[2];
  }
  out.elevation = cur.elevation;
  return out;
}
