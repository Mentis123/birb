// tests/aero-pose.test.js — the air poses the bird (src/flight/aero-pose.js).
//
// The rig used to read the RAW stick, so under the shipping pull-back-to-climb
// default a dive flapped harder than a climb and the tail moved the wrong way.
// These pin the replacement's physics by INTENT (a climb, a dive, a stall, an
// approach) rather than by stick sign, so no pitch preference can turn a
// climb check into a dive check that still passes.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AERO_POSE_DEFAULTS as T, powerDemand, throttleGain, flapDepth, burstDuty, spanMorph,
  liftFraction, loadFactor, pionusStroke, gearTarget, ramp, createAeroPose, createAeroInput,
  aeroPoseRequested,
} from '../src/flight/aero-pose.js';

const DT = 1 / 60;

/** Run the smoother for `seconds` on a fixed input; return the last output. */
function settle(model, input, seconds, dt = DT) {
  let out = null;
  for (let t = 0; t < seconds; t += dt) out = model.update(input, dt);
  return out;
}

/** Record `seconds` of one output field. */
function trace(model, input, seconds, field, dt = DT) {
  const values = [];
  for (let t = 0; t < seconds; t += dt) values.push(model.update(input, dt)[field]);
  return values;
}

function flying(overrides = {}) {
  return Object.assign(createAeroInput(), { airborne: true, aboveGround: 200 }, overrides);
}

// ---- power demand ---------------------------------------------------------

test('level flight at cruise is the unit of demand', () => {
  assert.ok(Math.abs(powerDemand(1, 1, 0, 0, 1) - 1) < 1e-12);
});

test('a dive asks for less power than a climb at the same airspeed', () => {
  for (const r of [0.7, 1, 1.3]) {
    const climb = powerDemand(r, 1, 0.5, 0.5, 1);
    const dive = powerDemand(r, 1, -0.5, -0.5, 1);
    assert.ok(dive < climb, `r=${r}: dive ${dive} vs climb ${climb}`);
    assert.ok(flapDepth(dive) < flapDepth(climb), `r=${r}: the stroke must be deeper climbing`);
  }
});

test('the power curve is U-shaped in airspeed with its minimum near cruise', () => {
  const at = (r) => powerDemand(r, r, 0, 0, 1);
  const cruise = at(1);
  assert.ok(at(0.5) > cruise * 1.3, 'slow flight is expensive (induced power)');
  assert.ok(at(1.8) > cruise * 1.3, 'fast flight is expensive (parasite power)');
  let best = Infinity; let bestR = 0;
  for (let r = 0.4; r <= 2; r += 0.01) { const p = at(r); if (p < best) { best = p; bestR = r; } }
  assert.ok(Math.abs(bestR - 1) < 0.05, `minimum at r=${bestR.toFixed(2)}, want ~1`);
});

test('the realistic climb and dive the realism check flies land on opposite sides of the glide line', () => {
  // flap-follows-climb holds 0.6 of stick for 90 frames: measured on the page
  // a 43-degree climb settles near 9 u/s (r 0.82, climb 0.56 of cruise) and
  // a 42-degree dive near 14.5 (r 1.32, climb -0.88).
  const climb = powerDemand(0.82, 1, 0.56, 0.49, 1);
  const dive = powerDemand(1.32, 1, -0.88, -0.49, 1);
  assert.equal(flapDepth(climb), 1, `climb demand ${climb.toFixed(2)} should be a full stroke`);
  assert.equal(flapDepth(dive), 0, `dive demand ${dive.toFixed(2)} should be a glide`);
  assert.equal(burstDuty(climb), 1, 'a climb flaps continuously');
  assert.equal(burstDuty(dive), 0, 'a dive does not flap at all');
});

test('accelerating toward the energy target costs power and bleeding excess speed saves it', () => {
  // A boost lifts the target to 2.4x cruise; afterwards the bird is fast and
  // the target is back at cruise.
  assert.ok(powerDemand(1.2, 2.4, 0, 0, 1) > T.demandFull, 'a boost is a full stroke');
  assert.ok(powerDemand(1.6, 1, 0, 0, 1) < T.demandGlide, 'the coast after a boost is a glide');
});

