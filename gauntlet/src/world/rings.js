/**
 * world/rings.js — collectible rings for Ring Rush.
 *
 * Ported from Birb Mobile's `src/environment/collectibles.js` in spirit, not in
 * code. Two things changed on the way over.
 *
 * THE SPAWNER OWNS THE COUNT. The original spawned 18 rings and then checked
 * the win condition against a hardcoded 10, so Ring Rush could be "completed"
 * eight rings early — and after a later change, never completed at all. Here
 * `count` is whatever actually got built, and the caller is expected to sync
 * its run state from it rather than assume. `modes.js` deliberately does not
 * reset ringsTotal for the same reason.
 *
 * THEY FOLLOW THE RACING LINE. The original scattered rings over a hemisphere
 * with a fibonacci lattice, which reads as a shopping list: you fly to a dot,
 * turn around, fly to another dot. Threading them along the course spline with
 * a lateral weave gives Ring Rush an actual RACING LINE to carry speed through,
 * and reuses a circuit that was already designed with a hairpin, a sweeper and
 * a canyon dive in it.
 *
 * One InstancedMesh for every ring. Collection is squared-distance only and
 * allocates nothing.
 */

import { createToonMaterial } from '../core/toon.js';
import { PALETTE } from '../core/palette.js';
import { makeRng, rngRange } from '../core/rng.js';

/** How close the bird's centre must get to count as a collection. */
export const RING_COLLECT_RADIUS = 6.5;

/** Ring geometry, in world units. */
export const RING_RADIUS = 5.0;
export const RING_TUBE = 0.62;

const TIER = {
    low: { count: 14, radial: 5, tubular: 14 },
    mid: { count: 18, radial: 6, tubular: 18 },
    high: { count: 18, radial: 6, tubular: 22 },
};

/**
 * @param {object} THREE
 * @param {object} opts
 * @param {string} [opts.quality]
 * @param {number} [opts.seed]
 * @param {object} opts.course  the circuit; rings thread along its spline
 * @param {number} [opts.count] override the tier count
 */
