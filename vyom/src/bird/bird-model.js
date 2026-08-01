/**
 * bird-model.js — VYOM's procedural chibi racer.
 *
 * The bird is the star: the chase camera stares at it for the entire race, so
 * it gets the tightest budget scrutiny in the project — **<= 9 draw calls and
 * <= 2.5k triangles per bird, outline hulls included**, with four birds on
 * screen at once.
 *
 * That budget rules out the obvious build (one mesh per articulated part plus
 * one hull each: body, head, beak, two wings, tail, two feet, four eye pieces
 * would be well over twenty draw calls). So the model uses two techniques to
 * get full articulation out of four meshes:
 *
 *   1. **Vertex colours instead of extra materials.** Belly, beak, eyes,
 *      pupils, highlights, feather tips and foot scales are all baked into one
 *      colour attribute per mesh at build time, so a whole assembly (skull +
 *      beak + crest + both eyes + pupils + highlights) is a single draw.
 *
 *   2. **Shader deformers instead of extra bones.** The tail fan/yaw/pitch and
 *      the wing-tip follow-through are done in the vertex shader from a handful
 *      of uniforms, weighted by the vertex's own position. The matching outline
 *      hull runs the *same* deformer, so the ink follows the deformation
 *      exactly — the usual failure of this trick (hull detaching from a bent
 *      wing tip) does not happen here.
 *
 * The result is 8 draw calls with outlines on, 4 with `outline: false`.
 *
 * Layout: forward is -Z, up is +Y. The bird's own right hand side is +X (same
 * convention as a camera looking down -Z), so `leftWing` sits at -X.
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import {
    ensureSmoothNormals,
    createOutlineMaterial,
} from '../core/outline.js';

// ---------------------------------------------------------------------------
// Build-time geometry helpers. These allocate freely — none of this runs in a
// frame. Everything is disposed into a single merged BufferGeometry.
// ---------------------------------------------------------------------------

/**
 * Apply a TRS to a geometry in place. Normals are carried through by
 * applyMatrix4's own normal matrix, so non-uniform scale (which is how the
 * flattened feathers and the egg body are made) still shades correctly.
 */
function xform(THREE, geo, tx, ty, tz, rx, ry, rz, sx, sy, sz) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ'));
    m.compose(
        new THREE.Vector3(tx || 0, ty || 0, tz || 0),
        q,
        new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz)
    );
    geo.applyMatrix4(m);
    return geo;
}

/**
 * A "feather": a cone rotated to point along +X with its base at the origin,
 * then flattened in Y. Every wing and tail surface in the bird is one of these,
 * which is what gives the silhouette its consistent layered-cone language.
 */
function feather(THREE, len, rad, seg, flatY, flatZ) {
    const g = new THREE.ConeGeometry(rad, len, seg, 1, false);
    // Cone points +Y with its base at -len/2. Rotate -90deg about Z so the tip
    // points +X, then slide the base onto the origin. Because Matrix4.compose
    // is T*R*S, the scale runs in the cone's OWN frame: local X becomes world
    // -Y after the rotation, so `flatY` has to be applied to X, not Y. (Scaling
    // Y here would shorten the feather instead of flattening it.)
    return xform(
        THREE, g, len * 0.5, 0, 0, 0, 0, -Math.PI / 2,
        flatY === undefined ? 1 : flatY, 1, flatZ === undefined ? 1 : flatZ
    );
}

/** Two-stop gradient painter, allocation-free per vertex (build time anyway). */
function gradient(THREE, hexA, hexB, fn) {
    const a = new THREE.Color(hexA);
    const b = new THREE.Color(hexB);
    return function paint(x, y, z, out) {
        out.copy(a).lerp(b, Math.min(1, Math.max(0, fn(x, y, z))));
    };
}

/**
 * Merge a list of `{ geo, color, mask }` entries into one BufferGeometry with
 * position / normal / color (and optionally aEyeMask) attributes.
 *
 * `color` is either a hex int or a function (x, y, z, outColor) so a single
 * primitive can carry a gradient — that is how the belly, the wing-tip ink and
 * the tail tips are painted without extra draw calls.
 */
