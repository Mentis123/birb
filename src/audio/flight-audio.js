/**
 * src/audio/flight-audio.js — hear the air.
 *
 * Procedural aeroacoustics for the bird, in Web Audio: no assets, no GPU and
 * no allocation per frame. Everything that sounds is built ONCE, on the first
 * user gesture after Tap-to-Start, from one generated noise buffer and a
 * handful of oscillators. After that a frame only moves AudioParams, and only
 * when the value it wants has actually changed.
 *
 * Five layers, each driven by something the flight already knows:
 *
 *   WIND     The airflow over the bird. Its LEVEL follows the aerodynamic
 *            power law — turbulent flow past a trailing edge radiates power
 *            proportional to V^5 (Ffowcs Williams & Hall 1970), so the RMS
 *            goes as V^2.5 — and its band CENTRE follows V, because the
 *            eddies that make it shed at a constant Strouhal number. Noise ->
 *            lowpass -> bandpass -> gust -> level: the recipe of Farnell's
 *            wind practical (Designing Sound, 2010), driven by airspeed
 *            instead of a weather knob.
 *   WHISTLE  The aeolian tone. A feather shaft of diameter d sheds vortices
 *            at f = St * V / d with St ~ 0.2 (Strouhal 1878; the real-time
 *            model is Selfridge, Reiss & Avital 2018). One oscillator with
 *            weak 2f and 3f partials — the drag dipole radiates at 2f — faded
 *            in only at speed, where a real one becomes audible.
 *   BUFFET   The stall warning. Low-passed noise under a 6-10 Hz tremolo,
 *            driven by the stunt model's OWN stall flag and authority, so the
 *            sound and the physics cannot disagree about where the stall is.
 *   WHOOSH   The wing. A noise band whose envelope is RETRIGGERED on every
 *            real downstroke, read off the wing's own motion (see
 *            createDownstrokeDetector) so it follows whatever pose code runs.
 *            No node is created per beat: a beat is param automation only.
 *   RUSH     Low and fast: the ground or the water close under the bird.
 *
 * The levels are OUTPUT RMS, not gain values. Filtered noise loses most of
 * its energy in the filter (a 1 kHz band at Q 0.8 keeps ~17% of the RMS of
 * the white noise feeding it), and how much depends on where the band is, so
 * every layer carries a makeup computed from the filter's equivalent noise
 * bandwidth. `windGain` 0.01 therefore MEANS 0.01 RMS at the output (before
 * the master volume), which is what makes it measurable — the realism check
 * reads the analyser and compares.
 *
 * Pure where it can be: every mapping below is a plain function of numbers,
 * unit-tested in tests/flight-audio.test.js. The graph takes its AudioContext
 * constructor by injection so the same test can prove the frame loop never
 * creates a node.
 */

// Uniform white noise in [-1, 1] has this standard deviation.
const NOISE_SIGMA = 1 / Math.sqrt(3);
// Equivalent noise bandwidth of a 2nd-order Butterworth lowpass, in units of
// its cutoff: (pi/4) / sin(pi/4).
const BUTTERWORTH2_ENBW = Math.PI / (4 * Math.SQRT1_2);
// Web Audio reads a lowpass Q in DECIBELS (spec: "not a traditional Q, but a
// resonance value in decibels"). Linear 0.7071 — Butterworth, no peak — is
// -3.01 dB. The default Q of 1 would be a 1 dB resonant bump on every layer.
const BUTTERWORTH_Q_DB = -3.0103;

