/**
 * model/figure.js - one of six alternating bronze reliefs, built from curves.
 *
 * Nothing here is loaded. The whole sculpture is generated from profile curves,
 * swept cast sections and signed-distance fields, so it works offline, ships as
 * source, and — the part that matters for this job — every proportion is a
 * NUMBER you can tune against a photograph rather than a vertex you would have
 * to sculpt.
 *
 * ---------------------------------------------------------------------------
 * ANATOMY OF ONE RELIEF, as read across the four reference photos
 * ---------------------------------------------------------------------------
 *
 *   COWL      One thick swept plate standing BEHIND the body. It stays open its
 *             full height, rises into the collar-arch and trails on the paving;
 *             the front skirt is not part of this shell.
 *   BODY      One blended distance field from skirt hem to collarbone: tapered
 *             elliptical trunk, bust, shoulders, arms and the narrative forms.
 *             It is heavy and columnar, not a pinched lathe or a flared bell.
 *   ARMS      Six reference-led roles, not one generic pair copied across the cast.
 *             The nearest arm bows clear of the ribs; the pregnant figure
 *             supports her belly; the mother's forearms cross under the baby;
 *             the clinician carries one arm back beside the stethoscope.
 *   BREASTS   Bold ellipsoidal relief blended into the chest with a fillet well
 *             smaller than the protrusion. Separate hemispheres and over-large
 *             blends both produced applied lumps or erased the form entirely.
 *   HEAD      A tapered cast head with a broad planar face, rounded crown and
 *             distinct jaw. The face is deliberately reduced but its features
 *             must survive the fine head mesher at group distance.
 *   FEET      One fine closed foot overlaps deeply beneath each raised hem,
 *             broad through the forefoot and seated under the skirt. Keeping it
 *             outside the coarse body field preserves the toe silhouette.
 *
 * Units are metres. The figures stand about 2.3m; a person walks past one in
 * `ref-d-wide.jpg` for scale.
 */

import { fbm3 } from '../core/noise.js';
import {
    sdEllipsoid, sdCapsule, sdRoundBox, sdTriPrism,
    smin, smax, subtract, surfaceNets, marchingTetrahedra,
} from './sdf.js';

/**
 * Approximate distance to a capsule whose radius tapers along its centreline.
 * The ordinary capsule is useful for bones but reads as pipework on the long,
 * reduced arms in the reference. Interpolating the radius gives the limb a
 * shoulder-to-wrist silhouette while preserving rounded, closed ends.
 */
function sdTaperedCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const pax = px - ax, pay = py - ay, paz = pz - az;
    const len2 = bax * bax + bay * bay + baz * baz || 1;
    const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / len2));
    const qx = pax - bax * h, qy = pay - bay * h, qz = paz - baz * h;
    return Math.hypot(qx, qy, qz) - (ra + (rb - ra) * h);
}

/**
 * A tapered capsule with an elliptical cross-section in the sculpture's X/Z
 * plane. The reference arms are flattened cast reliefs, not round rails. The
 * transformed field is not an exact Euclidean distance, but its zero set is
 * exact and that is what the mesher needs.
 */
function sdReliefCapsule(
    px, py, pz,
    ax, ay, az, bx, by, bz,
    ra, rb,
    widthScale = 1,
    depthScale = 0.72,
) {
    const sx = Math.max(0.2, widthScale);
    const sz = Math.max(0.2, depthScale);
    return sdTaperedCapsule(
        px / sx, py, pz / sz,
        ax / sx, ay, az / sz,
        bx / sx, by, bz / sz,
        ra, rb,
    ) * Math.min(1, sx, sz);
}

// ---------------------------------------------------------------------------
// Profile curves
// ---------------------------------------------------------------------------

/**
 * Per-figure arm paths, in local metres.
 *
 * Phase 3 left every figure with the same two capsules pressed against the
 * ribs. That kept the silhouette measurements green, but it erased the gesture:
 * no daylight beside the nearest figure, no crossed support under the baby and
 * no way to distinguish one woman's arms from another's at group distance.
 *
 * Each arm is a shoulder point, an elbow and a wrist. The shoulder centre stays
 * close to the measured outer silhouette; only the path below it changes. This
 * keeps the hard-won mass proportions while allowing the arm to peel away from
 * the trunk. Radius tapers continuously into a reduced cast tip; supporting
 * wrists terminate inside their gesture instead of growing separate hand blobs.
 */
export const ARM_POSES = Object.freeze({
    open: [
        // Nearest figure: her left arm makes the reference's clear wedge of sky
        // between arm and ribs. The other arm stays close and is partly lost in
        // the crowded group, as it is in ref-a-front.
        { shoulder: [-0.298, 1.820, 0.000], elbow: [-0.348, 1.500, 0.030], wrist: [-0.352, 0.885, 0.070], upper: 0.064, fore: 0.054, end: 0.036, hand: 0.030 },
        { shoulder: [ 0.298, 1.820, 0.000], elbow: [ 0.338, 1.500, 0.028], wrist: [ 0.340, 0.920, 0.074], upper: 0.064, fore: 0.054, end: 0.036, hand: 0.030 },
    ],
    developing: [
        // The departing foreground figure has one planted side arm and one
        // unmistakable diagonal forearm across the lower abdomen. This gesture
        // is visible in ref-a and is a stronger identifier than another pair of
        // generic hanging rails.
        { shoulder: [-0.298, 1.820, -0.004], elbow: [-0.342, 1.500, 0.018], wrist: [-0.340, 0.860, 0.054], upper: 0.064, fore: 0.052, end: 0.030, hand: 0.024, depth: 0.58, width: 1.08 },
        { shoulder: [ 0.298, 1.820, 0.000], elbow: [ 0.286, 1.475, 0.040], wrist: [ 0.126, 1.130, 0.142], upper: 0.064, fore: 0.054, end: 0.043, tip: [-0.082, 1.018, 0.166], tipEnd: 0.026, depth: 0.66, gestureDepth: 0.66, width: 1.12 },
    ],
    pregnant: [
        // Neither hospital-side reference shows an arm cupping the pregnancy.
        // Both limbs are shallow flank reliefs, leaving the round abdominal
        // silhouette uninterrupted instead of inventing a detached U-shape.
        { shoulder: [-0.296, 1.812, -0.008], elbow: [-0.322, 1.505, 0.000], wrist: [-0.318, 1.000, 0.020], upper: 0.055, fore: 0.042, end: 0.020, hand: 0.008, depth: 0.42, width: 1.12 },
        { shoulder: [ 0.296, 1.812, -0.008], elbow: [ 0.320, 1.505, -0.002], wrist: [ 0.312, 1.020, 0.018], upper: 0.054, fore: 0.041, end: 0.019, hand: 0.008, depth: 0.40, width: 1.12 },
    ],
    cradle: [
        // The near forearm curves beneath the newborn as one U-shaped support.
        // The far forearm returns into the wrapped block and disappears there
        // instead of forming a second competing horizontal rail.
        { shoulder: [-0.298, 1.820, 0.000], elbow: [-0.350, 1.555, 0.044], wrist: [-0.225, 1.310, 0.285], upper: 0.069, fore: 0.060, end: 0.050, support: [[-0.120, 1.285, 0.330], [-0.010, 1.250, 0.345], [0.110, 1.265, 0.350], [0.205, 1.315, 0.330]], supportEnd: 0.040, gestureDepth: 0.74 },
        { shoulder: [ 0.298, 1.820, 0.000], elbow: [ 0.346, 1.515, 0.040], wrist: [ 0.210, 1.350, 0.242], upper: 0.064, fore: 0.056, end: 0.046, tip: [ 0.125, 1.325, 0.292], tipEnd: 0.030, depth: 0.72, gestureDepth: 0.74 },
    ],
    clinical: [
        // The clinician's near arm hangs straight while the far arm sweeps a
        // little back and out. That leaves the stethoscope and chest unobscured
        // and gives her a different side silhouette from the open figure.
        { shoulder: [-0.294, 1.812, -0.010], elbow: [-0.320, 1.515, -0.004], wrist: [-0.312, 1.055, 0.018], upper: 0.054, fore: 0.041, end: 0.019, hand: 0.008, depth: 0.44, width: 1.12 },
        { shoulder: [ 0.294, 1.812, -0.010], elbow: [ 0.322, 1.510, -0.006], wrist: [ 0.318, 1.080, 0.014], upper: 0.053, fore: 0.040, end: 0.018, hand: 0.006, depth: 0.42, width: 1.12 },
    ],
    visitor: [
        // Both arms are mostly swallowed by the folded sheet in the outward
        // oblique reference. Keep shallow side seams instead of two pipes.
        { shoulder: [-0.292, 1.810, -0.004], elbow: [-0.320, 1.505, 0.004], wrist: [-0.316, 1.030, 0.030], upper: 0.055, fore: 0.042, end: 0.020, hand: 0.010, depth: 0.48, width: 1.12 },
        { shoulder: [ 0.292, 1.810, -0.006], elbow: [ 0.316, 1.510, 0.000], wrist: [ 0.314, 1.075, 0.024], upper: 0.054, fore: 0.041, end: 0.019, hand: 0.008, depth: 0.46, width: 1.10 },
    ],
    badge: [
        // The badge-side relief reads as a broad uninterrupted torso. Its arms
        // are cast into the flank and should not become detached vertical rods.
        { shoulder: [-0.294, 1.812, -0.010], elbow: [-0.316, 1.515, -0.002], wrist: [-0.310, 1.060, 0.018], upper: 0.053, fore: 0.040, end: 0.018, hand: 0.006, depth: 0.42, width: 1.14 },
        { shoulder: [ 0.294, 1.812, -0.010], elbow: [ 0.318, 1.515, -0.004], wrist: [ 0.312, 1.075, 0.016], upper: 0.052, fore: 0.039, end: 0.018, hand: 0.006, depth: 0.42, width: 1.14 },
    ],
});


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sample a [t, ...] keyframe table at `t`, linearly. */
function sampleProfile(table, t) {
    const asc = table[0][0] < table[table.length - 1][0];
    const rows = asc ? table : table.slice().reverse();
    if (t <= rows[0][0]) return rows[0].slice(1);
    if (t >= rows[rows.length - 1][0]) return rows[rows.length - 1].slice(1);
    for (let i = 1; i < rows.length; i++) {
        if (t <= rows[i][0]) {
            const a = rows[i - 1], b = rows[i];
            const k = (t - a[0]) / (b[0] - a[0]);
            const out = [];
            for (let j = 1; j < a.length; j++) out.push(a[j] + (b[j] - a[j]) * k);
            return out;
        }
    }
    return rows[rows.length - 1].slice(1);
}

