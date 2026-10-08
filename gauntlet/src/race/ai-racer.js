/**
 * race/ai-racer.js — Birb Gauntlet's five rivals.
 *
 * Talon, Zephyr and Pip are the original trio (aggressive, clean, erratic).
 * Two more joined them, each with one twist the camera can see:
 *
 *   - CORVUS, the crow ('clever'). Drafts: tucks in behind whoever is just
 *     ahead, charges a slipstream meter, then slingshots out to the side.
 *     And it covets shiny things — the race has no pickups, so it covets the
 *     GATE CENTRES, bending its line (and dropping its altitude) to thread
 *     the dead middle of every ring. A ring threaded close enough is a
 *     "caught shiny": a small, decaying pace nudge. Every crow bonus combined
 *     is capped at `cleverMax`, under the rubber band's 7% and well under
 *     the ~12% a boost is worth. It caws when it overtakes the player.
 *
 *   - TOCK, the clockwork owl ('clockwork'). Runs on a mainspring: the
 *     energy unwinds over `unwindTime` and the pace eases down with it, then
 *     it stalls for `rewindTime` while the key spins back up, then releases a
 *     little above cruise. Fully deterministic — no wander, no mistakes — the
 *     opposite of Pip. Its cycle-average pace is matched to the others (see
 *     `mainspringAverage`), so it is beatable: catch it on a rewind.
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
import { recordGate, updateRacerT, racerProgress, RACE_CONFIG } from './race-logic.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const CFG = Object.freeze({
    /** Pace a rival holds on the ridge straight, world units/sec. The player's
     *  cruise is 34 and their ceiling is 58, so a rival at 36 is beatable by
     *  anyone using the boost and uncatchable by anyone who never turns. */
    // Matched to the player's 20% speed reduction so the race stays even.
    baseSpeed: 29,
    minSpeed: 12,
    maxSpeed: 43,

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
     *  silhouettes rather than one. A bigger field packs its lanes tighter and
     *  lifts the stack, so the lowest bird never sits closer than 1.7 above
     *  the ribbon (see `gridLayout`). */
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

    /** Ceiling on EVERY crow pace bonus combined — slipstream, slingshot and
     *  caught shinies. Under `rubberMaxBehind` (7%) on purpose: the crow's
     *  cleverness may win it a pass, never a drag race against a boost. */
    cleverMax: 0.06,
    /** Lead (laps) the crow must open on the player before it caws, and lose
     *  before it can caw again — hysteresis, so a side-by-side duel near the
     *  same progress cannot machine-gun the sound. */
    cawHysteresis: 0.003,

    /** Angular rate that maps to animator `turn` = 1. Deliberately BELOW the
     *  personalities' max turn rate: a bird that only reaches full bank at its
     *  physical steering limit spends the whole lap looking bolt upright, and
     *  an arcade racer wants the lean to read on an ordinary sweeper. */
    turnNorm: 1.6,
});

/**
 * The five rivals. Every field here changes something you can SEE from the
 * chase camera, not just a number in a log.
 *
 * Shared by all: the line shape, spring, steering, pace and flap fields, plus
 * `species` (which model createBird builds) and `uiColor` (the minimap and
 * results swatch). The twist blocks are capabilities, not name checks:
 * `clever` (drafting + coveting) and `spring` (the mainspring) are null on
 * every personality that does not have them. `altColor` is the tint used when
 * the player flies the same species, so the rival never reads as you.
 */
