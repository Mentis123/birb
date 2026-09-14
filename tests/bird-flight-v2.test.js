/**
 * tests/bird-flight-v2.test.js — the flight-v2 mapping (`?flight=v2`).
 *
 * Everything v2 exists to do is a MOTION, so every check here flies the
 * controller and measures the result rather than reading a constant back.
 * The angles are measured against the LOCAL RADIAL, and every behavioural case
 * runs at a pole AND at the equator (SITES below): on a sphere, a term written
 * against world +Y passes at the pole and is wrong everywhere else, which is
 * the defect class this file is here to catch.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BirdFlightV2, FLIGHT_V2_DEFAULTS } from '../src/flight/bird-flight-v2.js';

// The repo's minimal `three` test stub (node_modules/three/index.js) has no
// Vector3.add; BirdFlight (which v2 extends) uses it to put the constrained
// radial offset back around the sphere centre. Same additive shim
// tests/bird-flight.test.js installs, for the same reason.
if (typeof THREE.Vector3.prototype.add !== 'function') {
  THREE.Vector3.prototype.add = function add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  };
}

const SPHERE_RADIUS = 100;
const ALT = 100; // well clear of the floor, so nothing here is a floor test by accident
const DT = 1 / 60;
const DEG = 180 / Math.PI;

// Pole and equator. The pole is where a world-+Y bug hides; the equator is
// where it shows.
const SITES = [
  { name: 'pole', position: () => new THREE.Vector3(0, SPHERE_RADIUS + ALT, 0), forward: () => new THREE.Vector3(0, 0, -1) },
  { name: 'equator', position: () => new THREE.Vector3(SPHERE_RADIUS + ALT, 0, 0), forward: () => new THREE.Vector3(0, 1, 0) },
];

const makeBird = (opts = {}) =>
  new BirdFlightV2(THREE, {
    sphereRadius: SPHERE_RADIUS,
    speed: 11,
    position: new THREE.Vector3(0, SPHERE_RADIUS + ALT, 0),
    ...opts,
  });

const radialUp = (bird) => bird.position.clone().sub(bird.sphereCenter).normalize();
const forwardOf = (bird) => new THREE.Vector3(0, 0, -1).applyQuaternion(bird.quaternion).normalize();
const bodyUpOf = (bird) => new THREE.Vector3(0, 1, 0).applyQuaternion(bird.quaternion).normalize();

/** Level the bird at its current position, nose along the tangent of `hint`. */
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

const spawn = (site, opts = {}) => {
  const bird = makeBird({ position: site.position(), ...opts });
  return levelAt(bird, site.forward());
};

/** Bank in degrees, full circle: a roll through inverted reads +/-180. */
const bankDeg = (bird) => bird.bankAngle() * DEG;

/** Pitch in degrees, full circle: over the top of a loop reads +/-180. */
const pitchFullDeg = (bird) => {
  const up = radialUp(bird);
  return Math.atan2(up.dot(forwardOf(bird)), up.dot(bodyUpOf(bird))) * DEG;
};

/** Nose elevation above the local horizon, +/-90. */
const pitchDeg = (bird) => bird.pitchAngle() * DEG;

/** The bird's track direction in its own tangent plane, or null at vertical. */
const headingOf = (bird) => {
  const up = radialUp(bird);
  const fwd = forwardOf(bird);
  const tangent = fwd.clone().addScaledVector(up, -fwd.dot(up));
  return tangent.lengthSq() > 1e-9 ? tangent.normalize() : null;
};

const fly = (bird, input, seconds, onStep) => {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    bird.tick(input, DT);
    if (onStep) onStep(bird, i);
  }
  return bird;
};

