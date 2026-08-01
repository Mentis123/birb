/**
 * world/nests.js — champion-tree nests. The landing pads of Birb Gauntlet.
 *
 * Ported from Birb Mobile's `src/nesting/nest-points.js`. Re-implemented, not
 * imported: `gauntlet/` stays airtight against the parent game.
 *
 * WHAT CHANGED FROM THE ORIGINAL, AND WHY
 *
 *  1. The original nest was a `CylinderGeometry(1.2, 0.8, 0.4)` in
 *     `MeshBasicMaterial` with a torus halo and a glowing sphere core — a
 *     brown-orange disc with a lens flare on it. It read as a UI marker
 *     hovering over the scenery, not as a place a bird lives. Here a nest is a
 *     woven bowl with twigs breaking its rim, sitting in the crown of its own
 *     champion tree. Silhouette does the work, not emissive.
 *
 *  2. The original built one THREE.Group per nest — three meshes each, so 3N
 *     draw calls plus per-frame material writes on every one of them. Here the
 *     whole population is TWO InstancedMeshes: the nest+tree geometry, and an
 *     outline hull sharing the same instanceMatrix buffer. 2 draw calls, any N.
 *
 *  3. Placement. Birb Mobile handed nests a list of host objects from the
 *     environment builder and glued a marker to each. Birb Gauntlet's planet
 *     scatters its props independently, so nests place themselves —
 *     `fibonacciDirection` + seeded jitter, zoned by `depthAt` toward the lush
 *     lowlands — and carry their own champion tree so the bowl is always
 *     genuinely in a treetop rather than hovering above whatever the scatter
 *     happened to put there.
 *
 * THE FEEL CONSTANTS PORT VERBATIM. `NEST_PROXIMITY_RANGE` 7.0,
 * `NEST_GLOW_RANGE` 18.0 and `NEST_LAND_RANGE` 24.0 are Birb Mobile's numbers,
 * copied exactly. So is the reason `NEST_LAND_RANGE` is measured along the
 * GROUND rather than in 3D: nests sit high on emergent trees, and a 3D range
 * would force the player to climb to the canopy just to be offered the landing
 * prompt. See `nearestGround`.
 *
 * Outlined, unlike the terrain props: a nest is a hero object — the thing the
 * player aims at, lands on and defends — so it earns its ink.
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import { ensureSmoothNormals, createOutlineMaterial } from '../core/outline.js';
import { makeRng, rngRange, fibonacciDirection } from '../core/rng.js';
import { surfaceRadius, depthAt, biomeAt, BIOME } from '../core/terrain.js';

// ---------------------------------------------------------------------------
// Feel constants — VERBATIM from Birb Mobile's nest-points.js
// ---------------------------------------------------------------------------

/** 3D range at which the bird counts as "at" the nest. */
export const NEST_PROXIMITY_RANGE = 7.0;
/** 3D range at which a nest starts brightening. */
export const NEST_GLOW_RANGE = 18.0;
/** GROUND (great-circle) range at which the Land prompt appears. Not 3D. */
export const NEST_LAND_RANGE = 24.0;

// ---------------------------------------------------------------------------
// Shape constants
// ---------------------------------------------------------------------------

/**
 * How far above the rendered surface the bowl's floor sits. Birb Gauntlet's
 * broadleaf props top out around 5 units, so a champion at ~13 reads as
 * genuinely emergent — you can see the nest over the canopy from cruise
 * altitude, which is the whole point of a landing pad.
 */
const CANOPY_HEIGHT = 12.6;

/** Inner radius of the bowl. A bird is ~2.4 units long, so this fits one. */
const BOWL_RADIUS = 2.25;

/** Nest population per quality tier (the contract's ~40% / ~65% / 100%). */
const COUNTS = { low: 6, mid: 9, high: 12 };

/** How many fibonacci candidates to consider before settling. */
const CANDIDATES = 220;

/**
 * Minimum angular separation between two nests, as a dot product. 0.86 is
 * ~30.7 degrees — about 53 world units of ground apart at PLANET_RADIUS, which
 * is comfortably outside NEST_LAND_RANGE so the land prompt is never ambiguous
 * about which nest it means.
 */
const MIN_SEPARATION_DOT = 0.86;