export function createRings(THREE, opts = {}) {
    const course = opts.course;
    if (!course) throw new Error('createRings: opts.course is required');

    const tier = TIER[opts.quality] || TIER.high;
    const count = Math.max(1, opts.count ?? tier.count) | 0;
    const rng = makeRng((opts.seed ?? 20260801) >>> 0);

    const group = new THREE.Group();
    group.name = 'gauntlet-rings';

    const geometry = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, tier.radial, tier.tubular);

    // `emissive` ramp: rings should read as lit objects you are drawn toward,
    // not as shaded scenery. nearFade for the same reason the course ribbon has
    // it — you fly THROUGH these, and a solid torus filling the screen at the
    // moment of collection blinds you exactly when the next one matters.
    const material = createToonMaterial(THREE, {
        ramp: 'emissive',
        color: PALETTE.gateIdle,
        emissive: PALETTE.gateIdle,
        emissiveIntensity: 0.55,
        rimColor: PALETTE.ribbonEdge,
        rimStrength: 0.9,
        rimThreshold: 0.34,
        specStrength: 0.35,
        nearFade: [3.5, 11],
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'gauntlet-rings-mesh';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = count;
    group.add(mesh);

    // --- placement ---------------------------------------------------------
    // Build-time allocation is free; none of this runs per frame.
    const positions = new Float32Array(count * 3);
    const collected = new Uint8Array(count);
    const ringT = new Float32Array(count);

    const _p = new THREE.Vector3();
    const _tan = new THREE.Vector3();
    const _up = new THREE.Vector3();
    const _side = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _m = new THREE.Matrix4();
    const _scale = new THREE.Vector3(1, 1, 1);
    const _look = new THREE.Matrix4();

    for (let i = 0; i < count; i++) {
        // Even spacing round the lap, jittered so it never reads as clockwork.
        const t = (i + rngRange(rng, -0.22, 0.22)) / count;
        const tw = t - Math.floor(t);
        ringT[i] = tw;

        course.sampleAt(tw, _p);
        course.tangentAt(tw, _tan);
        _up.copy(_p).normalize();

        // Weave across the line so the run is a slalom rather than a straight
        // string of hoops, and lift them clear of the deck.
        _side.crossVectors(_tan, _up).normalize();
        // Amplitude is bounded by the collect radius, not by taste. The probe
        // flies the bare centreline and counts how many rings that reaches;
        // at 3.0-8.5 lateral it reached 17 of 18, so one ring demanded a
        // detour that no amount of skill would make feel fair. A collectible
        // you can miss by flying the correct line is a bug, not a challenge.
        // The slalom still comes from the alternating sign — you weave to fly
        // them CLEANLY, you just cannot be locked out of one.
        const lateral = Math.sin(i * 1.9) * rngRange(rng, 2.4, 5.6);
        const lift = rngRange(rng, 1.8, 4.2);
        _p.addScaledVector(_side, lateral).addScaledVector(_up, lift);

        positions[i * 3] = _p.x;
        positions[i * 3 + 1] = _p.y;
        positions[i * 3 + 2] = _p.z;

        // A torus faces +Z, so aim it down the track: fly through, not past.
        _look.lookAt(_p, _p.clone().add(_tan), _up);
        _q.setFromRotationMatrix(_look);
        _m.compose(_p, _q, _scale);
        mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    // Per-instance colour so a collected ring can dim without a second draw.
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.instanceColor = colorAttr;
    const _cIdle = new THREE.Color(PALETTE.gateIdle);
    const _cGone = new THREE.Color(PALETTE.gatePassed);
    for (let i = 0; i < count; i++) _cIdle.toArray(colorAttr.array, i * 3);
    colorAttr.needsUpdate = true;

    // --- runtime -----------------------------------------------------------
    let remaining = count;
    let time = 0;
    const collectR2 = RING_COLLECT_RADIUS * RING_COLLECT_RADIUS;
    const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const _restore = new THREE.Matrix4();

    /**
     * Test the bird against every uncollected ring.
     * Returns the index collected this frame, or -1. Zero allocation.
     */
    function collect(x, y, z) {
        for (let i = 0; i < count; i++) {
            if (collected[i]) continue;
            const dx = x - positions[i * 3];
            const dy = y - positions[i * 3 + 1];
            const dz = z - positions[i * 3 + 2];
            if (dx * dx + dy * dy + dz * dz > collectR2) continue;

            collected[i] = 1;
            remaining--;
            // Collapse the instance rather than rebuilding the buffer: one
            // matrix write, no reallocation, and the draw call is unchanged.
            _restore.copy(_hidden);
            mesh.setMatrixAt(i, _restore);
            mesh.instanceMatrix.needsUpdate = true;
            _cGone.toArray(colorAttr.array, i * 3);
            colorAttr.needsUpdate = true;
            return i;
        }
        return -1;
    }

    /** Position of ring `i` into `out`. */
    function positionOf(i, out) {
        return out.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }

    /** Bring every ring back for a fresh run. */
    function reset() {
        for (let i = 0; i < count; i++) {
            if (!collected[i]) continue;
            collected[i] = 0;
            positionOf(i, _p);
            course.tangentAt(ringT[i], _tan);
            _up.copy(_p).normalize();
            _look.lookAt(_p, _p.clone().add(_tan), _up);
            _q.setFromRotationMatrix(_look);
            _m.compose(_p, _q, _scale);
            mesh.setMatrixAt(i, _m);
            _cIdle.toArray(colorAttr.array, i * 3);
        }
        remaining = count;
        mesh.instanceMatrix.needsUpdate = true;
        colorAttr.needsUpdate = true;
    }

    /** Gentle idle shimmer. Zero allocation. */
    function update(dt) {
        time += dt;
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.1);
        material.emissiveIntensity = 0.42 + pulse * 0.3;
    }

    function dispose() {
        geometry.dispose();
        material.dispose();
        group.clear();
    }

    return {
        group,
        mesh,
        count,
        get remaining() { return remaining; },
        get collectedCount() { return count - remaining; },
        positions,
        ringT,
        collect,
        positionOf,
        reset,
        update,
        dispose,
        drawCallCount: 1,
        triangleCount: (geometry.getIndex().count / 3) * count,
    };
}

export default createRings;
