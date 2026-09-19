/**
 * tests/dev-gesture.test.js — RED-FIRST spec for `src/ui/dev-gesture.js`.
 *
 * Wave 1 / task P1.1b of docs/ULTRACODE_PERFORMANCE_PLAN.md §4. The module under
 * test DOES NOT EXIST YET; Wave 2 (P2.2) builds it. This file is the oracle.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE CAN AND CANNOT BUY
 * ---------------------------------------------------------------------------
 * Assertion A1 of docs/perf/CONTRACT.md §4 has two halves:
 *
 *   (a) the gesture is recognised correctly — three fingers arriving together,
 *       held briefly, opening on RELEASE, not firing on one or two, respecting
 *       touchcancel; and
 *   (b) it is registered on the PRODUCTION path, outside the `?debug` block
 *       (CONTRACT §6, a ruling, and G2b's STOP condition).
 *
 * **This suite buys (a) and cannot buy (b).** Half (b) needs a real page and is
 * `tools/birb-quality.mjs`'s job in Wave 2 — a page loaded WITHOUT `?debug`,
 * synthesised touches, and a panel that opens. Nothing under `node --test` can
 * observe where a listener was registered. Recording that here so a green run of
 * this file is never mistaken for A1 being satisfied.
 *
 * What half (a) is worth is that it forces the recogniser to exist as a PURE
 * STATE MACHINE with injected callbacks and time as an argument. That shape is
 * not a stylistic preference: `node_modules/three` is a 414-line hand-written
 * stub tracked in git, CI runs `npm test` with no install step, and a module
 * that reaches for `document` or `Date.now()` is a module `npm test` cannot be
 * an oracle for — every task touching it then becomes Opus work.
 *
 * ---------------------------------------------------------------------------
 * THE COPY-PASTE THIS SUITE EXISTS TO REJECT
 * ---------------------------------------------------------------------------
 * Three sibling artefacts in this repo already ship a three-finger recogniser:
 * `gauntlet/src/ui/qr-overlay.js`, `sculpture/src/ui/qr-overlay.js` and
 * `icon3d/src/ui/qr-overlay.js`, all with the same body. It is the obvious
 * thing for a Wave 2 agent to lift, and it is right about the important part
 * (arrive together, hold, fire on release). It is wrong about three things that
 * matter here, and each has a test below:
 *
 *   1. It binds `touchcancel` to the SAME handler as `touchend`. So a cancel
 *      arriving after the hold is satisfied OPENS the panel. The plan says
 *      "respect touch cancellation" and a cancel is the OS taking the gesture
 *      away — Control Centre, a notification, a palm. DG-A6.
 *   2. It reads `Date.now()` internally, so its timing cannot be driven by a
 *      test or by a harness. DG-A11.
 *   3. It counts `e.touches.length` rather than tracking identifiers, so a
 *      repeated `touchstart` for a contact already down inflates the count.
 *      DG-A10.
 *
 * A fourth difference is deliberate and is a RULING of this task, not an
 * inheritance: this gesture must CANCEL GAMEPLAY POINTERS when it opens (the
 * plan: "Cancel gameplay pointers when it opens") and must NOT do so on a
 * candidate that never opens. That matters more here than in the QR siblings
 * because in Birb Mobile *three fingers is already a sprint*: index.html:7538
 * sprints on `touchCount >= 2`. A recogniser that cancelled pointers on every
 * three-finger candidate would drop the player's stick and boost mid-flight
 * every time they fumbled a grab. DG-A7.
 *
 * ---------------------------------------------------------------------------
 * THE API THIS SUITE PINS  (Wave 2 transcribes; it does not redesign)
 * ---------------------------------------------------------------------------
 *   export const DEV_GESTURE_DEFAULTS = { fingers, gatherMs, holdMs }
 *   export const DEV_GESTURE_STATES   = { IDLE:'idle', GATHERING:'gathering',
 *                                         ARMED:'armed', VOID:'void' }
 *
 *   export function createDevGesture({
 *     onOpen,            // () => void   fired exactly once, on release
 *     onCancelPointers,  // () => void   optional; fired immediately before onOpen, never otherwise
 *     fingers, gatherMs, holdMs,         // optional overrides of DEV_GESTURE_DEFAULTS
 *   })
 *
 *   .down(id, tMs)     a contact begins   (touchstart / pointerdown)
 *   .up(id, tMs)       a contact ends     (touchend / pointerup)
 *   .cancel(id, tMs)   a contact is TAKEN (touchcancel / pointercancel) — never opens
 *   .reset()           back to idle, drops all contacts
 *   .activeCount       number of contacts currently down
 *   .state             ∈ DEV_GESTURE_STATES
 *
 * THE STATE MACHINE, pinned:
 *   idle      → gathering  on the first `down`; firstDownAt = t
 *   gathering → armed      when activeCount reaches `fingers` AND (t - firstDownAt) <= gatherMs;
 *                          armedAt = t
 *   gathering → void       when activeCount reaches `fingers` too late, or exceeds it
 *   armed     → void       on any `cancel`, or when activeCount exceeds `fingers`
 *   armed     → OPEN       on the first `up` that drops activeCount below `fingers`,
 *                          if (t - armedAt) >= holdMs; then → void, so the remaining
 *                          lifts cannot fire it a second time
 *   armed     → void       on that same first `up` when the hold is NOT satisfied.
 *                          The first release DECIDES. A candidate that survives a
 *                          too-early release fires later, off the SECOND finger's
 *                          lift, which is how the sibling recognisers behave and is
 *                          what DG-A5 rejects.
 *   any       → idle       when activeCount reaches 0
 *
 * TWO PINNED DECISIONS, flagged for G1 because they are judgement, not
 * transcription:
 *   • A FOURTH contact voids the candidate. "Three fingers arriving together" is
 *     a specific grab; a fourth contact is a palm or a bystander's hand, and
 *     opening a dev panel on a palm-down is worse than missing a deliberate
 *     gesture that can simply be repeated. The sibling recognisers agree
 *     (`else if (n > 3) valid = false`).
 *   • The hold is measured from the THIRD arrival (armedAt), not from the
 *     first. Otherwise a slow gather satisfies the hold before the third finger
 *     has been down for any time at all.
 *
 * R4: dynamic import inside every test body, skipped unless BIRB_PERF_IMPL.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../src/ui/dev-gesture.js';
const IMPL = process.env.BIRB_PERF_IMPL ? false
  : 'BIRB_PERF_IMPL unset — src/ui/dev-gesture.js is a Wave 2 deliverable (P2.2)';

async function load() {
  try {
    return await import(MODULE);
  } catch (err) {
    err.message =
      `[red-first] ${MODULE} does not exist yet — Wave 2 P2.2 must create it.\n` +
      `  original (${err.code || 'no code'}): ${err.message}`;
    throw err;
  }
}

/** Recorder for the injected callbacks; order matters and is preserved. */
function makeRig(overrides = {}) {
  const calls = [];
  return {
    calls,
    get opens() { return calls.filter((c) => c === 'open').length; },
    get cancels() { return calls.filter((c) => c === 'cancelPointers').length; },
    opts: {
      onOpen: () => calls.push('open'),
      onCancelPointers: () => calls.push('cancelPointers'),
      ...overrides,
    },
  };
}

