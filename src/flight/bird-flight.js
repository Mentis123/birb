/**
 * bird-flight.js
 *
 * Standard Flight Controller for Spherical Worlds.
 * Separates Position and Orientation to allow full 6DOF control
 * (constrained to sphere surface).
 *
 * OPTIMIZED: Uses pre-allocated scratch vectors to eliminate per-frame garbage collection
 */

export const FLIGHT_DEFAULTS = {
    speed: 11,                  // bumped 8 -> 11 (~37%) for traversable 4× world
    yawRate: Math.PI * 0.8,
    pitchRate: Math.PI * 0.6,
    // 80 degrees. Was 72, which reads as a steep glide rather than a dive when
    // you have altitude to spend on one. Deliberately short of 90: at exactly
    // vertical the heading in the tangent plane is undefined and the auto-level
    // term below has no sign to work with.
    maxPitch: Math.PI * (80 / 180),
    // How hard the bird rolls itself back level, per second, when the player is
    // not holding a turn. See _levelRoll().
    rollLevelRate: 2.2,
};

// Zen mode tuning — chill and floaty, NOT slow.
// Applied as read-time multipliers so base constants stay intact for other modes.
export const ZEN_TUNING = {
    speedMul: 1.0,    // no speed nerf — Zen is the default, players need to cover ground
    yawMul: 0.9,      // gentle softening only
    pitchMul: 0.9,    // gentle softening only
};

export class BirdFlight {
    constructor(THREE, options = {}) {
        this.THREE = THREE;
        const { Vector3, Quaternion } = THREE;

        // Configuration
        this.sphereCenter = options.sphereCenter ? options.sphereCenter.clone() : new Vector3(0, 0, 0);
        this.sphereRadius = options.sphereRadius ?? 100;
        // Optional terrain sampler (x,y,z) -> signed height. When provided, the
        // minimum-altitude floor follows carved valleys DOWNWARD (the source
        // sampler already clamps height <= 0) so the bird can descend into
        // canyons. Null = flat sphere.
        this.terrainHeightAt = options.terrainHeightAt ?? null;
        // Bird collision radius. Kept as a clearance ABOVE the carved terrain so
        // the bird glides over the surface it sees instead of sinking its model
        // into the mesh (the gap that let it clip into / stick inside rises —
        // see _floorAt() and the terrain-deflection block in update()). Default 0
        // is byte-identical to the old behaviour for callers that omit it.
        this.birdRadius = options.birdRadius ?? 0;
        this.speed = options.speed ?? FLIGHT_DEFAULTS.speed;
        this.yawRate = options.yawRate ?? FLIGHT_DEFAULTS.yawRate;
        this.pitchRate = options.pitchRate ?? FLIGHT_DEFAULTS.pitchRate;
        this.maxPitch = options.maxPitch ?? FLIGHT_DEFAULTS.maxPitch;
        // Turn about the PLANET'S up rather than the bird's own, and roll back
        // to level when nothing is holding a bank. Together these are what stop
        // a held dive turning into a spiral; see yaw() for the measurement.
        // Default ON; `?levelturn=0` restores the old model for the A/B.
        this.levelTurns = options.levelTurns ?? true;
        // True only while a committed manoeuvre is mid-flight. Suspends every
        // stabiliser; see aerobatic().
        this.aerobaticActive = false;
        this.rollLevelRate = options.rollLevelRate ?? FLIGHT_DEFAULTS.rollLevelRate;

        // Cruise speed at full throttle. `throttle` (0..1) scales cruise so the
        // glide-speed slider has something to drive. Default 1.0 keeps the
        // base speed unchanged (byte-identical feel when untouched).
        this.baseSpeed = this.speed;
        this.throttle = options.throttle ?? 1;
        this.speed = this.baseSpeed * this.throttle;

        // Zen mode flag — when true, applies ZEN_TUNING multipliers at read-time.
        // Does NOT mutate base constants, so toggling back is byte-identical for other modes.
        this.zenMode = Boolean(options.zenMode);

        // State identifiers
        // 1. Position: Absolute world position
        this.position = options.position
            ? options.position.clone()
            : new Vector3(0, this.sphereRadius, 0);

        // 2. Quaternion: Orientation in World Space
        this.quaternion = options.quaternion
            ? options.quaternion.clone()
            : new Quaternion();

        // Pre-allocated scratch variables (ZERO per-frame allocations)
        this._scratch = {
            vec3: new Vector3(),
            vec3_2: new Vector3(),
            vec3_3: new Vector3(),
            axis: new Vector3(),
            quat: new Quaternion(),
            transportQuat: new Quaternion(),
            // Inverse of the bird's orientation, for bringing a world axis into
            // the bird's own frame without allocating. See yaw().
            quatInv: new Quaternion(),
            up: new Vector3(),
            forward: new Vector3(),
            oldPos: new Vector3(),
            oldNormal: new Vector3(),
            newNormal: new Vector3(),
            radialOffset: new Vector3(),
            sphereNormal: new Vector3(),
            displacement: new Vector3(),
            // Terrain-deflection scratch (only touched when penetrating a rise).
            surfNormal: new Vector3(),
            tanA: new Vector3(),
            tanB: new Vector3(),
        };

        // Pre-allocated pose output (reused each frame)
        this._poseOutput = {
            position: new Vector3(),
            quaternion: new Quaternion(),
            velocity: new Vector3()
        };

        // Ensure initially on surface
        this._constrainToSphere();

        // Snapshot of the spawn pose, so reset() can restore it (used by the
        // Reset button, which previously threw because BirdFlight had no reset).
        this._initialPose = {
            position: this.position.clone(),
            quaternion: this.quaternion.clone(),
            speed: this.baseSpeed,
            throttle: this.throttle,
        };
    }

