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
import { sdEllipsoid, sdCapsule, smin, smax, subtract, surfaceNets } from './sdf.js';

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
    [0.000, 0.440, 0.420],
    [0.120, 0.415, 0.385],
    [0.320, 0.392, 0.330],
    [0.560, 0.372, 0.286],
    [0.800, 0.356, 0.250],
    [1.000, 0.346, 0.226],
    [1.160, 0.338, 0.208],
    [1.300, 0.334, 0.194],
    [1.420, 0.332, 0.184],
    [1.520, 0.332, 0.176],
    [1.610, 0.332, 0.170],
    [1.700, 0.332, 0.166],
    [1.800, 0.332, 0.162],
    [1.900, 0.330, 0.158],
    // The arch narrows hard above the shoulders. Left as wide as the body it
    // framed each head in a doorway three times the head's width; in
    // `ref-c-under.jpg` the collar clears the crown by a hand's breadth.
    [2.050, 0.300, 0.150],
    [2.180, 0.276, 0.142],
    [2.300, 0.248, 0.130],
    [2.380, 0.210, 0.114],
    [2.420, 0.174, 0.098],
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
 * the circle simply is not there. Only near the ground does the cloth wrap round
 * into a closed column, because that is where it pools.
 *
 * The earlier table opened 0.55 rad at the chest and 1.92 at the crown, which
 * left a near-complete tube standing in front of the body with a slot cut in it.
 * The body was fully modelled the whole time; you could not see any of it.
 */
