// Frame clock — a virtual time base for frame-exact recording.
//
// The game loop runs on requestAnimationFrame and measures its delta from the
// timestamp it is handed. While `active`, index.html replaces that timestamp
// with `advance()`, so every system that runs on the loop's delta (flight,
// water, wind, clouds, the bird's flap, the eye's adaptation) sees exactly
// 1/fps seconds per frame however long the frame really took to draw. The
// studio seeks the shot to `frame / fps` in `before` and captures the canvas
// in `after`, so a slow machine produces the SAME video as a fast one — it
// just takes longer to make.
//
// `stall()` lets the encoder push back: while it returns true the clock does
// not advance, the loop re-draws the same instant (delta 0) and `fresh` is
// false, so `after` knows not to capture a duplicate.
//
// Pure: no DOM, no THREE.

export function createFrameClock() {
  return {
    active: false,
    fps: 30,
    ms: 0,
    frame: 0,
    fresh: false,
    stall: null,
    before: null,
    after: null,
    /** Start at wall time `startMs` (so the loop's previous timestamp stays continuous). */
    start(fps, startMs, hooks = {}) {
      this.fps = fps > 0 ? fps : 30;
      this.ms = startMs;
      this.frame = -1;
      this.fresh = false;
      this.stall = hooks.stall || null;
      this.before = hooks.before || null;
      this.after = hooks.after || null;
      this.active = true;
    },
    /** The timestamp this frame runs at. Advances one frame unless stalled. */
    advance() {
      if (this.stall && this.stall()) { this.fresh = false; return this.ms; }
      this.frame += 1;
      if (this.frame > 0) this.ms += 1000 / this.fps;
      this.fresh = true;
      return this.ms;
    },
    stop() {
      this.active = false;
      this.stall = this.before = this.after = null;
      this.fresh = false;
    },
  };
}

/** Wall clock, or the frame clock while one is recording (for modules off the loop's delta). */
export function clockNow() {
  const fc = typeof globalThis !== 'undefined' ? globalThis.__birbFrameClock : null;
  if (fc && fc.active) return fc.ms;
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
