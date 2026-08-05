/**
 * model/sculpture.js — six alternating reliefs in one connected bronze sheet.
 *
 * ARRANGEMENT. Read off `ref-a-front.jpg` and `ref-c-under.jpg`: the group is
 * not a line-up. The figures are staggered in depth and rotated slightly apart,
 * overlapping so their sheets interleave. Each side reads as one connected
 * casting with three positive reliefs and three closed reverse impressions.
 * Getting the stagger wrong is the fastest way to lose the likeness even with
 * accurate individual figures.
 *
 * PATINA. Vertex colours, not a texture — the artefact ships no image files.
 * Three signals are combined, and all three come from looking at the photos
 * rather than from a material preset:
 *
 *   1. UP-FACING SURFACES GO PALE. Rain washes the tops; shoulders, brows and
 *      the top edge of every cowl are the lightest thing on the bronze.
 *   2. CREVICES GO BLACK. Anything tucked away holds a century of dirt. This is
 *      approximated from how far a vertex sits inside the silhouette.
 *   3. VERTICAL STREAKS. Water runs DOWN a standing bronze and leaves stripes.
 *      A noise field stretched hard in Y is most of what makes the surface read
 *      as weathered metal instead of grey plastic.
 */

import { buildFigure } from './figure.js';
import { fbm3 } from '../core/noise.js';

/** Patina end points, sampled off the sunlit faces in `ref-a-front.jpg`. */
const PATINA = {
    // The photographs are a near-black casting with narrow grey-bronze wash,
    // not a mid-value olive object. Keep the body dark and let the light rig
    // reveal form; only genuinely up-facing shelves reach the washed endpoint.
    deep: [0.016, 0.017, 0.016],      // dirt held in the deepest crevices
    body: [0.072, 0.075, 0.070],      // near-black weathered bronze
    lit: [0.245, 0.235, 0.205],       // rain-washed shelves and ridges
    verdigris: [0.050, 0.075, 0.068], // restrained green bloom in sheltered runs
};

/**
 * Physical order along the folded sheet. x/z are metres and `turn` is radians
 * about Y. `side` names the side carrying that entry's positive relief.
 */
