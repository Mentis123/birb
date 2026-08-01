/**
 * nesting/drones.js — Birb Gauntlet's hostile drone swarm.
 *
 * Port of Birb Mobile's `src/nesting/drone-system.js` (742 lines). Re-implemented,
 * never imported: `gauntlet/` stays airtight against the parent `src/`.
 *
 * ============================================================================
 * WHAT PORTS VERBATIM — the feel constants
 * ============================================================================
 *   ORBIT_SPEED            0.150 rad/s   base angular rate around the planet
 *   ORBIT_SPEED_VARIANCE   0.4           -> per-drone multiplier 0.8 .. 1.2
 *   COLLISION_RADIUS       9.9           drone hit sphere
 *   BIRD_COLLISION_RADIUS  1.5           default bird radius added to it
 *   RESPAWN_DELAY          2.0 s         before a maintained population refills
 *   RING_SPIN_RATE         2.4 rad/s     the ring's own spin
 *   BODY_RADIUS            5.4           octahedron core (the original's 4x-world
 *                                        body, +50% from the density pass)
 *   RING_RADIUS            8.1           halo radius
 *
 * These were tuned over weeks against real hands. They are copied, not
 * re-derived. Two of them I would question if I had a vote — see the report:
 * 0.150 rad/s alone can never catch a 27 u/s bird, and 9.9 is a hit sphere
 * larger than the visible ring. Both are copied anyway; hunt applies a SEPARATE
 * authored multiplier rather than editing the base rate.
 *
 * ============================================================================
 * WHAT DID NOT PORT VERBATIM, AND WHY — the altitude band
 * ============================================================================
 * The original's band is `minAltitude 128 .. maxAltitude 148` as ABSOLUTE
 * radii on a baseline-120 world, i.e. **+8 .. +28 above the baseline**. Birb
 * Gauntlet's baseline is `PLANET_RADIUS = 100`, so the absolute numbers are
 * meaningless here and the OFFSET is the thing that carries meaning. Ported as
 * offsets: +8 .. +26.
 *
 * The top of the band is clipped 28 -> 26 for one specific reason:
 * `FLIGHT_CONFIG.maxAltitude` is exactly 26, a hard soft-ceiling the bird
 * cannot climb past. A drone parked at +28 would be permanently unrammable,
 * which silently breaks Drone Hunter's only scoring verb. Everything else about
 * the band is the original's.
 *
 * The mesh sizes (5.4 / 8.1) are NOT rescaled for the smaller planet, and that
 * is deliberate: the bird is the same absolute size in both games (~2.4 units),
 * so it is the drone:bird ratio that carries the feel, not the drone:planet
 * ratio. A drone stays a shape roughly three bird-lengths across. The one
 * consequence worth knowing is that the planet is 17% smaller, so the same
 * drone eats 17% more of the horizon — which reads as MORE threatening, not
 * less, and is the right side of that trade for a hunt mode.
 *
 * ============================================================================
 * THE STRUCTURAL CHANGE — two draw calls for any number of drones
 * ============================================================================
 * The original built a `THREE.Group` per drone (body Mesh + ring Mesh + two
 * materials) and wrote `emissiveIntensity` on every one of them every frame. At
 * 2 draw calls each that is where its own comment admits the mobile cap came
 * from: "drones are individual meshes, not instanced — each is 2 draw calls —
 * so phones can't afford more." Here the whole swarm is TWO InstancedMeshes
 * (body, ring) regardless of population, so density is a tuning decision rather
 * than a budget decision, and a 24-drone wave costs exactly what 4 do.
 *
 * The explosion is NOT ported. `nesting/rockets.js` already owns a pooled,
 * instanced, cel-styled detonation and duplicating it here would be a second
 * visual language for the same event. Call `rockets.explodeAt(x, y, z, power)`
 * from the kill callback — see the report's wiring notes.
 *
 * ============================================================================
 * BEHAVIOURS ARE CAPABILITY-DRIVEN
 * ============================================================================
 * This module never compares a mode id. The caller reads `modeDef(mode).drones`
 * and hands the resulting string straight to `setBehaviour`.
 *
 *   'off'      nothing alive.
 *   'ambient'  a handful drifting fixed orbits at bird cruise altitude.
 *              Dodgeable scenery for Casual. They do NOT chase.
 *   'hunt'     dense, and the orbit plane slews to pass through the bird, so
 *              they curve onto you instead of tracking like a missile.
 *   'waves'    spawnWave(count, nestIndex): they converge on that NEST and
 *              attack it. Turret Defense's whole threat model.
 *
 * The homing model is the same in hunt and waves and it is the one interesting
 * idea in this file: a drone always travels along a great circle about its own
 * `orbitAxis`, exactly as the original did. To chase, we do not steer the
 * POSITION — we slew the AXIS toward `normalize(cross(dronePos, targetPos))`,
 * the axis of the great circle that already passes through both. Rotating a
 * point about that axis moves it toward the target along the shortest arc, so
 * a hunting drone banks onto an intercept curve and keeps the orbital motion
 * that makes the ambient ones read as machines rather than as arrows.
 *
 * ZERO ALLOCATION in update(): every drone lives in flat typed arrays, the
 * rotation is Rodrigues in scalar math, and the only objects touched per frame
 * are the `_` scratch created once in the factory.
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import { makeRng, rngRange, fibonacciDirection } from '../core/rng.js';
import { PLANET_RADIUS } from '../core/terrain.js';

// ---------------------------------------------------------------------------
// Feel constants — VERBATIM from Birb Mobile's DRONE_CONFIG
// ---------------------------------------------------------------------------

/** Base radians per second. Angular, so it is scale-independent. */
export const ORBIT_SPEED = 0.150;
/** Per-drone speed varies by this fraction: multiplier lands in 0.8 .. 1.2. */
export const ORBIT_SPEED_VARIANCE = 0.4;
/** Hit sphere radius. */
export const COLLISION_RADIUS = 9.9;
/** Default bird radius added to COLLISION_RADIUS for a ram. */
export const BIRD_COLLISION_RADIUS = 1.5;
/** Seconds before a maintained population refills a dead slot. */
export const RESPAWN_DELAY = 2.0;
/** The ring's own spin, slowed in the original to match the gentler orbit. */
const RING_SPIN_RATE = 2.4;

