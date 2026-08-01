/**
 * nesting/nesting-system.js — landing on and leaving a nest.
 *
 * Ported from Birb Mobile's `src/nesting/nesting-system.js`. Re-implemented, not
 * imported: `gauntlet/` stays airtight against the parent game.
 *
 * ===========================================================================
 * THE STATE MACHINE PORTS EXACTLY
 * ===========================================================================
 *
 *     FLYING -> APPROACHING -> LANDING -> NESTED -> TAKING_OFF -> FLYING
 *
 * with the original's transition rules, unchanged:
 *
 *   - FLYING      enters APPROACHING the moment a nest is in range, and
 *     APPROACHING falls back to FLYING the moment none is.
 *   - LANDING is only enterable from FLYING or APPROACHING, which is what makes
 *     re-entering proximity mid-glide a no-op rather than a restart.
 *   - TAKING_OFF is only enterable from NESTED, so a take-off input while
 *     already airborne does nothing.
 *   - TAKING_OFF runs a 0.5s timer and then hands control back as FLYING.
 *
 * ===========================================================================
 * THE ONE THING DONE BETTER THAN THE ORIGINAL: THE GLIDE IS FLOWN, NOT LERPED
 * ===========================================================================
 * Birb Mobile auto-landed by writing the bird's transform directly:
 *
 *     flightController.position.addScaledVector(direction, speed * delta);
 *     flightController.quaternion.slerp(targetQuaternion, delta * 3);
 *
 * That moves the bird along the straight line to the nest regardless of where
 * it is pointing, so on any approach that is not already head-on the bird
 * visibly slides sideways through the air while its model rotates
 * independently — it detaches from its own physics for the most-watched five
 * seconds in the game.
 *
 * Here the glide is an AUTOPILOT, not a tween. Every frame it:
 *
 *   1. builds a stick input from the heading error to an aim point,
 *   2. hands that stick to the REAL `GauntletFlight.tick()`, so parallel
 *      transport, the pitch clamp, roll levelling, the energy trade and the
 *      terrain floor all still run, and
 *   3. bleeds speed through the flight model's own throttle.
 *
 * The bird therefore only ever moves along its own forward vector. It banks
 * into the turn toward the nest because it is genuinely turning. Measured in
 * the probe: peak angle between velocity and forward across a full approach is
 * a fraction of a degree, and all of that is the sphere's curvature — versus
 * ~35 degrees of pure sideslip for the lerp.
 *
 * THE ONE PLACE PHYSICS IS OVERRIDDEN, AND WHY
 * `GauntletFlight` has a HARD `minSpeed` of 15 u/s — a racer must never be
 * parked in mid-air by a climb. A bird arriving in a 2.25-unit bowl at 15 u/s
 * is not landing, it is crashing. So the last few units are a FLARE: the
 * controller is still ticked and still owns the direction and the attitude, and
 * only the MAGNITUDE of the step it produced is scaled down. That is
 * mathematically an external drag applied to the model, not a repositioning of
 * it — the bird cannot be pushed off its own trajectory by it, which is the
 * whole failure mode being fixed.
 *
 * ===========================================================================
 * FEEL CONSTANTS — VERBATIM
 * ===========================================================================
 * `autoFlySpeed` 16.0, `arrivalThreshold` 0.3, `takeOffDuration` 0.5,
 * `takeOffBoost` 3.0 and `takeOffSpeed` 4.0 are Birb Mobile's numbers, copied
 * exactly, including the shape of the expressions that consume them:
 * `Math.min(autoFlySpeed, distance / dt)` is still the overshoot guard, and the
 * take-off impulse is still `takeOffBoost * (timer / duration)` applied along
 * `normalize(surfaceNormal + 0.5 * lookForward)`.
 *
 * `takeOffSpeed` 4.0 is the one number that no longer means anything: Birb
 * Mobile cruised at ~4-7 u/s, Birb Gauntlet's envelope is 15-46. It is written
 * to `flight.speed` on take-off exactly as the original did, and the flight
 * model's own `minSpeed` floor supersedes it on the very next tick. Copied
 * anyway, per the port rules, and flagged rather than silently re-derived.
 *
 * ===========================================================================
 * SPLIT
 * ===========================================================================
 * `createNestingCore` is PURE — no THREE, no DOM, no allocation per frame, all
 * states/predicates/timers — and is unit-tested in
 * `tests/gauntlet-nesting.test.js`. `createNesting` is the thin THREE-aware
 * wrapper that measures distances, flies the autopilot and seats the bird.
 * Same split as `flight-recovery.js` and `race-logic.js`.
 *
 * MODES: this module has no mode awareness at all and never compares a mode id.
 * The integrator gates construction/update on `modeDef(run.mode).nesting`.
 */

