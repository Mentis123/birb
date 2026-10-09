/**
 * realistic/feather-textures.js — every texel the realistic birds sample,
 * generated in code.
 *
 * Gauntlet ships zero external assets (ARCHITECTURE.md rule 2), so where Birb
 * Mobile's v3 bird decodes two authored sheets (assets/textures/
 * feather_{contour,vane}_{albedo,normal}.png, applied by authored-textures.js
 * `applyAuthoredFeathers` / `installFeatherDetail`), the realistic crow and owl
 * synthesise theirs here, once per page, and every bird shares them.
 *
 * Four patterns, each an albedo DETAIL map (a linear multiplier over the
 * vertex colour — installFeatherDetail's idea, done with three's own
 * `diffuseColor *= map` because the data is generated linear), a tangent-space
 * normal map, and a roughness multiplier (G channel, three's roughnessMap
 * convention):
 *
 *   contour   shingled body feathers, tiling. The feather rooted nearer the
 *             head lies on top, so height is a sawtooth that climbs to each
 *             tip and drops onto the row beneath, and there is a contact
 *             shadow just past every overlying edge.
 *   vane      one flight feather, u across (0 outer edge, 0.5 rachis, 1 inner
 *             edge), v root to tip. Barbs leave the rachis toward the tip on
 *             BOTH sides — the chevron mirrors across the shaft, which is why
 *             the realistic birds give every feather its own UV frame — with a
 *             few seeded zipper splits where barbs have pulled apart, and a
 *             worn fringe at the edges.
 *   brushed   machined metal: grooves along u (stretched highlights, the cheap
 *             stand-in for anisotropy), streaky roughness, a few scratches.
 *   engrave   the owl's plate engraving atlas, sampled on uv1: engraved shaft,
 *             barb lines and a border inset from each plate's own outline,
 *             darkened as oxidised engraving is. v above ENGRAVE_BLANK_V is
 *             blank, for every vertex that is not a plate.
 *
 * The `*Data` functions are PURE (typed arrays only, seeded RNG) so the tests
 * can inspect them; `acquireFeatherTextures` is the only THREE in the file.
 */

import { makeRng } from '../../core/rng.js';

export const TEXTURE_SIZES = Object.freeze({
    contour: [128, 128],
    vane: [128, 256],
    brushed: [128, 128],
    engrave: [128, 256],
});

/** uv1.v at and above this is blank in the engraving atlas. */
export const ENGRAVE_BLANK_V = 0.93;
/** The fraction of the engraving atlas a plate's 0..1 length maps into. */
export const ENGRAVE_PLATE_V = 0.90;

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function smooth(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
function fract(x) { return x - Math.floor(x); }

/**
 * Periodic 2D value noise with integer periods (pu, pv), so a tile built
 * from it wraps seamlessly.
 */
function makePeriodicNoise(seed, pu, pv) {
    const rng = makeRng(seed);
    const lat = new Float32Array(pu * pv);
    for (let i = 0; i < lat.length; i++) lat[i] = rng();
    return function noise(u, v) {
        const x = u * pu, y = v * pv;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const i0 = ((x0 % pu) + pu) % pu, i1 = (i0 + 1) % pu;
        const j0 = ((y0 % pv) + pv) % pv, j1 = (j0 + 1) % pv;
        const a = lat[j0 * pu + i0], b = lat[j0 * pu + i1];
        const c = lat[j1 * pu + i0], d = lat[j1 * pu + i1];
        return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    };
}

/**
 * Height field -> tangent-space normal map (RGBA8, +X = +u, +Y = +v, the
 * convention three's derivative TBN reads with flipY off). Central
 * differences, wrapped or clamped per axis.
 */
export function heightToNormal(h, w, hh, strength, wrap) {
    const out = new Uint8Array(w * hh * 4);
    const at = (x, y) => {
        if (wrap) { x = (x + w) % w; y = (y + hh) % hh; } else {
            x = x < 0 ? 0 : (x >= w ? w - 1 : x);
            y = y < 0 ? 0 : (y >= hh ? hh - 1 : y);
        }
        return h[y * w + x];
    };
    for (let y = 0; y < hh; y++) {
        for (let x = 0; x < w; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
            const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
            let nx = -dx, ny = -dy, nz = 1;
            const l = Math.hypot(nx, ny, nz);
            nx /= l; ny /= l; nz /= l;
            const o = (y * w + x) * 4;
            out[o] = Math.round((nx * 0.5 + 0.5) * 255);
            out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            out[o + 3] = 255;
        }
    }
    return out;
}

function greyRGBA(values, w, h) {
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const v = Math.round(clamp01(values[i]) * 255);
        out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    return out;
}

/** Roughness multiplier in G (three's roughnessMap channel), R/B neutral. */
function roughRGBA(values, w, h) {
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        out[i * 4] = 255;
        out[i * 4 + 1] = Math.round(clamp01(values[i]) * 255);
        out[i * 4 + 2] = 255;
        out[i * 4 + 3] = 255;
    }
    return out;
}

