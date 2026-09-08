/**
 * icons/microsoft-fabric.js — the Microsoft Fabric mark from the Azure Visio
 * icon collection requested for this study.
 *
 * Source path data, gradients and translations are transcribed verbatim from:
 * https://github.com/fergusstrachan/David-Summers-Azure-Design/blob/master/SVG_Azure_All/Microsoft%20Fabric.svg
 *
 * `translate` carries the source's nested group transforms separately from the
 * path strings. This keeps the recipe auditable while the shared plate builder
 * composes path and gradient coordinates into one final SVG frame.
 */

const lower = {
    type: 'linear', units: 'userSpaceOnUse', x1: -0.46856334, y1: 92.32269, x2: 22.492283, y2: 92.32269,
    transform: 'scale(1.1146045,0.89717923)',
    stops: [[0.055, '#2aac94'], [0.155, '#239c87'], [0.37, '#177e71'], [0.59, '#0e6961'], [0.8, '#095d57'], [1, '#085954']],
};

const middle = {
    type: 'linear', units: 'userSpaceOnUse', x1: 0, y1: 89.306554, x2: 34.606589, y2: 89.306554,
    transform: 'scale(1.1974598,0.83510109)',
    stops: [[0.04, '#abe88e'], [0.55, '#2aaa92'], [0.905, '#117865']],
};

const upper = {
    type: 'linear', units: 'userSpaceOnUse', x1: 0, y1: 92.453786, x2: 40.993013, y2: 92.453786,
    transform: 'scale(1.2895902,0.77544011)',
    stops: [[0.045, '#25ffd4'], [0.875, '#55ddb9']],
};

export default {
    id: 'microsoft-fabric',
    productId: 'fabric',
    name: 'Microsoft Fabric',
    source: 'https://github.com/fergusstrachan/David-Summers-Azure-Design/blob/master/SVG_Azure_All/Microsoft%20Fabric.svg',
    viewBox: [0, 0, 57.171603, 56.665316],
    defaultBuilder: 'plates',
    pieces: [
        {
            id: 'lower', layer: 0, translate: [0.522263, -46.764673],
            d: 'M 1.82,85.86 0.98,88.9 C 0.67,89.87 0.24,91.3 0,92.57 a 8.0463,7.97353 -180 0 0 6.63,10.75 c 1.13,0.16 2.41,0.15 3.85,-0.06 l 6.59,-0.9 a 4.17967,4.14187 -180 0 0 3.46,-3.01 l 4.54,-16.52 z',
            fill: { base: lower },
        },
        {
            id: 'middle', layer: 1, translate: [0.399331, -57.334673],
            d: 'M 8.38,97.21 C 1.43,98.28 0,103.48 0,103.48 L 6.66,79.24 41.44,74.58 36.7,91.65 a 2.43862,2.41656 0 0 1 -1.99,1.76 l -0.19,0.03 -26.34,3.81 z',
            fill: { base: middle },
        },
        {
            id: 'upper', layer: 2, translate: [4.307411, -71.692373],
            d: 'm 8.41,96.11 38.51,-5.64 a 2.28281,2.26216 -180 0 0 1.89,-1.66 L 52.78,74.56 A 2.27995,2.25933 -180 0 0 50.3,71.71 L 13.56,77.09 A 10.2705,10.1776 -180 0 0 5.3,84.45 L 0,103.48 c 1.06,-3.85 1.72,-6.17 8.41,-7.37 z',
            fill: { base: upper },
        },
    ],
};