const PERSONALITIES = Object.freeze([
    {
        key: 'aggressive',
        name: 'Talon',
        species: 'birb',
        color: PALETTE.birdRival1,
        uiColor: PALETTE.birdRival1,
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
        clever: null, spring: null,
    },
    {
        key: 'clean',
        name: 'Zephyr',
        species: 'birb',
        color: PALETTE.birdRival2,
        uiColor: PALETTE.birdRival2,
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
        clever: null, spring: null,
    },
    {
        key: 'erratic',
        name: 'Pip',
        species: 'birb',
        color: PALETTE.birdRival3,
        uiColor: PALETTE.birdRival3,
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
        clever: null, spring: null,
    },
    {
        key: 'clever',
        name: 'Corvus',
        species: 'crow',
        color: PALETTE.birdRival4,
        belly: PALETTE.crowBelly,
        uiColor: PALETTE.birdRival4Ui,
        altColor: PALETTE.birdRival4Alt,
        // A tidy, slightly tight line (it wants to be on someone's tail, not
        // out wide on its own), a fairly settled spring, and a habit of
        // dropping in behind whoever is just ahead. Its base pace is the
        // trio's lowest; the slipstream and the shinies make up the rest.
        speedMul: 1.03,
        cornerBrake: 0.24,
        brakeLead: 12,
        lookahead: 15,
        lookaheadSpeedK: 0.34,
        apexInside: 1.10,
        outInOut: 0.90,
        latStiff: 40, latDamp: 10.8,  // zeta ~ 0.85: commits, barely overshoots
        steerGain: 6.0, turnRate: 2.75,
        accel: 24, brake: 30,
        wanderAmp: 0.30, wanderRate: 0.22,
        flapHz: 0.74, flapAmp: 0.86, flapBeat: 4,
        avoid: 0.55,                  // happy to sit close — that is the point
        bully: 0.1,
        mistakeEvery: [18, 30], mistakeDur: [0.5, 0.9],
        mistakeLat: 3.4, mistakeSlow: 0.88, mistakeTumble: 0.0,
        clever: {
            // Slipstream: a target counts if it is 1.5..draftRange units
            // ahead, within draftLat*2.4 sideways and within draftUp above or
            // below (about two altitude lanes: a wake is a tube behind a bird,
            // not a slab through the planet); the crow tucks toward it, and
            // while within draftLat it charges a meter. It tucks in
            // at a GAP: inside draftGap (clear of the bump range) it stops
            // pulling in and pops the slingshot early, rather than flying
            // into the tail it is drafting and eating a shove.
            draftRange: 16, draftGap: 6.0, draftLat: 3.2, draftUp: 4.0, draftPull: 0.9, draftCharge: 0.75,
            draftBonus: 0.025,
            // Full meter -> slingshot: swing out sideways and kick on.
            slingTime: 1.3, slingLat: 3.6, slingBonus: 0.05,
            // Coveting: within covetRange of a gate, blend the line toward the
            // ring's centre and drop toward covetAlt (just above the ribbon).
            covetRange: 34, covetPull: 0.75, covetAlt: 1.6, covetAltPull: 0.8,
            // A ring threaded within shinyCatch of its centre is caught.
            shinyCatch: 3.0, shinyGain: 0.03, shinyMax: 0.035, shinyDecay: 0.5,
        },
        spring: null,
    },
    {
        key: 'clockwork',
        name: 'Tock',
        species: 'clockwork-owl',
        color: PALETTE.birdRival5,
        uiColor: PALETTE.birdRival5Ui,
        altColor: PALETTE.birdRival5Alt,
        // Metronomic: the textbook line, a critically damped spring, zero
        // wander and no mistakes at all. Everything interesting it does comes
        // from the mainspring. speedMul is high because the spring's cycle
        // average is ~0.963 (mainspringAverage), which lands its real pace at
        // ~1.04 — level with the others.
        speedMul: 1.08,
        cornerBrake: 0.25,
        brakeLead: 14,
        lookahead: 16,
        lookaheadSpeedK: 0.36,
        apexInside: 1.00,
        outInOut: 1.00,
        latStiff: 50, latDamp: 14.1,  // zeta = 1.0: never overshoots
        steerGain: 5.6, turnRate: 2.6,
        accel: 22, brake: 30,
        wanderAmp: 0.0, wanderRate: 0.1,
        flapHz: 1.25, flapAmp: 0.80, flapBeat: 2,
        avoid: 0.9,
        bully: 0,
        mistakeEvery: null, mistakeDur: [0, 0],
        mistakeLat: 0, mistakeSlow: 1, mistakeTumble: 0.0,
        clever: null,
        spring: {
            unwindTime: 8.0,     // s from fully wound to run down
            rewindTime: 1.0,     // s stalled while the key winds it back
            paceTop: 1.07,       // just released: a little above cruise
            paceFloor: 0.84,     // nearly run down
            rewindPace: 0.72,    // stalled
            keyUnwind: 1.4,      // rad/s the key turns as the spring lets go
            keyRewind: 26,       // rad/s it spins (backwards) while winding
        },
    },
]);