    /**
     * Yaw (Turn Left/Right)
     *
     * Rotates around the PLANET'S up (the outward radial at the bird's
     * position), not the bird's own up — that is `levelTurns`, and it is the
     * fix for the dive that turns into a spiral.
     *
     * Rotating about the bird's own up is correct for a plane in open sky and
     * wrong for this game. Once the nose is 60-70 degrees down, the bird's own
     * up points mostly BACKWARD along the ground, so a yaw input stops being a
     * turn and becomes a world-space ROLL. Nothing outside Zen mode ever takes
     * roll back out, so it accumulates: measured holding (x 0.25, y -1) from
     * 200 units up, roll went 0.5 -> 40 degrees and stayed there, the heading
     * swung through more than a full revolution, and the pitch was carried
     * from -70 degrees round to +55 — the bird pulled out of its own dive and
     * started climbing. That is the "twists, spirals and loops around instead
     * of nosing down" report, and it is entirely this axis.
     *
     * About the radial instead, a turn is a turn at every pitch angle. In
     * level flight the two axes coincide, so this is a no-op for ordinary
     * cruising; it only bites where the old one was already wrong.
     */
    yaw(input, deltaTime) {
        if (!input) return;
        const yawMul = this.zenMode ? ZEN_TUNING.yawMul : 1;
        const angle = -input * this.yawRate * yawMul * deltaTime; // Input+ (Right) -> Neg Angle (Right Turn?)
        const s = this._scratch;
        if (this.levelTurns) {
            // The planet's up, brought into the bird's own frame, because the
            // rotation is applied on the right (local axis). Zero allocations.
            s.axis.copy(this.position).sub(this.sphereCenter);
            if (s.axis.lengthSq() < 1e-12) s.axis.set(0, 1, 0);
            else {
                s.axis.normalize();
                s.quatInv.copy(this.quaternion).invert();
                s.axis.applyQuaternion(s.quatInv);
            }
        } else {
            // Legacy: rotate around local Y.
            // If input +1 (Right), we want to turn Right. RotY(-ang) turns Right.
            s.axis.set(0, 1, 0);
        }
        s.quat.setFromAxisAngle(s.axis, angle);
        this.quaternion.multiply(s.quat);
    }

