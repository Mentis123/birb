/**
 * Committed aerobatic manoeuvres — the barrel roll and the loop.
 *
 * WHY COMMITTED, AND NOT FREE 6DOF. The obvious way to get a barrel roll into
 * a flight game is an explicit roll input, and on this game it is the wrong
 * one twice over. There is no spare input — the whole control surface is one
 * thumbstick and one BOOST pill, both already under a thumb — and free
 * inverted flight would have to answer for the nesting state machine, the
 * landing check and a ground floor that is a MINIMUM RADIUS with no opinion
 * about which way up the bird is. A move that starts, runs on rails for about
 * a second, and hands back a level bird answers none of those questions
 * because it never leaves them open.
 *
 * Nothing here touches THREE, the DOM or the flight controller. It is the
 * angle arithmetic and the state machine only, so the timing can be tested
 * without a renderer — the same split `bird-pose.js` uses.
 *
 * THE ANGLE PROFILE IS A TRAPEZOID WITH RAISED-COSINE ENDS, and that is not
 * decoration. A linear sweep starts and stops at full angular rate, which is
 * a hard jerk of the bird at both ends; a pure raised cosine (the first
 * version) eases beautifully but concentrates the whole turn in the middle
 * of the move, and the LOOP paid for that: its radius is speed over angular
 * rate, the raised cosine's peak rate is twice the average, and at cruise
 * that put the bird on a 1.75-unit circle — "almost pivoting on its own
 * axis", from the phone. Each move now names how much of its duration is
 * ease (`ease`, each end); the rate ramps up over that fraction, holds a
 * plateau, ramps down, and its integral is EXACTLY `turns * 2PI` whatever
 * the ease, so the move still closes the circle to the last radian. A
 * profile that merely looks smooth and lands at 359 degrees leaves the bird
 * permanently off-level. `ease = 0.5` has no plateau and IS the raised
 * cosine, which is what the roll still uses — a roll has no radius to widen.
 */

/**
 * `minAltitude` is clearance above the GROUND, not above the sphere.
 *
 * The loop needs the more of it, and not for the reason it first appears.
 * A forward loop pitches UP and over, so the top of it is never the problem;
 * what matters is that the bird comes back down through roughly its starting
 * altitude with its nose still swinging, and the flight floor is a hard
 * clamp that would catch it mid-arc and leave the manoeuvre deformed. The
 * loop's own radius is speed / angular-rate — at the cruise 11 and a 2.0 s
 * turn that is about 3.5 units, so ~7 across — and the gate is set well
 * above it rather than exactly at it, because the player's altitude at the
 * moment of the tap is not the altitude the terrain has a little further
 * along the track.
 */
