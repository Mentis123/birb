/**
 * bird-flight-v2.js — bank to turn, behind `?flight=v2`.
 *
 * v1 (`bird-flight.js`) maps stick x straight to YAW about the planet's up and
 * paints a cosmetic bank on the model. Rolls and loops cannot come out of that
 * mapping, which is why they had to be added as committed moves with a stick
 * dwell, a wind-up and a camera hold (`aerobatics.js`) — every one of those a
 * workaround for the mapping rather than flight. The owner's words:
 * "klugy workarounds instead of proper flight like an airplane or bird."
 *
 * v2 changes the MAPPING and nothing underneath it:
 *
 *   stick x  -> roll rate about the bird's own forward
 *   stick y  -> pitch rate about the bird's own right, NO clamp
 *   turning  -> falls out of the bank: yaw about the RADIAL at
 *               turnGain * sin(bank), plus a small direct assist so a
 *               thumbstick still bites before the bank has built
 *   speed    -> an energy model: dive gains, climb bleeds, hands-off
 *               returns to `cruise`
 *
 * Rolls, loops, split-S, Immelmann and inverted flight are then emergent: hold
 * the stick over and you keep rolling, pull and hold and you go over the top.
 * There is no move list, no trigger and no dwell.
 *
 * WHY IT EXTENDS BirdFlight rather than copying it. The sphere half of v1 is
 * correct and is NOT what feels scripted: parallel transport, the terrain
 * FLOOR (`_floorAt` — carve-down-only, so the gravity-less bird is never
 * ratcheted upward), the slide-along-a-rise deflection, the spawn constraint
 * and the pre-allocated pose object are all inherited verbatim. That keeps ONE
 * definition of the terrain floor across both controllers — the same rule
 * `checkGroundCollision` and `forceGroundedPose` already follow — and v1 is a
 * pinned oracle (`tests/bird-flight.test.js`) that must not change to serve
 * this. Only `tick()`/`update()` are replaced; v1's yaw/pitch/_levelRoll and
 * the maxPitch clamp are simply never called from here.
 *
 * Up is the RADIAL at the bird's position everywhere in this file. There is no
 * world +Y in it — same rule the ground shader, the flight floor, Wave B's snow
 * term and the walk bob all follow.
 *
 * Zero allocations in tick()/update(): scratch objects only, `_` prefixed.
 */

import { BirdFlight, ZEN_TUNING } from './bird-flight.js';

/**
 * One tuning table. Start points are from docs/realism/FLIGHT_V2_PLAN.md; the
 * phone decides the final numbers, so keep them here rather than inline.
 */
export const FLIGHT_V2_DEFAULTS = {
    // 200 deg/s — a full roll in 1.8 s at full stick.
    rollRate: 3.5,
    // 120 deg/s — a loop in 3 s. Deliberately unclamped: a loop IS a 360-degree
    // pitch, so any ceiling makes one impossible by definition.
    pitchRate: 2.1,
    // Yaw rate at a 90-degree bank. At 45 degrees that is ~65 deg/s against
    // v1's flat 135 deg/s, so an ordinary turn is slower and a steep one is
    // faster — which is the whole point of turning with the wing.
    turnGain: 1.6,
    // Direct yaw per unit stick, on top of the bank's own turn. Without it a
    // small thumbstick nudge does nothing for the ~0.3 s the bank takes to
    // build, which reads as lag rather than as inertia.
    yawAssist: 0.35,
    // Toward upright, a bird's dihedral. Scaled down by the stick so a held
    // input is never fought — see the stability scaling in tick().
    rightingRate: 1.4,
    // Bank inside which the righting eases off proportionally instead of
    // driving at full rate, so the roll-out ends in a settle rather than a stop
    // and the term cannot chatter around level. It is ALSO the steepest bank a
    // held stick can sit at: the equilibrium is rollRate*|x| = rightingRate*
    // (1-|x|)*bank/soft, so a wider soft zone buys steeper sustained turns.
    // 0.7 rad (40 deg) is the measured compromise — at 0.5 the steepest holdable
    // bank was 29 deg, and past ~0.9 the recovery from inverted misses the
    // 3-second budget (constant rate down to the soft zone, then exponential:
    // 2.4 s at 0.7, 2.65 s at 0.9). Outside the zone the rate is CONSTANT, which
    // is the half that matters — a -sin(bank) restoring term (v1's _levelRoll)
    // is zero at 180 degrees, so an inverted bird sits there forever.
    rightingSoftBank: 0.7,
    // Toward the horizon by the shortest path (see _pitchStability). Gentle:
    // this is trim, not an autopilot.
    pitchStability: 0.6,
    // Dive gain / climb loss, units/s^2. At 60 degrees nose-down that is
    // +5.2 units/s each second.
    gSpeed: 6.0,
    // Return toward cruise, per second.
    drag: 0.9,
    // Bounds on speed as a multiple of cruise. The floor is what keeps a
    // vertical climb from stalling to zero and leaving the player with no
    // control authority at all (this model has no stall and no gravity vector,
    // so a stopped bird would simply hang there).
    minMul: 0.55,
    maxMul: 1.9,
    // Below this the stick counts as centred for the STABILITY SCALING only.
    // The rates themselves use the raw value, which index.html has already run
    // through shapeAxis (deadzone + expo) before it ever reaches a controller.
    deadzone: 0.08,
};

