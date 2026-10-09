/**
 * realistic/realistic-bird.js — Corvus and Tock, assembled for three.
 *
 * `createBird(THREE, { species: 'crow' | 'clockwork-owl' })` lands here
 * (bird-model.js routes it), for rivals and for the player alike. The return
 * value is the SAME contract the toon birds honour — group, parts, uniforms,
 * species, mech, triangleCount, drawCallCount, dispose — so bird-anim.js, the
 * FX, the camera, ai-racer.js and index.html drive a realistic bird without
 * knowing it is one. Two additions:
 *
 *   - `attachToScene(scene, renderer)`: binds the shared sky probe
 *     (environment.js) on high/mid. Call once after adding the group. Low has
 *     no probe and returns false; so does a disposed bird.
 *   - `uniforms.splay`: the outer primaries' fan, written by the animator on
 *     the downstroke (it is optional there; toon birds lack it).
 *
 * Draw calls (one per mesh; no outline hulls — see below):
 *   crow  body, head, tail, left wing, right wing     5 (4 on low: tail merged)
 *   owl   body (+tail, gears, key), head, two wings   4
 * Everything that moves on its own — the wrist, the fingers, the tail, every
 * gear and the key — moves in the vertex shader, which is how a bird with
 * two gear trains and a key is four draws.
 *
 * NO INK OUTLINE. The inverted hull is a cel device: on a lit, reflective
 * bird it reads as a cartoon sticker, and it would double the draw calls.
 * Readability at race distance comes instead from (a) size — REAL_DISPLAY_SCALE
 * keeps the body as big on screen as the cel bird's; (b) value — a near-black
 * crow is the darkest thing over both green lowland and pale alpine, brass is
 * the warmest; (c) a restrained gloss (the crow's blue-black film on its
 * upper surfaces only, the owl's brushed metal) and a thin Fresnel rim,
 * strongest on low where there is no probe. `opts.outline` is accepted and
 * ignored for these two.
 *
 * The probe is refcounted per renderer: baked when the first bird attaches,
 * destroyed when the last one releases, so a later race bakes it again.
 *
 * Zero per-frame allocation: the only per-frame code here is `orientEnv`, a
 * named function installed as each mesh's onBeforeRender, which writes two
 * angles into the material's existing Euler. Gear and key angles reach the
 * shader through uniform getters on the `mech` nodes the animator rotates.
 */

import { buildCrow } from './crow.js';
import { buildOwl } from './owl.js';
import { mirrorX } from './mesh-kit.js';
import { acquireFeatherTextures, releaseFeatherTextures } from './feather-textures.js';
import { createRealMaterial, lookUniforms } from './materials.js';
import { acquireBirdEnvironment, releaseBirdEnvironment, envRotationFor } from './environment.js';
import { PALETTE } from '../../core/palette.js';

export const REALISTIC_SPECIES = Object.freeze(['crow', 'clockwork-owl']);

function noop() {}

/** 'alt' (the clash tint) from an explicit flag or from the rival's alt colour. */
export function resolveVariant(species, opts = {}) {
    if (opts.variant === 'alt' || opts.variant === 'normal') return opts.variant;
    if (opts.altTint) return 'alt';
    if (species === 'crow' && opts.bodyColor === PALETTE.birdRival4Alt) return 'alt';
    if (species === 'clockwork-owl' && opts.bodyColor === PALETTE.birdRival5Alt) return 'alt';
    return 'normal';
}

/**
 * Display scale per species, applied to the whole bird (it multiplies
 * opts.scale, so player and rivals both get it). The realistic builds keep
 * real proportions: the wingspan matches the cel birds' at 1.0, but a real
 * crow's or owl's body is much smaller than a cel bird's relative to its
 * wings, and at the chase camera (~16 units back, BIRD_SCALE 2) that read as
 * a shrunken bird. These bring body length to >= ~80% of the cel build and
 * the projected chase-view area to roughly the cel bird's; the span grows to
 * ~3.9 (crow) and ~4.5 (owl), which reads fine. Pinned against the cel bbox
 * in the tests.
 */