function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Concatenate parts into one non-indexed geometry, baking each part's colour
 * into vertex colours. Build-time only, so it may allocate freely.
 *
 * Vertex colours (rather than one material per part) are what let a whole
 * nest — trunk, canopy, straw, twigs, shaded interior — ship as a single
 * InstancedMesh. `instanceColor` then multiplies over the top, so a per-nest
 * highlight is one buffer write rather than a material swap.
 */
function mergeParts(THREE, parts) {
    let total = 0;
    const prepared = [];
    for (let i = 0; i < parts.length; i++) {
        let g = parts[i].geo;
        if (g.index) g = g.toNonIndexed();
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        prepared.push({ g, color: parts[i].color, owned: g !== parts[i].geo });
        total += g.getAttribute('position').count;
    }

    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    const ranges = [];

    let o = 0;
    for (let i = 0; i < prepared.length; i++) {
        const g = prepared[i].g;
        const c = prepared[i].color;
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        ranges.push({ start: o, count: p.count });
        for (let v = 0; v < p.count; v++) {
            const w = (o + v) * 3;
            position[w] = p.getX(v); position[w + 1] = p.getY(v); position[w + 2] = p.getZ(v);
            normal[w] = n.getX(v); normal[w + 1] = n.getY(v); normal[w + 2] = n.getZ(v);
            color[w] = c.r; color[w + 1] = c.g; color[w + 2] = c.b;
        }
        o += p.count;
        if (prepared[i].owned) g.dispose();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.userData.ranges = ranges;
    return geo;
}

/**
 * Repaint one vertex range of a merged geometry with a height gradient, so a
 * single part can carry lit tops and deep undersides without extra triangles.
 */
function paintRangeByHeight(THREE, geo, range, y0, y1, low, high) {
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    const tmp = new THREE.Color();
    for (let i = range.start; i < range.start + range.count; i++) {
        const t = smoothstep(y0, y1, pos.getY(i));
        tmp.copy(low).lerp(high, t);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
}

/**
 * The woven bowl.
 *
 * The weave is not a texture — zero external assets, and a texture would blur
 * to mud at the distance a nest is usually seen from anyway. Instead the outer
 * wall's radius is rippled per radial segment and its vertex colour alternates
 * between two straw tones. Under a stepped toon ramp that alternation reads as
 * individual strands from close up and as a warm textured band from far away,
 * which is exactly the range a landing pad has to work across.
 */
function buildBowl(THREE) {
    const SEG = 12;
    const wall = new THREE.CylinderGeometry(
        BOWL_RADIUS, BOWL_RADIUS * 0.62, 1.30, SEG, 2, true
    );
    wall.translate(0, 0.42, 0);

    // Ripple the wall so the silhouette is lumpy rather than machined, and so
    // the flat-shaded facets catch the key light at slightly different angles.
    {
        const pos = wall.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const a = Math.atan2(z, x);
            const r = Math.hypot(x, z);
            const band = y > 0.6 ? 1 : (y > 0.2 ? 0 : 1);
            // Two-frequency ripple: the fast one is the weave, the slow one
            // stops the bowl reading as a perfect circle from above.
            const k = 1
                + Math.cos(a * SEG + band * Math.PI) * 0.045
                + Math.cos(a * 3 + 0.7) * 0.055;
            pos.setXYZ(i, Math.cos(a) * r * k, y, Math.sin(a) * r * k);
        }
        wall.computeVertexNormals();
    }

    // Interior floor, sunk below the rim so the bowl reads as a container.
    const floor = new THREE.CircleGeometry(BOWL_RADIUS * 0.80, SEG);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, 0.02, 0);

    return { wall, floor, SEG };
}

/**
 * Twigs poking out of the rim. This is the single most important part of the
 * model: it is what stops a nest reading as a brown disc. A disc has a smooth
 * closed silhouette, and at 40 units a smooth closed silhouette is a coin.
 * Eight sticks at varied angles give the outline something to snag on, so the
 * shape says "woven pile of sticks" before any surface detail resolves.
 */
