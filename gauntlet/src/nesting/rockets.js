/**
 * rockets.js — Birb Gauntlet's turret projectile + explosion system.
 *
 * Port of Birb Mobile's `src/nesting/rocket.js`, re-implemented (gauntlet/ stays
 * airtight against the parent `src/`) with one structural improvement and one
 * art-direction rewrite.
 *
 * ============================================================================
 * WHAT PORTS VERBATIM — the feel constants
 * ============================================================================
 * These were tuned over weeks against real hands. They are copied, not
 * re-derived:
 *
 *   ROCKET_SPEED         50.0   u/s muzzle velocity
 *   ROCKET_GRAVITY        8.0   u/s^2, pulled RADIALLY toward the planet centre
 *   ROCKET_LIFETIME       8.0   s
 *   ROCKET_COOLDOWN       2.0   s
 *   MUZZLE_CLEAR_RADIUS  28.0   u — straight-line corridor in which SCENERY
 *                                (terrain) hits are ignored, so a shot fired out
 *                                of a nest punches clear of its own tree-top
 *                                instead of detonating on the canopy in front of
 *                                it. Drones are hit by a SEPARATE proximity
 *                                check, so this never stops a kill.
 *   ORIENT_SLERP         10.0   /s — how fast the model swings onto its velocity
 *   EXHAUST_FLICKER_HZ   20.0   rad/s — the original's sin(t*20) engine pulse
 *   EXPLOSION_LIFETIME    0.6   s — the shard life, from the original's fireball
 *   EXPLOSION_GROWTH      1.6   — the original's `scale = 1 + progress * 1.6`,
 *                                kept as the FLASH's total expansion (now taken
 *                                in hard steps instead of a smooth ramp)
 *
 * The one constant that is NOT ported is the mesh's size. Birb Mobile's rocket
 * was ~0.6u long on a radius-120 world; Birb Gauntlet's planet is radius 100 and
 * a drone's collision radius alone is 9.9, so a 0.6u rocket would be a
 * sub-pixel dot. Geometry scale is art, not feel — it is authored here.
 *
 * ============================================================================
 * THE STRUCTURAL IMPROVEMENT — two draw calls, total
 * ============================================================================
 * The original allocated a fresh `Group` (4 meshes + 4 materials), a `Points`
 * trail with its own BufferGeometry, and a fresh sphere Mesh + material for
 * every explosion — created and disposed at runtime, one draw call each, three
 * separate pools for shards / sparks / embers. Firing during a wave was a
 * reliable GC spike.
 *
 * Here there are exactly two InstancedMeshes for the entire system:
 *
 *   1. ROCKETS      — fixed capacity, ring-buffer slots.
 *   2. PARTICLES    — fixed capacity, ring-buffer slots, ONE buffer carrying
 *                     five KINDS (flash, shard, spark, ember, trail). A kind is
 *                     a per-particle byte that selects a scale profile, a colour,
 *                     a fade ramp and a motion model. One angular chunk geometry
 *                     stretched by a per-kind non-uniform scale is what lets a
 *                     sliver of spark and a fat tumbling ember come out of the
 *                     same vertex buffer.
 *
 * The rocket's exhaust trail is a particle KIND rather than a separate `Points`
 * object, which is how the trail survives the 2-draw-call budget at all.
 *
 * ============================================================================
 * THE EXPLOSION MUST READ AS CEL, NOT AS SMOKE
 * ============================================================================
 * No additive blending, no soft alpha haze, no billboard puffs — all three are
 * how a realistic engine draws fire, and all three dissolve a stylised frame
 * into grey mush. Instead:
 *
 *   - every particle is an OPAQUE, flat-shaded, hard-edged angular chunk that
 *     depth-writes (so no transparency sorting cost either);
 *   - the fade is QUANTISED into four hard steps of scale and tone — the exact
 *     rule `fx/feathers.js` follows, and the ember kind reuses its scale ramp
 *     [1.0, 0.80, 0.52, 0.24] verbatim so the two systems die the same way;
 *   - the flash steps UP in scale (the original's 1.6x growth, taken in four
 *     hard jumps) while its tone steps DOWN — cream, gold, orange, then a hard
 *     cut. Cooling in bands, not fading into haze.
 *
 * ============================================================================
 * NO OUTLINES — deliberate
 * ============================================================================
 * An inverted hull on either mesh is a third and fourth draw call, and the brief
 * is two. The silhouette is carried instead by flat shading, a hard baked
 * two-tone in the vertex colours, and a strong quantised rim. See the report.
 *
 * ZERO ALLOCATION in fire()/update(): all state lives in pre-sized typed arrays
 * and the only objects touched per frame are the `_` scratch in the factory.
 * Up is RADIAL (normalize(position)) — gravity pulls toward the planet centre,
 * never toward world -Y. On a sphere a world-Y pull makes shots veer sideways
 * depending where on the planet you are standing.
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import { makeRng } from '../core/rng.js';
import { PLANET_RADIUS, surfaceRadius } from '../core/terrain.js';

// --- ported feel constants ---------------------------------------------------
export const ROCKET_SPEED = 50.0;
export const ROCKET_GRAVITY = 8.0;
export const ROCKET_LIFETIME = 8.0;
export const ROCKET_COOLDOWN = 2.0;
export const MUZZLE_CLEAR_RADIUS = 28.0;
const ORIENT_SLERP = 10.0;
const EXHAUST_FLICKER_HZ = 20.0;
const EXPLOSION_LIFETIME = 0.6;
const EXPLOSION_GROWTH = 1.6;

/** Rocket's own collision radius, added to a target's. Art-scale, not ported. */
const ROCKET_RADIUS = 1.2;

