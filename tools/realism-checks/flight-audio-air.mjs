/**
 * Hear the air — on the real page, measured at the OUTPUT.
 *
 * The flight audio (src/audio/flight-audio.js) reports the levels it drives,
 * but a parameter moving is not a sound coming out: the lesson of a shader
 * that compiles to nothing while the page still paints applies to a graph
 * that renders silence while every AudioParam reads right. So every claim
 * here is read twice — once from the controller's own probe, once from an
 * analyser on the master (`__BIRB.flightAudio({ measure: true })`).
 *
 * Headless Chromium runs with --autoplay-policy=no-user-gesture-required and
 * --mute-audio (tools/birb-shot.mjs), so "running" here proves the graph was
 * built on the Tap-to-Start path and renders; it cannot prove the iOS gesture
 * rule, which only the phone can. The analyser sits before the muted sink,
 * so it hears what a speaker would.
 *
 * Audio runs on its own clock: the waits below that are in milliseconds are
 * waits for the AUDIO THREAD to render settled parameters (tau 60 ms), never
 * a stand-in for game time, which is always counted in frames.
 */
export const name = 'flight-audio-air';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fly with inputs held for `frames` frames, then read the probe and the
 * output. The analyser's window is 93 ms and the wind gusts on 0.23/0.37 Hz
 * LFOs, so the output is read `reads` times and averaged (power mean for the
 * RMS, so it stays an RMS).
 */
async function flyAndMeasure(page, { x = 0, y = 0, throttle = 1, sprint = false, frames = 60, reads = 8 } = {}) {
  return page.evaluate(async ({ x, y, throttle, sprint, frames, reads }) => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    B.setSprint(sprint);
    B.setStick(x, y);
    B.setPad(0, throttle);
    for (let i = 0; i < frames; i += 1) await raf();
    // Real time for the audio thread to render the settled targets.
    await sleep(400);
    const out = B.flightAudio();
    let pow = 0; let centroid = 0; let tone = 0;
    for (let i = 0; i < reads; i += 1) {
      const m = B.flightAudio({ measure: true, toneHz: out.whistleFreq }).measured;
      pow += m.rms * m.rms;
      centroid += m.centroidHz;
      tone += m.toneAboveFloorDb;
      await sleep(70);
    }
    out.measured = { rms: Math.sqrt(pow / reads), centroidHz: centroid / reads, toneAboveFloorDb: tone / reads };
    B.setStick(0, 0);
    B.setPad(null);
    B.setSprint(false);
    return out;
  }, { x, y, throttle, sprint, frames, reads });
}

