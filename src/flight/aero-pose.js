/**
 * aero-pose.js — let the air pose the bird.
 *
 * The rig in index.html used to pose the wings, tail and feet from the RAW
 * STICK: `climbing = pitchInput > 0.2` decided whether the bird beat its
 * wings, and `tailPitchOffset(stick.y)` set its elevator. Under the shipping
 * stunt model the pitch axis is inverted INSIDE the controller (pull back =
 * stick DOWN = nose up), so both read backwards: measured on the base
 * (tools/realism-checks/flap-follows-climb.mjs) a 42-degree dive flapped ~2.4x
 * harder than a 43-degree climb and the tail moved the wrong way. And nothing
 * the flight model knows — airspeed, the energy target, the throttle, the
 * climb, the load, the stall — ever reached the pose. The beat ran on a fixed
 * 1.55 s burst / 1.15 s glide timer whatever the bird was doing.
 *
 * This module turns the AERODYNAMIC STATE into a pose. It is pure arithmetic
 * plus one small smoother with pre-allocated state: no THREE, no DOM, no
 * flight physics. index.html measures the inputs (airspeed from the
 * controller, climb and body rates from the flight frame's own motion) and
 * applies the outputs to the named rig groups. Every output is bounded and
 * every term is smooth, so nothing snaps on the frame a state flips.
 *
 * What drives what, and where each number comes from:
 *
 *  - THE BEAT is a power output, not a timer. Frequency is near constant
 *    (cockatiels change wingbeat frequency only ~1.2x between 1 and 13 m/s —
 *    Hedrick, Tobalske & Biewener 2003); what changes is AMPLITUDE, and the
 *    amplitude follows POWER DEMAND: U-shaped in airspeed (induced power ~
 *    1/V, parasite ~ V^3, minimum near cruise — Pennycuick's power curve),
 *    plus the power to climb and to accelerate toward the energy model's
 *    target, scaled by the throttle. Descend nose-down, cut the throttle or
 *    fly fast and the demand falls below the glide line and the wings stop.
 *    Intermittent flyers flap a larger FRACTION of the time as demand rises,
 *    so the burst duty cycle follows demand too, reaching continuous flapping
 *    on a climb.
 *  - THE STROKE is a Bronze-winged Pionus's: "very deep wingbeats seem to
 *    almost touch on the downstroke and barely come above horizontal on the
 *    upstroke" (eBird, Bronze-winged Parrot). The stroke is anchored at the
 *    TOP — its peak sits just above the glide line at any depth — and the
 *    depth goes DOWN. The wing flexes on the upstroke, the hand lags the arm,
 *    the wing pronates going down and supinates coming up.
 *  - SPEED MORPHS THE WING. Gliding birds pull their span in as they speed
 *    up (jackdaws: Rosen & Hedenstrom 2001; Pennycuick) and sweep it back as
 *    it shortens (swifts: Lentink et al. 2007, Nature). Same slope, anchored
 *    at cruise — the literal intercept would fly the signed-off parrot wing
 *    at 75% span for most of the game. A dive or a boost reads as a
 *    falcon-like partial tuck.
 *  - HIGH LIFT OPENS THE HAND. Near the stall, or pulling hard at low speed,
 *    the lift coefficient runs up toward its maximum: the primaries splay and
 *    the tail fans wide (pigeons spread the tail to ~151 degrees for take-off
 *    and landing — Berg & Biewener 2010). Fast, the tail furls.
 *  - THE TAIL IS AN ELEVATOR with the right sign: it follows the elevator
 *    INTENT (stick times the controller's own pitch sign), dropping on a
 *    climb. It twists into a roll.
 *  - LOAD FLEXES THE WING UP: extra dihedral in proportion to the load
 *    factor (pitch rate x airspeed), and a brief flick on a gust. The gust
 *    input exists and is wired to zero until an air field exists to feed it.
 *  - THE FEET come down as landing gear on an approach — low, descending,
 *    slow, about 1-3 beats before contact — and tuck again climbing away.
 *
 * Conventions (all angles radians):
 *   wingX   + drops the tips (added to the LEFT wing's rotation.x; the
 *           caller mirror-signs the right wing, as for every symmetric term)
 *   wingY   + sweeps the wings AFT (caller mirror-signs)
 *   wingZ   + raises the leading edge (same sign on both wings)
 *   handX   + drops the hand at the wrist. SAME sign on both wings: the hand
 *           is a child INSIDE the arm's scale.z = -1, so the mirror has
 *           already been applied to its frame.
 *   handY   + sweeps the hand forward (same sign on both wings)
 *   tailPitch  + drops the tail tip (rotation.z of the tail group)
 *   tailTwist  + drops the tail's right edge (rotation.x of the tail group)
 */

