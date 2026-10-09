// PORTED from Birb Gauntlet (gauntlet/src/bird/realistic/crow.js) for the root
// game's bird picker. Gauntlet stays airtight: this is a copy, not an import.
// Root-game adaptations are marked "ROOT:".
/**
 * realistic/crow.js — Corvus, built as a real carrion/American crow. PURE.
 *
 * Returns MeshData (mesh-kit.js) plus the rig numbers the THREE adapter needs.
 * No THREE here, so the tests measure the exact mesh the game uploads.
 *
 * The morphology, and where each line of it lives:
 *
 *   - BODY: deep-keeled (deeper below than above), widest a third back from
 *     the throat, a SHORT neck as thick as the head, which sits almost
 *     straight onto the shoulders, and a taper to a short rump. Flattened
 *     back (pTop) over a rounded belly. Scapulars lie over the wing roots so
 *     the joint reads as feathers, not as a plank stuck into an egg.
 *   - HEAD: flat crown (superellipse top), steep forehead, and THE BILL: heavy,
 *     deep at the base, an arched culmen, a slight hook, a flat-cut tomium and
 *     a gonys keel underneath. Nasal bristles (stiff forward-pointing feather
 *     plates) cover the base of the culmen the way a crow's do. Dark brown
 *     iris, lateral eyes; the blink is the nictitating membrane, pale blue-grey,
 *     sweeping the eye (a colour, not a squash).
 *   - WINGS: long and broad (each 1.31 from the shoulder; aspect ratio ~5.5,
 *     inside a crow's), built from overlapping feather plates — tertials,
 *     secondaries, greater/median coverts, a leading-edge band of lesser and
 *     marginal coverts, alula, primary coverts and TEN primaries whose outer
 *     six are emarginated into fingers with open slots between them. The hand
 *     (everything past the wrist) carries aDef.x = 1 so the shader can lag it
 *     at the wrist; the outer primaries carry a splay factor so they fan apart
 *     on the downstroke.
 *   - TAIL: twelve rectrices, central pair longest and on top (a rounded fan),
 *     with upper- and undertail coverts. Fanned and steered by the same tail
 *     deformer the toon birds use.
 *   - LEGS: black, tucked back under the belly with the toes clenched.
 *
 * Plumage: blue-black everywhere, with the structural gloss carried by aSurf.z
 * (the film weight): strongest on the wings and tail, then the mantle, least
 * on the belly. The HOODED variant (the clash tint: the player is a crow too)
 * is a hooded crow — ash-grey mantle, back and underparts with no gloss, and a
 * black hood, bib, wings and tail.
 */

import {
    LAYOUT_FEATHER, createMeshData, loft, ellipsoid, cylinder, featherPlate, featherTip,
    stamp, trs, alignY, applyPoint, triangleCount, smooth, mixLin,
} from './mesh-kit.js';
import { PALETTE } from './species-palette.js';
import { makeRng } from './species-palette.js';

/**
 * The crow's thin film. A corvid's gloss is melanin (n ~ 2.0) layered in the
 * keratin of the barbules; three's Belcour-Barla film over a keratin base at
 * specularIntensity 0.5 (F0 0.024, the same base Birb Mobile's plumage uses).
 * At 300 nm: blue face-on (hue ~196), blue-violet at the chase camera's mid
 * angles (~272), purple toward grazing (~317) — never the teal-green a
 * thicker film gives face-on. The gloss is RESTRAINED: the film weights in
 * aSurf.z are 0.10-0.20 on the dorsal vanes, ~0.03-0.08 on the mantle and
 * nothing below, and the shader gates it to upward-facing surfaces, so the
 * bird reads near-black with a blue-violet sheen, not a mallard.
 */
export const CROW_FILM = Object.freeze({ ior: 2.0, thickness: 300, baseF0: 0.024, range: Object.freeze([120, 300]) });

/** Body-space rig: where the head and wings hang, and the deformer constants. */
export const CROW_RIG = Object.freeze({
    // The head sits on the shoulders: a crow in flight has almost no neck.
    head: Object.freeze([0, 0.180, -0.42]),
    shoulder: Object.freeze([0.115, 0.075, -0.13]),
    tailZ: 0.40,
    tailLen: 0.52,
    wristX: 0.60,
    wingSpan: 1.31,
});

