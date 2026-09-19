/**
 * quality-assertions.mjs — the A1–A12 assertion IMPLEMENTATIONS.
 *
 * Wave 1 / task P1.2 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4.
 * Authority: docs/perf/CONTRACT.md §4 (the assertion table, verbatim),
 * §3.1 (the sentinel protocol), §5 (harness context), §6 (the production-path
 * ruling), §7 (precedence). Companion documents:
 *   docs/perf/ASSERTIONS.md    — the table, the snapshot contract, the gaps
 *   docs/perf/EXPECTED-RED.md  — what A6 must report failing on HEAD today
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND THE ONE RULE FOR ANYONE EDITING IT
 * ---------------------------------------------------------------------------
 * The harness author (P1.3, sonnet) TRANSCRIBES these; they do not decide a
 * comparator direction. Every `>` `<` `===` below was chosen against a measured
 * capture of the real page (the measurements are in ASSERTIONS.md §2 and
 * EXPECTED-RED.md §3), not against a reading of the source. If one of these
 * looks wrong to you, say so in your report — do not change it. Changing a
 * comparator here is a gate decision (CONTRACT.md amendment rule).
 *
 * ---------------------------------------------------------------------------
 * DESIGN: PURE FUNCTIONS OVER A SNAPSHOT
 * ---------------------------------------------------------------------------
 * This module imports NOTHING. Not three, not node builtins, not the page.
 * Two consequences, both deliberate:
 *   1. it runs under `node --test` against the hand-written three stub tracked
 *      at node_modules/three/index.js, with no install step (CONTRACT §11);
 *   2. every assertion can be flipped by mutating a plain object, which is what
 *      makes G1's positive control cheap enough to run on all twelve rows.
 * Everything that touches a browser lives in tools/birb-quality.mjs.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR STATES, AND THE ONE THAT MATTERS
 * ---------------------------------------------------------------------------
 *   pass         the assertion was evaluated and held
 *   fail         the assertion was evaluated and did not hold
 *   unavailable  it could NOT be evaluated — a source named in CONTRACT §3.2
 *                does not exist yet. Carries a reason from the closed enum.
 *   invalid      the RUN was set up wrongly (A1 on a ?debug page, A6 truncated
 *                to two steps, A5 comparing two different tiers). This is a
 *                harness defect, not a product defect, and it must be as loud
 *                as a failure.
 *
 * `unavailable` is the whole point. A silent `pass` for a thing that does not
 * exist is how this repo shipped a world whose nesting and collectibles systems
 * were never created behind a screenshot that looked perfect. No function below
 * can return `pass` without having read the value it is asserting about.
 *
 * Harness exit-code mapping (transcribe this too):
 *   any `fail` or `invalid`            -> exit 1
 *   no fail/invalid, any `unavailable` -> exit 2   (skipped, never silent)
 *   all `pass`                         -> exit 0
 */

export const ASSERTION_STATES = /** @type {const} */ (['pass', 'fail', 'unavailable', 'invalid']);

/**
 * CONTRACT.md §3.1, verbatim and closed. A wiring bug must be distinguishable
 * from a platform fact, which is the only reason this is an enum and not a
 * free-text string.
 */
export const UNAVAILABLE_REASONS = /** @type {const} */ ([
  'not-implemented',
  'no-extension',
  'no-context',
  'disjoint',
  'insufficient-samples',
  'paused',
  'not-applicable',
  'stale',
]);

/** Float slack for pixel-ratio comparisons. Ratios are products of 0.05 steps
 *  and a device scale factor, so exact === is wrong; 1e-9 is far tighter than
 *  any real desync (the live one is 1.7 vs 0.85) and far looser than float
 *  noise. Dimensions are integers and are compared exactly. */
export const RATIO_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Transcribed source-of-truth arithmetic
// ---------------------------------------------------------------------------

/**
 * TRANSCRIPTION of `getQualityPixelRatio` from src/environment/visual-style.js.
 *
 * It is copied rather than imported because visual-style.js imports three, and
 * a module that imports three cannot run under this repo's tracked stub. The
 * copy is pinned by tests/quality-assertions.test.js, which reads the real file
 * as TEXT and asserts the return expression is still character-for-character
 * this one. A transcription nobody re-checks is a fabricated constant with a
 * citation attached.
 */
export function getQualityPixelRatio(devicePixelRatio, cap, tier) {
  return Math.min(devicePixelRatio || 1, tier >= 2 ? 0.85 : tier === 1 ? 1 : cap);
}

/** The exact source text the pin test looks for. Keep the two in step. */
export const QUALITY_PIXEL_RATIO_SOURCE =
  'return Math.min(devicePixelRatio || 1, tier >= 2 ? 0.85 : tier === 1 ? 1 : cap);';

/**
 * What every buffer's LIVE dimensions must be for a given CSS size and pixel
 * ratio. Two transcriptions, both measured against the running page:
 *
 *   THREE.WebGLRenderer.setSize:  drawingBuffer = Math.floor(css * pixelRatio)
 *   bloom-pass.js setSize (:316): scene = max(1, floor(css * ratio))
 *                                 blur  = max(1, floor(scene / downscale))
 *
 * Confirmed numerically on the page at 390x844 @ dsf 3, DPR_CAP 1.7:
 *   tier 0 (1.70): drawingBuffer 663x1434, scene 663x1434, blur 331x717
 *   tier 2 (0.85): drawingBuffer 331x717
 * and at 360x780:
 *   tier 2 (0.85): drawingBuffer 306x663,  scene 306x663,  blur 153x331
 *   tier 0 (1.70): drawingBuffer 612x1326, scene 612x1326, blur 306x663
 * (see EXPECTED-RED.md §3 for the full capture.)
 *
 * NOTE the blur derivation takes the EXPECTED scene size, not the observed one.
 * That difference is the whole distinction between A4 and A6: on HEAD after a
 * restore, blurA is exactly floor(observedScene/2) — internally consistent, and
 * half the resolution it should be. A4 passes on that frame. A6 must not.
 */
export function expectedTargetSizes({ cssWidth, cssHeight, pixelRatio, downscale }) {
  const w = Math.max(1, Math.floor(cssWidth * pixelRatio));
  const h = Math.max(1, Math.floor(cssHeight * pixelRatio));
  const d = downscale > 0 ? downscale : 1;
  const bw = Math.max(1, Math.floor(w / d));
  const bh = Math.max(1, Math.floor(h / d));
  return {
    drawingBufferWidth: Math.floor(cssWidth * pixelRatio),
    drawingBufferHeight: Math.floor(cssHeight * pixelRatio),
    sceneTarget: { width: w, height: h },
    blurA: { width: bw, height: bh },
    blurB: { width: bw, height: bh },
    rayTarget: { width: bw, height: bh },
  };
}

/**
 * CONTRACT §4.1, read off src/effects/bloom-pass.js render() and CONFIRMED on
 * the page (probe: 8 passes with the sun on screen and uRays 1; the frame after
 * setBloom({rays:0}) reported 6; every frame after that reported 5).
 */
export const PASS_COUNTS = Object.freeze({
  raysOn: 8,
  raysOff: 5,
  raysClearingFrame: 6,   // the SINGLE transitional frame; A9 skips exactly one
  noPost: 1,              // tier >= 1: presentFrame() takes the no-post branch
});

export const RAYS_ON_EPSILON = 0.001;   // bloom-pass.js:428-429, verbatim

/** raysOn per CONTRACT §4.1: uRays > 0.001 && uVisible > 0.001. */
export function computeRaysOn(raysStrength, sunVisible) {
  if (!Number.isFinite(raysStrength) || !Number.isFinite(sunVisible)) return null;
  return raysStrength > RAYS_ON_EPSILON && sunVisible > RAYS_ON_EPSILON;
}

// ---------------------------------------------------------------------------
// Verdict constructors
// ---------------------------------------------------------------------------

function verdict(id, ok, actual, expected, message, extra = {}) {
  return {
    id,
    state: ok ? 'pass' : 'fail',
    pass: !!ok,
    actual,
    expected,
    message,
    ...extra,
  };
}

/** A source named in CONTRACT §3.2 does not exist yet. NEVER a pass. */
function unavailable(id, reason, message, extra = {}) {
  if (!UNAVAILABLE_REASONS.includes(reason)) {
    // A reason outside the closed enum is itself a contract violation, and
    // silently accepting it would reopen exactly the hole the enum closes.
    return {
      id,
      state: 'invalid',
      pass: false,
      actual: reason,
      expected: `one of ${UNAVAILABLE_REASONS.join(' | ')}`,
      message: `${id}: unavailable reason "${reason}" is not in the CONTRACT §3.1 closed enum`,
    };
  }
  return { id, state: 'unavailable', pass: null, actual: null, expected: null, reason, message, ...extra };
}

