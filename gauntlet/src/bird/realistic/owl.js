/**
 * realistic/owl.js — Tock, a tawny owl built as a machined automaton. PURE.
 *
 * Owl first, machine second: the morphology is a tawny owl's — a big round
 * head with no ear tufts, a facial disc around forward-facing eyes, a short
 * hooked bill tucked into the disc, a stocky barrel body, broad rounded wings
 * with only gently slotted primaries, and a short rounded tail. Then every
 * surface is something a workshop would make it from:
 *
 *   - Body and head shells: brushed brass panels (the brushed sheet in
 *     feather-textures.js; effective roughness ~0.5, a thin lacquer, never a
 *     mirror), aged-brass mantle and rear panels, a steel underside, split by
 *     deep oxidised seam grooves and riveted along the seams. Polished brass
 *     is kept for rims, rivets, bezels and the key. The head sits down in a
 *     broad shoulder mantle (no neck gap); the body is pear-shaped.
 *   - The bay: a blackened-steel backing plate under a bezel, and the steel BACK TRAIN from
 *     gears.js — barrel (24), pinion (12), third wheel (16) — with real teeth,
 *     spokes and hubs, meshed at the solved centre distances and phases. They
 *     spin in the vertex shader (aGear/aAxis), so the whole train is part of
 *     the body's draw call.
 *   - The wind-up key: collar, shaft and a two-lobed bow, spinning on its own
 *     shaft (aAxis kind KEY) — winding hard on the rewind, slowly unwinding
 *     otherwise, exactly as the toon owl's did.
 *   - Facial discs: two turned cream-enamel dishes (the same cream on every
 *     tier) with brass rims (the ruff), which
 *     cross in the middle like a real owl's disc halves. Eyes: brass bezel,
 *     amber ENAMEL iris under a clearcoat (the glass), a black pupil, and an
 *     iris aperture of overlapping blued blades. The blink is a steel shutter.
 *   - Wings: layered, engraved metal feather plates (the engraving atlas on
 *     uv1: shaft, barb lines and a border inset from each plate's outline) —
 *     polished steel flight feathers under brass coverts — on a steel spar
 *     with brass knuckles at the shoulder and wrist, and a WING TRAIN
 *     (12 driving 8) on the arm coverts.
 *   - Breast: rows of engraved scale plates, steel and brass alternating.
 *
 * The ALT variant (the clash tint: the player is an owl too) is blued and
 * gunmetal steel with the brass kept for the accents: gears, key, bezels,
 * rims, rivets, knuckles, beak. Blued steel is itself a thin film (an oxide
 * layer), so it is rendered with the physical film, not painted blue.
 */

import {
    LAYOUT_MECH, createMeshData, loft, lathe, ellipsoid, cylinder, featherPlate,
    featherTip, stamp, trs, mul, alignY, applyPoint, triangleCount, smooth,
} from './mesh-kit.js';
import {
    SPIN, OWL_BACK_TRAIN, OWL_WING_TRAIN, solveTrain, gearPrim, backingPrim,
} from './gears.js';
import { ENGRAVE_PLATE_V } from './feather-textures.js';
import { PALETTE } from '../../core/palette.js';

/** The owl's gear module: smaller teeth than gears.js's default, to fit the bay. */
export const OWL_MODULE = 0.0055;

/**
 * Blued steel: a ~70 nm magnetite oxide over steel. Magnetite's index is
 * ~2.4; three's iridescenceIOR is specified over 1.0-2.333, so 2.3 at 72 nm,
 * which lands the same deep blue (hue ~218-226) at every angle.
 */
export const OWL_ALT_FILM = Object.freeze({ ior: 2.3, thickness: 72, baseF0: 0.55, range: Object.freeze([40, 72]) });

export const OWL_RIG = Object.freeze({
    // Low and aft: the head sinks into the shoulder mantle (an owl has no
    // visible neck), its lower contour overlapping the upper breast.
    head: Object.freeze([0, 0.140, -0.29]),
    shoulder: Object.freeze([0.17, 0.10, -0.15]),
    tailZ: 0.27,
    tailLen: 0.26,
    wristX: 0.55,
    wingSpan: 1.27,
});

