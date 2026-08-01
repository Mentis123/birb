/**
 * shake.js — seeded, decaying screen trauma.
 *
 * This module does NOT touch the camera. It owns a single scalar and the noise
 * that shapes it; the chase camera reads that scalar and decides what a shake
 * means for it (positional jitter, roll, FOV). Keeping the two apart means a
 * shake can be unit-tested with no renderer, and the camera stays the only
 * thing in the codebase that writes camera state.
 *
 * ============================================================================
 * WHY TRAUMA-SQUARED
 * ============================================================================
 * The naive implementation decays an offset directly, which gives a shake that
 * starts violent and tapers into a long, sea-sick wobble — the amplitude decays
 * linearly, so the last 30% of the effect lasts 30% of the duration while being
 * barely visible and thoroughly annoying.
 *
 * The trauma model (Squirrel Eiserloh's, from GDC 2016) stores `trauma` in
 * [0,1], decays it linearly, and outputs `trauma^2`. The square means the tail
 * collapses fast: at trauma 0.3 the output is 0.09 — effectively over. Impacts
 * hit hard and get out of the way, which is what an arcade racer wants.
 *
 * Noise is a precomputed seeded table sampled with continuous interpolation
 * along three decorrelated lanes (x, y, roll). Table-based rather than
 * Math.random() so the screenshot harness captures the same frame twice, and
 * interpolated rather than per-frame random so the shake is a smooth wobble at
 * any framerate rather than framerate-dependent static.
 *
 * Zero allocation after construction. Pure JS — no THREE, no DOM.
 */

import { makeRng } from '../core/rng.js';

const NOISE_LEN = 256;
const NOISE_MASK = NOISE_LEN - 1;

/** Trauma bleeds off at this much per second. ~0.9s from a full-strength hit. */
const DEFAULT_DECAY = 1.15;

/** How fast the noise table is traversed, per lane. Decorrelated on purpose. */
const LANE_FREQ = [17.0, 14.3, 11.1];

function smootherstep(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.decay]     trauma units per second
 * @param {number} [opts.maxTrauma] clamp; 1 by default
 */
export function createScreenShake(opts = {}) {
    const rng = makeRng(opts.seed || 0x51a4e);
    const decay = opts.decay > 0 ? opts.decay : DEFAULT_DECAY;
    const maxTrauma = opts.maxTrauma > 0 ? opts.maxTrauma : 1;

    // Three decorrelated lanes of value noise in [-1,1].
    const table = new Float32Array(NOISE_LEN * 3);
    for (let i = 0; i < table.length; i++) table[i] = rng() * 2 - 1;

    let trauma = 0;
    let time = 0;
    let disposed = false;

    /** Interpolated table lookup for lane `lane` at continuous position `p`. */
    function sample(lane, p) {
        const base = lane * NOISE_LEN;
        const i0 = Math.floor(p);
        const f = smootherstep(p - i0);
        const a = table[base + ((i0 & NOISE_MASK))];
        const b = table[base + (((i0 + 1) & NOISE_MASK))];
        return a + (b - a) * f;
    }

    const api = {
        /** trauma^2 — the scalar the camera multiplies its own limits by. */
        value: 0,
        /** Raw trauma in [0,1], for callers that want the linear quantity. */
        trauma: 0,
        /** Signed noise in [-1,1], already scaled by `value`. */
        offsetX: 0,
        offsetY: 0,
        roll: 0,

        /**
         * Add trauma. Additive and clamped, so a rapid string of small hits
         * builds rather than each one restarting the effect.
         */
        add(amount) {
            if (disposed || !(amount > 0)) return api.value;
            trauma += amount;
            if (trauma > maxTrauma) trauma = maxTrauma;
            return trauma;
        },

        /** Force a level (used by a race reset, which must not shake). */
        set(amount) {
            trauma = amount > 0 ? Math.min(maxTrauma, amount) : 0;
            return trauma;
        },

        /** Zero-allocation. Safe with dt <= 0 and with tab-return spikes. */
        update(dt) {
            if (disposed) return api.value;
            if (!(dt > 0)) dt = 0;
            if (dt > 0.1) dt = 0.1;

            trauma -= decay * dt;
            if (trauma < 0) trauma = 0;

            time += dt;
            const v = trauma * trauma;
            api.trauma = trauma;
            api.value = v;

            if (v > 0) {
                api.offsetX = sample(0, time * LANE_FREQ[0]) * v;
                api.offsetY = sample(1, time * LANE_FREQ[1]) * v;
                api.roll = sample(2, time * LANE_FREQ[2]) * v;
            } else {
                // Snap to rest rather than leaving a stale sub-pixel offset.
                api.offsetX = 0;
                api.offsetY = 0;
                api.roll = 0;
                time = 0;
            }
            return v;
        },

        dispose() {
            disposed = true;
            trauma = 0;
            api.value = 0;
            api.trauma = 0;
            api.offsetX = 0;
            api.offsetY = 0;
            api.roll = 0;
        },
    };

    return api;
}

export default createScreenShake;
