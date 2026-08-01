/**
 * bird/flight.js — Birb Gauntlet's arcade flight model on a miniature planet.
 *
 * ===========================================================================
 * THIS FILE PORTS A SOLVED PROBLEM. DO NOT RE-DERIVE IT.
 * ===========================================================================
 * Spherical flight direction — "the bird flies in a fixed world direction no
 * matter which way it faces" — was the longest-running bug in the parent Birb
 * Mobile project (Dec 2025 – Jan 2026). The solved version lives in that
 * repo's `src/flight/bird-flight.js` and the approach is ported here verbatim
 * in structure:
 *
 *   1. FORWARD IS A VECTOR, NOT AN ANGLE. Movement is always
 *      `(0,0,-1).applyQuaternion(q)`. There is no stored heading angle to
 *      drift out of sync with the rendered model.
 *   2. PARALLEL TRANSPORT. Moving over a curved surface changes what "up"
 *      means. Each step we take the quaternion that rotates the OLD radial
 *      normal onto the NEW one and `premultiply` it (world space, applied
 *      first). That drags the whole orientation along the curve, so after a
 *      full lap the bird is upright and its heading still means what it did.
 *   3. RE-PROJECTION IS A FLOOR, NOT A SPRING. There is no gravity. The radial
 *      clamp only ever pushes the bird OUT to a minimum radius.
 *   4. THE FLOOR FOLLOWS TERRAIN DOWNWARD ONLY — `Math.min(0, h)` in
 *      `_floorAt` is load-bearing. terrain.js already guarantees h <= 0, but a
 *      floor that could rise above the baseline would ratchet a gravity-less
 *      bird upward over every hill and it could never come back down. See the
 *      invariant block at the top of core/terrain.js.
 *   5. PENETRATION SLIDES, IT DOES NOT STOP. When the bird flies into a rising
 *      wall the heading is deflected along the local slope instead of being
 *      snapped radially outward (which would launch it) or hard-stopped.
 *
 * ===========================================================================
 * WHAT Birb Gauntlet ADDS ON TOP: RACING FEEL
 * ===========================================================================
 *   - ENERGY TRADE. Speed builds in a dive and bleeds in a climb, with drag
 *     pulling back toward cruise. This is the whole reason a racing line has
 *     shape: you dive the canyon to bank speed and spend it on the climb.
 *   - TURNS TIGHTEN WITH SPEED. Yaw rate scales up with airspeed so a fast
 *     bird does not helplessly understeer into a wide arc.
 *   - BOOST METER charged by diving and by clean gate lines (`chargeBoost`),
 *     spent as a burst with a HARD ceiling and a cooldown so it is a tactical
 *     resource, not a permanent speed setting.
 *   - COMMITTED KNOCKDOWN. `applyKnockdown()` takes control away, ramps the
 *     fall 1x -> 3x, then relaunches with an outward impulse and a REALIGNED
 *     quaternion so the yaw you had before the tumble is the yaw you get back.
 *     No self-arrest — Birb Mobile shipped exactly this and the commitment is
 *     what makes a crash read as a crash.
 *
 * All the tunable math is factored into pure exported functions at the top so
 * it is unit-testable under `node --test` with no THREE and no DOM.
 *
 * THREE is passed into the constructor; this module imports nothing.
 * Zero allocation after construction — every vector, quaternion and matrix the
 * per-frame path touches lives on `this._s`.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * Tuned against a planet of radius 100 (circumference ~628 units). Cruise
 * gives a ~19s lap, which is the right length for a 3-lap arcade race.
 */
