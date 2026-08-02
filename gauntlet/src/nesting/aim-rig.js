/**
 * nesting/aim-rig.js — the nest turret: aim solver + cel-shaded gun.
 *
 * This is a PORT of Birb Mobile's `src/nesting/aim-rig.js` (re-implemented, not
 * imported — `gauntlet/` stays airtight against the parent game). It is the
 * single best-tuned thing in the original: the numbers below were dialled in by
 * hand over weeks against real thumbs, so they are copied VERBATIM and are not
 * to be "improved" without a playtest to point at.
 *
 * ---------------------------------------------------------------------------
 * WHY IT FEELS HEAVY — the three layers, in order
 * ---------------------------------------------------------------------------
 *
 * 1. RATE CONTROL, NOT POSITION CONTROL. The stick does not steer the barrel to
 *    an angle; it requests an angular VELOCITY. That is what a real powered
 *    mount does, and it is why the turret cannot be flicked onto a target the
 *    way a mouse-look camera can.
 *
 * 2. THE HOLD-TO-SWEEP RAMP. A held direction eases from a gentle base rate up
 *    to base x 1.6 over 1.0s, quadratically. Brief corrections therefore stay
 *    slow (fine aim); only a sustained push accelerates (long sweep). The ramp
 *    resets on release AND on direction reversal, so a correction is always
 *    fine even mid-sweep.
 *
 * 3. ASYMMETRIC INERTIA. Angular velocity chases the requested velocity with
 *    stiffness 25 while you are pushing (responsive), but only 4.0 when you let
 *    go (momentum glide). THIS IS THE WHOLE FEEL. It is deliberately asymmetric:
 *    a symmetric filter that decays as slowly as this coast would feel like
 *    input lag on the way IN, and one that responds as fast as the tracking term
 *    would feel weightless on the way OUT.
 *
 *    Consequence worth stating plainly, because it is large: at the top of the
 *    ramp the mount is doing 5.43 rad/s, and a release decays that as
 *    exp(-4t) -> the barrel glides ~78 degrees over ~1.7s before it stops. That
 *    is the shipped tuning. It reads as a heavy mount spinning down, and it is
 *    the one constant here I would want re-playtested (see the report), but it
 *    is copied exactly as found.
 *
 * A NOTE ON "SPRING-DAMPER C0 8.0 / C1 6.0":
 * TURRET_RESEARCH.md proposed a second-order spring-damper for the aim itself.
 * The version that actually SHIPPED — and that this ports — solved it a
 * different way (asymmetric first-order velocity tracking, above), because a
 * spring needs a TARGET angle and rate control has none. So C0/C1 are used here
 * for the thing they genuinely describe: the mount's mechanical FLEX, a
 * second-order lean that trails the mount's angular velocity and settles when
 * it stops. C1 (6.0) > 2*sqrt(C0) (5.66) means it is just past critical damping
 * — chosen in the research explicitly so it does NOT oscillate. It converges
 * without ringing. That is correct, not a bug, and the probe measures it.
 *
 * The flex is VISUAL ONLY. `aimForward` never carries it, so what you shoot is
 * exactly where the reticle is. Same for the fire kick.
 *
 * ---------------------------------------------------------------------------
 * FRAME
 * ---------------------------------------------------------------------------
 * `reset(up, forward)` takes the RADIAL up at the nest and the bird's landing
 * heading, and builds an orthonormal reference basis from them. Yaw is about
 * that up, pitch about (forward x up). Taking `up` from the caller rather than
 * deriving it from the landing quaternion is what gives a perfect horizon no
 * matter how untidily the bird came down.
 *
 * Local convention holds throughout: forward is -Z, up is +Y.
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import { attachOutline } from '../core/outline.js';

// ---------------------------------------------------------------------------
// Tuning — VERBATIM from Birb Mobile's AIM_RIG_DEFAULTS. Do not re-derive.
// ---------------------------------------------------------------------------

export const AIM_RIG_DEFAULTS = {
    // Rotation speed targets (rad/s at full deflection). These are the GENTLE
    // BASE rates — what a fresh, short push gives you. A sustained hold ramps
    // from here toward base x rampMaxMult.
    yawRate: Math.PI * 1.08,          // horizontal base: 194 deg/s
    pitchRate: Math.PI * 0.864,       // vertical base:   156 deg/s

    // Hold-to-sweep ramp. Quadratic ease-in so brief corrections stay slow.
    // Resets on release or direction reversal.
    rampDuration: 1.0,
    rampMaxMult: 1.6,

    // Pitch limits. Nests sit high on emergent trees, so the gun must depress
    // steeply to reach targets far below. Stops 5 deg short of vertical on both
    // ends to avoid the look-axis singularity.
    maxPitch: (85 * Math.PI) / 180,
    minPitch: (-85 * Math.PI) / 180,

    // Input stabilisation.
    smoothing: 15,                    // stick exponential smoothing
    pointerSmoothing: 12,             // pointer/touch drag smoothing
    lookSensitivity: 0.00225,         // pointer delta -> angle scaling
    pointerDeadzone: 0.1,             // min pointer movement to register (px)
    maxPointerDelta: 40,              // max pointer movement per frame (px)
    axisDeadzone: 0.08,               // stick centre deadzone
    axisExpo: 0.4,                    // fine control at small deflections

    // Inertia — asymmetric stiffness. This is the heavy-turret feel.
    trackingStiffness: 25,            // velocity chases input (responsive)
    coastStiffness: 4.0,              // velocity decays on release (glide)
    maxYawVelocity: Math.PI * 1.728,    // = yawRate   x rampMaxMult
    maxPitchVelocity: Math.PI * 1.3824, // = pitchRate x rampMaxMult

    // Banking. Zero in the original — the turret does not roll the horizon.
    bankInfluence: 0,
    maxBank: 0,
    bankSmoothing: 4,
};

/**
 * Second-order constants for the mount's mechanical flex and the fire kick.
 * C0/C1 are the TURRET_RESEARCH.md values, used for the layer they actually
 * describe. The recoil pair is NEW (the original had no recoil animation) and
 * is labelled as such rather than smuggled in as a ported constant.
 */