function mergeGeos(THREE, entries, wantMask) {
    let total = 0;
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.geo.index) {
            const flat = e.geo.toNonIndexed();
            e.geo.dispose();
            e.geo = flat;
        }
        if (!e.geo.getAttribute('normal')) e.geo.computeVertexNormals();
        total += e.geo.getAttribute('position').count;
    }

    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    const mask = wantMask ? new Float32Array(total) : null;

    const c = new THREE.Color();
    let o = 0;
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const p = e.geo.getAttribute('position');
        const n = e.geo.getAttribute('normal');
        const isFn = typeof e.color === 'function';
        if (!isFn) c.setHex(e.color === undefined ? 0xffffff : e.color);
        for (let v = 0; v < p.count; v++) {
            const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
            const w = (o + v) * 3;
            position[w] = x; position[w + 1] = y; position[w + 2] = z;
            normal[w] = n.getX(v); normal[w + 1] = n.getY(v); normal[w + 2] = n.getZ(v);
            if (isFn) e.color(x, y, z, c);
            color[w] = c.r; color[w + 1] = c.g; color[w + 2] = c.b;
            if (mask) mask[o + v] = e.mask || 0;
        }
        o += p.count;
        e.geo.dispose();
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(position, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    out.setAttribute('color', new THREE.BufferAttribute(color, 3));
    if (mask) out.setAttribute('aEyeMask', new THREE.BufferAttribute(mask, 1));
    out.computeBoundingSphere();
    return out;
}

// ---------------------------------------------------------------------------
// Shader deformers.
//
// Both are written twice: once as a "normal" snippet (runs where objectNormal
// exists, before defaultnormal_vertex) and once as a "position" snippet (runs
// after begin_vertex, where `transformed` exists). The outline shader below
// concatenates the pair. Keeping them symmetric is what stops the ink from
// peeling off the deformed geometry.
// ---------------------------------------------------------------------------

const WING_UNIFORMS_GLSL = /* glsl */`
uniform float uCurl;
uniform float uSweep;
uniform float uSpanInv;
`;

/**
 * Wing follow-through. `uCurl` rotates the wing about its own long axis pivot
 * (the shoulder) by an amount that grows with the SQUARE of the distance out
 * the span, so the shoulder is rigid and the tip does all the bending. `uSweep`
 * trails the tip backwards in Z at the same weighting. Together they turn a
 * rigid plank into a wing with a whip in it.
 */
function wingDeform(nrmVar) {
    const bendAngle = /* glsl */`
    float vyS = clamp( abs( position.x ) * uSpanInv, 0.0, 1.0 );
    vyS = vyS * vyS;
    float vyA = uCurl * vyS * sign( position.x );
    float vyC = cos( vyA );
    float vySn = sin( vyA );
`;
    return {
        normal: /* glsl */`
    {
${bendAngle}
        float nx = ${nrmVar}.x, ny = ${nrmVar}.y;
        ${nrmVar}.x = nx * vyC - ny * vySn;
        ${nrmVar}.y = nx * vySn + ny * vyC;
    }
`,
        position: /* glsl */`
    {
${bendAngle}
        float px = transformed.x, py = transformed.y;
        transformed.x = px * vyC - py * vySn;
        transformed.y = px * vySn + py * vyC;
        transformed.z += uSweep * vyS;
    }
`,
    };
}

const TAIL_UNIFORMS_GLSL = /* glsl */`
uniform float uTailYaw;
uniform float uTailPitch;
uniform float uTailFan;
uniform float uTailZ;
uniform float uTailInv;
`;

/**
 * Tail fan + rudder, folded into the BODY mesh so the tail costs zero extra
 * draw calls. Weight is zero at the tail root (uTailZ) and 1 at the tip, so the
 * torso is untouched and the fan blends on smoothly.
 */
