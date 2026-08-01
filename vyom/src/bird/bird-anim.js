/**
 * bird-anim.js — the thing that decides whether VYOM reads as a shipped game.
 *
 * A racing bird that flaps with a symmetric sine wave and turns by rolling a
 * rigid model looks like a prototype no matter how good the shading is. This
 * animator does five specific things that a naive one does not:
 *
 *   1. **The flap is asymmetric in time.** The downstroke — the half that does
 *      the work — takes 36% of the cycle; the recovery takes 64%. Real wings
 *      snap down and drift up, and the eye reads the difference immediately.
 *
 *   2. **The tip lags the shoulder.** The shoulder angle drives a spring
 *      follower; the difference between the shoulder and the follower is fed to
 *      the wing's shader deformer as a tip curl plus a backward sweep. So the
 *      wing whips and overshoots at each end of the stroke instead of pivoting
 *      like a plank, and it keeps some follow-through for a beat after a burst.
 *
 *   3. **Turning is a whole-body action.** Bank, differential wing dihedral,
 *      tail rudder + fan, and a head that counter-rotates so the bird is
 *      LOOKING into the corner rather than being dragged around it.
 *
 *   4. **Attitude changes the wing shape.** Diving sweeps the wings back and
 *      shortens the span; climbing and landing spread and reach.
 *
 *   5. **It is never still.** Idle bob, blink, micro flap during a glide.
 *
 * Everything is driven from a caller-owned state object that is mutated in
 * place. `update` allocates nothing: every value below is a captured number,
 * and every write is a float store into an existing Euler / Vector3 / uniform.
 */

import { makeRng } from '../core/rng.js';

const TAU = Math.PI * 2;

/** Fraction of the flap cycle spent on the powered downstroke. */
const DOWNSTROKE = 0.36;

