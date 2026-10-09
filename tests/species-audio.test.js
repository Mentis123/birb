// The bird picker's voices in src/audio/flight-audio.js: the clockwork owl's
// escapement tick and gear whir, the crow's rate-limited caw. The Pionus's
// audio graph must be exactly what it was: nothing new is built for it, and
// a voice is only ever built by setSpecies (or by the unlock after one),
// never by a frame. A change of bird must leave nothing of the old one on
// the timeline. Same fake AudioContext approach as flight-audio.test.js,
// with every AudioParam keeping its scheduled events (time, value) so a
// cancelScheduledValues can be checked against what was scheduled AHEAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightAudio, FLIGHT_AUDIO_TUNING as T } from '../src/audio/flight-audio.js';

function makeAudio({ unlock = true, hold = true } = {}) {
  const log = { nodes: 0, all: [] };
  const param = (value) => {
    const p = {
      value, events: [],
      _add(type, v, time) {
        // Kept sorted by time, later inserts after equal times (the spec).
        let i = p.events.length;
        while (i > 0 && p.events[i - 1].time > time) i -= 1;
        p.events.splice(i, 0, { type, value: v, time });
        p.value = p.events[p.events.length - 1].value;
        return p;
      },
      setTargetAtTime(v, time) { return p._add('target', v, time); },
      linearRampToValueAtTime(v, time) { return p._add('ramp', v, time); },
      setValueAtTime(v, time) { return p._add('set', v, time); },
      cancelScheduledValues(time) {
        p.events = p.events.filter((e) => e.time < time);
        if (p.events.length) p.value = p.events[p.events.length - 1].value;
        return p;
      },
    };
    // cancelAndHoldAtTime removes events strictly AFTER its time and holds.
    if (hold) {
      p.cancelAndHoldAtTime = (time) => {
        p.events = p.events.filter((e) => e.time <= time);
        return p._add('hold', p.value, time);
      };
    }
    return p;
  };
  class Ctx {
    constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended'; this.destination = { connect() {} }; }
    _node(kind, extra = {}) {
      log.nodes += 1;
      const node = { kind, out: null, connect(to) { node.out = to; }, disconnect() {}, start() {}, stop() {}, ...extra };
      log.all.push(node);
      return node;
    }
    createGain() { return this._node('gain', { gain: param(1) }); }
    createOscillator() { return this._node('osc', { type: 'sine', frequency: param(440), detune: param(0), setPeriodicWave() {} }); }
    createBiquadFilter() { return this._node('biquad', { type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createBufferSource() { return this._node('source', { buffer: null, loop: false, playbackRate: param(1) }); }
    createBuffer(ch, len, rate) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (c) => d[c] }; }
    createPeriodicWave() { return {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const timers = {
    pending: [],
    setTimeout(fn) { timers.pending.push(fn); return timers.pending.length; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    flush() { const p = timers.pending.splice(0); for (const fn of p) fn(); },
  };
  const fa = createFlightAudio({ AudioContext: Ctx, navigator: { userActivation: { isActive: true } }, document: { hidden: false }, timers });
  fa.setVolume(0.8, true);
  if (unlock) fa.unlock({ type: 'click' });
  // The voice's nodes, found by what they are: the caw is the one sawtooth;
  // the tick and whir gains sit after their own bandpasses.
  const voice = () => {
    const caw = log.all.find((x) => x.kind === 'osc' && x.type === 'sawtooth');
    const bp = (hz) => log.all.find((x) => x.kind === 'biquad' && x.type === 'bandpass' && x.frequency.value === hz);
    return {
      caw, cawGain: caw.out.out,
      tickGain: bp(T.owlTickHz).out, whirGain: bp(T.owlWhirHz).out,
    };
  };
  return { fa, log, timers, ctx: () => fa.context, voice };
}

const frame = (extra = {}) => ({
  speed: 11, paused: false, airborne: true, stalled: false, authority: 1, stallMul: 0.5,
  wingAngle: 0, clearance: 40, overWater: false, ...extra,
});

const after = (p, time) => p.events.filter((e) => e.time > time);

/** Every species param holds nothing past `time`, and every gain ends at 0. */
function assertSilencedAt(v, time) {
  for (const [name, p] of [['caw gain', v.cawGain.gain], ['caw pitch', v.caw.frequency],
    ['tick gain', v.tickGain.gain], ['whir gain', v.whirGain.gain]]) {
    assert.deepEqual(after(p, time), [], `${name} still has events after the swap`);
  }
  for (const [name, p] of [['caw', v.cawGain.gain], ['tick', v.tickGain.gain], ['whir', v.whirGain.gain]]) {
    const last = p.events[p.events.length - 1];
    assert.equal(last.value, 0, `${name} gain does not end at 0`);
    assert.equal(last.time, time, `${name} gain is not cut at the swap`);
    assert.equal(p.value, 0);
  }
}

test('the Pionus builds exactly the graph it always did: no species voice, ever', () => {
  const { fa, log } = makeAudio();
  const built = log.nodes;
  fa.setSpecies('birb');
  fa.setSpecies(null);
  for (let i = 0; i < 120; i++) fa.update(frame(), 1 / 60);
  for (let i = 0; i < 30; i++) fa.update(frame({ species: null, speciesTick: true, speciesCall: true, speciesWhir: 1 }), 1 / 60);
  for (let i = 0; i < 30; i++) fa.update(frame({ species: 'birb', speciesTick: true, speciesCall: true, speciesWhir: 1 }), 1 / 60);
  fa.setSpecies('birb');
  assert.equal(log.nodes, built, 'no node added for the Pionus');
  const p = fa.probe();
  assert.equal(p.speciesVoice, null);
  assert.equal(p.species, null);
  assert.equal(p.speciesResets, 0);
  assert.equal(p.speciesUnbuilt, 0);
});

test('setSpecies before the unlock builds nothing until the graph exists, then builds with it', () => {
  const pionus = makeAudio();
  const { fa, log } = makeAudio({ unlock: false });
  assert.equal(fa.setSpecies('owl'), 'owl');
  for (let i = 0; i < 30; i++) fa.update(frame({ species: 'owl', speciesTick: true, speciesWhir: 1 }), 1 / 60);
  assert.equal(log.nodes, 0, 'nothing before the gesture');
  fa.unlock({ type: 'click' });
  const added = log.nodes - pionus.log.nodes;
  assert.ok(added > 0 && added <= 12, `the voice was built with the graph (${added} nodes)`);
  const built = log.nodes;
  for (let i = 0; i < 60; i++) fa.update(frame({ species: 'owl', speciesTick: i % 3 === 0, speciesWhir: 0.8 }), 1 / 60);
  assert.equal(log.nodes, built, 'never per frame');
  assert.equal(fa.probe().speciesVoice.ticks, 20);
});

test('update() never constructs: a frame naming a bird nobody set builds nothing', () => {
  const { fa, log } = makeAudio();
  const built = log.nodes;
  for (let i = 0; i < 200; i++) {
    fa.update(frame({ species: i % 2 ? 'owl' : 'crow', speciesTick: true, speciesCall: true, speciesWhir: 1 }), 1 / 60);
  }
  assert.equal(log.nodes, built);
  const p = fa.probe();
  assert.equal(p.speciesVoice, null);
  assert.equal(p.speciesUnbuilt, 200, 'counted, not built');
  // setSpecies builds it once, at once, and later swaps reuse it.
  fa.setSpecies('crow');
  const voiced = log.nodes;
  assert.ok(voiced > built);
  fa.setSpecies('owl'); fa.setSpecies('birb'); fa.setSpecies('crow');
  assert.equal(log.nodes, voiced, 'one voice for both birds, built once');
});

test('the owl ticks once per escapement step and whirs with the beat; never on the ground', () => {
  const { fa } = makeAudio();
  fa.setSpecies('owl');
  for (let i = 0; i < 12; i++) fa.update(frame({ species: 'owl', speciesTick: i % 3 === 0, speciesWhir: 0.8 }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.ticks, 4);
  fa.update(frame({ species: 'owl', speciesTick: true, airborne: false }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.ticks, 4);
});

test('the crow caws on cue, no closer together than the cooldown', () => {
  const { fa, ctx } = makeAudio();
  fa.setSpecies('crow');
  ctx().currentTime = 1;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 1);
  ctx().currentTime = 1 + T.crowCawCooldown * 0.5;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 1, 'two calls within the cooldown: one caw');
  ctx().currentTime = 1 + T.crowCawCooldown + 0.01;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 2, 'after it: the second');
  fa.update(frame({ species: 'crow', speciesCall: false }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 2, 'event-driven: no call, no caw');
});

for (const hold of [true, false]) {
  test(`a swap mid-caw leaves nothing of the caw on the timeline (cancelAndHold ${hold ? 'present' : 'absent'})`, () => {
    const { fa, ctx, voice } = makeAudio({ hold });
    fa.setSpecies('crow');
    ctx().currentTime = 5;
    fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
    const v = voice();
    // Mid first note: its ramp, the second note and both pitch drops are ahead.
    const swap = 5 + 0.05;
    assert.ok(after(v.cawGain.gain, swap).length >= 3, 'both notes were scheduled ahead');
    assert.ok(after(v.caw.frequency, swap).length >= 3, 'both pitch drops were scheduled ahead');
    ctx().currentTime = swap;
    fa.setSpecies('owl');
    assertSilencedAt(v, swap);
    // ...and on to the Pionus, later still: still nothing after either swap.
    ctx().currentTime = swap + 0.02;
    fa.setSpecies('birb');
    assertSilencedAt(v, swap + 0.02);
    for (let i = 0; i < 30; i++) fa.update(frame(), 1 / 60);
    assertSilencedAt(v, swap + 0.02);
    assert.equal(fa.probe().species, null);
  });
}

test('a swap mid-tick cuts the tick to 0 and the whir to 0, and the whir does not ramp back', () => {
  const { fa, ctx, voice } = makeAudio();
  fa.setSpecies('owl');
  ctx().currentTime = 3;
  fa.update(frame({ species: 'owl', speciesTick: true, speciesWhir: 1 }), 1 / 60);
  const v = voice();
  assert.ok(v.whirGain.gain.value > 0, 'whirring');
  assert.ok(after(v.tickGain.gain, 3).length >= 1, 'a tick envelope is in flight');
  ctx().currentTime = 3.001;
  fa.setSpecies('crow');
  assertSilencedAt(v, 3.001);
  // The crow's frames, then the Pionus's: the whir's smoothing record knows
  // it is at 0, so nothing schedules it back up.
  for (let i = 0; i < 20; i++) { ctx().currentTime += 1 / 60; fa.update(frame({ species: 'crow', speciesWhir: 1 }), 1 / 60); }
  for (let i = 0; i < 20; i++) { ctx().currentTime += 1 / 60; fa.update(frame(), 1 / 60); }
  // (The crow -> Pionus frame is itself a swap and cuts again, to 0.)
  for (const p of [v.whirGain.gain, v.tickGain.gain]) {
    assert.deepEqual(after(p, 3.001).filter((e) => e.value !== 0), [], 'something ramped back up');
    assert.equal(p.value, 0);
  }
  assert.equal(fa.probe().speciesVoice.ticks, 1);
});

test('a frame that changes bird without setSpecies silences the old one too', () => {
  const { fa, ctx, voice } = makeAudio();
  fa.setSpecies('crow');
  ctx().currentTime = 2;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  const v = voice();
  ctx().currentTime = 2.1;
  fa.update(frame({ species: null }), 1 / 60);
  assertSilencedAt(v, 2.1);
  assert.equal(fa.probe().species, null);
  const resets = fa.probe().speciesResets;
  // ...owl -> crow by frames alone, mid-tick.
  fa.update(frame({ species: 'owl', speciesTick: true, speciesWhir: 1 }), 1 / 60);
  ctx().currentTime = 2.2;
  fa.update(frame({ species: 'crow' }), 1 / 60);
  assertSilencedAt(v, 2.2);
  assert.equal(fa.probe().speciesResets, resets + 2);
  // A swap setSpecies already announced is not reset again by the frame.
  fa.setSpecies('owl');
  const announced = fa.probe().speciesResets;
  fa.update(frame({ species: 'owl' }), 1 / 60);
  assert.equal(fa.probe().speciesResets, announced);
});

test('a fresh crow after a swap may caw again: the cooldown resets with the bird', () => {
  const { fa, ctx } = makeAudio();
  fa.setSpecies('crow');
  ctx().currentTime = 1;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  fa.setSpecies('owl');
  fa.setSpecies('crow');
  ctx().currentTime = 2;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 2);
});

test('mute or pause, swap, resume: nothing throws and the voice stays silent', () => {
  const { fa, ctx, voice, timers } = makeAudio();
  fa.setSpecies('owl');
  ctx().currentTime = 4;
  fa.update(frame({ species: 'owl', speciesTick: true, speciesWhir: 1 }), 1 / 60);
  const v = voice();
  fa.setVolume(0, true);
  timers.flush();
  assert.equal(fa.probe().suspendReason, 'muted');
  assert.equal(ctx().state, 'suspended');
  assert.doesNotThrow(() => fa.setSpecies('crow'));
  assertSilencedAt(v, 4);
  assert.doesNotThrow(() => fa.setVolume(0.8, true));
  assert.equal(ctx().state, 'running');
  fa.update(frame({ species: 'crow' }), 1 / 60);
  assertSilencedAt(v, 4);
  // A pause, a swap to the Pionus inside it, and the frame that resumes.
  fa.suspend('paused');
  timers.flush();
  assert.doesNotThrow(() => fa.setSpecies('birb'));
  fa.update(frame(), 1 / 60);
  assert.equal(ctx().state, 'running');
  assertSilencedAt(v, 4);
  assert.equal(fa.probe().suspendReason, null);
});

test('the voices ride the master: muting suspends them with everything else', () => {
  const { fa } = makeAudio();
  fa.setSpecies('owl');
  fa.update(frame({ species: 'owl', speciesTick: true, speciesWhir: 1 }), 1 / 60);
  fa.setVolume(0, true);
  assert.equal(fa.probe().suspendReason, 'muted');
});
