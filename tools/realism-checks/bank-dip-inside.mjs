/**
 * The bank dip lowers the INSIDE wing.
 *
 * The rig's "dip the wing on the turn direction" term dipped the group NAMED
 * leftWing into a left turn. That group is built at model +Z, and the model
 * faces +X, so +Z is the bird's RIGHT: the dip raised the inside wing against
 * every roll. The names cannot settle which wing is which, so this check does
 * not read them — it takes whichever tip sits at +Z in the bird's own frame
 * (birdPose() reports tips in the model frame: nose +X, up +Y, span on Z) as
 * the right wing, and asserts that a right roll puts it BELOW the left one
 * and a left roll the reverse. Flown at 220 units so no terrain, thermal or
 * landing can touch the stick.
 */
export const name = 'bank-dip-inside';

const SAMPLE = `const p = B.birdPose();
  return { l: p.leftTip, r: p.rightTip, rec: B.flightProbe().recovery };`;

// Right wing minus left wing tip height, with sides decided by position.
const rightMinusLeft = (s) => {
  if (!s.l || !s.r) return NaN;
  const [right, left] = s.l[2] > s.r[2] ? [s.l, s.r] : [s.r, s.l];
  return right[1] - left[1];
};

export default async function run(ctx) {
  const { page } = ctx;
  const level = await page.evaluate(() => window.__BIRB.capturePose());
  const roll = async (x) => {
    await page.evaluate((p) => {
      const B = window.__BIRB;
      B.setRecovery?.('flying');
      B.restorePose(p);
      B.setAltitude(220);
    }, level);
    await ctx.frames(20);
    const rows = await ctx.hold({ x }, 24, SAMPLE);
    return rows.slice(8);
  };
  const right = await roll(0.8);
  const left = await roll(-0.8);
  const flew = [...right, ...left].every((s) => s.rec === 'flying');
  ctx.check(flew, 'the bird flew both rolls');
  const dR = ctx.stats(right.map(rightMinusLeft)).mean;
  const dL = ctx.stats(left.map(rightMinusLeft)).mean;
  ctx.check(dR < -0.05,
    `a RIGHT roll dips the right (inside) wing: right tip minus left tip ${dR.toFixed(3)} (want below -0.05)`);
  ctx.check(dL > 0.05,
    `a LEFT roll dips the left (inside) wing: right tip minus left tip ${dL.toFixed(3)} (want above 0.05)`);
  await page.evaluate((p) => window.__BIRB.restorePose(p), level);
}
