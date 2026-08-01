/**
 * feathers.js — VYOM's feather particle system.
 *
 * Feathers are to stylised flight what foam is to stylised water: the thing
 * that tells you the medium is being disturbed. A racer that leaves nothing
 * behind reads as a model being translated; a racer shedding a spreading,
 * tumbling trail reads as a bird punching through air.
 *
 * ============================================================================
 * DESIGN CONSTRAINTS (all load-bearing)
 * ============================================================================
 *
 * 1. ONE InstancedMesh, fixed capacity, ring-buffer slots. Two draw calls is
 *    the budget for the whole system; we spend one. Slots are never allocated
 *    or freed at runtime — a new emit overwrites the oldest slot, so an
 *    over-emitting frame degrades into a shorter trail instead of a GC spike
 *    or a hard drop.
 *
 * 2. NO OUTLINES. An inverted hull on every instance doubles the draw count for
 *    lines that, at feather scale, read as noise. Instead the silhouette does
 *    the work: a real tapered, curved blade, and a HARD two-tone split baked
 *    into the vertex colours across the rachis. Duplicated centre vertices make
 *    that split a genuine step rather than a gradient — a smooth vane reads as
 *    a photographic leaf, a stepped one reads as ink-and-flat-colour.
 *
 * 3. FADE-OUT IS QUANTISED. Four hard steps of scale and tone, then gone. A
 *    smooth alpha ramp reads as atmospheric haze, which is the exact opposite
 *    of this art direction — and it would also force transparency sorting on a
 *    few hundred instances, which mobile cannot afford. Everything here is
 *    opaque and depth-writes.
 *
 * 4. ZERO ALLOCATION in update()/emit(). All per-feather state lives in
 *    pre-sized Float32Arrays; the only objects touched per frame are the `_`
 *    scratch Vector3/Quaternion/Matrix4/Color declared in the factory.
 *
 * Up is radial (normalize(position)) — feathers settle toward the planet
 * centre, not toward world -Y.
 */

import { PALETTE, getRamp } from '../core/palette.js';
import { patchToon } from '../core/toon.js';
import { makeRng } from '../core/rng.js';

/** Feather budget per quality tier (ARCHITECTURE.md's table). */
const TIER_CAPACITY = { low: 90, mid: 180, high: 320 };

/**
 * Trail emission stride per tier: `emitTrail` spawns on 1 call in N. Sized so a
 * four-racer field at 60fps stays roughly inside capacity for the trail
 * lifetime, leaving headroom for bursts. Over-emission is safe (ring buffer),
 * it just shortens the tail.
 */
const TIER_TRAIL_STRIDE = { low: 4, mid: 2, high: 1 };

/**
 * The quantised death ramp. Index = age step; the feather is removed after the
 * last one. Scale steps down hard and tone lifts slightly toward the sky so a
 * dying feather dissolves into the background as a graphic pop, not a fade.
 */
const FADE_SCALE = [1.0, 0.88, 0.62, 0.33];
const FADE_TONE = [1.0, 1.06, 1.14, 1.24];
const FADE_STEPS = FADE_SCALE.length;

const TRAIL_LIFE = 1.75;   // seconds
const BURST_LIFE = 2.35;

/**
 * Build the feather blade.
 *
 * Profile is a tapered vane: a thin quill at the base, widest just past a
 * third, drawn to a point at the tip. The blade also curves (a quadratic sweep
 * in local X) and cambers (the rachis lifted in local Z) so it is never a flat
 * card — the camber is what gives the two vanes different N·L and makes the
 * toon ramp split them into two flat tones.
 *
 * Local frame: length runs along +Y, tip at +Y. Pivot sits near the blade's
 * balance point so tumbling spins look centred.
 *
 * Vertex colours carry the hard two-tone: left vane at full, right vane
 * darkened. The rachis vertices are duplicated so that step never interpolates.
 */
