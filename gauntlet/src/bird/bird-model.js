/**
 * bird-model.js — Birb Gauntlet's procedural chibi racer.
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
 *
 * Species (`opts.species`): 'birb' (the default, and byte-for-byte the model
 * this file always built), 'crow' and 'clockwork-owl'. A species is the same
 * rig re-proportioned — same parts, same deformers, same anchors — so the
 * animator, the FX and the camera never need to know which bird they have.
 *   - crow: sleeker torso, a long heavy dark beak, no crest, a wedge tail and
 *     a blue iridescent rim (the toon rim term, tinted — no new shader).
 *   - clockwork-owl: round brass body, big head with pale facial discs behind
 *     oversized eyes, ear tufts, gear discs merged into the wings, plus TWO
 *     extra meshes: a wind-up key and a back gear, exposed on `mech` so the
 *     animator can spin them. The gear sits inside the silhouette and goes
 *     unoutlined; the key sticks out of it and is inked except on 'low'.
 *     That is +3 draw calls (+2 on 'low') over the birb.
 */

import { PALETTE } from '../core/palette.js';
import { createToonMaterial } from '../core/toon.js';
import { parseSpecies } from './species.js';
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

/** Build a non-indexed geometry from a flat xyz triangle-soup array. */
function makeGeo(THREE, tris) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
    return orientOutward(THREE, g);
}

/**
 * Safety net for hand-wound geometry: if the whole shell ended up inside-out,
 * reverse it. Getting winding wrong is invisible on a lit mesh with two-sided
 * lighting but catastrophic with inverted-hull outlines — the hull renders the
 * outside in solid ink. Cheap insurance, build time only.
 */
function orientOutward(THREE, geo) {
    geo.computeVertexNormals();
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < p.count; i++) { cx += p.getX(i); cy += p.getY(i); cz += p.getZ(i); }
    cx /= p.count; cy /= p.count; cz /= p.count;
    let dot = 0;
    for (let i = 0; i < p.count; i++) {
        dot += (p.getX(i) - cx) * n.getX(i) + (p.getY(i) - cy) * n.getY(i) + (p.getZ(i) - cz) * n.getZ(i);
    }
    if (dot < 0) {
        const a = p.array;
        for (let t = 0; t < p.count; t += 3) {
            for (let k = 0; k < 3; k++) {
                const tmp = a[(t + 1) * 3 + k];
                a[(t + 1) * 3 + k] = a[(t + 2) * 3 + k];
                a[(t + 2) * 3 + k] = tmp;
            }
        }
        p.needsUpdate = true;
        geo.computeVertexNormals();
    }
    return geo;
}

/**
 * Loft a diamond cross-section along +X and close it with a tip point.
 *
 * This replaced the original cone-based feathers. A cone tapers linearly to a
 * point, so by 60% of the span it has almost no chord left and the wing renders
 * as a knife blade — which is exactly what the fourth captured frame showed. A
 * loft lets the planform hold its chord out to the wrist and then taper, which
 * is what makes a wing read as a wing.
 *
 * @param {Array} stations [x, halfChord(Z), halfThick(Y), zCentre, yCentre]
 * @param {Array} tip      [x, y, z]
 */
function loftBlade(THREE, stations, tip) {
    const rings = [];
    for (let i = 0; i < stations.length; i++) {
        const s = stations[i];
        rings.push([
            [s[0], s[4] + s[2], s[3]],          // top
            [s[0], s[4], s[3] + s[1]],          // trailing edge
            [s[0], s[4] - s[2], s[3]],          // bottom
            [s[0], s[4], s[3] - s[1]],          // leading edge
        ]);
    }
    const out = [];
    function T(a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }

    const r0 = rings[0];
    T(r0[0], r0[1], r0[2]);
    T(r0[0], r0[2], r0[3]);
    for (let i = 0; i < rings.length - 1; i++) {
        const a = rings[i], b = rings[i + 1];
        for (let k = 0; k < 4; k++) {
            const k2 = (k + 1) & 3;
            T(a[k], b[k], b[k2]);
            T(a[k], b[k2], a[k2]);
        }
    }
    const last = rings[rings.length - 1];
    for (let k = 0; k < 4; k++) T(last[k], tip, last[(k + 1) & 3]);
    return makeGeo(THREE, out);
}