/**
 * Cubic Hermite sampling for sculpted body contours.
 *
 * Linear interpolation leaves a visible change of surface slope at every
 * measured height, especially across the pregnancy. Neighbour-derived slopes
 * preserve the measured values while keeping the generated surface C1 smooth.
 */
function sampleSmoothProfile(table, t) {
    const asc = table[0][0] < table[table.length - 1][0];
    const rows = asc ? table : table.slice().reverse();
    if (t <= rows[0][0]) return rows[0].slice(1);
    if (t >= rows[rows.length - 1][0]) return rows[rows.length - 1].slice(1);
    for (let i = 1; i < rows.length; i++) {
        if (t > rows[i][0]) continue;
        const p0 = rows[Math.max(0, i - 2)];
        const p1 = rows[i - 1];
        const p2 = rows[i];
        const p3 = rows[Math.min(rows.length - 1, i + 1)];
        const span = p2[0] - p1[0];
        const u = (t - p1[0]) / span;
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        const out = [];
        for (let j = 1; j < p1.length; j++) {
            const m1 = (p2[j] - p0[j]) / (p2[0] - p0[0] || 1);
            const m2 = (p3[j] - p1[j]) / (p3[0] - p1[0] || 1);
            out.push(h00 * p1[j] + h10 * span * m1
                + h01 * p2[j] + h11 * span * m2);
        }
        return out;
    }
    return rows[rows.length - 1].slice(1);
}

/**
 * Displace every vertex along its own normal by fractal noise, then rebuild
 * normals.
 *
 * This is the single most important line in the file for likeness. A lathed
 * surface is perfectly smooth and reads as machined; the originals were pushed
 * into shape by hand and hold every one of those pushes. `scale` sets the size
 * of the lumps and `amount` how deep they go.
 */
function roughen(THREE, geo, {
    amount = 0.012, scale = 3.2, seed = 1, octaves = 2,
    topFadeStart = Infinity, topFadeEnd = Infinity, topAttenuation = 1,
} = {}) {
    geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        let gain = 1;
        if (y > topFadeStart) {
            const span = Math.max(1e-6, topFadeEnd - topFadeStart);
            const t = Math.min(1, Math.max(0, (y - topFadeStart) / span));
            const eased = t * t * (3 - 2 * t);
            gain += (topAttenuation - 1) * eased;
        }
        const d = fbm3(x * scale, y * scale, z * scale, seed, octaves) * amount * gain;
        pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/**
 * The cloak and collar-arch, as ONE swept cast shell.
 *
 * This started as a body robe with a separate cowl around it, and that was the
 * first structural failure: a cowl whose radius is only a little larger than
 * the body presents only two vertical rails to a front camera. Later reference
 * work settled the other half of the structure: the front skirt belongs to the
 * BODY field and the cloak is a plate behind it, open for its full height. The
 * invariant is therefore specific: the trailing cloak and the collar-arch are
 * one cast shell; do not split the cowl off and do not close the shell round the
 * body again.
 *
 * The cross-section is a crescent (outer wall, inner wall, closed at the rim),
 * so the casting has real wall thickness and every free edge shows section.
 * `FRONT_OPENING` removes the whole front through the body and face. Only its
 * terminal rings converge above the crown, forming the arch without turning the
 * lower shell back into a closed robe.
 */
const SHELL_PROFILE = [
    // [height, halfWidthX, halfDepthZ]
    //
    // FLAT. The profile references show the cloak is a PANEL — wide across and
    // thin front-to-back, so the group reads as a folded screen rather than as
    // four barrels. Depth never exceeds about half the width, and the hem
    // spreads wide where the cloth pools on the paving.
    // NARROW ACROSS, DEEP FRONT-TO-BACK at the hem. Measured off
    // `ref-a-front.jpg`: the nearest figure's skirt spans about 0.31 of her
    // height at the ground, barely more than her shoulders — she is a column
    // seen head-on. The wide flared bell in `ref-c-under.jpg` is the same cloth
    // seen from a low three-quarter: the pooling goes BACKWARD, which is the
    // train, not sideways. Built at 0.46 of height the figures read as four
    // bells and the diagonal arrangement disappeared into one skirt.
    // The hem is narrow in BOTH directions. Depth at the ground belongs to the
    // TRAIN, which trails behind her; a deep ring just makes a crinoline, and
    // read from a low angle that is exactly what 0.43 looked like.
    [0.000, 0.449, 0.296],
    [0.120, 0.436, 0.284],
    [0.320, 0.418, 0.264],
    [0.560, 0.404, 0.246],
    [0.800, 0.396, 0.232],
    [1.000, 0.390, 0.234],
    [1.160, 0.390, 0.216],
    [1.300, 0.392, 0.202],
    [1.420, 0.394, 0.192],
    [1.520, 0.396, 0.184],
    [1.610, 0.398, 0.178],
    [1.700, 0.398, 0.174],
    [1.800, 0.396, 0.170],
    [1.849, 0.392, 0.166],   // shoulder line
    // The shoulder sheet narrows quickly to head width, then stays broad and
    // nearly vertical around the crown. Continuing the taper to the terminal
    // ring made a tent; the photographs show a rounded rectangular cowl with
    // roughly a hand's breadth of clearance around the head.
    [2.000, 0.280, 0.145],
    [2.100, 0.250, 0.138],
    [2.240, 0.235, 0.132],
    [2.320, 0.230, 0.128],
    [2.380, 0.225, 0.124],
    [2.420, 0.220, 0.120],
    [2.440, 0.215, 0.118],
];

/**
 * [height, halfAngle of the FRONT opening]. Zero = a closed robe.
 *
 * THE WHOLE FRONT IS OPEN, and getting this wrong is what made every earlier
 * render a row of ghosts. Read `ref-c-under.jpg`, where the group is silhouetted
 * against sky: the cloak is a THIN SHEET STANDING BEHIND EACH WOMAN. It covers
 * her back, curls a little round her sides, and rises into a hollow collar-arch
 * behind her head — and that is all it does. Her face, throat, shoulders,
 * breasts and belly are in open air, in front of it, catching the sun.
 *
 * So at chest height the opening is about 1.5 rad EACH SIDE — roughly 170 deg of
 * the circle simply is not there — and it remains open at the ground. The smooth
 * front surface down to the paving is the skirt in `buildBodyField`, not a cloak
 * that closes round the legs.
 *
 * The earlier table opened 0.55 rad at the chest and 1.92 at the crown, which
 * left a near-complete tube standing in front of the body with a slot cut in it.
 * The body was fully modelled the whole time; you could not see any of it.
 */
const FRONT_OPENING = [
    // IT NEVER CLOSES BELOW THE CROWN. Earlier versions ran it to zero by knee height,
    // which turned the cloak into a tube below the hip and put a deep dark V up
    // the front of every figure where its two rims converged. No amount of
    // moving these keyframes removed that notch, because the notch was the
    // structure: a cloak that closes has to close SOMEWHERE.
    //
    // The photographs show it does not. She wears a long skirt — that is the
    // smooth continuous surface down the front of her in `ref-a-front.jpg` — and
    // the cloak is a panel hanging BEHIND it, open through the complete body
    // and face. The only convergence is the short arch above the crown. So the
    // skirt is now part of the body field (see TORSO_PROFILE, which runs to the
    // ground) and the cloak just stays open.
    [0.000, 1.10],
    [0.300, 1.12],
    [0.620, 1.16],
    [0.900, 1.20],
    [1.120, 1.24],
    [1.320, 1.28],
    [1.520, 1.34],
    [1.700, 1.46],
    [1.849, 1.58],   // shoulder
    // Above the shoulders the cowl remains a folded sheet behind the head. Its
    // front opening narrows only slightly: closing it over every crown creates
    // six repeated hoops that are absent from the reference silhouettes.
    [2.030, 1.55],
    [2.180, 1.50],
    [2.300, 1.44],
    [2.380, 1.36],
    [2.440, 1.30],
];

/**
 * How far behind the body's own axis the cloak hangs, at height `y`.
 *
 * The companion fix to `FRONT_OPENING`, and just as load-bearing. A cloak hangs
 * from the shoulders, so up there its axis is well behind the spine, while at
 * the hem the cloth has fallen round the ankles and shares the body's axis. With
 * a shared axis all the way up, the shell's rim passes through the chest no
 * matter how wide the opening is, and the bust is buried in bronze.
 */
function shellOffsetZ(y) {
    const t = Math.min(1, Math.max(0, (y - 0.55) / 0.95));
    const shoulderT = Math.min(1, Math.max(0, (y - 1.80) / 0.46));
    const bodyEase = t * t * (3 - 2 * t);
    const crownEase = shoulderT * shoulderT * (3 - 2 * shoulderT);
    return -0.150 * bodyEase - 0.070 * crownEase;
}

/**
 * Wall thickness of the casting, in metres, and the radius of the bead that
 * rounds every free edge.
 *
 * This is a LOOK, not a detail. The cloak's edges are the most-seen lines in the
 * whole model — they draw the silhouette of the collar-arch and both sides of
 * the open front — and at 0.040 with the two walls meeting in a hard fold they
 * read as cut paper. A cast bronze sheet shows its section: a rounded bead with
 * a highlight along the top of it and a shadow under. Rounding those edges is
 * also what removes the hard V-notch where the front opening closes, which no
 * amount of moving the opening's keyframes ever fixed, because the notch was
 * never the opening — it was the edge having no thickness to show.
 */
const WALL = 0.055;


/**
 * Two closed side wings around an exposed reverse relief.
 *
 * The original crescent closed across the complete rear of every figure. That
 * was manifold, but it hid the negative body field and turned the group into
 * six convex columns. These wings retain the photographed swept rims and cast
 * thickness while leaving the central rear torso visible.
 */
function buildReliefShell(THREE, opts) {
    const RINGS = 76;
    const ARC = 22;
    const RIM = 5;
    const WINGS = 2;
    const yTop = Math.min(opts.cowlTop, 2.44);
    const loop = (ARC + 1) * 2 + (RIM - 1) * 2;
    const positions = [];
    const indices = [];
    const vertex = (wing, ring, section) =>
        ((wing * (RINGS + 1) + ring) * loop + section);

    for (let wing = 0; wing < WINGS; wing++) {
        for (let ring = 0; ring <= RINGS; ring++) {
            const y = ring / RINGS * yTop;
            const [hw, hd] = sampleProfile(SHELL_PROFILE, y);
            const frontOpen = sampleProfile(FRONT_OPENING, y)[0] * opts.openScale;
            const zOff = shellOffsetZ(y);
            const capT = Math.max(0, (y - (yTop - 0.28)) / 0.28);
            const cap = 1 - 0.10 * capT * capT;
            const closeT = Math.min(1, Math.max(0, (y - (yTop - 0.16)) / 0.16));
            const closeEase = closeT * closeT * (3 - 2 * closeT);
            const rearOpen = 0.72 + (0.10 - 0.72) * closeEase;
            const start = wing === 0 ? frontOpen : Math.PI + rearOpen;
            const end = wing === 0 ? Math.PI - rearOpen : Math.PI * 2 - frontOpen;

            const kIn = 1 - WALL / Math.max(hw, 0.06);
            const midR = (1 + kIn) * 0.5;
            const halfT = (1 - kIn) * 0.5;
            const rimRad = WALL / (2 * Math.max(hw, 0.06));
            const section = [];
            for (let s = 0; s <= ARC; s++) {
                section.push([start + (end - start) * s / ARC, 1]);
            }
            for (let i = 1; i < RIM; i++) {
                const phase = Math.PI * i / RIM;
                section.push([
                    end + rimRad * Math.sin(phase),
                    midR + halfT * Math.cos(phase),
                ]);
            }
            for (let s = 0; s <= ARC; s++) {
                section.push([end - (end - start) * s / ARC, kIn]);
            }
            for (let i = 1; i < RIM; i++) {
                const phase = Math.PI * i / RIM;
                section.push([
                    start - rimRad * Math.sin(phase),
                    midR - halfT * Math.cos(phase),
                ]);
            }

            for (const [theta, radius] of section) {
                const cs = Math.cos(theta);
                const sn = Math.sin(theta);
                const flat = 1 - 0.09 * Math.pow(Math.abs(cs), 3);
                const trail = Math.max(0, Math.cos(theta - opts.trainAngle));
                const low = Math.pow(Math.max(0, 1 - y / 0.58), 2.6);
                const tail = opts.trainAmount * trail * trail * low;
                const rake = opts.hemRake
                    * Math.max(0, Math.cos(theta - opts.strideAngle))
                    * Math.pow(Math.max(0, 1 - y / 0.62), 2.0);
                const gather = Math.pow(Math.max(0, 1 - y / 1.85), 1.35);
                const depth = (0.026 + 0.058 * gather) * opts.foldDepth;
                const fold = 1
                    + depth * Math.cos(theta * opts.folds + y * 0.55 + opts.foldPhase)
                    + depth * 0.42 * Math.cos(
                        theta * (opts.folds * 2 + 1)
                        - y * 0.9
                        + opts.foldPhase * 1.7
                    );
                positions.push(
                    sn * hw * cap * radius * fold
                        + Math.sin(opts.trainAngle) * tail
                        + y * opts.sweepLean,
                    y + rake,
                    cs * hd * cap * flat * radius * fold
                        + zOff
                        + Math.cos(opts.trainAngle) * tail
                );
            }
        }
    }

    for (let wing = 0; wing < WINGS; wing++) {
        for (let ring = 0; ring < RINGS; ring++) {
            for (let section = 0; section < loop; section++) {
                const next = (section + 1) % loop;
                const a = vertex(wing, ring, section);
                const b = vertex(wing, ring, next);
                const c = vertex(wing, ring + 1, section);
                const d = vertex(wing, ring + 1, next);
                indices.push(a, b, c, b, d, c);
            }
        }
    }

    const capRing = (wing, ring, outwardY) => {
        const offset = vertex(wing, ring, 0);
        const contour = [];
        for (let section = 0; section < loop; section++) {
            contour.push(new THREE.Vector2(
                positions[(offset + section) * 3],
                positions[(offset + section) * 3 + 2]
            ));
        }
        for (const face of THREE.ShapeUtils.triangulateShape(contour, [])) {
            let a = offset + face[0];
            let b = offset + face[1];
            let c = offset + face[2];
            const ax = positions[a * 3], az = positions[a * 3 + 2];
            const bx = positions[b * 3], bz = positions[b * 3 + 2];
            const cx = positions[c * 3], cz = positions[c * 3 + 2];
            const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
            if (ny * outwardY < 0) [b, c] = [c, b];
            indices.push(a, b, c);
        }
    };
    for (let wing = 0; wing < WINGS; wing++) {
        capRing(wing, 0, -1);
        capRing(wing, RINGS, 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setIndex(indices);
    const finishStart = yTop - 0.24;
    roughen(THREE, geometry, {
        amount: 0.020,
        scale: 2.0,
        seed: opts.seed,
        topFadeStart: finishStart,
        topFadeEnd: yTop,
        topAttenuation: 0.18,
    });
    return roughen(THREE, geometry, {
        amount: 0.0060,
        scale: 10.5,
        seed: opts.seed + 9,
        topFadeStart: finishStart,
        topFadeEnd: yTop,
        topAttenuation: 0.42,
    });
}
/**
 * Closed recessed plate inside one collar arch.
 *
 * The swept shell deliberately leaves its rear centre open so the negative
 * body and blank head can project from it. Without a backing surface, however,
 * the clearance around that head reads as a handle-shaped hole through the
 * casting. This shallow tapered prism sits behind the reverse relief, overlaps
 * the shoulder sheet, and closes only the arch interior.
 */
export function buildCowlBacking(THREE, opts = {}) {
    const yTop = Math.min(opts.cowlTop ?? 2.42, 2.44);
    const widthScale = Math.min(1.06, Math.max(0.94, opts.openScale ?? 1));
    const xDrift = (y) => (y - 1.78) * (opts.sweepLean ?? 0);
    const point = (x, y) => [x * widthScale + xDrift(y), y];
    const outline = [
        point(-0.300, 1.780),
        point( 0.300, 1.780),
        point( 0.286, 1.950),
        point( 0.238, Math.min(2.230, yTop - 0.150)),
        point( 0.205, yTop - 0.055),
        point( 0.118, yTop - 0.012),
        point( 0.000, yTop),
        point(-0.118, yTop - 0.012),
        point(-0.205, yTop - 0.055),
        point(-0.238, Math.min(2.230, yTop - 0.150)),
        point(-0.286, 1.950),
    ];
    const frontZ = -0.052;
    const backZ = -0.102;
    const positions = [];
    for (const z of [frontZ, backZ]) {
        for (const [x, y] of outline) positions.push(x, y, z);
    }
    const frontCentre = positions.length / 3;
    positions.push(xDrift(2.08), 2.08, frontZ);
    const backCentre = positions.length / 3;
    positions.push(xDrift(2.08), 2.08, backZ);

    const indices = [];
    const count = outline.length;
    for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        indices.push(frontCentre, i, next);
        indices.push(backCentre, count + next, count + i);
        indices.push(i, count + i, next);
        indices.push(next, count + i, count + next);
    }

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3)
    );
    indexed.setIndex(indices);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    return geometry;
}