export class BirdFlightV2 extends BirdFlight {
    constructor(THREE, options = {}) {
        super(THREE, options);
        const { Vector3 } = THREE;
        const D = FLIGHT_V2_DEFAULTS;

        this.rollRate = options.rollRate ?? D.rollRate;
        // Overwrites the field v1's constructor just set. Deliberate: v2 never
        // calls v1's pitch(), and one `pitchRate` a probe can read beats two
        // that disagree about which controller is flying.
        this.pitchRate = options.pitchRate ?? D.pitchRate;
        this.turnGain = options.turnGain ?? D.turnGain;
        this.yawAssist = options.yawAssist ?? D.yawAssist;
        this.rightingRate = options.rightingRate ?? D.rightingRate;
        this.rightingSoftBank = options.rightingSoftBank ?? D.rightingSoftBank;
        this.pitchStabilityRate = options.pitchStability ?? D.pitchStability;
        this.gSpeed = options.gSpeed ?? D.gSpeed;
        this.drag = options.drag ?? D.drag;
        this.minMul = options.minMul ?? D.minMul;
        this.maxMul = options.maxMul ?? D.maxMul;
        this.deadzone = options.deadzone ?? D.deadzone;

        // The target the energy model chases. index.html writes THIS every
        // frame under v2 (where it writes `speed` under v1), so boost raises
        // the target and the model runs to it instead of teleporting the
        // speedometer. `speed` is the instantaneous value and is owned here.
        // Writing it also hands the energy model back the wheel — see the
        // accessor and `_commanded` below. It starts HANDED OVER: a consumer
        // that constructs v2 and never writes `cruise` should get the energy
        // model, not a silently constant speed that looks exactly like v1.
        this.cruise = options.cruise ?? this.speed;

        // What tick() last left in `speed`. Anything else found there at the
        // top of the next tick was written from OUTSIDE (walking, the falling
        // resume speed, the freeze, the studio harness) and is honoured as both
        // the speed and the target for that frame — otherwise a 1.2-unit walk
        // would be dragged straight back toward an 11-unit cruise.
        this._lastTickSpeed = this.speed;

        // v1's clamp is not enforced here. Reported as 180 rather than left at
        // v1's 80 so __BIRB.flightProbe()'s maxPitchDeg does not describe a
        // ceiling this controller does not have.
        this.maxPitch = Math.PI;

        // Extra scratch on top of v1's. Allocated once, here, never in tick().
        this._scratch.right = new Vector3();
        this._scratch.bodyUp = new Vector3();
    }

    // ---- read-only probes (harness + __BIRB.flightProbe) --------------------

    /**
     * Bank about the bird's own forward, measured against the LOCAL radial.
     * atan2, not asin, so it reads the full circle: a roll through inverted is
     * 0 -> -180 -> 0, where asin would fold it to 0 -> -90 -> 0 and hide the
     * half of the move that matters.
     *
     * NEGATIVE is a right bank (right wing down), matching bird-visual.js's own
     * convention — stick +1 (right) banks right wing down and turns right.
     * Degenerate (returns 0) at exactly vertical, where the bird's up and right
     * are both perpendicular to the radial and "bank" has no meaning.
     */
    bankAngle() {
        const s = this._scratch;
        s.up.copy(this.position).sub(this.sphereCenter);
        if (s.up.lengthSq() < 1e-12) return 0;
        s.up.normalize();
        s.right.set(1, 0, 0).applyQuaternion(this.quaternion);
        s.bodyUp.set(0, 1, 0).applyQuaternion(this.quaternion);
        return Math.atan2(s.up.dot(s.right), s.up.dot(s.bodyUp));
    }

