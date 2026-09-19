/**
 * stunt-detector.js — name the figure the player just flew.
 *
 * WHY THIS EXISTS AT ALL. Emergent aerobatics have one weakness against the
 * scripted kind they replace: nothing says "Barrel roll!" on the screen. The
 * old `aerobatics.js` knew what it was doing because it decided in advance;
 * this controller does not decide anything, so the figure has to be
 * RECOGNISED after the fact. That toast is also the only feedback that tells
 * a new player the stunts are there at all.
 *
 * IT READS ROTATION DELTAS, NOT ANGLES. The obvious implementation watches
 * `bank` and `pitch` and accumulates, and it is wrong: `pitch` is an `asin`
 * and folds at ±90 degrees, `bank` is undefined at the vertical, and both
 * singularities sit exactly where the interesting figures live — the top of
 * a loop, the apex of a hammerhead. The controller already knows precisely
 * how far it rotated the bird on each axis this frame (`lastDeltas`), so the
 * detector integrates THAT. No singularities, no unwrapping, and a figure is
 * measured in the same terms the pilot flew it in.
 *
 * A FULL FIGURE FIRES ON COMPLETION; A HALF FIGURE FIRES WHEN THE AXIS GOES
 * QUIET, and getting that order wrong is the one trap in here. The first
 * version tested for a half-loop first and CONSUMED the accumulator at PI —
 * so a full loop, which necessarily passes through PI on its way to 2PI,
 * could never be detected at all. Now a full turn fires and resets the
 * accumulator while the axis keeps running (so a player holding the stick
 * through three loops gets three toasts), and half-turns are only classified
 * once the stick has been still on that axis for `settle` — which is what
 * the end of a figure actually looks like.
 *
 * Pure: imports nothing, no THREE, no DOM. One pre-allocated event object,
 * so the game loop allocates nothing to be told it did a loop.
 */

const TAU = Math.PI * 2;
const HALF = Math.PI;

export const STUNT_DETECTOR_DEFAULTS = Object.freeze({
  // A figure has to be flown, not drifted into. An accumulation older than
  // its window is not a figure, it is a long turn.
  rollWindow: 3.0,
  loopWindow: 6.0,
  // How far off-axis a figure may wander and still count. A barrel roll with
  // 40 degrees of pitch in it is a barrel roll; with 120 it is a tumble.
  rollPitchSlack: 0.9,
  loopRollSlack: 1.2,
  // A full turn is allowed to fall a little short of 360: a frame boundary
  // lands wherever it lands, and the player released at "level again".
  fullTurn: TAU * 0.92,
  halfTurn: HALF * 0.8,
  // How long an axis must be still before the rotation on it counts as
  // finished. Long enough not to trip between two pulls of the same loop.
  settle: 0.22,
  // A combination figure (Immelmann, split-S) has to be continuous: the
  // second half closing within this long of the first.
  linkWindow: 2.2,
  // Held attitudes, radians.
  knifeTolerance: 0.26,    // 15 degrees either side of 90
  knifeHold: 1.2,
  invertedTolerance: 0.52, // 30 degrees either side of 180
  invertedHold: 2.0,
  // A low pass is a deliberate thing, done fast and close.
  lowPassHeight: 3.5,
  lowPassHold: 1.0,
  lowPassSpeedMul: 1.0,
  // The hammerhead's two halves: steeply up and out of speed, then steeply
  // down, within this long.
  hangPitch: 1.22,
  hangDownPitch: -0.9,
  hangWindow: 3.0,
  // Nothing fires twice inside this, so one long inverted run is one toast.
  repeatCooldown: 3.0,
});

export const STUNT_LABELS = Object.freeze({
  roll: 'Barrel roll!',
  loop: 'Loop!',
  immelmann: 'Immelmann!',
  splitS: 'Split-S!',
  hammerhead: 'Hammerhead!',
  knife: 'Knife edge!',
  inverted: 'Inverted!',
  lowPass: 'Low pass!',
});

/**
 * @param {object} cfg overrides for STUNT_DETECTOR_DEFAULTS
 * @returns a detector. Call `update(sample, dt)` once per frame with
 *   `{ rollDelta, pitchDelta, bank, pitch, heading, speed, cruise,
 *      aboveGround, stalled }` and read the returned event (or null).
 */
