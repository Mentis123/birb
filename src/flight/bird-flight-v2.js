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
 *   stick x  -> a BANK to hold (up to maxBank), reached at rollRate; at the
 *               RAIL (|x| >= edge) a continuous roll rate instead
 *   stick y  -> a PITCH to hold (up to maxPitchHold); at the rail a
 *               continuous pitch rate — a loop
 *   turning  -> falls out of the bank: yaw about the RADIAL at
 *               turnGain * sin(bank), plus a small direct assist so a
 *               thumbstick still bites before the bank has built
 *   speed    -> an energy model: dive gains, climb bleeds, hands-off
 *               returns to `cruise`
 *
 * ATTITUDE below the rail, RATE at it. The first cut was a pure rate on both
 * axes and the adversarial review measured what that does on a thumbstick:
 * the only sustainable bank was where rollRate*|x| balanced the righting
 * term, |x| < 0.29 SHAPED (raw 0.40), and CLAUDE.md's own number for an
 * ordinary hard turn on this stick is raw 0.6-0.8 — so the first hard turn
 * the owner asked for would have rolled the bird onto its back, and a held
 * pitch had a trim band of about 12% of the stick. A stick that commands an
 * attitude holds exactly the bank or climb you put it at, wings level when
 * you let go, and the rail — the same 0.94 edge the old aerobatics trigger
 * measured as "only a thumb pressed to the rail sustains this" — is where
 * it becomes a rate: pin it and you keep rolling, pull it and you go over
 * the top. Rolls, loops, split-S, Immelmann and inverted flight are still
 * emergent; there is no move list, no trigger and no dwell.
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
    // 200 deg/s — a full roll in 1.8 s at the rail, and the most the bank
    // command may roll at on its way to a held bank.
    rollRate: 3.5,
    // 120 deg/s — a loop in 3 s at the rail. Deliberately unclamped there: a
    // loop IS a 360-degree pitch, so any ceiling makes one impossible.
    pitchRate: 2.1,
    // The rail. At or beyond this the stick commands a RATE (roll / loop);
    // below it an ATTITUDE. 0.97, because a virtual stick reads 0.6-0.8
    // through an ordinary hard turn and only a thumb pressed to the rail
    // sustains more — and 0.94 was reported from the phone as rolling "too
    // soon" on the v1 trigger; the rail is the same rail here.
    edge: 0.97,
    // The bank held with the stick just inside the rail: 70 degrees. Chosen
    // against the ground-contact rule in index.html (a bank steeper than
    // ~75 degrees on contact is a crash), so a maximum-bank turn that skims
    // the floor still lands.
    maxBank: 1.22,
    // The climb / dive held just inside the rail: 70 degrees. Past the rail
    // the pitch is a rate and goes round.
    maxPitchHold: 1.22,
    // Bank command: roll rate per radian of bank error, clamped to rollRate.
    // 2.0 is a half-second time constant — hands-off from inverted rights in
    // about 1.5 s (0.4 s at the rate clamp, then the exponential tail), and
    // a held bank settles without overshoot.
    bankGain: 2.0,
    // Pitch command, likewise. Also the hands-off stability: with the stick
    // centred the target is the horizon, and unlike a sin(2p) term this has
    // full authority at the vertical — a bird teleported nose-up no longer
    // hangs there.
    pitchGain: 2.0,
    // Yaw rate at a 90-degree bank. At the 70-degree maximum held bank, with
    // the assist, that is 127 deg/s against v1's flat 135 — a hard turn feels
    // like v1's; a half-stick 37-degree bank turns at about 80.
    turnGain: 2.0,
    // Direct yaw per unit stick, on top of the bank's own turn. Without it a
    // small thumbstick nudge does nothing for the ~0.3 s the bank takes to
    // build, which reads as lag rather than as inertia.
    yawAssist: 0.35,
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
    // Below this the stick counts as centred: the commanded attitude is the
    // horizon, wings level. index.html has already run the stick through
    // shapeAxis (deadzone + expo) before it reaches a controller.
    deadzone: 0.08,
};

