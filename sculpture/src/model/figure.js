/**
 * model/figure.js — one of the four bronze women, built from curves.
 *
 * Nothing here is loaded. The whole sculpture is generated from profile curves
 * and swept surfaces, the same way Birb Gauntlet generates its world, so it
 * works offline, ships as a few kilobytes of source, and — the part that
 * matters for this job — every proportion is a NUMBER you can tune against a
 * photograph rather than a vertex you would have to sculpt.
 *
 * ---------------------------------------------------------------------------
 * ANATOMY OF ONE FIGURE, as read off the four reference photos
 * ---------------------------------------------------------------------------
 *
 *   COWL      The dominant form and the one that makes the silhouette. A large
 *             curved shell standing up behind the head, open at the front,
 *             sweeping down and outward to the ground as a cloak. In profile it
 *             is a thin plate; from the front it is an arch framing the face.
 *   BODY      A lathe: shoulders → bust → waist → hips → robe flaring to the
 *             ground. Elliptical, not circular — the figures are noticeably
 *             deeper front-to-back at the hem than they are wide.
 *   BREASTS   Two hemispheres sitting ON the torso, not blended into it. The
 *             originals read as applied lumps and copying that is what stops
 *             the torso looking like a vase.
 *   HEAD      An ovoid with a face in shallow relief: brow, straight nose,
 *             slit mouth, recessed eyes. Extremely reduced — anything more
 *             detailed reads as a mannequin rather than as cast bronze.
 *   FEET      Bare, protruding from under the hem at the front. Small, but they
 *             are the only thing telling you there is a person inside the robe.
 *
 * Units are metres. The figures stand about 2.3m; a person walks past one in
 * `ref-d-wide.jpg` for scale.
 */

import { fbm3 } from '../core/noise.js';

// ---------------------------------------------------------------------------
// Profile curves
// ---------------------------------------------------------------------------


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
 * Displace every vertex along its own normal by fractal noise, then rebuild
 * normals.
 *
 * This is the single most important line in the file for likeness. A lathed
 * surface is perfectly smooth and reads as machined; the originals were pushed
 * into shape by hand and hold every one of those pushes. `scale` sets the size
 * of the lumps and `amount` how deep they go.
 */
