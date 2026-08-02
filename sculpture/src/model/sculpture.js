/**
 * model/sculpture.js — the four figures, arranged, patinated and lit.
 *
 * ARRANGEMENT. Read off `ref-a-front.jpg` and `ref-c-under.jpg`: the group is
 * not a line-up. The figures are staggered in depth and rotated slightly apart,
 * overlapping so their cowls interleave, which is why the group reads as one
 * mass from the front and as four people from the side. Getting the stagger
 * wrong is the fastest way to lose the likeness even with perfect figures.
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
    // Dark. Weathered bronze reads almost black in the photographs and only the
    // washed edges come up to a mid grey-green; the pale values these started at
    // rendered the group as plaster once the shadow bug stopped hiding them.
    deep: [0.042, 0.044, 0.039],     // crevice black, faintly warm
    body: [0.170, 0.176, 0.155],     // the general bronze
    lit: [0.335, 0.344, 0.296],      // washed, up-facing surfaces
    verdigris: [0.148, 0.203, 0.170], // green bloom in the sheltered hollows
};

/**
 * Where each figure stands. x/z in metres, `turn` in radians about Y.
 *
 * The group faces roughly +Z. Figure 0 is the tall one front-left that anchors
 * `ref-a-front.jpg`; figure 3 is the one turned away whose blank cowl fills the
 * right of `ref-d-wide.jpg`.
 */
