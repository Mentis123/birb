/**
 * weapons.js — rockets and their explosions.
 *
 * Two InstancedMeshes: one for rockets in flight, one for the explosion
 * particles. Birb Mobile used three separate mesh pools for shards, sparks and
 * embers; one pool with a colour ramp does the same job in a third of the draw
 * calls, which matters more here because a camera-passthrough frame is already
 * paying for a video decode.
 *
 * ROCKETS HOME, GENTLY, AND THAT IS DELIBERATE. You are aiming a phone by
 * waving your arms in a room, with no mouse and no analogue stick, at a target
 * that is weaving. Pure ballistics tested as frustrating rather than skilful —
 * every near miss felt like the game's fault. A 0.965 cone (~15 degrees) with a
 * capped turn rate keeps a clean shot feeling earned while forgiving the tremor
 * that holding a phone at arm's length actually produces. Miss by more than the
 * cone and it still sails past.
 *
 * Zero-allocation throughout; pools are built once at capacity.
 */

import { createToonMaterial } from '/gauntlet/src/core/toon.js';
import { PALETTE } from '/gauntlet/src/core/palette.js';
import { makeRng, rngRange } from '/gauntlet/src/core/rng.js';

export const WEAPON_TUNING = Object.freeze({
    rocketSpeed: 26,
    rocketLife: 1.6,
    rocketRadius: 0.16,
    /**
     * cos of the homing HALF-angle. 0.991 ~= 7.6 degrees.
     *
     * This is the real measure of how much the game is helping: it is the
     * angular error a shot can carry and still be saved. It started at 0.965
     * (~15.2 degrees), which at 10m is a 2.7m forgiveness radius — wide enough
     * that shots which plainly deserved to miss were landing, and the assist
     * stopped feeling like assistance and started feeling like aimbot. Halved.
     * A clean shot is still rescued from hand tremor; a lazy one is not.
     */
    homingCone: 0.991,
    /**
     * Radians/sec of course correction, halved alongside the cone so the pull
     * stays proportionate to the window. Still ample: the worst case is now
     * nulling 0.133 rad, which takes 0.078s — under a fifth of a metre of a
     * typical 12m flight — so an acquired target is still reliably hit.
     */
    homingRate: 1.7,
    homingRange: 26,
    cooldown: 0.28,           // seconds between shots
    particleCount: 96,
    particleLife: 0.75,
});

