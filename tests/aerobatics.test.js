/**
 * Committed aerobatics.
 *
 * The thing that can silently go wrong here is the one thing a capture is
 * bad at judging: whether the move CLOSES. A barrel roll that lands at 359
 * degrees looks perfect in every frame and leaves the bird permanently a
 * degree off level, and the error compounds every time the player uses it.
 * So the angle profile gets its own arithmetic tests, separate from the
 * state machine's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AEROBATIC_MOVES, AEROBATIC_REFUSALS, createAerobatics, sweptAngle,
  moveFromStick, createStickEdgeTrigger, STICK_EDGE,
} from '../src/flight/aerobatics.js';

const TAU = Math.PI * 2;
/** Run a whole move at a fixed step and total what it actually delivered. */
const run = (aero, step = 1 / 60, limit = 600) => {
  let roll = 0; let pitch = 0; let frames = 0; let peakFollow = 0;
  for (let i = 0; i < limit; i += 1) {
    const r = aero.update(step);
    if (!r.active) break;
    roll += r.rollDelta; pitch += r.pitchDelta; frames += 1;
    peakFollow = Math.max(peakFollow, r.stableCamera);
  }
  return { roll, pitch, frames, peakFollow };
};

test('the sweep closes the circle exactly, and starts and ends at rest', () => {
  assert.equal(sweptAngle(1, 0), 0);
  assert.ok(Math.abs(sweptAngle(1, 1) - TAU) < 1e-12, `${sweptAngle(1, 1)} should be 2PI`);
  assert.ok(Math.abs(sweptAngle(2, 1) - 2 * TAU) < 1e-12);
  // Rate is the derivative; sample it as a difference at both ends. A profile
  // that merely looks smooth jerks the whole horizon on the frame it starts.
  const e = 1e-4;
  const rateAtStart = (sweptAngle(1, e) - sweptAngle(1, 0)) / e;
  const rateAtEnd = (sweptAngle(1, 1) - sweptAngle(1, 1 - e)) / e;
  const rateAtMid = (sweptAngle(1, 0.5 + e) - sweptAngle(1, 0.5)) / e;
  assert.ok(rateAtStart < 0.01, `starts at rate ${rateAtStart}`);
  assert.ok(rateAtEnd < 0.01, `ends at rate ${rateAtEnd}`);
  assert.ok(rateAtMid > 2 * TAU * 0.9, `peaks mid-move, got ${rateAtMid}`);
});

test('the sweep is monotonic — a move never rewinds mid-flight', () => {
  let previous = 0;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const a = sweptAngle(1, t);
    assert.ok(a >= previous - 1e-12, `went backwards at t=${t}`);
    previous = a;
  }
});

test('a barrel roll delivers exactly one turn and nothing else', () => {
  const aero = createAerobatics();
  assert.equal(aero.start('roll').started, true);
  const { roll, pitch, frames } = run(aero);
  assert.ok(Math.abs(roll - TAU) < 1e-6, `rolled ${roll}, wanted 2PI`);
  assert.equal(pitch, 0, 'a roll must not pitch');
  assert.ok(frames > 30, `ran only ${frames} frames`);
});

test('a loop delivers exactly one turn of PITCH and nothing else', () => {
  const aero = createAerobatics();
  aero.start('loop');
  const { roll, pitch } = run(aero);
  assert.equal(roll, 0, 'a loop must not roll');
  assert.ok(Math.abs(pitch - TAU) < 1e-6, `pitched ${pitch}, wanted 2PI`);
});

test('direction flips the sign and nothing else', () => {
  const right = createAerobatics(); right.start('roll', { direction: 1 });
  const left = createAerobatics(); left.start('roll', { direction: -1 });
  assert.ok(Math.abs(run(right).roll + run(left).roll) < 1e-9);
});

