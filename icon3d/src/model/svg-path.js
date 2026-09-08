/**
 * model/svg-path.js — an SVG path-data parser that emits lines and cubics.
 *
 * Pure: no THREE, no DOM, so it unit-tests under `node --test` and the same
 * code drives both the extruder and the geometry gate. It understands the whole
 * SVG 1.1 path grammar — M L H V C S Q T A Z, absolute and relative, implicit
 * command repetition, the compact number forms exporters love ("1.5.5-1-2") and
 * arc flags written without separators ("a1 1 0 00-1 1").
 *
 * Every curve comes out as a cubic. Quadratics are degree-elevated exactly; an
 * arc is converted through the SVG spec's centre parameterisation and split into
 * quarter-turn cubics, which is the standard 4/3·tan(θ/4) approximation and is
 * accurate to well under a thousandth of the radius. Lines stay lines, so an
 * extruder can keep straight edges as single segments instead of spending
 * `curveSegments` points on them.
 *
 * Why not Three's SVGLoader: it lives in `examples/`, drags the whole SVG DOM
 * model in for one `d` attribute, and this artefact ships nothing but the core
 * build (see ARCHITECTURE.md). A path parser is two hundred lines and, unlike a
 * loader, it can be tested without a browser.
 */

/**
 * @typedef {{kind:'L', x:number, y:number}} LineSeg
 * @typedef {{kind:'C', x1:number, y1:number, x2:number, y2:number, x:number, y:number}} CubicSeg
 * @typedef {{x:number, y:number, segments:(LineSeg|CubicSeg)[], closed:boolean}} Subpath
 */

class Scanner {
    constructor(d) {
        this.s = d;
        this.i = 0;
    }
    skipSep() {
        const s = this.s;
        while (this.i < s.length) {
            const c = s.charCodeAt(this.i);
            // whitespace or comma
            if (c === 32 || c === 44 || c === 9 || c === 10 || c === 13 || c === 12) this.i++;
            else break;
        }
    }
    peekCommand() {
        this.skipSep();
        const c = this.s[this.i];
        return c !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(c) ? c : null;
    }
    readCommand() {
        const c = this.peekCommand();
        if (c) this.i++;
        return c;
    }
    hasNumber() {
        this.skipSep();
        const c = this.s[this.i];
        return c !== undefined && /[-+.0-9]/.test(c);
    }
    readNumber() {
        this.skipSep();
        const rest = this.s.slice(this.i);
        const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(rest);
        if (!m) throw new Error(`svg-path: expected a number at ${this.i} in "${this.s.slice(this.i, this.i + 24)}"`);
        this.i += m[0].length;
        return parseFloat(m[0]);
    }
    /** Arc flags are single characters and may butt up against the next token. */
    readFlag() {
        this.skipSep();
        const c = this.s[this.i];
        if (c !== '0' && c !== '1') throw new Error(`svg-path: expected an arc flag at ${this.i}`);
        this.i++;
        return c === '1';
    }
    done() {
        this.skipSep();
        return this.i >= this.s.length;
    }
}

/**
 * Convert one SVG arc into cubic segments (SVG 1.1 implementation notes F.6.5).
 * Returns [] for a zero-length arc and a single line when a radius is zero,
 * exactly as the spec says a renderer must.
 */
