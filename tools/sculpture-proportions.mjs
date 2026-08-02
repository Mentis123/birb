#!/usr/bin/env node
/**
 * sculpture-proportions.mjs — the measurable half of the likeness gate.
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
 * head, a chin, a shoulder line, the outer edge of an arm, the ground. Those are
 * points, not regions, and a point is far more locatable in a cluttered photo
 * than an outline. So the gate is a table of PROPORTIONS — each landmark's
 * height, and each span's width, as a fraction of the figure's crown-to-ground
 * height — read off a pixel grid and compared against the same fractions
 * computed from the model's own construction constants.
 *
 * The other half of the gate is `sculpture/LIKENESS.md`, a rubric of the things
 * this cannot measure, scored by eye against the matched-view contact sheet from
 * `tools/sculpture-sheet.mjs`. Neither half is sufficient. This one says so in
 * its own output rather than implying a completeness it does not have.
 */

import { FIGURE_LANDMARKS } from '../sculpture/src/model/figure.js';

/**
 * Measured off `sculpture/reference/ref-a-front.jpg` — the NEAREST figure, which
 * is the largest, least occluded and least foreshortened full figure in any of
 * the four photographs — and cross-checked against the third figure in the same
 * frame. Method: crop, overlay a 50px grid, read each landmark in original-image
 * coordinates. Crown y=287, ground y=1187, so the figure stands 900px and every
 * fraction is (1187 - y) / 900. Widths are read from the LEFT edge and doubled
 * about her centre line at x=422, because her right side merges into the
 * neighbour standing behind her.
 *
 * TWO CORRECTIONS FROM THE PREVIOUS VERSION, both worth keeping.
 *
 * 1. THE NORMALISER IS NOW THE CROWN, not the top of the cowl. The cowl's height
 *    varies from figure to figure — on the nearest figure it stops at her
 *    shoulders and her head stands completely free — so normalising by it
 *    measures different figures against different rulers. The crown is the one
 *    landmark every figure has and every photograph shows.
 *
 * 2. `headHeight` WAS WRONG BY 45%, and the bad normaliser is exactly why. The
 *    old table put the crown at 0.952 and the chin at 0.832 of a cowl height,
 *    making the head 0.120 of the figure. Measured against the crown on two
 *    figures independently it is 0.183 and 0.167. The model has been building
 *    heads two-thirds the size they should be, which is most of why the renders
 *    read as small-headed and long-necked beside the photographs.
 *
 * That is the second time a landmark table on this model has been confidently
 * wrong, and both times the tell was identical: the gate was green and the
 * render did not look like the photograph. WHEN THE GATE AND THE EYE DISAGREE,
 * RE-MEASURE. A gate is only ever as good as the landmarks fed to it.
 *
 * Uncertainty is roughly +/-10 image pixels on a soft landmark such as the
 * shoulder line or the fullest point of the bust, i.e. about +/-0.011 here. The
 * 0.030 tolerance sits well outside that, so the gate never fails on eyesight.
 */
export const REFERENCE = {
    source: 'ref-a-front.jpg, nearest figure, 900px crown-to-ground; cross-checked on the third figure',
    tolerance: 0.030,
    heights: {
        headCrown: 1.000,
        brow: 0.923,
        nose: 0.888,
        chin: 0.827,
        shoulder: 0.797,
        bust: 0.665,
        headHeight: 0.175,
    },
    // Read from the left edge at four heights: shoulder y=505 x=275, bust y=645
    // x=268, waist y=760 x=262, hem y=1170 x=248, doubled about x=422. They
    // widen monotonically from shoulder to hem — she is a straight taper, with
    // no waist to speak of, and that is most of what makes these figures read as
    // heavy rather than as mannequins.
    widths: {
        headWidth: 0.150,
        shoulderSpan: 0.327,
        bustSpan: 0.342,
        waistSpan: 0.356,
        hemSpan: 0.387,
    },
};

function main() {
    const model = FIGURE_LANDMARKS;
    const total = model.headCrown;

    const rows = [];
    let worst = 0;
    let fails = 0;

    const check = (group, key, want) => {
        const raw = model[key];
        if (raw === undefined) return;
        const got = raw / total;
        const err = got - want;
        const ok = Math.abs(err) <= REFERENCE.tolerance;
        if (!ok) fails++;
        if (Math.abs(err) > Math.abs(worst)) worst = err;
        rows.push({ group, key, want, got, err, ok });
    };

    for (const [k, v] of Object.entries(REFERENCE.heights)) check('height', k, v);
    for (const [k, v] of Object.entries(REFERENCE.widths)) check('width', k, v);

    const pad = (s, n) => String(s).padEnd(n);
    let group = '';
    console.log('landmark        reference   model     error');
    for (const r of rows) {
        if (r.group !== group) {
            group = r.group;
            console.log(`--- ${group}s ${'-'.repeat(38 - group.length)}`);
        }
        console.log(
            pad(r.key, 15) + pad(r.want.toFixed(3), 12) + pad(r.got.toFixed(3), 10)
            + (r.err >= 0 ? '+' : '') + r.err.toFixed(3) + (r.ok ? '' : '   FAIL')
        );
    }
    console.log('------------------------------------------------');
    console.log(`tolerance +/-${REFERENCE.tolerance}  |  worst ${worst >= 0 ? '+' : ''}${worst.toFixed(3)}  |  ${fails} of ${rows.length} outside`);
    console.log('');
    console.log('Proportion only. Drapery, pose, face, surface and arrangement are');
    console.log('not measured here — those are sculpture/LIKENESS.md, scored by eye');
    console.log('against the matched-view sheet from tools/sculpture-sheet.mjs.');

    process.exit(fails > 0 ? 1 : 0);
}

main();