    /**
     * Apply one frame of a committed aerobatic manoeuvre.
     *
     * `roll` is about the bird's own long axis (local Z — the same axis
     * `_levelRoll` uses); positive rolls INTO a right bank. `pitch` is about
     * its local right (local X, the same axis `pitch()` uses); positive is
     * nose-up, so a positive full turn is a loop over the top. Setting `aerobaticActive` is the load-bearing
     * half: without it the auto-level, the roll leveller and the maxPitch
     * clamp all run in the same frame and undo the move as fast as it is
     * made. A loop in particular cannot exist while an 80-degree pitch
     * ceiling is being enforced — it is a 360-degree pitch by definition.
     *
     * The caller clears the flag when the move ends. Zero allocations.
     */
    aerobatic(roll = 0, pitch = 0) {
        const s = this._scratch;
        this.aerobaticActive = true;
        if (roll) {
            // NEGATED. Forward is local -Z, so a POSITIVE rotation about +Z
            // carries the right wing (+X) UP — which is a roll to the LEFT.
            // Shipped un-negated, a hard right bank rolled the bird left,
            // straight against the visual bank the model was already holding
            // the other way: reported from the phone as "hard bank left then
            // does a right roll and the other way". Positive `roll` here is
            // a roll INTO a right bank, right wing down, matching
            // bird-visual.js's own convention (input +1 -> negative bank).
            s.axis.set(0, 0, 1);
            s.quat.setFromAxisAngle(s.axis, -roll);
            this.quaternion.multiply(s.quat);
        }
        if (pitch) {
            s.axis.set(1, 0, 0);
            s.quat.setFromAxisAngle(s.axis, pitch);
            this.quaternion.multiply(s.quat);
        }
    }

    /** End the manoeuvre and hand the bird back to the stabilisers. */
    endAerobatic() {
        this.aerobaticActive = false;
    }

    /**
     * Roll back toward level, about the bird's own long axis.
     *
     * A bird is not an aerobatic aircraft holding whatever attitude it is left
     * in: with no roll input it rights itself. This existed only inside Zen
     * mode, gated on a near-centred stick — which is precisely when roll does
     * NOT accumulate, so it could never undo any of the roll a held turn built
     * up. It runs in every mode now, every frame, and is deliberately gentle:
     * the bank you SEE is `src/flight/bird-visual.js` rolling the model, a
     * separate thing this cannot flatten.
     *
     * `sinRoll` is the planet's up projected onto the bird's own right, so it
     * is zero when the bird's up and the planet's agree and signed by which
     * way it has tipped.
     */
    _levelRoll(deltaTime, rate) {
        const s = this._scratch;
        s.sphereNormal.copy(this.position).sub(this.sphereCenter);
        if (s.sphereNormal.lengthSq() < 1e-12) return;
        s.sphereNormal.normalize();
        const localRight = s.vec3_2.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
        const sinRoll = s.sphereNormal.dot(localRight);
        const correction = -sinRoll * rate * deltaTime;
        if (Math.abs(correction) > 0.0001) {
            s.axis.set(0, 0, 1); // Local Z (roll axis)
            s.quat.setFromAxisAngle(s.axis, correction);
            this.quaternion.multiply(s.quat);
        }
    }

    /**
     * Pitch (Nose Up/Down)
     * Rotates around the Bird's Local X axis
     */
    pitch(input, deltaTime) {
        if (!input) return;
        // User request: "Push Up (Input +1) should Fly Up"
        // +1 Input -> Positive Rotation around X -> Nose Up
        const pitchMul = this.zenMode ? ZEN_TUNING.pitchMul : 1;
        const angle = input * this.pitchRate * pitchMul * deltaTime;

        this._scratch.axis.set(1, 0, 0);
        this._scratch.quat.setFromAxisAngle(this._scratch.axis, angle);
        this.quaternion.multiply(this._scratch.quat);
    }

