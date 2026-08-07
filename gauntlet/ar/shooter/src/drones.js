/**
 * drones.js — the enemy swarm for Birb AR Shooter, in ROOM space.
 *
 * Gauntlet's `nesting/drones.js` cannot be reused here and it is worth saying
 * why: those drones orbit a planet, take their up vector from `normalize(pos)`
 * and are placed against nests and terrain. In this game the world is your
 * living room, the player is a fixed point at the origin, and "up" is just +Y.
 * Same silhouette, completely different motion — so this is a new module that
 * borrows the LOOK (dark body, bright spinning ring) and nothing else.
 *
 * Two InstancedMeshes, so the whole swarm is 2 draw calls no matter how many
 * are flying. Dead slots are hidden by zeroing their scale rather than by
 * rebuilding the buffer.
 *
 * Zero-allocation: every vector, quaternion and matrix is pre-allocated. The
 * drone records themselves are built once at capacity and recycled.
 */

import { createToonMaterial } from '/gauntlet/src/core/toon.js';
import { PALETTE } from '/gauntlet/src/core/palette.js';
import { makeRng, rngRange } from '/gauntlet/src/core/rng.js';

export const DRONE_TUNING = Object.freeze({
    radius: 0.40,           // visual size, metres
    hitRadius: 0.62,        // generous on purpose: you are aiming by waving a
                            // phone around a room, not with a mouse
    // These set the REACTION TIME, which is what difficulty in this game
    // actually is. At 5-9m and 0.95 m/s a wave-1 drone reached you in about 6
    // seconds, and only 3.8 at the near end — not enough to sweep 360 degrees,
    // find it, and line up a shot, so the whole game read as frantic.
    //
    // 9-15m gives ~10-17s at the wave-1 speed below. It was pulled IN to 5-9m
    // during the first build on the theory that distant drones were too small
    // to see; that was measured wrong. The body alone subtends ~3 degrees at
    // 12m, but the bright ring is 1.75x the body radius and spans ~7 degrees,
    // or about 85px on a portrait phone. They stay perfectly readable out here.
    spawnMin: 9.0,
    spawnMax: 15.0,
    /** How close a drone gets before it hits you. */
    strikeRange: 1.35,
    /** Vertical spawn window, radians. Kept inside a portrait phone's ~31.5
     *  degree half-FOV: below the floor they are unfindable, and above it you
     *  are asking the player to point at their own ceiling. */
    elevMin: -0.25,
    elevMax: 0.45,
    // Closing speed. Lowered with the spawn distance rather than instead of it:
    // distance alone buys reaction time once, while speed governs how fast that
    // margin erodes as the waves climb. The per-wave step is gentler too, so
    // wave 6 escalates rather than spikes.
    baseSpeed: 0.78,
    speedPerWave: 0.10,
    weaveAmp: 0.55,
});