function roughen(THREE, geo, { amount = 0.012, scale = 3.2, seed = 1, octaves = 2 } = {}) {
    geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const d = fbm3(x * scale, y * scale, z * scale, seed, octaves) * amount;
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
 * The robe AND the hood, as ONE swept shell.
 *
 * This started as two pieces — a body lathe with a separate cowl shell around
 * it — and that was the single biggest thing wrong with the model. A shell
 * whose radius is only a little larger than the body it wraps presents nothing
 * but its two vertical edges to a front-on camera, so the figures read as
 * people standing between a pair of rails. In the originals there is no
 * separate cowl: the robe simply keeps going up past the shoulders and opens at
 * the front to let the face out. One surface, one silhouette.
 *
 * The cross-section is a crescent (outer wall, inner wall, closed at the rim),
 * so the casting has real wall thickness and the hem and the hood opening both
 * show an edge. `FRONT_OPENING` is what turns the robe into a hood: zero below
 * the shoulders, opening up to nearly a half-turn at the crown.
 */
const SHELL_PROFILE = [
    // [height, halfWidthX, halfDepthZ]
    [0.000, 0.430, 0.362],
    [0.140, 0.400, 0.344],
    [0.340, 0.358, 0.316],
    [0.560, 0.318, 0.288],
    [0.800, 0.282, 0.262],
    [1.000, 0.258, 0.243],
    [1.160, 0.240, 0.228],
    [1.300, 0.232, 0.219],
    [1.420, 0.238, 0.217],
    [1.520, 0.244, 0.214],
    [1.610, 0.246, 0.208],
    [1.700, 0.248, 0.200],
    [1.800, 0.252, 0.196],
    [1.900, 0.262, 0.200],
    [2.050, 0.268, 0.204],
    [2.180, 0.264, 0.200],
    [2.300, 0.242, 0.184],
    [2.380, 0.200, 0.154],
    [2.420, 0.150, 0.116],
];

/**
 * [height, halfAngle of the FRONT opening]. Zero = a closed robe.
 *
 * The opening starts at the HIP, not at the shoulder. This is the thing the
 * model kept getting wrong: in the originals the cloak falls open all the way
 * down the front and the torso inside it is bare — breasts, ribs and belly are
 * fully modelled. Closing the robe at chest height turns four women into four
 * bottles, which is what the earlier passes looked like.
 */
const FRONT_OPENING = [
    [0.860, 0.00],
    [0.980, 0.30],
    [1.150, 0.55],
    [1.330, 0.72],
    [1.520, 0.86],
    [1.700, 1.00],
    [1.900, 1.14],
    [2.080, 1.26],
    [2.260, 1.38],
    [2.420, 1.50],
];

const WALL = 0.040;

function buildShell(THREE, opts) {
    const RINGS = 76;
    const ARC = 30;                       // segments along one wall of the crescent
    const yTop = SHELL_PROFILE[SHELL_PROFILE.length - 1][0];

    const positions = [];
    const indices = [];
    const loop = (ARC + 1) * 2;

    for (let r = 0; r <= RINGS; r++) {
        const y = (r / RINGS) * yTop;
        const [hw, hd] = sampleProfile(SHELL_PROFILE, y);
        const open = sampleProfile(FRONT_OPENING, y)[0];

        for (let side = 0; side < 2; side++) {
            const k = side === 0 ? 1 : 1 - WALL / Math.max(hw, 0.06);
            for (let s = 0; s <= ARC; s++) {
                const u = side === 0 ? s / ARC : 1 - s / ARC;
                // Walk from the near edge of the opening, round the back, to
                // the far edge. At open = 0 this is a complete revolution.
                const th = open + u * (Math.PI * 2 - open * 2);
                const cs = Math.cos(th), sn = Math.sin(th);
                // Slight flattening front and back: the robes carry their
                // fullness at the sides, not as a round tube.
                const flat = 1 - 0.09 * Math.pow(Math.abs(cs), 3);

                // DRAPERY. Every reference photograph is dominated by vertical
                // fold ridges running the length of the robe, and without them
                // the shell reads as a smooth cone no amount of surface noise
                // can rescue. The ridges run down the figure with a slow twist,
                // and they DEEPEN toward the hem where the cloth gathers —
                // constant-depth folds look machined, like fluting on a column.
                const gather = Math.pow(Math.max(0, 1 - y / 1.85), 1.35);
                const depth = (0.030 + 0.105 * gather) * opts.foldDepth;
                const fold = 1
                    + depth * Math.cos(th * opts.folds + y * 0.55 + opts.foldPhase)
                    + depth * 0.42 * Math.cos(th * (opts.folds * 2 + 1) - y * 0.9 + opts.foldPhase * 1.7);
                positions.push(sn * hw * k * fold, y, cs * hd * flat * k * fold);
            }
        }
    }

    for (let r = 0; r < RINGS; r++) {
        for (let s = 0; s < loop; s++) {
            const s2 = (s + 1) % loop;
            const a = r * loop + s, b = r * loop + s2;
            const c = (r + 1) * loop + s, d = (r + 1) * loop + s2;
            indices.push(a, c, b, b, c, d);
        }
    }

    // Close the hem: a flat annulus between the outer and inner walls, so the
    // figure is not an open pipe when you orbit down to ground level.
    const base = 0;
    for (let s = 0; s < ARC; s++) {
        const o1 = base + s, o2 = base + s + 1;
        const i1 = base + loop - 1 - s, i2 = base + loop - 2 - s;
        indices.push(o1, o2, i1, o2, i2, i1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    // Broad, low-frequency undulation: this is a big hand-beaten sheet, so it
    // should ripple rather than pebble.
    return roughen(THREE, geo, { amount: 0.014, scale: 2.2, seed: opts.seed });
}

/**
 * The nude torso standing inside the open cloak.
 *
 * Runs from inside the skirt up to the neck. Deliberately narrower than the
 * shell at every height so it never pokes through the back of the cloak, and
 * deliberately NOT a smooth taper — the waist pinch and the swell of the belly
 * are what read as a body rather than as a mannequin stand.
 */
const TORSO_PROFILE = [
    [0.700, 0.212, 0.176],
    [0.912, 0.204, 0.172],
    [1.076, 0.196, 0.168],
    [1.217, 0.180, 0.156],
    [1.334, 0.166, 0.146],
    [1.440, 0.162, 0.144],   // waist
    [1.546, 0.172, 0.150],
    [1.640, 0.180, 0.154],   // ribs, under the bust
    [1.734, 0.180, 0.150],
    [1.828, 0.172, 0.140],
    [1.911, 0.156, 0.126],   // shoulder line — 0.790 of total height
    [1.981, 0.104, 0.096],
    [2.046, 0.062, 0.062],   // neck
];

function buildTorso(THREE, opts) {
    const RINGS = 34;
    const SEG = 34;
    const y0 = TORSO_PROFILE[0][0];
    const y1 = TORSO_PROFILE[TORSO_PROFILE.length - 1][0];
    const positions = [];
    const indices = [];

    for (let r = 0; r <= RINGS; r++) {
        const y = y0 + (y1 - y0) * (r / RINGS);
        const [hw, hd] = sampleProfile(TORSO_PROFILE, y);
        for (let s = 0; s <= SEG; s++) {
            const a = (s / SEG) * Math.PI * 2;
            positions.push(Math.sin(a) * hw, y, Math.cos(a) * hd);
        }
    }
    for (let r = 0; r < RINGS; r++) {
        for (let s = 0; s < SEG; s++) {
            const a = r * (SEG + 1) + s;
            const b = a + SEG + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return roughen(THREE, geo, { amount: 0.007, scale: 4.4, seed: opts.seed + 61 });
}

/** Head, with the face carved as shallow relief on the front of an ovoid. */
function buildHead(THREE, opts) {
    const parts = [];
    const yc = 2.159;

    const skull = new THREE.SphereGeometry(1, 30, 22);
    skull.scale(0.113, 0.146, 0.119);
    skull.translate(0, yc, 0.004);
    parts.push(skull);

    // Brow: a shallow bar, not a ridge. On the originals the brow is the only
    // hard line on the face and everything else is soft.
    const brow = new THREE.SphereGeometry(1, 16, 10);
    brow.scale(0.082, 0.018, 0.032);
    brow.translate(0, yc + 0.058, 0.108);
    parts.push(brow);

    // Nose: long, straight, narrow — the Modigliani note in these faces.
    const nose = new THREE.SphereGeometry(1, 14, 12);
    nose.scale(0.019, 0.058, 0.028);
    nose.translate(0, yc - 0.014, 0.119);
    parts.push(nose);

    // Mouth: a small horizontal pad. A slit modelled as a groove disappears at
    // any distance; a slightly proud pad keeps a readable shadow under it.
    const mouth = new THREE.SphereGeometry(1, 14, 10);
    mouth.scale(0.030, 0.010, 0.017);
    mouth.translate(0, yc - 0.082, 0.112);
    parts.push(mouth);

    // Chin/jaw fullness.
    const jaw = new THREE.SphereGeometry(1, 18, 14);
    jaw.scale(0.082, 0.066, 0.086);
    jaw.translate(0, yc - 0.096, 0.022);
    parts.push(jaw);

    // Neck.
    // Short neck. An exposed column reads as a doll; on the originals the
    // head sits almost straight on the shoulders.
    const neck = new THREE.CylinderGeometry(0.058, 0.104, 0.135, 20, 1);
    neck.translate(0, yc - 0.192, 0.008);
    parts.push(neck);

    if (opts.bun) {
        // Coiled bun, sitting high and to the back. Two of the four wear one.
        const bun = new THREE.TorusGeometry(0.045, 0.021, 10, 22);
        bun.rotateX(Math.PI / 2 - 0.30);
        bun.translate(0, yc + 0.134, -0.038);
        parts.push(bun);
        const hair = new THREE.SphereGeometry(1, 20, 14);
        hair.scale(0.108, 0.088, 0.100);
        hair.translate(0, yc + 0.056, -0.026);
        parts.push(hair);
    }

    const geo = mergeGeometries(THREE, parts);
    return roughen(THREE, geo, { amount: 0.0035, scale: 8.0, seed: opts.seed + 13 });
}

/**
 * Shoulders and arms.
 *
 * The originals are not armless columns — each figure has a clear shoulder line
 * and upper arms held against the body, and on two of them a forearm crosses
 * the waist. Without these the torso reads as a bottle, which is exactly what
 * the first render of this model looked like.
 */
function buildArms(THREE, opts) {
    const parts = [];

    // Shoulder slope, not a yoke bar. The first attempt used a wide flattened
    // bar and the figures read as scarecrows on a crosspiece — the originals
    // have a soft shoulder that falls straight into the arm.
    for (const sx of [-1, 1]) {
        const shoulder = new THREE.SphereGeometry(1, 18, 14);
        shoulder.scale(0.068, 0.060, 0.074);
        shoulder.translate(sx * 0.124, 1.905, 0.002);
        parts.push(shoulder);

        // Upper arm: essentially VERTICAL, pressed against the ribs. Anything
        // more than a few degrees out and the silhouette stops being a column.
        const upper = new THREE.CylinderGeometry(0.048, 0.042, 0.40, 16, 1);
        upper.rotateZ(sx * 0.052);
        upper.translate(sx * 0.152, 1.678, 0.018);
        parts.push(upper);

        // Elbow into forearm, still close to the body, drifting a little
        // forward as it descends.
        const fore = new THREE.CylinderGeometry(0.042, 0.037, 0.32, 14, 1);
        fore.rotateZ(sx * 0.10);
        fore.rotateX(-0.20);
        fore.translate(sx * 0.146, 1.348, 0.058);
        parts.push(fore);
    }

    if (opts.hands) {
        // Two hands meeting low at the front — the gesture in ref-a-front. A
        // single flattened mass, because that is how it was cast: you read a
        // pair of hands, not ten fingers.
        const hand = new THREE.SphereGeometry(1, 18, 14);
        hand.scale(0.106, 0.052, 0.070);
        hand.translate(0, 1.155, 0.200);
        parts.push(hand);
    }

    const geo = mergeGeometries(THREE, parts);
    return roughen(THREE, geo, { amount: 0.005, scale: 6.5, seed: opts.seed + 41 });
}

/** Bare feet peeping from under the hem. */
function buildFeet(THREE, opts) {
    const parts = [];
    for (const sx of [-1, 1]) {
        const f = new THREE.SphereGeometry(1, 14, 10);
        f.scale(0.058, 0.034, 0.105);
        f.translate(sx * 0.070, 0.040, 0.290 + (sx > 0 ? 0.020 : 0));
        parts.push(f);
    }
    const geo = mergeGeometries(THREE, parts);
    return roughen(THREE, geo, { amount: 0.004, scale: 9, seed: opts.seed + 21 });
}

/** Breasts, as applied hemispheres. */
function buildBust(THREE, opts) {
    const parts = [];
    for (const sx of [-1, 1]) {
        const b = new THREE.SphereGeometry(1, 20, 16);
        b.scale(0.081, 0.072, 0.050);
        b.translate(sx * 0.073, 1.711, 0.122);
        parts.push(b);
    }
    const geo = mergeGeometries(THREE, parts);
    return roughen(THREE, geo, { amount: 0.005, scale: 7, seed: opts.seed + 31 });
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
    cowlTop: 2.420,
    headCrown: 2.159 + 0.146,
    brow: 2.159 + 0.058,
    nose: 2.159 - 0.014,
    chin: 2.159 - 0.146,
    shoulder: 1.911,
    bust: 1.711,
    headHeight: 0.292,
};

/**
 * Build one figure as a single merged geometry, in local space with its feet on
 * y = 0 and facing +Z.
 *
 * @param {object} THREE
 * @param {object} opts
 * @param {number} opts.seed     drives every noise field, so two figures with
 *                               different seeds are visibly different castings
 * @param {boolean} opts.bun     wears the coiled bun
 * @param {boolean} opts.faceless the head is turned away — no face relief
 * @param {boolean} opts.hands   hands meet at the front of the waist
 * @param {number} opts.scale    overall height multiplier
 */
export function buildFigure(THREE, opts = {}) {
    const o = {
        seed: opts.seed ?? 1,
        bun: opts.bun ?? false,
        faceless: opts.faceless ?? false,
        hands: opts.hands ?? false,
        folds: opts.folds ?? 7,
        foldDepth: opts.foldDepth ?? 1,
        foldPhase: opts.foldPhase ?? 0,
        scale: opts.scale ?? 1,
    };

    const parts = [
        buildShell(THREE, o), buildTorso(THREE, o), buildBust(THREE, o),
        buildArms(THREE, o), buildFeet(THREE, o),
    ];
    parts.push(o.faceless ? buildBlankHead(THREE, o) : buildHead(THREE, o));

    const geo = mergeGeometries(THREE, parts);
    if (o.scale !== 1) geo.scale(o.scale, o.scale, o.scale);
    geo.computeVertexNormals();
    return geo;
}

/** The fourth figure faces away: a smooth ovoid with a bun and no features. */
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