export const OWL_LOD = Object.freeze({
    high: Object.freeze({
        seams: true, bodySegs: 20, headSegs: 18, discSegs: 14, eyeSegs: 14, blades: 5, rivetSegs: 4,
        seamRivets: 5, discRivets: 4, breast: [2, 4], backGears: 3, perTooth: 4, gearWalls: true,
        wingGears: true, wingGearWalls: false, hubSegs: 8, plateSegs: 4, primaries: 9, secondaries: 7,
        gCoverts: 7, mCoverts: 5, pCoverts: 4, alula: 1, tail: 7, tCoverts: 3, sparSegs: 8,
        knuckle: [8, 5], legSegs: 6, keyLobe: [8, 5], keySegs: 10,
    }),
    mid: Object.freeze({
        seams: true, bodySegs: 16, headSegs: 14, discSegs: 12, eyeSegs: 12, blades: 5, rivetSegs: 4,
        seamRivets: 5, discRivets: 4, breast: [2, 4], backGears: 3, perTooth: 4, gearWalls: true,
        wingGears: true, wingGearWalls: false, hubSegs: 6, plateSegs: 3, primaries: 8, secondaries: 6,
        gCoverts: 6, mCoverts: 3, pCoverts: 3, alula: 1, tail: 7, tCoverts: 2, sparSegs: 6,
        knuckle: [6, 4], legSegs: 5, keyLobe: [6, 4], keySegs: 8,
    }),
    low: Object.freeze({
        seams: false, bodySegs: 12, headSegs: 12, discSegs: 8, eyeSegs: 8, blades: 0, rivetSegs: 4,
        seamRivets: 0, discRivets: 0, breast: [0, 0], backGears: 2, perTooth: 4, gearWalls: false,
        wingGears: false, wingGearWalls: false, hubSegs: 6, plateSegs: 2, primaries: 7, secondaries: 5,
        gCoverts: 4, mCoverts: 0, pCoverts: 2, alula: 1, tail: 5, tCoverts: 1, sparSegs: 5,
        knuckle: [6, 4], legSegs: 4, keyLobe: [6, 4], keySegs: 6,
    }),
});

// aSurf presets: [metalness, roughness, film weight, clearcoat weight].
// Effective roughness is these times the brushed map (~0.85 mean): shells
// ~0.5, steel plates ~0.35-0.4, polished trim ~0.22. Clearcoat is a thin
// lacquer on the shells, not a second mirror.
const S_BRASS = [1, 0.58, 0, 0.10];        // brushed brass shells and coverts
const S_AGED = [1, 0.66, 0, 0.05];         // aged brass/bronze panels
const S_BRASS_POL = [1, 0.26, 0, 0.30];    // rims, rivets, bezels, key: polished
const S_STEEL = [1, 0.44, 0, 0];           // flight plates, spar, legs
const S_GEAR = [1, 0.32, 0, 0];            // steel gears
const S_NICKEL = [1, 0.48, 0, 0.10];
const S_DARK = [0.9, 0.60, 0, 0];          // blackened steel: the gear bay
const S_ENAMEL = [0, 0.06, 0, 1];          // glossy enamel: the glass
const S_DISC = [0, 0.32, 0, 0.5];          // cream enamel facial disc
const S_SEAM = [0.2, 0.80, 0, 0];          // oxidised seam grooves

/** Colours and surfaces for a variant. */
function finish(alt) {
    return {
        shell: alt ? PALETTE.realBluedSteel : PALETTE.realBrass,
        shellSurf: alt ? [1, 0.48, 1, 0.1] : S_BRASS,
        aged: alt ? PALETTE.realGunmetal : PALETTE.realBrassDark,
        agedSurf: alt ? [1, 0.55, 0, 0.05] : S_AGED,
        under: alt ? PALETTE.realGunmetal : PALETTE.realSteel,
        seam: alt ? 0x1a1e26 : PALETTE.realOxide,
        flight: alt ? PALETTE.realGunmetal : PALETTE.realSteel,
        flightSurf: alt ? [1, 0.48, 0, 0] : S_STEEL,
        covert: alt ? 0x5b626b : PALETTE.realBrass,
        covertSurf: alt ? [1, 0.50, 0, 0.1] : S_BRASS,
        disc: alt ? PALETTE.realGunmetal : PALETTE.realOwlDisc,
        discSurf: alt ? [1, 0.44, 0, 0.1] : S_DISC,
        breastA: alt ? PALETTE.realGunmetal : PALETTE.realNickel,
        breastB: alt ? PALETTE.realBluedSteel : PALETTE.realBrassDark,
        breastBSurf: alt ? [1, 0.45, 1, 0.1] : S_AGED,
        brass: PALETTE.realBrass,
        accent: PALETTE.realBrass,
        steel: alt ? PALETTE.realGunmetal : PALETTE.realSteel,
        blade: PALETTE.realBluedSteel,
    };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function rowAt(rows, z) {
    let a = rows[0], b = rows[rows.length - 1];
    for (let i = 0; i < rows.length - 1; i++) {
        const lo = Math.min(rows[i].z, rows[i + 1].z), hi = Math.max(rows[i].z, rows[i + 1].z);
        if (z >= lo && z <= hi) { a = rows[i]; b = rows[i + 1]; break; }
    }
    const t = b.z === a.z ? 0 : Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z)));
    const L = (k) => a[k] + (b[k] - a[k]) * t;
    return { z, y: L('y'), w: L('w'), t: L('t'), b: L('b') };
}

/** Insert seam grooves: three rows per seam, the middle one pinched. */
function withSeams(rows, seams, pinch) {
    const out = rows.map((r) => Object.assign({}, r));
    for (const z of seams) {
        for (const [dz, k] of [[-0.008, 1], [0, pinch], [0.008, 1]]) {
            const r = rowAt(rows, z + dz);
            out.push({ z: z + dz, y: r.y, w: r.w * k, t: r.t * k, b: r.b * k });
        }
    }
    out.sort((p, q) => p.z - q.z);
    return out;
}

