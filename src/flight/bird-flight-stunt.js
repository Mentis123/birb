/**
 * bird-flight-stunt.js — fly the bird like a bi-wing stunt plane.
 *
 * The owner's brief: "Plan new joystick control mechanics so the birb can be
 * controlled like a bi-wing stunt plane, to do stunts and aerobatics. This
 * will be a total rewrite of the current weird triggered animation rolls and
 * stuff." See docs/realism/STUNT_FLIGHT_PLAN.md.
 *
 * WHAT A STUNT PLANE IS, AS A CONTROL LAW. The stick commands RATES, the
 * aircraft has no opinion about which way is up, and the pilot supplies the
 * coordination. Everything here follows from that one sentence:
 *
 *   stick x   -> ROLL RATE about the bird's own forward (cubic expo)
 *   stick y   -> PITCH RATE about the bird's own right (unlimited: a loop
 *                IS a 360-degree pitch)
 *   rudder    -> YAW RATE about the BIRD'S OWN UP — that is what a rudder
 *                is. Not the planet's up: yawing about the radial in a
 *                knife edge is a skid, not a heading hold.
 *   throttle  -> the speed the energy model chases
 *
 * and NOTHING turns the bird except the lift vector. There is no auto-yaw
 * from bank. A turn is bank-then-pull, which on a thumbstick is one push to
 * the diagonal. That single omission is the difference between this and
 * `bird-flight-v2.js`: v2's `turnGain * sin(bank)` means 90 degrees of bank
 * yaws you at over 100 deg/s about the radial, so a knife edge cannot hold a
 * heading and is not a manoeuvre you can fly.
 *
 * WHY THE PURE-RATE LAW IS SAFE ON A THUMBSTICK THIS TIME. G-FLIGHT-V2's
 * adversarial review refuted the first pure-rate cut (v70) because an
 * ordinary hard turn reads raw 0.6-0.8 on this stick and a LINEAR roll rate
 * put the bird on its back. Three terms answer that without bringing back a
 * rail (the hidden mode boundary at 0.97 that only a thumb pressed to the
 * plastic ever reaches):
 *
 *   1. cubic expo (`rollExpo`) — half stick is a third of the rate, and the
 *      last 30% of travel holds half the authority;
 *   2. bank is only righted with the WHOLE stick idle, so a bank held
 *      through a turn survives (v70 scaled righting by 1 - |x|, so every
 *      intermediate bank decayed under the thumb and the only cure was more
 *      stick, which rolled it over);
 *   3. roll rate eases under load (`gRollDamp`) — a wing being pulled hard
 *      rolls slower, which is true of the aeroplane and turns a diagonal
 *      stick from a corkscrew into a banked turn.
 *
 * LIFT, SINK AND STALL ARE WHAT MAKE THE STUNTS REAL. A knife edge with no
 * sink is a pose; a knife edge that falls out of the sky unless you hold it
 * is a manoeuvre. `lift` is the wing's, `sink` is what is left of gravity
 * when the wing is not carrying it, and below `stallMul` the nose
 * weathervanes toward the velocity — which is the hammerhead, for free, with
 * no move list, no trigger and no dwell.
 *
 * ONE CLASS, TWO MODELS. `model` is 'stunt' or 'classic'; under 'classic'
 * every method delegates to `BirdFlight`'s, so the settings toggle is a live
 * switch that rewires nothing. Swapping controller OBJECTS at runtime would
 * mean re-pointing every closure that captured `flight` (the camera rig, the
 * nesting system, the drone system, the debug hooks); a field does not.
 *
 * Up is the LOCAL RADIAL everywhere in this file — except the rudder axis,
 * which is the bird's own up on purpose, and is the one exception in the
 * codebase. There is no world +Y.
 *
 * Zero allocations in tick()/update(): scratch objects only, `_` prefixed.
 */

import { BirdFlight, ZEN_TUNING } from './bird-flight.js';