/** Detail per quality tier. Counts are feathers; segs are rows/rings. */
export const CROW_LOD = Object.freeze({
    high: Object.freeze({
        bodySegs: 22, headSegs: 18, eye: [12, 8], billSegs: 12, plateSegs: 5, plateCols: 4,
        primaries: 10, secondaries: 9, gCoverts: 9, mCoverts: 7, tertials: 3, pCoverts: 7, alula: 3,
        bandSegs: 8, tail: 12, uCoverts: 5, lCoverts: 4, bristles: 5, scapulars: 2, legSegs: 6, mergeTail: false,
    }),
    mid: Object.freeze({
        bodySegs: 18, headSegs: 14, eye: [10, 6], billSegs: 10, plateSegs: 4, plateCols: 2,
        primaries: 10, secondaries: 8, gCoverts: 8, mCoverts: 5, tertials: 2, pCoverts: 6, alula: 2,
        bandSegs: 6, tail: 12, uCoverts: 4, lCoverts: 3, bristles: 4, scapulars: 2, legSegs: 5, mergeTail: false,
    }),
    low: Object.freeze({
        bodySegs: 12, headSegs: 10, eye: [8, 5], billSegs: 8, plateSegs: 3, plateCols: 2,
        primaries: 7, secondaries: 6, gCoverts: 5, mCoverts: 0, tertials: 1, pCoverts: 4, alula: 1,
        bandSegs: 5, tail: 8, uCoverts: 2, lCoverts: 0, bristles: 2, scapulars: 1, legSegs: 4, mergeTail: true,
    }),
});

// Contour-feather tile density: one tile of the contour sheet (8 rows x 5
// columns of feathers) per ~0.24 units on the body and ~0.15 on the head.
const BODY_TILE = 1 / 0.24;
const HEAD_TILE = 1 / 0.15;

// aSurf presets: [metalness, roughness, film weight, clearcoat weight].
// Keratin roughness 0.35-0.5; the film weights are deliberately small.
const S_FLIGHT = [0, 0.42, 0.18, 0];
const S_COVERT = [0, 0.45, 0.14, 0];
const S_BILL = [0, 0.32, 0, 0.35];
const S_LEG = [0, 0.45, 0, 0.15];
const S_GREY = [0, 0.72, 0, 0];

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** Interpolate a loft row table at z (rows sorted by z either way). */
function rowAt(rows, z) {
    let a = rows[0], b = rows[rows.length - 1];
    for (let i = 0; i < rows.length - 1; i++) {
        const lo = Math.min(rows[i].z, rows[i + 1].z), hi = Math.max(rows[i].z, rows[i + 1].z);
        if (z >= lo && z <= hi) { a = rows[i]; b = rows[i + 1]; break; }
    }
    const t = b.z === a.z ? 0 : (z - a.z) / (b.z - a.z);
    const L = (k) => a[k] + (b[k] - a[k]) * Math.min(1, Math.max(0, t));
    return { y: L('y'), w: L('w'), t: L('t'), b: L('b') };
}