    update(deltaTime) {
        if (deltaTime <= 0) return this._getPose();

        const s = this._scratch; // Shorthand for scratch vectors

        // 1. Move Forward
        // Get forward direction: (0, 0, -1) rotated by Q
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();

        // Calculate displacement (reuse scratch vector)
        // Zen mode applies a speed multiplier at read-time without mutating this.speed.
        const speedMul = this.zenMode ? ZEN_TUNING.speedMul : 1;
        s.displacement.copy(s.forward).multiplyScalar(this.speed * speedMul * deltaTime);

        // Save old position/normal for transport (using scratch vectors - NO allocations)
        s.oldPos.copy(this.position);
        s.oldNormal.copy(s.oldPos).normalize();

        // Apply movement
        this.position.add(s.displacement);

        // 2. Constrain to Sphere (keep minimum altitude, allow climbing).
        //    The floor follows carved valleys downward so the bird can fly INTO
        //    canyons; rises never lift it (no gravity here, so a raised floor
        //    would ratchet the bird upward). See _floorAt().
        s.radialOffset.copy(this.position).sub(this.sphereCenter);
        const radialDistance = s.radialOffset.length();
        const floor = (radialDistance > 1e-3)
            ? this._floorAt(s.radialOffset.x / radialDistance, s.radialOffset.y / radialDistance, s.radialOffset.z / radialDistance)
            : this.sphereRadius + this.birdRadius;
        if (radialDistance < floor) {
            // Bird penetrated the floor — i.e. it flew INTO a rise relative to its
            // current altitude (the carved ground ahead is higher than where the
            // bird was skimming). Push it back out to the clearance floor AND
            // deflect its heading so it SLIDES over/around the rise instead of
            // hard-stopping or snapping straight up.
            s.radialOffset.normalize().multiplyScalar(floor);
            this.position.copy(s.radialOffset).add(this.sphereCenter);
            // Only bother deflecting when we actually have terrain to slide along
            // and meaningful speed; flat-sphere builds keep the old snap behaviour.
            if (this.terrainHeightAt && this.speed > 0.5 && radialDistance > 1e-3) {
                this._deflectAlongTerrain(s.radialOffset.x / floor, s.radialOffset.y / floor, s.radialOffset.z / floor);
            }
        }

        // 3. Transport Rotation (Spherical Adjustment)
        // We moved along the sphere, so our "Up" vector (Gravity) changed.
        // We must rotate the bird's orientation to match the new local vertical.
        s.newNormal.copy(this.position).sub(this.sphereCenter).normalize();

        // Calculate quaternion that rotates Old Normal to New Normal (using scratch quat)
        s.transportQuat.setFromUnitVectors(s.oldNormal, s.newNormal);

        // Apply this rotation GLOBALLY to the bird (Pre-multiply)
        // This effectively "drags" the bird's orientation to follow the curve
        this.quaternion.premultiply(s.transportQuat);

        // 4. Auto-Leveling (Pitch)
        // Only auto-level if speed is sufficient (aerodynamic stability), and
        // never during a manoeuvre — this term exists to return the nose to
        // the horizon, which is precisely what a loop is not doing.
        if (this.speed > 0.5 && !this.aerobaticActive) {
            s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
            s.sphereNormal.copy(this.position).sub(this.sphereCenter).normalize();

            // Pitch Angle: Sin(Pitch) = Forward dot Normal
            const sinPitch = s.forward.dot(s.sphereNormal);

            // Correction proportional to -sinPitch
            const autoLevelStrength = 1.0;
            const correction = -sinPitch * autoLevelStrength * deltaTime;

            // Apply if significant
            if (Math.abs(correction) > 0.0001) {
                s.axis.set(1, 0, 0); // Local X
                s.quat.setFromAxisAngle(s.axis, correction);
                this.quaternion.multiply(s.quat);
            }
        }

        // 5. Upper pitch clamp — hard ceiling so the bird can never pitch past
        // ±maxPitch (no inverting/looping). sinPitch = forward · outward-normal:
        // positive = nose-up. If beyond the limit, rotate back by the overage
        // around local X (same convention as pitch()/auto-level).
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        s.sphereNormal.copy(this.position).sub(this.sphereCenter).normalize();
        const sinPitchNow = Math.max(-1, Math.min(1, s.forward.dot(s.sphereNormal)));
        const pitchNow = Math.asin(sinPitchNow);
        if (!this.aerobaticActive && Math.abs(pitchNow) > this.maxPitch) {
            const over = pitchNow - Math.sign(pitchNow) * this.maxPitch;
            s.axis.set(1, 0, 0);
            s.quat.setFromAxisAngle(s.axis, -over);
            this.quaternion.multiply(s.quat);
        }

        return this._getPose();
    }

    tick(input, deltaTime) {
        const limitedDelta = Math.min(Math.max(deltaTime, 0), 0.05);
        // A committed manoeuvre owns the orientation for its whole second.
        // Leaving the stick live lets the player fight their own barrel roll,
        // which does not produce a half-roll — it produces a manoeuvre that
        // ends pointing somewhere nobody chose.
        if (!this.aerobaticActive) {
            this.yaw(input.x, limitedDelta);
            this.pitch(input.y, limitedDelta);
        }

        // Roll back toward level, always. This runs in every mode and at every
        // stick position: a held turn is exactly when roll accumulates under
        // the legacy yaw axis, and exactly when the Zen-only version was gated
        // off. Gentle enough that it never fights the player, because nothing
        // in this game asks the player to hold a roll.
        if (this.levelTurns && !this.aerobaticActive) {
            this._levelRoll(limitedDelta, this.rollLevelRate);
        }

        // Zen mode: extra settling when the stick is near-centered, so a
        // hands-off Zen bird sits flatter than a cruising one.
        if (this.zenMode) {
            const inputMag = Math.hypot(input.x || 0, input.y || 0);
            if (inputMag < 0.1) {
                this._applyZenAutoLevelRoll(limitedDelta);
            }
        }

        return this.update(limitedDelta);
    }

