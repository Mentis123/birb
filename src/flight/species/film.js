// PORTED from Birb Gauntlet (gauntlet/src/bird/realistic/film.js) for the root
// game's bird picker. Gauntlet stays airtight: this is a copy, not an import.
// Root-game adaptations are marked "ROOT:".
/**
 * realistic/film.js — structural colour, as numbers a test can hold. PURE.
 *
 * No THREE, no DOM. This is the JS side of the realistic birds' thin film:
 * the crow's blue-black gloss and the clockwork owl's blued steel are both
 * interference colour, and three's MeshPhysicalMaterial renders that with the
 * Belcour & Barla 2017 thin-film model (`iridescence`). The formula below is
 * that shader transcribed, so the film's colour at an angle is something the
 * tests pin rather than something only a capture can catch.
 *
 * PORTED from Birb Mobile's `src/flight/plumage.js` (`thinFilmReflectance`,
 * `hueDegrees`, `linearGreyHex`), which pins the Bronze-winged Pionus's
 * copper-to-green bronze the same way. Gauntlet is airtight against the parent
 * `src/`, so this is a copy, not an import; keep the two in step by hand if
 * three's evalIridescence ever changes.
 *
 * Also here: the sRGB <-> linear helpers every realistic module needs (vertex
 * colours are LINEAR in three; the palette is sRGB hex), and `filmRamp`, the
 * three-stop view-angle tint the mid tier uses in place of the real film
 * (MeshStandardMaterial has no iridescence) and the low tier bakes into its
 * Phong specular colour.
 */

/** Keratin, the stuff of feathers: F0 = ((n - 1) / (n + 1))^2 = 0.048. */
export const KERATIN_IOR = 1.56;

/** sRGB channel (0..1) -> linear. */
export function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** linear channel (0..1) -> sRGB. */
export function linearToSrgb(c) {
    const v = Math.min(Math.max(c, 0), 1);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** sRGB hex -> linear [r, g, b] (what three's Color.setHex stores). */
export function hexToLinear(hex, out) {
    const o = out || [0, 0, 0];
    o[0] = srgbToLinear(((hex >> 16) & 255) / 255);
    o[1] = srgbToLinear(((hex >> 8) & 255) / 255);
    o[2] = srgbToLinear((hex & 255) / 255);
    return o;
}

/** linear [r, g, b] -> sRGB hex. */
export function linearToHex(rgb) {
    const b = (c) => Math.round(linearToSrgb(c) * 255);
    return (b(rgb[0]) << 16) | (b(rgb[1]) << 8) | b(rgb[2]);
}

/** A linear grey level as the sRGB hex three's Color.set() decodes back to it. */
export function linearGreyHex(v) {
    const byte = Math.round(linearToSrgb(v) * 255);
    return (byte << 16) | (byte << 8) | byte;
}

/**
 * The thin-film Fresnel three's shader computes (iridescence_fragment,
 * `evalIridescence`). Air outside; `filmIor` over a base of Fresnel
 * reflectance `baseF0` (a scalar). Returns linear RGB reflectance.
 */
export function thinFilmReflectance(cosTheta1, filmIor, thicknessNm, baseF0) {
    const PI = Math.PI;
    const pow2 = (x) => x * x;
    // three's F_Schlick is the spherical-Gaussian fit, not pow(1 - c, 5).
    const schlick = (f0, f90, c) => { const f = 2 ** ((-5.55473 * c - 6.98316) * c); return f0 * (1 - f) + f90 * f; };
    const outside = 1;
    const t = Math.min(Math.max(thicknessNm / 0.03, 0), 1);
    const eta = outside + (filmIor - outside) * (t * t * (3 - 2 * t));
    const sin2Sq = pow2(outside / eta) * (1 - pow2(cosTheta1));
    const cos2Sq = 1 - sin2Sq;
    if (cos2Sq < 0) return [1, 1, 1];
    const cos2 = Math.sqrt(cos2Sq);
    const R0 = pow2((eta - outside) / (eta + outside));
    const R12 = schlick(R0, 1, cosTheta1);
    const T121 = 1 - R12;
    const phi12 = eta < outside ? PI : 0;
    const phi21 = PI - phi12;
    const s = Math.sqrt(Math.min(Math.max(baseF0, 0), 0.9999));
    const baseIor = (1 + s) / (1 - s);
    const R1 = pow2((baseIor - eta) / (baseIor + eta));
    const R23 = schlick(R1, 1, cos2);
    const phi23 = baseIor < eta ? PI : 0;
    const OPD = 2 * eta * thicknessNm * cos2;
    const phi = phi21 + phi23;
    const R123 = Math.min(Math.max(R12 * R23, 1e-5), 0.9999);
    const r123 = Math.sqrt(R123);
    const Rs = pow2(T121) * R23 / (1 - R123);
    const I = [R12 + Rs, R12 + Rs, R12 + Rs];
    let Cm = Rs - T121;
    // evalSensitivity: the CIE XYZ response of a phase shift, as three fits it.
    const val = [5.4856e-13, 4.4201e-13, 5.2481e-13];
    const pos = [1.6810e+06, 1.7953e+06, 2.2084e+06];
    const vr = [4.3278e+09, 9.3046e+09, 6.6121e+09];
    for (let m = 1; m <= 2; m += 1) {
        Cm *= r123;
        const phase = 2 * PI * (m * OPD) * 1e-9;
        const shift = m * phi;
        const xyz = [0, 1, 2].map((i) => val[i] * Math.sqrt(2 * PI * vr[i]) * Math.cos(pos[i] * phase + shift) * Math.exp(-pow2(phase) * vr[i]));
        xyz[0] += 9.7470e-14 * Math.sqrt(2 * PI * 4.5282e+09) * Math.cos(2.2399e+06 * phase + shift) * Math.exp(-4.5282e+09 * pow2(phase));
        const [X, Y, Z] = xyz.map((v) => v / 1.0685e-7);
        const rgb = [
            3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
            -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
            0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
        ];
        for (let i = 0; i < 3; i += 1) I[i] += Cm * 2 * rgb[i];
    }
    return I.map((v) => Math.max(v, 0));
}

/** Hue in degrees (0-360) of a linear RGB triple, or null for a grey. */
export function hueDegrees(rgb) {
    const r = rgb[0], g = rgb[1], b = rgb[2];
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d < 1e-9) return null;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
}

/**
 * The view angles the ramp is sampled at, as cos(theta): face-on, the chase
 * camera's mid view of a curved back, and grazing.
 */
export const FILM_RAMP_COS = Object.freeze([1.0, 0.55, 0.15]);

/**
 * Three linear reflectance tints of a film at FILM_RAMP_COS, each scaled so
 * its brightest channel is `peak`. The mid tier mixes material.specularColor
 * toward this ramp by N.V, which reproduces the film's HUE travel without the
 * physical model's cost; the low tier takes the middle stop as its Phong
 * specular colour.
 */
export function filmRamp(film, peak = 0.16) {
    const out = [];
    for (let i = 0; i < FILM_RAMP_COS.length; i++) {
        const r = thinFilmReflectance(FILM_RAMP_COS[i], film.ior, film.thickness, film.baseF0);
        const m = Math.max(r[0], r[1], r[2], 1e-6);
        out.push([r[0] / m * peak, r[1] / m * peak, r[2] / m * peak]);
    }
    return out;
}