// ---------------------------------------------------------------------------
// Roll
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] a held roll passes through inverted and a centred stick rights it inside 3 s`, () => {
    const bird = spawn(site);
    assert.ok(Math.abs(bankDeg(bird)) < 1, 'spawns wings level');

    // Full stick for 0.9 s: rollRate 3.5 rad/s puts the bird just past inverted.
    let peak = 0;
    fly(bird, { x: 1, y: 0, active: true }, 0.9, (b) => {
      peak = Math.max(peak, Math.abs(bankDeg(b)));
    });
    assert.ok(peak > 170, `a held roll must cross inverted, peak bank was ${peak.toFixed(1)}`);
    assert.ok(Math.abs(bankDeg(bird)) > 170, `ends inverted, bank ${bankDeg(bird).toFixed(1)}`);

    // Centre the stick: the dihedral has to bring it back. A -sin(bank)
    // restoring term is ZERO at 180 degrees and would sit here forever.
    let righted = -1;
    fly(bird, { x: 0, y: 0, active: false }, 3, (b, i) => {
      if (righted < 0 && Math.abs(bankDeg(b)) < 10) righted = (i + 1) * DT;
    });
    assert.ok(righted > 0, `never righted; bank after 3 s was ${bankDeg(bird).toFixed(1)}`);
    assert.ok(righted < 3, `righting took ${righted.toFixed(2)} s`);
  });

  test(`[${site.name}] a right bank turns the heading right and a left bank left`, () => {
    for (const stick of [1, -1]) {
      const bird = spawn(site);
      const start = headingOf(bird).clone();
      const startRight = new THREE.Vector3().crossVectors(start, radialUp(bird)).normalize();

      // Half stick is a HELD bank (0.5 / edge * maxBank = 37 degrees), not a
      // roll that happens to be passing through one — only the rail rolls.
      fly(bird, { x: 0.5 * stick, y: 0, active: true }, 2);

      const bank = bankDeg(bird);
      // Right stick banks right wing DOWN, which is a negative bank — the same
      // sign convention bird-visual.js paints the model with.
      assert.ok(Math.sign(bank) === -stick, `stick ${stick} should bank ${-stick > 0 ? 'left' : 'right'}, got ${bank.toFixed(1)}`);
      assert.ok(Math.abs(bank) > 20, `bank should build to a real angle, got ${bank.toFixed(1)}`);

      const turned = headingOf(bird).dot(startRight);
      assert.ok(
        Math.sign(turned) === stick && Math.abs(turned) > 0.3,
        `stick ${stick} should turn the heading that way; track . start-right = ${turned.toFixed(3)}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] a held pull completes a loop and keeps the heading`, () => {
    const bird = spawn(site, { position: site.position().normalize().multiplyScalar(SPHERE_RADIUS + 200) });
    levelAt(bird, site.forward());
    const start = headingOf(bird).clone();

    // Unwrap the full-circle pitch so a loop is measured as one 360, not as a
    // reading that wrapped at 180 and came back.
    let previous = pitchFullDeg(bird);
    let swept = 0;
    let peak = 0;
    let closedAt = -1;
    let pitchAtClose = null;
    let headingAtClose = null;
    // Stop AT the closure, not at a fixed wall clock: the stick is still held,
    // so a run that keeps ticking past 360 is measuring the start of a second
    // loop rather than the end of the first.
    for (let i = 0; i < Math.round(4 / DT) && closedAt < 0; i += 1) {
      bird.tick({ x: 0, y: 1, active: true }, DT);
      const now = pitchFullDeg(bird);
      let step = now - previous;
      if (step > 180) step -= 360;
      if (step < -180) step += 360;
      swept += step;
      previous = now;
      peak = Math.max(peak, Math.abs(now));
      if (swept >= 360) {
        closedAt = (i + 1) * DT;
        pitchAtClose = now;
        headingAtClose = headingOf(bird).clone();
      }
    }

    assert.ok(peak > 170, `the loop must pass through inverted, peak pitch ${peak.toFixed(1)}`);
    assert.ok(closedAt > 0, `the loop never closed, swept ${swept.toFixed(1)} degrees`);
    assert.ok(closedAt < 3.5, `a loop should take about 3 s, took ${closedAt.toFixed(2)}`);
    assert.ok(Math.abs(pitchAtClose) < 10, `comes out level, pitch ${pitchAtClose.toFixed(1)}`);

    // The heading has to survive it. If the dihedral were still running under a
    // held pull it would roll the bird at the top (where the bank reads 180 by
    // construction) and the loop would come out as an Immelmann.
    const drift = Math.acos(Math.max(-1, Math.min(1, headingAtClose.dot(start)))) * DEG;
    assert.ok(drift < 5, `heading drifted ${drift.toFixed(2)} degrees through the loop`);
  });

  test(`[${site.name}] hands-off from a 60-degree dive levels`, () => {
    const bird = spawn(site, { position: site.position().normalize().multiplyScalar(SPHERE_RADIUS + 300) });
    levelAt(bird, site.forward());
    bird.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -60 / DEG),
    );
    assert.ok(Math.abs(pitchDeg(bird) + 60) < 1, `starts at -60, got ${pitchDeg(bird).toFixed(1)}`);

    const after2 = (fly(bird, { x: 0, y: 0, active: false }, 2), pitchDeg(bird));
    assert.ok(after2 > -35 && after2 < 0, `should be climbing out after 2 s, pitch ${after2.toFixed(1)}`);

    fly(bird, { x: 0, y: 0, active: false }, 5);
    const pitch = pitchDeg(bird);
    assert.ok(Math.abs(pitch) < 6, `should settle on the horizon, pitch ${pitch.toFixed(2)}`);
    // And it must not have rolled on the way out — nothing asked it to.
    assert.ok(Math.abs(bankDeg(bird)) < 3, `bank ${bankDeg(bird).toFixed(2)} after a straight pull-out`);
  });
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

test('a dive gains speed, a climb bleeds it, and neither leaves the bounds', () => {
  const lo = FLIGHT_V2_DEFAULTS.minMul * 11;
  const hi = FLIGHT_V2_DEFAULTS.maxMul * 11;

  for (const site of SITES) {
    for (const sign of [-1, 1]) {
      const bird = spawn(site, { position: site.position().normalize().multiplyScalar(SPHERE_RADIUS + 400) });
      levelAt(bird, site.forward());
      assert.equal(bird.speed, 11);
      assert.equal(bird.cruise, 11);

      let worstLow = Infinity;
      let worstHigh = -Infinity;
      // A held full stick keeps pitching, so this is a dive and a climb ten
      // times over — exactly the case the clamp exists for.
      fly(bird, { x: 0, y: sign, active: true }, 10, (b) => {
        worstLow = Math.min(worstLow, b.speed);
        worstHigh = Math.max(worstHigh, b.speed);
      });
      assert.ok(worstLow >= lo - 1e-9, `${site.name} speed fell to ${worstLow.toFixed(3)}, floor ${lo}`);
      assert.ok(worstHigh <= hi + 1e-9, `${site.name} speed rose to ${worstHigh.toFixed(3)}, ceiling ${hi}`);
      // sign -1 is nose-down first: it must have gained before it lost.
      if (sign < 0) assert.ok(worstHigh > 11.5, `a dive should gain speed, peak ${worstHigh.toFixed(2)}`);
      else assert.ok(worstLow < 10.5, `a climb should bleed speed, trough ${worstLow.toFixed(2)}`);
    }
  }
});

test('a held dive gains and hands-off returns to cruise', () => {
  const bird = spawn(SITES[0], { position: new THREE.Vector3(0, SPHERE_RADIUS + 400, 0) });
  levelAt(bird, SITES[0].forward());
  // HELD: 0.7 stick commands a 52-degree dive and holds it there. A dive the
  // stick is not holding is one the hands-off stability is already pulling
  // out of, and the speed it gains says more about that than about energy.
  fly(bird, { x: 0, y: -0.7, active: true }, 2);
  assert.ok(pitchDeg(bird) < -40, `holds the commanded dive, pitch ${pitchDeg(bird).toFixed(1)}`);
  assert.ok(bird.speed > 12.5, `a 52-degree dive should gain speed, got ${bird.speed.toFixed(2)}`);
  assert.ok(bird.energy() > 1.1, `energy ${bird.energy().toFixed(3)} should read above 1 in a dive`);
  fly(bird, { x: 0, y: 0, active: false }, 10);
  assert.ok(Math.abs(pitchDeg(bird)) < 3, `hands-off levels, pitch ${pitchDeg(bird).toFixed(2)}`);
  assert.ok(Math.abs(bird.speed - 11) < 0.2, `should settle back to cruise, got ${bird.speed.toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// Attitude below the rail, rate at it (the adversarial review's F2/F3/F6)
// ---------------------------------------------------------------------------

for (const site of SITES) {
  test(`[${site.name}] a half stick holds a steady bank and never rolls past it`, () => {
    const bird = spawn(site);
    const target = (0.5 / FLIGHT_V2_DEFAULTS.edge) * FLIGHT_V2_DEFAULTS.maxBank * DEG;
    let peak = 0;
    fly(bird, { x: 0.5, y: 0, active: true }, 6, (b) => { peak = Math.max(peak, Math.abs(bankDeg(b))); });
    assert.ok(Math.abs(-bankDeg(bird) - target) < 3, `holds ${target.toFixed(1)}, got ${bankDeg(bird).toFixed(1)}`);
    assert.ok(peak < target + 5, `never overshoots into a roll, peak ${peak.toFixed(1)}`);
    // Just inside the rail is the steepest held bank; the rail itself rolls.
    const edgeBird = spawn(site);
    fly(edgeBird, { x: FLIGHT_V2_DEFAULTS.edge - 0.01, y: 0, active: true }, 6);
    assert.ok(Math.abs(-bankDeg(edgeBird) - FLIGHT_V2_DEFAULTS.maxBank * DEG) < 4,
      `just inside the rail holds maxBank, got ${bankDeg(edgeBird).toFixed(1)}`);
    const railBird = spawn(site);
    let crossed = false;
    fly(railBird, { x: FLIGHT_V2_DEFAULTS.edge, y: 0, active: true }, 1.2, (b) => { if (Math.abs(bankDeg(b)) > 170) crossed = true; });
    assert.ok(crossed, 'at the rail the bank keeps going and passes inverted');
  });

  test(`[${site.name}] a half pull holds a steady climb; hands-off from vertical levels`, () => {
    const bird = spawn(site, { position: site.position().normalize().multiplyScalar(SPHERE_RADIUS + 400) });
    levelAt(bird, site.forward());
    const target = (0.5 / FLIGHT_V2_DEFAULTS.edge) * FLIGHT_V2_DEFAULTS.maxPitchHold * DEG;
    fly(bird, { x: 0, y: 0.5, active: true }, 4);
    assert.ok(Math.abs(pitchDeg(bird) - target) < 3, `holds a ${target.toFixed(1)}-degree climb, got ${pitchDeg(bird).toFixed(1)}`);
    assert.ok(Math.abs(bankDeg(bird)) < 3, `wings stay level in a straight climb, bank ${bankDeg(bird).toFixed(2)}`);

    // Straight up, hands off. A sin(2p) stability term is ZERO here and the
    // bird hung there indefinitely (the review's F3); the attitude command has
    // its full authority at the vertical.
    const vertical = spawn(site, { position: site.position().normalize().multiplyScalar(SPHERE_RADIUS + 400) });
    levelAt(vertical, site.forward());
    vertical.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 90 / DEG));
    assert.ok(pitchDeg(vertical) > 89, `starts vertical, pitch ${pitchDeg(vertical).toFixed(1)}`);
    let levelledAt = -1;
    fly(vertical, { x: 0, y: 0, active: false }, 4, (b, i) => {
      if (levelledAt < 0 && Math.abs(pitchDeg(b)) < 10) levelledAt = (i + 1) * DT;
    });
    assert.ok(levelledAt > 0 && levelledAt < 3, `levels from vertical in under 3 s, took ${levelledAt.toFixed(2)}`);
  });
}