export const FLIGHT_MODELS = Object.freeze({ STUNT: 'stunt', CLASSIC: 'classic' });

/**
 * One tuning table. `?stunttune=rollMax:6,gSink:5` overrides any of it at
 * boot and `flightProbe().tuning` reports it back, because these are start
 * points chosen from what a Pitts does, not measurements from the phone.
 */
export const FLIGHT_STUNT_DEFAULTS = {
    // 300 deg/s — a full roll in 1.2 s at the rail. An aerobatic biplane
    // rolls at 240-400; below about 240 a roll reads as a wallow.
    rollMax: 5.2,
    // The LINEAR share of the cubic expo at the centre of the stick. At 0.35,
    // half stick is 34% of the rate and 0.7 is 47%. This is the number that
    // makes a pure-rate roll axis survive a thumb.
    rollExpo: 0.35,
    // Roll authority lost at full pull: a wing under load rolls slower.
    // Without it a diagonal stick is a corkscrew instead of a banked turn.
    gRollDamp: 0.45,
    // 150 deg/s — a loop in 2.4 s. Radius is speed over rate, about 4.2 at
    // cruise, so roughly 11 units across once the energy dip is counted.
    pitchMax: 2.6,
    // 69 deg/s of rudder. Enough to hold a knife edge's heading and to pivot
    // a hammerhead; deliberately not enough to flat-turn the bird, which
    // would hand back the auto-turn this law exists to remove.
    yawMax: 1.2,
    // Idle-only stability. Runs ONLY with the whole stick inside the
    // deadzone — see the class comment.
    righting: 0.7,
    // 0.4, not 0.5, and scaled by authority in `_pitchTrimStep`. Measured:
    // at 0.5 unscaled the nose is dragged back to the horizon from vertical
    // before the energy model can bleed the speed below stall (bottomed at
    // 6.3 against a 5.5 stall), so a hammerhead was unreachable at full
    // power. This is also the difference between a trim and an autopilot.
    pitchTrim: 0.4,
    // Past 120 degrees of bank an idle bird is closer to inverted than to
    // upright, and STAYS inverted. Inverted level flight is a stunt; a
    // controller that rolls you out of it is v2.
    rightingLimit: 2.09,
    // Energy (v2's model, verbatim), with a lower floor so a stall exists at
    // all: 0.35 * cruise is below `stallMul`.
    // 7.5, from v2's 6.0. A stunt plane pointing straight up loses its
    // airspeed fast, and that deceleration is what every vertical figure is
    // made of: at 7.5 a sustained vertical bleeds toward 11 - 7.5/0.9 = 2.7,
    // which is under the 5.5 stall, so the wing actually stops flying.
    gSpeed: 7.5,
    drag: 0.9,
    minMul: 0.35,
    maxMul: 1.9,
    // Gravity, as it appears once the wing is not carrying it. 4 units/s of
    // sink in a knife edge against an 11-unit cruise: legible from the chase
    // camera, and recoverable.
    gSink: 4.0,
    // Below half cruise the nose weathervanes toward the velocity at
    // `stallRate`. This is the hammerhead and the tail slide.
    stallMul: 0.5,
    stallRate: 2.0,
    // Throttle range, as a multiple of cruise. Springs back to 1.
    throttleIdle: 0.55,
    throttleFull: 1.35,
    // Matches index.html's INPUT_SHAPE deadzone, so "the stick is idle" means
    // the same thing here as it does to the shaper upstream.
    deadzone: 0.08,
    // 0 = the biplane, 1 = v2's attitude-hold assistance. One scalar on one
    // code path, not a second controller and not a rail.
    assist: 0,
};

/** Cubic expo, sign-preserving. `linear` is the share held at the centre. */
export function stickExpo(v, linear) {
    const a = Math.abs(v);
    return Math.sign(v) * a * (linear + (1 - linear) * a * a);
}

