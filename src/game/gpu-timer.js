/**
 * GPU Timer Probe and Measurement Module
 *
 * Probes for EXT_disjoint_timer_query_webgl2 and manages a single GPU timing
 * query per frame. Handles context loss gracefully and distinguishes wiring bugs
 * from platform facts via a precisely diagnosable state machine.
 *
 * No imports, no DOM access — the GL context arrives via injected getContext().
 */

export const GPU_TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';

export const GPU_TIMER_CAPABILITY_STATES = [
  'ok',
  'no-context',
  'not-webgl2',
  'no-extension'
];

export const GPU_TIMER_STATES = [
  'ok',
  'no-context',
  'not-webgl2',
  'no-extension',
  'disjoint'
];

// Bounded sample ring capacity (zero-allocation principle)
export const GPU_SAMPLE_CAPACITY = 256;

// Provisional: frames to wait before abandoning a stuck query
export const GPU_QUERY_TIMEOUT_FRAMES = 120;

/**
 * Create a GPU timer instance.
 *
 * @param {object} opts
 * @param {() => WebGLRenderingContext | WebGL2RenderingContext | null} opts.getContext
 *   Injected callback that returns the current GL context (or null if lost/unavailable).
 * @returns {object} timer API
 */
export function createGpuTimer({ getContext }) {
  if (!getContext || typeof getContext !== 'function') {
    throw new TypeError('createGpuTimer requires a getContext function');
  }

  // ----- Capability Probe -----

  let probeState = null;  // { state: string, reason: string|null, available: boolean }

  function probeCapability() {
    // Always re-probe if context is lost, even if we cached a probe
    if (isContextLost()) {
      probeState = null;
    }

    // Probe only once per context unless it was lost
    if (probeState) {
      return probeState;
    }

    const gl = getContext();

    // Precedence: no-context > not-webgl2 > no-extension
    if (!gl) {
      probeState = { state: 'no-context', reason: 'no-context', available: false };
      return probeState;
    }

    // Check if the context is lost (happens after context loss)
    if (gl.isContextLost && typeof gl.isContextLost === 'function' && gl.isContextLost()) {
      probeState = { state: 'no-context', reason: 'no-context', available: false };
      return probeState;
    }

    // Check if WebGL2 (has query API)
    if (!gl.createQuery || !gl.deleteQuery || !gl.beginQuery || !gl.endQuery || !gl.getQueryParameter) {
      probeState = { state: 'not-webgl2', reason: 'not-webgl2', available: false };
      return probeState;
    }

    // Check for the extension (only after confirming WebGL2)
    const ext = gl.getExtension(GPU_TIMER_EXTENSION);
    if (!ext) {
      probeState = { state: 'no-extension', reason: 'no-extension', available: false };
      return probeState;
    }

    probeState = { state: 'ok', reason: null, available: true };
    return probeState;
  }

  // ----- Context Loss Handling -----

  function isContextLost() {
    const gl = getContext();
    if (!gl) return false;
    if (gl.isContextLost && typeof gl.isContextLost === 'function') {
      return gl.isContextLost();
    }
    return false;
  }

  // ----- Sample Ring (Zero-Allocation) -----

  const samples = new Array(GPU_SAMPLE_CAPACITY);
  let sampleHead = 0;
  let sampleCount = 0;

  // ----- Query State Machine -----

  let currentQuery = null;     // { obj, issuedFrame } or null
  let lastReading = null;      // last accepted result in ms
  let lastReadingWasDisjoint = false;  // track if we need to report disjoint

  // Counters
  let totalCreated = 0;
  let totalDeleted = 0;
  let totalAccepted = 0;
  let totalDiscarded = 0;

  function isQueryInFlight() {
    return currentQuery !== null && currentQuery.issuedFrame !== null;
  }

  function deleteQueryIfExists() {
    if (!currentQuery) return;

    const gl = getContext();
    if (gl && currentQuery.obj) {
      try {
        gl.deleteQuery(currentQuery.obj);
        totalDeleted += 1;
      } catch (e) {
        // fail silently; context might be lost
      }
    }

    currentQuery = null;
  }

  // ----- Frame Lifecycle -----

  function beginFrame(frameId) {
    const gl = getContext();
    if (!gl || isContextLost()) return;

    const cap = probeCapability();
    if (cap.state !== 'ok') return;

    // If we have a pending query from a previous frame, don't issue a new one
    if (currentQuery && currentQuery.issuedFrame !== null) {
      return;
    }

    // currentQuery should be null at this point (either never existed or was deleted by poll)
    if (currentQuery) {
      return;  // shouldn't happen, but be safe
    }

    // Create a new query
    try {
      const qobj = gl.createQuery();
      if (!qobj) return;

      currentQuery = { obj: qobj, issuedFrame: frameId };
      totalCreated += 1;

      const ext = gl.getExtension(GPU_TIMER_EXTENSION);
      gl.beginQuery(ext.TIME_ELAPSED_EXT, currentQuery.obj);
    } catch (e) {
      currentQuery = null;
    }
  }

  function endFrame(frameId) {
    if (!currentQuery || currentQuery.issuedFrame === null) return;
    // beginFrame() skips issuing a new query while a previous frame's query
    // is still pending readback — deliberately, so two queries never overlap
    // — but that means `currentQuery` can belong to an EARLIER frame than
    // this one. Found live (not in this module's own fake-GL suite, whose
    // every call sequence happens to poll a frame's query away before the
    // next begin/end pair runs): on a real GL context, `gl.endQuery()` on a
    // query beginFrame() did not begin THIS frame is `INVALID_OPERATION:
    // endQuery: target query is not active` — the driver already ended it
    // on the frame that actually began it. Only end a query this exact
    // frameId began.
    if (currentQuery.issuedFrame !== frameId) return;

    const gl = getContext();
    if (!gl || isContextLost()) return;

    try {
      const ext = gl.getExtension(GPU_TIMER_EXTENSION);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
    } catch (e) {
      deleteQueryIfExists();
    }
  }

  function poll(frameId) {
    if (!currentQuery || currentQuery.issuedFrame === null) return;

    const gl = getContext();
    if (!gl || isContextLost()) {
      deleteQueryIfExists();
      return;
    }

    // Never read on the frame we issued it (mechanical deferral)
    if (currentQuery.issuedFrame === frameId) {
      return;
    }

    // Check timeout
    const framesSinceIssue = frameId - currentQuery.issuedFrame;
    if (framesSinceIssue >= GPU_QUERY_TIMEOUT_FRAMES) {
      // Stuck query — abandon it
      deleteQueryIfExists();
      return;
    }

    try {
      const ext = gl.getExtension(GPU_TIMER_EXTENSION);
      if (!ext) return;

      const available = gl.getQueryParameter(currentQuery.obj, gl.QUERY_RESULT_AVAILABLE);
      if (!available) return;

      // Read the result (nanoseconds)
      const resultNs = gl.getQueryParameter(currentQuery.obj, gl.QUERY_RESULT);
      if (resultNs === null || resultNs === undefined) return;

      // Check disjoint flag
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);

      if (disjoint) {
        // Discard the result
        lastReadingWasDisjoint = true;
        totalDiscarded += 1;
      } else {
        // Convert ns to ms and store
        const resultMs = resultNs / 1e6;
        lastReading = resultMs;
        lastReadingWasDisjoint = false;

        // Add to sample ring
        samples[sampleHead] = resultMs;
        sampleHead = (sampleHead + 1) % GPU_SAMPLE_CAPACITY;
        if (sampleCount < GPU_SAMPLE_CAPACITY) {
          sampleCount += 1;
        }

        totalAccepted += 1;
      }

      // Delete the query after reading it
      deleteQueryIfExists();
    } catch (e) {
      // Clean up on error
      deleteQueryIfExists();
    }
  }

  // ----- API -----

  return {
    capability() {
      return probeCapability();
    },

    beginFrame,
    endFrame,
    poll,

    read() {
      const cap = probeCapability();

      // If probe failed, report that reason
      if (cap.state !== 'ok') {
        return {
          value: null,
          state: 'unavailable',
          reason: cap.reason
        };
      }

      // If the last result was disjoint, report that
      if (lastReadingWasDisjoint) {
        return {
          value: null,
          state: 'unavailable',
          reason: 'disjoint'
        };
      }

      // If we have a reading, return it
      if (lastReading !== null) {
        return {
          value: lastReading,
          state: 'ok',
          reason: null
        };
      }

      // Probe is ok but no data yet
      return {
        value: null,
        state: 'unavailable',
        reason: 'insufficient-samples'
      };
    },

    meanMs() {
      const cap = probeCapability();

      if (cap.state !== 'ok') {
        return {
          value: null,
          state: 'unavailable',
          reason: cap.reason
        };
      }

      if (sampleCount === 0) {
        return {
          value: null,
          state: 'unavailable',
          reason: 'insufficient-samples'
        };
      }

      let sum = 0;
      for (let i = 0; i < sampleCount; i += 1) {
        sum += samples[i];
      }
      const mean = sum / sampleCount;

      return {
        value: mean,
        state: 'ok',
        reason: null
      };
    },

    counters() {
      return {
        created: totalCreated,
        deleted: totalDeleted,
        inFlight: isQueryInFlight() ? 1 : 0,
        accepted: totalAccepted,
        discarded: totalDiscarded
      };
    },

    onContextLost() {
      // Release the outstanding query
      deleteQueryIfExists();
      // Force re-probe on next capability check
      probeState = null;
    },

    onContextRestored() {
      // Force re-probe on the new context, and probe immediately
      probeState = null;
      probeCapability();
    },

    dispose() {
      deleteQueryIfExists();
    },

    __buffers() {
      return {
        samples: samples.slice(0, sampleCount)
      };
    }
  };
}