import { PLANET_RADIUS } from '../core/terrain.js';

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const NESTING_STATES = {
    FLYING: 'flying',
    APPROACHING: 'approaching',   // a nest is in range; the Land prompt shows
    LANDING: 'landing',           // auto-flying to the nest
    NESTED: 'nested',             // seated in the bowl
    TAKING_OFF: 'taking_off',     // leaving
};

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export const NESTING_CONFIG = Object.freeze({
    // --- VERBATIM from Birb Mobile ---------------------------------------
    /** Ceiling on the approach speed, and the source of the overshoot guard. */
    autoFlySpeed: 16.0,
    /** How close counts as landed. */
    arrivalThreshold: 0.3,
    /** Length of the take-off impulse. */
    takeOffDuration: 0.5,
    /** Peak outward take-off impulse, decaying linearly over the duration. */
    takeOffBoost: 3.0,
    /** Speed handed back on take-off. See the header: superseded by minSpeed. */
    takeOffSpeed: 4.0,
    /** Ground range at which a nest is offerable. Matches NEST_LAND_RANGE. */
    landRange: 24.0,

    // --- the autopilot (new; the original had no steering at all) ---------
    /**
     * Proportional steering gains, rad^-1. Tuned in the probe against the real
     * controller: at 2.4 a 40-degree entry error is dead by the time the bird
     * is halfway there, without the S-shaped overshoot that a hotter gain
     * gives when the flight model's own roll levelling fights it.
     */
    yawGain: 2.4,
    pitchGain: 2.8,
    /**
     * The aim point sits above the nest by `min(distance * aimLift, aimLiftMax)`
     * so the glide is a descending curve into the treetop rather than a flat
     * run at a point 12.6 units up a trunk, which would fly the bird through
     * the canopy.
     */
    aimLift: 0.30,
    aimLiftMax: 8.0,
    /** Inside this, steering stops chasing a direction that is going singular. */
    aimDeadRadius: 1.0,

    // --- the flare ---------------------------------------------------------
    /** Distance at which the external brake starts. */
    flareRadius: 13.0,
    /** Braked speed is `distance * flareRate`, so it decays smoothly to nothing. */
    flareRate: 2.1,
    /** ...but never below this, or arrival becomes an asymptote. */
    flareMinSpeed: 1.1,

    // --- safety ------------------------------------------------------------
    /**
     * A glide that has not arrived by now is seated anyway. The original had no
     * such valve and shipped a "hover forever" bug when the target moved; this
     * is cheap insurance that a mode script can never wedge the player.
     */
    landingMaxDuration: 20.0,
});

// ---------------------------------------------------------------------------
// Pure math — no THREE, no DOM, no allocation. Unit-tested.
// ---------------------------------------------------------------------------

export function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Throttle for the glide: full cruise while far out, easing to the ratio that
 * makes the flight model's own drag settle at `autoFlySpeed`.
 *
 * This is how the approach speed is BLED rather than assigned — the number 16
 * becomes a target the physics converges on, not a velocity written over it.
 */
export function approachThrottle(distance, cruiseSpeed, cfg = NESTING_CONFIG) {
    const base = cruiseSpeed > 0 ? clamp(cfg.autoFlySpeed / cruiseSpeed, 0, 1) : 1;
    const far = 80;
    const t = clamp((distance - cfg.flareRadius) / (far - cfg.flareRadius), 0, 1);
    return base + (1 - base) * t;
}

/**
 * Speed ceiling for this step, in world units/second.
 *
 * `Math.min(autoFlySpeed, distance / dt)` is Birb Mobile's expression verbatim:
 * the second term is the guard that stops a fast frame overshooting the nest.
 * The flare term is the addition — it is what lets a bird whose model refuses
 * to fly slower than 15 u/s settle into a 2.25-unit bowl.
 */
