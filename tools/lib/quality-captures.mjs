/**
 * tools/lib/quality-captures.mjs — the seven missing live capturers
 * (A1, A2, A3, A5, A10, A11, A12).
 *
 * Task P2R.6, closing G2b §5.2 / G2c §8 ("the harness the contract names as
 * the single oracle cannot run seven of its twelve assertions"). G2c's own
 * decision (§8, confirmed): "put the seven capturers in a new, unfrozen
 * tools/lib/quality-captures.mjs. tools/birb-quality.mjs is a manifest row
 * and tools/lib/quality-assertions.mjs is too; a new file under tools/lib/
 * is neither, so R5 stays intact for Wave 3 and no re-freeze is needed."
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT THIS FILE MATCHES
 * ---------------------------------------------------------------------------
 * tools/birb-quality.mjs (frozen, R5 — not edited by this task) defines:
 *
 *   const LIVE_CAPTURES = Object.freeze({
 *     A4: captureA4, A6: captureResizeRestore, A7: captureA7,
 *     A8: captureA8, A9: captureA9,
 *   });
 *   ...
 *   else snapshot = await LIVE_CAPTURES[id](page);
 *
 * i.e. one entry per assertion id, each an `async (page) => snapshot` that
 * takes the harness's already-booted Playwright `page` (CONTRACT §5.1
 * context, already past SC-DPR, already at `?debug=1`) and returns the plain
 * object docs/perf/ASSERTIONS.md §3 defines for that id. This file exports
 * `LIVE_CAPTURES` in EXACTLY that shape, for the same seven ids the harness
 * currently has no capturer for (A1, A2, A3, A5, A10, A11, A12). Wiring it in
 * is one line in tools/birb-quality.mjs — spread this module's LIVE_CAPTURES
 * into its own alongside the existing five (A4/A6/A7/A8/A9) — see this
 * task's report for the exact diff, which this file does NOT apply itself
 * (tools/birb-quality.mjs is frozen, R5).
 *
 * ---------------------------------------------------------------------------
 * WHY A1 AND A2 OPEN A SECOND PAGE
 * ---------------------------------------------------------------------------
 * CONTRACT §6 ruling: the panel and the gesture register on the PRODUCTION
 * path, and A1's own comparator (quality-assertions.mjs assertA1) rejects any
 * run with `debugParamPresent !== false`. The harness's own booted `page` is
 * always `?debug=1` (CONTRACT §5.1's pinned context is layered on top of that
 * URL in tools/birb-quality.mjs's `boot()`), so A1/A2's panel+gesture half
 * cannot be captured on that page at all — a second, undecorated page is not
 * a convenience here, it is the whole point of the assertion. `openProductionPage()`
 * below opens it in the SAME browser (via `page.context().browser()`), so no
 * second Chromium install or server boot is introduced (R7's spirit, even
 * though R7 itself names the harness rather than this library).
 *
 * A2's second half (`sprintActive`) is a different story: CONTRACT §6 ruling 2
 * is explicit that `?debug` gates ONLY `window.__BIRB`, never the gesture or
 * the sprint logic itself (index.html's touchstart/touchend listeners for
 * `updateSprintState` carry no debug check at all). So "does a two-finger
 * touch still engage the sprint" is a fact about code that runs identically
 * with or without `?debug` — only the READ INSTRUMENT needs `__BIRB`. This
 * file therefore captures A2's panel-stays-closed half on a fresh production
 * page (matching A1) and its sprintActive half on the harness's OWN already-
 * `?debug` page (reusing `window.__BIRB.stats().sprintActive`, added by this
 * task — see the "GAP-A2" section below for the exact index.html diff), never
 * the other way around. Two different facts about the same unconditional
 * code path, read through whichever instrument can see each one.
 *
 * ---------------------------------------------------------------------------
 * GAP-A2 — the index.html hook this task added
 * ---------------------------------------------------------------------------
 * docs/perf/ASSERTIONS.md §5 GAP-A2: "sprintState.active (index.html ~4974/
 * 7738) has no reader. __BIRB.setSprint writes it; stats() does not report
 * it. Blocks A2's second half. What is needed: expose it on stats() or the
 * panel export." This task added exactly that — one field on the existing
 * `stats()` object in index.html:
 *
 *   sprintActive: !!(sprintState && sprintState.active),
 *
 * No new method, no new gating, nothing else touched. `updateSprintState`
 * only engages the sprint in `GAME_MODES.RING_RUSH` (index.html ~7727), so
 * this file switches mode via the existing `__BIRB.startMode('ring_rush')`
 * hook before testing — a capture taken in Casual would read `sprintActive:
 * false` for a wholly legitimate reason and must not be scored as a defect
 * (the orchestrator's own note, transcribed).
 *
 * ---------------------------------------------------------------------------
 * HOW THE PANEL IS DRIVEN FOR A3 / A5 / A10
 * ---------------------------------------------------------------------------
 * Same methodology G2b's gate used by hand: locate a control inside
 * `#birb-dev-quality-panel` by its own `.bqp-control-label` text, then set
 * `input.value` and dispatch REAL `input` + `change` events — i.e. through
 * the exact listener a thumb reaches (dev-quality-panel.js's `commitControl`/
 * `forceCommitControl`), never through `qualitySettings.request` or
 * `__BIRB` directly. The panel itself is opened deterministically by
 * dispatching the same CustomEvent the gesture/keyboard/`?devpanel` routes
 * all funnel into (`birb:dev-panel-open`, index.html's `DEV_PANEL_OPEN_EVENT`)
 * — this is not a fourth backdoor, it is Route 1's own signal, used here to
 * skip re-proving the gesture (A1 already proves the gesture reaches it).
 */

