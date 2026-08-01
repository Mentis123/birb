/**
 * world/planet.js — Birb Gauntlet's miniature planet.
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
 * triangle budget, which keeps the terrain mesh at ~11.5k triangles at `high`
 * and leaves ~32k for the props that actually make the world feel inhabited.
 * Edge length at detail 24 is ~4.6 world units and the finest terrain detail
 * octave has a ~54-unit wavelength, so the mesh is already oversampled relative
 * to the height field — every triangle moved from the sphere into the prop
 * layers is a triangle you can actually see.
 */
const TIER = {
    low: { detail: 14, props: 0.40 },
    mid: { detail: 18, props: 0.65 },
    high: { detail: 22, props: 1.00 },
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
    // Narrow-ish overlap. The first tuning blended over 0.18 of the noise
    // range and the whole meadow/canyon border went khaki — a 50/50 mix of
    // saturated green and saturated ochre is mud, and it covered more of the
    // planet than either pure land did.
    const meadow = 1 - smoothstep(0.37, 0.47, n);
    const alpine = smoothstep(0.63, 0.73, n);
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
 * BufferGeometryUtils because Birb Gauntlet ships no addons — and because baking the
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

/**
 * Scale everything below y=0 toward the equator plane. Cheap way to turn a
 * symmetric solid into something that sits on the ground, without adding a
 * single triangle.
 */
function squashUnderside(geometry, factor) {
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < 0) p.setY(i, y * factor);
    }
    p.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
}

/** Flat-repaint every vertex below `y` — used to restore a trunk after a
 * whole-tree height gradient has washed over it. */
function paintBelow(THREE, geometry, y, color) {
    const p = geometry.getAttribute('position');
    const c = geometry.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < y) c.setXYZ(i, color.r, color.g, color.b);
    }
    c.needsUpdate = true;
    return geometry;
}

/**
 * Repaint an already-merged geometry's vertex colours as a vertical gradient
 * between two colours. Used where a prop is big enough that one flat colour
 * reads as a silhouette hole (the pine crown, the boulder mass).
 */
function tintByHeight(THREE, geometry, y0, y1, lowColor, highColor, gamma = 1) {
    const p = geometry.getAttribute('position');
    const c = geometry.getAttribute('color');
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        let t = clamp01((p.getY(i) - y0) / Math.max(1e-6, y1 - y0));
        t = Math.pow(t, gamma);
        tmp.copy(lowColor).lerp(highColor, t);
        c.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    c.needsUpdate = true;
    return geometry;
}

// ---------------------------------------------------------------------------
// Prop shader patch — wind sway + horizon collapse
// ---------------------------------------------------------------------------