function tailDeform(nrmVar) {
    const w = /* glsl */`
    float vyW = clamp( ( position.z - uTailZ ) * uTailInv, 0.0, 1.0 );
    float vyA = uTailYaw * vyW;
    float vyB = uTailPitch * vyW;
    float vyCa = cos( vyA ), vySa = sin( vyA );
    float vyCb = cos( vyB ), vySb = sin( vyB );
`;
    return {
        normal: /* glsl */`
    {
${w}
        float nx = ${nrmVar}.x, ny = ${nrmVar}.y, nz = ${nrmVar}.z;
        float rx = nx * vyCa + nz * vySa;
        float rz = -nx * vySa + nz * vyCa;
        ${nrmVar}.x = rx;
        ${nrmVar}.y = ny * vyCb - rz * vySb;
        ${nrmVar}.z = ny * vySb + rz * vyCb;
    }
`,
        position: /* glsl */`
    {
${w}
        transformed.x *= mix( 1.0, uTailFan, vyW );
        float dz = transformed.z - uTailZ;
        float rx = transformed.x * vyCa + dz * vySa;
        float rz = -transformed.x * vySa + dz * vyCa;
        transformed.x = rx;
        float ry = transformed.y * vyCb - rz * vySb;
        float rz2 = transformed.y * vySb + rz * vyCb;
        transformed.y = ry;
        transformed.z = uTailZ + rz2;
    }
`,
    };
}

/** Blink: squash the eye assembly flat about the eye centre line. */
const BLINK_UNIFORMS_GLSL = /* glsl */`
uniform float uBlink;
uniform float uEyeY;
uniform vec3  uLidColor;
attribute float aEyeMask;
varying float vEyeMask;
`;

const BLINK_POSITION_GLSL = /* glsl */`
    {
        float m = min( aEyeMask, 1.0 ) * uBlink;
        transformed.y = mix( transformed.y, uEyeY + ( transformed.y - uEyeY ) * 0.10, m );
        transformed.z = mix( transformed.z, transformed.z + 0.012, m );
        vEyeMask = aEyeMask;
    }
`;

// The sclera and highlight (mask 1.0) become lid-coloured while the pupil
// (mask 0.6) keeps its ink, so a closed eye reads as a lid with a lash line
// rather than as a hole.
const BLINK_FRAGMENT_GLSL = /* glsl */`
    #include <color_fragment>
    diffuseColor.rgb = mix( diffuseColor.rgb, uLidColor, uBlink * step( 0.8, vEyeMask ) );
`;

// ---------------------------------------------------------------------------
// Outline hulls with deformer support.
// ---------------------------------------------------------------------------

/**
 * The core `createOutlineMaterial` shader with a deformer spliced in. Built by
 * string surgery on a material the core factory made, so the ink colour, the
 * screen-space width solve and the shared `uUnitPerPixel` all stay identical to
 * every other outline in the game.
 */
function outlineVertexSource(uniformsGlsl, deform) {
    return /* glsl */`
attribute vec3 aOutlineNormal;
uniform float uPixels;
uniform float uUnitPerPixel;
uniform float uMaxPush;
${uniformsGlsl || ''}

void main() {
    vec3 transformed = position;
    vec3 objNormal = aOutlineNormal;
${deform ? deform.normal.replace(/objNormalTARGET/g, 'objNormal') : ''}
${deform ? deform.position : ''}
    vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
    vec3 viewNormal = normalize( normalMatrix * objNormal );
    float depth = max( -mvPosition.z, 0.05 );
    float push = min( uPixels * uUnitPerPixel * depth, uMaxPush );
    mvPosition.xyz += viewNormal * push;
    gl_Position = projectionMatrix * mvPosition;
}
`;
}

function makeHull(THREE, THREEgeo, parent, opts) {
    ensureSmoothNormals(THREE, THREEgeo);
    const mat = createOutlineMaterial(THREE, {
        color: PALETTE.ink,
        pixels: opts.pixels,
        maxPush: opts.maxPush,
    });
    if (opts.deform) {
        mat.vertexShader = outlineVertexSource(opts.uniformsGlsl, opts.deform);
        Object.assign(mat.uniforms, opts.uniforms);
    }
    const hull = new THREE.Mesh(THREEgeo, mat);
    hull.name = parent.name + '__outline';
    hull.userData.isOutline = true;
    hull.raycast = function noop() {};
    hull.renderOrder = -1;
    parent.add(hull);
    return hull;
}