export const REAL_DISPLAY_SCALE = Object.freeze({ crow: 1.35, 'clockwork-owl': 1.55 });

const RIM = {
    // The crow's rim is a faint cold edge, not a halo: a strong pale rim on a
    // near-black bird is what read grey-lavender in the race.
    crow: { color: 0x9db8e0, power: 3.0, strength: { high: 0.025, mid: 0.03, low: 0.18 } },
    'clockwork-owl': { color: 0xfff1cf, power: 3.0, strength: { high: 0.05, mid: 0.06, low: 0.14 } },
};

/** Probe reflection strength: kept low on the crow so the sky never greys the black. */
const ENV_INTENSITY = { crow: 0.42, 'clockwork-owl': 0.8 };

/** The build-time spec for a species/tier/variant (pure; the tests use it). */
export function buildRealisticSpec(species, quality, variant) {
    return species === 'crow' ? buildCrow({ quality, variant }) : buildOwl({ quality, variant });
}

function toGeometry(THREE, md) {
    const g = new THREE.BufferGeometry();
    for (const name in md.layout) {
        g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(md.arrays[name]), md.layout[name]));
    }
    const Index = md.vertexCount > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new Index(md.index), 1));
    if (typeof g.computeBoundingSphere === 'function') {
        g.computeBoundingSphere();
        // The shader bends wings and fans the tail past the rest bounds.
        if (g.boundingSphere) g.boundingSphere.radius *= 1.25;
    }
    return g;
}

/**
 * @param {object} THREE
 * @param {object} opts  createBird's options; species must be 'crow' or 'clockwork-owl'
 */
