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
    deep: [0.088, 0.090, 0.082],     // crevice black, faintly warm
    body: [0.300, 0.309, 0.276],     // the general bronze
    lit: [0.560, 0.575, 0.500],      // washed, up-facing surfaces
    verdigris: [0.286, 0.372, 0.318], // green bloom in the sheltered hollows
};

/**
 * Where each figure stands. x/z in metres, `turn` in radians about Y.
 *
 * The group faces roughly +Z. Figure 0 is the tall one front-left that anchors
 * `ref-a-front.jpg`; figure 3 is the one turned away whose blank cowl fills the
 * right of `ref-d-wide.jpg`.
 */
const LAYOUT = [
    // ZIGZAG, not a rank. The cloak panels fold back and forth like a screen —
    // that concertina is the group's whole plan-view and it is why the mass
    // reads as one object from the front and as four people from the side.
    // Alternating `turn` is what makes the fold; a shared heading gave four
    // parallel slabs and no sculpture.
    { x: -0.78, z: 0.16, turn: 0.42, scale: 1.020, seed: 11, bun: false, faceless: false, hands: false, pregnant: false, baby: false, stethoscope: false, folds: 7, foldDepth: 1.00, foldPhase: 0.0 },
    { x: -0.26, z: -0.20, turn: -0.34, scale: 0.995, seed: 23, bun: true, faceless: false, hands: false, pregnant: true, baby: false, stethoscope: false, folds: 8, foldDepth: 0.86, foldPhase: 1.7 },
    { x: 0.28, z: 0.14, turn: 0.30, scale: 1.005, seed: 37, bun: true, faceless: false, hands: false, pregnant: false, baby: true, stethoscope: false, folds: 6, foldDepth: 1.12, foldPhase: 3.1 },
    { x: 0.80, z: -0.18, turn: -0.40, scale: 1.010, seed: 51, bun: false, faceless: false, hands: false, pregnant: false, baby: false, stethoscope: true, folds: 7, foldDepth: 0.94, foldPhase: 4.6 },
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

    let maxR = 0.001;
    for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r > maxR) maxR = r;
    }

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const ny = nor.getY(i);

        // 1. up-facing wash
        const up = Math.max(0, ny);
        // 2. pocket darkening — inside the mass, and low down where the robes
        //    crowd together and never see the sky.
        const r = Math.hypot(x, z) / maxR;
        const pocket = (1 - r) * 0.65 + Math.max(0, 1 - y / 0.9) * 0.35;
        // 3. vertical run-off streaks: high frequency around the figure, very
        //    low frequency up it, which is exactly how water actually marks a
        //    standing bronze.
        const streak = fbm3(x * 11, y * 0.55, z * 11, seed + 5, 2) * 0.5 + 0.5;

        let c = mix(PATINA.body, PATINA.lit, Math.pow(up, 1.4) * 0.85);
        c = mix(c, PATINA.deep, Math.min(1, pocket) * 0.72);
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
        roughness: 0.62,
        metalness: 0.42,
        // Bronze is metal, so the diffuse term is nearly gone and the colour
        // has to arrive through the specular response. A high metalness with a
        // mid roughness is what makes it read as patinated metal rather than
        // painted stone.
        envMapIntensity: 1.0,
    });

    const figures = [];
    for (let i = 0; i < LAYOUT.length; i++) {
        const L = LAYOUT[i];
        const geo = buildFigure(THREE, {
            seed: L.seed, bun: L.bun, faceless: L.faceless, hands: L.hands, scale: L.scale,
            pregnant: L.pregnant, baby: L.baby, stethoscope: L.stethoscope,
            folds: L.folds, foldDepth: L.foldDepth, foldPhase: L.foldPhase,
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
    const baseGeo = new THREE.CylinderGeometry(1.36, 1.40, 0.026, 44, 1);
    baseGeo.scale(1.12, 1, 0.62);
    baseGeo.translate(0.16, 0.014, -0.06);
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
    const hemi = new THREE.HemisphereLight(0xbcd8f5, 0x8b8271, 2.15);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e2, 3.10);
    sun.position.set(-4.5, 5.2, 3.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 18;
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 4;
    sun.shadow.camera.bottom = -1;
    sun.shadow.bias = -0.0016;
    scene.add(sun);

    // Rim from behind, which is what separates the cowls from the sky in
    // `ref-c-under.jpg` and stops the group reading as one black blob.
    const rim = new THREE.DirectionalLight(0xcae2ff, 1.55);
    rim.position.set(3.4, 2.6, -4.4);
    scene.add(rim);

    // Bounce up off the pavement.
    const bounce = new THREE.DirectionalLight(0xe4d8c2, 0.85);
    bounce.position.set(0.8, -3, 2.4);
    scene.add(bounce);

    return { hemi, sun, rim, bounce };
}

export default createSculpture;