/** Mesh scale. Original's 4x-world body/halo after the +50% density pass. */
const BODY_RADIUS = 5.4;
const RING_RADIUS = 8.1;

/**
 * Altitude band, as an OFFSET above PLANET_RADIUS. See the header: the
 * original's absolute 128..148 on a 120 baseline is +8..+28, and +28 is clipped
 * to +26 because that is the bird's hard flight ceiling.
 */
const MIN_ALT_OFFSET = 8;
const MAX_ALT_OFFSET = 26;

// ---------------------------------------------------------------------------
// Authored constants — NOT from the original, which had no chase behaviour at
// all (its drones only ever orbited; "hunting" was the player doing the work).
// ---------------------------------------------------------------------------

/**
 * Angular-rate multiplier while hunting. 0.150 rad/s at r~115 is ~17 u/s and
 * the bird cruises at 27, so an unmultiplied drone can never close — it would
 * be scenery wearing a hunt label. 1.6x puts it at ~27.6 u/s: a shade faster
 * than cruise, so it closes, but slower than a boost, so the player can always
 * choose to disengage.
 */
const HUNT_SPEED_MUL = 1.6;
/** Waves commit to the nest rather than to a chase; less overspeed needed. */
const WAVE_SPEED_MUL = 1.25;

/** How fast the orbit axis slews onto the intercept axis, per second. */
const HUNT_AXIS_SLEW = 1.4;
const WAVE_AXIS_SLEW = 1.9;

/** How fast a chasing drone matches its target's altitude, in u/s. */
const ALT_SLEW = 6.0;

/** A wave drone this close to its nest lands its attack and is consumed. */
const NEST_ATTACK_RANGE = 12.0;

/** Vertical bob so a drifting swarm is not a set of perfect circles. */
const BOB_AMPLITUDE = 1.6;
const BOB_RATE = 0.9;

/**
 * Population per behaviour per tier.
 *
 * The base row is the original's: 8 on mobile, `round(8 * 1.5)` = 12 on
 * desktop. Ambient takes a little over half of it ("a handful ... dodgeable
 * scenery"), hunt takes 1.5x of it, which the original could not afford at 2
 * draw calls per drone and this can at 2 draw calls per swarm.
 */
const TIERS = {
    low: { base: 8, ambient: 5, hunt: 12, capacity: 20 },
    mid: { base: 8, ambient: 5, hunt: 12, capacity: 24 },
    high: { base: 12, ambient: 7, hunt: 18, capacity: 30 },
};

// ---------------------------------------------------------------------------
// Geometry — every mesh procedural, zero external assets.
// ---------------------------------------------------------------------------

/**
 * Concatenate positioned primitives into one non-indexed geometry with baked
 * vertex colours. Build time only, so it may allocate freely.
 */