test('the total is exact whatever the frame rate — even a stuttering one', () => {
  // Deltas are differenced from a swept total rather than integrated from a
  // rate, so a long frame cannot lose angle and a short one cannot gain it.
  for (const step of [1 / 120, 1 / 60, 1 / 30, 0.049]) {
    const aero = createAerobatics();
    aero.start('roll');
    const { roll } = run(aero, step);
    assert.ok(Math.abs(roll - TAU) < 1e-6, `at ${step}s steps the roll totalled ${roll}`);
  }
  // And a delta big enough to be clamped still lands closed, because the
  // clamp only slows the move down; it cannot make it overshoot.
  const aero = createAerobatics();
  aero.start('roll');
  const { roll } = run(aero, 5.0);
  assert.ok(Math.abs(roll - TAU) < 1e-6, `a 5-second hitch left the roll at ${roll}`);
});

test('the stable-camera ramp rises and returns, so the frame cannot snap', () => {
  const aero = createAerobatics();
  aero.start('roll');
  const first = aero.update(1 / 60);
  const { peakFollow } = run(aero);
  assert.ok(first.stableCamera < 0.2, `starts at ${first.stableCamera}`);
  assert.ok(peakFollow > 0.9, `peaks at only ${peakFollow}`);
});

// ── the guards ───────────────────────────────────────────────────────────
test('a move cannot start on top of itself, or inside its own cooldown', () => {
  const aero = createAerobatics();
  aero.start('roll');
  assert.equal(aero.start('roll').reason, AEROBATIC_REFUSALS.ALREADY_ACTIVE);
  run(aero);
  assert.equal(aero.start('roll').reason, AEROBATIC_REFUSALS.COOLING_DOWN);
  for (let i = 0; i < 120; i += 1) aero.update(1 / 60);   // spend the cooldown
  assert.equal(aero.start('roll').started, true);
});

test('a move refuses to start too low, and SAYS SO', () => {
  // The altitude gate is the only guard a player can trip by accident, so it
  // has to be reportable — a deliberate gesture that does nothing and says
  // nothing is the worst feedback there is.
  const aero = createAerobatics();
  const r = aero.start('loop', { altitude: 3 });
  assert.equal(r.started, false);
  assert.equal(r.reason, AEROBATIC_REFUSALS.TOO_LOW);
  assert.equal(r.need, AEROBATIC_MOVES.loop.minAltitude);
  assert.equal(r.have, 3);
  // A loop needs more room than a roll, and both need some.
  assert.ok(AEROBATIC_MOVES.loop.minAltitude > AEROBATIC_MOVES.roll.minAltitude);
  assert.ok(AEROBATIC_MOVES.roll.minAltitude > 0);
});

test('an unknown move is refused rather than crashing the tap handler', () => {
  assert.equal(createAerobatics().start('immelmann').reason, AEROBATIC_REFUSALS.UNKNOWN_MOVE);
});

test('cancel stops the move without charging its cooldown', () => {
  // A knockdown or a landing cancels mid-move, and the player should not then
  // be locked out of the next one for having been hit.
  const aero = createAerobatics();
  aero.start('roll');
  aero.update(0.3);
  assert.equal(aero.cancel(), 'roll');
  assert.equal(aero.state().active, null);
  assert.equal(aero.start('roll').started, true);
});

test('update on an idle machine is inert, not an error', () => {
  const aero = createAerobatics();
  const r = aero.update(1 / 60);
  assert.deepEqual(
    { active: r.active, rollDelta: r.rollDelta, pitchDelta: r.pitchDelta },
    { active: false, rollDelta: 0, pitchDelta: 0 },
  );
});

// ── the trigger: the edges of the stick ──────────────────────────────────
test('only a stick pinned to the rail asks for anything', () => {
  assert.deepEqual(moveFromStick(1, 0), { move: 'roll', direction: 1 });
  assert.deepEqual(moveFromStick(-1, 0), { move: 'roll', direction: -1 });
  assert.deepEqual(moveFromStick(0, 1), { move: 'loop', direction: 1 });
  // THE IMPORTANT HALF. A virtual stick reads 0.6-0.8 through an ordinary
  // hard turn; if those asked for a move the player could not turn hard
  // without rolling, and the feature would read as a bug.
  assert.equal(moveFromStick(0.8, 0), null);
  assert.equal(moveFromStick(0, 0.8), null);
  assert.equal(moveFromStick(0, 0), null);
  assert.equal(moveFromStick(NaN, undefined), null);
  // A hard bank wins over a hard climb: a stick in a corner is far more
  // likely to be a committed turn than a deliberate diagonal.
  assert.equal(moveFromStick(1, 1).move, 'roll');
});