import { devices } from 'playwright';
import { installCdnCache } from '../birb-shot.mjs';

// CONTRACT §5.1, transcribed verbatim from tools/birb-quality.mjs's own
// boot() — not re-derived. isMobile selects DPR_CAP=1.7 over 1.8; hasTouch is
// what makes touch synthesis meaningful at all; deviceScaleFactor MUST stay
// above the 1.7 cap or SC-DPR (§5.2) goes dead in this context.
const PINNED_CONTEXT = Object.freeze({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  reducedMotion: 'no-preference',
});

// dev-gesture.js DEV_GESTURE_DEFAULTS.holdMs is 350ms; hold comfortably past
// it so a slow CI frame never reads as an unsatisfied hold.
const GESTURE_HOLD_MS = 550;

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stripQuery(url) {
  const u = new URL(url);
  u.search = '';
  return u.toString();
}

// ---------------------------------------------------------------------------
// A second, undecorated page in the SAME browser — CONTRACT §6's production
// path. Never installs a second Chromium, never boots a second server.
// ---------------------------------------------------------------------------

async function openProductionPage(page) {
  const browser = page.context().browser();
  if (!browser) {
    throw new Error(
      'quality-captures: page.context().browser() returned null — cannot open the ' +
      'second, no-?debug page CONTRACT §6 requires for A1/A2. (Playwright launched with a ' +
      'persistent context rather than chromium.launch()?)',
    );
  }
  const baseUrl = stripQuery(page.url());
  const context = await browser.newContext({ ...devices['iPhone 13'], ...PINNED_CONTEXT });
  await installCdnCache(context);
  const prodPage = await context.newPage();
  await prodPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // The panel + gesture register at module top-level (index.html's single
  // <script type="module">, via top-level `await import(...)`), which runs
  // unconditionally on page load and well before Tap-to-Start — CONTRACT §6
  // ruling 1 ("register unconditionally ... outside the ?debug block") does
  // not say "after the splash flow", and waiting for the DOM node directly
  // is a stronger proof than clicking through splashes first: it shows the
  // workbench does not even need a started game.
  await prodPage.waitForSelector('#birb-dev-quality-panel', { state: 'attached', timeout: 20000 });
  return {
    page: prodPage,
    debugParamPresent: new URL(prodPage.url()).searchParams.has('debug'),
    close: () => context.close(),
  };
}