// Timings used by most tests. Chosen only to be unambiguous relative to each
// other; the module's own defaults are exercised separately by DG-A12.
const GATHER = 600;
const HOLD = 320;
const opts = (rig, extra = {}) => ({ ...rig.opts, gatherMs: GATHER, holdMs: HOLD, ...extra });

// ---------------------------------------------------------------------------
// DG-A0 — the environment guard. This suite is only meaningful because there is
// no DOM here: if the module reaches for `document`, importing it throws and
// every test below goes red. Asserting the precondition makes that legible
// instead of mysterious.
// ---------------------------------------------------------------------------
test('DG-A0 the test environment has no DOM, so a DOM-coupled recogniser cannot pass', { skip: IMPL }, async () => {
  assert.equal(typeof globalThis.document, 'undefined',
    'node --test has no document — this is the constraint that forces the injected-callback shape');
  const mod = await load();
  assert.equal(typeof mod.createDevGesture, 'function');
});

// ---------------------------------------------------------------------------
// DG-A1 (contract A1, half (a)) — three fingers together, held, opening ON
// RELEASE.
//
// Would catch a recogniser that fires when the hold elapses while the fingers
// are still down: the panel would pop up under the player's own hand, over the
// screen they are still touching, and the first thing it receives is three
// stray contacts. The explicit "not yet" assertion at holdMs + 1 is what makes
// this test about the release rather than about the timer.
// ---------------------------------------------------------------------------
test('DG-A1 three fingers arriving together and held open the panel on RELEASE', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_STATES } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.down('a', 1000);
  g.down('b', 1050);
  g.down('c', 1100);
  assert.equal(g.activeCount, 3);
  assert.equal(g.state, DEV_GESTURE_STATES.ARMED, 'all three landed inside the gather window');
  assert.equal(rig.opens, 0);

  // Well past the hold, still down. Nothing may have fired.
  assert.equal(rig.opens, 0, 'the hold elapsing is not the trigger — the release is');

  g.up('a', 1100 + HOLD + 1);
  assert.equal(rig.opens, 1, 'the first lift after a satisfied hold opens it');

  g.up('b', 1100 + HOLD + 20);
  g.up('c', 1100 + HOLD + 40);
  assert.equal(rig.opens, 1, 'and the other two lifts must not open it again');
  assert.equal(g.state, DEV_GESTURE_STATES.IDLE, 'all contacts gone, back to idle');
});