export const FIGURE_LAYOUT = [
    // The sculpture is one curved sheet carrying SIX alternating reliefs, not
    // four freestanding bodies. Read from the outward/community side, the
    // physical sequence is:
    //
    //   developing | doctor(back) | mother/newborn | pregnant(back)
    //              | visitor/patient | badge/nurse(back)
    //
    // The hospital side reverses that sequence and exposes the badge, full
    // pregnancy and doctor. Adjacent panels overlap at their shoulder sheets so
    // the group reads as one connected casting.
    {
        id: 'outward-developing', side: 'outward', identity: 'developing',
        x: -1.20, z: 0.28, turn: 0.16, scale: 0.985, seed: 11, shell: true,
        hair: 'none', armPose: 'developing', pregnant: false, belly: 0.18,
        baby: false, stethoscope: false, badge: false,
        torsoWidth: 1.02, torsoDepth: 0.80, sheetDepth: 0.44,
        bustWidth: 1.06, bustHeight: 1.02, bustDepth: 1.02,
        folds: 6, foldDepth: 0.72, foldPhase: 0.0,
        cowlTop: 2.420, openScale: 1.04, sweepLean: -0.012,
        strideAngle: 0.08, hemRake: 0.040, stride: -1,
        lean: 0.020, weightShift: -0.055, headTurn: 0.02, headTilt: 0.018,
        trainAngle: 3.26, trainAmount: 0.20,
    },
    {
        id: 'hospital-doctor', side: 'hospital', identity: 'doctor',
        x: -0.72, z: -0.02, turn: 3.04, scale: 1.000, seed: 23, shell: true,
        hair: 'cap', armPose: 'clinical', pregnant: false, belly: 0,
        baby: false, stethoscope: true, badge: false,
        torsoWidth: 0.98, torsoDepth: 0.79, sheetDepth: 0.40,
        bustWidth: 0.98, bustHeight: 0.94, bustDepth: 0.94,
        folds: 7, foldDepth: 0.78, foldPhase: 1.1,
        cowlTop: 2.390, openScale: 0.98, sweepLean: 0.006,
        strideAngle: -0.38, hemRake: 0.032, stride: 1,
        lean: 0.016, weightShift: 0.040, headTurn: 0.06, headTilt: -0.018,
        trainAngle: 3.06, trainAmount: 0.18,
    },
    {
        id: 'outward-mother', side: 'outward', identity: 'mother',
        x: -0.24, z: 0.14, turn: 0.035, scale: 1.015, seed: 37, shell: true,
        hair: 'capbun', armPose: 'cradle', pregnant: false, belly: 0,
        baby: true, stethoscope: false, badge: false,
        torsoWidth: 0.98, torsoDepth: 0.80, sheetDepth: 0.43,
        bustWidth: 0.94, bustHeight: 0.94, bustDepth: 0.92,
        folds: 6, foldDepth: 0.76, foldPhase: 2.2,
        cowlTop: 2.440, openScale: 1.02, sweepLean: -0.004,
        strideAngle: 0.06, hemRake: 0.038, stride: -1,
        lean: 0.018, weightShift: -0.035, headTurn: 0.68, headTilt: 0.012,
        trainAngle: 3.18, trainAmount: 0.18,
    },
    {
        id: 'hospital-pregnant', side: 'hospital', identity: 'pregnant',
        x: 0.24, z: -0.14, turn: 3.145, scale: 0.995, seed: 51, shell: true,
        hair: 'cap', armPose: 'pregnant', pregnant: true, belly: 1.00,
        baby: false, stethoscope: false, badge: false,
        torsoWidth: 1.00, torsoDepth: 0.82, sheetDepth: 0.42,
        bustWidth: 1.00, bustHeight: 0.98, bustDepth: 1.00,
        folds: 7, foldDepth: 0.74, foldPhase: 3.3,
        cowlTop: 2.410, openScale: 0.99, sweepLean: 0.004,
        strideAngle: -0.42, hemRake: 0.036, stride: 1,
        lean: 0.020, weightShift: 0.030, headTurn: 0.02, headTilt: -0.012,
        trainAngle: 3.12, trainAmount: 0.19,
    },
    {
        id: 'outward-visitor', side: 'outward', identity: 'visitor',
        x: 0.72, z: 0.02, turn: 0.38, scale: 1.005, seed: 67, shell: true,
        hair: 'capbun', armPose: 'visitor', pregnant: false, belly: 0,
        baby: false, stethoscope: false, badge: false,
        torsoWidth: 1.01, torsoDepth: 0.79, sheetDepth: 0.46,
        bustWidth: 1.02, bustHeight: 0.98, bustDepth: 0.98,
        folds: 6, foldDepth: 0.72, foldPhase: 4.4,
        cowlTop: 2.425, openScale: 1.03, sweepLean: 0.010,
        strideAngle: 0.10, hemRake: 0.034, stride: -1,
        lean: 0.014, weightShift: -0.030, headTurn: 0.28, headTilt: 0.016,
        trainAngle: 3.22, trainAmount: 0.19,
    },
    {
        id: 'hospital-badge', side: 'hospital', identity: 'badge',
        x: 1.20, z: -0.28, turn: 3.32, scale: 0.975, seed: 79, shell: true,
        hair: 'none', armPose: 'badge', pregnant: false, belly: 0,
        baby: false, stethoscope: false, badge: true,
        torsoWidth: 0.98, torsoDepth: 0.78, sheetDepth: 0.41,
        bustWidth: 0.98, bustHeight: 0.94, bustDepth: 0.94,
        folds: 7, foldDepth: 0.76, foldPhase: 5.5,
        cowlTop: 2.400, openScale: 0.97, sweepLean: 0.012,
        strideAngle: -0.48, hemRake: 0.030, stride: 1,
        lean: 0.014, weightShift: 0.040, headTurn: -0.04, headTilt: -0.016,
        trainAngle: 3.02, trainAmount: 0.20,
    },
];