/**
 * THE BODY, as one blended distance field.
 *
 * Everything from the hips to the collarbone — torso, bust, shoulders, arms,
 * and whichever narrative each figure carries — is a single field, smooth-
 * unioned and meshed in one piece. That is the whole point: a union of separate
 * ellipsoids has a visible crease wherever two of them meet, and the earlier
 * passes showed it badly, with the pregnant belly sitting on the torso like an
 * applied egg and the shoulders reading as two balls. Bronze has fillets, not
 * creases, and `smin` is how you get one.
 *
 * The blend radii below are modelling decisions, not tolerances:
 *   0.03  a jaw or a wrist — crisp, still not a crease
 *   0.06  arms into shoulders
 *   0.05  bust onto the chest wall
 *   0.08  a pregnancy growing out of a torso
 */
const TORSO_PROFILE = [
    // The trunk includes the skirt and runs all the way to the paving. It has to:
    // the cloak's front opening never closes over the body, so stopping it at the hip
    // leaves no front surface below it and reads as a tear in the casting.
    // A STRAIGHT TAPER, WIDENING DOWNWARD, with no waist to speak of. Measured
    // off the nearest figure in `ref-a-front.jpg` at four heights, her spans go
    // shoulder 0.327, bust 0.342, waist 0.356, hem 0.387 of her own height —
    // monotonically wider all the way down. Every earlier version of this table
    // pinched at the waist and flared below it, which is a fashion croquis, not
    // this casting; it is most of why the model read as separate mannequins
    // beside photographs of one heavy, continuous relief sheet.
    //
    // The whole table is also about 20% wider than the last one and the shoulder
    // line has come DOWN from 1.911 to 1.849. Both came out of the rebuilt
    // proportion gate, which found every width in the model short by roughly the
    // same fraction — the tell that it was one systematic error, not four.
    // Below the hip this IS the skirt, and it runs to the paving. It has to:
    // with the cloak open its whole height there is nothing else down there, and
    // in the photographs the front of each figure below the waist is one smooth
    // continuous surface reaching the ground.
    [0.000, 0.395, 0.238],
    [0.180, 0.388, 0.228],
    [0.400, 0.378, 0.212],
    [0.620, 0.368, 0.196],
    [0.820, 0.360, 0.182],
    [1.070, 0.346, 0.172],
    [1.210, 0.336, 0.168],
    [1.330, 0.326, 0.162],
    [1.430, 0.320, 0.158],   // waist — barely narrower than the ribs
    [1.530, 0.328, 0.162],
    [1.620, 0.336, 0.164],   // ribs, under the bust
    [1.720, 0.336, 0.162],
    // The shoulder stays broad ALL THE WAY to the shoulder line and then rises
    // fast. Tapering from further down gave a long cone that read as a bird's
    // neck; in the photographs the shoulders are near-horizontal slabs and the
    // chin sits almost on them.
    [1.800, 0.328, 0.156],
    [1.849, 0.312, 0.150],   // shoulder line — 0.797 of total height
    [1.895, 0.170, 0.104],
    [1.930, 0.092, 0.072],
    [1.960, 0.082, 0.068],   // neck
];

/**
 * Per-role contour multipliers sampled at physical heights. A single scaled
 * profile produced six mannequin copies; these tables preserve the photographed
 * differences in hem, abdomen, ribcage and shoulder width. Each row is
 * [height, width, depth, lateralOffset, frontOffset].
 */