    /**
     * Zen auto-level-roll. Gently interpolates the bird's local-up toward the
     * sphere normal by rotating around local Z. Zero allocations.
     */
    _applyZenAutoLevelRoll(deltaTime) {
        // One implementation, two strengths: Zen's extra settling on a centred
        // stick is the same correction the always-on leveller applies, just
        // harder. Keeping two copies is how they drift apart.
        this._levelRoll(deltaTime, 1.2);
    }

    // Minimum allowed radius along an outward unit direction. The shared terrain
    // sampler is already clamped to height <= 0 ("carve down from a baseline
    // plateau" — see spherical-world.js), so the floor only ever DIPS below
    // sphereRadius into carved valleys/canyons and never rises above it. That
    // keeps the gravity-less bird from being ratcheted upward on gentle ground
    // while still letting it descend into canyons.
    //
    // birdRadius is added as a CONSTANT clearance so the bird's body skims OVER
    // the surface it sees rather than sinking into the mesh. This closes the gap
    // that previously let the bird clip into / stick inside terrain rises: the
    // old floor (no clearance) let the centre reach sphereRadius+terrain, i.e.
    // birdRadius INTO the mesh, which then tripped checkGroundCollision and
    // force-grounded the bird against the rise. The clearance is a flat offset,
    // NOT a rise-follower, so flat ground and valley skimming feel unchanged.
    // Matches spherical-world.js checkGroundCollision (same sampler + radius), so
    // there is one source of truth for terrain height. Zero allocations.
    _floorAt(nx, ny, nz) {
        if (!this.terrainHeightAt) return this.sphereRadius + this.birdRadius;
        return this.sphereRadius + this.terrainHeightAt(nx, ny, nz) + this.birdRadius;
    }

    // Deflect the bird's heading so it SLIDES along a terrain rise it just
    // penetrated, instead of hard-stopping against it or being snapped straight
    // up (which would launch it). Called ONLY on an actual floor penetration, so
    // the extra height samples here never touch the normal cruise hot path.
    //
    // (nx,ny,nz) is the outward unit direction at the corrected position. We build
    // a local tangent basis, finite-difference the carved-terrain height along
    // each tangent to recover the slope gradient, and form the true surface normal
    // (radial tilted away from uphill). The component of the bird's forward that
    // points INTO that surface is removed and the forward re-normalized — a
    // tangential slide along the slope. The quaternion is then re-aimed at the new
    // forward so movement and the rendered model both follow the deflected path.
    // This is the velocity-deflection analogue of spherical-world's reflect-with-
    // damping ground response, expressed in this controller's orientation-driven
    // movement model (it has no separate velocity vector). Vector math reuses
    // scratch (no Vector3/Quaternion allocations); the only per-call allocation is
    // the tiny `sample` closure below, which is acceptable here because this runs
    // ONLY on a penetration frame, never on the cruise hot path.
    _deflectAlongTerrain(nx, ny, nz) {
        const s = this._scratch;

        // Outward radial normal at the corrected position.
        s.surfNormal.set(nx, ny, nz).normalize();

        // Build two orthonormal tangents to the sphere at this point.
        s.tanA.set(0, 1, 0);
        if (Math.abs(s.surfNormal.y) > 0.95) s.tanA.set(1, 0, 0); // avoid degeneracy near poles
        s.tanA.crossVectors(s.tanA, s.surfNormal).normalize();
        s.tanB.crossVectors(s.surfNormal, s.tanA).normalize();

        // Finite-difference the carved height along each tangent (small epsilon in
        // world units; we re-normalize the offset direction before sampling, since
        // terrainHeightAt keys off direction only). Slope = d(height)/d(tangent).
        const eps = 0.5;
        const sample = (tan, sign) => {
            const px = s.surfNormal.x + sign * eps * tan.x;
            const py = s.surfNormal.y + sign * eps * tan.y;
            const pz = s.surfNormal.z + sign * eps * tan.z;
            const inv = 1 / Math.sqrt(px * px + py * py + pz * pz);
            return this.terrainHeightAt(px * inv, py * inv, pz * inv);
        };
        const slopeA = (sample(s.tanA, 1) - sample(s.tanA, -1)) / (2 * eps);
        const slopeB = (sample(s.tanB, 1) - sample(s.tanB, -1)) / (2 * eps);

        // Surface normal = radial minus the tangential gradient (uphill pulls the
        // normal away from radial). Then normalize. If the ground is locally flat
        // (no gradient), this stays radial and the slide just removes the downward
        // dive component — still a graceful skim, never a snap.
        s.surfNormal.addScaledVector(s.tanA, -slopeA);
        s.surfNormal.addScaledVector(s.tanB, -slopeB);
        s.surfNormal.normalize();

        // Current forward (movement direction) in world space.
        s.forward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();

        // Remove the into-surface component so the bird glides along the slope.
        const into = s.forward.dot(s.surfNormal);
        if (into < 0) {
            s.vec3.copy(s.forward).addScaledVector(s.surfNormal, -into); // forward - (forward·n)n
            if (s.vec3.lengthSq() > 1e-6) {
                s.vec3.normalize();
                // Re-aim orientation onto the deflected forward (minimal rotation).
                s.quat.setFromUnitVectors(s.forward, s.vec3);
                this.quaternion.premultiply(s.quat);
            }
        }
    }