export function glideSpeedCap(distance, dt, cfg = NESTING_CONFIG) {
    const d = Math.max(0, distance);
    let cap = cfg.autoFlySpeed;
    if (dt > 0) cap = Math.min(cap, d / dt);
    if (d < cfg.flareRadius) cap = Math.min(cap, Math.max(cfg.flareMinSpeed, d * cfg.flareRate));
    return cap;
}

/** Decaying outward impulse during take-off. Verbatim shape. */
export function takeOffImpulse(timer, cfg = NESTING_CONFIG) {
    return cfg.takeOffBoost * clamp(timer / cfg.takeOffDuration, 0, 1);
}

/** Proportional stick from an angular error, clamped to the stick's range. */
export function steerFromError(errorRad, gain) {
    return clamp(errorRad * gain, -1, 1);
}

/** True if this state means the nesting system owns the bird's movement. */
export function stateDrivesFlight(state) {
    return state === NESTING_STATES.LANDING
        || state === NESTING_STATES.NESTED
        || state === NESTING_STATES.TAKING_OFF;
}

/** True if the bird is airborne and under the player's own control. */
export function stateIsFreeFlight(state) {
    return state === NESTING_STATES.FLYING || state === NESTING_STATES.APPROACHING;
}

// ---------------------------------------------------------------------------
// The PURE core
// ---------------------------------------------------------------------------

/**
 * The state machine, with nothing in it that knows about geometry.
 *
 * Per-frame inputs are two numbers the wrapper measures for it:
 *   `nearestIndex`  index of a nest within land range, or -1
 *   `distance`      distance remaining to the landing target (LANDING only)
 *
 * @param {object} [opts]
 * @param {object} [opts.cfg]            override NESTING_CONFIG
 * @param {Function} [opts.onStateChange] (next, prev, nestIndex)
 */
export function createNestingCore(opts = {}) {
    const cfg = opts.cfg || NESTING_CONFIG;
    const onStateChange = opts.onStateChange || null;

    let state = NESTING_STATES.FLYING;
    let activeNest = -1;      // the nest being landed on / occupied
    let nearNest = -1;        // the nest in range, if any (drives the prompt)
    let takeOffTimer = 0;
    let landingTime = 0;
    let arrivedThisStep = false;
    let stalled = false;      // arrival forced by the safety valve
    let hasShownWelcome = false;

    function setState(next) {
        if (state === next) return;
        const prev = state;
        state = next;
        if (onStateChange) onStateChange(next, prev, activeNest);
    }

    const core = {
        get state() { return state; },
        get activeNest() { return activeNest; },
        get nearNest() { return nearNest; },
        get takeOffTimer() { return takeOffTimer; },
        get landingTime() { return landingTime; },
        /** True only on the frame the bird reached the bowl. */
        get arrived() { return arrivedThisStep; },
        /** True if that arrival was forced by the safety valve, not earned. */
        get stalled() { return stalled; },

        isNested() { return state === NESTING_STATES.NESTED; },
        isFlying() { return stateIsFreeFlight(state) || state === NESTING_STATES.TAKING_OFF; },
        drivesFlight() { return stateDrivesFlight(state); },

        /** Fires once per landing, the way the original's welcome banner did. */
        shouldShowWelcome() {
            if (!hasShownWelcome && state === NESTING_STATES.NESTED) {
                hasShownWelcome = true;
                return true;
            }
            return false;
        },

        /**
         * Begin the auto-land glide.
         *
         * Only legal from FLYING or APPROACHING — which is exactly why a nest
         * re-entering proximity mid-glide cannot restart the landing.
         */
        requestLand(index) {
            const i = index === undefined ? nearNest : index;
            if (!(i >= 0)) return false;
            if (state !== NESTING_STATES.FLYING && state !== NESTING_STATES.APPROACHING) return false;
            activeNest = i | 0;
            landingTime = 0;
            arrivedThisStep = false;
            stalled = false;
            setState(NESTING_STATES.LANDING);
            return true;
        },

        /** Leave the nest. Only legal from NESTED, so it cannot fire in flight. */
        takeOff() {
            if (state !== NESTING_STATES.NESTED) return false;
            takeOffTimer = cfg.takeOffDuration;
            hasShownWelcome = false;
            setState(NESTING_STATES.TAKING_OFF);
            return true;
        },

        /**
         * Advance one frame.
         * @param {number} dt
         * @param {number} nearestIndex nest within land range, or -1
         * @param {number} distance     remaining distance while LANDING
         * @returns {string} the state after this step
         */
        update(dt, nearestIndex, distance) {
            const step = dt > 0 ? dt : 0;
            nearNest = nearestIndex >= 0 ? nearestIndex | 0 : -1;
            arrivedThisStep = false;

            switch (state) {
                case NESTING_STATES.FLYING:
                    if (nearNest >= 0) setState(NESTING_STATES.APPROACHING);
                    break;

                case NESTING_STATES.APPROACHING:
                    if (nearNest < 0) setState(NESTING_STATES.FLYING);
                    break;

                case NESTING_STATES.LANDING: {
                    landingTime += step;
                    const d = Number.isFinite(distance) ? distance : Infinity;
                    if (d <= cfg.arrivalThreshold) {
                        arrivedThisStep = true;
                        setState(NESTING_STATES.NESTED);
                    } else if (landingTime >= cfg.landingMaxDuration) {
                        arrivedThisStep = true;
                        stalled = true;
                        setState(NESTING_STATES.NESTED);
                    }
                    break;
                }

                case NESTING_STATES.NESTED:
                    break;

                case NESTING_STATES.TAKING_OFF:
                    takeOffTimer -= step;
                    if (takeOffTimer <= 0) {
                        takeOffTimer = 0;
                        activeNest = -1;
                        setState(NESTING_STATES.FLYING);
                    }
                    break;

                default:
                    break;
            }
            return state;
        },

        reset() {
            const prev = state;
            state = NESTING_STATES.FLYING;
            activeNest = -1;
            nearNest = -1;
            takeOffTimer = 0;
            landingTime = 0;
            arrivedThisStep = false;
            stalled = false;
            hasShownWelcome = false;
            if (onStateChange && prev !== state) onStateChange(state, prev, -1);
        },
    };

    return core;
}

