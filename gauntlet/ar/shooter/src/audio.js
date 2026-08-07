/**
 * audio.js — every sound synthesised, no files. House rule 2.
 *
 * iOS: the AudioContext starts suspended and can only be resumed inside a user
 * gesture, so NOTHING is created until `unlock()` runs and every method is a
 * no-op before it. Constructing the context at module load is the classic way
 * to get a game that is silent for the whole session on iPhone with no error
 * anywhere to explain it.
 */

import { makeRng } from '/gauntlet/src/core/rng.js';

export function createShooterAudio() {
    let ctx = null;
    let master = null;
    let enabled = true;
    // Seeded, not Math.random(): the project bans Math.random outright so a
    // harness capture is reproducible. Noise never reaches a pixel, but a
    // banned call is a banned call and the next reader should not have to
    // work out whether this one was the allowed exception.
    const rng = makeRng(0x4f15e);

    function unlock() {
        if (ctx) {
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.5;
            master.connect(ctx.destination);
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        } catch (_) { ctx = null; }
    }

    function ready() { return Boolean(ctx && master && enabled); }

    /** One shaped oscillator blip. */
    function tone(type, f0, f1, dur, gain, delay = 0) {
        if (!ready()) return;
        const t = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.02);
    }

    /** Filtered noise burst — the body of an explosion. */
    function noise(dur, gain, freq, delay = 0) {
        if (!ready()) return;
        const t = ctx.currentTime + delay;
        const n = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++) {
            // Decaying white noise. Cheap, and at these durations nobody can
            // tell it from a sampled explosion through a phone speaker.
            data[i] = (rng() * 2 - 1) * Math.pow(1 - i / n, 2.2);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(freq, t);
        filt.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.25), t + dur);
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(filt); filt.connect(g); g.connect(master);
        src.start(t);
    }

    return {
        unlock,
        setEnabled(v) { enabled = v !== false; },
        fire() { tone('square', 760, 180, 0.16, 0.16); noise(0.12, 0.10, 2600); },
        explode() { noise(0.42, 0.34, 1700); tone('sawtooth', 190, 40, 0.34, 0.14); },
        /** Rising two-note sting; pitch climbs with the combo. */
        kill(combo) {
            const k = Math.min(combo, 8);
            tone('triangle', 520 + k * 55, 900 + k * 80, 0.14, 0.14);
            tone('triangle', 780 + k * 70, 1180 + k * 90, 0.12, 0.10, 0.07);
        },
        damage() { tone('sawtooth', 240, 70, 0.42, 0.24); noise(0.3, 0.20, 900); },
        wave() {
            tone('square', 420, 620, 0.13, 0.13);
            tone('square', 620, 880, 0.16, 0.13, 0.13);
        },
        over() {
            tone('sawtooth', 420, 110, 0.6, 0.2);
            tone('sawtooth', 300, 70, 0.8, 0.16, 0.18);
        },
        dispose() { if (ctx) ctx.close().catch(() => {}); ctx = null; master = null; },
    };
}
