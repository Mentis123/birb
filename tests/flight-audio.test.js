// tests/flight-audio.test.js — hear the air: the mappings, the downstroke
// detector, and the graph's promise that a frame never creates a node.
//
// The mappings are the whole design in numbers, so each test states the
// property the sound depends on rather than a tuned value: the wind is
// monotonic and capped, the whistle is Strouhal's law and sits ABOVE the
// wind's band (below it, it is masked), the buffet only exists near or at
// the stall, the volume is the player's. The makeup gains are checked
// against a real cookbook biquad run over real noise, because a makeup that
// is only consistent with its own formula proves nothing about the output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLIGHT_AUDIO_TUNING as T,
  windLevel, windFrequency, aeolianFrequency, whistleLevel, buffetLevel, buffetRate,
  rushLevel, whooshLevel, outputVolume, bandpassMakeup, lowpassMakeup, lowpassedBandShare, partialsRms,
  createDownstrokeDetector, createFlightAudio, smoothstep, clamp01,
} from '../src/audio/flight-audio.js';
import { wingBeat } from '../src/flight/bird-pose.js';

const dB = (a, b) => 20 * Math.log10(a / b);

// ---- helpers --------------------------------------------------------------

test('clamp01 and smoothstep, including the falling form', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(NaN), 0);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(10, 2, 10), 0);
  assert.equal(smoothstep(10, 2, 2), 1);
  assert.ok(smoothstep(10, 2, 4) > smoothstep(10, 2, 8));
});

// ---- wind -------------------------------------------------------------------

test('wind: silent at rest and at walking pace, monotonic in speed, capped', () => {
  assert.equal(windLevel(0), 0);
  assert.equal(windLevel(T.windFloor), 0);
  assert.equal(windLevel(NaN), 0);
  assert.equal(windLevel(undefined), 0);
  let prev = 0;
  for (let v = 0; v <= 80; v += 0.25) {
    const g = windLevel(v);
    assert.ok(g >= prev - 1e-12, `wind fell from ${prev} to ${g} at ${v} u/s`);
    assert.ok(g <= T.windMax + 1e-12, `wind ${g} exceeded its cap at ${v} u/s`);
    prev = g;
  }
  assert.ok(Math.abs(windLevel(T.windRef) - T.windMax) < 1e-12, 'reaches the cap at windRef');
  assert.equal(windLevel(200), T.windMax);
  assert.equal(windLevel(-20), windLevel(20), 'speed sign does not matter');
});

test('wind: the aerodynamic power law — RMS as V^2.5 between floor and cap', () => {
  // Power ~ V^5 (trailing-edge noise), so doubling the speed is +15 dB.
  const ratio = windLevel(20) / windLevel(10);
  assert.ok(Math.abs(ratio - Math.pow(2, 2.5)) < 1e-9, `ratio ${ratio}`);
  assert.ok(Math.abs(dB(windLevel(20), windLevel(10)) - 15.05) < 0.01);
});

test('wind: cruise is a texture, a sprint is loud — the dynamic range the design rests on', () => {
  const cruise = windLevel(11);
  const sprint = windLevel(24);
  assert.ok(dB(T.windMax, cruise) > 20, `cruise only ${dB(T.windMax, cruise).toFixed(1)} dB under the cap`);
  assert.ok(dB(sprint, cruise) > 15, `sprint only ${dB(sprint, cruise).toFixed(1)} dB over cruise`);
});

test('wind: band centre proportional to speed, clamped to 400-2000 Hz', () => {
  assert.equal(windFrequency(0), T.windHzMin);
  assert.equal(windFrequency(100), T.windHzMax);
  assert.equal(windFrequency(10), 750);
  assert.equal(windFrequency(20), 1500);
  let prev = 0;
  for (let v = 0; v <= 60; v += 0.5) {
    const f = windFrequency(v);
    assert.ok(f >= prev && f >= 400 && f <= 2000, `${f} Hz at ${v}`);
    prev = f;
  }
});

// ---- whistle ----------------------------------------------------------------