// ---------------------------------------------------------------------------
// DG-A2 (contract A2, pinned) — one and two fingers must NEVER open it.
//
// Verbatim from `.claude/workflows/perf-wave-1.js` and CONTRACT §4: "a
// two-finger touch must NOT open the panel (the sprint gesture must survive)."
// One finger is the stick. Two is stick + boost, and in Ring Rush two contacts
// ARE the sprint (index.html:7538, `touchCount >= 2`). A dev panel that opens
// on either is a panel that opens mid-run, on a phone, during the exact
// gameplay this workbench exists to measure.
//
// Tested at generous durations on purpose: a one- or two-finger contact held
// for ten seconds is a completely normal thing for a player to do.
// ---------------------------------------------------------------------------
test('DG-A2 one finger and two fingers never open the panel, however long they are held', { skip: IMPL }, async () => {
  const { createDevGesture } = await load();

  for (const contacts of [['a'], ['a', 'b']]) {
    const rig = makeRig();
    const g = createDevGesture(opts(rig));

    contacts.forEach((id, i) => g.down(id, 1000 + i * 30));
    contacts.forEach((id, i) => g.up(id, 11000 + i * 30));

    assert.equal(rig.opens, 0, `${contacts.length}-finger gesture must not open the panel`);
    assert.equal(rig.cancels, 0,
      'and must not cancel gameplay pointers either — that is the stick and the sprint');
  }
});

// ---------------------------------------------------------------------------
// DG-A3 — a fourth contact voids the candidate.
//
// Would catch `activeCount >= fingers`, which turns a palm resting on the glass
// into a dev-panel trigger. Note the second half: the fourth finger lifting
// does NOT resurrect the candidate. A machine that re-arms when the count falls
// back to three opens the panel on the way out of a palm rest, which is the
// same bug arriving one event later.
// ---------------------------------------------------------------------------
test('DG-A3 a fourth contact voids the gesture, and lifting it does not resurrect it', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_STATES } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.down('a', 1000);
  g.down('b', 1020);
  g.down('c', 1040);
  assert.equal(g.state, DEV_GESTURE_STATES.ARMED);

  g.down('palm', 1060);
  assert.equal(g.state, DEV_GESTURE_STATES.VOID, 'four contacts is not the gesture');

  g.up('palm', 2000);
  assert.equal(g.state, DEV_GESTURE_STATES.VOID, 'still void with three down — no resurrection');

  g.up('a', 2100);
  g.up('b', 2120);
  g.up('c', 2140);
  assert.equal(rig.opens, 0);
  assert.equal(rig.cancels, 0);
});