export function createDroneSwarm(THREE, opts = {}) {
    const capacity = opts.capacity ?? 16;
    const rng = makeRng(opts.seed ?? 0xd0e5);
    const T = DRONE_TUNING;

    const group = new THREE.Group();

    // --- meshes ------------------------------------------------------------
    const bodyGeo = new THREE.IcosahedronGeometry(T.radius, 0);   // faceted, cel-friendly
    const bodyMat = createToonMaterial(THREE, {
        color: PALETTE.uiPanel,
        // Cranked well above the default: these are dark objects composited over
        // an arbitrary real room, and without a strong rim they disappear
        // against dark furniture entirely.
        rimStrength: 1.15,
        rimColor: PALETTE.sparkCyan,
        specStrength: 0.35,
        flatShading: true,
        fog: false,
    });
    const body = new THREE.InstancedMesh(bodyGeo, bodyMat, capacity);
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.frustumCulled = false;
    group.add(body);

    const ringGeo = new THREE.TorusGeometry(T.radius * 1.75, T.radius * 0.16, 6, 18);
    const ringMat = createToonMaterial(THREE, {
        color: PALETTE.sparkCyan,
        rimStrength: 0.9,
        specStrength: 0.7,
        fog: false,
    });
    const ring = new THREE.InstancedMesh(ringGeo, ringMat, capacity);
    ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ring.frustumCulled = false;
    group.add(ring);

    // --- records -----------------------------------------------------------
    const drones = [];
    for (let i = 0; i < capacity; i++) {
        drones.push({
            alive: false,
            pos: new THREE.Vector3(),
            dir: new THREE.Vector3(),     // unit vector toward the player
            speed: 0,
            spin: 0,
            phase: 0,
            weave: 0,
            hitFlash: 0,
        });
    }

    // --- scratch -----------------------------------------------------------
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _p = new THREE.Vector3();
    const _axis = new THREE.Vector3(0, 1, 0);
    const _toDrone = new THREE.Vector3();
    const _ringQ = new THREE.Quaternion();
    const _ringEuler = new THREE.Euler();
    const _zero = new THREE.Vector3(0, 0, 0);
    const _origin = new THREE.Vector3(0, 0, 0);

    let aliveCount = 0;
    let wave = 1;
    let elapsed = 0;

    /** Result object reused every frame — never allocate one per update. */
    const result = { strikes: 0 };

    function freeSlot() {
        for (let i = 0; i < capacity; i++) if (!drones[i].alive) return i;
        return -1;
    }

    /**
     * Spawn one drone.
     * @param {number} [azCenter] bearing to spawn around, radians. Usually the
     *   direction the player is currently facing.
     * @param {number} [azSpread] half-width of the spawn arc, radians. Omit (or
     *   pass >= PI) for anywhere.
     *
     * The bias exists for onboarding, not difficulty: wave one spread over a
     * full circle means a new player stares at an empty wall while three drones
     * close in behind them, and the game reads as broken. Early waves arrive in
     * front; the arc widens per wave until they really do come from everywhere.
     */
    function spawn(azCenter, azSpread) {
        const i = freeSlot();
        if (i < 0) return -1;
        const d = drones[i];

        const az = (azSpread === undefined || azSpread >= Math.PI)
            ? rngRange(rng, 0, Math.PI * 2)
            : azCenter + rngRange(rng, -azSpread, azSpread);
        const el = rngRange(rng, T.elevMin, T.elevMax);
        const dist = rngRange(rng, T.spawnMin, T.spawnMax);
        const ce = Math.cos(el);
        d.pos.set(
            Math.sin(az) * ce * dist,
            Math.sin(el) * dist,
            -Math.cos(az) * ce * dist
        );

        d.speed = T.baseSpeed + (wave - 1) * T.speedPerWave;
        d.spin = rngRange(rng, 1.6, 3.4) * (rng() > 0.5 ? 1 : -1);
        d.phase = rngRange(rng, 0, Math.PI * 2);
        d.weave = rngRange(rng, 0.6, 1.5);
        d.hitFlash = 0;
        d.alive = true;
        aliveCount++;
        return i;
    }

    /**
     * @param {number} dt
     * @returns {{strikes:number}} reused object; strikes = how many reached you
     */
    function update(dt) {
        elapsed += dt;
        result.strikes = 0;

        for (let i = 0; i < capacity; i++) {
            const d = drones[i];
            if (!d.alive) {
                // Hidden slot: zero scale. Cheaper than resizing the buffer and
                // keeps instance indices stable across the whole run.
                _m.compose(_zero, _q.identity(), _zero);
                body.setMatrixAt(i, _m);
                ring.setMatrixAt(i, _m);
                continue;
            }

            // Straight in, with a lateral weave so tracking one is a skill.
            _toDrone.copy(d.pos).sub(_origin);
            const dist = _toDrone.length();
            if (dist > 1e-4) d.dir.copy(_toDrone).multiplyScalar(-1 / dist);

            const wob = Math.sin(elapsed * d.weave + d.phase) * T.weaveAmp * dt;
            d.pos.addScaledVector(d.dir, d.speed * dt);
            d.pos.x += Math.cos(elapsed * d.weave + d.phase) * wob;
            d.pos.y += Math.sin(elapsed * 1.7 + d.phase) * 0.28 * dt;

            if (dist <= T.strikeRange) {
                d.alive = false;
                aliveCount--;
                result.strikes++;
                continue;
            }

            if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - dt * 4);

            // Body: slow tumble so it reads as a machine, not a billboard.
            _q.setFromAxisAngle(_axis, elapsed * 0.6 + d.phase);
            const pulse = 1 + d.hitFlash * 0.5;
            _s.setScalar(pulse);
            _m.compose(d.pos, _q, _s);
            body.setMatrixAt(i, _m);

            // Ring: spins on its own axis, tilted, so the silhouette changes as
            // it closes and you can read distance without a HUD.
            _ringEuler.set(Math.PI * 0.5, elapsed * d.spin, 0);
            _ringQ.setFromEuler(_ringEuler);
            _m.compose(d.pos, _ringQ, _s);
            ring.setMatrixAt(i, _m);
        }

        body.instanceMatrix.needsUpdate = true;
        ring.instanceMatrix.needsUpdate = true;
        return result;
    }

    /**
     * Nearest live drone whose centre lies within `coneCos` of the ray.
     * Used for the rockets' gentle homing — not for hit detection.
     * @returns {number} index or -1. Zero allocation.
     */
    function nearestInCone(originVec, dirVec, maxDist, coneCos) {
        let best = -1;
        let bestT = Infinity;
        for (let i = 0; i < capacity; i++) {
            const d = drones[i];
            if (!d.alive) continue;
            _p.copy(d.pos).sub(originVec);
            const t = _p.dot(dirVec);
            if (t <= 0 || t > maxDist) continue;
            const len = _p.length();
            if (len < 1e-5) continue;
            if (t / len < coneCos) continue;      // outside the cone
            if (t < bestT) { bestT = t; best = i; }
        }
        return best;
    }

    /** Index of a live drone within `radius` of a point, else -1. Zero alloc. */
    function hitAt(pointVec, radius) {
        const r = radius + T.hitRadius;
        const r2 = r * r;
        for (let i = 0; i < capacity; i++) {
            const d = drones[i];
            if (!d.alive) continue;
            if (d.pos.distanceToSquared(pointVec) <= r2) return i;
        }
        return -1;
    }

    function positionOf(i, out) { return out.copy(drones[i].pos); }

    function kill(i) {
        if (!drones[i] || !drones[i].alive) return false;
        drones[i].alive = false;
        aliveCount--;
        return true;
    }

    function reset() {
        for (let i = 0; i < capacity; i++) drones[i].alive = false;
        aliveCount = 0;
        wave = 1;
        elapsed = 0;
    }

    function dispose() {
        bodyGeo.dispose(); ringGeo.dispose();
        bodyMat.dispose(); ringMat.dispose();
        body.dispose(); ring.dispose();
    }

    return {
        group, spawn, update, nearestInCone, hitAt, positionOf, kill, reset, dispose,
        isAlive(i) { return Boolean(drones[i] && drones[i].alive); },
        get alive() { return aliveCount; },
        get capacity() { return capacity; },
        get wave() { return wave; },
        setWave(w) { wave = w; },
    };
}