// ---------------------------------------------------------------------------
// Toon material variants.
// ---------------------------------------------------------------------------

function toonWithDeform(THREE, baseOpts, uniformsGlsl, deform, uniforms, cacheKey, extra) {
    const mat = createToonMaterial(THREE, baseOpts);
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, renderer) {
        prev(shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = (uniformsGlsl || '') + (extra && extra.vertHead ? extra.vertHead : '') +
            shader.vertexShader
                .replace(
                    '#include <beginnormal_vertex>',
                    '#include <beginnormal_vertex>\n' + (deform ? deform.normal : '')
                )
                .replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n' + (deform ? deform.position : '') +
                    (extra && extra.vertBody ? extra.vertBody : '')
                );
        if (extra && extra.fragHead) {
            shader.fragmentShader = extra.fragHead + shader.fragmentShader;
        }
        if (extra && extra.fragColor) {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                extra.fragColor
            );
        }
    };
    mat.customProgramCacheKey = function () { return cacheKey; };
    return mat;
}

// ---------------------------------------------------------------------------
// Part builders. Each returns an array of merge entries so the same primitives
// can be built twice: once for the shaded mesh (with eyes, colours, masks) and
// once, cheaper, for the outline hull.
// ---------------------------------------------------------------------------

const TAIL_Z = 0.54;
const TAIL_LEN = 0.62;
const WING_SPAN = 0.98;

function bodyEntries(THREE, S, col, hullOnly) {
    const e = [];
    const bodyCol = col.body, bellyCol = col.belly;
    const tmp = new THREE.Color();

    // Egg torso. Belly colour is painted by height so the underside reads pale
    // from below (which is the only angle a trailing racer ever sees).
    const torso = xform(
        THREE,
        new THREE.SphereGeometry(0.44, S(15), S(11)),
        0, 0, 0.02, 0, 0, 0, 0.96, 1.02, 1.32
    );
    e.push({
        geo: torso,
        color: function (x, y, z, out) {
            const t = Math.min(1, Math.max(0, (y + 0.20) / 0.20));
            out.copy(tmp.setHex(bellyCol)).lerp(tmp.clone().setHex(bodyCol), t);
        },
    });

    // Tucked feet: two stubby toes each, pinned under the belly. They live in
    // the body mesh (no separate draw call) because a racing bird never puts
    // them down; `parts.leftFoot`/`rightFoot` are anchors at their positions.
    for (let s = -1; s <= 1; s += 2) {
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.062, 0.19, S(6), 1, false),
                s * 0.135, -0.30, 0.10, -1.15, 0, 0, 1, 1, 1),
            color: hullOnly ? bodyCol : PALETTE.foot,
        });
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.030, 0.14, S(5), 1, false),
                s * 0.135, -0.365, 0.005, -2.05, 0, 0, 1, 1, 1),
            color: hullOnly ? bodyCol : PALETTE.foot,
        });
    }

    // Tail fan: five flattened feathers splayed in the XZ plane from TAIL_Z.
    // Deformed by the tail uniforms in the vertex shader.
    const fanCount = 5;
    for (let i = 0; i < fanCount; i++) {
        const t = (i / (fanCount - 1)) * 2 - 1;              // -1 .. 1
        const len = TAIL_LEN * (1 - Math.abs(t) * 0.22);
        const g = feather(THREE, len, 0.105, S(5), 0.34, 1);
        // Feathers point +X by default; rotate them to point +Z (backwards)
        // and splay by t.
        xform(THREE, g, 0, 0.02 - Math.abs(t) * 0.01, TAIL_Z,
            0, -Math.PI / 2 + t * 0.40, 0, 1, 1, 1);
        e.push({
            geo: g,
            color: hullOnly ? bodyCol : function (x, y, z, out) {
                const k = Math.min(1, Math.max(0, (z - TAIL_Z - 0.10) / 0.42));
                out.copy(tmp.setHex(bodyCol)).lerp(tmp.clone().setHex(PALETTE.inkSoft), k * 0.72);
            },
        });
    }
    return e;
}