test('a normal hard turn never earns a move, however long it is held', () => {
  const trigger = createStickEdgeTrigger();
  let fired = 0;
  for (let i = 0; i < 600; i += 1) if (trigger.update(0.8, 0, 1 / 60)) fired += 1;
  assert.equal(fired, 0, 'ten seconds of an ordinary hard turn must not roll the bird');
});

test('the rail has to be HELD, and then it fires once', () => {
  const trigger = createStickEdgeTrigger();
  // Short of the dwell, nothing.
  for (let i = 0; i < Math.floor(STICK_EDGE.dwell * 60) - 2; i += 1) {
    assert.equal(trigger.update(1, 0, 1 / 60), null);
  }
  let fires = 0;
  for (let i = 0; i < 4; i += 1) if (trigger.update(1, 0, 1 / 60)) fires += 1;
  assert.equal(fires, 1, 'one hold must earn exactly one move, not one per frame');
});

test('leaving the rail forgets the hold entirely', () => {
  const trigger = createStickEdgeTrigger();
  for (let i = 0; i < 30; i += 1) trigger.update(1, 0, 1 / 60);
  trigger.update(0, 0, 1 / 60);                       // thumb comes off
  assert.equal(trigger.progress(), 0);
  for (let i = 0; i < 30; i += 1) {
    assert.equal(trigger.update(1, 0, 1 / 60), null, 'credit carried across a release');
  }
});

test('changing which move you are asking for restarts the hold', () => {
  // Easing from a hard left into a hard climb must not bank a roll's worth of
  // dwell into a loop — they are different requests.
  const trigger = createStickEdgeTrigger();
  for (let i = 0; i < 30; i += 1) trigger.update(-1, 0, 1 / 60);
  const r = trigger.update(0, 1, 1 / 60);
  assert.equal(r, null);
  assert.equal(trigger.progress() < 0.1, true);
});

test('holding the rail keeps asking, so a long hold rolls more than once', () => {
  // The owner's own words: "banking way left can roll around". Staying pinned
  // should keep rolling, not fire once and go quiet.
  const trigger = createStickEdgeTrigger();
  let fired = 0;
  for (let i = 0; i < 600; i += 1) if (trigger.update(1, 0, 1 / 60)) fired += 1;
  assert.ok(fired >= 2, `ten seconds pinned earned only ${fired} move(s)`);
});

test('reset clears a hold — for a knockdown, a landing or a nest', () => {
  const trigger = createStickEdgeTrigger();
  for (let i = 0; i < 30; i += 1) trigger.update(1, 0, 1 / 60);
  trigger.reset();
  assert.equal(trigger.progress(), 0);
});

// ---------------------------------------------------------------------------
// The wider loop and the loop under (2026-09-13, from the phone: "have the
// radius of the turn wider — it's almost pivoting on its own axis", "the
// nose dive into inverted isn't working yet", "smoother and a little slower").
// ---------------------------------------------------------------------------

test('ease 0.5 IS the original raised cosine, to the last bit', () => {
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const expected = 2 * Math.PI * t - Math.sin(2 * Math.PI * t);
    assert.ok(Math.abs(sweptAngle(1, t, 0.5) - expected) < 1e-12, `t=${t}`);
    assert.ok(Math.abs(sweptAngle(1, t) - expected) < 1e-12, `default ease at t=${t}`);
  }
});

