/**
 * model/figure.js — one of the four bronze women, built from curves.
 *
 * Nothing here is loaded. The whole sculpture is generated from profile curves,
 * swept cast sections and signed-distance fields, so it works offline, ships as
 * source, and — the part that matters for this job — every proportion is a
 * NUMBER you can tune against a photograph rather than a vertex you would have
 * to sculpt.
 *
 * ---------------------------------------------------------------------------
 * ANATOMY OF ONE FIGURE, as read off the four reference photos
 * ---------------------------------------------------------------------------
 *
 *   COWL      One thick swept plate standing BEHIND the body. It stays open its
 *             full height, rises into the collar-arch and trails on the paving;
 *             the front skirt is not part of this shell.
 *   BODY      One blended distance field from skirt hem to collarbone: tapered
 *             elliptical trunk, bust, shoulders, arms and the narrative forms.
 *             It is heavy and columnar, not a pinched lathe or a flared bell.
 *   ARMS      Four reference-led poses, not one generic pair copied four times.
 *             The nearest arm bows clear of the ribs; the pregnant figure
 *             supports her belly; the mother's forearms cross under the baby;
 *             the clinician carries one arm back beside the stethoscope.
 *   BREASTS   Bold ellipsoidal relief blended into the chest with a fillet well
 *             smaller than the protrusion. Separate hemispheres and over-large
 *             blends both produced applied lumps or erased the form entirely.
 *   HEAD      A rounded block with flat front and sides, domed crown and broad
 *             jaw. The face is deliberately reduced but its features must be
 *             thick enough to survive surface nets at group viewing distance.
 *   FEET      One fused planted foot emerges from each raised hem, tapered from
 *             instep to toe and seated under the SKIRT instead of beside it.
 *
 * Units are metres. The figures stand about 2.3m; a person walks past one in
 * `ref-d-wide.jpg` for scale.
 */

import { fbm3 } from '../core/noise.js';
import { sdEllipsoid, sdCapsule, sdRoundBox, smin, smax, subtract, surfaceNets } from './sdf.js';

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
 * the trunk. A short tapered extension beyond the wrist supplies the reduced,
 * mitten-like hand visible in the casting; ending at a capsule cap made the
 * hands disappear and left every arm looking like a pipe.
 */