export function createStuntDetector(cfg = {}) {
  const C = { ...STUNT_DETECTOR_DEFAULTS, ...cfg };

  /** One rotation axis: a signed accumulator and how quiet it has been. */
  function axis(window, slackKey) {
    return { acc: 0, age: 0, quiet: 0, sign: 0, offAxis: 0, window, slackKey };
  }
  const roll = axis(C.rollWindow, 'rollPitchSlack');
  const pitch = axis(C.loopWindow, 'loopRollSlack');

  // The last half-turn that closed, for linking into an Immelmann or a
  // split-S. 'roll' | 'pitchUp' | 'pitchDown'.
  let halfKind = null;
  let halfAge = 0;

  let knifeTime = 0, invertedTime = 0, lowTime = 0;
  let hangArmed = false, hangAge = 0, hangHeading = 0;

  const cooldowns = Object.create(null);
  const event = { id: null, label: '', detail: 0 };
  let clock = 0;

  function ready(id) {
    const last = cooldowns[id];
    return last === undefined || (clock - last) >= C.repeatCooldown;
  }

  function fire(id, detail = 0) {
    cooldowns[id] = clock;
    event.id = id;
    event.label = STUNT_LABELS[id] || id;
    event.detail = detail;
    return event;
  }

  function clear(a) {
    a.acc = 0; a.age = 0; a.quiet = 0; a.sign = 0; a.offAxis = 0;
  }

  /**
   * Feed one axis. Reverse the direction and the accumulation starts again —
   * a figure is a CONTINUOUS rotation one way, and half a roll left followed
   * by half a roll right is not a roll.
   */
  function accumulate(a, delta, offAxisDelta, dt) {
    const s = Math.sign(delta);
    if (s !== 0) {
      if (a.sign !== 0 && s !== a.sign) clear(a);
      a.sign = s;
      a.acc += delta;
      a.offAxis += Math.abs(offAxisDelta);
      a.quiet = 0;
    } else {
      a.quiet += dt;
    }
    a.age += dt;
    if (a.age > a.window) clear(a);
  }

  return {
    /** Reset every accumulator. Call on a knockdown, a nest or a teleport. */
    reset() {
      clear(roll); clear(pitch);
      halfKind = null; halfAge = 0;
      knifeTime = invertedTime = lowTime = 0;
      hangArmed = false; hangAge = 0;
    },

    /** @returns the completed figure this frame, or null. */
    update(sample, dt) {
      if (!sample || !(dt > 0)) return null;
      clock += dt;
      const rd = sample.rollDelta || 0;
      const pd = sample.pitchDelta || 0;
      const bank = sample.bank || 0;
      const nose = sample.pitch || 0;
      const cruise = sample.cruise > 0 ? sample.cruise : 1;
      const speed = sample.speed || 0;
      const above = Number.isFinite(sample.aboveGround) ? sample.aboveGround : Infinity;

      halfAge += dt;
      if (halfAge > C.linkWindow) halfKind = null;

      accumulate(roll, rd, pd, dt);
      accumulate(pitch, pd, rd, dt);

      // --- full turns: fire the moment they close -------------------------
      // The accumulator resets but the axis stays alive, so holding the stick
      // through three loops is three toasts rather than one.
      if (Math.abs(pitch.acc) >= C.fullTurn && pitch.offAxis <= C[pitch.slackKey]) {
        const turns = pitch.acc;
        clear(pitch);
        halfKind = null;
        if (ready('loop')) return fire('loop', turns);
      }
      if (Math.abs(roll.acc) >= C.fullTurn && roll.offAxis <= C[roll.slackKey]) {
        const turns = roll.acc;
        clear(roll);
        halfKind = null;
        if (ready('roll')) return fire('roll', turns);
      }

      // --- half turns: classify once the axis has gone quiet ---------------
      // An Immelmann is half a loop UP and then half a roll to upright; a
      // split-S is the same two halves in the other ORDER. The order is what
      // tells them apart — both pull positive pitch in the bird's own frame,
      // so the sign of the pitch half cannot.
      if (pitch.quiet >= C.settle && Math.abs(pitch.acc) >= C.halfTurn
          && pitch.offAxis <= C[pitch.slackKey]) {
        const up = pitch.acc > 0;
        clear(pitch);
        if (halfKind === 'roll' && halfAge <= C.linkWindow) {
          halfKind = null;
          if (ready('splitS')) return fire('splitS', up ? 1 : -1);
        } else {
          halfKind = up ? 'pitchUp' : 'pitchDown';
          halfAge = 0;
        }
      }
      if (roll.quiet >= C.settle && Math.abs(roll.acc) >= C.halfTurn
          && roll.offAxis <= C[roll.slackKey]) {
        clear(roll);
        if (halfKind === 'pitchUp' && halfAge <= C.linkWindow) {
          halfKind = null;
          if (ready('immelmann')) return fire('immelmann');
        } else {
          halfKind = 'roll';
          halfAge = 0;
        }
      }

      // --- the hammerhead --------------------------------------------------
      // Steeply nose-up and out of speed: arm, and remember the heading. Back
      // steeply nose-DOWN inside the window and it pivoted or slid — either
      // way it is a hammerhead, and neither is a scripted move.
      if (hangArmed) hangAge += dt;
      if (nose > C.hangPitch && (sample.stalled || speed < 0.6 * cruise)) {
        if (!hangArmed) { hangArmed = true; hangAge = 0; hangHeading = sample.heading || 0; }
      } else if (hangArmed) {
        if (nose < C.hangDownPitch) {
          hangArmed = false;
          if (ready('hammerhead')) return fire('hammerhead', hangHeading);
        } else if (hangAge > C.hangWindow) {
          hangArmed = false;
        }
      }

      // --- held attitudes ---------------------------------------------------
      const bankAbs = Math.abs(bank);
      if (Math.abs(bankAbs - Math.PI / 2) <= C.knifeTolerance) {
        knifeTime += dt;
        if (knifeTime >= C.knifeHold && ready('knife')) {
          knifeTime = 0;
          return fire('knife', bank);
        }
      } else knifeTime = 0;

      if (Math.abs(bankAbs - Math.PI) <= C.invertedTolerance) {
        invertedTime += dt;
        if (invertedTime >= C.invertedHold && ready('inverted')) {
          invertedTime = 0;
          return fire('inverted', bank);
        }
      } else invertedTime = 0;

      if (above <= C.lowPassHeight && speed >= C.lowPassSpeedMul * cruise && bankAbs < 1.0) {
        lowTime += dt;
        if (lowTime >= C.lowPassHold && ready('lowPass')) {
          lowTime = 0;
          return fire('lowPass', above);
        }
      } else lowTime = 0;

      return null;
    },

    /** For a harness: what the accumulators currently hold. */
    state() {
      return {
        rollAcc: roll.acc, pitchAcc: pitch.acc,
        rollQuiet: roll.quiet, pitchQuiet: pitch.quiet,
        knifeTime, invertedTime, lowTime, hangArmed, halfKind,
      };
    },
  };
}
