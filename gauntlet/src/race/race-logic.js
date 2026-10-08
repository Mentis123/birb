/**
 * race/race-logic.js — Birb Gauntlet's race rules. PURE.
 *
 * No THREE, no DOM, no imports. Everything here is arithmetic over typed
 * arrays so it can be unit-tested under `node --test` with zero dependencies
 * and called every frame without allocating.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL
 * ---------------------------------------------------------------------------
 * The circuit is a closed spline parameterised by `t` in [0,1). `gateCount`
 * gates sit at t = i/gateCount, so gate 0 IS the start/finish line and gate
 * spacing in t is uniform. That single choice is what lets this module compute
 * sub-gate progress without knowing any geometry.
 *
 * Racers line up ON (or a touch behind) the start/finish line, so the first
 * gate they must pass is gate 1, and passing gate 0 again is what completes a
 * lap. A gate is passed when the racer crosses its plane (see passGate).
 * Hence:
 *
 *     nextGate starts at 1     lap starts at 1
 *     recordGate(..., 0)  ->   lap split recorded, lap++, maybe finish
 *
 * ---------------------------------------------------------------------------
 * THE WRONG-WAY SEAM — the classic bug this module exists to not have
 * ---------------------------------------------------------------------------
 * A racer at t = 0.99 moving to t = 0.01 has gone FORWARD by 0.02, not
 * backward by 0.98. Every delta is therefore wrapped into (-0.5, 0.5] before
 * it is judged. Backwards travel is then integrated (with decay and
 * hysteresis) rather than tripped on a single frame, because one noisy sample
 * on a fast bird must not flash "WRONG WAY" across the HUD.
 *
 * Deltas larger than `wrongWayJumpT` are treated as a teleport (respawn,
 * knockdown recovery, debug jump) and ignored entirely.
 */

/** The frame loop's dt cap, seconds: index.html clamps every frame to it and
 *  ai-racer clamps its own update to it, so no racer ever steps further than
 *  its speed times this. */
const MAX_DT = 0.05;
/** At or above anything that races: the player's boost ceiling is 54, a
 *  rival's 43. */
const MAX_RACER_SPEED = 58;