export const FLIGHT_AUDIO_TUNING = Object.freeze({
  // ---- WIND ---------------------------------------------------------------
  // Speeds are game units per second, read as metres per second: the cruise
  // of 11 is what a parrot actually flies at, and a sprint of 24 is a
  // stoop-fast dash. The wind reaches its cap at `windRef`, a little past a
  // sprint, and is silent below `windFloor` (walking, sitting in a nest).
  windFloor: 1.5,
  windRef: 32,
  windExp: 2.5,
  // Output RMS at the cap, before the master volume. Cruise lands 23 dB
  // under it and a sprint 6 dB under it — see windLevel. Against the game's
  // own music as played (0.026 RMS at master 0.7) that is 12-14 dB under it
  // at cruise and 3-4 dB over it at a sprint, measured at the output.
  windMax: 0.12,
  // Band centre proportional to speed (constant Strouhal), clamped to the
  // 400-2000 Hz band a wind practical lives in.
  windHzPerSpeed: 75,
  windHzMin: 400,
  windHzMax: 2000,
  windQ: 0.8,
  // A Butterworth lowpass above the band at this multiple of the centre:
  // tames the hiss the bandpass's gentle upper skirt lets through — and
  // clears the octave the whistle lives in.
  windLowpassRatio: 2.0,
  // Two slow, incommensurate LFOs on a unity gain: gusting. Relative depth,
  // so a silent wind stays silent.
  gustDepthA: 0.12,
  gustHzA: 0.23,
  gustDepthB: 0.07,
  gustHzB: 0.37,

  // ---- WHISTLE ------------------------------------------------------------
  strouhal: 0.2,
  // The thin distal rachis of a primary, in metres: 1.2 mm puts the tone at
  // 167 Hz per unit of speed — 4.0 kHz at a sprint, above the wind's band.
  // At 2 mm it sat INSIDE the band (2.4 kHz against an 1.8 kHz centre) and a
  // critical-band estimate put it ~8 dB under the noise it had to beat:
  // present in the graph, inaudible in the ear.
  shaftDiameter: 0.0012,
  whistleOnset: 14,
  whistleFull: 32,
  whistleExp: 1.5,
  whistleMax: 0.035,
  whistleHzMax: 8000,
  // Weak partials: the lift dipole at f, the drag dipole at 2f, a trace at 3f.
  whistlePartials: Object.freeze([1, 0.2, 0.07]),
  // A shedding vortex street wanders in pitch; a steady sine is tinnitus.
  vibratoHz: 5.3,
  vibratoCents: 14,

  // ---- BUFFET -------------------------------------------------------------
  // The buffet starts `buffetMargin` above the stall line (authority =
  // stallMul) and is at 55% of full on it; a reported stall is 70-100%.
  // 0.10 puts the onset at 1.2x the stall speed, where a stall warner sits.
  // Against G-STUNT-1's climb table that is silent through a 55-degree climb
  // (authority ~0.64), a light shudder at 60 (0.57) and the stall at 70; at
  // 0.14 it shuddered through ordinary steep climbs.
  buffetMargin: 0.10,
  buffetMax: 0.08,
  buffetHzMin: 6,
  buffetHzMax: 10,
  // Phone speakers roll off below ~300 Hz, so the buffet's lowpass sits at
  // 300 Hz and opens with depth, or the warning would be felt on headphones
  // and nowhere else.
  buffetCutoff: 300,
  buffetCutoffSpan: 160,

  // ---- WHOOSH -------------------------------------------------------------
  // Detector thresholds, radians per second of the wing's own rotation.x.
  whooshFire: 1.5,
  whooshRearm: 1.0,
  // Stroke velocity at which the whoosh is at full level, and its law: the
  // same aerodynamic V^2.5 as the wind, applied to the wing's speed.
  whooshFull: 12,
  whooshExp: 2.5,
  // Soft on purpose: a climb beats four times a second, continuously.
  whooshMax: 0.05,
  whooshAttack: 0.025,
  whooshDecay: 0.085,
  whooshHz: 380,
  whooshHzSpan: 260,
  whooshQ: 0.9,

  // ---- RUSH ---------------------------------------------------------------
  rushRange: 9,
  rushNear: 1.0,
  rushRef: 20,
  rushMax: 0.05,
  rushHz: 700,
  rushWaterHz: 1600,

  // ---- SMOOTHING AND LIFECYCLE -------------------------------------------
  // Every continuous parameter moves with setTargetAtTime at this time
  // constant: exponential at audio rate, so no zipper noise.
  paramTau: 0.06,
  // The airspeed estimate is itself smoothed (a measured per-frame speed is
  // noisy at uneven frame times).
  speedTau: 0.1,
  masterTau: 0.05,
  fadeTau: 0.02,
  // The idle watchdog: every `idleCheckMs` it compares a frame COUNTER with
  // the last check's; this many checks in a row with no frame and the loop is
  // taken to have stopped (a pause path that did not say so), so the context
  // is suspended. A counter, not a clock: reading the time every frame boxes
  // a double per frame, and the known pause paths (hidden, settings, a lost
  // GL context) say so explicitly and do not wait for this.
  idleCheckMs: 1000,
  idleChecks: 2,
  // Length of the one noise buffer. Stereo: independent noise per channel,
  // so every noise layer is wide for free.
  noiseSeconds: 2,
  // A measured airspeed above this is a teleport or a restored pose.
  maxSpeed: 120,
});

// ---------------------------------------------------------------------------
// Pure mappings.
// ---------------------------------------------------------------------------