export const AIM_RIG_VISUAL = {
    flexC0: 8.0,          // spring stiffness   (TURRET_RESEARCH.md)
    flexC1: 6.0,          // damping, > 2*sqrt(C0) so it converges without ring
    flexGain: 0.020,      // rad of lean per rad/s of mount velocity
    flexMax: 0.075,       // hard cap, ~4.3 deg — beyond this it reads as broken

    kickC0: 150,          // fire kick: elevation punch, springs back
    kickC1: 15,           // zeta ~0.61 -> one visible settle, then still
    kickImpulse: 4.2,     // rad/s applied to the kick spring on fire

    slideC0: 210,         // barrel slides back in its cradle and returns
    slideC1: 17,
    slideImpulse: 6.5,    // units/s

    muzzleFlashTime: 0.065,
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const TWO_PI = Math.PI * 2;

/** Keep yaw in [-PI, PI] so a long session cannot drift into float mush. */
function normalizeAngle(a) {
    while (a > Math.PI) a -= TWO_PI;
    while (a < -Math.PI) a += TWO_PI;
    return a;
}

// ---------------------------------------------------------------------------
// Build-time geometry helpers (allocation is fine here — never in update)
// ---------------------------------------------------------------------------

/**
 * Merge a list of `{ geo, matrix }` into one non-indexed BufferGeometry.
 *
 * A turret built from eight primitives is eight draw calls plus eight outline
 * hulls; merged by material it is three plus three. Merging also welds the
 * seams for `ensureSmoothNormals`, so the outline hull comes out as one clean
 * silhouette instead of splitting at every join.
 */
function mergeParts(THREE, parts) {
    const pieces = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
        const g = parts[i].geo.index ? parts[i].geo.toNonIndexed() : parts[i].geo.clone();
        g.applyMatrix4(parts[i].matrix);
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        pieces.push(g);
        total += g.getAttribute('position').count;
    }
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    let o = 0;
    for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i].getAttribute('position');
        const n = pieces[i].getAttribute('normal');
        pos.set(p.array, o);
        nrm.set(n.array, o);
        o += p.count * 3;
        pieces[i].dispose();
    }
    for (let i = 0; i < parts.length; i++) parts[i].geo.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.computeBoundingSphere();
    return out;
}

/** Convenience: a transform matrix without leaking scratch objects. */
function xform(THREE, px, py, pz, rx, ry, rz, sx, sy, sz) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    m.compose(
        new THREE.Vector3(px, py, pz),
        q,
        new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz)
    );
    return m;
}

/**
 * A flat four-point star, used for the muzzle flash. Two crossed quads would
 * read as two quads; a star reads as light. Generated, like everything else.
 */