/** Tunables. Times in ms, gate radius in world units, thresholds in lap-t. */
export const RACE_CONFIG = Object.freeze({
    laps: 3,
    racerCount: 6,          // the player + ai-racer.js's five rivals
    gateCount: 12,

    countdownMs: 3200,
    countdownBeeps: 3,

    /** How close (world units) the bird must be to a gate centre, at the gate
     *  plane, to count it. The visible ring is radius 9. */
    gateRadius: 11,

    maxDt: MAX_DT,
    maxRacerSpeed: MAX_RACER_SPEED,
    /** World distance a racer may move in one step and still be judged to
     *  have flown through a gate plane: 4x the 2.9 units a capped step can
     *  cover, and short of the 22-unit counting diameter, so no single step
     *  can jump a ring. A longer step is a warp, not a crossing. */
    gateCrossMaxStep: MAX_RACER_SPEED * MAX_DT * 4,
    /** The same bound in lap-t (a step can be short in the world and long in
     *  t where the circuit passes close to itself): ~13 units on the ~640-unit
     *  lap. The longest legal step in t is a capped one on the inside of the
     *  hairpin, 7.6 off-line, where t runs ~1.5x fast: under 0.007. */
    gateCrossMaxT: 0.02,

    /** Backwards lap-fraction that must accumulate before WRONG WAY shows. */
    wrongWayEnterT: 0.012,
    /** ...and the (lower) level it must fall back to before it clears. */
    wrongWayExitT: 0.004,
    /** Forward travel bleeds the accumulator off this many times as fast. */
    wrongWayDecay: 2.5,
    /** |dt| above this is a teleport, not motion. Never judged. */
    wrongWayJumpT: 0.2,

    /** Progress epsilon used to break exact standings ties deterministically. */
    tieEpsilon: 1e-9,
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Wrap any t into [0,1). */
export function wrapT(t) {
    if (!Number.isFinite(t)) return 0;
    const w = t - Math.floor(t);
    return w === 1 ? 0 : w;
}

/**
 * Signed shortest lap-delta from `a` to `b`, in (-0.5, 0.5].
 * This is the seam-safe primitive the whole module is built on.
 */
export function deltaT(a, b) {
    let d = wrapT(b) - wrapT(a);
    if (d > 0.5) d -= 1;
    else if (d <= -0.5) d += 1;
    return d;
}

/** Forward-only distance from `a` to `b` around the lap, in [0,1). */
export function forwardT(a, b) {
    const d = wrapT(b) - wrapT(a);
    return d < 0 ? d + 1 : d;
}

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

/** "1:23.45". Non-finite / negative input renders as a placeholder. */
export function formatTime(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '--:--.--';
    const total = Math.floor(ms);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor(total / 1000) % 60;
    const centis = Math.floor((total % 1000) / 10);
    return minutes + ':' + pad2(seconds) + '.' + pad2(centis);
}

/** "+1.24" / "-0.31" / "--" — a delta against a rival or a personal best. */
export function formatDelta(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--';
    const sign = ms >= 0 ? '+' : '-';
    const abs = Math.abs(ms) / 1000;
    return sign + abs.toFixed(2);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Allocate a race state. Called once per race — everything after this point
 * writes into these arrays in place.
 */
export function createRaceState(opts = {}) {
    const laps = Math.max(1, opts.laps ?? RACE_CONFIG.laps) | 0;
    const gateCount = Math.max(1, opts.gateCount ?? RACE_CONFIG.gateCount) | 0;
    const racerCount = Math.max(1, opts.racerCount ?? RACE_CONFIG.racerCount) | 0;

    const state = {
        laps,
        gateCount,
        racerCount,

        /** Wall-clock ms the green light dropped. */
        startMs: 0,
        /** false until startRace() — recordGate is a no-op before that. */
        running: false,

        // --- per racer -------------------------------------------------------
        nextGate: new Int32Array(racerCount),
        lap: new Int32Array(racerCount),          // 1-based, clamped to `laps`
        gatesPassed: new Int32Array(racerCount),  // total, monotonic
        finished: new Uint8Array(racerCount),
        finishMs: new Float64Array(racerCount),   // elapsed, -1 while running
        lapStartMs: new Float64Array(racerCount),
        lapTimes: new Float64Array(racerCount * laps), // -1 = not set

        lastT: new Float64Array(racerCount),
        hasT: new Uint8Array(racerCount),
        subT: new Float64Array(racerCount),       // [0, 1/gateCount)
        wrongAccum: new Float64Array(racerCount),
        wrongWay: new Uint8Array(racerCount),

        // --- passGate's memory: the previous sample of each racer ------------
        crossT: new Float64Array(racerCount),
        crossX: new Float64Array(racerCount),
        crossY: new Float64Array(racerCount),
        crossZ: new Float64Array(racerCount),
        crossHas: new Uint8Array(racerCount),

        // --- standings -------------------------------------------------------
        progress: new Float64Array(racerCount),   // laps completed + fraction
        order: new Int32Array(racerCount),        // racer indices, best first
        place: new Int32Array(racerCount),        // 1-based finishing position
        finishOrder: new Int32Array(racerCount),  // racers in the order they finished
        finishedCount: 0,
    };

    resetRaceState(state);
    return state;
}

/** Return a state to the grid without reallocating anything. */
export function resetRaceState(state) {
    const n = state.racerCount;
    const firstGate = state.gateCount > 1 ? 1 : 0;
    for (let i = 0; i < n; i++) {
        state.nextGate[i] = firstGate;
        state.lap[i] = 1;
        state.gatesPassed[i] = 0;
        state.finished[i] = 0;
        state.finishMs[i] = -1;
        state.lapStartMs[i] = 0;
        state.lastT[i] = 0;
        state.hasT[i] = 0;
        state.subT[i] = 0;
        state.wrongAccum[i] = 0;
        state.wrongWay[i] = 0;
        state.crossT[i] = 0;
        state.crossX[i] = 0;
        state.crossY[i] = 0;
        state.crossZ[i] = 0;
        state.crossHas[i] = 0;
        state.progress[i] = 0;
        state.order[i] = i;
        state.place[i] = i + 1;
        state.finishOrder[i] = -1;
    }
    for (let i = 0; i < state.lapTimes.length; i++) state.lapTimes[i] = -1;
    state.finishedCount = 0;
    state.startMs = 0;
    state.running = false;
    return state;
}

/** Drop the green light. Every split is measured from here. */
export function startRace(state, nowMs) {
    state.startMs = nowMs;
    state.running = true;
    for (let i = 0; i < state.racerCount; i++) state.lapStartMs[i] = nowMs;
    return state;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * Register that `racerIndex` flew through `gateIndex`.
 *
 * Returns true only if it COUNTED — i.e. it was the gate that racer was
 * actually due to pass. Skipping a gate, re-triggering the one you just
 * cleared, or clipping a gate from a neighbouring part of the circuit all
 * return false and change nothing. That is what makes the ribbon the only
 * legal line.
 */
export function recordGate(state, racerIndex, gateIndex, nowMs) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return false;
    if (!state.running) return false;
    if (state.finished[racerIndex]) return false;
    if (gateIndex !== state.nextGate[racerIndex]) return false;

    state.gatesPassed[racerIndex]++;
    state.nextGate[racerIndex] = (gateIndex + 1) % state.gateCount;
    // Sub-gate progress resets to the gate we just crossed.
    state.subT[racerIndex] = 0;

    // Gate 0 is the start/finish line: crossing it closes a lap.
    if (gateIndex === 0) {
        const lap = state.lap[racerIndex];
        const split = nowMs - state.lapStartMs[racerIndex];
        if (lap >= 1 && lap <= state.laps) {
            state.lapTimes[racerIndex * state.laps + (lap - 1)] = split;
        }
        state.lapStartMs[racerIndex] = nowMs;

        if (lap >= state.laps) {
            state.finished[racerIndex] = 1;
            state.finishMs[racerIndex] = nowMs - state.startMs;
            state.wrongWay[racerIndex] = 0;
            state.wrongAccum[racerIndex] = 0;
            state.finishOrder[state.finishedCount] = racerIndex;
            state.finishedCount++;
            state.lap[racerIndex] = state.laps; // clamp for display
        } else {
            state.lap[racerIndex] = lap + 1;
        }
    }
    return true;
}

/**
 * THE gate rule — the player (index.html) and the rivals (ai-racer.js) both
 * call this, so they cannot disagree about what "through a gate" means. Call
 * it once per frame per racer with its course `t` and world position.
 *
 * A gate counts on the frame the racer's t reaches or passes the gate's t
 * (gate g sits at t = g/gateCount), if the point where its path crosses the
 * plane is inside `gateRadius` of the gate centre. That point is interpolated
 * between this sample and the last one, at the fraction of the step in t
 * that reached the plane, so a ring threaded 10.99 out between two samples
 * 11.1 out counts and one entered from inside but crossed 11.8 out does not.
 * The step must be forward and a step, not a warp: no more than
 * `gateCrossMaxT` in t and `gateCrossMaxStep` in the world.
 *
 * It used to count anywhere inside the radius, up to 11 units SHORT of the
 * plane, which read the racer a whole gate ahead until it crossed the plane
 * and then took the gate back off it.
 *
 * The first call after a reset only records the sample; seedGateCrossing
 * records one without a step, for the grid and after a warp. Only `nextGate`
 * is ever tested and recordGate does the filing, so skipping a ring still
 * counts for nothing. Returns the gate that counted, or -1.
 */
export function passGate(state, racerIndex, t, x, y, z, gatePositions, nowMs) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return -1;
    const tw = wrapT(t);
    const had = state.crossHas[racerIndex] === 1;
    const prevT = state.crossT[racerIndex];
    const px = state.crossX[racerIndex], py = state.crossY[racerIndex], pz = state.crossZ[racerIndex];
    writeCrossing(state, racerIndex, tw, x, y, z);
    if (!had) return -1;

    // Forward, and a step rather than a warp.
    const step = deltaT(prevT, tw);
    if (!(step > 0) || step > RACE_CONFIG.gateCrossMaxT) return -1;
    const sx = x - px, sy = y - py, sz = z - pz;
    const maxStep = RACE_CONFIG.gateCrossMaxStep;
    if (sx * sx + sy * sy + sz * sz > maxStep * maxStep) return -1;

    // The plane lies in (prevT, tw]: the racer reached or passed it this step.
    const g = state.nextGate[racerIndex];
    const toPlane = forwardT(prevT, g / state.gateCount);
    if (!(toPlane > 0 && toPlane <= step)) return -1;

    // Where the path crosses it.
    const o = g * 3;
    if (!gatePositions || gatePositions.length < o + 3) return -1;
    const a = toPlane / step;
    const dx = px + sx * a - gatePositions[o];
    const dy = py + sy * a - gatePositions[o + 1];
    const dz = pz + sz * a - gatePositions[o + 2];
    const r = RACE_CONFIG.gateRadius;
    if (dx * dx + dy * dy + dz * dz > r * r) return -1;

    return recordGate(state, racerIndex, g, nowMs) ? g : -1;
}

function writeCrossing(state, racerIndex, tw, x, y, z) {
    state.crossHas[racerIndex] = 1;
    state.crossT[racerIndex] = tw;
    state.crossX[racerIndex] = x;
    state.crossY[racerIndex] = y;
    state.crossZ[racerIndex] = z;
}

/**
 * Start a racer's sample history at (t, x, y, z) without judging a step: the
 * next passGate and updateRacerT measure from here. Call it wherever a racer
 * is PLACED rather than flown — on the grid at the green light, after a
 * respawn or a warp — so the first real step from there can count a gate, and
 * the jump to there can neither count one nor read as wrong-way travel.
 * Changes nothing else: no gate, no wrong-way accumulation, no lap.
 */
export function seedGateCrossing(state, racerIndex, t, x, y, z) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return;
    const tw = wrapT(t);
    writeCrossing(state, racerIndex, tw, x, y, z);
    state.hasT[racerIndex] = 1;
    state.lastT[racerIndex] = tw;
    state.subT[racerIndex] = subGateFraction(state, racerIndex, tw);
}

/** Total race time so far (or final time once finished). */
export function elapsedMs(state, nowMs) {
    if (!state.running) return 0;
    return nowMs - state.startMs;
}

/** Lap split in ms for a 1-based lap number, or null if not set yet. */
export function lapSplit(state, racerIndex, lap) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return null;
    if (lap < 1 || lap > state.laps) return null;
    const v = state.lapTimes[racerIndex * state.laps + (lap - 1)];
    return v < 0 ? null : v;
}