export class BirdFlightStunt extends BirdFlight {
    constructor(THREE, options = {}) {
        super(THREE, options);
        const { Vector3, Quaternion } = THREE;
        const D = FLIGHT_STUNT_DEFAULTS;

        this.model = options.model === FLIGHT_MODELS.CLASSIC
            ? FLIGHT_MODELS.CLASSIC : FLIGHT_MODELS.STUNT;

        for (const key of Object.keys(D)) {
            this[key] = options[key] ?? D[key];
        }

        // v1's constructor set `pitchRate`; the stunt law never reads it, but
        // `model: 'classic'` does, so it is left exactly as v1 wrote it.

        // The speed the energy model chases, and the handover flag. Identical
        // in meaning to v2's: index.html writes `cruise` every frame the bird
        // is flying under its own control and writes `speed` directly for
        // everything else (walking, the falling resume speed, the freeze, the
        // nesting approach), which must keep the speed it asked for.
        this.cruise = options.cruise ?? this.speed;
        this._lastTickSpeed = this.speed;

        // Live throttle and rudder, both springing to neutral. The pad
        // (src/flight/stunt-pad.js) writes them through `tick`'s input.
        this._throttle01 = 1;
        this._rudder = 0;

        // What the last stunt tick did, in the bird's own frame. The trick
        // detector reads these rather than re-deriving angles from a
        // quaternion, because bank and pitch both have singularities exactly
        // where the interesting manoeuvres live.
        this.lastDeltas = { roll: 0, pitch: 0, yaw: 0, sink: 0, lift: 1, stalled: false };

        // No pitch ceiling under stunt: a loop is a 360-degree pitch, and any
        // ceiling makes one impossible. Reported as PI so flightProbe()'s
        // maxPitchDeg does not describe a clamp that is not there.
        //
        // v1's ceiling is KEPT ASIDE, not discarded. `model: 'classic'` runs
        // BirdFlight's own update(), which enforces `this.maxPitch` — so
        // overwriting it here unconditionally left classic with no clamp at
        // all, which is not v1 and not what the gear toggle promises. Caught
        // by tools/birb-stunt.mjs reading the probe after a live switch; both
        // the unit suite and the eye would have missed it, because a bird
        // that CAN loop under classic looks like a bird flying normally until
        // somebody loops it.
        this._classicMaxPitch = this.maxPitch;
        if (this.isStunt) this.maxPitch = Math.PI;

        this._scratch.right = new Vector3();
        this._scratch.bodyUp = new Vector3();
        this._scratch.velDir = new Vector3();
        this._scratch.sinkVec = new Vector3();
        this._scratch.weatherAxis = new Vector3();
        this._scratch.weatherQuat = new Quaternion();
    }

    /** Live model switch, from the gear menu. Returns the model now in force. */
    setModel(model) {
        const next = model === FLIGHT_MODELS.CLASSIC
            ? FLIGHT_MODELS.CLASSIC : FLIGHT_MODELS.STUNT;
        if (next === this.model) return this.model;
        this.model = next;
        // The pitch ceiling belongs to the law, not to the object.
        this.maxPitch = this.isStunt ? Math.PI : this._classicMaxPitch;
        // Hand speed ownership back and forth cleanly. Classic writes
        // `speed` every frame from index.html, so the energy model must not
        // be left mid-integration when stunt resumes.
        this.cruise = this.speed;
        this._lastTickSpeed = this.speed;
        this._throttle01 = 1;
        this._rudder = 0;
        this.lastDeltas.roll = 0;
        this.lastDeltas.pitch = 0;
        this.lastDeltas.yaw = 0;
        return this.model;
    }

    get isStunt() { return this.model === FLIGHT_MODELS.STUNT; }

    // ---- read-only probes --------------------------------------------------