const LAYOUT = [
    // A CROWDED DIAGONAL, running back and to the right — read straight off
    // `ref-a-front.jpg`, where the nearest figure stands front-left and each of
    // the other three sits further back and further right, shoulders almost
    // touching. They all face roughly the same way, turning a little more to the
    // right as they go back, as though walking together.
    //
    // An earlier pass had them alternating left and right like a folded screen.
    // That reads as a decorative arrangement of panels; the photographs read as
    // four women standing close.
    //
    // `trainAngle` is the azimuth the cloak's hem drags toward, so the four
    // trains fan out rather than all pooling on the same side.
    { x: -0.92, z: 0.40, turn: -0.05, scale: 1.030, seed: 11, bun: false, faceless: false, hands: false, pregnant: false, baby: false, stethoscope: false, folds: 7, foldDepth: 1.00, foldPhase: 0.0, cowlTop: 1.98, trainAngle: 3.72, trainAmount: 0.22 },
    { x: -0.30, z: -0.06, turn: 0.13, scale: 0.995, seed: 23, bun: true, faceless: true, hands: false, pregnant: true, baby: false, stethoscope: false, folds: 8, foldDepth: 0.86, foldPhase: 1.7, cowlTop: 2.42, trainAngle: 3.05, trainAmount: 0.18 },
    { x: 0.33, z: -0.38, turn: 0.32, scale: 1.005, seed: 37, bun: true, faceless: false, hands: false, pregnant: false, baby: true, stethoscope: false, folds: 6, foldDepth: 1.12, foldPhase: 3.1, cowlTop: 2.42, trainAngle: 2.52, trainAmount: 0.25 },
    { x: 0.96, z: -0.70, turn: 0.50, scale: 1.010, seed: 51, bun: true, faceless: false, hands: false, pregnant: false, baby: false, stethoscope: true, folds: 7, foldDepth: 0.94, foldPhase: 4.6, cowlTop: 2.30, trainAngle: 2.05, trainAmount: 0.28 },
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
        const ny = nor.getY(i);

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
        const streak = fbm3(x * 11, y * 0.55, z * 11, seed + 5, 2) * 0.5 + 0.5;

        // The wash is raised to a high power so it lands on genuine shelves —
        // shoulders, brows, the top edge of a cowl — and not on everything with
        // a slight upward tilt. At 1.4 / 0.85 the bare feet came out as the
        // brightest objects in the scene, four pairs of white pebbles.
        // Nothing near the ground is rain-washed pale — it is splashed and
        // filthy — so the wash fades out over the last 40cm.
        const washable = Math.min(1, Math.max(0, (y - 0.10) / 0.40));
        let c = mix(PATINA.body, PATINA.lit, Math.pow(up, 2.0) * 0.60 * washable);
        c = mix(c, PATINA.deep, Math.min(1, pocket) * 0.55);
        c = mix(c, PATINA.verdigris, Math.max(0, 0.55 - up) * streak * 0.5);
        // The streaks themselves, as a light/dark multiply.
        const s = 0.86 + streak * 0.28;
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
 * Build the whole sculpture.
 *
 * @returns {{group, figures, material, height, dispose}}
 */
export function createSculpture(THREE, opts = {}) {
    const group = new THREE.Group();
    group.name = 'sculpture';

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.58,
        // Three defaults a FrontSide material's `shadowSide` to BackSide, which
        // is right for watertight solids and WRONG for this geometry: a figure
        // is a merge of an open-topped cloak sheet, a surface-nets body, a head
        // and two feet, so the "far side" the depth pass writes is not a valid
        // occluder for its own front. The result was every figure shadowing its
        // own chest — the entire group above waist height rendered in ambient
        // only, which for three passes looked exactly like a lighting or
        // material problem and survived every attempt to fix it as one. Toggling
        // castShadow off on the figures is what proved it was the depth pass.
        shadowSide: THREE.FrontSide,
        // PATINATED bronze, which is the point: the surface in the photographs
        // is oxide, not metal. Run at metalness 0.42 the diffuse term is scaled
        // by 0.58 and the group renders as a black cut-out no matter how bright
        // the sun. Weathered bronze behaves far closer to a rough dielectric.
        metalness: 0.20,
        envMapIntensity: 1.0,
    });

    const figures = [];
    for (let i = 0; i < LAYOUT.length; i++) {
        const L = LAYOUT[i];
        const geo = buildFigure(THREE, {
            seed: L.seed, bun: L.bun, faceless: L.faceless, hands: L.hands, scale: L.scale,
            pregnant: L.pregnant, baby: L.baby, stethoscope: L.stethoscope,
            folds: L.folds, foldDepth: L.foldDepth, foldPhase: L.foldPhase,
            cowlTop: L.cowlTop, trainAngle: L.trainAngle, trainAmount: L.trainAmount,
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
    const baseGeo = new THREE.CylinderGeometry(1.62, 1.66, 0.030, 48, 1);
    baseGeo.scale(1.16, 1, 0.74);
    baseGeo.translate(0.10, 0.016, -0.14);
    const baseCol = new Float32Array(baseGeo.attributes.position.count * 3);
    for (let i = 0; i < baseCol.length; i += 3) {
        baseCol[i] = 0.108; baseCol[i + 1] = 0.112; baseCol[i + 2] = 0.100;
    }
    baseGeo.setAttribute('color', new THREE.Float32BufferAttribute(baseCol, 3));
    const base = new THREE.Mesh(baseGeo, material);
    base.receiveShadow = true;
    base.name = 'base';
    group.add(base);

    return {
        group,
        figures,
        material,
        height: 2.33,
        dispose() {
            for (const f of figures) f.geometry.dispose();
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
    // Ambient is deliberately LOW. At 2.15 it drowned the modelling: the
    // reference photos are hard winter sun and everything that reads in them —
    // the bust, the belly, the fold ridges — reads because of the shadow beneath
    // it, and a bright sky fill erases every one of those shadows. The figures
    // went from sculpture to pale card in exactly the amount of hemisphere light
    // added.
    // Intensities are LOW because the albedo is low. Three's lights are plain
    // irradiance multipliers, so a 0.17 bronze under a 3.0 sun tone-maps to a
    // 0.7 grey and the group renders as plaster no matter how dark the vertex
    // colours are. Darkening the patina and brightening the sun are the same
    // knob turned opposite ways; this is the pair that actually lands on bronze.
    const hemi = new THREE.HemisphereLight(0xa8c6ea, 0x6d6455, 0.62);
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
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.78);
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
    // normalBias, not a flat negative bias: these are curved organic surfaces
    // and offsetting along the normal is what stops acne without peter-panning.
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);

    // Rim from behind, which is what separates the cowls from the sky in
    // `ref-c-under.jpg` and stops the group reading as one black blob.
    const rim = new THREE.DirectionalLight(0xbcd8ff, 0.46);
    rim.position.set(3.4, 2.6, -4.4);
    scene.add(rim);

    // A soft fill from the viewer's shoulder. The group stands close enough to
    // shadow each other's chests almost completely under a single key, and the
    // bust and belly are the whole point of the modelling — this keeps them
    // readable without flattening the key's shadows.
    const fill = new THREE.DirectionalLight(0xd8e4f4, 0.34);
    fill.position.set(1.6, 1.2, 6.0);
    scene.add(fill);

    // Bounce up off the pavement.
    const bounce = new THREE.DirectionalLight(0xe4d8c2, 0.20);
    bounce.position.set(0.8, -3, 2.4);
    scene.add(bounce);

    return { hemi, sun, rim, fill, bounce };
}

export default createSculpture;