async function readPanelHidden(page) {
  return page.evaluate(() => {
    const el = document.getElementById('birb-dev-quality-panel');
    return el ? el.hidden : null; // null, not false — "no panel" must never read as "closed"
  });
}

// ---------------------------------------------------------------------------
// Touch synthesis — real, trusted touch events via CDP, never JS-constructed
// TouchEvents (which a `passive` listener can tell apart from a real OS
// gesture on some engines, and which is not what a thumb produces anyway).
// ---------------------------------------------------------------------------

function fingerPoints(count) {
  // Spread out, not stacked — a stacked cluster is what a browser sometimes
  // coalesces into fewer touch identifiers.
  return Array.from({ length: count }, (_, i) => ({ x: 120 + i * 45, y: 520 + i * 35 }));
}

async function holdAndRelease(page, fingerCount, holdMs) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingerPoints(fingerCount) });
    await page.waitForTimeout(holdMs);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach().catch(() => {});
  }
}

/** Like holdAndRelease, but leaves the fingers DOWN and returns a releaser —
 * for A2's sprint half, where sprint is a HOLD (active only while touching),
 * not a toggle: reading sprintActive after release would always read false. */
async function holdDown(page, fingerCount) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingerPoints(fingerCount) });
  return async () => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach().catch(() => {});
  };
}

// ---------------------------------------------------------------------------
// Panel driving — Route 1's own open event; real DOM input/change events on
// the real control, located by its own visible label text (matches G2b's
// hand-driven methodology exactly, so this is a transcription of an already-
// proven technique, not a new one).
// ---------------------------------------------------------------------------

async function openPanel(page) {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('birb:dev-panel-open')));
  await page.waitForFunction(() => {
    const el = document.getElementById('birb-dev-quality-panel');
    return !!el && el.hidden === false;
  }, null, { timeout: 5000 });
}

async function switchPanelView(page, viewLabel) {
  await page.evaluate((label) => {
    const btn = Array.from(document.querySelectorAll('#birb-dev-quality-panel .bqp-tab'))
      .find((b) => b.textContent.trim() === label);
    if (!btn) throw new Error(`quality-captures: no panel tab labelled "${label}"`);
    btn.click();
  }, viewLabel);
}