// ---------------------------------------------------------------------------
// DG-A4 — "arriving TOGETHER": a late third finger is not the gesture.
//
// This is what separates a deliberate grab from ordinary play. A player flying
// with the stick (one finger) who adds boost (two) and then rests a third is
// not asking for a dev panel; they are flying. Both siblings' comments say the
// same thing: "a three-finger contact that started as a one-finger drag is
// somebody flying, not somebody asking for a QR code."
//
// Would catch a recogniser that only counts concurrent contacts, which is the
// simplest correct-looking implementation and is wrong for this exact case.
// ---------------------------------------------------------------------------
test('DG-A4 a third finger arriving after the gather window does not arm the gesture', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_STATES } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.down('stick', 1000);
  g.down('boost', 1200);
  g.down('late', 1000 + GATHER + 1);      // just outside the window, measured from the FIRST

  assert.equal(g.activeCount, 3);
  assert.equal(g.state, DEV_GESTURE_STATES.VOID, 'three fingers, but not together');

  g.up('stick', 9000);
  g.up('boost', 9020);
  g.up('late', 9040);
  assert.equal(rig.opens, 0);

  // The boundary case belongs to the gesture: exactly at gatherMs still arms.
  const rig2 = makeRig();
  const g2 = createDevGesture(opts(rig2));
  g2.down('a', 1000);
  g2.down('b', 1300);
  g2.down('c', 1000 + GATHER);
  assert.equal(g2.state, DEV_GESTURE_STATES.ARMED, 'the window is inclusive at its edge');
});

// ---------------------------------------------------------------------------
// DG-A5 — "holding BRIEFLY": a flick does not open it.
//
// Would catch holdMs being ignored entirely, which makes any three-finger tap a
// trigger — and three-finger taps happen by accident on a phone held in two
// hands. As in DG-A4, the boundary is pinned so `>` versus `>=` is decided here
// rather than discovered by a player.
// ---------------------------------------------------------------------------
test('DG-A5 a three-finger flick released before the hold does not open the panel', { skip: IMPL }, async () => {
  const { createDevGesture } = await load();

  const rig = makeRig();
  const g = createDevGesture(opts(rig));
  g.down('a', 1000); g.down('b', 1010); g.down('c', 1020);
  g.up('a', 1020 + HOLD - 1);
  g.up('b', 1020 + HOLD + 500);
  g.up('c', 1020 + HOLD + 600);
  assert.equal(rig.opens, 0, 'released one millisecond early — not a hold');

  // The hold is measured from the THIRD arrival, not the first: a slow gather
  // must not have its hold already satisfied by the time it completes.
  const rig2 = makeRig();
  const g2 = createDevGesture(opts(rig2));
  g2.down('a', 1000);
  g2.down('b', 1200);
  g2.down('c', 1500);                     // armedAt = 1500, gathered in 500 <= 600
  g2.up('a', 1500 + HOLD - 1);
  assert.equal(rig2.opens, 0, 'hold runs from the third arrival, not the first');

  // …and exactly at the hold, it opens.
  const rig3 = makeRig();
  const g3 = createDevGesture(opts(rig3));
  g3.down('a', 1000); g3.down('b', 1010); g3.down('c', 1020);
  g3.up('a', 1020 + HOLD);
  assert.equal(rig3.opens, 1, 'the hold boundary is inclusive');
});