/** Cheap deterministic hash noise in [0, 1). */
function hash3(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

function plate(md, opts, at, rot, paint) {
    const m = trs(at[0], at[1], at[2], rot[0], rot[1], rot[2]);
    stamp(md, featherPlate(opts), Object.assign({ m }, paint));
    return m;
}

// ---------------------------------------------------------------------------
// body
// ---------------------------------------------------------------------------

// A short, thick neck (about the head's width) that the head sits straight
// onto, a deep chest, and a body that tapers to a short rump.
export const CROW_BODY_ROWS = Object.freeze([
    { z: -0.42, y: 0.148, w: 0.100, t: 0.084, b: 0.094 },
    { z: -0.36, y: 0.116, w: 0.114, t: 0.094, b: 0.118 },
    { z: -0.29, y: 0.074, w: 0.134, t: 0.106, b: 0.150 },
    { z: -0.19, y: 0.034, w: 0.156, t: 0.118, b: 0.178 },
    { z: -0.07, y: 0.014, w: 0.168, t: 0.122, b: 0.184 },
    { z: 0.05, y: 0.010, w: 0.160, t: 0.112, b: 0.164 },
    { z: 0.16, y: 0.012, w: 0.135, t: 0.093, b: 0.125 },
    { z: 0.26, y: 0.019, w: 0.100, t: 0.068, b: 0.082 },
    { z: 0.34, y: 0.026, w: 0.066, t: 0.046, b: 0.050 },
    { z: 0.40, y: 0.030, w: 0.038, t: 0.028, b: 0.028 },
]);

/** Is this body point inside the hooded crow's black hood/bib? */
function inHood(x, y, z) {
    const r = rowAt(CROW_BODY_ROWS, z);
    const vert = (y - r.y) / (y >= r.y ? r.t : r.b);         // +1 spine .. -1 keel
    const ragged = (hash3(x * 9, y * 9, z * 9) - 0.5) * 0.05;
    if (z < -0.34) return vert < 0.30 + ragged * 4;           // throat and neck sides; nape grey
    if (z < -0.17 + ragged) return vert < -0.10 + ragged * 4;  // the bib, ending raggedly on the breast
    return false;
}

function crowBody(L, hooded, mergeTail, separateLegs) {
    const md = createMeshData(LAYOUT_FEATHER, 'bodyMesh');
    const rows = CROW_BODY_ROWS;
    const maxGirth = Math.PI * (0.168 + (0.122 + 0.184) * 0.5);
    const uTiles = Math.max(2, Math.round(maxGirth * BODY_TILE));
    const prim = loft(rows, L.bodySegs, { pTop: 2.3, pBot: 2.0, capEnd: true, uTiles, uvScale: BODY_TILE });
    const black = PALETTE.realCrowBlack, grey = PALETTE.realHoodedGrey;
    const _c = [0, 0, 0];
    stamp(md, prim, {
        color: (x, y, z) => {
            if (!hooded) return black;
            const g = hash3(x * 31, y * 29, z * 37) * 0.06;
            return inHood(x, y, z) ? black : mixLin(grey, 0xa3a49f, g, _c);
        },
        surf: (x, y, z, u) => {
            if (hooded && !inHood(x, y, z)) return S_GREY;
            const dorsal = Math.cos((u / uTiles) * Math.PI * 2);   // +1 along the spine
            // Mantle ~0.07 film, flanks ~0.02, belly none.
            return [0, 0.48, 0.07 * smooth(-0.2, 0.8, dorsal), 0];
        },
    });

    // Scapulars: long contour feathers lying over the wing roots.
    for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < L.scapulars; i++) {
            const k = L.scapulars === 1 ? 0.5 : i / (L.scapulars - 1);
            const z0 = -0.24 + 0.07 * k;
            const r = rowAt(rows, z0 + 0.1);
            plate(md, {
                len: 0.22 - 0.03 * k, wOut: 0.045, wIn: 0.040, segs: Math.max(2, L.plateSegs - 1), cols: 2,
                tip: 0.9, root: 0.7, bow: 0.008, droop: 0.008, rachis: 0.002,
            }, [s * (0.050 + 0.03 * k), r.y + r.t * 0.93, z0], [0.02, s * (0.20 + 0.06 * k), s * -0.35], {
                color: hooded ? grey : black,
                surf: hooded ? S_GREY : [0, 0.46, 0.10, 0],
                uvScale: [0.8, 1.6],
            });
        }
    }

    // Legs, tucked: tarsus back along the belly, toes clenched under the vent.
    // ROOT: with separate legs (crowLeg, below) the body carries none.
    for (let s = -1; s <= 1 && !separateLegs; s += 2) {
        const from = [s * 0.050, -0.118, 0.15], to = [s * 0.044, -0.104, 0.29];
        const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
        const len = Math.hypot(dx, dy, dz);
        const tars = cylinder(0.0125, 0.0105, 0, len, L.legSegs, false, false);
        stamp(md, tars, { m: alignY(from[0], from[1], from[2], dx, dy, dz), color: PALETTE.realCrowLeg, surf: S_LEG });
        for (let k = 0; k < 4; k++) {
            const a = (k - 1.5) * 0.45;
            const toe = cylinder(0.0075, 0.0015, 0, 0.045, Math.max(4, L.legSegs - 2), false, false);
            const dir = [Math.sin(a) * 0.5 * s, -0.55, 0.65];
            stamp(md, toe, {
                m: alignY(to[0], to[1] - 0.004, to[2] + 0.004, dir[0], dir[1], dir[2]),
                color: PALETTE.realCrowLeg, surf: S_LEG,
            });
        }
    }

    if (mergeTail) {
        // Low tier: the tail is merged into this mesh (one material), so its
        // per-feather UVs are rescaled onto the contour tile.
        appendTail(md, L, hooded, [0.6, 2.2]);
    }
    return md;
}

/**
 * ROOT: one leg, STANDING, its hip at the origin (Gauntlet frame: forward -Z,
 * up +Y, the bird's right +X; `s` = +1 right, -1 left). The root game lands,
 * walks and nests, so its rig tucks the leg by rotating this whole mesh about
 * the hip (bird-pose's foot tuck) instead of Gauntlet's baked-in tuck. Same
 * black keratin as Gauntlet's tucked tarsus and toes; three toes forward and
 * the hallux back, spread flat as a crow stands.
 */