/** The RUN was constructed wrongly. As loud as a failure, on purpose. */
function invalid(id, message, extra = {}) {
  return { id, state: 'invalid', pass: false, actual: null, expected: null, message, ...extra };
}

function has(v) { return v !== undefined && v !== null; }

function ratioEq(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= RATIO_EPSILON;
}

// ---------------------------------------------------------------------------
// A1 — the gesture opens the panel on a page loaded WITHOUT ?debug
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A1 / §6 ruling 4.
 *
 * The failure mode this rejects is the expensive one and it passes every naive
 * check: register the gesture inside `if (params.has('debug'))`, and every
 * harness in this repo — all of which load with ?debug=1 — reports it working,
 * while a phone at https://birbmobile.vercel.app can never open it. So a run of
 * A1 on a ?debug page is not a weaker result, it is NO result, and it returns
 * `invalid` rather than `unavailable`: an unavailable row is a thing to come
 * back to, an invalid row is a harness that must be fixed before it is trusted.
 */
export function assertA1(snapshot = {}) {
  const id = 'A1';
  const { debugParamPresent, panel, gesture } = snapshot;
  if (debugParamPresent !== false) {
    return invalid(id, `${id}: evaluated on a page loaded WITH ?debug (or the flag was not recorded). ` +
      'CONTRACT §6.4 rejects this run — A1 only means anything on the production path.',
      { actual: { debugParamPresent }, expected: { debugParamPresent: false } });
  }
  if (!has(panel) || panel.present !== true) {
    return unavailable(id, 'not-implemented',
      `${id}: src/ui/dev-quality-panel.js has not shipped — there is no panel to open. ` +
      'Reporting a pass here would certify the production path on the strength of its absence.');
  }
  if (!has(gesture) || gesture.performed !== 'three-finger-hold-release') {
    return unavailable(id, 'not-applicable',
      `${id}: no three-finger hold-and-release was synthesised on this run.`);
  }
  const opened = panel.openedAfterGesture === true;
  return verdict(id, opened,
    { panelOpenedAfterThreeFingerHoldRelease: opened, debugParamPresent },
    { panelOpenedAfterThreeFingerHoldRelease: true, debugParamPresent: false },
    opened
      ? 'A1: three-finger hold-and-release opened the panel on a page with no ?debug flag.'
      : 'A1: the three-finger gesture did NOT open the panel on the production path.');
}

// ---------------------------------------------------------------------------
// A2 — a two-finger touch must NOT open the panel (the sprint gesture survives)
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A2 (pinned by the wave script; reproduced unaltered).
 *
 * TWO independent claims, and the trap is that the first is vacuously true
 * whenever the panel does not exist. "Two fingers did not open the panel" is
 * satisfied perfectly by a repo with no panel in it, so this returns
 * `unavailable` until src/ui/dev-quality-panel.js is on disk. That guard is
 * here, in the assertion, rather than only in the harness, because the harness
 * is the thing most likely to be rewritten by a cheap agent.
 *
 * The second claim — the sprint still engages — is the one with teeth: three
 * fingers is chosen precisely because two is already taken (index.html:7538,
 * `touchCount >= 2 && !currentlyNested && isSprintMode`), so a gesture
 * implemented by counting "2 or more" would break boost while passing every
 * panel-shaped check.
 */
export function assertA2(snapshot = {}) {
  const id = 'A2';
  const { panel, gesture, sprintActive } = snapshot;
  if (!has(panel) || panel.present !== true) {
    return unavailable(id, 'not-implemented',
      `${id}: no panel exists yet, so "two fingers did not open it" is vacuous. ` +
      'This is the false pass the whole wave is built to prevent.');
  }
  if (!has(gesture) || gesture.performed !== 'two-finger-hold') {
    return unavailable(id, 'not-applicable',
      `${id}: no two-finger sequence was synthesised on this run.`);
  }
  if (!has(sprintActive)) {
    return unavailable(id, 'not-implemented',
      `${id}: sprintState.active has no reader on __BIRB (see ASSERTIONS.md §5, GAP-A2). ` +
      'Half of A2 is unreadable, so A2 as a whole is unreadable.');
  }
  const panelStayedClosed = panel.openedAfterGesture === false;
  const sprintSurvived = sprintActive === true;
  const ok = panelStayedClosed && sprintSurvived;
  return verdict(id, ok,
    { panelOpenedAfterTwoFingerTouch: panel.openedAfterGesture, sprintActive },
    { panelOpenedAfterTwoFingerTouch: false, sprintActive: true },
    ok
      ? 'A2: two fingers left the panel closed and the sprint engaged.'
      : `A2: ${!panelStayedClosed ? 'two fingers OPENED the panel. ' : ''}` +
        `${!sprintSurvived ? 'the two-finger sprint did not engage — the gesture ate it.' : ''}`.trim(),
    { parts: { panelStayedClosed, sprintSurvived } });
}

// ---------------------------------------------------------------------------
// A3 — the DPR control moves real pixels
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A3. Rejects a control wired to a label variable: the number on
 * screen changes, `renderer.getPixelRatio()` agrees with it, and the drawing
 * buffer never moves. Both halves are required, and the drawing-buffer half is
 * the one that cannot be faked by writing the request back to yourself.
 *
 * Depends on SC-DPR having passed (CONTRACT §5.2): at deviceScaleFactor 1 the
 * tier-0 and tier-1 ratios are both 1.0 and this assertion is dead rather than
 * false. The harness must have exited 1 before reaching here.
 */
export function assertA3(snapshot = {}) {
  const id = 'A3';
  const { before, after, requestedDpr, selfCheckDprPassed } = snapshot;
  if (selfCheckDprPassed === false) {
    return invalid(id, `${id}: SC-DPR failed for this context — the DPR discriminator is dead ` +
      '(CONTRACT §5.2). The harness should have exited 1 rather than evaluating A3.');
  }
  if (!has(before?.effective) || !has(after?.effective)) {
    return unavailable(id, 'not-implemented',
      `${id}: no DPR control exists yet, so there is no before/after pair to read.`);
  }
  if (!Number.isFinite(requestedDpr)) {
    return unavailable(id, 'not-applicable', `${id}: no requested DPR was recorded for this run.`);
  }
  const bufferMoved = after.effective.drawingBufferWidth !== before.effective.drawingBufferWidth;
  const ratioHonoured = ratioEq(after.effective.rendererPixelRatio, requestedDpr);
  const ok = bufferMoved && ratioHonoured;
  return verdict(id, ok,
    {
      drawingBufferWidth: { before: before.effective.drawingBufferWidth, after: after.effective.drawingBufferWidth },
      rendererPixelRatio: after.effective.rendererPixelRatio,
    },
    { drawingBufferWidth: 'changed', rendererPixelRatio: requestedDpr },
    ok
      ? 'A3: the DPR control moved the drawing buffer and the renderer honoured the request.'
      : `A3: ${!bufferMoved ? 'the drawing buffer did not change — the control is a label. ' : ''}` +
        `${!ratioHonoured ? `renderer.getPixelRatio() is ${after.effective.rendererPixelRatio}, requested ${requestedDpr}.` : ''}`.trim(),
    { parts: { bufferMoved, ratioHonoured } });
}

// ---------------------------------------------------------------------------
// A4 — the post targets are internally consistent
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A4. Catches a `downscale` changed without re-running setSize.
 *
 * IT CANNOT CATCH THE DESYNC A6 IS FOR, and that is worth stating loudly
 * because the two look like the same check. Measured on HEAD after the
 * resize-restore sequence: sceneTarget 306x663, blurA 153x331. A4 passes —
 * 153 === floor(306/2) — on a frame where the whole post chain is at half the
 * resolution the renderer is drawing. A4 is a relative check; A6 is absolute.
 */
export function assertA4(snapshot = {}) {
  const id = 'A4';
  const bloom = snapshot.effective?.bloom;
  if (!has(bloom)) {
    return unavailable(id, 'not-applicable',
      `${id}: no bloom pass on this run (effective().bloom is null) — nothing to size.`);
  }
  const d = bloom.downscale > 0 ? bloom.downscale : 1;
  const expW = Math.max(1, Math.floor(bloom.sceneTarget.width / d));
  const expH = Math.max(1, Math.floor(bloom.sceneTarget.height / d));
  const names = ['blurA', 'blurB', 'rayTarget'];
  const fields = names.map((n) => ({
    field: n,
    actual: { width: bloom[n].width, height: bloom[n].height },
    expected: { width: expW, height: expH },
    ok: bloom[n].width === expW && bloom[n].height === expH,
  }));
  const ok = fields.every((f) => f.ok);
  return verdict(id, ok,
    Object.fromEntries(fields.map((f) => [f.field, f.actual])),
    { blurA: { width: expW, height: expH }, blurB: { width: expW, height: expH }, rayTarget: { width: expW, height: expH } },
    ok
      ? `A4: blurA/blurB/rayTarget are all ${expW}x${expH} = sceneTarget / ${d}.`
      : `A4: ${fields.filter((f) => !f.ok).map((f) => f.field).join(', ')} do not equal floor(sceneTarget/${d}).`,
    { fields });
}