const CFG = {
    flapRateBase: 1.25,     // Hz at rest
    flapRateImpulse: 3.10,  // added Hz at full flapImpulse
    flapRateSpeed: 0.55,
    flapAmpBase: 0.30,      // rad, half-amplitude at rest
    flapAmpImpulse: 0.62,
    glideAmp: 0.055,
    glideRate: 0.42,
    restDihedral: 0.14,     // wings sit slightly above level when gliding
    tipStiffness: 190,      // spring the wing tip chases the shoulder with
    tipDamping: 11,
    curlGain: 0.62,
    sweepGain: 0.30,
    maxBank: 0.78,
    bankLag: 6.5,
    headYaw: 0.46,
    headCounterRoll: 0.55,
    blinkMin: 2.4,
    blinkMax: 5.6,
    blinkDur: 0.13,
    tumbleSpin: 9.5,
};

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function damp(current, target, rate, dt) {
    // Frame-rate independent exponential approach. No allocation, no branch on
    // dt spikes beyond the caller's clamp.
    return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * @param {object} THREE  (unused for maths — kept for API symmetry and so the
 *                        animator can be handed the same module everything else
 *                        gets. Deliberately no THREE objects are created here.)
 * @param {object} bird   the object returned by createBird
 */
export function createBirdAnimator(THREE, bird) {
    const parts = bird.parts;
    const u = bird.uniforms;

    const body = parts.body;
    const head = parts.head;
    const leftWing = parts.leftWing;
    const rightWing = parts.rightWing;

    // Rest transforms captured once so every frame writes absolute values
    // rather than accumulating drift.
    const bodyBaseY = body.position.y;
    const headBaseY = head.position.y;
    const headBaseZ = head.position.z;

    const rng = makeRng(0x51F7 ^ Math.round(headBaseZ * 10007));

    // --- animator state (plain numbers; nothing here is ever reallocated) ---
    let t = 0;
    let flapPhase = rng();
    let impulse = 0;
    let glide = 0;
    let bank = 0;
    let pitchS = 0;
    let turnS = 0;
    let speedS = 0;
    let tuck = 0;
    let spread = 0;
    let boost = 0;
    let shoulder = CFG.restDihedral;
    let tip = CFG.restDihedral;
    let tipVel = 0;
    let blinkTimer = 1.2 + rng() * 2;
    let blinkT = 0;
    let tumble = 0;
    let tumbleSpin = 0;
    let celebrate = 0;
    let groundT = 0;
    let walkPhase = 0;

    const api = {
        /** Read-only: current position in the flap cycle, 0..1. */
        flap01: 0,
        /** Read-only: current follow-through amount, for FX timing. */
        curl: 0,
        update: update,
        dispose: function dispose() { /* owns no GPU resources */ },
    };

    function update(dt, state) {
        if (!(dt > 0)) return;
        if (dt > 0.05) dt = 0.05;
        t += dt;

        const sIn = state || 0;
        const speed01 = clamp(sIn.speed01 || 0, 0, 1);
        const turn = clamp(sIn.turn || 0, -1, 1);
        const pitch = clamp(sIn.pitch || 0, -1, 1);
        const flapImpulse = clamp(sIn.flapImpulse || 0, 0, 1);
        const phaseOff = sIn.phase || 0;

        // --- smoothed inputs ------------------------------------------------
        speedS = damp(speedS, speed01, 4.0, dt);
        turnS = damp(turnS, turn, CFG.bankLag, dt);
        pitchS = damp(pitchS, pitch, 5.5, dt);
        boost = damp(boost, sIn.boosting ? 1 : 0, 7.0, dt);
        tumble = damp(tumble, sIn.tumbling ? 1 : 0, sIn.tumbling ? 12 : 3.2, dt);
        celebrate = damp(celebrate, sIn.celebrating ? 1 : 0, 5.0, dt);
        groundT = damp(groundT, sIn.grounded ? 1 : 0, 6.0, dt);

        // A flapImpulse is a one-shot kick from the flight model; hold and decay
        // it so a single tap produces a whole powered stroke, not one frame of
        // one.
        impulse = Math.max(impulse - dt * 1.45, flapImpulse);

        // --- flap cycle ------------------------------------------------------
        // Gliding is what the bird does at speed with no input; it is a state,
        // not an absence of one, so it gets its own blend.
        const wantGlide = (speed01 > 0.45 && impulse < 0.16 && !sIn.grounded && !sIn.celebrating) ? 1 : 0;
        glide = damp(glide, wantGlide, wantGlide ? 1.8 : 6.0, dt);

        let rate = CFG.flapRateBase + impulse * CFG.flapRateImpulse + speed01 * CFG.flapRateSpeed;
        rate = rate * (1 - glide) + CFG.glideRate * glide;
        if (celebrate > 0.01) rate = rate * (1 - celebrate) + 2.9 * celebrate;
        if (tumble > 0.01) rate = rate * (1 - tumble) + 4.6 * tumble;

        flapPhase += dt * rate;
        if (flapPhase >= 1) flapPhase -= Math.floor(flapPhase);

        let cyc = flapPhase + phaseOff;
        cyc -= Math.floor(cyc);
        api.flap01 = cyc;

        // Time warp: compress the first DOWNSTROKE of the cycle into the first
        // half of the waveform. Fast, powerful down; long, soft recovery.
        const warp = cyc < DOWNSTROKE
            ? (cyc / DOWNSTROKE) * 0.5
            : 0.5 + ((cyc - DOWNSTROKE) / (1 - DOWNSTROKE)) * 0.5;
        const stroke = Math.cos(warp * TAU);        // +1 top, -1 bottom

        let amp = CFG.flapAmpBase + impulse * CFG.flapAmpImpulse;
        amp = amp * (1 - glide) + CFG.glideAmp * glide;
        amp *= 1 - 0.45 * groundT;

        // Rest angle: wings sit high in a glide, low and folded when grounded,
        // thrown wide open when celebrating.
        let rest = CFG.restDihedral + glide * 0.10 - groundT * 0.30;
        rest += celebrate * 1.05;
        rest -= boost * 0.10;

        shoulder = rest + amp * stroke;

        // --- follow-through --------------------------------------------------
        // The tip is a mass on a spring hanging off the shoulder. The lag
        // between them IS the follow-through; feeding it to the shader deformer
        // bends the outer wing rather than the whole panel.
        tipVel += (shoulder - tip) * CFG.tipStiffness * dt;
        tipVel *= Math.exp(-CFG.tipDamping * dt);
        tip += tipVel * dt;
        const lag = clamp(tip - shoulder, -0.85, 0.85);
        api.curl = lag;

        // --- attitude: tuck on a dive, spread on a climb / landing -----------
        const wantTuck = clamp(-pitchS, 0, 1) * 0.85 + boost * 0.45;
        tuck = damp(tuck, clamp(wantTuck, 0, 1), 6.0, dt);
        const wantSpread = clamp(pitchS, 0, 1) * 0.8 + groundT * 1.0;
        spread = damp(spread, clamp(wantSpread, 0, 1), 5.0, dt);

        const sweepBack = tuck * 0.62 - spread * 0.22;
        const spanScale = 1 - tuck * 0.24 + spread * 0.07;

        // --- per-wing ---------------------------------------------------------
        // Differential dihedral: the wing on the inside of the turn drops, the
        // outside wing lifts. Positive `turn` is a right-hand turn.
        const diff = turnS * 0.26;
        const tumbleFold = tumble * 0.9;

        applyWing(leftWing, -1, shoulder + diff, sweepBack, spanScale, tumbleFold);
        applyWing(rightWing, 1, shoulder - diff, sweepBack, spanScale, tumbleFold);

        const curl = lag * CFG.curlGain * (1 - tumble * 0.7);
        const sweep = lag * CFG.sweepGain + tuck * 0.10;
        u.leftCurl.value = curl + turnS * 0.10;
        u.rightCurl.value = curl - turnS * 0.10;
        u.leftSweep.value = sweep;
        u.rightSweep.value = sweep;

        // --- body -------------------------------------------------------------
        bank = damp(bank, -turnS * CFG.maxBank, 8.0, dt);

        const bobAmp = (0.020 + 0.016 * impulse) * (1 - speedS * 0.5);
        const bob = Math.sin(warp * TAU + 1.1) * bobAmp;

        if (sIn.grounded) {
            walkPhase += dt * 3.2;
            body.position.y = bodyBaseY + Math.abs(Math.sin(walkPhase * TAU)) * 0.035;
            body.rotation.z = bank * 0.3 + Math.sin(walkPhase * TAU) * 0.06;
        } else {
            body.position.y = bodyBaseY + bob;
            body.rotation.z = bank;
        }

        // Tumble spins the whole body inside the root group, so the flight
        // controller keeps owning the actual heading while the bird visibly
        // loses control.
        if (tumble > 0.001) {
            tumbleSpin += dt * CFG.tumbleSpin;
            const normalPitch = pitchS * 0.26 - bob * 0.5;
            body.rotation.x = normalPitch * (1 - tumble) + tumbleSpin * tumble;
            body.rotation.z = bank * (1 - tumble) + Math.sin(tumbleSpin * 0.63) * 1.1 * tumble;
        } else {
            tumbleSpin = 0;
            body.rotation.x = pitchS * 0.26 - bob * 0.5 + celebrate * 0.20;
        }
        body.rotation.y = -turnS * 0.10;   // a touch of slip, so the bank leads

        // --- head ---------------------------------------------------------------
        // Counter-rotation: the head yaws INTO the turn and counter-rolls to
        // stay closer to level than the body. This is the single cheapest thing
        // that makes a model look like it has intent.
        const headLook = -turnS * CFG.headYaw * (1 - tumble * 0.8);
        head.rotation.y = headLook;
        head.rotation.z = -body.rotation.z * CFG.headCounterRoll;
        head.rotation.x = -pitchS * 0.16 - bob * 1.6 + celebrate * -0.26 + groundT * 0.10;
        head.position.y = headBaseY + Math.sin(t * 2.3) * 0.011 * (1 - speedS * 0.6) - bob * 0.35;
        head.position.z = headBaseZ - boost * 0.045 + tuck * 0.030;

        // --- blink ---------------------------------------------------------------
        if (blinkT > 0) {
            blinkT -= dt;
            const k = clamp(blinkT / CFG.blinkDur, 0, 1);
            u.blink.value = Math.sin(k * Math.PI);
            if (blinkT <= 0) {
                u.blink.value = 0;
                blinkTimer = CFG.blinkMin + rng() * (CFG.blinkMax - CFG.blinkMin);
            }
        } else {
            blinkTimer -= dt;
            if (blinkTimer <= 0) blinkT = CFG.blinkDur;
        }

        // --- tail ------------------------------------------------------------------
        // Rudder swings to the OUTSIDE of the corner (counter-steer), fans wide
        // when turning hard or flaring, and pitches down to brake on a climb.
        u.tailYaw.value = -turnS * 0.34;
        u.tailPitch.value = -pitchS * 0.30 + groundT * 0.55 + celebrate * -0.30
            + Math.sin(warp * TAU + 2.2) * 0.05 * (1 - glide);
        u.tailFan.value = 1
            + Math.abs(turnS) * 0.55
            + spread * 0.45
            + celebrate * 0.7
            - tuck * 0.22;
    }

    /**
     * Write one wing. `side` is -1 for the bird's left (which sits at -X, so a
     * positive dihedral is a NEGATIVE rotation about Z) and +1 for the right.
     */
    function applyWing(w, side, angle, sweepBack, spanScale, fold) {
        const a = angle * (1 - fold) + (-0.55) * fold;
        w.rotation.z = side < 0 ? -a : a;
        // Sweeping back means the tip travels toward +Z, which is a positive
        // Y-rotation for the left wing and a negative one for the right.
        const sb = sweepBack + fold * 0.55;
        w.rotation.y = side < 0 ? sb : -sb;
        w.rotation.x = side * angle * 0.10;   // a little twist through the stroke
        const sc = spanScale * (1 - fold * 0.18);
        w.scale.set(sc, 1, 1);
    }

    return api;
}