export function createRealisticBird(THREE, opts = {}) {
    const species = opts.species === 'crow' ? 'crow' : 'clockwork-owl';
    const crow = species === 'crow';
    const quality = opts.quality === 'low' || opts.quality === 'mid' ? opts.quality : 'high';
    const scale = opts.scale === undefined ? 1 : opts.scale;
    const variant = resolveVariant(species, opts);
    const spec = buildRealisticSpec(species, quality, variant);
    const rig = spec.rig;
    const textures = acquireFeatherTextures(THREE);

    const geometries = [];
    const materials = [];
    const meshes = [];

    const group = new THREE.Group();
    group.name = 'gauntletBird';
    group.scale.setScalar(scale * REAL_DISPLAY_SCALE[species]);
    const body = new THREE.Group();
    body.name = 'body';
    group.add(body);
    const head = new THREE.Group();
    head.name = 'head';
    head.rotation.order = 'YXZ';
    head.position.set(rig.head[0], rig.head[1], rig.head[2]);
    body.add(head);
    const wings = [];
    for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const g = new THREE.Group();
        g.name = side < 0 ? 'leftWing' : 'rightWing';
        g.rotation.order = 'YXZ';
        g.position.set(side * rig.shoulder[0], rig.shoulder[1], rig.shoulder[2]);
        body.add(g);
        wings.push(g);
    }

    // --- mechanism nodes (owl): the animator spins these on local Y and the
    // shader reads their angles through getter uniforms. --------------------
    let mech = null;
    let mechUniforms = null;
    if (!crow) {
        const key = new THREE.Object3D();
        key.name = 'windKey';
        key.position.set(spec.mech.keyBase[0], spec.mech.keyBase[1], spec.mech.keyBase[2]);
        body.add(key);
        const gear = new THREE.Object3D();
        gear.name = 'backGear';
        gear.position.set(spec.mech.bayCenter[0], spec.mech.bayCenter[1], spec.mech.bayCenter[2]);
        body.add(gear);
        mech = { key, gear };
        mechUniforms = {
            uGearAngle: { get value() { return gear.rotation.y; } },
            uKeyAngle: { get value() { return key.rotation.y; } },
        };
    }

    // --- uniform sets ---------------------------------------------------------
    const tail = {
        uTailYaw: { value: 0 }, uTailPitch: { value: 0 }, uTailFan: { value: 1 },
        uTailZ: { value: rig.tailZ }, uTailInv: { value: 1 / rig.tailLen },
    };
    const tailOff = {
        uTailYaw: { value: 0 }, uTailPitch: { value: 0 }, uTailFan: { value: 1 },
        uTailZ: { value: 0 }, uTailInv: { value: 0 },
    };
    const splay = { value: 0 };
    const wingSet = () => ({
        uCurl: { value: 0 }, uSweep: { value: 0 }, uSpanInv: { value: 1 / rig.wingSpan },
        uWristX: { value: rig.wristX }, uSplay: splay,
    });
    const wingOff = {
        uCurl: { value: 0 }, uSweep: { value: 0 }, uSpanInv: { value: 0 }, uWristX: { value: 1 }, uSplay: { value: 0 },
    };
    const blink = { uBlink: { value: 0 } };
    const look = lookUniforms({
        lid: spec.eye.lid,
        rim: { color: RIM[species].color, power: RIM[species].power, strength: RIM[species].strength[quality] },
        film: quality === 'mid' ? spec.film : null,
    });
    const wingL = wingSet(), wingR = wingSet();

    // Low's Phong specular: a restrained blue-black gloss on the crow; on the
    // owl the shader tints it per vertex toward the metal's own colour.
    const lowSpecular = crow ? 0x262c3e : (variant === 'alt' ? 0x4a5a7a : 0x6a5c40);
    const material = (kind, double, deform, tailSet) => {
        const m = createRealMaterial(THREE, {
            tier: quality, kind, double, mech: !crow, textures,
            film: spec.film, sheen: spec.sheen, filmUp: crow, envIntensity: ENV_INTENSITY[species],
            lowSpecular,
            uniforms: Object.assign({}, deform, tailSet, blink, look, mechUniforms || {}),
        });
        materials.push(m);
        return m;
    };

    // Body + head share one material (the same uniforms); the crow's tail and
    // each wing get their own because their deformer values differ. Double
    // sided: the body and head carry single-sheet plates too (scapulars,
    // nasal bristles, breast scales, the owl's tail, the crow's tail on low).
    const lowMerged = crow && quality === 'low';
    const bodyMat = crow ? material('contour', true, wingOff, lowMerged ? tail : tailOff) : material('metal', true, wingOff, tail);
    const tailMat = crow && !lowMerged ? material('vane', true, wingOff, tail) : null;
    const wingMats = [
        material(crow ? 'vane' : 'metal', true, wingL, tailOff),
        material(crow ? 'vane' : 'metal', true, wingR, tailOff),
    ];

    const add = (parent, name, md, mat) => {
        const geo = toGeometry(THREE, md);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = name;
        parent.add(mesh);
        geometries.push(geo);
        meshes.push(mesh);
        return mesh;
    };
    let bodyMesh = null, headMesh = null, tailMesh = null, rightData = null;
    for (const m of spec.meshes) {
        if (m.role === 'body') bodyMesh = add(body, m.name, m.data, bodyMat);
        else if (m.role === 'head') headMesh = add(head, m.name, m.data, bodyMat);
        else if (m.role === 'tail') tailMesh = add(body, m.name, m.data, tailMat);
        else if (m.role === 'wing') rightData = m.data;
    }
    const leftWingMesh = add(wings[0], 'leftWingMesh', mirrorX(rightData, 'leftWingMesh'), wingMats[0]);
    const rightWingMesh = add(wings[1], 'rightWingMesh', rightData, wingMats[1]);

    // --- anchors -------------------------------------------------------------
    function anchor(parent, name, p) {
        const a = new THREE.Object3D();
        a.name = name;
        a.position.set(p[0], p[1], p[2]);
        parent.add(a);
        return a;
    }
    const ha = spec.anchors.head, ba = spec.anchors.body, tip = spec.anchors.wingTip;
    const parts = {
        body, head,
        beak: anchor(head, 'beak', ha.beak),
        leftWing: wings[0], rightWing: wings[1],
        leftFoot: anchor(body, 'leftFoot', ba.leftFoot),
        rightFoot: anchor(body, 'rightFoot', ba.rightFoot),
        tail: anchor(body, 'tail', ba.tail),
        leftEye: anchor(head, 'leftEye', ha.leftEye),
        rightEye: anchor(head, 'rightEye', ha.rightEye),
        leftPupil: anchor(head, 'leftPupil', ha.leftPupil),
        rightPupil: anchor(head, 'rightPupil', ha.rightPupil),
        bodyMesh, headMesh, tailMesh, leftWingMesh, rightWingMesh,
        leftTip: anchor(wings[0], 'leftTip', [-tip[0], tip[1], tip[2]]),
        rightTip: anchor(wings[1], 'rightTip', tip),
    };

    let triangles = 0, drawCalls = 0;
    for (const m of meshes) {
        drawCalls++;
        const idx = m.geometry.index;
        triangles += (idx ? idx.count : m.geometry.getAttribute('position').count) / 3;
    }

    // --- the sky probe ---------------------------------------------------------
    let envRenderer = null;
    const _rot = { x: 0, y: 0 };
    /** onBeforeRender: aim this material's probe zenith at the radial up. */
    function orientEnv() {
        const e = this.matrixWorld.elements;
        const x = e[12], y = e[13], z = e[14];
        const l = Math.sqrt(x * x + y * y + z * z);
        if (!(l > 1e-6)) return;
        envRotationFor(x / l, y / l, z / l, _rot);
        const r = this.material.envMapRotation;
        if (r) r.set(-_rot.x, -_rot.y, 0, 'XYZ');
    }
    let disposed = false;
    function attachToScene(scene, renderer) {
        // After dispose() nothing may take a probe reference: dispose has
        // already run and would never give it back.
        if (disposed) return false;
        if (envRenderer || quality === 'low' || !renderer) return !!envRenderer;
        const tex = acquireBirdEnvironment(THREE, renderer);
        envRenderer = renderer;
        for (let i = 0; i < materials.length; i++) {
            materials[i].envMap = tex;
            materials[i].needsUpdate = true;
        }
        for (let i = 0; i < meshes.length; i++) meshes[i].onBeforeRender = orientEnv;
        return true;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        for (let i = 0; i < meshes.length; i++) meshes[i].onBeforeRender = noop;
        for (let i = 0; i < geometries.length; i++) geometries[i].dispose();
        for (let i = 0; i < materials.length; i++) {
            materials[i].envMap = null;
            materials[i].dispose();
        }
        releaseFeatherTextures(THREE);
        if (envRenderer) { releaseBirdEnvironment(envRenderer); envRenderer = null; }
        if (group.parent) group.parent.remove(group);
    }

    return {
        group,
        parts,
        uniforms: {
            blink: blink.uBlink,
            tailYaw: tail.uTailYaw,
            tailPitch: tail.uTailPitch,
            tailFan: tail.uTailFan,
            leftCurl: wingL.uCurl,
            leftSweep: wingL.uSweep,
            rightCurl: wingR.uCurl,
            rightSweep: wingR.uSweep,
            splay,
        },
        species,
        variant,
        quality,
        realistic: true,
        mech,
        triangleCount: triangles,
        drawCallCount: drawCalls,
        // For the probe page and the tests.
        materials,
        geometries,
        textures,
        gearTrains: crow ? null : { back: spec.mech.backTrain, wing: spec.mech.wingTrain },
        attachToScene,
        dispose,
    };
}
