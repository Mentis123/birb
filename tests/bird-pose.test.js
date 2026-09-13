import test from 'node:test';
import assert from 'node:assert/strict';
import { blendToward, perchPose, tumbleFlap, tailPitchOffset, wingBeat, beatEnvelope } from '../src/flight/bird-pose.js';

test('a blend approaches its target without ever passing it', () => {
  let value = 0;
  for (let i = 0; i < 300; i++) value = blendToward(value, 1, 1 / 60, 5);
  assert.ok(value > 0.99 && value <= 1, `settled at ${value}`);
});

test('a long frame does not make the blend overshoot or oscillate', () => {
  // The exponential form exists for this case. A linear step would fly past
  // the target on a slow frame and ring, which on a throttled phone is
  // precisely when frames run long.
  let value = 0;
  for (const delta of [0.5, 1, 5, 100]) {
    value = blendToward(0, 1, delta, 12);
    assert.ok(value <= 1, `delta ${delta} overshot to ${value}`);
    assert.ok(value >= 0);
  }
});

test('blending is frame-rate independent', () => {
  let sixty = 0;
  for (let i = 0; i < 60; i++) sixty = blendToward(sixty, 1, 1 / 60, 5);
  let thirty = 0;
  for (let i = 0; i < 30; i++) thirty = blendToward(thirty, 1, 1 / 30, 5);
  assert.ok(Math.abs(sixty - thirty) < 0.01, `${sixty} vs ${thirty} after one second`);
});

test('a non-finite input leaves the blend where it was rather than poisoning it', () => {
  assert.equal(blendToward(0.5, NaN, 1 / 60, 5), 0.5);
  assert.ok(Number.isFinite(blendToward(NaN, 1, 1 / 60, 5)));
});

test('the perch pose folds the wings in and settles the tail', () => {
  const flying = perchPose(0);
  const perched = perchPose(1);
  assert.equal(flying.fold, 0);
  assert.equal(flying.span, 1);
  assert.ok(perched.fold > 0.5, 'wings must actually fold');
  assert.ok(perched.span < 0.7, 'wings must pull in, not just rotate');
  assert.ok(perched.tailPitch > 0 && perched.tailSpread < 1);
});

test('the perch pose is monotonic, so the fold never jitters mid-landing', () => {
  let previous = perchPose(0);
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const current = perchPose(t);
    assert.ok(current.fold >= previous.fold);
    assert.ok(current.span <= previous.span);
    previous = current;
  }
});

test('a blend outside 0..1 clamps instead of folding the wings inside out', () => {
  assert.deepEqual(perchPose(-3), perchPose(0));
  assert.deepEqual(perchPose(7), perchPose(1));
  assert.deepEqual(perchPose(undefined), perchPose(0));
});

test('the tumble is asymmetric, which is what makes a fall read as a fall', () => {
  // A symmetric flap reads as a controlled descent. The two wings must
  // disagree at essentially every moment of the knockdown.
  let agreements = 0;
  for (let t = 0; t < 3; t += 0.02) {
    const { left, right } = tumbleFlap(t);
    if (Math.abs(left - right) < 0.01) agreements++;
  }
  assert.ok(agreements < 8, `wings moved together on ${agreements} samples`);
});

test('tumble intensity scales and clamps', () => {
  assert.deepEqual(tumbleFlap(1, 0), { left: 0, right: 0 });
  const full = tumbleFlap(1, 1);
  const over = tumbleFlap(1, 5);
  assert.deepEqual(over, full, 'intensity above one must clamp');
});

test('the tail drops on a climb and lifts on a dive', () => {
  assert.ok(tailPitchOffset(1) < 0, 'climb should drop the tail');
  assert.ok(tailPitchOffset(-1) > 0, 'dive should lift the tail');
  assert.equal(tailPitchOffset(0), 0);
  // Level flight must be exactly neutral or the bird sits nose-up at rest.
  assert.equal(tailPitchOffset(NaN), 0);
});

test('tail pitch stays inside a readable range at full deflection', () => {
  for (const input of [-5, -1, 0, 1, 5]) {
    assert.ok(Math.abs(tailPitchOffset(input)) <= 0.16);
  }
});

test('the downstroke is faster than the recovery, which is what makes it a bird', () => {
  // A sine spends equal time going down and coming up, and reads as a
  // machine. Power stroke fast, recovery slow.
  let down = 0;
  let up = 0;
  for (let p = 0; p < 1; p += 0.001) {
    const angle = wingBeat(p).angle;
    if (angle < -1e-9) down++;
    else if (angle > 1e-9) up++;
  }
  assert.ok(down > 0 && up > 0, 'the beat must have both halves');
  assert.ok(up > down * 1.3, `recovery (${up}) should be clearly longer than the power stroke (${down})`);
});

test('the wing folds in on the recovery and is fully out on the power stroke', () => {
  // A wing held fully extended on the upstroke pushes the bird back down.
  assert.ok(wingBeat(0.19).span > 0.99, 'span must be full mid-downstroke');
  assert.ok(wingBeat(0.69).span < 0.85, 'span must pull in mid-recovery');
  for (let p = 0; p < 1; p += 0.01) {
    const span = wingBeat(p).span;
    assert.ok(span > 0.6 && span <= 1.0, `span ${span} left the sane range at phase ${p}`);
  }
});