/**
 * Paint the patina into a geometry's colour attribute.
 *
 * `radial` is the horizontal distance from the group's axis, normalised — it is
 * the cheap stand-in for ambient occlusion. A vertex deep inside the cluster is
 * shaded by its neighbours in life, and going dark there buys most of the depth
 * a real AO pass would, for none of the cost.
 */
function paintPatina(THREE, geo, seed) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const ny = nor.getY(i), nz = nor.getZ(i);

        // 1. up-facing wash
        const up = Math.max(0, ny);
        // 2. pocket darkening — inside the mass, and low down where the robes
        //    crowd together and never see the sky.
        //
        //    Measured against a FIXED radius, not against the geometry's own
        //    extent. Normalising by max radius was fine until the cloaks grew
        //    trains: one vertex a metre out re-scaled everything, every point on
        //    the torso landed near r = 0 and the whole body was flooded with
        //    crevice black. The figures went flat in the same commit the trains
        //    appeared, which is the tell.
        const r = Math.min(1, Math.hypot(x, z) / 0.42);
        const pocket = (1 - r) * 0.52 + Math.max(0, 1 - y / 0.8) * 0.30;
        // 3. vertical run-off streaks: high frequency around the figure, very
        //    low frequency up it, which is exactly how water actually marks a
        //    standing bronze.
        const broadRun = fbm3(x * 12.5, y * 0.38, z * 12.5, seed + 5, 2) * 0.5 + 0.5;
        const fineRun = fbm3(x * 24, y * 0.16, z * 24, seed + 17, 1) * 0.5 + 0.5;
        const streak = Math.min(1, Math.max(0, broadRun * 0.74 + fineRun * 0.26));
        const runoff = Math.pow(streak, 1.45);

        // The wash is raised to a high power so it lands on genuine shelves —
        // shoulders, brows, the top edge of a cowl — and not on everything with
        // a slight upward tilt. At 1.4 / 0.85 the bare feet came out as the
        // brightest objects in the scene, four pairs of white pebbles.
        // Nothing near the ground is rain-washed pale — it is splashed and
        // filthy — so the wash fades out over the last 40cm.
        const washable = Math.min(1, Math.max(0, (y - 0.10) / 0.40));
        let c = mix(PATINA.body, PATINA.lit, Math.pow(up, 1.85) * 0.62 * washable);
        c = mix(c, PATINA.deep, Math.min(1, pocket) * 0.44);
        c = mix(c, PATINA.verdigris,
            Math.max(0, 0.62 - up) * Math.pow(runoff, 2.2) * 0.42);
        // Keep the vertical runoff visible without letting its dark end become
        // a second shadow system. Lighting should describe the form; the patina
        // only modulates it.
        // The inactive side of each alternating relief is a deep hammered
        // recess. Directional back darkening preserves that read without a
        // view-dependent material or painted silhouette.
        c = mix(c, PATINA.deep, Math.pow(Math.max(0, -nz), 1.35) * 0.34);
        const s = 0.88 + runoff * 0.22;
        col[i * 3] = c[0] * s;
        col[i * 3 + 1] = c[1] * s;
        col[i * 3 + 2] = c[2] * s;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
}