function buildTwigs(THREE, rng) {
    const parts = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + rngRange(rng, -0.16, 0.16);
        const len = rngRange(rng, 1.5, 2.5);
        const twig = new THREE.CylinderGeometry(0.075, 0.115, len, 3, 1, true);
        // Lay the stick down (local +Y -> +X) then splay it out and up.
        twig.rotateZ(-Math.PI / 2);
        twig.translate(len * 0.5, 0, 0);
        twig.rotateZ(rngRange(rng, 0.12, 0.62));      // tilt up off the rim
        twig.rotateY(-a);
        const r = BOWL_RADIUS * 0.80;
        twig.translate(Math.cos(a) * r, rngRange(rng, 0.55, 0.95), Math.sin(a) * r);
        parts.push(twig);
    }
    return parts;
}

/** The champion tree the bowl sits in: tapered trunk plus two canopy masses. */
function buildTree(THREE, rng) {
    const trunk = new THREE.CylinderGeometry(0.95, 1.85, CANOPY_HEIGHT + 2.4, 6, 1, true);
    trunk.translate(0, -(CANOPY_HEIGHT + 2.4) * 0.5 - 0.35, 0);

    // Two masses rather than one: an offset pair breaks the "green ball on a
    // stick" read and gives the bowl something to nestle against.
    const big = new THREE.IcosahedronGeometry(3.9, 0);
    big.scale(1.14, 0.80, 1.14);
    big.rotateY(0.6);
    big.translate(0.35, -2.35, -0.25);

    const small = new THREE.IcosahedronGeometry(2.7, 0);
    small.scale(1.10, 0.78, 1.10);
    small.rotateY(-1.1);
    small.translate(-1.85, -3.55, 1.35);

    // Branch stubs cradling the bowl, so it is visibly SUPPORTED rather than
    // balanced on a point.
    const branches = [];
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const b = new THREE.CylinderGeometry(0.16, 0.30, 3.1, 3, 1, true);
        b.rotateZ(-Math.PI / 2);
        b.translate(1.55, 0, 0);
        b.rotateZ(rngRange(rng, 0.55, 0.85));
        b.rotateY(-a);
        b.translate(0, -0.85, 0);
        branches.push(b);
    }

    return { trunk, big, small, branches };
}

/**
 * Outline proxy: bowl wall + trunk only.
 *
 * The hull is a second draw of whatever geometry it is given, so outlining the
 * full model would double the whole triangle count for lines nobody can see —
 * the canopy's ink would land inside a mass of foliage and the twigs are
 * thinner than the line itself. Bowl and trunk are the two shapes that define
 * the silhouette against sky and terrain, so they are the two that get ink.
 */
function buildOutlineProxy(THREE, wall) {
    const proxyWall = wall.clone();
    const trunk = new THREE.CylinderGeometry(0.95, 1.85, CANOPY_HEIGHT + 2.4, 6, 1, true);
    trunk.translate(0, -(CANOPY_HEIGHT + 2.4) * 0.5 - 0.35, 0);
    const parts = [
        { geo: proxyWall, color: { r: 1, g: 1, b: 1 } },
        { geo: trunk, color: { r: 1, g: 1, b: 1 } },
    ];
    const geo = mergeParts(THREE, parts);
    proxyWall.dispose();
    trunk.dispose();
    return geo;
}