test('load raises the induced term: a hard pull costs power', () => {
  assert.ok(powerDemand(1, 1, 0, 0, 3) > powerDemand(1, 1, 0, 0, 1) + 1);
  assert.equal(loadFactor(0, 11), 1);
  assert.equal(loadFactor(T.loadDeadband * 0.9, 11), 1, 'transport alone is not load');
  assert.ok(loadFactor(1, 11) > 2 && loadFactor(-1, 11) < 0, 'a pull loads, a push unloads');
});

test('idle throttle glides whatever the demand, the neutral pad passes it through', () => {
  assert.equal(throttleGain(0.55, 0.55), 0);
  assert.equal(throttleGain(1, 0.55), 1);
  assert.ok(throttleGain(1.35, 0.55) > 1.5 && throttleGain(9, 0.55) <= 1.6);
  const model = createAeroPose();
  const idle = settle(model, flying({ airspeed: 6, target: 6, throttle: 0.55 }), 3);
  assert.ok(idle.depth < 0.01 && idle.envelope < 0.01, `idle throttle still flapping: ${idle.depth}/${idle.envelope}`);
});

// ---- the stroke ------------------------------------------------------------

test('the Pionus stroke is deep below the glide line and barely above it', () => {
  let top = Infinity; let bottom = -Infinity;
  for (let p = 0; p < 1; p += 0.001) {
    const s = pionusStroke(p, 1);
    top = Math.min(top, s.angle);
    bottom = Math.max(bottom, s.angle);
  }
  const up = -top; const down = bottom;
  assert.ok(down > 2.5 * up, `downstroke ${down.toFixed(2)} vs upstroke ${up.toFixed(2)}`);
  // "Barely above horizontal": the top of the stroke plus the glide droop
  // sits within about 15 degrees of the base rig's horizontal.
  const topNet = T.glideDroop + top;
  assert.ok(topNet < 0 && topNet > -0.27, `top of stroke ${topNet.toFixed(3)} rad`);
  assert.ok(T.glideDroop + bottom > 0.85, 'the bottom of a full stroke is deep');
});

test('phase 0 is the top of the stroke, the bottom is the end of the downstroke', () => {
  assert.ok(pionusStroke(0, 1).angle <= pionusStroke(0.01, 1).angle);
  const bottom = pionusStroke(T.downFrac, 1).angle;
  for (let p = 0; p < 1; p += 0.01) assert.ok(pionusStroke(p, 1).angle <= bottom + 1e-12);
  assert.equal(pionusStroke(0.1, 1).downstroke, true);
  assert.equal(pionusStroke(0.7, 1).downstroke, false);
});

test('the wing flexes on the upstroke and is fully spread on the downstroke', () => {
  for (let p = 0; p < T.downFrac; p += 0.01) assert.equal(pionusStroke(p, 1).span, 1);
  const mid = pionusStroke(T.downFrac + (1 - T.downFrac) / 2, 1);
  assert.ok(mid.span < 0.8 && mid.handSweep < -0.2, 'mid-upstroke the wing is drawn in and the hand folded back');
});

test('the hand trails the arm: above it going down, below it coming up', () => {
  const down = pionusStroke(T.downFrac / 2, 1);
  const up = pionusStroke(T.downFrac + (1 - T.downFrac) / 2, 1);
  assert.ok(down.hand < 0, `hand should lag ABOVE on the downstroke: ${down.hand}`);
  assert.ok(up.hand > 0, `hand should lag BELOW on the upstroke: ${up.hand}`);
});