function se(c, p) { return Math.sign(c) * Math.pow(Math.abs(c), 2 / p); }

/** Point and outward normal on a loft surface at (z, angle from the top toward +X). */
function surfaceAt(rows, z, a, pTop, pBot) {
    const P = (zz, aa) => {
        const r = rowAt(rows, zz);
        const top = Math.cos(aa) >= 0;
        const p = top ? pTop : pBot;
        return [r.w * se(Math.sin(aa), p), r.y + (top ? r.t : r.b) * se(Math.cos(aa), p), zz];
    };
    const p = P(z, a);
    const pa = P(z, a + 0.01), pz = P(z + 0.005, a);
    const da = [pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]];
    const dz = [pz[0] - p[0], pz[1] - p[1], pz[2] - p[2]];
    let n = [da[1] * dz[2] - da[2] * dz[1], da[2] * dz[0] - da[0] * dz[2], da[0] * dz[1] - da[1] * dz[0]];
    const r = rowAt(rows, z);
    const out = [p[0], p[1] - r.y, 0];
    if (n[0] * out[0] + n[1] * out[1] < 0) n = [-n[0], -n[1], -n[2]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return { p, n: [n[0] / l, n[1] / l, n[2] / l], dz: [dz[0] / 0.005, dz[1] / 0.005, dz[2] / 0.005] };
}

/** Matrix whose +Y is `n` and +Z runs along `along` (orthogonalised), at p. */
function basis(p, n, along) {
    const Y = n;
    let Z = [along[0], along[1], along[2]];
    const d = Z[0] * Y[0] + Z[1] * Y[1] + Z[2] * Y[2];
    Z = [Z[0] - Y[0] * d, Z[1] - Y[1] * d, Z[2] - Y[2] * d];
    const zl = Math.hypot(Z[0], Z[1], Z[2]) || 1;
    Z = [Z[0] / zl, Z[1] / zl, Z[2] / zl];
    const X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
    return [X[0], Y[0], Z[0], p[0], X[1], Y[1], Z[1], p[1], X[2], Y[2], Z[2], p[2]];
}

// Big enough to read as rivets at chase distance, not as noise.
function rivetPrim(segs) {
    return lathe([[0.0105, 0], [0.0080, 0.0050], [0.0001, 0.0068]], segs);
}

/** An engraved plate's uv1: the plate's own (u, v) squeezed into the atlas. */
const plateUV1 = (x, y, z, u, v) => [u, v * ENGRAVE_PLATE_V];

/** A rigid spin carried per vertex: aGear (pivot, ratio) + aAxis (axis, kind). */
function spin(pivot, ratio, axis, kind) {
    return { gear: [pivot[0], pivot[1], pivot[2], ratio], axis: [axis[0], axis[1], axis[2], kind] };
}

/**
 * A gear train laid on a plane: `plane` maps train coordinates (x, z, with
 * +Y the shared axis) into mesh space. Stamps a backing plate + bezel and
 * every gear, each tagged to spin about the plane normal at its ratio.
 */
function stampTrain(md, train, plane, opts) {
    const placed = solveTrain(train, OWL_MODULE).slice(0, opts.count || train.length);
    const axis = [plane[1], plane[5], plane[9]];
    // Backing ellipse around the placed gears.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const g of placed) {
        const r = g.pitchR + OWL_MODULE * 1.6;
        minX = Math.min(minX, g.center[0] - r); maxX = Math.max(maxX, g.center[0] + r);
        minZ = Math.min(minZ, g.center[1] - r); maxZ = Math.max(maxZ, g.center[1] + r);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const rx = (maxX - minX) / 2 + 0.006, rz = (maxZ - minZ) / 2 + 0.006;
    const R = Math.max(rx, rz);
    const ell = mul(plane, trs(cx, 0, cz, 0, 0, 0, rx / R, 1, rz / R));
    stamp(md, backingPrim(R, opts.backSegs || 16), { m: ell, color: PALETTE.realBacking, surf: S_DARK });
    if (opts.bezel) {
        const wall = lathe([[R, -opts.bezel], [R, 0.004], [R - 0.010, 0.006]], opts.backSegs || 16);
        stamp(md, wall, { m: ell, color: opts.bezelColor, surf: S_BRASS_POL });
    }
    const centres = [];
    for (const g of placed) {
        const prim = gearPrim(g.teeth, {
            module: OWL_MODULE, thick: opts.thick, perTooth: opts.perTooth, spokes: g.spokes,
            phi0: g.phi0, hubSegs: opts.hubSegs, walls: opts.walls,
        });
        const m = mul(plane, trs(g.center[0], 0.003, g.center[1]));
        const pivot = applyPoint(m, 0, 0, 0, [0, 0, 0]);
        centres.push({ id: g.id, teeth: g.teeth, ratio: g.ratio, pivot, axis });
        stamp(md, prim, Object.assign({
            m,
            color: g.id === 'pinion' || g.id === 'idler' ? opts.pinionColor : opts.gearColor,
            surf: S_GEAR,
            uvScale: [1, 1],
        }, spin(pivot, g.ratio, axis, SPIN.GEAR)));
    }
    return centres;
}