export default async function run(ctx) {
  const { page } = ctx;
  const volume = await page.evaluate(() => window.__BIRB.flightAudio().volume);

  // ---- 0. The context exists, came from the Start path, and renders -------
  const p0 = await page.evaluate(() => window.__BIRB.flightAudio());
  ctx.log(`state ${p0.state}, sampleRate ${p0.sampleRate}, session ${p0.sessionType}, volume ${p0.volume}`);
  ctx.check(p0.state === 'running', `the flight audio context is running after Tap-to-Start (state ${p0.state})`);
  const tA = p0.contextTime;
  await wait(600);
  const tB = await page.evaluate(() => window.__BIRB.flightAudio().contextTime);
  ctx.check(tB - tA > 0.3, `the audio thread is rendering (currentTime ${tA} -> ${tB} over 0.6 s)`);
  // Arm the analyser: the read that creates it has heard nothing yet.
  const armed = await page.evaluate(() => window.__BIRB.flightAudio({ measure: true }).measured);
  ctx.check(armed && armed.fresh === true, 'the analyser reports its first, empty read as fresh');
  await wait(300);

  // ---- 1. Idle glide, cruise, sprint: level, pitch, brightness, whistle ---
  // Idle throttle settles near 0.55 of cruise: ~1.1x the stall speed, which
  // is exactly where a stall warner speaks, so the glide is expected to carry
  // a light pre-stall buffet. The wind itself is compared cruise -> sprint,
  // where nothing but the air is sounding.
  const rows = [];
  for (const [label, opts] of [
    ['idle glide', { throttle: 0, frames: 70 }],
    ['cruise', { throttle: 1, frames: 50 }],
    ['sprint', { sprint: true, frames: 45 }],
  ]) {
    await page.evaluate(() => { const B = window.__BIRB; B.freeze(false); B.setAltitude(220); });
    const r = await flyAndMeasure(page, opts);
    rows.push(r);
    ctx.log(`${label.padEnd(10)} speed ${String(r.speed).padEnd(6)} wind ${r.windGain} @ ${r.windFreq} Hz, whistle ${r.whistleGain} @ ${r.whistleFreq} Hz, buffet ${r.buffet}`
      + ` | out rms ${r.measured.rms.toFixed(5)}, centroid ${r.measured.centroidHz.toFixed(0)} Hz, tone +${r.measured.toneAboveFloorDb.toFixed(1)} dB`);
  }
  const [glide, cruise, fast] = rows;
  ctx.check(glide.speed < cruise.speed && cruise.speed < fast.speed,
    `three steady speeds (${glide.speed} < ${cruise.speed} < ${fast.speed} u/s)`);
  ctx.check(glide.windGain < cruise.windGain && fast.windGain > 5 * cruise.windGain,
    `windGain rises steeply with airspeed (${glide.windGain} -> ${cruise.windGain} -> ${fast.windGain})`);
  ctx.check(glide.windFreq < cruise.windFreq && cruise.windFreq < fast.windFreq,
    `windFreq rises with airspeed (${glide.windFreq} -> ${cruise.windFreq} -> ${fast.windFreq} Hz)`);
  const mc = cruise.measured;
  const mf = fast.measured;
  ctx.check(mf.rms > 3 * mc.rms, `the OUTPUT is louder at a sprint than at cruise (rms ${mc.rms.toFixed(5)} -> ${mf.rms.toFixed(5)})`);
  ctx.check(mf.centroidHz > mc.centroidHz * 1.3,
    `the OUTPUT is brighter at a sprint (centroid ${mc.centroidHz.toFixed(0)} -> ${mf.centroidHz.toFixed(0)} Hz)`);
  // The level the controller claims is the level that comes out: the makeup
  // gains turn filtered noise into the RMS the mapping asks for.
  for (const [label, r] of [['cruise', cruise], ['sprint', fast]]) {
    const claimed = Math.hypot(r.windGain, r.whistleGain) * volume;
    const ratio = r.measured.rms / claimed;
    ctx.check(ratio > 0.6 && ratio < 1.6,
      `the ${label} output RMS is what the controller claims (${r.measured.rms.toFixed(5)} vs ${claimed.toFixed(5)}, x${ratio.toFixed(2)})`);
  }
  ctx.check(cruise.buffet === 0, `no buffet at cruise (${cruise.buffet})`);
  ctx.check(glide.buffet > 0 && glide.buffet < 0.55,
    `the idle-throttle glide, ~1.1x the stall speed, carries a light pre-stall buffet (${glide.buffet})`);
  ctx.check(glide.whistleGain === 0 && cruise.whistleGain === 0,
    `no whistle below speed (${glide.whistleGain}, ${cruise.whistleGain})`);
  ctx.check(mf.toneAboveFloorDb >= 6,
    `the aeolian whistle stands out of the wind at a sprint (${fast.whistleFreq} Hz, +${mf.toneAboveFloorDb.toFixed(1)} dB over the noise around it)`);

  // ---- 2. The wingbeat whoosh follows the wing's real motion --------------
  // Forced beats first: flapPhase() writes wingBeat() straight into the rig,
  // so N forced beats must be N whooshes, and a wing held still must be none.
  const forced = await page.evaluate(async () => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    B.setAltitude(220);
    B.flapPhase(0.5);
    for (let i = 0; i < 6; i += 1) await raf();
    const c0 = B.flightAudio().whooshCount;
    for (let i = 0; i < 20; i += 1) await raf();
    const still = B.flightAudio().whooshCount - c0;
    // 8 beats, 6 frames each: phases 0, 1/6, ... — whatever the frame time,
    // the wing goes up and comes down once per beat.
    const c1 = B.flightAudio().whooshCount;
    for (let beat = 0; beat < 8; beat += 1) {
      for (let k = 0; k < 6; k += 1) { B.flapPhase(k / 6); await raf(); }
    }
    B.flapPhase(0.5);
    await raf(); await raf();
    const beats = B.flightAudio().whooshCount - c1;
    B.flapPhase(null);
    return { still, beats };
  });
  ctx.check(forced.still === 0, `a wing held still makes no whoosh (${forced.still})`);
  ctx.check(forced.beats >= 7 && forced.beats <= 9, `8 forced wingbeats make 8 whooshes (${forced.beats})`);

  // Then the rig's own beat, whatever pose code runs: hold a climb.
  const climbSign = await page.evaluate(() => {
    const t = window.__BIRB.flightProbe()?.tuning;
    return t && t.invertPitch === false ? 1 : -1;
  });
  const flap = await page.evaluate(async (y) => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    B.setAltitude(220);
    const c0 = B.flightAudio().whooshCount;
    const d0 = B.flightAudio().downstrokes;
    B.setStick(0, y);
    // Only whooshes that happen DURING the hold: `whooshLast` persists, and
    // read blindly it reports the last forced beat above (7.2 rad/s, 0.0139).
    let peak = 0;
    let seen = c0;
    for (let i = 0; i < 90; i += 1) {
      await raf();
      const a = B.flightAudio();
      if (a.whooshCount > seen) { peak = Math.max(peak, a.whooshLast); seen = a.whooshCount; }
    }
    B.setStick(0, 0);
    const p = B.flightAudio();
    return { whooshes: p.whooshCount - c0, downstrokes: p.downstrokes - d0, peak };
  }, climbSign * 0.6);
  ctx.log(`climb: ${flap.whooshes} whooshes / ${flap.downstrokes} downstrokes in 90 frames, loudest ${flap.peak.toFixed(4)}`);
  ctx.check(flap.whooshes >= 3, `whooshCount increases while the bird flaps (${flap.whooshes} in 90 frames)`);

  // ---- 3. The stall buffet ------------------------------------------------
  // Nose near-vertical at idle throttle, hands off: the energy model bleeds
  // the speed through the stall line (the hammerhead, G-STUNT-1).
  const U = [0.3, 0.9, 0.3];
  await page.evaluate(() => window.__BIRB.setSprint(false));
  const level = await page.evaluate(() => window.__BIRB.capturePose());
  const levelBuffet = await page.evaluate(async () => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    B.setAltitude(220);
    let maxBuffet = 0;
    for (let i = 0; i < 30; i += 1) { await raf(); maxBuffet = Math.max(maxBuffet, B.flightAudio().buffet); }
    return maxBuffet;
  });
  ctx.check(levelBuffet === 0, `no buffet in level cruise (max ${levelBuffet})`);
  await ctx.place({ U, above: 240, pitch: -1.45, settle: 4 });
  const stall = await page.evaluate(async () => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    B.freeze(false);
    B.setPad(0, 0);
    let maxBuffet = 0; let stalledFrames = 0; let modelStalled = 0; let minSpeed = Infinity;
    for (let i = 0; i < 120; i += 1) {
      await raf();
      const a = B.flightAudio();
      maxBuffet = Math.max(maxBuffet, a.buffet);
      if (a.stalled) stalledFrames += 1;
      if (a.modelStalled) modelStalled += 1;
      minSpeed = Math.min(minSpeed, a.speed);
    }
    const out = B.flightAudio({ measure: true });
    B.setPad(null);
    return { maxBuffet, stalledFrames, modelStalled, minSpeed, rms: out.measured.rms };
  });
  ctx.log(`stall: buffet max ${stall.maxBuffet}, stalled frames ${stall.stalledFrames} (model ${stall.modelStalled}), min speed ${stall.minSpeed}`);
  ctx.check(stall.modelStalled > 0, `the stunt model stalls nose-up at idle throttle (${stall.modelStalled} frames)`);
  ctx.check(stall.maxBuffet >= 0.7, `the buffet sounds in the stall (max ${stall.maxBuffet})`);

  // A boost is NOT a stall, even though the controller's own test says so
  // for its first few frames (it measures against the boosted target).
  await page.evaluate((p) => { const B = window.__BIRB; B.restorePose(p); B.setAltitude(220); }, level);
  await ctx.frames(20);
  const boost = await page.evaluate(async () => {
    const B = window.__BIRB;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const el = document.querySelector('[data-boost]');
    const r = el.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 91, bubbles: true, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
    let boosting = 0; let modelStalled = 0; let maxBuffet = 0;
    for (let i = 0; i < 16; i += 1) {
      await raf();
      const a = B.flightAudio();
      if (a.boosting) boosting += 1;
      if (a.boosting && a.modelStalled) modelStalled += 1;
      maxBuffet = Math.max(maxBuffet, a.buffet);
    }
    return { boosting, modelStalled, maxBuffet };
  });
  ctx.log(`boost: ${boost.boosting} boosting frames, controller reported a stall on ${boost.modelStalled} of them, buffet max ${boost.maxBuffet}`);
  ctx.check(boost.boosting > 0, `the boost pill fired (${boost.boosting} frames)`);
  ctx.check(boost.maxBuffet === 0, `a boost never buffets (max ${boost.maxBuffet}; the controller reported a stall on ${boost.modelStalled} boost frames)`);

  await page.evaluate((p) => { const B = window.__BIRB; B.restorePose(p); B.setAltitude(40); }, level);
}