test('an eased trapezoid still closes exactly, never rewinds, and rests at both ends', () => {
  for (const ease of [0.05, 0.15, 0.22, 0.35, 0.49]) {
    assert.equal(sweptAngle(1, 0, ease), 0);
    assert.ok(Math.abs(sweptAngle(1, 1, ease) - TAU) < 1e-12, `ease ${ease} closes at ${sweptAngle(1, 1, ease)}`);
    assert.ok(Math.abs(sweptAngle(-2, 1, ease) + 2 * TAU) < 1e-12, `ease ${ease}, two turns the other way`);
    let prev = 0;
    for (let i = 1; i <= 1000; i++) {
      const a = sweptAngle(1, i / 1000, ease);
      assert.ok(a >= prev - 1e-12, `ease ${ease}: rewound at ${i / 1000}`);
      prev = a;
    }
    const e = 1e-4;
    const rateAtStart = (sweptAngle(1, e, ease) - sweptAngle(1, 0, ease)) / e;
    const rateAtEnd = (sweptAngle(1, 1, ease) - sweptAngle(1, 1 - e, ease)) / e;
    const rateAtMid = (sweptAngle(1, 0.5 + e, ease) - sweptAngle(1, 0.5, ease)) / e;
    assert.ok(rateAtStart < 0.01 * rateAtMid, `ease ${ease}: starts at rest`);
    assert.ok(rateAtEnd < 0.01 * rateAtMid, `ease ${ease}: ends at rest`);
  }
});

test('the plateau rate is 2PI / (1 - ease): a flatter profile turns SLOWER at its fastest', () => {
  const e = 1e-4;
  const peak = (ease) => (sweptAngle(1, 0.5 + e, ease) - sweptAngle(1, 0.5, ease)) / e;
  assert.ok(Math.abs(peak(0.22) - TAU / 0.78) < 1e-3, `plateau ${peak(0.22)}`);
  assert.ok(Math.abs(peak(0.5) - 2 * TAU) < 1e-3, `raised cosine peaks at twice the average, got ${peak(0.5)}`);
  assert.ok(peak(0.22) < peak(0.5) / 1.5, 'the trapezoid must peak well below the raised cosine');
  // Out-of-range ease is clamped, never a NaN or an open circle.
  assert.ok(Math.abs(sweptAngle(1, 1, 0) - TAU) < 1e-12);
  assert.ok(Math.abs(sweptAngle(1, 1, 0.9) - TAU) < 1e-12);
  assert.ok(Math.abs(sweptAngle(1, 1, NaN) - TAU) < 1e-12);
});

test('the loop is wide enough not to pivot: radius at cruise is at least 5 units', () => {
  // Radius = speed / angular rate, at the plateau, at the speed the move
  // actually flies (cruise 11, bird-flight.js FLIGHT_DEFAULTS.speed).
  const loop = AEROBATIC_MOVES.loop;
  const plateauRate = (loop.pitchTurns * TAU) / (loop.duration * (1 - loop.ease));
  const radius = (11 * loop.speedMul) / plateauRate;
  assert.ok(radius >= 5, `loop radius ${radius.toFixed(2)} at cruise; the raised-cosine 2.0 s loop was 1.75`);
  assert.ok(loop.ease < 0.5, 'the loop needs a plateau, or the middle of it pivots');
  assert.ok(loop.speedMul > 1, 'a loop carries speed');
  // And the roll is what got slower: "smoother and a little slower".
  assert.ok(AEROBATIC_MOVES.roll.duration >= 1.2, `roll duration ${AEROBATIC_MOVES.roll.duration}`);
  assert.equal(AEROBATIC_MOVES.roll.speedMul, 1, 'a roll does not change speed');
});