// ---------------------------------------------------------------------------
// contour: shingled body feathers (tiling)
// ---------------------------------------------------------------------------

export function contourTileData(w = 128, hh = 128, seed = 0xC0A7) {
    const ROWS = 8, COLS = 5;
    const dv = 1 / ROWS;
    const len = dv * 1.9;            // each feather reaches ~2 rows: they shingle
    const hw = 0.66 / COLS;          // and overlap side by side
    const rng = makeRng(seed);
    const tint = new Float32Array(ROWS * COLS);
    for (let i = 0; i < tint.length; i++) tint[i] = 0.95 + rng() * 0.08;

    const height = new Float32Array(w * hh);
    const albedo = new Float32Array(w * hh);
    const rough = new Float32Array(w * hh);
    // q < 1 inside a feather's outline: a straight-sided body that rounds
    // over the last 45% of its length into the tip.
    const qOf = (du, along) => {
        if (along < 0) return 99;
        const tipK = along > 0.55 ? (along - 0.55) / 0.45 : 0;
        return Math.sqrt((du / hw) * (du / hw) + tipK * tipK);
    };
    for (let y = 0; y < hh; y++) {
        const v = (y + 0.5) / hh;
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            let best = null;
            let shadowQ = 99;
            // Candidate feathers: rows rooted up to `len` before this texel.
            const rFirst = Math.floor(v / dv) - 2;
            for (let r = rFirst; r <= rFirst + 2; r++) {
                const v0 = r * dv;
                const along = (v - v0) / len;
                const off = (((r % 2) + 2) % 2) * 0.5;
                for (let c = -1; c <= COLS; c++) {
                    const cu = (c + off + 0.5) / COLS;
                    let du = u - cu;
                    du -= Math.round(du);         // wrap across the tile
                    const q = qOf(du, along);
                    if (q < 1) {
                        // Shingling: the feather rooted nearer the head (lower v0) is on top.
                        if (!best || v0 < best.v0) best = { v0, along, du, q, r, c };
                    }
                }
            }
            if (!best) { height[y * w + x] = 0; albedo[y * w + x] = 0.7; rough[y * w + x] = 1; continue; }
            // Contact shadow: just outside the tip edge of a feather lying ABOVE this one.
            for (let r = Math.floor(best.v0 / dv + 1e-6) - 2; r < Math.round(best.v0 / dv); r++) {
                const v0 = r * dv;
                const along = (v - v0) / len;
                const off = (((r % 2) + 2) % 2) * 0.5;
                for (let c = -1; c <= COLS; c++) {
                    let du = u - (c + off + 0.5) / COLS;
                    du -= Math.round(du);
                    shadowQ = Math.min(shadowQ, qOf(du, along));
                }
            }
            const { along, du, q } = best;
            const cross = 1 - (du / hw) * (du / hw);
            const rachis = Math.exp(-(du / 0.010) * (du / 0.010));
            const barbs = 0.5 + 0.5 * Math.cos(Math.PI * 2 * ((v - best.v0) * 46 - Math.abs(du) * 30));
            height[y * w + x] = 0.25 + 0.55 * along + 0.18 * cross + 0.05 * rachis + 0.03 * barbs;
            const shadow = 1 - 0.30 * (1 - smooth(1.0, 1.22, shadowQ));
            const fringe = smooth(0.80, 1.0, q);
            const ti = (((best.r % ROWS) + ROWS) % ROWS) * COLS + (((best.c % COLS) + COLS) % COLS);
            albedo[y * w + x] = (0.86 + 0.06 * barbs + 0.06 * fringe) * tint[ti] * shadow;
            rough[y * w + x] = 0.82 + 0.18 * fringe - 0.10 * rachis;
        }
    }
    return {
        width: w, height: hh,
        albedo: greyRGBA(albedo, w, hh),
        normal: heightToNormal(height, w, hh, 7.0, true),
        surf: roughRGBA(rough, w, hh),
    };
}

// ---------------------------------------------------------------------------
// vane: one flight feather (per-feather UV)
// ---------------------------------------------------------------------------