/** Wrap an angle to (-PI, PI]. */
function wrapPi(a) {
    let r = a % (2 * Math.PI);
    if (r > Math.PI) r -= 2 * Math.PI;
    else if (r <= -Math.PI) r += 2 * Math.PI;
    return r;
}

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
        this.edge = options.edge ?? D.edge;
        this.maxBank = options.maxBank ?? D.maxBank;
        this.maxPitchHold = options.maxPitchHold ?? D.maxPitchHold;
        this.bankGain = options.bankGain ?? D.bankGain;
        this.pitchGain = options.pitchGain ?? D.pitchGain;
        this.turnGain = options.turnGain ?? D.turnGain;
        this.yawAssist = options.yawAssist ?? D.yawAssist;
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

    /** The stick, with the deadzone applied and the sign kept. */
    _stick(v) {
        const a = Math.abs(v || 0);
        if (a < this.deadzone) return 0;
        return Math.sign(v) * Math.min(1, a);
    }

    /**
     * Roll toward the commanded bank. `target` is the bank to hold (0 with the
     * stick centred — that is the dihedral); the rate is proportional to the
     * error, wrapped to the short way round, and clamped to rollRate.
     *
     * There is no sin(bank) in it, so inverted is not a fixed point: from
     * exactly 180 the wrap picks a side and the bird comes round at the clamp.
     */
    _bankCommand(target, bank, dt) {
        const err = wrapPi(target - bank);
        const rate = Math.max(-this.rollRate, Math.min(this.rollRate, this.bankGain * err));
        this._rollBy(rate * dt);
    }

    /**
     * Pitch toward the commanded elevation (0 with the stick centred — the
     * hands-off stability). Rotating about local X moves the nose toward the
     * bird's OWN up, so the direction is signed by up . bodyUp: an inverted
     * bird with the nose down is pushed back to the horizon, not further
     * over. Only the SIGN — the magnitude is the error, so the term keeps its
     * full authority at the vertical, where the earlier sin(2p) form was zero
     * and a bird teleported nose-up stayed nose-up.
     */
    _pitchCommand(target, dt) {
        const s = this._scratch;
        s.up.copy(this.position).sub(this.sphereCenter);
        if (s.up.lengthSq() < 1e-12) return;
        s.up.normalize();
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        s.bodyUp.set(0, 1, 0).applyQuaternion(this.quaternion);
        const pitch = Math.asin(Math.max(-1, Math.min(1, s.forward.dot(s.up))));
        const err = target - pitch;
        const rate = Math.max(-this.pitchRate, Math.min(this.pitchRate, this.pitchGain * err));
        const sign = s.up.dot(s.bodyUp) >= 0 ? 1 : -1;
        this._pitchBy(rate * sign * dt);
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

        // 1. Roll. At the rail a rate; below it a bank to hold. During a rail
        //    PULL the bank command is off entirely: at the top of a loop the
        //    bank reads 180 degrees by construction (the bird is upside down),
        //    and a command that saw that would roll the loop into an Immelmann.
        const sx = this._stick(x);
        const sy = this._stick(y);
        const railX = Math.abs(sx) >= this.edge;
        const railY = Math.abs(sy) >= this.edge;
        const bank = this.bankAngle();
        if (railX) {
            // Stick +1 (right) banks right wing DOWN: a negative rotation
            // about +Z, the same negation v1's aerobatic() makes.
            this._rollBy(-Math.sign(sx) * this.rollRate * rollMul * dt);
        } else if (!railY) {
            this._bankCommand(-(sx / this.edge) * this.maxBank, bank, dt);
        }

        // 2. Pitch. At the rail (and not rolling) a rate — the loop. Below it
        //    an elevation to hold, and with the stick centred that target is
        //    the horizon. During a rail ROLL the pitch command is off: a barrel
        //    roll holds its nose, and at a knife edge a rotation about local X
        //    is a yaw, not a correction.
        if (railY && !railX) {
            this._pitchBy(Math.sign(sy) * this.pitchRate * pitchMul * dt);
        } else if (!railX) {
            this._pitchCommand((sy / this.edge) * this.maxPitchHold, dt);
        }

        // 3. Turn from the bank. sin(bank) is negative in a right bank and the
        //    yaw axis turns LEFT for a positive angle, so both terms carry the
        //    same sign and a right bank turns right.
        this._yawBy((this.turnGain * Math.sin(this.bankAngle()) - this.yawAssist * sx) * rollMul * dt);

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