export function createWeapons(THREE, opts = {}) {
    const W = WEAPON_TUNING;
    const rocketCap = opts.rocketCapacity ?? 12;
    const partCap = opts.particleCapacity ?? W.particleCount;
    const rng = makeRng(opts.seed ?? 0x0f1e);

    const group = new THREE.Group();

    // --- rockets -----------------------------------------------------------
    // Cone pointing +Y by default; rotated so it lies along -Z to match the
    // project's forward convention, then aimed with a quaternion each frame.
    const rocketGeo = new THREE.ConeGeometry(W.rocketRadius, W.rocketRadius * 4.2, 7);
    rocketGeo.rotateX(-Math.PI / 2);
    const rocketMat = createToonMaterial(THREE, {
        color: PALETTE.uiGold,
        rimStrength: 1.0,
        specStrength: 0.8,
        fog: false,
    });
    const rocketMesh = new THREE.InstancedMesh(rocketGeo, rocketMat, rocketCap);
    rocketMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rocketMesh.frustumCulled = false;
    group.add(rocketMesh);

    // --- explosion particles ----------------------------------------------
    const partGeo = new THREE.TetrahedronGeometry(0.085, 0);
    const partMat = new THREE.MeshBasicMaterial({
        color: PALETTE.impactPuff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        toneMapped: false,
        fog: false,
    });
    const partMesh = new THREE.InstancedMesh(partGeo, partMat, partCap);
    partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    partMesh.frustumCulled = false;
    group.add(partMesh);

    // --- pools -------------------------------------------------------------
    const rockets = [];
    for (let i = 0; i < rocketCap; i++) {
        rockets.push({
            alive: false,
            pos: new THREE.Vector3(),
            dir: new THREE.Vector3(),
            life: 0,
            target: -1,
        });
    }

    const parts = [];
    for (let i = 0; i < partCap; i++) {
        parts.push({
            alive: false,
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            life: 0,
            spin: 0,
        });
    }
    let partCursor = 0;

    // --- scratch -----------------------------------------------------------
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(1, 1, 1);
    const _zero = new THREE.Vector3(0, 0, 0);
    const _fwd = new THREE.Vector3(0, 0, -1);
    const _want = new THREE.Vector3();
    const _tPos = new THREE.Vector3();
    const _axis = new THREE.Vector3();
    const _hit = new THREE.Vector3();

    let cooldown = 0;

    /** Reused; never allocate a result object per frame. */
    const result = { kills: 0, hitX: 0, hitY: 0, hitZ: 0 };

    function canFire() { return cooldown <= 0; }

    /**
     * @param {THREE.Vector3} origin
     * @param {THREE.Vector3} dir unit
     * @returns {boolean} whether a rocket actually left the tube
     */
    function fire(origin, dir) {
        if (cooldown > 0) return false;
        for (let i = 0; i < rocketCap; i++) {
            const r = rockets[i];
            if (r.alive) continue;
            r.pos.copy(origin);
            r.dir.copy(dir).normalize();
            r.life = W.rocketLife;
            r.target = -1;
            r.alive = true;
            cooldown = W.cooldown;
            return true;
        }
        return false;
    }

    function burst(x, y, z, count, colorHex) {
        for (let n = 0; n < count; n++) {
            const p = parts[partCursor];
            partCursor = (partCursor + 1) % partCap;
            p.pos.set(x, y, z);
            // Even-ish sphere of debris with a seeded jitter.
            const a = rngRange(rng, 0, Math.PI * 2);
            const u = rngRange(rng, -1, 1);
            const s = Math.sqrt(Math.max(0, 1 - u * u));
            const spd = rngRange(rng, 2.2, 6.4);
            p.vel.set(Math.cos(a) * s, u, Math.sin(a) * s).multiplyScalar(spd);
            p.life = W.particleLife * rngRange(rng, 0.7, 1.15);
            p.spin = rngRange(rng, -9, 9);
            p.alive = true;
        }
        if (colorHex !== undefined) partMat.color.setHex(colorHex);
    }

    /**
     * @param {number} dt
     * @param {object} drones the swarm, for homing and hit tests
     * @returns {{kills:number, hitX:number, hitY:number, hitZ:number}} reused
     */
    function update(dt, drones) {
        if (cooldown > 0) cooldown -= dt;
        result.kills = 0;

        // --- rockets -------------------------------------------------------
        for (let i = 0; i < rocketCap; i++) {
            const r = rockets[i];
            if (!r.alive) {
                _m.compose(_zero, _q.identity(), _zero);
                rocketMesh.setMatrixAt(i, _m);
                continue;
            }

            // Acquire once, then hold — re-acquiring every frame makes a rocket
            // flick between two drones and fly between them forever.
            if (r.target < 0 && drones) {
                r.target = drones.nearestInCone(r.pos, r.dir, W.homingRange, W.homingCone);
            }
            if (r.target >= 0 && drones) {
                drones.positionOf(r.target, _tPos);
                _want.copy(_tPos).sub(r.pos);
                if (_want.lengthSq() > 1e-6) {
                    _want.normalize();
                    // Rotate dir toward want, capped at homingRate.
                    const dot = Math.max(-1, Math.min(1, r.dir.dot(_want)));
                    const ang = Math.acos(dot);
                    const step = Math.min(ang, W.homingRate * dt);
                    if (ang > 1e-4) {
                        _axis.copy(r.dir).cross(_want);
                        if (_axis.lengthSq() > 1e-8) {
                            _axis.normalize();
                            _q.setFromAxisAngle(_axis, step);
                            r.dir.applyQuaternion(_q).normalize();
                        }
                    }
                }
            }

            r.pos.addScaledVector(r.dir, W.rocketSpeed * dt);
            r.life -= dt;

            const hitIdx = drones ? drones.hitAt(r.pos, W.rocketRadius) : -1;
            if (hitIdx >= 0) {
                drones.positionOf(hitIdx, _hit);
                drones.kill(hitIdx);
                burst(_hit.x, _hit.y, _hit.z, 16, PALETTE.sparkCyan);
                result.kills++;
                result.hitX = _hit.x; result.hitY = _hit.y; result.hitZ = _hit.z;
                r.alive = false;
                _m.compose(_zero, _q.identity(), _zero);
                rocketMesh.setMatrixAt(i, _m);
                continue;
            }

            if (r.life <= 0) {
                r.alive = false;
                _m.compose(_zero, _q.identity(), _zero);
                rocketMesh.setMatrixAt(i, _m);
                continue;
            }

            _q.setFromUnitVectors(_fwd, r.dir);
            _s.setScalar(1);
            _m.compose(r.pos, _q, _s);
            rocketMesh.setMatrixAt(i, _m);
        }
        rocketMesh.instanceMatrix.needsUpdate = true;

        // --- particles -----------------------------------------------------
        for (let i = 0; i < partCap; i++) {
            const p = parts[i];
            if (!p.alive) {
                _m.compose(_zero, _q.identity(), _zero);
                partMesh.setMatrixAt(i, _m);
                continue;
            }
            p.life -= dt;
            if (p.life <= 0) {
                p.alive = false;
                _m.compose(_zero, _q.identity(), _zero);
                partMesh.setMatrixAt(i, _m);
                continue;
            }
            p.vel.y -= 5.2 * dt;                 // a little gravity so debris falls
            p.vel.multiplyScalar(1 - 1.8 * dt);  // drag
            p.pos.addScaledVector(p.vel, dt);
            const k = p.life / W.particleLife;
            _q.setFromAxisAngle(_fwd, p.spin * p.life);
            _s.setScalar(0.4 + k * 0.9);
            _m.compose(p.pos, _q, _s);
            partMesh.setMatrixAt(i, _m);
        }
        partMesh.instanceMatrix.needsUpdate = true;

        return result;
    }

    function reset() {
        for (let i = 0; i < rocketCap; i++) rockets[i].alive = false;
        for (let i = 0; i < partCap; i++) parts[i].alive = false;
        cooldown = 0;
    }

    function dispose() {
        rocketGeo.dispose(); partGeo.dispose();
        rocketMat.dispose(); partMat.dispose();
        rocketMesh.dispose(); partMesh.dispose();
    }

    return {
        group, fire, burst, update, reset, dispose, canFire,
        get cooldown01() { return Math.max(0, cooldown / W.cooldown); },
    };
}