/** How many rivals a full race fields: every personality, once. */
export const RIVAL_COUNT = PERSONALITIES.length;

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

// ---------------------------------------------------------------------------
// Pure twist maths. No THREE, no allocation: exported so the rules can be
// unit-tested without a course or a renderer.
// ---------------------------------------------------------------------------

/** Mainspring phases. */
export const SPRING_UNWIND = 0;
export const SPRING_REWIND = 1;

/** A mainspring state. Build-time only; step it in place every frame. */
export function createMainspring() {
    return { energy: 1, phase: SPRING_UNWIND, phaseT: 0, pace: 1, keyRate: 0, cycles: 0, released: false };
}

export function resetMainspring(m) {
    m.energy = 1; m.phase = SPRING_UNWIND; m.phaseT = 0;
    m.pace = 1; m.keyRate = 0; m.cycles = 0; m.released = false;
    return m;
}

/**
 * Pace multiplier for a spring state. While unwinding it eases down with the
 * square of how far the spring has run, so most of the run sits near cruise
 * and the slow-down arrives late, the way a wind-up toy dies; while rewinding
 * it is the flat stall pace.
 */
export function mainspringPace(m, sp) {
    if (m.phase === SPRING_REWIND) return sp.rewindPace;
    const low = 1 - m.energy;
    return sp.paceFloor + (sp.paceTop - sp.paceFloor) * (1 - low * low);
}

/**
 * Advance the spring by `dt`. Unwind -> rewind -> release -> unwind, forever.
 * Overshoot past a phase boundary is carried into the next phase, so the
 * cycle period is exact under any frame rate. Writes `pace`, `keyRate`
 * (rad/s, negative while winding back) and `released` (true only on the step
 * the rewind completes). Returns the pace.
 */
export function stepMainspring(m, sp, dt) {
    m.released = false;
    if (!(dt > 0)) return m.pace;
    if (m.phase === SPRING_UNWIND) {
        m.energy -= dt / sp.unwindTime;
        if (m.energy <= 0) {
            m.phaseT = -m.energy * sp.unwindTime;
            m.energy = 0;
            m.phase = SPRING_REWIND;
        }
    } else {
        m.phaseT += dt;
        m.energy = m.phaseT >= sp.rewindTime ? 1 : m.phaseT / sp.rewindTime;
    }
    if (m.phase === SPRING_REWIND && m.phaseT >= sp.rewindTime) {
        m.energy = 1 - (m.phaseT - sp.rewindTime) / sp.unwindTime;
        m.phase = SPRING_UNWIND;
        m.phaseT = 0;
        m.cycles++;
        m.released = true;
    }
    m.pace = mainspringPace(m, sp);
    m.keyRate = m.phase === SPRING_UNWIND ? sp.keyUnwind : -sp.keyRewind;
    return m.pace;
}

/** Closed-form cycle-average pace (the tests check it against stepping). */
export function mainspringAverage(sp) {
    const unwindMean = sp.paceFloor + (sp.paceTop - sp.paceFloor) * (2 / 3);
    return (sp.unwindTime * unwindMean + sp.rewindTime * sp.rewindPace) / (sp.unwindTime + sp.rewindTime);
}

/**
 * The crow's caught-shiny nudge: decays exponentially, a catch adds
 * `shinyGain`, and it can never exceed `shinyMax` however many rings are
 * threaded back to back.
 */
export function stepShinyNudge(nudge, caught, dt, cl) {
    let n = nudge * Math.exp(-cl.shinyDecay * (dt > 0 ? dt : 0));
    if (caught) n += cl.shinyGain;
    return n > cl.shinyMax ? cl.shinyMax : (n > 0 ? n : 0);
}

