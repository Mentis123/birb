#!/usr/bin/env node
/**
 * sculpture-proportions.mjs — the likeness gate.
 *
 * WHY NOT PIXEL IoU, which is what the plan for this scene promised.
 *
 * The plan called for thresholding the reference photographs into silhouettes
 * and scoring intersection-over-union against a matched render. That was tried
 * and abandoned, on evidence: the sculpture is dark bronze photographed against
 * dark winter trees, dark window mullions and its own cast shadow, with a
 * sunlit robe front that is BRIGHTER than the paving behind it. Luminance
 * thresholding, flood fill from the centre, and a blue-vs-neutral colour
 * discriminator were each tried and each produced a mask that leaked into the
 * trees or dropped the lit robe. An IoU computed against a mask like that is a
 * number that lies, and a lying number is worse than an honest eye.
 *
 * What CAN be read off those photographs accurately is a landmark: the top of a
 * cowl, a chin, a shoulder line, the ground. Those are points, not regions, and
 * a point is far more locatable in a cluttered photo than an outline. So the
 * gate is a table of vertical PROPORTIONS — each landmark's height as a
 * fraction of the figure's total height — measured off `ref-c-under.jpg` with a
 * pixel grid, and compared against the same fractions computed from the model's
 * own construction constants.
 *
 * That covers proportion, which is most of what "does it look like it" means at
 * a glance, and it explicitly does NOT cover surface, drapery or face — those
 * stay a visual judgement, and the report says so rather than implying a
 * completeness it does not have.
 */

import { FIGURE_LANDMARKS } from '../sculpture/src/model/figure.js';

/**
 * Measured from `sculpture/reference/ref-d-wide.jpg`, the FRONT-RIGHT figure —
 * the plain-headed one, and the only figure in any of the four photographs that
 * is unambiguously a single figure from crown to ground.
 *
 * Method: crop (690,250)-(1060,1180), overlay a 50px grid, read each landmark's
 * y. Crown at y=32, ground at y=880, so the figure stands 848 crop-pixels and
 * every fraction is (880 - y) / 848, then rescaled so the cowl top is 1.000.
 *
 * THE FIRST VERSION OF THIS TABLE WAS WRONG, and the way it was caught is worth
 * keeping. It was read off ref-c, where the nearest figure is turned away: the
 * mass at the top of that crop is the near figure's hood, but the FACE below it
 * belongs to a different figure standing further back and therefore smaller in
 * frame. Measuring across two figures produced a head sitting far too low
 * inside a cowl far too tall, the model was solved to match it exactly, the
 * gate went green — and the render visibly got worse. A gate is only ever as
 * good as the landmarks fed to it, so when the number and the eye disagree,
 * re-measure before believing the number.
 *
 * The correction that matters: the top of the figure IS THE HEAD. The cloak
 * rises only a little above the crown, and on some figures it is swept to one
 * side and does not pass over the head at all.
 *
 * Uncertainty is roughly +/-8 crop pixels on a soft landmark such as the
 * shoulder line, i.e. about +/-0.009 here. The 0.030 tolerance sits well
 * outside that so the gate never fails on my eyesight alone.
 */
export const REFERENCE = {
    source: 'ref-d-wide.jpg, front-right figure, 848px crown-to-ground',
    tolerance: 0.030,
    landmarks: {
        cowlTop: 1.000,
        headCrown: 0.952,
        brow: 0.916,
        nose: 0.886,
        chin: 0.832,
        shoulder: 0.790,
        bust: 0.707,
        headHeight: 0.121,
    },
};

function main() {
    const model = FIGURE_LANDMARKS;
    const total = model.cowlTop;

    const rows = [];
    let worst = 0;
    let fails = 0;

    for (const [key, want] of Object.entries(REFERENCE.landmarks)) {
        const raw = model[key];
        if (raw === undefined) continue;
        // headHeight is already a length; everything else is a height.
        const got = key === 'headHeight' ? raw / total : raw / total;
        const err = got - want;
        const ok = Math.abs(err) <= REFERENCE.tolerance;
        if (!ok) fails++;
        if (Math.abs(err) > Math.abs(worst)) worst = err;
        rows.push({ key, want, got, err, ok });
    }

    const pad = (s, n) => String(s).padEnd(n);
    console.log('landmark        reference   model     error');
    console.log('------------------------------------------------');
    for (const r of rows) {
        console.log(
            pad(r.key, 15) + pad(r.want.toFixed(3), 12) + pad(r.got.toFixed(3), 10)
            + (r.err >= 0 ? '+' : '') + r.err.toFixed(3) + (r.ok ? '' : '   FAIL')
        );
    }
    console.log('------------------------------------------------');
    console.log(`tolerance +/-${REFERENCE.tolerance}  |  worst ${worst >= 0 ? '+' : ''}${worst.toFixed(3)}  |  ${fails} of ${rows.length} outside`);
    console.log('');
    console.log('Proportion only. Drapery, face and surface are not measured here');
    console.log('and remain a visual judgement against sculpture/reference/.');

    process.exit(fails > 0 ? 1 : 0);
}

main();