// ---------------------------------------------------------------------------
// body
// ---------------------------------------------------------------------------

// Pear-shaped: a broad shoulder mantle the head sits down into, the belly
// fuller than the back.
const BODY_BASE = [
    { z: -0.38, y: 0.130, w: 0.160, t: 0.110, b: 0.130 },
    { z: -0.30, y: 0.098, w: 0.205, t: 0.135, b: 0.175 },
    { z: -0.20, y: 0.058, w: 0.225, t: 0.145, b: 0.215 },
    { z: -0.08, y: 0.030, w: 0.230, t: 0.145, b: 0.225 },
    { z: 0.05, y: 0.025, w: 0.210, t: 0.135, b: 0.200 },
    { z: 0.16, y: 0.030, w: 0.170, t: 0.112, b: 0.150 },
    { z: 0.25, y: 0.040, w: 0.115, t: 0.080, b: 0.092 },
    { z: 0.31, y: 0.045, w: 0.065, t: 0.050, b: 0.050 },
];
const BODY_SEAMS = [-0.15, 0.17];
const BODY_PTOP = 3.0, BODY_PBOT = 2.4;
// A deep pinch: the groove has to read as a panel line at chase distance.
const SEAM_PINCH = 0.955;
export const OWL_BODY_ROWS = Object.freeze(withSeams(BODY_BASE, BODY_SEAMS, SEAM_PINCH));