    /**
     * Bank about the bird's own forward, against the LOCAL radial. atan2, not
     * asin, so a roll through inverted reads 0 -> -180 -> 0 instead of being
     * folded to 0 -> -90 -> 0, which hides the half that matters.
     * NEGATIVE is a right bank (right wing down), matching bird-visual.js.
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
     * The wing's lift, 1 at cruise and upright. Falls with the square of
     * speed, and with the cosine of how far the bird's up has rolled from the
     * radial: a 60-degree bank carries half, a knife edge carries none, and
     * inverted carries NEGATIVE lift. A level turn therefore wants back
     * stick, which is the pilot's job and is the whole point.
     */
    liftFactor() {
        const s = this._scratch;
        s.up.copy(this.position).sub(this.sphereCenter);
        if (s.up.lengthSq() < 1e-12) return 1;
        s.up.normalize();
        s.bodyUp.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
        const cruise = this._cruise > 0 ? this._cruise : 1;
        const q = Math.min(1.6, (this.speed / cruise) * (this.speed / cruise));
        const lift = q * s.bodyUp.dot(s.up);
        // The assist knob puts a floor under it so nothing falls fast in Zen.
        return this.assist > 0 ? Math.max(lift, 0.6 * this.assist) : lift;
    }

    /** Units per second the bird is falling, radially. Never negative. */
    sinkRate() {
        if (this._commanded) return 0;
        const s = Math.max(0, 1 - this.liftFactor());
        return Math.min(s, 2) * this.gSink;
    }

    /**
     * The speed the energy model is chasing. Writing it is the HANDOVER —
     * see the same accessor in bird-flight-v2.js for why it matters: a nest
     * approach at setSpeed(4) climbing at 30 degrees would otherwise bleed to
     * the energy floor and halve the approach the landing auto-fly is timed
     * against.
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

    /**
     * Control authority, 0.35..1.2 — how much of the commanded rate the air
     * will actually give. A stalled bird is not a bird with full elevator.
     */
    authority() {
        const cruise = this._cruise > 0 ? this._cruise : 1;
        return Math.max(0.35, Math.min(1.2, Math.abs(this.speed) / cruise));
    }

    /** True while the wing is below flying speed. */
    isStalled() {
        const cruise = this._cruise > 0 ? this._cruise : 1;
        return this.isStunt && Math.abs(this.speed) < this.stallMul * cruise;
    }

    // ---- rotations ---------------------------------------------------------

    /**
     * Roll about the bird's own long axis. POSITIVE carries the LEFT wing
     * down (bank angle increases), so the caller negates for a right stick —
     * forward is local -Z, and a positive rotation about +Z lifts the right
     * wing. This sign has been got wrong three times in this codebase; the
     * unit test checks where the wing TIP ends up, never the sign of an angle.
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
     * Rudder: yaw about the BIRD'S OWN UP (local +Y). Positive turns LEFT
     * (rotating forward about +Y carries -Z toward -X), so the caller negates
     * for a right rudder.
     *
     * This is the one axis in the codebase that is deliberately NOT the
     * planet's radial. v1 yaws about the radial because it has no roll at all
     * and a body-axis yaw in a dive would be a world-space roll. Here the
     * bird can be at any attitude and the rudder has to mean what a rudder
     * means: in a knife edge it is the elevator, at the top of a vertical
     * climb it is what pivots a hammerhead, and about the radial it would do
     * neither.
     */
    _rudderBy(angle) {
        if (!angle) return;
        const s = this._scratch;
        s.axis.set(0, 1, 0);
        s.quat.setFromAxisAngle(s.axis, angle);
        this.quaternion.multiply(s.quat);
    }

    /**
     * Idle roll righting. Toward wings-level by the short way round, and only
     * while the bird is within `rightingLimit` of upright — past that it is
     * closer to inverted, and an inverted bird that is left alone stays
     * inverted (and sinks, which is the tell).
     */
    _rightingStep(dt, strength) {
        const bank = this.bankAngle();
        if (Math.abs(bank) > this.rightingLimit) return 0;
        // `bank` is POSITIVE for a left bank and `_rollBy(+)` deepens a left
        // bank, so the correction is the negative of the error. The sign is
        // folded in once, here.
        // Scaled by AUTHORITY, because this is an aerodynamic term and not an
        // autopilot: a wing with no air over it does not right itself.
        const rate = Math.max(-this.righting, Math.min(this.righting, -bank * 2.2))
            * strength * this.authority();
        const step = rate * dt;
        this._rollBy(step);
        return step;
    }