test('the wing pronates going down and supinates coming up', () => {
  let minTwist = Infinity; let maxTwist = -Infinity; let minAt = 0; let maxAt = 0;
  for (let p = 0; p < 1; p += 0.001) {
    const tw = pionusStroke(p, 1).twist;
    if (tw < minTwist) { minTwist = tw; minAt = p; }
    if (tw > maxTwist) { maxTwist = tw; maxAt = p; }
  }
  assert.ok(minTwist < -0.15 && maxTwist > 0.1);
  assert.ok(minAt < T.downFrac, 'most pronated during the downstroke (it leads, so early)');
  assert.ok(maxAt > T.downFrac - T.twistLead, 'most supinated during the upstroke');
});

test('depth 0 is no stroke at all', () => {
  for (let p = 0; p < 1; p += 0.05) {
    const s = pionusStroke(p, 0);
    assert.equal(s.angle, 0); assert.equal(s.span, 1); assert.equal(s.hand, 0);
    assert.equal(s.handSweep, 0); assert.equal(s.twist, 0);
  }
});

// ---- speed morph, high lift ------------------------------------------------

test('cruise flies the designed planform; fast flight tucks and sweeps, down to a floor', () => {
  const cruiseRatio = 1 / T.stallMul;
  assert.equal(spanMorph(cruiseRatio), 1);
  assert.ok(spanMorph(1.5 * cruiseRatio) < 0.8);
  assert.equal(spanMorph(10 * cruiseRatio), T.spanMin);
  assert.equal(spanMorph(0.5 * cruiseRatio), 1, 'slow flight never over-extends');
});

test('slow flight spreads the span and the tail; fast flight sweeps the wing and furls the tail', () => {
  const slow = settle(createAeroPose(), flying({ airspeed: 6, target: 6 }), 3);
  const fast = settle(createAeroPose(), flying({ airspeed: 21, target: 21 }), 3);
  assert.ok(slow.span > fast.span + 0.25, `span slow ${slow.span.toFixed(2)} vs fast ${fast.span.toFixed(2)}`);
  assert.ok(slow.tailFan > 1.3 && fast.tailFan < 0.9, `tail slow ${slow.tailFan.toFixed(2)} fast ${fast.tailFan.toFixed(2)}`);
  assert.ok(fast.wingY > 0.25, `the fast wing sweeps aft: ${fast.wingY.toFixed(2)}`);
  assert.ok(slow.wingY <= 0, 'the slow wing is held forward, not swept');
});

test('the stall splays the hand and fans the tail', () => {
  const stalled = settle(createAeroPose(), flying({ airspeed: 4, target: 11, stalled: true }), 2);
  const cruising = settle(createAeroPose(), flying(), 2);
  assert.ok(stalled.splay > 0.9 && stalled.handSpread > 1.3, `splay ${stalled.splay}`);
  assert.ok(cruising.splay < 0.05 && Math.abs(cruising.handSpread - 1) < 0.02);
  assert.ok(stalled.tailFan > 1.5);
  // A hard pull at cruise speed runs the wing to CLmax too.
  assert.ok(liftFraction(2, 5) > 1 && liftFraction(2, 1) < 0.3);
});

test('the controller\'s stall flag alone splays, even above the geometric stall speed', () => {
  const out = settle(createAeroPose(), flying({ airspeed: 7, target: 11, stalled: true }), 2);
  assert.ok(out.splay > 0.9);
});

// ---- tail -------------------------------------------------------------------

test('the tail drops on a climb and lifts on a dive (+ is down), and twists into a roll', () => {
  const up = settle(createAeroPose(), flying({ elevator: 0.8 }), 1);
  const down = settle(createAeroPose(), flying({ elevator: -0.8 }), 1);
  assert.ok(up.tailPitch > 0.1, `climb tail ${up.tailPitch}`);
  assert.ok(down.tailPitch < -0.08, `dive tail ${down.tailPitch}`);
  const right = settle(createAeroPose(), flying({ rollRate: 2 }), 1);
  const left = settle(createAeroPose(), flying({ rollRate: -2 }), 1);
  assert.ok(right.tailTwist > 0.1 && left.tailTwist < -0.1);
  assert.ok(Math.abs(right.tailTwist) <= T.tailTwistMax + 1e-9);
});

// ---- load -------------------------------------------------------------------

