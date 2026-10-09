// The bird picker's voices in src/audio/flight-audio.js: the clockwork owl's
// escapement tick and gear whir, the crow's rate-limited caw. The Pionus's
// audio graph must be exactly what it was: nothing new is built until a frame
// names a species that has a voice. Same fake AudioContext approach as
// flight-audio.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightAudio, FLIGHT_AUDIO_TUNING as T } from '../src/audio/flight-audio.js';

function makeAudio() {
  const log = { nodes: 0, types: [] };
  const param = (value) => {
    const p = {
      value, calls: 0,
      setTargetAtTime(v) { p.calls += 1; p.value = v; return p; },
      linearRampToValueAtTime() { p.calls += 1; return p; },
      setValueAtTime(v) { p.calls += 1; p.value = v; return p; },
      cancelScheduledValues() { p.calls += 1; return p; },
      cancelAndHoldAtTime() { p.calls += 1; return p; },
    };
    return p;
  };
  class Ctx {
    constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended'; this.destination = { connect() {} }; }
    _node(kind, extra = {}) { log.nodes += 1; log.types.push(kind); return { connect() {}, disconnect() {}, start() {}, stop() {}, ...extra }; }
    createGain() { return this._node('gain', { gain: param(1) }); }
    createOscillator() { return this._node('osc', { type: 'sine', frequency: param(440), detune: param(0), setPeriodicWave() {} }); }
    createBiquadFilter() { return this._node('biquad', { type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createBufferSource() { return this._node('source', { buffer: null, loop: false, playbackRate: param(1) }); }
    createBuffer(ch, len, rate) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (c) => d[c] }; }
    createPeriodicWave() { return {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const timers = { setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {} };
  const fa = createFlightAudio({ AudioContext: Ctx, navigator: { userActivation: { isActive: true } }, document: { hidden: false }, timers });
  fa.setVolume(0.8, true);
  fa.unlock({ type: 'click' });
  return { fa, log, ctx: () => fa.context };
}

const frame = (extra = {}) => ({
  speed: 11, paused: false, airborne: true, stalled: false, authority: 1, stallMul: 0.5,
  wingAngle: 0, clearance: 40, overWater: false, ...extra,
});

test('the Pionus builds exactly the graph it always did: no species voice, ever', () => {
  const { fa, log } = makeAudio();
  const built = log.nodes;
  for (let i = 0; i < 120; i++) fa.update(frame(), 1 / 60);
  for (let i = 0; i < 30; i++) fa.update(frame({ species: null, speciesTick: true, speciesCall: true, speciesWhir: 1 }), 1 / 60);
  assert.equal(log.nodes, built, 'no node added for the Pionus');
  assert.equal(fa.probe().speciesVoice, null);
});

test('the owl ticks once per escapement step and whirs with the beat; the voice is built once', () => {
  const { fa, log } = makeAudio();
  const before = log.nodes;
  for (let i = 0; i < 12; i++) fa.update(frame({ species: 'owl', speciesTick: i % 3 === 0, speciesWhir: 0.8 }), 1 / 60);
  const added = log.nodes - before;
  assert.ok(added > 0 && added <= 12, `voice nodes ${added}`);
  for (let i = 0; i < 12; i++) fa.update(frame({ species: 'owl', speciesTick: false, speciesWhir: 0.8 }), 1 / 60);
  assert.equal(log.nodes - before, added, 'built once, never per frame');
  assert.equal(fa.probe().speciesVoice.ticks, 4);
  // No ticks on the ground.
  fa.update(frame({ species: 'owl', speciesTick: true, airborne: false }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.ticks, 4);
});

test('the crow caws on cue, no closer together than the cooldown', () => {
  const { fa, ctx } = makeAudio();
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 1);
  ctx().currentTime = T.crowCawCooldown * 0.5;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 1, 'rate-limited');
  ctx().currentTime = T.crowCawCooldown + 0.01;
  fa.update(frame({ species: 'crow', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 2);
  fa.update(frame({ species: 'owl', speciesCall: true }), 1 / 60);
  assert.equal(fa.probe().speciesVoice.caws, 2, 'only the crow caws');
});

test('the voices ride the master: muting suspends them with everything else', () => {
  const { fa } = makeAudio();
  fa.update(frame({ species: 'owl', speciesTick: true, speciesWhir: 1 }), 1 / 60);
  fa.setVolume(0, true);
  assert.equal(fa.probe().suspendReason, 'muted');
});