test('aeolian frequency is Strouhal: f = 0.2 V / d', () => {
  assert.ok(Math.abs(aeolianFrequency(10, 0.002, 0.2) - 1000) < 1e-9);
  assert.ok(Math.abs(aeolianFrequency(24, 0.0012) - 4000) < 1e-9);
  assert.ok(Math.abs(aeolianFrequency(30, 0.0012) / aeolianFrequency(15, 0.0012) - 2) < 1e-12, 'linear in V');
  assert.ok(Math.abs(aeolianFrequency(20, 0.001) / aeolianFrequency(20, 0.002) - 2) < 1e-12, 'inverse in d');
  assert.equal(aeolianFrequency(20, 0), 0);
  assert.equal(aeolianFrequency(20, -1), 0);
  assert.equal(aeolianFrequency(-20, 0.002), aeolianFrequency(20, 0.002));
});

test('whistle: silent at cruise and on a boost start, audible only at speed, capped', () => {
  assert.equal(whistleLevel(11), 0);
  assert.equal(whistleLevel(T.whistleOnset), 0);
  assert.ok(whistleLevel(24) > 0);
  let prev = 0;
  for (let v = 0; v <= 60; v += 0.5) {
    const g = whistleLevel(v);
    assert.ok(g >= prev - 1e-12 && g <= T.whistleMax + 1e-12);
    prev = g;
  }
  assert.equal(whistleLevel(T.whistleFull), T.whistleMax);
});

test('whistle sits ABOVE the wind band at every speed it sounds — below it, it is masked', () => {
  // Measured when the shaft was 2 mm: 2.4 kHz inside a 1.8 kHz band, ~8 dB
  // under the in-band noise. The whistle must clear the wind's lowpass.
  for (let v = T.whistleOnset; v <= 60; v += 1) {
    const whistle = Math.min(T.whistleHzMax, aeolianFrequency(v));
    const windTop = windFrequency(v) * T.windLowpassRatio;
    assert.ok(whistle > windTop, `at ${v} u/s the whistle ${whistle.toFixed(0)} Hz is inside the wind (top ${windTop.toFixed(0)} Hz)`);
  }
});

// ---- buffet -------------------------------------------------------------------

test('buffet: nothing in ordinary flight, nothing without a stall model', () => {
  // G-STUNT-1's climb table: a 50-degree climb settles at 7.75 of 11
  // (authority 0.70) and must be silent — a buffet in an ordinary steep
  // climb is the "it stalls too much" complaint in sound form.
  assert.equal(buffetLevel(false, 7.75 / 11), 0);
  assert.equal(buffetLevel(false, 1), 0);
  assert.equal(buffetLevel(false, 1.2), 0);
  assert.equal(buffetLevel(false, 0.5 + T.buffetMargin), 0);
  assert.equal(buffetLevel(false, NaN), 0, 'no authority (classic, v2, a boost) is no buffet');
  assert.equal(buffetLevel(false, undefined), 0);
});

test('buffet: rises smoothly toward the stall line and is strongest in a deep stall', () => {
  const near = buffetLevel(false, 0.5 + T.buffetMargin / 2);
  const onLine = buffetLevel(false, 0.5);
  assert.ok(near > 0 && near < onLine, `near ${near} on-line ${onLine}`);
  assert.ok(Math.abs(onLine - 0.55) < 1e-9);
  const stalled = buffetLevel(true, 0.49);
  const deep = buffetLevel(true, 0.36);
  assert.ok(stalled >= 0.7 && deep > stalled && deep <= 1, `stalled ${stalled} deep ${deep}`);
  assert.equal(buffetLevel(true, NaN), 1, 'a reported stall with no authority reads as full');
  let prev = 0;
  for (let a = 1.2; a >= 0.35; a -= 0.01) {
    const b = buffetLevel(a < 0.5, a);
    assert.ok(b >= prev - 1e-9 && b <= 1, `buffet ${b} at authority ${a.toFixed(2)}`);
    prev = b;
  }
});

test('buffet tremolo: 6 Hz at onset, 10 Hz deep in, clamped', () => {
  assert.equal(buffetRate(0), 6);
  assert.equal(buffetRate(1), 10);
  assert.equal(buffetRate(5), 10);
  assert.equal(buffetRate(-1), 6);
  assert.ok(buffetRate(0.5) > 6 && buffetRate(0.5) < 10);
});

// ---- rush, whoosh, volume -------------------------------------------------------