async function setSliderByLabel(page, labelText, value) {
  await page.evaluate(({ label, v }) => {
    const wraps = Array.from(document.querySelectorAll('#birb-dev-quality-panel .bqp-control'));
    const wrap = wraps.find((w) => {
      const l = w.querySelector('.bqp-control-label');
      return l && l.textContent.trim().startsWith(label);
    });
    if (!wrap) throw new Error(`quality-captures: no control labelled "${label}" is visible (wrong tab?)`);
    const input = wrap.querySelector('input[type="range"]');
    if (!input) throw new Error(`quality-captures: control "${label}" has no range input`);
    input.value = String(v);
    // Real listener path, not qualitySettings.request()/__BIRB — 'input' is
    // the throttled live-drag commit, 'change' is the unthrottled release
    // commit; dispatching both is what a real drag-then-lift produces.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { label: labelText, v: value });
}

// ---------------------------------------------------------------------------
// A1 — three-finger hold-and-release opens the panel WITHOUT ?debug
// ---------------------------------------------------------------------------

export async function captureA1(page) {
  let session;
  try {
    session = await openProductionPage(page);
  } catch (err) {
    return {
      debugParamPresent: false,
      panel: { present: false, openedAfterGesture: false },
      gesture: { performed: null },
      captureError: String(err && err.message || err),
    };
  }
  try {
    const beforeHidden = await readPanelHidden(session.page);
    await holdAndRelease(session.page, 3, GESTURE_HOLD_MS);
    await session.page.waitForTimeout(150);
    const afterHidden = await readPanelHidden(session.page);
    return {
      debugParamPresent: session.debugParamPresent,
      panel: {
        present: true,
        openedAfterGesture: beforeHidden === true && afterHidden === false,
      },
      gesture: { performed: 'three-finger-hold-release' },
    };
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// A2 — two fingers must NOT open the panel, and the sprint survives
// ---------------------------------------------------------------------------

export async function captureA2(page) {
  // Half 1 (production path): two fingers must not open the panel.
  let panelHalf;
  let session;
  try {
    session = await openProductionPage(page);
  } catch (err) {
    panelHalf = { present: false, openedAfterGesture: null, captureError: String(err && err.message || err) };
  }
  if (session) {
    try {
      const beforeHidden = await readPanelHidden(session.page);
      await holdAndRelease(session.page, 2, GESTURE_HOLD_MS);
      await session.page.waitForTimeout(150);
      const afterHidden = await readPanelHidden(session.page);
      panelHalf = {
        present: true,
        // "stayed closed" — true only if it was closed throughout, never
        // transitioned open. A panel that opened and was closed again by
        // something else would otherwise read as a false pass.
        openedAfterGesture: !(beforeHidden === true && afterHidden === true),
      };
    } finally {
      await session.close();
    }
  }

  // Half 2 (sprintActive, GAP-A2): the sprint/gesture LOGIC is unconditional
  // (CONTRACT §6 ruling 2); only the read instrument needs __BIRB, so this
  // reuses the harness's own already-?debug page. RING_RUSH is required for
  // the sprint to engage at all (index.html's updateSprintState) — switching
  // mode here, not assuming the page booted into it.
  let sprintActive = null;
  try {
    await page.evaluate(() => window.__BIRB.startMode('ring_rush'));
    await page.waitForTimeout(80);
    const release = await holdDown(page, 2);
    try {
      // Sprint is a HOLD, not a toggle — read while the fingers are still
      // down. Reading after release would read false for every capture,
      // real or broken, which is exactly the kind of always-passing (or in
      // this case always-failing) capturer R8 warns against.
      await page.waitForTimeout(120);
      sprintActive = await page.evaluate(() => window.__BIRB.stats().sprintActive);
    } finally {
      await release();
    }
  } finally {
    await page.evaluate(() => window.__BIRB.startMode('casual')).catch(() => {});
  }

  return {
    panel: panelHalf,
    gesture: { performed: 'two-finger-hold' },
    sprintActive,
  };
}

// ---------------------------------------------------------------------------
// A3 — the DPR control moves the drawing buffer
// ---------------------------------------------------------------------------

async function selfCheckDprLocal(page) {
  // CONTRACT §5.2, transcribed. Run BEFORE touching the panel's own dpr
  // override: a panel override takes precedence over the tier (CONTRACT
  // §7.1, G2b §3 "Item B"), so pinning tiers while an override is active
  // would read the override twice and prove nothing about the discriminator.
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await page.waitForTimeout(150);
  const r0 = (await page.evaluate(() => window.__BIRB.effective())).rendererPixelRatio;
  await page.evaluate(() => window.__BIRB.pinTier(1));
  await page.waitForTimeout(150);
  const r1 = (await page.evaluate(() => window.__BIRB.effective())).rendererPixelRatio;
  await page.evaluate(() => window.__BIRB.pinTier(0));
  await page.waitForTimeout(150);
  return r0 !== r1;
}

export async function captureA3(page) {
  const selfCheckDprPassed = await selfCheckDprLocal(page);
  const before = { effective: await page.evaluate(() => window.__BIRB.effective()) };

  // Pick a target distinctly away from the current ratio, inside the
  // control's own 0.85-2.0 range (CONTRACT §5.2 / PRO-9), so the test cannot
  // pass by accident because the requested value already matched.
  const requestedDpr = Math.abs(before.effective.rendererPixelRatio - 1.3) < 0.05 ? 1.05 : 1.3;

  await openPanel(page);
  await switchPanelView(page, 'Look');
  await setSliderByLabel(page, 'Render DPR', requestedDpr);
  await page.waitForTimeout(250);
  const after = { effective: await page.evaluate(() => window.__BIRB.effective()) };

  // Restore what we moved. `--check all` boots ONE page and runs every
  // assertion on it in sequence (doCheck), so a capturer that mutates state
  // and walks away contaminates every assertion after it. Measured: wiring
  // these capturers in made A6 fail inside `--check all` while passing
  // standalone, because it began its tier0 step at the 1.3 this capturer left
  // behind instead of the 1.7 cap. Its restore step was still coherent — the
  // Wave 2 fix held — but a check whose verdict depends on which siblings ran
  // before it is not a check. Restoring here rather than isolating in the
  // harness keeps the single-page boot, which matters: SwiftShader takes
  // ~20-60s per boot and twelve of them would price the gate out of CI.
  await restoreDpr(page, before.effective.rendererPixelRatio);

  return { before, after, requestedDpr, selfCheckDprPassed };
}

/**
 * Put the render-DPR control back where it was found, and confirm the live
 * renderer actually returned — a slider snapping back is not evidence.
 */
async function restoreDpr(page, ratio) {
  if (!Number.isFinite(ratio)) return;
  await setSliderByLabel(page, 'Render DPR', ratio);
  await page.waitForTimeout(250);
  const back = await page.evaluate(() => window.__BIRB.effective().rendererPixelRatio);
  if (Math.abs(back - ratio) > 0.001) {
    throw new Error(`captureA3 could not restore render DPR: wanted ${ratio}, got ${back}. `
      + 'Later assertions in --check all would run on a contaminated page.');
  }
}

// ---------------------------------------------------------------------------
// A5 — weather density 0 skips the draw
// ---------------------------------------------------------------------------

async function sampleSceneCallsAndWeather(page, count) {
  return page.evaluate((n) => new Promise((resolve) => {
    const calls = [];
    let visible = null;
    function tick() {
      const w = window.__BIRB.weather();
      visible = w ? w.visible : null;
      calls.push(window.__BIRB.frameTotals().scene.calls);
      if (calls.length >= n) resolve({ calls, visible });
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), count);
}

export async function captureA5(page) {
  // CONTRACT §4.2 confounds: freeze the sun and the pose, pin the tier —
  // same same-tier/same-pose requirement assertA5 itself enforces.
  await page.evaluate(() => {
    window.__BIRB.setSunEnabled(false);
    window.__BIRB.freeze(true);
    window.__BIRB.pinTier(0);
  });
  await page.waitForTimeout(200);
  await openPanel(page);
  await switchPanelView(page, 'Performance');

  await setSliderByLabel(page, 'Weather density', 1);
  await page.waitForTimeout(200);
  const one = await sampleSceneCallsAndWeather(page, 10);
  const tierOne = await page.evaluate(() => window.__BIRB.stats().tier);

  await setSliderByLabel(page, 'Weather density', 0);
  await page.waitForTimeout(200);
  const zero = await sampleSceneCallsAndWeather(page, 10);
  const tierZero = await page.evaluate(() => window.__BIRB.stats().tier);

  // Put back everything this capturer moved. It unfroze but left the sun
  // DISABLED, the density at 0 and the tier pinned — and `--check all` runs
  // every assertion on one page, so A9 (shafts collapse 8 -> 5) then sampled a
  // sky with no sun in it and failed with "the sun was not producing shafts
  // before the toggle". A capturer that disables the sun and walks away is not
  // measuring weather, it is rewriting the world for everything downstream.
  await setSliderByLabel(page, 'Weather density', 1);
  await page.evaluate(() => {
    window.__BIRB.freeze(false);
    window.__BIRB.setSunEnabled(true);
    window.__BIRB.unpinTier?.();
    if (typeof window.__BIRB.faceSun === 'function') window.__BIRB.faceSun();
  }).catch(() => {});
  await page.waitForTimeout(200);

  return {
    densityOne: { tier: tierOne, weather: { visible: one.visible }, frameTotals: { scene: { calls: median(one.calls) } } },
    densityZero: { tier: tierZero, weather: { visible: zero.visible }, frameTotals: { scene: { calls: median(zero.calls) } } },
  };
}

// ---------------------------------------------------------------------------
// A10 — a panel request still holds two frames later (routing register)
// ---------------------------------------------------------------------------

const READ_ROUTED_FIELDS_JS = () => {
  const eff = window.__BIRB.effective();
  const q = window.__BIRB.quality();
  const w = window.__BIRB.weather();
  const s = window.__BIRB.shadow();
  return {
    tier: window.__BIRB.stats().tier,
    rendererPixelRatio: eff.rendererPixelRatio,
    weatherPixelRatio: eff.weatherPixelRatio,
    resizeStatePixelRatio: eff.resizeStatePixelRatio,
    bloomSceneTargetWidth: eff.bloom ? eff.bloom.sceneTarget.width : null,
    weatherVisible: w ? w.visible : null,
    // GAP-A7-adjacent: wind has no direct __BIRB reader either, but
    // quality().effective.decorativeDensity.effective IS visualUniforms.wind.value
    // (index.html panelGetControlState) — a real live read, not a recomputation.
    windValue: (q && q.effective && q.effective.decorativeDensity) ? q.effective.decorativeDensity.effective : null,
    contactShadowVisible: s ? s.visible : null,
    // ribbonsVisible: no reader exists on __BIRB (wingRibbons is a bare
    // local) — omitted rather than guessed, same as G2b §3 scored 7 of 8.
  };
};

export async function captureA10(page) {
  // Tier 2 sheds wind/shadow/weather by default (G2b §3 "Item B" measured
  // this), which is what makes "the panel override still wins two frames
  // later" a real test rather than a vacuous one.
  await page.evaluate(() => window.__BIRB.pinTier(2));
  await page.waitForTimeout(150);
  await openPanel(page);
  await switchPanelView(page, 'Performance');
  await setSliderByLabel(page, 'Weather density', 1);
  await setSliderByLabel(page, 'Decorative density (wind / contact shadow / ribbons)', 1);
  await switchPanelView(page, 'Look');
  const requestedDpr = 1.25;
  await setSliderByLabel(page, 'Render DPR', requestedDpr);
  await page.waitForTimeout(80);

  // atN, atN+1, atN+2 in ONE evaluate call — no Playwright round-trip
  // latency between reads (same reasoning as birb-quality.mjs's own
  // sampleFrames/sampleFramesWithSun).
  const frames = await page.evaluate((readFieldsSrc) => new Promise((resolve) => {
    // eslint-disable-next-line no-eval -- reconstructing the shared reader
    // inside the page; see READ_ROUTED_FIELDS_JS above for the real source.
    const readFields = new Function(`return (${readFieldsSrc})`)();
    const out = [];
    function tick() {
      out.push(readFields());
      if (out.length >= 3) resolve(out);
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), READ_ROUTED_FIELDS_JS.toString());

  const [atN, , atN2] = frames;
  return { request: { dpr: requestedDpr }, atN, atN2 };
}

// ---------------------------------------------------------------------------
// A11 — every sourceless field serialises the sentinel, never a number
// ---------------------------------------------------------------------------

export async function captureA11(page) {
  const quality = await page.evaluate(() => window.__BIRB.quality());
  return { quality, sentinelFields: quality.sentinelFields };
}

// ---------------------------------------------------------------------------
// A12 — the serving build is the requested build
// ---------------------------------------------------------------------------

export async function captureA12(page) {
  const quality = await page.evaluate(() => window.__BIRB.quality());
  await openPanel(page);
  // The stale banner is painted by the panel's own 4Hz tick (tick() sets
  // staleBanner.hidden = !stale) — give it at least one tick before reading.
  await page.waitForTimeout(350);
  const panelShowsStaleWarning = await page.evaluate(() => {
    const banner = document.querySelector('#birb-dev-quality-panel .bqp-stale-banner');
    return !!banner && banner.hidden === false;
  });
  return { quality, panelShowsStaleWarning };
}

// ---------------------------------------------------------------------------
// The contract: one entry per id this file covers, `async (page) => snapshot`
// — same shape as tools/birb-quality.mjs's own (frozen) LIVE_CAPTURES.
// ---------------------------------------------------------------------------

export const LIVE_CAPTURES = Object.freeze({
  A1: captureA1,
  A2: captureA2,
  A3: captureA3,
  A5: captureA5,
  A10: captureA10,
  A11: captureA11,
  A12: captureA12,
});

export default LIVE_CAPTURES;