/** How far below the rendered surface counts as a ground hit. */
const GROUND_EPS = 0.35;

// --- particle kinds ----------------------------------------------------------
const K_FLASH = 0;
const K_SHARD = 1;
const K_SPARK = 2;
const K_EMBER = 3;
const K_TRAIL = 4;
const KIND_COUNT = 5;

/**
 * Per-kind scale profile applied to the shared chunk geometry. This is the
 * whole trick that gets five particle types out of one vertex buffer: a chunk
 * squashed to (0.26, 0.26, 3.6) is a spark streak, the same chunk at
 * (0.82, 0.82, 1.9) is a tumbling shard.
 * Local +Z is the alignment axis for the kinds that align to velocity.
 */
const KIND_SX = [1.00, 0.82, 0.26, 0.78, 0.62];
const KIND_SY = [1.00, 0.66, 0.26, 0.78, 0.62];
const KIND_SZ = [1.00, 1.90, 3.60, 0.86, 0.78];

/** Base size range per kind, in world units. */
const KIND_SIZE_MIN = [3.1, 0.85, 0.62, 0.55, 0.42];
const KIND_SIZE_MAX = [4.4, 1.55, 1.05, 0.95, 0.80];

/** Base colour per kind. Palette-only; see the report on the missing fire ramp. */
const KIND_COLOR = [
    PALETTE.sunCore,      // FLASH — near-white cream
    PALETTE.birdRival1,   // SHARD — hot orange
    PALETTE.uiGold,       // SPARK — bright gold
    PALETTE.sunHalo,      // EMBER — deep gold
    PALETTE.impactPuff,   // TRAIL — pale warm smoke
];

/** Seconds of life per kind. SHARD carries the original's 0.6s fireball. */
const KIND_LIFE = [0.20, EXPLOSION_LIFETIME, 0.34, 0.95, 0.40];

/** True if the kind aligns its long axis to its velocity (vs. tumbling). */
const KIND_ALIGNED = [0, 1, 1, 0, 0];

/** Launch speed range per kind, before the `power` multiplier. */
const KIND_SPEED_MIN = [0.0, 11.0, 26.0, 5.0, 0.0];
const KIND_SPEED_MAX = [0.0, 22.0, 44.0, 13.0, 1.4];

/** Linear drag per kind. Sparks brake hard so they read as short streaks. */
const KIND_DRAG = [0.0, 1.5, 5.2, 0.9, 2.6];

/** Radial sink per kind (u/s^2 toward the planet centre). */
const KIND_SINK = [0.0, 7.5, 2.0, 11.0, -1.6];   // trail rises slightly

/**
 * The quantised death ramps — four hard steps, then gone. Index 0 is freshest.
 *
 * EMBER's scale ramp is `fx/feathers.js`'s FADE_SCALE verbatim: both systems
 * shed debris into the same world, and two different dissolve rules read as two
 * different games.
 *
 * FLASH inverts the rule on purpose: it steps UP through the original's 1.6x
 * growth while its tone steps down, so it blooms and cools rather than shrinks.
 */
const KIND_FADE_SCALE = [
    [0.62, 1.00, 1.00 + EXPLOSION_GROWTH * 0.55, 1.00 + EXPLOSION_GROWTH * 0.90],
    [1.00, 0.86, 0.60, 0.30],
    [1.00, 0.78, 0.46, 0.20],
    [1.00, 0.80, 0.52, 0.24],
    [1.00, 0.80, 0.52, 0.24],
];
const KIND_FADE_TONE = [
    [1.32, 1.12, 0.84, 0.52],
    [1.24, 1.00, 0.72, 0.44],
    [1.38, 1.14, 0.78, 0.40],
    [1.12, 0.88, 0.60, 0.32],
    [1.00, 0.80, 0.56, 0.30],
];
const FADE_STEPS = 4;

/** Per-tier budgets and burst composition. */
const TIERS = {
    low: { rockets: 8, particles: 150, trailStride: 3, burst: [3, 6, 5, 4] },
    mid: { rockets: 10, particles: 300, trailStride: 2, burst: [4, 10, 8, 6] },
    high: { rockets: 12, particles: 470, trailStride: 1, burst: [6, 14, 12, 8] },
};

// ---------------------------------------------------------------------------
// Build-time geometry. Allocation here is free — none of it runs in the loop.
// ---------------------------------------------------------------------------

/**
 * Concatenate a list of positioned primitives into one non-indexed geometry
 * carrying baked vertex colours.
 *
 * Non-indexed because everything here is flat-shaded: sharing vertices across
 * faces would only matter for smooth normals, and hard facets are the look.
 *
 * @param {object} THREE
 * @param {Array<{geo, matrix, color, shade}>} parts
 *        `shade` optionally returns a per-vertex multiplier from local (x,y,z),
 *        used to bake a hot gradient toward the rocket's tail.
 */
