/**
 * tests/bird-flight-stunt.test.js — the stunt-plane control law.
 *
 * Every property this controller exists to have is a MOTION, so every check
 * flies it and measures where the bird ended up rather than reading a
 * constant back. Angles are measured against the LOCAL RADIAL and every
 * behavioural case runs at a pole AND at the equator: on a sphere a term
 * written against world +Y passes at the pole and is wrong everywhere else,
 * and that defect class is exactly what two sites catch.
 *
 * The sign checks look at where the WING TIP ends up, never at the sign of an
 * angle. This codebase has got a roll sign wrong three separate times (the
 * bank with no bank in it, the aerobatic roll that rolled the wrong way, the
 * inside-out bird), and every one of them was arguable from the source and
 * decisive the moment something evaluated a position.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  BirdFlightStunt, FLIGHT_STUNT_DEFAULTS, FLIGHT_MODELS, stickExpo,
} from '../src/flight/bird-flight-stunt.js';

// The repo's minimal `three` test stub has no Vector3.add; BirdFlight uses it
// to put the constrained radial offset back around the sphere centre. Same
// additive shim tests/bird-flight.test.js and the v2 suite install.
// The stub gained Vector3.add / cross / distanceTo for this suite — real
// three has had all three forever, and a stub missing a method the library
// has is a test that cannot run the code the game runs. Kept as a shim too,
// so this file still passes against an older checkout of the stub.
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
const DEG = 180 / Math.PI;

const SITES = [
  { name: 'pole', position: () => new THREE.Vector3(0, SPHERE_RADIUS + ALT, 0), forward: () => new THREE.Vector3(0, 0, -1) },
  { name: 'equator', position: () => new THREE.Vector3(SPHERE_RADIUS + ALT, 0, 0), forward: () => new THREE.Vector3(0, 1, 0) },
];

const makeBird = (opts = {}) =>
  new BirdFlightStunt(THREE, {
    sphereRadius: SPHERE_RADIUS,
    speed: 11,
    position: new THREE.Vector3(0, SPHERE_RADIUS + ALT, 0),
    ...opts,
  });

const radialUp = (b) => b.position.clone().sub(b.sphereCenter).normalize();
const forwardOf = (b) => new THREE.Vector3(0, 0, -1).applyQuaternion(b.quaternion).normalize();
const bodyUpOf = (b) => new THREE.Vector3(0, 1, 0).applyQuaternion(b.quaternion).normalize();
const rightOf = (b) => new THREE.Vector3(1, 0, 0).applyQuaternion(b.quaternion).normalize();

const levelAt = (bird, hint) => {
  const up = radialUp(bird);
  const fwd = hint.clone();
  fwd.addScaledVector(up, -fwd.dot(up));
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const m = new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate());
  bird.quaternion.setFromRotationMatrix(m);
  return bird;
};

const spawn = (site, opts = {}) => levelAt(makeBird({ position: site.position(), ...opts }), site.forward());

const bankDeg = (b) => b.bankAngle() * DEG;
const pitchDeg = (b) => b.pitchAngle() * DEG;

/** Full-circle pitch: over the top of a loop this reads past ±90. */
const pitchFullDeg = (b) => {
  const up = radialUp(b);
  return Math.atan2(up.dot(forwardOf(b)), up.dot(bodyUpOf(b))) * DEG;
};

const headingOf = (b) => {
  const up = radialUp(b);
  const fwd = forwardOf(b);
  const t = fwd.clone().addScaledVector(up, -fwd.dot(up));
  return t.lengthSq() > 1e-9 ? t.normalize() : null;
};

const altitudeOf = (b) => b.position.distanceTo(b.sphereCenter) - SPHERE_RADIUS;

const fly = (bird, input, seconds, onStep) => {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    bird.tick(input, DT);
    if (onStep) onStep(bird, i);
  }
  return bird;
};

const stick = (x = 0, y = 0, extra = {}) => ({ x, y, active: x !== 0 || y !== 0, ...extra });