// ---------------------------------------------------------------------------
// A5 — weather density 0 skips a draw, it does not just zero a uniform
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A5. A uniform set to zero still rasterises every point and still
 * costs a draw call; only `points.visible = false` removes the work. So the
 * draw-call half is what makes this an assertion about rendering rather than
 * about a number.
 *
 * ON HEAD THIS IS `invalid`, NOT `pass`, WHENEVER THE TWO SAMPLES CAME FROM
 * DIFFERENT TIERS. Weather density is written per frame from the tier
 * (index.html:8391-8395, routing register T5/T6), so the only way to reach
 * density 0 today is to change the tier — which also drops the contact shadow
 * and the ribbons. Measured: tier 1 -> tier 2 took scene calls 87 -> 85, and
 * the weather points are only one of those two. Crediting that difference to
 * the density control is the confound CONTRACT §4.2 exists to forbid.
 */
export function assertA5(snapshot = {}) {
  const id = 'A5';
  const { densityOne, densityZero } = snapshot;
  if (!has(densityOne?.weather) || !has(densityZero?.weather)) {
    return unavailable(id, 'not-implemented',
      `${id}: no weather-density control independent of the tier exists yet (routing register T5/T6).`);
  }
  if (densityOne.tier !== densityZero.tier) {
    return invalid(id, `${id}: the two samples were taken at tier ${densityOne.tier} and tier ` +
      `${densityZero.tier}. A tier change also moves the contact shadow and the ribbons, so the ` +
      'draw-call delta is not attributable to weather density (CONTRACT §4.2).',
      { actual: { tierOne: densityOne.tier, tierZero: densityZero.tier } });
  }
  const hidden = densityZero.weather.visible === false;
  const callsDropped = densityZero.frameTotals.scene.calls < densityOne.frameTotals.scene.calls;
  const ok = hidden && callsDropped;
  return verdict(id, ok,
    { visibleAtZero: densityZero.weather.visible, sceneCalls: { one: densityOne.frameTotals.scene.calls, zero: densityZero.frameTotals.scene.calls } },
    { visibleAtZero: false, sceneCalls: 'zero < one' },
    ok
      ? 'A5: density 0 hid the points and the scene draw count fell.'
      : `A5: ${!hidden ? 'weather.points.visible is still true at density 0 — a uniform is not a skipped draw. ' : ''}` +
        `${!callsDropped ? 'scene draw calls did not fall.' : ''}`.trim(),
    { parts: { hidden, callsDropped } });
}

// ---------------------------------------------------------------------------
// A6 — BUFFER COHERENCE. The reason this programme exists.
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A6 (pinned by the wave script; reproduced unaltered):
 * after tier0 -> degrade -> resize WHILE DEGRADED -> restore, every render
 * target's LIVE dimensions equal what the restored tier requests.
 *
 * MUST FAIL ON HEAD. docs/perf/EXPECTED-RED.md is the field-by-field manifest
 * of that failure, and EXPECTED_RED_HEAD below is the machine-readable form of
 * the same thing, so "matches field for field" is a diff rather than a reading.
 * If this passes on HEAD it is the wrong check and Wave 1 has failed.
 *
 * WHY ALL FOUR STEPS. `applyTier` (index.html:6523-6529) calls
 * `renderer.setPixelRatio` and nothing else — not `resizeState`, not
 * `bloomPass.setSize`, not `weather.setPixelRatio`. So a degrade alone already
 * desyncs (step 2). But step 3, an ordinary resize, runs `updateRendererSize`,
 * which re-sizes EVERYTHING at the degraded ratio — it HEALS step 2's damage.
 * A check truncated at step 2 is therefore red today for the right reason and
 * turns green forever the instant the sizing fix lands, catching nothing after
 * that. The permanent mismatch is step 4: restore raises the renderer to 1.7
 * while every offscreen target stays at the 0.85 sizes step 3 baked in, and
 * measurement showed it still there two seconds and ten frames later.
 *
 * So: fewer than four steps is `invalid`, not a partial pass.
 */
export const A6_REQUIRED_STEPS = /** @type {const} */ ([
  'tier0',
  'degraded',
  'resizedWhileDegraded',
  'restored',
]);

export function assertA6(snapshot = {}) {
  const id = 'A6';
  const steps = snapshot.steps;
  if (!Array.isArray(steps)) {
    return unavailable(id, 'not-applicable', `${id}: no step sequence was captured.`);
  }
  const ids = steps.map((s) => s?.id);
  const missing = A6_REQUIRED_STEPS.filter((s) => !ids.includes(s));
  if (missing.length) {
    return invalid(id, `${id}: the sequence is missing step(s) ${missing.join(', ')}. ` +
      'A truncated resize-restore check is red today for the right reason and green forever ' +
      'after the sizing fix. All four steps or nothing.',
      { actual: { steps: ids }, expected: { steps: [...A6_REQUIRED_STEPS] } });
  }
  if (ids.slice(0, 4).join(',') !== A6_REQUIRED_STEPS.join(',')) {
    return invalid(id, `${id}: the steps ran out of order (${ids.join(' -> ')}). ` +
      'The resize must happen WHILE DEGRADED; a resize after the restore heals the desync instead of exposing it.',
      { actual: { steps: ids }, expected: { steps: [...A6_REQUIRED_STEPS] } });
  }
  // The labels are not taken on trust. A step named `resizedWhileDegraded` that
  // carries the same CSS size as the step before it did not resize anything,
  // and a run whose resize actually landed after the restore would still hand
  // over four correctly-named steps. So the shape of the sequence is checked
  // against the data: the CSS size must change EXACTLY ONCE, between step 2 and
  // step 3, and the tier must go down at step 2 and back at step 4.
  const [s1, s2, s3, s4] = A6_REQUIRED_STEPS.map((n) => steps.find((s) => s.id === n));
  const sameSize = (a, b) => a?.cssWidth === b?.cssWidth && a?.cssHeight === b?.cssHeight;
  if (!sameSize(s1, s2)) {
    return invalid(id, `${id}: the canvas resized between tier0 and degraded ` +
      `(${s1?.cssWidth}x${s1?.cssHeight} -> ${s2?.cssWidth}x${s2?.cssHeight}). ` +
      'That resize re-runs updateRendererSize and heals the very desync step 2 is meant to expose.');
  }
  if (sameSize(s2, s3)) {
    return invalid(id, `${id}: step 3 is named resizedWhileDegraded but the canvas is still ` +
      `${s3?.cssWidth}x${s3?.cssHeight}. No resize happened while degraded, so the sequence never ` +
      'reached the state that makes the restore mismatch permanent.');
  }
  if (!sameSize(s3, s4)) {
    return invalid(id, `${id}: the canvas resized again at the restore ` +
      `(${s3?.cssWidth}x${s3?.cssHeight} -> ${s4?.cssWidth}x${s4?.cssHeight}). ` +
      'A resize after the restore re-sizes every target and hides the desync — this is the ' +
      'reordering that turns the check green while nothing has been fixed.');
  }
  if (!(s2.requestedTier > s1.requestedTier) || s3.requestedTier !== s2.requestedTier
      || s4.requestedTier !== s1.requestedTier) {
    return invalid(id, `${id}: the tier sequence is ${[s1, s2, s3, s4].map((s) => s.requestedTier).join(' -> ')}. ` +
      'It must degrade at step 2, hold that tier across the resize, and return to the opening tier at step 4.');
  }
  const cap = snapshot.context?.dprCap;
  const dpr = snapshot.context?.devicePixelRatio;
  if (!Number.isFinite(cap) || !Number.isFinite(dpr)) {
    return unavailable(id, 'not-applicable',
      `${id}: context.dprCap / context.devicePixelRatio were not recorded, so the requested ratio cannot be derived.`);
  }

  const stepResults = A6_REQUIRED_STEPS.map((wanted) => {
    const step = steps.find((s) => s.id === wanted);
    const eff = step?.effective;
    if (!has(eff) || !has(eff.bloom)) {
      return { step: wanted, evaluated: false, fields: [], note: 'effective()/bloom not captured' };
    }
    const requested = Number.isFinite(step.requestedPixelRatio)
      ? step.requestedPixelRatio
      : getQualityPixelRatio(dpr, cap, step.requestedTier);
    const exp = expectedTargetSizes({
      cssWidth: step.cssWidth,
      cssHeight: step.cssHeight,
      pixelRatio: requested,
      downscale: eff.bloom.downscale,
    });
    const fields = [
      { field: 'rendererPixelRatio', actual: eff.rendererPixelRatio, expected: requested, ok: ratioEq(eff.rendererPixelRatio, requested) },
      { field: 'drawingBufferWidth', actual: eff.drawingBufferWidth, expected: exp.drawingBufferWidth, ok: eff.drawingBufferWidth === exp.drawingBufferWidth },
      { field: 'drawingBufferHeight', actual: eff.drawingBufferHeight, expected: exp.drawingBufferHeight, ok: eff.drawingBufferHeight === exp.drawingBufferHeight },
      { field: 'bloom.sceneTarget.width', actual: eff.bloom.sceneTarget.width, expected: exp.sceneTarget.width, ok: eff.bloom.sceneTarget.width === exp.sceneTarget.width },
      { field: 'bloom.sceneTarget.height', actual: eff.bloom.sceneTarget.height, expected: exp.sceneTarget.height, ok: eff.bloom.sceneTarget.height === exp.sceneTarget.height },
      { field: 'bloom.blurA.width', actual: eff.bloom.blurA.width, expected: exp.blurA.width, ok: eff.bloom.blurA.width === exp.blurA.width },
      { field: 'bloom.blurA.height', actual: eff.bloom.blurA.height, expected: exp.blurA.height, ok: eff.bloom.blurA.height === exp.blurA.height },
      { field: 'bloom.blurB.width', actual: eff.bloom.blurB.width, expected: exp.blurB.width, ok: eff.bloom.blurB.width === exp.blurB.width },
      { field: 'bloom.blurB.height', actual: eff.bloom.blurB.height, expected: exp.blurB.height, ok: eff.bloom.blurB.height === exp.blurB.height },
      { field: 'bloom.rayTarget.width', actual: eff.bloom.rayTarget.width, expected: exp.rayTarget.width, ok: eff.bloom.rayTarget.width === exp.rayTarget.width },
      { field: 'bloom.rayTarget.height', actual: eff.bloom.rayTarget.height, expected: exp.rayTarget.height, ok: eff.bloom.rayTarget.height === exp.rayTarget.height },
      { field: 'weatherPixelRatio', actual: eff.weatherPixelRatio, expected: requested, ok: ratioEq(eff.weatherPixelRatio, requested) },
      { field: 'resizeStatePixelRatio', actual: eff.resizeStatePixelRatio, expected: requested, ok: ratioEq(eff.resizeStatePixelRatio, requested) },
    ];
    return {
      step: wanted,
      evaluated: true,
      requestedPixelRatio: requested,
      cssWidth: step.cssWidth,
      cssHeight: step.cssHeight,
      fields,
      mismatches: fields.filter((f) => !f.ok).map((f) => f.field),
      coherent: fields.every((f) => f.ok),
    };
  });

  const unevaluated = stepResults.filter((s) => !s.evaluated);
  if (unevaluated.length) {
    return unavailable(id, 'not-applicable',
      `${id}: ${unevaluated.map((s) => s.step).join(', ')} carried no effective() reading.`,
      { steps: stepResults });
  }

  const ok = stepResults.every((s) => s.coherent);
  const restored = stepResults.find((s) => s.step === 'restored');
  return verdict(id, ok,
    Object.fromEntries(stepResults.map((s) => [s.step, s.mismatches])),
    Object.fromEntries(A6_REQUIRED_STEPS.map((s) => [s, []])),
    ok
      ? 'A6: every render target agreed with the requested pixel ratio at all four steps.'
      : `A6: buffer desync. ${stepResults.filter((s) => !s.coherent).map((s) => `${s.step}: ${s.mismatches.join(', ')}`).join(' | ')}`,
    { steps: stepResults, restoredCoherent: restored.coherent });
}