test('rush: only close to the ground and only when moving', () => {
  assert.equal(rushLevel(Infinity, 20), 0);
  assert.equal(rushLevel(NaN, 20), 0);
  assert.equal(rushLevel(T.rushRange + 1, 20), 0);
  assert.equal(rushLevel(0.5, 0), 0);
  assert.ok(rushLevel(1, 20) > rushLevel(5, 20));
  assert.ok(rushLevel(1, 20) > rushLevel(1, 10));
  assert.ok(rushLevel(0, 100) <= T.rushMax + 1e-12);
});

test('whoosh: silent for no stroke, monotonic in stroke speed, capped', () => {
  assert.equal(whooshLevel(0), 0);
  assert.equal(whooshLevel(-5), 0);
  assert.equal(whooshLevel(NaN), 0);
  assert.ok(whooshLevel(3) < whooshLevel(6));
  assert.equal(whooshLevel(T.whooshFull), T.whooshMax);
  assert.equal(whooshLevel(100), T.whooshMax);
});

test('volume: the master slider scales it, the SFX switch silences it', () => {
  assert.equal(outputVolume(0.7, true), 0.7);
  assert.equal(outputVolume(0.7, false), 0);
  assert.equal(outputVolume(0, true), 0);
  assert.equal(outputVolume(1.5, true), 1);
  assert.equal(outputVolume(NaN, true), 0);
  assert.equal(outputVolume('0.4', true), 0.4);
});

// ---- makeup gains, against a real filter over real noise --------------------

function rbjBandpass(f0, Q, fs) {
  const w = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w) / (2 * Q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - alpha) / a0 };
}
function rbjLowpass(fc, Qlin, fs) {
  const w = 2 * Math.PI * fc / fs;
  const alpha = Math.sin(w) / (2 * Qlin);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - alpha) / a0 };
}
/** RMS of uniform white noise through one biquad, or a cascade of them. */
function filteredNoiseRms(coefs, n = 1 << 17) {
  const chain = Array.isArray(coefs) ? coefs : [coefs];
  const z = chain.map(() => [0, 0, 0, 0]);
  let s = 0x2545f491;
  let sq = 0;
  for (let i = 0; i < n; i += 1) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    let x = ((s >>> 0) / 4294967296) * 2 - 1;
    for (let k = 0; k < chain.length; k += 1) {
      const c = chain[k]; const m = z[k];
      const y = c.b0 * x + c.b1 * m[0] + c.b2 * m[1] - c.a1 * m[2] - c.a2 * m[3];
      m[1] = m[0]; m[0] = x; m[3] = m[2]; m[2] = y;
      x = y;
    }
    if (i > 4096) sq += x * x;
  }
  return Math.sqrt(sq / (n - 4097));
}

test('bandpass makeup brings white noise through the cookbook BPF to unit RMS (±12%)', () => {
  for (const [f0, Q] of [[400, 0.8], [1000, 0.8], [2000, 0.8], [500, 0.9]]) {
    const rms = filteredNoiseRms(rbjBandpass(f0, Q, 48000));
    const out = rms * bandpassMakeup(f0, Q, 48000);
    assert.ok(out > 0.88 && out < 1.12, `BPF ${f0} Hz Q${Q}: makeup lands at ${out.toFixed(3)} RMS`);
  }
});

test('lowpass makeup brings white noise through a Butterworth LPF to unit RMS (±12%)', () => {
  for (const fc of [300, 460, 700, 1600]) {
    const rms = filteredNoiseRms(rbjLowpass(fc, Math.SQRT1_2, 48000));
    const out = rms * lowpassMakeup(fc, 48000);
    assert.ok(out > 0.88 && out < 1.12, `LPF ${fc} Hz: makeup lands at ${out.toFixed(3)} RMS`);
  }
});