// Which way the pitch axis points. The shipping model PULLS BACK for nose up
// (see `invertPitch`), so a "pull" is a NEGATIVE stick y. Every check below
// asks for a pull or a push by intent rather than by sign, so flipping the
// default does not silently invert what any of them is testing.
const PITCH_SIGN = FLIGHT_STUNT_DEFAULTS.invertPitch ? -1 : 1;
/** Stick position for a nose-UP command of `amount` (0..1). */
const pull = (amount, extra = {}) => stick(0, PITCH_SIGN * amount, extra);
/** Stick position for a nose-DOWN command of `amount` (0..1). */
const push = (amount, extra = {}) => stick(0, -PITCH_SIGN * amount, extra);
/** Roll `sx` while pulling `amount` — a banked, climbing turn. */
const bankPull = (sx, amount, extra = {}) => stick(sx, PITCH_SIGN * amount, extra);

// ---------------------------------------------------------------------------
// The expo curve — the term that makes a pure-rate roll axis survive a thumb
// ---------------------------------------------------------------------------

test('cubic expo holds most of the authority in the last of the travel', () => {
  const k = FLIGHT_STUNT_DEFAULTS.rollExpo;
  assert.equal(stickExpo(0, k), 0);
  assert.ok(Math.abs(stickExpo(1, k) - 1) < 1e-9, 'full stick is full rate');
  assert.ok(Math.abs(stickExpo(-1, k) + 1) < 1e-9, 'and is odd');
  // Half stick well under half rate: this is the whole point of it.
  assert.ok(stickExpo(0.5, k) < 0.4, `half stick is ${stickExpo(0.5, k).toFixed(2)} of the rate`);
  // An ordinary hard turn (raw 0.7 on this stick) must not be most of the
  // roll rate — that is the v70 failure this curve answers.
  assert.ok(stickExpo(0.7, k) < 0.55, `0.7 stick is ${stickExpo(0.7, k).toFixed(2)} of the rate`);
  // Monotonic.
  for (let v = 0; v < 1; v += 0.05) {
    assert.ok(stickExpo(v + 0.05, k) > stickExpo(v, k), 'monotonic');
  }
});

