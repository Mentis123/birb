/**
 * audio.js — Birb Gauntlet's entire soundtrack, synthesised.
 *
 * Zero audio files. Every sound in the game is built from oscillators, one
 * deterministically generated noise buffer, filters and envelopes. The whole
 * module is ~one Web Audio graph:
 *
 *     [wind noise] -> lowpass -> gain -\
 *     [whistle]    -> bandpass -> gain -+-> musicBus -\
 *                                                       -> master -> destination
 *     [one-shot voices: flap/gate/boost/impact/...] -> sfxBus -/
 *
 * iOS reality, which shapes every line below:
 *   - An AudioContext constructed outside a user gesture starts `suspended`
 *     and, on iOS, may never resume. So NOTHING is constructed until
 *     `unlock()` is called from a real gesture handler.
 *   - Every public method is therefore a no-op before unlock, and none of them
 *     may throw. The game calls `setFlightSpeed()` from the render loop, which
 *     starts running behind the splash screens long before anyone has tapped.
 *   - `unlock()` is idempotent and safe to call from every gesture (Safari
 *     sometimes re-suspends on tab return, so re-calling it re-resumes).
 *
 * Allocation: `setFlightSpeed()` is the only per-frame entry point and it
 * writes AudioParams only — no nodes, no objects. The one-shot voices do build
 * nodes, but they fire on discrete events (a gate, a flap), not every frame,
 * and Web Audio gives no way to avoid that.
 *
 * Determinism: the noise buffer and every "randomised" detune come from the
 * seeded RNG in core/rng.js, so two runs of the screenshot harness render the
 * same waveform.
 */

import { makeRng } from '/gauntlet/src/core/rng.js';

/**
 * Mix levels. Tuned against a captured offline render, not by ear-in-the-head:
 * the first pass ran the wind bed at 0.34 and at full speed it visibly buried
 * the gate chimes in the waveform. The bed has to sit UNDER the events — it is
 * the floor of the mix, not a voice.
 */
const MIX = {
    master: 0.85,
    wind: 0.26,        // peak wind gain at speed01 = 1 — carries speed alone now
    whistle: 0.10,     // high-speed edge tone, only above ~0.6
    // Wingbeats are ambience, not events. Now that every completed stroke fires
    // one, 0.5 turned a climb into a machine gun — the bang-bang-bang was the
    // sound doing the same job at full level three times a second.
    flap: 0.17,
    gate: 0.34,
    boost: 0.42,
    impact: 0.62,
    beep: 0.3,
    horn: 0.34,
    finish: 0.3,
    ring: 0.36,        // ring pickup — sits with the gate chime, not above it
    // The gun is the loudest thing in the game and should be. It is the one
    // sound the player CAUSES on purpose, and at 0.4 it sat under the wind bed
    // and read as a puff rather than a launch.
    rocket: 0.9,
    explode: 0.5,
    kill: 0.42,
    alarm: 0.34,
};

/** Major pentatonic in semitones. Gate chimes walk up this, forever. */
const PENTATONIC = [0, 2, 4, 7, 9];
const GATE_ROOT = 523.25;      // C5
const SEMI = 1.0594630943592953;

function semitone(n) {
    return Math.pow(SEMI, n);
}

/** Fanfare motifs by placement bucket: 1st, podium, also-ran. */
const FANFARE_WIN = [0, 4, 7, 12, 16, 19];
const FANFARE_PODIUM = [0, 4, 7, 12];
const FANFARE_LOSS = [0, -3, -5, -8];

/**
 * Build the audio system.
 *
 * @param {object} [opts]
 * @param {AudioContext} [opts.context]  inject a context (the dev probe passes
 *        an OfflineAudioContext so it can render the synth to a waveform and
 *        prove it is producing sound rather than silence). When injected, the
 *        context is NOT closed on dispose — the caller owns it.
 * @param {number} [opts.seed]
 */
