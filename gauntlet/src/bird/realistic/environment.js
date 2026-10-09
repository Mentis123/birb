/**
 * realistic/environment.js — the realistic birds' own sky to reflect.
 *
 * A black crow and a brass owl are both mostly REFLECTION: with nothing to
 * reflect, physical metal goes dark between highlights and black feathers
 * read as holes. So they get a bird-only probe: Gauntlet's sky gradient
 * (PALETTE skyZenith / skyMid / skyHorizon, the same three colours the sky
 * dome is drawn with) over the planet below, baked to an equirect and
 * prefiltered with PMREM ONCE per renderer — Gauntlet has one sky, so that is
 * once per page — and shared by every realistic bird on it. Never per frame.
 * `scene.environment` is not touched; nothing else in the world changes.
 *
 * PORTED from Birb Mobile: `skyRadianceAt`, `rowUpComponent` and
 * `buildEquirectSky` (src/environment/sky-environment.js) and `envRotationFor`
 * plus the createBirdEnvironment ownership rules (src/flight/plumage.js).
 * Gauntlet is airtight against the parent src/, so these are copies.
 *
 * UP IS RADIAL here too (ARCHITECTURE.md): the planet is centred on the
 * origin, so a bird's up is normalize(position) and a world-+Y bake is right
 * only at the pole. Each realistic mesh turns its material's envMapRotation
 * to its own radial up just before it draws (realistic-bird.js), with
 * `envRotationFor` below. The gradient has no azimuth, so the cheapest such
 * rotation (two angles, no roll) is exact.
 */

import { PALETTE } from '../../core/palette.js';
import { hexToLinear, linearToHex } from './film.js';

/**
 * How far the probe's zenith and mid sky are pulled toward PALETTE.cloudLit.
 *
 * The dome is ART: a saturated cyan that reads as sky behind cel birds. A
 * mirror needs RADIANCE, and real daylight is far less saturated than that
 * paint. Measured, brass (realBrass) reflecting the raw dome: zenith -> hue
 * 168 (teal, near black), mid -> hue 124 (olive green) — a brass owl that
 * reads as verdigris. Halfway to cloudLit: zenith 37, mid 52 — gold. The
 * warm horizon and the planet below are kept as they are.
 */
export const PROBE_SKY_LIFT = 0.5;

function lift(hex, k) {
    const a = hexToLinear(hex), b = hexToLinear(PALETTE.cloudLit);
    return linearToHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}

/** The probe's four colours: Gauntlet's sky (lifted), and the planet below it. */
export function birdSkyColors() {
    return {
        top: lift(PALETTE.skyZenith, PROBE_SKY_LIFT),
        mid: lift(PALETTE.skyMid, PROBE_SKY_LIFT),
        horizon: PALETTE.skyHorizon,
        bottom: PALETTE.realGround,
    };
}

function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
function mix(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return Math.min(1, Math.max(0, x)); }

/** Linear radiance of the sky gradient at up-component h (-1 nadir .. 1 zenith). */
export function skyRadianceAt(h, colors) {
    const top = hexToLinear(colors.top);
    const mid = hexToLinear(colors.mid);
    const horizon = hexToLinear(colors.horizon);
    const bottom = hexToLinear(colors.bottom);
    const hc = Math.max(-1, Math.min(1, h));
    let c;
    if (hc < 0) {
        const t = (hc + 1) ** 2.2;
        c = [mix(bottom[0], horizon[0], t), mix(bottom[1], horizon[1], t), mix(bottom[2], horizon[2], t)];
    } else if (hc < 0.35) {
        const t = smoothstep(0, 0.35, hc);
        c = [mix(horizon[0], mid[0], t), mix(horizon[1], mid[1], t), mix(horizon[2], mid[2], t)];
    } else {
        const t = smoothstep(0.35, 1, hc);
        c = [mix(mid[0], top[0], t), mix(mid[1], top[1], t), mix(mid[2], top[2], t)];
    }
    const room = 1 - clamp01(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
    const band = Math.exp(-(((hc - 0.02) * 8) ** 2)) * 0.22 * room;
    return [c[0] + horizon[0] * band, c[1] + horizon[1] * band, c[2] + horizon[2] * band];
}

/** Up-component an equirect row samples (row 0 looks at the nadir). */
export function rowUpComponent(row, rows) {
    const v = (row + 0.5) / rows;
    return Math.sin((v - 0.5) * Math.PI);
}

/** The bake, as RGBA float data (pure). */
export function equirectSkyData(colors, width = 64, height = 32) {
    const data = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const rgb = skyRadianceAt(rowUpComponent(y, height), colors);
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 1;
        }
    }
    return data;
}

/**
 * Euler (x, y; order XYZ) with R_X(x) R_Y(y) mapping unit `up` onto +Y. three
 * negates material.envMapRotation before use, so callers write (-x, -y, 0).
 */
export function envRotationFor(ux, uy, uz, out) {
    const r = Math.sqrt(ux * ux + uz * uz);
    out.y = r > 1e-9 ? Math.atan2(-ux, uz) : 0;
    out.x = Math.atan2(-r, uy);
    return out;
}

// One prefiltered probe per renderer, refcounted by the birds that use it.
const _probes = new WeakMap();

/**
 * The shared probe texture for `renderer`, baking it on first use. Every
 * call takes a reference; `releaseBirdEnvironment` gives it back and the
 * last release disposes the render target.
 */
export function acquireBirdEnvironment(THREE, renderer) {
    let entry = _probes.get(renderer);
    if (!entry) {
        const w = 64, h = 32;
        const source = new THREE.DataTexture(equirectSkyData(birdSkyColors(), w, h), w, h, THREE.RGBAFormat, THREE.FloatType);
        source.mapping = THREE.EquirectangularReflectionMapping;
        source.needsUpdate = true;
        const pmrem = new THREE.PMREMGenerator(renderer);
        let target = null;
        try {
            pmrem.compileEquirectangularShader();
            target = pmrem.fromEquirectangular(source);
        } finally {
            source.dispose();
            pmrem.dispose();
        }
        entry = { target, refs: 0 };
        _probes.set(renderer, entry);
    }
    entry.refs++;
    return entry.target.texture;
}

export function releaseBirdEnvironment(renderer) {
    const entry = _probes.get(renderer);
    if (!entry) return false;
    entry.refs--;
    if (entry.refs > 0) return false;
    entry.target.dispose();
    _probes.delete(renderer);
    return true;
}

export function birdEnvironmentRefs(renderer) {
    const entry = _probes.get(renderer);
    return entry ? entry.refs : 0;
}