    /** Nose elevation above the local horizon, radians, +/- 90. */
    pitchAngle() {
        const s = this._scratch;
        s.up.copy(this.position).sub(this.sphereCenter);
        if (s.up.lengthSq() < 1e-12) return 0;
        s.up.normalize();
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        return Math.asin(Math.max(-1, Math.min(1, s.forward.dot(s.up))));
    }

    /**
     * The speed the energy model is chasing.
     *
     * Writing it is also the HANDOVER: index.html writes `cruise` every frame
     * the bird is flying under its own control and never writes it otherwise,
     * so this is the one signal that says "the energy model owns speed now".
     * Everything that drives the bird by hand instead — the walk, the falling
     * resume speed, the freeze, and nesting's setSpeed(4) approach / setSpeed(0)
     * hold — writes `speed`, and must keep the speed it asked for: a nest climb
     * at 30 degrees would otherwise bleed from 4.0 to the 2.2 energy floor and
     * halve the approach the landing auto-fly is timed against.
     */
    get cruise() { return this._cruise; }

    set cruise(value) {
        this._cruise = value;
        this._commanded = false;
    }

    /** Speed as a fraction of the target. 1.0 is trimmed; >1 is a dive. */
    energy() {
        if (!Number.isFinite(this.cruise) || Math.abs(this.cruise) < 1e-6) return 1;
        return this.speed / this.cruise;
    }

    // ---- the mapping -------------------------------------------------------

    /**
     * Roll about the bird's own long axis. Positive `angle` carries the LEFT
     * wing down (bank angle increases); stick x is negated below for the same
     * reason v1's aerobatic() negates its roll — forward is local -Z, so a
     * positive rotation about +Z lifts the right wing.
     */
    _rollBy(angle) {
        if (!angle) return;
        const s = this._scratch;
        s.axis.set(0, 0, 1);
        s.quat.setFromAxisAngle(s.axis, angle);
        this.quaternion.multiply(s.quat);
    }

    /** Pitch about the bird's own right. Positive is nose-up. No clamp. */
    _pitchBy(angle) {
        if (!angle) return;
        const s = this._scratch;
        s.axis.set(1, 0, 0);
        s.quat.setFromAxisAngle(s.axis, angle);
        this.quaternion.multiply(s.quat);
    }

    /**
     * Yaw about the PLANET'S up, never the bird's own — the same axis choice v1
     * made and for the same measured reason: at 60-70 degrees nose-down the
     * bird's own up points backward along the ground, so a yaw there is a
     * world-space ROLL and a held dive spirals out of itself.
     *
     * Positive `angle` turns LEFT (rotating forward about +up carries -Z toward
     * -X), so the caller negates for a right turn.
     */
    _yawBy(angle) {
        if (!angle) return;
        const s = this._scratch;
        s.axis.copy(this.position).sub(this.sphereCenter);
        if (s.axis.lengthSq() < 1e-12) return;
        s.axis.normalize();
        // Into the bird's own frame, because the rotation is applied on the
        // right (local axis). Zero allocations.
        s.quatInv.copy(this.quaternion).invert();
        s.axis.applyQuaternion(s.quatInv);
        s.quat.setFromAxisAngle(s.axis, angle);
        this.quaternion.multiply(s.quat);
    }

    /**
     * How much of a stabiliser to apply, given how hard the stick is held.
     * A held input is never fought: at full deflection both stabilisers are off
     * entirely, which is what lets a held roll pass through inverted and a held
     * pull go over the top instead of being levelled out halfway.
     */
    _deadzoned(v) {
        const a = Math.abs(v || 0);
        return a < this.deadzone ? 0 : Math.min(1, a);
    }