/**
 * The machine-readable half of docs/perf/EXPECTED-RED.md.
 *
 * `--check resize-restore` on HEAD, at the pinned harness context
 * (390x844, deviceScaleFactor 3, isMobile true => DPR_CAP 1.7), resizing to
 * 360x780 at step 3. Every number here was captured from the running page, not
 * derived; the capture is pasted in EXPECTED-RED.md §3.
 *
 * G1's job is a diff against this, and specifically: `restored` MUST be in the
 * incoherent list. A run where only `degraded` fails is a truncated check.
 */
export const EXPECTED_RED_HEAD = Object.freeze({
  assertion: 'A6',
  state: 'fail',
  context: Object.freeze({ cssWidth: 390, cssHeight: 844, resizedTo: [360, 780], deviceScaleFactor: 3, dprCap: 1.7 }),
  steps: Object.freeze({
    tier0: Object.freeze({ requestedPixelRatio: 1.7, coherent: true, mismatches: Object.freeze([]) }),
    degraded: Object.freeze({
      requestedPixelRatio: 0.85,
      coherent: false,
      mismatches: Object.freeze([
        'bloom.sceneTarget.width', 'bloom.sceneTarget.height',
        'bloom.blurA.width', 'bloom.blurA.height',
        'bloom.blurB.width', 'bloom.blurB.height',
        'bloom.rayTarget.width', 'bloom.rayTarget.height',
        'weatherPixelRatio', 'resizeStatePixelRatio',
      ]),
    }),
    resizedWhileDegraded: Object.freeze({ requestedPixelRatio: 0.85, coherent: true, mismatches: Object.freeze([]) }),
    restored: Object.freeze({
      requestedPixelRatio: 1.7,
      coherent: false,
      mismatches: Object.freeze([
        'bloom.sceneTarget.width', 'bloom.sceneTarget.height',
        'bloom.blurA.width', 'bloom.blurA.height',
        'bloom.blurB.width', 'bloom.blurB.height',
        'bloom.rayTarget.width', 'bloom.rayTarget.height',
        'weatherPixelRatio', 'resizeStatePixelRatio',
      ]),
    }),
  }),
  /** The one that must never be dropped: step 4 is the permanent mismatch. */
  loadBearingStep: 'restored',
});

/**
 * Compare an A6 verdict against EXPECTED_RED_HEAD field for field.
 * Returns { matches, differences[] }. Used by --check resize-restore and by G1.
 */
export function matchesExpectedRed(a6Verdict, manifest = EXPECTED_RED_HEAD) {
  const differences = [];
  if (a6Verdict?.state !== manifest.state) {
    differences.push(`state: got ${a6Verdict?.state}, manifest says ${manifest.state}`);
  }
  const got = new Map((a6Verdict?.steps ?? []).map((s) => [s.step, s]));
  for (const [name, want] of Object.entries(manifest.steps)) {
    const step = got.get(name);
    if (!step) { differences.push(`step ${name}: absent from the run`); continue; }
    if (step.coherent !== want.coherent) {
      differences.push(`step ${name}: coherent=${step.coherent}, manifest says ${want.coherent}`);
    }
    const a = [...step.mismatches].sort().join(',');
    const b = [...want.mismatches].sort().join(',');
    if (a !== b) differences.push(`step ${name}: mismatches [${a}] != manifest [${b}]`);
  }
  const loadBearing = got.get(manifest.loadBearingStep);
  if (loadBearing && loadBearing.coherent === true) {
    differences.push(`step ${manifest.loadBearingStep} is coherent — this check has been truncated or the fix has landed; ` +
      'either way EXPECTED-RED.md must be revised by a gate decision, not by the harness.');
  }
  return { matches: differences.length === 0, differences };
}

// ---------------------------------------------------------------------------
// A7 — whole-frame totals exceed the scene, and the pass count is the branch
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A7 (pinned by the wave script; reproduced unaltered):
 * `frameTotals().calls > sceneOnly.calls` and `passes === (raysOn ? 8 : 5)`.
 *
 * PRECONDITIONS THAT ARE NOT OPTIONAL (CONTRACT §4.1):
 *  - tier 0 and bloomEnabled. At tier >= 1 presentFrame() takes the no-post
 *    branch, passes === 1 and calls === scene.calls, so `>` is correctly false.
 *    That is A8's job. Measured: tier 1 -> {calls 87, passes 1, scene 87}.
 *  - a SETTLED frame. `raysOn` false with `raysDirty` true is a 6-pass frame,
 *    exactly one, on the frame the sun leaves. Measured directly: the frame
 *    after setBloom({rays:0}) reported 6, the next reported 5. Sampling one
 *    frame at an arbitrary moment flakes at the rate the sun crosses the edge.
 *
 * Measured on HEAD at tier 0: raysOn -> {passes 8, calls 70, scene 63};
 * rays off -> {passes 5, calls 74, scene 70}. Both satisfy calls > scene.calls
 * by exactly (passes - 1) fullscreen quads.
 */
