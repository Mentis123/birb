/**
 * race/ai-racer.js — VYOM's three rivals.
 *
 * ---------------------------------------------------------------------------
 * WHY KINEMATIC AND NOT THE REAL FLIGHT MODEL
 * ---------------------------------------------------------------------------
 * `bird/flight.js` is a parallel-transported, energy-trading arcade sim tuned
 * for a human holding a joystick. Three more copies of it would cost three more
 * quaternion transports per frame, and — worse — would need an AI *pilot* on
 * top: a controller that outputs stick deflections and that can, like any
 * controller, diverge. A rival that spirals off into space once every twenty
 * races is not shippable.
 *
 * So the rivals are kinematic: a position, a unit heading, and a scalar speed.
 * They STEER — the heading turns toward a lookahead target at a bounded angular
 * rate — rather than being dragged along the spline. That distinction is the
 * whole point:
 *
 *   - a rail-follower cannot overshoot, so it can never make a mistake, and a
 *     rival that cannot make a mistake is not a rival, it is a metronome;
 *   - a steerer with a bounded turn rate *has* a turn radius, so a corner taken
 *     too fast runs wide on its own, with no scripting.
 *
 * The bounded turn rate is the safety net that the full sim lacks: heading
 * cannot leave the unit sphere, speed is clamped to an envelope, and the radius
 * is clamped above `floorRadius`. Divergence is structurally impossible.
 *
 * ---------------------------------------------------------------------------
 * HOW A "LINE" IS BUILT
 * ---------------------------------------------------------------------------
 * At build time the course is sampled into a SIGNED curvature table, k(t), in
 * [-1,1] (+1 = hardest left-hand corner the circuit has... whichever side that
 * is; the sign is consistent, which is all that matters). `side = tangent x up`
 * so +k means the corner's centre lies on +side, i.e. the INSIDE is +side.
 *
 * A blurred copy kbar(t) is then taken over a ~26-unit window. The pair gives
 * every line shape a racing driver actually uses, for free:
 *
 *     lat(t) = A * ( apexInside * k(t)  -  outInOut * ( kbar(t) - k(t) ) )
 *
 *   - at the APEX, k is at its peak and kbar ~ k, so the first term dominates
 *     and the bird sits on the inside kerb;
 *   - on ENTRY and EXIT, k is small but kbar is still large, so the second term
 *     goes negative and the bird sits WIDE.
 *
 * Turn `outInOut` down and you get a driver who dives at the apex from the
 * middle of the track (the aggressive one). Turn `apexInside` up past 1 and
 * they cut the kerb. The two knobs are the personalities' skeleton; the flesh
 * is the second-order lateral spring below.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LATERAL FILTER IS A SPRING AND NOT A DAMP()
 * ---------------------------------------------------------------------------
 * A first-order exponential approach can never overshoot, so a first-order
 * rival can never over-correct — and "over-corrects" is half the definition of
 * the erratic personality. The lateral offset is therefore a mass on a spring
 * (`latStiff`, `latDamp`). Damping ratio is the personality:
 *
 *     clean       zeta ~ 0.95   settles onto the line and stays there
 *     aggressive  zeta ~ 0.85   snaps to the apex, slight over-commit
 *     erratic     zeta ~ 0.45   visibly rings — swings wide, catches it, swings back
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM
 * ---------------------------------------------------------------------------
 * Mistakes are scheduled from a per-racer `makeRng` stream, so the sequence of
 * blunders is identical every run. The lateral WANDER is a sum of sines of the
 * accumulated race clock, not an rng draw per frame — an rng draw per frame
 * would make the result depend on the frame rate, which would break the
 * screenshot harness's "capture the same frame twice" guarantee.
 *
 * Nothing in `update()` allocates: every vector below is built once here.
 */