    _constrainToSphere() {
        if (this.sphereCenter) {
            const s = this._scratch;
            s.radialOffset.copy(this.position).sub(this.sphereCenter);
            const radialDistance = s.radialOffset.length();
            // Route through _floorAt so the birdRadius clearance / null-terrain case
            // matches update()'s floor — one floor definition for spawn and cruise.
            const floor = (radialDistance > 1e-3)
                ? this._floorAt(s.radialOffset.x / radialDistance, s.radialOffset.y / radialDistance, s.radialOffset.z / radialDistance)
                : this.sphereRadius + this.birdRadius;
            if (radialDistance < floor) {
                s.radialOffset.normalize().multiplyScalar(floor);
                this.position.copy(s.radialOffset).add(this.sphereCenter);
            }
        }
    }

    _getPose() {
        // Reuse pre-allocated pose output to avoid allocations
        this._poseOutput.position.copy(this.position);
        this._poseOutput.quaternion.copy(this.quaternion);
        this._poseOutput.velocity.set(0, 0, 0); // Todo: calc velocity if needed
        return this._poseOutput;
    }

    // Getters for external checking
    // Note: getPosition returns a copy for safety when used externally
    getPosition() { return this._scratch.vec3.copy(this.position); }

    setSpeed(speed) {
        this.speed = speed;
    }

    /**
     * Glide-speed control (0..1). Scales cruise speed off baseSpeed and exposes
     * `throttle` for the slider's % readout. Previously absent, so the glide
     * slider threw on every input. NOTE: the main loop currently re-asserts a
     * cruise speed each frame, so until that coupling is addressed (the deferred
     * momentum/energy work) this primarily keeps the control from throwing and
     * drives the % display rather than fully governing steady-state speed.
     */
    setThrottle(value) {
        const t = Math.max(0, Math.min(1, Number.isFinite(value) ? value : this.throttle));
        this.throttle = t;
        this.speed = this.baseSpeed * t;
    }

    /** Restore the spawn pose/speed. Previously absent, so the Reset button threw. */
    reset() {
        if (!this._initialPose) return;
        this.position.copy(this._initialPose.position);
        this.quaternion.copy(this._initialPose.quaternion);
        this.baseSpeed = this._initialPose.speed;
        this.throttle = this._initialPose.throttle;
        this.speed = this.baseSpeed * this.throttle;
        this._constrainToSphere();
    }

    /**
     * Toggle Zen mode. When enabled, applies ZEN_TUNING multipliers to forward
     * speed, yaw rate, and pitch rate at read-time. Base constants are not mutated.
     */
    setZenMode(enabled) {
        this.zenMode = Boolean(enabled);
    }
}