export function assertA7(snapshot = {}) {
  const id = 'A7';
  const ft = snapshot.frameTotals;
  const prev = snapshot.frameTotalsPrev;
  if (!has(ft) || !has(ft.scene)) {
    return unavailable(id, 'not-applicable', `${id}: frameTotals() was not captured.`);
  }
  if (ft.tier !== 0) {
    return invalid(id, `${id}: captured at tier ${ft.tier}. A7 requires tier 0 — at tier >= 1 the ` +
      'no-post branch makes calls === scene.calls and passes === 1, which is A8, not a failure.',
      { actual: { tier: ft.tier }, expected: { tier: 0 } });
  }
  if (snapshot.bloomEnabled === false) {
    return invalid(id, `${id}: bloom is disabled on this run, so there is no post chain to total.`);
  }
  if (!has(prev)) {
    return invalid(id, `${id}: no previous-frame reading. A7 requires a SETTLED frame ` +
      '(CONTRACT §4.1) and settledness cannot be asserted from one sample.');
  }
  if (prev.passes !== ft.passes) {
    return invalid(id, `${id}: unsettled — passes went ${prev.passes} -> ${ft.passes} across the two ` +
      'sampled frames. Re-sample; do not report this as a result.',
      { actual: { passesPrev: prev.passes, passes: ft.passes } });
  }
  const raysOn = has(snapshot.raysOn) ? snapshot.raysOn : computeRaysOn(snapshot.raysStrength, snapshot.sunVisible);
  if (raysOn === null || raysOn === undefined) {
    return unavailable(id, 'not-applicable',
      `${id}: raysOn is unknown. Supply snapshot.raysOn, or both raysStrength (the value last ` +
      'requested through setBloom({rays})) and sunVisible (stats().sunUv[2]). See ASSERTIONS.md §5, GAP-A7.');
  }
  const expectedPasses = raysOn ? PASS_COUNTS.raysOn : PASS_COUNTS.raysOff;
  const callsExceed = ft.calls > ft.scene.calls;
  const passesRight = ft.passes === expectedPasses;
  const ok = callsExceed && passesRight;
  return verdict(id, ok,
    { calls: ft.calls, sceneCalls: ft.scene.calls, passes: ft.passes, raysOn },
    { calls: `> ${ft.scene.calls}`, passes: expectedPasses, raysOn },
    ok
      ? `A7: ${ft.calls} whole-frame calls against ${ft.scene.calls} scene calls, ${ft.passes} passes with rays ${raysOn ? 'on' : 'off'}.`
      : `A7: ${!callsExceed ? `whole-frame calls (${ft.calls}) do not exceed scene calls (${ft.scene.calls}) — the accumulator is reporting the last pass only. ` : ''}` +
        `${!passesRight ? `passes is ${ft.passes}, expected ${expectedPasses} with rays ${raysOn ? 'on' : 'off'}.` : ''}`.trim(),
    { parts: { callsExceed, passesRight }, raysOn });
}

// ---------------------------------------------------------------------------
// A8 — the degraded tiers are reported at all
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A8. The bug this exists for: stats() read `bloomPass.frameStats`
 * only while `getTier() < 1` and `renderer.info.render` otherwise — and
 * renderer.info.render RESETS on every render() call, so after a composite it
 * reports ~1 call for the whole world. Whole-frame totals were therefore
 * unreported at exactly the degraded tiers the controller exists to manage.
 * Measured on HEAD after P0.2c: tier 1 -> {calls 87, passes 1, scene 87};
 * tier 2 -> {calls 85, passes 1, scene 85}.
 */
export function assertA8(snapshot = {}) {
  const id = 'A8';
  const ft = snapshot.frameTotals;
  if (!has(ft) || !has(ft.scene)) {
    return unavailable(id, 'not-applicable', `${id}: frameTotals() was not captured.`);
  }
  if (!(ft.tier >= 1)) {
    return invalid(id, `${id}: captured at tier ${ft.tier}. A8 requires a pinned tier >= 1.`,
      { actual: { tier: ft.tier }, expected: { tier: '>= 1' } });
  }
  const onePass = ft.passes === PASS_COUNTS.noPost;
  const callsEqual = ft.calls === ft.scene.calls;
  const nonZero = ft.calls > 0;
  const ok = onePass && callsEqual && nonZero;
  return verdict(id, ok,
    { passes: ft.passes, calls: ft.calls, sceneCalls: ft.scene.calls, tier: ft.tier },
    { passes: PASS_COUNTS.noPost, calls: ft.scene.calls, sceneCalls: '> 0' },
    ok
      ? `A8: tier ${ft.tier} reports one pass and ${ft.calls} whole-frame calls equal to the scene.`
      : `A8: ${!onePass ? `passes is ${ft.passes}, expected ${PASS_COUNTS.noPost}. ` : ''}` +
        `${!callsEqual ? `calls (${ft.calls}) != scene.calls (${ft.scene.calls}). ` : ''}` +
        `${!nonZero ? 'calls is 0 — the whole frame is unreported at this tier, which is the bug A8 exists for.' : ''}`.trim(),
    { parts: { onePass, callsEqual, nonZero } });
}