test('the wind chain (lowpass at 2x, then bandpass) lands at unit RMS with its share correction (±8%)', () => {
  // Without lowpassedBandShare the plain bandpass makeup lands at ~0.75:
  // the wind would play 2.4 dB under the level it reports.
  const share = lowpassedBandShare(T.windQ, T.windLowpassRatio);
  assert.ok(share > 0.6 && share < 0.9, `share ${share}`);
  assert.equal(lowpassedBandShare(T.windQ, 1e6) > 0.999, true, 'a lowpass far above the band keeps it all');
  for (const f0 of [400, 1000, 1800]) {
    const rms = filteredNoiseRms([
      rbjLowpass(f0 * T.windLowpassRatio, Math.SQRT1_2, 48000),
      rbjBandpass(f0, T.windQ, 48000),
    ]);
    const out = rms * bandpassMakeup(f0, T.windQ, 48000) / share;
    assert.ok(out > 0.92 && out < 1.08, `wind chain at ${f0} Hz lands at ${out.toFixed(3)} RMS`);
  }
});

test('partialsRms: a pure sine is 1/sqrt2; the whistle partials stay near it', () => {
  assert.ok(Math.abs(partialsRms([1]) - Math.SQRT1_2) < 1e-3);
  const r = partialsRms(T.whistlePartials);
  assert.ok(r > 0.6 && r < 0.8, `whistle partials RMS ${r}`);
});

// ---- the downstroke detector --------------------------------------------------

function runDetector(det, angleAt, seconds, fps) {
  const dt = 1 / fps;
  let fires = 0;
  let maxStrength = 0;
  for (let i = 0; i <= Math.round(seconds * fps); i += 1) {
    const s = det.step(angleAt(i * dt), i === 0 ? 0 : dt);
    if (s > 0) { fires += 1; maxStrength = Math.max(maxStrength, s); }
  }
  return { fires, maxStrength };
}

test('detector: exactly one fire per cycle of a sine, at 20, 60 and 144 fps', () => {
  for (const fps of [20, 60, 144]) {
    for (const [hz, amp] of [[4, 0.3], [2.6, 0.2], [6, 0.25]]) {
      const det = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
      const seconds = 5;
      const { fires } = runDetector(det, (t) => amp * Math.sin(2 * Math.PI * hz * t), seconds, fps);
      const cycles = hz * seconds;
      assert.ok(Math.abs(fires - cycles) <= 1, `${hz} Hz x ${amp} rad at ${fps} fps: ${fires} fires for ${cycles} cycles`);
    }
  }
});

test('detector: one fire per beat of the rig\'s own asymmetric wingBeat()', () => {
  // The rig writes base + wingBeat(t * rate).angle into leftWing.rotation.x.
  for (const rate of [2.6, 4.4]) {
    const det = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
    const seconds = 6;
    const { fires } = runDetector(det, (t) => -0.08 + wingBeat(t * rate).angle, seconds, 60);
    assert.ok(Math.abs(fires - rate * seconds) <= 1, `rate ${rate}: ${fires} fires for ${rate * seconds} beats`);
  }
});

test('detector: never fires on motion below its thresholds', () => {
  // A random walk whose velocity never leaves +-0.9 rad/s (under rearm AND fire).
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const det = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
  let angle = 0;
  for (let i = 0; i < 60 * 30; i += 1) {
    angle += (rnd() * 1.8 - 0.9) / 60;
    assert.equal(det.step(angle, 1 / 60), 0, `fired on sub-threshold noise at step ${i}`);
  }
  // Idle flutter (0.035 rad at 1.7 rad/s) and per-frame jitter.
  const det2 = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
  const quiet = runDetector(det2, (t) => 0.035 * Math.sin(1.7 * t) + 0.002 * Math.sin(977 * t), 20, 60);
  assert.equal(quiet.fires, 0);
});

test('detector: a downward drift with no upstroke never arms, so never fires', () => {
  const det = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
  const { fires } = runDetector(det, (t) => 3 * t, 3, 60);
  assert.equal(fires, 0);
});

test('detector: a discontinuity (model swap, forced pose) disarms instead of firing', () => {
  const det = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
  det.step(0, 0);
  det.step(-0.1, 1 / 60); // an upstroke: armed
  assert.equal(det.armed, true);
  assert.equal(det.step(2.5, 1 / 60), 0, 'a 2.6 rad jump in one frame is not a stroke');
  assert.equal(det.armed, false);
});

test('detector: a paused frame (dt 0) neither fires nor invents a velocity', () => {
  const det = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
  det.step(0, 0);
  det.step(-0.1, 1 / 60);
  assert.equal(det.step(0.5, 0), 0);
  // After the pause the next real frame measures from the paused sample.
  assert.equal(det.step(0.5, 1 / 60), 0);
  assert.equal(det.velocity, 0);
});