import { PALETTE } from '../core/palette.js';
import { floorRadius, PLANET_RADIUS } from '../core/terrain.js';
import { makeRng } from '../core/rng.js';
import { createBird as defaultCreateBird } from '../bird/bird-model.js';
import { createBirdAnimator } from '../bird/bird-anim.js';
import { recordGate, updateRacerT, RACE_CONFIG } from './race-logic.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const CFG = {
    /** Pace a rival holds on the ridge straight, world units/sec. The player's
     *  cruise is 34 and their ceiling is 58, so a rival at 36 is beatable by
     *  anyone using the boost and uncatchable by anyone who never turns. */
    baseSpeed: 36,
    minSpeed: 15,
    maxSpeed: 54,

    /** Curvature (rad/world-unit) that maps to |k| = 1. The hairpin measures
     *  2.37 deg/u = 0.0414 rad/u, so the hairpin saturates the table and every
     *  other corner is a readable fraction of it. */
    kappaNorm: 0.042,

    /** Half-width of the corridor the line-shaper may use, world units. Gates
     *  are radius 9 and `RACE_CONFIG.gateRadius` is 11, so a rival this far
     *  off-line still flies through the ring. */
    laneAmp: 5.0,
    /** Hard cap on lateral offset including wander, mistakes and contact. */
    laneMax: 7.6,

    /** Nominal altitude above the ribbon centreline. The ribbon is a beam
     *  1.5 units deep; +3.4 puts a bird clear of it without losing the read
     *  that they are following it. */
    altAbove: 3.4,
    /** Per-racer vertical lane separation so a three-wide pack still has three
     *  silhouettes rather than one. */
    altLane: 1.7,

    /** Never closer than this to the flight floor. The ribbon itself clears the
     *  floor by 5.5, so 6.5 keeps a rival above the racing line's own floor. */
    floorClear: 6.5,
    /** Soft ceiling above the baseline, mirroring flight.js's maxAltitude. */
    maxAltitude: 30,

    /** Mutual avoidance: full strength inside `avoidNear`, zero past `avoidFar`. */
    avoidNear: 5.0,
    avoidFar: 13.0,
    avoidPush: 5.0,
    /** Contact range for the aggressive personality's shoulder-barge. */
    bumpDist: 4.2,
    bumpShove: 26,
    bumpSpeedLoss: 3.2,

    /** Rubber band: extra pace per lap-of-progress the player is ahead, and the
     *  hard cap on it. 7% is under the ~12% a boost is worth, so a rival can
     *  never out-drag a player who is using theirs — it only stops a bad lap
     *  turning into a lonely one. */
    rubberGain: 1.6,
    rubberMaxBehind: 0.07,
    rubberMaxAhead: 0.05,

    /** Pack cohesion. The player band alone is not enough: in a race where the
     *  player is off the back, the rivals have nothing pulling them together
     *  and the field strings out into three separate races. This is a second,
     *  weaker band toward the FIELD MEAN, so the rivals also stay in sight of
     *  each other. Capped well below the player band so it can never be the
     *  thing that decides a result. */
    packGain: 1.1,
    packMax: 0.045,

    /** Angular rate that maps to animator `turn` = 1. Deliberately BELOW the
     *  personalities' max turn rate: a bird that only reaches full bank at its
     *  physical steering limit spends the whole lap looking bolt upright, and
     *  an arcade racer wants the lean to read on an ordinary sweeper. */
    turnNorm: 1.6,
};

/**
 * The three rivals. Every field here changes something you can SEE from the
 * chase camera, not just a number in a log.
 */
const PERSONALITIES = [
    {
        key: 'aggressive',
        name: 'Talon',
        color: PALETTE.birdRival1,
        // Dives at the apex from wherever it happens to be, cuts the kerb,
        // barely lifts for the corner and leans on anyone alongside.
        speedMul: 1.03,
        cornerBrake: 0.21,      // late on the brakes
        brakeLead: 7,           // ...and barely looks ahead for them
        lookahead: 12,
        lookaheadSpeedK: 0.26,
        apexInside: 1.40,       // past 1 = over the inside kerb
        outInOut: 0.18,         // almost no setup phase
        latStiff: 46, latDamp: 11.6,
        steerGain: 6.4, turnRate: 2.85,
        accel: 27, brake: 33,
        wanderAmp: 0.45, wanderRate: 0.31,
        flapHz: 1.00, flapAmp: 0.95, flapBeat: 5,
        avoid: 0.30,            // yields to nobody
        bully: 1.0,
        mistakeEvery: [12, 20], mistakeDur: [0.55, 0.95],
        mistakeLat: 4.6, mistakeSlow: 0.80, mistakeTumble: 0.0,
    },
    {
        key: 'clean',
        name: 'Zephyr',
        color: PALETTE.birdRival2,
        // Textbook out-in-out, brakes early and consistently, almost never
        // deviates. The benchmark you measure your own lap against.
        speedMul: 1.06,
        cornerBrake: 0.26,
        brakeLead: 16,
        lookahead: 17,
        lookaheadSpeedK: 0.40,
        apexInside: 1.00,
        outInOut: 1.28,
        latStiff: 34, latDamp: 11.1,
        steerGain: 5.2, turnRate: 2.6,
        accel: 21, brake: 30,
        wanderAmp: 0.10, wanderRate: 0.17,
        flapHz: 0.68, flapAmp: 0.72, flapBeat: 3,
        avoid: 1.0,
        bully: 0,
        mistakeEvery: [26, 42], mistakeDur: [0.4, 0.7],
        mistakeLat: 2.4, mistakeSlow: 0.92, mistakeTumble: 0.0,
    },
    {
        key: 'erratic',
        name: 'Pip',
        color: PALETTE.birdRival3,
        // Wanders across the whole corridor, over-corrects when it catches
        // itself, and once every few corners genuinely throws one away.
        speedMul: 1.05,
        cornerBrake: 0.28,
        brakeLead: 9,
        lookahead: 11,
        lookaheadSpeedK: 0.20,
        apexInside: 0.72,
        outInOut: 0.50,
        latStiff: 60, latDamp: 7.0,   // zeta ~ 0.45: rings visibly
        steerGain: 8.6, turnRate: 2.95,
        accel: 30, brake: 25,
        wanderAmp: 4.0, wanderRate: 0.32,
        flapHz: 0.84, flapAmp: 0.88, flapBeat: 7,
        avoid: 0.85,
        bully: 0.2,
        mistakeEvery: [8, 14], mistakeDur: [0.8, 1.5],
        mistakeLat: 7.4, mistakeSlow: 0.82, mistakeTumble: 0.55,
    },
];