// ---------------------------------------------------------------------------
// Roll: direction, completion, and the bank that survives a held turn
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] right stick puts the RIGHT wing down`, () => {
    const bird = spawn(site);
    const up = radialUp(bird);
    fly(bird, stick(1, 0), 0.2);
    // Where the wing tip went, not the sign of an angle.
    const rightTipHeight = rightOf(bird).dot(up);
    assert.ok(rightTipHeight < -0.05,
      `right wing should be BELOW the horizon, got ${rightTipHeight.toFixed(3)}`);
    assert.ok(bankDeg(bird) < -5, `and bank reads negative, got ${bankDeg(bird).toFixed(1)}`);
  });

  test(`[${site.name}] left stick puts the LEFT wing down, symmetrically`, () => {
    const a = spawn(site); fly(a, stick(1, 0), 0.2);
    const b = spawn(site); fly(b, stick(-1, 0), 0.2);
    assert.ok(Math.abs(bankDeg(a) + bankDeg(b)) < 1.0,
      `opposite sticks give opposite banks: ${bankDeg(a).toFixed(1)} vs ${bankDeg(b).toFixed(1)}`);
  });

  test(`[${site.name}] a held full stick rolls right through inverted and keeps going`, () => {
    const bird = spawn(site);
    let sawInverted = false;
    let swept = 0;
    // Measured on the SWEPT angle, not on the bank at a fixed moment. The
    // lateral stability (see `bankComfort`) opposes the first 90 degrees, so
    // the time a full turn takes depends on tuning — the property that must
    // hold is that a pinned stick keeps going round, not that it lands
    // level at any particular second.
    fly(bird, stick(1, 0), 2.5, (b) => {
      swept += b.lastDeltas.roll;
      if (Math.abs(bankDeg(b)) > 165) sawInverted = true;
    });
    assert.ok(sawInverted, 'passed through inverted');
    assert.ok(Math.abs(swept) > 2 * Math.PI,
      `a pinned stick keeps rolling past a full turn (swept ${(swept * DEG).toFixed(0)} deg)`);
    // ...and does not stop there.
    const before = swept;
    fly(bird, stick(1, 0), 0.5, (b) => { swept += b.lastDeltas.roll; });
    assert.ok(Math.abs(swept) > Math.abs(before) + 1,
      'and it is still rolling after a full turn');
  });

  test(`[${site.name}] a bank put in with the stick SURVIVES a held turn`, () => {
    // This is the v70 failure (G-FLIGHT-V2 F2) in test form: righting scaled
    // by (1 - |x|) decayed every intermediate bank under the thumb, so the
    // only way to hold a turn was more stick, which rolled the bird over.
    const bird = spawn(site);
    fly(bird, stick(0.55, 0), 0.30);
    const entry = bankDeg(bird);
    assert.ok(entry < -12, `established a bank of ${entry.toFixed(1)} degrees`);
    // Now pull, with only a whisper of aileron — the ordinary way a turn is
    // flown. The bank must not wash out.
    fly(bird, bankPull(0.12, 0.5), 1.2);
    const held = bankDeg(bird);
    assert.ok(held < entry * 0.6,
      `the bank held through the pull: entry ${entry.toFixed(1)}, now ${held.toFixed(1)}`);
    assert.ok(held > -170, 'and did not roll onto its back');
  });

  test(`[${site.name}] an ordinary hard turn does not roll the bird over`, () => {
    // Raw 0.7 held for two seconds is what a player does in a hard turn.
    const bird = spawn(site);
    fly(bird, bankPull(0.7, 0.7), 2.0);
    const bank = Math.abs(bankDeg(bird));
    assert.ok(bank > 25 && bank < 130,
      `a diagonal stick banks into a turn rather than corkscrewing, got ${bank.toFixed(1)}`);
  });
}

// ---------------------------------------------------------------------------
// Pitch: unlimited, and it closes a loop
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] a held pull goes over the top and round`, () => {
    const bird = spawn(site, { position: site.position() });
    const entryHeading = headingOf(bird).clone();
    let overTheTop = false;
    // pitchMax 2.6 rad/s: 360 degrees in about 2.4 s. Authority scales it, so
    // give it room.
    fly(bird, pull(1), 3.2, (b) => {
      if (Math.abs(pitchFullDeg(b)) > 120) overTheTop = true;
    });
    assert.ok(overTheTop, 'went past the vertical — there is no pitch clamp');
    const exit = headingOf(bird);
    assert.ok(exit, 'ends with a defined heading');
    // A loop returns to its entry heading. Generous: the energy model changes
    // the rate around the circle, so the loop does not close on a fixed clock.
    assert.ok(entryHeading.dot(exit) > 0.3,
      `comes back round to its entry heading (dot ${entryHeading.dot(exit).toFixed(2)})`);
  });

  test(`[${site.name}] there is no pitch clamp at all`, () => {
    const bird = spawn(site);
    assert.ok(bird.maxPitch >= Math.PI - 1e-6, 'reports no ceiling');
    // Measured on the FULL-CIRCLE pitch: `pitchDeg` is an asin and folds back
    // at 90, so a bird that has gone right over the top reads as a shallow
    // climb again. Past 100 degrees is unambiguously past the vertical, which
    // is what v1's 80-degree clamp made impossible.
    let past = false;
    fly(bird, pull(1), 2.0, (b) => {
      if (Math.abs(pitchFullDeg(b)) > 100) past = true;
    });
    assert.ok(past, 'goes past the vertical — v1 clamped at 80 degrees');
  });
}