test('load flexes the wing up, a push droops it, both bounded', () => {
  const pull = settle(createAeroPose(), flying({ pitchRate: 2.5 }), 1);
  const push = settle(createAeroPose(), flying({ pitchRate: -2.5 }), 1);
  const level = settle(createAeroPose(), flying(), 1);
  assert.ok(pull.flex > 0.2 && pull.flex <= T.flexMax + 1e-9, `pull flex ${pull.flex}`);
  assert.ok(push.flex < 0 && push.flex >= T.flexMin - 1e-9);
  assert.ok(Math.abs(level.flex) < 1e-6);
});

test('a gust flicks the wing up briefly and then settles, even if the updraft holds', () => {
  const model = createAeroPose();
  const input = flying();
  settle(model, input, 1);
  input.gust = 6;
  const flicked = trace(model, input, 2, 'flex');
  const peak = Math.max(...flicked);
  assert.ok(peak > 0.1, `gust flick ${peak}`);
  assert.ok(flicked[flicked.length - 1] < peak * 0.2, 'a held updraft is not a held flex');
  // The input exists and is 0 until the air field lands.
  assert.equal(createAeroInput().gust, 0);
});

// ---- feet -------------------------------------------------------------------

test('the gear comes down on a slow approach a beat or three out, and not on a fast dive', () => {
  // 2 units of clearance, sinking 3 u/s: contact in ~0.5 s.
  assert.ok(gearTarget(2.6, -3, 0.8, false) > 0.9);
  // Same geometry, diving fast: not landing.
  assert.equal(gearTarget(2.6, -3, 1.8, false), 0);
  // High up, descending: not yet.
  assert.equal(gearTarget(60, -3, 0.8, false), 0);
  // Climbing away: up.
  assert.equal(gearTarget(2.6, 2, 0.8, false), 0);
  // The nest auto-fly is always an approach.
  assert.equal(gearTarget(80, 0, 1.4, true), 1);
  assert.equal(gearTarget(NaN, -3, 0.8, false), 0, 'no terrain, no gear');
});

test('the feet are down on the ground and tuck once flying at altitude', () => {
  const model = createAeroPose();
  const grounded = settle(model, flying({ airborne: false }), 1);
  assert.ok(grounded.feet > 0.99, 'on the ground the feet are down (the old rig\'s pose)');
  const cruising = settle(model, flying(), 2);
  assert.ok(cruising.feet < 0.01 && cruising.gear < 0.01, `still down at altitude: ${cruising.feet}`);
  const approach = settle(model, flying({ airspeed: 8, target: 8, climbRate: -3, aboveGround: 2.6 }), 1);
  assert.ok(approach.gear > 0.9 && approach.feet > 0.9, `approach gear ${approach.gear}`);
  const away = settle(model, flying({ airspeed: 8, target: 8, climbRate: 3, aboveGround: 3 }), 1);
  assert.ok(away.gear < 0.05, 'climbing away tucks it again');
});

// ---- the smoother -----------------------------------------------------------

test('update returns the SAME object every frame and allocates nothing it keeps', () => {
  const model = createAeroPose();
  const input = flying();
  const first = model.update(input, DT);
  for (let i = 0; i < 100; i += 1) assert.equal(model.update(input, DT), first);
  assert.equal(model.out, first);
});