test('a loop under needs more room than a loop over, and says how much', () => {
  const loop = AEROBATIC_MOVES.loop;
  assert.ok(loop.minAltitudeDown > loop.minAltitude);
  // At least the diameter at cruise-with-boost plus the bird.
  const plateauRate = (loop.pitchTurns * TAU) / (loop.duration * (1 - loop.ease));
  const diameter = 2 * (11 * loop.speedMul) / plateauRate;
  assert.ok(loop.minAltitudeDown >= diameter + 2, `gate ${loop.minAltitudeDown} vs diameter ${diameter.toFixed(1)}`);
  const a = createAerobatics();
  const under = a.start('loop', { direction: -1, altitude: loop.minAltitude + 1 });
  assert.equal(under.started, false);
  assert.equal(under.reason, AEROBATIC_REFUSALS.TOO_LOW);
  assert.equal(under.need, loop.minAltitudeDown);
  const over = a.start('loop', { direction: 1, altitude: loop.minAltitude + 1 });
  assert.equal(over.started, true, 'the same altitude is enough going over');
});

test('a pinned dive asks for the loop under; a merely hard dive asks for nothing', () => {
  assert.deepEqual(moveFromStick(0, -1), { move: 'loop', direction: -1 });
  assert.deepEqual(moveFromStick(0, -0.98), { move: 'loop', direction: -1 });
  assert.equal(moveFromStick(0, -0.8), null);
  // A hard bank still wins over a hard dive in the corner.
  assert.equal(moveFromStick(-1, -1).move, 'roll');
});

test('update reports the speed multiplier and the angle swept so far', () => {
  const a = createAerobatics();
  a.start('loop', { direction: -1 });
  let last = 0;
  let sawMul = false;
  for (let i = 0; i < 400; i++) {
    const r = a.update(1 / 60);
    if (!r.active) break;
    assert.equal(r.speedMul, AEROBATIC_MOVES.loop.speedMul);
    assert.equal(r.direction, -1);
    assert.ok(r.swept >= last, 'swept is monotonic');
    assert.ok(r.pitchDelta <= 0, 'a loop under pitches nose-down throughout');
    last = r.swept;
    sawMul = true;
  }
  assert.ok(sawMul);
  assert.ok(Math.abs(last - TAU) < 1e-6, `swept ${last}`);
  const idle = a.update(1 / 60);
  assert.equal(idle.speedMul, 1);
  assert.equal(idle.swept, 0);
  const b = createAerobatics();
  b.start('roll');
  assert.equal(b.update(1 / 60).speedMul, 1);
});

test('the loop under needs a longer hold than a roll or a loop over, and progress is measured against it', () => {
  assert.ok(STICK_EDGE.dwellUnder > STICK_EDGE.dwell, `dwellUnder ${STICK_EDGE.dwellUnder} vs dwell ${STICK_EDGE.dwell}`);
  assert.ok(STICK_EDGE.dwell >= 1.0, `a dwell under a second fires inside an ordinary committed turn (got ${STICK_EDGE.dwell})`);
  assert.ok(STICK_EDGE.edge >= 0.97, `edge ${STICK_EDGE.edge}: a virtual stick reads 0.6-0.8 through a hard turn`);
  const t = createStickEdgeTrigger();
  // Held exactly as long as a roll needs: a dive has not earned its loop yet.
  let fired = null;
  for (let i = 0; i < Math.round(STICK_EDGE.dwell * 60) + 1; i += 1) fired = t.update(0, -1, 1 / 60) || fired;
  assert.equal(fired, null, 'a dive pinned for a roll-length hold must not flip');
  assert.ok(t.progress() < 1 && t.progress() > 0.6, `progress ${t.progress().toFixed(2)} is measured against the longer hold`);
  for (let i = 0; i < Math.round((STICK_EDGE.dwellUnder - STICK_EDGE.dwell) * 60) + 2; i += 1) fired = t.update(0, -1, 1 / 60) || fired;
  assert.deepEqual(fired, { move: 'loop', direction: -1 });
  // And the roll still fires at its own, shorter, dwell.
  const r = createStickEdgeTrigger();
  let roll = null;
  for (let i = 0; i < Math.round(STICK_EDGE.dwell * 60) + 2; i += 1) roll = r.update(1, 0, 1 / 60) || roll;
  assert.deepEqual(roll, { move: 'roll', direction: 1 });
});