const PROP_VERT_HEAD = /* glsl */`
uniform float uGauntletTime;
uniform float uGauntletSway;
uniform vec3  uGauntletViewDir;
uniform float uGauntletCull;
uniform float uGauntletCullDot;
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
 * popping. Disabled (uGauntletCull = 0) when the caller passes a zero direction,
 * e.g. for a whole-planet shot.
 */
const PROP_VERT_BODY = /* glsl */`
    #ifdef USE_INSTANCING
    {
        vec3 vyIPos = instanceMatrix[3].xyz;
        float vyPhase = vyIPos.x * 0.41 + vyIPos.y * 0.67 + vyIPos.z * 0.29;
        float vyH = max( transformed.y, 0.0 );
        float vySway = sin( uGauntletTime * 1.5 + vyPhase ) * uGauntletSway * vyH * vyH * 0.05;
        transformed.x += vySway;
        transformed.z += vySway * 0.55;

        float vySide = dot( normalize( vyIPos ), uGauntletViewDir );
        float vyKeep = mix( 1.0, smoothstep( uGauntletCullDot - 0.10, uGauntletCullDot + 0.10, vySide ), uGauntletCull );
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
        cap: 520,
        scatter: 3400,     // global even spread — the anti-sparseness layer
        clusters: 46,
        perCluster: 30,
        clusterSpread: 0.055,
        sway: 1.0,
        sink: 1.0,
        tilt: 0.08,
        zone(d, w, nx, ny, nz) {
            // Meadow's signature prop. A little spill into canyon rims and the
            // alpine treeline so the borders don't read as a stencil.
            const affinity = w[0] * 1.0 + w[1] * 0.22 + w[2] * 0.14;
            // Widened after a captured frame: the original 0.08->0.42 ramp put
            // so little on the mid slopes that any view from a crest had a bare
            // foreground. Crests still thin out; the shoulders now fill in.
            // The floor of 0.14 is deliberate. A pure ramp put literally
            // nothing on the high shoulders, and a portrait phone frame — which
            // is mostly near ground — landed on bare paint. Crests still thin
            // out hard and the survivors are dwarfed by `scale()`, but the
            // world is never empty.
            const treeLine = 0.14 + 0.86 * smoothstep(0.02, 0.26, d);
            // Groves and glades, not a carpet.
            const grove = 0.34 + 0.85 * patchMask(nx, ny, nz, 3.1, 0.38, 0.62);
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
        cap: 450,
        scatter: 2600,
        clusters: 36,
        perCluster: 24,
        clusterSpread: 0.048,
        sway: 0.45,
        sink: 0.9,
        tilt: 0.05,
        zone(d, w, nx, ny, nz) {
            // Pines climb higher than broadleaf — their tree line starts lower
            // in depth (i.e. nearer the crest) and thins less aggressively.
            const affinity = w[2] * 0.95 + w[0] * 0.42 + w[1] * 0.20;
            const treeLine = 0.12 + 0.88 * smoothstep(0.02, 0.30, d);
            const stand = 0.38 + 0.8 * patchMask(nx, ny, nz, 3.9, 0.40, 0.63);
            return affinity * treeLine * stand;
        },
        scale(d, w, rng) {
            const vigour = 0.62 + 0.55 * smoothstep(0.05, 0.55, d);
            return vigour * rngRange(rng, 0.78, 1.40);
        },
    },
    {
        name: 'spire',
        cap: 700,
        scatter: 11000,
        clusters: 24,
        perCluster: 11,
        clusterSpread: 0.040,
        sway: 0,
        sink: 2.2,
        tilt: 0.055,
        xVar: 0.30,
        yVar: 0.45,
        zone(d, w, nx, ny, nz) {
            // Squaring the canyon weight made this so selective that the layer
            // never reached its cap — canyon land covers ~44% of the planet but
            // was carrying a tenth of the meadow's prop count, so a canyon
            // low-shot read as bare paint. Softened to a mostly-linear
            // affinity, the depth ramp widened onto the mid-slopes, and the
            // between-cluster floor raised, so the badlands actually furnish.
            const affinity = w[1] * (0.55 + 0.45 * w[1]);
            return affinity * smoothstep(0.10, 0.55, d)
                * (0.40 + 0.75 * patchMask(nx, ny, nz, 4.6, 0.42, 0.66));
        },
        scale(d, w, rng) {
            return (0.66 + 0.44 * d) * rngRange(rng, 0.70, 1.15);
        },
    },
    {
        name: 'boulder',
        cap: 700,
        scatter: 7000,
        clusters: 30,
        perCluster: 12,
        clusterSpread: 0.05,
        sway: 0,
        sink: 0.5,
        tilt: 0.32,        // boulders sit at any angle
        xVar: 0.30,
        yVar: 0.30,
        zone(d, w) {
            // At 8 triangles a boulder is the cheapest coverage in the game,
            // and a bare canyon SLOPE was the worst frame the planet produced.
            // Weighted hard toward canyon and toward mid depths, which is
            // exactly where the spire clusters do not reach.
            const slope = 0.45 + 0.55 * (1 - Math.abs(d - 0.5) * 2);
            return (0.05 + w[1] * 1.25 + w[2] * 0.45) * slope;
        },
        scale(d, w, rng) {
            return rngRange(rng, 0.45, 1.15);
        },
    },
    {
        name: 'snowcap',
        // Alpine crest is only ~1.4% of the planet's directions, so this layer
        // needs an order of magnitude more candidates than the others just to
        // fill its cap. Candidates are free (build-time noise lookups); empty
        // sky where a snowfield should be is not.
        cap: 160,
        scatter: 9000,
        clusters: 40,
        perCluster: 12,
        clusterSpread: 0.045,
        sway: 0,
        sink: 0.8,
        tilt: 0.06,
        zone(d, w) {
            // Only the highest ground, and only where the land is alpine.
            return w[2] * w[2] * (1 - smoothstep(0.10, 0.52, d));
        },
        scale(d, w, rng) {
            return rngRange(rng, 0.7, 1.9);
        },
    },
    {
        name: 'shrub',
        cap: 330,
        scatter: 2200,
        clusters: 24,
        perCluster: 18,
        clusterSpread: 0.045,
        sway: 1.6,
        sink: 0.3,
        tilt: 0.14,
        zone(d, w, nx, ny, nz) {
            return (w[0] * 0.9 + w[1] * 0.35) * (0.22 + 0.78 * smoothstep(0.14, 0.62, d))
                * (0.42 + 0.8 * patchMask(nx, ny, nz, 5.4, 0.36, 0.60));
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
            // 26 tris: 3-sided open trunk (6) + icosahedral canopy (20).
            //
            // The canopy went octahedron -> icosahedron after a captured frame
            // showed the 8-triangle version reading as a sharp gem, which at a
            // glance was indistinguishable from the pines standing next to it.
            // Broadleaf has to be ROUND for the two layers to separate, and 20
            // triangles is the cheapest round thing there is. The extra 12
            // triangles per tree are paid for by dropping the layer from 1000
            // instances to 760 — a silhouette you can name beats 240 more
            // shapes you cannot.
            const trunk = new THREE.CylinderGeometry(0.24, 0.42, 2.2, 3, 1, true);
            trunk.translate(0, 1.1, 0);
            const canopy = new THREE.IcosahedronGeometry(1.85, 0);
            canopy.scale(1.12, 0.92, 1.12);
            squashUnderside(canopy, 0.72);
            canopy.translate(0, 3.15, 0);
            const geo = mergeParts(THREE, [
                { geo: trunk, color: new THREE.Color(PALETTE.trunk) },
                { geo: canopy, color: new THREE.Color(PALETTE.foliageMid) },
            ]);
            // Sun-side crown lighter than the underside of the mass.
            tintByHeight(THREE, geo, 2.3, 4.9,
                new THREE.Color(PALETTE.foliageDeep),
                new THREE.Color(PALETTE.foliageLit), 0.85);
            // ...but the trunk must stay wood, so repaint it back.
            paintBelow(THREE, geo, 2.25, new THREE.Color(PALETTE.trunk));
            return geo;
        }
        case 'pine': {
            // 11 tris: 3-sided trunk (6) + one 5-sided open cone (5). The
            // silhouette does all the work at this scale.
            const trunk = new THREE.CylinderGeometry(0.16, 0.28, 1.2, 3, 1, true);
            trunk.translate(0, 0.6, 0);
            const crown = new THREE.ConeGeometry(1.45, 5.4, 5, 1, true);
            crown.translate(0, 3.5, 0);
            const geo = mergeParts(THREE, [
                { geo: trunk, color: new THREE.Color(PALETTE.trunk) },
                { geo: crown, color: new THREE.Color(PALETTE.pineDeep) },
            ]);
            // Sunlit tip -> shadowed skirt down the length of the cone. A
            // single-colour pine at this size read as a black-green wedge.
            tintByHeight(THREE, geo, 1.3, 6.2,
                new THREE.Color(PALETTE.pineDeep),
                new THREE.Color(PALETTE.pineLit), 1.2);
            return geo;
        }
        case 'spire': {
            // 10 tris: one 5-sided tapered column. The previous version stacked
            // a wide cone on top of a narrow one and the captured frame showed
            // exactly what that is — a mushroom. A single taper reads as a
            // hoodoo, which is what a canyon wants, and it is the tallest thing
            // on the planet: terrain can only carve DOWN, so every bit of
            // verticality in this world has to come from a prop.
            const g = new THREE.CylinderGeometry(0.85, 2.6, 10.5, 5, 1, true);
            g.translate(0, 5.25, 0);
            const geo = mergeParts(THREE, [{ geo: g, color: new THREE.Color(PALETTE.canyonMid) }]);
            tintByHeight(THREE, geo, 0.5, 10.5,
                new THREE.Color(PALETTE.canyonDeep),
                new THREE.Color(PALETTE.canyonLit), 0.75);
            return geo;
        }
        case 'boulder': {
            // 8 tris. Two-tone by height: the upper faces catch the sky, the
            // lower ones keep the rock's own value, so it reads as a solid
            // instead of the flat grey paper cut-out a single-colour
            // octahedron turned out to be in the captured frame.
            const g = new THREE.OctahedronGeometry(1.25, 0);
            g.scale(1.3, 0.85, 1.0);
            squashUnderside(g, 0.5);
            g.translate(0, 0.6, 0);
            const geo = mergeParts(THREE, [{ geo: g, color: new THREE.Color(PALETTE.rock) }]);
            const cAttr = geo.getAttribute('color');
            const pAttr = geo.getAttribute('position');
            const top = new THREE.Color(PALETTE.rock).lerp(new THREE.Color(PALETTE.alpineLit), 0.22);
            const bot = new THREE.Color(PALETTE.rock).lerp(new THREE.Color(PALETTE.canyonDeep), 0.45);
            for (let i = 0; i < pAttr.count; i++) {
                const c = pAttr.getY(i) > 0.5 ? top : bot;
                cAttr.setXYZ(i, c.r, c.g, c.b);
            }
            cAttr.needsUpdate = true;
            return geo;
        }
        case 'snowcap': {
            // 8 tris. Wide and flat: a patch of snow lying on the crest, not a
            // white ball sitting on top of it.
            const g = new THREE.OctahedronGeometry(2.6, 0);
            g.scale(1.45, 0.34, 1.45);
            squashUnderside(g, 0.25);
            g.translate(0, 0.12, 0);
            return mergeParts(THREE, [{ geo: g, color: new THREE.Color(PALETTE.snow) }]);
        }
        case 'shrub':
        default: {
            // 8 tris. Near-field ground clutter — the layer that keeps the
            // first few metres in front of the bird from being bare paint.
            // Small, dark and low. Earlier passes made these bright
            // foliageLit gems the size of a boulder and a captured frame had
            // them reading as emeralds scattered over the canyon floor. Ground
            // clutter must sit UNDER the eye and never compete with the trees.
            const g = new THREE.OctahedronGeometry(0.66, 0);
            g.scale(1.35, 1.15, 1.35);
            squashUnderside(g, 0.35);
            g.translate(0, 0.34, 0);
            const geo = mergeParts(THREE, [{ geo: g, color: new THREE.Color(PALETTE.foliageMid) }]);
            tintByHeight(THREE, geo, 0.0, 1.1,
                new THREE.Color(PALETTE.foliageDeep),
                new THREE.Color(PALETTE.foliageMid), 0.9);
            return geo;
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
            const v = rngRange(rng, 0.78, 1.10);
            out.setRGB(v * rngRange(rng, 0.92, 1.06), v, v * 0.92);
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
    group.name = 'gauntlet-planet';

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
        [0.00, mixHex(THREE, PALETTE.meadowLit, PALETTE.alpineLit, 0.14)],
        [0.04, mixHex(THREE, PALETTE.meadowLit, PALETTE.meadowMid, 0.34)],
        [0.26, new THREE.Color(PALETTE.meadowMid)],
        [0.68, mixHex(THREE, PALETTE.meadowMid, PALETTE.meadowDeep, 0.62)],
        [1.00, new THREE.Color(PALETTE.meadowDeep)],
    ];
    const canyonRamp = [
        [0.00, mixHex(THREE, PALETTE.canyonLit, PALETTE.alpineLit, 0.16)],
        [0.16, new THREE.Color(PALETTE.canyonLit)],
        [0.50, new THREE.Color(PALETTE.canyonMid)],
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
        // Sedimentary banding, but only lightly. At a 0.55 weight the terraces
        // followed the depth contours so exactly that the whole canyon read as
        // a pixel-stepped stair pattern from orbit; at 0.28 they read as strata
        // in the cut faces and vanish on open ground, which is what rock does.
        const bands = 12;
        const strata = Math.floor(d * bands) / (bands - 1);
        const dCanyon = clamp01(d * 0.72 + strata * 0.28);

        sampleRamp(meadowRamp, d, cM);
        sampleRamp(canyonRamp, dCanyon, cC);
        sampleRamp(alpineRamp, d, cA);

        // Low-amplitude mottle so large flat lands don't read as vinyl. Kept
        // as COLOUR only — perturbing normals at this frequency is exactly the
        // band-noise trap the contract warns about.
        const m = fbm(nx * 7.3 + 4.1, ny * 7.3 + 9.6, nz * 7.3 + 2.2, 3);
        const mott = 0.93 + 0.15 * m;

        const o = i * 3;
        colors[o] = (cM.r * w3[0] + cC.r * w3[1] + cA.r * w3[2]) * mott;
        colors[o + 1] = (cM.g * w3[0] + cC.g * w3[1] + cA.g * w3[2]) * mott;
        colors[o + 2] = (cM.b * w3[0] + cC.b * w3[1] + cA.b * w3[2]) * mott;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // --- slope shading pass -------------------------------------------------
    // The single biggest legibility problem in the captured frames: a sphere
    // lit by one high key light puts almost every visible ground vertex in the
    // TOP band of the toon ramp, so a whole valley system rendered as one flat
    // wash of colour and the terrain read as painted-on rather than shaped.
    //
    // The fix has to be view-independent (it is baked once) and light-
    // independent (it must survive the terminator sweeping past). So: darken
    // and slightly desaturate by how far the surface normal has tilted away
    // from radial. Flat ground keeps its colour; valley walls and gully sides
    // get a grounded, richer version of it. It is free at runtime and it is
    // what makes the rolling terrain visible AS terrain.
    //
    // Must run AFTER computeVertexNormals — it reads the normals it shades by.
    const nrmAttr = geo.getAttribute('normal');
    const colAttr = geo.getAttribute('color');
    for (let i = 0; i < vcount; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const pinv = 1 / Math.hypot(px, py, pz);
        const dot = nrmAttr.getX(i) * px * pinv
            + nrmAttr.getY(i) * py * pinv
            + nrmAttr.getZ(i) * pz * pinv;
        // 0 on flat ground, 1 on a wall.
        const steep = clamp01((1 - dot) * 3.4);
        const shade = 1 - 0.40 * steep;
        const o = i * 3;
        colAttr.setXYZ(i, colors[o] * shade, colors[o + 1] * shade, colors[o + 2] * shade);
    }
    colAttr.needsUpdate = true;

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
    terrain.name = 'gauntlet-terrain';
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
        uGauntletTime: { value: 0 },
        uGauntletViewDir: { value: new THREE.Vector3(0, 1, 0) },
        uGauntletCull: { value: 0 },
        // cos(~62 deg): anything further round the planet than this is well
        // past the ~40-unit horizon at bird altitude.
        uGauntletCullDot: { value: 0.47 },
    };

    const layerMeshes = [];
    const layerCounts = {};
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

        // (a) CLUSTER POCKETS FIRST, against a reserved slice of the cap.
        //     Order matters and this was a real bug: with the scatter pass
        //     first, `scatter` (thousands of candidates) always exhausted the
        //     cap before a single cluster was placed, so the world had a
        //     perfectly even spread and not one grove in it. Groves are what
        //     make a view read as somewhere rather than as noise.
        const clusterCap = Math.round(cap * 0.55);
        const clusters = Math.max(3, Math.round(layer.clusters * tier.props));
        for (let c = 0; c < clusters && placed < clusterCap; c++) {
            fibonacciDirection(c, clusters, cDir, rng, 0.8);
            const cd = clamp01(depthAt(cDir.x, cDir.y, cDir.z));
            biomeWeights(cDir.x, cDir.y, cDir.z, bw);
            if (layer.zone(cd, bw, cDir.x, cDir.y, cDir.z) < 0.22) continue;
            // Tangent frame around the cluster centre.
            _n.set(cDir.x, cDir.y, cDir.z);
            _axis.set(0, 1, 0);
            if (Math.abs(_n.y) > 0.94) _axis.set(1, 0, 0);
            _p.copy(_axis).cross(_n).normalize();
            _axis.copy(_n).cross(_p).normalize();
            for (let k = 0; k < layer.perCluster && placed < clusterCap; k++) {
                // pow(rng, 0.55) pulls the population inward, so a grove has a
                // dense core and a ragged edge rather than a uniform disc.
                const rr = layer.clusterSpread * Math.pow(rng(), 0.55);
                const th = rng() * Math.PI * 2;
                const ct = Math.cos(th) * rr, st = Math.sin(th) * rr;
                const ox = _n.x + _p.x * ct + _axis.x * st;
                const oy = _n.y + _p.y * ct + _axis.y * st;
                const oz = _n.z + _p.z * ct + _axis.z * st;
                const linv = 1 / Math.hypot(ox, oy, oz);
                tryPlace(ox * linv, oy * linv, oz * linv, 1.8);
            }
        }

        // (b) GLOBAL EVEN SCATTER fills whatever is left. This is the layer
        //     that stops the world reading as empty: fibonacci points are
        //     maximally spread, so a view in any direction lands on some of
        //     them, and it costs nothing extra because it goes into the SAME
        //     instanced array as the groves above.
        for (let i = 0; i < scatterN && placed < cap; i++) {
            fibonacciDirection(i, scatterN, dir, rng, 0.55 / Math.cbrt(scatterN));
            tryPlace(dir.x, dir.y, dir.z, 1.0);
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
            // Props are small and numerous, so a strong rim turns every one of
            // them into a white-edged sticker — the captured frame had tree
            // undersides reading as snow. Just enough to lift them off the
            // ground behind, no more.
            rimStrength: 0.10,
            rimColor: PALETTE.skyGlow,
            rimThreshold: 0.68,
        });

        // Layer the sway/cull injection ON TOP of the toon patch rather than
        // replacing it — otherwise the props lose the rim and stop matching
        // everything else in the frame.
        const baseCompile = pmat.onBeforeCompile;
        const swayU = { value: layer.sway };
        pmat.onBeforeCompile = (shader) => {
            baseCompile(shader);
            Object.assign(shader.uniforms, propUniforms, { uGauntletSway: swayU });
            shader.vertexShader = PROP_VERT_HEAD + shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n' + PROP_VERT_BODY
            );
        };
        pmat.customProgramCacheKey = () => 'gauntlet-prop-v1';

        const mesh = new THREE.InstancedMesh(pgeo, pmat, count);
        mesh.name = 'gauntlet-prop-' + layer.name;
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

            // Horizontal/vertical scale decorrelation: same asset, different
            // plant. Spires carry a much wider range than the rest — a canyon
            // full of identically proportioned needles reads as a fence.
            const xv = layer.xVar || 0.13;
            const yv = layer.yVar || 0.18;
            _s.set(sc * rngRange(rng, 1 - xv, 1 + xv), sc * rngRange(rng, 1 - yv, 1 + yv), sc);
            _s.z = _s.x;

            _m.compose(_p, _q, _s);
            mesh.setMatrixAt(i, _m);
            mesh.setColorAt(i, tintFor(layer.name, rng, _tint));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        group.add(mesh);
        layerMeshes.push(mesh);
        layerCounts[layer.name] = count;
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
        propUniforms.uGauntletTime.value = _time;
        const l2 = birdDirX * birdDirX + birdDirY * birdDirY + birdDirZ * birdDirZ;
        if (l2 > 1e-6) {
            const inv = 1 / Math.sqrt(l2);
            propUniforms.uGauntletViewDir.value.set(birdDirX * inv, birdDirY * inv, birdDirZ * inv);
            propUniforms.uGauntletCull.value = 1;
        } else {
            propUniforms.uGauntletCull.value = 0;
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
        layerCounts,
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