function owlBody(L, F) {
    const md = createMeshData(LAYOUT_MECH, 'bodyMesh');
    // Low drops the seam-groove rows: there is no vertex left at a seam for
    // the groove colour to land on, so they would only cost triangles.
    const rows = L.seams ? OWL_BODY_ROWS : BODY_BASE;
    const shell = loft(rows, L.bodySegs, { pTop: BODY_PTOP, pBot: BODY_PBOT, capEnd: true, uTiles: 6, uvScale: 6 });
    const nearSeam = (z) => BODY_SEAMS.some((s) => Math.abs(z - s) < 0.0045);
    // Panels: the mid (bay) panel brushed brass, the mantle and rear panels
    // aged brass, the underside steel — so the shell reads as assembled
    // plates, not one polished casting.
    const panel = (y, z) => {
        if (nearSeam(z)) return 0;
        const r = rowAt(BODY_BASE, z);
        if (y < r.y - 0.30 * r.b) return 1;
        return z < BODY_SEAMS[0] || z > BODY_SEAMS[1] ? 2 : 3;
    };
    stamp(md, shell, {
        color: (x, y, z) => [F.seam, F.under, F.aged, F.shell][panel(y, z)],
        surf: (x, y, z) => [S_SEAM, F.flightSurf, F.agedSurf, F.shellSurf][panel(y, z)],
    });

    // --- the mechanism bay and the back train -----------------------------
    const bayZ = 0.02;
    const top = rowAt(rows, bayZ);
    const slope = (rowAt(rows, bayZ + 0.05).y + rowAt(rows, bayZ + 0.05).t - (rowAt(rows, bayZ - 0.05).y + rowAt(rows, bayZ - 0.05).t)) / 0.1;
    const tilt = Math.atan(-slope);
    const plane = trs(0, top.y + top.t + 0.002, bayZ, tilt, 0, 0);
    const back = stampTrain(md, OWL_BACK_TRAIN, plane, {
        count: L.backGears, thick: 0.012, perTooth: L.perTooth, hubSegs: L.hubSegs, walls: L.gearWalls,
        bezel: 0.040, bezelColor: F.accent, gearColor: PALETTE.realSteel, pinionColor: PALETTE.realGunmetal,
        backSegs: L.bodySegs,
    });

    // --- the wind-up key, behind the bay (the head now sits where the key
    // used to, down in the mantle) ------------------------------------------
    const kz = 0.225;
    const kr = rowAt(rows, kz);
    const keyBase = [0, kr.y + kr.t - 0.004, kz];
    const keyAxis = [0, 0.85, 0.53];
    const km = alignY(keyBase[0], keyBase[1], keyBase[2], keyAxis[0], keyAxis[1], keyAxis[2]);
    const al = Math.hypot(keyAxis[0], keyAxis[1], keyAxis[2]);
    const kAxis = [keyAxis[0] / al, keyAxis[1] / al, keyAxis[2] / al];
    const keySpin = spin(keyBase, 1, kAxis, SPIN.KEY);
    const keyPart = (prim, local, color, surf) => stamp(md, prim, Object.assign({ m: mul(km, local), color, surf }, keySpin));
    keyPart(cylinder(0.028, 0.024, 0, 0.022, L.keySegs, false, true), trs(0, 0, 0), PALETTE.realBrassDark, S_BRASS_POL);
    keyPart(cylinder(0.011, 0.011, 0.02, 0.15, 6, false, false), trs(0, 0, 0), F.steel, S_STEEL);
    for (let s = -1; s <= 1; s += 2) {
        keyPart(ellipsoid(0.010, 0.046, 0.040, L.keyLobe[0], L.keyLobe[1]), trs(0, 0.180, s * 0.040), F.accent, S_BRASS_POL);
    }
    keyPart(ellipsoid(0.017, 0.017, 0.017, L.keyLobe[0], L.keyLobe[1]), trs(0, 0.152, 0), F.accent, S_BRASS_POL);

    // --- rivets along both seams, over the top half -------------------------
    const rivet = rivetPrim(L.rivetSegs);
    for (const z of BODY_SEAMS) {
        for (let i = 0; i < L.seamRivets; i++) {
            const a = -1.25 + (2.5 * i) / Math.max(1, L.seamRivets - 1);
            const s = surfaceAt(BODY_BASE, z + 0.016, a, BODY_PTOP, BODY_PBOT);
            stamp(md, rivet, { m: alignY(s.p[0], s.p[1], s.p[2], s.n[0], s.n[1], s.n[2]), color: F.accent, surf: S_BRASS_POL });
        }
    }

    // --- breast scale plates -------------------------------------------------
    for (let r = 0; r < L.breast[0]; r++) {
        for (let c = 0; c < L.breast[1]; c++) {
            const a = Math.PI + (c - (L.breast[1] - 1) / 2) * 0.30 + (r % 2) * 0.15;
            const s = surfaceAt(BODY_BASE, -0.30 + 0.085 * r, a, BODY_PTOP, BODY_PBOT);
            const along = [s.dz[0], s.dz[1] - 0.6, s.dz[2]];
            const m = basis([s.p[0] + s.n[0] * 0.003, s.p[1] + s.n[1] * 0.003, s.p[2] + s.n[2] * 0.003], s.n, along);
            const brass = (r + c) % 2 === 1;
            stamp(md, featherPlate({
                len: 0.10, wOut: 0.034, wIn: 0.034, segs: L.plateSegs, cols: 2, tip: 0.95, root: 0.75, bow: 0.004, droop: 0.003,
            }), {
                m, color: brass ? F.breastB : F.breastA, surf: brass ? F.breastBSurf : S_NICKEL, uv1: plateUV1,
            });
        }
    }

    // --- legs: steel tarsi tucked under, talons clenched ---------------------
    for (let s = -1; s <= 1; s += 2) {
        const from = [s * 0.07, -0.165, 0.05], to = [s * 0.062, -0.180, 0.17];
        const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
        const len = Math.hypot(dx, dy, dz);
        stamp(md, cylinder(0.018, 0.014, 0, len, L.legSegs, false, false), {
            m: alignY(from[0], from[1], from[2], dx, dy, dz), color: F.steel, surf: S_STEEL,
        });
        for (let k = 0; k < 4; k++) {
            const a = (k - 1.5) * 0.5;
            const dir = [Math.sin(a) * 0.6 * s, -0.5, k === 0 ? -0.6 : 0.7];
            stamp(md, cylinder(0.0085, 0.0015, 0, 0.05, Math.max(4, L.legSegs - 2), false, false), {
                m: alignY(to[0], to[1], to[2], dir[0], dir[1], dir[2]), color: 0x2a2d33, surf: [1, 0.4, 0, 0],
            });
        }
    }

    // --- tail: short, rounded, engraved steel plates under brass coverts ----
    const n = L.tail;
    for (let i = 0; i < n; i++) {
        const s = n === 1 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);
        stamp(md, featherPlate({
            len: 0.24 - 0.04 * s * s, wOut: 0.034, wIn: 0.034, segs: L.plateSegs, cols: 2, tip: 1.0, root: 0.6,
            bow: -0.006, droop: 0.003, rachis: 0.002,
        }), {
            m: trs(s * 0.05, 0.050 - 0.006 * Math.abs(s) * (n / 2), 0.235, 0.10, s * 0.42, 0),
            color: F.flight, surf: F.flightSurf, uv1: plateUV1,
        });
    }
    for (let i = 0; i < L.tCoverts; i++) {
        const s = L.tCoverts === 1 ? 0 : (i - (L.tCoverts - 1) / 2) / ((L.tCoverts - 1) / 2);
        stamp(md, featherPlate({
            len: 0.15, wOut: 0.038, wIn: 0.038, segs: Math.max(2, L.plateSegs - 1), cols: 2, tip: 1.0, root: 0.6, bow: 0.004,
        }), {
            m: trs(s * 0.04, 0.072, 0.21, 0.12, s * 0.30, 0), color: F.covert, surf: F.covertSurf, uv1: plateUV1,
        });
    }

    return { md, back, keyBase, keyAxis: kAxis, bayCenter: applyPoint(plane, 0, 0, 0, [0, 0, 0]) };
}

// ---------------------------------------------------------------------------
// head
// ---------------------------------------------------------------------------

const HEAD_BASE = [
    { z: 0.17, y: 0.000, w: 0.100, t: 0.090, b: 0.090 },
    { z: 0.12, y: 0.020, w: 0.170, t: 0.150, b: 0.140 },
    { z: 0.05, y: 0.030, w: 0.215, t: 0.185, b: 0.170 },
    { z: -0.02, y: 0.030, w: 0.228, t: 0.190, b: 0.175 },
    { z: -0.08, y: 0.026, w: 0.218, t: 0.178, b: 0.166 },
    { z: -0.13, y: 0.022, w: 0.195, t: 0.160, b: 0.150 },
];
export const OWL_HEAD_ROWS = Object.freeze(withSeams(HEAD_BASE, [0.07], SEAM_PINCH));