export const AEROBATIC_MOVES = Object.freeze({
  roll: Object.freeze({
    id: 'roll',
    label: 'Barrel roll',
    // 1.3, from 0.95: "smoother and a little slower", after the freeze at
    // the start was fixed elsewhere (index.html keeps the model's own bank
    // through the move instead of muting it — the mute unwinding a 63-degree
    // bank while the sweep was still easing in read as the bird stopping).
    duration: 1.3,
    // Full raised cosine: no plateau. A roll has no radius to widen.
    ease: 0.5,
    speedMul: 1,
    rollTurns: 1,
    pitchTurns: 0,
    cooldown: 0.7,
    minAltitude: 5,
    // How hard the chase camera HOLDS A STABLE FRAME during the move, 0..1
    // — radial up, and the heading the bird had when the move began. The
    // first version reasoned the opposite way ("a roll must carry the
    // camera"), and the phone said no: the chase rig derives its up and its
    // offset from the bird's own orientation, so a camera left to follow the
    // move rolls WITH the bird and the bird never visibly inverts, and in a
    // loop the offset swings to the far side as the nose comes over the top
    // and the whole world reads as going backwards. The move is only legible
    // against something that does not move.
    stableCamera: 1,
    // A roll does not displace the bird, so the usual stand-off is right.
    cameraDistance: 1,
  }),
  loop: Object.freeze({
    id: 'loop',
    label: 'Loop',
    // The radius is speed over angular rate, and both halves of that were
    // moved to widen it: 2.6 s (from 2.0) with a plateau (ease 0.22, so the
    // peak rate is 2PI / (2.6 * 0.78) = 3.1 rad/s against the raised cosine's
    // 6.3), and the bird flies the loop at 1.5x cruise the way a real loop
    // entry carries speed. At cruise 11 that is a 5.3-unit minimum radius —
    // three times the 1.75 that read as pivoting.
    duration: 2.6,
    ease: 0.22,
    speedMul: 1.5,
    rollTurns: 0,
    pitchTurns: 1,
    cooldown: 1.1,
    minAltitude: 14,
    // Going OVER (direction +1) the bird climbs first and comes back to its
    // own altitude. Going UNDER (direction -1 — the nose-down "into inverted"
    // from a pinned dive) it descends by the whole diameter first: two
    // radii of about 5.3 at cruise, more with boost, plus the bird. The
    // flight floor is a hard clamp that would catch it mid-arc and leave the
    // manoeuvre deformed, so the gate is the diameter with a margin.
    minAltitudeDown: 24,
    // Same reasoning, and MORE so: a loop is two seconds, which is long
    // enough for the damped rig to swing all the way round behind the
    // inverted bird.
    stableCamera: 1,
    // Stand well back: the loop's radius is of the order of the normal
    // stand-off, so at 1x the bird goes over the top almost directly above
    // the lens. See follow-camera.js hold.distanceMul. 2.6 keeps the whole
    // wider circle in frame.
    cameraDistance: 2.6,
  }),
});

/** Seconds over which the camera hold eases in at move start and out at its end. */
export const CAMERA_HOLD_RAMP = Object.freeze({ in: 0.15, out: 0.25 });

/**
 * Total angle swept by `turns` full turns at normalised time `t`.
 *
 * `ease` is the fraction of the move spent ramping at EACH end (0.01..0.5).
 * The rate is a half raised cosine up over [0, ease], a plateau over
 * [ease, 1 - ease], and a half raised cosine down over [1 - ease, 1]; with
 * the plateau rate P, the integral is P * (ease/2 + (1 - 2 ease) + ease/2) =
 * P * (1 - ease), so P = turns * 2PI / (1 - ease) closes the circle exactly.
 * At ease = 0.5 the two ramps meet with no plateau and the expression
 * reduces to spin * (2PI u - sin 2PI u) — the original raised cosine, to
 * the last bit, which the tests check.
 */
export function sweptAngle(turns, t, ease = 0.5) {
  const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const spin = Number.isFinite(turns) ? turns : 0;
  const e = Math.min(0.5, Math.max(0.01, Number.isFinite(ease) ? ease : 0.5));
  const plateau = (spin * 2 * Math.PI) / (1 - e);
  if (u <= e) {
    // Integral of plateau * (1 - cos(PI u / e)) / 2.
    return plateau * (u / 2 - (e / (2 * Math.PI)) * Math.sin((Math.PI * u) / e));
  }
  if (u <= 1 - e) return plateau * (e / 2 + (u - e));
  const v = u - (1 - e);
  // Integral of plateau * (1 + cos(PI v / e)) / 2 from the plateau's end.
  return plateau * (e / 2 + (1 - 2 * e) + v / 2 + (e / (2 * Math.PI)) * Math.sin((Math.PI * v) / e));
}

/**
 * Why a move was refused, so a caller can say something useful rather than
 * swallowing the tap. "Nothing happened" is the worst possible feedback for
 * a gesture the player just deliberately made.
 */
export const AEROBATIC_REFUSALS = Object.freeze({
  UNKNOWN_MOVE: 'unknown-move',
  ALREADY_ACTIVE: 'already-active',
  COOLING_DOWN: 'cooling-down',
  TOO_LOW: 'too-low',
});

