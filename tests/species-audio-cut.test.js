// A species swap must not CLICK. silenceSpeciesVoice cuts the old bird's
// gains to 0 from wherever they are at the swap; a swap that lands inside a
// ramp — a tick's 2 ms attack, a caw note's rise, a decay — used to drop that
// ramp (cancelScheduledValues removes every event at or after `now`), and
// the cut's decay then started from the value the ramp STARTED at: a step in
// the gain. Here each AudioParam is a small model of the Web Audio timeline
// (setValueAtTime, linear and exponential ramps, setTargetAtTime, cancel,
// cancelAndHoldAtTime), evaluated at any time, and `.value` is the computed
// value at the context's current time, as a browser reports it. The swap is
// checked for continuity at the instant it lands, with and without
// cancelAndHoldAtTime (older Safari has none), through both ways a swap
// reaches the voice: setSpecies, and a frame naming another bird.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightAudio, FLIGHT_AUDIO_TUNING as T } from '../src/audio/flight-audio.js';

/** The value of a sorted event list at time `t` (Web Audio's rules). */
function evaluate(events, t, initial) {
  let i = -1;
  for (let k = 0; k < events.length && events[k].time <= t; k++) i = k;
  const next = events[i + 1];
  if (next && (next.type === 'linear' || next.type === 'exp') && i >= 0) {
    const e = events[i];
    const t0 = e.time;
    const v0 = evaluate(events.slice(0, i + 1), t0, initial);
    const f = (t - t0) / (next.time - t0);
    if (next.type === 'linear') return v0 + (next.value - v0) * f;
    // An exponential ramp between values of different sign (or from 0) holds.
    if (!(v0 * next.value > 0)) return v0;
    return v0 * Math.pow(next.value / v0, f);
  }
  if (i < 0) return initial;
  const e = events[i];
  if (e.type === 'target') {
    const v0 = evaluate(events.slice(0, i), e.time, initial);
    return e.value + (v0 - e.value) * Math.exp(-(t - e.time) / e.tau);
  }
  return e.value; // set, hold, and a ramp once it has ended
}

function modelParam(clock, initial, { hold }) {
  const p = {
    events: [],
    calls: [],
    get value() { return evaluate(p.events, clock.currentTime, initial); },
    set value(v) {
      if (p.events.length) p.setValueAtTime(v, clock.currentTime);
      else initial = v;
    },
    at(t) { return evaluate(p.events, t, initial); },
    _add(type, value, time, tau) {
      // Sorted by time; a later insert goes after equal times (the spec).
      let i = p.events.length;
      while (i > 0 && p.events[i - 1].time > time) i -= 1;
      p.events.splice(i, 0, { type, value, time, tau });
      return p;
    },
    setValueAtTime(v, time) { p.calls.push(['set', v, time]); return p._add('set', v, time); },
    linearRampToValueAtTime(v, time) { p.calls.push(['linear', v, time]); return p._add('linear', v, time); },
    exponentialRampToValueAtTime(v, time) { p.calls.push(['exp', v, time]); return p._add('exp', v, time); },
    setTargetAtTime(v, time, tau) { p.calls.push(['target', v, time, tau]); return p._add('target', v, time, tau); },
    cancelScheduledValues(time) {
      p.calls.push(['cancel', time]);
      p.events = p.events.filter((e) => e.time < time);
      return p;
    },
  };
  if (hold) {
    // Holds the value the timeline had at `time`, a ramp in flight included,
    // and removes every event after it.
    p.cancelAndHoldAtTime = (time) => {
      p.calls.push(['hold', time]);
      const v = evaluate(p.events, time, initial);
      p.events = p.events.filter((e) => e.time <= time);
      return p._add('set', v, time);
    };
  }
  return p;
}