// ---------------------------------------------------------------------------
// The pitch axis points the way a control column does
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] PULLING BACK raises the nose and pushing drops it`, () => {
    // Measured on where the NOSE ends up, not on the sign of the input — the
    // whole point of the check is that those two are now opposite.
    const back = spawn(site);
    fly(back, stick(0, -0.6), 0.8);
    assert.ok(pitchDeg(back) > 15,
      `stick back (y -0.6) is nose UP, got ${pitchDeg(back).toFixed(1)} deg`);

    const fwd = spawn(site);
    fly(fwd, stick(0, 0.6), 0.8);
    assert.ok(pitchDeg(fwd) < -15,
      `stick forward (y +0.6) is nose DOWN, got ${pitchDeg(fwd).toFixed(1)} deg`);
  });

  test(`[${site.name}] ?pitchinvert=0 restores the direct sense`, () => {
    const bird = spawn(site, { invertPitch: false });
    assert.equal(bird.pitchSign, 1);
    fly(bird, stick(0, 0.6), 0.8);
    assert.ok(pitchDeg(bird) > 15,
      `uninverted, stick up is nose up, got ${pitchDeg(bird).toFixed(1)} deg`);
  });
}

// ---------------------------------------------------------------------------
// The rudder: the bird's OWN up, which is what makes a knife edge possible
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] right rudder yaws the nose right`, () => {
    const bird = spawn(site);
    const before = headingOf(bird).clone();
    const right = rightOf(bird).clone();
    fly(bird, stick(0, 0, { rudder: 1 }), 0.5);
    const after = headingOf(bird);
    assert.ok(after.dot(right) > 0.05,
      `the nose swung toward the old right (dot ${after.dot(right).toFixed(3)})`);
    assert.ok(before.dot(after) < 0.999, 'and the heading actually moved');
  });

  test(`[${site.name}] the rudder rotates about the BIRD'S up, not the planet's`, () => {
    // Knife edge: roll to 90 degrees, then apply rudder. About the bird's own
    // up that is an ELEVATOR and lifts the nose; about the radial it would be
    // a flat skid that leaves the pitch alone. The difference is the whole
    // reason a knife edge is flyable.
    const bird = spawn(site);
    // Roll to roughly 90 degrees with the stick.
    for (let i = 0; i < 400 && Math.abs(Math.abs(bankDeg(bird)) - 90) > 3; i += 1) {
      bird.tick(stick(0.45, 0), DT);
    }
    const pitchBefore = pitchDeg(bird);
    fly(bird, stick(0, 0, { rudder: 1 }), 0.4);
    const moved = Math.abs(pitchDeg(bird) - pitchBefore);
    assert.ok(moved > 4,
      `in a knife edge the rudder moves the NOSE UP/DOWN (moved ${moved.toFixed(1)} degrees)`);
  });
}