function buildFeatherGeometry(THREE) {
    // t along the shaft, half-width, and how far the rachis is cambered up.
    const ROWS = [
        [0.00, 0.014],
        [0.10, 0.052],
        [0.26, 0.098],
        [0.46, 0.118],
        [0.66, 0.104],
        [0.84, 0.064],
        [1.00, 0.000],
    ];
    const N = ROWS.length;
    const PIVOT = 0.42;      // fraction of length behind the pivot
    const CURVE = 0.16;      // lateral sweep at the tip
    const CAMBER = 0.055;    // rachis lift, in local Z

    // 4 verts per row: left edge, left-rachis, right-rachis, right edge.
    const vertCount = N * 4;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const indices = [];

    // Two flat tones, hard split at the shaft. Values are multipliers applied
    // to the per-instance colour, so a racer's hue survives the split.
    const TONE_L = 1.0;
    const TONE_R = 0.58;

    for (let i = 0; i < N; i++) {
        const t = ROWS[i][0];
        const w = ROWS[i][1];
        const y = t - PIVOT;
        const x = CURVE * t * t;                  // swept, not straight
        const z = CAMBER * Math.sin(Math.PI * t); // rachis ridge

        const o = i * 4 * 3;
        // left edge
        positions[o + 0] = x - w; positions[o + 1] = y; positions[o + 2] = 0;
        // left rachis (duplicated centre)
        positions[o + 3] = x; positions[o + 4] = y; positions[o + 5] = z;
        // right rachis (duplicated centre)
        positions[o + 6] = x; positions[o + 7] = y; positions[o + 8] = z;
        // right edge
        positions[o + 9] = x + w; positions[o + 10] = y; positions[o + 11] = 0;

        // Tip rows get a small extra lift so the point does not read as dirty
        // when it lands in the dark band.
        const tipLift = 1 + 0.22 * t * t;
        colors[o + 0] = TONE_L * tipLift; colors[o + 1] = TONE_L * tipLift; colors[o + 2] = TONE_L * tipLift;
        colors[o + 3] = TONE_L * tipLift; colors[o + 4] = TONE_L * tipLift; colors[o + 5] = TONE_L * tipLift;
        colors[o + 6] = TONE_R * tipLift; colors[o + 7] = TONE_R * tipLift; colors[o + 8] = TONE_R * tipLift;
        colors[o + 9] = TONE_R * tipLift; colors[o + 10] = TONE_R * tipLift; colors[o + 11] = TONE_R * tipLift;
    }

    for (let i = 0; i < N - 1; i++) {
        const a = i * 4;
        const b = (i + 1) * 4;
        // left vane quad (a+0,a+1 / b+0,b+1)
        indices.push(a + 0, a + 1, b + 1, a + 0, b + 1, b + 0);
        // right vane quad (a+2,a+3 / b+2,b+3)
        indices.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    // Bounding sphere is authored: instance matrices move the geometry all over
    // the planet and the mesh is frustum-culled off anyway.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
    return geo;
}

/**
 * @param {object} THREE
 * @param {object} [opts]
 * @param {'low'|'mid'|'high'} [opts.quality]
 * @param {number} [opts.capacity]  override the tier capacity
 * @param {number} [opts.seed]
 * @param {number} [opts.planetRadius] used only to bias settling; feathers fall
 *                 radially regardless, this just scales the pull.
 */
export function createFeatherFX(THREE, opts = {}) {
    const quality = opts.quality || 'high';
    const capacity = Math.max(8, opts.capacity || TIER_CAPACITY[quality] || TIER_CAPACITY.high);
    const trailStride = TIER_TRAIL_STRIDE[quality] || 1;
    const rng = makeRng(opts.seed || 0x5eed);

    const group = new THREE.Group();
    group.name = 'vyom-feathers';

    const geometry = buildFeatherGeometry(THREE);

    // 'graphic' is the two-band ramp — maximum step contrast, which is exactly
    // what a 40px-tall object needs to stay legible. specStrength is off: a
    // banded highlight on a surface this small is a random white pixel.
    const material = new THREE.MeshToonMaterial({
        color: 0xffffff,
        gradientMap: getRamp(THREE, 'graphic'),
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: false,
        depthWrite: true,
        fog: true,
    });
    patchToon(THREE, material, {
        ramp: 'graphic',
        rimColor: PALETTE.uiCream,
        rimStrength: 0.30,
        rimPower: 1.8,
        rimThreshold: 0.40,
        rimSoftness: 0.05,
        specStrength: 0.0,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = () => {};
    mesh.name = 'vyom-feather-instances';
    group.add(mesh);

    // --- particle state, all flat typed arrays --------------------------
    const px = new Float32Array(capacity);
    const py = new Float32Array(capacity);
    const pz = new Float32Array(capacity);
    const vx = new Float32Array(capacity);
    const vy = new Float32Array(capacity);
    const vz = new Float32Array(capacity);
    // spin axis (unit) + current angle + rate
    const sx = new Float32Array(capacity);
    const sy = new Float32Array(capacity);
    const sz = new Float32Array(capacity);
    const ang = new Float32Array(capacity);
    const angVel = new Float32Array(capacity);
    // flutter: a unit sway direction plus phase/rate
    const fx = new Float32Array(capacity);
    const fy = new Float32Array(capacity);
    const fz = new Float32Array(capacity);
    const fPhase = new Float32Array(capacity);
    const fRate = new Float32Array(capacity);
    const fAmp = new Float32Array(capacity);
    // base colour (already sRGB-decoded)
    const cr = new Float32Array(capacity);
    const cg = new Float32Array(capacity);
    const cb = new Float32Array(capacity);

    const life = new Float32Array(capacity);   // seconds remaining
    const ttl = new Float32Array(capacity);    // seconds at birth
    const size = new Float32Array(capacity);
    const drag = new Float32Array(capacity);
    const sink = new Float32Array(capacity);
    const alive = new Uint8Array(capacity);
    const step = new Int8Array(capacity).fill(-1); // last written fade step

    let cursor = 0;
    let liveCount = 0;
    let trailCounter = 0;
    let disposed = false;

    // --- scratch --------------------------------------------------------
    const _pos = new THREE.Vector3();
    const _scl = new THREE.Vector3();
    const _axis = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _mat = new THREE.Matrix4();
    const _col = new THREE.Color();
    const _zero = new THREE.Vector3(0, 0, 0);
    const _one = new THREE.Quaternion();
    const _colCream = new THREE.Color(PALETTE.uiCream);

    // Zero the whole buffer once so untouched slots draw nothing.
    _mat.compose(_zero, _one, _zero);
    for (let i = 0; i < capacity; i++) {
        mesh.setMatrixAt(i, _mat);
        mesh.instanceColor.setXYZ(i, 1, 1, 1);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    /** Signed uniform in [-1,1). */
    function s1() { return rng() * 2 - 1; }

    /**
     * Claim the next ring-buffer slot. Never allocates; overwrites the oldest
     * feather when full, which is the graceful-degradation path.
     */
    function claim() {
        const i = cursor;
        cursor = (cursor + 1) % capacity;
        if (!alive[i]) liveCount++;
        alive[i] = 1;
        step[i] = -1;
        return i;
    }

    /**
     * Fill one slot. `colorHex` is the racer's plumage; feathers are mixed
     * toward cream so they read as down rather than as chips of the bird.
     */
    function spawn(x, y, z, ivx, ivy, ivz, colorHex, ttlSec, sizeMin, sizeMax, spinScale) {
        const i = claim();

        px[i] = x; py[i] = y; pz[i] = z;
        vx[i] = ivx; vy[i] = ivy; vz[i] = ivz;

        // Tumble about a random unit axis. Feathers rotate fast about the shaft
        // and slower end-over-end; a single random axis gives both for free.
        let ax = s1(), ay = s1(), az = s1();
        const alen = Math.hypot(ax, ay, az) || 1;
        sx[i] = ax / alen; sy[i] = ay / alen; sz[i] = az / alen;
        ang[i] = rng() * Math.PI * 2;
        angVel[i] = (2.2 + rng() * 4.6) * (rng() < 0.5 ? -1 : 1) * spinScale;

        // Flutter sway: a direction perpendicular-ish to the spin axis.
        let gx = s1(), gy = s1(), gz = s1();
        let hx = sy[i] * gz - sz[i] * gy;
        let hy = sz[i] * gx - sx[i] * gz;
        let hz = sx[i] * gy - sy[i] * gx;
        const hlen = Math.hypot(hx, hy, hz) || 1;
        fx[i] = hx / hlen; fy[i] = hy / hlen; fz[i] = hz / hlen;
        fPhase[i] = rng() * Math.PI * 2;
        fRate[i] = 3.4 + rng() * 3.2;
        fAmp[i] = 3.0 + rng() * 4.0;

        _col.setHex(colorHex);
        // 0.46 toward cream: keeps racer identity legible while stopping a
        // saturated body colour from reading as confetti.
        _col.lerp(_colCream, 0.46);
        // Per-feather value jitter so a burst is not one flat sticker.
        const j = 0.86 + rng() * 0.28;
        cr[i] = _col.r * j; cg[i] = _col.g * j; cb[i] = _col.b * j;

        const t = ttlSec * (0.82 + rng() * 0.36);
        life[i] = t; ttl[i] = t;
        size[i] = sizeMin + rng() * (sizeMax - sizeMin);
        drag[i] = 1.35 + rng() * 1.15;
        sink[i] = 1.6 + rng() * 1.9;
        return i;
    }

    /** Write a slot's instance matrix + colour for its current fade step. */
    function writeInstance(i) {
        const remaining = life[i] / (ttl[i] || 1);
        // 4 hard steps. Index 0 is freshest.
        let st = Math.floor((1 - remaining) * FADE_STEPS);
        if (st < 0) st = 0;
        if (st > FADE_STEPS - 1) st = FADE_STEPS - 1;

        const s = size[i] * FADE_SCALE[st];
        _pos.set(px[i], py[i], pz[i]);
        _axis.set(sx[i], sy[i], sz[i]);
        _quat.setFromAxisAngle(_axis, ang[i]);
        _scl.set(s, s, s);
        _mat.compose(_pos, _quat, _scl);
        mesh.setMatrixAt(i, _mat);

        if (step[i] !== st) {
            const tone = FADE_TONE[st];
            mesh.instanceColor.setXYZ(i, cr[i] * tone, cg[i] * tone, cb[i] * tone);
            step[i] = st;
        }
    }

    function kill(i) {
        alive[i] = 0;
        liveCount--;
        _mat.compose(_zero, _one, _zero);
        mesh.setMatrixAt(i, _mat);
        step[i] = -1;
    }

    // ---------------------------------------------------------------- API

    /**
     * Persistent trail behind a racer. Call every frame per racer with the
     * racer's world position and velocity; the stride throttle decides whether
     * this call actually sheds a feather.
     *
     * Shed feathers keep a fraction of the racer's velocity (so they stream
     * backwards and spread rather than being dropped in place) plus a lateral
     * kick that widens the plume as it ages.
     */
    function emitTrail(x, y, z, ivx, ivy, ivz, colorHex) {
        if (disposed) return -1;
        if ((trailCounter++ % trailStride) !== 0) return -1;

        const vlen = Math.hypot(ivx, ivy, ivz);
        const inv = vlen > 1e-4 ? 1 / vlen : 0;
        const dx = ivx * inv, dy = ivy * inv, dz = ivz * inv;

        // Radial up at the emitter — feathers pop slightly outward from the
        // planet before settling, which reads as air being displaced.
        const plen = Math.hypot(x, y, z) || 1;
        const ux = x / plen, uy = y / plen, uz = z / plen;

        // Lateral basis = up x forward.
        let lx = uy * dz - uz * dy;
        let ly = uz * dx - ux * dz;
        let lz = ux * dy - uy * dx;
        const llen = Math.hypot(lx, ly, lz) || 1;
        lx /= llen; ly /= llen; lz /= llen;

        const spread = s1();
        const keep = 0.26 + rng() * 0.16;          // trails behind the racer
        const lat = spread * (1.1 + vlen * 0.055); // plume widening
        const lift = 0.7 + rng() * 1.4;

        // Offset the birth point behind the racer so feathers do not spawn
        // inside the bird mesh.
        const back = 0.9 + rng() * 0.9;

        return spawn(
            x - dx * back + lx * spread * 0.35,
            y - dy * back + ly * spread * 0.35,
            z - dz * back + lz * spread * 0.35,
            ivx * keep + lx * lat + ux * lift,
            ivy * keep + ly * lat + uy * lift,
            ivz * keep + lz * lat + uz * lift,
            colorHex, TRAIL_LIFE, 0.85, 1.45, 1.0
        );
    }

    /**
     * A puff. Small counts for a gate pass, larger for an impact. Velocities
     * are a radially-biased sphere so the puff blooms and then settles.
     */
    function burst(x, y, z, count, colorHex, power = 1) {
        if (disposed) return;
        const n = Math.max(1, count | 0);
        const plen = Math.hypot(x, y, z) || 1;
        const ux = x / plen, uy = y / plen, uz = z / plen;

        for (let k = 0; k < n; k++) {
            let ax = s1(), ay = s1(), az = s1();
            const alen = Math.hypot(ax, ay, az) || 1;
            ax /= alen; ay /= alen; az /= alen;
            const sp = (5.5 + rng() * 9.0) * power;
            spawn(
                x + ax * 0.5, y + ay * 0.5, z + az * 0.5,
                ax * sp + ux * (1.6 + rng() * 2.4) * power,
                ay * sp + uy * (1.6 + rng() * 2.4) * power,
                az * sp + uz * (1.6 + rng() * 2.4) * power,
                colorHex, BURST_LIFE, 1.0, 1.75, 1.5
            );
        }
    }

    /** Integrate + write. Zero allocation. */
    function update(dt) {
        if (disposed) return;
        if (!(dt > 0)) dt = 0;
        if (dt > 0.1) dt = 0.1;      // a tab-return spike must not teleport the plume
        if (liveCount === 0) return;

        let touched = false;
        for (let i = 0; i < capacity; i++) {
            if (!alive[i]) continue;

            life[i] -= dt;
            if (life[i] <= 0) { kill(i); touched = true; continue; }

            // radial down
            const x = px[i], y = py[i], z = pz[i];
            const plen = Math.hypot(x, y, z) || 1;
            const ux = x / plen, uy = y / plen, uz = z / plen;

            // flutter sway, oscillating about the sway axis
            fPhase[i] += fRate[i] * dt;
            const sway = Math.sin(fPhase[i]) * fAmp[i];

            const g = sink[i];
            let nvx = vx[i] + (-ux * g + fx[i] * sway) * dt;
            let nvy = vy[i] + (-uy * g + fy[i] * sway) * dt;
            let nvz = vz[i] + (-uz * g + fz[i] * sway) * dt;

            // Exponential-ish drag, clamped so a big dt cannot invert velocity.
            let d = 1 - drag[i] * dt;
            if (d < 0) d = 0;
            nvx *= d; nvy *= d; nvz *= d;

            vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
            px[i] = x + nvx * dt;
            py[i] = y + nvy * dt;
            pz[i] = z + nvz * dt;

            // Tumble. Rate bleeds off with the same drag so a settling feather
            // stops spinning instead of drilling.
            angVel[i] *= d;
            ang[i] += angVel[i] * dt;

            writeInstance(i);
            touched = true;
        }

        if (touched) {
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.needsUpdate = true;
        }
    }

    /** Instantly clear every feather (race restart). */
    function clear() {
        for (let i = 0; i < capacity; i++) {
            if (alive[i]) kill(i);
        }
        liveCount = 0;
        cursor = 0;
        mesh.instanceMatrix.needsUpdate = true;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        group.remove(mesh);
        geometry.dispose();
        material.dispose();
        mesh.dispose();
    }

    return {
        group,
        mesh,
        capacity,
        emitTrail,
        burst,
        update,
        clear,
        dispose,
        get liveCount() { return liveCount; },
        drawCallCount: 1,
        triangleCount: (geometry.getIndex().count / 3) * capacity,
    };
}

export default createFeatherFX;
