/**
 * model/svg-gradient.js — SVG gradients as numbers, evaluated in JS and in GLSL.
 *
 * Pure, no THREE. A fill is a base gradient plus an optional overlay gradient
 * (the highlight sheen Microsoft's icons paint as a second, semi-transparent
 * copy of the same path). Both are described exactly as the SVG describes them —
 * `gradientUnits`, `gradientTransform`, stop offsets, stop colours and
 * stop-opacity — so the table in `icons/*.js` is a transcription of the source
 * file, not an artist's approximation of it.
 *
 * `evaluateFill()` is the reference implementation the tests and the colour
 * gate use. `fillGLSL()` emits the same maths as a GLSL function so the GPU
 * evaluates the gradient PER PIXEL. That matters: an extruded cap is a handful
 * of large triangles, and a gradient sampled at their corners and interpolated
 * across them is visibly wrong — the sweep of a radial gradient cannot be
 * reconstructed from three vertex colours.
 *
 * Interpolation is done in sRGB with premultiplied alpha, which is what Skia
 * does for SVG gradients, and the result is converted to linear at the end so
 * it can be handed to a physically based material as albedo.
 */

const DEG = Math.PI / 180;

/** Affine [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(m, n) {
    // m ∘ n — apply n first, then m.
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ];
}

export function invert(m) {
    const [a, b, c, d, e, f] = m;
    const det = a * d - b * c;
    if (!det) throw new Error('svg-gradient: singular gradientTransform');
    return [
        d / det, -b / det, -c / det, a / det,
        (c * f - d * e) / det, (b * e - a * f) / det,
    ];
}

export function apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Parse an SVG transform list ("translate(1 2) rotate(30) scale(2)") into one matrix. */
export function parseTransform(str) {
    let m = IDENTITY.slice();
    if (!str) return m;
    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = re.exec(str))) {
        const name = match[1];
        const v = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
        let t;
        switch (name) {
            case 'matrix': t = v; break;
            case 'translate': t = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
            case 'scale': t = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]; break;
            case 'rotate': {
                const a = (v[0] || 0) * DEG, cs = Math.cos(a), sn = Math.sin(a);
                t = [cs, sn, -sn, cs, 0, 0];
                if (v.length > 2) {
                    t = multiply([1, 0, 0, 1, v[1], v[2]], multiply(t, [1, 0, 0, 1, -v[1], -v[2]]));
                }
                break;
            }
            case 'skewX': t = [1, 0, Math.tan((v[0] || 0) * DEG), 1, 0, 0]; break;
            case 'skewY': t = [1, Math.tan((v[0] || 0) * DEG), 0, 1, 0, 0]; break;
            default: throw new Error(`svg-gradient: unsupported transform ${name}`);
        }
        m = multiply(m, t);
    }
    return m;
}