test('a commanded speed is held, and writing cruise hands the energy model back', () => {
  // index.html writes `cruise` every frame the bird flies under its own
  // control and NEVER writes it otherwise. Nesting's approach (setSpeed(4)) and
  // hold (setSpeed(0)) must keep the speed they asked for: at a 30-degree nest
  // climb the energy model would otherwise bleed 4.0 down to its 2.2 floor and
  // halve the approach the landing auto-fly is timed against.
  const bird = makeBird();
  bird.setSpeed(4);
  // Nose up 30 degrees: a handed-over bird would bleed speed here.
  bird.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 30 / DEG));
  fly(bird, { x: 0, y: 0, active: false }, 2);
  assert.equal(bird.speed, 4, 'a commanded speed is held exactly');

  // The handover is the write to cruise, and only that.
  bird.cruise = 4;
  fly(bird, { x: 0, y: 0, active: false }, 0.5);
  assert.ok(bird.speed < 4, `the energy model should take over on a cruise write, got ${bird.speed.toFixed(2)}`);
});

test('a direct write to speed is honoured as speed AND cruise for that frame', () => {
  // index.html writes `flight.speed` directly for walking, the falling resume
  // speed and the freeze. Without this the energy model would drag a 1.4-unit
  // walk straight back toward an 11-unit cruise inside a frame.
  const bird = makeBird();
  bird.speed = 1.4;
  bird.tick({ x: 0, y: 0, active: false }, DT);
  assert.equal(bird.cruise, 1.4);
  assert.ok(Math.abs(bird.speed - 1.4) < 0.05, `speed held near the written value, got ${bird.speed}`);

  // A negative speed is the reverse walk. The energy model must not run on it:
  // the bounds are multiples of cruise and flip over when cruise is negative.
  bird.speed = -0.8;
  bird.tick({ x: 0, y: 0, active: false }, DT);
  assert.equal(bird.cruise, -0.8);
  assert.equal(bird.speed, -0.8);

  // Writing `cruise` instead (the flying branch under v2) leaves speed to the
  // energy model, which chases it rather than teleporting.
  bird.speed = 11;
  bird.tick({ x: 0, y: 0, active: false }, DT);
  bird.cruise = 11; // the flying branch's handover, before the boost
  bird.tick({ x: 0, y: 0, active: false }, DT);
  bird.cruise = 26.4; // boost: 11 * BOOST_CONFIG.speedMult
  bird.tick({ x: 0, y: 0, active: false }, DT);
  // One frame in, the bird is already at the new FLOOR (0.55 * 26.4 = 14.52) —
  // the bounds are multiples of cruise, so raising the target raises the floor
  // under the current speed at once — but it is nowhere near the target yet.
  assert.ok(bird.speed > 11 && bird.speed < 16, `boost should not teleport: ${bird.speed.toFixed(2)}`);
  fly(bird, { x: 0, y: 0, active: false }, 1.5);
  assert.ok(bird.speed > 20 && bird.speed < 26.4, `boost should ramp toward cruise: ${bird.speed.toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

test('the terrain floor holds through a loop under', () => {
  // A carved-down sampler (height <= 0 everywhere), the same shape
  // spherical-world.js guarantees — the gravity-less floor may dip into
  // valleys and must never rise.
  const terrainHeightAt = (nx, ny, nz) => -6 * Math.abs(nx) - 3 * Math.abs(nz);
  const birdRadius = 1.2;

  for (const site of SITES) {
    const bird = makeBird({
      terrainHeightAt,
      birdRadius,
      position: site.position().normalize().multiplyScalar(SPHERE_RADIUS + 8),
    });
    levelAt(bird, site.forward());

    let worst = Infinity;
    fly(bird, { x: 0, y: -1, active: true }, 5, (b) => {
      const dir = b.position.clone().normalize();
      const floor = SPHERE_RADIUS + terrainHeightAt(dir.x, dir.y, dir.z) + birdRadius;
      worst = Math.min(worst, b.position.length() - floor);
    });
    assert.ok(worst >= -1e-6, `${site.name}: sank ${(-worst).toFixed(4)} below the floor`);
  }
});

// ---------------------------------------------------------------------------
// Contract with index.html
// ---------------------------------------------------------------------------

test('tick returns the same pre-allocated pose and grows no scratch', () => {
  const bird = makeBird();
  const first = bird.tick({ x: 0.4, y: 0.3, active: true }, DT);
  const keys = Object.keys(bird._scratch);
  const before = keys.map((k) => bird._scratch[k]);

  for (let i = 0; i < 1000; i += 1) {
    const pose = bird.tick({ x: Math.sin(i * 0.1), y: Math.cos(i * 0.07), active: true }, DT);
    assert.equal(pose, first, 'pose object identity must not change');
    assert.equal(pose.position, first.position, 'pose.position identity must not change');
    assert.equal(pose.quaternion, first.quaternion, 'pose.quaternion identity must not change');
    assert.equal(pose.velocity, first.velocity, 'pose.velocity identity must not change');
  }

  assert.deepEqual(Object.keys(bird._scratch), keys, 'no scratch slot was added mid-flight');
  keys.forEach((k, i) => assert.equal(bird._scratch[k], before[i], `scratch.${k} was reallocated`));
  assert.ok(Number.isFinite(bird.position.length()), 'position stayed finite');
});

test('the drop-in surface index.html relies on is present', () => {
  const bird = makeBird();
  assert.equal(bird.aerobaticActive, false);
  bird.aerobatic(1, 1);
  assert.equal(bird.aerobaticActive, false, 'aerobatic() is a no-op under v2');
  bird.endAerobatic();
  assert.equal(bird.aerobaticActive, false);

  bird.setSpeed(7);
  assert.equal(bird.speed, 7);
  assert.equal(bird.cruise, 7, 'setSpeed sets the target too, or the bird accelerates away from it');

  bird.setThrottle(0.5);
  assert.equal(bird.throttle, 0.5);
  assert.equal(bird.speed, bird.baseSpeed * 0.5);
  assert.equal(bird.cruise, bird.speed);

  const spawnPos = bird._initialPose.position.clone();
  fly(bird, { x: 1, y: 1, active: true }, 1);
  bird.reset();
  assert.ok(bird.position.clone().sub(spawnPos).length() < 1e-6, 'reset restores the spawn pose');
  assert.equal(bird.cruise, bird.speed, 'reset leaves speed and cruise agreeing');

  assert.equal(typeof bird.getPosition().x, 'number');
  bird.setZenMode(true);
  assert.equal(bird.zenMode, true);
  assert.equal(typeof bird.bankAngle(), 'number');
  assert.equal(typeof bird.pitchAngle(), 'number');
  // Against a number, not against the getter's own formula.
  bird.setSpeed(11);
  bird.cruise = 11;
  bird.speed = 16.5;
  bird._lastTickSpeed = 16.5; // a read, not a command
  assert.ok(Math.abs(bird.energy() - 1.5) < 1e-9, `energy ${bird.energy()}`);
});

test('a huge delta is clamped so a hitch cannot teleport the bird', () => {
  const bird = makeBird();
  const before = bird.position.clone();
  bird.tick({ x: 0, y: 0, active: false }, 5.0);
  const moved = bird.position.clone().sub(before).length();
  assert.ok(moved < 1.0, `delta clamp should cap movement, moved ${moved.toFixed(3)}`);
});