/** Build the one merged nest geometry shared by every instance. */
function buildNestGeometry(THREE, rng) {
    const { wall, floor } = buildBowl(THREE);
    const twigs = buildTwigs(THREE, rng);
    const tree = buildTree(THREE, rng);

    const cTrunk = new THREE.Color(PALETTE.trunk);
    const cStraw = new THREE.Color(PALETTE.canyonLit);
    const cStrawDeep = new THREE.Color(PALETTE.canyonMid);
    const cShade = new THREE.Color(PALETTE.canyonDeep);
    const cFoliage = new THREE.Color(PALETTE.foliageMid);
    const cFoliageDeep = new THREE.Color(PALETTE.foliageDeep);
    const cFoliageLit = new THREE.Color(PALETTE.foliageLit);

    const parts = [
        { geo: tree.trunk, color: cTrunk },      // 0
        { geo: tree.big, color: cFoliage },      // 1
        { geo: tree.small, color: cFoliage },    // 2
    ];
    for (let i = 0; i < tree.branches.length; i++) {
        parts.push({ geo: tree.branches[i], color: cTrunk });
    }
    const wallIndex = parts.length;
    parts.push({ geo: wall, color: cStraw });
    parts.push({ geo: floor, color: cShade });
    for (let i = 0; i < twigs.length; i++) {
        parts.push({ geo: twigs[i], color: i % 2 ? cStrawDeep : cStraw });
    }

    const geo = mergeParts(THREE, parts);
    const ranges = geo.userData.ranges;

    // Canopy: lit tops, deep undersides.
    paintRangeByHeight(THREE, geo, ranges[1], -5.4, -0.4, cFoliageDeep, cFoliageLit);
    paintRangeByHeight(THREE, geo, ranges[2], -6.2, -1.6, cFoliageDeep, cFoliage);
    // Trunk: darken toward the roots so it does not read as a flat pole.
    paintRangeByHeight(THREE, geo, ranges[0], -(CANOPY_HEIGHT + 2), -2.0,
        cShade, cTrunk);

    // Bowl wall: alternate the straw tone per weave column. mergeParts painted
    // it one flat colour; this is what makes it read as woven strands rather
    // than a moulded pot.
    {
        const pos = geo.getAttribute('position');
        const col = geo.getAttribute('color');
        const r = ranges[wallIndex];
        for (let i = r.start; i < r.start + r.count; i++) {
            const a = Math.atan2(pos.getZ(i), pos.getX(i));
            const strand = Math.cos(a * 12) > 0 ? 1 : 0;
            const c = strand ? cStraw : cStrawDeep;
            col.setXYZ(i, c.r, c.g, c.b);
        }
        col.needsUpdate = true;
    }

    wall.dispose();
    floor.dispose();
    tree.trunk.dispose();
    tree.big.dispose();
    tree.small.dispose();
    for (let i = 0; i < tree.branches.length; i++) tree.branches[i].dispose();
    for (let i = 0; i < twigs.length; i++) twigs[i].dispose();

    return geo;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * How much this direction wants a nest. Nests are homes, so they favour the
 * lush lowlands — high `depthAt` means carved well below the baseline, which is
 * exactly where the planet's tree line puts its tallest, densest broadleaf.
 * Meadow strongly preferred, canyon rims tolerated, bare alpine crest almost
 * never (a champion broadleaf above the tree line would be a lie).
 */
function nestAffinity(nx, ny, nz) {
    const d = depthAt(nx, ny, nz);
    const lowland = 0.08 + 0.92 * smoothstep(0.10, 0.58, d);
    const biome = biomeAt(nx, ny, nz);
    const biomeWeight = biome === BIOME.MEADOW ? 1.0
        : (biome === BIOME.CANYON ? 0.45 : 0.14);
    return lowland * biomeWeight;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} opts
 * @param {'low'|'mid'|'high'} [opts.quality]
 * @param {number} [opts.seed]
 * @param {number} [opts.count]   override the tier count (probes/tests)
 * @param {object} [opts.planet]  reserved: lets a future pass ask the planet to
 *                                suppress its own props under a champion tree.
 */
export function createNests(THREE, opts = {}) {
    const quality = opts.quality || 'high';
    const seed = opts.seed ?? 90210;
    const count = Math.max(1, opts.count ?? (COUNTS[quality] ?? COUNTS.high));

    const rng = makeRng(seed);

    // --- placement -------------------------------------------------------
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const _dir = new THREE.Vector3();

    let placed = 0;
    // Two passes. The first is picky about ground; the second takes anything
    // that clears the separation test, so `count` is always met even on a seed
    // whose lowlands happen to fall where the fibonacci lattice is thin.
    for (let pass = 0; pass < 2 && placed < count; pass++) {
        for (let i = 0; i < CANDIDATES && placed < count; i++) {
            fibonacciDirection(i, CANDIDATES, _dir, rng, 0.30);
            const nx = _dir.x, ny = _dir.y, nz = _dir.z;

            if (pass === 0) {
                if (rng() > nestAffinity(nx, ny, nz)) continue;
            } else if (nestAffinity(nx, ny, nz) < 0.05) {
                continue;
            }

            let tooClose = false;
            for (let j = 0; j < placed; j++) {
                const d = nx * normals[j * 3] + ny * normals[j * 3 + 1] + nz * normals[j * 3 + 2];
                if (d > MIN_SEPARATION_DOT) { tooClose = true; break; }
            }
            if (tooClose) continue;

            const r = surfaceRadius(nx, ny, nz) + CANOPY_HEIGHT;
            positions[placed * 3] = nx * r;
            positions[placed * 3 + 1] = ny * r;
            positions[placed * 3 + 2] = nz * r;
            normals[placed * 3] = nx;
            normals[placed * 3 + 1] = ny;
            normals[placed * 3 + 2] = nz;
            placed++;
        }
    }
    const actualCount = placed;

    // --- geometry + materials --------------------------------------------
    const geometry = buildNestGeometry(THREE, rng);
    const proxySrc = buildBowl(THREE);           // fresh copy for the proxy
    const outlineGeometry = buildOutlineProxy(THREE, proxySrc.wall);
    proxySrc.wall.dispose();
    proxySrc.floor.dispose();
    ensureSmoothNormals(THREE, outlineGeometry);

    const material = createToonMaterial(THREE, {
        ramp: 'hero',
        vertexColors: true,
        flatShading: true,
        // DoubleSide, deliberately. Every part here is an open shell (tapered
        // tubes for trunk, branches and twigs; a rimless bowl wall) because
        // caps are triangles nobody sees from outside. But you DO look into the
        // bowl when you land in it, and a single-sided bowl shows you the ink
        // hull's far wall through the opening — a black hole where the straw
        // should be. Two-sided costs no draw calls and no triangles, only fill.
        side: THREE.DoubleSide,
        // A nest is warm straw against green canopy; the default rim would put
        // a cold halo on every twig. Warm and restrained instead.
        rimColor: PALETTE.uiCream,
        rimStrength: 0.34,
        specStrength: 0.18,
        specPower: 26,
    });

    const outlineMaterial = createOutlineMaterial(THREE, {
        color: PALETTE.ink,
        pixels: 2.2,
        maxPush: 0.55,
    });

    const group = new THREE.Group();
    group.name = 'nests';

    const mesh = new THREE.InstancedMesh(geometry, material, actualCount);
    mesh.name = 'nests-body';
    mesh.frustumCulled = false;   // instances are spread over the whole planet
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(actualCount * 3), 3
    );
    group.add(mesh);

    // The hull is a second InstancedMesh sharing the SAME instanceMatrix
    // buffer, so a nest and its ink can never drift apart and the CPU only ever
    // writes one transform.
    const hull = new THREE.InstancedMesh(outlineGeometry, outlineMaterial, actualCount);
    hull.name = 'nests-outline';
    hull.instanceMatrix = mesh.instanceMatrix;
    hull.frustumCulled = false;
    hull.renderOrder = -1;
    hull.raycast = () => {};
    hull.userData.isOutline = true;
    group.add(hull);

    // --- per-instance transforms -----------------------------------------
    const _mat = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scl = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);
    const _axis = new THREE.Vector3();
    const _spin = new THREE.Quaternion();
    const _color = new THREE.Color();

    const baseScale = new Float32Array(actualCount);
    const baseQuat = new Float32Array(actualCount * 4);

    const cIdle = new THREE.Color(0xffffff);
    const cActive = new THREE.Color(PALETTE.uiGold);

    for (let i = 0; i < actualCount; i++) {
        _axis.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
        _quat.setFromUnitVectors(_up, _axis);
        // Random yaw about the radial axis so twelve copies of one mesh do not
        // read as twelve copies of one mesh.
        _spin.setFromAxisAngle(_axis, rngRange(rng, 0, Math.PI * 2));
        _quat.premultiply(_spin);
        const s = rngRange(rng, 0.92, 1.12);
        baseScale[i] = s;
        baseQuat[i * 4] = _quat.x; baseQuat[i * 4 + 1] = _quat.y;
        baseQuat[i * 4 + 2] = _quat.z; baseQuat[i * 4 + 3] = _quat.w;

        _pos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        _scl.setScalar(s);
        _mat.compose(_pos, _quat, _scl);
        mesh.setMatrixAt(i, _mat);
        mesh.instanceColor.setXYZ(i, 1, 1, 1);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    const triPerNest = geometry.getAttribute('position').count / 3;
    const triPerHull = outlineGeometry.getAttribute('position').count / 3;

    let activeIndex = -1;
    let time = 0;

    const api = {
        group,
        mesh,
        count: actualCount,
        positions,
        normals,
        canopyHeight: CANOPY_HEIGHT,
        bowlRadius: BOWL_RADIUS,
        drawCallCount: 2,
        triangleCount: (triPerNest + triPerHull) * actualCount,
        get activeIndex() { return activeIndex; },

        /**
         * Nearest nest within `maxDist` (3D), or -1. Zero allocation, squared
         * distance, no sqrt.
         */
        nearest(x, y, z, maxDist = NEST_LAND_RANGE) {
            const maxSq = maxDist * maxDist;
            let best = -1;
            let bestSq = maxSq;
            for (let i = 0; i < actualCount; i++) {
                const dx = x - positions[i * 3];
                const dy = y - positions[i * 3 + 1];
                const dz = z - positions[i * 3 + 2];
                const sq = dx * dx + dy * dy + dz * dz;
                if (sq < bestSq) { bestSq = sq; best = i; }
            }
            return best;
        },

        /**
         * Nearest nest by GROUND distance — the great-circle arc between the
         * two radial directions, ignoring altitude entirely.
         *
         * This is Birb Mobile's land-prompt test, ported for its reason and not
         * just its number: a nest sits ~13 units up a champion tree, so a 3D
         * range forces the player to climb to the canopy before the game will
         * even offer to land. With ground distance you fly past the trunk at
         * any altitude, tap Land, and the approach flies you up.
         *
         * Zero allocation. One acos per candidate — `count` is a dozen, and
         * this runs once a frame at most.
         */
        nearestGround(x, y, z, maxDist = NEST_LAND_RANGE, sphereRadius = 100) {
            const bl = Math.hypot(x, y, z) || 1;
            let best = -1;
            let bestArc = maxDist;
            for (let i = 0; i < actualCount; i++) {
                let c = (x * normals[i * 3] + y * normals[i * 3 + 1] + z * normals[i * 3 + 2]) / bl;
                c = c < -1 ? -1 : (c > 1 ? 1 : c);
                const arc = sphereRadius * Math.acos(c);
                if (arc < bestArc) { bestArc = arc; best = i; }
            }
            return best;
        },

        positionOf(i, out) {
            if (i < 0 || i >= actualCount) return out;
            return out.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        },

        normalOf(i, out) {
            if (i < 0 || i >= actualCount) return out;
            return out.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
        },

        /**
         * Highlight the nest being defended (or approached). Writes one
         * instance colour; the pulse itself happens in update().
         */
        setActive(i) {
            const next = (i >= 0 && i < actualCount) ? i : -1;
            if (next === activeIndex) return;
            if (activeIndex >= 0) {
                mesh.instanceColor.setXYZ(activeIndex, 1, 1, 1);
                // Restore the resting transform of the nest we are leaving.
                writeMatrix(activeIndex, 1);
            }
            activeIndex = next;
            mesh.instanceColor.needsUpdate = true;
            mesh.instanceMatrix.needsUpdate = true;
        },

        /**
         * Zero allocation. Only the active nest is touched — an idle
         * population costs one branch per frame.
         */
        update(dt) {
            if (!(dt > 0)) dt = 0;
            time += dt;
            if (activeIndex < 0) return;
            const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
            // 1 -> ~1.55 toward gold: the bowl glows warmer without the
            // MeshBasic lens-flare look the original leaned on.
            _color.copy(cIdle).lerp(cActive, 0.35 + 0.35 * pulse)
                .multiplyScalar(1.18 + 0.30 * pulse);
            mesh.instanceColor.setXYZ(activeIndex, _color.r, _color.g, _color.b);
            mesh.instanceColor.needsUpdate = true;
            writeMatrix(activeIndex, 1 + 0.022 * pulse);
            mesh.instanceMatrix.needsUpdate = true;
        },

        dispose() {
            group.removeFromParent();
            geometry.dispose();
            outlineGeometry.dispose();
            material.dispose();
            outlineMaterial.dispose();
            mesh.dispose();
            // hull shares mesh.instanceMatrix; disposing it again is safe.
            hull.dispose();
            api.update = () => {};
            api.setActive = () => {};
        },
    };

    function writeMatrix(i, scaleMul) {
        _pos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        _quat.set(baseQuat[i * 4], baseQuat[i * 4 + 1], baseQuat[i * 4 + 2], baseQuat[i * 4 + 3]);
        _scl.setScalar(baseScale[i] * scaleMul);
        _mat.compose(_pos, _quat, _scl);
        mesh.setMatrixAt(i, _mat);
    }

    return api;
}
