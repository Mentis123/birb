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
 * THE ANGLE PROFILE IS AN INTEGRATED RAISED COSINE, and that is not
 * decoration. A linear sweep starts and stops at full angular rate, which is
 * a hard jerk of the bird at both ends. Rate `turns * 2PI * (1 - cos(2PI t))` is zero at t=0 and t=1
 * and its integral over the move is EXACTLY `turns * 2PI`, so the move eases
 * in and out and still closes the circle to the last radian. A profile that
 * merely looks smooth and lands at 359 degrees leaves the bird permanently
 * off-level.
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
    duration: 0.95,
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
    duration: 2.0,
    rollTurns: 0,
    pitchTurns: 1,
    cooldown: 1.1,
    minAltitude: 14,
    // Same reasoning, and MORE so: a loop is two seconds, which is long
    // enough for the damped rig to swing all the way round behind the
    // inverted bird.
    stableCamera: 1,
    // Stand twice as far back: the loop's radius is smaller than the normal
    // stand-off, so at 1x the bird goes over the top almost directly above
    // the lens. See follow-camera.js hold.distanceMul.
    cameraDistance: 2.0,
  }),
});

/** Seconds over which the camera hold eases in at move start and out at its end. */
export const CAMERA_HOLD_RAMP = Object.freeze({ in: 0.15, out: 0.25 });

/** Total angle swept by `turns` full turns at normalised time `t`. */
export function sweptAngle(turns, t) {
  const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const spin = Number.isFinite(turns) ? turns : 0;
  // Integral of spin * 2PI * (1 - cos(2PI u)) du from 0 to u.
  return spin * (2 * Math.PI * u - Math.sin(2 * Math.PI * u));
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
    if (Number.isFinite(altitude) && altitude < move.minAltitude) {
      return { started: false, reason: AEROBATIC_REFUSALS.TOO_LOW, need: move.minAltitude, have: altitude };
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
    if (!active) return { active: false, rollDelta: 0, pitchDelta: 0, stableCamera: 0, cameraDistance: 1, t: 0, move: null };

    elapsed += dt;
    const t = Math.min(1, elapsed / active.duration);
    const total = sweptAngle(active.rollTurns + active.pitchTurns, t);
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
      // Positive is a roll INTO a right bank (right wing down). The flight
      // controller owns the axis convention that makes that true.
      rollDelta: active.rollTurns ? step * direction : 0,
      pitchDelta: active.pitchTurns ? step * direction : 0,
      stableCamera: active.stableCamera * ramp,
      cameraDistance: active.cameraDistance ?? 1,
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
 * ROLL; pin it hard up and the climb goes OVER THE TOP. Both are the
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