/** Best lap set by a racer so far, or null. */
export function bestLap(state, racerIndex) {
    let best = null;
    for (let l = 0; l < state.laps; l++) {
        const v = state.lapTimes[racerIndex * state.laps + l];
        if (v >= 0 && (best === null || v < best)) best = v;
    }
    return best;
}

export function isFinished(state, racerIndex) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return false;
    return state.finished[racerIndex] === 1;
}

/** True once every racer has crossed the line. */
export function isRaceOver(state) {
    return state.finishedCount >= state.racerCount;
}

// ---------------------------------------------------------------------------
// Position on the spline: sub-gate progress + wrong-way
// ---------------------------------------------------------------------------

/**
 * Feed a racer's current spline parameter in. Updates sub-gate progress and
 * the wrong-way accumulator. Zero allocation; safe to call every frame.
 *
 * Returns the (hysteretic) wrong-way flag so callers that only want that can
 * use `isWrongWay` and callers that want both can use this.
 */
export function updateRacerT(state, racerIndex, t) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return false;
    const tw = wrapT(t);

    if (!state.hasT[racerIndex]) {
        state.hasT[racerIndex] = 1;
        state.lastT[racerIndex] = tw;
        state.subT[racerIndex] = subGateFraction(state, racerIndex, tw);
        return false;
    }

    const d = deltaT(state.lastT[racerIndex], tw);
    state.lastT[racerIndex] = tw;

    if (Math.abs(d) <= RACE_CONFIG.wrongWayJumpT) {
        if (d < 0) {
            state.wrongAccum[racerIndex] -= d; // d is negative -> accumulate
        } else {
            const bleed = state.wrongAccum[racerIndex] - d * RACE_CONFIG.wrongWayDecay;
            state.wrongAccum[racerIndex] = bleed > 0 ? bleed : 0;
        }
    }

    if (state.finished[racerIndex]) {
        state.wrongAccum[racerIndex] = 0;
        state.wrongWay[racerIndex] = 0;
    } else if (state.wrongAccum[racerIndex] > RACE_CONFIG.wrongWayEnterT) {
        state.wrongWay[racerIndex] = 1;
    } else if (state.wrongAccum[racerIndex] < RACE_CONFIG.wrongWayExitT) {
        state.wrongWay[racerIndex] = 0;
    }

    state.subT[racerIndex] = subGateFraction(state, racerIndex, tw);
    return state.wrongWay[racerIndex] === 1;
}