// ---------------------------------------------------------------------------
// DG-A6 — touchcancel ABORTS. This is the sibling copy-paste's live defect.
//
// `gauntlet/src/ui/qr-overlay.js` registers `onEnd` for both `touchend` and
// `touchcancel`, so a cancel that drops the count below three after the hold is
// satisfied calls show(). Here that would open the dev panel at the moment iOS
// took the gesture away — Control Centre sliding down, a notification, a call.
// The plan is explicit: "respect touch cancellation."
//
// The re-arm half matters as much: a machine that latches void forever after
// one cancel is a gesture that stops working after the first notification of
// the session, which reads to a user as "the panel is broken".
// ---------------------------------------------------------------------------
test('DG-A6 a cancel aborts a satisfied gesture, and the machine re-arms afterwards', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_STATES } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.down('a', 1000); g.down('b', 1010); g.down('c', 1020);
  g.cancel('a', 1020 + HOLD + 50);        // the OS takes it, well past the hold
  assert.equal(g.state, DEV_GESTURE_STATES.VOID);
  assert.equal(rig.opens, 0, 'a cancel is not a release');

  g.up('b', 1500); g.up('c', 1520);
  assert.equal(rig.opens, 0, 'and the remaining lifts cannot complete a cancelled gesture');
  assert.equal(g.state, DEV_GESTURE_STATES.IDLE);

  // A fresh, complete gesture still works.
  g.down('d', 5000); g.down('e', 5010); g.down('f', 5020);
  g.up('d', 5020 + HOLD);
  assert.equal(rig.opens, 1, 'one cancel must not disable the gesture for the session');
});

// ---------------------------------------------------------------------------
// DG-A7 — gameplay pointers are cancelled ONLY when the panel opens, and
//         immediately before it.
//
// Both directions are load-bearing:
//  • Not cancelling on open leaves the stick and the sprint latched under a
//    panel the player is now tapping — the plan: "Cancel gameplay pointers when
//    it opens … Close restores control cleanly."
//  • Cancelling on a candidate that never opens is worse. Three fingers is
//    already a sprint in this game, so every fumbled grab, every palm, every
//    late third finger would drop the player's controls mid-flight.
// ---------------------------------------------------------------------------
test('DG-A7 gameplay pointers are cancelled on open, immediately before it, and never otherwise', { skip: IMPL }, async () => {
  const { createDevGesture } = await load();

  const rig = makeRig();
  const g = createDevGesture(opts(rig));
  g.down('a', 1000); g.down('b', 1010); g.down('c', 1020);
  g.up('a', 1020 + HOLD);
  assert.deepEqual(rig.calls, ['cancelPointers', 'open'],
    'cancel first, then open — a panel that opens over live pointers receives them');

  // Every rejected shape: no cancellation at all.
  for (const drive of [
    (m) => { m.down('a', 0); m.up('a', 9000); },                                   // one finger
    (m) => { m.down('a', 0); m.down('b', 10); m.up('a', 9000); m.up('b', 9010); }, // two
    (m) => { m.down('a', 0); m.down('b', 10); m.down('c', 20); m.up('a', 30); },   // flick
    (m) => { m.down('a', 0); m.down('b', 10); m.down('c', GATHER + 100); m.up('a', 9000); }, // late
    (m) => { m.down('a', 0); m.down('b', 10); m.down('c', 20); m.cancel('b', 9000); },       // cancelled
  ]) {
    const r = makeRig();
    drive(createDevGesture(opts(r)));
    assert.equal(r.opens, 0);
    assert.equal(r.cancels, 0, 'a candidate that never opens must not touch gameplay input');
  }
});

// ---------------------------------------------------------------------------
// DG-A8 — repeated gestures each open once; nothing latches, nothing leaks.
//
// Would catch a machine that opens once per session (armedAt never cleared) and
// one that keeps stale contacts, where the second gesture's first `down` lands
// on a count that never returned to zero and immediately reads as four.
// ---------------------------------------------------------------------------
test('DG-A8 consecutive gestures each open exactly once', { skip: IMPL }, async () => {
  const { createDevGesture } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  for (let i = 0; i < 5; i += 1) {
    const t = 10000 * (i + 1);
    g.down(`a${i}`, t); g.down(`b${i}`, t + 10); g.down(`c${i}`, t + 20);
    g.up(`a${i}`, t + 20 + HOLD);
    g.up(`b${i}`, t + 20 + HOLD + 10);
    g.up(`c${i}`, t + 20 + HOLD + 20);
    assert.equal(g.activeCount, 0, `contacts leaked after gesture ${i}`);
    assert.equal(rig.opens, i + 1, `gesture ${i} must open exactly once`);
  }
  assert.equal(rig.cancels, 5, 'one pointer cancellation per open, no more');
});

