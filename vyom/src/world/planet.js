/**
 * world/planet.js — VYOM's miniature planet.
 *
 * One displaced icosphere with baked vertex colours, plus a small set of
 * instanced prop layers. Everything here is built once, from a seed, and then
 * never allocates again.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LOOKS THE WAY IT DOES
 * ---------------------------------------------------------------------------
 * 1. COLOUR IS THE READ, NOT GEOMETRY. Terrain only carves DOWN (see
 *    terrain.js's invariant), so the planet has no mountains to silhouette
 *    against the sky — the lands have to be legible from their colour alone.
 *    So the vertex colour is a two-axis lookup: `biomeNoise` picks WHICH land
 *    (meadow / canyon / alpine, blended over a wide border so nothing hard-
 *    switches at a seam), and `depthAt` picks WHERE in that land's own ramp
 *    (lush saturated valley floors -> paler, thinner crests). Canyon gets its
 *    depth axis partially quantised into strata so the cuts read as sedimentary
 *    rock rather than a gradient.
 *
 * 2. DENSITY IS THE POINT. Birb Mobile shipped a clustered-only scatter and it
 *    read as an empty world, because on a small sphere the horizon is ~40 units
 *    away and most views land in the gap BETWEEN clusters. So every primary
 *    prop layer gets BOTH a global evenly-spaced fibonacci scatter AND cluster
 *    pockets, pushed into the SAME instanced arrays — richer world, zero extra
 *    draw calls. Something is always in view.
 *
 * 3. TRIANGLES, NOT DRAW CALLS, ARE THE BINDING CONSTRAINT. The budget is
 *    <=26 draw calls / <=46k triangles and we spend 7 calls. So props are
 *    deliberately tiny (a tree is 28 triangles) and variety comes from
 *    per-instance non-uniform scale + `instanceColor` tint, not from more
 *    geometry.
 *
 * 4. NO OUTLINES ON PROPS. Contract: inverted hulls double the draw count for
 *    lines that read as noise at prop scale. Hero objects only.
 *
 * 5. TERRAIN MATERIAL: `specStrength: 0`, `rimStrength: 0.2`. The default
 *    banded specular on a surface this large and this smooth produces a pale
 *    blob that reads as a bleached patch, not a highlight.
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import {
    PLANET_RADIUS,
    TERRAIN,
    surfaceRadius,
    continentalHeight,
    depthAt,
    biomeNoise,
    fbm,
} from '../core/terrain.js';
import { makeRng, rngRange, fibonacciDirection } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Quality tiers
// ---------------------------------------------------------------------------

/**
 * Icosphere subdivision per tier.
 *
 * NOTE ON THE NUMBERS: the architecture table lists "planet subdivision
 * 48/72/110". Those cannot be Three's icosahedron `detail` parameter — that
 * yields 20*detail^2 triangles, i.e. 242,000 at 110, five times the WHOLE
 * frame budget. They are read here as a subdivision index scaled to the actual
 * triangle budget (roughly detail = subdivision / 4), which keeps the terrain
 * mesh at ~15.7k triangles at `high` and leaves ~28k for the props that
 * actually make the world feel inhabited. Edge length at detail 28 is ~4 world
 * units, and the finest terrain detail octave has a ~54-unit wavelength, so the
 * mesh is comfortably oversampled relative to the height field — spending more
 * triangles here would buy literally nothing visible.
 */
const TIER = {
    low: { detail: 16, props: 0.40 },
    mid: { detail: 21, props: 0.65 },
    high: { detail: 26, props: 1.00 },
};

// ---------------------------------------------------------------------------
// Small math helpers (build-time only — none of this runs in update())
// ---------------------------------------------------------------------------

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

/**
 * Continuous biome weights for a direction. Wide overlap bands so the three
 * lands blend into each other instead of seaming. Writes into `out` (a 3-array)
 * so this can be called a few thousand times without allocating.
 */
function biomeWeights(nx, ny, nz, out) {
    const n = biomeNoise(nx, ny, nz);
    const meadow = 1 - smoothstep(0.33, 0.51, n);
    const alpine = smoothstep(0.58, 0.77, n);
    let canyon = 1 - meadow - alpine;
    if (canyon < 0) canyon = 0;
    const sum = meadow + canyon + alpine || 1;
    out[0] = meadow / sum;
    out[1] = canyon / sum;
    out[2] = alpine / sum;
    return out;
}