function crowLeg(L, s, len) {
    const md = createMeshData(LAYOUT_FEATHER, s < 0 ? 'leftLegMesh' : 'rightLegMesh');
    const foot = [0, -len, -0.012];
    // A feathered thigh "trouser" where the leg leaves the belly.
    stamp(md, ellipsoid(0.030, 0.042, 0.034, Math.max(5, L.legSegs), Math.max(3, L.legSegs - 2)), {
        m: trs(0, -0.010, 0.004), color: PALETTE.realCrowBlack, surf: [0, 0.48, 0.03, 0],
    });
    const tars = cylinder(0.0125, 0.0105, 0, Math.hypot(foot[1] + 0.02, foot[2]), L.legSegs, false, false);
    stamp(md, tars, { m: alignY(0, -0.02, 0, foot[0], foot[1] + 0.02, foot[2]), color: PALETTE.realCrowLeg, surf: S_LEG });
    for (let k = 0; k < 4; k++) {
        const hallux = k === 3;
        const a = hallux ? Math.PI : (k - 1) * 0.36 * s;
        const dir = [Math.sin(a), -0.10, -Math.cos(a)];
        const toe = cylinder(0.0078, 0.0016, 0, hallux ? 0.042 : 0.058, Math.max(4, L.legSegs - 2), false, false);
        stamp(md, toe, {
            m: alignY(foot[0], foot[1] + 0.004, foot[2], dir[0], dir[1], dir[2]),
            color: PALETTE.realCrowLeg, surf: S_LEG,
        });
    }
    return md;
}

// ---------------------------------------------------------------------------
// tail
// ---------------------------------------------------------------------------

function appendTail(md, L, hooded, uvScale) {
    const n = L.tail;
    const black = PALETTE.realCrowFlight;
    const rng = makeRng(0x7A11);
    for (let i = 0; i < n; i++) {
        const s = n === 1 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);     // -1 .. 1 across the fan
        const len = 0.50 - 0.06 * s * s;
        const narrow = 0.020, broad = 0.034;
        const outerPos = s > 0;
        plate(md, {
            len, wOut: outerPos ? broad : narrow, wIn: outerPos ? narrow : broad,
            segs: L.plateSegs, cols: 2, tip: 0.85, root: 0.6, bow: -0.018, droop: 0.004, rachis: 0.003,
            twist: s * 0.05,
        }, [s * 0.045, 0.036 - 0.0045 * Math.abs(s) * (n / 2), 0.355], [0.06, s * 0.24, 0], {
            color: mixLin(black, 0x22252f, rng() * 0.6, [0, 0, 0]),
            surf: S_FLIGHT, uvScale,
        });
    }
    for (let i = 0; i < L.uCoverts; i++) {
        const s = L.uCoverts === 1 ? 0 : (i - (L.uCoverts - 1) / 2) / ((L.uCoverts - 1) / 2);
        plate(md, {
            len: 0.23 - 0.03 * Math.abs(s), wOut: 0.032, wIn: 0.032, segs: Math.max(2, L.plateSegs - 2), cols: 2,
            tip: 0.9, root: 0.6, bow: 0.006, droop: 0.004,
        }, [s * 0.030, 0.052 - 0.004 * Math.abs(s), 0.30], [0.10, s * 0.18, 0], {
            color: PALETTE.realCrowBlack, surf: S_COVERT, uvScale,
        });
    }
    for (let i = 0; i < L.lCoverts; i++) {
        const s = L.lCoverts === 1 ? 0 : (i - (L.lCoverts - 1) / 2) / ((L.lCoverts - 1) / 2);
        // Undertail coverts face DOWN: rolled over (rz = pi) so the top face
        // is the one the camera below sees.
        plate(md, {
            len: 0.20, wOut: 0.034, wIn: 0.034, segs: 2, cols: 2, tip: 0.9, root: 0.6, bow: 0.004,
        }, [s * 0.032, -0.012, 0.31], [0.20, s * 0.20, Math.PI], {
            color: hooded ? PALETTE.realHoodedGrey : PALETTE.realCrowBlack,
            surf: hooded ? S_GREY : S_COVERT, uvScale,
        });
    }
}

function crowTail(L, hooded) {
    const md = createMeshData(LAYOUT_FEATHER, 'tailMesh');
    appendTail(md, L, hooded, null);
    return md;
}