// ---------------------------------------------------------------------------
// DG-A9 — an unknown id cannot lift a contact that was never down.
//
// Would catch a plain counter: iOS is entirely capable of delivering a
// `touchend` for an identifier the page never saw a `touchstart` for (a contact
// that began before the listener attached, or during a scroll the browser
// consumed). Decrementing a counter there drives it negative, and the next
// three fingers read as one.
// ---------------------------------------------------------------------------
test('DG-A9 lifting or cancelling an unknown contact is inert', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_STATES } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.up('ghost', 500);
  g.cancel('phantom', 510);
  assert.equal(g.activeCount, 0, 'the count must not go negative');
  assert.equal(g.state, DEV_GESTURE_STATES.IDLE);

  g.down('a', 1000); g.down('b', 1010); g.down('c', 1020);
  g.up('a', 1020 + HOLD);
  assert.equal(rig.opens, 1, 'and a real gesture afterwards still works');
});

// ---------------------------------------------------------------------------
// DG-A10 — contacts are tracked by IDENTIFIER, so a duplicate `down` is not a
//          second finger.
//
// The sibling recognisers read `e.touches.length`, which is authoritative in a
// real DOM event and unavailable to a pure machine. Reimplementing that as an
// increment means two `touchstart`s for the same identifier — which iOS emits
// on re-entry after a gesture the browser partially consumed — count as two
// contacts. Then TWO fingers open the dev panel, which is A2, in production, on
// the sprint.
// ---------------------------------------------------------------------------
test('DG-A10 a duplicate down for an id already held is not a second finger', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_STATES } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.down('a', 1000);
  g.down('a', 1005);
  g.down('a', 1010);
  assert.equal(g.activeCount, 1, 'one identifier is one finger, however many times it is announced');
  assert.notEqual(g.state, DEV_GESTURE_STATES.ARMED);

  g.down('b', 1020);
  g.down('b', 1025);
  assert.equal(g.activeCount, 2);
  g.up('a', 1020 + HOLD + 100);
  g.up('b', 1020 + HOLD + 120);
  assert.equal(rig.opens, 0, 'two identifiers can never open the panel — that is the sprint (A2)');

  // A duplicate `up` is equally inert.
  const rig2 = makeRig();
  const g2 = createDevGesture(opts(rig2));
  g2.down('a', 1000); g2.down('b', 1010); g2.down('c', 1020);
  g2.up('a', 1020 + HOLD);
  g2.up('a', 1020 + HOLD + 5);
  assert.equal(rig2.opens, 1, 'a repeated lift of the same id must not open it twice');
});

// ---------------------------------------------------------------------------
// DG-A11 — time is an ARGUMENT. The machine owns no clock and no timer.
//
// Would catch `Date.now()` (all three siblings) and `setTimeout`. Two costs:
// the gesture becomes untestable under `node --test`, and — more expensively —
// a self-timed recogniser can fire between frames, which means it can open a
// panel while the render loop is mid-frame and while `birb-quality.mjs` is
// sampling. A machine driven entirely by events fires only where its caller
// says it does.
//
// Driven here with clock values that are absurd in wall-clock terms (starting
// at zero, then leaping a year) precisely so an implementation consulting the
// real clock cannot agree with them.
// ---------------------------------------------------------------------------
test('DG-A11 the recogniser has no clock of its own and no timers', { skip: IMPL }, async () => {
  const { createDevGesture } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.down('a', 0);
  g.down('b', 1);
  g.down('c', 2);
  g.up('a', 2 + HOLD);
  g.up('b', 2 + HOLD + 1);
  g.up('c', 2 + HOLD + 2);
  assert.equal(rig.opens, 1, 'a gesture at t=0 is a valid gesture');

  const YEAR = 365 * 24 * 3600 * 1000;
  g.down('d', YEAR);
  g.down('e', YEAR + 5);
  g.down('f', YEAR + 10);
  g.up('d', YEAR + 10 + HOLD);
  assert.equal(rig.opens, 2, 'and so is one a year later — nothing here reads the wall clock');

  // Nothing may fire without an event: if a timer existed, the count would move
  // as the process ticks. Two microtask turns are enough to expose a
  // queueMicrotask/Promise-based trigger; a setTimeout(0) would also land.
  const before = rig.calls.length;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(rig.calls.length, before, 'no callback may fire between events');
});