// ---------------------------------------------------------------------------
// Idle stability: rights, trims, and leaves an inverted bird inverted
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] hands off from a 50-degree bank, the wings level`, () => {
    const bird = spawn(site);
    fly(bird, stick(0.5, 0), 0.35);
    assert.ok(Math.abs(bankDeg(bird)) > 15, 'established a bank first');
    fly(bird, stick(0, 0), 3.0);
    assert.ok(Math.abs(bankDeg(bird)) < 12,
      `levels hands-off, got ${bankDeg(bird).toFixed(1)}`);
  });

  test(`[${site.name}] hands off from INVERTED, it stays inverted`, () => {
    // The property that separates this from v2: inverted level flight is a
    // stunt you can hold, not a state the controller rolls you out of.
    const bird = spawn(site);
    // Roll past the righting limit.
    for (let i = 0; i < 600 && Math.abs(bankDeg(bird)) < 178; i += 1) {
      bird.tick(stick(1, 0), DT);
    }
    assert.ok(Math.abs(bankDeg(bird)) > 170, `reached inverted (${bankDeg(bird).toFixed(1)})`);
    fly(bird, stick(0, 0), 3.0);
    assert.ok(Math.abs(bankDeg(bird)) > 120,
      `stays inverted hands-off, got ${bankDeg(bird).toFixed(1)}`);
  });

  test(`[${site.name}] hands off from a dive, the nose comes back to the horizon`, () => {
    const bird = spawn(site);
    fly(bird, push(0.8), 0.6);
    assert.ok(pitchDeg(bird) < -25, `established a dive (${pitchDeg(bird).toFixed(1)})`);
    fly(bird, stick(0, 0), 4.0);
    assert.ok(Math.abs(pitchDeg(bird)) < 15,
      `trims back to the horizon, got ${pitchDeg(bird).toFixed(1)}`);
  });

  test(`[${site.name}] a bird placed VERTICAL does not hang there`, () => {
    // G-FLIGHT-V2 F3: the sin(2p) stability term was zero at the vertical.
    const bird = spawn(site);
    // Pitch straight up by hand, then let go with plenty of speed so the
    // stall term is not what rescues it.
    const axis = new THREE.Vector3(1, 0, 0);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2);
    bird.quaternion.multiply(q);
    bird.setSpeed(11);
    bird.cruise = 11;
    assert.ok(pitchDeg(bird) > 85, `starts vertical (${pitchDeg(bird).toFixed(1)})`);
    fly(bird, stick(0, 0), 3.0);
    assert.ok(pitchDeg(bird) < 70,
      `the nose comes down from vertical, got ${pitchDeg(bird).toFixed(1)}`);
  });
}

// ---------------------------------------------------------------------------
// Energy, lift and sink
// ---------------------------------------------------------------------------

test('a dive gains speed and a climb bleeds it, both bounded', () => {
  const site = SITES[0];
  const dive = spawn(site);
  dive.cruise = 11;
  fly(dive, push(0.6), 1.5);
  assert.ok(dive.speed > 11, `a dive gains speed (${dive.speed.toFixed(1)})`);
  assert.ok(dive.speed <= 11 * FLIGHT_STUNT_DEFAULTS.maxMul + 1e-6, 'bounded above');

  const climb = spawn(site);
  climb.cruise = 11;
  fly(climb, pull(0.6), 1.5);
  assert.ok(climb.speed < 11, `a climb bleeds speed (${climb.speed.toFixed(1)})`);
  assert.ok(climb.speed >= 11 * FLIGHT_STUNT_DEFAULTS.minMul - 1e-6, 'bounded below');
});

test('lift is 1 level at cruise, zero in a knife edge and negative inverted', () => {
  const bird = spawn(SITES[0]);
  bird.cruise = 11;
  assert.ok(Math.abs(bird.liftFactor() - 1) < 0.05, `level at cruise: ${bird.liftFactor().toFixed(2)}`);
  assert.ok(bird.sinkRate() < 0.2, 'and it does not sink');

  // Knife edge. Stick 0.8 is the firm-but-held input that the lateral
  // stability settles at about 83 degrees — see `bankComfort`. A gentler
  // stick now holds a gentler bank instead of rolling on round to 90.
  fly(bird, stick(0.8, 0), 5.0);
  assert.ok(Math.abs(bankDeg(bird)) > 75, `reached a knife edge (${bankDeg(bird).toFixed(0)})`);
  assert.ok(Math.abs(bird.liftFactor()) < 0.3, `knife edge carries almost no lift: ${bird.liftFactor().toFixed(2)}`);
  assert.ok(bird.sinkRate() > 2.5, `and it falls: ${bird.sinkRate().toFixed(1)} units/s`);
});

test('a knife edge loses altitude and a level bird does not', () => {
  const level = spawn(SITES[1]);
  level.cruise = 11;
  const levelStart = altitudeOf(level);
  fly(level, stick(0, 0), 2.0);
  assert.ok(Math.abs(altitudeOf(level) - levelStart) < 1.5,
    `level flight holds altitude (moved ${(altitudeOf(level) - levelStart).toFixed(2)})`);

  const knife = spawn(SITES[1]);
  knife.cruise = 11;
  fly(knife, stick(0.8, 0), 5.0);
  const knifeStart = altitudeOf(knife);
  fly(knife, stick(0.8, 0), 1.5);
  const dropped = knifeStart - altitudeOf(knife);
  assert.ok(dropped > 2.5, `a knife edge falls out of the sky (dropped ${dropped.toFixed(1)})`);
});

test('sink is suspended while the speed is COMMANDED (walking, nesting, the freeze)', () => {
  const bird = spawn(SITES[0]);
  bird.setSpeed(2.1); // the walk speed — a commanded write
  assert.equal(bird.sinkRate(), 0, 'a walking bird does not sink through the planet');
});

// ---------------------------------------------------------------------------
// RELAXED FLIGHT — the regression the owner found on the phone
//
// "It's like it stalls way too much when trying to fly up and it's no longer
// a fun relaxing experience." Two causes, both fixed and both pinned here:
// the climb bleed was linear in sin(pitch), so a 45-degree climb settled
// below stall; and pitch was a pure rate with no resting point, so holding
// ANY up-stick rotated the bird to vertical in about two seconds.
//
// These checks are the floor of the whole model. A future tuning pass that
// makes some stunt reachable by raising the climb penalty again has to fail
// here first.
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] an ordinary climb NEVER stalls, at any gentle stick`, () => {
    for (const sy of [0.2, 0.3, 0.4, 0.5, 0.6]) {
      const bird = spawn(site);
      bird.cruise = 11;
      let stalled = false;
      let minSpeed = Infinity;
      // Ten seconds is far past any transient: if it settles below stall,
      // this finds it.
      fly(bird, pull(sy), 10, (b) => {
        if (b.isStalled()) stalled = true;
        minSpeed = Math.min(minSpeed, b.speed);
      });
      assert.ok(!stalled,
        `stick ${sy} held for 10 s must keep flying (min speed ${minSpeed.toFixed(2)}, `
        + `stall ${(FLIGHT_STUNT_DEFAULTS.stallMul * 11).toFixed(2)})`);
    }
  });

  test(`[${site.name}] a held up-stick settles at a CLIMB, not at the vertical`, () => {
    // The input needs a resting point. Without one a relaxed player who just
    // wants height ends up pointing at the sky with no airspeed.
    for (const [sy, maxPitch] of [[0.3, 45], [0.5, 55], [0.6, 62]]) {
      const bird = spawn(site);
      bird.cruise = 11;
      let peak = 0;
      fly(bird, pull(sy), 10, (b) => { peak = Math.max(peak, Math.abs(pitchFullDeg(b))); });
      assert.ok(peak < maxPitch,
        `stick ${sy} settles at a climb, peaked at ${peak.toFixed(0)} (limit ${maxPitch})`);
      assert.ok(pitchDeg(bird) > 12, `and it IS climbing (${pitchDeg(bird).toFixed(0)} deg)`);
    }
  });

  test(`[${site.name}] a gentle climb GAINS altitude instead of losing it`, () => {
    const bird = spawn(site);
    bird.cruise = 11;
    const start = altitudeOf(bird);
    fly(bird, pull(0.4), 10);
    assert.ok(altitudeOf(bird) > start + 20,
      `ten seconds of gentle climb gains height (${start.toFixed(0)} -> ${altitudeOf(bird).toFixed(0)})`);
  });

  test(`[${site.name}] a gentle turn holds a bank and does not roll or sink`, () => {
    const bird = spawn(site);
    bird.cruise = 11;
    const start = altitudeOf(bird);
    let peakBank = 0;
    fly(bird, stick(0.3, 0), 10, (b) => { peakBank = Math.max(peakBank, Math.abs(bankDeg(b))); });
    assert.ok(peakBank < 40,
      `a gentle sideways stick is a BANK, not a barrel roll (peaked ${peakBank.toFixed(0)} deg)`);
    assert.ok(Math.abs(bankDeg(bird)) > 12, `and it is a real bank (${bankDeg(bird).toFixed(0)} deg)`);
    assert.ok(Math.abs(altitudeOf(bird) - start) < 8,
      `and it costs almost no altitude (${(altitudeOf(bird) - start).toFixed(1)})`);
  });

  test(`[${site.name}] a held bank tracks the stick, gently to steeply`, () => {
    // The ladder that makes the model legible: more stick is more bank, all
    // the way to a knife edge, and only a pinned stick rolls.
    const banks = [0.3, 0.5, 0.7, 0.8].map((sx) => {
      const bird = spawn(site);
      bird.cruise = 11;
      fly(bird, stick(sx, 0), 6);
      return Math.abs(bankDeg(bird));
    });
    for (let i = 1; i < banks.length; i += 1) {
      assert.ok(banks[i] > banks[i - 1] + 5,
        `more stick is more bank: ${banks.map((b) => b.toFixed(0)).join(' / ')}`);
    }
    assert.ok(banks[banks.length - 1] > 70, 'and a firm stick reaches a knife edge');
  });
}