export function createAudio(opts = {}) {
    const seed = opts.seed ?? 0xA1D05;
    const injected = opts.context || null;

    let ctx = null;
    let ready = false;            // graph built and usable
    let disposed = false;

    let master = null, musicBus = null, sfxBus = null;
    let windSrc = null, windFilter = null, windGain = null;
    let whistleSrc = null, whistleFilter = null, whistleGain = null;
    let noiseBuffer = null;

    let musicOn = true, sfxOn = true;
    let lastSpeed = -1;
    let gateStreakPitch = 0;

    const rng = makeRng(seed);

    // --- haptics -----------------------------------------------------------
    // navigator.vibrate is Android-only and has stayed that way. Since iOS 18,
    // toggling an <input type="checkbox" switch> fires a real haptic tick, so
    // a hidden bridge element gives iPhone players haptics too. Same trick
    // Birb Mobile ships.
    const CAN_VIBRATE = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    let hapticSwitch = null;
    let hapticsEnabled = true;

    function ensureHapticSwitch() {
        // Must return the EXISTING element on every call after the first —
        // returning null there would mean iOS got exactly one haptic tick per
        // session and none afterwards. (The dev probe asserts this.)
        if (hapticSwitch) return hapticSwitch;
        if (CAN_VIBRATE || typeof document === 'undefined' || !document.body) return null;
        try {
            const el = document.createElement('input');
            el.type = 'checkbox';
            el.setAttribute('switch', '');
            el.setAttribute('aria-hidden', 'true');
            el.tabIndex = -1;
            el.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;';
            document.body.appendChild(el);
            hapticSwitch = el;
        } catch (_) { /* no DOM, no haptics — not an error */ }
        return hapticSwitch;
    }

    function triggerHaptic(durationMs = 12) {
        if (!hapticsEnabled) return;
        if (CAN_VIBRATE) {
            try { navigator.vibrate(durationMs); } catch (_) { /* ignore */ }
            return;
        }
        const el = ensureHapticSwitch();
        if (el) { try { el.click(); } catch (_) { /* ignore */ } }
    }

    // --- graph construction (lazy, post-gesture) ---------------------------

    function makeNoiseBuffer() {
        const sr = ctx.sampleRate;
        const len = Math.floor(sr * 2);
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);
        // Cheap pink-ish noise (Voss-McCartney style running sum). Pure white
        // through a lowpass reads as radio static; this reads as air.
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const w = rng() * 2 - 1;
            b0 = 0.99765 * b0 + w * 0.0990460;
            b1 = 0.96300 * b1 + w * 0.2965164;
            b2 = 0.57000 * b2 + w * 1.0526913;
            d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.32;
        }
        // Cross-fade the tail into the head so the loop point is inaudible.
        const fade = Math.min(2048, len >> 3);
        for (let i = 0; i < fade; i++) {
            const t = i / fade;
            d[i] = d[i] * t + d[len - fade + i] * (1 - t);
        }
        return buf;
    }

    function buildGraph() {
        master = ctx.createGain();
        master.gain.value = MIX.master;
        // Safety limiter. Nothing in the mix clips on its own, but a gate chime
        // landing on top of a boost surge and an impact while the wind bed is
        // wide open does — and on a phone speaker that reads as a crackle, not
        // as loudness. One compressor is cheaper than ducking everything.
        if (typeof ctx.createDynamicsCompressor === 'function') {
            const limiter = ctx.createDynamicsCompressor();
            limiter.threshold.value = -8;
            limiter.knee.value = 6;
            limiter.ratio.value = 9;
            limiter.attack.value = 0.003;
            limiter.release.value = 0.16;
            master.connect(limiter);
            limiter.connect(ctx.destination);
        } else {
            master.connect(ctx.destination);
        }

        musicBus = ctx.createGain();
        musicBus.gain.value = musicOn ? 1 : 0;
        musicBus.connect(master);

        sfxBus = ctx.createGain();
        sfxBus.gain.value = sfxOn ? 1 : 0;
        sfxBus.connect(master);

        noiseBuffer = makeNoiseBuffer();

        // --- wind bed: broadband air moving past the bird -------------------
        windSrc = ctx.createBufferSource();
        windSrc.buffer = noiseBuffer;
        windSrc.loop = true;
        windFilter = ctx.createBiquadFilter();
        windFilter.type = 'lowpass';
        windFilter.frequency.value = 260;
        windFilter.Q.value = 0.7;
        windGain = ctx.createGain();
        windGain.gain.value = 0.0;
        windSrc.connect(windFilter).connect(windGain).connect(musicBus);

        // --- whistle: narrow resonance that only opens up at high speed -----
        whistleSrc = ctx.createBufferSource();
        whistleSrc.buffer = noiseBuffer;
        whistleSrc.loop = true;
        whistleSrc.playbackRate.value = 1.37;   // decorrelate from the bed
        whistleFilter = ctx.createBiquadFilter();
        whistleFilter.type = 'bandpass';
        whistleFilter.frequency.value = 1400;
        whistleFilter.Q.value = 6.5;
        whistleGain = ctx.createGain();
        whistleGain.gain.value = 0.0;
        whistleSrc.connect(whistleFilter).connect(whistleGain).connect(musicBus);

        // There is deliberately NO low-frequency body voice here. A 46Hz
        // sawtooth under the wind was meant to give speed "weight"; on a phone
        // speaker it just reads as a rough engine growl, which is wrong for a
        // bird and was the single worst thing in the mix. Speed is carried by
        // the wind bed opening up and the whistle arriving on top of it.

        const t0 = ctx.currentTime;
        try { windSrc.start(t0); } catch (_) { /* already started */ }
        try { whistleSrc.start(t0); } catch (_) { /* already started */ }

        ready = true;
        lastSpeed = -1;
    }

    function unlock() {
        if (disposed) return false;
        try {
            if (!ctx) {
                if (injected) {
                    ctx = injected;
                } else {
                    const Ctor = typeof window !== 'undefined'
                        ? (window.AudioContext || window.webkitAudioContext)
                        : null;
                    if (!Ctor) return false;
                    ctx = new Ctor({ latencyHint: 'interactive' });
                }
            }
            // Offline contexts have no meaningful resume() before rendering,
            // and Safari can reject it — never let it reach the caller.
            if (typeof ctx.resume === 'function' && ctx.state === 'suspended' && !isOffline()) {
                const p = ctx.resume();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
            if (!ready) buildGraph();
            // Some iOS builds need a silent tick before they will play anything.
            if (!isOffline()) blip();
            return true;
        } catch (_) {
            ready = false;
            return false;
        }
    }

    function isOffline() {
        return !!ctx && (ctx.startRendering !== undefined || ctx.constructor && ctx.constructor.name === 'OfflineAudioContext');
    }

    /** A single inaudible sample — the classic iOS "the graph is live" nudge. */
    function blip() {
        try {
            const s = ctx.createBufferSource();
            s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
            s.connect(master);
            s.start(0);
        } catch (_) { /* ignore */ }
    }

    // --- voice helpers -----------------------------------------------------

    function now() { return ctx.currentTime; }

    /** Percussive envelope: silence -> peak (attack) -> exponential tail. */
    function shape(param, t, peak, attack, decay, sustain = 0) {
        param.cancelScheduledValues(t);
        param.setValueAtTime(0.0001, t);
        param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
        if (sustain > 0) param.setValueAtTime(Math.max(0.0002, peak), t + attack + sustain);
        param.exponentialRampToValueAtTime(0.0001, t + attack + sustain + decay);
    }

    /** Fire-and-forget noise voice through a filter, with a frequency sweep. */
    function noiseVoice(t, type, f0, f1, q, peak, attack, decay, rate0, rate1, dest) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        // Start at a seeded offset so repeated hits are not phase-identical.
        const off = rng() * 1.5;
        const filt = ctx.createBiquadFilter();
        filt.type = type;
        filt.Q.value = q;
        filt.frequency.setValueAtTime(f0, t);
        filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
        const g = ctx.createGain();
        shape(g.gain, t, peak, attack, decay);
        if (rate0 !== rate1) {
            src.playbackRate.setValueAtTime(rate0, t);
            src.playbackRate.exponentialRampToValueAtTime(rate1, t + attack + decay);
        } else {
            src.playbackRate.value = rate0;
        }
        src.connect(filt).connect(g).connect(dest || sfxBus);
        try { src.start(t, off, attack + decay + 0.05); } catch (_) { src.start(t); }
        try { src.stop(t + attack + decay + 0.06); } catch (_) { /* ignore */ }
        return g;
    }

    /** Fire-and-forget tonal voice with an optional pitch glide. */
    function toneVoice(t, type, f0, f1, peak, attack, decay, sustain = 0, dest = null, detune = 0) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + attack + sustain + decay);
        const g = ctx.createGain();
        shape(g.gain, t, peak, attack, decay, sustain);
        osc.connect(g).connect(dest || sfxBus);
        osc.start(t);
        osc.stop(t + attack + sustain + decay + 0.05);
        return g;
    }

    // --- public voices -----------------------------------------------------

    /**
     * Wind rush. Called every frame; writes AudioParams only.
     * @param {number} speed01 0..1
     */
    function setFlightSpeed(speed01) {
        if (!ready || disposed) return;
        let s = speed01;
        if (!(s >= 0)) s = 0; else if (s > 1) s = 1;
        if (lastSpeed >= 0 && Math.abs(s - lastSpeed) < 0.004) return;
        lastSpeed = s;
        const t = now();
        const k = 0.12;   // smoothing time constant — no zipper noise
        const s2 = s * s;
        // Sweeps further than before: with no body voice underneath, the
        // filter opening IS the sensation of speed.
        windFilter.frequency.setTargetAtTime(300 + 4200 * s2, t, k);
        windGain.gain.setTargetAtTime(0.015 + MIX.wind * s * s, t, k);
        whistleFilter.frequency.setTargetAtTime(1100 + 1900 * s, t, k);
        whistleGain.gain.setTargetAtTime(MIX.whistle * s2 * s, t, k);
    }

    /** Wing flap: a filtered noise whoosh with a downward pitch sweep. */
    /**
     * One wingbeat. `strength` 0..1 scales it, so a gentle climb stroke is a
     * soft push of air and only a boost stroke really cracks — identical level
     * on every stroke is exactly what reads as bang-bang-bang.
     *
     * The attack is softened too. A 14ms attack on a repeating sound is a
     * transient, and a transient three times a second is a rhythm section.
     */
    function flap(strength = 0.5) {
        if (!ready || disposed) return;
        let s = strength;
        if (!(s >= 0)) s = 0; else if (s > 1) s = 1;
        const g = MIX.flap * (0.55 + 0.45 * s);
        const t = now();
        const jitter = 0.9 + rng() * 0.25;
        noiseVoice(t, 'bandpass', 1200 * jitter, 300, 1.2, g, 0.030, 0.26, 1.4, 0.7);
        // A touch of low body so the downstroke has weight, not just hiss.
        toneVoice(t, 'sine', 190 * jitter, 92, 0.045 * (0.5 + s), 0.03, 0.17);
    }

    /**
     * Gate chime. Climbs the pentatonic scale with the streak so a clean run
     * literally sounds like it is going up.
     * @param {number} streak 0-based consecutive-gate count
     */
    function gate(streak = 0) {
        if (!ready || disposed) return;
        const t = now();
        let i = streak | 0;
        if (i < 0) i = 0;
        if (i > 14) i = 14;                       // cap ~3 octaves
        gateStreakPitch = PENTATONIC[i % 5] + 12 * Math.floor(i / 5);
        const f = GATE_ROOT * semitone(gateStreakPitch);
        // Bell = fundamental + a quiet, slightly sharp partial.
        toneVoice(t, 'triangle', f, f, MIX.gate, 0.006, 0.52);
        toneVoice(t, 'sine', f * 2, f * 2, MIX.gate * 0.4, 0.006, 0.34, 0, null, 8);
        toneVoice(t + 0.055, 'triangle', f * 1.5, f * 1.5, MIX.gate * 0.5, 0.006, 0.36);
        // Sparkle so it reads as a pickup, not just a note.
        noiseVoice(t, 'highpass', 4200, 9000, 0.8, 0.09, 0.004, 0.12, 1, 1);
        triggerHaptic(10);
    }

    /** Boost surge: a riser under a filter sweep, plus a body whoosh. */
    function boost() {
        if (!ready || disposed) return;
        const t = now();
        const g = ctx.createGain();
        shape(g.gain, t, MIX.boost, 0.02, 0.52);
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.Q.value = 5.5;
        filt.frequency.setValueAtTime(340, t);
        filt.frequency.exponentialRampToValueAtTime(4600, t + 0.34);
        filt.frequency.exponentialRampToValueAtTime(900, t + 0.54);
        const a = ctx.createOscillator();
        a.type = 'sawtooth';
        a.frequency.setValueAtTime(96, t);
        a.frequency.exponentialRampToValueAtTime(430, t + 0.42);
        const b = ctx.createOscillator();
        b.type = 'sawtooth';
        b.detune.value = 11;
        b.frequency.setValueAtTime(64, t);
        b.frequency.exponentialRampToValueAtTime(288, t + 0.42);
        a.connect(filt); b.connect(filt);
        filt.connect(g).connect(sfxBus);
        a.start(t); b.start(t);
        a.stop(t + 0.6); b.stop(t + 0.6);
        noiseVoice(t, 'bandpass', 600, 5200, 1.2, 0.26, 0.03, 0.44, 0.8, 1.6);
        triggerHaptic(24);
    }

    /** Impact thud: pitch-dropping sine, dirt burst, and a click transient. */
    function impact() {
        if (!ready || disposed) return;
        const t = now();
        toneVoice(t, 'sine', 180, 38, MIX.impact, 0.004, 0.34);
        toneVoice(t, 'triangle', 96, 30, MIX.impact * 0.5, 0.004, 0.22);
        noiseVoice(t, 'lowpass', 1400, 220, 0.9, 0.34, 0.003, 0.2, 1, 0.7);
        noiseVoice(t, 'bandpass', 2600, 1200, 2.5, 0.14, 0.002, 0.06, 1, 1);
        triggerHaptic(38);
    }

    /**
     * Countdown beep. Pass the number being shown; 0 (or GO) gets the high,
     * longer tone so the start reads without looking at the HUD.
     */
    function countdownBeep(n = 3) {
        if (!ready || disposed) return;
        const t = now();
        const final = (n | 0) <= 0;
        const f = final ? 1046.5 : 587.33;
        toneVoice(t, 'square', f, f, MIX.beep * (final ? 1.15 : 0.8), 0.004, final ? 0.34 : 0.13, final ? 0.1 : 0.02);
        toneVoice(t, 'sine', f * 2, f * 2, MIX.beep * 0.3, 0.004, 0.1);
        triggerHaptic(final ? 28 : 12);
    }

    /** Start horn: stacked detuned saws with a rising bend. */
    function horn() {
        if (!ready || disposed) return;
        const t = now();
        const g = ctx.createGain();
        shape(g.gain, t, MIX.horn, 0.05, 0.42, 0.5);
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(900, t);
        filt.frequency.linearRampToValueAtTime(2400, t + 0.18);
        filt.Q.value = 1.4;
        const roots = [146.83, 220, 293.66];
        for (let i = 0; i < 3; i++) {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.detune.value = (i - 1) * 7;
            o.frequency.setValueAtTime(roots[i] * 0.985, t);
            o.frequency.linearRampToValueAtTime(roots[i], t + 0.12);
            o.connect(filt);
            o.start(t);
            o.stop(t + 1.1);
        }
        filt.connect(g).connect(sfxBus);
        noiseVoice(t, 'bandpass', 900, 500, 3, 0.07, 0.06, 0.5, 1, 1);
        triggerHaptic(46);
    }

    /**
     * Finish fanfare. 1st gets the full six-note rise, podium gets a short
     * rise, everything else gets a wry descending motif.
     */
    function finish(placement = 1) {
        if (!ready || disposed) return;
        const t = now();
        const p = placement | 0;
        const motif = p <= 1 ? FANFARE_WIN : (p <= 3 ? FANFARE_PODIUM : FANFARE_LOSS);
        const root = p <= 1 ? 392 : (p <= 3 ? 349.23 : 293.66);
        const step = p <= 1 ? 0.115 : 0.14;
        for (let i = 0; i < motif.length; i++) {
            const tt = t + i * step;
            const f = root * semitone(motif[i]);
            const last = i === motif.length - 1;
            toneVoice(tt, p <= 3 ? 'square' : 'triangle', f, f, MIX.finish, 0.008, last ? 0.7 : 0.16, last ? 0.16 : 0.02);
            toneVoice(tt, 'triangle', f * 0.5, f * 0.5, MIX.finish * 0.45, 0.008, last ? 0.5 : 0.14);
            if (p <= 1) noiseVoice(tt, 'highpass', 5000, 9000, 0.8, 0.05, 0.003, 0.1, 1, 1);
        }
        triggerHaptic(p <= 3 ? 40 : 18);
    }

    // --- mini-game voices --------------------------------------------------

    /**
     * Ring pickup. A rising two-note sparkle that climbs with `collected`, so
     * a clean run through the weave sounds like an ascending phrase rather
     * than the same ding eighteen times.
     *
     * It walks the same pentatonic as the gate chime deliberately: Ring Rush
     * and the race are the same instrument, played at different tempos.
     */
    function ring(collected = 0) {
        if (!ready || disposed) return;
        const t = now();
        const n = collected | 0;
        const f = GATE_ROOT * semitone(PENTATONIC[n % PENTATONIC.length] + 12 * Math.min(1, (n / PENTATONIC.length) | 0));
        toneVoice(t, 'sine', f, f, MIX.ring, 0.004, 0.26);
        toneVoice(t + 0.05, 'sine', f * 1.5, f * 1.5, MIX.ring * 0.7, 0.004, 0.3);
        noiseVoice(t, 'highpass', 6000, 11000, 0.9, 0.06, 0.002, 0.13, 1, 1);
        triggerHaptic(16);
    }

    /** Rocket launch: a downward-filtered noise whoosh with a body thump. */
    function rocketFire() {
        if (!ready || disposed) return;
        const t = now();
        // Four layers, because "louder" alone just clips: a crack to start it,
        // a body thump you feel, the whoosh of the motor, and a low tail that
        // keeps the launch ringing after the transient is gone.
        noiseVoice(t, 'highpass', 4200, 2000, 0.7, MIX.rocket * 0.75, 0.001, 0.055, 1, 1);
        toneVoice(t, 'sine', 240, 52, MIX.rocket * 0.95, 0.003, 0.26);
        noiseVoice(t, 'bandpass', 380, 2600, 0.8, MIX.rocket, 0.012, 0.42, 0.7, 1.8);
        toneVoice(t, 'triangle', 150, 62, MIX.rocket * 0.6, 0.006, 0.34);
        triggerHaptic(46);
    }

    /**
     * Explosion. Low body + broadband crack; `size` 0..1 scales both the level
     * and the decay so a distant kill is not the same event as one on your
     * canopy.
     */
    function explode(size = 1) {
        if (!ready || disposed) return;
        const t = now();
        let s = size;
        if (!(s >= 0.2)) s = 0.2; else if (s > 1) s = 1;
        toneVoice(t, 'sine', 150 * s, 34, MIX.explode * s, 0.003, 0.36 * s + 0.14);
        noiseVoice(t, 'lowpass', 2400, 180, 0.7, MIX.explode * 0.8 * s, 0.002, 0.34 * s + 0.1, 1, 0.55);
        noiseVoice(t, 'highpass', 3200, 6000, 0.6, MIX.explode * 0.28 * s, 0.001, 0.09, 1, 1);
        triggerHaptic(Math.round(24 + 30 * s));
    }

    /**
     * Kill confirm, pitched by combo. Separate from `explode` on purpose: the
     * explosion says something died, the confirm says YOU did it and how good
     * your chain is. Fusing them costs the player the combo feedback.
     */
    function kill(combo = 1) {
        if (!ready || disposed) return;
        const t = now();
        const step = Math.min(8, Math.max(0, Math.round((combo - 1) * 2)));
        const f = 659.25 * semitone(step);
        toneVoice(t, 'square', f * 0.5, f, MIX.kill, 0.004, 0.16, 0.02);
        toneVoice(t + 0.06, 'square', f, f * 1.5, MIX.kill * 0.6, 0.004, 0.2);
        triggerHaptic(20);
    }

    /**
     * Tube loaded. A short mechanical double-click, not a musical chime: it
     * has to say "the machine is ready" without competing with the gate and
     * ring chimes that carry actual scoring information.
     *
     * This exists so the player can keep their eyes on the target. A reload
     * you can only see is a reload you have to look away to check.
     */
    function reload() {
        if (!ready || disposed) return;
        const t = now();
        noiseVoice(t, 'highpass', 3000, 5200, 1.4, 0.16, 0.001, 0.035, 1, 1);
        noiseVoice(t + 0.065, 'highpass', 3600, 6000, 1.6, 0.20, 0.001, 0.045, 1, 1);
        toneVoice(t + 0.065, 'square', 880, 880, 0.075, 0.003, 0.06);
        triggerHaptic(14);
    }

    /** Nest under attack. Two-tone alarm — deliberately unpleasant. */
    function alarm() {
        if (!ready || disposed) return;
        const t = now();
        toneVoice(t, 'sawtooth', 440, 440, MIX.alarm, 0.006, 0.14, 0.04);
        toneVoice(t + 0.16, 'sawtooth', 330, 330, MIX.alarm, 0.006, 0.2, 0.04);
        triggerHaptic(44);
    }

    /** Music (wind bed) and SFX buses, independently muteable. */
    function setEnabled(music, sfx) {
        musicOn = music !== false;
        sfxOn = sfx !== false;
        if (!ready || disposed) return;
        const t = now();
        musicBus.gain.setTargetAtTime(musicOn ? 1 : 0, t, 0.05);
        sfxBus.gain.setTargetAtTime(sfxOn ? 1 : 0, t, 0.02);
    }

    function setHapticsEnabled(on) { hapticsEnabled = on !== false; }

    function dispose() {
        if (disposed) return;
        disposed = true;
        try {
            if (windSrc) windSrc.stop();
            if (whistleSrc) whistleSrc.stop();
        } catch (_) { /* already stopped */ }
        try { if (master) master.disconnect(); } catch (_) { /* ignore */ }
        if (ctx && !injected && typeof ctx.close === 'function') {
            try {
                const p = ctx.close();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch (_) { /* ignore */ }
        }
        if (hapticSwitch && hapticSwitch.parentNode) {
            try { hapticSwitch.parentNode.removeChild(hapticSwitch); } catch (_) { /* ignore */ }
        }
        hapticSwitch = null;
        ready = false;
        ctx = null;
    }

    return {
        unlock,
        setEnabled,
        setHapticsEnabled,
        setFlightSpeed,
        flap,
        gate,
        boost,
        impact,
        countdownBeep,
        horn,
        finish,
        ring,
        rocketFire,
        explode,
        kill,
        alarm,
        reload,
        triggerHaptic,
        dispose,
        // --- inspection hooks (dev probe / HUD debug; never used in the loop) ---
        get isReady() { return ready; },
        get state() { return ctx ? ctx.state : 'none'; },
        get context() { return ctx; },
        /** Master gain node, for attaching an AnalyserNode. Null before unlock. */
        tap() { return master; },
        /** Last pentatonic offset a gate chime used — lets the HUD colour-match. */
        get lastGatePitch() { return gateStreakPitch; },
    };
}
