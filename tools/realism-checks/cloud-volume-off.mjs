/**
 * `?cloudvol=0` is the true before: the solid puffs, one per cloud on a
 * phone, alpha-eroded, opaque, hard-edged — and no real cloud shadows.
 *
 * The same measurement cloud-volume-look makes, on the same seeded cloud
 * from the same pose (goToCloud frames the cloud's COLLIDER centre, which is
 * identical in both boots). The soft-edge claim is only a claim if the
 * control boot measures hard.
 */
import { measureCloudEdge } from './cloud-volume-look.mjs';

export const name = 'cloud-volume-off';
export const query = 'cloudvol=0&flight=classic';

export default async function run(ctx) {
  const m = await measureCloudEdge(ctx, 'solid');
  const { info, edge } = m;
  ctx.check(!!info && info.volumetric === false, `the clouds are the solid puffs (${info?.clouds} clouds, ${info?.puffs} puffs)`);
  const mat = info?.material || {};
  ctx.check(mat.transparent === false && mat.depthWrite === true && mat.side === 0 && mat.alphaTest === 0.5,
    `the phone's puffs are opaque, front-faced and alpha-eroded, as before (${JSON.stringify(mat)})`);
  ctx.check(info?.shadowSpheres === 0 && info?.tuning === null, 'no real cloud shadows, no volume tuning');
  ctx.check(edge.rays >= 8, `the cloud is in frame on ${edge.rays}/24 rays`);
  const ratio = edge.width / Math.max(1, edge.radius);
  // The width is REPORTED, not asserted: the noise erosion makes the solid's
  // rim ragged, so its 90-10 span measures holes, not a gradient. What makes
  // it a solid is that almost no pixel is partly covered.
  ctx.log(`solid rim: ${edge.width} px from 90% to 10% (${(ratio * 100).toFixed(1)}% of its ${edge.radius} px radius)`);
  ctx.check(m.partial <= 0.15,
    `the solid is solid: only ${(m.partial * 100).toFixed(1)}% of its ${m.foot} px footprint is partly covered`);
  ctx.check(m.controlFraction < 0.05, `the control pair is stable (${(m.controlFraction * 100).toFixed(2)}%)`);
  ctx.check(m.shown.calls - m.hidden.calls === 1 && m.shown.tris - m.hidden.tris === info.puffs * 80,
    `the solid puffs cost ${m.shown.calls - m.hidden.calls} call and ${m.shown.tris - m.hidden.tris} triangles`);
  await ctx.unfreeze();
}