const K_TABLE = 256;
/** Blur half-width for kbar, in table entries (~26 world units on this lap). */
const K_BLUR = 10;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }

/** Signed shortest lap-delta, in (-0.5, 0.5]. Same primitive race-logic uses. */
function deltaT(a, b) {
    let d = (b - Math.floor(b)) - (a - Math.floor(a));
    if (d > 0.5) d -= 1; else if (d <= -0.5) d += 1;
    return d;
}

/**
 * Build a lighter belly tone for a rival body colour. Build-time only.
 * Straight lerp toward cream in sRGB — the birds are cel-shaded, so a
 * perceptual blend would be invisible and cost a colour-space conversion.
 */
function bellyOf(THREE, hex, scratch, cream) {
    scratch.setHex(hex);
    scratch.lerp(cream, 0.62);
    return scratch.getHex();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} opts
 * @param {object}   opts.course        the object returned by createCourse
 * @param {number}   [opts.count=3]
 * @param {string}   [opts.quality='high']
 * @param {number}   [opts.seed=20260801]
 * @param {Function} [opts.createBirdFn]  defaults to bird-model.js's createBird
 * @param {number}   [opts.birdScale=2.0]
 * @param {number}   [opts.firstRacerIndex=1]  index of racer 0 in the race state
 *                                             (the player is normally index 0)
 * @param {boolean}  [opts.autoGates=true]     let the AI file its own gate
 *                                             crossings into the race state
 */
