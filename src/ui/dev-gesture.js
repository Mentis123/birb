/**
 * src/ui/dev-gesture.js
 *
 * Three-finger hold-and-release recogniser for the performance workbench.
 * Wave 2 / task P2.2c of docs/ULTRACODE_PERFORMANCE_PLAN.md §4, implementing
 * docs/perf/CONTRACT.md §6 (RULING — the panel and the gesture register on
 * the production path).
 *
 * This module is a PURE STATE MACHINE: it owns no clock, no timer, and no DOM.
 * Every call is driven by an event and a timestamp supplied by the caller
 * (`down(id, tMs)`, `up(id, tMs)`, `cancel(id, tMs)`). The caller — this
 * game's document-level touch listeners — is the only thing that may read
 * `Date.now()` / `performance.now()` or attach to `document`. That split is
 * what lets `tests/dev-gesture.test.js` exercise the recognition logic under
 * `node --test`, which has no DOM at all.
 *
 * THE STATE MACHINE (pinned by the oracle, transcribed here — not redesigned):
 *
 *   idle      → gathering  on the first `down`; firstDownAt = t
 *   gathering → armed      when activeCount reaches `fingers` AND
 *                           (t - firstDownAt) <= gatherMs; armedAt = t
 *   gathering → void       when activeCount reaches `fingers` too late
 *   *         → void       when activeCount exceeds `fingers` (a 4th contact —
 *                           a palm or a bystander, never resurrected by that
 *                           contact lifting again)
 *   armed     → OPEN       on the first `up` that drops activeCount below
 *                           `fingers`, if (t - armedAt) >= holdMs — then → void,
 *                           so the remaining lifts cannot fire it again
 *   armed     → void       on that same first `up` when the hold is not yet
 *                           satisfied, or on ANY `cancel` (touchcancel is not
 *                           a release — the OS took the gesture away)
 *   any       → idle       whenever activeCount reaches 0
 *
 * Contacts are tracked by IDENTIFIER, not by count: a duplicate `down` for an
 * id already held is not a second finger (iOS re-announces a contact after a
 * partially-consumed gesture), and `up`/`cancel` for an id never seen is inert
 * rather than driving the count negative.
 */

export const DEV_GESTURE_DEFAULTS = Object.freeze({
  fingers: 3,   // the first touch count this game can never produce on its own:
                // one is the stick, two is stick + boost / the sprint tracker.
  gatherMs: 250,
  holdMs: 350,
});

export const DEV_GESTURE_STATES = Object.freeze({
  IDLE: 'idle',
  GATHERING: 'gathering',
  ARMED: 'armed',
  VOID: 'void',
});

const noop = () => {};

/**
 * @param {object} options
 * @param {() => void} options.onOpen — fired exactly once, on the release that
 *   completes a satisfied hold.
 * @param {() => void} [options.onCancelPointers] — optional; fired immediately
 *   before `onOpen`, and never at any other time.
 * @param {number} [options.fingers]
 * @param {number} [options.gatherMs]
 * @param {number} [options.holdMs]
 */
export function createDevGesture(options = {}) {
  const onOpen = options.onOpen || noop;
  const onCancelPointers = options.onCancelPointers || null;
  const fingers = options.fingers ?? DEV_GESTURE_DEFAULTS.fingers;
  const gatherMs = options.gatherMs ?? DEV_GESTURE_DEFAULTS.gatherMs;
  const holdMs = options.holdMs ?? DEV_GESTURE_DEFAULTS.holdMs;

  // Set, not a counter — see the identifier-tracking note above.
  const contacts = new Set();

  let state = DEV_GESTURE_STATES.IDLE;
  let firstDownAt = null;
  let armedAt = null;

  function down(id, tMs) {
    if (contacts.has(id)) return; // DG-A10: re-announcement, not a new finger
    contacts.add(id);
    const count = contacts.size;

    if (count === 1) {
      state = DEV_GESTURE_STATES.GATHERING;
      firstDownAt = tMs;
      return;
    }

    if (count > fingers) {
      // A 4th contact (or more) voids the candidate outright, from any state.
      state = DEV_GESTURE_STATES.VOID;
      return;
    }

    if (count === fingers && state === DEV_GESTURE_STATES.GATHERING) {
      if (tMs - firstDownAt <= gatherMs) {
        state = DEV_GESTURE_STATES.ARMED;
        armedAt = tMs;
      } else {
        state = DEV_GESTURE_STATES.VOID;
      }
    }
    // Otherwise (count still below `fingers`, or state already VOID/ARMED
    // impossible-at-this-count) the current state is left untouched.
  }

  function up(id, tMs) {
    if (!contacts.has(id)) return; // DG-A9: unknown id, inert
    contacts.delete(id);

    if (state === DEV_GESTURE_STATES.ARMED) {
      const holdSatisfied = tMs - armedAt >= holdMs;
      if (holdSatisfied) {
        if (onCancelPointers) onCancelPointers();
        onOpen();
      }
      state = DEV_GESTURE_STATES.VOID;
    }

    if (contacts.size === 0) {
      state = DEV_GESTURE_STATES.IDLE;
    }
  }

  function cancel(id, _tMs) {
    if (!contacts.has(id)) return; // unknown id, inert
    contacts.delete(id);
    // A cancel is never a release — it can only void the candidate.
    state = DEV_GESTURE_STATES.VOID;
    if (contacts.size === 0) {
      state = DEV_GESTURE_STATES.IDLE;
    }
  }

  function reset() {
    contacts.clear();
    state = DEV_GESTURE_STATES.IDLE;
    firstDownAt = null;
    armedAt = null;
  }

  return {
    down,
    up,
    cancel,
    reset,
    get activeCount() { return contacts.size; },
    get state() { return state; },
  };
}
