/**
 * Minimal Three-compatible geometry surface for sculpture unit tests.
 *
 * The application loads the full pinned Three.js build in the browser. Node CI
 * intentionally installs nothing, so geometry tests use only the data-path
 * operations needed by the procedural model instead of depending on a local
 * development package.
 */
class BufferAttribute {
    constructor(array, itemSize) {
        this.array = array;
        this.itemSize = itemSize;
        this.count = array.length / itemSize;
    }

    getX(i) { return this.array[i * this.itemSize]; }
    getY(i) { return this.array[i * this.itemSize + 1]; }
    getZ(i) { return this.array[i * this.itemSize + 2]; }
    setX(i, value) { this.array[i * this.itemSize] = value; }
    setY(i, value) { this.array[i * this.itemSize + 1] = value; }
    setZ(i, value) { this.array[i * this.itemSize + 2] = value; }
    setXYZ(i, x, y, z) {
        const offset = i * this.itemSize;
        this.array[offset] = x;
        this.array[offset + 1] = y;
        this.array[offset + 2] = z;
    }
}

class Float32BufferAttribute extends BufferAttribute {
    constructor(array, itemSize) {
        super(array instanceof Float32Array ? array : new Float32Array(array), itemSize);
    }
}

class Uint32BufferAttribute extends BufferAttribute {
    constructor(array, itemSize) {
        super(array instanceof Uint32Array ? array : new Uint32Array(array), itemSize);
    }
}

class BufferGeometry {
    constructor() {
        this.attributes = {};
        this.index = null;
    }

    setAttribute(name, attribute) {
        this.attributes[name] = attribute;
        return this;
    }

    setIndex(index) {
        this.index = index instanceof BufferAttribute
            ? index
            : new Uint32BufferAttribute(index, 1);
        return this;
    }

    scale(x, y, z) {
        const p = this.attributes.position;
        for (let i = 0; i < p.count; i++) {
            p.setXYZ(i, p.getX(i) * x, p.getY(i) * y, p.getZ(i) * z);
        }
        return this;
    }

    computeVertexNormals() {
        const p = this.attributes.position;
        const index = this.index;
        const values = new Float32Array(p.count * 3);
        const triangleCount = index ? index.count : p.count;
        for (let i = 0; i < triangleCount; i += 3) {
            const a = index ? index.getX(i) : i;
            const b = index ? index.getX(i + 1) : i + 1;
            const c = index ? index.getX(i + 2) : i + 2;
            const abx = p.getX(b) - p.getX(a);
            const aby = p.getY(b) - p.getY(a);
            const abz = p.getZ(b) - p.getZ(a);
            const acx = p.getX(c) - p.getX(a);
            const acy = p.getY(c) - p.getY(a);
            const acz = p.getZ(c) - p.getZ(a);
            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            for (const vertex of [a, b, c]) {
                values[vertex * 3] += nx;
                values[vertex * 3 + 1] += ny;
                values[vertex * 3 + 2] += nz;
            }
        }
        for (let i = 0; i < p.count; i++) {
            const offset = i * 3;
            const length = Math.hypot(values[offset], values[offset + 1], values[offset + 2]) || 1;
            values[offset] /= length;
            values[offset + 1] /= length;
            values[offset + 2] /= length;
        }
        this.attributes.normal = new Float32BufferAttribute(values, 3);
    }

    dispose() {}
}

class Vector2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
}

function signedArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const next = points[(i + 1) % points.length];
        area += points[i].x * next.y - next.x * points[i].y;
    }
    return area * 0.5;
}

function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function insideTriangle(point, a, b, c) {
    const ab = cross(a, b, point);
    const bc = cross(b, c, point);
    const ca = cross(c, a, point);
    return ab >= -1e-10 && bc >= -1e-10 && ca >= -1e-10;
}

function triangulateShape(contour, holes = []) {
    if (holes.length) throw new Error('Sculpture test adapter does not support polygon holes');
    if (contour.length < 3) return [];

    const remaining = [...contour.keys()];
    if (signedArea(contour) < 0) remaining.reverse();
    const triangles = [];
    let guard = remaining.length * remaining.length;
    while (remaining.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let i = 0; i < remaining.length; i++) {
            const ia = remaining[(i + remaining.length - 1) % remaining.length];
            const ib = remaining[i];
            const ic = remaining[(i + 1) % remaining.length];
            if (cross(contour[ia], contour[ib], contour[ic]) <= 1e-10) continue;
            if (remaining.some((index) => index !== ia && index !== ib && index !== ic
                && insideTriangle(contour[index], contour[ia], contour[ib], contour[ic]))) continue;
            triangles.push([ia, ib, ic]);
            remaining.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) throw new Error('Unable to triangulate sculpture shell cap');
    }
    if (remaining.length === 3) triangles.push(remaining);
    return triangles;
}

export const SCULPTURE_THREE = Object.freeze({
    BufferGeometry,
    Float32BufferAttribute,
    Uint32BufferAttribute,
    Vector2,
    ShapeUtils: Object.freeze({ triangulateShape }),
});
