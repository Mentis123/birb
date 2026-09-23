/**
 * `?airsound=0` is the silent game exactly as it was: the flight-audio module
 * is never fetched, no controller exists (every hook in index.html is then a
 * no-op), and the hook says "off".
 *
 * The page's own resource timing is the witness for the fetch — a flag that
 * skipped the graph but still downloaded and evaluated the module would not
 * be the before, and a boot that pulls a module the offline cache might not
 * hold is exactly the failure class sw.js's CORE_ASSETS list exists for.
 * (The runner also fails this boot on any console error or warning.)
 */
export const name = 'flight-audio-off';
export const query = 'airsound=0';

export default async function run(ctx) {
  const { page } = ctx;
  await ctx.frames(10);
  const r = await page.evaluate(() => ({
    probe: window.__BIRB.flightAudio(),
    fetched: performance.getEntriesByType('resource').filter((e) => /flight-audio\.js/.test(e.name)).length,
    otherModules: performance.getEntriesByType('resource').filter((e) => /\/src\/.+\.js/.test(e.name)).length,
  }));
  ctx.check(r.probe && r.probe.state === 'off', `the hook reports off (${JSON.stringify(r.probe)})`);
  ctx.check(r.otherModules > 20, `resource timing sees the boot's modules (${r.otherModules})`);
  ctx.check(r.fetched === 0, `src/audio/flight-audio.js was never fetched (${r.fetched})`);
}