    /**
     * Idle pitch trim toward the horizon, shortest path, full authority at
     * the vertical. NOT sin(2p): that term is zero at 90 degrees, which is
     * how v70 left a nose-up bird hanging there (G-FLIGHT-V2, F3).
     *
     * Rotating about local X moves the nose toward the bird's OWN up, so the
     * direction is signed by up . bodyUp — an inverted bird with the nose
     * down is pushed back to ITS horizon, not rolled upright. Only the sign;
     * the magnitude is the error.
     */
    _pitchTrimStep(dt, strength) {
        const s = this._scratch;
        s.up.copy(this.position).sub(this.sphereCenter);
        if (s.up.lengthSq() < 1e-12) return 0;
        s.up.normalize();
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        s.bodyUp.set(0, 1, 0).applyQuaternion(this.quaternion);
        const pitch = Math.asin(Math.max(-1, Math.min(1, s.forward.dot(s.up))));
        // Scaled by AUTHORITY, and that is what makes the hammerhead exist. An
        // unscaled trim drags the nose down from the vertical at a constant
        // 0.5 rad/s whatever the airspeed, so the bird is always back at the
        // horizon before the energy model can bleed it below stall — measured:
        // the speed bottomed at 6.3 against a 5.5 stall and the wing never
        // stopped flying. With the scale, a bird that has run out of speed
        // hangs there instead, and the weathervane takes it.
        const rate = Math.max(-this.pitchTrim, Math.min(this.pitchTrim, -pitch * 2.0))
            * strength * this.authority();
        const sign = s.up.dot(s.bodyUp) >= 0 ? 1 : -1;
        const step = rate * sign * dt;
        this._pitchBy(step);
        return step;
    }

    /**
     * The stall. Below flying speed the nose swings toward wherever the bird
     * is actually GOING, at a rate that grows the further below stall it is.
     *
     * This one term is the hammerhead: pull to the vertical at idle throttle,
     * the energy model bleeds the speed away against gravity, authority
     * fades, and the nose falls through toward a velocity that by then points
     * straight down. With a boot of rudder at the top it pivots instead of
     * sliding back. Neither is a scripted move; both are this term.
     */
    _weathervaneStep(dt) {
        const cruise = this._cruise > 0 ? this._cruise : 1;
        const stallSpeed = this.stallMul * cruise;
        const spd = Math.abs(this.speed);
        if (spd >= stallSpeed) return false;
        const s = this._scratch;
        // The real velocity: forward at speed, plus the sink straight down.
        s.up.copy(this.position).sub(this.sphereCenter);
        if (s.up.lengthSq() < 1e-12) return false;
        s.up.normalize();
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        s.velDir.copy(s.forward).multiplyScalar(this.speed).addScaledVector(s.up, -this.sinkRate());
        if (s.velDir.lengthSq() < 1e-8) return false;
        s.velDir.normalize();
        const dot = Math.max(-1, Math.min(1, s.forward.dot(s.velDir)));
        const err = Math.acos(dot);
        if (err < 1e-4) return true;
        s.weatherAxis.copy(s.forward).cross(s.velDir);
        if (s.weatherAxis.lengthSq() < 1e-10) return true;
        s.weatherAxis.normalize();
        const depth = Math.min(1, (stallSpeed - spd) / Math.max(1e-6, stallSpeed));
        const step = Math.min(err, this.stallRate * depth * dt);
        s.weatherQuat.setFromAxisAngle(s.weatherAxis, step);
        // World-space axis, so premultiply.
        this.quaternion.premultiply(s.weatherQuat);
        return true;
    }

    /** The stick, deadzone applied, sign kept. */
    _stick(v) {
        const a = Math.abs(v || 0);
        if (a < this.deadzone) return 0;
        return Math.sign(v) * Math.min(1, a);
    }