function headEntries(THREE, S, col, hullOnly) {
    const e = [];
    const bodyCol = col.body, bellyCol = col.belly;
    const tmp = new THREE.Color();

    // Skull: oversized relative to the torso — the whole chibi read depends on
    // this ratio. Centre sits forward and up of the neck pivot.
    const skull = xform(
        THREE, new THREE.SphereGeometry(0.40, S(15), S(11)),
        0, 0.05, -0.10, 0, 0, 0, 1.00, 0.98, 0.97
    );
    e.push({
        geo: skull,
        color: function (x, y, z, out) {
            const t = Math.min(1, Math.max(0, (y - 0.05 + 0.16) / 0.16));
            out.copy(tmp.setHex(bellyCol)).lerp(tmp.clone().setHex(bodyCol), t);
        },
    });

    // Beak: two flattened cones, upper long and hooked slightly down, lower
    // short. Prominent is the brief — this one is 0.42 long on a 0.40 skull.
    e.push({
        geo: xform(THREE, new THREE.ConeGeometry(0.165, 0.44, S(7), 1, false),
            0, 0.015, -0.52, -Math.PI / 2 - 0.07, 0, 0, 1, 0.74, 1),
        color: hullOnly ? bodyCol : PALETTE.beak,
    });
    e.push({
        geo: xform(THREE, new THREE.ConeGeometry(0.125, 0.30, S(6), 1, false),
            0, -0.075, -0.44, -Math.PI / 2 + 0.10, 0, 0, 1, 0.55, 1),
        color: hullOnly ? bodyCol : PALETTE.beak,
    });

    // Crest: three little quills, swept back. Cheap, and it gives the
    // silhouette something to read against the sky besides a circle.
    for (let i = 0; i < 3; i++) {
        const t = (i - 1) * 0.5;
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.052, 0.22 - Math.abs(t) * 0.05, S(5), 1, false),
                t * 0.10, 0.42, 0.02 + Math.abs(t) * 0.02, 0.55, t * 0.5, 0, 1, 1, 1),
            color: hullOnly ? bodyCol : function (x, y, z, out) {
                out.copy(tmp.setHex(bodyCol)).lerp(tmp.clone().setHex(PALETTE.inkSoft), 0.35);
            },
        });
    }

    if (hullOnly) return e;

    // Eyes. Big, forward-set, with a domed pupil and a specular dot. Masked so
    // the blink deformer can squash exactly this geometry and nothing else.
    const dirX = 0.62, dirY = 0.30, dirZ = -0.72;
    const dl = Math.hypot(dirX, dirY, dirZ);
    for (let s = -1; s <= 1; s += 2) {
        const nx = (s * dirX) / dl, ny = dirY / dl, nz = dirZ / dl;
        const ex = 0 + nx * 0.33, ey = 0.05 + ny * 0.33, ez = -0.10 + nz * 0.33;
        e.push({
            geo: xform(THREE, new THREE.SphereGeometry(0.158, S(11), S(8)), ex, ey, ez),
            color: PALETTE.eyeWhite,
            mask: 1.0,
        });
        e.push({
            geo: xform(THREE, new THREE.SphereGeometry(0.098, S(9), S(7)),
                ex + nx * 0.082, ey + ny * 0.082, ez + nz * 0.082),
            color: PALETTE.eyeDark,
            mask: 0.6,
        });
        e.push({
            geo: xform(THREE, new THREE.SphereGeometry(0.040, S(6), S(4)),
                ex + nx * 0.115 + s * 0.038, ey + ny * 0.115 + 0.052, ez + nz * 0.115),
            color: PALETTE.eyeWhite,
            mask: 1.0,
        });
    }
    return e;
}