// ---------------------------------------------------------------------------
// A9 — the shafts toggle collapses the pass count, once, and stays collapsed
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A9. Rejects `raysDirty` latched true — a state in which the ray
 * chain keeps running forever with the sun off screen, costing three passes a
 * frame that nothing composites.
 *
 * Exactly ONE 6-pass clearing frame is permitted, and only immediately after
 * the toggle. Measured on HEAD, frame by frame after setBloom({rays:0}) with
 * the sun on screen: 6, 5, 5, 5.
 *
 * A9 needs the sun ON SCREEN for the `8` sample, which pulls against
 * CONTRACT §4.2's instruction to freeze the sun. They are compatible, and the
 * recipe below is MEASURED — three earlier attempts at it produced `sunUv
 * [0,0,0]`, five passes, and would have been reported as "the 8-pass branch is
 * unreachable" by anyone who stopped there.
 *
 *   window.__BIRB.setSunEnabled(true);   // the cycle must be RUNNING...
 *   window.__BIRB.setSunTime(0);         // ...for this to move the sun at all
 *   // -> one requestAnimationFrame, so the render loop writes keyLight.position
 *   window.__BIRB.setSunEnabled(false);  // NOW freeze it (CONTRACT §4.2)
 *   window.__BIRB.faceSun(0.22);         // in the SAME evaluate as the frames you sample
 *
 * Three separate traps, each measured:
 *  1. `setSunTime()` is INERT while the cycle is disabled. `lightingRig.keyLight
 *     .position` is only written inside `if (sunState.enabled ...)`, so
 *     setSunEnabled(false) then setSunTime(t) leaves the sun exactly where it
 *     was — measured across nine sun times, all returning the same direction.
 *     Enable, set, step a frame, then freeze.
 *  2. `faceSun(0.22)` only works on a LOW sun. At t=0 the sun sits at elevation
 *     ~0.33 (19 degrees) and 0.22 rad of pitch-up puts it on screen at
 *     visibility 1.0. At t=450 it is at 0.63 (39 degrees) and 0.22 gives
 *     visibility 0 — measured; 0.5 is the first value that works there. Either
 *     freeze at t=0, or retry with a growing pitchUp until sunUv[2] > 0.001.
 *  3. faceSun() does not latch. The flight system rewrites the quaternion
 *     (capturePose()'s own comment says so), so calling it and then settling
 *     lets the sun drift back behind the camera. This is CLAUDE.md's own
 *     recorded trap: "three light-shaft captures in a row came back with the
 *     sun behind the camera."
 *
 * Always re-read `stats().sunUv[2]` on the frames you sampled and refuse the
 * sample if it is 0. A `before.passes` of 5 is not evidence about the shafts.
 */
export function assertA9(snapshot = {}) {
  const id = 'A9';
  const { before, samplesAfter } = snapshot;
  if (!has(before) || !Array.isArray(samplesAfter)) {
    return unavailable(id, 'not-applicable', `${id}: no before/after pass-count series was captured.`);
  }
  if (before.tier !== 0) {
    return invalid(id, `${id}: the "before" sample is at tier ${before.tier}; A9 requires tier 0.`);
  }
  if (samplesAfter.length < 3) {
    return invalid(id, `${id}: only ${samplesAfter.length} post-toggle frames captured. At least 3 are ` +
      'needed to see the clearing frame AND two settled frames after it.');
  }
  const startedAt8 = before.passes === PASS_COUNTS.raysOn;
  // Exactly one transitional 6, and only as the first post-toggle frame.
  const first = samplesAfter[0].passes;
  const rest = samplesAfter.slice(1).map((s) => s.passes);
  const transitionOk = first === PASS_COUNTS.raysClearingFrame || first === PASS_COUNTS.raysOff;
  const settledOk = rest.every((p) => p === PASS_COUNTS.raysOff);
  const neverRecurs = rest.every((p) => p <= PASS_COUNTS.raysOff);
  const ok = startedAt8 && transitionOk && settledOk && neverRecurs;
  return verdict(id, ok,
    { before: before.passes, after: samplesAfter.map((s) => s.passes) },
    { before: PASS_COUNTS.raysOn, after: `[${PASS_COUNTS.raysClearingFrame} or ${PASS_COUNTS.raysOff}] then all ${PASS_COUNTS.raysOff}` },
    ok
      ? `A9: passes went ${before.passes} -> ${samplesAfter.map((s) => s.passes).join(',')} and stayed collapsed.`
      : `A9: ${!startedAt8 ? `the sun was not producing shafts before the toggle (passes ${before.passes}, expected ${PASS_COUNTS.raysOn}) — re-aim with faceSun() and re-sample. ` : ''}` +
        `${!transitionOk ? `the first post-toggle frame reported ${first}. ` : ''}` +
        `${!settledOk ? `later frames reported ${rest.join(',')} instead of a steady ${PASS_COUNTS.raysOff} — raysDirty is latched. ` : ''}`.trim(),
    { parts: { startedAt8, transitionOk, settledOk, neverRecurs } });
}

// ---------------------------------------------------------------------------
// A10 — a panel request is not reverted by the next frame
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A10 / §7.1 ("a panel request is not a suggestion") and §7.2.
 *
 * The hazard is specifically the PER-FRAME writers in the routing register:
 * wind (T4), weather density (T5/T6), the contact shadow (T9) and the ribbons
 * (T10) are written on EVERY frame from the tier. Route the panel through a
 * setter and leave those unrouted, and every static assertion still passes
 * while the request is silently reverted on the very next frame. So this reads
 * at frame n and again at n+2 and requires equality — frame n+1 alone is not
 * enough, because a writer that runs after the read would not be caught.
 */
export const A10_ROUTED_FIELDS = /** @type {const} */ ([
  'rendererPixelRatio',
  'weatherPixelRatio',
  'resizeStatePixelRatio',
  'weatherVisible',
  'windValue',
  'contactShadowVisible',
  'ribbonsVisible',
  'bloomSceneTargetWidth',
]);

export function assertA10(snapshot = {}) {
  const id = 'A10';
  const { atN, atN2, request } = snapshot;
  if (!has(request)) {
    return unavailable(id, 'not-implemented',
      `${id}: no panel exists to issue a request through (src/ui/dev-quality-panel.js absent).`);
  }
  if (!has(atN) || !has(atN2)) {
    return unavailable(id, 'not-applicable', `${id}: frame-n and frame-n+2 readings were not both captured.`);
  }
  if (atN.tier !== atN2.tier) {
    return invalid(id, `${id}: the tier moved between the two reads (${atN.tier} -> ${atN2.tier}). ` +
      'Pin the tier — an unpinned adaptive change is a legitimate rewrite and would be scored as a revert.');
  }
  const present = A10_ROUTED_FIELDS.filter((f) => has(atN[f]) || has(atN2[f]));
  if (!present.length) {
    return unavailable(id, 'not-applicable', `${id}: none of the routed fields were captured.`);
  }
  const fields = present.map((f) => ({
    field: f, actual: atN2[f], expected: atN[f],
    ok: typeof atN[f] === 'number' && typeof atN2[f] === 'number' ? ratioEq(atN[f], atN2[f]) : atN[f] === atN2[f],
  }));
  const ok = fields.every((f) => f.ok);
  return verdict(id, ok,
    Object.fromEntries(fields.map((f) => [f.field, f.actual])),
    Object.fromEntries(fields.map((f) => [f.field, f.expected])),
    ok
      ? `A10: all ${fields.length} routed quantities still held the panel's request two frames later.`
      : `A10: reverted within two frames: ${fields.filter((f) => !f.ok).map((f) => `${f.field} ${f.expected} -> ${f.actual}`).join(', ')}. ` +
        'An unrouted per-frame writer is overwriting the panel (routing register T4/T6/T9/T10).',
    { fields });
}

// ---------------------------------------------------------------------------
// A11 — every sourceless field serialises its sentinel, never a number
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A11 / §3.1. The forbidden substitutes are enumerated there and
 * every one of them has a cost recorded in this repo: a plausible-looking zero
 * is indistinguishable from a measurement, and that is precisely how a dead FPS
 * sampler and a dead bloom pass both stayed green for months.
 *
 * `cooldown: 0` and `mode: "Manual"` are the two named traps (TEL-14, TEL-15).
 * `0` is the one that will actually be written, because it is what a
 * default-initialised counter contains.
 */
export function assertA11(snapshot = {}) {
  const id = 'A11';
  const { quality, sentinelFields } = snapshot;
  if (!has(quality)) {
    return unavailable(id, 'not-implemented',
      `${id}: __BIRB.quality() does not exist yet (Wave 2 P2.3/P2.4).`);
  }
  if (!Array.isArray(sentinelFields) || !sentinelFields.length) {
    return invalid(id, `${id}: no sentinel field list was supplied. The list is derived from ` +
      'CONTRACT §3.2/§3.3 — every row whose wave is later than the build under test.');
  }
  const fields = sentinelFields.map((path) => {
    const value = path.split('.').reduce((o, k) => (o == null ? o : o[k]), quality);
    const shaped = !!value && typeof value === 'object'
      && value.value === null
      && value.state === 'unavailable'
      && UNAVAILABLE_REASONS.includes(value.reason);
    return { field: path, actual: value, expected: { value: null, state: 'unavailable', reason: '<enum>' }, ok: shaped };
  });
  const ok = fields.every((f) => f.ok);
  return verdict(id, ok,
    Object.fromEntries(fields.map((f) => [f.field, f.actual])),
    { '<each>': { value: null, state: 'unavailable', reason: `one of ${UNAVAILABLE_REASONS.join('|')}` } },
    ok
      ? `A11: all ${fields.length} sourceless fields serialised the sentinel.`
      : `A11: ${fields.filter((f) => !f.ok).map((f) => `${f.field}=${JSON.stringify(f.actual)}`).join(', ')} ` +
        'did not serialise {value:null, state:"unavailable", reason:<enum>}. A number here is a fabricated measurement.',
    { fields });
}

// ---------------------------------------------------------------------------
// A12 — the build being measured is the build that is serving
// ---------------------------------------------------------------------------
/**
 * CONTRACT §4 A12 / §8. The measurement hazard, which is worse than the offline
 * one: `staleWhileRevalidate` serves the CACHED src/** first, so the first run
 * of a device session executes the PREVIOUS build's modules against the new
 * index.html, and every number from that session is attributed to a build that
 * was not running. Wave 4 is the hard gate for the whole programme.
 *
 * Absence of a service worker is NOT staleness (localhost, the harness): that
 * case must serialise the sentinel with reason 'not-applicable' and stale false.
 */
export function assertA12(snapshot = {}) {
  const id = 'A12';
  const build = snapshot.quality?.build;
  if (!has(build)) {
    return unavailable(id, 'not-implemented',
      `${id}: quality().build does not exist yet (CONTRACT §8.3 SW-1..SW-4, Wave 2 P2.4).`);
  }
  if (!has(build.requested)) {
    return verdict(id, false, { build }, { requested: '<BIRB_BUILD literal>' },
      'A12: quality().build.requested is missing — this page has no build identity at all.');
  }
  const serving = build.serving;
  const noServiceWorker = serving === null
    || (!!serving && typeof serving === 'object' && serving.state === 'unavailable' && serving.reason === 'not-applicable');
  if (noServiceWorker) {
    const ok = build.stale === false;
    return verdict(id, ok, { serving, stale: build.stale }, { serving: 'sentinel(not-applicable)', stale: false },
      ok
        ? 'A12: no controlling service worker, correctly reported as not-applicable rather than stale.'
        : 'A12: no service worker is controlling the page, yet stale is not false. Absence of a service worker is not staleness (CONTRACT §8.3 SW-4).');
  }
  const matched = build.requested === serving;
  const staleFlagRight = build.stale === !matched;
  const warningRight = matched ? true : snapshot.panelShowsStaleWarning === true;
  const ok = staleFlagRight && warningRight;
  return verdict(id, ok,
    { requested: build.requested, serving, stale: build.stale, panelShowsStaleWarning: snapshot.panelShowsStaleWarning },
    { stale: !matched, panelShowsStaleWarning: matched ? '(n/a)' : true },
    ok
      ? (matched ? 'A12: the serving build matches the requested build.'
        : 'A12: a stale service worker was correctly detected and surfaced.')
      : `A12: ${!staleFlagRight ? `stale is ${build.stale} but requested "${build.requested}" ${matched ? '===' : '!=='} serving "${serving}". ` : ''}` +
        `${!warningRight ? 'the panel did not surface the staleness warning — a device number taken here would be attributed to the wrong build.' : ''}`.trim(),
    { parts: { staleFlagRight, warningRight } });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The A1–A12 table. `run` is the implementation; `needs` is the snapshot
 * contract; `availableOnHead` is whether the source exists at Wave 1; `flip` is
 * the recipe G1 uses to force the TRUE state artificially.
 */
export const ASSERTIONS = Object.freeze({
  A1: {
    id: 'A1', run: assertA1, title: 'three-finger gesture opens the panel WITHOUT ?debug',
    contract: 'CONTRACT §4 A1, §6 ruling 4', needs: ['debugParamPresent', 'panel', 'gesture'],
    availableOnHead: false, unavailableReason: 'not-implemented',
    flip: 'register the gesture inside the ?debug block and load without ?debug — must fail',
  },
  A2: {
    id: 'A2', run: assertA2, title: 'two fingers do NOT open the panel and the sprint survives',
    contract: 'CONTRACT §4 A2 (pinned)', needs: ['panel', 'gesture', 'sprintActive'],
    availableOnHead: false, unavailableReason: 'not-implemented',
    flip: 'stub a panel that opens on ANY touch — must fail',
  },
  A3: {
    id: 'A3', run: assertA3, title: 'the DPR control moves the drawing buffer',
    contract: 'CONTRACT §4 A3, §5.2 SC-DPR', needs: ['before.effective', 'after.effective', 'requestedDpr'],
    availableOnHead: false, unavailableReason: 'not-implemented',
    flip: 'wire the control to a label variable only — must fail',
  },
  A4: {
    id: 'A4', run: assertA4, title: 'blur targets equal sceneTarget / downscale',
    contract: 'CONTRACT §4 A4', needs: ['effective.bloom'],
    availableOnHead: true,
    flip: 'change downscale without re-running setSize — must fail',
  },
  A5: {
    id: 'A5', run: assertA5, title: 'weather density 0 skips the draw',
    contract: 'CONTRACT §4 A5', needs: ['densityOne', 'densityZero'],
    availableOnHead: false, unavailableReason: 'not-implemented',
    flip: 'set the uniform to 0 but leave points.visible true — must fail',
  },
  A6: {
    id: 'A6', run: assertA6, title: 'buffer coherence across tier0 / degrade / resize / restore',
    contract: 'CONTRACT §4 A6 (pinned), docs/perf/EXPECTED-RED.md', needs: ['steps[4]', 'context.dprCap', 'context.devicePixelRatio'],
    availableOnHead: true, expectedOnHead: 'fail',
    flip: 'already TRUE-state on HEAD; flip the other way by hand-desyncing a target dimension on a FIXED tree — must fail there too',
  },
  A7: {
    id: 'A7', run: assertA7, title: 'whole-frame calls exceed scene calls; passes === (raysOn ? 8 : 5)',
    contract: 'CONTRACT §4 A7 (pinned), §4.1', needs: ['frameTotals', 'frameTotalsPrev', 'raysOn | (raysStrength + sunVisible)'],
    availableOnHead: true,
    flip: 'force an 8-pass frame where 5 is expected — must fail',
  },
  A8: {
    id: 'A8', run: assertA8, title: 'tier >= 1 reports one pass and whole-frame === scene',
    contract: 'CONTRACT §4 A8', needs: ['frameTotals (tier >= 1)'],
    availableOnHead: true,
    flip: 'report renderer.info.render after the composite instead of the accumulator — must fail (~1 call)',
  },
  A9: {
    id: 'A9', run: assertA9, title: 'shafts off collapses 8 -> 5 and never recurs',
    contract: 'CONTRACT §4 A9, §4.1', needs: ['before', 'samplesAfter[>=3]'],
    availableOnHead: true,
    flip: 'leave raysDirty latched true — must fail',
  },
  A10: {
    id: 'A10', run: assertA10, title: 'a panel request still holds two frames later',
    contract: 'CONTRACT §4 A10, §7', needs: ['request', 'atN', 'atN2'],
    availableOnHead: false, unavailableReason: 'not-implemented',
    flip: 'let the per-frame writers at T4/T6/T9/T10 run unrouted — must fail on the next frame',
  },
  A11: {
    id: 'A11', run: assertA11, title: 'sourceless fields serialise the sentinel, never a number',
    contract: 'CONTRACT §4 A11, §3.1', needs: ['quality', 'sentinelFields'],
    availableOnHead: false, unavailableReason: 'not-implemented',
    flip: 'emit 0 for cooldown or "Manual" for active mode — must fail',
  },
  A12: {
    id: 'A12', run: assertA12, title: 'the serving build is the requested build',
    contract: 'CONTRACT §4 A12, §8', needs: ['quality.build'],
    availableOnHead: false, unavailableReason: 'not-implemented',
    flip: 'force a stale SW cache name — stale must become true and the warning must show',
  },
});

export const ASSERTION_IDS = Object.freeze(Object.keys(ASSERTIONS));

/** Run a set of assertions over one snapshot bundle. `snapshots` is keyed by id;
 *  a missing key runs the assertion with `{}`, which yields unavailable/invalid,
 *  never a pass. */
export function runAssertions(snapshots = {}, ids = ASSERTION_IDS) {
  return ids.map((id) => {
    const spec = ASSERTIONS[id];
    if (!spec) return invalid(id, `${id}: not a known assertion id`);
    return spec.run(snapshots[id] ?? {});
  });
}

/** Exit code per the mapping in this file's header. Transcribe, do not re-derive. */
export function exitCodeFor(results = []) {
  if (results.some((r) => r.state === 'fail' || r.state === 'invalid')) return 1;
  if (results.some((r) => r.state === 'unavailable')) return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// The page-side mutation catalogue
// ---------------------------------------------------------------------------
/**
 * What `--selftest` applies to prove each assertion DISCRIMINATES. R8: a check
 * is not trusted until it has been watched failing, and red-because-nothing-is-
 * implemented proves nothing about discrimination.
 *
 * Three classes, and the class is what makes the coverage line honest:
 *
 *   snapshot   Mutate the captured snapshot object before the assertion sees
 *              it. Always applicable, needs no page hooks, proves the
 *              comparator direction. This is the class that lets G1 flip all
 *              twelve rows today.
 *   page-hook  Replace a __BIRB reader in the live page (e.g. wrap
 *              effective() to return a desynced dimension). Applicable today
 *              on any hook that exists; also exercises the harness's read path,
 *              which the snapshot class does not.
 *   page-real  A real behavioural defect — a stub panel that opens on any
 *              touch, a latched raysDirty. Needs a module that does not exist
 *              yet. `applicable: false` until then, which is exactly what makes
 *              `mutations: N catalogued, M applicable, M detected` mean
 *              something instead of reading N = M = 0 and calling it success.
 *
 * `detects` is the assertion that MUST come back `fail` (or `invalid`, where
 * stated) when the mutation is applied. A mutation that changes nothing is a
 * rejected assertion, not a rejected mutation.
 */
export const MUTATIONS = Object.freeze([
  // ---- A1 ----
  {
    // G1/F3. A1's only catalogued mutation was page-real, so nothing ever
    // executed a flip for it: QA-FLIP covers snapshot-class mutations only and
    // staticGreenFixtures() had no A1 entry. The assertion was sound — G1 drove
    // it by hand — but "sound when someone remembers to check it by hand" is
    // the state R8 exists to forbid. This is the same defect in snapshot form:
    // the gesture is registered inside the ?debug block, so on a production
    // load (debugParamPresent false) the three-finger hold never opens it.
    id: 'M-A1-gesture-never-opens', targets: 'A1', class: 'snapshot', detects: 'fail',
    why: 'gesture registered behind ?debug — on the production path the panel never opens',
    apply: (s) => ({ ...s, panel: { ...s.panel, openedAfterGesture: false } }),
  },
  // ---- A4 ----
  {
    id: 'M-A4-downscale-drift', targets: 'A4', class: 'snapshot', detects: 'fail',
    why: 'downscale changed without re-running setSize — the blur chain keeps last frame\'s size',
    apply: (s) => ({ ...s, effective: { ...s.effective, bloom: { ...s.effective.bloom, downscale: s.effective.bloom.downscale * 2 } } }),
  },
  {
    id: 'M-A4-blurA-odd', targets: 'A4', class: 'page-hook', detects: 'fail',
    why: 'one target of the three left at a stale width',
    pageScript: `(() => { const e = window.__BIRB.effective; window.__BIRB.effective = () => { const v = e(); v.bloom.blurA.width += 7; return v; }; })()`,
  },
  // ---- A6 ----
  {
    id: 'M-A6-desync-scene-target', targets: 'A6', class: 'page-hook', detects: 'fail',
    why: 'G1\'s named recipe: hand-desync a bloom render target dimension. Must fail even on a FIXED tree.',
    pageScript: `(() => { const e = window.__BIRB.effective; window.__BIRB.effective = () => { const v = e(); v.bloom.sceneTarget.width = Math.max(1, v.bloom.sceneTarget.width - 13); return v; }; })()`,
  },
  {
    id: 'M-A6-truncate-to-two-steps', targets: 'A6', class: 'snapshot', detects: 'invalid',
    why: 'the truncation trap itself: two steps is red today for the right reason and green forever after the fix',
    apply: (s) => ({ ...s, steps: s.steps.slice(0, 2) }),
  },
  {
    id: 'M-A6-resize-after-restore', targets: 'A6', class: 'snapshot', detects: 'invalid',
    why: 'the resize lands AFTER the restore, which re-sizes every target and hides the desync; the four step LABELS are still correct, so only the CSS sizes give it away',
    apply: (s) => {
      const steps = s.steps.map((x) => ({ ...x }));
      steps[2].cssWidth = steps[1].cssWidth; steps[2].cssHeight = steps[1].cssHeight;
      return { ...s, steps };
    },
  },
  {
    id: 'M-A6-never-degraded', targets: 'A6', class: 'snapshot', detects: 'invalid',
    why: 'step 2 never actually lowered the tier, so nothing was ever degraded to restore from',
    apply: (s) => {
      const steps = s.steps.map((x) => ({ ...x }));
      steps[1].requestedTier = steps[0].requestedTier;
      steps[2].requestedTier = steps[0].requestedTier;
      return { ...s, steps };
    },
  },
  // ---- A7 ----
  {
    id: 'M-A7-forced-8-pass', targets: 'A7', class: 'snapshot', detects: 'fail',
    why: 'G1\'s named recipe: force an 8-pass frame where 5 is expected',
    apply: (s) => ({ ...s, frameTotals: { ...s.frameTotals, passes: 8 }, frameTotalsPrev: { ...s.frameTotalsPrev, passes: 8 }, raysOn: false }),
  },
  {
    id: 'M-A7-last-pass-only', targets: 'A7', class: 'snapshot', detects: 'fail',
    why: 'the original bug: report renderer.info.render after the composite, so whole-frame === one quad',
    apply: (s) => ({ ...s, frameTotals: { ...s.frameTotals, calls: 1, scene: { ...s.frameTotals.scene, calls: 1 } } }),
  },
  {
    id: 'M-A7-unsettled', targets: 'A7', class: 'snapshot', detects: 'invalid',
    why: 'sampling one frame across the 8->6->5 transition; must be refused, not scored',
    apply: (s) => ({ ...s, frameTotalsPrev: { ...s.frameTotalsPrev, passes: 6 } }),
  },
  // ---- A8 ----
  {
    id: 'M-A8-renderer-info-after-composite', targets: 'A8', class: 'snapshot', detects: 'fail',
    why: 'renderer.info.render resets per render() call; after a composite it reports ~1 call for the world',
    apply: (s) => ({ ...s, frameTotals: { ...s.frameTotals, calls: 1 } }),
  },
  {
    id: 'M-A8-zero-at-degraded-tier', targets: 'A8', class: 'snapshot', detects: 'fail',
    why: 'the pre-P0.2c state: whole-frame totals unreported at exactly the tiers the controller manages',
    apply: (s) => ({ ...s, frameTotals: { ...s.frameTotals, calls: 0, scene: { ...s.frameTotals.scene, calls: 0 } } }),
  },
  // ---- A9 ----
  {
    id: 'M-A9-rays-dirty-latched', targets: 'A9', class: 'snapshot', detects: 'fail',
    why: 'G1\'s named recipe: leave raysDirty latched true, so the ray chain runs forever',
    apply: (s) => ({ ...s, samplesAfter: s.samplesAfter.map((x) => ({ ...x, passes: 6 })) }),
  },
  {
    id: 'M-A9-never-collapsed', targets: 'A9', class: 'snapshot', detects: 'fail',
    why: 'the toggle is a label: passes stay at 8',
    apply: (s) => ({ ...s, samplesAfter: s.samplesAfter.map((x) => ({ ...x, passes: 8 })) }),
  },
  // ---- A1 / A2 ----
  {
    id: 'M-A1-gesture-behind-debug', targets: 'A1', class: 'page-real', detects: 'fail',
    requires: 'src/ui/dev-gesture.js',
    why: 'the ruling\'s own trap: register the gesture inside the ?debug block, then load without ?debug',
    note: 'applicable from Wave 2 P2.2 onward',
  },
  {
    id: 'M-A2-panel-opens-on-any-touch', targets: 'A2', class: 'page-real', detects: 'fail',
    requires: 'src/ui/dev-quality-panel.js',
    why: 'G1\'s named recipe: stub a panel that opens on ANY touch; the sprint assertion must fail',
    note: 'applicable from Wave 2 P2.3 onward',
  },
  {
    id: 'M-A2-panel-eats-the-sprint', targets: 'A2', class: 'snapshot', detects: 'fail',
    why: 'a gesture implemented as "2 or more fingers" leaves the panel shut and kills boost',
    apply: (s) => ({ ...s, sprintActive: false }),
  },
  // ---- A3 / A5 / A10 / A11 / A12 ----
  {
    id: 'M-A3-label-only', targets: 'A3', class: 'snapshot', detects: 'fail',
    why: 'the control writes a label; the drawing buffer never moves',
    apply: (s) => ({ ...s, after: { ...s.after, effective: { ...s.after.effective, drawingBufferWidth: s.before.effective.drawingBufferWidth } } }),
  },
  {
    id: 'M-A5-uniform-not-visibility', targets: 'A5', class: 'snapshot', detects: 'fail',
    why: 'density 0 zeroes the uniform but leaves points.visible true — a uniform is not a skipped draw',
    apply: (s) => ({ ...s, densityZero: { ...s.densityZero, weather: { ...s.densityZero.weather, visible: true } } }),
  },
  {
    id: 'M-A5-tier-confound', targets: 'A5', class: 'snapshot', detects: 'invalid',
    why: 'the two samples taken at different tiers; the call delta is not attributable to density',
    apply: (s) => ({ ...s, densityZero: { ...s.densityZero, tier: s.densityOne.tier + 1 } }),
  },
  {
    id: 'M-A10-reverted-next-frame', targets: 'A10', class: 'snapshot', detects: 'fail',
    why: 'an unrouted per-frame writer (T4/T6/T9/T10) overwrites the panel request',
    apply: (s) => ({ ...s, atN2: { ...s.atN2, windValue: (s.atN.windValue ?? 1) === 1 ? 0.35 : 1 } }),
  },
  {
    id: 'M-A11-zero-for-cooldown', targets: 'A11', class: 'snapshot', detects: 'fail',
    why: 'CONTRACT §3.1\'s first forbidden substitute, and the one a default-initialised counter produces',
    apply: (s) => ({ ...s, quality: { ...s.quality, cooldown: 0 } }),
  },
  {
    id: 'M-A11-manual-inferred-from-pinned', targets: 'A11', class: 'snapshot', detects: 'fail',
    why: 'TEL-15: reporting pinned===true as "Manual" is an inference and is forbidden',
    apply: (s) => ({ ...s, quality: { ...s.quality, activeMode: 'Manual' } }),
  },
  {
    id: 'M-A12-stale-not-flagged', targets: 'A12', class: 'snapshot', detects: 'fail',
    why: 'the serving build differs and stale stays false — every device number is then misattributed',
    apply: (s) => ({ ...s, quality: { ...s.quality, build: { ...s.quality.build, serving: s.quality.build.requested + '-OLD', stale: false } } }),
  },
  {
    id: 'M-A12-absent-sw-called-stale', targets: 'A12', class: 'snapshot', detects: 'fail',
    why: 'CONTRACT §8.3 SW-4: absence of a service worker is not staleness',
    apply: (s) => ({ ...s, quality: { ...s.quality, build: { ...s.quality.build, serving: null, stale: true } } }),
  },
]);

/** Coverage line inputs for `--selftest`. `applicable` counts mutations whose
 *  `requires` file is present (or which need no file at all). */
export function mutationCoverage(existingFiles = []) {
  const catalogued = MUTATIONS.length;
  const applicable = MUTATIONS.filter((m) => !m.requires || existingFiles.includes(m.requires)).length;
  return { catalogued, applicable };
}