/**
 * The tail: one scalloped lens-shaped plate rather than a bundle of cones.
 * Five separate cones read as five spikes; a single plate with a notched
 * trailing edge reads as a fan, costs a third of the triangles, and spreads
 * cleanly under the `uTailFan` deformer (which scales X).
 */
function tailPlate(THREE, len, halfAngle, points, thick, wedge) {
    const rim = [];
    for (let i = 0; i < points; i++) {
        const t = (i / (points - 1)) * 2 - 1;
        const a = t * halfAngle;
        // `wedge` (the crow) grades the feathers so the centre pair is
        // longest and the fan comes to a blunt point instead of a scallop.
        const r = wedge
            ? len * (1.0 - 0.34 * Math.abs(t)) * (i % 2 === 1 ? 1.0 : 0.94)
            : len * (i % 2 === 1 ? 1.0 : 0.82);
        rim.push([Math.sin(a) * r, 0, Math.cos(a) * r]);
    }
    const root = [0, 0, 0];
    const apexT = [0, thick, len * 0.30];
    const apexB = [0, -thick, len * 0.30];
    const out = [];
    function T(a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    for (let i = 0; i < points - 1; i++) {
        T(apexT, rim[i], rim[i + 1]);
        T(apexB, rim[i + 1], rim[i]);
    }
    T(apexT, root, rim[0]);
    T(apexT, rim[points - 1], root);
    T(apexB, rim[0], root);
    T(apexB, root, rim[points - 1]);
    return makeGeo(THREE, out);
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
 * Mirror a merged (non-indexed) geometry across X, in place.
 *
 * Mirroring with a negative scale in the transform looks like it works and does
 * not: a reflection reverses triangle winding, so every face becomes a back
 * face, gets culled, and the inverted-hull outline — which draws back faces —
 * renders the outer shell in solid ink instead. (This is exactly what the first
 * captured frame showed: a black blade where the left wing should be.) So the
 * winding is reversed explicitly here to match.
 */
function mirrorX(geo) {
    const attrs = [geo.getAttribute('position'), geo.getAttribute('normal'), geo.getAttribute('color')];
    const pos = attrs[0].array;
    const nrm = attrs[1].array;
    for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nrm[i] = -nrm[i]; }
    // Reverse winding: swap the 2nd and 3rd vertex of every triangle, carrying
    // each vertex's whole attribute set with it.
    const count = attrs[0].count;
    for (let t = 0; t < count; t += 3) {
        for (let a = 0; a < attrs.length; a++) {
            const arr = attrs[a].array;
            const n = attrs[a].itemSize;
            const i1 = (t + 1) * n, i2 = (t + 2) * n;
            for (let k = 0; k < n; k++) {
                const tmp = arr[i1 + k]; arr[i1 + k] = arr[i2 + k]; arr[i2 + k] = tmp;
            }
        }
    }
    for (let a = 0; a < attrs.length; a++) attrs[a].needsUpdate = true;
    geo.computeBoundingSphere();
    return geo;
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
${deform ? deform.normal : ''}
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

function makeHull(THREE, geo, parent, opts) {
    ensureSmoothNormals(THREE, geo);
    const mat = createOutlineMaterial(THREE, {
        color: PALETTE.ink,
        pixels: opts.pixels,
        maxPush: opts.maxPush,
    });
    if (opts.deform) {
        mat.vertexShader = outlineVertexSource(opts.uniformsGlsl, opts.deform);
        Object.assign(mat.uniforms, opts.uniforms);
    }
    const hull = new THREE.Mesh(geo, mat);
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

// Eye placement, shared by the geometry builder and the anchor nodes so they
// can never drift apart. Set forward rather than sideways: a chibi bird needs
// both eyes readable from behind, and eyes far out on the sides break the head
// silhouette into lumps.
const EYE_DIR_X = 0.40, EYE_DIR_Y = 0.38, EYE_DIR_Z = -0.83;
const EYE_SET = 0.310;

const TAIL_Z = 0.54;
const TAIL_LEN = 0.88;
const WING_SPAN = 1.06;

// Species proportions. The birb's numbers stay inline below as literals; these
// only ever replace them for the other two, so the default bird cannot drift.
const CROW_TAIL_LEN = 1.04;
const OWL_TAIL_LEN = 0.62;
/** Owl eyes sit further out (in front of the facial discs) and are bigger. */
const OWL_EYE_SET = 0.40;
const OWL_EYE_K = 1.13;

function tailLenOf(sp) {
    return sp === 'crow' ? CROW_TAIL_LEN : (sp === 'clockwork-owl' ? OWL_TAIL_LEN : TAIL_LEN);
}

/**
 * A low-poly gear lying in the XZ plane (axis +Y), centred on the origin:
 * a disc plus radial teeth. Returns bare geometries so the caller can place
 * and colour them. ~100 triangles at six teeth.
 */
function gearGeos(THREE, S, radius, thick, teeth) {
    const out = [new THREE.CylinderGeometry(radius, radius, thick, S(8), 1, false)];
    for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        // Rotating about Y by -a turns local +X onto the radial direction, so
        // each tooth's long side points outward.
        out.push(xform(THREE, new THREE.BoxGeometry(radius * 0.38, thick * 0.9, radius * 0.32),
            Math.cos(a) * radius * 1.06, 0, Math.sin(a) * radius * 1.06, 0, -a, 0));
    }
    return out;
}

function bodyEntries(THREE, S, col, hullOnly, sp) {
    const e = [];
    const bodyCol = col.body, bellyCol = col.belly;
    const crow = sp === 'crow', owl = sp === 'clockwork-owl';

    // Egg torso. Belly colour is painted by height so the underside reads pale
    // from below (which is the only angle a trailing racer ever sees).
    // The crow is longer and narrower; the owl is rounder.
    const bellyPaint = gradient(THREE, bellyCol, bodyCol, function (x, y) { return (y + 0.30) / 0.24; });
    const torso = xform(
        THREE,
        new THREE.SphereGeometry(0.42, S(14), S(10)),
        0, -0.01, 0.05, 0, 0, 0,
        crow ? 0.84 : (owl ? 0.97 : 0.91),
        crow ? 0.90 : (owl ? 1.00 : 0.96),
        crow ? 1.34 : (owl ? 1.12 : 1.26)
    );
    e.push({ geo: torso, color: bellyPaint });

    // Neck. Without it the head and the torso read as two tangent balls — a
    // snowman, not a bird. An open-ended truncated cone buried at both ends
    // welds the two masses into one silhouette for 16 triangles.
    e.push({
        geo: xform(THREE, new THREE.CylinderGeometry(0.25, 0.33, 0.40, S(8), 1, true),
            0, 0.20, -0.24, 0.42, 0, 0, 1, 1, 1),
        color: bellyPaint,
    });

    // Tucked feet: two stubby toes each, folded back along the belly. They live
    // in the body mesh (no separate draw call) because a racing bird never puts
    // them down; `parts.leftFoot`/`rightFoot` are anchors at their positions.
    for (let s = -1; s <= 1; s += 2) {
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.047, 0.15, S(6), 1, false),
                s * 0.108, -0.205, 0.11, 2.55, 0, 0, 1, 1, 1),
            color: hullOnly ? bodyCol : PALETTE.foot,
        });
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.025, 0.11, S(5), 1, false),
                s * 0.108, -0.238, 0.055, 2.80, 0, 0, 1, 1, 1),
            color: hullOnly ? bodyCol : PALETTE.foot,
        });
    }

    // Tail fan: five flattened feathers splayed in the XZ plane from TAIL_Z.
    // Deformed by the tail uniforms in the vertex shader.
    const tailPaint = gradient(THREE, bodyCol, PALETTE.inkSoft, function (x, y, z) {
        return ((z - TAIL_Z - 0.12) / 0.56) * 0.42;
    });
    e.push({
        geo: xform(THREE, crow
            ? tailPlate(THREE, CROW_TAIL_LEN, 0.46, 7, 0.050, true)
            : (owl ? tailPlate(THREE, OWL_TAIL_LEN, 0.66, 5, 0.060)
                : tailPlate(THREE, TAIL_LEN, 0.74, 7, 0.055)),
            0, 0.07, TAIL_Z, -0.05, 0, 0, 1, 1, 1),
        color: hullOnly ? bodyCol : tailPaint,
    });
    return e;
}