const FRONT_OPENING = [
    [0.000, 0.00],
    [0.240, 0.00],
    [0.460, 0.16],
    [0.680, 0.44],
    [0.900, 0.74],
    [1.120, 1.00],
    [1.320, 1.20],
    [1.520, 1.34],
    [1.720, 1.46],
    [1.920, 1.58],
    [2.100, 1.70],
    [2.260, 1.80],
    [2.420, 1.88],
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

const WALL = 0.040;

function buildShell(THREE, opts) {
    const RINGS = 76;
    const ARC = 30;                       // segments along one wall of the crescent
    // NOT every cloak goes over its wearer's head. In `ref-a-front.jpg` the
    // nearest figure's stops at her shoulders and her head stands completely
    // free; two others carry the full arch behind the crown. Building all four
    // the same height gave a row of identical doorways.
    const yTop = opts.cowlTop;

    const positions = [];
    const indices = [];
    const loop = (ARC + 1) * 2;

    for (let r = 0; r <= RINGS; r++) {
        const y = (r / RINGS) * yTop;
        const [hw, hd] = sampleProfile(SHELL_PROFILE, y);
        const open = sampleProfile(FRONT_OPENING, y)[0];
        const zOff = shellOffsetZ(y);
        // Round the last 28cm off to whatever height this cloak stops at, so a
        // truncated one ends in a curve rather than a flat lid.
        const capT = Math.max(0, (y - (yTop - 0.28)) / 0.28);
        const cap = 1 - 0.66 * capT * capT;

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

                // THE TRAIN. Each cloak drags out to one side and pools on the
                // paving — in `ref-b-threequarter.jpg` the nearest figure's
                // sweeps almost a metre clear of her feet. Without it the hems
                // are four tidy bells and the group loses the sense of cloth
                // that has been walked in.
                // Kept modest on purpose. The first version ran to +0.74 and
                // the hems came out as four flat sails, wider than the figures
                // and reading as sheet card — the sculpture's hems are heavy
                // pooled cloth, not drapery blowing off a stand.
                const trail = Math.max(0, Math.cos(th - opts.trainAngle));
                const low = Math.pow(Math.max(0, 1 - y / 0.78), 2.1);
                const spread = 1 + opts.trainAmount * trail * trail * low;

                // DRAPERY. Every reference photograph is dominated by vertical
                // fold ridges running the length of the robe, and without them
                // the shell reads as a smooth cone no amount of surface noise
                // can rescue. The ridges run down the figure with a slow twist,
                // and they DEEPEN toward the hem where the cloth gathers —
                // constant-depth folds look machined, like fluting on a column.
                const gather = Math.pow(Math.max(0, 1 - y / 1.85), 1.35);
                const depth = (0.026 + 0.058 * gather) * opts.foldDepth;
                const fold = 1
                    + depth * Math.cos(th * opts.folds + y * 0.55 + opts.foldPhase)
                    + depth * 0.42 * Math.cos(th * (opts.folds * 2 + 1) - y * 0.9 + opts.foldPhase * 1.7);
                positions.push(
                    sn * hw * cap * k * fold * spread,
                    y,
                    cs * hd * cap * flat * k * fold * spread + zOff
                );
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
    // should ripple rather than pebble — then a second finer pass for the
    // hammer marks, because ripple alone still reads as a moulded plastic shell.
    roughen(THREE, geo, { amount: 0.014, scale: 2.2, seed: opts.seed });
    return roughen(THREE, geo, { amount: 0.0042, scale: 11.0, seed: opts.seed + 9 });
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
 *   0.10  bust onto the chest wall
 *   0.14  a pregnancy growing out of a torso
 */
const TORSO_PROFILE = [
    // The trunk runs well below the hip. It has to: the cloak's front opening
    // starts closing around 0.68 and if the body stops at the same height there
    // is a notch where neither surface is, which reads as a tear in the casting.
    // Widened about 18% over the first pass. The reference figures are BROAD:
    // shoulder to shoulder runs ~0.28 of total height in `ref-a-front.jpg`,
    // against 0.21 as first built, and slender ones read as mannequins rather
    // than as the heavy standing women in the photographs.
    [0.420, 0.288, 0.157],
    [0.560, 0.304, 0.159],
    [0.700, 0.316, 0.159],
    [0.912, 0.309, 0.157],
    [1.076, 0.302, 0.155],
    [1.217, 0.290, 0.151],
    [1.334, 0.276, 0.144],
    [1.440, 0.269, 0.140],   // waist
    [1.546, 0.278, 0.144],
    [1.640, 0.288, 0.146],   // ribs, under the bust
    [1.734, 0.288, 0.144],
    // The shoulder stays broad ALL THE WAY to the shoulder line and then rises
    // fast. Tapering from 1.83 gave a long cone that read as a bird's neck; in
    // the photographs the shoulders are near-horizontal slabs and the neck is
    // short.
    [1.828, 0.284, 0.141],
    [1.911, 0.268, 0.134],   // shoulder line — 0.790 of total height
    [1.958, 0.152, 0.096],
    [2.005, 0.082, 0.067],
    [2.046, 0.072, 0.062],   // neck
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

    function field(x, y, z) {
        // Trunk from well down inside the skirt up to the base of the neck.
        let d = sdTrunk(x, y, z, 0.420, 2.046);

        // Bust. THE BLEND RADIUS MUST BE WELL UNDER THE PROTRUSION — this is
        // the one rule of modelling with smin and the first version broke it.
        // A form standing 0.02 proud of the chest wall, blended at k=0.10, is
        // not a soft bust: it is no bust at all, because the fillet is five
        // times deeper than the feature and swallows it whole. Everything
        // below protrudes 2-3x its own blend.
        for (const sx of [-1, 1]) {
            d = smin(d, sdEllipsoid(x - sx * 0.108, y - 1.698, z - 0.142,
                0.100, 0.090, 0.092), 0.034);
        }

        // Shoulders and arms: one continuous run from the deltoid to the wrist,
        // pressed against the ribs.
        for (const sx of [-1, 1]) {
            d = smin(d, sdEllipsoid(x - sx * 0.222, y - 1.880, z,
                0.076, 0.068, 0.082), 0.050);
            d = smin(d, sdCapsule(x, y, z,
                sx * 0.268, 1.858, 0.012, sx * 0.286, 1.476, 0.030, 0.053), 0.040);
            if (o.baby) {
                // Cradling: the forearm comes OFF the body and crosses in front
                // of the waist, so the bundle has something visibly under it.
                d = smin(d, sdCapsule(x, y, z,
                    sx * 0.286, 1.476, 0.030, sx * 0.062, 1.372, 0.212, 0.050), 0.030);
            } else {
                d = smin(d, sdCapsule(x, y, z,
                    sx * 0.286, 1.476, 0.030, sx * 0.278, 1.174, 0.078, 0.047), 0.032);
            }
        }

        // Neck, rising to meet the head field.
        // Stops BELOW the chin (2.013). Run up to 2.108 its cap reaches 2.167 and
        // pushes a bare dome straight up through the middle of the face.
        d = smin(d, sdCapsule(x, y, z, 0, 1.880, 0.006, 0, 1.975, 0.010, 0.062), 0.055);

        if (o.pregnant) {
            // A pregnancy is not a ball on a torso — it is the torso, changed.
            // The largest blend radius in the model, deliberately.
            d = smin(d, sdEllipsoid(x, y - 1.296, z - 0.104,
                0.244, 0.220, 0.182), 0.048);
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
            d = smin(d, sdEllipsoid(x + 0.014, y - 1.442, z - 0.196,
                0.172, 0.100, 0.128), 0.016);
            // The head end, standing proud of the wrap so the bundle has a
            // direction and reads as a baby rather than as a bolster.
            d = smin(d, sdEllipsoid(x + 0.148, y - 1.476, z - 0.196,
                0.080, 0.078, 0.086), 0.018);
        }

        if (o.stethoscope) {
            // Round the back of the neck, over both shoulders, into a bell at
            // the sternum. It has to STAND OFF the chest to exist at all: the
            // first version's bell was 19mm proud of the body and measured as a
            // bump you could not find in a render. Cast bronze tubing is fat and
            // it hangs in front of her, not on her.
            for (const sx of [-1, 1]) {
                d = smin(d, sdCapsule(x, y, z,
                    sx * 0.050, 1.952, -0.030, sx * 0.152, 1.896, 0.078, 0.024), 0.012);
                d = smin(d, sdCapsule(x, y, z,
                    sx * 0.152, 1.896, 0.078, sx * 0.060, 1.648, 0.222, 0.024), 0.012);
            }
            // The bell, hanging clear at the sternum.
            d = smin(d, sdEllipsoid(x - 0.004, y - 1.606, z - 0.240,
                0.052, 0.052, 0.034), 0.014);
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
        d += fbm3(x * 3.1, y * 3.1, z * 3.1, seed, 2) * 0.010;
        d += fbm3(x * 9.5, y * 9.5, z * 9.5, seed + 3, 2) * 0.0045;
        return d;
    }

    // The top bound has to CLEAR the neck capsule's cap (0.059 above its 2.108
    // end point, so 2.167). At 2.13 the box sliced straight through the neck,
    // surface nets left the cut open with a torn rim, and every figure wore what
    // looked like a dark trapezoidal visor from the eyes to the collarbone.
    // Three passes were spent hunting that as a lighting bug, a shadow bug and a
    // facial-geometry bug; a MeshNormalMaterial render found it in one.
    const mesh = surfaceNets(field, {
        min: [-0.52, 0.38, -0.32],
        max: [0.52, 2.22, 0.42],
        voxel: 0.0135,
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
    const yc = 2.159;
    const seed = o.seed + 13;

    // Smoothstep, for the hairline. Kept local: this file has no maths module
    // and one helper does not earn one.
    const ss = (a, b, t) => {
        const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
        return k * k * (3 - 2 * k);
    };

    function field(x, y, z) {
        // Skull: a flattened wedge, much narrower front-to-back than a sphere.
        let d = sdEllipsoid(x, y - yc, z - 0.004, 0.112, 0.144, 0.098);

        // Jaw and chin, blended into the cranium.
        d = smin(d, sdEllipsoid(x, y - (yc - 0.096), z - 0.020,
            0.086, 0.070, 0.078), 0.06);

        if (!o.faceless) {
            // THE FACIAL PLANE. These faces are flats, not bulbs. It is made by
            // SLICING the front off the skull, not by adding a slab to it: an
            // added box is wider than the skull down at jaw height and pokes out
            // as a literal dark rectangle, which is exactly what the first
            // version rendered — a visor bolted to each head. A smooth-max
            // against a half-space plane flattens the front and lets the cut
            // roll off into the skull's own curvature.
            d = smax(d, z - 0.090, 0.045);
        }

        // HAIR. A helmet over the cranium and down to the nape, and it has to
        // keep an EDGE at the temple — in `ref-a-front.jpg` the hair frames each
        // face with a clear step, and blending it away leaves a bald egg.
        //
        // The edge is cut, not blended: everything in front of `hairFrontZ` is
        // simply not hair. That plane sweeps FORWARD above the brow, which is
        // the fringe crossing the forehead, and stops at the temple below it.
        {
            // Two constraints bracket this. The edge has to sit where the
            // surface still faces the camera — at z = 0.028 it fell on the
            // grazing side of the skull and the head rendered bald from the
            // front. But it must also stay BEHIND the facial plane (z = 0.085):
            // running the fringe out to 0.120 built a 3.5cm brim across the
            // forehead, the whole face sat in a recess behind it, and every head
            // in the group wore a black visor from the eyes to the chin.
            const hairFrontZ = 0.038 + 0.040 * ss(yc + 0.030, yc + 0.122, y);
            let hair = sdEllipsoid(x, y - (yc + 0.008), z + 0.022,
                0.134, 0.148, 0.118);
            hair = smax(hair, z - hairFrontZ, 0.016);
            d = smin(d, hair, 0.010);
        }

        if (o.bun) {
            // A coiled knot sitting ON TOP of the crown with daylight under it,
            // not tucked behind — it is the tallest thing on three of the four
            // figures and most of what tells them apart at a distance.
            d = smin(d, sdEllipsoid(x, y - (yc + 0.178), z + 0.012,
                0.059, 0.045, 0.057), 0.018);
            d = smin(d, sdCapsule(x, y, z,
                0, yc + 0.132, 0.014, 0, yc + 0.166, 0.012, 0.040), 0.030);
        }

        if (!o.faceless) {
            // Every feature here is small, so every blend has to be smaller
            // still. An earlier version blended a 0.017-thick brow at k = 0.030
            // and a 0.016-radius nose at k = 0.030 — filleting each feature away
            // with a radius twice its own size, leaving a smooth mask. Same rule
            // as the bust: k well under the protrusion.
            //
            // ONE ridge from the brow to the tip of the nose, unbroken, and it
            // must stand clear of the facial plane (front face at z = 0.092) or
            // there is no nose at all.
            d = smin(d, sdCapsule(x, y, z,
                0, yc + 0.072, 0.080, 0, yc - 0.032, 0.128, 0.021), 0.010);
            // Brow bar. Narrow — the full-width version read as a shelf.
            d = smin(d, sdEllipsoid(x, y - (yc + 0.062), z - 0.080,
                0.066, 0.014, 0.020), 0.009);
            // Lips: a low proud pad, not a groove — a groove vanishes at any
            // distance, a pad keeps a shadow under it.
            d = smin(d, sdEllipsoid(x, y - (yc - 0.084), z - 0.086,
                0.040, 0.014, 0.018), 0.008);
            // Chin, just proud of the plane.
            d = smin(d, sdEllipsoid(x, y - (yc - 0.126), z - 0.070,
                0.044, 0.030, 0.032), 0.026);

            // Sockets, SHALLOW and small. Carved 0.034 deep into a head only
            // 0.098 deep, they came out as two black slots.
            for (const sx of [-1, 1]) {
                d = subtract(d, sdEllipsoid(x - sx * 0.044, y - (yc + 0.030), z - 0.112,
                    0.031, 0.017, 0.030), 0.012);
            }
        } else {
            // The turned-away figure in `ref-d-wide.jpg`: a smooth ovoid, no
            // relief at all. Nothing to add.
        }

        // Neck stub, so head and body overlap when both are welded. It is
        // STRICTLY THINNER than the body's own neck (0.058): head and body are
        // two separate closed surfaces, not one field, so wherever they are the
        // same radius they intersect in a hard rim instead of disappearing into
        // each other — which is what put a dark hard-edged trapezoid under every
        // chin and made the faces read as visors.
        d = smin(d, sdCapsule(x, y, z, 0, yc - 0.150, 0.008, 0, yc - 0.280, 0.008, 0.048), 0.05);

        d += fbm3(x * 9, y * 9, z * 9, seed, 2) * 0.0028;
        d += fbm3(x * 27, y * 27, z * 27, seed + 7, 2) * 0.0011;
        return d;
    }

    // Same rule as the body's box: clear the neck stub's bottom cap (0.048 below
    // its 1.879 end) or surface nets leaves a torn rim at the collar.
    const mesh = surfaceNets(field, {
        min: [-0.22, yc - 0.35, -0.22],
        max: [0.22, yc + 0.27, 0.22],
        voxel: 0.0062,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
    return geo;
}

/**
 * Bare feet peeping from under the hem.
 *
 * They have to clear the hem's own front depth (0.30 at y = 0) or they are cast
 * inside the cloth and you see nothing — which is what happened when they sat at
 * z = 0.29. Small, long and low, exactly as they read in `ref-c-under.jpg`.
 */
function buildFeet(THREE, opts) {
    const parts = [];
    for (const sx of [-1, 1]) {
        const lead = sx > 0 ? 0.030 : 0;
        // Set so the HEM COVERS THE HEEL and only the front of the foot shows.
        // Standing entirely clear of the cloth they read as four pairs of loose
        // eggs on the paving, which is what they looked like for three passes.
        // Built as ONE squashed sphere they still did: it is the heel-to-toe
        // taper, heel high and back, toes low and forward, that makes a foot.
        const heel = new THREE.SphereGeometry(1, 14, 10);
        heel.scale(0.048, 0.046, 0.062);
        heel.translate(sx * 0.082, 0.046, 0.330 + lead);
        parts.push(heel);
        const foot = new THREE.SphereGeometry(1, 16, 10);
        foot.scale(0.050, 0.027, 0.100);
        foot.translate(sx * 0.083, 0.026, 0.404 + lead);
        parts.push(foot);
    }
    const geo = mergeGeometries(THREE, parts);
    return roughen(THREE, geo, { amount: 0.004, scale: 9, seed: opts.seed + 21 });
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
    headCrown: 2.159 + 0.156,      // top of the hair mass
    cowlTop: 2.420,                // tallest cloak in the group, figures 1 and 2
    brow: 2.159 + 0.058,
    nose: 2.159 - 0.014,
    chin: 2.159 - 0.146,
    shoulder: 1.911,
    bust: 1.698,
    headHeight: 0.302,             // crown to chin

    // Widths, metres, measured across the figure. These are what the gate was
    // missing: every landmark it checked was vertical and all eight had been
    // green since the model was half its current shape, while the errors that
    // remained were all horizontal.
    // All spans are the OUTER SILHOUETTE at that height, arms included, because
    // that is what can be read off a photograph. Measuring the model's bust as
    // the breasts alone and the photograph's as the whole body compares two
    // different things and reports a 0.12 error that is not there.
    headWidth: 0.268,              // hair mass, 2 x rx
    shoulderSpan: 0.596,           // 2 x (deltoid centre 0.222 + r 0.076)
    bustSpan: 0.657,               // 2 x upper-arm outer edge at y = 1.698
    waistSpan: 0.664,              // 2 x forearm outer edge at y = 1.440
    hemSpan: 0.880,                // cloak at the ground, ignoring the train
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
        pregnant: opts.pregnant ?? false,
        baby: opts.baby ?? false,
        stethoscope: opts.stethoscope ?? false,
        folds: opts.folds ?? 7,
        foldDepth: opts.foldDepth ?? 1,
        foldPhase: opts.foldPhase ?? 0,
        cowlTop: opts.cowlTop ?? 2.420,
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