function mergeParts(THREE, parts) {
    const prepped = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
        const src = parts[i].geo;
        const g = src.index ? src.toNonIndexed() : src.clone();
        g.computeVertexNormals();
        prepped.push({ g, color: parts[i].color, shade: parts[i].shade || null });
        total += g.getAttribute('position').count;
        src.dispose();
    }

    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const col = new THREE.Color();

    let o = 0;
    for (let k = 0; k < prepped.length; k++) {
        const { g, color, shade } = prepped[k];
        const gp = g.getAttribute('position');
        const gn = g.getAttribute('normal');
        col.setHex(color);
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
 * The drone body. Forward is -Z (house convention), up is +Y.
 *
 * The original was a single smooth-shaded emissive octahedron: a red diamond
 * with a bloom on it, which under a stepped toon ramp is a flat magenta blob
 * with no front, no back and no read at 40 units. Four parts fix that and the
 * whole reason for each one is silhouette or orientation, never decoration:
 *
 *   CORE    the octahedron, kept — it is the shape the original taught players
 *           to recognise. Stretched 1.22 on Z so it has a nose rather than
 *           being rotationally identical from every angle.
 *   COLLAR  an ink-dark octagonal band around the waist. This is the single
 *           highest-value part: a hard black stripe across a bright body
 *           survives at any distance and at any lighting angle, where a
 *           gradient does not. It is also what makes the body read as
 *           MANUFACTURED next to the planet's hand-carved everything.
 *   EYE     a cyan cone at the nose. Cold against the warm body, so it is the
 *           first thing the eye finds, and it points at the thing the drone is
 *           about to hit. A hostile object whose facing you cannot read is not
 *           a threat, it is a hazard.
 *   SPINES  four short blades at the equator, angled back. They break the
 *           closed convex outline, which is what stops the drone reading as a
 *           ball once it is small enough that the collar is one pixel.
 */
function buildBodyGeometry(THREE) {
    const parts = [];

    const shell = new THREE.Color(PALETTE.boostPad);
    const shellDeep = new THREE.Color(PALETTE.boostPad).lerp(new THREE.Color(PALETTE.ink), 0.58);

    // --- core ---------------------------------------------------------------
    const core = new THREE.OctahedronGeometry(BODY_RADIUS, 0);
    core.scale(0.94, 0.84, 1.22);
    parts.push({
        geo: core,
        color: PALETTE.boostPad,
        // Hard-ish top/bottom split baked into the base colour so the underside
        // stays dark even when the key light is behind the drone. Under a
        // 2-band ramp the LIGHTING cannot do this on its own.
        shade: (x, y) => (y > 0.2 ? 1.18 : (y < -0.6 ? 0.42 : 0.78)),
    });

    // --- collar -------------------------------------------------------------
    // Open-ended: it is a band, not a tube, and nobody ever sees a cap.
    const collar = new THREE.CylinderGeometry(
        BODY_RADIUS * 0.86, BODY_RADIUS * 0.86, BODY_RADIUS * 0.40, 8, 1, true
    );
    parts.push({ geo: collar, color: PALETTE.ink, shade: () => 1 });

    // --- eye ----------------------------------------------------------------
    // Apex forward (-Z). ConeGeometry points +Y, so rotate onto -Z.
    const eye = new THREE.ConeGeometry(BODY_RADIUS * 0.34, BODY_RADIUS * 0.62, 6, 1, true);
    eye.rotateX(-Math.PI / 2);
    eye.translate(0, 0, -BODY_RADIUS * 1.14);
    parts.push({
        geo: eye,
        color: PALETTE.uiCyan,
        // Hot at the tip, cooling toward the socket. A flat cyan cone reads as
        // a plastic nose; the step reads as something switched on.
        shade: (x, y, z) => (z < -BODY_RADIUS * 1.30 ? 1.55 : 0.72),
    });

    // A dark socket ring so the eye is set INTO the hull rather than glued on.
    const socket = new THREE.CylinderGeometry(
        BODY_RADIUS * 0.40, BODY_RADIUS * 0.40, BODY_RADIUS * 0.16, 6, 1, true
    );
    socket.rotateX(Math.PI / 2);
    socket.translate(0, 0, -BODY_RADIUS * 0.86);
    parts.push({ geo: socket, color: PALETTE.ink, shade: () => 1 });

    // --- spines -------------------------------------------------------------
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const spine = new THREE.ConeGeometry(BODY_RADIUS * 0.20, BODY_RADIUS * 0.74, 4, 1, true);
        spine.rotateZ(-Math.PI / 2);              // point along +X
        spine.translate(BODY_RADIUS * 0.37, 0, 0);
        spine.rotateY(0.42);                      // rake them backward
        spine.rotateY(-a);
        spine.translate(0, 0, BODY_RADIUS * 0.30);
        parts.push({
            geo: spine,
            color: PALETTE.boostPad,
            shade: () => 0.66,
        });
    }

    const geo = mergeParts(THREE, parts);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), BODY_RADIUS * 1.6);
    // Colours were mixed above for readability; keep the two THREE.Color
    // instances referenced so a future edit does not silently drop them.
    void shell; void shellDeep;
    return geo;
}

/**
 * The halo ring, lying in the XZ plane so it spins about local +Y.
 *
 * `radialSegments: 4` is the whole cel trick here — a 4-sided tube is a SQUARE
 * cross-section, so the ring is a faceted band with hard highlights rather than
 * a smooth chrome donut, and it costs 160 triangles. The original's
 * `TorusGeometry(8.1, 0.54, 8, 24)` was 384 triangles of smooth tube rendered
 * in MeshBasicMaterial at 0.7 opacity — a translucent hoop, which is exactly
 * the soft-alpha look this project rules out.
 *
 * Tube thickness is authored (0.54 -> 0.92): at 0.54 the ring is 6.6% of its own
 * radius and disappears to a hairline at any real distance. Radius 8.1 is the
 * ported number and is untouched, because THAT is what sets apparent size
 * against the 9.9 hit sphere.
 */