function mergeParts(THREE, parts) {
    const prepped = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
        if (p.matrix) g.applyMatrix4(p.matrix);
        g.computeVertexNormals();
        prepped.push(p.shade ? { g, c: p.color, shade: p.shade } : { g, c: p.color, shade: null });
        total += g.getAttribute('position').count;
        p.geo.dispose();
    }

    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const col = new THREE.Color();

    let o = 0;
    for (let k = 0; k < prepped.length; k++) {
        const { g, c, shade } = prepped[k];
        const gp = g.getAttribute('position');
        const gn = g.getAttribute('normal');
        col.setHex(c);
        for (let i = 0; i < gp.count; i++) {
            const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
            const d = (o + i) * 3;
            positions[d] = x; positions[d + 1] = y; positions[d + 2] = z;
            normals[d] = gn.getX(i); normals[d + 1] = gn.getY(i); normals[d + 2] = gn.getZ(i);
            const m = shade ? shade(x, y, z) : 1;
            colors[d] = col.r * m; colors[d + 1] = col.g * m; colors[d + 2] = col.b * m;
        }
        o += gp.count;
        g.dispose();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
}

/**
 * The rocket. Nose at -Z (house convention: forward is -Z), flame at +Z.
 *
 * Ten radial segments and flat shading, because a smooth-shaded cylinder under
 * a stepped ramp gets one wide band with a mushy terminator, whereas ten hard
 * facets give ten flat tones that read as drawn metal.
 *
 * Fins are ink-dark: at speed the body blurs into the sky and the fins are the
 * only thing that still says "which way is this pointing".
 */
function buildRocketGeometry(THREE) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const e = new THREE.Euler();
    const parts = [];

    // --- nose cone: apex at z = -2.10, base at z = -1.00 ---------------------
    e.set(-Math.PI / 2, 0, 0);
    q.setFromEuler(e);
    v.set(0, 0, -1.55);
    m.compose(v, q, s);
    parts.push({ geo: new THREE.ConeGeometry(0.42, 1.10, 10), matrix: m.clone(), color: PALETTE.uiGold });

    // --- body: z from -1.00 to +1.10, flaring slightly toward the tail -------
    v.set(0, 0, 0.05);
    m.compose(v, q, s);
    parts.push({
        geo: new THREE.CylinderGeometry(0.42, 0.47, 2.10, 10, 1, true),
        matrix: m.clone(),
        color: PALETTE.birdRival1,
        // Bake a hot gradient toward the tail so the body reads as being
        // driven from behind even in the frame where the flame is occluded.
        shade: (x, y, z) => 0.88 + 0.30 * Math.max(0, Math.min(1, (z + 1.0) / 2.1)),
    });

    // --- three ink fins at the tail -----------------------------------------
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        e.set(0, 0, a);
        q.setFromEuler(e);
        v.set(Math.cos(a + Math.PI / 2) * 0.72, Math.sin(a + Math.PI / 2) * 0.72, 0.66);
        m.compose(v, q, s);
        parts.push({ geo: new THREE.BoxGeometry(0.10, 0.62, 0.92), matrix: m.clone(), color: PALETTE.inkSoft });
    }

    // --- flame: base at z = +1.10, apex at z = +2.60 -------------------------
    e.set(Math.PI / 2, 0, 0);
    q.setFromEuler(e);
    v.set(0, 0, 1.85);
    m.compose(v, q, s);
    parts.push({
        geo: new THREE.ConeGeometry(0.54, 1.50, 8),
        matrix: m.clone(),
        color: PALETTE.sunCore,
        // Hard two-tone down the flame: white at the throat, gold at the tip.
        // A smooth gradient here is exactly the soft haze the brief rules out.
        shade: (x, y, z) => (z > 1.85 ? 0.68 : 1.18),
    });

    const geo = mergeParts(THREE, parts);
    // Authored: instance matrices scatter this all over the planet and the mesh
    // is frustum-culled off anyway.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
    return geo;
}

/**
 * The particle chunk: an octahedron with seeded per-axis jitter, flat-shaded.
 *
 * Irregular on purpose. A clean octahedron repeated forty times reads as forty
 * copies of one crystal; jittering the six poles (consistently, so the shared
 * faces still meet) turns it into a chip of debris. The jitter is seeded so the
 * screenshot harness captures the same chip twice.
 *
 * A hard two-tone is baked along local Y so each chunk has a lit face and a
 * shadow face regardless of how it tumbles — that internal step is what stops a
 * fast-moving particle reading as a flat sticker.
 */
function buildChunkGeometry(THREE) {
    const src = new THREE.OctahedronGeometry(1, 0);
    const g = src.index ? src.toNonIndexed() : src;
    const pos = g.getAttribute('position');
    const rng = makeRng(0x0c7a);

    // The six poles, jittered once each, then matched by sign so every face
    // that shares a pole gets the same displaced position (no torn chunks).
    const POLES = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    const JIT = [];
    for (let i = 0; i < POLES.length; i++) {
        JIT.push([
            POLES[i][0] * (0.62 + rng() * 0.78) + (rng() - 0.5) * 0.42,
            POLES[i][1] * (0.62 + rng() * 0.78) + (rng() - 0.5) * 0.42,
            POLES[i][2] * (0.62 + rng() * 0.78) + (rng() - 0.5) * 0.42,
        ]);
    }

    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        // Which pole is this vertex? Octahedron verts ARE the poles.
        let best = 0, bestD = Infinity;
        for (let p = 0; p < POLES.length; p++) {
            const dx = x - POLES[p][0], dy = y - POLES[p][1], dz = z - POLES[p][2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = p; }
        }
        pos.setXYZ(i, JIT[best][0], JIT[best][1], JIT[best][2]);
        // 1.9:1 two-tone. Deliberately loud — at 12px across, a subtle split is
        // no split at all.
        const tone = JIT[best][1] > 0 ? 1.22 : 0.64;
        colors[i * 3] = tone; colors[i * 3 + 1] = tone; colors[i * 3 + 2] = tone;
    }
    pos.needsUpdate = true;
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
    if (g !== src) src.dispose();
    return g;
}

// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} [opts]
 * @param {'low'|'mid'|'high'} [opts.quality]
 * @param {number} [opts.capacity]          rocket slots (overrides the tier)
 * @param {number} [opts.particleCapacity]  particle slots (overrides the tier)
 * @param {number} [opts.seed]
 * @param {Function} [opts.onHit]           (x, y, z, targetIndex) on any detonation
 * @param {Function} [opts.onFire]          (x, y, z) when a rocket leaves the tube
 */
export function createRockets(THREE, opts = {}) {
    const quality = opts.quality || 'high';
    const tier = TIERS[quality] || TIERS.high;
    const capacity = Math.max(2, opts.capacity || tier.rockets);
    const pCapacity = Math.max(16, opts.particleCapacity || tier.particles);
    const trailStride = opts.trailStride || tier.trailStride;
    const burst = tier.burst;
    const rng = makeRng(opts.seed || 0x0cce7);

    const group = new THREE.Group();
    group.name = 'gauntlet-rockets';

    // --- rocket mesh -----------------------------------------------------
    const rocketGeo = buildRocketGeometry(THREE);
    // 'graphic' is the two-band ramp: maximum step contrast, which is what a
    // small fast object needs to stay legible against both sky and terrain.
    const rocketMat = createToonMaterial(THREE, {
        ramp: 'graphic',
        vertexColors: true,
        flatShading: true,
        rimColor: PALETTE.uiGold,
        rimStrength: 0.62,
        rimPower: 1.9,
        rimThreshold: 0.50,
        rimSoftness: 0.05,
        specColor: PALETTE.sunCore,
        specStrength: 0.55,
        specPower: 36,
        specThreshold: 0.52,
    });
    const rocketMesh = new THREE.InstancedMesh(rocketGeo, rocketMat, capacity);
    rocketMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rocketMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    rocketMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    rocketMesh.frustumCulled = false;
    rocketMesh.castShadow = false;
    rocketMesh.receiveShadow = false;
    rocketMesh.raycast = () => {};
    rocketMesh.name = 'gauntlet-rocket-instances';
    group.add(rocketMesh);

    // --- particle mesh ---------------------------------------------------
    const chunkGeo = buildChunkGeometry(THREE);
    // 'emissive' is the near-flat ramp: fire should not read as a shaded solid,
    // but a completely unlit chunk loses its form entirely, so a hint of N·L
    // stays. specStrength 0 — a banded highlight on a 10px chip is one random
    // white pixel.
    const chunkMat = createToonMaterial(THREE, {
        ramp: 'emissive',
        vertexColors: true,
        flatShading: true,
        rimColor: PALETTE.uiGold,
        rimStrength: 0.42,
        rimPower: 1.6,
        rimThreshold: 0.48,
        rimSoftness: 0.04,
        specStrength: 0,
    });
    const chunkMesh = new THREE.InstancedMesh(chunkGeo, chunkMat, pCapacity);
    chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    chunkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pCapacity * 3), 3);
    chunkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    chunkMesh.frustumCulled = false;
    chunkMesh.castShadow = false;
    chunkMesh.receiveShadow = false;
    chunkMesh.raycast = () => {};
    chunkMesh.name = 'gauntlet-explosion-instances';
    group.add(chunkMesh);

    // --- rocket state (flat typed arrays) --------------------------------
    const rpx = new Float32Array(capacity);
    const rpy = new Float32Array(capacity);
    const rpz = new Float32Array(capacity);
    const rvx = new Float32Array(capacity);
    const rvy = new Float32Array(capacity);
    const rvz = new Float32Array(capacity);
    const rqx = new Float32Array(capacity);
    const rqy = new Float32Array(capacity);
    const rqz = new Float32Array(capacity);
    const rqw = new Float32Array(capacity);
    const rlx = new Float32Array(capacity);   // launch point
    const rly = new Float32Array(capacity);
    const rlz = new Float32Array(capacity);
    const rlife = new Float32Array(capacity);
    const ralive = new Uint8Array(capacity);
    const rtrail = new Uint8Array(capacity);  // per-rocket trail stride counter

    // --- particle state --------------------------------------------------
    const px = new Float32Array(pCapacity);
    const py = new Float32Array(pCapacity);
    const pz = new Float32Array(pCapacity);
    const pvx = new Float32Array(pCapacity);
    const pvy = new Float32Array(pCapacity);
    const pvz = new Float32Array(pCapacity);
    const pdx = new Float32Array(pCapacity);  // alignment direction (aligned kinds)
    const pdy = new Float32Array(pCapacity);
    const pdz = new Float32Array(pCapacity);
    const pax = new Float32Array(pCapacity);  // tumble axis (tumbling kinds)
    const pay = new Float32Array(pCapacity);
    const paz = new Float32Array(pCapacity);
    const pang = new Float32Array(pCapacity);
    const pangv = new Float32Array(pCapacity);
    const pcr = new Float32Array(pCapacity);
    const pcg = new Float32Array(pCapacity);
    const pcb = new Float32Array(pCapacity);
    const plife = new Float32Array(pCapacity);
    const pttl = new Float32Array(pCapacity);
    const psize = new Float32Array(pCapacity);
    const pkind = new Uint8Array(pCapacity);
    const palive = new Uint8Array(pCapacity);
    const pstep = new Int8Array(pCapacity).fill(-1);

    let rCursor = 0, rLive = 0;
    let pCursor = 0, pLive = 0;
    let cooldownTimer = 0;
    let animTime = 0;
    let disposed = false;

    // --- scratch (the only objects touched per frame) --------------------
    const _pos = new THREE.Vector3();
    const _scl = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    const _axis = new THREE.Vector3();
    const _qa = new THREE.Quaternion();
    const _qb = new THREE.Quaternion();
    const _qs = new THREE.Quaternion();
    const _mat = new THREE.Matrix4();
    const _col = new THREE.Color();
    const _zero = new THREE.Vector3(0, 0, 0);
    const _ident = new THREE.Quaternion();
    const _fwd = new THREE.Vector3(0, 0, -1);
    const _unitZ = new THREE.Vector3(0, 0, 1);

    // Per-kind base colours, decoded once so the loop never touches Color.
    const KCR = new Float32Array(KIND_COUNT);
    const KCG = new Float32Array(KIND_COUNT);
    const KCB = new Float32Array(KIND_COUNT);
    for (let k = 0; k < KIND_COUNT; k++) {
        _col.setHex(KIND_COLOR[k]);
        KCR[k] = _col.r; KCG[k] = _col.g; KCB[k] = _col.b;
    }

    // Zero both buffers so untouched slots draw nothing.
    _mat.compose(_zero, _ident, _zero);
    for (let i = 0; i < capacity; i++) {
        rocketMesh.setMatrixAt(i, _mat);
        rocketMesh.instanceColor.setXYZ(i, 1, 1, 1);
    }
    for (let i = 0; i < pCapacity; i++) {
        chunkMesh.setMatrixAt(i, _mat);
        chunkMesh.instanceColor.setXYZ(i, 1, 1, 1);
    }
    rocketMesh.instanceMatrix.needsUpdate = true;
    rocketMesh.instanceColor.needsUpdate = true;
    chunkMesh.instanceMatrix.needsUpdate = true;
    chunkMesh.instanceColor.needsUpdate = true;

    /** Signed uniform in [-1, 1). */
    function s1() { return rng() * 2 - 1; }

    // ------------------------------------------------------------ particles

    /**
     * Claim the next particle slot. Never allocates; an over-emitting frame
     * overwrites the oldest particle, so a dense wave degrades into a shorter
     * debris field rather than a GC spike or a hard drop.
     */
    function claimParticle() {
        const i = pCursor;
        pCursor = (pCursor + 1) % pCapacity;
        if (!palive[i]) pLive++;
        palive[i] = 1;
        pstep[i] = -1;
        return i;
    }

    function spawnParticle(kind, x, y, z, dirX, dirY, dirZ, power) {
        const i = claimParticle();
        pkind[i] = kind;
        px[i] = x; py[i] = y; pz[i] = z;

        const sp = (KIND_SPEED_MIN[kind] + rng() * (KIND_SPEED_MAX[kind] - KIND_SPEED_MIN[kind])) * power;
        pvx[i] = dirX * sp; pvy[i] = dirY * sp; pvz[i] = dirZ * sp;
        pdx[i] = dirX; pdy[i] = dirY; pdz[i] = dirZ;

        let ax = s1(), ay = s1(), az = s1();
        const alen = Math.hypot(ax, ay, az) || 1;
        pax[i] = ax / alen; pay[i] = ay / alen; paz[i] = az / alen;
        pang[i] = rng() * Math.PI * 2;
        pangv[i] = (3.4 + rng() * 7.2) * (rng() < 0.5 ? -1 : 1);

        // Per-particle value jitter so a burst is not one flat sticker.
        const j = 0.84 + rng() * 0.32;
        pcr[i] = KCR[kind] * j; pcg[i] = KCG[kind] * j; pcb[i] = KCB[kind] * j;

        const t = KIND_LIFE[kind] * (0.82 + rng() * 0.36);
        plife[i] = t; pttl[i] = t;
        psize[i] = (KIND_SIZE_MIN[kind] + rng() * (KIND_SIZE_MAX[kind] - KIND_SIZE_MIN[kind]))
            * (kind === K_FLASH ? power : 1);
        return i;
    }

    function writeParticle(i) {
        const k = pkind[i];
        const remaining = plife[i] / (pttl[i] || 1);
        let st = Math.floor((1 - remaining) * FADE_STEPS);
        if (st < 0) st = 0;
        if (st > FADE_STEPS - 1) st = FADE_STEPS - 1;

        const s = psize[i] * KIND_FADE_SCALE[k][st];
        _pos.set(px[i], py[i], pz[i]);

        if (KIND_ALIGNED[k]) {
            // Long axis onto the direction of travel, then spin about it so a
            // shard flickers as it flies instead of sliding like a decal.
            _dir.set(pdx[i], pdy[i], pdz[i]);
            _qa.setFromUnitVectors(_unitZ, _dir);
            _qs.setFromAxisAngle(_dir, pang[i]);
            _qa.premultiply(_qs);
        } else {
            _axis.set(pax[i], pay[i], paz[i]);
            _qa.setFromAxisAngle(_axis, pang[i]);
        }

        _scl.set(KIND_SX[k] * s, KIND_SY[k] * s, KIND_SZ[k] * s);
        _mat.compose(_pos, _qa, _scl);
        chunkMesh.setMatrixAt(i, _mat);

        if (pstep[i] !== st) {
            const tone = KIND_FADE_TONE[k][st];
            chunkMesh.instanceColor.setXYZ(i, pcr[i] * tone, pcg[i] * tone, pcb[i] * tone);
            pstep[i] = st;
        }
    }

    function killParticle(i) {
        palive[i] = 0;
        pLive--;
        _mat.compose(_zero, _ident, _zero);
        chunkMesh.setMatrixAt(i, _mat);
        pstep[i] = -1;
    }

    /**
     * A detonation. Four kinds fired from one point:
     *   FLASH  — stationary, blooms through the original's 1.6x growth in hard
     *            steps, gone in 200ms. This is the punch.
     *   SHARD  — the fireball, broken into hard-edged chunks flying outward.
     *   SPARK  — thin fast slivers, braked hard so they read as short streaks.
     *   EMBER  — slow, heavy, sinks radially and cools through four tones.
     */
    function explodeAt(x, y, z, power = 1) {
        if (disposed) return;

        // Radial up at the blast, so embers sink the right way and the flash
        // sits slightly proud of whatever it hit.
        const plen = Math.hypot(x, y, z) || 1;
        const ux = x / plen, uy = y / plen, uz = z / plen;

        for (let n = 0; n < burst[0]; n++) {
            // Flash chunks cluster tightly at the centre — a spread flash reads
            // as four separate small explosions.
            spawnParticle(K_FLASH,
                x + s1() * 0.9, y + s1() * 0.9, z + s1() * 0.9,
                0, 1, 0, power);
        }
        for (let pass = 1; pass <= 3; pass++) {
            const kind = pass === 1 ? K_SHARD : (pass === 2 ? K_SPARK : K_EMBER);
            const count = burst[pass];
            for (let n = 0; n < count; n++) {
                let ax = s1(), ay = s1(), az = s1();
                const alen = Math.hypot(ax, ay, az) || 1;
                ax /= alen; ay /= alen; az /= alen;
                // Bias outward from the planet so the blast blooms up and away
                // rather than half of it burying itself in the ground.
                ax = ax * 0.82 + ux * 0.34;
                ay = ay * 0.82 + uy * 0.34;
                az = az * 0.82 + uz * 0.34;
                const l2 = Math.hypot(ax, ay, az) || 1;
                ax /= l2; ay /= l2; az /= l2;
                spawnParticle(kind, x + ax * 0.6, y + ay * 0.6, z + az * 0.6, ax, ay, az, power);
            }
        }
    }

    // -------------------------------------------------------------- rockets

    function claimRocket() {
        const i = rCursor;
        rCursor = (rCursor + 1) % capacity;
        if (!ralive[i]) rLive++;
        ralive[i] = 1;
        rtrail[i] = 0;
        return i;
    }

    function killRocket(i) {
        ralive[i] = 0;
        rLive--;
        _mat.compose(_zero, _ident, _zero);
        rocketMesh.setMatrixAt(i, _mat);
    }

    /**
     * Fire from a point along a direction. Honours the 2.0s cooldown, verbatim
     * from the original. Returns true if a rocket actually left the tube.
     */
    function fire(x, y, z, dirX, dirY, dirZ) {
        if (disposed) return false;
        if (cooldownTimer > 0) return false;
        const dl = Math.hypot(dirX, dirY, dirZ);
        if (!(dl > 1e-5)) return false;
        const nx = dirX / dl, ny = dirY / dl, nz = dirZ / dl;

        const i = claimRocket();
        rpx[i] = x; rpy[i] = y; rpz[i] = z;
        rlx[i] = x; rly[i] = y; rlz[i] = z;
        rvx[i] = nx * ROCKET_SPEED;
        rvy[i] = ny * ROCKET_SPEED;
        rvz[i] = nz * ROCKET_SPEED;
        rlife[i] = ROCKET_LIFETIME;

        _dir.set(nx, ny, nz);
        _qa.setFromUnitVectors(_fwd, _dir);
        rqx[i] = _qa.x; rqy[i] = _qa.y; rqz[i] = _qa.z; rqw[i] = _qa.w;

        cooldownTimer = ROCKET_COOLDOWN;
        if (api.onFire) api.onFire(x, y, z);
        return true;
    }

    function writeRocket(i) {
        _pos.set(rpx[i], rpy[i], rpz[i]);
        _qa.set(rqx[i], rqy[i], rqz[i], rqw[i]);
        _scl.set(1, 1, 1);
        _mat.compose(_pos, _qa, _scl);
        rocketMesh.setMatrixAt(i, _mat);
    }

    /**
     * Integrate everything and resolve collisions.
     *
     * @param {number} dt
     * @param {Array<{x,y,z,radius}>} [drones] optional targets. Squared distance
     *        only — no sqrt in the inner loop.
     * @returns {number} hits scored this frame, so the caller does not
     *        re-implement collision. The caller decides what a hit does to the
     *        target; `onHit(x, y, z, targetIndex)` fires per hit.
     */
    function update(dt, drones) {
        if (disposed) return 0;
        if (!(dt > 0)) dt = 0;
        // A tab-return spike must not teleport a rocket through a drone.
        if (dt > 0.1) dt = 0.1;

        animTime += dt;
        if (cooldownTimer > 0) cooldownTimer -= dt;

        let hits = 0;
        let rTouched = false;
        const targetCount = drones ? drones.length : 0;

        // Quantised engine flicker. The original pulsed the exhaust material's
        // opacity at sin(t*20); with one instanced mesh there is no per-part
        // material, so the pulse rides the whole instance's colour — stepped to
        // three levels so it reads as a cel flicker and not as a dimmer knob.
        const flickRaw = Math.sin(animTime * EXHAUST_FLICKER_HZ);
        const flick = 1 + 0.11 * (Math.round(flickRaw * 1.5) / 1.5);

        for (let i = 0; i < capacity; i++) {
            if (!ralive[i]) continue;

            rlife[i] -= dt;
            if (rlife[i] <= 0) { killRocket(i); rTouched = true; continue; }

            const x = rpx[i], y = rpy[i], z = rpz[i];

            // Radial gravity: on a sphere, "down" is toward the centre. A
            // world-Y pull made shots veer sideways depending where on the
            // planet you were standing.
            const plen = Math.hypot(x, y, z) || 1;
            const ux = x / plen, uy = y / plen, uz = z / plen;
            const g = ROCKET_GRAVITY * dt;
            let vx = rvx[i] - ux * g;
            let vy = rvy[i] - uy * g;
            let vz = rvz[i] - uz * g;
            rvx[i] = vx; rvy[i] = vy; rvz[i] = vz;

            const nx = x + vx * dt;
            const ny = y + vy * dt;
            const nz = z + vz * dt;
            rpx[i] = nx; rpy[i] = ny; rpz[i] = nz;

            // --- drone proximity, squared distance only ---------------------
            // Deliberately NOT gated by the muzzle corridor: the corridor exists
            // to stop scenery detonations, and gating kills behind it would make
            // a point-blank shot pass through the thing you aimed at.
            let detonated = false;
            for (let t = 0; t < targetCount; t++) {
                const d = drones[t];
                if (!d) continue;
                const dx = d.x - nx, dy = d.y - ny, dz = d.z - nz;
                const r = (d.radius || 0) + ROCKET_RADIUS;
                if (dx * dx + dy * dy + dz * dz <= r * r) {
                    explodeAt(nx, ny, nz, 1);
                    if (api.onHit) api.onHit(nx, ny, nz, t);
                    hits++;
                    killRocket(i);
                    rTouched = true;
                    detonated = true;
                    break;
                }
            }
            if (detonated) continue;

            // --- ground, held off until the muzzle corridor is cleared -------
            // Straight-line distance from the launch point, not path length, so
            // a gravity arc cannot bank the gate open early.
            const lx = nx - rlx[i], ly = ny - rly[i], lz = nz - rlz[i];
            if (lx * lx + ly * ly + lz * lz > MUZZLE_CLEAR_RADIUS * MUZZLE_CLEAR_RADIUS) {
                // terrain.js's invariant: the surface never rises above
                // PLANET_RADIUS, so anything still outside that radius cannot
                // possibly be underground. That early-out keeps the expensive
                // fbm sample off all but the handful of rockets about to land.
                const nlen = Math.hypot(nx, ny, nz);
                if (nlen <= PLANET_RADIUS + GROUND_EPS && nlen > 1e-3) {
                    const gx = nx / nlen, gy = ny / nlen, gz = nz / nlen;
                    if (nlen < surfaceRadius(gx, gy, gz) + GROUND_EPS) {
                        explodeAt(nx, ny, nz, 1);
                        if (api.onHit) api.onHit(nx, ny, nz, -1);
                        killRocket(i);
                        rTouched = true;
                        continue;
                    }
                }
            }

            // --- swing the model onto its velocity --------------------------
            const vlen2 = vx * vx + vy * vy + vz * vz;
            if (vlen2 > 0.01) {
                const inv = 1 / Math.sqrt(vlen2);
                _dir.set(vx * inv, vy * inv, vz * inv);
                _qb.setFromUnitVectors(_fwd, _dir);
                _qa.set(rqx[i], rqy[i], rqz[i], rqw[i]);
                let s = dt * ORIENT_SLERP;
                if (s > 1) s = 1;
                _qa.slerp(_qb, s);
                rqx[i] = _qa.x; rqy[i] = _qa.y; rqz[i] = _qa.z; rqw[i] = _qa.w;

                // --- exhaust trail, as a particle kind ----------------------
                if ((rtrail[i]++ % trailStride) === 0) {
                    // Born a little behind the nozzle with a touch of lateral
                    // scatter, otherwise the trail is a rigid rod rather than a
                    // dissipating plume.
                    const bx = -_dir.x, by = -_dir.y, bz = -_dir.z;
                    spawnParticle(K_TRAIL,
                        nx + bx * 2.6 + s1() * 0.35,
                        ny + by * 2.6 + s1() * 0.35,
                        nz + bz * 2.6 + s1() * 0.35,
                        bx, by, bz, 1);
                }
            }

            writeRocket(i);
            rocketMesh.instanceColor.setXYZ(i, flick, flick, flick);
            rTouched = true;
        }

        // -------------------------------------------------------- particles
        let pTouched = false;
        if (pLive > 0) {
            for (let i = 0; i < pCapacity; i++) {
                if (!palive[i]) continue;

                plife[i] -= dt;
                if (plife[i] <= 0) { killParticle(i); pTouched = true; continue; }

                const k = pkind[i];
                const x = px[i], y = py[i], z = pz[i];

                if (k !== K_FLASH) {
                    const plen = Math.hypot(x, y, z) || 1;
                    const ux = x / plen, uy = y / plen, uz = z / plen;
                    const sink = KIND_SINK[k] * dt;
                    let vx = pvx[i] - ux * sink;
                    let vy = pvy[i] - uy * sink;
                    let vz = pvz[i] - uz * sink;

                    // Clamped linear drag — a big dt must not invert velocity.
                    let d = 1 - KIND_DRAG[k] * dt;
                    if (d < 0) d = 0;
                    vx *= d; vy *= d; vz *= d;
                    pvx[i] = vx; pvy[i] = vy; pvz[i] = vz;

                    let nx = x + vx * dt;
                    let ny = y + vy * dt;
                    let nz = z + vz * dt;

                    // Same cheap ground early-out as the rockets.
                    const nlen = Math.hypot(nx, ny, nz);
                    if (nlen <= PLANET_RADIUS + GROUND_EPS && nlen > 1e-3) {
                        const gx = nx / nlen, gy = ny / nlen, gz = nz / nlen;
                        const ground = surfaceRadius(gx, gy, gz) + GROUND_EPS;
                        if (nlen < ground) {
                            nx = gx * ground; ny = gy * ground; nz = gz * ground;
                            pvx[i] = 0; pvy[i] = 0; pvz[i] = 0;
                            pangv[i] = 0;
                            // Debris is punctuation, not accumulation.
                            if (plife[i] > 0.22) plife[i] = 0.22;
                        }
                    }

                    px[i] = nx; py[i] = ny; pz[i] = nz;

                    const sp2 = vx * vx + vy * vy + vz * vz;
                    if (sp2 > 1e-4) {
                        const inv = 1 / Math.sqrt(sp2);
                        pdx[i] = vx * inv; pdy[i] = vy * inv; pdz[i] = vz * inv;
                    }

                    pangv[i] *= d;
                }

                pang[i] += pangv[i] * dt;
                writeParticle(i);
                pTouched = true;
            }
        }

        if (rTouched) {
            rocketMesh.instanceMatrix.needsUpdate = true;
            rocketMesh.instanceColor.needsUpdate = true;
        }
        if (pTouched) {
            chunkMesh.instanceMatrix.needsUpdate = true;
            chunkMesh.instanceColor.needsUpdate = true;
        }

        return hits;
    }

    /** Wipe every rocket and particle (mode restart). */
    function clear() {
        for (let i = 0; i < capacity; i++) if (ralive[i]) killRocket(i);
        for (let i = 0; i < pCapacity; i++) if (palive[i]) killParticle(i);
        rLive = 0; pLive = 0; rCursor = 0; pCursor = 0;
        rocketMesh.instanceMatrix.needsUpdate = true;
        chunkMesh.instanceMatrix.needsUpdate = true;
    }

    function reset() {
        clear();
        cooldownTimer = 0;
        animTime = 0;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        group.remove(rocketMesh);
        group.remove(chunkMesh);
        rocketGeo.dispose();
        chunkGeo.dispose();
        rocketMat.dispose();
        chunkMat.dispose();
        rocketMesh.dispose();
        chunkMesh.dispose();
    }

    const rocketTris = rocketGeo.getAttribute('position').count / 3;
    const chunkTris = chunkGeo.getAttribute('position').count / 3;

    const api = {
        group,
        mesh: rocketMesh,
        particleMesh: chunkMesh,

        fire,
        explodeAt,
        update,
        clear,
        reset,
        dispose,

        /** Settable: (x, y, z, targetIndex) — targetIndex is -1 for a ground hit. */
        onHit: opts.onHit || null,
        /** Settable: (x, y, z) when a rocket leaves the tube. */
        onFire: opts.onFire || null,

        canFire() { return cooldownTimer <= 0; },
        get cooldownRemaining() { return Math.max(0, cooldownTimer); },
        /** 1 = just fired, 0 = ready. Drives the HUD reload arc. */
        get cooldown01() { return Math.max(0, Math.min(1, cooldownTimer / ROCKET_COOLDOWN)); },

        capacity,
        particleCapacity: pCapacity,
        get liveRockets() { return rLive; },
        get liveParticles() { return pLive; },

        drawCallCount: 2,
        triangleCount: rocketTris * capacity + chunkTris * pCapacity,
        rocketTriangles: rocketTris,
        particleTriangles: chunkTris,
    };
    return api;
}

export default createRockets;