export function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    if (rx === 0 || ry === 0) return [{ kind: 'L', x: x2, y: y2 }];
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = phiDeg * Math.PI / 180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cosP * dx + sinP * dy;
    const y1p = -sinP * dx + cosP * dy;
    // Scale radii up if the endpoints are too far apart for them.
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
    const rx2 = rx * rx, ry2 = ry * ry;
    const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
    const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    let coef = Math.sqrt(Math.max(0, num / den));
    if (largeArc === sweep) coef = -coef;
    const cxp = coef * rx * y1p / ry;
    const cyp = -coef * ry * x1p / rx;
    const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
    const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

    const ang = (ux, uy, vx, vy) => {
        const dot = ux * vx + uy * vy;
        const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
        let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
    };
    const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

    const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
    const step = dTheta / n;
    const out = [];
    const map = (ux, uy) => [
        cx + rx * ux * cosP - ry * uy * sinP,
        cy + rx * ux * sinP + ry * uy * cosP,
    ];
    for (let i = 0; i < n; i++) {
        const a = theta1 + i * step, b = a + step;
        const k = 4 / 3 * Math.tan((b - a) / 4);
        const p0 = [Math.cos(a), Math.sin(a)];
        const p3 = [Math.cos(b), Math.sin(b)];
        const c1 = [p0[0] - k * Math.sin(a), p0[1] + k * Math.cos(a)];
        const c2 = [p3[0] + k * Math.sin(b), p3[1] - k * Math.cos(b)];
        const [x1c, y1c] = map(c1[0], c1[1]);
        const [x2c, y2c] = map(c2[0], c2[1]);
        // Land the final segment exactly on the requested endpoint so
        // floating-point drift can never leave a contour open.
        const [xe, ye] = i === n - 1 ? [x2, y2] : map(p3[0], p3[1]);
        out.push({ kind: 'C', x1: x1c, y1: y1c, x2: x2c, y2: y2c, x: xe, y: ye });
    }
    return out;
}

/**
 * Parse an SVG `d` attribute.
 * @param {string} d
 * @returns {Subpath[]}
 */
export function parsePath(d) {
    const sc = new Scanner(String(d));
    /** @type {Subpath[]} */
    const subpaths = [];
    let cur = null;
    let x = 0, y = 0;           // current point
    let sx = 0, sy = 0;         // subpath start
    let lastCmd = '';
    let cx2 = 0, cy2 = 0;       // last cubic control point (for S)
    let qx = 0, qy = 0;         // last quadratic control point (for T)

    const begin = (nx, ny) => {
        cur = { x: nx, y: ny, segments: [], closed: false };
        subpaths.push(cur);
        x = sx = nx; y = sy = ny;
    };
    const ensure = () => {
        if (!cur) begin(x, y);
    };
    const line = (nx, ny) => {
        ensure();
        cur.segments.push({ kind: 'L', x: nx, y: ny });
        x = nx; y = ny;
    };
    const cubic = (x1, y1, x2, y2, nx, ny) => {
        ensure();
        cur.segments.push({ kind: 'C', x1, y1, x2, y2, x: nx, y: ny });
        cx2 = x2; cy2 = y2;
        x = nx; y = ny;
    };

    let cmd = null;
    while (!sc.done()) {
        const next = sc.readCommand();
        if (next) cmd = next;
        else if (!cmd) throw new Error('svg-path: path data must start with a command');
        else if (cmd === 'Z' || cmd === 'z') throw new Error('svg-path: numbers after Z without a command');
        // Implicit repetition: numbers after M continue as L.
        if (!next && (cmd === 'M' || cmd === 'm')) cmd = cmd === 'M' ? 'L' : 'l';

        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        switch (C) {
            case 'M': {
                const nx = sc.readNumber(), ny = sc.readNumber();
                // A subpath that was closed and then moved: start a fresh one.
                begin(rel ? x + nx : nx, rel ? y + ny : ny);
                break;
            }
            case 'L': {
                const nx = sc.readNumber(), ny = sc.readNumber();
                line(rel ? x + nx : nx, rel ? y + ny : ny);
                break;
            }
            case 'H': { const nx = sc.readNumber(); line(rel ? x + nx : nx, y); break; }
            case 'V': { const ny = sc.readNumber(); line(x, rel ? y + ny : ny); break; }
            case 'C': {
                const a = sc.readNumber(), b = sc.readNumber(), c = sc.readNumber(),
                    dd = sc.readNumber(), e = sc.readNumber(), f = sc.readNumber();
                const ox = rel ? x : 0, oy = rel ? y : 0;
                cubic(ox + a, oy + b, ox + c, oy + dd, ox + e, oy + f);
                break;
            }
            case 'S': {
                const c = sc.readNumber(), dd = sc.readNumber(), e = sc.readNumber(), f = sc.readNumber();
                const ox = rel ? x : 0, oy = rel ? y : 0;
                const refl = (lastCmd === 'C' || lastCmd === 'S');
                const x1 = refl ? 2 * x - cx2 : x, y1 = refl ? 2 * y - cy2 : y;
                cubic(x1, y1, ox + c, oy + dd, ox + e, oy + f);
                break;
            }
            case 'Q': {
                const a = sc.readNumber(), b = sc.readNumber(), e = sc.readNumber(), f = sc.readNumber();
                const ox = rel ? x : 0, oy = rel ? y : 0;
                const qcx = ox + a, qcy = oy + b, nx = ox + e, ny = oy + f;
                qx = qcx; qy = qcy;
                cubic(x + 2 / 3 * (qcx - x), y + 2 / 3 * (qcy - y),
                    nx + 2 / 3 * (qcx - nx), ny + 2 / 3 * (qcy - ny), nx, ny);
                break;
            }
            case 'T': {
                const e = sc.readNumber(), f = sc.readNumber();
                const ox = rel ? x : 0, oy = rel ? y : 0;
                const refl = (lastCmd === 'Q' || lastCmd === 'T');
                const qcx = refl ? 2 * x - qx : x, qcy = refl ? 2 * y - qy : y;
                const nx = ox + e, ny = oy + f;
                qx = qcx; qy = qcy;
                cubic(x + 2 / 3 * (qcx - x), y + 2 / 3 * (qcy - y),
                    nx + 2 / 3 * (qcx - nx), ny + 2 / 3 * (qcy - ny), nx, ny);
                break;
            }
            case 'A': {
                const rx = sc.readNumber(), ry = sc.readNumber(), rot = sc.readNumber();
                const large = sc.readFlag(), sweep = sc.readFlag();
                const e = sc.readNumber(), f = sc.readNumber();
                const nx = rel ? x + e : e, ny = rel ? y + f : f;
                ensure();
                for (const seg of arcToCubics(x, y, rx, ry, rot, large, sweep, nx, ny)) {
                    cur.segments.push(seg);
                    if (seg.kind === 'C') { cx2 = seg.x2; cy2 = seg.y2; }
                }
                x = nx; y = ny;
                break;
            }
            case 'Z': {
                if (cur) {
                    cur.closed = true;
                    x = sx; y = sy;
                    // The spec: after Z the next segment starts at the subpath
                    // start; a following non-M command begins a new subpath there.
                    cur = null;
                }
                break;
            }
            default:
                throw new Error(`svg-path: unsupported command ${cmd}`);
        }
        lastCmd = C;
    }
    return subpaths;
}