const DISC_PROFILE = [
    [0.000, -0.034], [0.040, -0.031], [0.075, -0.022], [0.100, -0.010],
    [0.114, 0.000], [0.122, 0.009], [0.131, 0.002], [0.128, -0.030],
];
export const OWL_EYE = Object.freeze({
    disc: Object.freeze([0.088, 0.032, -0.170]),
    axis: Object.freeze([0.22, 0.05, -1.0]),
});

function owlHead(L, F) {
    const md = createMeshData(LAYOUT_MECH, 'headMesh');
    const shell = loft(L.seams ? OWL_HEAD_ROWS : HEAD_BASE, L.headSegs,
        { pTop: 2.2, pBot: 2.2, capStart: true, capEnd: true, uTiles: 6, uvScale: 6 });
    stamp(md, shell, {
        color: (x, y, z) => (Math.abs(z - 0.07) < 0.0045 ? F.seam : F.shell),
        surf: (x, y, z) => (Math.abs(z - 0.07) < 0.0045 ? S_SEAM : F.shellSurf),
    });

    const anchors = {};
    const rivet = rivetPrim(L.rivetSegs);
    for (let s = -1; s <= 1; s += 2) {
        const c = [s * OWL_EYE.disc[0], OWL_EYE.disc[1], OWL_EYE.disc[2]];
        const a = [s * OWL_EYE.axis[0], OWL_EYE.axis[1], OWL_EYE.axis[2]];
        const al = Math.hypot(a[0], a[1], a[2]);
        const n = [a[0] / al, a[1] / al, a[2] / al];
        const dm = alignY(c[0], c[1], c[2], n[0], n[1], n[2]);
        // Facial disc: a turned dish, rim (the ruff) in brass.
        const dish = lathe(DISC_PROFILE, L.discSegs);
        stamp(md, dish, {
            m: dm,
            color: (x, y, z, u, v, lx, ly, lz) => (Math.hypot(lx, lz) > 0.112 ? F.accent : F.disc),
            surf: (x, y, z, u, v, lx, ly, lz) => (Math.hypot(lx, lz) > 0.112 ? S_BRASS_POL : F.discSurf),
            uvScale: [4, 12],
        });
        for (let i = 0; i < L.discRivets; i++) {
            const ang = (i / L.discRivets) * Math.PI * 2 + 0.3;
            const lp = [Math.sin(ang) * 0.122, 0.010, Math.cos(ang) * 0.122];
            const p = applyPoint(dm, lp[0], lp[1], lp[2], [0, 0, 0]);
            stamp(md, rivet, { m: alignY(p[0], p[1], p[2], n[0], n[1], n[2]), color: F.accent, surf: S_BRASS_POL });
        }
        // Eye, seated in the dish: bezel, enamel iris (the glass), pupil,
        // aperture blades.
        const eyeC = [c[0] - n[0] * 0.012, c[1] - n[1] * 0.012, c[2] - n[2] * 0.012];
        const em = alignY(eyeC[0], eyeC[1], eyeC[2], n[0], n[1], n[2]);
        const bezel = lathe([[0.046, -0.010], [0.053, 0.002], [0.051, 0.012], [0.041, 0.015]], L.eyeSegs);
        stamp(md, bezel, { m: em, color: F.accent, surf: S_BRASS_POL });
        const enamel = lathe([[0.043, 0.006], [0.037, 0.016], [0.023, 0.022], [0.0005, 0.024]], L.eyeSegs);
        stamp(md, enamel, {
            m: em,
            color: (x, y, z, u, v, lx, ly, lz) => (Math.hypot(lx, lz) < 0.013 ? PALETTE.realEnamelPupil : PALETTE.realEnamel),
            surf: S_ENAMEL,
            mask: 1,
        });
        for (let j = 0; j < L.blades; j++) {
            const b = (j / L.blades) * Math.PI * 2;
            const r0 = 0.0125;
            const local = trs(Math.sin(b) * r0, 0.0215, Math.cos(b) * r0, 0.16, b + 0.75, 0);
            stamp(md, featherPlate({
                len: 0.018, wOut: 0.0042, wIn: 0.0058, segs: 2, cols: 2, tip: 0.4, root: 0.9, bow: 0.0015,
            }), { m: mul(em, local), color: F.blade, surf: [1, 0.22, 0.9, 0.4], mask: 1 });
        }
        const side = s < 0 ? 'left' : 'right';
        anchors[side + 'Eye'] = eyeC;
        anchors[side + 'Pupil'] = [eyeC[0] + n[0] * 0.024, eyeC[1] + n[1] * 0.024, eyeC[2] + n[2] * 0.024];
    }

    // The bill: short, hooked, copper, tucked between the discs.
    const by = -0.030;
    const beak = [
        [-0.150, 0.030, -0.025, 0.026], [-0.185, 0.024, -0.028, 0.021], [-0.212, 0.010, -0.036, 0.015],
        [-0.228, -0.012, -0.050, 0.009], [-0.232, -0.038, -0.064, 0.003],
    ].map(([z, t, b, w]) => ({ z, y: by + (t + b) / 2, w, t: (t - b) / 2, b: (t - b) / 2 }));
    stamp(md, loft(beak, 10, { pTop: 1.6, pBot: 3.0, uvScale: 6 }), { color: PALETTE.realCopper, surf: [1, 0.30, 0, 0.6] });
    anchors.beak = [0, by - 0.05, -0.232];
    return { md, anchors };
}