// ---------------------------------------------------------------------------
// head
// ---------------------------------------------------------------------------

// A big head: broad, flat-crowned skull about as wide as the neck it sits on.
export const CROW_HEAD_ROWS = Object.freeze([
    { z: 0.070, y: 0.000, w: 0.075, t: 0.069, b: 0.075 },
    { z: 0.030, y: 0.015, w: 0.098, t: 0.085, b: 0.090 },
    { z: -0.020, y: 0.025, w: 0.113, t: 0.098, b: 0.100 },
    { z: -0.070, y: 0.030, w: 0.118, t: 0.100, b: 0.103 },
    { z: -0.120, y: 0.028, w: 0.110, t: 0.093, b: 0.098 },
    { z: -0.165, y: 0.024, w: 0.093, t: 0.080, b: 0.085 },
    { z: -0.205, y: 0.020, w: 0.070, t: 0.065, b: 0.070 },
    { z: -0.235, y: 0.018, w: 0.050, t: 0.052, b: 0.055 },
]);

// Bill sections: [z, top, bottom, halfWidth]. The upper mandible's culmen
// arches down to a slight hook; the lower is shorter, with a gonys keel.
// Heavy at the base (deep and broad), the tip where it always was.
const UPPER_BILL = [
    [-0.215, 0.083, -0.004, 0.049], [-0.260, 0.071, -0.003, 0.040], [-0.310, 0.053, -0.002, 0.029],
    [-0.360, 0.035, -0.003, 0.021], [-0.405, 0.017, -0.006, 0.0115], [-0.440, -0.003, -0.012, 0.005],
    [-0.458, -0.016, -0.019, 0.0015],
];
const LOWER_BILL = [
    [-0.215, -0.006, -0.061, 0.044], [-0.280, -0.006, -0.046, 0.032], [-0.350, -0.008, -0.033, 0.021],
    [-0.410, -0.011, -0.0227, 0.0103], [-0.442, -0.016, -0.021, 0.003],
];

function billRows(table) {
    return table.map(([z, top, bot, w]) => ({ z, y: (top + bot) / 2, w, t: (top - bot) / 2, b: (top - bot) / 2 }));
}

export const CROW_EYE = Object.freeze({
    center: Object.freeze([0.085, 0.049, -0.150]),
    axis: Object.freeze([0.90, 0.12, -0.42]),
    radius: 0.024,
});

function crowHead(L, hooded) {
    const md = createMeshData(LAYOUT_FEATHER, 'headMesh');
    const rows = CROW_HEAD_ROWS;
    const maxGirth = Math.PI * (0.118 + 0.1015);
    const uTiles = Math.max(2, Math.round(maxGirth * HEAD_TILE));
    const skull = loft(rows, L.headSegs, { pTop: 2.7, pBot: 2.1, capStart: true, capEnd: true, uTiles, uvScale: HEAD_TILE });
    stamp(md, skull, {
        color: PALETTE.realCrowBlack,
        surf: (x, y, z, u) => {
            const dorsal = Math.cos((u / uTiles) * Math.PI * 2);
            return [0, 0.46, 0.08 * smooth(-0.2, 0.9, dorsal), 0];
        },
    });

    // The bill: two lofts. pTop < 2 ridges the culmen; pBot > 2 flattens the
    // cutting edge.
    const upper = loft(billRows(UPPER_BILL), L.billSegs, { pTop: 1.55, pBot: 4.0, uvScale: 4 });
    stamp(md, upper, { color: PALETTE.realCrowBill, surf: S_BILL });
    const lower = loft(billRows(LOWER_BILL), L.billSegs, { pTop: 4.0, pBot: 1.8, uvScale: 4 });
    stamp(md, lower, { color: 0x101115, surf: S_BILL });

    // Nasal bristles: stiff, forward-lying feather plates over the nostrils
    // and the base of the culmen.
    for (let s = -1; s <= 1; s += 2) {
        for (let i = 0; i < L.bristles; i++) {
            const k = L.bristles === 1 ? 0.5 : i / (L.bristles - 1);
            plate(md, {
                len: 0.115 - 0.027 * k, wOut: 0.0085, wIn: 0.0085, segs: 2, cols: 2, tip: 0.2, root: 0.8,
                bow: 0.004, droop: 0.001, rachis: 0.0015,
            }, [s * (0.007 + 0.027 * k), 0.085 - 0.014 * k, -0.200], [0.17 + 0.05 * k, Math.PI - s * (0.06 + 0.16 * k), 0], {
                color: PALETTE.realCrowBlack, surf: [0, 0.48, 0.04, 0], uvScale: [0.25, 1],
            });
        }
    }

    // Eyes: a lens dome, axis lateral-and-forward. Pupil, dark brown iris and
    // a black lid ring painted by angle from the axis; all of it masked for
    // the membrane blink.
    const E = CROW_EYE;
    const anchors = {};
    for (let s = -1; s <= 1; s += 2) {
        const c = [s * E.center[0], E.center[1], E.center[2]];
        const ax = [s * E.axis[0], E.axis[1], E.axis[2]];
        const al = Math.hypot(ax[0], ax[1], ax[2]);
        const lens = ellipsoid(E.radius, E.radius * 0.52, E.radius, L.eye[0], L.eye[1]);
        stamp(md, lens, {
            m: alignY(c[0], c[1], c[2], ax[0], ax[1], ax[2]),
            color: (x, y, z, u, v, lx, ly, lz) => {
                const r = Math.hypot(lx, lz) / E.radius;
                if (ly < 0 || r > 0.88) return 0x1a1a1f;
                return r < 0.44 ? PALETTE.realCrowPupil : PALETTE.realCrowIris;
            },
            surf: (x, y, z, u, v, lx, ly, lz) => (ly > 0 && Math.hypot(lx, lz) / E.radius <= 0.88 ? [0, 0.07, 0, 1] : [0, 0.5, 0, 0]),
            mask: 1,
        });
        const side = s < 0 ? 'left' : 'right';
        anchors[side + 'Eye'] = c;
        anchors[side + 'Pupil'] = [c[0] + ax[0] / al * 0.012, c[1] + ax[1] / al * 0.012, c[2] + ax[2] / al * 0.012];
    }
    anchors.beak = [0, -0.012, -0.458];
    return { md, anchors };
}