export const FLIGHT_CONFIG = {
    // --- speed envelope (world units / second) ---------------------------
    // Whole envelope taken down 20% from the original tuning: on a real phone
    // the bird outran the player's ability to read the next gate. Turn RATES
    // were deliberately left alone, so the same angular rate at a lower speed
    // gives a tighter turning radius — that is most of the "easier to control".
    // The accelerations (pitchEnergy, boostAccel) scale with it so the time
    // constants of the energy trade and the boost feel unchanged.
    cruiseSpeed: 27,        // what drag pulls you back toward
    minSpeed: 15,           // stall floor: a hard climb can never park you
    maxSpeed: 46,           // ceiling without boost
    boostMaxSpeed: 61,      // HARD ceiling while boosting

    // --- energy trade ------------------------------------------------------
    // dv/dt = -sinPitch * pitchEnergy. sinPitch is forward-dot-radial-up, so
    // nose-up (climb) is positive and bleeds speed; nose-down gains it.
    pitchEnergy: 24,
    dragCoef: 0.55,         // exponential pull back toward cruise, per second

    // --- handling ----------------------------------------------------------
    yawRate: Math.PI * 0.55,
    pitchRate: Math.PI * 0.5,
    // 61 degrees. Steep enough for a committed canyon dive, shallow enough
    // that the horizon never leaves frame — past ~70 the chase view reads as
    // a rollercoaster and the course becomes unreadable.
    maxPitch: Math.PI * 0.34,
    // Yaw rate multiplier at the top of the speed range. >1 = turns tighten as
    // you go faster (the angular rate rises, so the radius does not blow out).
    turnTighten: 0.5,
    autoLevelStrength: 1.0, // pitch settle toward the horizon
    rollLevelStrength: 3.2, // keep local up on the radial, camera-safe
    // Soft altitude ceiling above the baseline radius. Without one the bird can
    // simply leave: there is no gravity to bring it back, and a player who
    // holds up for ten seconds ends up in orbit looking at a marble.
    // 26 units, which mirrors terrain.js's 26-unit maximum carve: the bird's
    // usable band is symmetric about the baseline. The first captured orbit
    // frame had this at 40 and the trajectory ribbon visibly ballooned off the
    // limb of the planet — at that height the terrain reads as a distant map
    // rather than as something you are racing through.
    maxAltitude: 26,
    ceilingSoftness: 9,     // world units over which the climb rate fades out

    // --- boost -------------------------------------------------------------
    boostAccel: 76,         // u/s^2 toward boostMaxSpeed while boosting
    boostDrain: 0.55,       // meter units per second while boosting
    boostDiveCharge: 0.30,  // meter per second at a full-angle dive
    boostGateCharge: 0.22,  // added by course code on a clean gate line
    boostMinToStart: 0.15,  // can't tap a nearly-empty meter
    boostCooldown: 1.1,     // seconds after a burst empties

    // --- knockdown ---------------------------------------------------------
    knockFallSpeed: 13,     // base radial fall, ramped by fallRampMultiplier
    knockSpin: 7.4,         // rad/s tumble spin
    knockDrift: 0.5,        // fraction of speed retained while tumbling
    knockMaxDuration: 3.2,  // safety valve if the floor is never reached
    launchImpulse: 21,      // outward u/s on relaunch
    launchDuration: 0.45,
    launchSpeed: 21,        // airspeed handed back after a tumble
};

/** Fall ramp: 1x at t=0 -> 3x after 3s, then held. (Birb Mobile's curve.) */
export const FALL_RAMP_DURATION = 3.0;
export const FALL_RAMP_MAX_MULT = 3.0;

export const FLIGHT_STATE = {
    FLYING: 'flying',
    TUMBLING: 'tumbling',
    LAUNCHING: 'launching',
};

// ---------------------------------------------------------------------------
// Pure math — no THREE, no DOM, no allocation. Unit-tested.
// ---------------------------------------------------------------------------

export function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Minimum allowed radius along an outward unit direction.
 *
 * `Math.min(0, h)` is LOAD-BEARING, not defensive tidiness. The flight model
 * has no gravity, so this clamp is a floor and never a spring: a floor that
 * rose above the baseline would push a cruising bird up over every hill and it
 * would have no way back down. Terrain may only carve downward.
 */
export function floorRadiusAt(sphereRadius, terrainHeight, birdRadius) {
    return sphereRadius + Math.min(0, terrainHeight) + birdRadius;
}

/** Linear fall-ramp multiplier for the committed knockdown. */
export function fallRampMultiplier(fallTimer, duration = FALL_RAMP_DURATION, maxMult = FALL_RAMP_MAX_MULT) {
    const t = clamp(fallTimer / duration, 0, 1);
    return 1 + t * (maxMult - 1);
}

/**
 * One step of the energy trade.
 *
 * @param {number} speed     current airspeed
 * @param {number} sinPitch  forward-dot-up: +1 straight up, -1 straight down
 * @param {number} throttle  0..1, scales the cruise target
 * @param {number} dt        seconds
 * @param {number} ceiling   hard upper clamp (boost raises this)
 * @param {object} cfg
 * @returns {number} the new airspeed
 */