function wingEntries(THREE, S, col, side, hullOnly) {
    // side: +1 builds the right wing (span along +X), -1 mirrors it for the
    // left. Mirroring in the builder rather than with scale.x = -1 on the group
    // keeps triangle winding and normals correct.
    const e = [];
    const bodyCol = col.body;
    const tmp = new THREE.Color();
    const tipColor = function (x, y, z, out) {
        const k = Math.min(1, Math.max(0, (Math.abs(x) - 0.42) / 0.52));
        out.copy(tmp.setHex(bodyCol)).lerp(tmp.clone().setHex(PALETTE.inkSoft), k * 0.62);
    };
    const paint = hullOnly ? bodyCol : tipColor;

    // Shoulder mass — hides the join with the torso from every angle.
    e.push({
        geo: xform(THREE, new THREE.SphereGeometry(0.175, S(8), S(6)), 0.03 * side, 0, 0.02,
            0, 0, 0, 1, 0.82, 1.15),
        color: paint,
    });

    // Three layered coverts/secondaries/primaries, each longer, thinner and
    // swept a little further back than the last.
    const layers = [
        { len: 0.50, rad: 0.235, flat: 0.44, y: 0.045, z: -0.020, sweep: 0.02 },
        { len: 0.72, rad: 0.205, flat: 0.32, y: 0.010, z: 0.055, sweep: 0.13 },
        { len: 0.92, rad: 0.165, flat: 0.25, y: -0.020, z: 0.105, sweep: 0.22 },
    ];
    for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        const g = feather(THREE, L.len, L.rad, S(7), L.flat, 1);
        xform(THREE, g, 0, L.y, L.z, 0, side > 0 ? -L.sweep : L.sweep, 0, side, 1, 1);
        e.push({ geo: g, color: paint });
    }

    // Splayed primary "fingers" at the tip — the detail that stops the wing
    // ending in a blunt cone and reads as feathers even in a 40px silhouette.
    for (let i = 0; i < 3; i++) {
        const g = feather(THREE, 0.30 - i * 0.03, 0.058, S(5), 0.42, 1);
        xform(THREE, g, side * 0.80, -0.015 - i * 0.012, 0.10 + i * 0.055,
            0, side > 0 ? -(0.30 + i * 0.20) : (0.30 + i * 0.20), 0, side, 1, 1);
        e.push({ geo: g, color: paint });
    }
    return e;
}

// ---------------------------------------------------------------------------
// The factory.
// ---------------------------------------------------------------------------

/**
 * @param {object} THREE
 * @param {object} opts
 * @param {number}  [opts.bodyColor]
 * @param {number}  [opts.bellyColor]
 * @param {number}  [opts.scale]     1 -> ~2.4 units nose to tail
 * @param {string}  [opts.quality]   'low' | 'mid' | 'high'
 * @param {boolean} [opts.outline]   default true
 * @param {number}  [opts.outlinePixels]
 */
