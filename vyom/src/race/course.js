/**
 * race/course.js — VYOM's circuit: the racing line, the glowing ribbon, the
 * gates and the start gantry.
 *
 * ---------------------------------------------------------------------------
 * HOW THE CIRCUIT IS AUTHORED
 * ---------------------------------------------------------------------------
 * A great circle round a sphere is a lap with no corners and no memory. So the
 * circuit is HAND-AUTHORED, in a frame-relative coordinate system that makes
 * corner shape independent of where on the planet the course lands:
 *
 *     dir(a, b) = normalize( U*cos(a) + V*sin(a) + W*b )
 *
 * `a` walks 0..360 once round the planet through an orthonormal frame
 * (U, V, W); `b` pushes the line sideways OUT of that plane. Each control
 * point also carries `alt` — metres ABOVE THE LOCAL FLOOR, never an absolute
 * radius. That is the whole trick behind "the ribbon follows the terrain":
 * every point is placed at `floorRadius(dir) + alt`, so where the continental
 * field carves a canyon the racing line dives into it, and where the ground
 * rises to the baseline the line rises with it. Nothing clips, ever, because
 * `surfaceHeight <= continentalHeight` is an invariant of terrain.js and the
 * minimum authored `alt` clears the ridged detail amplitude.
 *
 * The authored character, in order round the lap:
 *
 *   1. RIDGE STRAIGHT   a   0..58   flat, alt 15   0.67 deg/u (a geodesic on a
 *                                                  radius-100 planet is 0.57 —
 *                                                  this is as straight as the
 *                                                  planet allows)
 *   2. WIDE SWEEPER     a  78..155  b out to 0.36  0.74 deg/u, one long arc
 *   3. HAIRPIN          a 169..189  b to -0.245    2.37 deg/u — a real 20-unit
 *                                                  radius, 130 degrees of it
 *   4. CANYON DIVE      a 194..248  alt 9 -> 6     0.94 deg/u, radius 83..91,
 *                                                  i.e. 17 units BELOW baseline
 *   5. CLIMBING CHICANE a 262..326  b +/-0.08      1.28 deg/u, climbs 9 -> 17
 *   6. RUN-IN           a 340..352  back on line
 *
 * Those numbers are not aspirations — they are what `characterReport` measures
 * off the built spline, and the probe page prints them.
 *
 * ---------------------------------------------------------------------------
 * WHERE ON THE PLANET IT LANDS
 * ---------------------------------------------------------------------------
 * The character above is only real if the terrain agrees: a "ridge straight"
 * in a canyon is a lie and a "canyon dive" on a crest cannot dive. So the
 * frame (U, V, W) is not arbitrary — the builder scores a few hundred seeded
 * orientations against the actual height field (ridge segment wants shallow
 * ground, dive segment wants deep ground AND enough depth to drop below the
 * baseline) and keeps the best. Deterministic, build-time only.
 *
 * The result is measured, not assumed: `characterReport` carries per-segment
 * mean/peak curvature in degrees per world unit and the min/max ribbon radius,
 * and the dev probe prints it.
 *
 * ---------------------------------------------------------------------------
 * BUDGET — 7 draw calls, ~10k triangles at `high`
 * ---------------------------------------------------------------------------
 *   ribbon beam (1) + ribbon glow strip (1) + gate rings, instanced (1) +
 *   gate ring outlines, instanced (1) + gate light pillars, instanced (1) +
 *   start gantry (1) + gantry outline (1)
 *
 * Twelve gates as twelve Meshes with twelve outline hulls would be 24 draw
 * calls on its own, so gates are one InstancedMesh and their idle/next/passed
 * colour rides on `instanceColor`. Their outline hulls are a second
 * InstancedMesh sharing the same matrices (the outline shader already handles
 * USE_INSTANCING).
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import { ensureSmoothNormals, createOutlineMaterial, attachOutline } from '../core/outline.js';
import { PLANET_RADIUS, floorRadius, depthAt, continentalHeight } from '../core/terrain.js';
import { makeRng } from '../core/rng.js';

// ---------------------------------------------------------------------------
// The authored circuit
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Control points: `a` degrees round the frame, `b` lateral push out of the
 * frame plane, `alt` world units above the LOCAL FLOOR.
 *
 * Corner tightness is set by the `b` swing over the `a` advance, and it goes as
 * the SQUARE of the spacing — halve the `a` gap and you quadruple the corner.
 * Change one number and re-read the measured curvature in the probe; every
 * attempt to eyeball this produced a corner 3-5x tighter than intended.
 */
const CONTROL = [
    // 1. ridge straight -------------------------------------------------- 0-3
    { a: 0, b: 0.00, alt: 15 },
    { a: 20, b: 0.00, alt: 15 },
    { a: 40, b: 0.01, alt: 14 },
    { a: 58, b: 0.03, alt: 13 },
    // 2. wide sweeper ---------------------------------------------------- 4-8
    // One long committed arc pushing 36 units off the frame plane and back.
    { a: 78, b: 0.13, alt: 12 },
    { a: 98, b: 0.28, alt: 11 },
    { a: 118, b: 0.36, alt: 11 },
    { a: 138, b: 0.32, alt: 11 },
    { a: 155, b: 0.18, alt: 10 },
    // 3. hairpin -------------------------------------------------------- 9-14
    // Six points sampled off a REAL 20-unit-radius arc sweeping 130 degrees.
    // Two things were learned the hard way here and are measured in
    // `characterReport`, so do not "simplify" them away:
    //   - a hand-placed apex point makes a V, not a corner (measured 13 deg/u,
    //     a 4-unit turn radius that nothing can fly);
    //   - the arc's ENTRY HEADING has to match the heading the sweeper hands
    //     over at control 8 (-50 vs -56 degrees here). When it did not, the
    //     spline snapped between them across one link and put a 6.5 deg/u
    //     spike on the corner entry.
    { a: 168.7, b: -0.174, alt: 10 },
    { a: 172.8, b: -0.228, alt: 10 },
    { a: 177.9, b: -0.245, alt: 10 },
    { a: 182.9, b: -0.222, alt: 10 },
    { a: 186.8, b: -0.163, alt: 10 },
    { a: 188.8, b: -0.080, alt: 10 },
    // 4. canyon dive ---------------------------------------------------- 15-19
    // The hairpin spits you out at +80 degrees, so the dive opens as a 40-unit
    // right-hander continuing that exact tangent, then straightens and drops.
    // The drama here is vertical: altitude falls 10 -> 6 while the ground
    // falls faster, so the line ends up BELOW the baseline radius.
    { a: 193.8, b: 0.108, alt: 9 },
    { a: 203.5, b: 0.227, alt: 7 },
    { a: 215.4, b: 0.245, alt: 6 },
    { a: 232.0, b: 0.200, alt: 6 },
    { a: 248.0, b: 0.060, alt: 7 },
    // 5. climbing chicane ----------------------------------------------- 20-24
    // A chicane is a sinusoid, and its curvature is amplitude * omega^2 — so
    // it is dominated by the SPACING, squared. The first cut used a 12-degree
    // (21-unit) half-period with 0.12 of lateral swing and measured 7.1 deg/u,
    // sharper than the hairpin. 16 degrees and 0.08 predicts 2.9 and measures
    // it. Halve the spacing here and you quadruple the corner.
    { a: 262, b: -0.02, alt: 9 },
    { a: 278, b: -0.10, alt: 11 },
    { a: 294, b: -0.02, alt: 13 },
    { a: 310, b: -0.10, alt: 15 },
    { a: 326, b: -0.02, alt: 17 },
    // 6. run-in --------------------------------------------------------- 25-26
    { a: 340, b: 0.02, alt: 17 },
    { a: 352, b: 0.00, alt: 16 },
];