export function stepAirSpeed(speed, sinPitch, throttle, dt, ceiling, cfg = FLIGHT_CONFIG) {
    // Trade height for speed: diving accelerates, climbing bleeds.
    let s = speed - sinPitch * cfg.pitchEnergy * dt;
    // Drag hauls it back toward the cruise target. Exponential, so it is
    // frame-rate independent and never overshoots into oscillation.
    const target = cfg.cruiseSpeed * throttle;
    s += (target - s) * clamp(cfg.dragCoef * dt, 0, 1);
    return clamp(s, cfg.minSpeed, ceiling);
}

/**
 * Turn-rate multiplier. Turns TIGHTEN with speed: without this the yaw rate is
 * constant, so the turn radius (v / omega) grows with velocity and a boosting
 * bird understeers straight past the gate.
 */
export function turnRateScale(speed01, cfg = FLIGHT_CONFIG) {
    return 1 + cfg.turnTighten * clamp(speed01, 0, 1);
}

/** A fresh, plain boost-meter state. Allocated once by the caller, never per frame. */
export function createBoostState() {
    return { meter: 0, boosting: false, cooldown: 0 };
}

/**
 * Advance the boost meter in place. Zero allocation.
 *
 * Charge comes from diving (converting the height you gave up into a resource)
 * and from `addBoostCharge` for clean gate lines. Spending is all-or-nothing
 * until the meter empties, then a cooldown blocks a re-tap so boost cannot be
 * feathered into a permanent speed setting.
 *
 * @param {object} st        {meter, boosting, cooldown}, mutated
 * @param {boolean} wantBoost
 * @param {number} sinPitch  negative = diving
 * @param {number} dt
 * @param {object} cfg
 * @returns {boolean} whether a NEW burst started this step (for audio/FX)
 */
export function stepBoostState(st, wantBoost, sinPitch, dt, cfg = FLIGHT_CONFIG) {
    let started = false;
    if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt);

    if (st.boosting) {
        st.meter -= cfg.boostDrain * dt;
        if (st.meter <= 0 || !wantBoost) {
            // Releasing early keeps what is left but still pays the cooldown,
            // so tap-tap-tap is never better than one committed burst.
            st.meter = Math.max(0, st.meter);
            st.boosting = false;
            st.cooldown = cfg.boostCooldown;
        }
    } else {
        if (sinPitch < 0) st.meter += -sinPitch * cfg.boostDiveCharge * dt;
        if (st.meter > 1) st.meter = 1;
        if (wantBoost && st.cooldown <= 0 && st.meter >= cfg.boostMinToStart) {
            st.boosting = true;
            started = true;
        }
    }
    return started;
}

/** Add meter from an external event (a clean gate line). Clamped to [0,1]. */
export function addBoostCharge(st, amount) {
    st.meter = clamp(st.meter + amount, 0, 1);
    return st.meter;
}

/** Normalised airspeed over the un-boosted envelope — HUD needle, wing tuck. */
export function airSpeed01(speed, cfg = FLIGHT_CONFIG) {
    return clamp((speed - cfg.minSpeed) / (cfg.maxSpeed - cfg.minSpeed), 0, 1);
}

/**
 * Normalised speed over the FULL envelope including boost. This is the one the
 * camera FOV kick, the speed lines and the wind audio read, so a boost visibly
 * pushes past what level flight can ever reach.
 */