export function createAerobatics(moves = AEROBATIC_MOVES) {
  let active = null;      // the move descriptor, or null
  let elapsed = 0;
  let cooldown = 0;
  let direction = 1;      // +1 or -1; which way the roll goes
  let swept = 0;          // angle already delivered this move, for exact deltas

  /**
   * Try to begin a move.
   *
   * `altitude` is the bird's clearance above the ground. Pass it; the default
   * of Infinity exists for tests and for the debug hook, and a caller that
   * forgets it gets a move that can start inside a hill.
   */
  function start(moveId, { direction: dir = 1, altitude = Infinity } = {}) {
    const move = moves[moveId];
    if (!move) return { started: false, reason: AEROBATIC_REFUSALS.UNKNOWN_MOVE };
    if (active) return { started: false, reason: AEROBATIC_REFUSALS.ALREADY_ACTIVE };
    if (cooldown > 0) return { started: false, reason: AEROBATIC_REFUSALS.COOLING_DOWN, wait: cooldown };
    // The gate depends on which way the move goes: a loop UNDER descends
    // by its whole diameter before it climbs (see minAltitudeDown).
    const need = dir < 0 && Number.isFinite(move.minAltitudeDown) ? move.minAltitudeDown : move.minAltitude;
    if (Number.isFinite(altitude) && altitude < need) {
      return { started: false, reason: AEROBATIC_REFUSALS.TOO_LOW, need, have: altitude };
    }
    active = move;
    elapsed = 0;
    swept = 0;
    direction = dir < 0 ? -1 : 1;
    return { started: true, move: move.id, label: move.label };
  }

  /**
   * Advance, and return THIS FRAME'S rotation deltas in radians.
   *
   * Deltas, not absolute angles, because the caller composes them onto a
   * quaternion it also owns — the player's own yaw and the sphere's parallel
   * transport are writing to the same orientation between our frames, and an
   * absolute angle would fight both. They are differenced from the swept
   * total rather than integrated from the rate, so rounding cannot
   * accumulate and the move still closes exactly.
   */
  function update(delta) {
    const dt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.1));
    if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
    if (!active) {
      return {
        active: false, move: null, t: 0, direction: 0, swept: 0,
        rollDelta: 0, pitchDelta: 0, stableCamera: 0, cameraDistance: 1, speedMul: 1,
      };
    }

    elapsed += dt;
    const t = Math.min(1, elapsed / active.duration);
    const total = sweptAngle(active.rollTurns + active.pitchTurns, t, active.ease);
    const step = total - swept;
    swept = total;

    // Camera hold: IN fast, OUT at the end, FULL in between. This was a
    // sin(PI t) over the whole move and the loop was still wild, and the
    // probe said why: at half weight the rig's frame is a blend of the held
    // frame and the bird's own — which mid-loop is pointing straight up —
    // so for most of the move the camera was half-following the tumble. A
    // manoeuvre needs the frame held for its WHOLE duration; the ramps are
    // only there so the two transitions are not single-frame snaps.
    const seconds = elapsed;
    const remaining = Math.max(0, active.duration - elapsed);
    const ramp = Math.max(0, Math.min(1,
      Math.min(seconds / CAMERA_HOLD_RAMP.in, remaining / CAMERA_HOLD_RAMP.out)));
    const result = {
      active: true,
      move: active.id,
      t,
      direction,
      // Angle delivered so far, unsigned. index.html unwinds the visual
      // wind-up against this so the two motions can never fight.
      swept: total,
      // Positive is a roll INTO a right bank (right wing down). The flight
      // controller owns the axis convention that makes that true.
      rollDelta: active.rollTurns ? step * direction : 0,
      pitchDelta: active.pitchTurns ? step * direction : 0,
      stableCamera: active.stableCamera * ramp,
      cameraDistance: active.cameraDistance ?? 1,
      // Cruise multiplier for the duration of the move; 1 leaves it alone.
      speedMul: active.speedMul ?? 1,
    };

    if (t >= 1) {
      cooldown = active.cooldown;
      active = null;
      elapsed = 0;
      swept = 0;
    }
    return result;
  }

  /** Abandon the move without running its cooldown — for a knockdown or a nest. */
  function cancel() {
    const was = active;
    active = null;
    elapsed = 0;
    swept = 0;
    return was ? was.id : null;
  }

  function state() {
    return {
      active: active ? active.id : null,
      t: active ? Math.min(1, elapsed / active.duration) : 0,
      cooldown: +cooldown.toFixed(3),
    };
  }

  return { start, update, cancel, state };
}