function makeAudio({ hold }) {
  const all = [];
  class Ctx {
    constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended'; this.destination = { connect() {} }; }
    _node(kind, extra = {}) {
      const node = { kind, out: null, connect(to) { node.out = to; }, disconnect() {}, start() {}, stop() {}, ...extra };
      all.push(node);
      return node;
    }
    _param(v) { return modelParam(this, v, { hold }); }
    createGain() { return this._node('gain', { gain: this._param(1) }); }
    createOscillator() { return this._node('osc', { type: 'sine', frequency: this._param(440), detune: this._param(0), setPeriodicWave() {} }); }
    createBiquadFilter() { return this._node('biquad', { type: 'lowpass', frequency: this._param(350), Q: this._param(1) }); }
    createBufferSource() { return this._node('source', { buffer: null, loop: false, playbackRate: this._param(1) }); }
    createBuffer(ch, len, rate) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (c) => d[c] }; }
    createPeriodicWave() { return {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const timers = { setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {} };
  const fa = createFlightAudio({ AudioContext: Ctx, navigator: { userActivation: { isActive: true } }, document: { hidden: false }, timers });
  fa.setVolume(0.8, true);
  fa.unlock({ type: 'click' });
  const voice = () => {
    const caw = all.find((x) => x.kind === 'osc' && x.type === 'sawtooth');
    const bp = (hz) => all.find((x) => x.kind === 'biquad' && x.type === 'bandpass' && x.frequency.at(0) === hz);
    return { cawGain: caw.out.out.gain, tickGain: bp(T.owlTickHz).out.gain, whirGain: bp(T.owlWhirHz).out.gain };
  };
  return { fa, ctx: () => fa.context, voice };
}

const frame = (extra = {}) => ({
  speed: 11, paused: false, airborne: true, stalled: false, authority: 1, stallMul: 0.5,
  wingAngle: 0, clearance: 40, overWater: false, ...extra,
});

/**
 * Swap at `swap` (by setSpecies or by a frame) and check the gain `p` is
 * continuous there: the cut starts from exactly the value the timeline had
 * at that instant, moves smoothly away from it, and decays to silence.
 */
function assertSmoothCut(p, swap, doSwap, label) {
  const before = p.at(swap);
  assert.ok(before > 1e-4, `${label}: the gain is sounding at the swap (${before})`);
  doSwap();
  const at = p.at(swap);
  const soon = p.at(swap + 1e-5); // half a sample at 48 kHz
  assert.ok(Math.abs(at - before) <= 1e-9 * before, `${label}: a step at the swap, ${before} -> ${at}`);
  assert.ok(soon <= at && at - soon <= 0.01 * before, `${label}: no jump just after the swap (${at} -> ${soon})`);
  // Smooth all the way down: no sample-to-sample step bigger than the cut's
  // own exponential allows, and silent within 12 time constants.
  const step = 1 / 48000;
  let prev = at;
  for (let t = swap + step; t < swap + 12 * T.speciesCutTau; t += step) {
    const v = p.at(t);
    assert.ok(v <= prev + 1e-12 && prev - v <= prev * (step / T.speciesCutTau) + 1e-12, `${label}: a discontinuity at ${t}`);
    prev = v;
  }
  assert.ok(p.at(swap + 12 * T.speciesCutTau) < before * 1e-5, `${label}: not silent after the cut`);
  assert.deepEqual(p.events.filter((e) => e.time > swap), [], `${label}: events left after the swap`);
}

const ROUTES = {
  setSpecies: (fa, to) => () => fa.setSpecies(to),
  frame: (fa, to) => () => fa.update(frame({ species: to }), 1 / 60),
};

for (const hold of [true, false]) {
  const how = hold ? 'with cancelAndHoldAtTime' : 'without cancelAndHoldAtTime';
  for (const route of Object.keys(ROUTES)) {
    test(`owl tick: a swap during the ATTACK ramp and during the DECAY does not click (${how}, via ${route})`, () => {
      // The tick: hold at 3, linear rise to its peak over 2 ms, then decay.
      for (const swap of [3.001, 3.0015, 3.01, 3.03]) {
        const { fa, ctx, voice } = makeAudio({ hold });
        fa.setSpecies('owl');
        ctx().currentTime = 3;
        fa.update(frame({ species: 'owl', speciesTick: true }), 1 / 60);
        const v = voice();
        ctx().currentTime = swap;
        assertSmoothCut(v.tickGain, swap, ROUTES[route](fa, 'crow'), `tick @${swap}`);
      }
    });

    test(`crow caw: a swap during a note's rise and during its decay does not click (${how}, via ${route})`, () => {
      // Note one rises over 15 ms from 5; note two starts at 5 + gap.
      for (const swap of [5.004, 5.012, 5.08, 5 + T.crowCawGap + 0.007, 5 + T.crowCawGap + 0.1]) {
        const { fa, ctx, voice } = makeAudio({ hold });
        fa.setSpecies('crow');
        ctx().currentTime = 5;
        fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
        const v = voice();
        ctx().currentTime = swap;
        assertSmoothCut(v.cawGain, swap, ROUTES[route](fa, 'owl'), `caw @${swap}`);
      }
    });

    test(`explicit linear and exponential ramps, rising and falling, are cut from where they are (${how}, via ${route})`, () => {
      for (const [type, from, to] of [['linear', 0.001, 0.05], ['linear', 0.05, 0.001], ['exp', 0.001, 0.05], ['exp', 0.05, 0.001]]) {
        const { fa, ctx, voice } = makeAudio({ hold });
        fa.setSpecies('crow');
        const p = voice().cawGain;
        p.setValueAtTime(from, 1);
        if (type === 'linear') p.linearRampToValueAtTime(to, 1.2);
        else p.exponentialRampToValueAtTime(to, 1.2);
        ctx().currentTime = 1.07;
        assertSmoothCut(p, 1.07, ROUTES[route](fa, 'birb'), `${type} ${from}->${to}`);
      }
    });
  }

  test(`the cut's calls: hold (or read, cancel, set) at the swap, then decay to 0 (${how})`, () => {
    const { fa, ctx, voice } = makeAudio({ hold });
    fa.setSpecies('owl');
    ctx().currentTime = 3;
    fa.update(frame({ species: 'owl', speciesTick: true }), 1 / 60);
    const p = voice().tickGain;
    ctx().currentTime = 3.001;
    const mid = p.at(3.001);
    p.calls.length = 0;
    fa.setSpecies('crow');
    if (hold) assert.deepEqual(p.calls, [['hold', 3.001], ['target', 0, 3.001, T.speciesCutTau]]);
    else assert.deepEqual(p.calls, [['cancel', 3.001], ['set', mid, 3.001], ['target', 0, 3.001, T.speciesCutTau]]);
  });
}

test('the model sees the click the old cut made (cancelScheduledValues, then decay): the check is not vacuous', () => {
  const clock = { currentTime: 3 };
  const p = modelParam(clock, 0, { hold: false });
  // The tick envelope, as envelope() schedules it.
  p.setValueAtTime(0, 3);
  p.linearRampToValueAtTime(0.05, 3.002);
  p.setTargetAtTime(0, 3.002, T.owlTickDecay);
  const before = p.at(3.001);
  p.cancelScheduledValues(3.001);
  p.setTargetAtTime(0, 3.001, T.speciesCutTau);
  assert.ok(Math.abs(before - 0.025) < 1e-9);
  assert.equal(p.at(3.001), 0, 'the old cut dropped half the peak in one sample');
});