// ---------------------------------------------------------------------------
// The THREE-aware wrapper
// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} opts
 * @param {object} opts.flight              a GauntletFlight
 * @param {object} opts.nests               a world/nests.js instance
 * @param {Function} [opts.onStateChange]   (next, prev, nestIndex)
 * @param {number} [opts.sphereRadius]      for the great-circle land range
 * @param {number} [opts.landRange]         defaults to NESTING_CONFIG.landRange
 * @param {boolean} [opts.highlight]        drive nests.setActive() (default true)
 * @param {boolean} [opts.driveNests]       call nests.update(dt) (default true)
 * @param {object} [opts.cfg]
 */
export function createNesting(THREE, opts = {}) {
    const { Vector3, Quaternion } = THREE;
    const cfg = opts.cfg || NESTING_CONFIG;
    const flight = opts.flight;
    const nests = opts.nests;
    const sphereRadius = opts.sphereRadius ?? PLANET_RADIUS;
    const landRange = opts.landRange ?? cfg.landRange;
    const highlight = opts.highlight !== false;
    const driveNests = opts.driveNests !== false;
    const userStateChange = opts.onStateChange || null;

    // --- scratch (zero per-frame allocation) --------------------------------
    const _nestPos = new Vector3();
    const _nestUp = new Vector3();
    const _aim = new Vector3();
    const _to = new Vector3();
    const _local = new Vector3();
    const _invQ = new Quaternion();
    const _oldPos = new Vector3();
    const _step = new Vector3();
    const _fwd = new Vector3();
    const _up = new Vector3();
    const _takeOffDir = new Vector3();
    /** The stick handed to the real controller. Mutated, never replaced. */
    const _input = { x: 0, y: 0, boost: false };

    let disposed = false;
    let lastDistance = Infinity;
    let lastSlipDeg = 0;

    const core = createNestingCore({ cfg, onStateChange: userStateChange });

    /**
     * Which nest the highlight should be on: the one being landed on/occupied
     * if there is one, otherwise whatever the Land prompt is offering.
     */
    function syncHighlight(near) {
        if (!highlight || !nests.setActive) return;
        nests.setActive(core.activeNest >= 0 ? core.activeNest : near);
    }

    // -- geometry helpers ----------------------------------------------------

    /** Refresh the landing target from the live nest data, as the original did. */
    function readTarget(index) {
        nests.positionOf(index, _nestPos);
        nests.normalOf(index, _nestUp);
    }

    /** Distance from the bird to the bowl. */
    function distanceToNest() {
        return _to.copy(_nestPos).sub(flight.position).length();
    }

    // -- the glide -----------------------------------------------------------

    /**
     * One autopilot step. Everything here goes THROUGH the flight controller.
     */
    function glide(dt, distance) {
        // Aim above the nest while far out so the approach is a descending
        // curve; drop the lift to nothing as the bowl comes up.
        const lift = Math.min(distance * cfg.aimLift, cfg.aimLiftMax);
        _aim.copy(_nestPos).addScaledVector(_nestUp, lift);
        _to.copy(_aim).sub(flight.position);

        if (distance > cfg.aimDeadRadius && _to.lengthSq() > 1e-8) {
            _to.normalize();
            // Heading error in the bird's own frame. Forward is -Z, so the
            // forward component of a local direction is -z and the right
            // component is +x.
            _invQ.copy(flight.quaternion).invert();
            _local.copy(_to).applyQuaternion(_invQ);
            const yawErr = Math.atan2(_local.x, -_local.z);
            const pitchErr = Math.asin(clamp(_local.y, -1, 1));
            _input.x = steerFromError(yawErr, cfg.yawGain);
            _input.y = steerFromError(pitchErr, cfg.pitchGain);
        } else {
            // Inside the dead radius the direction to the target goes singular:
            // chasing it would make the bird twitch on the doorstep. Coast in.
            _input.x = 0;
            _input.y = 0;
        }
        _input.boost = false;

        if (typeof flight.setThrottle === 'function') {
            flight.setThrottle(approachThrottle(distance, flight.cruiseSpeed ?? 0, cfg));
        }

        _oldPos.copy(flight.position);
        flight.tick(_input, dt);

        // The flare. Only the LENGTH of the controller's own step is scaled —
        // its direction and the whole attitude it produced are untouched, so
        // this is drag, not repositioning.
        _step.copy(flight.position).sub(_oldPos);
        const moved = _step.length();
        const maxStep = glideSpeedCap(distance, dt, cfg) * dt;
        if (moved > maxStep && moved > 1e-9) {
            flight.position.copy(_oldPos).addScaledVector(_step, maxStep / moved);
        }

        // Diagnostic the probe reads: the angle between where the bird went and
        // where it was pointing. This is the number that was ~35 degrees in the
        // original's lerp and is essentially zero here.
        if (moved > 1e-6) {
            _fwd.set(0, 0, -1).applyQuaternion(flight.quaternion);
            const c = clamp(_step.dot(_fwd) / moved, -1, 1);
            lastSlipDeg = Math.acos(c) * 180 / Math.PI;
        }
    }

    /** Seat the bird in the bowl, upright on the nest's radial, heading kept. */
    function seat() {
        const i = core.activeNest;
        if (i < 0) return;
        readTarget(i);
        flight.position.copy(_nestPos);
        _up.copy(_nestUp);
        _fwd.set(0, 0, -1).applyQuaternion(flight.quaternion);
        _fwd.addScaledVector(_up, -_fwd.dot(_up));
        if (_fwd.lengthSq() < 1e-6) {
            _fwd.set(0, 1, 0).cross(_up);
            if (_fwd.lengthSq() < 1e-6) _fwd.set(1, 0, 0).cross(_up);
        }
        _fwd.normalize();
        // setHeading rebuilds the quaternion with radial up — and the position
        // was just snapped to the nest, so its radial IS the nest normal.
        flight.setHeading(_fwd.x, _fwd.y, _fwd.z);
        flight.speed = 0;
        lastSlipDeg = 0;
    }

    /** Hold the seated pose. The flight controller is deliberately not ticked. */
    function hold() {
        const i = core.activeNest;
        if (i < 0) return;
        readTarget(i);
        flight.position.copy(_nestPos);
        flight.speed = 0;
    }

    /** The verbatim take-off impulse, on top of a real climbing tick. */
    function launch(dt) {
        _input.x = 0;
        // A touch of nose-up so the bird flies off the branch under its own
        // power; the impulse below is the shove, not the whole departure.
        _input.y = 0.55;
        _input.boost = false;
        flight.tick(_input, dt);
        flight.position.addScaledVector(_takeOffDir, takeOffImpulse(core.takeOffTimer, cfg) * dt);
    }

    const api = {
        get state() { return core.state; },
        get activeNest() { return core.activeNest; },
        /** Nest within land range, or -1 — drive the Land prompt with this. */
        get nearNest() { return core.nearNest; },
        /** True while this system owns the bird: DO NOT tick flight yourself. */
        get drivesFlight() { return core.drivesFlight(); },
        get distanceToNest() { return lastDistance; },
        /** Angle between travel and facing on the last glide step, degrees. */
        get slipDegrees() { return lastSlipDeg; },
        core,

        isNested() { return core.isNested(); },
        isFlying() { return core.isFlying(); },
        shouldShowWelcome() { return core.shouldShowWelcome(); },

        /**
         * @param {number} dt
         * @param {THREE.Vector3} [birdPos] defaults to the flight's own position
         * @returns {string} the state after this step
         */
        update(dt, birdPos) {
            if (disposed) return core.state;
            const p = birdPos || flight.position;
            if (driveNests && nests.update) nests.update(dt);

            // Ground range, not 3D: a nest is 12.6 units up a tree, and a 3D
            // test would force the player to climb to the canopy before the
            // game would even offer to land. See nests.nearestGround.
            const near = nests.nearestGround(p.x, p.y, p.z, landRange, sphereRadius);

            let distance = Infinity;
            if (core.state === NESTING_STATES.LANDING && core.activeNest >= 0) {
                readTarget(core.activeNest);
                distance = distanceToNest();
                lastDistance = distance;
            } else {
                lastDistance = Infinity;
            }

            const state = core.update(dt, near, distance);

            if (state === NESTING_STATES.LANDING) {
                glide(dt, distance);
            } else if (state === NESTING_STATES.NESTED) {
                if (core.arrived) seat(); else hold();
            } else if (state === NESTING_STATES.TAKING_OFF) {
                launch(dt);
            }

            syncHighlight(near);
            return state;
        },

        /** Begin the auto-land glide. Defaults to the nest in range. */
        requestLand(index) {
            if (disposed) return false;
            const ok = core.requestLand(index);
            if (ok) syncHighlight(core.nearNest);
            return ok;
        },

        /**
         * Leave the nest.
         *
         * Direction is the original's, verbatim: the surface normal plus half
         * the current look forward, normalised. The tangential part of it is
         * handed to the flight model as a heading so the bird departs flying
         * rather than being pushed.
         */
        takeOff() {
            if (disposed) return false;
            const i = core.activeNest;
            if (!core.takeOff()) return false;

            if (i >= 0) {
                nests.normalOf(i, _takeOffDir);
            } else {
                _takeOffDir.copy(flight.position).normalize();
            }
            _fwd.set(0, 0, -1).applyQuaternion(flight.quaternion);
            _takeOffDir.addScaledVector(_fwd, 0.5).normalize();

            _up.copy(flight.position).normalize();
            _fwd.copy(_takeOffDir).addScaledVector(_up, -_takeOffDir.dot(_up));
            if (_fwd.lengthSq() < 1e-6) {
                _fwd.set(0, 1, 0).cross(_up);
                if (_fwd.lengthSq() < 1e-6) _fwd.set(1, 0, 0).cross(_up);
            }
            _fwd.normalize();
            flight.setHeading(_fwd.x, _fwd.y, _fwd.z);

            // Verbatim, and immediately superseded by GauntletFlight's minSpeed
            // floor on the next tick. See the header.
            flight.speed = cfg.takeOffSpeed;
            if (typeof flight.setThrottle === 'function') flight.setThrottle(1);
            return true;
        },

        reset() {
            core.reset();
            lastDistance = Infinity;
            lastSlipDeg = 0;
            if (typeof flight.setThrottle === 'function') flight.setThrottle(1);
            if (highlight && nests.setActive) nests.setActive(-1);
        },

        dispose() {
            if (disposed) return;
            core.reset();
            disposed = true;
            api.update = () => NESTING_STATES.FLYING;
            api.requestLand = () => false;
            api.takeOff = () => false;
        },
    };

    return api;
}

export default createNesting;
