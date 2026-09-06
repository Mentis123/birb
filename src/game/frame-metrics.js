/**
 * Frame-rate sampling for the adaptive quality tier.
 *
 * This exists as its own module because of the bug that created it. The
 * sampler used to live inside the function that also wrote the FPS number
 * into a debug readout, and that function opened with:
 *
 *     if (!fpsMetric) return;
 *
 * The element it looks for, `[data-metric="fps"]`, is not in the document —
 * the string appears exactly once in the whole file, in the query that hunts
 * for it. So the guard hit on every frame the game has ever rendered, the
 * adaptive tier was never handed a sample, and the entire mobile quality
 * safety net was dead: DPR never dropped, no optional effect was ever shed,
 * and a struggling phone simply stayed struggling.
 *
 * A measurement the game acts on must never be reachable only through a
 * display. Rendering the number is optional; sampling it is not.
 */

export const FRAME_SAMPLE_WINDOW_MS = 250;

export function createFrameSampler({ windowMs = FRAME_SAMPLE_WINDOW_MS } = {}) {
  let lastSampleTime = null;
  let frames = 0;
  let value = 0;

  return {
    /** Most recent measured rate, 0 before the first window closes. */
    get value() { return value; },

    /**
     * Count a frame. Returns the frame rate when a window closes, else null.
     *
     * The first call only starts the clock: the interval between "the page
     * loaded" and "the first frame rendered" includes module imports and
     * world construction, and reporting that as the frame rate would trip an
     * immediate downshift on a machine that is actually fine.
     */
    sample(time) {
      if (!Number.isFinite(time)) return null;
      if (lastSampleTime === null) {
        lastSampleTime = time;
        frames = 0;
        return null;
      }
      frames += 1;
      const elapsed = time - lastSampleTime;
      if (elapsed < windowMs) return null;
      // A backwards or zero-length window would divide by zero and hand the
      // tier manager an Infinity, which reads as "wonderful, upshift".
      if (elapsed <= 0) {
        lastSampleTime = time;
        frames = 0;
        return null;
      }
      value = (frames / elapsed) * 1000;
      frames = 0;
      lastSampleTime = time;
      return value;
    },

    /**
     * Forget the current window. Call after a stall the frame rate should not
     * be blamed for — returning from a background tab, or a world rebuild on
     * an environment switch — so one long frame cannot trigger a downshift.
     */
    reset() {
      lastSampleTime = null;
      frames = 0;
    },
  };
}
