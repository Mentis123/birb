/**
 * icons/ai-foundry.js — the Microsoft Foundry product mark.
 *
 * The path and gradient data below are transcribed verbatim from the current
 * Azure architecture icon set. The inspected source is mirrored at:
 * https://github.com/jajera/azure-icons/blob/main/icons/ai-machine-learning/ai-foundry.svg
 * and originates from Microsoft's Azure Architecture Center icon download:
 * https://learn.microsoft.com/en-us/azure/architecture/icons/
 *
 * The source paints its first path twice. The second paint is fully opaque, so
 * the first is invisible under SVG paint semantics and is intentionally not a
 * second coplanar plate. The three visible regions retain source paint order.
 */

const bridge = {
    type: 'linear', units: 'userSpaceOnUse', x1: 12.26, y1: 8.32, x2: 12.26, y2: 18.23,
    transform: 'translate(0 20) scale(1 -1)',
    stops: [[0.02, '#201ba6'], [0.64, '#2d29c7'], [1, '#201ba6']],
};

const arm = {
    type: 'linear', units: 'userSpaceOnUse', x1: 14.19, y1: 8.27, x2: 14.19, y2: 14.47,
    transform: 'translate(0 20) scale(1 -1)',
    stops: [[0, '#3530c3'], [0.5, '#6d71d1'], [0.97, '#c0bff5'], [1, '#e3e4ff']],
};

const stem = {
    type: 'linear', units: 'userSpaceOnUse', x1: 6.51, y1: 3, x2: 6.51, y2: 19.15,
    transform: 'translate(0 20) scale(1 -1)',
    stops: [[0, '#302ec9'], [0.45, '#302ec9'], [0.95, '#cacafb'], [1, '#7f7eaf']],
};

export default {
    id: 'ai-foundry',
    productId: 'foundry',
    name: 'Microsoft Foundry',
    source: 'https://learn.microsoft.com/en-us/azure/architecture/icons/',
    sourceMirror: 'https://github.com/jajera/azure-icons/blob/main/icons/ai-machine-learning/ai-foundry.svg',
    viewBox: [0, 0, 18, 18],
    defaultBuilder: 'plates',
    pieces: [
        {
            id: 'bridge', layer: 0,
            d: 'M11.96,11.68s.07-.1.07-.24v-3.87c0-.85.66-1.76,1.59-2.03-.06-.19-.64-2.11-.81-2.65-.17-.56-.67-1.9-1.29-1.9,0,0,0,0-.01,0h0s-.09.05-.13.13c-.32.58-.46,3.02-.46,4.84v2.26c.27.97.91,3.22.96,3.35,0,0,.05.1.09.1h0Z',
            fill: { base: bridge },
        },
        {
            id: 'arm', layer: 1,
            d: 'M16.01,5.46h-1.81c-1.21,0-2.17,1.09-2.17,2.11v3.87c0,.14-.04.24-.07.24s-.09-.1-.09-.1c0,0,.07.21.17.21h1.98c.62,0,2.48-.61,2.48-2.52v-3.25c0-.41-.24-.55-.49-.55Z',
            fill: { base: arm },
        },
        {
            id: 'stem', layer: 2,
            d: 'M2.34,17h5.38c2.35,0,3.2-2.03,3.2-3.81v-7.23c0-2.08.19-4.97.61-4.97h-3.23c-.77,0-1.43.82-2.18,2.48-.75,1.66-4.36,11.87-4.52,12.36-.26.79-.02,1.16.74,1.16Z',
            fill: { base: stem },
        },
    ],
};