/** Named spans over CONTROL, used for scoring and for the measured report. */
const SEGMENTS = [
    { name: 'ridge straight', from: 0, to: 3 },
    { name: 'wide sweeper', from: 4, to: 8 },
    { name: 'hairpin', from: 9, to: 14 },
    { name: 'canyon dive', from: 15, to: 19 },
    { name: 'climb chicane', from: 20, to: 24 },
    { name: 'run-in', from: 25, to: 26 },
];

const RIDGE_IDX = [0, 1, 2, 3, 26];
const DIVE_IDX = [15, 16, 17, 18, 19];

const TIER = {
    low: { ribbonSegments: 220, sampleCount: 512, ringRadial: 5, ringTubular: 14, pillars: false },
    mid: { ribbonSegments: 280, sampleCount: 768, ringRadial: 6, ringTubular: 16, pillars: true },
    high: { ribbonSegments: 340, sampleCount: 1024, ringRadial: 6, ringTubular: 18, pillars: true },
};

/** Ribbon cross-section. Half-width and half-thickness, world units. */
const RIBBON_HALF_W = 5.2;
const RIBBON_HALF_H = 0.75;
const RIBBON_DECK = 0.80;     // fraction of the half-width the flat deck spans
const GLOW_SPREAD = 1.8;      // glow skirt half-width, as a multiple of the beam
const GLOW_DROP = 2.2;        // how far below the deck the skirt hangs
const GATE_RADIUS = 9.0;
const GATE_TUBE = 0.85;

/**
 * Minimum clearance between the racing line and the flight floor.
 * terrain.js guarantees `surfaceHeight >= continentalHeight - detailAmplitude`
 * (3.4), so anything above ~4 cannot clip the rendered mesh. 5.5 leaves a
 * visible gap so the ribbon reads as flying over the ground, not painted on.
 */
const MIN_CLEARANCE = 5.5;

/**
 * Radial low-pass passes applied to the racing line.
 *
 * Following `floorRadius` literally is wrong: the continental field's finest
 * octave has an ~11-unit wavelength, so a line pinned at a constant altitude
 * above it acquires vertical kinks with a radius of curvature of a few units.
 * Measured on the first build, that put PEAK CURVATURE OF 11 deg/unit ON THE
 * "STRAIGHT" — i.e. the straight was not straight, it was corrugated. So the
 * radius profile is box-smoothed and then clamped back up above the floor,
 * repeatedly: smoothing removes the corrugation, the clamp restores the
 * invariant, and a few iterations converge on a smooth envelope that still
 * dives into the canyons (which are 50+ units wide and survive the filter).
 */
const RADIUS_SMOOTH_PASSES = 4;
/**
 * Filter half-width in WORLD UNITS, not sample indices. Dense samples are
 * packed much closer through a tight corner than along a straight, so an
 * index-window filter barely touches the hairpin — which is exactly where the
 * measured curvature was still spiking to 6 deg/unit against a 3 deg/unit
 * design target.
 */
const RADIUS_SMOOTH_RANGE = 13;

// ---------------------------------------------------------------------------
// Build-time helpers (allocation is fine here — none of this runs in update)
// ---------------------------------------------------------------------------

/**
 * Non-uniform (Barry-Goldman) Catmull-Rom through 4 scalars with explicit
 * knots. `u` runs in [k1, k2].
 *
 * The uniform form is not good enough here. The authored control points are
 * NOT evenly spaced — the hairpin packs five points into 25 degrees while the
 * straight spreads four over 54 — and a uniform Catmull-Rom through unevenly
 * spaced points overshoots at every spacing change. Measured on the second
 * build that showed up as a 7.3 deg/unit curvature SPIKE in the middle of the
 * "wide sweeper", whose mean was 0.87: a kink, not a corner. Centripetal knots
 * remove it.
 */
function crNU(p0, p1, p2, p3, k0, k1, k2, k3, u) {
    const a1 = ((k1 - u) * p0 + (u - k0) * p1) / (k1 - k0);
    const a2 = ((k2 - u) * p1 + (u - k1) * p2) / (k2 - k1);
    const a3 = ((k3 - u) * p2 + (u - k2) * p3) / (k3 - k2);
    const b1 = ((k2 - u) * a1 + (u - k0) * a2) / (k2 - k0);
    const b2 = ((k3 - u) * a2 + (u - k1) * a3) / (k3 - k1);
    return ((k2 - u) * b1 + (u - k1) * b2) / (k2 - k1);
}

/**
 * Approximate world-space distance between two authored control points.
 * One degree of `a` is ~1.745 units on a radius-100 planet; one unit of `b` is
 * a full planet radius. Getting this ratio right is what makes the centripetal
 * knots behave like real arc length.
 */
const A_TO_UNITS = PLANET_RADIUS * DEG;
function controlChord(a0, b0, a1, b1) {
    const da = (a1 - a0) * A_TO_UNITS;
    const db = (b1 - b0) * PLANET_RADIUS;
    return Math.hypot(da, db);
}