function mix(a, b, t) {
    const k = t < 0 ? 0 : t > 1 ? 1 : t;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
/**
 * Closed vertical ribbon through the six relief centres. It is the shared cast
 * sheet: active bodies project from alternating sides while the ribbon closes
 * their buried bases. The overlapping full-height shells and body recesses
 * supply the visible shoulder-to-crown folds.
 */
export function buildFoldedScreen(THREE, layout = FIGURE_LAYOUT) {
    const bottom = -0.045;
    // The reference is one folded casting, so the centre ribbon must close the
    // gaps between reliefs above the waist. Uneven peaks avoid the false flat
    // shoulder wall produced by a single uniform top edge.
    const topProfile = [2.05, 1.88, 2.10, 1.90, 2.08, 1.86];
    const halfThickness = 0.034;
    const endExtension = 0.10;
    const rows = 36;

    const centres = layout.map(({ x, z }, index) => ({
        x, z, top: topProfile[index] ?? 1.92,
    }));
    const direction = (a, b) => {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        return { x: dx / length, z: dz / length };
    };
    const firstDirection = direction(centres[0], centres[1]);
    const lastDirection = direction(centres.at(-2), centres.at(-1));
    const path = [
        {
            x: centres[0].x - firstDirection.x * endExtension,
            z: centres[0].z - firstDirection.z * endExtension,
            top: centres[0].top,
        },
        ...centres,
        {
            x: centres.at(-1).x + lastDirection.x * endExtension,
            z: centres.at(-1).z + lastDirection.z * endExtension,
            top: centres.at(-1).top,
        },
    ];
    const offsets = path.map((point, index) => {
        const previous = index > 0 ? direction(path[index - 1], point) : null;
        const next = index < path.length - 1 ? direction(point, path[index + 1]) : null;
        if (!previous) {
            return { x: -next.z * halfThickness, z: next.x * halfThickness };
        }
        if (!next) {
            return { x: -previous.z * halfThickness, z: previous.x * halfThickness };
        }
        const previousNormal = { x: -previous.z, z: previous.x };
        const nextNormal = { x: -next.z, z: next.x };
        const mx = previousNormal.x + nextNormal.x;
        const mz = previousNormal.z + nextNormal.z;
        const miterLength = Math.hypot(mx, mz);
        const miter = { x: mx / miterLength, z: mz / miterLength };
        const denominator = Math.max(0.45,
            miter.x * nextNormal.x + miter.z * nextNormal.z);
        return {
            x: miter.x * halfThickness / denominator,
            z: miter.z * halfThickness / denominator,
        };
    });

    const positions = [];
    const indices = [];
    const vertex = (pointIndex, row, side) =>
        ((pointIndex * (rows + 1) + row) * 2 + side);
    for (let pointIndex = 0; pointIndex < path.length; pointIndex++) {
        const point = path[pointIndex];
        const offset = offsets[pointIndex];
        for (let row = 0; row <= rows; row++) {
            const y = bottom + (point.top - bottom) * row / rows;
            positions.push(point.x + offset.x, y, point.z + offset.z);
            positions.push(point.x - offset.x, y, point.z - offset.z);
        }
    }

    for (let pointIndex = 0; pointIndex < path.length - 1; pointIndex++) {
        for (let row = 0; row < rows; row++) {
            const p00 = vertex(pointIndex, row, 0);
            const p10 = vertex(pointIndex + 1, row, 0);
            const p01 = vertex(pointIndex, row + 1, 0);
            const p11 = vertex(pointIndex + 1, row + 1, 0);
            indices.push(p00, p10, p01, p10, p11, p01);

            const m00 = vertex(pointIndex, row, 1);
            const m10 = vertex(pointIndex + 1, row, 1);
            const m01 = vertex(pointIndex, row + 1, 1);
            const m11 = vertex(pointIndex + 1, row + 1, 1);
            indices.push(m00, m01, m10, m10, m01, m11);
        }

        const pBottom = vertex(pointIndex, 0, 0);
        const mBottom = vertex(pointIndex, 0, 1);
        const nextPBottom = vertex(pointIndex + 1, 0, 0);
        const nextMBottom = vertex(pointIndex + 1, 0, 1);
        indices.push(pBottom, mBottom, nextPBottom,
            nextPBottom, mBottom, nextMBottom);

        const pTop = vertex(pointIndex, rows, 0);
        const mTop = vertex(pointIndex, rows, 1);
        const nextPTop = vertex(pointIndex + 1, rows, 0);
        const nextMTop = vertex(pointIndex + 1, rows, 1);
        indices.push(pTop, nextPTop, mTop, nextPTop, nextMTop, mTop);
    }

    const last = path.length - 1;
    for (let row = 0; row < rows; row++) {
        const firstPlus = vertex(0, row, 0);
        const firstMinus = vertex(0, row, 1);
        const firstPlusNext = vertex(0, row + 1, 0);
        const firstMinusNext = vertex(0, row + 1, 1);
        indices.push(firstPlus, firstPlusNext, firstMinus,
            firstMinus, firstPlusNext, firstMinusNext);

        const lastPlus = vertex(last, row, 0);
        const lastMinus = vertex(last, row, 1);
        const lastPlusNext = vertex(last, row + 1, 0);
        const lastMinusNext = vertex(last, row + 1, 1);
        indices.push(lastPlus, lastMinus, lastPlusNext,
            lastMinus, lastMinusNext, lastPlusNext);
    }

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setIndex(indices);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    return geometry;
}


/**
 * Build the whole sculpture.
 *
 * @returns {{group, figures, material, height, dispose}}
 */
export function createSculpture(THREE, opts = {}) {
    const group = new THREE.Group();
    group.name = 'sculpture';

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.68,
        // Every generated component is now closed and outward-wound, so
        // Three's normal BackSide shadow pass for a FrontSide material is
        // the correct closed-solid behaviour. Do not reintroduce a
        // shadowSide override to compensate for broken topology; validate
        // the geometry instead.
        // PATINATED bronze, which is the point: the surface in the photographs
        // is oxide, not metal. Run at metalness 0.42 the diffuse term is scaled
        // by 0.58 and the group renders as a black cut-out no matter how bright
        // the sun. Weathered bronze behaves far closer to a rough dielectric.
        metalness: 0.12,
        envMapIntensity: 1.0,
    });

    const screenGeo = buildFoldedScreen(THREE);
    paintPatina(THREE, screenGeo, 101);
    const screen = new THREE.Mesh(screenGeo, material);
    screen.castShadow = true;
    screen.receiveShadow = true;
    screen.name = 'folded-screen';
    group.add(screen);

    const figures = [];
    for (let i = 0; i < FIGURE_LAYOUT.length; i++) {
        const L = FIGURE_LAYOUT[i];
        const geo = buildFigure(THREE, {
            seed: L.seed, identity: L.identity, shell: L.shell,
            hair: L.hair, faceless: false,
            armPose: L.armPose, scale: L.scale,
            pregnant: L.pregnant, belly: L.belly, baby: L.baby,
            stethoscope: L.stethoscope, badge: L.badge,
            torsoWidth: L.torsoWidth, torsoDepth: L.torsoDepth, sheetDepth: L.sheetDepth,
            bustWidth: L.bustWidth, bustHeight: L.bustHeight, bustDepth: L.bustDepth,
            folds: L.folds, foldDepth: L.foldDepth, foldPhase: L.foldPhase,
            cowlTop: L.cowlTop, openScale: L.openScale, sweepLean: L.sweepLean,
            strideAngle: L.strideAngle, hemRake: L.hemRake, stride: L.stride,
            lean: L.lean, weightShift: L.weightShift,
            headTurn: L.headTurn, headTilt: L.headTilt,
            trainAngle: L.trainAngle, trainAmount: L.trainAmount,
        });
        paintPatina(THREE, geo, L.seed);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(L.x, 0, L.z);
        mesh.rotation.y = L.turn;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'figure-' + i;
        group.add(mesh);
        figures.push(mesh);
    }

    // The low bronze base plate the group stands on. In the photos it is barely
    // a step — a shallow irregular slab that reads as part of the casting.
    const baseGeo = new THREE.CylinderGeometry(1.48, 1.49, 0.008, 48, 1);
    baseGeo.scale(1.02, 1, 0.39);
    baseGeo.translate(0, 0.004, 0);
    const baseCol = new Float32Array(baseGeo.attributes.position.count * 3);
    for (let i = 0; i < baseCol.length; i += 3) {
        baseCol[i] = 0.108; baseCol[i + 1] = 0.112; baseCol[i + 2] = 0.100;
    }
    baseGeo.setAttribute('color', new THREE.Float32BufferAttribute(baseCol, 3));
    const base = new THREE.Mesh(baseGeo, material);
    base.receiveShadow = true;
    base.visible = false;
    base.name = 'base';
    group.add(base);

    return {
        group,
        figures,
        screen,
        material,
        height: 2.33,
        dispose() {
            for (const f of figures) f.geometry.dispose();
            screenGeo.dispose();
            baseGeo.dispose();
            material.dispose();
        },
    };
}