export function createAIRacers(THREE, opts = {}) {
    const course = opts.course;
    if (!course) throw new Error('createAIRacers: opts.course is required');

    const count = Math.max(0, Math.min(PERSONALITIES.length, opts.count ?? 3)) | 0;
    const quality = opts.quality || 'high';
    const seed = (opts.seed ?? 20260801) >>> 0;
    const createBirdFn = opts.createBirdFn || defaultCreateBird;
    const birdScale = opts.birdScale ?? 2.0;
    const firstRacerIndex = opts.firstRacerIndex ?? 1;
    const autoGates = opts.autoGates !== false;

    const length = course.length || 640;
    const group = new THREE.Group();
    group.name = 'vyom-ai-racers';

    // --- build-time scratch (freely allocated; none of this runs per frame) --
    const _b0 = new THREE.Vector3();
    const _b1 = new THREE.Vector3();
    const _b2 = new THREE.Vector3();
    const _b3 = new THREE.Vector3();
    const _bSide = new THREE.Vector3();

    // ---- signed curvature table -------------------------------------------
    const kappa = new Float32Array(K_TABLE);
    const kappaBar = new Float32Array(K_TABLE);
    {
        const h = 1.2 / length;               // finite-difference step, ~1.2 units
        for (let i = 0; i < K_TABLE; i++) {
            const t = i / K_TABLE;
            course.sampleAt(t, _b0);
            _b1.copy(_b0).normalize();        // radial up at the sample
            course.tangentAt(t, _b2);
            _bSide.crossVectors(_b2, _b1).normalize();
            course.tangentAt(t + h, _b2);
            course.tangentAt(t - h, _b3);
            const dk = (_b2.dot(_bSide) - _b3.dot(_bSide)) / (2 * h * length);
            kappa[i] = clamp(dk / CFG.kappaNorm, -1, 1);
        }
        // Wrapped triangular blur -> the "where is the corner, roughly" signal
        // that gives entry and exit their width.
        let wsumRef = 0;
        for (let d = -K_BLUR; d <= K_BLUR; d++) wsumRef += 1 - Math.abs(d) / (K_BLUR + 1);
        for (let i = 0; i < K_TABLE; i++) {
            let sum = 0;
            for (let d = -K_BLUR; d <= K_BLUR; d++) {
                const j = ((i + d) % K_TABLE + K_TABLE) % K_TABLE;
                sum += kappa[j] * (1 - Math.abs(d) / (K_BLUR + 1));
            }
            kappaBar[i] = sum / wsumRef;
        }
    }

    function tableAt(tab, t) {
        const w = t - Math.floor(t);
        const f = w * K_TABLE;
        let i = f | 0; if (i >= K_TABLE) i = K_TABLE - 1;
        const s = f - i;
        const a = tab[i], b = tab[(i + 1) % K_TABLE];
        return a + (b - a) * s;
    }

    // ---- runtime scratch ----------------------------------------------------
    const _up = new THREE.Vector3();
    const _tan = new THREE.Vector3();
    const _side = new THREE.Vector3();
    const _tp = new THREE.Vector3();
    const _tpUp = new THREE.Vector3();
    const _des = new THREE.Vector3();
    const _old = new THREE.Vector3();
    const _cross = new THREE.Vector3();
    const _line = new THREE.Vector3();
    const _rel = new THREE.Vector3();
    const _ax = new THREE.Vector3();
    const _ay = new THREE.Vector3();
    const _az = new THREE.Vector3();
    const _mat = new THREE.Matrix4();
    const _roll = new THREE.Quaternion();
    const _rollAxis = new THREE.Vector3(0, 0, 1);

    // ---- the racers ---------------------------------------------------------
    const cream = new THREE.Color(PALETTE.uiCream);
    const colScratch = new THREE.Color();

    const racers = [];
    for (let i = 0; i < count; i++) {
        const p = PERSONALITIES[i % PERSONALITIES.length];
        const bird = createBirdFn(THREE, {
            bodyColor: p.color,
            bellyColor: bellyOf(THREE, p.color, colScratch, cream),
            scale: birdScale,
            quality,
            outline: true,
        });
        const anim = createBirdAnimator(THREE, bird);
        group.add(bird.group);

        const rng = makeRng(seed ^ Math.imul(i + 1, 0x9e3779b1));

        racers.push({
            // --- public-ish ---------------------------------------------------
            group: bird.group,
            bird,
            anim,
            name: p.name,
            color: p.color,
            personality: p.key,
            raceIndex: firstRacerIndex + i,
            t: 0,
            lap: 1,
            speed: 0,
            progress: 0,
            finished: false,
            boosting: false,

            // --- internals ----------------------------------------------------
            cfg: p,
            rng,
            position: new THREE.Vector3(),
            dir: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            _side: new THREE.Vector3(),
            _up: new THREE.Vector3(),
            gridLat: 0,
            gridT: 0,
            altLane: 0,
            lat: 0,
            latVel: 0,
            latTarget: 0,
            avoidPush: 0,
            shove: 0,
            speedPenalty: 0,
            alt: 0,
            lastT: 0,
            laps: 0,
            turnSig: 0,
            pitchSig: 0,
            bank: 0,
            wanderA: rng() * Math.PI * 2,
            wanderB: rng() * Math.PI * 2,
            wanderFA: 0.7 + rng() * 0.5,
            wanderFB: 1.7 + rng() * 0.9,
            flapPhase: rng(),
            mistakeIn: 0,
            mistakeT: 0,
            mistakeDur: 1,
            mistakeLat: 0,
            mistakeSlow: 1,
            mistakeTumble: 0,
            // The animator's caller-owned state object. Allocated ONCE.
            animState: {
                speed01: 0, turn: 0, pitch: 0, boosting: false, flapImpulse: 0,
                tumbling: false, grounded: false, celebrating: false,
                phase: (i * 0.37) % 1,
            },
        });
    }

    // ---- helpers ------------------------------------------------------------

    /** side = tangent x up at `t`, written into `out`. Zero-alloc. */
    function sideAt(t, out) {
        course.sampleAt(t, _tp);
        _tpUp.copy(_tp).normalize();
        course.tangentAt(t, _tan);
        out.crossVectors(_tan, _tpUp);
        const l = out.length();
        if (l > 1e-6) out.multiplyScalar(1 / l); else out.set(1, 0, 0);
        return out;
    }

    function scheduleMistake(r) {
        const e = r.cfg.mistakeEvery;
        r.mistakeIn = e[0] + (e[1] - e[0]) * r.rng();
    }

    function triggerMistake(r) {
        const d = r.cfg.mistakeDur;
        r.mistakeDur = d[0] + (d[1] - d[0]) * r.rng();
        r.mistakeT = r.mistakeDur;
        // Sign is drawn, magnitude is scaled by a second draw, so a "mistake"
        // ranges from a scruffy corner to a properly thrown-away one.
        const sev = 0.45 + 0.55 * r.rng();
        r.mistakeLat = (r.rng() < 0.5 ? -1 : 1) * r.cfg.mistakeLat * sev;
        r.mistakeSlow = 1 - (1 - r.cfg.mistakeSlow) * sev;
        r.mistakeTumble = r.cfg.mistakeTumble * (sev > 0.85 ? 1 : 0);
        scheduleMistake(r);
    }

    // ---- reset --------------------------------------------------------------

    let clockMs = 0;
    let raceRunning = false;

    function reset() {
        clockMs = 0;
        raceRunning = false;
        for (let i = 0; i < racers.length; i++) {
            const r = racers[i];
            // Grid: staggered across the line and a touch behind it, so the
            // first thing they do is cross gate 0 (which does not count — the
            // convention in race-logic.js is nextGate starts at 1).
            r.gridLat = (i - (racers.length - 1) * 0.5) * 4.4;
            r.gridT = -0.0022 * i - 0.0018;
            r.altLane = (i - (racers.length - 1) * 0.5) * CFG.altLane;

            const t0 = r.gridT - Math.floor(r.gridT);
            r.t = t0;
            r.lastT = t0;
            r.laps = 0;
            r.lap = 1;
            r.progress = 0;
            r.finished = false;

            course.sampleAt(t0, _tp);
            _tpUp.copy(_tp).normalize();
            sideAt(t0, _side);
            r.position.copy(_tp)
                .addScaledVector(_side, r.gridLat)
                .addScaledVector(_tpUp, CFG.altAbove + r.altLane);
            course.tangentAt(t0, _tan);
            r.dir.copy(_tan);
            r._up.copy(_tpUp);
            r._side.copy(_side);

            r.speed = 0;
            r.lat = r.gridLat;
            r.latVel = 0;
            r.latTarget = r.gridLat;
            r.alt = CFG.altAbove + r.altLane;
            r.avoidPush = 0;
            r.shove = 0;
            r.speedPenalty = 0;
            r.turnSig = 0;
            r.pitchSig = 0;
            r.bank = 0;
            r.mistakeT = 0;
            r.mistakeTumble = 0;
            scheduleMistake(r);

            writePose(r);

            const s = r.animState;
            s.speed01 = 0; s.turn = 0; s.pitch = 0; s.boosting = false;
            s.flapImpulse = 0; s.tumbling = false; s.grounded = false;
            s.celebrating = false;
        }
    }

    /** Orientation from heading + radial up, plus a roll into the corner. */
    function writePose(r) {
        _az.copy(r.dir).multiplyScalar(-1);          // model forward is -Z
        _ay.copy(r._up);
        _ax.crossVectors(_ay, _az);
        const lx = _ax.length();
        if (lx < 1e-5) {
            // Heading is parallel to up (a vertical climb). Fall back to the
            // previous right vector so the pose cannot pop.
            _ax.copy(r._side);
        } else {
            _ax.multiplyScalar(1 / lx);
        }
        _ay.crossVectors(_az, _ax).normalize();
        _mat.makeBasis(_ax, _ay, _az);
        r.quaternion.setFromRotationMatrix(_mat);
        // A little roll on top of the animator's own body bank — the animator
        // leans the torso, this commits the whole bird.
        _roll.setFromAxisAngle(_rollAxis, -r.bank * 0.34);
        r.quaternion.multiply(_roll);
        r.group.position.copy(r.position);
        r.group.quaternion.copy(r.quaternion);
    }

    // ---- update -------------------------------------------------------------

    /**
     * @param {number} dt
     * @param {number} [playerProgress]  laps + fraction, for rubber-banding
     * @param {object} [raceState]       race-logic state; gates + standings
     * @param {THREE.Vector3} [playerPosition] optional, so rivals avoid (and
     *                                         Talon leans on) the player too
     */
    function update(dt, playerProgress, raceState, playerPosition) {
        if (!(dt > 0)) return;
        if (dt > 0.05) dt = 0.05;

        let fieldMean = 0;
        const running = raceState ? !!raceState.running : true;
        if (running) {
            if (!raceRunning && raceState) clockMs = raceState.startMs;
            raceRunning = true;
            clockMs += dt * 1000;
        }
        const pProg = typeof playerProgress === 'number' ? playerProgress : 0;
        const hasPlayerPos = !!(playerPosition && playerPosition.isVector3);

        // ---- pass A: where everyone is, and what line they want -------------
        for (let i = 0; i < racers.length; i++) {
            const r = racers[i];
            const p = r.cfg;

            const t = course.nearestT(r.position.x, r.position.y, r.position.z);
            const d = deltaT(r.lastT, t);
            if (d > 0 && t < r.lastT) r.laps++;
            r.lastT = t;
            r.t = t;
            r.progress = r.laps + t;
            r._up.copy(r.position).normalize();
            sideAt(t, r._side);

            // Lookahead grows with speed so a fast rival plans further ahead.
            const look = (p.lookahead + r.speed * p.lookaheadSpeedK) / length;
            const tl = t + look;
            const k = tableAt(kappa, tl);
            const kb = tableAt(kappaBar, tl);

            // The line (see the header): apex term minus the setup term.
            let lat = CFG.laneAmp * (p.apexInside * k - p.outInOut * (kb - k));

            // Wander: sum of two sines of the race clock. Deterministic under
            // any frame rate, unlike an rng draw per frame.
            const tc = clockMs * 0.001;
            lat += p.wanderAmp * (
                Math.sin(tc * p.wanderRate * r.wanderFA * 6.283 + r.wanderA) * 0.66 +
                Math.sin(tc * p.wanderRate * r.wanderFB * 6.283 + r.wanderB) * 0.34
            );

            // Mistakes.
            if (running && !r.finished) {
                if (r.mistakeT > 0) {
                    r.mistakeT -= dt;
                    if (r.mistakeT <= 0) { r.mistakeT = 0; r.mistakeTumble = 0; }
                } else {
                    r.mistakeIn -= dt;
                    if (r.mistakeIn <= 0) triggerMistake(r);
                }
            }
            if (r.mistakeT > 0) {
                // sin envelope: the error creeps in, peaks, and is caught.
                const env = Math.sin(Math.PI * (1 - r.mistakeT / r.mistakeDur));
                lat += r.mistakeLat * env;
            }

            r.latTarget = clamp(lat, -CFG.laneMax, CFG.laneMax);
            r.avoidPush = 0;
        }

        // Field mean, for the pack-cohesion band. Includes the player when we
        // were given their progress, so the rivals gravitate toward the race
        // rather than toward each other in isolation.
        fieldMean = 0;
        for (let i = 0; i < racers.length; i++) fieldMean += racers[i].progress;
        fieldMean = (fieldMean + pProg) / (racers.length + 1);

        // ---- pass B: mutual avoidance (uses pass A's consistent positions) ---
        for (let i = 0; i < racers.length; i++) {
            const a = racers[i];
            for (let j = i + 1; j < racers.length; j++) {
                const b = racers[j];
                _rel.subVectors(b.position, a.position);
                const dist2 = _rel.lengthSq();
                if (dist2 > CFG.avoidFar * CFG.avoidFar || dist2 < 1e-6) continue;
                const dist = Math.sqrt(dist2);
                const w = clamp((CFG.avoidFar - dist) / (CFG.avoidFar - CFG.avoidNear), 0, 1);
                // Sign of the separation along a's lateral axis. If they are
                // exactly nose-to-tail the sign is arbitrary, so break the tie
                // with the racer index — deterministic, and it means the pair
                // always splits the same way instead of oscillating.
                let s = _rel.dot(a._side);
                if (Math.abs(s) < 0.05) s = (i < j ? -1 : 1) * 0.05;
                const push = CFG.avoidPush * w * w;
                a.avoidPush -= Math.sign(s) * push * a.cfg.avoid;
                b.avoidPush += Math.sign(s) * push * b.cfg.avoid;

                // The aggressive personality steers back INTO a rival it is
                // alongside rather than away, and barges on contact.
                if (a.cfg.bully > 0) a.avoidPush += Math.sign(s) * push * a.cfg.bully * 0.75;
                if (b.cfg.bully > 0) b.avoidPush -= Math.sign(s) * push * b.cfg.bully * 0.75;

                if (dist < CFG.bumpDist) {
                    const bully = Math.max(a.cfg.bully, b.cfg.bully);
                    if (bully > 0) {
                        const hit = (CFG.bumpDist - dist) / CFG.bumpDist;
                        if (a.cfg.bully >= b.cfg.bully) {
                            b.latVel += Math.sign(s) * CFG.bumpShove * hit * dt * 60 * 0.05;
                            b.speedPenalty += CFG.bumpSpeedLoss * hit;
                        } else {
                            a.latVel -= Math.sign(s) * CFG.bumpShove * hit * dt * 60 * 0.05;
                            a.speedPenalty += CFG.bumpSpeedLoss * hit;
                        }
                    }
                }
            }

            if (hasPlayerPos) {
                _rel.subVectors(playerPosition, a.position);
                const dist2 = _rel.lengthSq();
                if (dist2 < CFG.avoidFar * CFG.avoidFar && dist2 > 1e-6) {
                    const dist = Math.sqrt(dist2);
                    const w = clamp((CFG.avoidFar - dist) / (CFG.avoidFar - CFG.avoidNear), 0, 1);
                    let s = _rel.dot(a._side);
                    if (Math.abs(s) < 0.05) s = 0.05;
                    const push = CFG.avoidPush * w * w;
                    // Talon holds his line against the player; the others yield.
                    a.avoidPush -= Math.sign(s) * push * (a.cfg.avoid - a.cfg.bully * 0.8);
                }
            }
        }

        // ---- pass C: steer, integrate, pose, animate ------------------------
        for (let i = 0; i < racers.length; i++) {
            const r = racers[i];
            const p = r.cfg;

            if (raceState) {
                r.finished = raceState.finished[r.raceIndex] === 1;
                r.lap = raceState.lap[r.raceIndex];
            } else {
                r.lap = r.laps + 1;
            }

            // --- lateral spring ---------------------------------------------
            const target = clamp(r.latTarget + r.avoidPush, -CFG.laneMax, CFG.laneMax);
            r.latVel += (target - r.lat) * p.latStiff * dt;
            r.latVel *= Math.exp(-p.latDamp * dt);
            r.lat += r.latVel * dt;
            if (r.lat > CFG.laneMax) { r.lat = CFG.laneMax; if (r.latVel > 0) r.latVel = 0; }
            if (r.lat < -CFG.laneMax) { r.lat = -CFG.laneMax; if (r.latVel < 0) r.latVel = 0; }

            // --- the point we are flying at ----------------------------------
            const look = (p.lookahead + r.speed * p.lookaheadSpeedK) / length;
            const tl = r.t + look;
            course.sampleAt(tl, _tp);
            _tpUp.copy(_tp).normalize();
            course.tangentAt(tl, _tan);
            _side.crossVectors(_tan, _tpUp).normalize();
            r.alt = damp(r.alt, CFG.altAbove + r.altLane, 2.2, dt);
            _tp.addScaledVector(_side, r.lat).addScaledVector(_tpUp, r.alt);

            _des.subVectors(_tp, r.position);
            const dl = _des.length();
            if (dl > 1e-4) _des.multiplyScalar(1 / dl); else _des.copy(r.dir);

            // --- bounded steering --------------------------------------------
            _old.copy(r.dir);
            let dot = r.dir.dot(_des);
            if (dot > 1) dot = 1; else if (dot < -1) dot = -1;
            const ang = Math.acos(dot);
            if (ang > 1e-5) {
                let f = 1 - Math.exp(-p.steerGain * dt);
                const maxStep = p.turnRate * dt;
                if (f * ang > maxStep) f = maxStep / ang;
                r.dir.lerp(_des, f);
                const l = r.dir.length();
                if (l > 1e-6) r.dir.multiplyScalar(1 / l); else r.dir.copy(_old);
            }

            // Signed yaw rate about the radial up -> the animator's `turn`.
            // Positive `turn` means a right-hand turn, which is a NEGATIVE
            // rotation about +up for a -Z-forward model.
            _cross.crossVectors(_old, r.dir);
            const yawRate = -_cross.dot(r._up) / dt;
            r.turnSig = damp(r.turnSig, clamp(yawRate / CFG.turnNorm, -1, 1), 9, dt);
            r.pitchSig = damp(r.pitchSig, clamp(r.dir.dot(r._up) * 2.4, -1, 1), 6, dt);
            r.bank = damp(r.bank, r.turnSig, 7, dt);

            // --- speed --------------------------------------------------------
            let targetSpeed;
            if (!running) {
                targetSpeed = 0;
            } else if (r.finished) {
                targetSpeed = CFG.baseSpeed * 0.55;
            } else {
                // Brake for the WORST curvature between here and brakeLead.
                const lead = p.brakeLead / length;
                const k0 = Math.abs(tableAt(kappa, r.t));
                const k1 = Math.abs(tableAt(kappa, r.t + lead * 0.5));
                const k2 = Math.abs(tableAt(kappa, r.t + lead));
                const kMax = Math.max(k0, Math.max(k1, k2));

                targetSpeed = CFG.baseSpeed * p.speedMul * (1 - p.cornerBrake * kMax);

                // Rubber band. Positive gap = the player is up the road.
                const gap = pProg - r.progress;
                const band = clamp(gap * CFG.rubberGain,
                    -CFG.rubberMaxAhead, CFG.rubberMaxBehind);
                const pack = clamp((fieldMean - r.progress) * CFG.packGain,
                    -CFG.packMax, CFG.packMax);
                targetSpeed *= 1 + band + pack;
                r.boosting = band > CFG.rubberMaxBehind * 0.7 && kMax < 0.25;

                if (r.mistakeT > 0) {
                    const env = Math.sin(Math.PI * (1 - r.mistakeT / r.mistakeDur));
                    targetSpeed *= 1 - (1 - r.mistakeSlow) * env;
                }
                // Scrubbing: a bird a long way off its line is fighting the air.
                if (Math.abs(r.lat) > 6.4) targetSpeed *= 0.94;
                targetSpeed -= r.speedPenalty;
            }
            r.speedPenalty *= Math.exp(-4 * dt);
            targetSpeed = clamp(targetSpeed, running ? CFG.minSpeed * (r.finished ? 0.4 : 1) : 0, CFG.maxSpeed);
            const prevSpeed = r.speed;
            const rate = targetSpeed > r.speed ? p.accel : p.brake;
            const ds = targetSpeed - r.speed;
            const step = rate * dt;
            r.speed += Math.abs(ds) < step ? ds : Math.sign(ds) * step;

            // --- integrate -----------------------------------------------------
            r.position.addScaledVector(r.dir, r.speed * dt);

            // --- hard safety clamps --------------------------------------------
            // These can never fire in normal flight (the lookahead target is on
            // the ribbon, which already clears the floor); they exist so that no
            // combination of mistake + bump + corner can ever put a rival
            // through the ground or into orbit.
            r._up.copy(r.position).normalize();
            const rad = r.position.length();
            const rMin = floorRadius(r._up.x, r._up.y, r._up.z) + CFG.floorClear;
            const rMax = PLANET_RADIUS + CFG.maxAltitude;
            if (rad < rMin) {
                r.position.copy(r._up).multiplyScalar(rMin);
                const down = r.dir.dot(r._up);
                if (down < 0) r.dir.addScaledVector(r._up, -down).normalize();
            } else if (rad > rMax) {
                r.position.copy(r._up).multiplyScalar(rMax);
                const upComp = r.dir.dot(r._up);
                if (upComp > 0) r.dir.addScaledVector(r._up, -upComp).normalize();
            }

            writePose(r);

            // --- race bookkeeping ----------------------------------------------
            if (raceState && autoGates) {
                updateRacerT(raceState, r.raceIndex, r.t);
                const g = raceState.nextGate[r.raceIndex];
                if (g >= 0 && g < course.gateCount && !r.finished) {
                    const o = g * 3;
                    const dx = r.position.x - course.gatePositions[o];
                    const dy = r.position.y - course.gatePositions[o + 1];
                    const dz = r.position.z - course.gatePositions[o + 2];
                    const gr = RACE_CONFIG.gateRadius;
                    if (dx * dx + dy * dy + dz * dz < gr * gr) {
                        recordGate(raceState, r.raceIndex, g, clockMs);
                    }
                }
            }

            // --- animator -------------------------------------------------------
            const s = r.animState;
            s.speed01 = clamp((r.speed - 18) / (CFG.maxSpeed - 18), 0, 1);
            s.turn = r.turnSig;
            s.pitch = r.pitchSig;
            s.boosting = !!r.boosting;
            // A flap is the bird ADDING energy: accelerating, or climbing.
            const accel01 = clamp((r.speed - prevSpeed) / dt / 24, 0, 1);
            // ...and a cadence, because a racing bird that only flaps when it
            // accelerates is a glider with a beak. `flapBeat` sharpens the
            // pulse: a high exponent is a hard, punchy beat with a long glide
            // between, a low one is a continuous rhythmic churn.
            let beat = Math.sin((clockMs * 0.001) * p.flapHz * 6.283 + r.flapPhase * 6.283);
            beat = beat > 0 ? Math.pow(beat, p.flapBeat) * p.flapAmp : 0;
            s.flapImpulse = clamp(
                Math.max(accel01 * 0.9, beat) + clamp(r.pitchSig, 0, 1) * 0.55, 0, 1);
            s.tumbling = r.mistakeTumble > 0 && r.mistakeT > 0;
            s.celebrating = r.finished;
            s.grounded = false;
            r.anim.update(dt, s);
        }
    }

    function dispose() {
        for (let i = 0; i < racers.length; i++) {
            racers[i].anim.dispose();
            racers[i].bird.dispose();
        }
        racers.length = 0;
        if (group.parent) group.parent.remove(group);
    }

    reset();

    // Reported at build time so the probe can print a real budget.
    let triangleCount = 0, drawCallCount = 0;
    for (let i = 0; i < racers.length; i++) {
        triangleCount += racers[i].bird.triangleCount || 0;
        drawCallCount += racers[i].bird.drawCallCount || 0;
    }

    return {
        group,
        racers,
        update,
        reset,
        dispose,

        // --- measured / diagnostic ------------------------------------------
        kappa,
        kappaBar,
        triangleCount,
        drawCallCount,
        length,
    };
}