// ---------------------------------------------------------------------------
// wing (built as the RIGHT wing; the adapter mirrors it for the left)
// ---------------------------------------------------------------------------

/** The full ten-primary table; low tiers take the OUTER entries. */
const PRIMARY_LEN = [0.40, 0.42, 0.44, 0.47, 0.51, 0.55, 0.57, 0.565, 0.50, 0.33];

function primaryHeading(idx) {
    return 0.34 + 1.10 * Math.pow(idx / 9, 0.95);
}

function crowWing(L, hooded) {
    const md = createMeshData(LAYOUT_FEATHER, 'rightWingMesh');
    const WX = CROW_RIG.wristX;
    const rng = makeRng(0xC20E);
    const flight = () => mixLin(PALETTE.realCrowFlight, 0x232838, rng() * 0.5, [0, 0, 0]);
    const covert = () => mixLin(PALETTE.realCrowBlack, 0x262a36, rng() * 0.5, [0, 0, 0]);
    const ARM = (pz) => [0, 0, 0, pz];
    const HAND = (px, pz, splay) => [1, splay || 0, px, pz];
    const coverSegs = Math.max(2, L.plateSegs - 2);

    // --- leading-edge band: lesser and marginal coverts over the patagium.
    // Built along Z, turned onto +X (ry = +90deg maps local Z to wing x and
    // local X to -z), so row.x is MINUS the chord centre.
    const band = [
        { s: 0.00, cz: -0.020, y: 0.016, hc: 0.075, t: 0.030, b: 0.022 },
        { s: 0.15, cz: -0.036, y: 0.014, hc: 0.066, t: 0.023, b: 0.016 },
        { s: 0.35, cz: -0.052, y: 0.012, hc: 0.056, t: 0.018, b: 0.012 },
        { s: 0.55, cz: -0.066, y: 0.010, hc: 0.046, t: 0.015, b: 0.010 },
        { s: WX + 0.02, cz: -0.074, y: 0.009, hc: 0.040, t: 0.015, b: 0.011 },
        { s: WX + 0.14, cz: -0.068, y: 0.005, hc: 0.030, t: 0.011, b: 0.008 },
        { s: WX + 0.27, cz: -0.058, y: 0.001, hc: 0.016, t: 0.007, b: 0.006 },
    ].map((r) => ({ z: r.s, y: r.y, x: -r.cz, w: r.hc, t: r.t, b: r.b }));
    const bandPrim = loft(band, L.bandSegs, { pTop: 2.0, pBot: 2.6, capEnd: true, uTiles: 1 });
    stamp(md, bandPrim, {
        m: trs(0, 0, 0, 0, Math.PI / 2, 0),
        color: PALETTE.realCrowBlack,
        surf: S_COVERT,
        def: (x) => [smooth(WX - 0.05, WX + 0.02, x), 0, 0, 0],
        uvScale: [0.30, 1 / (WX + 0.27)],
    });

    // --- tertials: innermost, longest of the arm's top layer, lean inward.
    for (let i = 0; i < L.tertials; i++) {
        const k = L.tertials === 1 ? 0.5 : i / (L.tertials - 1);
        plate(md, {
            len: 0.29 - 0.03 * k, wOut: 0.050, wIn: 0.034, segs: L.plateSegs, cols: L.plateCols,
            tip: 0.9, root: 0.6, bow: -0.010, droop: 0.006, rachis: 0.003,
        }, [0.030 + 0.045 * k, 0.026 + 0.003 * (L.tertials - i), -0.010], [0.05, -0.22 + 0.10 * k, 0], {
            color: covert(), surf: S_COVERT, def: ARM(0),
        });
    }

    // --- secondaries: the arm's flight feathers, inner ones on top.
    const nS = L.secondaries;
    for (let i = 0; i < nS; i++) {
        const t = nS === 1 ? 1 : i / (nS - 1);
        plate(md, {
            len: 0.34 + 0.03 * Math.sin(Math.PI * t), wOut: 0.045, wIn: 0.027,
            segs: L.plateSegs, cols: L.plateCols, tip: 0.85, root: 0.6,
            bow: -0.012, droop: 0.006, rachis: 0.003, twist: -0.06 * t, curve: 0.010,
        }, [0.075 + t * (WX - 0.095), 0.004 + 0.0032 * (nS - 1 - i), -0.020 - 0.030 * t], [0.05, -0.06 + 0.22 * t, 0], {
            color: flight(), surf: S_FLIGHT, def: ARM(0),
        });
    }

    // --- greater coverts: over the secondaries' bases.
    const nG = L.gCoverts;
    for (let i = 0; i < nG; i++) {
        const t = nG === 1 ? 1 : i / (nG - 1);
        plate(md, {
            len: 0.185 - 0.02 * t, wOut: 0.036, wIn: 0.030, segs: coverSegs, cols: 2,
            tip: 0.9, root: 0.65, bow: -0.006, droop: 0.004, rachis: 0.002,
        }, [0.080 + t * (WX - 0.10), 0.018 + 0.002 * (nG - 1 - i), -0.050 - 0.026 * t], [0.10, -0.04 + 0.20 * t, 0], {
            color: covert(), surf: S_COVERT, def: ARM(0),
        });
    }

    // --- median coverts.
    const nM = L.mCoverts;
    for (let i = 0; i < nM; i++) {
        const t = nM === 1 ? 1 : i / (nM - 1);
        plate(md, {
            len: 0.105, wOut: 0.030, wIn: 0.026, segs: 2, cols: 2, tip: 0.95, root: 0.7, bow: -0.003, droop: 0.003,
        }, [0.090 + t * (WX - 0.16), 0.027, -0.068 - 0.018 * t], [0.16, -0.02 + 0.16 * t, 0], {
            color: covert(), surf: S_COVERT, def: ARM(0),
        });
    }

    // --- primaries: the hand. Outer six emarginated into fingers that splay.
    const nP = L.primaries;
    let tip = [0, 0, 0];
    const hand0 = [WX, -0.002, -0.035], hand1 = [WX + 0.25, -0.006, -0.058];
    for (let j = 0; j < nP; j++) {
        const idx = 10 - nP + j;                  // index in the full ten (0 = P1)
        const t = idx / 9;
        const at = [
            hand0[0] + (hand1[0] - hand0[0]) * t,
            hand0[1] + (hand1[1] - hand0[1]) * t - 0.0028 * idx,
            hand0[2] + (hand1[2] - hand0[2]) * t,
        ];
        const finger = idx >= 4;
        const opts = {
            len: PRIMARY_LEN[idx] * (nP < 10 ? 1.02 : 1),
            wOut: 0.040 - 0.010 * t, wIn: 0.018 - 0.004 * t,
            segs: L.plateSegs + 1, cols: L.plateCols, tip: 0.55, root: 0.55,
            bow: -0.010, droop: 0.005, rachis: 0.003, twist: -0.10, curve: 0.025,
            emarg: finger ? (idx === 4 ? { at: 0.56, neg: 0.35, pos: 0.45 } : { at: 0.52, neg: 0.55, pos: 0.72 }) : null,
        };
        const splay = finger ? (idx - 6.5) * 0.10 : 0;
        const m = plate(md, opts, at, [0.02, primaryHeading(idx), 0], {
            color: flight(), surf: S_FLIGHT, def: HAND(at[0], at[2], splay),
        });
        const p = applyPoint(m, ...featherTip(opts), [0, 0, 0]);
        if (p[0] > tip[0]) tip = p;
    }

    // --- primary coverts.
    const nPC = L.pCoverts;
    for (let j = 0; j < nPC; j++) {
        const t = nPC === 1 ? 0.5 : j / (nPC - 1);
        const idx = t * 8;
        const at = [
            hand0[0] + (hand1[0] - hand0[0]) * (idx / 9) - 0.01,
            0.012 - 0.001 * j,
            hand0[2] + (hand1[2] - hand0[2]) * (idx / 9) - 0.020,
        ];
        plate(md, {
            len: 0.15 - 0.03 * t, wOut: 0.026, wIn: 0.016, segs: coverSegs, cols: 2,
            tip: 0.8, root: 0.6, bow: -0.004, droop: 0.003, rachis: 0.002,
        }, at, [0.06, primaryHeading(idx), 0], {
            color: covert(), surf: S_COVERT, def: HAND(at[0], at[2], 0),
        });
    }

    // --- alula: the thumb, at the wrist's leading edge.
    for (let j = 0; j < L.alula; j++) {
        const at = [WX + 0.008 * j, 0.020 + 0.002 * j, -0.080];
        plate(md, {
            len: 0.11 + 0.012 * j, wOut: 0.014, wIn: 0.010, segs: 2, cols: 2, tip: 0.5, root: 0.7,
            bow: 0.003, droop: 0.002,
        }, at, [0.0, 1.70 + 0.12 * j, 0], {
            color: covert(), surf: S_COVERT, def: HAND(at[0], at[2], 0),
        });
    }

    return { md, tip };
}