/**
 * How far past the last gate the racer is, expressed as a fraction of ONE LAP
 * clamped to a single gate spacing. Because gates are evenly spaced in t this
 * needs no geometry at all. With fwd the forward lap-t from the last gate:
 *
 *     [0, span)          fwd: between the last gate and the next
 *     [1 - span, 1)      0: up to one span BEHIND the last gate
 *     [span, 1 - span)   span * 0.999: at or past the next gate, not counted
 */
function subGateFraction(state, racerIndex, tw) {
    const n = state.gateCount;
    const span = 1 / n;
    const lastGate = (state.nextGate[racerIndex] - 1 + n) % n;
    const fwd = forwardT(lastGate * span, tw);
    if (fwd < span) return fwd;
    // Short of the last gate (on the grid behind the line, or drifting back
    // through a plane): no distance past it at all. Reading that as "nearly
    // a whole span on" put such a racer a gate ahead of the field.
    if (fwd >= 1 - span) return 0;
    // Past the next gate (gate not registered yet) — hold at the gate spacing
    // so progress never overshoots and un-does itself when the gate fires.
    return span * 0.999;
}

/**
 * Wrong-way flag. Also advances the accumulator, so calling this once per
 * frame per racer is the intended usage (the contract's signature).
 */
export function isWrongWay(state, racerIndex, t) {
    return updateRacerT(state, racerIndex, t);
}