/**
 * Light rig, matched to the reference photos: a cold winter sky, one hard low
 * sun, and a bounce off the pale paving.
 */
export function createLightRig(THREE, scene) {
    // Sky/ground hemisphere carries the ambient. Bronze in shade is not black,
    // it is a very dark blue-grey, and that only happens with a coloured
    // ambient rather than a grey one.
    // The hemisphere is the exposure floor for every view. It is strong enough
    // to preserve faces and robe planes in shade, while the directional lights
    // still provide the modelling and contact shadows.
    const hemi = new THREE.HemisphereLight(0xb7cbe2, 0x867d70, 0.90);
    scene.add(hemi);

    // Round to the FRONT, and LOW. Two failure modes bracket this position and
    // both were rendered before landing on it: swing the key out to the side and
    // the cloak's own flank, which runs the full height of the figure, throws a
    // shadow straight across the chest, so the bust and belly the model works
    // hardest to get right become the darkest part of the frame; push it high
    // and frontal to fix that and every piece of relief flat-lights instead —
    // the noses vanish, and the only shadow left on a head is the one under the
    // chin, which reads as a black visor. About 22 deg off-front at 28 deg
    // elevation lights the fronts and still rakes across them.
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.60);
    sun.position.set(-2.6, 3.6, 6.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 22;
    // The frustum has to contain the group in LIGHT space, which is not world
    // space: a box of -3.6..3.6 by -1..4 clipped the far figures out of the
    // depth pass and the renderer shadowed everything they should have lit. The
    // symptom was the whole group going dark at the front while the hems kept a
    // bright rim, and it survived three rounds of material tuning because it
    // looks exactly like a lighting problem. Turning shadows off and seeing the
    // model render correctly is what identified it.
    // Tight to the group (about 2.6m wide, 2.5m tall) so 2048 texels land at
    // ~1.5mm. At +/-5 a texel was 5mm and the jaw's shadow on the neck came out
    // as a hard black trapezoid that read as a visor.
    sun.shadow.camera.left = -1.9;
    sun.shadow.camera.right = 1.9;
    sun.shadow.camera.top = 2.2;
    sun.shadow.camera.bottom = -2.2;
    sun.shadow.radius = 2.4;
    // normalBias offsets the shadow lookup ALONG THE SURFACE NORMAL, so it is a
    // distance in metres and it erases self-shadowing of anything shallower than
    // itself. At 0.035 it was larger than the entire facial relief — a 25mm brow
    // and a 30mm eye socket, correct in the field and correct in the mesh, could
    // not cast on each other, and under a near-frontal key that shadow is the
    // ONLY thing that makes a reduced face read. Three passes were spent moving
    // those features around, then a fourth refining the mesher, before the
    // shadow settings turned out to be what was flattening them.
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.009;
    scene.add(sun);

    // A cool rear fill separates the cowls from the sky and keeps the sculpture
    // readable through the full orbit. It remains weaker than the front key, so
    // the back stays in shade without collapsing into a black cut-out.
    const rim = new THREE.DirectionalLight(0xbcd8ff, 1.22);
    rim.position.set(0.6, 3.0, -6.0);
    scene.add(rim);

    // The deep cowl folds face away from that central rear source at oblique
    // orbit angles. A weaker opposing fill keeps those broad planes above black
    // on mobile without washing frontal facial relief.
    const rearFill = new THREE.DirectionalLight(0xaec8e0, 0.46);
    rearFill.position.set(-4.2, 1.5, -3.8);
    scene.add(rearFill);

    // A soft fill from the viewer's shoulder. The group stands close enough to
    // shadow each other's chests almost completely under a single key, and the
    // bust and belly are the whole point of the modelling — this keeps them
    // readable without flattening the key's shadows.
    const fill = new THREE.DirectionalLight(0xd8e4f4, 0.44);
    fill.position.set(1.6, 1.2, 6.0);
    scene.add(fill);

    // Bounce up off the pavement.
    const bounce = new THREE.DirectionalLight(0xe4d8c2, 0.24);
    bounce.position.set(0.8, -3, 2.4);
    scene.add(bounce);

    return { hemi, sun, rim, rearFill, fill, bounce };
}

export default createSculpture;