/** Evaluate a cubic at t. */
export function cubicPoint(x0, y0, x1, y1, x2, y2, x3, y3, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3];
}

/**
 * Flatten a subpath to a polyline (the start point first, without repeating it
 * at the end). `divisions` samples per cubic; lines contribute one point.
 */
export function flattenSubpath(sub, divisions = 8) {
    const pts = [[sub.x, sub.y]];
    let x = sub.x, y = sub.y;
    for (const s of sub.segments) {
        if (s.kind === 'L') {
            pts.push([s.x, s.y]);
        } else {
            for (let i = 1; i <= divisions; i++) {
                pts.push(cubicPoint(x, y, s.x1, s.y1, s.x2, s.y2, s.x, s.y, i / divisions));
            }
        }
        x = s.x; y = s.y;
    }
    // Drop a duplicated closing point so area and containment maths stay clean.
    const first = pts[0], last = pts[pts.length - 1];
    if (pts.length > 1 && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) pts.pop();
    return pts;
}

/** Signed polygon area (shoelace). Positive when the ring is counter-clockwise in a y-up frame. */
export function signedArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}

/** Bounding box of a list of subpaths, sampled along the curves: [minX, minY, maxX, maxY]. */
export function subpathsBounds(subpaths, divisions = 8) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sub of subpaths) {
        for (const [x, y] of flattenSubpath(sub, divisions)) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    }
    return [minX, minY, maxX, maxY];
}