// ---------------------------------------------------------------------------
// The stall — the hammerhead, with no move list
// ---------------------------------------------------------------------------

test('a vertical climb runs out of speed and the nose falls through — the hammerhead', () => {
  // This is the whole figure, with no move list, no trigger and no dwell:
  // pull to the vertical with the power back, let go, and the terms do it.
  //
  // THE THROTTLE IS PART OF THE INPUT, and that is not a weakening of the
  // figure — it is how a hammerhead is actually flown. At full power the
  // climb curve (see `climbExp`) deliberately keeps an ordinary climb flying,
  // which is the whole fix for "it stalls way too much when trying to fly
  // up"; cutting the power is the deliberate act that makes the wing stop.
  const bird = spawn(SITES[1]);
  bird.cruise = 11;
  const idle = { throttle: FLIGHT_STUNT_DEFAULTS.throttleIdle };
  fly(bird, pull(1, idle), 1.0);
  assert.ok(pitchDeg(bird) > 60, `pulled up steeply (${pitchDeg(bird).toFixed(1)})`);
  let stalled = false;
  let minSpeed = Infinity;
  fly(bird, stick(0, 0, idle), 8.0, (b) => {
    if (b.isStalled()) stalled = true;
    minSpeed = Math.min(minSpeed, b.speed);
  });
  assert.ok(stalled, `the wing stopped flying at the top (min speed ${minSpeed.toFixed(2)})`);
  assert.ok(pitchDeg(bird) < 40,
    `and the nose came back down (${pitchDeg(bird).toFixed(1)})`);
});

