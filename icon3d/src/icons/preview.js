/** Build an inline, inert SVG preview from the same audited recipe as the 3D icon. */
const NS = 'http://www.w3.org/2000/svg';

function setAttrs(node, attrs) {
    for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined && value !== null && value !== '') node.setAttribute(key, String(value));
    }
    return node;
}

function gradientNode(fill, id) {
    if (typeof fill === 'string') return null;
    const radial = fill.type === 'radial';
    const node = document.createElementNS(NS, radial ? 'radialGradient' : 'linearGradient');
    setAttrs(node, radial
        ? { id, gradientUnits: fill.units, gradientTransform: fill.transform, cx: fill.cx, cy: fill.cy, r: fill.r }
        : { id, gradientUnits: fill.units, gradientTransform: fill.transform, x1: fill.x1, y1: fill.y1, x2: fill.x2, y2: fill.y2 });
    for (const [offset, colour, opacity = 1] of fill.stops) {
        node.append(setAttrs(document.createElementNS(NS, 'stop'), {
            offset, 'stop-color': colour, 'stop-opacity': opacity,
        }));
    }
    return node;
}

export function createIconPreview(icon) {
    const svg = setAttrs(document.createElementNS(NS, 'svg'), {
        viewBox: icon.viewBox.join(' '), preserveAspectRatio: 'xMidYMid meet',
        role: 'img', 'aria-label': `${icon.name} original 2D icon`,
    });
    const defs = document.createElementNS(NS, 'defs');
    svg.append(defs);
    const ordered = icon.pieces.map((piece, index) => ({ piece, index }))
        .sort((a, b) => (a.piece.layer || 0) - (b.piece.layer || 0) || a.index - b.index);
    for (const { piece, index } of ordered) {
        const transform = piece.translate ? `translate(${piece.translate[0]} ${piece.translate[1]})` : null;
        const addPath = (fill, suffix) => {
            const id = `preview-${icon.id}-${index}-${suffix}`;
            const gradient = gradientNode(fill, id);
            if (gradient) defs.append(gradient);
            svg.append(setAttrs(document.createElementNS(NS, 'path'), {
                d: piece.d,
                fill: gradient ? `url(#${id})` : fill,
                transform,
                'fill-rule': piece.fillRule || 'nonzero',
            }));
        };
        addPath(piece.fill.base, 'base');
        if (piece.fill.overlay) addPath(piece.fill.overlay, 'overlay');
    }
    return svg;
}