test('outputs are finite and bounded for any input, including garbage', () => {
  const model = createAeroPose();
  const nasty = [NaN, Infinity, -Infinity, -1e9, 1e9, 0, -0, undefined, null];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = () => (rnd() < 0.25 ? nasty[Math.floor(rnd() * nasty.length)] : (rnd() - 0.5) * 60);
  for (let i = 0; i < 4000; i += 1) {
    const input = {
      airborne: rnd() < 0.8, landing: rnd() < 0.1, airspeed: pick(), cruise: pick(), target: pick(),
      throttle: pick(), throttleIdle: pick(), stallMul: pick(), stalled: rnd() < 0.2,
      climbRate: pick(), pitchRate: pick(), rollRate: pick(), elevator: pick(), bank: pick(),
      aboveGround: pick(), gust: pick(), reducedMotion: rnd() < 0.1,
    };
    const out = model.update(rnd() < 0.05 ? null : input, rnd() < 0.1 ? pick() : DT);
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} = ${v} on step ${i}`);
    }
    assert.ok(out.depth >= 0 && out.depth <= 1 && out.envelope >= 0 && out.envelope <= 1);
    assert.ok(out.span >= T.spanMin * (1 - T.upFlex) - 1e-9 && out.span <= 1 + 1e-9, `span ${out.span}`);
    assert.ok(Math.abs(out.wingX) < 1.5 && Math.abs(out.wingY) < 0.6 && Math.abs(out.wingZ) < 0.4);
    assert.ok(Math.abs(out.handX) < 0.6 && Math.abs(out.handY) < 0.5 && out.handSpread >= 1 && out.handSpread <= 1 + T.handSpread + 1e-9);
    assert.ok(out.tailFan >= T.tailFurlMin - 1e-9 && out.tailFan <= T.tailFanMax + 1e-9, `tailFan ${out.tailFan}`);
    assert.ok(Math.abs(out.tailPitch) < 0.4 && Math.abs(out.tailTwist) <= T.tailTwistMax + 1e-9);
    assert.ok(out.feet >= 0 && out.feet <= 1 && out.gear >= 0 && out.gear <= 1);
    assert.ok(out.phase01 >= 0 && out.phase01 < 1);
  }
});

test('the smoother converges on its target without overshooting, at any frame rate', () => {
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.05, 0.1]) {
    const model = createAeroPose();
    settle(model, flying(), 3, dt);
    const input = flying({ airspeed: 21, target: 21 });
    const spans = trace(model, input, 4, 'morphSpan', dt);
    const target = spanMorph(21 / 11 / T.stallMul);
    for (let i = 1; i < spans.length; i += 1) {
      assert.ok(spans[i] <= spans[i - 1] + 1e-12, `dt ${dt}: span went back up at step ${i}`);
      assert.ok(spans[i] >= target - 1e-9, `dt ${dt}: overshot ${spans[i]} past ${target}`);
    }
    assert.ok(spans[spans.length - 1] - target < 0.01, `dt ${dt}: did not converge (${spans[spans.length - 1]} vs ${target})`);
  }
});

test('the beat frequency is near constant: at most ~1.2x between glide and full effort', () => {
  const count = (input) => {
    const model = createAeroPose();
    settle(model, input, 2);
    const b0 = model.out.beats;
    settle(model, input, 10);
    return (model.out.beats - b0) / 10;
  };
  const cruise = count(flying());
  const climb = count(flying({ airspeed: 9, target: 11, climbRate: 6, elevator: 0.5 }));
  assert.ok(climb >= cruise, 'effort does not SLOW the beat');
  assert.ok(climb / cruise <= 1.2, `beat rate ${cruise.toFixed(2)} -> ${climb.toFixed(2)} Hz`);
  assert.ok(cruise > 3.5 && climb < 5, 'in the band the rig was drawn for');
});

test('changing effort never jumps the phase: it integrates', () => {
  const model = createAeroPose();
  const calm = flying();
  const hard = flying({ airspeed: 9, target: 11, climbRate: 6, elevator: 0.5 });
  let prev = model.update(calm, DT).phase01;
  for (let i = 0; i < 600; i += 1) {
    const out = model.update(i % 90 < 45 ? calm : hard, DT);
    let step = out.phase01 - prev;
    if (step < 0) step += 1;
    assert.ok(step > 0 && step < 5 * DT + 1e-9, `phase stepped ${step} at frame ${i}`);
    prev = out.phase01;
  }
});

test('level cruise beats in bursts; a climb beats continuously; a dive glides', () => {
  const env = (input) => {
    const model = createAeroPose();
    settle(model, input, 2);
    const e = trace(model, input, 8, 'envelope');
    return e.reduce((s, v) => s + v, 0) / e.length;
  };
  const cruise = env(flying());
  const climb = env(flying({ airspeed: 9, target: 11, climbRate: 6, elevator: 0.5 }));
  const dive = env(flying({ airspeed: 15, target: 11, climbRate: -10, elevator: -0.5 }));
  assert.ok(cruise > 0.3 && cruise < 0.8, `cruise duty ${cruise.toFixed(2)}`);
  assert.ok(climb > 0.95, `climb duty ${climb.toFixed(2)}`);
  assert.ok(dive < 0.05, `dive duty ${dive.toFixed(2)}`);
});

test('a harness freeze (in the air at zero airspeed) is posed as cruise, not as a stall', () => {
  const frozen = settle(createAeroPose(), flying({ airspeed: 0, target: 0, stalled: true }), 3);
  const cruise = settle(createAeroPose(), flying(), 3);
  assert.equal(frozen.frozen, true);
  assert.ok(frozen.splay < 0.01 && Math.abs(frozen.tailFan - cruise.tailFan) < 1e-6);
  assert.ok(Math.abs(frozen.morphSpan - 1) < 1e-6 && Math.abs(frozen.depth - cruise.depth) < 1e-6);
});

test('on the ground every aero term fades out and the perch pose is left alone', () => {
  const model = createAeroPose();
  settle(model, flying({ airspeed: 21, target: 21, rollRate: 2, elevator: 0.8 }), 2);
  const grounded = settle(model, flying({ airborne: false, airspeed: 0, target: 0 }), 3);
  for (const k of ['wingX', 'wingY', 'wingZ', 'handX', 'handY', 'tailPitch', 'tailTwist', 'gear']) {
    assert.ok(Math.abs(grounded[k]) < 1e-3, `${k} = ${grounded[k]} on the ground`);
  }
  for (const k of ['span', 'handSpread', 'tailFan']) {
    assert.ok(Math.abs(grounded[k] - 1) < 1e-3, `${k} = ${grounded[k]} on the ground`);
  }
});

test('reduced motion drops the decorative twist, flutter and gust flick but keeps the beat', () => {
  const model = createAeroPose();
  const input = flying({ airspeed: 9, target: 11, climbRate: 6, elevator: 0.5, reducedMotion: true, gust: 5 });
  const out = settle(model, input, 3);
  assert.equal(out.wingZ, 0);
  assert.equal(out.flutter, 0);
  assert.ok(out.depth > 0.8, 'the beat itself is not decoration');
});

test('the forced stroke (the bird sheet) is the full-depth beat on the glide line', () => {
  const model = createAeroPose();
  const target = { wingX: 0, wingZ: 0, span: 1, handX: 0, handY: 0 };
  for (const p of [0, 0.19, 0.7]) {
    const f = model.forcedStroke(p, target);
    const s = pionusStroke(p, 1);
    assert.equal(f, target);
    assert.ok(Math.abs(f.wingX - (T.glideDroop + s.angle)) < 1e-12);
    assert.ok(Math.abs(f.span - s.span) < 1e-12 && Math.abs(f.handX - s.hand) < 1e-12);
  }
});

test('?aeropose=0 is the only thing that turns it off', () => {
  assert.equal(aeroPoseRequested(''), true);
  assert.equal(aeroPoseRequested('?debug=1'), true);
  assert.equal(aeroPoseRequested('?aeropose=1'), true);
  assert.equal(aeroPoseRequested('?aeropose=0'), false);
  assert.equal(aeroPoseRequested('?debug=1&aeropose=0&env=city'), false);
  assert.equal(aeroPoseRequested('?aeropose=01'), true);
  assert.equal(aeroPoseRequested(undefined), true);
});

test('ramp runs either way and is flat outside its band', () => {
  assert.equal(ramp(0, 1, 2), 0); assert.equal(ramp(3, 1, 2), 1); assert.equal(ramp(1.5, 1, 2), 0.5);
  assert.equal(ramp(0.5, 0.85, 0.55), 1); assert.equal(ramp(0.9, 0.85, 0.55), 0);
});