/** Every crow pace bonus combined, hard-capped at CFG.cleverMax. */
export function cleverBonus(drafting, slingEnv, shiny, cl) {
    const b = (drafting ? cl.draftBonus : 0) + slingEnv * cl.slingBonus + shiny;
    return clamp(b, 0, CFG.cleverMax);
}

/**
 * Seam-safe race distance for overtake detection: gates filed plus where the
 * racer actually is relative to the last gate it filed — NEGATIVE while it is
 * still short of that gate's centre. race-logic's own sub-gate fraction holds
 * a full gate span in that window (a gate is filed 11 units before its
 * centre), so comparing two racers on racerProgress reads one of them a whole
 * gate ahead for a moment, which is a phantom overtake. Finishers report the
 * full distance.
 */
export function fineProgress(state, racerIndex, t) {
    if (state.finished[racerIndex]) return state.laps;
    const n = state.gateCount;
    const lastGate = (state.nextGate[racerIndex] - 1 + n) % n;
    let fwd = t - lastGate / n;
    fwd -= Math.floor(fwd);
    if (fwd > 0.5) fwd -= 1;
    return state.gatesPassed[racerIndex] / n + fwd;
}

/**
 * Grid slot `i` of `n`: lateral offset, lap-t behind the line, vertical lane.
 * Three racers get exactly the original layout. A bigger field narrows the
 * lateral spacing to stay inside the lane, staggers further back so wings do
 * not overlap, and packs the vertical lanes tighter while lifting the stack
 * so the lowest bird stays 1.7 clear of the ribbon. Writes into `out`.
 */