function headEntries(THREE, S, col, hullOnly, sp) {
    const e = [];
    const bodyCol = col.body, bellyCol = col.belly;
    const crow = sp === 'crow', owl = sp === 'clockwork-owl';

    // Skull: oversized relative to the torso — the whole chibi read depends on
    // this ratio. Centre sits forward and up of the neck pivot. The crow's is a
    // touch smaller and flatter-crowned; the owl's is the biggest in the game.
    const skull = xform(
        THREE, new THREE.SphereGeometry(crow ? 0.41 : (owl ? 0.45 : 0.43), S(14), S(10)),
        0, 0.05, -0.10, 0, 0, 0,
        owl ? 1.04 : 1.00, crow ? 0.93 : (owl ? 1.00 : 0.98), crow ? 1.02 : (owl ? 0.96 : 0.97)
    );
    e.push({
        geo: skull,
        color: gradient(THREE, bellyCol, bodyCol, function (x, y) { return (y + 0.10) / 0.16; }),
    });

    if (crow) {
        // A crow's whole identity is the beak: long, deep at the root, nearly
        // straight, and as dark as the bird. Inked so it reads against sky.
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.155, 0.70, S(7), 1, false),
                0, 0.020, -0.66, -Math.PI / 2 - 0.035, 0, 0, 1, 1, 0.66),
            color: hullOnly ? bodyCol : PALETTE.crowBeak,
        });
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.120, 0.48, S(6), 1, false),
                0, -0.070, -0.56, -Math.PI / 2 + 0.06, 0, 0, 1, 1, 0.50),
            color: hullOnly ? bodyCol : PALETTE.crowBeak,
        });
    } else if (owl) {
        // A small hooked bill tucked between the facial discs.
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.10, 0.26, S(6), 1, false),
                0, -0.03, -0.55, -Math.PI / 2 - 0.55, 0, 0, 1, 1, 0.80),
            color: hullOnly ? bodyCol : PALETTE.owlCopper,
        });
    } else {
        // Beak: two flattened cones, upper long and hooked slightly down, lower
        // short. "Prominent" is the brief — this one is 0.44 long on a 0.40 skull.
        // The cone's local Z becomes vertical after the -90deg X rotation, so the
        // vertical flatten is applied there.
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.175, 0.48, S(7), 1, false),
                0, 0.010, -0.55, -Math.PI / 2 - 0.07, 0, 0, 1, 1, 0.70),
            color: hullOnly ? bodyCol : PALETTE.beak,
        });
        e.push({
            geo: xform(THREE, new THREE.ConeGeometry(0.132, 0.31, S(6), 1, false),
                0, -0.085, -0.44, -Math.PI / 2 + 0.11, 0, 0, 1, 1, 0.55),
            color: hullOnly ? bodyCol : PALETTE.beak,
        });
    }

    // Crest: three little quills, swept back. Cheap, and it gives the
    // silhouette something to read against the sky besides a circle.
    // Crows have none; the owl gets two ear tufts in the same paint instead.
    const crestPaint = gradient(THREE, bodyCol, PALETTE.inkSoft, function () { return 0.34; });
    if (owl) {
        for (let s = -1; s <= 1; s += 2) {
            e.push({
                geo: xform(THREE, new THREE.ConeGeometry(0.078, 0.30, S(5), 1, false),
                    s * 0.21, 0.45, -0.04, 0.22, 0, -s * 0.48, 1, 1, 0.7),
                color: hullOnly ? bodyCol : crestPaint,
            });
        }
    } else if (!crow) {
        for (let i = 0; i < 3; i++) {
            const t = (i - 1) * 0.5;
            e.push({
                geo: xform(THREE, new THREE.ConeGeometry(0.054, 0.24 - Math.abs(t) * 0.06, S(5), 1, false),
                    t * 0.105, 0.40, 0.01 + Math.abs(t) * 0.02, 0.62, t * 0.45, 0, 1, 1, 1),
                color: hullOnly ? bodyCol : crestPaint,
            });
        }
    }

    if (hullOnly) return e;

    // Eyes. Big, forward-set, with a domed pupil and a specular dot. Masked so
    // the blink deformer can squash exactly this geometry and nothing else.
    // The owl's are pushed out and scaled up so they sit proud of its discs.
    const eyeSet = owl ? OWL_EYE_SET : EYE_SET;
    const k = owl ? OWL_EYE_K : 1;
    const dl = Math.hypot(EYE_DIR_X, EYE_DIR_Y, EYE_DIR_Z);
    for (let s = -1; s <= 1; s += 2) {
        const nx = (s * EYE_DIR_X) / dl, ny = EYE_DIR_Y / dl, nz = EYE_DIR_Z / dl;
        const ex = nx * eyeSet, ey = 0.05 + ny * eyeSet, ez = -0.10 + nz * eyeSet;
        if (owl) {
            // Facial disc: a pale, flattened dish behind each eye, its flat
            // axis turned onto the eye direction. Unmasked, so it stays put
            // while the eye blinks in front of it.
            const dd = eyeSet - 0.012;
            e.push({
                geo: xform(THREE, new THREE.SphereGeometry(0.245, S(10), S(7)),
                    nx * dd, 0.05 + ny * dd, -0.10 + nz * dd,
                    -Math.asin(ny), Math.atan2(nx, nz), 0, 1, 1, 0.36),
                color: PALETTE.owlDisc,
            });
        }
        e.push({
            geo: xform(THREE, new THREE.SphereGeometry(0.146 * k, S(10), S(7)), ex, ey, ez),
            color: PALETTE.eyeWhite,
            mask: 1.0,
        });
        e.push({
            geo: xform(THREE, new THREE.SphereGeometry(0.097 * k, S(8), S(6)),
                ex + nx * 0.078 * k, ey + ny * 0.078 * k, ez + nz * 0.078 * k),
            color: PALETTE.eyeDark,
            mask: 0.6,
        });
        e.push({
            geo: xform(THREE, new THREE.SphereGeometry(0.031 * k, S(5), S(3)),
                ex + nx * 0.128 * k + s * 0.030 * k, ey + ny * 0.128 * k + 0.044 * k, ez + nz * 0.128 * k),
            color: PALETTE.eyeWhite,
            mask: 1.0,
        });
    }
    return e;
}