export const ROLE_BODY_STYLES = Object.freeze({
    developing: Object.freeze({
        contour: [[0.00, 1.10, 1.04, -0.012, 0.000], [0.65, 1.09, 1.06, -0.012, 0.004], [1.08, 1.12, 1.16, -0.008, 0.018], [1.34, 1.14, 1.18, -0.004, 0.024], [1.56, 1.08, 1.10, 0.002, 0.014], [1.78, 1.05, 1.03, 0.006, 0.004], [1.96, 1.00, 1.00, 0.000, 0.000]],
        shoulder: [1.04, 1.00], bust: [1.505, 1.07, 1.04, 1.06, -0.004, 0.126, 0.032, 0.035],
    }),
    doctor: Object.freeze({
        contour: [[0.00, 1.00, 1.00, 0.008, 0.000], [0.65, 0.98, 0.97, 0.008, -0.002], [1.08, 0.94, 0.93, 0.006, -0.004], [1.34, 0.92, 0.92, 0.004, -0.004], [1.56, 0.97, 0.98, 0.000, 0.000], [1.78, 1.02, 1.01, -0.004, 0.002], [1.96, 1.00, 1.00, 0.000, 0.000]],
        shoulder: [1.01, 0.96], bust: [1.515, 0.96, 0.95, 0.94, 0.003, 0.118, 0.027, -0.025],
    }),
    mother: Object.freeze({
        contour: [[0.00, 1.05, 1.02, -0.006, 0.000], [0.65, 1.02, 0.99, -0.006, -0.002], [1.08, 0.96, 0.95, -0.004, 0.000], [1.34, 0.93, 0.94, 0.000, 0.000], [1.56, 0.98, 1.00, 0.004, 0.004], [1.78, 1.03, 1.01, 0.006, 0.002], [1.96, 1.00, 1.00, 0.000, 0.000]],
        shoulder: [1.02, 0.98], bust: [1.500, 0.94, 0.95, 0.94, -0.006, 0.118, 0.030, 0.030],
    }),
    pregnant: Object.freeze({
        contour: [[0.00, 1.03, 1.00, 0.000, 0.000], [0.65, 1.04, 1.02, 0.002, 0.000], [1.00, 1.04, 1.04, 0.003, 0.002], [1.18, 1.06, 1.08, 0.004, 0.008], [1.36, 1.08, 1.15, 0.006, 0.015], [1.52, 1.07, 1.12, 0.005, 0.012], [1.68, 1.04, 1.05, 0.003, 0.004], [1.82, 1.01, 1.02, 0.002, 0.002], [1.96, 1.00, 1.00, 0.000, 0.000]],
        shoulder: [1.01, 0.99], bust: [1.515, 0.99, 0.99, 0.99, 0.004, 0.120, 0.030, -0.020],
    }),
    visitor: Object.freeze({
        contour: [[0.00, 0.99, 1.00, 0.010, 0.000], [0.65, 0.97, 0.97, 0.010, -0.002], [1.08, 0.95, 0.95, 0.008, -0.002], [1.34, 0.98, 0.98, 0.006, 0.000], [1.56, 1.09, 1.08, 0.002, 0.012], [1.78, 1.08, 1.03, -0.002, 0.004], [1.96, 1.00, 1.00, 0.000, 0.000]],
        shoulder: [1.03, 1.00], bust: [1.510, 1.04, 1.00, 1.03, 0.006, 0.124, 0.034, 0.028],
    }),
    badge: Object.freeze({
        contour: [[0.00, 0.97, 0.99, -0.008, 0.000], [0.65, 0.96, 0.97, -0.008, -0.002], [1.08, 0.98, 1.00, -0.006, 0.000], [1.34, 0.94, 0.96, -0.004, -0.002], [1.56, 0.96, 0.97, 0.000, 0.000], [1.78, 1.02, 1.00, 0.004, 0.002], [1.96, 1.00, 1.00, 0.000, 0.000]],
        shoulder: [1.00, 0.97], bust: [1.515, 0.97, 0.95, 0.96, 0.002, 0.118, 0.028, -0.020],
    }),
});

export const PREGNANCY_SHAPE = Object.freeze({
    upper: Object.freeze([0.000, 1.405, 0.195, 0.180, 0.185, 0.120]),
    lower: Object.freeze([-0.004, 1.255, 0.210, 0.195, 0.190, 0.140]),
    joinBlend: 0.100,
    torsoBlend: 0.085,
});

/**
 * Distance to the tapered elliptical trunk described by TORSO_PROFILE.
 *
 * A stack of blended spheres would need dozens of primitives to stay smooth;
 * sampling the profile directly costs one lookup and gives an exact elliptical
 * cross-section at every height.
 */
function sdTrunk(x, y, z, y0, y1, o, crossScale = 1) {
    const sampledY = Math.min(y1, Math.max(y0, y));
    const radial = sdTrunkAt(x, sampledY, z, o, crossScale);
    const slab = Math.max(y0 - y, y - y1);
    const outside = Math.hypot(Math.max(radial, 0), Math.max(slab, 0));
    const inside = Math.min(Math.max(radial, slab), 0);
    return outside + inside;
}

function sdTrunkAt(x, y, z, o, crossScale = 1) {
    const [baseWidth, baseDepth] = sampleSmoothProfile(TORSO_PROFILE, y);
    const bodyStyle = ROLE_BODY_STYLES[o.identity] || ROLE_BODY_STYLES.visitor;
    const [roleWidth, roleDepth, lateralOffset, frontOffset]
        = sampleSmoothProfile(bodyStyle.contour, y);
    const hw = baseWidth * o.torsoWidth * roleWidth * crossScale;
    const frontDepth = baseDepth * o.torsoDepth * roleDepth * crossScale;

    // Preserve the tuned front plane while sweeping the rear surface backward
    // into the long triangular fins visible in both oblique reference views.
    // The added depth vanishes at the shoulder, so it reads as a folded sheet
    // planted on the paving rather than a barrel around the torso.
    const sweepT = Math.min(1, Math.max(0, 1 - y / 2.02));
    const shoulderFade = y <= 1.82
        ? 1
        : Math.max(0, 1 - (y - 1.82) / 0.14);
    const rearSweep = o.sheetDepth
        * (0.16 + 0.84 * Math.pow(sweepT, 0.78))
        * shoulderFade
        * crossScale;
    const centreZ = frontOffset * crossScale - rearSweep * 0.5;
    const hd = frontDepth + rearSweep * 0.5;

    const kx = (x - lateralOffset * crossScale) / hw;
    const kz = (z - centreZ) / hd;
    const r = Math.sqrt(kx * kx + kz * kz);
    return (r - 1) * Math.min(hw, hd);
}

/**
 * Explicit foot sections: forward, half-width, half-height, centre-Y, drift.
 * The buried root opens into a broad instep before the long cast wedge tapers.
 */
export const PLANTED_FOOT_PROFILE = Object.freeze([
    Object.freeze([-0.110, 0.070, 0.170, 0.170, 0.000]),
    Object.freeze([-0.060, 0.080, 0.160, 0.160, 0.000]),
    Object.freeze([ 0.000, 0.090, 0.140, 0.140, 0.001]),
    Object.freeze([ 0.060, 0.092, 0.115, 0.115, 0.004]),
    Object.freeze([ 0.120, 0.092, 0.092, 0.094, 0.007]),
    Object.freeze([ 0.185, 0.089, 0.074, 0.077, 0.010]),
    Object.freeze([ 0.250, 0.084, 0.059, 0.062, 0.013]),
    Object.freeze([ 0.310, 0.075, 0.047, 0.050, 0.016]),
    Object.freeze([ 0.360, 0.064, 0.037, 0.040, 0.019]),
    Object.freeze([ 0.400, 0.058, 0.034, 0.037, 0.022]),
    Object.freeze([ 0.435, 0.042, 0.027, 0.032, 0.024]),
    Object.freeze([ 0.455, 0.025, 0.019, 0.029, 0.025]),
]);