function starGeometry(THREE, longR, shortR, points) {
    const verts = [];
    const step = Math.PI / points;
    for (let i = 0; i < points * 2; i++) {
        const a0 = i * step;
        const a1 = (i + 1) * step;
        const r0 = i % 2 === 0 ? longR : shortR;
        const r1 = i % 2 === 0 ? shortR : longR;
        verts.push(0, 0, 0);
        verts.push(Math.cos(a0) * r0, Math.sin(a0) * r0, 0);
        verts.push(Math.cos(a1) * r1, Math.sin(a1) * r1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.computeVertexNormals();
    return g;
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} [opts]
 * @param {THREE.PerspectiveCamera} [opts.camera]  driven by `viewQuaternion` when `driveCamera`
 * @param {boolean} [opts.driveCamera]  write the aim into `camera.quaternion` each update
 * @param {boolean} [opts.visual]       build the turret mesh (default true)
 * @param {boolean} [opts.outline]      inverted-hull outlines (default true)
 * @param {string}  [opts.quality]      'low' | 'mid' | 'high'
 * @param {number}  [opts.scale]        turret size multiplier
 * @param {number}  [opts.reticleDistance]
 * @param {boolean} [opts.active]       start live (default true)
 * ...plus any AIM_RIG_DEFAULTS key to override.
 */
export function createAimRig(THREE, opts = {}) {
    if (!THREE) throw new Error('createAimRig requires a THREE namespace');

    const cfg = {};
    for (const k in AIM_RIG_DEFAULTS) {
        cfg[k] = opts[k] === undefined ? AIM_RIG_DEFAULTS[k] : opts[k];
    }
    // Guard against a caller swapping the limits.
    const hi = Math.max(cfg.maxPitch, cfg.minPitch);
    const lo = Math.min(cfg.maxPitch, cfg.minPitch);
    cfg.maxPitch = hi;
    cfg.minPitch = lo;

    const camera = opts.camera || null;
    const driveCamera = Boolean(opts.driveCamera && camera);
    const quality = opts.quality || 'high';
    const wantVisual = opts.visual !== false;
    const wantOutline = opts.outline !== false && quality !== 'low';
    const scale = opts.scale === undefined ? 1 : opts.scale;
    const reticleDistance = opts.reticleDistance === undefined ? 60 : opts.reticleDistance;
    const seg = quality === 'low' ? 8 : quality === 'mid' ? 10 : 12;

    // --- solver state -------------------------------------------------------
    let active = opts.active !== false;
    let disposed = false;

    let _yaw = 0;
    let _pitch = 0;
    let _yawVelocity = 0;
    let _pitchVelocity = 0;
    let _smoothedX = 0;
    let _smoothedY = 0;
    let _smoothedDeltaX = 0;
    let _smoothedDeltaY = 0;
    let _smoothedBank = 0;
    let _yawHoldTime = 0;
    let _pitchHoldTime = 0;
    let _yawHoldDir = 0;
    let _pitchHoldDir = 0;

    // --- visual state -------------------------------------------------------
    let _flex = 0;          // mount lean, rad
    let _flexVel = 0;
    let _kick = 0;          // fire elevation punch, rad
    let _kickVel = 0;
    let _slide = 0;         // barrel recoil travel, units
    let _slideVel = 0;
    let _flashTimer = 0;

    // --- pre-allocated scratch (never allocate in update) -------------------
    const _referenceUp = new THREE.Vector3(0, 1, 0);
    const _referenceForward = new THREE.Vector3(0, 0, -1);
    const _referenceRight = new THREE.Vector3(1, 0, 0);
    const _basisQuat = new THREE.Quaternion();
    const _scratchForward = new THREE.Vector3(0, 0, -1);
    const _scratchRight = new THREE.Vector3(1, 0, 0);
    const _scratchUp = new THREE.Vector3(0, 1, 0);
    const _negForward = new THREE.Vector3(0, 0, 1);
    const _scratchQuat = new THREE.Quaternion();
    const _scratchMatrix = new THREE.Matrix4();
    const _projScratch = new THREE.Vector3();
    const _fallback = new THREE.Vector3(1, 0, 0);

    /** Public, mutated in place, never replaced. */
    const aimQuaternion = new THREE.Quaternion();
    const aimForward = new THREE.Vector3(0, 0, -1);
    const viewQuaternion = new THREE.Quaternion();
    /** Scratch for setReady01 — the loop must not allocate a Color per frame. */
    const _readyCol = new THREE.Color();

    // -----------------------------------------------------------------------
    // Visual: mount / barrel / reticle
    // -----------------------------------------------------------------------
    const group = new THREE.Group();
    group.name = 'aim-rig';

    const yawGroup = new THREE.Group();     // rotates about local +Y by yaw
    const flexGroup = new THREE.Group();    // mechanical lean (visual only)
    const pitchGroup = new THREE.Group();   // rotates about local +X by pitch
    const kickGroup = new THREE.Group();    // fire elevation punch (visual only)
    const slideGroup = new THREE.Group();   // barrel recoil travel (visual only)
    group.add(yawGroup);
    yawGroup.add(flexGroup);
    flexGroup.add(pitchGroup);
    pitchGroup.add(kickGroup);
    kickGroup.add(slideGroup);

    // The reticle hangs off a CLEAN yaw/pitch chain so it reports the true aim,
    // untouched by flex, kick or recoil. What you see is what you shoot.
    const aimYawGroup = new THREE.Group();
    const aimPitchGroup = new THREE.Group();
    group.add(aimYawGroup);
    aimYawGroup.add(aimPitchGroup);

    const disposables = [];
    let mountMesh = null;
    let barrelMesh = null;
    let brassMesh = null;
    let reticle = null;
    let flash = null;
    let triangleCount = 0;
    let drawCallCount = 0;

    if (wantVisual) {
        const TRUNNION = 1.42;      // height of the pitch axis above the nest rim

        // --- mount: bedplate, turntable, two cheek plates, elevation handle ---
        const mountGeo = mergeParts(THREE, [
            { geo: new THREE.CylinderGeometry(1.72, 1.95, 0.34, seg), matrix: xform(THREE, 0, 0.17, 0) },
            { geo: new THREE.CylinderGeometry(1.22, 1.46, 0.52, seg), matrix: xform(THREE, 0, 0.58, 0) },
            { geo: new THREE.BoxGeometry(0.34, 1.06, 0.86), matrix: xform(THREE, -0.86, TRUNNION - 0.42, 0.06) },
            { geo: new THREE.BoxGeometry(0.34, 1.06, 0.86), matrix: xform(THREE, 0.86, TRUNNION - 0.42, 0.06) },
            // Traverse handle sweeping back from the turntable.
            { geo: new THREE.CylinderGeometry(0.1, 0.1, 1.15, 6), matrix: xform(THREE, 0.62, 0.95, 0.86, -0.5, 0, -0.35) },
            // Splinter shield. Sits BELOW the trunnion so the barrel clears it —
            // no intersecting geometry, and it gives the mount a broad, readable
            // silhouette from the front instead of a bare post.
            { geo: new THREE.BoxGeometry(2.1, 0.98, 0.16), matrix: xform(THREE, 0, 0.74, -1.3, 0.22, 0, 0) },
            { geo: new THREE.BoxGeometry(0.52, 0.72, 0.15), matrix: xform(THREE, -1.2, 0.68, -1.18, 0.22, 0.55, 0) },
            { geo: new THREE.BoxGeometry(0.52, 0.72, 0.15), matrix: xform(THREE, 1.2, 0.68, -1.18, 0.22, -0.55, 0) },
        ]);

        // --- barrel assembly: cradle, tube, recoil rams, breech, counterweight
        // The two rams flanking the tube are what make it read as ARTILLERY at a
        // glance. A bare cylinder on a pivot reads as a telescope.
        const barrelGeo = mergeParts(THREE, [
            { geo: new THREE.BoxGeometry(1.04, 0.62, 1.62), matrix: xform(THREE, 0, 0, 0.22) },
            { geo: new THREE.CylinderGeometry(0.34, 0.4, 4.3, seg), matrix: xform(THREE, 0, 0, -2.3, -Math.PI / 2, 0, 0) },
            { geo: new THREE.CylinderGeometry(0.17, 0.17, 2.3, 6), matrix: xform(THREE, -0.48, 0.1, -1.5, -Math.PI / 2, 0, 0) },
            { geo: new THREE.CylinderGeometry(0.17, 0.17, 2.3, 6), matrix: xform(THREE, 0.48, 0.1, -1.5, -Math.PI / 2, 0, 0) },
            { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.46, seg), matrix: xform(THREE, 0, 0, -0.3, -Math.PI / 2, 0, 0) },
            { geo: new THREE.CylinderGeometry(0.58, 0.46, 0.95, seg), matrix: xform(THREE, 0, 0, 1.3, -Math.PI / 2, 0, 0) },
        ]);

        // --- brass: muzzle brake, breech ring, sight blade -------------------
        const brassGeo = mergeParts(THREE, [
            { geo: new THREE.CylinderGeometry(0.5, 0.44, 0.62, seg), matrix: xform(THREE, 0, 0, -4.36, -Math.PI / 2, 0, 0) },
            { geo: new THREE.TorusGeometry(0.42, 0.09, 6, seg), matrix: xform(THREE, 0, 0, -3.6) },
            { geo: new THREE.BoxGeometry(0.09, 0.34, 0.12), matrix: xform(THREE, 0, 0.44, -2.9) },
        ]);

        // --- mount brass: turntable ring + trunnion collars ------------------
        // These live on the MOUNT, not the barrel. Putting the turntable ring in
        // the barrel's brass group made it inherit pitch AND recoil, so it rode
        // around the breech as a giant hoop. Rotating parts and static parts do
        // not share a mesh.
        //
        // The ring is what says "this part traverses": without it the wooden
        // bedplate and the wooden shield merge into one brown lump at gun scale.
        const mountTrimGeo = mergeParts(THREE, [
            { geo: new THREE.TorusGeometry(1.46, 0.1, 6, 20), matrix: xform(THREE, 0, 0.36, 0, Math.PI / 2, 0, 0) },
            { geo: new THREE.CylinderGeometry(0.26, 0.26, 0.26, seg), matrix: xform(THREE, -1.03, TRUNNION, 0, 0, 0, Math.PI / 2) },
            { geo: new THREE.CylinderGeometry(0.26, 0.26, 0.26, seg), matrix: xform(THREE, 1.03, TRUNNION, 0, 0, 0, Math.PI / 2) },
        ]);

        const mountMat = createToonMaterial(THREE, {
            color: PALETTE.trunk, ramp: 'graphic', specStrength: 0.32, rimStrength: 0.5,
        });
        const barrelMat = createToonMaterial(THREE, {
            color: PALETTE.rock, ramp: 'graphic', specStrength: 0.55, specPower: 36, rimStrength: 0.62,
        });
        const brassMat = createToonMaterial(THREE, {
            color: PALETTE.beak, ramp: 'graphic', specStrength: 0.8, specPower: 26, rimStrength: 0.7,
        });

        mountMesh = new THREE.Mesh(mountGeo, mountMat);
        mountMesh.name = 'turret-mount';
        yawGroup.add(mountMesh);

        barrelMesh = new THREE.Mesh(barrelGeo, barrelMat);
        barrelMesh.name = 'turret-barrel';
        brassMesh = new THREE.Mesh(brassGeo, brassMat);
        brassMesh.name = 'turret-brass';
        slideGroup.add(barrelMesh);
        slideGroup.add(brassMesh);

        // Trim shares the brass material, so it costs one draw call and no
        // outline hull — it is interior detail, not silhouette.
        const mountTrim = new THREE.Mesh(mountTrimGeo, brassMat);
        mountTrim.name = 'turret-mount-trim';
        mountTrim.userData.noOutline = true;
        yawGroup.add(mountTrim);

        pitchGroup.position.y = TRUNNION;

        if (wantOutline) {
            attachOutline(THREE, mountMesh, { color: PALETTE.ink, pixels: 2.4, maxPush: 0.6 });
            attachOutline(THREE, barrelMesh, { color: PALETTE.ink, pixels: 2.4, maxPush: 0.5 });
            attachOutline(THREE, brassMesh, { color: PALETTE.ink, pixels: 2.0, maxPush: 0.3 });
        }

        // --- muzzle flash ----------------------------------------------------
        // Warm, wide and short-lived. A cool white star reads as a sparkle;
        // muzzle blast is gold, and it is gone before you can look at it.
        const flashGeo = starGeometry(THREE, 1.05, 0.62, 8);
        const flashMat = new THREE.MeshBasicMaterial({
            color: PALETTE.sunHalo,
            transparent: true,
            opacity: 0.8,
            // NOT additive. Gold added to a bright sky is white, and a white
            // star reads as a sparkle, not as burning propellant. Straight
            // alpha keeps the blast gold against the sky it will live in.
            blending: THREE.NormalBlending,
            depthWrite: false,
            fog: false,
        });
        flash = new THREE.Mesh(flashGeo, flashMat);
        flash.name = 'muzzle-flash';
        flash.position.z = -4.75;
        flash.visible = false;
        flash.userData.noOutline = true;
        slideGroup.add(flash);
        disposables.push(flashGeo, flashMat);

        // --- reticle ---------------------------------------------------------
        // Sized in world units at `reticleDistance`, so it subtends a constant
        // angle regardless of how far out the caller puts it.
        const rs = reticleDistance / 60;
        const reticleGeo = mergeParts(THREE, [
            { geo: new THREE.TorusGeometry(1.5 * rs, 0.075 * rs, 4, 28), matrix: xform(THREE, 0, 0, 0) },
            { geo: new THREE.BoxGeometry(0.09 * rs, 0.62 * rs, 0.02), matrix: xform(THREE, 0, 2.15 * rs, 0) },
            { geo: new THREE.BoxGeometry(0.09 * rs, 0.62 * rs, 0.02), matrix: xform(THREE, 0, -2.15 * rs, 0) },
            { geo: new THREE.BoxGeometry(0.62 * rs, 0.09 * rs, 0.02), matrix: xform(THREE, 2.15 * rs, 0, 0) },
            { geo: new THREE.BoxGeometry(0.62 * rs, 0.09 * rs, 0.02), matrix: xform(THREE, -2.15 * rs, 0, 0) },
            { geo: new THREE.BoxGeometry(0.16 * rs, 0.16 * rs, 0.02), matrix: xform(THREE, 0, 0, 0) },
        ]);
        const reticleMat = new THREE.MeshBasicMaterial({
            color: PALETTE.uiCyan, transparent: true, opacity: 0.92,
            depthTest: false, depthWrite: false, fog: false,
        });
        reticle = new THREE.Mesh(reticleGeo, reticleMat);
        reticle.name = 'turret-reticle';
        reticle.position.z = -reticleDistance;
        reticle.renderOrder = 900;
        reticle.userData.noOutline = true;
        aimPitchGroup.add(reticle);
        disposables.push(reticleGeo, reticleMat);

        disposables.push(mountGeo, barrelGeo, brassGeo, mountTrimGeo, mountMat, barrelMat, brassMat);

        // Reported once at build time; the caller's renderer.info is the truth
        // for the whole frame.
        const hulls = wantOutline ? 3 : 0;   // mount, barrel, barrel brass
        drawCallCount = 4 + hulls + 1 /* reticle */;
        triangleCount = 0;
        group.traverse((o) => {
            if (o.isMesh && o.geometry) {
                const p = o.geometry.getAttribute('position');
                if (p) triangleCount += p.count / 3;
            }
        });
        triangleCount = Math.round(triangleCount);

        group.scale.setScalar(scale);
    }

    // -----------------------------------------------------------------------
    // Frame setup
    // -----------------------------------------------------------------------

    function clearInputState() {
        _smoothedX = 0;
        _smoothedY = 0;
        _smoothedDeltaX = 0;
        _smoothedDeltaY = 0;
        _yawHoldTime = 0;
        _pitchHoldTime = 0;
        _yawHoldDir = 0;
        _pitchHoldDir = 0;
    }

    function clearMotionState() {
        _yaw = 0;
        _pitch = 0;
        _yawVelocity = 0;
        _pitchVelocity = 0;
        _smoothedBank = 0;
        _flex = 0;
        _flexVel = 0;
    }

    /** Rebuild the group transform from the reference basis. */
    function syncBasis() {
        _negForward.copy(_referenceForward).negate();
        _scratchMatrix.makeBasis(_referenceRight, _referenceUp, _negForward);
        _basisQuat.setFromRotationMatrix(_scratchMatrix);
        group.quaternion.copy(_basisQuat);
    }

    /**
     * Point the rig. `up` is the RADIAL up at the nest (never world up); the
     * forward is projected into the tangent plane, which is what guarantees a
     * level horizon however the bird landed.
     */
    function reset(up, forward) {
        if (up) _referenceUp.copy(up).normalize();
        if (forward) {
            _projScratch.copy(_referenceUp).multiplyScalar(forward.dot(_referenceUp));
            _scratchForward.copy(forward).sub(_projScratch);
            if (_scratchForward.lengthSq() < 0.001) {
                // Forward was parallel to up — fall back to a world axis, itself
                // projected, so the basis is still orthonormal.
                _fallback.set(1, 0, 0);
                if (Math.abs(_referenceUp.x) > 0.9) _fallback.set(0, 0, 1);
                _projScratch.copy(_referenceUp).multiplyScalar(_fallback.dot(_referenceUp));
                _scratchForward.copy(_fallback).sub(_projScratch);
            }
            _referenceForward.copy(_scratchForward).normalize();
        }
        _referenceRight.crossVectors(_referenceForward, _referenceUp).normalize();
        clearInputState();
        clearMotionState();
        syncBasis();
        recompute();
        return api;
    }

    /** Same, from a quaternion (the bird's landing orientation). */
    function resetFromQuaternion(q) {
        if (!q) return api;
        _scratchForward.set(0, 0, -1).applyQuaternion(q).normalize();
        _scratchUp.set(0, 1, 0).applyQuaternion(q).normalize();
        return reset(_scratchUp, _scratchForward);
    }

    function setActive(on) {
        const next = Boolean(on);
        if (next === active) return;
        active = next;
        clearInputState();
        if (!next) clearMotionState();
    }

    // -----------------------------------------------------------------------
    // Input shaping
    // -----------------------------------------------------------------------

    /**
     * Deadzone then expo. The expo blends linear with cubic: fine control at
     * small deflections, full sweep speed at the rim.
     */
    function shapeAxis(value) {
        const magnitude = Math.abs(value);
        if (magnitude < cfg.axisDeadzone) return 0;
        const sign = value > 0 ? 1 : -1;
        const remapped = (magnitude - cfg.axisDeadzone) / (1 - cfg.axisDeadzone);
        const c = Math.min(remapped, 1);
        const k = cfg.axisExpo;
        return sign * ((1 - k) * c + k * c * c * c);
    }

    // -----------------------------------------------------------------------
    // Aim output
    // -----------------------------------------------------------------------

    /**
     * Build `aimQuaternion` / `aimForward` from yaw + pitch.
     *
     * Yaw about the reference up, pitch about the YAWED right. Recomputing
     * right from (pitchedForward x up) instead collapses at high pitch, because
     * pitchedForward goes parallel to up — which is exactly where a nest turret
     * spends its time, depressed steeply at the ground below.
     */
    function recompute() {
        const forward = _scratchForward.copy(_referenceForward);

        if (Math.abs(_yaw) > 1e-8) {
            _scratchQuat.setFromAxisAngle(_referenceUp, _yaw);
            forward.applyQuaternion(_scratchQuat).normalize();
        }

        const right = _scratchRight.crossVectors(forward, _referenceUp).normalize();

        if (Math.abs(_pitch) > 1e-8) {
            _scratchQuat.setFromAxisAngle(right, _pitch);
            forward.applyQuaternion(_scratchQuat).normalize();
        }

        const up = _scratchUp.crossVectors(right, forward).normalize();

        if (Math.abs(_smoothedBank) > 1e-6) {
            _scratchQuat.setFromAxisAngle(forward, _smoothedBank);
            up.applyQuaternion(_scratchQuat).normalize();
            right.crossVectors(forward, up).normalize();
        }

        aimForward.copy(forward);
        // Three cameras look down -Z, so the basis takes the negated forward.
        _negForward.copy(forward).negate();
        _scratchMatrix.makeBasis(right, up, _negForward);
        aimQuaternion.setFromRotationMatrix(_scratchMatrix);
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------

    /**
     * @param {number} dt seconds
     * @param {object} [input] { x, y } stick in [-1,1] (aliases axisX/axisY),
     *                         and/or { deltaX, deltaY } pointer pixels this frame
     */
    function update(dt, input) {
        if (disposed) return api;

        let axisX = 0, axisY = 0, deltaX = 0, deltaY = 0;
        if (input) {
            axisX = input.x !== undefined ? input.x : (input.axisX || 0);
            axisY = input.y !== undefined ? input.y : (input.axisY || 0);
            deltaX = input.deltaX || 0;
            deltaY = input.deltaY || 0;
        }

        const step = clamp(dt, 0, 0.05);
        if (step <= 0 || !active) {
            // Still advance the visual springs so a paused stick does not leave
            // the mount frozen mid-lean.
            if (step > 0) updateVisual(step);
            return api;
        }

        // --- channel 1: stick, rate-based ----------------------------------
        const shapedX = shapeAxis(axisX);
        const shapedY = shapeAxis(axisY);

        const smoothStep = 1 - Math.exp(-cfg.smoothing * step);
        _smoothedX += (shapedX - _smoothedX) * smoothStep;
        _smoothedY += (shapedY - _smoothedY) * smoothStep;

        // --- hold-to-sweep ramp (stick channel only) ------------------------
        // Direction comes from the INSTANTANEOUS shaped input, not the smoothed
        // one, so a reversal drops straight back to fine speed instead of
        // waiting for the filter to catch up.
        const yawDir = Math.sign(shapedX);
        if (yawDir !== 0 && yawDir === _yawHoldDir) {
            _yawHoldTime += step;
        } else {
            _yawHoldDir = yawDir;
            _yawHoldTime = yawDir !== 0 ? step : 0;
        }
        const pitchDir = Math.sign(shapedY);
        if (pitchDir !== 0 && pitchDir === _pitchHoldDir) {
            _pitchHoldTime += step;
        } else {
            _pitchHoldDir = pitchDir;
            _pitchHoldTime = pitchDir !== 0 ? step : 0;
        }

        const rampSpan = cfg.rampMaxMult - 1;
        const yawHoldFrac = cfg.rampDuration > 0 ? clamp(_yawHoldTime / cfg.rampDuration, 0, 1) : 1;
        const pitchHoldFrac = cfg.rampDuration > 0 ? clamp(_pitchHoldTime / cfg.rampDuration, 0, 1) : 1;
        const yawRamp = 1 + yawHoldFrac * yawHoldFrac * rampSpan;
        const pitchRamp = 1 + pitchHoldFrac * pitchHoldFrac * rampSpan;

        let desiredYawVel = -_smoothedX * cfg.yawRate * yawRamp;
        let desiredPitchVel = _smoothedY * cfg.pitchRate * pitchRamp;

        // --- channel 2: pointer drag, delta-based ---------------------------
        // Added UN-ramped on purpose: a drag's speed already follows the finger,
        // so a time-ramp on top would fight the hand.
        const safeDX = Number.isFinite(deltaX) ? deltaX : 0;
        const safeDY = Number.isFinite(deltaY) ? deltaY : 0;
        const targetDX = Math.abs(safeDX) < cfg.pointerDeadzone
            ? 0 : clamp(safeDX, -cfg.maxPointerDelta, cfg.maxPointerDelta);
        const targetDY = Math.abs(safeDY) < cfg.pointerDeadzone
            ? 0 : clamp(safeDY, -cfg.maxPointerDelta, cfg.maxPointerDelta);

        const pStep = 1 - Math.exp(-cfg.pointerSmoothing * step);
        _smoothedDeltaX += (targetDX - _smoothedDeltaX) * pStep;
        _smoothedDeltaY += (targetDY - _smoothedDeltaY) * pStep;

        if (Math.abs(_smoothedDeltaX) > 0.01 || Math.abs(_smoothedDeltaY) > 0.01) {
            desiredYawVel += -_smoothedDeltaX * cfg.lookSensitivity / step;
            desiredPitchVel += _smoothedDeltaY * cfg.lookSensitivity / step;
        }

        // --- inertia: asymmetric tracking -----------------------------------
        // Coasting = there is velocity but the request has dropped well below it
        // (finger lifted, stick released, input fading). Pushing the other way
        // is NOT coasting — a deliberate reversal gets the responsive stiffness
        // so the player can fight the momentum rather than wait it out.
        const oppositeYaw = Math.sign(desiredYawVel) !== 0
            && Math.sign(desiredYawVel) !== Math.sign(_yawVelocity);
        const coastingYaw = !oppositeYaw
            && Math.abs(_yawVelocity) > 0.01
            && Math.abs(desiredYawVel) < Math.abs(_yawVelocity) * 0.8;

        const oppositePitch = Math.sign(desiredPitchVel) !== 0
            && Math.sign(desiredPitchVel) !== Math.sign(_pitchVelocity);
        const coastingPitch = !oppositePitch
            && Math.abs(_pitchVelocity) > 0.01
            && Math.abs(desiredPitchVel) < Math.abs(_pitchVelocity) * 0.8;

        const yawStiff = coastingYaw ? cfg.coastStiffness : cfg.trackingStiffness;
        const pitchStiff = coastingPitch ? cfg.coastStiffness : cfg.trackingStiffness;

        _yawVelocity += (desiredYawVel - _yawVelocity) * (1 - Math.exp(-yawStiff * step));
        _pitchVelocity += (desiredPitchVel - _pitchVelocity) * (1 - Math.exp(-pitchStiff * step));

        _yawVelocity = clamp(_yawVelocity, -cfg.maxYawVelocity, cfg.maxYawVelocity);
        _pitchVelocity = clamp(_pitchVelocity, -cfg.maxPitchVelocity, cfg.maxPitchVelocity);

        // Kill micro-drift, or the mount creeps forever after a release.
        if (Math.abs(_yawVelocity) < 0.005) _yawVelocity = 0;
        if (Math.abs(_pitchVelocity) < 0.005) _pitchVelocity = 0;

        _yaw += _yawVelocity * step;
        _pitch += _pitchVelocity * step;

        _pitch = clamp(_pitch, cfg.minPitch, cfg.maxPitch);
        // Dump velocity at the hard stops, or energy piles up against the limit
        // and the barrel snaps away the instant you reverse.
        if (_pitch >= cfg.maxPitch && _pitchVelocity > 0) _pitchVelocity = 0;
        if (_pitch <= cfg.minPitch && _pitchVelocity < 0) _pitchVelocity = 0;

        _yaw = normalizeAngle(_yaw);

        const targetBank = clamp(-_yawVelocity * cfg.bankInfluence, -cfg.maxBank, cfg.maxBank);
        _smoothedBank += (targetBank - _smoothedBank) * (1 - Math.exp(-cfg.bankSmoothing * step));

        recompute();
        updateVisual(step);
        return api;
    }

    /**
     * Second-order visual layers. Semi-implicit Euler: velocity first, then
     * position from the NEW velocity. Explicit Euler injects energy at large dt
     * and would make the stiff recoil spring blow up on a frame hitch.
     */
    function updateVisual(step) {
        const V = AIM_RIG_VISUAL;

        // Mount flex: leans against the turn, settles when the mount stops.
        const flexTarget = clamp(-_yawVelocity * V.flexGain, -V.flexMax, V.flexMax);
        _flexVel += (V.flexC0 * (flexTarget - _flex) - V.flexC1 * _flexVel) * step;
        _flex += _flexVel * step;

        // Fire kick and barrel slide both spring back to zero.
        _kickVel += (V.kickC0 * (0 - _kick) - V.kickC1 * _kickVel) * step;
        _kick += _kickVel * step;
        _slideVel += (V.slideC0 * (0 - _slide) - V.slideC1 * _slideVel) * step;
        _slide += _slideVel * step;

        if (_flashTimer > 0) {
            _flashTimer -= step;
            if (flash && _flashTimer <= 0) flash.visible = false;
        }

        yawGroup.rotation.y = _yaw;
        flexGroup.rotation.z = _flex;
        pitchGroup.rotation.x = _pitch;
        kickGroup.rotation.x = _kick;
        slideGroup.position.z = _slide;
        aimYawGroup.rotation.y = _yaw;
        aimPitchGroup.rotation.x = _pitch;

        if (flash && flash.visible) {
            // Spin the star each frame so two consecutive shots never look like
            // the same sprite, and shrink it as it dies.
            const k = Math.max(0, _flashTimer / V.muzzleFlashTime);
            flash.rotation.z += 2.7;
            flash.scale.setScalar(0.55 + k * 0.75);
            flash.material.opacity = 0.8 * k;
        }

        if (driveCamera) {
            // The camera gets the KICKED aim (that punch is most of what makes a
            // shot feel powerful) while aimForward stays clean for the rocket.
            viewQuaternion.copy(aimQuaternion);
            if (Math.abs(_kick) > 1e-6) {
                _scratchRight.set(1, 0, 0).applyQuaternion(aimQuaternion);
                _scratchQuat.setFromAxisAngle(_scratchRight, _kick);
                viewQuaternion.premultiply(_scratchQuat);
            }
            camera.quaternion.copy(viewQuaternion);
        }
    }

    /** Recoil: elevation punch, barrel slide, muzzle flash. Call on rocket fire. */
    function fire() {
        if (disposed) return api;
        const V = AIM_RIG_VISUAL;
        _kickVel += V.kickImpulse;
        _slideVel += V.slideImpulse;
        if (flash) {
            _flashTimer = V.muzzleFlashTime;
            flash.visible = true;
            flash.material.opacity = 0.8;
        }
        return api;
    }

    /** World-space muzzle position, for spawning the rocket. Zero-alloc. */
    function getMuzzlePosition(out) {
        if (!out) return null;
        out.set(0, 0, -4.9);
        if (slideGroup.parent) {
            slideGroup.updateWorldMatrix(true, false);
            out.applyMatrix4(slideGroup.matrixWorld);
        }
        return out;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (group.parent) group.parent.remove(group);
        group.traverse((o) => {
            if (o.isMesh) {
                if (o.userData.isOutline && o.material) o.material.dispose();
            }
        });
        for (let i = 0; i < disposables.length; i++) disposables[i].dispose();
        disposables.length = 0;
    }

    const api = {
        // scene
        group,
        reticle,
        mountMesh,
        barrelMesh,
        triangleCount,
        drawCallCount,

        // aim output (mutated in place — never replaced, never copy the reference)
        aimQuaternion,
        aimForward,
        viewQuaternion,

        /**
         * Show the gun's readiness on the reticle. `ready01` is 0 the instant
         * you fire and 1 when the tube is loaded again.
         *
         * The reticle is where the player's eye already is, so it has to carry
         * the reload — a meter on a button by your thumb is a meter you have to
         * look away from the target to read. It shrinks and goes dim-amber
         * while loading, then snaps back to full-size cyan when it is ready,
         * and that SNAP is the tell: a smooth fade tells you nothing about the
         * moment you can fire again.
         */
        setReady01(ready01) {
            if (!reticle) return api;
            let r = ready01;
            if (!(r >= 0)) r = 0; else if (r > 1) r = 1;
            const loaded = r >= 1;
            _readyCol.set(loaded ? PALETTE.uiCyan : PALETTE.gateIdle);
            reticle.material.color.copy(_readyCol);
            reticle.material.opacity = loaded ? 0.92 : 0.30 + 0.30 * r;
            const s = loaded ? 1 : 0.55 + 0.35 * r;
            reticle.scale.set(s, s, 1);
            return api;
        },

        // control
        update,
        reset,
        resetFromQuaternion,
        setActive,
        fire,
        getMuzzlePosition,
        dispose,

        // read-only telemetry, for the HUD, the probe and the audio servo loop
        get active() { return active; },
        get yaw() { return _yaw; },
        get pitch() { return _pitch; },
        get yawVelocity() { return _yawVelocity; },
        get pitchVelocity() { return _pitchVelocity; },
        get flex() { return _flex; },
        get recoilKick() { return _kick; },
        get recoilSlide() { return _slide; },
        /** 0..1 mount speed — drives servo sound volume/pitch. */
        get speed01() {
            return Math.min(1, Math.hypot(
                _yawVelocity / cfg.maxYawVelocity,
                _pitchVelocity / cfg.maxPitchVelocity
            ));
        },
        config: cfg,
    };

    syncBasis();
    recompute();
    updateVisual(0);
    return api;
}

export default createAimRig;