/** "#RRGGBB" / "#RGB" → [r, g, b] in 0..1 sRGB. */
export function hexToRgb(hex) {
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Pre-compute everything a gradient needs. `bbox` is only consulted for
 * `objectBoundingBox` units.
 *
 * @param {object} g  { type:'linear'|'radial', units?, transform?, stops:[[offset, '#hex', opacity?]],
 *                      x1,y1,x2,y2 | cx,cy,r }
 * @param {number[]} [bbox] [minX, minY, maxX, maxY] of the filled path
 */
export function compileGradient(g, bbox) {
    const units = g.units || 'objectBoundingBox';
    let pre = IDENTITY;
    if (units === 'objectBoundingBox') {
        if (!bbox) throw new Error('svg-gradient: objectBoundingBox gradient needs the path bbox');
        const w = bbox[2] - bbox[0] || 1, h = bbox[3] - bbox[1] || 1;
        // user → bbox space
        pre = [1 / w, 0, 0, 1 / h, -bbox[0] / w, -bbox[1] / h];
    }
    const inv = multiply(invert(parseTransform(g.transform)), pre);
    const stops = g.stops.map(([offset, hex, opacity]) => ({
        offset, rgb: hexToRgb(hex), a: opacity === undefined ? 1 : opacity,
    })).sort((p, q) => p.offset - q.offset);
    if (g.type === 'radial') {
        const r = g.r === undefined ? 0.5 : g.r;
        return { kind: 'radial', inv, cx: g.cx === undefined ? 0.5 : g.cx, cy: g.cy === undefined ? 0.5 : g.cy, r, stops };
    }
    const x1 = g.x1 === undefined ? 0 : g.x1, y1 = g.y1 === undefined ? 0 : g.y1;
    const x2 = g.x2 === undefined ? 1 : g.x2, y2 = g.y2 === undefined ? 0 : g.y2;
    return { kind: 'linear', inv, x1, y1, dx: x2 - x1, dy: y2 - y1, stops };
}

/** Gradient parameter t (pad-clamped to 0..1) at a user-space point. */
export function gradientParam(cg, x, y) {
    const [gx, gy] = apply(cg.inv, x, y);
    let t;
    if (cg.kind === 'radial') {
        t = Math.hypot(gx - cg.cx, gy - cg.cy) / cg.r;
    } else {
        const dd = cg.dx * cg.dx + cg.dy * cg.dy;
        t = dd ? ((gx - cg.x1) * cg.dx + (gy - cg.y1) * cg.dy) / dd : 0;
    }
    return Math.max(0, Math.min(1, t));
}

/** Premultiplied sRGB stop interpolation → [r, g, b, a] straight alpha. */
export function sampleStops(stops, t) {
    if (t <= stops[0].offset) { const s = stops[0]; return [s.rgb[0], s.rgb[1], s.rgb[2], s.a]; }
    for (let i = 1; i < stops.length; i++) {
        const s0 = stops[i - 1], s1 = stops[i];
        if (t <= s1.offset) {
            const span = s1.offset - s0.offset;
            const f = span > 0 ? (t - s0.offset) / span : 1;
            const a = s0.a + (s1.a - s0.a) * f;
            const rgb = [0, 1, 2].map((k) => s0.rgb[k] * s0.a * (1 - f) + s1.rgb[k] * s1.a * f);
            return a > 0 ? [rgb[0] / a, rgb[1] / a, rgb[2] / a, a] : [s1.rgb[0], s1.rgb[1], s1.rgb[2], 0];
        }
    }
    const s = stops[stops.length - 1];
    return [s.rgb[0], s.rgb[1], s.rgb[2], s.a];
}

/**
 * Compile a piece's fill (base + optional overlay).
 * @param {object} fill { base: gradient|'#hex', overlay?: gradient }
 * @param {number[]} bbox
 */
export function compileFill(fill, bbox) {
    const base = typeof fill.base === 'string'
        ? { kind: 'solid', rgb: hexToRgb(fill.base) }
        : compileGradient(fill.base, bbox);
    const overlay = fill.overlay ? compileGradient(fill.overlay, bbox) : null;
    return { base, overlay };
}

/** Reference evaluation: sRGB [r, g, b] in 0..1 at a user-space point. */
export function evaluateFill(cf, x, y) {
    let rgb = cf.base.kind === 'solid'
        ? cf.base.rgb.slice()
        : sampleStops(cf.base.stops, gradientParam(cf.base, x, y)).slice(0, 3);
    if (cf.overlay) {
        const [r, g, b, a] = sampleStops(cf.overlay.stops, gradientParam(cf.overlay, x, y));
        rgb = [rgb[0] + (r - rgb[0]) * a, rgb[1] + (g - rgb[1]) * a, rgb[2] + (b - rgb[2]) * a];
    }
    return rgb;
}

const f = (n) => {
    const s = Number(n).toPrecision(9);
    return /[.e]/.test(s) ? s : s + '.0';
};

function gradientGLSL(cg, prefix) {
    const m = cg.inv;
    const lines = [];
    lines.push(`vec2 ${prefix}q = vec2(${f(m[0])} * p.x + ${f(m[2])} * p.y + ${f(m[4])}, ${f(m[1])} * p.x + ${f(m[3])} * p.y + ${f(m[5])});`);
    if (cg.kind === 'radial') {
        lines.push(`float ${prefix}t = clamp(length(${prefix}q - vec2(${f(cg.cx)}, ${f(cg.cy)})) / ${f(cg.r)}, 0.0, 1.0);`);
    } else {
        const dd = cg.dx * cg.dx + cg.dy * cg.dy || 1;
        lines.push(`float ${prefix}t = clamp(((${prefix}q.x - ${f(cg.x1)}) * ${f(cg.dx)} + (${prefix}q.y - ${f(cg.y1)}) * ${f(cg.dy)}) / ${f(dd)}, 0.0, 1.0);`);
    }
    // Premultiplied chain of mixes: each mix only engages once t passes its stop.
    const s0 = cg.stops[0];
    lines.push(`vec4 ${prefix}c = vec4(${f(s0.rgb[0] * s0.a)}, ${f(s0.rgb[1] * s0.a)}, ${f(s0.rgb[2] * s0.a)}, ${f(s0.a)});`);
    for (let i = 1; i < cg.stops.length; i++) {
        const a = cg.stops[i - 1], b = cg.stops[i];
        const span = Math.max(1e-6, b.offset - a.offset);
        lines.push(`${prefix}c = mix(${prefix}c, vec4(${f(b.rgb[0] * b.a)}, ${f(b.rgb[1] * b.a)}, ${f(b.rgb[2] * b.a)}, ${f(b.a)}), clamp((${prefix}t - ${f(a.offset)}) / ${f(span)}, 0.0, 1.0));`);
    }
    return lines;
}

/**
 * GLSL for `vec3 <name>(vec2 p)` returning LINEAR rgb for a point in the
 * gradient's user space (SVG coordinates, y down).
 */
export function fillGLSL(name, cf) {
    const body = [];
    if (cf.base.kind === 'solid') {
        body.push(`vec3 rgb = vec3(${f(cf.base.rgb[0])}, ${f(cf.base.rgb[1])}, ${f(cf.base.rgb[2])});`);
    } else {
        body.push(...gradientGLSL(cf.base, 'b'));
        body.push('vec3 rgb = bc.a > 0.0 ? bc.rgb / bc.a : bc.rgb;');
    }
    if (cf.overlay) {
        body.push(...gradientGLSL(cf.overlay, 'o'));
        body.push('vec3 orgb = oc.a > 0.0 ? oc.rgb / oc.a : oc.rgb;');
        body.push('rgb = mix(rgb, orgb, oc.a);');
    }
    return [
        `vec3 ${name}(vec2 p) {`,
        ...body.map((l) => '    ' + l),
        '    vec3 lo = rgb / 12.92;',
        '    vec3 hi = pow((rgb + 0.055) / 1.055, vec3(2.4));',
        '    return mix(lo, hi, step(0.04045, rgb));',
        '}',
    ].join('\n');
}