test('at FULL power the same pull does not stall — that is the point', () => {
  // The counterpart to the hammerhead above, and the regression guard for
  // the whole of this fix: with the power on, pulling up hard is a CLIMB.
  const bird = spawn(SITES[1]);
  bird.cruise = 11;
  fly(bird, pull(1), 1.0);
  let stalled = false;
  fly(bird, pull(1), 1.0, (b) => { if (b.isStalled()) stalled = true; });
  assert.ok(!stalled, 'a powered pull-up keeps flying');
});

test('authority falls with speed, so a stalled bird is not a bird with full elevator', () => {
  const bird = spawn(SITES[0]);
  // `setSpeed` moves the TARGET too (it is a commanded speed), so authority
  // would read 1 either way. Authority is speed against the cruise it is
  // trying to hold, so set them apart deliberately.
  bird.cruise = 11;
  bird.speed = 11;
  const fast = bird.authority();
  bird.speed = 2;
  const slow = bird.authority();
  assert.ok(slow < fast, `authority ${slow.toFixed(2)} at 2 vs ${fast.toFixed(2)} at cruise`);
  assert.ok(slow >= 0.35 - 1e-9, 'but never zero — a bird with no control at all is a bug report');
});

// ---------------------------------------------------------------------------
// The model switch — the settings toggle
// ---------------------------------------------------------------------------

test('classic delegates to v1: the pitch clamp is back and the stick yaws', () => {
  const bird = spawn(SITES[0], { model: FLIGHT_MODELS.CLASSIC, maxPitch: Math.PI * (80 / 180) });
  assert.equal(bird.model, 'classic');
  // v1 clamps pitch at 80 degrees however long you pull.
  fly(bird, pull(1), 3.0);
  assert.ok(Math.abs(pitchDeg(bird)) <= 81,
    `classic holds v1's clamp, got ${pitchDeg(bird).toFixed(1)}`);
});

test('the model switch restores v1\'s pitch clamp, and takes it away again', () => {
  // Found by tools/birb-stunt.mjs on the live page: the constructor set
  // maxPitch = PI unconditionally, so `classic` inherited NO clamp and was
  // not v1 at all. A bird that can loop under classic looks like a bird
  // flying normally right up until somebody loops it.
  const bird = spawn(SITES[0], { maxPitch: Math.PI * (80 / 180) });
  assert.ok(bird.maxPitch >= Math.PI - 1e-6, 'stunt has no ceiling');
  bird.setModel(FLIGHT_MODELS.CLASSIC);
  assert.ok(Math.abs(bird.maxPitch - Math.PI * (80 / 180)) < 1e-9,
    `classic gets v1's ceiling back (got ${bird.maxPitch})`);
  fly(bird, pull(1), 3.0);
  assert.ok(Math.abs(pitchDeg(bird)) <= 81, `and it is enforced (${pitchDeg(bird).toFixed(1)})`);
  bird.setModel(FLIGHT_MODELS.STUNT);
  assert.ok(bird.maxPitch >= Math.PI - 1e-6, 'and stunt takes it away again');
});