export function createBird(THREE, opts = {}) {
    const bodyColor = opts.bodyColor === undefined ? PALETTE.birdPlayer : opts.bodyColor;
    const bellyColor = opts.bellyColor === undefined ? PALETTE.birdPlayerBelly : opts.bellyColor;
    const scale = opts.scale === undefined ? 1 : opts.scale;
    const quality = opts.quality || 'high';
    const wantOutline = opts.outline !== false;
    const outlinePixels = opts.outlinePixels === undefined ? 2.6 : opts.outlinePixels;

    // Segment budget. 'low' trims ring counts ~25%; mid and high share the same
    // mesh because the per-bird triangle cap is what binds, not the tier.
    const segScale = quality === 'low' ? 0.72 : 1;
    const S = function (n) { return Math.max(4, Math.round(n * segScale)); };
    const col = { body: bodyColor, belly: bellyColor };

    const geometries = [];
    const materials = [];

    const group = new THREE.Group();
    group.name = 'vyomBird';
    group.scale.setScalar(scale);

    // ---- body (torso + belly + feet + tail fan) ---------------------------
    const body = new THREE.Group();
    body.name = 'body';
    group.add(body);

    const tailUniforms = {
        uTailYaw: { value: 0 },
        uTailPitch: { value: 0 },
        uTailFan: { value: 1 },
        uTailZ: { value: TAIL_Z },
        uTailInv: { value: 1 / TAIL_LEN },
    };
    const tailDef = tailDeform('objectNormal');
    const tailDefHull = tailDeform('objNormal');

    const bodyGeo = mergeGeos(THREE, bodyEntries(THREE, S, col, false), false);
    const bodyMat = toonWithDeform(
        THREE,
        { color: 0xffffff, ramp: 'hero', vertexColors: true, rimStrength: 0.5, specStrength: 0.34, specThreshold: 0.6 },
        TAIL_UNIFORMS_GLSL, tailDef, tailUniforms, 'vyom-bird-body-v1'
    );
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.name = 'bodyMesh';
    body.add(bodyMesh);
    geometries.push(bodyGeo);
    materials.push(bodyMat);

    if (wantOutline) {
        const hullGeo = mergeGeos(THREE, bodyEntries(THREE, S, col, true), false);
        makeHull(THREE, hullGeo, bodyMesh, {
            pixels: outlinePixels, maxPush: 0.14,
            deform: tailDefHull, uniformsGlsl: TAIL_UNIFORMS_GLSL, uniforms: tailUniforms,
        });
        geometries.push(hullGeo);
    }

    // ---- head (skull + beak + crest + eyes) -------------------------------
    const head = new THREE.Group();
    head.name = 'head';
    head.rotation.order = 'YXZ';
    head.position.set(0, 0.30, -0.42);
    body.add(head);

    const headUniforms = {
        uBlink: { value: 0 },
        uEyeY: { value: 0.05 + (0.30 / Math.hypot(0.62, 0.30, 0.72)) * 0.33 },
        uLidColor: { value: new THREE.Color(bodyColor) },
    };
    const headGeo = mergeGeos(THREE, headEntries(THREE, S, col, false), true);
    const headMat = toonWithDeform(
        THREE,
        { color: 0xffffff, ramp: 'hero', vertexColors: true, rimStrength: 0.5, specStrength: 0.62, specThreshold: 0.52 },
        BLINK_UNIFORMS_GLSL, null, headUniforms, 'vyom-bird-head-v1',
        {
            vertBody: BLINK_POSITION_GLSL,
            fragHead: 'varying float vEyeMask;\nuniform float uBlink;\nuniform vec3 uLidColor;\n',
            fragColor: BLINK_FRAGMENT_GLSL,
        }
    );
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.name = 'headMesh';
    head.add(headMesh);
    geometries.push(headGeo);
    materials.push(headMat);

    if (wantOutline) {
        // Hull covers skull + beak + crest only. Inking the eye domes as well
        // would double the head's triangle cost for lines that sit inside the
        // silhouette anyway.
        const hullGeo = mergeGeos(THREE, headEntries(THREE, S, col, true), false);
        makeHull(THREE, hullGeo, headMesh, { pixels: outlinePixels, maxPush: 0.12 });
        geometries.push(hullGeo);
    }

    // ---- wings ------------------------------------------------------------
    const wings = [];
    const wingUniformSets = [];
    for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;                 // -1 = left (bird's -X)
        const name = side < 0 ? 'leftWing' : 'rightWing';
        const g = new THREE.Group();
        g.name = name;
        g.rotation.order = 'YXZ';
        g.position.set(side * 0.30, 0.14, -0.04);
        body.add(g);

        const u = {
            uCurl: { value: 0 },
            uSweep: { value: 0 },
            uSpanInv: { value: 1 / WING_SPAN },
        };
        const def = wingDeform('objectNormal');
        const defHull = wingDeform('objNormal');

        const geo = mergeGeos(THREE, wingEntries(THREE, S, col, side, false), false);
        const mat = toonWithDeform(
            THREE,
            { color: 0xffffff, ramp: 'hero', vertexColors: true, rimStrength: 0.62, specStrength: 0.30, specThreshold: 0.62 },
            WING_UNIFORMS_GLSL, def, u, 'vyom-bird-wing-v1'
        );
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = name + 'Mesh';
        g.add(mesh);
        geometries.push(geo);
        materials.push(mat);

        if (wantOutline) {
            const hullGeo = mergeGeos(THREE, wingEntries(THREE, S, col, side, true), false);
            makeHull(THREE, hullGeo, mesh, {
                pixels: outlinePixels, maxPush: 0.12,
                deform: defHull, uniformsGlsl: WING_UNIFORMS_GLSL, uniforms: u,
            });
            geometries.push(hullGeo);
        }

        wings.push(g);
        wingUniformSets.push(u);
    }

    // ---- anchors ----------------------------------------------------------
    // These carry no geometry: their meshes are merged into body/head to hold
    // the draw-call budget. They exist so the animator, the FX system and the
    // camera have stable, correctly placed nodes to read world positions from
    // (feather emitters at the wing tips, sparkles at the eyes, and so on).
    function anchor(parent, name, x, y, z) {
        const a = new THREE.Object3D();
        a.name = name;
        a.position.set(x, y, z);
        parent.add(a);
        return a;
    }
    const dl = Math.hypot(0.62, 0.30, 0.72);
    const eyeAnchors = [];
    const pupilAnchors = [];
    for (let s = -1; s <= 1; s += 2) {
        const nx = (s * 0.62) / dl, ny = 0.30 / dl, nz = -0.72 / dl;
        eyeAnchors.push(anchor(head, s < 0 ? 'leftEye' : 'rightEye',
            nx * 0.33, 0.05 + ny * 0.33, -0.10 + nz * 0.33));
        pupilAnchors.push(anchor(head, s < 0 ? 'leftPupil' : 'rightPupil',
            nx * 0.412, 0.05 + ny * 0.412, -0.10 + nz * 0.412));
    }

    const parts = {
        body: body,
        head: head,
        beak: anchor(head, 'beak', 0, -0.02, -0.72),
        leftWing: wings[0],
        rightWing: wings[1],
        leftFoot: anchor(body, 'leftFoot', -0.135, -0.40, 0.03),
        rightFoot: anchor(body, 'rightFoot', 0.135, -0.40, 0.03),
        tail: anchor(body, 'tail', 0, 0.02, TAIL_Z),
        leftEye: eyeAnchors[0],
        rightEye: eyeAnchors[1],
        leftPupil: pupilAnchors[0],
        rightPupil: pupilAnchors[1],
        // Meshes, for anyone who needs the renderable objects themselves.
        bodyMesh: bodyMesh,
        headMesh: headMesh,
        leftWingMesh: wings[0].children[0],
        rightWingMesh: wings[1].children[0],
        // Wing-tip anchors, for the feather trail.
        leftTip: anchor(wings[0], 'leftTip', -WING_SPAN * 1.02, 0, 0.14),
        rightTip: anchor(wings[1], 'rightTip', WING_SPAN * 1.02, 0, 0.14),
    };

    let triangles = 0;
    let drawCalls = 0;
    group.traverse(function (o) {
        if (!o.isMesh) return;
        drawCalls++;
        const idx = o.geometry.getAttribute('position');
        triangles += (o.geometry.index ? o.geometry.index.count : idx.count) / 3;
    });

    return {
        group: group,
        parts: parts,
        // Deformer handles the animator writes into. Plain uniform objects —
        // writing `.value` is a float store, zero allocation.
        uniforms: {
            blink: headUniforms.uBlink,
            tailYaw: tailUniforms.uTailYaw,
            tailPitch: tailUniforms.uTailPitch,
            tailFan: tailUniforms.uTailFan,
            leftCurl: wingUniformSets[0].uCurl,
            leftSweep: wingUniformSets[0].uSweep,
            rightCurl: wingUniformSets[1].uCurl,
            rightSweep: wingUniformSets[1].uSweep,
        },
        triangleCount: triangles,
        drawCallCount: drawCalls,
        dispose: function dispose() {
            for (let i = 0; i < geometries.length; i++) geometries[i].dispose();
            for (let i = 0; i < materials.length; i++) materials[i].dispose();
            group.traverse(function (o) {
                if (o.isMesh && o.userData.isOutline && o.material) o.material.dispose();
            });
            if (group.parent) group.parent.remove(group);
        },
    };
}