/**
 * Mid-frequency mask used to break a prop layer into groves and glades.
 *
 * Without it, a zone function that says "meadow + not-a-crest" carpets every
 * square unit of meadow evenly and the world reads as one undifferentiated
 * forest with nowhere to fly. The mask carves open ground between the stands,
 * which is what makes the terrain shape (and, later, the racing line) legible.
 */
function patchMask(nx, ny, nz, freq, lo, hi) {
    const n = fbm(nx * freq + 31.7, ny * freq + 58.2, nz * freq + 12.4, 2);
    return smoothstep(lo, hi, n);
}

/**
 * Sample a multi-stop colour ramp at t, writing into `outColor`.
 * `stops` is [[t, THREE.Color], ...] ascending. Build-time only.
 */
function sampleRamp(stops, t, outColor) {
    if (t <= stops[0][0]) return outColor.copy(stops[0][1]);
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const a = stops[i - 1];
            const b = stops[i];
            const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
            return outColor.copy(a[1]).lerp(b[1], f);
        }
    }
    return outColor.copy(stops[stops.length - 1][1]);
}

/** THREE.Color from a hex, optionally mixed toward another hex. */
function mixHex(THREE, a, b, f) {
    return new THREE.Color(a).lerp(new THREE.Color(b), f);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Merge a list of { geo, color } parts into one non-indexed BufferGeometry
 * carrying position / normal / color. Written locally rather than pulling in
 * BufferGeometryUtils because VYOM ships no addons — and because baking the
 * part colour into vertices is exactly what lets a whole tree (trunk + canopy)
 * live in ONE InstancedMesh.
 */
function mergeParts(THREE, parts) {
    let total = 0;
    const prepared = [];
    for (let i = 0; i < parts.length; i++) {
        let g = parts[i].geo;
        if (g.index) { const ng = g.toNonIndexed(); g.dispose(); g = ng; }
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        prepared.push({ g, color: parts[i].color });
        total += g.getAttribute('position').count;
    }

    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let o = 0;
    for (let i = 0; i < prepared.length; i++) {
        const g = prepared[i].g;
        const c = prepared[i].color;
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        for (let v = 0; v < p.count; v++) {
            const k = (o + v) * 3;
            pos[k] = p.getX(v); pos[k + 1] = p.getY(v); pos[k + 2] = p.getZ(v);
            nrm[k] = n.getX(v); nrm[k + 1] = n.getY(v); nrm[k + 2] = n.getZ(v);
            col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
        }
        o += p.count;
        g.dispose();
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
    merged.computeBoundingSphere();
    return merged;
}

// ---------------------------------------------------------------------------
// Prop shader patch — wind sway + horizon collapse
// ---------------------------------------------------------------------------

const PROP_VERT_HEAD = /* glsl */`
uniform float uVyomTime;
uniform float uVyomSway;
uniform vec3  uVyomViewDir;
uniform float uVyomCull;
uniform float uVyomCullDot;
`;

/**
 * Injected after <begin_vertex>, so it edits `transformed` in the prop's LOCAL
 * space (base at the origin, +Y up) before `instanceMatrix` puts it on the
 * planet.
 *
 * SWAY: amplitude scales with y^2 so trunks stay planted and canopies move.
 * Per-instance phase comes from the instance translation, which is already an
 * attribute — no extra buffer.
 *
 * HORIZON COLLAPSE: the planet has a ~40-unit horizon at bird altitude, but an
 * InstancedMesh is one draw call and Three cannot cull individual instances, so
 * every tree on the far side of the world still rasterises. Collapsing an
 * instance to zero size when it faces away from the bird kills that overdraw
 * for free, and the soft band means props sink into the ground rather than
 * popping. Disabled (uVyomCull = 0) when the caller passes a zero direction,
 * e.g. for a whole-planet shot.
 */
const PROP_VERT_BODY = /* glsl */`
    #ifdef USE_INSTANCING
    {
        vec3 vyIPos = instanceMatrix[3].xyz;
        float vyPhase = vyIPos.x * 0.41 + vyIPos.y * 0.67 + vyIPos.z * 0.29;
        float vyH = max( transformed.y, 0.0 );
        float vySway = sin( uVyomTime * 1.5 + vyPhase ) * uVyomSway * vyH * vyH * 0.05;
        transformed.x += vySway;
        transformed.z += vySway * 0.55;

        float vySide = dot( normalize( vyIPos ), uVyomViewDir );
        float vyKeep = mix( 1.0, smoothstep( uVyomCullDot - 0.10, uVyomCullDot + 0.10, vySide ), uVyomCull );
        transformed *= vyKeep;
    }
    #endif
`;

// ---------------------------------------------------------------------------
// Prop layer definitions
// ---------------------------------------------------------------------------

/**
 * Each layer: how to build its geometry, how many candidates to try, and how
 * strongly it wants a given patch of ground. `zone` returns 0..1 acceptance
 * probability; `scale` returns a size multiplier for the accepted instance.
 *
 * All zoning is driven by `depthAt` (0 = crest touching the baseline ceiling,
 * 1 = deepest carve) and the blended biome weights, exactly as the brief asks:
 * lush dense valleys, a tree line where props dwarf and thin toward the crests,
 * spires favouring canyon, snow only on the highest ground.
 */
const LAYERS = [
    {
        name: 'broadleaf',
        cap: 460,
        scatter: 2200,     // global even spread — the anti-sparseness layer
        clusters: 34,
        perCluster: 26,
        clusterSpread: 0.055,
        sway: 1.0,
        sink: 1.0,
        tilt: 0.08,
        zone(d, w, nx, ny, nz) {
            // Meadow's signature prop. A little spill into canyon rims and the
            // alpine treeline so the borders don't read as a stencil.
            const affinity = w[0] * 1.0 + w[1] * 0.22 + w[2] * 0.14;
            const treeLine = smoothstep(0.08, 0.42, d);
            // Groves and glades, not a carpet.
            const grove = 0.18 + 0.95 * patchMask(nx, ny, nz, 3.1, 0.38, 0.62);
            return affinity * treeLine * grove;
        },
        scale(d, w, rng) {
            // Dwarfed and thin at the tree line, tall and lush in the valleys.
            const vigour = 0.55 + 0.62 * smoothstep(0.10, 0.62, d);
            return vigour * rngRange(rng, 0.72, 1.34);
        },
    },
    {
        name: 'pine',
        cap: 350,
        scatter: 1600,
        clusters: 26,
        perCluster: 20,
        clusterSpread: 0.048,
        sway: 0.45,
        sink: 0.9,
        tilt: 0.05,
        zone(d, w, nx, ny, nz) {
            // Pines climb higher than broadleaf — their tree line starts lower
            // in depth (i.e. nearer the crest) and thins less aggressively.
            const affinity = w[2] * 0.95 + w[0] * 0.42 + w[1] * 0.20;
            const treeLine = smoothstep(0.02, 0.30, d);
            const stand = 0.22 + 0.9 * patchMask(nx, ny, nz, 3.9, 0.40, 0.63);
            return affinity * treeLine * stand;
        },
        scale(d, w, rng) {
            const vigour = 0.62 + 0.55 * smoothstep(0.05, 0.55, d);
            return vigour * rngRange(rng, 0.78, 1.40);
        },
    },
    {
        name: 'spire',
        cap: 130,
        scatter: 700,
        clusters: 16,
        perCluster: 14,
        clusterSpread: 0.040,
        sway: 0,
        sink: 2.2,
        tilt: 0.04,
        zone(d, w, nx, ny, nz) {
            return w[1] * smoothstep(0.24, 0.70, d)
                * (0.25 + 0.9 * patchMask(nx, ny, nz, 4.6, 0.42, 0.66));
        },
        scale(d, w, rng) {
            return (0.72 + 0.58 * d) * rngRange(rng, 0.70, 1.5);
        },
    },
    {
        name: 'boulder',
        cap: 280,
        scatter: 1200,
        clusters: 18,
        perCluster: 12,
        clusterSpread: 0.05,
        sway: 0,
        sink: 0.5,
        tilt: 0.32,        // boulders sit at any angle
        zone(d, w) {
            return 0.16 + w[1] * 0.55 + w[2] * 0.40;
        },
        scale(d, w, rng) {
            return rngRange(rng, 0.5, 1.5);
        },
    },
    {
        name: 'snowcap',
        cap: 120,
        scatter: 1100,
        clusters: 12,
        perCluster: 12,
        clusterSpread: 0.045,
        sway: 0,
        sink: 0.8,
        tilt: 0.06,
        zone(d, w) {
            // Only the highest ground, and only where the land is alpine.
            return w[2] * (1 - smoothstep(0.03, 0.26, d));
        },
        scale(d, w, rng) {
            return rngRange(rng, 0.7, 1.9);
        },
    },
    {
        name: 'shrub',
        cap: 380,
        scatter: 2000,
        clusters: 20,
        perCluster: 16,
        clusterSpread: 0.045,
        sway: 1.6,
        sink: 0.3,
        tilt: 0.14,
        zone(d, w, nx, ny, nz) {
            return (w[0] * 0.9 + w[1] * 0.35) * smoothstep(0.14, 0.62, d)
                * (0.3 + 0.9 * patchMask(nx, ny, nz, 5.4, 0.36, 0.60));
        },
        scale(d, w, rng) {
            return (0.6 + 0.7 * d) * rngRange(rng, 0.7, 1.4);
        },
    },
];

// ---------------------------------------------------------------------------
// Prop geometry builders
// ---------------------------------------------------------------------------

function buildPropGeometry(THREE, name) {
    switch (name) {
        case 'broadleaf': {
            // 36 tris: open 4-sided trunk (8) + main canopy (20) + a cheap
            // octahedral secondary lobe (8). The lobe is what stops a stand of
            // these reading as a bag of identical balls at close range; an
            // icosahedron there would have cost 20 more triangles per tree,
            // i.e. ~9k across the layer, for a difference nobody would see.
            const trunk = new THREE.CylinderGeometry(0.20, 0.34, 1.8, 4, 1, true);
            trunk.translate(0, 0.9, 0);
            const canopy = new THREE.IcosahedronGeometry(1.20, 0);
            canopy.scale(1.14, 0.90, 1.14);
            canopy.translate(0, 2.30, 0);
            const lobe = new THREE.OctahedronGeometry(0.86, 0);
            lobe.scale(1.15, 0.95, 1.15);
            lobe.translate(0.62, 3.05, -0.30);
            return mergeParts(THREE, [
                { geo: trunk, color: new THREE.Color(PALETTE.trunk) },
                { geo: canopy, color: new THREE.Color(PALETTE.foliageMid) },
                { geo: lobe, color: new THREE.Color(PALETTE.foliageLit) },
            ]);
        }
        case 'pine': {
            // 20 tris: trunk (8) + two open cone skirts (6 + 6).
            const trunk = new THREE.CylinderGeometry(0.14, 0.24, 1.0, 4, 1, true);
            trunk.translate(0, 0.5, 0);
            const lower = new THREE.ConeGeometry(1.10, 2.4, 6, 1, true);
            lower.translate(0, 1.7, 0);
            const upper = new THREE.ConeGeometry(0.74, 2.0, 6, 1, true);
            upper.translate(0, 3.2, 0);
            return mergeParts(THREE, [
                { geo: trunk, color: new THREE.Color(PALETTE.trunk) },
                { geo: lower, color: new THREE.Color(PALETTE.pineDeep) },
                { geo: upper, color: new THREE.Color(PALETTE.pineLit) },
            ]);
        }
        case 'spire': {
            // 10 tris: a stepped ochre needle. Buried base, so no cap needed.
            const base = new THREE.ConeGeometry(2.5, 9.0, 5, 1, true);
            base.translate(0, 4.5, 0);
            const tip = new THREE.ConeGeometry(1.2, 4.4, 5, 1, true);
            tip.translate(0, 10.2, 0);
            return mergeParts(THREE, [
                { geo: base, color: new THREE.Color(PALETTE.canyonMid) },
                { geo: tip, color: new THREE.Color(PALETTE.canyonLit) },
            ]);
        }
        case 'boulder': {
            // 8 tris. Squashed so it reads as a rock rather than a crystal.
            const g = new THREE.OctahedronGeometry(0.95, 0);
            g.scale(1.28, 0.70, 1.0);
            g.translate(0, 0.42, 0);
            return mergeParts(THREE, [{ geo: g, color: new THREE.Color(PALETTE.rock) }]);
        }
        case 'snowcap': {
            // 20 tris. Wide and flat: a patch of snow lying on the crest, not
            // a white ball sitting on it.
            const g = new THREE.IcosahedronGeometry(2.6, 0);
            g.scale(1.45, 0.26, 1.45);
            g.translate(0, 0.24, 0);
            return mergeParts(THREE, [{ geo: g, color: new THREE.Color(PALETTE.snow) }]);
        }
        case 'shrub':
        default: {
            // 4 tris. Ground clutter that fills the near field cheaply.
            const g = new THREE.TetrahedronGeometry(0.80, 0);
            g.scale(1.2, 0.90, 1.2);
            g.translate(0, 0.46, 0);
            return mergeParts(THREE, [{ geo: g, color: new THREE.Color(PALETTE.foliageLit) }]);
        }
    }
}

/** Per-instance tint range, so a layer doesn't read as one flat colour. */
function tintFor(name, rng, out) {
    switch (name) {
        case 'broadleaf': {
            // Warm/cool spread across the canopy population.
            const v = rngRange(rng, 0.78, 1.32);
            out.setRGB(v * rngRange(rng, 0.92, 1.22), v, v * rngRange(rng, 0.80, 1.02));
            return out;
        }
        case 'pine': {
            const v = rngRange(rng, 0.80, 1.22);
            out.setRGB(v * 0.95, v, v * rngRange(rng, 0.92, 1.10));
            return out;
        }
        case 'spire': {
            const v = rngRange(rng, 0.82, 1.20);
            out.setRGB(v * rngRange(rng, 0.98, 1.12), v, v * 0.92);
            return out;
        }
        case 'boulder': {
            const v = rngRange(rng, 0.72, 1.22);
            out.setRGB(v, v * rngRange(rng, 0.96, 1.04), v * rngRange(rng, 0.94, 1.06));
            return out;
        }
        case 'snowcap': {
            const v = rngRange(rng, 0.94, 1.06);
            out.setRGB(v, v, v);
            return out;
        }
        default: {
            const v = rngRange(rng, 0.72, 1.25);
            out.setRGB(v * rngRange(rng, 0.9, 1.1), v, v * 0.9);
            return out;
        }
    }
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} [opts]
 * @param {'low'|'mid'|'high'} [opts.quality]
 * @param {number} [opts.seed]
 */
export function createPlanet(THREE, opts = {}) {
    const tier = TIER[opts.quality] || TIER.high;
    const seed = opts.seed ?? 20260801;

    const group = new THREE.Group();
    group.name = 'vyom-planet';

    const disposables = [];
    let triangleCount = 0;
    let drawCallCount = 0;

    // -----------------------------------------------------------------------
    // 1. Terrain mesh
    // -----------------------------------------------------------------------
    const geo = new THREE.IcosahedronGeometry(PLANET_RADIUS, tier.detail);
    const pos = geo.getAttribute('position');
    const vcount = pos.count;
    const colors = new Float32Array(vcount * 3);

    // Per-biome depth ramps. Read top-to-bottom as: bare pale crest -> the
    // land's own hue -> saturated valley floor.
    // Crest colours are deliberately only a LITTLE paler than the land's own
    // hue. The first captured frame mixed 42% alpineLit into the meadow crest,
    // and because crests on this terrain are thin ridge lines, that read as
    // cream-coloured cracks scratched across the hills rather than as sunlit
    // high ground.
    const meadowRamp = [
        [0.00, mixHex(THREE, PALETTE.meadowLit, PALETTE.alpineLit, 0.20)],
        [0.16, new THREE.Color(PALETTE.meadowLit)],
        [0.46, mixHex(THREE, PALETTE.meadowLit, PALETTE.meadowMid, 0.55)],
        [0.78, new THREE.Color(PALETTE.meadowMid)],
        [1.00, new THREE.Color(PALETTE.meadowDeep)],
    ];
    const canyonRamp = [
        [0.00, mixHex(THREE, PALETTE.canyonLit, PALETTE.alpineLit, 0.20)],
        [0.22, new THREE.Color(PALETTE.canyonLit)],
        [0.58, new THREE.Color(PALETTE.canyonMid)],
        [0.86, new THREE.Color(PALETTE.canyonDeep)],
        [1.00, mixHex(THREE, PALETTE.canyonDeep, PALETTE.ink, 0.22)],
    ];
    const alpineRamp = [
        [0.00, new THREE.Color(PALETTE.snow)],
        [0.16, new THREE.Color(PALETTE.alpineLit)],
        [0.44, new THREE.Color(PALETTE.alpineMid)],
        [0.70, new THREE.Color(PALETTE.alpineDeep)],
        [1.00, mixHex(THREE, PALETTE.alpineDeep, PALETTE.meadowDeep, 0.55)],
    ];

    const cM = new THREE.Color();
    const cC = new THREE.Color();
    const cA = new THREE.Color();
    const w3 = [0, 0, 0];

    for (let i = 0; i < vcount; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const inv = 1 / Math.hypot(x, y, z);
        const nx = x * inv, ny = y * inv, nz = z * inv;

        const r = surfaceRadius(nx, ny, nz);
        pos.setXYZ(i, nx * r, ny * r, nz * r);

        const d = clamp01(depthAt(nx, ny, nz));
        biomeWeights(nx, ny, nz, w3);

        // Canyon reads as sedimentary strata: half the depth axis is quantised
        // into bands, half stays continuous so the bands still follow the form.
        const bands = 9;
        const strata = Math.floor(d * bands) / (bands - 1);
        const dCanyon = clamp01(d * 0.45 + strata * 0.55);

        sampleRamp(meadowRamp, d, cM);
        sampleRamp(canyonRamp, dCanyon, cC);
        sampleRamp(alpineRamp, d, cA);

        // Low-amplitude mottle so large flat lands don't read as vinyl. Kept
        // as COLOUR only — perturbing normals at this frequency is exactly the
        // band-noise trap the contract warns about.
        const m = fbm(nx * 7.3 + 4.1, ny * 7.3 + 9.6, nz * 7.3 + 2.2, 3);
        const mott = 0.90 + 0.20 * m;

        const o = i * 3;
        colors[o] = (cM.r * w3[0] + cC.r * w3[1] + cA.r * w3[2]) * mott;
        colors[o + 1] = (cM.g * w3[0] + cC.g * w3[1] + cA.g * w3[2]) * mott;
        colors[o + 2] = (cM.b * w3[0] + cC.b * w3[1] + cA.b * w3[2]) * mott;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const terrainMat = createToonMaterial(THREE, {
        ramp: 'terrain',
        vertexColors: true,
        // Contract: a banded specular on a surface this big is a bleached blob.
        specStrength: 0,
        rimStrength: 0.2,
        rimColor: PALETTE.skyGlow,
        rimPower: 3.0,
        rimThreshold: 0.62,
    });

    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.name = 'vyom-terrain';
    group.add(terrain);
    disposables.push(geo, terrainMat);
    triangleCount += vcount / 3;
    drawCallCount += 1;

    // -----------------------------------------------------------------------
    // 2. Instanced prop layers
    // -----------------------------------------------------------------------

    // Shared per-frame uniforms. One object, referenced by every prop material,
    // so update() writes each value exactly once.
    const propUniforms = {
        uVyomTime: { value: 0 },
        uVyomViewDir: { value: new THREE.Vector3(0, 1, 0) },
        uVyomCull: { value: 0 },
        // cos(~62 deg): anything further round the planet than this is well
        // past the ~40-unit horizon at bird altitude.
        uVyomCullDot: { value: 0.47 },
    };

    const layerMeshes = [];
    const dir = { x: 0, y: 1, z: 0 };
    const cDir = { x: 0, y: 1, z: 0 };
    const bw = [0, 0, 0];

    // Build-time scratch (never used after construction).
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _qSpin = new THREE.Quaternion();
    const _qTilt = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _m = new THREE.Matrix4();
    const _up = new THREE.Vector3(0, 1, 0);
    const _axis = new THREE.Vector3();
    const _n = new THREE.Vector3();
    const _tint = new THREE.Color();

    for (let li = 0; li < LAYERS.length; li++) {
        const layer = LAYERS[li];
        const rng = makeRng(seed * 2654435761 + li * 7919 + 13);
        const cap = Math.max(8, Math.round(layer.cap * tier.props));
        const scatterN = Math.round(layer.scatter * (0.55 + 0.45 * tier.props));

        // --- gather placements -------------------------------------------
        // [nx, ny, nz, scale, spin, tiltA, tiltB] per accepted instance.
        // STRIDE is why `placed` is tracked separately from `place.length` —
        // comparing the flat array's length against the cap silently built
        // every layer at 1/7 of its intended density.
        const STRIDE = 7;
        const place = [];
        let placed = 0;

        function tryPlace(px, py, pz, boost) {
            if (placed >= cap) return;
            const d = clamp01(depthAt(px, py, pz));
            biomeWeights(px, py, pz, bw);
            const score = layer.zone(d, bw, px, py, pz) * boost;
            if (rng() > score) return;
            place.push(
                px, py, pz,
                layer.scale(d, bw, rng),
                rngRange(rng, 0, Math.PI * 2),
                rngRange(rng, -layer.tilt, layer.tilt),
                rngRange(rng, -layer.tilt, layer.tilt)
            );
            placed++;
        }

        // (a) GLOBAL EVEN SCATTER. This is the layer that stops the world
        //     reading as empty: fibonacci points are maximally spread, so a
        //     view in any direction lands on some of them.
        for (let i = 0; i < scatterN && placed < cap; i++) {
            fibonacciDirection(i, scatterN, dir, rng, 0.55 / Math.cbrt(scatterN));
            tryPlace(dir.x, dir.y, dir.z, 1.0);
        }

        // (b) CLUSTER POCKETS. Groves and rock fields on top of the even
        //     spread, in the SAME instanced array — zero extra draw calls.
        const clusters = Math.max(3, Math.round(layer.clusters * tier.props));
        for (let c = 0; c < clusters && placed < cap; c++) {
            fibonacciDirection(c, clusters, cDir, rng, 0.8);
            const cd = clamp01(depthAt(cDir.x, cDir.y, cDir.z));
            biomeWeights(cDir.x, cDir.y, cDir.z, bw);
            if (layer.zone(cd, bw, cDir.x, cDir.y, cDir.z) < 0.22) continue;
            for (let k = 0; k < layer.perCluster && placed < cap; k++) {
                // Concentrated toward the centre: cubing the radius pulls the
                // population inward, so a grove has a dense core and a ragged
                // edge instead of a uniform disc.
                const rr = layer.clusterSpread * Math.pow(rng(), 0.55);
                const th = rng() * Math.PI * 2;
                // Build a tangent frame around the cluster centre.
                _n.set(cDir.x, cDir.y, cDir.z);
                _axis.set(0, 1, 0);
                if (Math.abs(_n.y) > 0.94) _axis.set(1, 0, 0);
                _p.copy(_axis).cross(_n).normalize();
                _axis.copy(_n).cross(_p).normalize();
                const ox = _n.x + (_p.x * Math.cos(th) + _axis.x * Math.sin(th)) * rr;
                const oy = _n.y + (_p.y * Math.cos(th) + _axis.y * Math.sin(th)) * rr;
                const oz = _n.z + (_p.z * Math.cos(th) + _axis.z * Math.sin(th)) * rr;
                const linv = 1 / Math.hypot(ox, oy, oz);
                tryPlace(ox * linv, oy * linv, oz * linv, 1.6);
            }
        }

        const count = place.length / STRIDE;
        if (count < 1) continue;

        // --- geometry + material ------------------------------------------
        const pgeo = buildPropGeometry(THREE, layer.name);
        const triPerInstance = pgeo.getAttribute('position').count / 3;

        const pmat = createToonMaterial(THREE, {
            ramp: 'terrain',
            vertexColors: true,
            flatShading: true,
            specStrength: 0,
            rimStrength: 0.34,
            rimColor: PALETTE.skyGlow,
            rimThreshold: 0.46,
        });

        // Layer the sway/cull injection ON TOP of the toon patch rather than
        // replacing it — otherwise the props lose the rim and stop matching
        // everything else in the frame.
        const baseCompile = pmat.onBeforeCompile;
        const swayU = { value: layer.sway };
        pmat.onBeforeCompile = (shader) => {
            baseCompile(shader);
            Object.assign(shader.uniforms, propUniforms, { uVyomSway: swayU });
            shader.vertexShader = PROP_VERT_HEAD + shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n' + PROP_VERT_BODY
            );
        };
        pmat.customProgramCacheKey = () => 'vyom-prop-v1';

        const mesh = new THREE.InstancedMesh(pgeo, pmat, count);
        mesh.name = 'vyom-prop-' + layer.name;
        // Props blanket the whole sphere, so the mesh bounds always intersect
        // the frustum. Skipping the test saves the per-frame bounds work.
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        for (let i = 0; i < count; i++) {
            const o = i * STRIDE;
            const nx = place[o], ny = place[o + 1], nz = place[o + 2];
            const sc = place[o + 3];
            const spin = place[o + 4];
            const tA = place[o + 5], tB = place[o + 6];

            _n.set(nx, ny, nz);
            const r = surfaceRadius(nx, ny, nz) - layer.sink * Math.max(0.6, sc);
            _p.copy(_n).multiplyScalar(r);

            // Up is radial — always. Then a per-instance spin about that up,
            // and a small random lean so a forest doesn't look extruded.
            _q.setFromUnitVectors(_up, _n);
            _qSpin.setFromAxisAngle(_up, spin);
            _q.multiply(_qSpin);
            _axis.set(1, 0, 0);
            _qTilt.setFromAxisAngle(_axis, tA);
            _q.multiply(_qTilt);
            _axis.set(0, 0, 1);
            _qTilt.setFromAxisAngle(_axis, tB);
            _q.multiply(_qTilt);

            // Slight horizontal/vertical scale decorrelation: same asset,
            // different plant.
            _s.set(sc * rngRange(rng, 0.88, 1.14), sc * rngRange(rng, 0.86, 1.22), sc);
            _s.z = _s.x;

            _m.compose(_p, _q, _s);
            mesh.setMatrixAt(i, _m);
            mesh.setColorAt(i, tintFor(layer.name, rng, _tint));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        group.add(mesh);
        layerMeshes.push(mesh);
        disposables.push(pgeo, pmat);
        triangleCount += triPerInstance * count;
        drawCallCount += 1;
    }

    // -----------------------------------------------------------------------
    // 3. Runtime
    // -----------------------------------------------------------------------

    let _time = 0;

    /**
     * Zero-allocation. `birdDir*` is the bird's radial direction (it does NOT
     * need to be normalised); pass 0,0,0 to disable the horizon collapse, e.g.
     * for a whole-planet camera.
     */
    function update(dt, birdDirX, birdDirY, birdDirZ) {
        _time += dt;
        propUniforms.uVyomTime.value = _time;
        const l2 = birdDirX * birdDirX + birdDirY * birdDirY + birdDirZ * birdDirZ;
        if (l2 > 1e-6) {
            const inv = 1 / Math.sqrt(l2);
            propUniforms.uVyomViewDir.value.set(birdDirX * inv, birdDirY * inv, birdDirZ * inv);
            propUniforms.uVyomCull.value = 1;
        } else {
            propUniforms.uVyomCull.value = 0;
        }
    }

    function dispose() {
        for (let i = 0; i < disposables.length; i++) {
            const d = disposables[i];
            if (d && typeof d.dispose === 'function') d.dispose();
        }
        disposables.length = 0;
        layerMeshes.length = 0;
        group.clear();
    }

    return {
        group,
        terrain,
        propLayers: layerMeshes,
        update,
        triangleCount: Math.round(triangleCount),
        drawCallCount,
        dispose,
        // Exposed for probes/integration: the constants this module built from.
        PLANET_RADIUS,
        TERRAIN,
        continentalHeight,
    };
}