/**
 * Score one candidate frame against the real height field.
 *
 * A course whose "ridge straight" sits in a pit and whose "canyon dive" sits
 * on a crest has the right shape and none of the character, so the terms are:
 *   + the dive is deep, and deep enough to break the baseline
 *   + the straight is shallow
 *   + the lap as a whole varies in elevation (a course at one depth is dull)
 */
function scoreFrame(ux, uy, uz, vx, vy, vz, wx, wy, wz) {
    let ridge = 0, dive = 0, margin = 0;
    let sum = 0, sum2 = 0;

    for (let i = 0; i < CONTROL.length; i++) {
        const c = CONTROL[i];
        const ca = Math.cos(c.a * DEG), sa = Math.sin(c.a * DEG);
        let x = ux * ca + vx * sa + wx * c.b;
        let y = uy * ca + vy * sa + wy * c.b;
        let z = uz * ca + vz * sa + wz * c.b;
        const inv = 1 / Math.hypot(x, y, z);
        x *= inv; y *= inv; z *= inv;
        const d = depthAt(x, y, z);
        sum += d; sum2 += d * d;
        if (RIDGE_IDX.indexOf(i) >= 0) ridge += d;
        if (DIVE_IDX.indexOf(i) >= 0) {
            dive += d;
            // How far the racing line ends up BELOW the baseline radius.
            const below = -(continentalHeight(x, y, z) + c.alt);
            margin += below > 0 ? Math.min(1, below / 10) : 0;
        }
    }

    const n = CONTROL.length;
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    ridge /= RIDGE_IDX.length;
    dive /= DIVE_IDX.length;
    margin /= DIVE_IDX.length;

    return 1.7 * dive + 1.1 * (1 - ridge) + 1.4 * margin + 2.0 * std;
}

/** Pick the best-scoring orientation for the circuit. Deterministic. */
function chooseFrame(seed, tries = 384) {
    const rng = makeRng(seed >>> 0);
    let best = null, bestScore = -Infinity;

    for (let k = 0; k < tries; k++) {
        // Two independent uniform directions -> an orthonormal frame.
        const u = randomUnit(rng);
        const h = randomUnit(rng);
        let vx = h[1] * u[2] - h[2] * u[1];
        let vy = h[2] * u[0] - h[0] * u[2];
        let vz = h[0] * u[1] - h[1] * u[0];
        const vl = Math.hypot(vx, vy, vz);
        if (vl < 1e-4) continue;
        vx /= vl; vy /= vl; vz /= vl;
        const wx = u[1] * vz - u[2] * vy;
        const wy = u[2] * vx - u[0] * vz;
        const wz = u[0] * vy - u[1] * vx;

        const s = scoreFrame(u[0], u[1], u[2], vx, vy, vz, wx, wy, wz);
        if (s > bestScore) {
            bestScore = s;
            best = [u[0], u[1], u[2], vx, vy, vz, wx, wy, wz];
        }
    }
    return { frame: best, score: bestScore };
}

function randomUnit(rng) {
    // Marsaglia: rejection-free polar method on the sphere.
    const z = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(th), r * Math.sin(th), z];
}

// ---------------------------------------------------------------------------
// Geometry assembly helpers
// ---------------------------------------------------------------------------

// Box faces, written out longhand so the normals are exact: running
// computeVertexNormals over a merged set of boxes averages across the seams
// and rounds every corner into mush under a stepped ramp.
// For each face: outward normal, then the (u, v) axes of the face plane chosen
// so that u x v == n, which makes the fixed CCW corner order face outward.
const BOX_FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const BOX_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

/** Append a box (position/normal/colour) into flat build arrays. */
function pushBox(P, N, C, cx, cy, cz, hx, hy, hz, r, g, b) {
    for (let f = 0; f < 6; f++) {
        const face = BOX_FACES[f];
        const n = face.n, u = face.u, v = face.v;
        const ox = n[0] * hx, oy = n[1] * hy, oz = n[2] * hz;
        const ux = u[0] * hx, uy = u[1] * hy, uz = u[2] * hz;
        const vx = v[0] * hx, vy = v[1] * hy, vz = v[2] * hz;
        for (let k = 0; k < 6; k++) {
            const s = BOX_CORNERS[k][0], t = BOX_CORNERS[k][1];
            P.push(cx + ox + ux * s + vx * t, cy + oy + uy * s + vy * t, cz + oz + uz * s + vz * t);
            N.push(n[0], n[1], n[2]);
            C.push(r, g, b);
        }
    }
}

/**
 * A tapered, alpha-faded light shaft on the unit Y axis (y in [0,1], radius 1
 * at the widest ring). Colour comes from `instanceColor`; the vertex colour
 * carries only the alpha envelope, so one geometry serves every gate.
 */