    /**
     * Energy. Identical to v2's, with the throttle folded into the target:
     * dSpeed = (-gSpeed * sin(pitch) - drag * (speed - target)) * dt.
     * Suspended whenever the speed is COMMANDED rather than handed over.
     */
    _integrateEnergy(dt) {
        const cruise = this._cruise;
        if (this._commanded || !(cruise > 0)) {
            this.speed = cruise;
            return;
        }
        const target = cruise * this._throttle01;
        const sinPitch = Math.sin(this.pitchAngle());
        this.speed += (-this.gSpeed * sinPitch - this.drag * (this.speed - target)) * dt;
        const lo = this.minMul * cruise;
        const hi = this.maxMul * cruise;
        if (this.speed < lo) this.speed = lo;
        else if (this.speed > hi) this.speed = hi;
    }

    // ---- frame -------------------------------------------------------------

    tick(input, deltaTime) {
        if (!this.isStunt) return super.tick(input, deltaTime);

        const dt = Math.min(Math.max(deltaTime, 0), 0.05);

        // Honour a direct write to `speed` from outside — walking, the
        // falling resume speed, the freeze, the studio harness. Straight to
        // the backing field: a direct write is the OPPOSITE of a handover, so
        // it must not clear `_commanded`.
        if (this.speed !== this._lastTickSpeed) {
            this._cruise = this.speed;
            this._commanded = true;
        }

        const d = this.lastDeltas;
        d.roll = 0; d.pitch = 0; d.yaw = 0;

        if (dt <= 0) {
            this._lastTickSpeed = this.speed;
            return this._getPose();
        }

        const sx = this._stick(input?.x ?? 0);
        const sy = this._stick(input?.y ?? 0);
        const rud = this._stick(input?.rudder ?? 0);
        // The pad springs to 1; an absent field means "no pad on this build".
        const thr = Number.isFinite(input?.throttle) ? input.throttle : 1;
        this._throttle01 = Math.max(this.throttleIdle, Math.min(this.throttleFull, thr));
        this._rudder = rud;

        const zenRoll = this.zenMode ? ZEN_TUNING.yawMul : 1;
        const zenPitch = this.zenMode ? ZEN_TUNING.pitchMul : 1;
        const auth = this.authority();

        // 1. Roll. Cubic expo, eased by authority and by how hard the wing is
        //    being pulled. Stick +1 (right) banks the RIGHT wing down, which
        //    is a NEGATIVE rotation about +Z.
        if (sx) {
            const load = 1 - this.gRollDamp * Math.abs(sy);
            const assistMul = 1 - 0.5 * this.assist;
            const rate = stickExpo(sx, this.rollExpo) * this.rollMax
                * (0.6 + 0.4 * auth) * load * assistMul * zenRoll;
            const step = -rate * dt;
            this._rollBy(step);
            d.roll = step;
        }

        // 2. Pitch. Unlimited — a loop is a 360-degree pitch and any ceiling
        //    makes one impossible.
        if (sy) {
            const step = sy * this.pitchMax * auth * zenPitch * dt;
            this._pitchBy(step);
            d.pitch = step;
        }

        // 3. Rudder, about the bird's own up. Right rudder turns right, which
        //    is a negative rotation about +Y.
        if (rud) {
            const step = -rud * this.yawMax * auth * dt;
            this._rudderBy(step);
            d.yaw = step;
        }

        // 4. Stability, and ONLY with the whole stick idle. This is the term
        //    v70 got wrong: scaled by (1 - |x|) it decayed every intermediate
        //    bank under the thumb, so the only way to hold a turn was more
        //    stick, which rolled the bird over. A bank you put in stays in.
        //    The `assist` knob is the one exception, and it is a scalar.
        const idle = !sx && !sy && !rud;
        if (idle) {
            d.roll += this._rightingStep(dt, 1);
            d.pitch += this._pitchTrimStep(dt, 1);
        } else if (this.assist > 0) {
            const slack = Math.max(0, 1 - Math.max(Math.abs(sx), Math.abs(sy)));
            d.roll += this._rightingStep(dt, this.assist * slack);
            d.pitch += this._pitchTrimStep(dt, this.assist * slack);
        }

        // 5. The stall, then energy, then move.
        d.stalled = this._weathervaneStep(dt);
        this._integrateEnergy(dt);
        d.lift = this.liftFactor();
        d.sink = this.sinkRate();
        const pose = this.update(dt);
        this._lastTickSpeed = this.speed;
        return pose;
    }