test('detector: a slow stroke after a fast burst reports its OWN peak', () => {
  // The first cut fired at the threshold crossing and patched the level with
  // a decaying memory of earlier strokes: on exactly this input it reported
  // the 2.83 rad/s strokes as 5.68, 3.28, then 1.99 (the crossing value) —
  // too loud after the burst, too quiet once it faded. Firing at the stroke's
  // own peak needs no memory at all.
  const det = createDownstrokeDetector({ fire: T.whooshFire, rearm: T.whooshRearm });
  const fast = (t) => 0.5 * Math.sin(2 * Math.PI * 3 * t);   // peak 9.4 rad/s
  const slow = (t) => 0.15 * Math.sin(2 * Math.PI * 3 * t);  // peak 2.8 rad/s
  const strengths = [];
  for (let i = 0; i <= 60 * 4; i += 1) {
    const t = i / 60;
    const s = det.step(t < 2 ? fast(t) : slow(t), i === 0 ? 0 : 1 / 60);
    if (s > 0) strengths.push({ t, s });
  }
  const after = strengths.filter((x) => x.t > 2.2).map((x) => x.s);
  assert.ok(after.length >= 4, `slow strokes detected: ${after.length}`);
  for (const s of after) assert.ok(s < 3.0, `a 2.8 rad/s stroke reported ${s.toFixed(2)}`);
});

test('detector: it fires at the stroke\'s velocity peak, one sample after it', () => {
  const det = createDownstrokeDetector({ fire: 1.5, rearm: 1.0 });
  // Up, then a downstroke whose sampled velocities are 2, 5, 8, 6, 3, -1.
  const vel = [-3, -3, 2, 5, 8, 6, 3, -1];
  let a = 0;
  det.step(a, 0);
  const out = [];
  for (const v of vel) { a += v * 0.05; out.push(det.step(a, 0.05)); }
  assert.deepEqual(out.map((x) => +x.toFixed(6)), [0, 0, 0, 0, 0, 8, 0, 0]);
  assert.equal(det.count, 1);
});

test('detector: strength follows the stroke — a harder beat reports more', () => {
  const soft = runDetector(createDownstrokeDetector(), (t) => 0.1 * Math.sin(2 * Math.PI * 3 * t), 4, 60);
  const hard = runDetector(createDownstrokeDetector(), (t) => 0.5 * Math.sin(2 * Math.PI * 3 * t), 4, 60);
  assert.ok(hard.maxStrength > 2 * soft.maxStrength, `soft ${soft.maxStrength} hard ${hard.maxStrength}`);
  // The peak of 0.5 sin(6 pi t) is 9.42 rad/s; memory lets the prediction reach it.
  assert.ok(hard.maxStrength > 0.7 * 0.5 * 6 * Math.PI, `hard ${hard.maxStrength}`);
});

// ---- the graph, against a fake AudioContext -----------------------------------