// ---------------------------------------------------------------------------
// wing (RIGHT; mirrored by the adapter)
// ---------------------------------------------------------------------------

const OWL_PRIMARY_LEN = [0.42, 0.44, 0.47, 0.50, 0.53, 0.56, 0.58, 0.57, 0.50];

function owlPrimaryHeading(idx) {
    return 0.30 + 1.05 * Math.pow(idx / 8, 0.95);
}

function owlWing(L, F) {
    const md = createMeshData(LAYOUT_MECH, 'rightWingMesh');
    const WX = OWL_RIG.wristX;
    const ARM = [0, 0, 0, 0];
    const HAND = (px, pz, sp) => [1, sp || 0, px, pz];
    const plateAt = (opts, at, rot, color, surf, def) => {
        const m = trs(at[0], at[1], at[2], rot[0], rot[1], rot[2]);
        stamp(md, featherPlate(opts), { m, color, surf, def, uv1: plateUV1 });
        return m;
    };

    // --- spar: a steel tube along the leading edge, brass knuckles ----------
    const spar = [
        { s: 0.00, cz: -0.030, y: 0.012, r: 0.026 },
        { s: 0.20, cz: -0.045, y: 0.012, r: 0.020 },
        { s: 0.40, cz: -0.055, y: 0.010, r: 0.017 },
        { s: WX, cz: -0.062, y: 0.008, r: 0.016 },
        { s: WX + 0.12, cz: -0.060, y: 0.004, r: 0.012 },
        { s: WX + 0.22, cz: -0.058, y: 0.000, r: 0.008 },
    ].map((r) => ({ z: r.s, y: r.y, x: -r.cz, w: r.r, t: r.r, b: r.r }));
    stamp(md, loft(spar, L.sparSegs, { capEnd: true, uTiles: 1 }), {
        m: trs(0, 0, 0, 0, Math.PI / 2, 0),
        color: F.steel, surf: S_STEEL,
        def: (x) => [smooth(WX - 0.04, WX + 0.02, x), 0, 0, 0],
        uvScale: [1, 6],
    });
    stamp(md, ellipsoid(0.032, 0.026, 0.032, L.knuckle[0], L.knuckle[1]), {
        m: trs(WX, 0.008, -0.062), color: F.accent, surf: S_BRASS_POL, def: [0.5, 0, 0, 0],
    });
    stamp(md, ellipsoid(0.040, 0.034, 0.040, L.knuckle[0], L.knuckle[1]), {
        m: trs(0.0, 0.012, -0.030), color: F.accent, surf: S_BRASS_POL, def: ARM,
    });

    // --- secondaries: broad, round-tipped steel plates -----------------------
    const nS = L.secondaries;
    for (let i = 0; i < nS; i++) {
        const t = nS === 1 ? 1 : i / (nS - 1);
        plateAt({
            len: 0.40 + 0.02 * Math.sin(Math.PI * t), wOut: 0.056, wIn: 0.040, segs: L.plateSegs, cols: 2,
            tip: 1.0, root: 0.6, bow: -0.012, droop: 0.004, rachis: 0.002, twist: -0.04 * t,
        }, [0.06 + t * (WX - 0.08), 0.004 + 0.0035 * (nS - 1 - i), -0.020 - 0.025 * t], [0.05, -0.08 + 0.24 * t, 0],
        F.flight, F.flightSurf, ARM);
    }
    // --- greater coverts (brass) --------------------------------------------
    for (let i = 0; i < L.gCoverts; i++) {
        const t = L.gCoverts === 1 ? 1 : i / (L.gCoverts - 1);
        plateAt({
            len: 0.22 - 0.02 * t, wOut: 0.046, wIn: 0.040, segs: Math.max(2, L.plateSegs - 1), cols: 2,
            tip: 1.0, root: 0.65, bow: -0.006, droop: 0.003, rachis: 0.002,
        }, [0.07 + t * (WX - 0.10), 0.020 + 0.0025 * (L.gCoverts - 1 - i), -0.048 - 0.02 * t], [0.10, -0.06 + 0.22 * t, 0],
        F.covert, F.covertSurf, ARM);
    }
    // --- median coverts (brass) ----------------------------------------------
    for (let i = 0; i < L.mCoverts; i++) {
        const t = L.mCoverts === 1 ? 1 : i / (L.mCoverts - 1);
        plateAt({
            len: 0.13, wOut: 0.036, wIn: 0.032, segs: 2, cols: 2, tip: 1.0, root: 0.7, bow: -0.003, droop: 0.002,
        }, [0.08 + t * (WX - 0.16), 0.034, -0.062 - 0.012 * t], [0.16, -0.04 + 0.18 * t, 0], F.covert, F.covertSurf, ARM);
    }

    // --- primaries: rounded tip, outer four gently slotted -------------------
    const nP = L.primaries;
    const h0 = [WX, -0.002, -0.040], h1 = [WX + 0.21, -0.006, -0.060];
    let tip = [0, 0, 0];
    for (let j = 0; j < nP; j++) {
        const idx = 9 - nP + j;
        const t = idx / 8;
        const at = [h0[0] + (h1[0] - h0[0]) * t, h0[1] + (h1[1] - h0[1]) * t - 0.003 * idx, h0[2] + (h1[2] - h0[2]) * t];
        const slotted = idx >= 5;
        const opts = {
            len: OWL_PRIMARY_LEN[idx], wOut: 0.050 - 0.010 * t, wIn: 0.024 - 0.004 * t, segs: L.plateSegs + 1, cols: 2,
            tip: 0.85, root: 0.55, bow: -0.010, droop: 0.003, rachis: 0.002, twist: -0.08, curve: 0.02,
            emarg: slotted ? { at: 0.60, neg: 0.25, pos: 0.40 } : null,
        };
        // Metal does not splay like keratin: a quarter of the crow's spread.
        const m = plateAt(opts, at, [0.02, owlPrimaryHeading(idx), 0], F.flight, F.flightSurf,
            HAND(at[0], at[2], slotted ? (idx - 6.5) * 0.05 : 0));
        const p = applyPoint(m, ...featherTip(opts), [0, 0, 0]);
        if (p[0] > tip[0]) tip = p;
    }
    for (let j = 0; j < L.pCoverts; j++) {
        const t = L.pCoverts === 1 ? 0.5 : j / (L.pCoverts - 1);
        const idx = t * 7;
        const at = [h0[0] + (h1[0] - h0[0]) * (idx / 8) - 0.01, 0.014, h0[2] + (h1[2] - h0[2]) * (idx / 8) - 0.022];
        plateAt({
            len: 0.17 - 0.03 * t, wOut: 0.032, wIn: 0.020, segs: 2, cols: 2, tip: 1.0, root: 0.6, bow: -0.004,
        }, at, [0.06, owlPrimaryHeading(idx), 0], F.covert, F.covertSurf, HAND(at[0], at[2], 0));
    }
    for (let j = 0; j < L.alula; j++) {
        const at = [WX + 0.008 * j, 0.022, -0.082];
        plateAt({ len: 0.12, wOut: 0.018, wIn: 0.012, segs: 2, cols: 2, tip: 0.9, root: 0.7, bow: 0.003 },
            at, [0, 1.70 + 0.12 * j, 0], F.covert, F.covertSurf, HAND(at[0], at[2], 0));
    }

    // --- the wing train, on the arm coverts ----------------------------------
    let wingGears = [];
    if (L.wingGears) {
        const plane = trs(0.25, 0.046, 0.045, 0.08, 0, 0);
        wingGears = stampTrain(md, OWL_WING_TRAIN, plane, {
            thick: 0.010, perTooth: L.perTooth, hubSegs: L.hubSegs, walls: L.wingGearWalls,
            bezel: 0, gearColor: PALETTE.realBrass, pinionColor: PALETTE.realSteel, backSegs: 12,
        });
    }
    return { md, tip, wingGears };
}