    /**
     * Move, sink, hold the floor, transport.
     *
     * v2's update() with the sink added. The two STABILISERS v1's update()
     * carries (auto-level to the horizon and the maxPitch clamp) are not
     * here: this controller owns those, unclamped, above. `_floorAt` and
     * `_deflectAlongTerrain` are v1's, inherited, so there is exactly one
     * definition of the carved terrain floor across all three models.
     *
     * THE SINK CANNOT BREAK THE GRAVITY-LESS-FLOOR INVARIANT. It only ever
     * pushes the bird DOWN, and the floor is a minimum radius that only ever
     * dips below the baseline — so nothing here can ratchet a cruising bird
     * upward, which is the failure the invariant exists to prevent.
     */
    update(deltaTime) {
        if (!this.isStunt) return super.update(deltaTime);
        if (deltaTime <= 0) return this._getPose();
        const s = this._scratch;

        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        const speedMul = this.zenMode ? ZEN_TUNING.speedMul : 1;
        const step = this.speed * speedMul * deltaTime;

        s.oldPos.copy(this.position);
        s.oldNormal.copy(s.oldPos).sub(this.sphereCenter).normalize();

        this.position.addScaledVector(s.forward, step);

        // Gravity, as much of it as the wing is not carrying. Position only —
        // never the orientation: a sinking bird still points where it points,
        // and that difference between where it looks and where it goes is
        // what a knife edge IS.
        const sink = this.sinkRate();
        if (sink > 0) {
            s.sinkVec.copy(s.oldNormal).multiplyScalar(-sink * deltaTime);
            this.position.add(s.sinkVec);
        }

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
        // changed and the whole body frame is dragged with it.
        s.newNormal.copy(this.position).sub(this.sphereCenter).normalize();
        s.transportQuat.setFromUnitVectors(s.oldNormal, s.newNormal);
        this.quaternion.premultiply(s.transportQuat);

        return this._getPose();
    }

    _getPose() {
        const out = super._getPose();
        if (!this.isStunt) return out;
        // The REAL velocity, sink included. The chase camera and the trick
        // detector both read this rather than `forward`: through a hammerhead
        // the velocity reverses smoothly while forward snaps round, and a
        // camera on forward flips at the top.
        const s = this._scratch;
        s.up.copy(this.position).sub(this.sphereCenter);
        out.velocity.set(0, 0, -1).applyQuaternion(this.quaternion).normalize().multiplyScalar(this.speed);
        if (s.up.lengthSq() > 1e-12) {
            s.up.normalize();
            out.velocity.addScaledVector(s.up, -this.sinkRate());
        }
        return out;
    }

    // ---- contract ----------------------------------------------------------

    /**
     * No-ops. Triggered aerobatics are exactly what this controller deletes:
     * a roll is the stick held over, a loop is the stick held back, and a
     * hammerhead is running out of speed pointing up. Present so nothing
     * downstream needs a branch.
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

    /** The glide-speed slider sets the TARGET, so it is a handover. */
    setThrottle(value) {
        super.setThrottle(value);
        this.cruise = this.speed;
        this._lastTickSpeed = this.speed;
    }

    reset() {
        super.reset();
        this.cruise = this.speed;
        this._lastTickSpeed = this.speed;
        this._throttle01 = 1;
        this._rudder = 0;
    }
}