test('the model switch is live, and hands speed ownership over cleanly', () => {
  const bird = spawn(SITES[0]);
  bird.cruise = 11;
  fly(bird, push(0.5), 1.0);
  const divedTo = bird.speed;
  assert.ok(divedTo > 11, 'the energy model was running');
  bird.setModel(FLIGHT_MODELS.CLASSIC);
  assert.equal(bird.model, 'classic');
  assert.ok(Math.abs(bird.speed - divedTo) < 1e-9, 'the speed is not teleported by the switch');
  bird.setModel(FLIGHT_MODELS.STUNT);
  assert.equal(bird.model, 'stunt');
  // And stunt flies again afterwards.
  const before = bird.position.clone();
  fly(bird, stick(0, 0), 0.5);
  assert.ok(bird.position.distanceTo(before) > 1, 'still moving after two switches');
});

// ---------------------------------------------------------------------------
// The invariants that must survive this controller
// ---------------------------------------------------------------------------

test('the terrain floor still holds, and sink cannot push through it', () => {
  const bird = makeBird({
    position: new THREE.Vector3(0, SPHERE_RADIUS + 3, 0),
    terrainHeightAt: () => -10,
  });
  levelAt(bird, new THREE.Vector3(0, 0, -1));
  bird.cruise = 11;
  // Knife edge, which sinks hard, held right down on the deck.
  for (let i = 0; i < 400 && Math.abs(Math.abs(bankDeg(bird)) - 90) > 2; i += 1) bird.tick(stick(0.45, 0), DT);
  fly(bird, stick(0.09, 0), 4.0);
  const radius = bird.position.distanceTo(bird.sphereCenter);
  const floor = SPHERE_RADIUS - 10 + bird.birdRadius;
  assert.ok(radius >= floor - 1e-3,
    `never goes below the carved floor: radius ${radius.toFixed(2)} vs floor ${floor.toFixed(2)}`);
});

test('a gravity-less floor is never ratcheted upward by the sink term', () => {
  // The invariant from CLAUDE.md: the floor only ever dips. Sink only ever
  // pushes DOWN, so it cannot lift a cruising bird — but prove it rather than
  // assert it, because this is the one that breaks the whole world.
  const bird = makeBird({ terrainHeightAt: () => 0 });
  levelAt(bird, new THREE.Vector3(0, 0, -1));
  bird.cruise = 11;
  const start = altitudeOf(bird);
  fly(bird, stick(0, 0), 5.0);
  assert.ok(altitudeOf(bird) <= start + 0.5,
    `level flight does not climb (${start.toFixed(2)} -> ${altitudeOf(bird).toFixed(2)})`);
});

test('zero allocations in the hot loop: the pose object is the same object', () => {
  const bird = spawn(SITES[0]);
  const first = bird.tick(bankPull(0.4, 0.4, { rudder: 0.3, throttle: 1.2 }), DT);
  for (let i = 0; i < 1000; i += 1) {
    const pose = bird.tick(bankPull(0.4, 0.4, { rudder: 0.3, throttle: 1.2 }), DT);
    assert.equal(pose, first, 'the same pre-allocated pose every frame');
  }
  assert.ok(Number.isFinite(bird.position.x), 'and 1000 ticks leaves it finite');
});

test('the throttle moves the speed the energy model chases', () => {
  const slow = spawn(SITES[0]); slow.cruise = 11;
  fly(slow, stick(0, 0, { throttle: FLIGHT_STUNT_DEFAULTS.throttleIdle }), 4.0);
  const fast = spawn(SITES[0]); fast.cruise = 11;
  fly(fast, stick(0, 0, { throttle: FLIGHT_STUNT_DEFAULTS.throttleFull }), 4.0);
  assert.ok(slow.speed < 11, `idle throttle settles below cruise (${slow.speed.toFixed(1)})`);
  assert.ok(fast.speed > 11, `full throttle settles above it (${fast.speed.toFixed(1)})`);
  assert.ok(fast.speed > slow.speed + 3, 'and the range is worth having');
});

test('lastDeltas reports what the frame actually rotated, for the trick detector', () => {
  const bird = spawn(SITES[0]);
  bird.tick(stick(1, 0), DT);
  assert.ok(Math.abs(bird.lastDeltas.roll) > 1e-4, 'a roll frame reports roll');
  assert.ok(Math.abs(bird.lastDeltas.pitch) < 1e-3, 'and not pitch');
  bird.tick(pull(1), DT);
  assert.ok(Math.abs(bird.lastDeltas.pitch) > 1e-4, 'a pitch frame reports pitch');
});
