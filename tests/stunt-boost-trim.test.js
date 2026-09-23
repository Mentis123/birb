/**
 * tests/stunt-boost-trim.test.js — a boost is thrust, not a stall.
 *
 * index.html boosts the stunt model by raising its energy TARGET (`cruise`)
 * to 2.4x for 0.6 s. The model judged lift, the stall, the weathervane and
 * control authority against that same target, so the frame a boost began the
 * bird was flying at 11 against a 26.4 target: under the 0.5 stall line, a
 * third of its lift, its nose swinging toward the sink and its controls at a
 * third of their authority. Measured on the live page, every boost sank the
 * bird 1.4-1.55 units. `liftCruise` is the speed the WING is trimmed for;
 * index.html writes the unboosted cruise into it every frame the bird flies
 * itself, and a null (the default) keeps the old reference exactly — which
 * is why the frozen suite in tests/bird-flight-stunt.test.js is unaffected.
 *
 * The control arm flies the same boost with `liftCruise` null and asserts the
 * DEFECT, so this file fails if the fix is reverted rather than passing on a
 * boost that simply happened not to sink.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BirdFlightStunt } from '../src/flight/bird-flight-stunt.js';

// Same additive shim the frozen stunt suite installs for the repo's stub.
for (const [name, impl] of [
  ['add', function add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }],
  ['cross', function cross(v) { return this.crossVectors(this, v); }],
  ['distanceTo', function distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }],
]) {
  if (typeof THREE.Vector3.prototype[name] !== 'function') THREE.Vector3.prototype[name] = impl;
}

const SPHERE_RADIUS = 100;
const ALT = 100;
const DT = 1 / 60;
const CRUISE = 11;
const BOOST = { speedMult: 2.4, duration: 0.6 };

const makeBird = () => new BirdFlightStunt(THREE, {
  sphereRadius: SPHERE_RADIUS,
  speed: CRUISE,
  position: new THREE.Vector3(0, SPHERE_RADIUS + ALT, 0),
});

const radius = (b) => b.position.clone().sub(b.sphereCenter).length();
const HANDS_OFF = { x: 0, y: 0, rudder: 0, throttle: 1 };

/**
 * Fly `seconds` of hands-off level flight the way index.html drives the
 * stunt model: every frame it writes the energy target (`cruise`, boosted
 * for the first BOOST.duration seconds) and, when `trim` is on, the wing's
 * trim (`liftCruise`, never boosted).
 */
function flyBoost(bird, { trim, seconds = 2 }) {
  const out = { stalledFrames: 0, minAuthority: Infinity, maxSink: 0, drop: 0 };
  const r0 = radius(bird);
  for (let t = 0; t < seconds; t += DT) {
    bird.cruise = t < BOOST.duration ? CRUISE * BOOST.speedMult : CRUISE;
    if (trim) bird.liftCruise = CRUISE;
    bird.tick(HANDS_OFF, DT);
    if (bird.isStalled()) out.stalledFrames += 1;
    out.minAuthority = Math.min(out.minAuthority, bird.authority());
    out.maxSink = Math.max(out.maxSink, bird.sinkRate());
  }
  out.drop = r0 - radius(bird);
  return out;
}

test('boost: with the wing trimmed for the unboosted cruise, a boost never reads as a stall and never sinks', () => {
  const bird = makeBird();
  bird.cruise = CRUISE;
  // Settle a second of trimmed, hands-off cruise first.
  for (let t = 0; t < 1; t += DT) { bird.liftCruise = CRUISE; bird.tick(HANDS_OFF, DT); }
  const r = flyBoost(bird, { trim: true });
  assert.equal(r.stalledFrames, 0, `stalled on ${r.stalledFrames} frames of a boost`);
  assert.equal(r.maxSink, 0, `sank at up to ${r.maxSink.toFixed(3)} u/s during a boost`);
  assert.ok(r.drop < 0.01, `a boost lost ${r.drop.toFixed(3)} units of height`);
  assert.ok(r.minAuthority >= 0.99, `authority fell to ${r.minAuthority.toFixed(2)} during a boost`);
});

test('boost control: judged against the boosted TARGET (liftCruise null), the same boost stalls and sinks', () => {
  const bird = makeBird();
  bird.cruise = CRUISE;
  for (let t = 0; t < 1; t += DT) bird.tick(HANDS_OFF, DT);
  const r = flyBoost(bird, { trim: false });
  assert.ok(r.stalledFrames > 0, 'the untrimmed control arm never stalled — the defect this file guards is not reproduced');
  assert.ok(r.drop > 0.5, `the untrimmed control arm lost only ${r.drop.toFixed(3)} units`);
  assert.ok(r.minAuthority < 0.6, `the untrimmed control arm kept authority ${r.minAuthority.toFixed(2)}`);
});

test('liftCruise equal to cruise changes nothing: lift, stall and authority are the old numbers', () => {
  for (const speed of [3, 5.4, 5.6, 8, 11, 14, 20]) {
    const a = makeBird();
    const b = makeBird();
    a.cruise = CRUISE; b.cruise = CRUISE; b.liftCruise = CRUISE;
    a.speed = speed; b.speed = speed;
    a._lastTickSpeed = speed; b._lastTickSpeed = speed;
    assert.equal(b.liftFactor(), a.liftFactor(), `lift at speed ${speed}`);
    assert.equal(b.isStalled(), a.isStalled(), `stall at speed ${speed}`);
    assert.equal(b.authority(), a.authority(), `authority at speed ${speed}`);
    assert.equal(b.sinkRate(), a.sinkRate(), `sink at speed ${speed}`);
  }
});

test('a COMMANDED speed ignores the trim: the nest approach at setSpeed(4) is not a stall', () => {
  const bird = makeBird();
  bird.cruise = CRUISE;
  bird.liftCruise = CRUISE;
  bird.setSpeed(4);
  assert.equal(bird.isStalled(), false, 'a commanded 4 read as a stall against the 11 trim');
  assert.equal(bird.sinkRate(), 0, 'a commanded speed sinks');
});

test('the stall is still reachable: below half the trim speed, handed over, the wing stops flying', () => {
  const bird = makeBird();
  bird.cruise = CRUISE;
  bird.liftCruise = CRUISE;
  bird.speed = 0.45 * CRUISE;
  bird._lastTickSpeed = bird.speed;
  assert.equal(bird.isStalled(), true);
  assert.ok(bird.sinkRate() > 0);
});