    /**
     * Self-righting toward wings-level, a bird's dihedral.
     *
     * Constant rate outside `rightingSoftBank`, proportional inside it. The
     * obvious -sin(bank) form (v1's `_levelRoll`) is NOT usable here: it goes
     * to zero at 180 degrees, so an inverted bird sits in an equilibrium and
     * never rights — measured against the 3-second recovery this has to hit,
     * a sin-based term needs 4.3 s from inverted and this one 2.2 s.
     */
    _selfRight(bank, scale, dt) {
        if (scale <= 0) return;
        const soft = Math.max(1e-3, this.rightingSoftBank);
        const drive = Math.max(-1, Math.min(1, bank / soft));
        this._rollBy(-drive * this.rightingRate * scale * dt);
    }

    /**
     * Pitch stability: return the nose to the horizon by the SHORTEST path.
     *
     * Rotating about local X moves forward toward the bird's own up, so the
     * correction has to be signed by `up . bodyUp` as well as by the pitch —
     * without that an INVERTED bird with the nose down gets pushed further
     * over rather than back to level. The same product makes the term vanish at
     * a knife edge (bodyUp perpendicular to the radial), where a rotation about
     * local X does not change the pitch at all. Both are the shortest path,
     * falling out of one multiplication.
     */
    _pitchStability(scale, dt) {
        if (scale <= 0) return;
        const s = this._scratch;
        s.up.copy(this.position).sub(this.sphereCenter);
        if (s.up.lengthSq() < 1e-12) return;
        s.up.normalize();
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        s.bodyUp.set(0, 1, 0).applyQuaternion(this.quaternion);
        const sinPitch = Math.max(-1, Math.min(1, s.forward.dot(s.up)));
        this._pitchBy(-sinPitch * s.up.dot(s.bodyUp) * this.pitchStabilityRate * scale * dt);
    }

    /**
     * Energy. dSpeed = (-gSpeed * sin(pitch) - drag * (speed - cruise)) * dt,
     * bounded to [minMul, maxMul] * cruise.
     *
     * Suspended whenever the speed is COMMANDED rather than handed over as a
     * target (see the `cruise` accessor), and for a non-positive target — a
     * reverse walk is a NEGATIVE speed, which flips the bounds over.
     */
    _integrateEnergy(dt) {
        const cruise = this._cruise;
        if (this._commanded || !(cruise > 0)) {
            this.speed = cruise;
            return;
        }
        const sinPitch = Math.sin(this.pitchAngle());
        this.speed += (-this.gSpeed * sinPitch - this.drag * (this.speed - cruise)) * dt;
        const lo = this.minMul * cruise;
        const hi = this.maxMul * cruise;
        if (this.speed < lo) this.speed = lo;
        else if (this.speed > hi) this.speed = hi;
    }

    // ---- frame -------------------------------------------------------------

    tick(input, deltaTime) {
        const dt = Math.min(Math.max(deltaTime, 0), 0.05);

        // Honour a direct write to `speed` from outside (see _lastTickSpeed).
        // Straight to the backing field: a direct write to `speed` is the
        // OPPOSITE of a handover, so it must not clear `_commanded`.
        if (this.speed !== this._lastTickSpeed) {
            this._cruise = this.speed;
            this._commanded = true;
        }

        if (dt <= 0) {
            this._lastTickSpeed = this.speed;
            return this._getPose();
        }

        const x = input?.x ?? 0;
        const y = input?.y ?? 0;
        // Zen softens the rates the same way it softens v1's; it is a feel
        // multiplier, not a different controller.
        const rollMul = this.zenMode ? ZEN_TUNING.yawMul : 1;
        const pitchMul = this.zenMode ? ZEN_TUNING.pitchMul : 1;

        // 1. Stick. Roll first, so the bank the turn is derived from is this
        //    frame's bank and not last frame's.
        this._rollBy(-x * this.rollRate * rollMul * dt);
        this._pitchBy(y * this.pitchRate * pitchMul * dt);

        // 2. Turn from the bank. sin(bank) is negative in a right bank and the
        //    yaw axis turns LEFT for a positive angle, so both terms carry the
        //    same sign and a right bank turns right.
        const bank = this.bankAngle();
        this._yawBy((this.turnGain * Math.sin(bank) - this.yawAssist * x) * rollMul * dt);

        // 3. Stabilisers, scaled by how hard the stick is held. The plan scales
        //    the righting by (1 - |x|) alone; it is scaled by the PITCH stick
        //    too because at the top of a loop the bank reads 180 degrees by
        //    construction (the bird is upside down), so a righting term that
        //    ignored |y| would roll a held loop into an Immelmann and the
        //    heading would not survive it.
        const ax = this._deadzoned(x);
        const ay = this._deadzoned(y);
        this._selfRight(bank, (1 - ax) * (1 - ay), dt);
        this._pitchStability(1 - ay, dt);

        // 4. Energy, then move.
        this._integrateEnergy(dt);
        const pose = this.update(dt);
        this._lastTickSpeed = this.speed;
        return pose;
    }