import { tailPitchOffset } from './bird-pose.js';

/* ------------------------------------------------------------------ tuning */

export const AERO_POSE_DEFAULTS = Object.freeze({
  // ---- the beat ----
  // Centre frequency and its total fractional spread across depth 0..1:
  // 3.9 -> 4.5 Hz, a 1.15x range (the cockatiel's is ~1.2x).
  beatHz: 4.2,
  beatHzRange: 0.14,
  // Share of the cycle spent in the downstroke. 0.38 is the old wingBeat's,
  // kept so tools/birb-bird-sheet.mjs's three flap phases (0 top, 0.19
  // mid-downstroke, 0.7 recovery) still land where their labels say.
  downFrac: 0.38,
  // The Pionus stroke at full depth: 0.22 rad ABOVE the glide line at the
  // top and 0.90 BELOW it at the bottom — with the 0.12 glide droop, the
  // shoulder lifts the wing ~6 degrees above horizontal and drives it ~58
  // degrees below. Anchored at the top, so a deeper stroke only goes DOWN.
  // First cut was 0.30 up: measured on the page the climbing wingtip rose
  // 16 degrees above the shoulder, which is not "barely".
  strokeUp: 0.22,
  strokeDown: 0.90,
  // Span pulled in at mid-upstroke, full depth.
  upFlex: 0.26,
  // The hand trails the arm by this fraction of a beat, bending at the
  // wrist by `handGain` per radian of arm lead, and sweeps back on the
  // upstroke by up to `handFold`.
  handLag: 0.09,
  handGain: 0.5,
  handFold: 0.30,
  // Pronation (leading edge down) through the downstroke, supination
  // through the upstroke, leading the stroke by `twistLead` of a beat.
  twistDown: 0.22,
  twistUp: 0.16,
  twistLead: 0.08,
  // The glide line: a gentle droop below the base rig, more in a bank. The
  // old rig's was 0.18; 0.12 keeps the bottom of a CRUISE stroke (0.12 +
  // 0.22 x 0.90 = 0.32) far enough above the perch fold (0.70) that
  // tools/birb-walk.mjs's "the wing moved on landing" (> 0.30) holds at any
  // phase of the beat, not just most of them.
  glideDroop: 0.12,
  bankDroop: 0.12,
  // Idle flutter while gliding, as the old rig had (0.035 rad at 1.7 rad/s).
  flutterAmp: 0.035,
  flutterRate: 1.7,

  // ---- power demand (1.0 = level flight at cruise) ----
  // How much of the load factor's square reaches the induced term.
  loadInduced: 0.35,
  // Demand per unit of radial climb rate over cruise speed.
  climbPower: 2.0,
  // Demand per unit of (target - speed)/cruise, times speed/cruise.
  accelPower: 3.0,
  // Demand per unit of elevator intent: the anticipation that makes a pull
  // flap on its first frame, before the climb has developed.
  intentPower: 0.5,
  // Below this the bird glides; at `demandContinuous` the bursts become
  // continuous flapping; at `demandFull` the stroke reaches full depth.
  // Level cruise (1.0) is a 0.22-deep stroke flown 56% of the time, which is
  // the old idle beat's size and duty; a 43-degree climb is full depth.
  demandGlide: 0.55,
  demandContinuous: 1.35,
  demandFull: 2.6,
  // Burst-and-glide period. Duty follows demand.
  burstPeriod: 2.7,

  // ---- speed morph ----
  stallMul: 0.5,
  // Span lost per unit of V/Vstall past cruise (the jackdaw's slope).
  spanSlope: 0.25,
  spanMin: 0.62,
  // Aft sweep per unit of span lost, and forward sweep in slow flight.
  sweepPerSpan: 0.9,
  slowSweepFwd: 0.10,

  // ---- high lift ----
  // The energy model's own gravity, units/s^2 (FLIGHT_STUNT_DEFAULTS.gSpeed).
  gRef: 6.5,
  // Pitch-rate deadband before it counts as load: parallel transport alone
  // turns a level bird ~V/R = 0.09 rad/s nose-down.
  loadDeadband: 0.12,
  // Splay ramps in over this band of CL/CLmax = n / (V/Vstall)^2.
  splayOn: 0.55,
  splayFull: 0.95,
  // Slow flight spreads the tail over this band of V/cruise.
  slowFanFrom: 0.85,
  slowFanTo: 0.55,
  // Fast flight furls it over this band.
  fastFrom: 1.15,
  fastTo: 1.8,
  tailFanMax: 1.55,
  tailFurlMin: 0.74,
  // The hand's chord scale and forward sweep at full splay.
  handSpread: 0.35,
  handSplayFwd: 0.10,

  // ---- tail ----
  // Gain on tailPitchOffset's shape: 0.16 rad at a full climb is ~9 degrees,
  // under the chase camera's threshold of legibility; x1.5 is 14.
  tailElevatorGain: 1.5,
  // Extra drop at full high lift (a landing flare).
  tailFlare: 0.10,
  // Twist into a roll: 0.12 rad per rad/s, so the stunt law's opening roll
  // at an ordinary hard stick (~1.3 rad/s) reads as ~9 degrees.
  tailTwistPerRate: 0.12,
  tailTwistMax: 0.22,
  // The old rig's steering fan: +20% at full stick.
  tailYawFan: 0.20,

  // ---- load ----
  flexPerG: 0.07,
  flexMax: 0.30,
  flexMin: -0.12,
  // Gust flick: a high-pass of the vertical gust speed over cruise.
  gustGain: 1.2,
  gustMax: 0.22,
  gustSettle: 1.5,

  // ---- feet ----
  // Time to contact at which the gear target is fully out / starts to come
  // out. Eased at `rateGear`, the legs are down about two beats (at ~4 Hz)
  // before contact. First cut was 0.9 / 1.8 s: measured on the page, the
  // gear was out ~4 beats early, which reads as flying with the gear down.
  gearTtcOn: 0.7,
  gearTtcOff: 1.4,
  // "Slow": full below 1.25x cruise, none above 1.6x.
  gearSlowFrom: 1.25,
  gearSlowTo: 1.6,
  // Skimming slowly within a few units of the ground also lowers it.
  gearLowNear: 1.0,
  gearLowFar: 3.0,
  gearLowSlowFrom: 0.9,
  gearLowSlowTo: 0.6,
  // Climbing faster than this retracts it.
  gearClimbOff: 0.6,
  // The bird's own clearance: the flight floor sits birdRadius above ground.
  gearClearance: 0.6,

  // ---- smoothing rates, 1/s ----
  rateDepth: 5,
  rateEnv: 9,
  rateMorph: 4,
  rateSplay: 6,
  rateTail: 8,
  rateFlex: 12,
  rateGear: 7,
  rateAir: 8,
  rateInputs: 10,

  // A bird in the air with (near) zero airspeed is a harness freeze, never a
  // flight state: the stunt model floors speed at minMul x cruise and the
  // classic model is written a cruise every frame. Posed as cruise.
  frozenSpeed: 0.25,
});