export function clamp01(x) {
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

/** Hermite smoothstep; edge0 > edge1 gives the falling version. */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function finiteAbs(v) {
  const n = Math.abs(Number(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Wind level — output RMS, before the master volume — at an airspeed.
 * Monotonic non-decreasing and capped at `windMax`. Zero at and below the
 * floor, and eased in across one more floor's width, so a bird walking up to
 * a run does not switch the wind on with a click.
 */
export function windLevel(speed, t = FLIGHT_AUDIO_TUNING) {
  const v = finiteAbs(speed);
  if (!(v > t.windFloor)) return 0;
  const x = Math.min(1, v / t.windRef);
  const ease = Math.min(1, (v - t.windFloor) / t.windFloor);
  return t.windMax * Math.pow(x, t.windExp) * ease;
}

/** Centre of the wind's band, Hz: proportional to V, clamped. */
export function windFrequency(speed, t = FLIGHT_AUDIO_TUNING) {
  const f = finiteAbs(speed) * t.windHzPerSpeed;
  return f < t.windHzMin ? t.windHzMin : (f > t.windHzMax ? t.windHzMax : f);
}

/**
 * The aeolian tone of a cylinder of diameter `d` (metres) in a flow of speed
 * V (metres per second): f = St * V / d. Strouhal's number is ~0.2 across the
 * Reynolds range a feather lives in (~40 to ~2e5).
 */
export function aeolianFrequency(speed, diameter = FLIGHT_AUDIO_TUNING.shaftDiameter,
  strouhal = FLIGHT_AUDIO_TUNING.strouhal) {
  const d = Number(diameter);
  if (!(d > 0)) return 0;
  return strouhal * finiteAbs(speed) / d;
}

/** Whistle level (output RMS): silent below onset, full at `whistleFull`. */
export function whistleLevel(speed, t = FLIGHT_AUDIO_TUNING) {
  const s = clamp01((finiteAbs(speed) - t.whistleOnset) / (t.whistleFull - t.whistleOnset));
  return s > 0 ? t.whistleMax * Math.pow(s, t.whistleExp) : 0;
}

/**
 * How hard the air is buffeting, 0..1, from the flight model's OWN stall
 * state. `authority` is the stunt controller's speed / cruise ratio (clamped
 * 0.35..1.2 there); `stallMul` is its stall line (0.5).
 *
 * Near the stall — within `buffetMargin` above the line — a smooth pre-stall
 * buffet rises to 0.55; a reported stall is at least 0.7 and deepens to 1 as
 * the authority falls to its floor. Non-finite authority (not the stunt
 * model, or a boost that has moved the energy target) contributes nothing,
 * so only an explicit stall flag can make a sound.
 */
export function buffetLevel(stalled, authority, t = FLIGHT_AUDIO_TUNING, stallMul = 0.5) {
  const a = Number(authority);
  const line = Number.isFinite(stallMul) ? stallMul : 0.5;
  let pre = 0;
  if (Number.isFinite(a)) {
    const onset = line + t.buffetMargin;
    if (a < onset) {
      const x = clamp01((onset - a) / t.buffetMargin);
      pre = 0.55 * x * x * (3 - 2 * x);
    }
  }
  if (!stalled) return pre;
  const floor = 0.35;
  const depth = Number.isFinite(a) ? clamp01((line - a) / Math.max(1e-6, line - floor)) : 1;
  return Math.max(pre, 0.7 + 0.3 * depth);
}

/** Tremolo rate for a buffet level: 6 Hz at its onset, 10 Hz deep in. */
export function buffetRate(level, t = FLIGHT_AUDIO_TUNING) {
  return t.buffetHzMin + (t.buffetHzMax - t.buffetHzMin) * clamp01(level);
}

/** Ground/water rush (output RMS): close under the bird, and moving. */
export function rushLevel(clearance, speed, t = FLIGHT_AUDIO_TUNING) {
  const c = Number(clearance);
  if (!Number.isFinite(c)) return 0;
  const near = smoothstep(t.rushRange, t.rushNear, c);
  if (!(near > 0)) return 0;
  const x = Math.min(1, finiteAbs(speed) / t.rushRef);
  return t.rushMax * near * x * x;
}

/** Whoosh peak (output RMS) for a downstroke of this angular speed, rad/s. */
export function whooshLevel(strokeVelocity, t = FLIGHT_AUDIO_TUNING) {
  const v = Number(strokeVelocity);
  if (!(v > 0)) return 0;
  return t.whooshMax * Math.pow(Math.min(1, v / t.whooshFull), t.whooshExp);
}

/** The player's volume as the flight audio hears it: master, unless SFX is off. */
export function outputVolume(masterVolume, sfxEnabled) {
  if (!sfxEnabled) return 0;
  const m = Number(masterVolume);
  return Number.isFinite(m) ? clamp01(m) : 0;
}

/**
 * Makeup gain that turns unit-variance-free white noise through a 2nd-order
 * bandpass (Web Audio's, which is the cookbook's constant-0-dB-peak BPF) into
 * unit RMS. The filter passes an equivalent noise bandwidth of (pi/2)(f0/Q),
 * so the RMS it keeps is sigma * sqrt(ENBW / Nyquist).
 */
export function bandpassMakeup(f0, Q, sampleRate) {
  const nyq = sampleRate / 2;
  const enbw = (Math.PI / 2) * (f0 / Q);
  return 1 / (NOISE_SIGMA * Math.sqrt(Math.min(1, enbw / nyq)));
}

/** Same for a Butterworth lowpass at cutoff fc. */
export function lowpassMakeup(fc, sampleRate) {
  const nyq = sampleRate / 2;
  return 1 / (NOISE_SIGMA * Math.sqrt(Math.min(1, (BUTTERWORTH2_ENBW * fc) / nyq)));
}

/**
 * The share of a bandpass's noise RMS that survives a Butterworth lowpass at
 * `ratio` times its centre. The wind runs noise through both, and the plain
 * bandpass makeup assumes all of it: at Q 0.8 and ratio 2 the lowpass keeps
 * ~76% (measured against a simulated cookbook cascade in the unit test), so
 * without this the wind would play 2.4 dB under the level it reports.
 *
 * Both filters scale with the centre, so the share does not depend on it:
 * one numeric integral of the analog responses, over a log grid, at build.
 */
export function lowpassedBandShare(Q, ratio) {
  if (!(Q > 0) || !(ratio > 0)) return 1;
  const steps = 4000;
  const lo = Math.log(1e-3);
  const hi = Math.log(1e3);
  const h = (hi - lo) / steps;
  let band = 0;
  let kept = 0;
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.exp(lo + i * h);
    const q = x / Q;
    const bp = (q * q) / ((1 - x * x) * (1 - x * x) + q * q);
    const r = x / ratio;
    const lp = 1 / (1 + r * r * r * r);
    const w = (i === 0 || i === steps ? 0.5 : 1) * x * h; // dx = x dlnx
    band += bp * w;
    kept += bp * lp * w;
  }
  return band > 0 ? Math.sqrt(kept / band) : 1;
}

/** RMS of a unit-peak periodic wave built from these sine partials. */
export function partialsRms(partials, samples = 512) {
  let peak = 0;
  let sq = 0;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / samples) * Math.PI * 2;
    let y = 0;
    for (let k = 0; k < partials.length; k += 1) y += partials[k] * Math.sin((k + 1) * x);
    const a = Math.abs(y);
    if (a > peak) peak = a;
    sq += y * y;
  }
  if (!(peak > 0)) return 0;
  // Web Audio normalises a PeriodicWave to a peak of 1.
  return Math.sqrt(sq / samples) / peak;
}

// ---------------------------------------------------------------------------
// The downstroke detector.
// ---------------------------------------------------------------------------

/**
 * Fires once per DOWNSTROKE of a wing, from the wing's own angle sampled once
 * a frame. For the left wing a POSITIVE rotation.x carries the tip DOWN (a
 * rotation about +X sends +Z, where the tip is, toward -Y), so "down" here is
 * a positive angular velocity; pass `sign: -1` for a rig built the other way.
 *
 * Hysteresis, not a zero crossing: it ARMS on an upstroke faster than
 * `rearm`, a downstroke faster than `fire` then STARTS a stroke, and the
 * stroke FIRES at its velocity peak — the first sample that is no faster
 * than the one before — returning that peak in rad/s. So a beat fires
 * exactly once however many samples its downstroke spans (at 20 fps a whole
 * downstroke can be two samples), the strength is the stroke's own sampled
 * peak rather than the threshold it happened to cross, and jitter, idle
 * flutter or anything slower than the thresholds never fires at all. The
 * sound peaks where the wing is fastest, which is where the air is loudest;
 * the cost is one frame of latency.
 *
 * The first cut fired AT the crossing and patched the level with a decaying
 * memory of earlier strokes — and a burst of fast strokes then inflated the
 * next slow one (measured live: a 3.9 rad/s idle beat whooshing as 6.8).
 *
 * A jump faster than `maxRate` is a discontinuity (a model swap, a forced
 * pose), not a stroke: it disarms instead of firing.
 */
export function createDownstrokeDetector({ fire = 1.5, rearm = 1.0, maxRate = 60, sign = 1 } = {}) {
  const d = {
    count: 0,
    armed: false,
    inStroke: false,
    velocity: 0,
    peak: 0,
    _prev: NaN,
    step(angle, dt) {
      const a = Number(angle);
      if (!Number.isFinite(a)) { d._prev = NaN; d.velocity = 0; return 0; }
      if (!(dt > 0)) { d._prev = a; return 0; }
      if (!Number.isFinite(d._prev)) { d._prev = a; return 0; }
      const v = sign * (a - d._prev) / dt;
      d._prev = a;
      if (!(Math.abs(v) <= maxRate)) {
        d.armed = false;
        d.inStroke = false;
        d.velocity = 0;
        return 0;
      }
      d.velocity = v;
      let fired = 0;
      if (d.inStroke) {
        if (v > d.peak) { d.peak = v; return 0; }
        // Past the peak (or already over): this is the stroke's moment.
        d.inStroke = false;
        d.count += 1;
        fired = d.peak;
        // ...and the SAME sample may already be the next upstroke: at 20 fps
        // a 6 Hz beat is 3.3 samples a cycle, and returning here without
        // letting it arm missed every third beat.
      }
      if (!d.armed) {
        if (v < -rearm) d.armed = true;
        return fired;
      }
      if (v > fire) {
        d.armed = false;
        d.inStroke = true;
        d.peak = v;
      }
      return fired;
    },
    reset() {
      d.armed = false;
      d.inStroke = false;
      d.velocity = 0;
      d.peak = 0;
      d._prev = NaN;
    },
  };
  return d;
}

// ---------------------------------------------------------------------------
// The graph.
// ---------------------------------------------------------------------------

function noop() {}

/**
 * One stereo buffer of white noise, generated once. xorshift32 rather than
 * Math.random: deterministic, and ~2x faster over the ~200k samples this
 * writes inside a tap.
 */
function makeNoiseBuffer(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, len, rate);
  let s = 0x2545f491;
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i += 1) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
  }
  return buffer;
}