/**
 * The owl's wind-up key, built along +Y from its base so the mesh can spin on
 * its own shaft: collar, shaft, and a two-lobed bow lying in the YZ plane.
 */
function keyEntries(THREE, S) {
    const c = PALETTE.owlKey;
    return [
        { geo: xform(THREE, new THREE.CylinderGeometry(0.065, 0.075, 0.05, S(8), 1, false), 0, 0.025, 0), color: PALETTE.owlGear },
        { geo: xform(THREE, new THREE.CylinderGeometry(0.030, 0.030, 0.26, S(6), 1, false), 0, 0.15, 0), color: c },
        { geo: xform(THREE, new THREE.SphereGeometry(0.105, S(7), S(5)), 0, 0.33, 0.088, 0, 0, 0, 0.32, 0.80, 1.0), color: c },
        { geo: xform(THREE, new THREE.SphereGeometry(0.105, S(7), S(5)), 0, 0.33, -0.088, 0, 0, 0, 0.32, 0.80, 1.0), color: c },
        { geo: xform(THREE, new THREE.SphereGeometry(0.046, S(6), S(4)), 0, 0.29, 0), color: c },
    ];
}

function wingEntries(THREE, S, col, hullOnly, sp) {
    // Always built along +X (the bird's right). The left wing is the same
    // geometry run through mirrorX() after the merge, which flips winding too.
    const e = [];
    const bodyCol = col.body;
    // Only a light darkening toward the tip. The first pass pushed 66% toward
    // ink and the wing rendered as a black blade whenever it faced away from
    // the key light — the cel ramp's dark band multiplies whatever the vertex
    // colour already is, so vertex-painted shading has to stay subtle.
    const paint = hullOnly ? bodyCol : gradient(THREE, bodyCol, PALETTE.inkSoft, function (x) {
        return ((Math.abs(x) - 0.44) / 0.58) * 0.34;
    });

    // Shoulder mass — hides the join with the torso from every angle.
    e.push({
        geo: xform(THREE, new THREE.SphereGeometry(0.150, S(7), S(5)), 0.02, -0.02, 0.02,
            0, 0, 0, 1, 0.80, 1.25),
        color: paint,
    });

    // Wing planform: broad at the shoulder, holding chord out to the wrist,
    // then sweeping and tapering into the hand. The trailing edge drifts back
    // (rising zCentre) so the wing has natural sweep without the group having
    // to be rotated, which would fight the flap axis.
    e.push({
        geo: loftBlade(THREE, [
            [0.00, 0.300, 0.090, 0.020, 0.030],
            [0.28, 0.325, 0.072, 0.035, 0.020],
            [0.58, 0.300, 0.052, 0.075, 0.000],
            [0.84, 0.235, 0.034, 0.130, -0.020],
            [1.00, 0.150, 0.020, 0.185, -0.030],
        ], [1.12, -0.040, 0.250]),
        color: paint,
    });

    // Splayed primary "fingers" past the wrist — the detail that stops the wing
    // ending in a blunt edge and reads as feathers even in a 40px silhouette.
    // A crow's hand is its signature in flight: four long, widely splayed
    // fingers rather than three short ones.
    const crow = sp === 'crow';
    const fingers = crow ? 4 : 3;
    for (let i = 0; i < fingers; i++) {
        const g = loftBlade(THREE, [
            [0.00, 0.070, 0.024, 0, 0],
            [0.20, 0.055, 0.016, 0.010, 0],
        ], [(crow ? 0.44 : 0.36) - i * 0.04, -0.004, 0.030]);
        xform(THREE, g, 0.86, -0.012 - i * 0.014, 0.10 + i * (crow ? 0.062 : 0.075),
            0, -(0.16 + i * (crow ? 0.17 : 0.15)), 0, 1, 1, 1);
        e.push({ geo: g, color: paint });
    }

    // The owl's wing gear: a brass disc lying on the upper surface over the
    // inner wing, merged into the wing mesh so it costs no draw call. It sits
    // inside the silhouette, so the hull skips it.
    if (sp === 'clockwork-owl' && !hullOnly) {
        const gg = gearGeos(THREE, S, 0.105, 0.032, 6);
        for (let i = 0; i < gg.length; i++) {
            e.push({ geo: xform(THREE, gg[i], 0.36, 0.098, 0.05), color: PALETTE.owlGear });
        }
    }
    return e;
}