// ---------------------------------------------------------------------------
// DG-A12 — the defaults are exported AND used.
//
// An exported constant that the implementation does not read is decoration, and
// the panel/harness then cannot know the timings it is driving. Asserted
// behaviourally — the module's own numbers are used to drive it — rather than by
// pinning values, so a later tuning pass changes one place.
// ---------------------------------------------------------------------------
test('DG-A12 DEV_GESTURE_DEFAULTS is exported and is what an unconfigured machine uses', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_DEFAULTS } = await load();

  const { fingers, gatherMs, holdMs } = DEV_GESTURE_DEFAULTS;
  assert.equal(fingers, 3, 'three is the first contact count this game can never produce (CONTRACT §6.5)');
  assert.ok(Number.isFinite(gatherMs) && gatherMs > 0);
  assert.ok(Number.isFinite(holdMs) && holdMs > 0);

  // Just inside both defaults: opens.
  const ok = makeRig();
  const a = createDevGesture(ok.opts);
  a.down('a', 0); a.down('b', 10); a.down('c', gatherMs - 10);
  a.up('a', (gatherMs - 10) + holdMs);
  assert.equal(ok.opens, 1, 'the unconfigured machine honours its own gather and hold');

  // Just outside the default gather: does not.
  const late = makeRig();
  const b = createDevGesture(late.opts);
  b.down('a', 0); b.down('b', 10); b.down('c', gatherMs + 10);
  b.up('a', gatherMs + 10 + holdMs * 4);
  assert.equal(late.opens, 0, 'and its own gather window is real, not decorative');

  // Just inside the default gather but short of the default hold: does not.
  const brief = makeRig();
  const c = createDevGesture(brief.opts);
  c.down('a', 0); c.down('b', 10); c.down('c', 20);
  c.up('a', 20 + holdMs - 1);
  assert.equal(brief.opens, 0, 'and so is its own hold');
});

// ---------------------------------------------------------------------------
// DG-A13 — `reset()` returns the machine to idle and drops every contact.
//
// The panel and the harness both need this: the panel calls it when it closes
// (so the contacts still down from the opening gesture do not immediately arm a
// second one), and `birb-quality.mjs` calls it between synthesised sequences so
// one check cannot leak state into the next.
// ---------------------------------------------------------------------------
test('DG-A13 reset() clears contacts and cannot itself open the panel', { skip: IMPL }, async () => {
  const { createDevGesture, DEV_GESTURE_STATES } = await load();
  const rig = makeRig();
  const g = createDevGesture(opts(rig));

  g.down('a', 1000); g.down('b', 1010); g.down('c', 1020);
  g.reset();
  assert.equal(g.activeCount, 0);
  assert.equal(g.state, DEV_GESTURE_STATES.IDLE);
  assert.equal(rig.opens, 0, 'reset is not a release');

  g.up('a', 1020 + HOLD + 100);
  assert.equal(rig.opens, 0, 'and a lift arriving after a reset opens nothing');
});

// ---------------------------------------------------------------------------
// DG-A14 — `onCancelPointers` is optional; the machine must not require it.
//
// Would catch `this.onCancelPointers()` on a bare construction, which throws
// inside a document-level touch listener on the production path. index.html has
// no global error boundary on that path, and `tools/birb-modes.mjs` treats a
// console warning as a failure — so this crashes the page for every player who
// makes the gesture, in the one build the workbench is meant to be used on.
// ---------------------------------------------------------------------------
test('DG-A14 the machine works with onOpen alone', { skip: IMPL }, async () => {
  const { createDevGesture } = await load();
  let opened = 0;
  const g = createDevGesture({ onOpen: () => { opened += 1; }, gatherMs: GATHER, holdMs: HOLD });

  g.down('a', 1000); g.down('b', 1010); g.down('c', 1020);
  g.up('a', 1020 + HOLD);
  assert.equal(opened, 1, 'onCancelPointers is optional and its absence must not throw');
});