/**
 * The flight-audio controller. Nothing is created until `unlock()` (call it
 * from a user gesture after the game has started); every method is safe to
 * call before that and does nothing.
 *
 *   unlock(event?)      create/resume in a gesture; sets the iOS audio session
 *   update(frame, dt)   per frame, zero allocation — see the frame shape below
 *   setVolume(m, sfx)   live master volume / SFX toggle
 *   suspend(reason)     fade and suspend ('hidden', 'paused', ...)
 *   ensureContext()     the shared AudioContext (the ring chime uses it too)
 *   probe()             a snapshot for __BIRB.flightAudio()
 *   measure()           debug: RMS / spectrum of the output, via an analyser
 *                       created on first use
 *
 * The frame object (one, refilled by the caller every frame):
 *   { speed, paused, airborne, stalled, authority, stallMul, wingAngle,
 *     clearance, overWater }
 * `speed` NaN keeps the last estimate; `authority` NaN means "no stall
 * model"; `wingAngle` NaN means "no wing"; `dt` is the time the sampled pose
 * advanced by.
 */
export function createFlightAudio(options = {}) {
  const t = options.tuning || FLIGHT_AUDIO_TUNING;
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const AC = options.AudioContext !== undefined
    ? options.AudioContext
    : (g.AudioContext || g.webkitAudioContext || null);
  const nav = options.navigator !== undefined ? options.navigator : (g.navigator || null);
  const doc = options.document !== undefined ? options.document : (g.document || null);
  const timers = options.timers || {
    setTimeout: (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: (id) => g.clearTimeout(id),
    setInterval: (fn, ms) => g.setInterval(fn, ms),
    clearInterval: (id) => g.clearInterval(id),
  };

  let ctx = null;
  let unavailable = !AC;
  let n = null; // the nodes, once built
  const detector = createDownstrokeDetector({ fire: t.whooshFire, rearm: t.whooshRearm });

  const st = {
    volume: 0,
    speed: 0,
    suspendReason: null,
    suspendTimer: 0,
    watchdog: 0,
    frames: 0,
    seenFrames: 0,
    quietChecks: 0,
    everRan: false,
    sessionType: null,
    whooshCount: 0,
    whooshLast: 0,
    // Targets last sent, for the probe.
    wind: 0,
    windHz: 0,
    whistle: 0,
    whistleHz: 0,
    buffet: 0,
    rush: 0,
    stalled: false,
    whistleMakeup: 1,
    buffetMakeup: 1,
    windShare: 1,
  };

  // One record per continuously driven AudioParam, so a frame can skip a
  // target that has not moved (and not grow the automation timeline).
  const P = {};
  function track(key, param, tau, rel) {
    P[key] = { param, tau, rel, last: NaN };
  }
  function send(rec, value) {
    const last = rec.last;
    if (last === last) { // not NaN
      const diff = Math.abs(value - last);
      if (diff <= rec.rel * Math.abs(last) || diff < 1e-6) return;
    }
    rec.last = value;
    rec.param.setTargetAtTime(value, ctx.currentTime, rec.tau);
  }

  function isHidden() {
    return !!(doc && doc.hidden);
  }

  function ensureContext() {
    if (ctx) return ctx;
    if (unavailable) return null;
    try { ctx = new AC(); } catch (_) { ctx = null; }
    if (!ctx) { unavailable = true; return null; }
    return ctx;
  }

  function osc(type, hz) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    return o;
  }
  function gain(v) {
    const node = ctx.createGain();
    node.gain.value = v;
    return node;
  }
  function biquad(type, hz, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  }
  function noiseSource(buffer, offset, rate) {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, offset);
    return s;
  }

  function build() {
    if (n || !ensureContext()) return !!n;
    const rate = ctx.sampleRate;
    const buffer = makeNoiseBuffer(ctx, t.noiseSeconds);
    const master = gain(0);
    master.connect(ctx.destination);

    // WIND: noise -> lowpass -> bandpass -> gust -> level.
    const windSrc = noiseSource(buffer, 0, 1);
    const windLP = biquad('lowpass', t.windHzMin * t.windLowpassRatio, BUTTERWORTH_Q_DB);
    const windBP = biquad('bandpass', t.windHzMin, t.windQ);
    const gust = gain(1);
    const windGain = gain(0);
    windSrc.connect(windLP); windLP.connect(windBP); windBP.connect(gust);
    gust.connect(windGain); windGain.connect(master);
    const gustA = osc('sine', t.gustHzA);
    const gustAGain = gain(t.gustDepthA);
    gustA.connect(gustAGain); gustAGain.connect(gust.gain);
    const gustB = osc('sine', t.gustHzB);
    const gustBGain = gain(t.gustDepthB);
    gustB.connect(gustBGain); gustBGain.connect(gust.gain);
    st.windShare = lowpassedBandShare(t.windQ, t.windLowpassRatio);

    // WHISTLE: one oscillator, weak partials, a wandering pitch.
    const whistle = osc('sine', 1000);
    const partials = t.whistlePartials;
    let rms = Math.SQRT1_2;
    if (typeof ctx.createPeriodicWave === 'function' && partials && partials.length > 1) {
      try {
        const real = new Float32Array(partials.length + 1);
        const imag = new Float32Array(partials.length + 1);
        for (let k = 0; k < partials.length; k += 1) imag[k + 1] = partials[k];
        whistle.setPeriodicWave(ctx.createPeriodicWave(real, imag));
        rms = partialsRms(partials);
      } catch (_) { rms = Math.SQRT1_2; }
    }
    st.whistleMakeup = 1 / rms;
    const vibrato = osc('sine', t.vibratoHz);
    const vibratoGain = gain(t.vibratoCents);
    vibrato.connect(vibratoGain); vibratoGain.connect(whistle.detune);
    const whistleGain = gain(0);
    whistle.connect(whistleGain); whistleGain.connect(master);

    // BUFFET: noise -> lowpass -> tremolo -> level. Two tremolo LFOs at a
    // non-integer ratio, so it shudders instead of pulsing like a metronome.
    const buffetSrc = noiseSource(buffer, 0.61, 0.97);
    const buffetLP = biquad('lowpass', t.buffetCutoff, BUTTERWORTH_Q_DB);
    const trem = gain(0.5);
    const tremA = osc('sine', t.buffetHzMin);
    const tremAGain = gain(0.35);
    tremA.connect(tremAGain); tremAGain.connect(trem.gain);
    const tremB = osc('sine', t.buffetHzMin * 1.37);
    const tremBGain = gain(0.15);
    tremB.connect(tremBGain); tremBGain.connect(trem.gain);
    const buffetGain = gain(0);
    buffetSrc.connect(buffetLP); buffetLP.connect(trem); trem.connect(buffetGain); buffetGain.connect(master);
    // RMS of 0.5 + 0.35 sin + 0.15 sin' is sqrt(0.25 + 0.35^2/2 + 0.15^2/2).
    st.buffetMakeup = 1 / Math.sqrt(0.25 + (0.35 * 0.35) / 2 + (0.15 * 0.15) / 2);

    // WHOOSH: noise -> bandpass -> envelope. The envelope is the only thing a
    // beat touches.
    const whooshSrc = noiseSource(buffer, 1.13, 1.03);
    const whooshBP = biquad('bandpass', t.whooshHz, t.whooshQ);
    const whooshGain = gain(0);
    whooshSrc.connect(whooshBP); whooshBP.connect(whooshGain); whooshGain.connect(master);

    // RUSH: noise -> lowpass -> level.
    const rushSrc = noiseSource(buffer, 1.57, 0.99);
    const rushLP = biquad('lowpass', t.rushHz, BUTTERWORTH_Q_DB);
    const rushGain = gain(0);
    rushSrc.connect(rushLP); rushLP.connect(rushGain); rushGain.connect(master);

    gustA.start(); gustB.start(); whistle.start(); vibrato.start(); tremA.start(); tremB.start();

    n = {
      master, windSrc, windLP, windBP, gust, windGain, gustA, gustB,
      whistle, vibrato, whistleGain, buffetSrc, buffetLP, trem, tremA, tremB, buffetGain,
      whooshSrc, whooshBP, whooshGain, rushSrc, rushLP, rushGain,
      analyser: null, splitter: null, timeData: null, freqData: null, rate,
    };
    track('master', master.gain, t.masterTau, 0.004);
    track('windGain', windGain.gain, t.paramTau, 0.01);
    track('windHz', windBP.frequency, t.paramTau, 0.005);
    track('windLP', windLP.frequency, t.paramTau, 0.005);
    track('whistleGain', whistleGain.gain, t.paramTau, 0.01);
    track('whistleHz', whistle.frequency, t.paramTau, 0.004);
    track('buffetGain', buffetGain.gain, t.paramTau, 0.01);
    track('buffetLP', buffetLP.frequency, t.paramTau, 0.01);
    track('tremA', tremA.frequency, t.paramTau, 0.01);
    track('tremB', tremB.frequency, t.paramTau, 0.01);
    track('whooshHz', whooshBP.frequency, t.paramTau, 0.01);
    track('rushGain', rushGain.gain, t.paramTau, 0.01);
    track('rushLP', rushLP.frequency, t.paramTau, 0.01);

    ctx.onstatechange = onStateChange;
    onStateChange();
    st.seenFrames = st.frames;
    st.quietChecks = 0;
    st.watchdog = timers.setInterval(checkIdle, t.idleCheckMs);
    return true;
  }

  function onStateChange() {
    if (ctx && ctx.state === 'running') st.everRan = true;
  }

  /**
   * iOS mutes Web Audio with the ring/silent switch unless the page's audio
   * session is 'playback' — which is what the game's HTML Audio music and
   * effects already get implicitly, so without this the wind would be the
   * one sound the switch silences. Safari 16.4+; unknown inside Chrome on
   * iOS's WKWebView. Feature-detected, never thrown, and only claimed while
   * the flight audio actually has something to play.
   */
  function syncAudioSession() {
    const session = nav && nav.audioSession;
    if (!session || !('type' in session)) { st.sessionType = null; return; }
    try {
      const want = st.volume > 0 ? 'playback' : 'auto';
      if (session.type !== want) session.type = want;
      st.sessionType = session.type;
    } catch (_) {
      st.sessionType = 'error';
    }
  }

  function applyMaster() {
    if (!n) return;
    // No `document.hidden` read here: this runs every frame, and a hidden
    // page arrives as suspend('hidden') from the visibility handler (frames
    // stop anyway). A DOM getter per frame was 1.3 us of a 25 us path.
    send(P.master, st.suspendReason ? 0 : st.volume);
  }

  function checkIdle() {
    if (!ctx || st.suspendReason || ctx.state !== 'running' || st.frames !== st.seenFrames) {
      st.seenFrames = st.frames;
      st.quietChecks = 0;
      return;
    }
    st.quietChecks += 1;
    if (st.quietChecks >= t.idleChecks) suspend('idle');
  }

  function doSuspend() {
    st.suspendTimer = 0;
    if (!ctx || !st.suspendReason || ctx.state !== 'running') return;
    try {
      const p = ctx.suspend();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch (_) { /* ignore */ }
  }

  /** Fade to silence, then suspend the context (battery, and iOS etiquette). */
  function suspend(reason = 'paused') {
    if (!ctx) return;
    st.suspendReason = reason;
    if (n) {
      const rec = P.master;
      rec.last = 0;
      rec.param.setTargetAtTime(0, ctx.currentTime, t.fadeTau);
    }
    if (st.suspendTimer) timers.clearTimeout(st.suspendTimer);
    st.suspendTimer = timers.setTimeout(doSuspend, 120);
  }

  function resume() {
    // Nothing to play is a reason to stay asleep, whatever woke us.
    if (!(st.volume > 0)) { if (ctx) suspend('muted'); return; }
    st.suspendReason = null;
    if (st.suspendTimer) { timers.clearTimeout(st.suspendTimer); st.suspendTimer = 0; }
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      try {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(noop);
      } catch (_) { /* ignore */ }
    }
    applyMaster();
  }

  /**
   * Call from a user gesture. The first call builds the graph (which must
   * happen inside a gesture on iOS); every later call re-resumes a context
   * the OS interrupted. A touchstart is NOT a user activation to Chrome's
   * autoplay policy, and creating a context there logs a warning and leaves
   * it suspended, so a gesture that carries no activation is ignored.
   */
  function unlock(event) {
    if (unavailable) return false;
    const act = nav && nav.userActivation;
    if (act && act.isActive === false) return false;
    if (!act && event && event.type === 'touchstart') return false;
    const fresh = !n;
    if (!n && !build()) return false;
    syncAudioSession();
    if (!(st.volume > 0)) { suspend('muted'); return true; }
    // A tap resumes only what the OS stopped (iOS 'interrupted', or a
    // context that was never allowed to start) — never the game's OWN pause.
    // The gear button's tap bubbles to the page's unlock listener AFTER it
    // has paused the game, and resuming here woke the audio of a paused
    // game (caught by flight-audio-lifecycle). Our pauses are lifted by the
    // next frame, which is what "the game is running" actually means.
    if ((fresh || !st.suspendReason) && !isHidden() && ctx.state !== 'running') resume();
    return true;
  }

  function setVolume(masterVolume, sfxEnabled) {
    const v = outputVolume(masterVolume, sfxEnabled);
    const was = st.volume;
    st.volume = v;
    if (!n) return;
    if (v > 0 && !(was > 0)) syncAudioSession();
    if (!(v > 0)) {
      suspend('muted');
      syncAudioSession();
    } else if (st.suspendReason === 'muted') {
      resume();
    } else {
      applyMaster();
    }
  }

  function triggerWhoosh(strength) {
    const level = whooshLevel(strength, t);
    if (!(level > 1e-5)) return;
    const hz = t.whooshHz + t.whooshHzSpan * clamp01(strength / t.whooshFull);
    const peak = level * bandpassMakeup(hz, t.whooshQ, n.rate);
    const p = n.whooshGain.gain;
    const now = ctx.currentTime;
    if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
    else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
    p.linearRampToValueAtTime(peak, now + t.whooshAttack);
    p.setTargetAtTime(0, now + t.whooshAttack, t.whooshDecay);
    send(P.whooshHz, hz);
    st.whooshCount += 1;
    st.whooshLast = level;
  }

  /** Per frame. Zero allocation: numbers in, AudioParam automation out. */
  function update(frame, dt) {
    st.frames = (st.frames + 1) & 0x3fffffff;
    const step = dt > 0 ? dt : 0;
    const raw = frame ? Number(frame.speed) : NaN;
    if (raw === raw && step > 0) {
      const v = Math.abs(raw);
      if (v <= t.maxSpeed) st.speed += (v - st.speed) * (1 - Math.exp(-step / t.speedTau));
    }
    const paused = !frame || !!frame.paused;
    const airborne = !!(frame && frame.airborne) && !paused;
    // The detector runs every frame so its state stays continuous; it only
    // SOUNDS while the bird is in the air.
    const strength = detector.step(frame ? frame.wingAngle : NaN, step);
    if (!n) return;
    // A frame IS the loop running: wake from any pause, hidden tab or idle
    // watchdog — but not from a volume of zero, which only setVolume lifts.
    if (st.suspendReason && st.suspendReason !== 'muted' && !isHidden()) resume();

    const v = paused ? 0 : st.speed;
    const wind = windLevel(v, t);
    const hz = windFrequency(v, t);
    st.wind = wind;
    st.windHz = hz;
    send(P.windHz, hz);
    send(P.windLP, hz * t.windLowpassRatio);
    send(P.windGain, wind * bandpassMakeup(hz, t.windQ, n.rate) / st.windShare);

    const wHz = Math.min(t.whistleHzMax, Math.max(20, aeolianFrequency(v, t.shaftDiameter, t.strouhal)));
    const whistle = whistleLevel(v, t);
    st.whistle = whistle;
    st.whistleHz = wHz;
    send(P.whistleHz, wHz);
    send(P.whistleGain, whistle * st.whistleMakeup);

    const stalled = airborne && !!frame.stalled;
    const buffet = airborne ? buffetLevel(stalled, frame.authority, t, frame.stallMul) : 0;
    st.stalled = stalled;
    st.buffet = buffet;
    const cutoff = t.buffetCutoff + t.buffetCutoffSpan * buffet;
    const rate = buffetRate(buffet, t);
    send(P.buffetLP, cutoff);
    send(P.tremA, rate);
    send(P.tremB, rate * 1.37);
    send(P.buffetGain, buffet * t.buffetMax * lowpassMakeup(cutoff, n.rate) * st.buffetMakeup);

    const rush = airborne ? rushLevel(frame.clearance, v, t) : 0;
    const rushHz = frame && frame.overWater ? t.rushWaterHz : t.rushHz;
    st.rush = rush;
    send(P.rushLP, rushHz);
    send(P.rushGain, rush * lowpassMakeup(rushHz, n.rate));

    if (strength > 0 && airborne) triggerWhoosh(strength);
    applyMaster();
  }

  function probe() {
    return {
      state: unavailable ? 'unavailable' : (ctx ? ctx.state : 'idle'),
      suspendReason: st.suspendReason,
      volume: st.volume,
      speed: +st.speed.toFixed(3),
      windGain: +st.wind.toFixed(5),
      windFreq: +st.windHz.toFixed(1),
      whistleGain: +st.whistle.toFixed(5),
      whistleFreq: +st.whistleHz.toFixed(1),
      buffet: +st.buffet.toFixed(3),
      stalled: st.stalled,
      rush: +st.rush.toFixed(5),
      whooshCount: st.whooshCount,
      whooshLast: +st.whooshLast.toFixed(5),
      downstrokes: detector.count,
      wingVelocity: +detector.velocity.toFixed(3),
      sessionType: st.sessionType,
      sampleRate: ctx ? ctx.sampleRate : null,
      contextTime: ctx ? +ctx.currentTime.toFixed(3) : null,
      everRan: st.everRan,
    };
  }

  /**
   * Debug only (the realism check): read what actually comes OUT. An
   * analyser on the LEFT channel of the master — the analyser would
   * otherwise down-mix decorrelated stereo noise to mono and read it 3 dB
   * low. Created on first use; costs nothing until somebody asks.
   */
  function measure(opts = {}) {
    if (!n) return null;
    let fresh = false;
    if (!n.analyser) {
      // An analyser has heard nothing the moment it is connected: the first
      // read is all zeros, and says so (`fresh`) rather than reading silent.
      fresh = true;
      n.splitter = ctx.createChannelSplitter(2);
      n.analyser = ctx.createAnalyser();
      n.analyser.fftSize = 4096;
      n.analyser.smoothingTimeConstant = 0;
      n.master.connect(n.splitter);
      n.splitter.connect(n.analyser, 0);
      n.timeData = new Float32Array(n.analyser.fftSize);
      n.freqData = new Float32Array(n.analyser.frequencyBinCount);
    }
    const a = n.analyser;
    a.getFloatTimeDomainData(n.timeData);
    a.getFloatFrequencyData(n.freqData);
    let sq = 0;
    for (let i = 0; i < n.timeData.length; i += 1) sq += n.timeData[i] * n.timeData[i];
    const rms = Math.sqrt(sq / n.timeData.length);
    const binHz = ctx.sampleRate / a.fftSize;
    let pw = 0;
    let pwf = 0;
    for (let i = 1; i < n.freqData.length; i += 1) {
      const db = n.freqData[i];
      if (!Number.isFinite(db)) continue;
      const p = Math.pow(10, db / 10);
      pw += p;
      pwf += p * i * binHz;
    }
    const out = { rms, centroidHz: pw > 0 ? pwf / pw : 0, binHz, fresh };
    // The level of a tone at `toneHz` above the noise around it: the peak
    // bin within +-2 bins against the median of the bins 6-40 bins away.
    if (Number(opts.toneHz) > 0) {
      const c = Math.round(opts.toneHz / binHz);
      let peak = -Infinity;
      for (let i = Math.max(1, c - 2); i <= Math.min(n.freqData.length - 1, c + 2); i += 1) {
        if (n.freqData[i] > peak) peak = n.freqData[i];
      }
      const ring = [];
      for (let k = 6; k <= 40; k += 1) {
        if (c - k > 0) ring.push(n.freqData[c - k]);
        if (c + k < n.freqData.length) ring.push(n.freqData[c + k]);
      }
      ring.sort((x, y) => x - y);
      const floor = ring.length ? ring[Math.floor(ring.length / 2)] : -Infinity;
      out.toneDb = peak;
      out.floorDb = floor;
      out.toneAboveFloorDb = peak - floor;
    }
    return out;
  }

  function dispose() {
    if (st.watchdog) { timers.clearInterval(st.watchdog); st.watchdog = 0; }
    if (st.suspendTimer) { timers.clearTimeout(st.suspendTimer); st.suspendTimer = 0; }
    if (ctx && typeof ctx.close === 'function') {
      try { const p = ctx.close(); if (p && p.catch) p.catch(noop); } catch (_) { /* ignore */ }
    }
    ctx = null;
    n = null;
  }

  return {
    unlock,
    update,
    setVolume,
    suspend,
    resume,
    ensureContext,
    probe,
    measure,
    dispose,
    detector,
    get context() { return ctx; },
    get built() { return !!n; },
  };
}