// ---------------------------------------------------------------------------
// the whole bird
// ---------------------------------------------------------------------------

export function buildOwl(o = {}) {
    const quality = OWL_LOD[o.quality] ? o.quality : 'high';
    const L = OWL_LOD[quality];
    const alt = o.variant === 'alt';
    const F = finish(alt);
    const body = owlBody(L, F);
    const head = owlHead(L, F);
    const wing = owlWing(L, F);
    const meshes = [
        { name: 'bodyMesh', part: 'body', material: 'metal', role: 'body', data: body.md },
        { name: 'headMesh', part: 'head', material: 'metal', role: 'head', data: head.md },
        { name: 'rightWingMesh', part: 'rightWing', material: 'metalWing', role: 'wing', side: 1, data: wing.md },
    ];
    let triangles = 0;
    for (const m of meshes) triangles += triangleCount(m.data);
    triangles += triangleCount(wing.md);
    return {
        species: 'clockwork-owl',
        quality,
        variant: alt ? 'alt' : 'normal',
        meshes,
        rig: OWL_RIG,
        anchors: {
            head: head.anchors,
            body: {
                leftFoot: [-0.062, -0.180, 0.17], rightFoot: [0.062, -0.180, 0.17],
                tail: [0, 0.05, OWL_RIG.tailZ],
            },
            wingTip: wing.tip,
        },
        mech: {
            keyBase: body.keyBase, keyAxis: body.keyAxis, bayCenter: body.bayCenter,
            backTrain: body.back, wingTrain: wing.wingGears,
        },
        eye: { lid: PALETTE.realShutter },
        film: alt ? OWL_ALT_FILM : null,
        drawCalls: meshes.length + 1,
        triangles,
    };
}