function buildBodyField(THREE, o) {
    const seed = o.seed;
    const arms = ARM_POSES[o.armPose] || ARM_POSES.open;
    const bodyStyle = ROLE_BODY_STYLES[o.identity] || ROLE_BODY_STYLES.visitor;
    const [shoulderWidth, shoulderDepth] = bodyStyle.shoulder;
    const [
        bustY, roleBustWidth, roleBustHeight, roleBustDepth, bustTilt,
        bustSpacing, bustDrop, bustAsymmetry,
    ]
        = bodyStyle.bust;
    const [, , shoulderOffset] = sampleSmoothProfile(bodyStyle.contour, 1.805);
    const rearProfile = {
        ...o,
        torsoWidth: o.torsoWidth * 0.72,
        torsoDepth: o.torsoDepth * 0.92,
        sheetDepth: o.sheetDepth * 0.70,
    };

    function field(x, y, z) {
        // Trunk from well down inside the skirt up to the base of the neck.
        // The skirt's hem is raked to match the cloak's, so the lift reveals a
        // planted foot rather than cutting a step into the front of the drape.
        const hemLift = o.hemRake
            * Math.max(0, Math.cos(Math.atan2(x, z) - o.strideAngle))
            * 0.92;
        // Close the deep trunk below the paving. A cap at visible hem height
        // produced a broad horizontal crescent in every low camera; the source
        // presents a thin vertical cast edge with the foot projecting beyond it.
        const trunkFloor = -0.200 + hemLift * 0.20;
        let d = sdTrunk(x, y, z, trunkFloor, 1.960, o);
        // The foot is a separate 7.5 mm closed field whose root overlaps this
        // trunk beneath the hem. Sampling it here at 18 mm produced a pointed
        // wedge even while the finer isolation probe looked correct.
        // The reverse is the negative side of the same continuous cast sheet.
        // Follow the complete torso profile rather than punching an oval into it:
        // this produces the broad, full-height concave panels visible between
        // every active figure while leaving a closed inner surface and thick rim.
        const cavityFloor = trunkFloor + 0.055;
        const cavityT = Math.min(1, Math.max(0, (y - cavityFloor) / 0.065));
        const cavityEase = cavityT * cavityT * (3 - 2 * cavityT);
        const cavityScale = 0.02 + 0.98 * cavityEase;
        const rearCavity = sdTrunk(
            x, y, z + 0.240,
            cavityFloor,
            1.915,
            rearProfile,
            cavityScale
        );
        // A low rounded shoulder shelf removes the machined rectangular corners
        // while keeping the broad, almost horizontal cast shoulder line.
        d = smin(d, sdEllipsoid(
            x - shoulderOffset,
            y - 1.805,
            z - 0.010,
            0.338 * o.torsoWidth * shoulderWidth,
            0.105,
            0.145 * o.torsoDepth * shoulderDepth
        ), 0.052);

        // The source is one broad, low cast shelf with only a restrained
        // bilateral break. A pair of detached ellipsoids reads as applied
        // spheres even when their depth is correct, so start with the complete
        // shelf and use the lower lobes only to shape its irregular underside.
        const shelfCenterX = shoulderOffset * 0.35;
        let chest = sdEllipsoid(
            x - shelfCenterX,
            y - (bustY + 0.005),
            z - 0.110,
            0.250 * o.bustWidth * roleBustWidth,
            0.082 * o.bustHeight * roleBustHeight,
            0.052 * o.bustDepth * roleBustDepth
        );
        for (const sx of [-1, 1]) {
            const sideScale = 1 + sx * bustAsymmetry;
            const centreX = sx * bustSpacing * o.bustWidth * roleBustWidth;
            const centreY = bustY + sx * bustTilt;
            const lobe = sdEllipsoid(
                x - (centreX + sx * 0.006),
                y - (centreY - bustDrop),
                z - 0.124,
                0.118 * o.bustWidth * roleBustWidth * sideScale,
                0.060 * o.bustHeight * roleBustHeight * (1 - sx * bustAsymmetry * 0.6),
                0.050 * o.bustDepth * roleBustDepth
            );
            chest = smin(chest, lobe, 0.026);
        }
        d = smin(d, chest, 0.045);

        // Per-figure arms taper continuously from the shoulder into a reduced
        // wrist. The reference does not show bulbous hands: hanging limbs end in
        // a narrow cast tip, while supporting wrists disappear into the gesture.
        for (const arm of arms) {
            const [rawSx, sy, sz] = arm.shoulder;
            const [rawEx, ey, ez] = arm.elbow;
            const [rawWx, wy, wz] = arm.wrist;
            const sx = rawSx * o.armWidth;
            const ex = rawEx * o.armWidth;
            const wx = rawWx * o.armWidth;
            const armWidthScale = arm.width ?? 1;
            const armDepthScale = arm.depth ?? 0.72;
            const gestureDepthScale = arm.gestureDepth ?? armDepthScale;
            d = smin(d, sdEllipsoid(x - sx, y - sy, z - sz,
                0.070 * armWidthScale,
                0.064,
                0.075 * armDepthScale), 0.040);
            d = smin(d, sdReliefCapsule(
                x, y, z,
                sx, sy - 0.018, sz + 0.010,
                ex, ey, ez,
                0.070, arm.upper,
                armWidthScale, armDepthScale
            ), 0.028);
            const wristRadius = arm.end ?? arm.fore * 0.70;
            d = smin(d, sdReliefCapsule(
                x, y, z,
                ex, ey, ez,
                wx, wy, wz,
                arm.upper, wristRadius,
                armWidthScale, armDepthScale
            ), 0.018);

            if (arm.support) {
                let [px, py, pz] = [wx, wy, wz];
                let previousRadius = wristRadius;
                for (let i = 0; i < arm.support.length; i++) {
                    const [rawTx, ty, tz] = arm.support[i];
                    const tx = rawTx * o.armWidth;
                    const t = (i + 1) / arm.support.length;
                    const nextRadius = wristRadius
                        + ((arm.supportEnd ?? 0.022) - wristRadius) * t;
                    d = smin(d, sdReliefCapsule(
                        x, y, z,
                        px, py, pz,
                        tx, ty, tz,
                        previousRadius, nextRadius,
                        armWidthScale, gestureDepthScale
                    ), 0.014);
                    [px, py, pz] = [tx, ty, tz];
                    previousRadius = nextRadius;
                }
            } else if (arm.tip) {
                const [rawTx, ty, tz] = arm.tip;
                const tx = rawTx * o.armWidth;
                d = smin(d, sdReliefCapsule(
                    x, y, z,
                    wx, wy, wz,
                    tx, ty, tz,
                    wristRadius, arm.tipEnd ?? 0.022,
                    armWidthScale, gestureDepthScale
                ), 0.014);
            } else {
                const tipLength = arm.hand ?? 0.036;
                if (tipLength > 0) {
                    const hdx = wx - ex, hdy = wy - ey, hdz = wz - ez;
                    const hlen = Math.hypot(hdx, hdy, hdz) || 1;
                    const htx = wx + hdx / hlen * tipLength;
                    const hty = wy + hdy / hlen * tipLength;
                    const htz = wz + hdz / hlen * tipLength;
                    d = smin(d, sdReliefCapsule(
                        x, y, z,
                        wx, wy, wz,
                        htx, hty, htz,
                        wristRadius, Math.max(0.020, wristRadius * 0.60),
                        armWidthScale, armDepthScale
                    ), 0.008);
                }
            }
        }

        // Neck, rising to meet the head field. Stops BELOW the chin (1.919): run
        // any higher and its cap pushes a bare dome up through the face.
        d = smin(d, sdCapsule(x, y, z, 0, 1.812, 0.006, 0, 1.906, 0.010, 0.068), 0.055);

        // A localized pear-shaped volume carries the measured half-metre
        // pregnancy zone; the surrounding trunk remains one continuous cast.
        if (o.identity === 'pregnant') {
            const [ux, uy, uz, urx, ury, urz] = PREGNANCY_SHAPE.upper;
            const [lx, ly, lz, lrx, lry, lrz] = PREGNANCY_SHAPE.lower;
            let pregnancy = sdEllipsoid(
                x - ux, y - uy, z - uz, urx, ury, urz
            );
            pregnancy = smin(pregnancy, sdEllipsoid(
                x - lx, y - ly, z - lz, lrx, lry, lrz
            ), PREGNANCY_SHAPE.joinBlend);
            d = smin(d, pregnancy, PREGNANCY_SHAPE.torsoBlend);
        }
        // Baby and stethoscope are deliberately separate, finer geometries.
        // Blending either into this 18mm body field erased their identity and
        // made the tubing look like wounds cut into the chest.

        // Cut the reverse only after every positive relief has been unioned;
        // otherwise those later unions silently fill the negative panel back in.
        d = subtract(d, rearCavity, 0.018);

        // Hand-worked surface, in the FIELD rather than as a post-pass vertex
        // push: displacing a meshed surface along its normals re-creases the
        // very blends this whole approach exists to remove.
        // HAND-WORKED SURFACE, in the FIELD rather than as a post-pass vertex
        // push, which would re-crease the very blends this approach exists to
        // remove. Two octaves: a broad swell, and a finer one whose amplitude
        // stays well under the 18mm voxel so it modulates the surface instead
        // of aliasing holes into it. Without the second, the bronze is a
        // machined lathe and no amount of patina rescues it.
        d += fbm3(x * 2.8, y * 2.8, z * 2.8, seed, 2) * 0.0135;
        d += fbm3(x * 8.8, y * 8.8, z * 8.8, seed + 3, 2) * 0.0044;
        return d;
    }

    // The top bound has to CLEAR the neck capsule's cap. In the current field
    // the cap reaches 1.974 and the box reaches 2.06. An earlier neck ended at
    // 2.108 with a 0.059 cap, while its box stopped at 2.13; surface nets sliced
    // it open and left a torn rim that looked like a dark trapezoidal visor from
    // the eyes to the collarbone. Three passes were spent hunting that as a
    // lighting bug, a shadow bug and a facial-geometry bug; one
    // MeshNormalMaterial render found it.
    const mesh = marchingTetrahedra(field, {
        min: [-0.60, -0.26, -0.82],
        max: [0.60, 2.06, 0.55],
        voxel: 0.0180,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
    return geo;
}

/** A separate fine field keeps the small hospital badge legible and closed. */
function buildBadgeField(THREE, o) {
    const field = (x, y, z) => {
        let d = sdRoundBox(
            x - 0.112, y - 1.700, z - 0.170,
            0.058, 0.024, 0.014, 0.006
        );
        d += fbm3(x * 22, y * 22, z * 22, o.seed + 43, 1) * 0.0006;
        return d;
    };
    const mesh = surfaceNets(field, {
        min: [0.035, 1.650, 0.135],
        max: [0.190, 1.750, 0.205],
        voxel: 0.0035,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
    return geo;
}

/**
 * The newborn is an explicit capped loft resting on one curved U-shaped
 * support. Keeping it separate from the coarse body field preserves the broad
 * wrapped-block contour and restrained unequal ends without inventing a head.
 */

export const BABY_LOFT_PROFILE = Object.freeze([
    Object.freeze([-0.215, -0.004,  0.006, 0.035, 0.045]),
    Object.freeze([-0.190, -0.003,  0.005, 0.060, 0.074]),
    Object.freeze([-0.145, -0.001,  0.004, 0.074, 0.084]),
    Object.freeze([-0.075,  0.002,  0.002, 0.080, 0.089]),
    Object.freeze([ 0.000,  0.004,  0.000, 0.082, 0.091]),
    Object.freeze([ 0.075,  0.003, -0.001, 0.080, 0.090]),
    Object.freeze([ 0.145,  0.000, -0.003, 0.077, 0.087]),
    Object.freeze([ 0.190, -0.005, -0.006, 0.064, 0.080]),
    Object.freeze([ 0.215, -0.010, -0.010, 0.032, 0.050]),
]);

function buildBabyGeometry(THREE, o) {
    const SIDES = 24;
    const angle = 0.100;
    const c = Math.cos(angle), s = Math.sin(angle);
    const positions = [];
    const indices = [];
    const point = (u, v, z) => [
        -0.004 + u * c - v * s,
        1.385 + u * s + v * c,
        0.305 + z,
    ];

    for (const [u, centerV, centerZ, halfHeight, halfDepth] of BABY_LOFT_PROFILE) {
        for (let side = 0; side < SIDES; side++) {
            const theta = side / SIDES * Math.PI * 2;
            const cv = Math.sign(Math.cos(theta))
                * Math.pow(Math.abs(Math.cos(theta)), 0.72);
            const cz = Math.sign(Math.sin(theta))
                * Math.pow(Math.abs(Math.sin(theta)), 0.72);
            const wobble = fbm3(u * 11, theta * 0.9, centerZ * 19, o.seed + 31, 2) * 0.0032;
            positions.push(...point(
                u,
                centerV + cv * (halfHeight + wobble),
                centerZ + cz * (halfDepth + wobble * 0.8)
            ));
        }
    }

    for (let ring = 0; ring < BABY_LOFT_PROFILE.length - 1; ring++) {
        for (let side = 0; side < SIDES; side++) {
            const next = (side + 1) % SIDES;
            const a = ring * SIDES + side;
            const b = ring * SIDES + next;
            const c0 = (ring + 1) * SIDES + side;
            const d = (ring + 1) * SIDES + next;
            indices.push(a, b, c0, b, d, c0);
        }
    }

    const addTip = (u, centerV, centerZ, ring, outward) => {
        const tip = positions.length / 3;
        positions.push(...point(u, centerV, centerZ));
        for (let side = 0; side < SIDES; side++) {
            const next = (side + 1) % SIDES;
            const a = ring * SIDES + side;
            const b = ring * SIDES + next;
            if (outward < 0) indices.push(tip, b, a);
            else indices.push(tip, a, b);
        }
    };
    const first = BABY_LOFT_PROFILE[0];
    const last = BABY_LOFT_PROFILE.at(-1);
    addTip(-0.232, first[1], first[2], 0, -1);
    addTip(0.234, last[1], last[2], BABY_LOFT_PROFILE.length - 1, 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    return geo;
}
/** Reference-led control points for the clinician's stethoscope. */
export const STETHOSCOPE_PATHS = Object.freeze({
    left: Object.freeze([
        Object.freeze([-0.024, 1.940, 0.010]),
        Object.freeze([-0.030, 1.875, 0.096]),
        Object.freeze([-0.076, 1.790, 0.137]),
        Object.freeze([-0.112, 1.690, 0.131]),
        Object.freeze([-0.104, 1.535, 0.149]),
    ]),
    right: Object.freeze([
        Object.freeze([0.024, 1.940, 0.010]),
        Object.freeze([0.030, 1.875, 0.096]),
        Object.freeze([0.074, 1.800, 0.136]),
        Object.freeze([0.110, 1.690, 0.133]),
        Object.freeze([0.078, 1.558, 0.148]),
    ]),
    terminals: Object.freeze([
        Object.freeze([-0.104, 1.525, 0.154]),
        Object.freeze([ 0.078, 1.550, 0.148]),
    ]),
});

/**
 * Two curved tubes seated into the torso, matching the reference casting. The
 * lower fittings are deliberately asymmetric and ordered as photographed: a
 * low shallow U fitting on the left and a higher circular chestpiece on the
 * right. Both are broad enough to survive the delivery lighting.
 */
function buildStethoscopeGeometry(THREE) {
    const parts = [];
    const paths = [STETHOSCOPE_PATHS.left, STETHOSCOPE_PATHS.right];
    for (const path of paths) {
        const points = path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
        const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
        parts.push(new THREE.TubeGeometry(curve, 30, 0.0140, 10, false));
    }

    const [leftTerminal, rightTerminal] = STETHOSCOPE_PATHS.terminals;
    const [lx, ly, lz] = leftTerminal;
    const yokePoints = [
        [lx - 0.028, ly + 0.014, lz + 0.007],
        [lx - 0.022, ly - 0.003, lz + 0.009],
        [lx, ly - 0.014, lz + 0.011],
        [lx + 0.022, ly - 0.003, lz + 0.009],
        [lx + 0.028, ly + 0.014, lz + 0.007],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const yokeCurve = new THREE.CatmullRomCurve3(yokePoints, false, 'catmullrom', 0.5);
    parts.push(new THREE.TubeGeometry(yokeCurve, 18, 0.0075, 8, false));
    for (const point of [yokePoints[0], yokePoints.at(-1)]) {
        const knob = new THREE.SphereGeometry(0.0120, 12, 8);
        knob.translate(point.x, point.y, point.z);
        parts.push(knob);
    }

    const [rx, ry, rz] = rightTerminal;
    const chestpiece = new THREE.CylinderGeometry(0.030, 0.031, 0.016, 24, 1, false);
    chestpiece.rotateX(Math.PI / 2);
    chestpiece.scale(1.08, 0.90, 1.0);
    chestpiece.translate(rx, ry, rz + 0.008);
    parts.push(chestpiece);
    const chestpieceRim = new THREE.TorusGeometry(0.0275, 0.0035, 7, 24);
    chestpieceRim.scale(1.08, 0.90, 1.0);
    chestpieceRim.translate(rx, ry, rz + 0.0170);
    parts.push(chestpieceRim);
    const diaphragm = new THREE.SphereGeometry(0.0215, 20, 12);
    diaphragm.scale(1.0, 0.90, 0.34);
    diaphragm.translate(rx, ry, rz + 0.0205);
    parts.push(diaphragm);

    const geo = mergeGeometries(THREE, parts);
    return roughen(THREE, geo, { amount: 0.0005, scale: 38, seed: 73, octaves: 1 });
}

/**
 * Identity parameters alter structure, not merely scale. Values are in the
 * unscaled head field and are tuned against the isolated reference crops.
 */
export const FACE_STYLES = Object.freeze({
    developing: Object.freeze({ headWidth: 1.08, headHeight: 1.00, headDepth: 1.02, faceWidth: 1.06, nose: 0.90, noseWidth: 1.08, noseLean: -0.006, mouth: 1.08, mouthTilt: -0.006, browWidth: 1.06, browTilt: 0.012, eyeSpacing: 1.04, eyeAsym: 0.006, noseX: -0.006, mouthY: -0.004, jaw: 1.08, cheek: 1.05, cheekAsym: 0.014, rolls: 0 }),
    doctor:     Object.freeze({ headWidth: 0.90, headHeight: 1.12, headDepth: 0.97, faceWidth: 0.87, nose: 1.22, noseWidth: 0.85, noseLean: 0.006, mouth: 0.82, mouthTilt: 0.004, browWidth: 0.90, browTilt: -0.022, eyeSpacing: 0.94, eyeAsym: -0.006, noseX: 0.003, mouthY: -0.006, jaw: 0.88, cheek: 0.90, cheekAsym: -0.010, rolls: 0 }),
    mother:     Object.freeze({ headWidth: 0.84, headHeight: 1.17, headDepth: 0.94, faceWidth: 0.78, nose: 1.17, noseWidth: 0.82, noseLean: -0.005, mouth: 0.78, mouthTilt: -0.003, browWidth: 0.84, browTilt: 0.024, eyeSpacing: 0.90, eyeAsym: 0.007, noseX: -0.005, mouthY: 0.003, jaw: 0.82, cheek: 0.84, cheekAsym: 0.012, rolls: 1 }),
    pregnant:   Object.freeze({ headWidth: 1.07, headHeight: 1.02, headDepth: 1.01, faceWidth: 1.03, nose: 0.96, noseWidth: 1.07, noseLean: 0.001, mouth: 1.03, mouthTilt: 0.002, browWidth: 1.05, browTilt: -0.012, eyeSpacing: 1.03, eyeAsym: -0.004, noseX: 0.004, mouthY: 0.000, jaw: 1.08, cheek: 1.09, cheekAsym: -0.008, rolls: 0 }),
    visitor:    Object.freeze({ headWidth: 0.82, headHeight: 1.19, headDepth: 0.92, faceWidth: 0.77, nose: 1.24, noseWidth: 0.80, noseLean: 0.010, mouth: 0.76, mouthTilt: 0.006, browWidth: 0.82, browTilt: 0.030, eyeSpacing: 0.88, eyeAsym: 0.008, noseX: 0.006, mouthY: -0.005, jaw: 0.80, cheek: 0.82, cheekAsym: 0.015, rolls: 2 }),
    badge:      Object.freeze({ headWidth: 0.94, headHeight: 1.07, headDepth: 0.97, faceWidth: 0.90, nose: 0.92, noseWidth: 1.04, noseLean: -0.006, mouth: 0.92, mouthTilt: -0.004, browWidth: 0.94, browTilt: -0.026, eyeSpacing: 0.92, eyeAsym: -0.006, noseX: -0.004, mouthY: 0.003, jaw: 0.95, cheek: 0.97, cheekAsym: -0.012, rolls: 0 }),
});

/**
 * THE HEAD, as its own field at a finer voxel.
 *
 * Separate from the body because a face needs roughly twice the resolution and
 * paying for that over the whole figure would quadruple the build for nothing.
 *
 * The eye sockets are SUBTRACTED with a soft rim rather than modelled as dark
 * spheres — the references show real hollows with a shadow in them, and a
 * carved socket is the only thing that reads as one from any angle.
 */
function buildHeadField(THREE, o) {
    /**
     * HEAD SCALE. Every offset and radius below is in the head's own units and
     * multiplied by this, so the whole head grows about its own centre without
     * any of its internal proportions changing.
     *
     * It exists because the head was 35% too small and nobody could see it. The
     * old proportion table normalised by the top of the COWL, whose height
     * varies per figure by design, so it compared different figures against
     * different rulers and reported a head 0.120 of the figure when measurement
     * against the crown on two figures independently gives 0.175. That single
     * bad denominator is most of why the model read as elongated and
     * small-headed beside photographs of squat, big-headed women about five and
     * a half heads tall.
     */
    const HS = 1.335;
    const yc = 2.113;
    // The head's own origin, IN HEAD UNITS. `headField` must use this and never
    // `yc`: `yc` is where the head sits in the WORLD, and mixing the two is a
    // bug that hides well — every offset shifts by the same amount, so the head
    // stays internally correct and simply sits 62mm below where FIGURE_LANDMARKS
    // says it does. The gate then measures a head that is not there, which is a
    // worse failure than a red gate because it is a green one.
    const YC0 = 2.159;
    const seed = o.seed + 13;

    // Smoothstep, for the hairline. Kept local: this file has no maths module
    // and one helper does not earn one.
    const ss = (a, b, t) => {
        const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
        return k * k * (3 - 2 * k);
    };

    /**
     * The field in the head's OWN units. Everything inside is written at the
     * original scale — thirty offsets and radii tuned against the photographs
     * over several passes — and `field` below maps world space into here. That
     * is deliberately a coordinate change and not a rescaling of the constants:
     * rescaling thirty numbers by hand is thirty chances to miss one, and a
     * missed one is a feature that silently stops matching its neighbours.
     */
    /**
     * THE HEAD IS A TAPERED CAST BLOCK, not an ovoid.
     *
     * Read off the nearest figure in `ref-a-front.jpg` at 4x: flat front, flat
     * sides, a domed top and a broad flat jaw — a loaf standing on end. Built as
     * an egg, which is what every version before this one was, the face has
     * nowhere flat to sit on and every feature slides off the curvature. The
     * flats are the whole reason a face this reduced reads at all.
     *
     * The features are just as specific and none of them was right:
     *
     *   BROW   two broad cast ridges over the eye hollows, separated at the
     *          nose root so the expression does not collapse into a T-mask.
     *   EYES   two hollow triangular sockets under the brow. Their planar
     *          walls and 28mm world-space depth retain a shadow at the normal
     *          group camera instead of collapsing into horizontal slits.
     *   NOSE   a NARROW ridge, about a sixth of the face across, running
     *          unbroken from between the brows to a small blunt tip.
     *   MOUTH  a WIDE flat bar, about half the face across, split by one
     *          horizontal line. The old one was a small pad and read as a bud.
     *
     * And under a near-frontal key — which is where this scene's sun has to sit,
     * see createLightRig — a nose reads from the shadow carved BESIDE it, not
     * from how far it stands out. Hence the cheek hollows either side of it.
     */
    const face = FACE_STYLES[o.identity] || FACE_STYLES.visitor;

    function headField(x, y, z) {
        const facePlane = 0.084 * face.headDepth;
        const lowerHeadT = 1 - ss(YC0 - 0.145, YC0 - 0.015, y);
        const upperHeadT = ss(YC0 + 0.075, YC0 + 0.158, y);
        const headX = (x - face.browTilt * 0.22)
            / (1 - 0.28 * lowerHeadT - 0.10 * upperHeadT);
        let d = sdRoundBox(
            headX,
            y - (YC0 + 0.004),
            z - 0.002,
            0.104 * face.headWidth,
            0.154 * face.headHeight,
            0.086 * face.headDepth,
            0.073
        );
        d = smin(d, sdEllipsoid(
            x - face.cheekAsym * 0.80,
            y - (YC0 - 0.092),
            z,
            0.074 * face.headWidth * face.jaw,
            0.055 * face.headHeight,
            0.068 * face.headDepth
        ), 0.035);

        // The original faces are shallow relief on a broad, nearly planar
        // front. The back remains a complete blank rounded head.
        d = smax(d, z - facePlane, 0.016);

        if (o.hair !== 'none') {
            const hairFrontZ = 0.058 + 0.014 * ss(YC0 + 0.030, YC0 + 0.122, y);
            let hair = sdRoundBox(
                x,
                y - (YC0 + 0.010),
                z + 0.018,
                0.115 * face.headWidth,
                0.152 * face.headHeight,
                0.100 * face.headDepth,
                0.061
            );
            hair = smax(hair, z - hairFrontZ, 0.002);
            d = Math.min(d, hair);
        }

        if (face.rolls > 0) {
            // Crown rolls sit visibly above the head. The mother carries one;
            // the visitor's second roll sits behind it instead of forming a hat.
            d = smin(d, sdEllipsoid(
                x + 0.004,
                y - (YC0 + 0.188),
                z - 0.010,
                0.090 * face.headWidth,
                0.032,
                0.055
            ), 0.015);
            if (face.rolls > 1) {
                d = smin(d, sdEllipsoid(
                    x - 0.006,
                    y - (YC0 + 0.222),
                    z + 0.020,
                    0.080 * face.headWidth,
                    0.029,
                    0.050
                ), 0.014);
            }
        }
        {
            // Unequal shallow cheek planes keep the face integrated with the
            // block while giving each identity a different lower-face rhythm.
            for (const sx of [-1, 1]) {
                const cheekX = sx * 0.047 * face.faceWidth;
                const cheekY = YC0 - 0.030 + sx * face.cheekAsym;
                d = smin(d, sdEllipsoid(
                    x - cheekX,
                    y - cheekY,
                    z - (facePlane - 0.007),
                    0.034 * face.cheek,
                    0.026,
                    0.007
                ), 0.004);
            }

            // Separate worn brows avoid one mask-like bar across every face.
            const browHalf = 0.023 * face.faceWidth * face.browWidth;
            const browY = YC0 + 0.050;
            for (const sx of [-1, 1]) {
                const eyeX = face.noseX
                    + sx * 0.047 * face.faceWidth * face.eyeSpacing;
                const eyeY = YC0 + 0.010 + sx * face.eyeAsym;
                d = smin(d, sdCapsule(
                    x, y, z,
                    eyeX - browHalf, browY - sx * face.browTilt * 0.5,
                    facePlane + 0.003,
                    eyeX + browHalf, browY + sx * face.browTilt * 0.5,
                    facePlane + 0.004,
                    0.0037
                ), 0.0018);
                const socketHalf = 0.018 * face.faceWidth;
                const socket = sdCapsule(
                    x, y, z,
                    eyeX - socketHalf, eyeY + 0.001, facePlane + 0.002,
                    eyeX + socketHalf, eyeY - 0.001, facePlane + 0.002,
                    0.0065
                );
                d = subtract(d, socket, 0.0012);
            }

            // Narrow ridge and compact tip. Projection stays readable at group
            // distance while the side silhouette remains close to the photos.
            const noseTopX = face.noseX - face.noseLean * 0.35;
            const noseTipX = face.noseX + face.noseLean;
            d = smin(d, sdTaperedCapsule(
                x, y, z,
                noseTopX, YC0 + 0.044, facePlane - 0.001,
                noseTipX, YC0 - 0.040, facePlane + 0.014 * face.nose,
                0.0048 * face.noseWidth, 0.0075 * face.noseWidth
            ), 0.0030);
            d = smin(d, sdEllipsoid(
                x - noseTipX,
                y - (YC0 - 0.041),
                z - (facePlane + 0.014 * face.nose),
                0.011 * face.noseWidth,
                0.007,
                0.009
            ), 0.0025);
            d = subtract(d, sdEllipsoid(
                x - noseTipX,
                y - (YC0 - 0.050),
                z - (facePlane + 0.023 * face.nose),
                0.012 * face.noseWidth,
                0.0025,
                0.007
            ), 0.0015);

            // One restrained worn lip ridge and a narrow cast line.
            const mouthWidth = 0.034 * face.mouth;
            const mouthY = YC0 - 0.082 + face.mouthY;
            const leftY = mouthY - face.mouthTilt * 0.5;
            const rightY = mouthY + face.mouthTilt * 0.5;
            d = smin(d, sdCapsule(
                x, y, z,
                -mouthWidth, leftY + 0.002, facePlane + 0.002,
                mouthWidth, rightY + 0.002, facePlane + 0.002,
                0.0030
            ), 0.0010);
            d = subtract(d, sdCapsule(
                x, y, z,
                -mouthWidth * 0.84, leftY - 0.002, facePlane + 0.004,
                mouthWidth * 0.84, rightY - 0.002, facePlane + 0.004,
                0.0010
            ), 0.0007);

            d = smin(d, sdEllipsoid(
                x - face.cheekAsym * 0.85,
                y - (YC0 - 0.126),
                z - (facePlane - 0.016),
                0.036 * face.faceWidth * face.jaw,
                0.018,
                0.010
            ), 0.006);
        }

        d = smin(d, sdCapsule(
            x, y, z,
            0, YC0 - 0.150, 0.006,
            0, YC0 - 0.280, 0.006,
            0.046
        ), 0.046);

        d += fbm3(x * 9, y * 9, z * 9, seed, 2) * 0.0034;
        d += fbm3(x * 27, y * 27, z * 27, seed + 7, 2) * 0.0011;
        return d;
    }
    // World space in, head units out, and the distance scaled back. Surface nets
    // only needs the sign and a monotonic crossing, so a uniformly scaled
    // distance meshes identically — but scaling it keeps the value honest for
    // anything that later reads it as metres.
    // Head turn and tilt, applied as an inverse rotation of the sample point.
    // Six heads at identical angles is one of the loudest tells that a group is
    // a render rather than a casting: the active faces turn differently by role
    // and none of them is quite level.
    const cT = Math.cos(o.headTurn), sT = Math.sin(o.headTurn);
    const cP = Math.cos(o.headTilt), sP = Math.sin(o.headTilt);
    const field = (x, y, z) => {
        const dy = y - yc;
        const rx = x * cT - z * sT;
        const rz = x * sT + z * cT;
        const ry2 = dy * cP + rz * sP;
        const rz2 = -dy * sP + rz * cP;
        return headField(rx / HS, ry2 / HS + YC0, rz2 / HS) * HS;
    };

    // TIGHT BOX, FINER VOXEL. The face's features were measurably correct in the
    // field — 25mm of brow standing off the plane, a 30mm eye socket — and none
    // of them survived the mesher: at 0.0062 the upper lid was three and a half
    // cells tall, and surface nets places ONE vertex per cell at the mean of its
    // edge crossings, so anything that thin is averaged flat. Three passes were
    // spent moving those features around in a field that already had them right.
    //
    // The box is now sized to the head rather than to a generous cube, which
    // pays for the finer sampling: 0.0042 is a third finer than before at rather
    // fewer samples than the loose box cost. Same rule as the body's box —
    // clear the neck stub's full smooth-union envelope and the bun's top, or
    // a sampled mesher leaves a torn rim. The neck reaches about 0.38 head units
    // below YC0 after its blend; 0.34 cut straight through it. The X margin
    // also has to contain the skull after headTurn rotates its Z depth sideways;
    // the rear Z margin must contain the same turn in the other axis.
    const mesh = marchingTetrahedra(field, {
        min: [-0.170 * HS, yc - 0.440 * HS, -0.185 * HS],
        max: [0.170 * HS, yc + 0.310 * HS, 0.185 * HS],
        voxel: 0.0042 * HS,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
    return geo;
}

/** One explicit, closed planted foot peeping from under the leading hem. */
function buildFeet(THREE, opts) {
    const SIDES = 28;
    const positions = [];
    const indices = [];
    const yaw = opts.stride * opts.strideAngle * 0.65;
    const c = Math.cos(yaw), s = Math.sin(yaw);

    const worldPoint = (fx, y, fz) => {
        const dx = fx * c + fz * s;
        const dz = -fx * s + fz * c;
        return [-opts.stride * 0.130 + dx, y, 0.055 + dz];
    };

    for (const [fz, halfWidth, halfHeight, centreY, lateralDrift]
        of PLANTED_FOOT_PROFILE) {
        for (let side = 0; side < SIDES; side++) {
            const theta = side / SIDES * Math.PI * 2;
            const crossX = Math.sign(Math.cos(theta))
                * Math.pow(Math.abs(Math.cos(theta)), 0.82);
            const crossY = Math.sign(Math.sin(theta))
                * Math.pow(Math.abs(Math.sin(theta)), 0.82);
            const fx = crossX * halfWidth
                + opts.stride * lateralDrift;
            const y = centreY + crossY * halfHeight;
            positions.push(...worldPoint(fx, y, fz));
        }
    }

    for (let ring = 0; ring < PLANTED_FOOT_PROFILE.length - 1; ring++) {
        for (let side = 0; side < SIDES; side++) {
            const next = (side + 1) % SIDES;
            const a = ring * SIDES + side;
            const b = ring * SIDES + next;
            const c0 = (ring + 1) * SIDES + side;
            const d = (ring + 1) * SIDES + next;
            indices.push(a, b, c0, b, d, c0);
        }
    }

    const addCap = (ring, outward) => {
        const [fz, , , centreY, lateralDrift] = PLANTED_FOOT_PROFILE[ring];
        const centre = positions.length / 3;
        positions.push(...worldPoint(opts.stride * lateralDrift, centreY, fz));
        const offset = ring * SIDES;
        for (let side = 0; side < SIDES; side++) {
            const next = (side + 1) % SIDES;
            if (outward > 0) indices.push(centre, offset + side, offset + next);
            else indices.push(centre, offset + next, offset + side);
        }
    };
    addCap(0, -1);
    addCap(PLANTED_FOOT_PROFILE.length - 1, 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    return geo;
}

/**
 * Merge a list of BufferGeometries into one.
 *
 * Hand-rolled because BufferGeometryUtils lives in Three's examples/ and this
 * artefact imports nothing but the core build.
 */
export function mergeGeometries(THREE, geos) {
    let vTotal = 0, iTotal = 0;
    for (const g of geos) {
        vTotal += g.attributes.position.count;
        iTotal += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(vTotal * 3);
    const idx = new Uint32Array(iTotal);
    let vo = 0, io = 0;
    for (const g of geos) {
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
            pos[(vo + i) * 3] = p.getX(i);
            pos[(vo + i) * 3 + 1] = p.getY(i);
            pos[(vo + i) * 3 + 2] = p.getZ(i);
        }
        if (g.index) {
            for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
            io += g.index.count;
        } else {
            for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
            io += p.count;
        }
        vo += p.count;
        g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Vertical landmarks, in metres, for `tools/sculpture-proportions.mjs`.
 *
 * Exported rather than duplicated in the tool so the gate can never drift out
 * of step with the geometry it is meant to be checking — if someone moves the
 * head, the measurement moves with it.
 */
export const FIGURE_LANDMARKS = {
    // Heights, metres above the paving. `headCrown` is the normaliser: it is the
    // one landmark every figure has and can be read unambiguously in every
    // photograph, whereas the cowl's height varies per figure by design.
    // The head is built in its own units about `yc` and scaled by `HS` — see
    // buildHeadField. These have to be derived the same way or the gate measures
    // a model that no longer exists, which is a worse failure than a red gate
    // because it is a green one.
    headCrown: 2.113 + 0.156 * 1.335,   // top of the hair mass
    cowlTop: 2.440,                     // tallest cloak in the group
    brow: 2.113 + 0.062 * 1.335,
    nose: 2.113 - 0.032 * 1.335,        // tip of the ridge, not its root
    chin: 2.113 - 0.146 * 1.335,
    shoulder: 1.849,
    bust: 1.543,
    headHeight: 0.302 * 1.335,          // crown to chin

    // Widths, metres, measured across the figure. These are what the gate was
    // missing: every landmark it checked was vertical and all eight had been
    // green since the model was half its current shape, while the errors that
    // remained were all horizontal.
    // All spans are the OUTER SILHOUETTE at that height, arms included, because
    // that is what can be read off a photograph. Measuring the model's bust as
    // the breasts alone and the photograph's as the whole body compares two
    // different things and reports a 0.12 error that is not there.
    headWidth: 2 * 0.134 * 1.335,  // hair mass, 2 x rx
    shoulderSpan: 0.763,           // measured outer mesh slice at y = 1.849
    bustSpan: 0.850,               // measured outer mesh slice at y = 1.543
    waistSpan: 0.853,              // measured outer mesh slice at y = 1.430
    hemSpan: 0.898,                // cloak at the ground, ignoring the train
};

/**
 * Build one figure as a single merged geometry, in local space with its feet on
 * y = 0 and facing +Z.
 *
 * @param {object} THREE
 * @param {object} opts
 * @param {number} opts.seed     drives every noise field, so two figures with
 *                               different seeds are visibly different castings
 * @param {'none'|'cap'|'capbun'} opts.hair head treatment
 * @param {boolean} opts.faceless the complete face is turned to the far side
 * @param {'open'|'developing'|'pregnant'|'cradle'|'clinical'|'visitor'|'badge'} opts.armPose reference-led arm path
 * @param {number} opts.scale    overall height multiplier
 */
export function buildFigure(THREE, opts = {}) {
    const o = {
        seed: opts.seed ?? 1,
        identity: opts.identity ?? 'visitor',
        shell: opts.shell ?? true,
        hair: opts.hair ?? 'cap',
        faceless: opts.faceless ?? false,
        pregnant: opts.pregnant ?? false,
        belly: opts.belly ?? (opts.pregnant ? 1 : 0),
        baby: opts.baby ?? false,
        stethoscope: opts.stethoscope ?? false,
        badge: opts.badge ?? false,
        torsoWidth: opts.torsoWidth ?? 1,
        torsoDepth: opts.torsoDepth ?? 1,
        sheetDepth: opts.sheetDepth ?? 0.40,
        bustWidth: opts.bustWidth ?? 1,
        bustHeight: opts.bustHeight ?? 1,
        bustDepth: opts.bustDepth ?? 1,
        armWidth: opts.armWidth ?? 0.92,
        armPose: opts.armPose
            ?? (opts.baby ? 'cradle' : opts.pregnant ? 'pregnant' : opts.stethoscope ? 'clinical' : 'open'),
        folds: opts.folds ?? 7,
        foldDepth: opts.foldDepth ?? 1,
        foldPhase: opts.foldPhase ?? 0,
        cowlTop: opts.cowlTop ?? 2.420,
        // No two cloaks in the group are swept alike. `openScale` widens or
        // narrows this one's front opening, `sweepLean` leans the whole panel
        // sideways as it rises — both small, both per figure, and together they
        // stop the six folded panels reading as copies of one part.
        openScale: opts.openScale ?? 1,
        sweepLean: opts.sweepLean ?? 0,
        // The walk. `strideAngle` is the direction she is stepping, `hemRake`
        // how far the hem lifts off the leading foot, `stride` which side leads,
        // and `lean` how far her whole column tips forward of vertical.
        strideAngle: opts.strideAngle ?? 0,
        hemRake: opts.hemRake ?? 0,
        stride: opts.stride ?? -1,
        lean: opts.lean ?? 0,
        weightShift: opts.weightShift ?? 0,
        headTurn: opts.headTurn ?? 0,
        headTilt: opts.headTilt ?? 0,
        trainAngle: opts.trainAngle ?? Math.PI,
        trainAmount: opts.trainAmount ?? 0.55,
        scale: opts.scale ?? 1,
    };

    // `only` exists for the isolation probes in sculpture/dev/. Rendering the
    // body without the cloak in front of it is the only way to tell "the torso
    // is wrong" apart from "the torso is hidden", and this model has been
    // debugged the wrong way round once already.
    const only = opts.only || null;
    const want = (name) => !only || only.includes(name);

    const parts = [];
    if (o.shell && want('shell')) {
        parts.push(buildReliefShell(THREE, o));
        parts.push(buildCowlBacking(THREE, o));
    }
    if (want('body')) parts.push(buildBodyField(THREE, o));
    if (want('feet')) parts.push(buildFeet(THREE, o));
    if (want('head')) parts.push(buildHeadField(THREE, o));
    if (o.baby && want('baby')) parts.push(buildBabyGeometry(THREE, o));
    if (o.stethoscope && want('stethoscope')) parts.push(buildStethoscopeGeometry(THREE));
    if (o.badge && want('badge')) parts.push(buildBadgeField(THREE, o));

    const geo = mergeGeometries(THREE, parts);

    // FORWARD LEAN, as a shear rather than a rotation. Rotating the figure would
    // tip her feet off the paving and lift one edge of the hem into the air;
    // shearing z by height leaves everything at ground level exactly where it
    // was and tips only what is above it, which is what walking looks like.
    if (o.lean) {
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            pos.setZ(i, pos.getZ(i) + pos.getY(i) * o.lean);
        }
        pos.needsUpdate = true;
    }

    // Settle the column over one planted foot. This is a height-eased shear:
    // the hem and support foot remain fixed on the paving while pelvis, torso,
    // head and cowl progressively move over the load-bearing side.
    if (o.weightShift) {
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const t = Math.min(1, Math.max(0, (pos.getY(i) - 0.18) / 1.17));
            const eased = t * t * (3 - 2 * t);
            pos.setX(i, pos.getX(i) + o.weightShift * eased);
        }
        pos.needsUpdate = true;
    }

    if (o.scale !== 1) geo.scale(o.scale, o.scale, o.scale);
    geo.computeVertexNormals();
    return geo;
}

/** Legacy, currently unused: the pre-Phase-3 smooth ovoid blank head. */
function buildBlankHead(THREE, opts) {
    const parts = [];
    const yc = 2.005;
    const skull = new THREE.SphereGeometry(1, 30, 22);
    skull.scale(0.106, 0.143, 0.114);
    skull.translate(0, yc, 0);
    parts.push(skull);
    const jaw = new THREE.SphereGeometry(1, 18, 14);
    jaw.scale(0.070, 0.058, 0.076);
    jaw.translate(0, yc - 0.074, 0.014);
    parts.push(jaw);
    const neck = new THREE.CylinderGeometry(0.049, 0.062, 0.14, 20, 1);
    neck.translate(0, yc - 0.192, 0.004);
    parts.push(neck);
    const geo = mergeGeometries(THREE, parts);
    return roughen(THREE, geo, { amount: 0.004, scale: 7.5, seed: opts.seed + 13 });
}

export default buildFigure;
