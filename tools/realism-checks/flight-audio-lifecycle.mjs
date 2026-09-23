/**
 * Hear the air — the lifecycle: the player's volume, the pause, a hidden tab.
 *
 * Driven through the game's OWN controls (the master slider, the SFX switch,
 * the gear button and its close button) and its own visibility handler, not
 * through the controller's methods: a hook that works when called directly
 * and is never called by the UI is the failure this exists to catch.
 *
 * Every UI change is put back at the end — the slider and the switch persist
 * to localStorage.
 */
export const name = 'flight-audio-lifecycle';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(page) {
  return page.evaluate(() => window.__BIRB.flightAudio());
}

export default async function run(ctx) {
  const { page } = ctx;
  await page.evaluate(() => { const B = window.__BIRB; B.freeze(false); B.setAltitude(200); });
  await ctx.frames(10);
  const p0 = await probe(page);
  ctx.check(p0.state === 'running' && p0.volume > 0, `running at the player's volume to start with (${p0.state}, ${p0.volume})`);

  // ---- The master slider, live ------------------------------------------
  const before = await page.evaluate(() => document.querySelector('[data-volume="master"]').value);
  await page.evaluate(() => {
    const s = document.querySelector('[data-volume="master"]');
    s.value = '30';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await ctx.frames(3);
  const p1 = await probe(page);
  ctx.check(Math.abs(p1.volume - 0.3) < 1e-9, `the master slider reaches the flight audio live (volume ${p1.volume})`);

  // ---- The SFX switch silences AND suspends; on again resumes -------------
  await page.evaluate(() => document.querySelector('[data-sound-toggle="sfx"]').click());
  await wait(300);
  await ctx.frames(3);
  const p2 = await probe(page);
  ctx.check(p2.volume === 0 && p2.state === 'suspended' && p2.suspendReason === 'muted',
    `SFX off: volume ${p2.volume}, context ${p2.state} (${p2.suspendReason}) — and a frame does not wake it`);
  await page.evaluate(() => document.querySelector('[data-sound-toggle="sfx"]').click());
  await wait(200);
  await ctx.frames(3);
  const p3 = await probe(page);
  ctx.check(p3.state === 'running' && Math.abs(p3.volume - 0.3) < 1e-9, `SFX on again: ${p3.state} at ${p3.volume}`);

  // ---- The gear button pauses the game, and the flight audio with it ------
  await page.evaluate(() => document.querySelector('[data-control="settings-open"]').click());
  await wait(400);
  const p4 = await probe(page);
  ctx.check(p4.state === 'suspended' && p4.suspendReason === 'paused', `settings open: ${p4.state} (${p4.suspendReason})`);
  await page.evaluate(() => document.querySelector('[data-control="settings-close"]').click());
  await ctx.frames(4);
  await wait(150);
  const p5 = await probe(page);
  ctx.check(p5.state === 'running' && p5.suspendReason === null, `settings closed: the next frame resumes it (${p5.state})`);

  // ---- A hidden tab -----------------------------------------------------
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wait(400);
  const p6 = await probe(page);
  ctx.check(p6.state === 'suspended' && p6.suspendReason === 'hidden', `tab hidden: ${p6.state} (${p6.suspendReason})`);
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await ctx.frames(4);
  await wait(150);
  const p7 = await probe(page);
  ctx.check(p7.state === 'running' && p7.suspendReason === null, `tab visible again: ${p7.state}`);

  // Put the player's settings back exactly.
  await page.evaluate((v) => {
    const s = document.querySelector('[data-volume="master"]');
    s.value = v;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  }, before);
  await ctx.frames(2);
  const p8 = await probe(page);
  ctx.check(Math.abs(p8.volume - Number(before) / 100) < 1e-9, `the slider is back where it was (${p8.volume})`);
}