export function gridLayout(i, n, out) {
    const big = n > 3;
    const half = (n - 1) * 0.5;
    const gap = big ? Math.min(4.4, 13.2 / (n - 1)) : 4.4;
    const step = big ? CFG.altLane * Math.sqrt(2 / (n - 1)) : CFG.altLane;
    out.lat = (i - half) * gap;
    out.t = -0.0022 * (big ? 1.5 : 1) * i - 0.0018;
    out.altLane = (i - half) * step + Math.max(0, half * step - CFG.altLane);
    return out;
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
 * @param {number}   [opts.count=RIVAL_COUNT]  rivals to field, in PERSONALITIES order
 * @param {string}   [opts.playerSpecies]  the player's species; a rival of the
 *                                         same species is built in its altColor
 * @param {string}   [opts.quality='high']
 * @param {number}   [opts.seed=20260801]
 * @param {Function} [opts.createBirdFn]  defaults to bird-model.js's createBird
 * @param {number}   [opts.birdScale=2.0]
 * @param {number}   [opts.firstRacerIndex=1]  index of racer 0 in the race state
 *                                             (the player is normally index 0)
 * @param {number}   [opts.playerIndex=0]      the player's index in the race state
 * @param {boolean}  [opts.autoGates=true]     let the AI file its own gate
 *                                             crossings into the race state
 */
export function createAIRacers(THREE, opts = {}) {
    const course = opts.course;
    if (!course) throw new Error('createAIRacers: opts.course is required');

    const count = Math.max(0, Math.min(PERSONALITIES.length, opts.count ?? RIVAL_COUNT)) | 0;
    const playerSpecies = opts.playerSpecies || null;
    const quality = opts.quality || 'high';
    const seed = (opts.seed ?? 20260801) >>> 0;
    const createBirdFn = opts.createBirdFn || defaultCreateBird;
    const birdScale = opts.birdScale ?? 2.0;
    const firstRacerIndex = opts.firstRacerIndex ?? 1;
    /** The player's index in the race state (the crow's overtake check). */
    const playerIndex = opts.playerIndex ?? 0;
    const autoGates = opts.autoGates !== false;

    const length = course.length || 640;
    const group = new THREE.Group();
    group.name = 'gauntlet-ai-racers';

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
    const _grid = { lat: 0, t: 0, altLane: 0 };

    // ---- the racers ---------------------------------------------------------
    const cream = new THREE.Color(PALETTE.uiCream);
    const colScratch = new THREE.Color();

    const racers = [];
    for (let i = 0; i < count; i++) {
        const p = PERSONALITIES[i % PERSONALITIES.length];
        // Same species as the player -> the alternate tint, so two crows (or
        // two owls) on screen can never be confused. Colour is the clash
        // handling; the silhouette is the same by design.
        const clash = !!playerSpecies && p.species === playerSpecies && p.altColor !== undefined;
        const bodyColor = clash ? p.altColor : p.color;
        const bellyColor = (!clash && p.belly !== undefined)
            ? p.belly : bellyOf(THREE, bodyColor, colScratch, cream);
        const uiColor = clash ? p.altColor : (p.uiColor !== undefined ? p.uiColor : p.color);
        const bird = createBirdFn(THREE, {
            bodyColor,
            bellyColor,
            scale: birdScale,
            quality,
            outline: true,
            species: p.species,
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
            color: bodyColor,
            uiColor,
            altTint: clash,
            species: p.species,
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
            // --- clever (crow) ---------------------------------------------
            covet: 0,             // 0..1, how hard it is bending toward a ring
            covetGate: -1,
            drafting: false,
            draft01: 0,           // slipstream meter
            slingT: 0,
            slingSide: 0,
            slingEnv: 0,
            altBias: 0,
            shiny: 0,             // current caught-shiny nudge
            shinyCaught: 0,       // rings threaded this race (diagnostic)
            caughtKey: -1,
            cleverBonus: 0,
            aheadOfPlayer: false,
            /** True on the single frame the crow takes the lead off the player. */
            cawEvent: false,
            // --- clockwork (owl) -----------------------------------------
            mainspring: createMainspring(),
            // The animator's caller-owned state object. Allocated ONCE.
            animState: {
                speed01: 0, turn: 0, pitch: 0, boosting: false, flapImpulse: 0,
                tumbling: false, grounded: false, celebrating: false,
                phase: (i * 0.37) % 1,
                keySpin: 0, rewinding: false,
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
        // No schedule = no mistakes, ever (the clockwork owl). Infinity minus
        // dt stays Infinity, so the trigger below can never fire.
        if (!e) { r.mistakeIn = Infinity; return; }
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
            gridLayout(i, racers.length, _grid);
            r.gridLat = _grid.lat;
            r.gridT = _grid.t;
            r.altLane = _grid.altLane;

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

            r.covet = 0; r.covetGate = -1;
            r.drafting = false; r.draft01 = 0;
            r.slingT = 0; r.slingSide = 0; r.slingEnv = 0; r.altBias = 0;
            r.shiny = 0; r.shinyCaught = 0; r.caughtKey = -1; r.cleverBonus = 0;
            r.aheadOfPlayer = false; r.cawEvent = false;
            resetMainspring(r.mainspring);

            writePose(r);

            const s = r.animState;
            s.speed01 = 0; s.turn = 0; s.pitch = 0; s.boosting = false;
            s.flapImpulse = 0; s.tumbling = false; s.grounded = false;
            s.celebrating = false; s.keySpin = 0; s.rewinding = false;
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
     * @param {THREE.Vector3} [draftTarget]    optional player position used ONLY
     *                                         so the crow can draft the player;
     *                                         it does not switch on avoidance
     */
    function update(dt, playerProgress, raceState, playerPosition, draftTarget) {
        if (!(dt > 0)) return;
        if (dt > 0.05) dt = 0.05;
        for (let i = 0; i < racers.length; i++) racers[i].cawEvent = false;

        let fieldMean = 0;
        const running = raceState ? !!raceState.running : true;
        if (running) {
            if (!raceRunning && raceState) clockMs = raceState.startMs;
            raceRunning = true;
            clockMs += dt * 1000;
        }
        const hasPlayerProg = typeof playerProgress === 'number';
        const pProg = hasPlayerProg ? playerProgress : 0;
        const hasPlayerPos = !!(playerPosition && playerPosition.isVector3);
        const draftPos = (draftTarget && draftTarget.isVector3) ? draftTarget
            : (hasPlayerPos ? playerPosition : null);

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

            // Coveting (the crow). The race has no pickups, so the shiny
            // things are the rings themselves: approaching the next gate, the
            // line bends toward its centre — which sits ON the centreline, so
            // the target lateral is 0 — harder the closer it gets. The gate is
            // found by spline position, not raceState.nextGate, because a gate
            // is filed 11 units out and the crow wants the centre, not the
            // edge of the counting radius.
            const cl = p.clever;
            r.covet = 0;
            r.covetGate = -1;
            if (cl && course.gateT && course.gateCount > 0) {
                let g = -1, ahead = 2;
                for (let k = 0; k < course.gateCount; k++) {
                    let a = course.gateT[k] - t;
                    a -= Math.floor(a);
                    if (a < ahead) { ahead = a; g = k; }
                }
                const dist = ahead * length;
                if (g >= 0 && dist < cl.covetRange) {
                    let w = 1 - dist / cl.covetRange;
                    w = w * w * (3 - 2 * w);
                    r.covet = w;
                    r.covetGate = g;
                    lat -= lat * w * cl.covetPull;
                }
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

        // ---- pass B2: drafting (the crow) -----------------------------------
        // Runs after avoidance so the tuck-in can override it: the crow WANTS
        // to sit on a tail. The target is the nearest racer (or the player,
        // when we were told where they are) that is properly ahead and close
        // to the crow's own line. Tucked inside `draftLat`, the slipstream
        // meter charges; full, the crow slingshots out sideways and kicks on.
        for (let i = 0; i < racers.length; i++) {
            const r = racers[i];
            const cl = r.cfg.clever;
            r.drafting = false;
            r.altBias = 0;
            if (!cl) continue;
            if (!running || r.finished) {
                r.draft01 = 0; r.slingT = 0; r.slingEnv = 0;
                continue;
            }

            // The wake is bounded on all three axes. Forward and sideways alone
            // are tangent-plane projections: a bird far overhead, or one on the
            // far side of the planet, can project inside them. So the radial
            // separation is checked too, and the straight-line distance is
            // capped as a backstop for when `dir` is not perpendicular to up.
            let found = false, best = cl.draftRange, bestLat = 0, bestUp = 0;
            const latMax = cl.draftLat * 2.4;
            const reach2 = cl.draftRange * cl.draftRange + latMax * latMax + cl.draftUp * cl.draftUp;
            const n = racers.length + (draftPos ? 1 : 0);
            for (let j = 0; j < n; j++) {
                if (j === i) continue;
                const o = j < racers.length ? racers[j].position : draftPos;
                _rel.subVectors(o, r.position);
                if (_rel.lengthSq() > reach2) continue;
                const ahead = _rel.dot(r.dir);
                if (ahead < 1.5 || ahead > best) continue;
                const side = _rel.dot(r._side);
                if (Math.abs(side) > latMax) continue;
                const up = _rel.dot(r._up);
                if (Math.abs(up) > cl.draftUp) continue;
                found = true; best = ahead; bestLat = side; bestUp = up;
            }

            if (r.slingT > 0) {
                // Slingshot: a sin envelope out and back, pace kick riding it.
                r.slingT -= dt;
                if (r.slingT <= 0) { r.slingT = 0; r.slingEnv = 0; } else {
                    r.slingEnv = Math.sin(Math.PI * (1 - r.slingT / cl.slingTime));
                    r.avoidPush += r.slingSide * cl.slingLat * r.slingEnv;
                }
            } else if (found && best < cl.draftGap) {
                // Too close to keep tucking in. With some slipstream banked,
                // that is the moment to pull out; otherwise just stop pulling
                // in and let mutual avoidance open the gap again.
                if (r.draft01 >= 0.3) {
                    r.draft01 = 0;
                    r.slingT = cl.slingTime;
                    r.slingSide = r.lat > 0 ? -1 : 1;
                }
            } else if (found) {
                r.avoidPush += bestLat * cl.draftPull;
                r.altBias = clamp(bestUp, -3, 3) * 0.8;
                if (Math.abs(bestLat) < cl.draftLat) {
                    r.drafting = true;
                    r.draft01 += cl.draftCharge * dt;
                    if (r.draft01 >= 1) {
                        r.draft01 = 0;
                        r.slingT = cl.slingTime;
                        // Pull out toward the middle of the corridor, never
                        // into the wall of the lane it is already near.
                        r.slingSide = r.lat > 0 ? -1 : 1;
                    }
                }
            } else {
                r.draft01 = Math.max(0, r.draft01 - dt * 0.5);
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
            // The crow leaves its altitude lane twice: dropping toward a ring
            // it covets, and matching the height of a tail it is drafting.
            let altGoal = CFG.altAbove + r.altLane;
            let altRate = 2.2;
            if (p.clever) {
                altGoal += (p.clever.covetAlt - altGoal) * r.covet * p.clever.covetAltPull;
                altGoal += r.altBias;
                altRate += 3 * r.covet;
            }
            r.alt = damp(r.alt, altGoal, altRate, dt);
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
                // The crow's cleverness, capped as a whole (see cleverBonus).
                const clever = p.clever ? cleverBonus(r.drafting, r.slingEnv, r.shiny, p.clever) : 0;
                r.cleverBonus = clever;
                targetSpeed *= 1 + band + pack + clever;
                r.boosting = band > CFG.rubberMaxBehind * 0.7 && kMax < 0.25;

                // The owl's mainspring. Only runs while racing, so every owl
                // leaves the grid fully wound and the cycle is the same race
                // to race.
                if (p.spring) targetSpeed *= stepMainspring(r.mainspring, p.spring, dt);

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

            // --- the crow: shinies and the caw -----------------------------------
            if (p.clever) {
                let caught = false;
                if (running && !r.finished && r.covetGate >= 0) {
                    const o = r.covetGate * 3;
                    const dx = r.position.x - course.gatePositions[o];
                    const dy = r.position.y - course.gatePositions[o + 1];
                    const dz = r.position.z - course.gatePositions[o + 2];
                    const rr = p.clever.shinyCatch;
                    if (dx * dx + dy * dy + dz * dz < rr * rr) {
                        // One catch per ring per lap. Rounding progress to the
                        // nearest gate gives the same key either side of the
                        // centre, even across the lap seam at gate 0.
                        const key = Math.round(r.progress * course.gateCount);
                        if (key !== r.caughtKey) { r.caughtKey = key; caught = true; r.shinyCaught++; }
                    }
                }
                r.shiny = stepShinyNudge(r.shiny, caught, dt, p.clever);

                // Caw on taking the lead off the player, with hysteresis. With
                // a race state and the player's position, both birds are
                // measured on fineProgress (seam-safe, no phantom gate jumps);
                // otherwise on the progress figures we were handed.
                if (running && !r.finished && hasPlayerProg) {
                    let lead;
                    if (raceState && draftPos) {
                        const pt = course.nearestT(draftPos.x, draftPos.y, draftPos.z);
                        lead = fineProgress(raceState, r.raceIndex, r.t) - fineProgress(raceState, playerIndex, pt);
                    } else {
                        lead = (raceState ? racerProgress(raceState, r.raceIndex) : r.progress) - pProg;
                    }
                    if (!r.aheadOfPlayer && lead > CFG.cawHysteresis) {
                        r.aheadOfPlayer = true;
                        r.cawEvent = true;
                    } else if (r.aheadOfPlayer && lead < -CFG.cawHysteresis) {
                        r.aheadOfPlayer = false;
                    }
                }
            }

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
            // The owl: the key follows the spring, and a rewind cuts the beat.
            if (p.spring) {
                const m = r.mainspring;
                s.rewinding = running && !r.finished && m.phase === SPRING_REWIND;
                s.keySpin = m.keyRate;
                if (s.rewinding) s.flapImpulse = 0;
            }
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

// Read-only views for the unit tests and the integrator (both are frozen).
export { PERSONALITIES, CFG as AI_CONFIG };