/* ----------------------------------------------------------------- helpers */

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function num(v, fallback) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
}

function wrap01(p) {
  return p - Math.floor(p);
}

/**
 * Smooth 0..1 ramp from `a` to `b`. Works in either direction (a > b ramps
 * DOWN in x), which is how "slow below 0.55, not slow above 0.85" reads.
 */
export function ramp(x, a, b) {
  if (a === b) return x >= b ? 1 : 0;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Exponential ease toward a target, frame-rate independent, no overshoot. */
function ease(current, target, dt, rate) {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

/* ------------------------------------------------------- pure functions */

/**
 * Normalised power demand. 1.0 is level flight at cruise.
 *
 *   level = (3 (1 + k (n^2 - 1)) / r + r^3) / 4
 *
 * is the U-shaped power curve with its minimum at r = 1 (induced power
 * ~ n^2 / V, parasite and profile ~ V^3; three quarters induced at cruise so
 * the minimum lands there). Then the power to accelerate toward the energy
 * model's target (the thrust surplus its own drag term implies), the power
 * to climb, and a little anticipation from the elevator.
 *
 * @param {number} r         airspeed / cruise
 * @param {number} rTarget   energy target / cruise (= r when there is none)
 * @param {number} climbN    radial climb rate / cruise (+ up)
 * @param {number} elevator  elevator intent, -1..1, + = nose up
 * @param {number} load      load factor n (1 in level flight)
 */
export function powerDemand(r, rTarget, climbN, elevator, load, t = AERO_POSE_DEFAULTS) {
  const rr = Math.max(0.2, num(r, 1));
  const n = clamp(num(load, 1), 0, 6);
  const level = (3 * (1 + t.loadInduced * (n * n - 1)) / rr + rr * rr * rr) / 4;
  const accel = t.accelPower * (num(rTarget, rr) - rr) * rr;
  const climb = t.climbPower * clamp(num(climbN, 0), -3, 3);
  const intent = t.intentPower * clamp(num(elevator, 0), -1, 1);
  return level + accel + climb + intent;
}

/**
 * The throttle as a power multiplier: 0 at idle, 1 at the neutral pad, up to
 * 1.6 at full. At idle the bird glides whatever the demand.
 */
export function throttleGain(throttle, idle = 0.55) {
  const th = num(throttle, 1);
  const lo = num(idle, 0.55);
  if (lo >= 1) return 1;
  return clamp((th - lo) / (1 - lo), 0, 1.6);
}

/** Stroke depth 0..1 for a delivered demand. */
export function flapDepth(demand, t = AERO_POSE_DEFAULTS) {
  return clamp01((num(demand, 0) - t.demandGlide) / (t.demandFull - t.demandGlide));
}

/** Fraction of the burst period spent flapping, 0..1, for a delivered demand. */
export function burstDuty(demand, t = AERO_POSE_DEFAULTS) {
  return clamp01((num(demand, 0) - t.demandGlide) / (t.demandContinuous - t.demandGlide));
}

/**
 * Span multiplier for a speed, as a ratio to the STALL speed. The jackdaw's
 * slope (0.25 per unit of V/Vstall), anchored so cruise flies the designed
 * planform, floored at a partial tuck.
 */
export function spanMorph(stallRatio, t = AERO_POSE_DEFAULTS) {
  const cruiseRatio = 1 / t.stallMul;
  return clamp(1 - t.spanSlope * (num(stallRatio, cruiseRatio) - cruiseRatio), t.spanMin, 1);
}

/**
 * Lift coefficient as a fraction of its maximum: the load factor over the
 * square of the speed ratio to stall. 1.0 is the wing at CLmax.
 */
export function liftFraction(stallRatio, load) {
  const rs = Math.max(0.05, num(stallRatio, 2));
  return Math.max(0, num(load, 1)) / (rs * rs);
}

/**
 * Load factor from a body pitch rate (rad/s, + nose up) and airspeed.
 * n = 1 + q V / g, with a small deadband (see `loadDeadband`).
 */
export function loadFactor(pitchRate, airspeed, t = AERO_POSE_DEFAULTS) {
  const q = num(pitchRate, 0);
  const aq = Math.max(0, Math.abs(q) - t.loadDeadband);
  return 1 + Math.sign(q) * aq * Math.max(0, num(airspeed, 0)) / t.gRef;
}

/** Stroke shape, 0 at the top of the stroke and 1 at the bottom. */
function strokeShape(p, down) {
  if (p < down) return 0.5 - 0.5 * Math.cos(Math.PI * p / down);
  return 0.5 + 0.5 * Math.cos(Math.PI * (p - down) / (1 - down));
}

/**
 * One Pionus wingbeat at `phase01` (0 = top of the stroke) and `depth`
 * (0..1). Fills and returns `out`:
 *
 *   angle      tips-down offset from the glide line (+ down)
 *   span       span multiplier (pulled in on the upstroke)
 *   hand       wrist bend (+ drops the hand), trailing the arm
 *   handSweep  hand sweep (+ forward; negative = folded back on the upstroke)
 *   twist      leading-edge-up rotation (negative = pronated)
 *   downstroke true while the wing is going down
 */
export function pionusStroke(phase01, depth, out = {}, t = AERO_POSE_DEFAULTS) {
  const p = wrap01(num(phase01, 0));
  const d = clamp01(num(depth, 0));
  const D = t.downFrac;
  const s = strokeShape(p, D);
  const range = t.strokeUp + t.strokeDown;
  // The `|| 0`s normalise -0, which strict equality (and Object.is) does not
  // treat as 0 — the same guard bird-pose.js's tumbleFlap carries.
  out.angle = d * (-t.strokeUp + range * s) || 0;
  const up = p >= D ? (p - D) / (1 - D) : -1;
  const fold = up >= 0 ? Math.sin(Math.PI * up) : 0;
  out.span = 1 - t.upFlex * d * fold;
  // The hand is the same stroke a fraction of a beat LATE, so it cannot
  // drift out of step with the arm however the beat is retimed: going down
  // it trails above the arm line, coming up it trails below.
  const sl = strokeShape(wrap01(p - t.handLag), D);
  out.hand = d * t.handGain * range * (sl - s) || 0;
  out.handSweep = -t.handFold * d * fold || 0;
  const pt = wrap01(p + t.twistLead);
  out.twist = d * (pt < D
    ? -t.twistDown * Math.sin(Math.PI * pt / D)
    : t.twistUp * Math.sin(Math.PI * (pt - D) / (1 - D))) || 0;
  out.downstroke = p < D;
  return out;
}

/**
 * Landing-gear target, 0 tucked .. 1 down, from the approach geometry.
 * Down when contact is about a beat or three away on a slow descent, or
 * when skimming slowly within a few units of the ground; up when climbing
 * away. `landing` (the nest auto-fly) is always gear down.
 */
export function gearTarget(aboveGround, climbRate, r, landing, t = AERO_POSE_DEFAULTS) {
  if (landing) return 1;
  const h = num(aboveGround, NaN);
  if (!Number.isFinite(h)) return 0;
  const vr = num(climbRate, 0);
  if (vr > t.gearClimbOff) return 0;
  const clearance = Math.max(0, h - t.gearClearance);
  const rr = num(r, 1);
  const descent = -vr;
  let soon = 0;
  if (descent > 0.05) soon = ramp(clearance / descent, t.gearTtcOff, t.gearTtcOn);
  const slow = ramp(rr, t.gearSlowTo, t.gearSlowFrom);
  const low = ramp(clearance, t.gearLowFar, t.gearLowNear) * ramp(rr, t.gearLowSlowFrom, t.gearLowSlowTo);
  return clamp01(Math.max(soon * slow, low));
}

/* ------------------------------------------------------------ the smoother */

/** A fresh input record. Allocate ONCE and refill it every frame. */
export function createAeroInput() {
  return {
    // FLYING under its own wings: not grounded, not falling, not nested.
    airborne: true,
    // The nest auto-fly (NESTING_STATES.LANDING): a committed approach.
    landing: false,
    // Airspeed and the bird's reference cruise, units/s.
    airspeed: 11,
    cruise: 11,
    // The energy model's target, units/s (= airspeed when it has none).
    target: 11,
    // The stunt pad's throttle multiplier (1 neutral) and its idle stop.
    throttle: 1,
    throttleIdle: 0.55,
    // The controller's stall multiple of cruise, and its own stall flag.
    stallMul: 0.5,
    stalled: false,
    // Radial climb rate, units/s, + up.
    climbRate: 0,
    // Body rates, rad/s: pitch + nose up, roll + rolling RIGHT.
    pitchRate: 0,
    rollRate: 0,
    // Elevator intent -1..1 (+ nose up) and |stick x| 0..1.
    elevator: 0,
    bank: 0,
    // Height above the carved ground, units (NaN when unknown).
    aboveGround: NaN,
    // Vertical air speed, units/s, + updraft. Wired to 0 until an air field
    // exists to feed it.
    gust: 0,
    // prefers-reduced-motion: drops the decorative flick and flutter.
    reducedMotion: false,
  };
}

/**
 * The stateful half: integrates the beat phase and the burst clock, and
 * eases every output toward its target. `update(input, dt)` returns the SAME
 * `out` object every frame and allocates nothing.
 */
export function createAeroPose(options = {}) {
  const t = Object.freeze({ ...AERO_POSE_DEFAULTS, ...options });

  const out = {
    // The beat, readable by anything (audio can key off `downstroke` or
    // `beats` changing).
    phase01: 0,
    beats: 0,
    downstroke: false,
    // Smoothed stroke depth 0..1 and the burst envelope 0..1: the beat
    // amplitude is depth * envelope.
    depth: 0,
    envelope: 0,
    // Delivered power demand (1 = level cruise) and burst duty.
    demand: 1,
    duty: 0,
    // State estimates.
    load: 1,
    liftFraction: 0.25,
    stalled: false,
    frozen: false,
    // 0 on the ground / falling / nested, 1 flying (eased).
    air: 0,
    // Wing outputs, already weighted by `air`.
    wingX: 0,
    wingY: 0,
    wingZ: 0,
    span: 1,
    handX: 0,
    handY: 0,
    handSpread: 1,
    flutter: 0,
    // Feather follow-through for the ribbon anchors (the old rig's `flex`).
    featherFlex: 0,
    // Morph and high-lift state, for readers.
    morphSpan: 1,
    sweep: 0,
    splay: 0,
    flex: 0,
    // Tail.
    tailPitch: 0,
    tailTwist: 0,
    tailFan: 1,
    tailYawFan: 1,
    // Feet: 1 = down (the base rig's grounded/falling pose, and standing in
    // the nest), 0 = tucked; `gear` is the airborne landing-gear part of it.
    feet: 1,
    gear: 0,
  };

  // Private state. Plain numbers, so nothing here can allocate per frame.
  const st = {
    phase: 0,
    burst: 0,
    env: 0,
    depth: 0,
    air: 0,
    morph: 1,
    sweep: 0,
    splay: 0,
    spread: 0,
    fast: 0,
    tailPitch: 0,
    tailTwist: 0,
    bank: 0,
    flex: 0,
    gustLP: 0,
    feet: 1,
    gear: 0,
    pitchRate: 0,
    rollRate: 0,
    climbRate: 0,
    time: 0,
  };
  const stroke = { angle: 0, span: 1, hand: 0, handSweep: 0, twist: 0, downstroke: false };

  function update(input, deltaTime) {
    const dt = clamp(num(deltaTime, 0), 0, 0.1);
    const i = input || null;
    const cruise = Math.max(0.5, num(i && i.cruise, 11));
    const airborne = !!(i && i.airborne);
    const landing = !!(i && i.landing) && airborne;
    const rawSpeed = Math.abs(num(i && i.airspeed, cruise));
    const frozen = airborne && !landing && rawSpeed < t.frozenSpeed;
    const reduced = !!(i && i.reducedMotion);

    // Inputs, eased so one noisy frame (a collision push, a teleport the
    // caller did not catch) cannot throw a pose.
    const wantPitchRate = frozen ? 0 : clamp(num(i && i.pitchRate, 0), -6, 6);
    const wantRollRate = frozen ? 0 : clamp(num(i && i.rollRate, 0), -8, 8);
    const wantClimb = frozen ? 0 : clamp(num(i && i.climbRate, 0), -3 * cruise, 3 * cruise);
    st.pitchRate = ease(st.pitchRate, wantPitchRate, dt, t.rateInputs);
    st.rollRate = ease(st.rollRate, wantRollRate, dt, t.rateInputs);
    st.climbRate = ease(st.climbRate, wantClimb, dt, t.rateInputs);
    st.bank = ease(st.bank, clamp01(num(i && i.bank, 0)), dt, t.rateTail);

    // Airspeed. The nest auto-fly writes position directly with the
    // controller's speed at 0, so an approach is posed as slow flight.
    const speed = frozen ? cruise : (landing ? 0.6 * cruise : rawSpeed);
    const r = speed / cruise;
    const stallMul = clamp(num(i && i.stallMul, t.stallMul), 0.1, 0.95);
    const stallRatio = r / stallMul;
    const target = frozen || landing ? speed : Math.abs(num(i && i.target, speed));
    const rTarget = target / cruise;
    const climbN = st.climbRate / cruise;
    const elevator = frozen ? 0 : clamp(num(i && i.elevator, 0), -1, 1);
    const load = frozen ? 1 : loadFactor(st.pitchRate, speed, t);
    const stalled = !frozen && (!!(i && i.stalled) || stallRatio < 1);

    // Power delivered.
    let demand = powerDemand(r, rTarget, climbN, elevator, load, t);
    if (landing) demand = Math.max(demand, 1.6);
    const gain = frozen ? 1 : throttleGain(num(i && i.throttle, 1), num(i && i.throttleIdle, 0.55));
    const delivered = demand > 0 ? demand * gain : demand;
    const depthTarget = airborne ? flapDepth(delivered, t) : 0;
    const duty = airborne ? burstDuty(delivered, t) : 0;

    // The beat: phase integrates, so a change of rate never jumps the wing.
    st.depth = ease(st.depth, depthTarget, dt, t.rateDepth);
    const hz = t.beatHz * (1 - t.beatHzRange / 2 + t.beatHzRange * st.depth);
    const before = st.phase;
    st.phase = wrap01(st.phase + hz * dt);
    if (st.phase < before) out.beats += 1;
    st.burst += dt;
    if (st.burst >= t.burstPeriod) st.burst -= t.burstPeriod * Math.floor(st.burst / t.burstPeriod);
    const inBurst = duty >= 1 || st.burst < duty * t.burstPeriod;
    st.env = ease(st.env, inBurst ? 1 : 0, dt, t.rateEnv);
    st.air = ease(st.air, airborne ? 1 : 0, dt, t.rateAir);
    st.time += dt;
    pionusStroke(st.phase, st.depth, stroke, t);

    // Morph and high lift.
    const morphTarget = landing ? 1 : spanMorph(stallRatio, t);
    st.morph = ease(st.morph, morphTarget, dt, t.rateMorph);
    const cl = liftFraction(stallRatio, load);
    const splayTarget = Math.max(ramp(cl, t.splayOn, t.splayFull), stalled ? 1 : 0, landing ? 0.8 : 0);
    st.splay = ease(st.splay, splayTarget, dt, t.rateSplay);
    const spreadTarget = Math.max(splayTarget, ramp(r, t.slowFanFrom, t.slowFanTo), landing ? 1 : 0);
    st.spread = ease(st.spread, spreadTarget, dt, t.rateSplay);
    st.fast = ease(st.fast, landing ? 0 : ramp(r, t.fastFrom, t.fastTo), dt, t.rateMorph);
    const sweepTarget = t.sweepPerSpan * (1 - st.morph) - t.slowSweepFwd * st.spread;
    st.sweep = ease(st.sweep, sweepTarget, dt, t.rateMorph);

    // Tail: the elevator with the controller's own sign, a flare at high
    // lift, a twist into a roll. tailPitchOffset's convention is "negative
    // drops the tail on a climb"; this output's is "+ drops the tip", so it
    // is negated once, here.
    const elevDrop = -tailPitchOffset(elevator) * t.tailElevatorGain;
    st.tailPitch = ease(st.tailPitch, elevDrop + t.tailFlare * st.splay, dt, t.rateTail);
    const twistTarget = clamp(t.tailTwistPerRate * st.rollRate, -t.tailTwistMax, t.tailTwistMax);
    st.tailTwist = ease(st.tailTwist, twistTarget, dt, t.rateTail);

    // Load flex, plus a high-passed gust flick.
    const gust = reduced ? 0 : num(i && i.gust, 0);
    st.gustLP = ease(st.gustLP, gust, dt, t.gustSettle);
    const flick = clamp(t.gustGain * (gust - st.gustLP) / cruise, -t.gustMax, t.gustMax);
    const flexTarget = clamp(t.flexPerG * (load - 1), t.flexMin, t.flexMax) + flick;
    st.flex = ease(st.flex, flexTarget, dt, t.rateFlex);

    // Feet: down on the ground and falling (the base rig's pose) and
    // standing in the nest; landing gear in the air.
    const gearT = airborne && !frozen
      ? gearTarget(num(i && i.aboveGround, NaN), st.climbRate, r, landing, t) : 0;
    st.gear = ease(st.gear, gearT, dt, t.rateGear);
    st.feet = ease(st.feet, airborne ? gearT : 1, dt, t.rateGear);

    // ---- outputs ----
    const air = st.air;
    const env = st.env;
    out.phase01 = st.phase;
    out.downstroke = stroke.downstroke && env * st.depth > 0.05;
    out.depth = st.depth;
    out.envelope = env;
    out.demand = delivered;
    out.duty = duty;
    out.load = load;
    out.liftFraction = cl;
    out.stalled = stalled;
    out.frozen = frozen;
    out.air = air;
    out.morphSpan = st.morph;
    out.sweep = st.sweep;
    out.splay = st.splay;
    out.flex = st.flex;

    const glide = t.glideDroop + t.bankDroop * st.bank;
    out.wingX = air * (glide + env * stroke.angle - st.flex);
    out.wingY = air * st.sweep;
    out.wingZ = reduced ? 0 : air * env * stroke.twist || 0;
    const beatSpan = 1 - env * (1 - stroke.span);
    out.span = 1 + air * (st.morph * beatSpan - 1);
    out.handX = air * env * stroke.hand;
    out.handY = air * (env * stroke.handSweep + t.handSplayFwd * st.splay);
    out.handSpread = 1 + air * t.handSpread * st.splay;
    out.flutter = reduced ? 0 : (1 - env) * (st.bank < 0.1 ? 1 : 0)
      * Math.sin(st.time * t.flutterRate) * t.flutterAmp || 0;
    const beatWork = env * st.depth;
    out.featherFlex = reduced ? 0 : air
      * Math.sin(st.time * (2.2 + 4.6 * beatWork) - 0.6) * (0.025 + 0.035 * beatWork) || 0;

    out.tailPitch = air * st.tailPitch;
    out.tailTwist = air * st.tailTwist;
    const fan = 1 + (t.tailFanMax - 1) * st.spread - (1 - t.tailFurlMin) * st.fast * (1 - st.spread);
    out.tailFan = 1 + air * (fan - 1);
    out.tailYawFan = 1 + t.tailYawFan * st.bank;

    out.feet = st.feet;
    out.gear = air * st.gear;
    return out;
  }

  /** Back to a bird sitting on the ground, feet down, wings still. */
  function reset() {
    st.phase = 0; st.burst = 0; st.env = 0; st.depth = 0; st.air = 0;
    st.morph = 1; st.sweep = 0; st.splay = 0; st.spread = 0; st.fast = 0;
    st.tailPitch = 0; st.tailTwist = 0; st.bank = 0; st.flex = 0; st.gustLP = 0;
    st.feet = 1; st.gear = 0; st.pitchRate = 0; st.rollRate = 0; st.climbRate = 0;
    st.time = 0;
    out.beats = 0;
  }

  /**
   * The stroke the harness forces with __BIRB.flapPhase(): full depth,
   * written into `out`-shaped fields of `target` so the bird sheet
   * photographs the beat the game actually flies.
   */
  function forcedStroke(phase01, target) {
    pionusStroke(phase01, 1, stroke, t);
    target.wingX = t.glideDroop + stroke.angle;
    target.wingZ = stroke.twist;
    target.span = stroke.span;
    target.handX = stroke.hand;
    target.handY = stroke.handSweep;
    return target;
  }

  return { out, update, reset, forcedStroke, tuning: t };
}

/**
 * `?aeropose=0` restores the base rig — the raw-stick beat and the reversed
 * tail — exactly, as the A/B's before. Same regex shape as every other
 * opt-out the Flags tab renders.
 */
export function aeroPoseRequested(search) {
  return !/[?&]aeropose=0(?:&|$)/.test(typeof search === 'string' ? search : '');
}