/** Same toon options object for the birb; a tinted copy for the others. */
function toonFor(sp, base, crowExtra, owlExtra) {
    if (sp === 'crow') return Object.assign({}, base, crowExtra);
    if (sp === 'clockwork-owl') return Object.assign({}, base, owlExtra);
    return base;
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
 * @param {string}  [opts.species]   'birb' (default) | 'crow' | 'clockwork-owl'
 */
export function createBird(THREE, opts = {}) {
    const sp = parseSpecies(opts.species) || 'birb';
    const crow = sp === 'crow', owl = sp === 'clockwork-owl';
    const bodyColor = opts.bodyColor === undefined
        ? (crow ? PALETTE.birdRival4 : (owl ? PALETTE.owlBrass : PALETTE.birdPlayer))
        : opts.bodyColor;
    const bellyColor = opts.bellyColor === undefined
        ? (crow ? PALETTE.crowBelly : (owl ? PALETTE.owlDisc : PALETTE.birdPlayerBelly))
        : opts.bellyColor;
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
    group.name = 'gauntletBird';
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
        uTailInv: { value: 1 / tailLenOf(sp) },
    };
    const tailDef = tailDeform('objectNormal');
    const tailDefHull = tailDeform('objNormal');

    // The crow's iridescence is the stock rim term tinted blue and pushed a
    // little harder, with a tighter gloss; the owl's brass gets a broader,
    // brighter specular band so it reads as metal rather than feathers. Both
    // are uniforms, so every species still shares one compiled program.
    const bodyGeo = mergeGeos(THREE, bodyEntries(THREE, S, col, false, sp), false);
    const bodyMat = toonWithDeform(
        THREE,
        toonFor(sp,
            { color: 0xffffff, ramp: 'hero', vertexColors: true, rimStrength: 0.5, specStrength: 0.10, specThreshold: 0.74 },
            { rimColor: PALETTE.crowRim, rimStrength: 0.72, specStrength: 0.20, specThreshold: 0.70 },
            { rimStrength: 0.42, specStrength: 0.34, specThreshold: 0.62 }),
        TAIL_UNIFORMS_GLSL, tailDef, tailUniforms, 'gauntlet-bird-body-v1'
    );
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.name = 'bodyMesh';
    body.add(bodyMesh);
    geometries.push(bodyGeo);
    materials.push(bodyMat);

    if (wantOutline) {
        const hullGeo = mergeGeos(THREE, bodyEntries(THREE, S, col, true, sp), false);
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
    head.position.set(0, 0.28, -0.31);
    body.add(head);

    const eyeSet = owl ? OWL_EYE_SET : EYE_SET;
    const headUniforms = {
        uBlink: { value: 0 },
        uEyeY: { value: 0.05 + (EYE_DIR_Y / Math.hypot(EYE_DIR_X, EYE_DIR_Y, EYE_DIR_Z)) * eyeSet },
        uLidColor: { value: new THREE.Color(bodyColor) },
    };
    const headGeo = mergeGeos(THREE, headEntries(THREE, S, col, false, sp), true);
    const headMat = toonWithDeform(
        THREE,
        toonFor(sp,
            { color: 0xffffff, ramp: 'hero', vertexColors: true, rimStrength: 0.5, specStrength: 0.11, specThreshold: 0.74 },
            { rimColor: PALETTE.crowRim, rimStrength: 0.72, specStrength: 0.22, specThreshold: 0.70 },
            { rimStrength: 0.42, specStrength: 0.30, specThreshold: 0.64 }),
        BLINK_UNIFORMS_GLSL, null, headUniforms, 'gauntlet-bird-head-v1',
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
        const hullGeo = mergeGeos(THREE, headEntries(THREE, S, col, true, sp), false);
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
        g.position.set(side * 0.215, 0.13, -0.12);
        body.add(g);

        const u = {
            uCurl: { value: 0 },
            uSweep: { value: 0 },
            uSpanInv: { value: 1 / WING_SPAN },
        };
        const def = wingDeform('objectNormal');
        const defHull = wingDeform('objNormal');

        const geo = mergeGeos(THREE, wingEntries(THREE, S, col, false, sp), false);
        if (side < 0) mirrorX(geo);
        const mat = toonWithDeform(
            THREE,
            toonFor(sp,
                { color: 0xffffff, ramp: 'hero', vertexColors: true, rimStrength: 0.26, specStrength: 0.0, specThreshold: 0.72 },
                { rimColor: PALETTE.crowRim, rimStrength: 0.44 },
                { specStrength: 0.18, specThreshold: 0.66 }),
            WING_UNIFORMS_GLSL, def, u, 'gauntlet-bird-wing-v1'
        );
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = name + 'Mesh';
        g.add(mesh);
        geometries.push(geo);
        materials.push(mat);

        if (wantOutline) {
            const hullGeo = mergeGeos(THREE, wingEntries(THREE, S, col, true, sp), false);
            if (side < 0) mirrorX(hullGeo);
            makeHull(THREE, hullGeo, mesh, {
                pixels: outlinePixels, maxPush: 0.12,
                deform: defHull, uniformsGlsl: WING_UNIFORMS_GLSL, uniforms: u,
            });
            geometries.push(hullGeo);
        }

        wings.push(g);
        wingUniformSets.push(u);
    }

    // ---- clockwork (owl only) ---------------------------------------------
    // The key and the back gear are the only parts of any bird that rotate
    // rigidly on their own axis, so they are the only parts that cannot be
    // merged into a parent mesh. Each sits in a tilted mount group (matching
    // the slope of the back) and the MESH spins on its local Y inside it, so
    // the animator writes one float per part per frame.
    let mech = null;
    if (owl) {
        const keyMount = new THREE.Group();
        keyMount.name = 'windKeyMount';
        keyMount.position.set(0, 0.33, 0.24);
        keyMount.rotation.x = 0.30;          // lean back with the shoulders
        body.add(keyMount);
        const keyGeo = mergeGeos(THREE, keyEntries(THREE, S), false);
        const keyMat = createToonMaterial(THREE, {
            color: 0xffffff, ramp: 'hero', vertexColors: true,
            rimStrength: 0.4, specStrength: 0.42, specThreshold: 0.6,
        });
        const keyMesh = new THREE.Mesh(keyGeo, keyMat);
        keyMesh.name = 'windKey';
        keyMount.add(keyMesh);
        geometries.push(keyGeo);
        materials.push(keyMat);
        // The key breaks the silhouette, so it is inked — except on 'low',
        // where the draw call buys more elsewhere.
        if (wantOutline && quality !== 'low') {
            const hullGeo = mergeGeos(THREE, keyEntries(THREE, S), false);
            makeHull(THREE, hullGeo, keyMesh, { pixels: outlinePixels, maxPush: 0.08 });
            geometries.push(hullGeo);
        }

        const gearMount = new THREE.Group();
        gearMount.name = 'backGearMount';
        gearMount.position.set(0, 0.255, 0.43);
        gearMount.rotation.x = 0.62;
        body.add(gearMount);
        const gg = gearGeos(THREE, S, 0.12, 0.036, 6);
        const gearList = [];
        for (let i = 0; i < gg.length; i++) gearList.push({ geo: gg[i], color: PALETTE.owlGear });
        const gearGeo = mergeGeos(THREE, gearList, false);
        const gearMat = createToonMaterial(THREE, {
            color: 0xffffff, ramp: 'hero', vertexColors: true,
            rimStrength: 0.3, specStrength: 0.36, specThreshold: 0.6,
        });
        const gearMesh = new THREE.Mesh(gearGeo, gearMat);
        gearMesh.name = 'backGear';
        gearMount.add(gearMesh);
        geometries.push(gearGeo);
        materials.push(gearMat);

        mech = { key: keyMesh, gear: gearMesh };
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
    const dl = Math.hypot(EYE_DIR_X, EYE_DIR_Y, EYE_DIR_Z);
    const eyeAnchors = [];
    const pupilAnchors = [];
    for (let s = -1; s <= 1; s += 2) {
        const nx = (s * EYE_DIR_X) / dl, ny = EYE_DIR_Y / dl, nz = EYE_DIR_Z / dl;
        eyeAnchors.push(anchor(head, s < 0 ? 'leftEye' : 'rightEye',
            nx * eyeSet, 0.05 + ny * eyeSet, -0.10 + nz * eyeSet));
        pupilAnchors.push(anchor(head, s < 0 ? 'leftPupil' : 'rightPupil',
            nx * (eyeSet + 0.08), 0.05 + ny * (eyeSet + 0.08), -0.10 + nz * (eyeSet + 0.08)));
    }

    const parts = {
        body: body,
        head: head,
        beak: anchor(head, 'beak', 0, crow ? 0.0 : -0.02, crow ? -1.00 : (owl ? -0.66 : -0.80)),
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
        species: sp,
        // Clockwork handles: { key, gear } meshes the animator spins about
        // their local Y. Null for every species without a mechanism.
        mech: mech,
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