test('the beat is continuous across the wrap, so a cycle has no snap', () => {
  const before = wingBeat(0.999);
  const after = wingBeat(1.001);
  assert.ok(Math.abs(before.angle - after.angle) < 0.05, 'angle jumped across the wrap');
  assert.ok(Math.abs(before.span - after.span) < 0.05, 'span jumped across the wrap');
});

test('a non-finite phase does not produce NaN wings', () => {
  for (const bad of [NaN, Infinity, undefined, null]) {
    const beat = wingBeat(bad);
    assert.ok(Number.isFinite(beat.angle) && Number.isFinite(beat.span));
  }
});

test('the bird flaps in bursts and then glides', () => {
  // Continuous flapping at a constant rate is the artificial thing. Over one
  // full cadence there must be real glide time AND real burst time.
  let beating = 0;
  let gliding = 0;
  for (let t = 0; t < 27; t += 0.01) {
    if (beatEnvelope(t) > 0.5) beating++; else if (beatEnvelope(t) === 0) gliding++;
  }
  assert.ok(beating > 200, `expected substantial burst time, got ${beating}`);
  assert.ok(gliding > 200, `expected substantial glide time, got ${gliding}`);
});

test('bursts ramp rather than switching on for a single frame', () => {
  const envelope = beatEnvelope(0.02);
  assert.ok(envelope > 0 && envelope < 1, `expected a ramp, got ${envelope}`);
});

// ---------------------------------------------------------------------------
// Wing twist and the hand segment (docs/realism/BIRD_PLAN.md Phase 1).
//
// The measurement that motivates these: the bird is ~115-158 CSS px wide at
// the chase camera on a 390x844 phone, so a feather is a few pixels and a barb
// is sub-pixel. What reads as a real bird at that size is surface, silhouette
// and MOTION — and the motion this rig had was one rigid plate rotating about
// the shoulder, which is the one thing a real wing never does.
// ---------------------------------------------------------------------------

test('the wing twists, and the twist leads the sweep rather than tracking it', () => {
  // A real wing pronates (leading edge down) through the downstroke to make
  // thrust, and supinates on the recovery so the primaries can part and spill
  // air. The tell that this is modelled rather than decorated is that twist is
  // NOT proportional to sweep: if it were, it would be the same animation with
  // a different name and could be folded into the shoulder angle.
  let maxAbsRatioSpread = 0;
  const ratios = [];
  for (let i = 1; i < 20; i += 1) {
    const p = i / 20;
    const b = wingBeat(p);
    assert.ok(Number.isFinite(b.twist), `twist must be finite at ${p}`);
    if (Math.abs(b.angle) > 0.02) ratios.push(b.twist / b.angle);
  }
  const lo = Math.min(...ratios);
  const hi = Math.max(...ratios);
  maxAbsRatioSpread = hi - lo;
  assert.ok(maxAbsRatioSpread > 0.5,
    `twist/sweep ratio spans only ${maxAbsRatioSpread.toFixed(3)} — the twist is tracking the sweep, which makes it decoration`);
});

test('pronation on the downstroke, supination on the recovery', () => {
  // Sign convention: positive twist is leading-edge-down (pronation).
  // Downstroke is the first 38% of the beat; recovery is the rest.
  const down = wingBeat(0.19).twist;
  const up = wingBeat(0.69).twist;
  assert.ok(down > 0, `mid-downstroke twist ${down.toFixed(3)} should pronate (positive)`);
  assert.ok(up < 0, `mid-recovery twist ${up.toFixed(3)} should supinate (negative)`);
});

test('twist is bounded — a wing that rotates past a right angle is a propeller', () => {
  for (let i = 0; i <= 40; i += 1) {
    const t = wingBeat(i / 40).twist;
    assert.ok(Math.abs(t) < Math.PI / 4,
      `twist ${t.toFixed(3)} at phase ${(i / 40).toFixed(2)} exceeds 45 degrees`);
  }
});

test('the hand LAGS the shoulder, which is the whole point of having one', () => {
  // The wrist trails the shoulder through the stroke — that lag is what makes
  // a wing read as jointed rather than as a board. Measured as a phase offset:
  // the hand's extremum must arrive LATER in the beat than the shoulder's.
  const samples = [];
  for (let i = 0; i < 200; i += 1) {
    const p = i / 200;
    const b = wingBeat(p);
    assert.ok(Number.isFinite(b.handAngle), `handAngle must be finite at ${p}`);
    samples.push({ p, angle: b.angle, hand: b.handAngle });
  }
  const argMin = (key) => samples.reduce((a, b) => (b[key] < a[key] ? b : a)).p;
  const shoulderLow = argMin('angle');
  const handLow = argMin('hand');
  assert.ok(handLow > shoulderLow,
    `the hand bottoms out at ${handLow.toFixed(3)} and the shoulder at ${shoulderLow.toFixed(3)} — the hand must trail`);
  assert.ok(handLow - shoulderLow < 0.3,
    `lag of ${(handLow - shoulderLow).toFixed(3)} of a beat is a broken wing, not a trailing one`);
});

test('every beat field stays finite and periodic, including the new ones', () => {
  const before = wingBeat(0.999);
  const after = wingBeat(1.999);
  for (const k of ['angle', 'span', 'twist', 'handAngle']) {
    assert.ok(Math.abs(before[k] - after[k]) < 1e-9, `${k} is not periodic across the wrap`);
  }
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
    const b = wingBeat(bad);
    for (const k of ['angle', 'span', 'twist', 'handAngle']) {
      assert.ok(Number.isFinite(b[k]), `${k} is not finite for input ${String(bad)}`);
    }
  }
});