function buildLightShaft(THREE, sides, ys, alphas, radii) {
    const rings = ys.length;
    const pos = [], col = [];
    for (let s = 0; s < sides; s++) {
        const a0 = (s / sides) * Math.PI * 2;
        const a1 = ((s + 1) / sides) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        for (let r = 0; r < rings - 1; r++) {
            const yA = ys[r], yB = ys[r + 1];
            const rA = radii[r], rB = radii[r + 1];
            const aA = alphas[r], aB = alphas[r + 1];
            const v = [
                [c0 * rA, yA, s0 * rA, aA], [c1 * rA, yA, s1 * rA, aA],
                [c1 * rB, yB, s1 * rB, aB], [c0 * rB, yB, s0 * rB, aB],
            ];
            const order = [0, 1, 2, 0, 2, 3];
            for (let k = 0; k < 6; k++) {
                const p = v[order[k]];
                pos.push(p[0], p[1], p[2]);
                col.push(1, 1, 1, p[3]);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.computeBoundingSphere();
    return geo;
}

// ---------------------------------------------------------------------------
// createCourse
// ---------------------------------------------------------------------------

export function createCourse(THREE, opts = {}) {
    const quality = TIER[opts.quality] ? opts.quality : 'high';
    const tier = TIER[quality];
    const seed = (opts.seed ?? 20260801) >>> 0;
    const gateCount = Math.max(3, opts.gateCount ?? 12) | 0;

    const group = new THREE.Group();
    group.name = 'vyom-course';
    const disposables = [];

    // --- 1. pick where on the planet the circuit lands ---------------------
    const chosen = chooseFrame(seed);
    const F = chosen.frame;

    // --- 2. densify the hand-authored control points ------------------------
    // `a` is unwrapped to stay monotonic across the seam so the Catmull-Rom
    // through it never runs backwards at the join.
    const nC = CONTROL.length;
    const aVal = new Float64Array(nC + 3);
    const bVal = new Float64Array(nC + 3);
    const hVal = new Float64Array(nC + 3);
    for (let i = -1; i <= nC + 1; i++) {
        const j = ((i % nC) + nC) % nC;
        const turns = Math.floor(i / nC);
        aVal[i + 1] = CONTROL[j].a + turns * 360;
        bVal[i + 1] = CONTROL[j].b;
        hVal[i + 1] = CONTROL[j].alt;
    }

    // Centripetal knots over the padded control array.
    const knot = new Float64Array(nC + 3);
    knot[0] = 0;
    for (let i = 1; i < nC + 3; i++) {
        const d = controlChord(aVal[i - 1], bVal[i - 1], aVal[i], bVal[i]);
        knot[i] = knot[i - 1] + Math.sqrt(Math.max(1e-4, d));
    }

    // Dense sample count per authored segment is proportional to its length, so
    // the samples are ~evenly spaced round the lap. A fixed count per segment
    // packs 22 samples into an 11-unit hairpin link and spreads the same 22
    // over a 34-unit straight, which makes every downstream filter behave
    // differently in different parts of the circuit.
    const DENSE_SPACING = 1.6;
    const subCount = new Int32Array(nC);
    let nD = 0;
    for (let i = 0; i < nC; i++) {
        const chord = controlChord(aVal[i + 1], bVal[i + 1], aVal[i + 2], bVal[i + 2]);
        subCount[i] = Math.max(4, Math.round(chord / DENSE_SPACING));
        nD += subCount[i];
    }

    const dirX = new Float64Array(nD), dirY = new Float64Array(nD), dirZ = new Float64Array(nD);
    const floorR = new Float64Array(nD);
    const radius = new Float64Array(nD);
    const radiusTmp = new Float64Array(nD);
    const denseIndexOfControl = new Int32Array(nC);

    for (let i = 0, d = 0; i < nC; i++) {
        denseIndexOfControl[i] = d;
        const sub = subCount[i];
        for (let k = 0; k < sub; k++, d++) {
            const k0 = knot[i], k1 = knot[i + 1], k2 = knot[i + 2], k3 = knot[i + 3];
            const u = k1 + (k2 - k1) * (k / sub);
            const a = crNU(aVal[i], aVal[i + 1], aVal[i + 2], aVal[i + 3], k0, k1, k2, k3, u) * DEG;
            const b = crNU(bVal[i], bVal[i + 1], bVal[i + 2], bVal[i + 3], k0, k1, k2, k3, u);
            const alt = crNU(hVal[i], hVal[i + 1], hVal[i + 2], hVal[i + 3], k0, k1, k2, k3, u);
            const ca = Math.cos(a), sa = Math.sin(a);
            let x = F[0] * ca + F[3] * sa + F[6] * b;
            let y = F[1] * ca + F[4] * sa + F[7] * b;
            let z = F[2] * ca + F[5] * sa + F[8] * b;
            const inv = 1 / Math.hypot(x, y, z);
            x *= inv; y *= inv; z *= inv;
            dirX[d] = x; dirY[d] = y; dirZ[d] = z;
            // THE terrain-following line: local floor + authored altitude.
            floorR[d] = floorRadius(x, y, z);
            radius[d] = floorR[d] + Math.max(MIN_CLEARANCE, alt);
        }
    }

    // Great-circle arc length between consecutive dense samples, used to build
    // the world-distance filter window below.
    const step = new Float64Array(nD);
    for (let i = 0; i < nD; i++) {
        const j = (i + 1) % nD;
        let dot = dirX[i] * dirX[j] + dirY[i] * dirY[j] + dirZ[i] * dirZ[j];
        if (dot > 1) dot = 1; else if (dot < -1) dot = -1;
        step[i] = Math.acos(dot) * PLANET_RADIUS;
    }

    // De-corrugate the radial profile (see RADIUS_SMOOTH_PASSES). Triangular
    // weights over a fixed world-distance window, then clamp back above the
    // floor so the terrain invariant survives every pass.
    for (let pass = 0; pass < RADIUS_SMOOTH_PASSES; pass++) {
        for (let i = 0; i < nD; i++) {
            let sum = radius[i], wsum = 1;
            for (let dir = -1; dir <= 1; dir += 2) {
                let dist = 0, j = i;
                while (dist < RADIUS_SMOOTH_RANGE) {
                    const prev = j;
                    j = ((j + dir) % nD + nD) % nD;
                    dist += dir > 0 ? step[prev] : step[j];
                    if (dist >= RADIUS_SMOOTH_RANGE || j === i) break;
                    const w = 1 - dist / RADIUS_SMOOTH_RANGE;
                    sum += radius[j] * w;
                    wsum += w;
                }
            }
            radiusTmp[i] = sum / wsum;
        }
        for (let i = 0; i < nD; i++) {
            const floorMin = floorR[i] + MIN_CLEARANCE;
            radius[i] = radiusTmp[i] > floorMin ? radiusTmp[i] : floorMin;
        }
    }

    const dense = new Array(nD);
    for (let i = 0; i < nD; i++) {
        dense[i] = new THREE.Vector3(dirX[i] * radius[i], dirY[i] * radius[i], dirZ[i] * radius[i]);
    }

    const curve = new THREE.CatmullRomCurve3(dense, true, 'centripetal', 0.5);
    curve.arcLengthDivisions = 2048;
    const totalLength = curve.getLength();

    // --- 3. bake the uniform arc-length sample tables -----------------------
    // Everything downstream (ribbon, gates, sampleAt, nearestT) reads these, so
    // there is exactly one definition of "t" in the whole subsystem.
    const N = tier.sampleCount;
    const samples = new Float32Array((N + 1) * 3);
    const tangents = new Float32Array((N + 1) * 3);
    const _bake = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
        curve.getPointAt((i % N) / N, _bake);
        samples[i * 3] = _bake.x; samples[i * 3 + 1] = _bake.y; samples[i * 3 + 2] = _bake.z;
    }
    for (let i = 0; i <= N; i++) {
        const a = ((i - 1) + N) % N, b = (i + 1) % N;
        let tx = samples[b * 3] - samples[a * 3];
        let ty = samples[b * 3 + 1] - samples[a * 3 + 1];
        let tz = samples[b * 3 + 2] - samples[a * 3 + 2];
        const inv = 1 / Math.max(1e-6, Math.hypot(tx, ty, tz));
        tangents[i * 3] = tx * inv; tangents[i * 3 + 1] = ty * inv; tangents[i * 3 + 2] = tz * inv;
    }

    // ---- runtime samplers (zero allocation) --------------------------------
    function sampleAt(t, out) {
        const w = t - Math.floor(t);
        const f = w * N;
        let i = f | 0; if (i >= N) i = N - 1;
        const s = f - i, i0 = i * 3, i1 = (i + 1) * 3;
        out.x = samples[i0] + (samples[i1] - samples[i0]) * s;
        out.y = samples[i0 + 1] + (samples[i1 + 1] - samples[i0 + 1]) * s;
        out.z = samples[i0 + 2] + (samples[i1 + 2] - samples[i0 + 2]) * s;
        return out;
    }

    function tangentAt(t, out) {
        const w = t - Math.floor(t);
        const f = w * N;
        let i = f | 0; if (i >= N) i = N - 1;
        const s = f - i, i0 = i * 3, i1 = (i + 1) * 3;
        let x = tangents[i0] + (tangents[i1] - tangents[i0]) * s;
        let y = tangents[i0 + 1] + (tangents[i1 + 1] - tangents[i0 + 1]) * s;
        let z = tangents[i0 + 2] + (tangents[i1 + 2] - tangents[i0 + 2]) * s;
        const inv = 1 / Math.max(1e-6, Math.hypot(x, y, z));
        out.x = x * inv; out.y = y * inv; out.z = z * inv;
        return out;
    }

    /**
     * Closest point on the racing line -> t in [0,1). Full scan of the sample
     * table then a sub-sample projection onto the two neighbouring chords.
     *
     * A hinted local window would be ~10x cheaper, but the circuit passes
     * within 30 units of itself at the hairpin, so a hint that goes stale
     * (respawn, knockdown, a racer cutting the corner) would silently latch
     * onto the wrong leg and hand the HUD a lap of bogus progress. 1024
     * squared distances is ~8k flops — for four racers that is noise, and the
     * answer is always right.
     */
    function nearestT(x, y, z) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < N; i++) {
            const o = i * 3;
            const dx = x - samples[o], dy = y - samples[o + 1], dz = z - samples[o + 2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = i; }
        }
        // Refine against the chord on each side.
        let bt = best, bs = 0, bd = bestD;
        for (let k = -1; k <= 0; k++) {
            const i0 = ((best + k) % N + N) % N;
            const i1 = (i0 + 1) % N;
            const ax = samples[i0 * 3], ay = samples[i0 * 3 + 1], az = samples[i0 * 3 + 2];
            const ex = samples[i1 * 3] - ax, ey = samples[i1 * 3 + 1] - ay, ez = samples[i1 * 3 + 2] - az;
            const len2 = ex * ex + ey * ey + ez * ez;
            if (len2 < 1e-9) continue;
            let s = ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len2;
            if (s < 0) s = 0; else if (s > 1) s = 1;
            const px = ax + ex * s - x, py = ay + ey * s - y, pz = az + ez * s - z;
            const d = px * px + py * py + pz * pz;
            if (d < bd) { bd = d; bt = i0; bs = s; }
        }
        const t = (bt + bs) / N;
        return t - Math.floor(t);
    }

    // --- 4. the ribbon ------------------------------------------------------
    // A shallow beam section extruded along the line: a flat strip vanishes
    // when you fly level with it, and the beam keeps a silhouette from every
    // angle. Stripes are baked into vertex colour, so speed reads without a
    // texture and without a second draw call.
    const RS = tier.ribbonSegments;
    const SECT = 6;                       // cross-section vertex count
    const ribbonPos = new Float32Array(RS * SECT * 6 * 3);
    const ribbonNrm = new Float32Array(RS * SECT * 6 * 3);
    const ribbonCol = new Float32Array(RS * SECT * 6 * 3);
    const glowPos = new Float32Array(RS * 4 * 3 * 3);
    const glowCol = new Float32Array(RS * 4 * 3 * 4);

    {
        const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
        const t0 = new THREE.Vector3(), t1 = new THREE.Vector3();
        const e1a = new THREE.Vector3(), e2a = new THREE.Vector3();
        const e1b = new THREE.Vector3(), e2b = new THREE.Vector3();
        const up = new THREE.Vector3();
        const A = [], B = [];
        for (let k = 0; k < SECT; k++) { A.push(new THREE.Vector3()); B.push(new THREE.Vector3()); }
        const nrm = new THREE.Vector3(), ab = new THREE.Vector3(), ad = new THREE.Vector3();

        // Two glowing rails either side of a darker deck. A single flat colour
        // reads as a painted stripe; the rails give the track an edge you can
        // aim at, which is the whole job of a racing line.
        const colRail = new THREE.Color(PALETTE.ribbonEdge);
        const colDeckLit = new THREE.Color(PALETTE.ribbon);
        const colDeckDim = new THREE.Color(PALETTE.ribbon).multiplyScalar(0.30);
        const colUnder = new THREE.Color(PALETTE.ribbon).multiplyScalar(0.3);
        const glowC = new THREE.Color(PALETTE.ribbon);

        const frameAt = (t, e1, e2, p, tan) => {
            sampleAt(t, p); tangentAt(t, tan);
            up.copy(p).normalize();
            e1.copy(up).cross(tan).normalize();
            e2.copy(tan).cross(e1).normalize();
        };
        // Hexagonal section, running CCW about +tangent:
        //   0 right rail tip, 1 deck right, 2 deck left, 3 left rail tip,
        //   4 underside left, 5 underside right.
        const W = RIBBON_HALF_W, D = RIBBON_HALF_W * RIBBON_DECK, H = RIBBON_HALF_H;
        const sectionInto = (out, p, e1, e2) => {
            out[0].copy(p).addScaledVector(e1, W);
            out[1].copy(p).addScaledVector(e1, D).addScaledVector(e2, H);
            out[2].copy(p).addScaledVector(e1, -D).addScaledVector(e2, H);
            out[3].copy(p).addScaledVector(e1, -W);
            out[4].copy(p).addScaledVector(e1, -D).addScaledVector(e2, -H);
            out[5].copy(p).addScaledVector(e1, D).addScaledVector(e2, -H);
        };
        // Which colour each of the six longitudinal faces gets.
        const faceColor = [colRail, null, colRail, colUnder, colUnder, colUnder];

        let vp = 0, gp = 0, gc = 0;
        for (let j = 0; j < RS; j++) {
            const tA = j / RS, tB = (j + 1) / RS;
            frameAt(tA, e1a, e2a, p0, t0);
            frameAt(tB, e1b, e2b, p1, t1);
            sectionInto(A, p0, e1a, e2a);
            sectionInto(B, p1, e1b, e2b);

            // Deck chevrons: 6 lit, 4 dim. At ~2 units per segment that is a
            // 20-unit rhythm, which still reads as motion at racing speed
            // instead of strobing into a flat average.
            const lit = (j % 10) < 6;
            const deck = lit ? colDeckLit : colDeckDim;

            // Quad winding: (a0, a1, b1) then (a0, b1, b0). With the section
            // running CCW about +tangent, that order faces OUT of the beam,
            // which is what the explicit normal below also says.
            const quad = [0, 1, 3, 0, 3, 2]; // indices into [a0, a1, b0, b1]
            for (let k = 0; k < SECT; k++) {
                const k2 = (k + 1) % SECT;
                const corners = [A[k], A[k2], B[k], B[k2]];
                ab.copy(corners[2]).sub(corners[0]);   // along the line
                ad.copy(corners[1]).sub(corners[0]);   // around the section
                nrm.copy(ad).cross(ab).normalize();    // outward
                const c = faceColor[k] || deck;
                const cr_ = c.r, cg_ = c.g, cb_ = c.b;
                for (let q = 0; q < 6; q++) {
                    const v = corners[quad[q]];
                    ribbonPos[vp] = v.x; ribbonPos[vp + 1] = v.y; ribbonPos[vp + 2] = v.z;
                    ribbonNrm[vp] = nrm.x; ribbonNrm[vp + 1] = nrm.y; ribbonNrm[vp + 2] = nrm.z;
                    ribbonCol[vp] = cr_; ribbonCol[vp + 1] = cg_; ribbonCol[vp + 2] = cb_;
                    vp += 3;
                }
            }

            // Glow skirt: a wide additive strip at the ribbon's own altitude,
            // alpha 0 at both edges. This is what keeps the line legible from
            // bird altitude a long way out, where the beam is sub-pixel.
            const w = RIBBON_HALF_W * GLOW_SPREAD;
            const gA = [
                p0.x - e1a.x * w, p0.y - e1a.y * w, p0.z - e1a.z * w,
                p0.x, p0.y, p0.z,
                p0.x + e1a.x * w, p0.y + e1a.y * w, p0.z + e1a.z * w,
            ];
            const gB = [
                p1.x - e1b.x * w, p1.y - e1b.y * w, p1.z - e1b.z * w,
                p1.x, p1.y, p1.z,
                p1.x + e1b.x * w, p1.y + e1b.y * w, p1.z + e1b.z * w,
            ];
            // Additive over a bright golden-hour sky blows out fast: the first
            // captured frame at 0.55 was a solid white wedge that swallowed the
            // beam it was supposed to be haloing.
            const alpha = [0, lit ? 0.16 : 0.09, 0];
            for (let h = 0; h < 2; h++) {
                const srcs = [gA, gA, gB, gA, gB, gB];
                const cols = [h, h + 1, h + 1, h, h + 1, h];
                for (let q = 0; q < 6; q++) {
                    const src = srcs[q], ci = cols[q];
                    glowPos[gp] = src[ci * 3]; glowPos[gp + 1] = src[ci * 3 + 1]; glowPos[gp + 2] = src[ci * 3 + 2];
                    gp += 3;
                    glowCol[gc] = glowC.r; glowCol[gc + 1] = glowC.g; glowCol[gc + 2] = glowC.b;
                    glowCol[gc + 3] = alpha[ci];
                    gc += 4;
                }
            }
        }
    }

    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPos, 3));
    ribbonGeo.setAttribute('normal', new THREE.BufferAttribute(ribbonNrm, 3));
    ribbonGeo.setAttribute('color', new THREE.BufferAttribute(ribbonCol, 3));
    ribbonGeo.computeBoundingSphere();
    const ribbonMat = createToonMaterial(THREE, {
        ramp: 'emissive',
        vertexColors: true,
        emissive: PALETTE.ribbon,
        emissiveIntensity: 0.22,
        rimColor: PALETTE.ribbonEdge,
        rimStrength: 0.85,
        rimThreshold: 0.35,
        specStrength: 0,
        side: THREE.DoubleSide,
    });
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbon.name = 'course-ribbon';
    ribbon.renderOrder = 1;
    group.add(ribbon);
    disposables.push(ribbonGeo, ribbonMat);

    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 4));
    glowGeo.computeBoundingSphere();
    const glowMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.name = 'course-ribbon-glow';
    glow.renderOrder = 0;
    group.add(glow);
    disposables.push(glowGeo, glowMat);

    // --- 5. gates -----------------------------------------------------------
    const gateT = new Float32Array(gateCount);
    const gatePositions = new Float32Array(gateCount * 3);
    for (let i = 0; i < gateCount; i++) gateT[i] = i / gateCount;

    const ringGeo = new THREE.TorusGeometry(GATE_RADIUS, GATE_TUBE, tier.ringRadial, tier.ringTubular);
    ensureSmoothNormals(THREE, ringGeo);
    // No `emissive` here: it is per-material, and gate colour has to be
    // per-instance (idle / next / passed), so a constant emissive would just
    // wash a fixed tint over all three states. The glow comes from a strong
    // rim instead, which also gives the ring a hard cel silhouette.
    const ringMat = createToonMaterial(THREE, {
        ramp: 'graphic',
        rimColor: PALETTE.ribbonEdge,
        rimStrength: 0.95,
        rimPower: 1.9,
        rimThreshold: 0.34,
        specStrength: 0.45,
        specThreshold: 0.5,
    });
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, gateCount);
    rings.name = 'course-gates';
    rings.frustumCulled = false;
    rings.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    group.add(rings);
    disposables.push(ringGeo, ringMat);

    const ringOutlineMat = createOutlineMaterial(THREE, { color: PALETTE.ink, pixels: 2.6, maxPush: 2.2 });
    const ringOutlines = new THREE.InstancedMesh(ringGeo, ringOutlineMat, gateCount);
    ringOutlines.name = 'course-gates-outline';
    ringOutlines.frustumCulled = false;
    ringOutlines.renderOrder = -1;
    ringOutlines.raycast = () => {};
    group.add(ringOutlines);
    disposables.push(ringOutlineMat);

    // Light pillars: a shaft of light through each gate, so a gate that is
    // still over the horizon tells you where it is.
    //
    // Built by hand rather than from CylinderGeometry because the alpha has to
    // fade to nothing at both ends — a constant-alpha additive cylinder reads
    // as a solid white slab clipped off at the top and bottom, which is what
    // the first captured frame showed.
    let pillars = null;
    const pillarGeo = buildLightShaft(THREE, 7, [0, 0.34, 0.62, 1], [0, 0.17, 0.09, 0], [1.35, 0.85, 0.55, 0.22]);
    const pillarMat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    if (tier.pillars) {
        pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, gateCount);
        pillars.name = 'course-gate-pillars';
        pillars.frustumCulled = false;
        pillars.renderOrder = 2;
        group.add(pillars);
    }
    disposables.push(pillarGeo, pillarMat);

    {
        const p = new THREE.Vector3(), tan = new THREE.Vector3();
        const up = new THREE.Vector3(), ex = new THREE.Vector3(), ey = new THREE.Vector3();
        const pex = new THREE.Vector3(), pez = new THREE.Vector3();
        const m = new THREE.Matrix4(), sc = new THREE.Matrix4();
        const pm = new THREE.Matrix4();
        const c = new THREE.Color(PALETTE.gateIdle);
        for (let i = 0; i < gateCount; i++) {
            sampleAt(gateT[i], p);
            tangentAt(gateT[i], tan);
            gatePositions[i * 3] = p.x; gatePositions[i * 3 + 1] = p.y; gatePositions[i * 3 + 2] = p.z;

            up.copy(p).normalize();
            ey.copy(up).addScaledVector(tan, -up.dot(tan)).normalize();
            ex.copy(ey).cross(tan).normalize();
            // Torus lies in XY with its axis on +Z, so +Z must be the tangent.
            m.makeBasis(ex, ey, tan);
            m.setPosition(p.x, p.y, p.z);
            const s = i === 0 ? 1.34 : 1;
            if (s !== 1) { sc.makeScale(s, s, s); m.multiply(sc); }
            rings.setMatrixAt(i, m);
            ringOutlines.setMatrixAt(i, m);
            rings.setColorAt(i, c);

            if (pillars) {
                // The shaft geometry runs y = 0..1 from its base, so the
                // instance sits ON the ground and scales up through the gate.
                const groundR = floorRadius(up.x, up.y, up.z) - 4;
                const topR = p.length() + 30;
                pex.copy(up).cross(tan).normalize();
                pez.copy(pex).cross(up).normalize();
                pm.makeBasis(pex, up, pez);
                pm.setPosition(up.x * groundR, up.y * groundR, up.z * groundR);
                sc.makeScale(1.9 * s, topR - groundR, 1.9 * s);
                pm.multiply(sc);
                pillars.setMatrixAt(i, pm);
                pillars.setColorAt(i, c);
            }
        }
        rings.instanceMatrix.needsUpdate = true;
        ringOutlines.instanceMatrix.needsUpdate = true;
        if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
        if (pillars) {
            pillars.instanceMatrix.needsUpdate = true;
            if (pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
        }
    }

    // --- 6. start/finish gantry --------------------------------------------
    // Built in a local frame (X lateral, Y up, Z along the line) and placed by
    // the group transform, so no vertex ever has to be transformed by hand.
    let gantry = null;
    {
        const P = [], Nn = [], C = [];
        const cream = new THREE.Color(PALETTE.uiCream);
        const ink = new THREE.Color(PALETTE.inkSoft);
        const gold = new THREE.Color(PALETTE.uiGold);

        // The gate-0 ring is 1.34x scale, so the gantry has to clear r=12 in
        // both axes or it reads as a fence in front of the gate rather than an
        // arch over it. Local Y is radial, so -14 puts the post feet on the
        // ground (gate 0 sits ~15 above the local floor).
        const postX = GATE_RADIUS * 1.34 + 2.8;
        const footY = -14;
        const beamY = 17;
        const postHalf = (beamY - footY) * 0.5;
        pushBox(P, Nn, C, -postX, footY + postHalf, 0, 1.15, postHalf, 1.15, gold.r, gold.g, gold.b);
        pushBox(P, Nn, C, postX, footY + postHalf, 0, 1.15, postHalf, 1.15, gold.r, gold.g, gold.b);
        // Cross beam + checkered banner hanging under it.
        pushBox(P, Nn, C, 0, beamY + 1.5, 0, postX + 1.15, 1.5, 1.3, gold.r, gold.g, gold.b);
        const cells = 10;
        const cw = postX / cells;
        for (let i = 0; i < cells * 2; i++) {
            const cx = -postX + cw * (i + 0.5);
            const col = (i & 1) === 0 ? cream : ink;
            pushBox(P, Nn, C, cx, beamY - 1.8, 0, cw * 0.5, 1.8, 0.65, col.r, col.g, col.b);
        }

        const gGeo = new THREE.BufferGeometry();
        gGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        gGeo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
        gGeo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        gGeo.computeBoundingSphere();
        const gMat = createToonMaterial(THREE, {
            ramp: 'graphic', vertexColors: true, rimStrength: 0.45, specStrength: 0.25,
        });
        gantry = new THREE.Mesh(gGeo, gMat);
        gantry.name = 'course-gantry';
        attachOutline(THREE, gantry, { color: PALETTE.ink, pixels: 2.6, maxPush: 2.0 });

        const p = new THREE.Vector3(), tan = new THREE.Vector3();
        const up = new THREE.Vector3(), ex = new THREE.Vector3(), ey = new THREE.Vector3();
        sampleAt(0, p); tangentAt(0, tan);
        up.copy(p).normalize();
        ey.copy(up).addScaledVector(tan, -up.dot(tan)).normalize();
        ex.copy(ey).cross(tan).normalize();
        gantry.matrixAutoUpdate = false;
        gantry.matrix.makeBasis(ex, ey, tan);
        gantry.matrix.setPosition(p.x, p.y, p.z);
        gantry.matrixWorldNeedsUpdate = true;
        group.add(gantry);
        disposables.push(gGeo, gMat);
    }

    // --- 7. measured character report ---------------------------------------
    // Claims about "a hairpin" are worthless unless the geometry agrees, so the
    // curvature is sampled here and exposed for the probe to print.
    const CURV_N = 256;
    const curvature = new Float32Array(CURV_N);
    let minRadius = Infinity, maxRadius = -Infinity, minAbove = Infinity;
    {
        const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
        const ds = totalLength / CURV_N;
        for (let i = 0; i < CURV_N; i++) {
            tangentAt(i / CURV_N, a);
            tangentAt(((i + 1) % CURV_N) / CURV_N, b);
            let d = a.dot(b); if (d > 1) d = 1; else if (d < -1) d = -1;
            curvature[i] = (Math.acos(d) / DEG) / ds;
            sampleAt(i / CURV_N, p);
            const r = p.length();
            if (r < minRadius) minRadius = r;
            if (r > maxRadius) maxRadius = r;
            const inv = 1 / r;
            const above = r - floorRadius(p.x * inv, p.y * inv, p.z * inv);
            if (above < minAbove) minAbove = above;
        }
    }

    // Map each authored segment onto a t range via its dense-point index.
    const segReport = [];
    for (let s = 0; s < SEGMENTS.length; s++) {
        const seg = SEGMENTS[s];
        const tFrom = nearestT(dense[denseIndexOfControl[seg.from]].x, dense[denseIndexOfControl[seg.from]].y, dense[denseIndexOfControl[seg.from]].z);
        const dEnd = dense[(denseIndexOfControl[seg.to] + subCount[seg.to]) % dense.length];
        const tTo = nearestT(dEnd.x, dEnd.y, dEnd.z);
        let sum = 0, peak = 0, count = 0;
        let lo = Infinity, hi = -Infinity;
        const pv = new THREE.Vector3();
        for (let i = 0; i < CURV_N; i++) {
            const t = i / CURV_N;
            const inSeg = tFrom <= tTo ? (t >= tFrom && t < tTo) : (t >= tFrom || t < tTo);
            if (!inSeg) continue;
            sum += curvature[i];
            if (curvature[i] > peak) peak = curvature[i];
            count++;
            sampleAt(t, pv);
            const r = pv.length();
            if (r < lo) lo = r; if (r > hi) hi = r;
        }
        segReport.push({
            name: seg.name,
            tFrom, tTo,
            meanCurvature: count ? sum / count : 0,
            peakCurvature: peak,
            minRadius: lo, maxRadius: hi,
        });
    }

    let report = `course seed=${seed} len=${totalLength.toFixed(1)}u  frameScore=${chosen.score.toFixed(3)}\n`;
    report += `radius ${minRadius.toFixed(1)}..${maxRadius.toFixed(1)} (baseline ${PLANET_RADIUS})  minAboveFloor=${minAbove.toFixed(2)}\n`;
    report += `belowBaseline=${(minRadius < PLANET_RADIUS ? (PLANET_RADIUS - minRadius).toFixed(1) + 'u' : 'NO')}\n`;
    for (let i = 0; i < segReport.length; i++) {
        const r = segReport[i];
        report += `${r.name.padEnd(14)} curv mean ${r.meanCurvature.toFixed(2)} peak ${r.peakCurvature.toFixed(2)} deg/u  r ${r.minRadius.toFixed(0)}..${r.maxRadius.toFixed(0)}\n`;
    }

    // --- 8. runtime ---------------------------------------------------------
    const _cIdle = new THREE.Color(PALETTE.gateIdle);
    const _cNext = new THREE.Color(PALETTE.gateNext);
    const _cPassed = new THREE.Color(PALETTE.gatePassed);
    const _cScratch = new THREE.Color();
    let _next = -1;
    let _time = 0;

    function paintGate(i, color) {
        rings.setColorAt(i, color);
        if (pillars) pillars.setColorAt(i, color);
    }

    /**
     * Recolour for a new "next gate". Gates less than half a lap ahead read as
     * idle; the ones behind you dim to `gatePassed` so the circuit tells you
     * which way round it goes even with the HUD off.
     */
    function setNextGate(index) {
        _next = ((index % gateCount) + gateCount) % gateCount;
        const half = gateCount * 0.5;
        for (let i = 0; i < gateCount; i++) {
            const d = (i - _next + gateCount) % gateCount;
            if (d === 0) paintGate(i, _cNext);
            else if (d > half) paintGate(i, _cPassed);
            else paintGate(i, _cIdle);
        }
        if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
        if (pillars && pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
    }

    function update(dt) {
        _time += dt;
        if (_next < 0) return;
        // Only the next gate animates: one instance colour write per frame.
        const pulse = 0.5 + 0.5 * Math.sin(_time * 5.2);
        _cScratch.copy(_cNext);
        _cScratch.r = _cNext.r + (1 - _cNext.r) * pulse * 0.6;
        _cScratch.g = _cNext.g + (1 - _cNext.g) * pulse * 0.6;
        _cScratch.b = _cNext.b + (1 - _cNext.b) * pulse * 0.6;
        paintGate(_next, _cScratch);
        if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
        if (pillars && pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
    }

    function dispose() {
        for (let i = 0; i < disposables.length; i++) {
            const d = disposables[i];
            if (d && typeof d.dispose === 'function') d.dispose();
        }
        disposables.length = 0;
        group.clear();
    }

    setNextGate(1);

    const triangleCount =
        RS * SECT * 2 +                                   // ribbon beam
        RS * 4 +                                          // glow skirt
        tier.ringRadial * tier.ringTubular * 2 * gateCount * 2 + // rings + hulls
        (tier.pillars ? 42 * gateCount : 0) +                    // 7 sides x 3 bands x 2
        (gantry ? (3 + 20) * 12 * 2 : 0);                 // gantry + hull
    const drawCallCount = 5 + (tier.pillars ? 1 : 0) + (gantry ? 1 : 0);

    return {
        group,
        curve,
        gateCount,
        gatePositions,
        gateT,
        sampleAt,
        tangentAt,
        nearestT,
        setNextGate,
        update,
        dispose,

        // --- measured, for probes / HUD / AI -------------------------------
        length: totalLength,
        curvature,
        segments: segReport,
        characterReport: report,
        minRadius,
        maxRadius,
        triangleCount,
        drawCallCount,
    };
}
