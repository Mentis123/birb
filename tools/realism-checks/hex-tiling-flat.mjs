/**
 * The hex path on the FLAT ground (?smooth=0): its own splice, its own
 * compile. The fetch replaces the triplanar block at <opaque_fragment>
 * instead of the hoisted one at <normal_fragment_begin>, and it chooses
 * projections by the radial (a flat-shaded ground has no continuous surface
 * normal). This boot proves that program compiles — the runner fails any
 * boot with a console error or warning — and that it stops the repeat too.
 */
import { assertNoRepeat } from './hex-tiling-repeat.mjs';
import { restore } from './hex-tiling-lib.mjs';

export const name = 'hex-tiling-flat';
export const query = 'hextile=1&smooth=0';

export default async function run(ctx) {
  await assertNoRepeat(ctx, 'flat');
  await restore(ctx);
}