export function vaneTileData(w = 128, hh = 256, seed = 0x7A4E) {
    const rng = makeRng(seed);
    // Zipper splits: where barbs have pulled apart, a gap runs in along the
    // barb from the vane edge.
    const splits = [];
    for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < 4; i++) {
            splits.push({ side: s, v: 0.18 + rng() * 0.66, depth: 0.25 + rng() * 0.6, width: 0.004 + rng() * 0.004 });
        }
    }
    const BARBS = 72;
    const SLOPE = 0.95;
    const height = new Float32Array(w * hh);
    const albedo = new Float32Array(w * hh);
    const rough = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) {
        const v = (y + 0.5) / hh;
        const rw = 0.004 + 0.020 * (1 - v * 0.75);
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            const s = u - 0.5;
            const a = Math.abs(s);
            const side = s < 0 ? -1 : 1;
            const i = y * w + x;
            if (a < rw) {
                const k = a / rw;
                height[i] = 0.9 * (1 - k * k) + 0.25;
                albedo[i] = 0.97;
                rough[i] = 0.55;
                continue;
            }
            // Barb coordinate: constant along a barb, which runs out from the
            // shaft toward the tip on this side (the mirrored chevron).
            const b = (v - (a - rw) * SLOPE) * BARBS;
            const ridge = 0.5 + 0.5 * Math.cos(Math.PI * 2 * b);
            let hgt = 0.18 + 0.22 * Math.pow(ridge, 1.6);
            let alb = 0.82 + 0.07 * ridge;
            let rgh = 0.80 + 0.15 * (1 - ridge);
            for (const sp of splits) {
                if (sp.side !== side) continue;
                const d = Math.abs((v - (a - rw) * SLOPE) - (sp.v - (0.5 - rw) * SLOPE));
                const reach = (a - (0.5 - sp.depth * 0.5)) / (sp.depth * 0.5);
                if (reach > 0 && d < sp.width) {
                    const g = (1 - d / sp.width) * smooth(0, 0.3, reach);
                    hgt -= 0.30 * g; alb -= 0.20 * g; rgh += 0.15 * g;
                }
            }
            // Worn fringe at the vane edge.
            const edge = smooth(0.43, 0.5, a);
            alb += 0.07 * edge; rgh += 0.08 * edge; hgt -= 0.08 * edge;
            height[i] = hgt; albedo[i] = alb; rough[i] = rgh;
        }
    }
    return {
        width: w, height: hh,
        albedo: greyRGBA(albedo, w, hh),
        normal: heightToNormal(height, w, hh, 5.0, false),
        surf: roughRGBA(rough, w, hh),
    };
}

// ---------------------------------------------------------------------------
// brushed: machined metal (tiling)
// ---------------------------------------------------------------------------

export function brushedTileData(w = 128, hh = 128, seed = 0xB2A5) {
    const fine = makePeriodicNoise(seed, 3, 96);
    const coarse = makePeriodicNoise(seed ^ 0x55, 2, 24);
    const rng = makeRng(seed ^ 0xA11);
    const scratches = [];
    for (let i = 0; i < 7; i++) scratches.push({ v: rng(), slope: (rng() - 0.5) * 0.08, w: 0.0025 + rng() * 0.003 });
    const height = new Float32Array(w * hh);
    const albedo = new Float32Array(w * hh);
    const rough = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) {
        const v = (y + 0.5) / hh;
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            const n = fine(u, v) * 0.65 + coarse(u, v) * 0.35;
            let hgt = n;
            let alb = 0.90 + 0.10 * n;
            // Brushing that reads at distance: fine and broad bands that run
            // along u (functions of v only), over a little isotropic grain.
            let rgh = 0.64 + 0.10 * fine(u + 0.37, v) + 0.14 * fine(0.29, v) + 0.12 * coarse(0.11, v);
            for (const s of scratches) {
                let d = v - (s.v + s.slope * u);
                d -= Math.round(d);
                const g = Math.max(0, 1 - Math.abs(d) / s.w);
                hgt -= 0.5 * g; alb += 0.08 * g; rgh -= 0.25 * g;
            }
            const i = y * w + x;
            height[i] = hgt; albedo[i] = alb; rough[i] = rgh;
        }
    }
    return {
        width: w, height: hh,
        albedo: greyRGBA(albedo, w, hh),
        normal: heightToNormal(height, w, hh, 1.6, true),
        surf: roughRGBA(rough, w, hh),
    };
}

// ---------------------------------------------------------------------------
// engrave: the owl's plate engraving (uv1 atlas)
// ---------------------------------------------------------------------------