function buildRingGeometry(THREE) {
    const torus = new THREE.TorusGeometry(RING_RADIUS, 0.92, 4, 20);
    torus.rotateX(Math.PI / 2);
    const parts = [{
        geo: torus,
        color: PALETTE.boostPad,
        // Two-tone across the tube's own thickness: the outer face catches, the
        // inner face stays dark, so the hoop has a visible edge from any angle.
        shade: (x, y, z) => (Math.hypot(x, z) > RING_RADIUS ? 1.42 : 0.58),
    }];
    const geo = mergeParts(THREE, parts);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), RING_RADIUS + 1.2);
    return geo;
}

// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} [opts]
 * @param {'low'|'mid'|'high'} [opts.quality]
 * @param {number} [opts.seed]
 * @param {object} [opts.planet]   accepted, currently unused (reserved for
 *                                 asking the planet for a spawn-clear test)
 * @param {object} [opts.nests]    the nests api; spawnWave targets nests[i]
 * @param {number} [opts.capacity] hard slot override (probes/tests)
 * @param {Function} [opts.onKill] (index, x, y, z) whenever a drone dies
 */
export function createDrones(THREE, opts = {}) {
    const quality = opts.quality || 'high';
    const tier = TIERS[quality] || TIERS.high;
    const CAP = Math.max(1, opts.capacity || tier.capacity);
    const nests = opts.nests || null;
    const rng = makeRng(opts.seed ?? 0xd7043);

    const group = new THREE.Group();
    group.name = 'gauntlet-drones';

    // --- meshes ----------------------------------------------------------
    const bodyGeo = buildBodyGeometry(THREE);
    const ringGeo = buildRingGeometry(THREE);

    /**
     * 'graphic' is the two-band ramp — maximum step contrast, which a small
     * fast hostile object needs to stay legible against green meadow, ochre
     * canyon AND pale alpine.
     *
     * The rim is CYAN and strong, against a magenta body. That is the one
     * decision that makes drones read at distance: the planet is warm
     * (meadow green, canyon ochre, golden sky) end to end, so a cold rim is
     * the only hue in the frame that nothing else owns. `rimThreshold` is
     * pulled in to 0.44 and `rimPower` down to 1.7 so the halo is WIDE — a
     * thin rim vanishes on a 30px object, which is the size a drone is when
     * you actually need to see it coming.
     */
    const bodyMat = createToonMaterial(THREE, {
        ramp: 'graphic',
        vertexColors: true,
        flatShading: true,
        rimColor: PALETTE.uiCyan,
        rimStrength: 0.78,
        rimPower: 1.7,
        rimThreshold: 0.44,
        rimSoftness: 0.05,
        specColor: PALETTE.uiCream,
        specStrength: 0.42,
        specPower: 30,
        specThreshold: 0.54,
    });

    const ringMat = createToonMaterial(THREE, {
        ramp: 'emissive',
        vertexColors: true,
        flatShading: true,
        rimColor: PALETTE.uiCyan,
        rimStrength: 0.62,
        rimPower: 1.8,
        rimThreshold: 0.46,
        rimSoftness: 0.05,
        specStrength: 0,
    });

    const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, CAP);
    const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, CAP);
    for (const m of [bodyMesh, ringMesh]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;   // instances are spread over the whole planet
        m.castShadow = false;
        m.receiveShadow = false;
        m.raycast = () => {};
        group.add(m);
    }
    bodyMesh.name = 'gauntlet-drone-bodies';
    ringMesh.name = 'gauntlet-drone-rings';

    // --- per-drone state, flat typed arrays ------------------------------
    const px = new Float32Array(CAP);
    const py = new Float32Array(CAP);
    const pz = new Float32Array(CAP);
    const axx = new Float32Array(CAP);   // orbit axis (unit)
    const axy = new Float32Array(CAP);
    const axz = new Float32Array(CAP);
    const spd = new Float32Array(CAP);   // per-drone angular rate
    const alt = new Float32Array(CAP);   // base altitude (world radius)
    const phase = new Float32Array(CAP); // ring spin / bob / pulse phase
    const bobPh = new Float32Array(CAP);
    const nestOf = new Int16Array(CAP).fill(-1);
    const alive = new Uint8Array(CAP);
    const respawn = new Float32Array(CAP);

    let liveCount = 0;
    let behaviour = 'off';
    let disposed = false;
    let fibCursor = 0;

    // --- scratch (the only objects touched per frame) --------------------
    const _pos = new THREE.Vector3();
    const _scl = new THREE.Vector3();
    const _one = new THREE.Vector3(1, 1, 1);
    const _zero = new THREE.Vector3(0, 0, 0);
    const _quat = new THREE.Quaternion();
    const _spin = new THREE.Quaternion();
    const _ident = new THREE.Quaternion();
    const _mat = new THREE.Matrix4();
    const _bx = new THREE.Vector3();
    const _by = new THREE.Vector3();
    const _bz = new THREE.Vector3();
    const _localY = new THREE.Vector3(0, 1, 0);
    const _fib = { x: 0, y: 0, z: 0 };
    const _target = new THREE.Vector3();

    /** The reused return object. Never reallocated. */
    const _result = {
        hitBird: -1, hitX: 0, hitY: 0, hitZ: 0,
        nestHits: 0, nestHitIndex: -1, nestHitX: 0, nestHitY: 0, nestHitZ: 0,
    };

    /**
     * Collision targets for `rockets.update(dt, targets)`. Fixed length CAP;
     * a dead slot is `null`, which rockets already skips. Fixed length + null
     * holes is what keeps this allocation-free — mutating `.length` every frame
     * would churn the backing store.
     */
    const targets = new Array(CAP);
    const targetPool = new Array(CAP);
    for (let i = 0; i < CAP; i++) {
        targetPool[i] = { x: 0, y: 0, z: 0, radius: COLLISION_RADIUS, index: i };
        targets[i] = null;
    }

    // Body colour steps. The original pulsed `emissiveIntensity` smoothly
    // between 0.2 and 1.0; a smooth pulse under a cel ramp is a dimmer knob, so
    // it is quantised to three levels here and the pulse reads as a beacon.
    const PULSE_STEPS = [0.86, 1.00, 1.24];

    // Zero every slot so untouched instances draw nothing.
    _mat.compose(_zero, _ident, _zero);
    for (let i = 0; i < CAP; i++) {
        bodyMesh.setMatrixAt(i, _mat);
        ringMesh.setMatrixAt(i, _mat);
        bodyMesh.instanceColor.setXYZ(i, 1, 1, 1);
        ringMesh.instanceColor.setXYZ(i, 1, 1, 1);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceMatrix.needsUpdate = true;
    bodyMesh.instanceColor.needsUpdate = true;
    ringMesh.instanceColor.needsUpdate = true;

    // -----------------------------------------------------------------------
    // Spawning
    // -----------------------------------------------------------------------

    /** First free slot, or -1. */
    function freeSlot() {
        for (let i = 0; i < CAP; i++) if (!alive[i] && respawn[i] <= 0) return i;
        for (let i = 0; i < CAP; i++) if (!alive[i]) return i;
        return -1;
    }

    /**
     * Give slot `i` a fresh orbit axis perpendicular to its radial. The
     * original crossed the radial with a random vector; the same idea, but the
     * random vector comes from the seeded rng so a capture is repeatable.
     */
    function seedAxis(i, nx, ny, nz) {
        let rx = rng() - 0.5, ry = rng() - 0.5, rz = rng() - 0.5;
        // cross(radial, random)
        let ax = ny * rz - nz * ry;
        let ay = nz * rx - nx * rz;
        let az = nx * ry - ny * rx;
        let len = Math.hypot(ax, ay, az);
        if (!(len > 1e-3)) {
            // Degenerate (random vector parallel to radial). Any perpendicular
            // will do; take the one from the smallest radial component.
            if (Math.abs(nx) < 0.9) { ax = 0; ay = nz; az = -ny; }
            else { ax = -nz; ay = 0; az = nx; }
            len = Math.hypot(ax, ay, az) || 1;
        }
        axx[i] = ax / len; axy[i] = ay / len; axz[i] = az / len;
    }

    /**
     * Place a drone on the unit direction (nx, ny, nz).
     * @returns {number} the slot used, or -1 if the swarm is full.
     */
    function spawnAt(nx, ny, nz, nestIndex, altitudeOverride) {
        const i = freeSlot();
        if (i < 0) return -1;

        const r = altitudeOverride != null
            ? altitudeOverride
            : PLANET_RADIUS + rngRange(rng, MIN_ALT_OFFSET, MAX_ALT_OFFSET);

        px[i] = nx * r; py[i] = ny * r; pz[i] = nz * r;
        alt[i] = r;
        seedAxis(i, nx, ny, nz);
        // VERBATIM: base * (1 - variance/2 + rand * variance) -> 0.8x .. 1.2x
        spd[i] = ORBIT_SPEED *
            (1 - ORBIT_SPEED_VARIANCE / 2 + rng() * ORBIT_SPEED_VARIANCE);
        phase[i] = rng() * Math.PI * 2;
        bobPh[i] = rng() * Math.PI * 2;
        nestOf[i] = nestIndex == null ? -1 : nestIndex;
        respawn[i] = 0;
        alive[i] = 1;
        liveCount++;
        targets[i] = targetPool[i];
        writeInstance(i, 1);
        return i;
    }

    /** Spawn on the next fibonacci direction, jittered. Deterministic. */
    function spawnScattered(nestIndex) {
        fibonacciDirection(fibCursor % 233, 233, _fib, rng, 0.45);
        fibCursor += 37;   // coprime with 233, so the lattice is walked evenly
        return spawnAt(_fib.x, _fib.y, _fib.z, nestIndex);
    }

    /** How many drones this behaviour wants standing at all times. */
    function desiredPopulation() {
        if (behaviour === 'ambient') return Math.min(CAP, tier.ambient);
        if (behaviour === 'hunt') return Math.min(CAP, tier.hunt);
        return 0;   // 'off' has none; 'waves' is driven by spawnWave only
    }

    // -----------------------------------------------------------------------
    // Instance writing
    // -----------------------------------------------------------------------

    /**
     * Compose the body and ring matrices for slot `i`.
     *
     * Up is RADIAL. Forward is the orbit tangent, and because the house
     * convention is -Z forward, the basis' third column is the BACKWARD vector.
     */
    function writeInstance(i, pulse) {
        const x = px[i], y = py[i], z = pz[i];
        const rl = Math.hypot(x, y, z) || 1;
        const ux = x / rl, uy = y / rl, uz = z / rl;

        // tangent = cross(axis, radial) — the direction of travel.
        let tx = axy[i] * uz - axz[i] * uy;
        let ty = axz[i] * ux - axx[i] * uz;
        let tz = axx[i] * uy - axy[i] * ux;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-4) { tx /= tl; ty /= tl; tz /= tl; }
        else { tx = 1; ty = 0; tz = 0; }

        _by.set(ux, uy, uz);
        _bz.set(-tx, -ty, -tz);          // -Z is forward, so +Z is backward
        _bx.crossVectors(_by, _bz).normalize();
        _bz.crossVectors(_bx, _by).normalize();
        _mat.makeBasis(_bx, _by, _bz);
        _quat.setFromRotationMatrix(_mat);

        _pos.set(x, y, z);
        _mat.compose(_pos, _quat, _one);
        bodyMesh.setMatrixAt(i, _mat);

        // The ring shares the body's frame and adds its own spin about local Y.
        _spin.setFromAxisAngle(_localY, phase[i]);
        _spin.premultiply(_quat);
        _mat.compose(_pos, _spin, _one);
        ringMesh.setMatrixAt(i, _mat);

        bodyMesh.instanceColor.setXYZ(i, pulse, pulse, pulse);
        // The ring counter-pulses, so body and halo never peak together and the
        // drone reads as breathing rather than as flickering.
        const rp = 2.1 - pulse;
        ringMesh.instanceColor.setXYZ(i, rp, rp, rp);

        const t = targetPool[i];
        t.x = x; t.y = y; t.z = z;
    }

    function hideInstance(i) {
        _mat.compose(_zero, _ident, _zero);
        bodyMesh.setMatrixAt(i, _mat);
        ringMesh.setMatrixAt(i, _mat);
        targets[i] = null;
    }

    // -----------------------------------------------------------------------
    // Killing
    // -----------------------------------------------------------------------

    function killAt(i) {
        if (i < 0 || i >= CAP || !alive[i]) return false;
        const x = px[i], y = py[i], z = pz[i];
        alive[i] = 0;
        liveCount--;
        nestOf[i] = -1;
        hideInstance(i);
        // Only maintained populations refill. A wave is finite by definition:
        // refilling one would mean Turret Defense could never end a round.
        respawn[i] = (behaviour === 'ambient' || behaviour === 'hunt') ? RESPAWN_DELAY : 0;
        if (opts.onKill) opts.onKill(i, x, y, z);
        return true;
    }

    function clear() {
        for (let i = 0; i < CAP; i++) {
            if (alive[i]) { alive[i] = 0; liveCount--; }
            respawn[i] = 0;
            nestOf[i] = -1;
            hideInstance(i);
        }
        liveCount = 0;
        bodyMesh.instanceMatrix.needsUpdate = true;
        ringMesh.instanceMatrix.needsUpdate = true;
    }

    // -----------------------------------------------------------------------
    // Behaviour
    // -----------------------------------------------------------------------

    function setBehaviour(next) {
        const b = (next === 'ambient' || next === 'hunt' || next === 'waves') ? next : 'off';
        if (b === behaviour) return;
        behaviour = b;
        if (b === 'off' || b === 'waves') {
            // A mode switch is a hard reset: leaving stale ambient drones in a
            // Turret Defense arena would count as wave kills.
            clear();
            return;
        }
        // Ambient/hunt: converge on the new population immediately rather than
        // trickling in over RESPAWN_DELAY. A mode start should look intentional.
        const want = desiredPopulation();
        for (let i = 0; i < CAP; i++) respawn[i] = 0;
        while (liveCount > want) {
            for (let i = CAP - 1; i >= 0; i--) {
                if (alive[i]) { alive[i] = 0; liveCount--; hideInstance(i); break; }
            }
        }
        while (liveCount < want && spawnScattered(-1) >= 0) { /* fill */ }
        bodyMesh.instanceMatrix.needsUpdate = true;
        ringMesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Spawn `count` drones converging on nest `nestIndex`.
     *
     * They appear on a ring of directions standing off from the nest, not on
     * top of it — a wave that materialises inside turret range is not a wave,
     * it is an ambush, and the player never gets to see it coming. The
     * stand-off is angular so it is the same ground distance everywhere.
     *
     * @returns {number} how many actually spawned (capacity-limited).
     */
    function spawnWave(count, nestIndex) {
        if (disposed) return 0;
        if (!nests || nestIndex == null || nestIndex < 0 || nestIndex >= nests.count) return 0;

        nests.normalOf(nestIndex, _target);
        const nx = _target.x, ny = _target.y, nz = _target.z;

        // Build an orthonormal basis in the tangent plane at the nest so the
        // stand-off ring is genuinely a circle around it.
        let ex, ey, ez;
        if (Math.abs(nx) < 0.9) { ex = 0; ey = nz; ez = -ny; }
        else { ex = -nz; ey = 0; ez = nx; }
        let el = Math.hypot(ex, ey, ez) || 1;
        ex /= el; ey /= el; ez /= el;
        const fx = ny * ez - nz * ey;
        const fy = nz * ex - nx * ez;
        const fz = nx * ey - ny * ex;

        // ~0.72 rad of arc: 72 world units at PLANET_RADIUS, comfortably beyond
        // the turret's useful range so the approach is the interesting part.
        const STANDOFF = 0.72;

        let spawned = 0;
        for (let n = 0; n < count; n++) {
            const a = (n / Math.max(1, count)) * Math.PI * 2 + rngRange(rng, -0.34, 0.34);
            const arc = STANDOFF * rngRange(rng, 0.86, 1.14);
            const ca = Math.cos(arc), sa = Math.sin(arc);
            const dx = ex * Math.cos(a) + fx * Math.sin(a);
            const dy = ey * Math.cos(a) + fy * Math.sin(a);
            const dz = ez * Math.cos(a) + fz * Math.sin(a);
            let sx = nx * ca + dx * sa;
            let sy = ny * ca + dy * sa;
            let sz = nz * ca + dz * sa;
            const sl = Math.hypot(sx, sy, sz) || 1;
            sx /= sl; sy /= sl; sz /= sl;
            if (spawnAt(sx, sy, sz, nestIndex) >= 0) spawned++;
        }
        bodyMesh.instanceMatrix.needsUpdate = true;
        ringMesh.instanceMatrix.needsUpdate = true;
        return spawned;
    }

    // -----------------------------------------------------------------------
    // Update
    // -----------------------------------------------------------------------

    /**
     * @param {number} dt
     * @param {{x,y,z}} [birdPos]  the bird's world position (hunt target + ram test)
     * @param {number} [birdRadius] defaults to the ported BIRD_COLLISION_RADIUS
     * @returns {object} the REUSED result object:
     *   hitBird      index of the drone the bird rammed this frame, or -1
     *   hitX/Y/Z     where it happened (the drone's centre)
     *   nestHits     how many wave drones reached their nest this frame
     *   nestHitIndex the last nest hit, or -1
     *   nestHitX/Y/Z where that drone died
     *
     * The caller decides consequences. This never auto-kills on a bird hit:
     * Drone Hunter wants the ram to score a kill, Casual wants it to knock the
     * bird down and leave the drone flying, and that is a game-rule decision,
     * not a physics one. Call `killAt(hitBird)` if your mode wants it dead.
     */
    function update(dt, birdPos, birdRadius) {
        _result.hitBird = -1;
        _result.nestHits = 0;
        _result.nestHitIndex = -1;
        if (disposed) return _result;
        if (!(dt > 0)) dt = 0;
        // A tab-return spike must not teleport a drone through the bird.
        if (dt > 0.1) dt = 0.1;

        const chasing = behaviour === 'hunt';
        const attacking = behaviour === 'waves';
        const speedMul = chasing ? HUNT_SPEED_MUL : (attacking ? WAVE_SPEED_MUL : 1);
        const axisSlew = chasing ? HUNT_AXIS_SLEW : WAVE_AXIS_SLEW;

        const hitR = COLLISION_RADIUS + (birdRadius != null ? birdRadius : BIRD_COLLISION_RADIUS);
        const hitR2 = hitR * hitR;
        const nestR2 = NEST_ATTACK_RANGE * NEST_ATTACK_RANGE;

        // --- respawns ----------------------------------------------------
        const want = desiredPopulation();
        for (let i = 0; i < CAP; i++) {
            if (alive[i] || respawn[i] <= 0) continue;
            respawn[i] -= dt;
            if (respawn[i] <= 0) {
                respawn[i] = 0;
                if (liveCount < want) spawnScattered(-1);
            }
        }
        // A behaviour that lost drones to a mode switch tops itself back up.
        while (liveCount < want && spawnScattered(-1) >= 0) { /* fill */ }

        // --- integrate ---------------------------------------------------
        for (let i = 0; i < CAP; i++) {
            if (!alive[i]) continue;

            let x = px[i], y = py[i], z = pz[i];
            let ax = axx[i], ay = axy[i], az = axz[i];

            // --- homing: slew the ORBIT AXIS, never the position ----------
            let haveTarget = false;
            if (chasing && birdPos) {
                _target.set(birdPos.x, birdPos.y, birdPos.z);
                haveTarget = true;
            } else if (attacking && nestOf[i] >= 0 && nests) {
                nests.positionOf(nestOf[i], _target);
                haveTarget = true;
            }

            if (haveTarget) {
                // desired axis = normalize(cross(pos, target)). Rotating pos
                // about it by a POSITIVE angle sweeps pos toward target along
                // the shorter arc — which is the whole intercept model.
                let dx = y * _target.z - z * _target.y;
                let dy = z * _target.x - x * _target.z;
                let dz = x * _target.y - y * _target.x;
                const dl = Math.hypot(dx, dy, dz);
                if (dl > 1e-3) {
                    dx /= dl; dy /= dl; dz /= dl;
                    let k = axisSlew * dt;
                    if (k > 1) k = 1;
                    // If we are orbiting the wrong way round, `a + (d-a)k`
                    // passes through zero. Nudge off the degenerate point
                    // rather than normalising a null vector.
                    if (ax * dx + ay * dy + az * dz < -0.999) {
                        ax += 0.02; ay -= 0.02;
                    }
                    ax += (dx - ax) * k;
                    ay += (dy - ay) * k;
                    az += (dz - az) * k;
                    const al = Math.hypot(ax, ay, az);
                    if (al > 1e-4) { ax /= al; ay /= al; az /= al; }
                    axx[i] = ax; axy[i] = ay; axz[i] = az;
                }

                // Match the target's altitude, rate-limited so the climb reads
                // as a machine changing height rather than as a snap.
                const tr = Math.hypot(_target.x, _target.y, _target.z);
                const da = tr - alt[i];
                const step = ALT_SLEW * dt;
                alt[i] += da > step ? step : (da < -step ? -step : da);
            }

            // --- Rodrigues rotation about the (unit) axis -----------------
            const ang = spd[i] * speedMul * dt;
            const c = Math.cos(ang), s = Math.sin(ang);
            const dot = ax * x + ay * y + az * z;
            const cx = ay * z - az * y;
            const cy = az * x - ax * z;
            const cz = ax * y - ay * x;
            x = x * c + cx * s + ax * dot * (1 - c);
            y = y * c + cy * s + ay * dot * (1 - c);
            z = z * c + cz * s + az * dot * (1 - c);

            // --- hold altitude (with a bob) -------------------------------
            phase[i] += dt * RING_SPIN_RATE;
            bobPh[i] += dt * BOB_RATE;
            const targetR = alt[i] + Math.sin(bobPh[i]) * BOB_AMPLITUDE;
            const rl = Math.hypot(x, y, z) || 1;
            const k = targetR / rl;
            x *= k; y *= k; z *= k;

            px[i] = x; py[i] = y; pz[i] = z;

            // --- pulse ----------------------------------------------------
            const pulseRaw = Math.sin(phase[i] * 0.84);
            const pulse = PULSE_STEPS[pulseRaw < -0.34 ? 0 : (pulseRaw > 0.34 ? 2 : 1)];
            writeInstance(i, pulse);

            // --- bird collision -------------------------------------------
            if (birdPos && _result.hitBird < 0) {
                const bx = x - birdPos.x, by = y - birdPos.y, bz = z - birdPos.z;
                if (bx * bx + by * by + bz * bz <= hitR2) {
                    _result.hitBird = i;
                    _result.hitX = x; _result.hitY = y; _result.hitZ = z;
                }
            }

            // --- nest attack ----------------------------------------------
            if (attacking && nestOf[i] >= 0 && nests) {
                nests.positionOf(nestOf[i], _target);
                const nx = x - _target.x, ny = y - _target.y, nz = z - _target.z;
                if (nx * nx + ny * ny + nz * nz <= nestR2) {
                    _result.nestHits++;
                    _result.nestHitIndex = nestOf[i];
                    _result.nestHitX = x; _result.nestHitY = y; _result.nestHitZ = z;
                    killAt(i);
                }
            }
        }

        bodyMesh.instanceMatrix.needsUpdate = true;
        ringMesh.instanceMatrix.needsUpdate = true;
        bodyMesh.instanceColor.needsUpdate = true;
        ringMesh.instanceColor.needsUpdate = true;
        return _result;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        group.removeFromParent();
        group.remove(bodyMesh);
        group.remove(ringMesh);
        bodyGeo.dispose();
        ringGeo.dispose();
        bodyMat.dispose();
        ringMat.dispose();
        bodyMesh.dispose();
        ringMesh.dispose();
        for (let i = 0; i < CAP; i++) targets[i] = null;
        liveCount = 0;
    }

    const bodyTris = bodyGeo.getAttribute('position').count / 3;
    const ringTris = ringGeo.getAttribute('position').count / 3;

    const api = {
        group,
        bodyMesh,
        ringMesh,

        capacity: CAP,
        get alive() { return liveCount; },
        get behaviour() { return behaviour; },

        /** Fixed-length CAP array of {x,y,z,radius,index} | null, for rockets. */
        targets,

        setBehaviour,
        spawnWave,
        update,
        killAt,
        clear,
        dispose,

        /** True if slot `i` currently holds a live drone. */
        isAlive(i) { return i >= 0 && i < CAP && alive[i] === 1; },

        /** Which nest slot `i` is attacking, or -1. */
        nestTargetOf(i) { return (i >= 0 && i < CAP) ? nestOf[i] : -1; },

        positionOf(i, out) {
            if (i < 0 || i >= CAP) return out;
            return out.set(px[i], py[i], pz[i]);
        },

        collisionRadius: COLLISION_RADIUS,
        drawCallCount: 2,
        bodyTriangles: bodyTris,
        ringTriangles: ringTris,
        triangleCount: (bodyTris + ringTris) * CAP,
    };
    return api;
}

export default createDrones;