export function speed01(speed, cfg = FLIGHT_CONFIG) {
    const lo = cfg.cruiseSpeed * 0.6;
    return clamp((speed - lo) / (cfg.boostMaxSpeed - lo), 0, 1);
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

export class GauntletFlight {
    /**
     * @param {object} THREE
     * @param {object} options
     * @param {number} [options.sphereRadius]      baseline planet radius
     * @param {Function} [options.terrainHeightAt] (nx,ny,nz) -> height <= 0
     * @param {number} [options.birdRadius]        clearance held above terrain
     * @param {THREE.Vector3} [options.position]
     * @param {THREE.Quaternion} [options.quaternion]
     * @param {number} [options.speed] [options.yawRate] [options.pitchRate] [options.maxPitch]
     */
    constructor(THREE, options = {}) {
        const { Vector3, Quaternion, Matrix4 } = THREE;
        this.THREE = THREE;

        this.sphereRadius = options.sphereRadius ?? 100;
        this.terrainHeightAt = options.terrainHeightAt ?? null;
        this.birdRadius = options.birdRadius ?? 1.2;

        this.cfg = FLIGHT_CONFIG;
        this.cruiseSpeed = options.speed ?? FLIGHT_CONFIG.cruiseSpeed;
        this.yawRate = options.yawRate ?? FLIGHT_CONFIG.yawRate;
        this.pitchRate = options.pitchRate ?? FLIGHT_CONFIG.pitchRate;
        this.maxPitch = options.maxPitch ?? FLIGHT_CONFIG.maxPitch;
        this.throttle = options.throttle ?? 1;

        this.position = options.position ? options.position.clone() : new Vector3(0, this.sphereRadius + 12, 0);
        this.quaternion = options.quaternion ? options.quaternion.clone() : new Quaternion();

        // --- live state -----------------------------------------------------
        this.speed = this.cruiseSpeed;
        this.state = FLIGHT_STATE.FLYING;
        this.boost = createBoostState();
        this.boost01 = 0;
        this.isBoosting = false;
        this.speed01 = 0;
        this.airSpeed01 = 0;
        this.sinPitch = 0;
        /** Smoothed stick, handed to the animator so it can bank and lean. */
        this.turn = 0;
        this.pitchInput = 0;
        /** Set true on the frame a burst starts / a tumble impacts — FX hooks. */
        this.boostStarted = false;
        this.impacted = false;

        this._fallTimer = 0;
        this._tumbleTimer = 0;
        this._launchTimer = 0;

        // --- scratch (zero per-frame allocation) ----------------------------
        this._s = {
            forward: new Vector3(),
            up: new Vector3(),
            right: new Vector3(),
            axis: new Vector3(),
            quat: new Quaternion(),
            transport: new Quaternion(),
            oldPos: new Vector3(),
            oldNormal: new Vector3(),
            newNormal: new Vector3(),
            radial: new Vector3(),
            displacement: new Vector3(),
            surfNormal: new Vector3(),
            tanA: new Vector3(),
            tanB: new Vector3(),
            slide: new Vector3(),
            heading: new Vector3(),
            zero: new Vector3(0, 0, 0),
            m4: new Matrix4(),
        };

        this._pose = {
            position: new Vector3(),
            quaternion: new Quaternion(),
            velocity: new Vector3(),
        };

        this._constrainToFloor();
        this._initial = {
            position: this.position.clone(),
            quaternion: this.quaternion.clone(),
        };
    }

    // -- public API ---------------------------------------------------------

    /**
     * Advance one frame.
     * @param {{x:number,y:number,boost:boolean}} input
     * @param {number} dt seconds
     * @returns {{position,quaternion,velocity}} the SAME object every call.
     */
    tick(input, dt) {
        const step = clamp(dt, 0, 0.05); // a tab-restore spike must not teleport
        this.boostStarted = false;
        this.impacted = false;
        if (step <= 0) return this._getPose();

        const s = this._s;
        s.oldPos.copy(this.position);

        const ix = input ? clamp(input.x || 0, -1, 1) : 0;
        const iy = input ? clamp(input.y || 0, -1, 1) : 0;
        const wantBoost = Boolean(input && input.boost);

        // Stick smoothing is for the ANIMATOR only; the control path uses the
        // raw stick so the bird answers instantly.
        const k = clamp(step * 9, 0, 1);
        this.turn += (ix - this.turn) * k;
        this.pitchInput += (iy - this.pitchInput) * k;

        if (this.state === FLIGHT_STATE.TUMBLING) {
            this._tickTumble(step);
        } else {
            this._tickFlight(ix, iy, wantBoost, step);
        }

        // Velocity is measured, not assumed — feathers and audio read it.
        this._pose.velocity.copy(this.position).sub(s.oldPos).multiplyScalar(1 / step);
        return this._getPose();
    }

    /**
     * Committed knockdown. Control is taken away, the fall ramps 1x -> 3x, and
     * the bird relaunches on impact. There is deliberately NO self-arrest: a
     * crash you can cancel does not read as a crash.
     */
    applyKnockdown() {
        if (this.state === FLIGHT_STATE.TUMBLING) return;
        // Remember the heading so the relaunch can hand it back. Without this
        // the bird pops out of a tumble pointing wherever the spin left it and
        // the player has to re-find the course.
        const s = this._s;
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
        s.up.copy(this.position).normalize();
        s.heading.copy(s.forward).addScaledVector(s.up, -s.forward.dot(s.up));
        if (s.heading.lengthSq() < 1e-6) s.heading.set(1, 0, 0).cross(s.up);
        s.heading.normalize();

        this.state = FLIGHT_STATE.TUMBLING;
        this._fallTimer = 0;
        this._tumbleTimer = 0;
        this.boost.boosting = false;
        this.boost.cooldown = this.cfg.boostCooldown;
        this.isBoosting = false;
    }

    /** Add boost meter from outside — a clean gate line, a boost pad. */
    chargeBoost(amount = FLIGHT_CONFIG.boostGateCharge) {
        this.boost01 = addBoostCharge(this.boost, amount);
        return this.boost01;
    }

    /** 0..1 cruise-speed scale. Used by the AI handicap and the practice mode. */
    setThrottle(v) {
        this.throttle = clamp(Number.isFinite(v) ? v : this.throttle, 0, 1);
    }

    /** Restore the spawn pose and clear every timer. */
    reset() {
        this.position.copy(this._initial.position);
        this.quaternion.copy(this._initial.quaternion);
        this.speed = this.cruiseSpeed;
        this.state = FLIGHT_STATE.FLYING;
        this.boost.meter = 0;
        this.boost.boosting = false;
        this.boost.cooldown = 0;
        this.boost01 = 0;
        this.isBoosting = false;
        this.speed01 = 0;
        this.airSpeed01 = 0;
        this.turn = 0;
        this.pitchInput = 0;
        this._fallTimer = 0;
        this._tumbleTimer = 0;
        this._launchTimer = 0;
        this._constrainToFloor();
    }

    /** Point the bird along a world direction, upright on the radial. */
    setHeading(dirX, dirY, dirZ) {
        const s = this._s;
        s.up.copy(this.position).normalize();
        s.forward.set(dirX, dirY, dirZ);
        s.forward.addScaledVector(s.up, -s.forward.dot(s.up));
        if (s.forward.lengthSq() < 1e-6) s.forward.set(1, 0, 0).cross(s.up);
        s.forward.normalize();
        this._orientTo(s.forward, s.up);
    }

    dispose() {
        this.terrainHeightAt = null;
    }

    // -- flight -------------------------------------------------------------

    _tickFlight(ix, iy, wantBoost, dt) {
        const s = this._s;
        const cfg = this.cfg;

        // 1. Steering.
        //
        //    Yaw turns around the RADIAL up, not around the bird's local Y, and
        //    is therefore premultiplied (world space, applied first). This is
        //    not a stylistic choice: yawing around local Y while pitched tips
        //    the turn axis away from vertical by the pitch angle, so every
        //    turn injects roll at yawRate*sin(pitch). In a steep dive with the
        //    stick held over that reaches ~2.3 rad/s of roll, which the
        //    levelling term can only fight to an equilibrium of ~60 degrees —
        //    measured, not guessed, in the probe: the bird flew a whole
        //    canyon dive lying on its side. Turning about the radial injects
        //    exactly zero roll anywhere on the planet.
        //
        //    Pitch stays around LOCAL x with `multiply` (local space, applied
        //    after), because pitch genuinely is relative to the bird's frame.
        s.up.copy(this.position).normalize();
        if (ix !== 0) {
            const scale = turnRateScale(this.speed01, cfg);
            s.quat.setFromAxisAngle(s.up, -ix * this.yawRate * scale * dt);
            this.quaternion.premultiply(s.quat);
        }
        if (iy !== 0) {
            s.axis.set(1, 0, 0);
            s.quat.setFromAxisAngle(s.axis, iy * this.pitchRate * dt);
            this.quaternion.multiply(s.quat);
        }

        // 2. Energy trade + boost. sinPitch is measured from the CURRENT
        //    orientation against the CURRENT radial, so it is correct anywhere
        //    on the sphere — there is no global "up" to be wrong about.
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        s.up.copy(this.position).normalize();
        this.sinPitch = clamp(s.forward.dot(s.up), -1, 1);

        this.boostStarted = stepBoostState(this.boost, wantBoost, this.sinPitch, dt, cfg);
        this.isBoosting = this.boost.boosting;
        this.boost01 = this.boost.meter;

        const ceiling = this.isBoosting ? cfg.boostMaxSpeed : cfg.maxSpeed;
        if (this.isBoosting) {
            // Drive hard at the boost ceiling, then let the same clamp hold it.
            this.speed = Math.min(cfg.boostMaxSpeed, this.speed + cfg.boostAccel * dt);
        } else {
            this.speed = stepAirSpeed(this.speed, this.sinPitch, this.throttle, dt, ceiling, cfg);
        }
        // Coming off a boost the speed is above maxSpeed; bleed it rather than
        // snapping, so the burst has a satisfying run-out.
        if (!this.isBoosting && this.speed > cfg.maxSpeed) {
            this.speed = Math.max(cfg.maxSpeed, this.speed - cfg.pitchEnergy * dt);
        }

        // 3. Launch impulse (post-tumble): a radial pop that decays out.
        let radialVel = 0;
        if (this._launchTimer > 0) {
            const t = this._launchTimer / cfg.launchDuration;
            radialVel = cfg.launchImpulse * t * t;
            this._launchTimer = Math.max(0, this._launchTimer - dt);
            if (this._launchTimer === 0) this.state = FLIGHT_STATE.FLYING;
        }

        // 4. Move. Displacement is SPLIT into a tangential part and a radial
        //    part, and the radius is then set explicitly.
        //
        //    Why not just `position += forward * speed * dt` like the parent
        //    controller? Because a straight step along the tangent of a sphere
        //    is a chord: it lands OUTSIDE the sphere by d^2/2r every frame. At
        //    34 u/s on a radius-100 planet that is +1.6cm per frame, which is
        //    +5.7 units per minute of level flight — a bird that slowly
        //    balloons off the planet with the stick centred. On Birb Mobile's
        //    much larger world with a much shorter session that drift never
        //    showed up; on a 100-unit planet raced for three laps it absolutely
        //    does. Setting the radius explicitly removes the drift exactly and
        //    makes the climb rate literally `speed * sin(pitch)`, which is what
        //    the energy trade already assumes.
        s.oldNormal.copy(this.position).normalize();
        const rOld = this.position.length();

        // Tangential heading = forward with the radial component removed. Its
        // length is cos(pitch), so it also carries the speed projection.
        s.slide.copy(s.forward).addScaledVector(s.oldNormal, -this.sinPitch);
        const cosPitch = s.slide.length();
        if (cosPitch > 1e-5) {
            s.slide.multiplyScalar(1 / cosPitch);
            this.position.addScaledVector(s.slide, this.speed * cosPitch * dt);
        }

        let climb = this.speed * this.sinPitch + radialVel;
        if (climb > 0) {
            // Fade the climb out approaching the ceiling instead of hitting a
            // wall, so the limit reads as thin air rather than as a bug.
            const ceiling = this.sphereRadius + cfg.maxAltitude;
            climb *= clamp((ceiling - rOld) / cfg.ceilingSoftness, 0, 1);
        }
        this.position.setLength(rOld + climb * dt);

        this._applyFloor(true);
        this._transport(s.oldNormal);
        this._settleAttitude(dt);

        this.speed01 = speed01(this.speed, cfg);
        this.airSpeed01 = airSpeed01(this.speed, cfg);
    }

    // -- knockdown ----------------------------------------------------------

    _tickTumble(dt) {
        const s = this._s;
        const cfg = this.cfg;

        this._fallTimer += dt;
        this._tumbleTimer += dt;

        // Committed fall, ramping 1x -> 3x. It starts gently so the hit reads
        // as a stagger and ends fast so the ground arrives with weight.
        const fall = cfg.knockFallSpeed * fallRampMultiplier(this._fallTimer);

        s.oldNormal.copy(this.position).normalize();
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        this.speed = Math.max(cfg.minSpeed * 0.5, this.speed - cfg.pitchEnergy * dt);

        // Same split integration as level flight (see _tickFlight): tangential
        // drift plus an explicit radius, so a long tumble cannot drift off the
        // sphere either.
        const rOld = this.position.length();
        s.slide.copy(s.forward).addScaledVector(s.oldNormal, -s.forward.dot(s.oldNormal));
        if (s.slide.lengthSq() > 1e-10) {
            s.slide.normalize();
            this.position.addScaledVector(s.slide, this.speed * cfg.knockDrift * dt);
        }
        this.position.setLength(Math.max(1, rOld - fall * dt));

        // Tumble spin, around local X and Z so it reads as an uncontrolled
        // cartwheel rather than a tidy pirouette.
        s.axis.set(1, 0, 0);
        s.quat.setFromAxisAngle(s.axis, -cfg.knockSpin * dt);
        this.quaternion.multiply(s.quat);
        s.axis.set(0, 0, 1);
        s.quat.setFromAxisAngle(s.axis, cfg.knockSpin * 0.42 * dt);
        this.quaternion.multiply(s.quat);

        const hitGround = this._applyFloor(false);
        this._transport(s.oldNormal);

        this.speed01 = speed01(this.speed, cfg);
        this.airSpeed01 = airSpeed01(this.speed, cfg);
        this.boost01 = this.boost.meter;

        if (hitGround || this._tumbleTimer >= cfg.knockMaxDuration) this._relaunch();
    }

    /**
     * Come out of the tumble: outward impulse plus a REALIGNED quaternion.
     * The heading captured at knockdown is re-projected onto the tangent plane
     * where the bird actually landed, so "forward" still points where the
     * player was going. Skipping this realign is what makes tumbles feel like
     * being teleported into a random direction.
     */
    _relaunch() {
        const s = this._s;
        s.up.copy(this.position).normalize();
        s.forward.copy(s.heading).addScaledVector(s.up, -s.heading.dot(s.up));
        if (s.forward.lengthSq() < 1e-6) {
            s.forward.set(0, 1, 0).cross(s.up);
            if (s.forward.lengthSq() < 1e-6) s.forward.set(1, 0, 0).cross(s.up);
        }
        s.forward.normalize();
        this._orientTo(s.forward, s.up);

        this.state = FLIGHT_STATE.LAUNCHING;
        this._launchTimer = this.cfg.launchDuration;
        this.speed = this.cfg.launchSpeed;
        this.impacted = true;
    }

    // -- shared spherical machinery ----------------------------------------

    /**
     * Radial floor clamp. Returns true if the bird was actually pushed out
     * (i.e. it touched the ground this step).
     *
     * @param {boolean} deflect  slide along the slope instead of stopping
     */
    _applyFloor(deflect) {
        const s = this._s;
        s.radial.copy(this.position);
        const r = s.radial.length();
        if (r <= 1e-3) {
            this.position.set(0, this.sphereRadius + this.birdRadius, 0);
            return true;
        }
        const inv = 1 / r;
        const floor = this._floorAt(s.radial.x * inv, s.radial.y * inv, s.radial.z * inv);
        if (r >= floor) return false;

        s.radial.multiplyScalar(floor * inv);
        this.position.copy(s.radial);
        if (deflect && this.terrainHeightAt && this.speed > 0.5) {
            const f = 1 / floor;
            this._deflectAlongTerrain(s.radial.x * f, s.radial.y * f, s.radial.z * f);
        }
        return true;
    }

    /** See floorRadiusAt — the Math.min(0, h) there is the load-bearing part. */
    _floorAt(nx, ny, nz) {
        const h = this.terrainHeightAt ? this.terrainHeightAt(nx, ny, nz) : 0;
        return floorRadiusAt(this.sphereRadius, h, this.birdRadius);
    }

    /**
     * Parallel transport. THE fix: moving over the sphere changed which way is
     * up, so rotate the orientation by exactly that change, in world space.
     */
    _transport(oldNormal) {
        const s = this._s;
        s.newNormal.copy(this.position).normalize();
        s.transport.setFromUnitVectors(oldNormal, s.newNormal);
        this.quaternion.premultiply(s.transport);
    }

    /**
     * Aerodynamic settle: pitch drifts back toward the local horizon, roll
     * drifts back toward the radial, and pitch is hard-clamped to +/-maxPitch
     * so the bird can never invert or loop. Roll leveling also keeps the
     * rendered bird upright for the chase camera; the visible bank belongs to
     * the animator, not to the physics quaternion.
     */
    _settleAttitude(dt) {
        const s = this._s;
        s.up.copy(this.position).normalize();

        // Roll toward radial-up.
        s.right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
        const sinRoll = s.up.dot(s.right);
        const rollFix = -sinRoll * this.cfg.rollLevelStrength * dt;
        if (Math.abs(rollFix) > 1e-4) {
            s.axis.set(0, 0, 1);
            s.quat.setFromAxisAngle(s.axis, rollFix);
            this.quaternion.multiply(s.quat);
        }

        // Pitch toward the horizon.
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        let sp = clamp(s.forward.dot(s.up), -1, 1);
        const pitchFix = -sp * this.cfg.autoLevelStrength * dt;
        if (Math.abs(pitchFix) > 1e-4) {
            s.axis.set(1, 0, 0);
            s.quat.setFromAxisAngle(s.axis, pitchFix);
            this.quaternion.multiply(s.quat);
        }

        // Hard pitch clamp.
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        sp = clamp(s.forward.dot(s.up), -1, 1);
        const pitch = Math.asin(sp);
        if (Math.abs(pitch) > this.maxPitch) {
            const over = pitch - Math.sign(pitch) * this.maxPitch;
            s.axis.set(1, 0, 0);
            s.quat.setFromAxisAngle(s.axis, -over);
            this.quaternion.multiply(s.quat);
        }
        this.sinPitch = sp;
    }

    /**
     * Slide along a terrain rise the bird just penetrated, rather than
     * hard-stopping or snapping radially outward (which would fling it into
     * the sky). Only runs on a penetration frame, never on the cruise path.
     */
    _deflectAlongTerrain(nx, ny, nz) {
        const s = this._s;
        s.surfNormal.set(nx, ny, nz).normalize();

        // Two tangents, dodging the degenerate case at the pole of the basis.
        s.tanA.set(0, 1, 0);
        if (Math.abs(s.surfNormal.y) > 0.95) s.tanA.set(1, 0, 0);
        s.tanA.crossVectors(s.tanA, s.surfNormal).normalize();
        s.tanB.crossVectors(s.surfNormal, s.tanA).normalize();

        const eps = 0.5;
        const slopeA = (this._sampleH(s.tanA, eps) - this._sampleH(s.tanA, -eps)) / (2 * eps);
        const slopeB = (this._sampleH(s.tanB, eps) - this._sampleH(s.tanB, -eps)) / (2 * eps);

        // True surface normal = radial tilted away from uphill.
        s.surfNormal.addScaledVector(s.tanA, -slopeA);
        s.surfNormal.addScaledVector(s.tanB, -slopeB);
        s.surfNormal.normalize();

        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        const into = s.forward.dot(s.surfNormal);
        if (into >= 0) return;
        s.slide.copy(s.forward).addScaledVector(s.surfNormal, -into);
        if (s.slide.lengthSq() < 1e-6) return;
        s.slide.normalize();

        // Re-aim onto the deflected heading with the radial as the reference
        // up, rather than applying the minimal forward->slide rotation.
        //
        // The minimal rotation is the obvious move and it is wrong: on a
        // sloped wall the deflection has a sideways component, and the shortest
        // arc that turns the nose sideways also tips the wings. Skimming a
        // canyon flank for a second or two accumulated that into 66 degrees of
        // roll in the probe — the bird flew the dive lying on its side, which
        // then also defeated the pitch clamp (rotating about a rolled local X
        // is no longer a pure pitch change). Rebuilding the frame keeps the
        // heading change and throws the roll away.
        s.up.copy(this.position).normalize();
        this._orientTo(s.slide, s.up);
    }

    /**
     * Finite-difference height probe along a tangent. A method rather than the
     * closure the parent repo used, so even the penetration path allocates
     * nothing.
     */
    _sampleH(tan, signedEps) {
        const s = this._s;
        const px = s.surfNormal.x + signedEps * tan.x;
        const py = s.surfNormal.y + signedEps * tan.y;
        const pz = s.surfNormal.z + signedEps * tan.z;
        const inv = 1 / Math.max(1e-6, Math.hypot(px, py, pz));
        return this.terrainHeightAt(px * inv, py * inv, pz * inv);
    }

    /** Build the quaternion whose -Z is `forward` and whose +Y is `up`. */
    _orientTo(forward, up) {
        const s = this._s;
        // Matrix4.lookAt puts +Z along (eye - target); eye at the origin and
        // target at `forward` therefore puts -Z on `forward`, which is the
        // house convention.
        s.m4.lookAt(s.zero, forward, up);
        this.quaternion.setFromRotationMatrix(s.m4);
    }

    _constrainToFloor() {
        this._applyFloor(false);
    }

    _getPose() {
        this._pose.position.copy(this.position);
        this._pose.quaternion.copy(this.quaternion);
        return this._pose;
    }
}

export default GauntletFlight;