    /**
     * Move, hold the floor, transport.
     *
     * This is v1's update() with the two STABILISERS taken out (auto-level to
     * the horizon and the maxPitch clamp) — v2 owns those, unclamped, above.
     * The floor itself is not re-derived: `_floorAt` and `_deflectAlongTerrain`
     * are v1's, inherited, so there is exactly one definition of the carved
     * terrain floor across both controllers.
     */
    update(deltaTime) {
        if (deltaTime <= 0) return this._getPose();
        const s = this._scratch;

        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        const speedMul = this.zenMode ? ZEN_TUNING.speedMul : 1;
        const step = this.speed * speedMul * deltaTime;

        s.oldPos.copy(this.position);
        s.oldNormal.copy(s.oldPos).sub(this.sphereCenter).normalize();

        this.position.addScaledVector(s.forward, step);

        // Minimum radius only — the floor follows carved valleys DOWN so the
        // bird can fly into canyons, and never rises, because with no gravity a
        // raised floor would ratchet a cruising bird upward.
        s.radialOffset.copy(this.position).sub(this.sphereCenter);
        const radialDistance = s.radialOffset.length();
        const floor = (radialDistance > 1e-3)
            ? this._floorAt(s.radialOffset.x / radialDistance, s.radialOffset.y / radialDistance, s.radialOffset.z / radialDistance)
            : this.sphereRadius + this.birdRadius;
        if (radialDistance < floor) {
            s.radialOffset.normalize().multiplyScalar(floor);
            this.position.copy(s.radialOffset).add(this.sphereCenter);
            if (this.terrainHeightAt && Math.abs(this.speed) > 0.5 && radialDistance > 1e-3) {
                this._deflectAlongTerrain(s.radialOffset.x / floor, s.radialOffset.y / floor, s.radialOffset.z / floor);
            }
        }

        // Parallel transport: we moved along the sphere, so the local vertical
        // changed and the whole body frame is dragged with it. This is what
        // keeps a "level" bird level all the way round the planet.
        s.newNormal.copy(this.position).sub(this.sphereCenter).normalize();
        s.transportQuat.setFromUnitVectors(s.oldNormal, s.newNormal);
        this.quaternion.premultiply(s.transportQuat);

        return this._getPose();
    }

    _getPose() {
        const out = super._getPose();
        // v1 leaves velocity at zero (it has no velocity vector). v2 does know
        // it — speed along forward — and the debug arrow in index.html draws
        // whatever it is given, so give it the real one.
        out.velocity.set(0, 0, -1).applyQuaternion(this.quaternion).normalize().multiplyScalar(this.speed);
        return out;
    }

    // ---- contract ----------------------------------------------------------

    /**
     * No-ops. Committed aerobatics are what v2 exists to delete: a roll is the
     * stick held over and a loop is the stick held back. Present so the
     * per-frame block in index.html needs no branch for them.
     */
    aerobatic() { this.aerobaticActive = false; }
    endAerobatic() { this.aerobaticActive = false; }

    /** Set the instantaneous speed AND the target it will settle back to. */
    setSpeed(speed) {
        this.speed = speed;
        this._cruise = speed;
        this._commanded = true;
        this._lastTickSpeed = speed;
    }

    /** The glide-speed slider sets the TARGET, so it is a handover, not a command. */
    setThrottle(value) {
        super.setThrottle(value);
        this.cruise = this.speed;
        this._lastTickSpeed = this.speed;
    }

    reset() {
        super.reset();
        this.cruise = this.speed;
        this._lastTickSpeed = this.speed;
    }
}
