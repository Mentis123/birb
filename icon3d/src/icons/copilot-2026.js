/**
 * icons/copilot-2026.js — the flatter Copilot mark Microsoft announced in
 * August 2026: the same two bands, no folds, no tucked-under geometry.
 *
 * Transcribed verbatim from the vector on Wikimedia Commons
 * (https://commons.wikimedia.org/wiki/File:Microsoft-copilot-2026-seeklogo.svg),
 * an Illustrator export whose radial gradients sit at an absurd centre
 * (987, 1216) with a 2-unit radius and a translate/rotate/scale/skewX transform
 * doing all the work — a good stress test for the gradient evaluator, and the
 * reason it takes the whole transform list rather than a rotation angle.
 *
 * Both bands are painted at the same level: nothing overlaps, so nothing needs
 * a layer of its own. It is here because it is the current mark and because a
 * second table proves the pipeline is not shaped around the first one.
 */

const band_blue = {
    type: 'radial', units: 'userSpaceOnUse', cx: 987.21, cy: 1216.02, r: 2,
    transform: 'translate(-402710.6509 -405348.4949) rotate(116.7194) scale(232.2644 -445.8898) skewX(-9.7245)',
    stops: [[0.25, '#109df2'], [0.72, '#aad445'], [0.97, '#ffd400']],
};
const band_blue_sheen = {
    type: 'linear', units: 'userSpaceOnUse', x1: 175.87, y1: 498.29, x2: 173.86, y2: 137.69,
    transform: 'translate(0 514) scale(1 -1)',
    stops: [[0, '#3dcbff'], [0.25, '#0588f7', 0]],
};
const band_pink = {
    type: 'radial', units: 'userSpaceOnUse', cx: 987.17, cy: 1215.84, r: 2,
    transform: 'translate(-214974.3479 -373904.6811) rotate(116.0466) scale(242.0348 -294.2735) skewX(.4853)',
    stops: [[0.07, '#8c48ff'], [0.5, '#f2598a'], [0.9, '#ffb152']],
};
const band_pink_sheen = {
    type: 'linear', units: 'userSpaceOnUse', x1: 337.55, y1: 400.48, x2: 337.35, y2: 302.27,
    transform: 'translate(0 514) scale(1 -1)',
    stops: [[0.06, '#f8adfa'], [0.71, '#a86edd', 0]],
};

export default {
    id: 'copilot-2026',
    name: 'Microsoft Copilot (2026 mark)',
    source: 'https://commons.wikimedia.org/wiki/File:Microsoft-copilot-2026-seeklogo.svg',
    viewBox: [-1, 15, 513, 481],
    defaultBuilder: 'plates',
    pieces: [
        {
            id: 'band_blue', layer: 0,
            d: 'M347.3,115.17l-5.16,20.63h-49.62c-36.77,0-68.82,25.03-77.74,60.7l-44.92,179.7h-89.69c-52.13,0-90.38-48.99-77.74-99.57L47.46,96.53C59.35,48.97,102.08,15.6,151.11,15.6h118.45c52.13,0,90.38,48.99,77.74,99.57Z',
            fill: { base: band_blue, overlay: band_blue_sheen },
        },
        {
            id: 'band_pink', layer: 0,
            d: 'M164.7,396.83l5.16-20.63h49.62c36.77,0,68.82-25.03,77.74-60.7l44.92-179.7h89.69c52.13,0,90.38,48.99,77.74,99.57l-45.02,180.1c-11.89,47.56-54.63,80.93-103.66,80.93h-118.45c-52.13,0-90.38-48.99-77.74-99.57Z',
            fill: { base: band_pink, overlay: band_pink_sheen },
        },
    ],
};