/**
 * Progress in laps: gates passed / gateCount, plus the fraction of the
 * current gate span already travelled. Monotonic during valid forward racing
 * (through each gate in turn); a racer flying backwards loses the sub-gate
 * part, never a counted gate. A racer who has crossed the line reports their
 * full race distance so finishers never fall below runners.
 */
export function racerProgress(state, racerIndex) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return 0;
    if (state.finished[racerIndex]) return state.laps;
    return state.gatesPassed[racerIndex] / state.gateCount + state.subT[racerIndex];
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/**
 * true if racer `a` should be classified ahead of racer `b`.
 * Finishers outrank runners; finishers sort by time; runners by progress.
 * Ties fall back to racer index so the order is deterministic.
 */
function ranksAhead(state, a, b) {
    const fa = state.finished[a], fb = state.finished[b];
    if (fa !== fb) return fa === 1;
    if (fa === 1) {
        if (state.finishMs[a] !== state.finishMs[b]) return state.finishMs[a] < state.finishMs[b];
        return a < b;
    }
    const pa = state.progress[a], pb = state.progress[b];
    if (Math.abs(pa - pb) > RACE_CONFIG.tieEpsilon) return pa > pb;
    return a < b;
}

/**
 * Recompute `state.progress`, sort `state.order` in place (insertion sort —
 * n<=8, already nearly sorted every frame, and allocates nothing), and stamp
 * `state.place`.
 */
export function updateStandings(state) {
    const n = state.racerCount;
    for (let i = 0; i < n; i++) state.progress[i] = racerProgress(state, i);

    for (let i = 1; i < n; i++) {
        const v = state.order[i];
        let j = i - 1;
        while (j >= 0 && ranksAhead(state, v, state.order[j])) {
            state.order[j + 1] = state.order[j];
            j--;
        }
        state.order[j + 1] = v;
    }

    for (let k = 0; k < n; k++) state.place[state.order[k]] = k + 1;
    return state.order;
}

/** 1-based classification for a racer. Call updateStandings first. */
export function placeOf(state, racerIndex) {
    if (racerIndex < 0 || racerIndex >= state.racerCount) return 0;
    return state.place[racerIndex];
}

/**
 * Gap in laps-of-progress between two racers (positive = `a` ahead).
 * Used by the AI's rubber-banding and by the HUD's split readout.
 */
export function progressGap(state, a, b) {
    return racerProgress(state, a) - racerProgress(state, b);
}