export const ARM_POSES = Object.freeze({
    open: [
        // Nearest figure: her left arm makes the reference's clear wedge of sky
        // between arm and ribs. The other arm stays close and is partly lost in
        // the crowded group, as it is in ref-a-front.
        { shoulder: [-0.298, 1.820, 0.000], elbow: [-0.405, 1.500, 0.030], wrist: [-0.432, 0.900, 0.070], upper: 0.060, fore: 0.052, hand: 0.076 },
        { shoulder: [ 0.298, 1.820, 0.000], elbow: [ 0.352, 1.500, 0.028], wrist: [ 0.360, 0.935, 0.074], upper: 0.058, fore: 0.052, hand: 0.074 },
    ],
    pregnant: [
        // One arm hangs; the other turns forward and supports the underside of
        // the pregnancy. It remains a restrained gesture, but it cannot be
        // mistaken for the open pose or the crossed baby pose.
        { shoulder: [-0.298, 1.820, 0.000], elbow: [-0.362, 1.505, 0.020], wrist: [-0.360, 0.910, 0.080], upper: 0.059, fore: 0.052, hand: 0.074 },
        { shoulder: [ 0.298, 1.820, 0.000], elbow: [ 0.360, 1.555, 0.038], wrist: [ 0.082, 1.205, 0.252], upper: 0.059, fore: 0.053, hand: 0.066 },
    ],
    cradle: [
        // The mother's forearms CROSS beneath the swaddled newborn. Their
        // slightly different heights keep the crossing readable instead of
        // collapsing into one horizontal bolster.
        { shoulder: [-0.298, 1.820, 0.000], elbow: [-0.350, 1.555, 0.044], wrist: [ 0.098, 1.326, 0.238], upper: 0.058, fore: 0.052, hand: 0.060 },
        { shoulder: [ 0.298, 1.820, 0.000], elbow: [ 0.350, 1.515, 0.054], wrist: [-0.090, 1.282, 0.250], upper: 0.058, fore: 0.052, hand: 0.060 },
    ],
    clinical: [
        // The clinician's near arm hangs straight while the far arm sweeps a
        // little back and out. That leaves the stethoscope and chest unobscured
        // and gives her a different side silhouette from the open figure.
        { shoulder: [-0.298, 1.820, 0.000], elbow: [-0.360, 1.490, 0.018], wrist: [-0.352, 0.885, 0.072], upper: 0.058, fore: 0.051, hand: 0.074 },
        { shoulder: [ 0.298, 1.820, 0.000], elbow: [ 0.365, 1.505, -0.002], wrist: [ 0.425, 0.940, -0.018], upper: 0.058, fore: 0.051, hand: 0.072 },
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
 * `FRONT_OPENING` removes the whole front at every height; it does not turn a
 * closed robe into a hood only above the shoulders.
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
    // The arch narrows hard above the shoulders. Left as wide as the body it
    // framed each head in a doorway three times the head's width; in
    // `ref-c-under.jpg` the collar clears the crown by a hand's breadth. It has
    // to clear a HEAD, though, and the head is now a third bigger than it was.
    [2.000, 0.340, 0.156],
    [2.140, 0.302, 0.146],
    [2.280, 0.264, 0.132],
    [2.380, 0.220, 0.116],
    [2.440, 0.180, 0.100],
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
    // IT NEVER CLOSES. Earlier versions ran the opening to zero by knee height,
    // which turned the cloak into a tube below the hip and put a deep dark V up
    // the front of every figure where its two rims converged. No amount of
    // moving these keyframes removed that notch, because the notch was the
    // structure: a cloak that closes has to close SOMEWHERE.
    //
    // The photographs show it does not. She wears a long skirt — that is the
    // smooth continuous surface down the front of her in `ref-a-front.jpg` — and
    // the cloak is a panel hanging BEHIND it, open its whole height. So the
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
    [2.030, 1.70],
    [2.220, 1.80],
    [2.440, 1.88],
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
    return -0.150 * t * t * (3 - 2 * t);
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

function buildShell(THREE, opts) {
    const RINGS = 76;
    const ARC = 30;                       // segments along one wall of the crescent
    const RIM = 5;                        // segments rounding one free edge
    // NOT every cloak goes over its wearer's head. In `ref-a-front.jpg` the
    // nearest figure's stops at her shoulders and her head stands completely
    // free; two others carry the full arch behind the crown. Building all four
    // the same height gave a row of identical doorways.
    const yTop = opts.cowlTop;

    const positions = [];
    const indices = [];
    // outer wall + far bead + inner wall + near bead
    const loop = (ARC + 1) * 2 + (RIM - 1) * 2;

    for (let r = 0; r <= RINGS; r++) {
        const y = (r / RINGS) * yTop;
        const [hw, hd] = sampleProfile(SHELL_PROFILE, y);
        const open = sampleProfile(FRONT_OPENING, y)[0] * opts.openScale;
        const zOff = shellOffsetZ(y);
        // Round the last 28cm off to whatever height this cloak stops at, so a
        // truncated one ends in a curve rather than a flat lid.
        const capT = Math.max(0, (y - (yTop - 0.28)) / 0.28);
        const cap = 1 - 0.66 * capT * capT;

        // THE CROSS-SECTION, as ONE closed loop: outer wall from the near edge
        // round the back to the far edge, a rounded bead over that edge, the
        // inner wall back again, and a bead over the near edge. Built as two
        // separate walls meeting at a fold, which is what it was, the free edges
        // had no section to show and the cloak read as cut paper.
        //
        // The bead sweeps radius from the outer wall to the inner one while
        // bulging PAST the edge by half the wall thickness, so it is a proper
        // half-round. `rimRad` converts that half-thickness into radians at this
        // ring's radius, and fades out as the opening closes — a ring with no
        // opening has no free edge to round, and bulging past a seam that is not
        // there just creases the front of the skirt.
        const kIn = 1 - WALL / Math.max(hw, 0.06);
        const midR = (1 + kIn) * 0.5;
        const halfT = (1 - kIn) * 0.5;
        const far = Math.PI * 2 - open;
        const rimFade = Math.min(1, Math.max(0, (open - 0.02) / 0.14));
        const rimRad = (WALL / (2 * Math.max(hw, 0.06))) * rimFade;

        const section = [];
        for (let s = 0; s <= ARC; s++) section.push([open + (far - open) * s / ARC, 1]);
        for (let i = 1; i < RIM; i++) {
            const ph = Math.PI * i / RIM;
            section.push([far + rimRad * Math.sin(ph), midR + halfT * Math.cos(ph)]);
        }
        for (let s = 0; s <= ARC; s++) section.push([far - (far - open) * s / ARC, kIn]);
        for (let i = 1; i < RIM; i++) {
            const ph = Math.PI * i / RIM;
            section.push([open - rimRad * Math.sin(ph), midR - halfT * Math.cos(ph)]);
        }

        {
            for (const [th, k] of section) {
                const cs = Math.cos(th), sn = Math.sin(th);
                // Slight flattening front and back: the robes carry their
                // fullness at the sides, not as a round tube.
                const flat = 1 - 0.09 * Math.pow(Math.abs(cs), 3);

                // THE TRAIN. Each cloak drags out to one side and pools on the
                // paving — in `ref-b-threequarter.jpg` the nearest figure's
                // sweeps almost a metre clear of her feet. Without it the hems
                // are four tidy bells and the group loses the sense of cloth
                // that has been walked in.
                // THE TRAIN IS A DISPLACEMENT, NOT A SCALE, and that distinction
                // is the single biggest silhouette fix in this pass. Multiplying
                // the ring's radius pushed the hem out in EVERY direction on the
                // trailing half, including sideways: measured on the first
                // matched-view sheet the model's hem spanned 0.56 of figure
                // height against the photograph's 0.39, while the base profile
                // measured correct to within 0.007. All of that error was this
                // one line. Real cloth trailing off a walking figure goes
                // BACKWARD; it does not make her wider.
                //
                // So the trailing half of each low ring is translated along
                // `trainAngle` by up to `trainAmount` METRES, and the leading
                // half does not move at all.
                // Concentrated hard at the ground so the tail LIES FLAT on the
                // paving rather than sweeping up the back of the figure like a
                // cape. In `ref-c-under.jpg` it is a long low tongue of bronze
                // on the pavement, and its top edge barely leaves the ground.
                const trail = Math.max(0, Math.cos(th - opts.trainAngle));
                const low = Math.pow(Math.max(0, 1 - y / 0.58), 2.6);
                const tail = opts.trainAmount * trail * trail * low;

                // DRAPERY. Every reference photograph is dominated by vertical
                // fold ridges running the length of the robe, and without them
                // the shell reads as a smooth cone no amount of surface noise
                // can rescue. The ridges run down the figure with a slow twist,
                // and they DEEPEN toward the hem where the cloth gathers —
                // constant-depth folds look machined, like fluting on a column.
                // THE RAKE. A walking figure's hem is not a horizontal line: it
                // is lifted clear of the leading foot and left trailing behind
                // the other. In `ref-c-under.jpg` you can see straight under the
                // near figure's hem to her planted foot, and the cloth behind
                // her is still on the ground. Lift only — dropping the back edge
                // would push it through the paving.
                const rake = opts.hemRake * Math.max(0, Math.cos(th - opts.strideAngle))
                    * Math.pow(Math.max(0, 1 - y / 0.62), 2.0);

                const gather = Math.pow(Math.max(0, 1 - y / 1.85), 1.35);
                const depth = (0.026 + 0.058 * gather) * opts.foldDepth;
                const fold = 1
                    + depth * Math.cos(th * opts.folds + y * 0.55 + opts.foldPhase)
                    + depth * 0.42 * Math.cos(th * (opts.folds * 2 + 1) - y * 0.9 + opts.foldPhase * 1.7);
                positions.push(
                    sn * hw * cap * k * fold + Math.sin(opts.trainAngle) * tail
                        + y * opts.sweepLean,
                    y + rake,
                    cs * hd * cap * flat * k * fold + zOff + Math.cos(opts.trainAngle) * tail
                );
            }
        }
    }

    for (let r = 0; r < RINGS; r++) {
        for (let s = 0; s < loop; s++) {
            const s2 = (s + 1) % loop;
            const a = r * loop + s, b = r * loop + s2;
            const c = (r + 1) * loop + s, d = (r + 1) * loop + s2;
            indices.push(a, b, c, b, d, c);
        }
    }

    // Close the complete wall section at both ends. The old hem cap covered
    // only the straight outer/inner arcs, leaving the rounded beads open, and
    // the top had no cap at all.
    const capRing = (ring, outwardY) => {
        const offset = ring * loop;
        const contour = [];
        for (let s = 0; s < loop; s++) {
            contour.push(new THREE.Vector2(
                positions[(offset + s) * 3],
                positions[(offset + s) * 3 + 2]
            ));
        }
        for (const face of THREE.ShapeUtils.triangulateShape(contour, [])) {
            let a = offset + face[0], b = offset + face[1], c = offset + face[2];
            const ax = positions[a * 3], az = positions[a * 3 + 2];
            const bx = positions[b * 3], bz = positions[b * 3 + 2];
            const cx = positions[c * 3], cz = positions[c * 3 + 2];
            const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
            if (ny * outwardY < 0) [b, c] = [c, b];
            indices.push(a, b, c);
        }
    };
    capRing(0, -1);
    capRing(RINGS, 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    // Broad, low-frequency undulation: this is a big hand-beaten sheet, so it
    // should ripple rather than pebble — then a second finer pass for the
    // hammer marks, because ripple alone still reads as a moulded plastic shell.
    roughen(THREE, geo, { amount: 0.020, scale: 2.0, seed: opts.seed });
    return roughen(THREE, geo, { amount: 0.0060, scale: 10.5, seed: opts.seed + 9 });
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
    // the cloak's front opening never closes, so stopping the body at the hip
    // leaves no front surface below it and reads as a tear in the casting.
    // A STRAIGHT TAPER, WIDENING DOWNWARD, with no waist to speak of. Measured
    // off the nearest figure in `ref-a-front.jpg` at four heights, her spans go
    // shoulder 0.327, bust 0.342, waist 0.356, hem 0.387 of her own height —
    // monotonically wider all the way down. Every earlier version of this table
    // pinched at the waist and flared below it, which is a fashion croquis, not
    // these women; it is most of why the model read as four mannequins beside
    // photographs of four heavy standing people.
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
 * Distance to the tapered elliptical trunk described by TORSO_PROFILE.
 *
 * A stack of blended spheres would need dozens of primitives to stay smooth;
 * sampling the profile directly costs one lookup and gives an exact elliptical
 * cross-section at every height.
 */
function sdTrunk(x, y, z, y0, y1) {
    if (y < y0) {
        const d = sdTrunkAt(x, y0, z);
        return Math.hypot(Math.max(d, 0), y0 - y) + Math.min(d, 0) * 0;
    }
    if (y > y1) {
        const d = sdTrunkAt(x, y1, z);
        return Math.hypot(Math.max(d, 0), y - y1);
    }
    return sdTrunkAt(x, y, z);
}

function sdTrunkAt(x, y, z) {
    const [hw, hd] = sampleProfile(TORSO_PROFILE, y);
    // Elliptical bound, scaled back into world units by the smaller radius so
    // the value stays a usable distance rather than a raw ratio.
    const kx = x / hw, kz = z / hd;
    const r = Math.sqrt(kx * kx + kz * kz);
    return (r - 1) * Math.min(hw, hd);
}

function buildBodyField(THREE, o) {
    const seed = o.seed;
    const arms = ARM_POSES[o.armPose] || ARM_POSES.open;

    function field(x, y, z) {
        // Trunk from well down inside the skirt up to the base of the neck.
        // The skirt's hem is raked to match the cloak's, so the lift reveals a
        // planted foot rather than cutting a step into the front of the drape.
        const hemY = o.hemRake * Math.max(0, Math.cos(Math.atan2(x, z) - o.strideAngle)) * 0.92;
        let d = sdTrunk(x, y, z, hemY, 1.960);

        // Bust. THE BLEND RADIUS MUST BE WELL UNDER THE PROTRUSION — this is
        // the one rule of modelling with smin and the first version broke it.
        // A form standing 0.02 proud of the chest wall, blended at k=0.10, is
        // not a soft bust: it is no bust at all, because the fillet is five
        // times deeper than the feature and swallows it whole. Everything
        // below protrudes 2-3x its own blend.
        for (const sx of [-1, 1]) {
            d = smin(d, sdEllipsoid(x - sx * 0.120, y - 1.530, z - 0.132,
                0.124, 0.092, 0.100), 0.055);
        }

        // Per-figure arms. The deltoid still grows out of the measured shoulder
        // line, but below it each path follows the reference instead of one
        // generic vertical capsule. The smaller forearm blend is deliberate:
        // a large smooth-union radius bridges a real gap back to the trunk and
        // silently destroys A7 even when the centreline is in the right place.
        for (const arm of arms) {
            const [sx, sy, sz] = arm.shoulder;
            const [ex, ey, ez] = arm.elbow;
            const [wx, wy, wz] = arm.wrist;
            d = smin(d, sdEllipsoid(x - sx, y - sy, z - sz,
                0.081, 0.072, 0.087), 0.050);
            d = smin(d, sdCapsule(x, y, z,
                sx, sy - 0.018, sz + 0.010, ex, ey, ez, arm.upper), 0.032);
            d = smin(d, sdCapsule(x, y, z,
                ex, ey, ez, wx, wy, wz, arm.fore), 0.022);

            // Continue past the wrist with a short two-stage taper. The casting
            // reduces hands to mitten-like masses, but it still has hands; a
            // forearm that simply ends in a hemisphere reads as a pipe.
            const hdx = wx - ex, hdy = wy - ey, hdz = wz - ez;
            const hlen = Math.hypot(hdx, hdy, hdz) || 1;
            const handLength = arm.hand ?? 0.070;
            const hmx = wx + hdx / hlen * handLength * 0.56;
            const hmy = wy + hdy / hlen * handLength * 0.56;
            const hmz = wz + hdz / hlen * handLength * 0.56;
            const htx = wx + hdx / hlen * handLength;
            const hty = wy + hdy / hlen * handLength;
            const htz = wz + hdz / hlen * handLength;
            d = smin(d, sdCapsule(x, y, z,
                wx, wy, wz, hmx, hmy, hmz, arm.fore * 1.03), 0.014);
            d = smin(d, sdCapsule(x, y, z,
                hmx, hmy, hmz, htx, hty, htz, arm.fore * 0.84), 0.012);
        }

        // Neck, rising to meet the head field. Stops BELOW the chin (1.919): run
        // any higher and its cap pushes a bare dome up through the face.
        d = smin(d, sdCapsule(x, y, z, 0, 1.812, 0.006, 0, 1.906, 0.010, 0.068), 0.055);

        if (o.pregnant) {
            // A pregnancy is not a ball on a torso — it is the torso, changed.
            // The largest blend radius in the model, deliberately.
            d = smin(d, sdEllipsoid(x, y - 1.245, z - 0.100,
                0.262, 0.222, 0.176), 0.080);
        }

        if (o.baby) {
            // A SWADDLED NEWBORN, CARRIED — not a second pregnancy. The first
            // version put a 0.15 sphere on the belly at 1.33 and blended it at
            // k = 0.032, which produced a form indistinguishable from the
            // pregnant figure's: same place, same size, same soft merge. Nothing
            // in the render told you one woman was expecting and the other was
            // holding a baby, which is most of what the sculpture is about.
            //
            // Three changes make it read: it sits HIGHER, at the forearms rather
            // than the womb; it is OBLONG across the body rather than round; and
            // it keeps a CREASE where it meets her (k = 0.016). A crease is
            // wrong for anatomy and right here — this is a separate object held
            // against a body, and the seam is the thing that says so.
            d = smin(d, sdEllipsoid(x + 0.010, y - 1.395, z - 0.205,
                0.178, 0.082, 0.108), 0.016);
            // The head end, standing proud of the wrap so the bundle has a
            // direction and reads as a baby rather than as a bolster.
            d = smin(d, sdEllipsoid(x + 0.150, y - 1.424, z - 0.224,
                0.064, 0.060, 0.068), 0.012);
            // A raised diagonal seam makes the swaddle a carried object instead
            // of another anatomical bulge. It remains shallow enough to sit
            // beneath the crossing hands.
            d = smin(d, sdCapsule(x, y, z,
                -0.118, 1.430, 0.298, 0.118, 1.352, 0.298, 0.014), 0.005);
        }

        if (o.stethoscope) {
            // Round the back of the neck, over both shoulders, into a bell at
            // the sternum. It has to STAND OFF the chest to exist at all: the
            // first version's bell was 19mm proud of the body and measured as a
            // bump you could not find in a render. Cast bronze tubing is fat and
            // it hangs in front of her, not on her.
            for (const sx of [-1, 1]) {
                d = smin(d, sdCapsule(x, y, z,
                    sx * 0.052, 1.886, -0.032, sx * 0.170, 1.824, 0.086, 0.026), 0.012);
                d = smin(d, sdCapsule(x, y, z,
                    sx * 0.170, 1.824, 0.086, sx * 0.066, 1.556, 0.238, 0.026), 0.012);
            }
            // The bell, hanging clear at the sternum.
            d = smin(d, sdEllipsoid(x - 0.004, y - 1.512, z - 0.258,
                0.056, 0.056, 0.036), 0.014);
        }

        // Hand-worked surface, in the FIELD rather than as a post-pass vertex
        // push: displacing a meshed surface along its normals re-creases the
        // very blends this whole approach exists to remove.
        // HAND-WORKED SURFACE, in the FIELD rather than as a post-pass vertex
        // push, which would re-crease the very blends this approach exists to
        // remove. Two octaves: a broad swell, and a finer one whose amplitude
        // stays well under the 13.5mm voxel so it modulates the surface instead
        // of aliasing holes into it. Without the second, the bronze is a
        // machined lathe and no amount of patina rescues it.
        d += fbm3(x * 2.8, y * 2.8, z * 2.8, seed, 2) * 0.0080;
        d += fbm3(x * 8.8, y * 8.8, z * 8.8, seed + 3, 2) * 0.0030;
        return d;
    }

    // The top bound has to CLEAR the neck capsule's cap. In the current field
    // the cap reaches 1.974 and the box reaches 2.06. An earlier neck ended at
    // 2.108 with a 0.059 cap, while its box stopped at 2.13; surface nets sliced
    // it open and left a torn rim that looked like a dark trapezoidal visor from
    // the eyes to the collarbone. Three passes were spent hunting that as a
    // lighting bug, a shadow bug and a facial-geometry bug; one
    // MeshNormalMaterial render found it.
    const mesh = surfaceNets(field, {
        min: [-0.60, -0.03, -0.36],
        max: [0.60, 2.06, 0.46],
        voxel: 0.0145,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
    return geo;
}

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
     * THE HEAD IS A ROUNDED BLOCK, not an ovoid.
     *
     * Read off the nearest figure in `ref-a-front.jpg` at 4x: flat front, flat
     * sides, a domed top and a broad flat jaw — a loaf standing on end. Built as
     * an egg, which is what every version before this one was, the face has
     * nowhere flat to sit on and every feature slides off the curvature. The
     * flats are the whole reason a face this reduced reads at all.
     *
     * The features are just as specific and none of them was right:
     *
     *   BROW   a straight ridge across the FULL width of the face, with a
     *          shadow under it. The old one was two thirds as wide and read as
     *          a bump between the eyes.
     *   EYES   the Phase 3 approximation is two long shallow lens-shaped cuts,
     *          nearly closed and angled slightly down and out. The reference
     *          target remains a pair of hollow triangular sockets; that is E3
     *          in the rubric and is intentionally still unresolved.
     *   NOSE   a NARROW ridge, about a sixth of the face across, running
     *          unbroken from between the brows to a small blunt tip.
     *   MOUTH  a WIDE flat bar, about half the face across, split by one
     *          horizontal line. The old one was a small pad and read as a bud.
     *
     * And under a near-frontal key — which is where this scene's sun has to sit,
     * see createLightRig — a nose reads from the shadow carved BESIDE it, not
     * from how far it stands out. Hence the cheek hollows either side of it.
     */
    function headField(x, y, z) {
        // Skull: a rounded block spanning chin to crown. The turned-away
        // figure uses a narrower, tapered back-of-head silhouette; reusing the
        // facial block without its features made it look like a failed render.
        let d;
        if (o.faceless) {
            d = sdRoundBox(x, y - (YC0 + 0.006), z + 0.002,
                0.098, 0.153, 0.087, 0.054);
            d = smin(d, sdEllipsoid(x, y - (YC0 - 0.096), z + 0.004,
                0.078, 0.076, 0.073), 0.046);
        } else {
            d = sdRoundBox(x, y - (YC0 + 0.005), z - 0.004,
                0.112, 0.151, 0.094, 0.052);
            // Jaw: broad and flat, softening the block's lower corners.
            d = smin(d, sdEllipsoid(x, y - (YC0 - 0.090), z - 0.002,
                0.098, 0.072, 0.082), 0.05);
        }

        if (!o.faceless) {
            // THE FACIAL PLANE, made by SLICING the front off, not by adding a
            // slab to it: an added box is wider than the skull at jaw height and
            // pokes out as a literal dark rectangle, which is what the first
            // version rendered — a visor bolted to each head.
            d = smax(d, z - 0.090, 0.020);
        }

        // HAIR. The nearest figure in ref-a is bare-headed — a plain block — and
        // giving every figure the same cap was one of the things making the four
        // heads interchangeable. The turned-away figure may carry a plain cap;
        // only the two `capbun` figures carry the coiled crown silhouette.
        if (o.hair !== 'none') {
            // The edge is CUT, not blended: in the photographs the hair meets
            // the face along a hard vertical line in front of the ear, and
            // blending it away leaves a bald head. It must also stay behind the
            // facial plane; run forward as a fringe it builds a brim and the
            // whole face sits in a recess under it.
            const hairFrontZ = 0.030 + 0.042 * ss(YC0 + 0.030, YC0 + 0.122, y);
            let hair = sdRoundBox(x, y - (YC0 + 0.012), z + 0.020,
                0.120, 0.150, 0.108, 0.056);
            hair = smax(hair, z - hairFrontZ, 0.014);
            d = smin(d, hair, 0.010);
        }

        if (o.hair === 'capbun') {
            // A THICK ROLL lying across the crown, not a knob on top of it. In
            // `ref-a-front.jpg` it is unmistakably a rolled plait seen end-on,
            // wide across the head and flattened front to back.
            d = smin(d, sdEllipsoid(x, y - (YC0 + 0.152), z + 0.024,
                0.098, 0.046, 0.062), 0.022);
            d = smin(d, sdEllipsoid(x, y - (YC0 + 0.130), z + 0.040,
                0.076, 0.038, 0.052), 0.026);
        }

        if (!o.faceless) {
            // Every feature is small, so every blend is smaller still. An early
            // version blended a 0.017-thick brow at k = 0.030 — filleting the
            // feature away with a radius twice its own size — and left a mask.
            //
            // BOLD, because thin features do not survive the mesher. Surface
            // nets places ONE vertex per cell at the mean of its edge crossings,
            // so a form only three or four cells thick is averaged into nothing
            // — and it fails SILENTLY and misleadingly: the field is correct, a
            // numeric march through it finds the feature, and even a max-z sweep
            // of the mesh finds the few stray slivers that survive, so every
            // measurement agrees the brow is there while no render shows it. A
            // MeshNormalMaterial pass is what settles it.
            //
            // These faces are extremely reduced anyway, so bold is also truer:
            // the reference brow is a slab, not a line.
            //
            // THE BLEND RADIUS MUST BE WELL UNDER THE PROTRUSION, and the
            // first version of this face broke that rule on every feature but
            // the nose: a brow standing 5mm proud of the plane, blended at
            // k = 0.010, is not a soft brow, it is no brow. The nose survived
            // only because it happened to stand 47mm out. Every feature here
            // now clears the facial plane by two to three times its own blend.
            //
            // BROW: full width, straight, with a shadow under it.
            d = smin(d, sdEllipsoid(x, y - (YC0 + 0.058), z - 0.086,
                0.096, 0.015, 0.023), 0.006);

            // EYES: two shallow, wide cuts separated by the nose bridge. Earlier
            // upper and lower lid additions survived as four horizontal bars,
            // overpowering the nose and making the faces read as masks.
            // At rx 0.050 centred
            // on x 0.050 the two carves met in the middle and removed a
            // full-width band 28mm deep, which left the brow above it standing
            // as an overhanging shelf over a cave — the single thing that made
            // every face unreadable. The carve now cuts about 4mm.
            for (const sx of [-1, 1]) {
                d = subtract(d, sdEllipsoid(x - sx * 0.052, y - (YC0 + 0.002), z - 0.117,
                    0.040, 0.020, 0.031), 0.007);
            }

            // NOSE: one narrow ridge, unbroken from between the brows to the
            // tip. It must clear the facial plane at z = 0.090 or there is no
            // nose; it must also stay NARROW, or it reads as a muzzle.
            d = smin(d, sdCapsule(x, y, z,
                0, YC0 + 0.050, 0.086, 0, YC0 - 0.044, 0.124, 0.019), 0.009);
            d = smin(d, sdEllipsoid(x, y - (YC0 - 0.040), z - 0.104,
                0.030, 0.015, 0.021), 0.008);

            // MOUTH: a wide bar, two flat pads split by one line.
            d = smin(d, sdEllipsoid(x, y - (YC0 - 0.078), z - 0.088,
                0.060, 0.010, 0.018), 0.005);
            d = smin(d, sdEllipsoid(x, y - (YC0 - 0.101), z - 0.086,
                0.054, 0.010, 0.016), 0.005);

            // Chin, just proud of the plane.
            d = smin(d, sdEllipsoid(x, y - (YC0 - 0.126), z - 0.068,
                0.052, 0.028, 0.032), 0.024);
        }

        // Neck stub, so head and body overlap when both are welded. STRICTLY
        // THINNER than the body's own neck: they are two separate closed
        // surfaces, and wherever they are the same radius they intersect in a
        // hard rim rather than disappearing into each other.
        d = smin(d, sdCapsule(x, y, z, 0, YC0 - 0.150, 0.008, 0, YC0 - 0.280, 0.008, 0.048), 0.05);

        d += fbm3(x * 9, y * 9, z * 9, seed, 2) * 0.0028;
        d += fbm3(x * 27, y * 27, z * 27, seed + 7, 2) * 0.0011;
        return d;
    }

    // World space in, head units out, and the distance scaled back. Surface nets
    // only needs the sign and a monotonic crossing, so a uniformly scaled
    // distance meshes identically — but scaling it keeps the value honest for
    // anything that later reads it as metres.
    // Head turn and tilt, applied as an inverse rotation of the sample point.
    // Four heads at identical angles is one of the loudest tells that a group is
    // a render rather than a casting: in every photograph the four are looking
    // slightly different ways and none of them is quite level.
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
    // surface nets leaves a torn rim. The neck reaches about 0.38 head units
    // below YC0 after its blend; 0.34 cut straight through it. The X margin
    // also has to contain the skull after headTurn rotates its Z depth sideways;
    // the rear Z margin must contain the same turn in the other axis.
    const mesh = surfaceNets(field, {
        min: [-0.170 * HS, yc - 0.440 * HS, -0.185 * HS],
        max: [0.170 * HS, yc + 0.215 * HS, 0.185 * HS],
        voxel: 0.0042 * HS,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
    return geo;
}

/**
 * One planted bare foot peeping from under the leading hem.
 *
 * Its rear overlaps the skirt while the low tapered toe reaches forward. The
 * reference hides the trailing foot; exposing both sides made the group look as
 * though pairs of loose stones had been placed in front of every robe.
 */
function buildFeet(THREE, opts) {
    // The reference exposes one planted leading foot per figure. Building two
    // feet from separate heel and toe spheres produced four pairs of detached
    // eggs in the live orbit. This is one fused, tapered field whose rear sits
    // under the raised hem, so the stance reads before the viewer sees detail.
    const yaw = opts.strideAngle * 0.65;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const side = opts.stride;

    function field(x, y, z) {
        const dx = x - side * 0.105;
        const dz = z - 0.175;
        const fx = dx * c - dz * s;
        const fz = dx * s + dz * c;

        let d = sdEllipsoid(fx, y - 0.064, fz - 0.140,
            0.078, 0.058, 0.135);
        d = smin(d, sdEllipsoid(fx, y - 0.043, fz - 0.260,
            0.066, 0.038, 0.085), 0.032);
        d += fbm3(fx * 12, y * 12, fz * 12, opts.seed + 21, 2) * 0.0020;
        return d;
    }

    const mesh = surfaceNets(field, {
        min: [-0.30, -0.03, 0.08],
        max: [0.30, 0.16, 0.68],
        voxel: 0.0075,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
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
    shoulderSpan: 0.758,           // 2 x (deltoid centre 0.298 + r 0.081)
    bustSpan: 0.812,               // 2 x upper-arm outer edge at y = 1.543
    waistSpan: 0.811,              // 2 x forearm outer edge at y = 1.430
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
 * @param {boolean} opts.faceless the head is turned away — no face relief
 * @param {'open'|'pregnant'|'cradle'|'clinical'} opts.armPose reference-led arm path
 * @param {number} opts.scale    overall height multiplier
 */
export function buildFigure(THREE, opts = {}) {
    const o = {
        seed: opts.seed ?? 1,
        hair: opts.hair ?? 'cap',
        faceless: opts.faceless ?? false,
        pregnant: opts.pregnant ?? false,
        baby: opts.baby ?? false,
        stethoscope: opts.stethoscope ?? false,
        armPose: opts.armPose
            ?? (opts.baby ? 'cradle' : opts.pregnant ? 'pregnant' : opts.stethoscope ? 'clinical' : 'open'),
        folds: opts.folds ?? 7,
        foldDepth: opts.foldDepth ?? 1,
        foldPhase: opts.foldPhase ?? 0,
        cowlTop: opts.cowlTop ?? 2.420,
        // No two cloaks in the group are swept alike. `openScale` widens or
        // narrows this one's front opening, `sweepLean` leans the whole panel
        // sideways as it rises — both small, both per figure, and together they
        // stop the four cloaks reading as four copies of one part.
        openScale: opts.openScale ?? 1,
        sweepLean: opts.sweepLean ?? 0,
        // The walk. `strideAngle` is the direction she is stepping, `hemRake`
        // how far the hem lifts off the leading foot, `stride` which side leads,
        // and `lean` how far her whole column tips forward of vertical.
        strideAngle: opts.strideAngle ?? 0,
        hemRake: opts.hemRake ?? 0,
        stride: opts.stride ?? -1,
        lean: opts.lean ?? 0,
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
    if (want('shell')) parts.push(buildShell(THREE, o));
    if (want('body')) parts.push(buildBodyField(THREE, o));
    if (want('head')) parts.push(buildHeadField(THREE, o));
    if (want('feet')) parts.push(buildFeet(THREE, o));

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
