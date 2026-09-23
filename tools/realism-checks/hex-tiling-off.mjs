/**
 * Without ?hextile=1 the ground is the default ground: no hex capability is
 * attached at all, so there is nothing to flip on at runtime and the program
 * three compiles is the one every other check measures. The byte-for-byte
 * claim itself lives in tests/hex-tiling.test.js; this is the live page
 * agreeing with it.
 */
export const name = 'hex-tiling-off';

export default async function run(ctx) {
  const { page } = ctx;
  const state = await page.evaluate(() => window.__BIRB.hexTile());
  ctx.check(state === null, `the default boot builds no hex-tiled ground (${JSON.stringify(state)})`);
  const flipped = await page.evaluate(() => window.__BIRB.hexTile(true));
  ctx.check(flipped === null, `and it cannot be switched on without the flag (${JSON.stringify(flipped)})`);
  const flags = await page.evaluate(async () => {
    const { readBootFlag } = await import('/src/ui/boot-flags.js');
    const { hexTileRequested } = await import('/src/environment/ground-detail.js');
    return { panel: readBootFlag(location.search, 'hextile'), game: hexTileRequested(location.search) };
  });
  ctx.check(flags.panel?.value === null && flags.game === false,
    `the Flags tab and the game agree it is off (${JSON.stringify(flags)})`);
}