/**
 * THE MOVES LIVE AT THE EDGES OF THE STICK YOU ALREADY HAVE.
 *
 * This replaced a double-tap on the BOOST pill, and the reason is the whole
 * point: the first thing the owner said about that trigger was "I'm not
 * getting how this works — or isn't". A gesture that has to be explained,
 * on a control surface with no room to explain it, is a feature nobody
 * finds. Pin the stick hard over and keep it there and the bank becomes a
 * ROLL; pin it hard up and the climb goes OVER THE TOP; pin it hard down
 * and the dive goes UNDER through inverted. All three are the
 * continuation of something the player was already doing, so there is
 * nothing to discover — the move is what happens when you ask for more of
 * what you have got.
 *
 * `edge` is deliberately close to 1. A virtual stick reads 0.6-0.8 through
 * an ordinary hard turn; only a thumb pressed to the rail sustains 0.94, so
 * the move cannot fire out of normal flying. `dwell` then asks for that rail
 * to be HELD, which is what separates "I am turning hard" from "I meant it":
 * the climb has already reached the 80-degree pitch ceiling by then and the
 * bank has already reached full deflection, so in both cases the aircraft
 * has visibly run out of the ordinary control before the extraordinary one
 * takes over.
 *
 * Returns null when the stick is not asking for anything.
 */
export const STICK_EDGE = Object.freeze({ edge: 0.94, dwell: 0.55 });

export function moveFromStick(x = 0, y = 0, { edge = STICK_EDGE.edge } = {}) {
  const sx = Number.isFinite(x) ? x : 0;
  const sy = Number.isFinite(y) ? y : 0;
  // A hard bank wins over a hard climb: you cannot roll and loop at once,
  // and a stick held into a corner is far more likely to be a turn the
  // player is committed to than a deliberate diagonal.
  if (Math.abs(sx) >= edge) return { move: 'roll', direction: sx > 0 ? 1 : -1 };
  if (sy >= edge) return { move: 'loop', direction: 1 };
  // Pinned DOWN: the dive goes on through the vertical into inverted and
  // round — a loop under. "The nose dive into inverted isn't working yet"
  // was this line not existing: a held dive sat at the 80-degree ceiling
  // for as long as the rail was held, asking for more and getting nothing.
  if (sy <= -edge) return { move: 'loop', direction: -1 };
  return null;
}

/**
 * Track how long the stick has been pinned, and say when a move is earned.
 *
 * Stateful because a dwell is, and separate from the machine above because
 * the machine has no business knowing what an input is. Reset the moment the
 * stick leaves the rail OR changes which move it is asking for, so easing
 * from a hard left into a hard climb does not bank a roll's worth of credit
 * into a loop.
 */
export function createStickEdgeTrigger({ edge = STICK_EDGE.edge, dwell = STICK_EDGE.dwell } = {}) {
  let held = 0;
  let heldMove = null;
  /** @returns the earned move, or null. Fires ONCE per hold. */
  function update(x, y, delta) {
    const ask = moveFromStick(x, y, { edge });
    if (!ask) { held = 0; heldMove = null; return null; }
    const key = `${ask.move}:${ask.direction}`;
    if (key !== heldMove) { heldMove = key; held = 0; }
    held += Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 0.1));
    if (held < dwell) return null;
    // Zero rather than subtract: holding the rail through a whole move and
    // out the other side should ask for the NEXT one from scratch, not bank
    // the time the move itself took and fire again the instant it ends.
    held = 0;
    return ask;
  }
  function reset() { held = 0; heldMove = null; }
  function progress() { return Math.min(1, held / dwell); }
  return { update, reset, progress };
}