function makeFakeAudio() {
  const log = { contexts: 0, nodes: 0, automation: [], resumed: 0, suspended: 0 };
  const param = (value) => {
    const p = {
      value,
      calls: 0,
      setTargetAtTime(v) { p.calls += 1; log.automation.push('target'); p.value = v; return p; },
      linearRampToValueAtTime(v) { p.calls += 1; log.automation.push('ramp'); return p; },
      setValueAtTime(v) { p.calls += 1; log.automation.push('set'); p.value = v; return p; },
      cancelScheduledValues() { p.calls += 1; log.automation.push('cancel'); return p; },
      cancelAndHoldAtTime() { p.calls += 1; log.automation.push('cancelAndHold'); return p; },
    };
    return p;
  };
  class FakeContext {
    constructor() {
      log.contexts += 1;
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.state = 'suspended';
      this.destination = { connect() {} };
      this.onstatechange = null;
    }
    _node(extra = {}) {
      log.nodes += 1;
      return { connect() {}, disconnect() {}, start() {}, stop() {}, ...extra };
    }
    createGain() { return this._node({ gain: param(1) }); }
    createOscillator() {
      return this._node({ type: 'sine', frequency: param(440), detune: param(0), setPeriodicWave() {} });
    }
    createBiquadFilter() { return this._node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createBufferSource() { return this._node({ buffer: null, loop: false, playbackRate: param(1) }); }
    createBuffer(ch, len, rate) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (c) => data[c] };
    }
    createPeriodicWave() { return {}; }
    createChannelSplitter() { return this._node(); }
    createAnalyser() {
      return this._node({
        fftSize: 2048,
        get frequencyBinCount() { return this.fftSize / 2; },
        getFloatTimeDomainData(a) { a.fill(0.1); },
        getFloatFrequencyData(a) { a.fill(-60); },
      });
    }
    resume() { log.resumed += 1; this.state = 'running'; return Promise.resolve(); }
    suspend() { log.suspended += 1; this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const timers = {
    pending: [],
    intervals: [],
    setTimeout(fn) { timers.pending.push(fn); return timers.pending.length; },
    clearTimeout() {},
    setInterval(fn) { timers.intervals.push(fn); return timers.intervals.length; },
    clearInterval() {},
    flush() { const p = timers.pending.splice(0); for (const fn of p) fn(); },
    tickInterval() { for (const fn of timers.intervals) fn(); },
  };
  return { FakeContext, log, timers };
}

function makeAudio(extra = {}) {
  const fake = makeFakeAudio();
  const nav = extra.navigator || { userActivation: { isActive: true } };
  const doc = extra.document || { hidden: false };
  const fa = createFlightAudio({
    AudioContext: fake.FakeContext, navigator: nav, document: doc, timers: fake.timers,
  });
  return { fa, fake, nav, doc };
}

const frame = () => ({
  speed: 11, paused: false, airborne: true, stalled: false, authority: 1, stallMul: 0.5,
  wingAngle: 0, clearance: 40, overWater: false,
});

test('graph: nothing is created before a gesture, and update() is safe without one', () => {
  const { fa, fake } = makeAudio();
  fa.setVolume(0.7, true);
  fa.update(frame(), 1 / 60);
  assert.equal(fake.log.contexts, 0);
  assert.equal(fa.probe().state, 'idle');
});

test('graph: a touchstart without user activation builds nothing (Chrome would warn)', () => {
  const { fa, fake } = makeAudio({ navigator: { userActivation: { isActive: false } } });
  fa.setVolume(0.7, true);
  assert.equal(fa.unlock({ type: 'touchstart' }), false);
  assert.equal(fake.log.contexts, 0);
  const { fa: fb, fake: fakeB } = makeAudio({ navigator: {} });
  fb.setVolume(0.7, true);
  assert.equal(fb.unlock({ type: 'touchstart' }), false, 'no userActivation API: touchstart is still not a gesture');
  assert.equal(fb.unlock({ type: 'touchend' }), true);
  assert.equal(fakeB.log.contexts, 1);
});

test('graph: one context, a fixed set of nodes, and NO node per frame or per beat', () => {
  const { fa, fake } = makeAudio();
  fa.setVolume(0.7, true);
  assert.equal(fa.unlock(), true);
  assert.equal(fake.log.contexts, 1);
  assert.equal(fa.probe().state, 'running', 'resumed inside the gesture');
  const nodesAfterBuild = fake.log.nodes;
  assert.ok(nodesAfterBuild > 10);
  const f = frame();
  for (let i = 0; i < 3000; i += 1) {
    fa.context.currentTime += 1 / 60;
    f.speed = 8 + 16 * (0.5 + 0.5 * Math.sin(i / 300));
    f.wingAngle = 0.3 * Math.sin(2 * Math.PI * 4 * (i / 60));
    f.stalled = i % 500 < 50;
    f.authority = f.stalled ? 0.45 : 1;
    fa.update(f, 1 / 60);
  }
  assert.equal(fake.log.nodes, nodesAfterBuild, 'the frame loop created nodes');
  assert.equal(fake.log.contexts, 1);
  const p = fa.probe();
  assert.ok(p.whooshCount >= 190 && p.whooshCount <= 201, `whooshCount ${p.whooshCount} for 200 beats`);
  // A beat is automation: cancel(AndHold) + ramp + target, never a node.
  assert.ok(fake.log.automation.includes('cancelAndHold'));
  assert.ok(fake.log.automation.includes('ramp'));
});

test('graph: a whoosh only sounds in the air', () => {
  const { fa } = makeAudio();
  fa.setVolume(0.7, true);
  fa.unlock();
  const f = frame();
  f.airborne = false;
  for (let i = 0; i < 600; i += 1) {
    fa.context.currentTime += 1 / 60;
    f.wingAngle = 0.3 * Math.sin(2 * Math.PI * 4 * (i / 60));
    fa.update(f, 1 / 60);
  }
  const p = fa.probe();
  assert.equal(p.whooshCount, 0, 'a folded wing on the ground whooshed');
  assert.ok(p.downstrokes >= 39, 'the detector still tracked the wing');
});

test('graph: wind and whistle targets follow speed; buffet follows the stall flag', () => {
  const { fa } = makeAudio();
  fa.setVolume(0.7, true);
  fa.unlock();
  const f = frame();
  const settle = (speed, extra = {}) => {
    Object.assign(f, extra, { speed });
    for (let i = 0; i < 120; i += 1) { fa.context.currentTime += 1 / 60; fa.update(f, 1 / 60); }
    return fa.probe();
  };
  const slow = settle(6);
  const fast = settle(24);
  assert.ok(fast.windGain > 5 * slow.windGain, `wind ${slow.windGain} -> ${fast.windGain}`);
  assert.ok(fast.windFreq > slow.windFreq);
  assert.equal(slow.whistleGain, 0);
  assert.ok(fast.whistleGain > 0);
  assert.equal(fast.buffet, 0);
  const stall = settle(5, { stalled: true, authority: 0.45 });
  assert.ok(stall.buffet >= 0.7, `buffet ${stall.buffet}`);
  const paused = settle(24, { paused: true, stalled: false, authority: 1 });
  assert.equal(paused.windGain, 0, 'a paused frame is silent');
});

test('graph: volume — SFX off silences and suspends, back on resumes; the session follows', () => {
  const session = { type: 'auto' };
  const { fa, fake } = makeAudio({ navigator: { userActivation: { isActive: true }, audioSession: session } });
  fa.setVolume(0.7, true);
  fa.unlock();
  assert.equal(session.type, 'playback', 'Web Audio must not be the one sound the silent switch mutes');
  fa.update(frame(), 1 / 60);
  fa.setVolume(0.7, false);
  fake.timers.flush();
  assert.equal(fa.context.state, 'suspended');
  assert.equal(fa.probe().suspendReason, 'muted');
  assert.equal(session.type, 'auto', 'released when there is nothing to play');
  // A frame does not wake a muted context.
  fa.update(frame(), 1 / 60);
  assert.equal(fa.probe().suspendReason, 'muted');
  fa.setVolume(0.4, true);
  assert.equal(fa.context.state, 'running');
  assert.equal(fa.probe().volume, 0.4);
  assert.equal(session.type, 'playback');
});

test('graph: an audio session that throws is reported, never thrown', () => {
  const session = {};
  Object.defineProperty(session, 'type', { get() { return 'auto'; }, set() { throw new Error('nope'); } });
  const { fa } = makeAudio({ navigator: { userActivation: { isActive: true }, audioSession: session } });
  fa.setVolume(0.7, true);
  assert.doesNotThrow(() => fa.unlock());
  assert.equal(fa.probe().sessionType, 'error');
});

test('graph: a tap does not wake a paused game — the next FRAME does', () => {
  // The gear button pauses the game and its tap then bubbles to the page's
  // unlock listener; that tap must not resume the audio of a paused game.
  const { fa, fake } = makeAudio();
  fa.setVolume(0.7, true);
  fa.unlock();
  fa.update(frame(), 1 / 60);
  fa.suspend('paused');
  fake.timers.flush();
  assert.equal(fa.context.state, 'suspended');
  fa.unlock({ type: 'click' });
  assert.equal(fa.context.state, 'suspended', 'the tap woke a paused game');
  assert.equal(fa.probe().suspendReason, 'paused');
  fa.update(frame(), 1 / 60);
  assert.equal(fa.context.state, 'running');
  // ...while a context the OS interrupted IS resumed by a tap (iOS only
  // allows it inside a gesture).
  fa.context.state = 'interrupted';
  fa.unlock({ type: 'touchend' });
  assert.equal(fa.context.state, 'running');
});

test('graph: muting and unmuting INSIDE the paused settings menu does not wake it', () => {
  // The SFX switch and the master slider live in the settings overlay, which
  // pauses the game. Each tap there runs the control's handler and then
  // bubbles to the page's unlock listener. Unmuting must not resume the
  // audio of a paused game; the next frame does, as for any pause.
  const { fa, fake } = makeAudio();
  fa.setVolume(0.7, true);
  fa.unlock();
  fa.update(frame(), 1 / 60);
  fa.suspend('paused'); fake.timers.flush();
  fa.unlock({ type: 'click' }); // the gear tap
  fa.setVolume(0.7, false); fa.unlock({ type: 'click' }); fake.timers.flush(); // SFX off
  assert.equal(fa.context.state, 'suspended');
  fa.setVolume(0.7, true); fa.unlock({ type: 'click' }); fake.timers.flush(); // SFX on
  assert.equal(fa.context.state, 'suspended', 'unmuting in the menu played the wind over a paused game');
  assert.equal(fa.probe().suspendReason, 'paused');
  fa.update(frame(), 1 / 60);
  assert.equal(fa.context.state, 'running', 'the next frame resumes it');
  // Leave the menu still muted: the first frame settles on 'muted' and the
  // frames after it leave it alone.
  fa.suspend('paused'); fake.timers.flush();
  fa.setVolume(0.7, false); fake.timers.flush();
  fa.update(frame(), 1 / 60); fake.timers.flush();
  assert.equal(fa.probe().suspendReason, 'muted');
  assert.equal(fa.context.state, 'suspended');
  const pendingBefore = fake.timers.pending.length;
  fa.update(frame(), 1 / 60);
  assert.equal(fake.timers.pending.length, pendingBefore, 'a muted frame schedules nothing');
});

test('graph: the idle watchdog counts frames, not time — a stopped loop is suspended', () => {
  // A pause path that does not say so (none known today: hidden, settings and
  // a lost GL context all call suspend) must not leave the wind blowing.
  const { fa, fake } = makeAudio();
  fa.setVolume(0.7, true);
  fa.unlock();
  fa.update(frame(), 1 / 60);
  fake.timers.tickInterval(); // frames arrived since the last check: fine
  assert.equal(fa.probe().suspendReason, null);
  fa.update(frame(), 1 / 60);
  fake.timers.tickInterval();
  fake.timers.tickInterval(); // one quiet check is a hitch...
  assert.equal(fa.probe().suspendReason, null);
  fake.timers.tickInterval(); // ...two in a row is a stopped loop
  assert.equal(fa.probe().suspendReason, 'idle');
  fake.timers.flush();
  assert.equal(fa.context.state, 'suspended');
  fa.update(frame(), 1 / 60);
  assert.equal(fa.context.state, 'running', 'the next frame wakes it');
});

test('graph: hidden suspends; the next frame after it is visible again resumes', () => {
  const { fa, fake, doc } = makeAudio();
  fa.setVolume(0.7, true);
  fa.unlock();
  doc.hidden = true;
  fa.suspend('hidden');
  fake.timers.flush();
  assert.equal(fa.context.state, 'suspended');
  doc.hidden = false;
  fa.update(frame(), 1 / 60);
  assert.equal(fa.context.state, 'running');
  assert.equal(fa.probe().suspendReason, null);
});

test('graph: the chime shares the one context; no Web Audio means state "unavailable"', () => {
  const { fa, fake } = makeAudio();
  const ctx = fa.ensureContext();
  assert.ok(ctx);
  assert.equal(fa.ensureContext(), ctx);
  fa.setVolume(0.7, true);
  fa.unlock();
  assert.equal(fa.context, ctx);
  assert.equal(fake.log.contexts, 1);
  const none = createFlightAudio({ AudioContext: null, navigator: {}, document: { hidden: false } });
  none.setVolume(0.7, true);
  assert.equal(none.unlock(), false);
  assert.equal(none.probe().state, 'unavailable');
  assert.doesNotThrow(() => none.update(frame(), 1 / 60));
});