// ---------------------------------------------------------------------------
// the whole bird
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {'high'|'mid'|'low'} [o.quality='high']
 * @param {'normal'|'alt'} [o.variant='normal']  'alt' is the hooded crow
 */
export function buildCrow(o = {}) {
    const quality = CROW_LOD[o.quality] ? o.quality : 'high';
    // ROOT: `o.lod` overrides individual counts (the root game's frame budget).
    const L = o.lod ? Object.assign({}, CROW_LOD[quality], o.lod) : CROW_LOD[quality];
    const hooded = o.variant === 'alt';
    const head = crowHead(L, hooded);
    const wing = crowWing(L, hooded);
    // ROOT: `o.legs` ({ len }) builds standing legs as their own meshes.
    const legs = o.legs ? { left: crowLeg(L, -1, o.legs.len), right: crowLeg(L, 1, o.legs.len) } : null;
    const meshes = [
        { name: 'bodyMesh', part: 'body', material: 'contour', role: 'body', data: crowBody(L, hooded, L.mergeTail, !!legs) },
        { name: 'headMesh', part: 'head', material: 'contour', role: 'head', data: head.md },
    ];
    if (!L.mergeTail) {
        meshes.push({ name: 'tailMesh', part: 'body', material: 'vane', role: 'tail', data: crowTail(L, hooded) });
    }
    meshes.push({ name: 'rightWingMesh', part: 'rightWing', material: 'vane', role: 'wing', side: 1, data: wing.md });
    let triangles = 0;
    for (const m of meshes) triangles += triangleCount(m.data);
    triangles += triangleCount(wing.md);         // the mirrored left wing
    if (legs) triangles += triangleCount(legs.left) + triangleCount(legs.right);
    return {
        species: 'crow',
        legs,
        quality,
        variant: hooded ? 'alt' : 'normal',
        meshes,
        rig: CROW_RIG,
        anchors: {
            head: head.anchors,
            body: {
                leftFoot: [-0.046, -0.110, 0.29], rightFoot: [0.046, -0.110, 0.29],
                tail: [0, 0.03, CROW_RIG.tailZ],
            },
            wingTip: wing.tip,
        },
        eye: { lid: PALETTE.realCrowMembrane },
        film: CROW_FILM,
        sheen: hooded ? PALETTE.realHoodedSheen : PALETTE.realCrowSheen,
        // Body, head, (tail,) two wings: 5 draws, 4 with the tail merged.
        // ROOT: plus one per separate leg.
        drawCalls: meshes.length + 1 + (legs ? 2 : 0),
        triangles,
    };
}