export function engraveAtlasData(w = 128, hh = 256) {
    const albedo = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) {
        const v = (y + 0.5) / hh;
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            const i = y * w + x;
            if (v >= ENGRAVE_BLANK_V - 0.01) { albedo[i] = 1; continue; }
            const tv = Math.min(1, v / ENGRAVE_PLATE_V);
            const a = Math.abs(u - 0.5);
            let g = 1;
            // Shaft: a deep cut, slightly wider at the root.
            const shaft = 0.010 + 0.006 * (1 - tv);
            if (a < shaft) g = Math.min(g, 0.40);
            // Barb lines, running out from the shaft toward the tip.
            if (a > 0.03 && a < 0.415) {
                const ph = fract((tv - a * 1.15) * 15);
                if (ph < 0.09) g = Math.min(g, 0.62);
            }
            // Border, inset from the plate's own outline (u is across the
            // plate at every row, so this follows the tip's curve too).
            if (a > 0.432 && a < 0.452) g = Math.min(g, 0.56);
            if (tv < 0.035 && a < 0.452) g = Math.min(g, 0.56);
            // A little burnish at the very edge, where wear polishes engraving.
            if (a > 0.47) g = Math.max(g, 1);
            albedo[i] = g;
        }
    }
    return { width: w, height: hh, albedo: greyRGBA(albedo, w, hh) };
}

// ---------------------------------------------------------------------------
// THREE adapter: built once per page, shared by every bird, refcounted.
// ---------------------------------------------------------------------------

const _shared = new WeakMap();

function dataTexture(THREE, data, w, h, wrap, anisotropy) {
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
}

/**
 * The shared texture set for this THREE. First call builds it (a few tens of
 * milliseconds of pure JS, once); every call adds a reference that
 * `releaseFeatherTextures` gives back. The last release disposes the GPU side.
 */
export function acquireFeatherTextures(THREE) {
    let entry = _shared.get(THREE);
    if (!entry) {
        const R = THREE.RepeatWrapping, C = THREE.ClampToEdgeWrapping;
        const [cw, ch] = TEXTURE_SIZES.contour;
        const [vw, vh] = TEXTURE_SIZES.vane;
        const [bw, bh] = TEXTURE_SIZES.brushed;
        const [ew, eh] = TEXTURE_SIZES.engrave;
        const contour = contourTileData(cw, ch);
        const vane = vaneTileData(vw, vh);
        const brushed = brushedTileData(bw, bh);
        const engrave = engraveAtlasData(ew, eh);
        const set = {
            contour: {
                map: dataTexture(THREE, contour.albedo, cw, ch, R, 4),
                normal: dataTexture(THREE, contour.normal, cw, ch, R, 4),
                surf: dataTexture(THREE, contour.surf, cw, ch, R, 4),
            },
            vane: {
                map: dataTexture(THREE, vane.albedo, vw, vh, C, 8),
                normal: dataTexture(THREE, vane.normal, vw, vh, C, 8),
                surf: dataTexture(THREE, vane.surf, vw, vh, C, 8),
            },
            brushed: {
                map: dataTexture(THREE, brushed.albedo, bw, bh, R, 8),
                normal: dataTexture(THREE, brushed.normal, bw, bh, R, 8),
                surf: dataTexture(THREE, brushed.surf, bw, bh, R, 8),
            },
            engrave: dataTexture(THREE, engrave.albedo, ew, eh, C, 8),
        };
        // The engraving rides the second UV set so the brushed grain can tile
        // on the first.
        set.engrave.channel = 1;
        entry = { set, refs: 0 };
        _shared.set(THREE, entry);
    }
    entry.refs++;
    return entry.set;
}

/** Every texture in a set, flat — for disposal and for the tests. */
export function texturesOf(set) {
    return [
        set.contour.map, set.contour.normal, set.contour.surf,
        set.vane.map, set.vane.normal, set.vane.surf,
        set.brushed.map, set.brushed.normal, set.brushed.surf,
        set.engrave,
    ];
}

export function releaseFeatherTextures(THREE) {
    const entry = _shared.get(THREE);
    if (!entry) return false;
    entry.refs--;
    if (entry.refs > 0) return false;
    const all = texturesOf(entry.set);
    for (let i = 0; i < all.length; i++) all[i].dispose();
    _shared.delete(THREE);
    return true;
}

/** Live reference count, for the tests and the debug hook. */
export function featherTextureRefs(THREE) {
    const entry = _shared.get(THREE);
    return entry ? entry.refs : 0;
}
