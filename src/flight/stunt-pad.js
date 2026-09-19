/**
 * stunt-pad.js — the BOOST pill becomes the right hand.
 *
 * THE INPUT PROBLEM THIS SOLVES. The whole argument in the old
 * `aerobatics.js` against free flight was "there is no spare input — the
 * control surface is one thumbstick and one BOOST pill, both already under a
 * thumb". That was true of the pill as a BUTTON. As a PAD it is three
 * controls, and the one it already had is unchanged:
 *
 *   tap the pill            -> boost, exactly as before (take off, grounded)
 *   hold and drag up/down   -> throttle
 *   hold and drag left/right-> rudder
 *   release                 -> both spring back to neutral
 *
 * Nothing anywhere else on the screen changes, and there is no new gesture to
 * discover: a player who never drags has the game they had yesterday.
 *
 * WHY IT SPRINGS RATHER THAN LATCHES. A latched throttle is one more piece of
 * hidden state on a screen with nowhere to display it, and "my bird is
 * mysteriously slow" is the support request it generates. Springing means the
 * pad is only ever doing something while a thumb is on it.
 *
 * TAP VERSUS DRAG. A tap is a press that never travels more than `tapSlop`
 * pixels AND is released within `tapTime` ms. Both halves are needed: a slow
 * deliberate press-and-hold with no movement is not a boost (it is a throttle
 * input that happens to be centred), and a fast flick across the pill is not
 * a boost either. Once a press has become a drag it can never become a tap
 * again, so a drag never fires the boost by accident on release.
 *
 * Pure state + an optional DOM adapter, the same split `flight-recovery.js`
 * uses: this file imports nothing, so the thresholds are unit-testable
 * without a browser.
 */

export const STUNT_PAD_DEFAULTS = Object.freeze({
  // Pixels of travel that turn a press into a drag. 12 is about a thumb's
  // own wobble on a phone held one-handed; below that a still thumb would
  // register as a rudder input.
  tapSlop: 12,
  // Milliseconds. Past this a press is a hold even if it never moved.
  tapTime: 180,
  // Pixels of travel for full deflection on each axis. 70 is roughly the
  // distance a thumb can travel from the pill without the hand shifting.
  range: 70,
  // Throttle range as a multiple of cruise, matching the controller's own
  // clamp. Dragging UP is faster, which is the way every throttle on every
  // device moves.
  throttleIdle: 0.55,
  throttleFull: 1.35,
});

/**
 * The pad as pure state. Feed it pointer events in CSS pixels; read
 * `throttle` (a multiple of cruise) and `rudder` (-1..1) every frame.
 *
 * `now` is milliseconds and is passed in rather than read from a clock, so a
 * test can decide what "180 ms later" means.
 */
export function createStuntPadState(options = {}) {
  const cfg = { ...STUNT_PAD_DEFAULTS, ...options };
  let active = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let throttle = 1;
  let rudder = 0;

  function reset() {
    active = false;
    dragging = false;
    throttle = 1;
    rudder = 0;
  }

  return {
    /** A thumb went down on the pill. */
    down(x, y, now = 0) {
      active = true;
      dragging = false;
      startX = x;
      startY = y;
      startT = now;
      throttle = 1;
      rudder = 0;
    },

    /** The thumb moved. Returns true once the press has become a drag. */
    move(x, y, now = 0) {
      if (!active) return false;
      const dx = x - startX;
      const dy = y - startY;
      if (!dragging) {
        const travelled = Math.hypot(dx, dy) >= cfg.tapSlop;
        const held = (now - startT) >= cfg.tapTime;
        if (!travelled && !held) return false;
        dragging = true;
      }
      // Screen y grows downward; dragging UP must mean more throttle.
      const up = Math.max(-1, Math.min(1, -dy / cfg.range));
      throttle = up >= 0
        ? 1 + up * (cfg.throttleFull - 1)
        : 1 + up * (1 - cfg.throttleIdle);
      rudder = Math.max(-1, Math.min(1, dx / cfg.range));
      return true;
    },

    /**
     * The thumb came off. Returns `{ tap }` — true only for a press that
     * never became a drag, which is the boost.
     */
    up(now = 0) {
      const wasActive = active;
      const wasDragging = dragging;
      const quick = (now - startT) < cfg.tapTime;
      reset();
      return { tap: wasActive && !wasDragging && quick };
    },

    /** A cancelled press (the browser took the pointer). Never a tap. */
    cancel() {
      reset();
    },

    get throttle() { return throttle; },
    get rudder() { return rudder; },
    get dragging() { return dragging; },
    get active() { return active; },
    config: cfg,
  };
}

/**
 * Bind a pad to a DOM element. Returns the same state object plus `dispose`.
 *
 * `onTap` fires on release of a tap and is where the existing boost handler
 * goes; the button's own `click` must be removed by the caller or the boost
 * fires twice.
 */
export function attachStuntPad(element, { onTap = null, ...options } = {}) {
  const pad = createStuntPadState(options);
  if (!element) return { ...pad, dispose() {} };

  let pointerId = null;

  const onDown = (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId ?? 0;
    // The pill sits inside the joystick's zone on some layouts, and a drag
    // that reaches nipplejs spawns a SECOND stick under the same thumb.
    e.stopPropagation();
    e.preventDefault();
    try { element.setPointerCapture?.(pointerId); } catch (_) { /* ignore */ }
    pad.down(e.clientX, e.clientY, e.timeStamp);
  };

  const onMove = (e) => {
    if (pointerId === null || (e.pointerId ?? 0) !== pointerId) return;
    e.stopPropagation();
    pad.move(e.clientX, e.clientY, e.timeStamp);
    element.classList?.toggle('is-dragging', pad.dragging);
  };

  const onUp = (e) => {
    if (pointerId === null || (e.pointerId ?? 0) !== pointerId) return;
    e.stopPropagation();
    e.preventDefault();
    try { element.releasePointerCapture?.(pointerId); } catch (_) { /* ignore */ }
    pointerId = null;
    const { tap } = pad.up(e.timeStamp);
    element.classList?.remove('is-dragging');
    if (tap && onTap) onTap();
  };

  const onCancel = (e) => {
    if (pointerId === null || (e.pointerId ?? 0) !== pointerId) return;
    pointerId = null;
    pad.cancel();
    element.classList?.remove('is-dragging');
  };

  element.addEventListener('pointerdown', onDown, { passive: false });
  element.addEventListener('pointermove', onMove, { passive: false });
  element.addEventListener('pointerup', onUp, { passive: false });
  element.addEventListener('pointercancel', onCancel);

  return {
    get throttle() { return pad.throttle; },
    get rudder() { return pad.rudder; },
    get dragging() { return pad.dragging; },
    get active() { return pad.active; },
    cancel: () => pad.cancel(),
    dispose() {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
    },
  };
}
