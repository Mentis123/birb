/**
 * The realism contract for Birb Gauntlet's realistic Corvus (crow) and Tock
 * (clockwork owl) — gauntlet/src/bird/realistic/.
 *
 * `node --test`, no DOM, no WebGL. The species builders are PURE (plain
 * arrays), so budgets, gear meshing and feather layout are measured on the
 * exact mesh the game uploads. The THREE adapter runs against a stub built
 * here (the tracked node_modules/three stub is deliberately minimal and is
 * NOT edited): enough of Group/Mesh/BufferGeometry/materials/DataTexture/
 * PMREMGenerator to assemble a bird, drive it with the real animator, and
 * prove dispose() gives everything back.
 *
 * What is pinned, and why each is load-bearing:
 *   - the default birb (and the cel trio) is untouched: the toon builder's
 *     source is frozen by hash, and createBird only routes crow/owl away;
 *   - per-tier draw calls and triangles for both species and both variants;
 *   - every gear train meshes: module, centre distance, ratio, rest phase,
 *     and the animator's 2*pi wrap is a visual no-op for every gear;
 *   - dispose() releases geometry, materials, the shared textures and the
 *     shared sky probe, refcounted across birds;
 *   - no allocation in any new per-frame path (source inspection, the same
 *     test the roster suite uses);
 *   - the films: the crow's restrained blue -> violet gloss (small weights,
 *     upper surfaces only) and blued steel's blue are what the physics gives;
 *   - size: the display scale keeps body length >= 70% of the cel build.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Matrix4 } from 'three';

import { createBird } from '../gauntlet/src/bird/bird-model.js';
import { createBirdAnimator } from '../gauntlet/src/bird/bird-anim.js';
import {
    createRealisticBird, buildRealisticSpec, resolveVariant, REALISTIC_SPECIES, REAL_DISPLAY_SCALE, SHADE,
} from '../gauntlet/src/bird/realistic/realistic-bird.js';
import {
    buildCrow, CROW_FILM, CROW_LOD, CROW_RIG, CROW_BODY_ROWS, CROW_HEAD_ROWS,
} from '../gauntlet/src/bird/realistic/crow.js';
import { buildOwl, OWL_ALT_FILM, OWL_MODULE, OWL_RIG } from '../gauntlet/src/bird/realistic/owl.js';
import {
    OWL_BACK_TRAIN, OWL_WING_TRAIN, SPIN, solveTrain, meshError, gearOutline, gearPrim, countTeeth,
    pitchRadius, tipRadius,
} from '../gauntlet/src/bird/realistic/gears.js';
import { thinFilmReflectance, hueDegrees, FILM_RAMP_COS, hexToLinear } from '../gauntlet/src/bird/realistic/film.js';
import {
    contourTileData, vaneTileData, brushedTileData, engraveAtlasData, featherTextureRefs,
    TEXTURE_SIZES, ENGRAVE_BLANK_V,
} from '../gauntlet/src/bird/realistic/feather-textures.js';
import {
    patchRealShader, SHADE_WARM, SHADE_GLASS_DIM, dielectricWeight,
} from '../gauntlet/src/bird/realistic/materials.js';
import {
    birdEnvironmentRefs, envRotationFor, equirectSkyData, rowUpComponent, birdSkyColors, skyRadianceAt,
} from '../gauntlet/src/bird/realistic/environment.js';
import { triangleCount, mirrorX } from '../gauntlet/src/bird/realistic/mesh-kit.js';
import { PALETTE } from '../gauntlet/src/core/palette.js';
import { createAIRacers, AI_CONFIG } from '../gauntlet/src/race/ai-racer.js';
import { floorRadius } from '../gauntlet/src/core/terrain.js';

const SPECIES = ['crow', 'clockwork-owl'];
const TIERS = ['high', 'mid', 'low'];
const VARIANTS = ['normal', 'alt'];

// ---------------------------------------------------------------------------
// A stub THREE, extended locally. It records disposals so the tests can
// check that dispose() releases what the bird built.
// ---------------------------------------------------------------------------

function makeStub() {
    const log = { geometries: 0, materials: 0, textures: 0, targets: 0, pmrem: 0 };
    class V3 extends Vector3 {
        get isVector3() { return true; }
        subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
        lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
    }
    class Euler {
        constructor() { this.x = 0; this.y = 0; this.z = 0; this.order = 'XYZ'; }
        set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this; }
    }
    class Object3D {
        constructor() {
            this.name = ''; this.children = []; this.parent = null; this.userData = {}; this.visible = true;
            this.position = new V3();
            this.quaternion = new Quaternion();
            this.rotation = new Euler();
            const s = { x: 1, y: 1, z: 1 };
            s.set = (x, y, z) => { s.x = x; s.y = y; s.z = z; return s; };
            s.setScalar = (k) => s.set(k, k, k);
            this.scale = s;
            this.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
        }
        add(o) { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); return this; }
        remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
        traverse(fn) { fn(this); for (const c of this.children.slice()) c.traverse(fn); }
    }
    class Group extends Object3D { get isGroup() { return true; } }
    class Mesh extends Object3D {
        constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
        get isMesh() { return true; }
    }
    class BufferAttribute {
        constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
    }
    class BufferGeometry {
        constructor() { this.attributes = {}; this.index = null; this.disposed = false; }
        setAttribute(n, a) { this.attributes[n] = a; return this; }
        getAttribute(n) { return this.attributes[n]; }
        setIndex(i) { this.index = i; return this; }
        dispose() { if (!this.disposed) log.geometries++; this.disposed = true; }
    }
    class Material {
        constructor(p) {
            Object.assign(this, p);
            this.userData = {};
            this.envMap = null;
            this.envMapRotation = new Euler();
            const ns = { x: 1, y: 1 };
            ns.set = (a, b) => { ns.x = a; ns.y = b; return ns; };
            this.normalScale = ns;
            this.disposed = false;
        }
        dispose() { if (!this.disposed) log.materials++; this.disposed = true; }
    }
    class MeshPhysicalMaterial extends Material {
        get isMeshPhysicalMaterial() { return true; }
        get isMeshStandardMaterial() { return true; }
    }
    class MeshStandardMaterial extends Material { get isMeshStandardMaterial() { return true; } }
    class MeshPhongMaterial extends Material {
        get isMeshPhongMaterial() { return true; }
        constructor(p) { super(p); delete this.normalScale; }
    }
    class DataTexture {
        constructor(data, width, height, format, type) {
            this.image = { data, width, height }; this.format = format; this.type = type;
            this.channel = 0; this.disposed = false;
        }
        dispose() { if (!this.disposed) log.textures++; this.disposed = true; }
    }
    class PMREMGenerator {
        constructor(renderer) { this.renderer = renderer; this.disposed = false; }
        compileEquirectangularShader() {}
        fromEquirectangular(tex) {
            assert.equal(tex.mapping, 'equirect', 'the probe source is an equirect');
            log.pmrem++;
            return { texture: { isProbe: true }, dispose() { log.targets++; this.disposed = true; } };
        }
        dispose() { this.disposed = true; }
    }
    const THREE = {
        Vector3: V3, Quaternion, Matrix4, Euler, Object3D, Group, Mesh, BufferAttribute, BufferGeometry,
        MeshPhysicalMaterial, MeshStandardMaterial, MeshPhongMaterial, DataTexture, PMREMGenerator,
        FrontSide: 0, BackSide: 1, DoubleSide: 2, RepeatWrapping: 'repeat', ClampToEdgeWrapping: 'clamp',
        LinearFilter: 'linear', LinearMipmapLinearFilter: 'mip', RGBAFormat: 'rgba', FloatType: 'float',
        EquirectangularReflectionMapping: 'equirect',
        Color: class { constructor(h = 0) { this.h = h; } setHex(h) { this.h = h; return this; } },
    };
    return { THREE, log };
}

const allMeshes = (bird) => {
    const out = [];
    bird.group.traverse((o) => { if (o.isMesh) out.push(o); });
    return out;
};

// ---------------------------------------------------------------------------
// the default birb, and the cel trio, are untouched
// ---------------------------------------------------------------------------

test('the toon birb builder is byte-for-byte what it was (source frozen by hash)', () => {
    // Everything bird-model.js builds for 'birb' lives in these two regions:
    // the geometry/shader helpers, and createBird's body after the realistic
    // early return. Pinned at the commit before the realistic species landed.
    // Editing either is a GATE decision (it changes the default bird), so the
    // hash moves in the same commit as the change that blesses it.
    const src = readFileSync(new URL('../gauntlet/src/bird/bird-model.js', import.meta.url), 'utf8');
    const a = src.slice(src.indexOf('function xform('), src.indexOf('// The factory.'));
    const b = src.slice(src.indexOf('    const bodyColor = opts.bodyColor === undefined'));
    const h = (s) => createHash('sha256').update(s).digest('hex');
    assert.equal(h(a), '60b851a93f705eddf5ab4e9645936f4cf71e086410e92d63059634dd11824bd8', 'toon helpers changed');
    assert.equal(h(b), 'fd52e42c284d1bba67e845f53013febabb079fc94375071d07b7722918d67b18', 'toon createBird body changed');
});

test('createBird routes ONLY crow and owl to the realistic builder', () => {
    // A THREE whose very first toon call throws a sentinel: reaching it proves
    // the toon path ran, and the shared texture refcount proves the realistic
    // builder did not.
    const sentinel = new Proxy({}, { get(_, k) { if (k === 'then') return undefined; throw new Error('TOON_PATH:' + String(k)); } });
    for (const species of [undefined, 'birb', 'BIRB', 'robin', 42]) {
        assert.throws(() => createBird(sentinel, { species }), /TOON_PATH/, String(species));
    }
    assert.throws(() => createBird(sentinel, { species: 'crow', realistic: false }), /TOON_PATH/, 'the cel crow is still reachable');
    assert.throws(() => createBird(sentinel, { species: 'owl', realistic: false }), /TOON_PATH/);
    const { THREE } = makeStub();
    for (const species of ['crow', 'corvus', 'owl', 'clockwork-owl', 'tock']) {
        const bird = createBird(THREE, { species, quality: 'low' });
        assert.equal(bird.realistic, true, species);
        assert.ok(REALISTIC_SPECIES.includes(bird.species));
        bird.dispose();
    }
    assert.equal(featherTextureRefs(THREE), 0);
});

// ---------------------------------------------------------------------------
// budgets
// ---------------------------------------------------------------------------

const BUDGET = {
    // Per bird. The task's ceilings are <= 8 draws / <= 6k tris on high and
    // <= 2.5k on low; the measured numbers sit under them, and the draw
    // calls are pinned exactly so a creeping mesh count is loud.
    crow: { high: [5, 6000], mid: [5, 6000], low: [4, 2500] },
    'clockwork-owl': { high: [4, 6000], mid: [4, 6000], low: [4, 2500] },
};

test('per-tier draw calls and triangles, both species, both variants', () => {
    const { THREE } = makeStub();
    for (const species of SPECIES) {
        let prevTris = Infinity;
        for (const quality of TIERS) {
            const [draws, tris] = BUDGET[species][quality];
            for (const variant of VARIANTS) {
                const bird = createRealisticBird(THREE, { species, quality, variant });
                const label = `${species}/${quality}/${variant}`;
                assert.equal(bird.drawCallCount, draws, label + ' draws');
                assert.equal(allMeshes(bird).length, draws, label + ' meshes in the group');
                assert.ok(bird.triangleCount <= tris, `${label}: ${bird.triangleCount} > ${tris}`);
                const spec = buildRealisticSpec(species, quality, variant);
                assert.equal(bird.triangleCount, spec.triangles, label + ' adapter uploads exactly the spec');
                assert.equal(bird.drawCallCount, spec.drawCalls);
                if (variant === 'normal') {
                    assert.ok(bird.triangleCount <= prevTris, label + ' never more than the tier above');
                    prevTris = bird.triangleCount;
                }
                bird.dispose();
            }
        }
    }
});

/** Rest-pose bounds of a spec, in group space (display scale applied). */
function specBounds(spec, k) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const r = spec.rig;
    for (const m of spec.meshes) {
        const P = m.data.arrays.position;
        const o = m.role === 'head' ? r.head : m.role === 'wing' ? r.shoulder : [0, 0, 0];
        for (let i = 0; i < P.length; i += 3) {
            for (const sx of (m.role === 'wing' ? [1, -1] : [1])) {
                const p = [sx * (P[i] + o[0]), P[i + 1] + o[1], P[i + 2] + o[2]];
                for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], p[j] * k); mx[j] = Math.max(mx[j], p[j] * k); }
            }
        }
    }
    return { min: mn, max: mx, size: mx.map((x, j) => x - mn[j]) };
}

// The cel builds' rest bounds at scale 1, [span, height, length], as the
// operator measured them in headless Chrome (three r183) before this change.
const CEL_BOUNDS = { crow: [3.01, 1.10, 2.90], 'clockwork-owl': [2.85, 1.29, 2.10] };

test('display scale: the realistic birds read as big as the cel birds did', () => {
    const { THREE } = makeStub();
    assert.deepEqual(Object.keys(REAL_DISPLAY_SCALE).sort(), [...SPECIES].sort());
    for (const species of SPECIES) {
        const k = REAL_DISPLAY_SCALE[species];
        for (const quality of TIERS) {
            for (const variant of VARIANTS) {
                const label = `${species}/${quality}/${variant}`;
                const b = specBounds(buildRealisticSpec(species, quality, variant), k);
                const cel = CEL_BOUNDS[species];
                const [span, height, length] = b.size.map((s, j) => s / cel[j]);
                assert.ok(length >= 0.70 && length <= 1.05, label + ' body length / cel ' + length.toFixed(2));
                assert.ok(height >= 0.55 && height <= 1.05, label + ' height / cel ' + height.toFixed(2));
                assert.ok(span >= 1.15 && span <= 1.65, label + ' span / cel ' + span.toFixed(2) + ' (may grow; capped)');
                assert.ok(b.size[0] <= 4.6, label + ' span ' + b.size[0].toFixed(2));
            }
        }
        // The scale composes with opts.scale, for player and rivals alike.
        for (const scale of [1, 2]) {
            const bird = createRealisticBird(THREE, { species, quality: 'low', scale });
            assert.equal(bird.group.scale.x, scale * k, species + ' scale ' + scale);
            bird.dispose();
        }
        const viaFactory = createBird(THREE, { species, quality: 'low', scale: 2 });
        assert.equal(viaFactory.group.scale.x, 2 * k, species + ' through createBird');
        viaFactory.dispose();
    }
});

test('silhouettes: the crow\'s head sits on a thick neck; the owl\'s head sinks into its mantle', () => {
    for (const quality of TIERS) {
        const crow = buildCrow({ quality });
        const headRows = CROW_HEAD_ROWS, bodyRows = CROW_BODY_ROWS;
        const skullW = Math.max(...headRows.map((r) => r.w));
        assert.ok(bodyRows[0].w >= 0.8 * skullW, 'neck about the head\'s width: ' + bodyRows[0].w + ' vs ' + skullW);
        assert.ok(CROW_RIG.head[2] >= -0.44, 'head close to the shoulders: z ' + CROW_RIG.head[2]);
        const neckReach = -bodyRows[0].z - (-CROW_RIG.shoulder[2]);
        assert.ok(neckReach < 0.32, 'short neck reach ' + neckReach.toFixed(3));
        // Deep chest: deeper below than above at the breast.
        const breast = bodyRows.find((r) => r.z === -0.19);
        assert.ok(breast.b > 1.4 * breast.t, 'deep keel');
        // The bill: about the skull's length, heavy at the base.
        const P = crow.meshes.find((m) => m.role === 'head').data.arrays.position;
        let minZ = 0;
        for (let i = 2; i < P.length; i += 3) minZ = Math.min(minZ, P[i]);
        const skullLen = headRows[0].z - headRows[headRows.length - 1].z;
        const billLen = -0.215 - minZ;
        assert.ok(billLen > 0.65 * skullLen && billLen < 1.0 * skullLen, 'bill ' + billLen.toFixed(3) + ' vs skull ' + skullLen.toFixed(3));

        const owl = buildOwl({ quality });
        const head = owl.meshes.find((m) => m.role === 'head').data.arrays.position;
        let headMinY = Infinity, headMaxZ = -Infinity;
        for (let i = 0; i < head.length; i += 3) { headMinY = Math.min(headMinY, head[i + 1]); headMaxZ = Math.max(headMaxZ, head[i + 2]); }
        headMinY += OWL_RIG.head[1];
        headMaxZ += OWL_RIG.head[2];
        // The body's top under the back of the head.
        const body = owl.meshes.find((m) => m.role === 'body').data.arrays.position;
        let bodyTopUnderHead = -Infinity;
        for (let i = 0; i < body.length; i += 3) {
            if (Math.abs(body[i]) < 0.05 && body[i + 2] > headMaxZ - 0.12 && body[i + 2] < headMaxZ) {
                bodyTopUnderHead = Math.max(bodyTopUnderHead, body[i + 1]);
            }
        }
        assert.ok(headMinY < bodyTopUnderHead - 0.10, `owl head overlaps the mantle: head bottom ${headMinY.toFixed(3)} vs body top ${bodyTopUnderHead.toFixed(3)}`);
    }
});

test('the owl: brushed (not mirror) brass, steel gears, cream enamel disc on every tier', () => {
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const discLin = hexToLinear(PALETTE.realOwlDisc);
    for (const quality of TIERS) {
        const spec = buildOwl({ quality });
        let brassShell = 0, steelShell = 0, total = 0, discVerts = 0;
        const body = spec.meshes.find((m) => m.role === 'body').data;
        const brass = hexToLinear(PALETTE.realBrass), steel = hexToLinear(PALETTE.realSteel);
        for (let v = 0; v < body.vertexCount; v++) {
            const c = [body.arrays.color[v * 3], body.arrays.color[v * 3 + 1], body.arrays.color[v * 3 + 2]];
            const s = body.arrays.aSurf.slice(v * 4, v * 4 + 4);
            total++;
            if (near(c[0], brass[0]) && near(c[1], brass[1])) {
                brassShell++;
                assert.ok(s[1] >= 0.26, 'brass never mirror-smooth: ' + s[1]);
                if (s[1] > 0.4) assert.ok(s[3] <= 0.15, 'shell lacquer, not a second mirror: ' + s[3]);
            }
            if (near(c[0], steel[0]) && near(c[1], steel[1])) steelShell++;
        }
        assert.ok(steelShell / total > 0.15, quality + ' steel share ' + (steelShell / total).toFixed(2));
        assert.ok(brassShell > 0, quality + ' has brushed brass');
        const head = spec.meshes.find((m) => m.role === 'head').data;
        for (let v = 0; v < head.vertexCount; v++) {
            const c = head.arrays.color;
            if (near(c[v * 3], discLin[0]) && near(c[v * 3 + 1], discLin[1]) && near(c[v * 3 + 2], discLin[2])) {
                discVerts++;
                assert.equal(head.arrays.aSurf[v * 4], 0, 'the disc is enamel (dielectric), so Phong and PBR agree');
            }
        }
        assert.ok(discVerts > 0, quality + ' cream disc present');
    }
    // Low's metal: per-surface Phong, warm brass specular base, never blue.
    const lowSpec = hexToLinear(0x6a5c40);
    assert.ok(lowSpec[0] > lowSpec[2], 'warm low specular');
    // Brushing reads at distance: roughness varies more across v (the bands)
    // than along u (the brush direction).
    const t = brushedTileData(64, 64);
    const g = (x, y) => t.surf[(y * 64 + x) * 4 + 1];
    let du = 0, dv = 0;
    for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) { du += Math.abs(g(x + 1, y) - g(x, y)); dv += Math.abs(g(x, y + 1) - g(x, y)); }
    assert.ok(dv > du * 1.2, 'anisotropic brushing: dv ' + dv.toFixed(1) + ' du ' + du.toFixed(1));
});

test('the realistic pair never costs the field more draws than the cel pair did', () => {
    // The cel crow was 8 draws and the cel owl 11 (10 on low), outlines on.
    const { THREE } = makeStub();
    for (const quality of TIERS) {
        const c = createRealisticBird(THREE, { species: 'crow', quality });
        const o = createRealisticBird(THREE, { species: 'clockwork-owl', quality });
        assert.ok(c.drawCallCount < 8 && o.drawCallCount < 10, quality);
        c.dispose(); o.dispose();
    }
});

test('every mesh carries every attribute its shader declares, at full length', () => {
    for (const species of SPECIES) {
        for (const quality of TIERS) {
            const spec = buildRealisticSpec(species, quality, 'normal');
            for (const m of spec.meshes) {
                const md = m.data;
                for (const name in md.layout) {
                    assert.equal(md.arrays[name].length, md.vertexCount * md.layout[name], `${species}/${quality}/${m.name}.${name}`);
                    for (const v of md.arrays[name]) assert.ok(Number.isFinite(v), `${m.name}.${name} finite`);
                }
                for (const i of md.index) assert.ok(i >= 0 && i < md.vertexCount);
            }
        }
    }
});

// ---------------------------------------------------------------------------
// the crow
// ---------------------------------------------------------------------------

function wingData(spec) {
    return spec.meshes.find((m) => m.role === 'wing').data;
}

test('the crow: long broad wings, a heavy bill, fingered primaries that splay', () => {
    for (const quality of TIERS) {
        const spec = buildCrow({ quality });
        const span = 2 * (CROW_RIG.shoulder[0] + spec.anchors.wingTip[0]);
        assert.ok(span > 2.6 && span < 3.2, quality + ' span ' + span.toFixed(2));
        // Splay factors: one distinct non-zero value per finger.
        const def = wingData(spec).arrays.aDef;
        const splays = new Set();
        for (let i = 0; i < def.length; i += 4) if (def[i + 1] !== 0) splays.add(def[i + 1].toFixed(4));
        assert.ok(splays.size >= 5 && splays.size <= 6, quality + ' fingers ' + splays.size);
        // The hand is everything past the wrist, and only that.
        const pos = wingData(spec).arrays.position;
        let hand = 0;
        for (let i = 0; i < def.length; i += 4) {
            if (def[i] > 0.99) { hand++; assert.ok(pos[(i / 4) * 3] > CROW_RIG.wristX - 0.06, 'hand vertex inboard of the wrist'); }
        }
        assert.ok(hand > 0, 'the wing has a hand');
    }
    // The bill is a third of the head-to-tail length or more of the head mesh's reach.
    const head = buildCrow({}).meshes.find((m) => m.role === 'head').data.arrays.position;
    let minZ = 0;
    for (let i = 2; i < head.length; i += 3) minZ = Math.min(minZ, head[i]);
    assert.ok(minZ < -0.44, 'a long bill: tip at z ' + minZ.toFixed(3));
});

test('the hooded crow (clash tint): ash-grey body, black hood, wings and tail', () => {
    const lum = (arr, i) => 0.2126 * arr[i] + 0.7152 * arr[i + 1] + 0.0722 * arr[i + 2];
    const greyShare = (md) => {
        let grey = 0;
        for (let i = 0; i < md.arrays.color.length; i += 3) if (lum(md.arrays.color, i) > 0.12) grey++;
        return grey / md.vertexCount;
    };
    const normal = buildCrow({ variant: 'normal' }), hooded = buildCrow({ variant: 'alt' });
    const body = (s) => s.meshes.find((m) => m.role === 'body').data;
    assert.equal(greyShare(body(normal)), 0, 'the carrion crow is black all over');
    assert.ok(greyShare(body(hooded)) > 0.4, 'the hooded crow body is mostly grey');
    for (const role of ['head', 'wing']) {
        assert.equal(greyShare(hooded.meshes.find((m) => m.role === role).data), 0, 'hooded ' + role + ' stays black');
    }
    // The tail is black; only its undertail coverts are grey, as the real bird's are.
    const tailGrey = greyShare(hooded.meshes.find((m) => m.role === 'tail').data);
    assert.ok(tailGrey > 0 && tailGrey < 0.25, 'hooded tail: grey vent only (' + tailGrey.toFixed(2) + ')');
    // No gloss on the grey.
    const b = body(hooded);
    for (let v = 0; v < b.vertexCount; v++) {
        if (lum(b.arrays.color, v * 3) > 0.12) assert.equal(b.arrays.aSurf[v * 4 + 2], 0, 'grey feathers carry no film');
    }
});

test('the eye mask (blink) is on the head only', () => {
    for (const species of SPECIES) {
        const spec = buildRealisticSpec(species, 'high', 'normal');
        for (const m of spec.meshes) {
            const masked = m.data.arrays.aMask.some((v) => v > 0);
            assert.equal(masked, m.role === 'head', species + ' ' + m.name);
        }
    }
});

// ---------------------------------------------------------------------------
// the owl's gear trains
// ---------------------------------------------------------------------------

test('every gear train meshes: module, centre distance, ratio, phase at any angle', () => {
    for (const train of [OWL_BACK_TRAIN, OWL_WING_TRAIN]) {
        const placed = solveTrain(train, OWL_MODULE);
        const byId = new Map(placed.map((g) => [g.id, g]));
        for (const g of placed) {
            if (!g.meshes) continue;
            const a = byId.get(g.meshes);
            const d = Math.hypot(g.center[0] - a.center[0], g.center[1] - a.center[1]);
            assert.ok(Math.abs(d - OWL_MODULE * (a.teeth + g.teeth) / 2) < 1e-12, g.id + ' centre distance');
            assert.ok(Math.abs(g.ratio + a.ratio * a.teeth / g.teeth) < 1e-12, g.id + ' ratio');
            // Pitch-line speeds match (no slip): |w| * r equal on both gears.
            assert.ok(Math.abs(Math.abs(g.ratio) * g.pitchR - Math.abs(a.ratio) * a.pitchR) < 1e-12);
            for (let k = 0; k < 60; k++) {
                const phase = k * 0.731 - 7;
                assert.ok(meshError(a, g, phase, OWL_MODULE) < 1e-9, `${a.id}/${g.id} at ${phase}: ${meshError(a, g, phase, OWL_MODULE)}`);
            }
            // And a deliberately mis-phased gear is caught.
            const off = Object.assign({}, g, { phi0: g.phi0 + Math.PI / g.teeth / 2 });
            assert.ok(meshError(a, off, 0, OWL_MODULE) > 1e-4, 'the check can fail');
        }
    }
});

test('the animator\'s 2*pi wrap moves every gear by whole teeth AND whole spokes', () => {
    for (const train of [OWL_BACK_TRAIN, OWL_WING_TRAIN]) {
        for (const g of solveTrain(train, OWL_MODULE)) {
            const isInt = (x) => Math.abs(x - Math.round(x)) < 1e-9;
            assert.ok(isInt(Math.abs(g.ratio) * g.teeth), g.id + ' teeth');
            if (g.spokes) assert.ok(isInt(Math.abs(g.ratio) * g.spokes), g.id + ' spokes');
        }
    }
    assert.deepEqual(solveTrain(OWL_BACK_TRAIN).map((g) => g.ratio), [1, -2, -1.5]);
    assert.deepEqual(solveTrain(OWL_WING_TRAIN).map((g) => g.ratio), [1, -1.5]);
});

test('gear geometry has real teeth, sized by the module', () => {
    for (const n of [8, 12, 16, 24]) {
        for (const per of [4, 6]) {
            const o = gearOutline(n, per, OWL_MODULE);
            assert.equal(countTeeth(o), n, n + ' teeth, ' + per + ' points each');
            assert.equal(o.pts.length, n * per);
            assert.ok(Math.abs(o.ra - tipRadius(n, OWL_MODULE)) < 1e-12);
            assert.ok(Math.abs(o.rp - pitchRadius(n, OWL_MODULE)) < 1e-12);
            assert.ok(Math.abs(o.ra - o.rr - 2.25 * OWL_MODULE) < 1e-12, 'whole depth 2.25 modules');
        }
        const prim = gearPrim(n, { module: OWL_MODULE, spokes: n % 4 === 0 ? 4 : 0 });
        for (let i = 0; i < prim.pos.length; i += 3) {
            assert.ok(Math.hypot(prim.pos[i], prim.pos[i + 2]) <= tipRadius(n, OWL_MODULE) + 1e-9, 'nothing outside the tip circle');
        }
    }
});

test('the owl mesh spins each gear about its own placed centre at its train ratio', () => {
    for (const quality of TIERS) {
        const spec = buildOwl({ quality });
        const body = spec.meshes.find((m) => m.role === 'body').data;
        const ratios = new Map();
        let keyVerts = 0;
        for (let v = 0; v < body.vertexCount; v++) {
            const kind = body.arrays.aAxis[v * 4 + 3];
            if (kind === SPIN.KEY) keyVerts++;
            if (kind !== SPIN.GEAR) continue;
            const g = body.arrays.aGear;
            const r = g[v * 4 + 3];
            const placed = spec.mech.backTrain.find((p) => Math.abs(p.ratio - r) < 1e-12);
            assert.ok(placed, 'every spinning vertex belongs to a placed gear (ratio ' + r + ')');
            assert.ok(Math.abs(g[v * 4] - placed.pivot[0]) < 1e-9 && Math.abs(g[v * 4 + 2] - placed.pivot[2]) < 1e-9);
            const p = body.arrays.position;
            const d = Math.hypot(p[v * 3] - placed.pivot[0], p[v * 3 + 1] - placed.pivot[1], p[v * 3 + 2] - placed.pivot[2]);
            assert.ok(d <= tipRadius(placed.teeth, OWL_MODULE) + 0.03, 'gear vertex near its own axis');
            ratios.set(r, (ratios.get(r) || 0) + 1);
        }
        const want = quality === 'low' ? [1, -2] : [1, -2, -1.5];
        assert.deepEqual([...ratios.keys()].sort(), want.slice().sort(), quality + ' back train ratios');
        assert.ok(keyVerts > 0, quality + ': the key spins on its own shaft');
        // Wing trains, and the left wing's mirror image turns the other way.
        const wing = spec.meshes.find((m) => m.role === 'wing').data;
        const wr = new Set(), lr = new Set();
        const left = mirrorX(wing);
        for (let v = 0; v < wing.vertexCount; v++) {
            if (wing.arrays.aAxis[v * 4 + 3] === SPIN.GEAR) wr.add(wing.arrays.aGear[v * 4 + 3]);
            if (left.arrays.aAxis[v * 4 + 3] === SPIN.GEAR) lr.add(left.arrays.aGear[v * 4 + 3]);
        }
        assert.deepEqual([...wr].sort(), quality === 'low' ? [] : [-1.5, 1], quality + ' wing train');
        assert.deepEqual([...lr].sort(), quality === 'low' ? [] : [-1, 1.5], 'mirrored wing reverses');
    }
});

// ---------------------------------------------------------------------------
// the animator drives a realistic bird through the unchanged contract
// ---------------------------------------------------------------------------

function animState(extra) {
    return Object.assign({
        speed01: 0.5, turn: 0, pitch: 0, boosting: false, flapImpulse: 1,
        tumbling: false, grounded: false, celebrating: false, phase: 0,
    }, extra);
}

test('the animator flaps the crow, lags its hand, and fans its fingers on the downstroke', () => {
    const { THREE } = makeStub();
    const bird = createRealisticBird(THREE, { species: 'crow' });
    const anim = createBirdAnimator(THREE, bird);
    const s = animState({ pitch: 0.7 });
    let maxSplay = 0, maxCurl = 0, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 240; i++) {
        anim.update(1 / 60, s);
        maxSplay = Math.max(maxSplay, bird.uniforms.splay.value);
        maxCurl = Math.max(maxCurl, Math.abs(bird.uniforms.rightCurl.value));
        minZ = Math.min(minZ, bird.parts.rightWing.rotation.z);
        maxZ = Math.max(maxZ, bird.parts.rightWing.rotation.z);
    }
    assert.ok(maxSplay > 0.5, 'fingers fan on the downstroke: ' + maxSplay);
    assert.ok(maxCurl > 0.05, 'the hand lags the shoulder: ' + maxCurl);
    assert.ok(maxZ - minZ > 0.5, 'a climbing crow beats');
    bird.dispose();
});

test('the owl\'s key and gears reach the shader through the mech nodes the animator spins', () => {
    const { THREE } = makeStub();
    const bird = createRealisticBird(THREE, { species: 'clockwork-owl' });
    const anim = createBirdAnimator(THREE, bird);
    const u = bird.materials[0].userData.realistic.uniforms;
    const s = animState({ keySpin: 1.4 });
    for (let i = 0; i < 30; i++) anim.update(1 / 60, s);
    assert.ok(Math.abs(bird.mech.key.rotation.y - 0.7) < 1e-9);
    assert.equal(u.uKeyAngle.value, bird.mech.key.rotation.y, 'the key uniform IS the key node');
    assert.ok(u.uGearAngle.value > 0, 'gears turn in flight');
    s.keySpin = -26; s.rewinding = true;
    anim.update(1 / 60, s);
    assert.ok(u.uKeyAngle.value < 0.7, 'the key winds back on the rewind');
    // Every material of the bird sees the same mechanism.
    for (const m of bird.materials) assert.equal(m.userData.realistic.uniforms.uGearAngle.value, u.uGearAngle.value);
    bird.dispose();
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

test('dispose() releases geometry, materials, the shared textures and the shared probe', () => {
    const { THREE, log } = makeStub();
    const renderer = { id: 'r1' };
    const scene = new THREE.Group();
    const a = createRealisticBird(THREE, { species: 'crow', quality: 'high' });
    const b = createRealisticBird(THREE, { species: 'clockwork-owl', quality: 'mid' });
    scene.add(a.group); scene.add(b.group);
    assert.equal(a.textures, b.textures, 'one texture set per page, shared');
    assert.equal(featherTextureRefs(THREE), 2);
    assert.equal(a.attachToScene(scene, renderer), true);
    assert.equal(b.attachToScene(scene, renderer), true);
    assert.equal(a.attachToScene(scene, renderer), true, 'idempotent');
    assert.equal(log.pmrem, 1, 'the probe is baked ONCE per renderer');
    // ...and its equirect source is released the moment the cube exists.
    assert.equal(log.textures, 1, 'the bake source, and only it, is already gone');
    assert.equal(birdEnvironmentRefs(renderer), 2);
    for (const m of a.materials.concat(b.materials)) assert.ok(m.envMap && m.envMap.isProbe, 'bound');
    const all = [
        b.textures.contour.map, b.textures.contour.normal, b.textures.contour.surf,
        b.textures.vane.map, b.textures.vane.normal, b.textures.vane.surf,
        b.textures.brushed.map, b.textures.brushed.normal, b.textures.brushed.surf, b.textures.engrave,
    ];

    const geoA = a.geometries.length, matA = a.materials.length;
    a.dispose();
    a.dispose();   // idempotent
    assert.equal(log.geometries, geoA);
    assert.equal(log.materials, matA);
    assert.ok(a.geometries.every((g) => g.disposed) && a.materials.every((m) => m.disposed && m.envMap === null));
    assert.ok(all.every((t) => !t.disposed), 'textures survive while another bird holds them');
    assert.equal(log.targets, 0, 'so does the probe');
    assert.equal(a.group.parent, null, 'removed from the scene');

    b.dispose();
    assert.ok(all.every((t) => t.disposed), 'the last bird out disposes every texture');
    assert.equal(log.textures, all.length + 1);
    assert.equal(log.targets, 1, 'and the probe');
    assert.equal(featherTextureRefs(THREE), 0);
    assert.equal(birdEnvironmentRefs(renderer), 0);
    assert.equal(scene.children.length, 0);
});

test('a disposed bird cannot take a probe, and dispose() clears its render callbacks', () => {
    const { THREE, log } = makeStub();
    const renderer = { id: 'r-late' };
    const early = createRealisticBird(THREE, { species: 'crow', quality: 'high' });
    early.dispose();
    assert.equal(early.attachToScene(new THREE.Group(), renderer), false, 'attach after dispose is refused');
    assert.equal(birdEnvironmentRefs(renderer), 0, 'and takes no reference');
    assert.equal(log.pmrem, 0, 'nothing baked for it');

    const bird = createRealisticBird(THREE, { species: 'clockwork-owl', quality: 'mid' });
    assert.equal(bird.attachToScene(new THREE.Group(), renderer), true);
    const meshes = allMeshes(bird);
    assert.ok(meshes.every((m) => typeof m.onBeforeRender === 'function' && m.onBeforeRender.name === 'orientEnv'));
    bird.dispose();
    assert.ok(meshes.every((m) => m.onBeforeRender.name !== 'orientEnv'), 'no probe callback outlives the bird');
    assert.equal(birdEnvironmentRefs(renderer), 0);
    assert.equal(featherTextureRefs(THREE), 0);
});

test('low has no probe: attachToScene declines and binds nothing', () => {
    const { THREE, log } = makeStub();
    const bird = createRealisticBird(THREE, { species: 'crow', quality: 'low' });
    assert.equal(bird.attachToScene(new THREE.Group(), { id: 'r' }), false);
    assert.equal(log.pmrem, 0);
    for (const m of bird.materials) assert.ok(m.isMeshPhongMaterial && !m.envMap);
    bird.dispose();
});

// ---------------------------------------------------------------------------
// materials per tier
// ---------------------------------------------------------------------------

test('high is physical (film, sheen, clearcoat), mid standard, low Phong', () => {
    const { THREE } = makeStub();
    const crow = createRealisticBird(THREE, { species: 'crow', quality: 'high' });
    const [contour, tail] = crow.materials;
    assert.ok(contour.isMeshPhysicalMaterial && contour.sheen > 0 && contour.clearcoat > 0);
    assert.equal(contour.iridescence, 1);
    assert.equal(contour.iridescenceIOR, CROW_FILM.ior);
    assert.equal(contour.iridescenceThicknessRange[1], CROW_FILM.thickness, 'three uses the range max without a thickness map');
    assert.equal(contour.ior, 1.56, 'keratin');
    assert.ok(tail.normalMap && tail.roughnessMap && tail.map, 'procedural vane detail');
    crow.dispose();

    const owl = createRealisticBird(THREE, { species: 'clockwork-owl', quality: 'high', variant: 'alt' });
    assert.equal(owl.materials[0].iridescenceIOR, OWL_ALT_FILM.ior, 'blued steel is a film');
    assert.equal(owl.materials[0].map.channel, 1, 'the engraving rides uv1');
    owl.dispose();
    const plain = createRealisticBird(THREE, { species: 'clockwork-owl', quality: 'high' });
    assert.ok(!plain.materials[0].iridescence, 'brass carries no film');
    plain.dispose();

    const mid = createRealisticBird(THREE, { species: 'crow', quality: 'mid' });
    assert.ok(mid.materials.every((m) => m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial));
    assert.ok(mid.materials[0].userData.realistic.uniforms.uFilmMid, 'mid carries the faux-film ramp');
    mid.dispose();
});

test('one program per tier and kind across the whole field', () => {
    const { THREE } = makeStub();
    const keys = new Set();
    const birds = [];
    for (let i = 0; i < 3; i++) birds.push(createRealisticBird(THREE, { species: 'crow', quality: 'high' }));
    for (const b of birds) for (const m of b.materials) keys.add(m.customProgramCacheKey());
    assert.equal(keys.size, 2, 'contour + vane: ' + [...keys].join(', '));
    for (const b of birds) b.dispose();
});

test('the shader patch lands on every anchor, per family', () => {
    const vert = '#include <beginnormal_vertex>\n#include <begin_vertex>\n';
    const inc = (list) => list.map((c) => '#include <' + c + '>').join('\n');
    const frag = inc(['color_fragment', 'normal_fragment_begin', 'metalnessmap_fragment', 'roughnessmap_fragment',
        'lights_physical_fragment', 'lights_fragment_maps', 'opaque_fragment']);
    const phongFrag = inc(['color_fragment', 'specularmap_fragment', 'normal_fragment_begin', 'emissivemap_fragment',
        'lights_phong_fragment', 'lights_fragment_maps', 'opaque_fragment']);
    const pbr = patchRealShader({ vertexShader: vert, fragmentShader: frag },
        { mech: true, fauxFilm: true, filmUp: true, family: 'standard' });
    assert.match(pbr.vertexShader, /^#define REAL_MECH/);
    assert.match(pbr.vertexShader, /realDeform\( realP, objectNormal \)/);
    assert.match(pbr.vertexShader, /realDeform\( transformed, realN \)/);
    assert.match(pbr.fragmentShader, /metalnessFactor = vSurf\.x;/);
    assert.match(pbr.fragmentShader, /roughnessFactor \*= vSurf\.y;/);
    assert.match(pbr.fragmentShader, /material\.iridescence \*= vSurf\.z \* realUp;/);
    assert.match(pbr.fragmentShader, /iblIrradiance = iblIrradiance \* uPlumEnvDiffuse \+ irradiance \* uPlumHemi;/);
    assert.match(pbr.fragmentShader, /#define REAL_FAUX_FILM/);
    assert.match(pbr.fragmentShader, /uBlink \* vMask/);
    assert.ok(pbr.fragmentShader.indexOf('realRimF') < pbr.fragmentShader.indexOf('#include <opaque_fragment>'));
    // The crow's film is gated to upward-facing surfaces (faceDirection comes
    // from normal_fragment_begin, which precedes lights_physical_fragment).
    assert.match(pbr.fragmentShader, /#define REAL_FILM_UP/);
    assert.match(pbr.fragmentShader, /material\.iridescence \*= vSurf\.z \* realUp;/);
    assert.match(pbr.fragmentShader, /fT, vSurf\.z \* realUp/, 'mid faux film is gated the same way');
    assert.match(pbr.vertexShader, /vUpN = normalize\( objectNormal \)\.y;/);
    const phong = patchRealShader({ vertexShader: vert, fragmentShader: phongFrag }, { mech: false, fauxFilm: false, family: 'phong' });
    assert.doesNotMatch(phong.vertexShader, /#define REAL_MECH/);
    assert.match(phong.fragmentShader, /specularStrength \*=/);
    assert.doesNotMatch(phong.fragmentShader, /metalnessFactor = vSurf/, 'phong has no metalness');
    // Low's lobe is per surface, not one bird-wide setting.
    assert.match(phong.fragmentShader, /material\.specularShininess = clamp\( 100\.0 - 160\.0 \* \( vSurf\.y - 0\.06 \), 20\.0, 100\.0 \);/);
    assert.match(phong.fragmentShader, /material\.specularColor = mix\( material\.specularColor, diffuseColor\.rgb, vSurf\.x/);
    assert.match(phong.fragmentShader, /totalEmissiveRadiance \+= diffuseColor\.rgb \* 0\.16 \* vSurf\.x;/);
    assert.ok(phong.fragmentShader.indexOf('specularShininess = clamp') > phong.fragmentShader.indexOf('#include <lights_phong_fragment>'));
});

// ---------------------------------------------------------------------------
// shade lighting: the cyan ambient on dielectrics (Tock's teal disc)
// ---------------------------------------------------------------------------

/**
 * CPU model of a dielectric facing away from the sun, as the patched shader
 * lights it under createLightRig: AmbientLight PALETTE.skyMid x 0.55 is the
 * only diffuse (three: albedo x irradiance / PI), its hue pulled toward
 * SHADE_WARM by `neutral`; the composited colour (no sun, so no specular
 * here) is then floored at `floor` x albedo, as the shader's final
 * max( outgoingLight, albedo x floor ). Returns linear.
 */
function shadeModel(albedoHex, shade, metal = 0) {
    const albedo = hexToLinear(albedoHex);
    const amb = hexToLinear(PALETTE.skyMid).map((c) => c * 0.55);
    const y = 0.2126 * amb[0] + 0.7152 * amb[1] + 0.0722 * amb[2];
    const k = dielectricWeight(metal) * shade.neutral;
    const irr = amb.map((c, i) => c + (y * SHADE_WARM[i] - c) * k);
    const fl = dielectricWeight(metal) * shade.floor;
    return albedo.map((a, i) => Math.max(a * irr[i] / Math.PI, a * fl));
}
const toSrgb8 = (lin) => lin.map((c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('every family carries the shade neutralisation and floor', () => {
    const vert = '#include <beginnormal_vertex>\n#include <begin_vertex>\n';
    const inc = (list) => list.map((c) => '#include <' + c + '>').join('\n');
    const pbr = inc(['color_fragment', 'normal_fragment_begin', 'metalnessmap_fragment', 'roughnessmap_fragment',
        'lights_physical_fragment', 'lights_fragment_maps', 'opaque_fragment']);
    const phong = inc(['color_fragment', 'specularmap_fragment', 'normal_fragment_begin', 'emissivemap_fragment',
        'lights_phong_fragment', 'lights_fragment_maps', 'opaque_fragment']);
    const neutral = /irradiance = mix\( irradiance, dot\( irradiance, vec3\( 0\.2126, 0\.7152, 0\.0722 \) \) \* realWarm, realNeutral \);/;
    // high (physical) and mid (standard) share the 'standard' family; low is phong.
    for (const [family, frag] of [['standard', pbr], ['phong', phong]]) {
        const s = patchRealShader({ vertexShader: vert, fragmentShader: frag }, { mech: false, fauxFilm: false, family }).fragmentShader;
        assert.match(s, /uniform float uShadeNeutral;/, family);
        assert.match(s, /clamp\( 1\.0 - 5\.0 \* vSurf\.x, 0\.0, 1\.0 \) \* uShadeNeutral/, family + ': dielectric only');
        assert.match(s, neutral, family);
        // The neutralisation lands after lights_fragment_maps (where the
        // ambient sits in `irradiance`), before PBR routes it to the IBL slot.
        assert.ok(s.search(neutral) > s.indexOf('#include <lights_fragment_maps>'), family);
        if (family === 'standard') assert.ok(s.search(neutral) < s.indexOf('iblIrradiance = iblIrradiance'), family);
        // A final linear-light floor on the composited colour, before the rim.
        const floor = /outgoingLight = max\( outgoingLight, diffuseColor\.rgb \* realFloorW \);/;
        assert.match(s, floor, family + ': the floor');
        assert.doesNotMatch(s, /realLit/, family + ': no raw-diffuse measure');
        assert.match(s, /\( 1\.0 - uBlink \* vMask \) \* uShadeFloor/, family + ': on the eye glass too, lifted by a blink');
        assert.ok(s.search(floor) < s.indexOf('outgoingLight += uRimColor'), family + ': floor before rim');
        assert.ok(s.indexOf('realFloorW') < s.indexOf('#include <opaque_fragment>'), family);
        // The eye glass's probe reflection: desaturated and dimmed on high/mid,
        // per bird (uShadeNeutral), dielectric under the eye mask only.
        const glass = /radiance = mix\( radiance, vec3\( dot\( radiance, vec3\( 0\.2126, 0\.7152, 0\.0722 \) \) \), realGlass \) \* realGlassDim;/;
        if (family === 'standard') {
            assert.match(s, /float realGlass = clamp\( 1\.0 - 5\.0 \* vSurf\.x, 0\.0, 1\.0 \) \* vMask \* uShadeNeutral;/);
            assert.match(s, glass);
            assert.ok(s.includes('float realGlassDim = 1.0 - ' + SHADE_GLASS_DIM.toFixed(4) + ' * realGlass;'));
            assert.match(s, /clearcoatRadiance = mix\( clearcoatRadiance, vec3\( dot\( clearcoatRadiance,/, 'clearcoat too');
            // After the probe is sampled (lights_fragment_maps), before it is used.
            assert.ok(s.search(glass) > s.indexOf('#include <lights_fragment_maps>'));
            assert.ok(s.search(glass) < s.indexOf('#include <opaque_fragment>'));
        } else {
            assert.doesNotMatch(s, /realGlass/, 'low has no probe to tint');
        }
    }
    // SHADE_WARM is a warm neutral at unit luminance (the pull keeps brightness).
    assert.ok(Math.abs(lum(SHADE_WARM) - 1) < 1e-9);
    assert.ok(SHADE_WARM[0] > SHADE_WARM[1] && SHADE_WARM[1] > SHADE_WARM[2]);
});

test('Tock\'s cream disc reads ivory in the sun\'s shadow, the crow stays black', () => {
    const owl = SHADE['clockwork-owl'];
    const before = shadeModel(PALETTE.realOwlDisc, { neutral: 0, floor: 0 });
    assert.ok(before[1] > before[0], 'regression guard: unpatched, the disc models teal (G > R)');

    const disc = shadeModel(PALETTE.realOwlDisc, owl);
    const s = toSrgb8(disc);
    assert.ok(s[0] >= s[1] && s[1] > s[2], 'R >= G > B: ' + s);
    assert.ok(s[0] >= 200 && s[0] <= 235 && s[1] >= 190 && s[1] <= 220 && s[2] >= 160 && s[2] <= 195, 'cream band: ' + s);
    const h = hueDegrees(disc);
    assert.ok(h >= 30 && h <= 55, 'warm cream hue, not cyan: ' + h);
    // Neutralisation alone (no floor) already turns the hue warm.
    const neutralOnly = shadeModel(PALETTE.realOwlDisc, { neutral: owl.neutral, floor: 0 });
    assert.ok(neutralOnly[0] >= neutralOnly[1] && neutralOnly[1] > neutralOnly[2], 'neutralised: ' + neutralOnly);

    // Metal (brass, the alt's gunmetal disc) is untouched by both terms.
    for (const hex of [PALETTE.realBrass, PALETTE.realGunmetal]) {
        assert.deepEqual(shadeModel(hex, owl, 1), shadeModel(hex, { neutral: 0, floor: 0 }, 1));
    }

    // The crow: unchanged by design, and the neutralisation would not lift
    // it even if applied (it keeps the ambient's luminance).
    assert.deepEqual(SHADE.crow, { neutral: 0, floor: 0 });
    for (const hex of [PALETTE.realCrowBlack, PALETTE.realHoodedGrey]) {
        const base = shadeModel(hex, SHADE.crow);
        const pulled = shadeModel(hex, { neutral: owl.neutral, floor: 0 });
        assert.ok(Math.abs(lum(pulled) - lum(base)) / lum(base) < 0.15, 'luminance kept: ' + hex.toString(16));
    }
    assert.ok(lum(shadeModel(PALETTE.realCrowBlack, SHADE.crow)) < 0.004, 'crow shade stays near-black');
});

/**
 * CPU model of the eye glass (dielectric, eye mask, no blink) facing away
 * from the sun: shadeModel's diffuse plus, on high/mid (`probe`), the sky
 * probe's mirror reflection — taken as PALETTE.skyMid x 0.08 linear, a
 * harsher cyan than the operator's measured unpatched high iris — which
 * SHADE_GLASS (`glass`) desaturates by `neutral` and dims by
 * SHADE_GLASS_DIM x neutral; the sum is then floored. Returns linear.
 */
function glassModel(albedoHex, shade, probe, glass = true) {
    const albedo = hexToLinear(albedoHex);
    const amb = hexToLinear(PALETTE.skyMid).map((c) => c * 0.55);
    const y = lum(amb);
    const irr = amb.map((c, i) => c + (y * SHADE_WARM[i] - c) * shade.neutral);
    const sky = probe ? hexToLinear(PALETTE.skyMid).map((c) => c * 0.08) : [0, 0, 0];
    const g = glass ? shade.neutral : 0;
    const ry = lum(sky);
    const refl = sky.map((c) => (c + (ry - c) * g) * (1 - SHADE_GLASS_DIM * g));
    return albedo.map((a, i) => Math.max(a * irr[i] / Math.PI + refl[i], a * shade.floor));
}

test('Tock\'s iris reads saturated amber on every tier, the pupil stays black, the crow is unchanged', () => {
    const owl = SHADE['clockwork-owl'];
    // The iris (and pupil) qualify for the shade terms on every tier: enamel
    // (dielectric) under the eye mask; the only other masked parts, the
    // aperture blades, are metal and so untouched.
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const iris = hexToLinear(PALETTE.realEnamel), pupil = hexToLinear(PALETTE.realEnamelPupil);
    for (const quality of TIERS) {
        const head = buildOwl({ quality }).meshes.find((m) => m.role === 'head').data;
        let irisVerts = 0;
        for (let v = 0; v < head.vertexCount; v++) {
            const c = [head.arrays.color[v * 3], head.arrays.color[v * 3 + 1], head.arrays.color[v * 3 + 2]];
            const metal = head.arrays.aSurf[v * 4], mask = head.arrays.aMask[v];
            const isIris = near(c[0], iris[0]) && near(c[1], iris[1]) && near(c[2], iris[2]);
            if (isIris) {
                irisVerts++;
                assert.equal(mask, 1, quality + ': the iris is the eye glass');
                // The shader's weights: SHADE_FLOOR (no blink) and SHADE_GLASS.
                assert.ok(dielectricWeight(metal) * owl.floor > 0.5, quality + ': iris floored');
                assert.ok(dielectricWeight(metal) * mask * owl.neutral > 0.5, quality + ': iris reflection tinted');
            }
            if (mask > 0 && !isIris) {
                const isPupil = near(c[0], pupil[0]) && near(c[1], pupil[1]) && near(c[2], pupil[2]);
                assert.ok(isPupil || dielectricWeight(metal) === 0, quality + ': masked and dielectric is only the enamel');
            }
        }
        assert.ok(irisVerts > 0, quality + ' amber iris present');
    }

    const inBand = (s) => s[0] >= 170 && s[0] <= 225 && s[1] >= 100 && s[1] <= 150 && s[2] >= 15 && s[2] <= 60
        && s[0] > s[1] && s[1] > s[2] && (s[0] - s[2]) / s[0] > 0.7;
    // Regression guard: unpatched, the iris models dark and cyan-grey on high/mid.
    const before = toSrgb8(glassModel(PALETTE.realEnamel, { neutral: 0, floor: 0 }, true));
    assert.ok(before[0] < 100 && !inBand(before), 'unpatched: ' + before);
    // high/mid (probe) and low (no probe) all land in the amber band.
    for (const probe of [true, false]) {
        const s = toSrgb8(glassModel(PALETTE.realEnamel, owl, probe));
        assert.ok(inBand(s), (probe ? 'high/mid' : 'low') + ' amber iris: ' + s);
    }
    // The floor alone is not enough on high/mid: the untinted sky reflection
    // lifts blue past the band (greys the amber); SHADE_GLASS is what holds it.
    const floorOnly = toSrgb8(glassModel(PALETTE.realEnamel, owl, true, false));
    assert.ok(floorOnly[2] > 60, 'without SHADE_GLASS: ' + floorOnly);
    // The pupil stays black (its floor is ~0.8 x near-black).
    for (const probe of [true, false]) {
        assert.ok(Math.max(...toSrgb8(glassModel(PALETTE.realEnamelPupil, owl, probe))) < 60, 'pupil stays dark');
    }

    // The crow: uniforms 0, so every term is the identity.
    assert.deepEqual(SHADE.crow, { neutral: 0, floor: 0 });
    for (const probe of [true, false]) {
        assert.deepEqual(glassModel(PALETTE.realCrowBlack, SHADE.crow, probe),
            glassModel(PALETTE.realCrowBlack, { neutral: 0, floor: 0 }, probe, false));
    }
});

test('a missing or repeated anchor leaves the shader untouched (never half-patched)', () => {
    const vert = '#include <beginnormal_vertex>\n#include <begin_vertex>\n';
    const frag = ['color_fragment', 'normal_fragment_begin', 'metalnessmap_fragment', 'roughnessmap_fragment',
        'lights_physical_fragment', 'opaque_fragment'].map((c) => '#include <' + c + '>').join('\n');   // no lights_fragment_maps
    const warn = console.warn;
    let warnings = 0;
    console.warn = () => { warnings++; };
    try {
        const s = patchRealShader({ vertexShader: vert, fragmentShader: frag }, { mech: false, fauxFilm: false, family: 'standard' });
        assert.equal(s.vertexShader, vert, 'vertex untouched');
        assert.equal(s.fragmentShader, frag, 'fragment untouched');
        const twice = vert + '#include <begin_vertex>\n';
        const full = frag + '\n#include <lights_fragment_maps>';
        const t = patchRealShader({ vertexShader: twice, fragmentShader: full }, { mech: false, fauxFilm: false, family: 'standard' });
        assert.equal(t.vertexShader, twice, 'an ambiguous (repeated) anchor is refused too');
    } finally {
        console.warn = warn;
    }
    assert.ok(warnings <= 1, 'warned at most once');
});

// ---------------------------------------------------------------------------
// the films
// ---------------------------------------------------------------------------

test('the crow film is a restrained blue -> violet gloss, never teal-green', () => {
    const hue = (c) => hueDegrees(thinFilmReflectance(c, CROW_FILM.ior, CROW_FILM.thickness, CROW_FILM.baseF0));
    assert.deepEqual(FILM_RAMP_COS, [1.0, 0.55, 0.15]);
    const face = hue(1.0), mid = hue(0.55), graze = hue(0.15);
    assert.ok(face > 185 && face < 235, 'face-on blue ' + face);
    assert.ok(mid > 245 && mid < 290, 'chase-angle blue-violet ' + mid);
    assert.ok(graze > 285 && graze < 330, 'grazing violet-purple ' + graze);
    for (const h of [face, mid, graze]) assert.ok(!(h > 90 && h < 180), 'no green/teal anywhere: ' + h);
    assert.ok(CROW_FILM.thickness >= 250 && CROW_FILM.thickness <= 300, 'in the 250-300 nm sweep');
    assert.equal(CROW_FILM.range[1], CROW_FILM.thickness);

    // RESTRAINED: the per-vertex film weights are small, largest on the
    // dorsal flight feathers and absent from the belly.
    for (const quality of TIERS) {
        const spec = buildCrow({ quality });
        let max = 0;
        for (const m of spec.meshes) {
            const s = m.data.arrays.aSurf;
            for (let i = 2; i < s.length; i += 4) max = Math.max(max, s[i]);
        }
        assert.ok(max > 0.08 && max <= 0.20, quality + ' film weight max ' + max);
        const body = spec.meshes.find((m) => m.role === 'body').data;
        const P = body.arrays.position, S = body.arrays.aSurf;
        for (let v = 0; v < body.vertexCount; v++) {
            if (P[v * 3 + 1] < -0.06 && P[v * 3 + 2] > -0.3 && P[v * 3 + 2] < 0.2) {
                assert.ok(S[v * 4 + 2] <= 0.02, 'belly film ' + S[v * 4 + 2]);
            }
        }
    }
});

test('the crow is near-black: albedo ~0.02-0.04 linear, keratin roughness, dark sheen', () => {
    const lum = (hex) => { const c = hexToLinear(hex); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    for (const k of ['realCrowBlack', 'realCrowFlight']) {
        const y = lum(PALETTE[k]);
        // The contour/vane albedo maps sit ~0.8-0.95, so the rendered albedo
        // stays inside 0.02-0.04.
        assert.ok(y > 0.022 && y < 0.04, k + ' linear luminance ' + y.toFixed(4));
        const c = hexToLinear(PALETTE[k]);
        assert.ok(c[2] >= c[1] && c[1] >= c[0], k + ' leans blue, not green');
    }
    assert.ok(lum(PALETTE.realCrowSheen) < 0.015, 'sheen near-black');
    const { THREE } = makeStub();
    const bird = createRealisticBird(THREE, { species: 'crow', quality: 'high' });
    for (const m of bird.materials) {
        assert.ok(m.envMapIntensity >= 0.35 && m.envMapIntensity <= 0.5, 'crow env intensity ' + m.envMapIntensity);
        assert.ok(m.sheen <= 0.3, 'sheen strength ' + m.sheen);
        assert.match(m.customProgramCacheKey(), /u$/, 'film gated to upper surfaces');
    }
    bird.dispose();
    for (const quality of TIERS) {
        const spec = buildCrow({ quality });
        for (const m of spec.meshes) {
            const s = m.data.arrays.aSurf, c = m.data.arrays.color;
            for (let v = 0; v < m.data.vertexCount; v++) {
                const feather = s[v * 4 + 3] === 0 && 0.2126 * c[v * 3] + 0.7152 * c[v * 3 + 1] + 0.0722 * c[v * 3 + 2] < 0.05;
                if (feather) assert.ok(s[v * 4 + 1] >= 0.35 && s[v * 4 + 1] <= 0.5, 'keratin roughness ' + s[v * 4 + 1]);
            }
        }
    }
});

test('blued steel stays blue at every angle', () => {
    for (const c of FILM_RAMP_COS) {
        const h = hueDegrees(thinFilmReflectance(c, OWL_ALT_FILM.ior, OWL_ALT_FILM.thickness, OWL_ALT_FILM.baseF0));
        assert.ok(h > 200 && h < 240, 'blue at cos ' + c + ': ' + h);
    }
});

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------

test('procedural textures: sizes, determinism, and the right structure', () => {
    const c = contourTileData(...TEXTURE_SIZES.contour);
    assert.equal(c.albedo.length, TEXTURE_SIZES.contour[0] * TEXTURE_SIZES.contour[1] * 4);
    assert.deepEqual(contourTileData(...TEXTURE_SIZES.contour).normal, c.normal, 'seeded: same every load');
    // The contour sheet tiles: the wrap seam is no rougher than the interior.
    const [w, h] = TEXTURE_SIZES.contour;
    let seam = 0, inner = 0;
    for (let y = 0; y < h; y++) {
        seam += Math.abs(c.albedo[(y * w) * 4] - c.albedo[(y * w + w - 1) * 4]);
        inner += Math.abs(c.albedo[(y * w + 60) * 4] - c.albedo[(y * w + 61) * 4]);
    }
    assert.ok(seam <= inner * 2.5 + h, 'contour seam ' + seam + ' vs interior ' + inner);

    // The vane's barbs chevron across the shaft: the normal's u-slope mirrors.
    const v = vaneTileData(...TEXTURE_SIZES.vane);
    const [vw, vh] = TEXTURE_SIZES.vane;
    let corr = 0, norm = 0;
    for (let y = 8; y < vh - 8; y++) {
        for (let x = 8; x < vw / 2 - 8; x++) {
            const a = v.normal[(y * vw + x) * 4] - 127.5;
            const b = v.normal[(y * vw + (vw - 1 - x)) * 4] - 127.5;
            corr += a * b; norm += a * a;
        }
    }
    assert.ok(corr < -0.5 * norm, 'mirrored barb slopes (corr ' + (corr / norm).toFixed(2) + ')');

    const b = brushedTileData(...TEXTURE_SIZES.brushed);
    assert.equal(b.surf[1] > 0, true, 'roughness lives in G');
    const e = engraveAtlasData(...TEXTURE_SIZES.engrave);
    const [ew, eh] = TEXTURE_SIZES.engrave;
    for (let y = Math.ceil(ENGRAVE_BLANK_V * eh); y < eh; y++) {
        for (let x = 0; x < ew; x++) assert.equal(e.albedo[(y * ew + x) * 4], 255, 'blank band is blank');
    }
    let dark = 0;
    for (let i = 0; i < e.albedo.length; i += 4) if (e.albedo[i] < 200) dark++;
    assert.ok(dark > ew * eh * 0.05, 'the plates are actually engraved');
});

// ---------------------------------------------------------------------------
// the sky probe
// ---------------------------------------------------------------------------

test('the probe: Gauntlet sky above, the planet below, zenith turned to radial up', () => {
    const data = equirectSkyData({ top: PALETTE.skyZenith, mid: PALETTE.skyMid, horizon: PALETTE.skyHorizon, bottom: PALETTE.realGround }, 8, 16);
    assert.ok(rowUpComponent(0, 16) < -0.9 && rowUpComponent(15, 16) > 0.9, 'row 0 is the nadir');
    const top = data.slice((15 * 8) * 4, (15 * 8) * 4 + 3), bottom = data.slice(0, 3);
    assert.ok(top[2] > top[0], 'the zenith is blue');
    assert.ok(bottom[1] > bottom[2], 'below is the green planet');
    const out = { x: 0, y: 0 };
    for (const up of [[0, 1, 0], [1, 0, 0], [0, 0, -1], [0.6, -0.48, 0.64]]) {
        envRotationFor(up[0], up[1], up[2], out);
        // R_X(x) R_Y(y) up == +Y
        const cy = Math.cos(out.y), sy = Math.sin(out.y), cx = Math.cos(out.x), sx = Math.sin(out.x);
        const x1 = cy * up[0] + sy * up[2], y1 = up[1], z1 = -sy * up[0] + cy * up[2];
        const y2 = cx * y1 - sx * z1;
        assert.ok(Math.abs(y2 - 1) < 1e-9 && Math.abs(x1) < 1e-9, 'maps ' + up + ' onto +Y');
    }
});

test('brass reflecting the probe reads as brass, not verdigris', () => {
    // The raw dome would make it teal/olive (see PROBE_SKY_LIFT); the lifted
    // probe must keep every sky sample the owl's back sees warm.
    const brass = hexToLinear(PALETTE.realBrass);
    const sky = birdSkyColors();
    for (const h of [0.2, 0.5, 0.8, 1.0]) {
        const r = skyRadianceAt(h, sky).map((v, i) => v * brass[i]);
        const hue = hueDegrees(r);
        assert.ok(hue > 15 && hue < 62, 'brass under the sky at up ' + h + ': hue ' + hue.toFixed(0));
    }
    const raw = skyRadianceAt(1, { top: PALETTE.skyZenith, mid: PALETTE.skyMid, horizon: PALETTE.skyHorizon, bottom: PALETTE.realGround })
        .map((v, i) => v * brass[i]);
    assert.ok(hueDegrees(raw) > 120, 'and the raw dome really would have turned it teal');
});

test('each realistic mesh turns its probe to its own radial up before it draws', () => {
    const { THREE } = makeStub();
    const bird = createRealisticBird(THREE, { species: 'clockwork-owl', quality: 'high' });
    bird.attachToScene(new THREE.Group(), { id: 'probe-turn' });
    const mesh = bird.parts.bodyMesh;
    assert.equal(typeof mesh.onBeforeRender, 'function');
    mesh.matrixWorld.elements[12] = 0; mesh.matrixWorld.elements[13] = 0; mesh.matrixWorld.elements[14] = 110;
    mesh.onBeforeRender();
    const r = mesh.material.envMapRotation;
    const out = { x: 0, y: 0 };
    envRotationFor(0, 0, 1, out);
    assert.ok(Math.abs(r.x + out.x) < 1e-12 && Math.abs(r.y + out.y) < 1e-12, 'written negated, as three expects');
    bird.dispose();
});

// ---------------------------------------------------------------------------
// variants and the rival wiring
// ---------------------------------------------------------------------------

test('the clash variant: explicit flag, or the rival\'s alt colour', () => {
    assert.equal(resolveVariant('crow', {}), 'normal');
    assert.equal(resolveVariant('crow', { altTint: true }), 'alt');
    assert.equal(resolveVariant('crow', { bodyColor: PALETTE.birdRival4Alt }), 'alt');
    assert.equal(resolveVariant('crow', { bodyColor: PALETTE.birdRival4 }), 'normal');
    assert.equal(resolveVariant('clockwork-owl', { bodyColor: PALETTE.birdRival5Alt }), 'alt');
    assert.equal(resolveVariant('clockwork-owl', { variant: 'normal', altTint: true }), 'normal', 'explicit wins');
});

test('rivals: the trio stay cel birbs; a crow/owl rival clashing with the player is told so', () => {
    class V3 extends Vector3 {
        get isVector3() { return true; }
        subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
        lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
    }
    class Group { constructor() { this.name = ''; this.position = new V3(); this.quaternion = new Quaternion(); this.children = []; } add(o) { this.children.push(o); } }
    class Color {
        setHex(h) { this.r = (h >> 16 & 255) / 255; this.g = (h >> 8 & 255) / 255; this.b = (h & 255) / 255; return this; }
        lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
        getHex() { return (Math.round(this.r * 255) << 16) | (Math.round(this.g * 255) << 8) | Math.round(this.b * 255); }
        constructor(h = 0) { this.setHex(h); }
    }
    const TAU = Math.PI * 2;
    const at = (t, out) => { const a = TAU * t, x = Math.cos(a), z = Math.sin(a); return out.set(x, 0, z).multiplyScalar(floorRadius(x, 0, z) + AI_CONFIG.floorClear); };
    const p = new V3(), q = new V3();
    const course = {
        length: TAU * 100, gateCount: 0, sampleAt: at,
        tangentAt(t, out) { at(t + 1e-4, p); at(t - 1e-4, q); return out.subVectors(p, q).normalize(); },
        nearestT(x, y, z) { const t = Math.atan2(z, x) / TAU; return t - Math.floor(t); },
    };
    const calls = [];
    const spy = (THREE, opts) => {
        calls.push(opts);
        const node = () => ({ position: new V3(), rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1, set() {} } });
        const uniforms = new Proxy({}, { get: (u, k) => (u[k] ??= { value: 0 }) });
        return { group: new Group(), parts: { body: node(), head: node(), leftWing: node(), rightWing: node() }, uniforms, dispose() {}, attachToScene() { return true; } };
    };
    const STUB = { Vector3: V3, Quaternion, Matrix4, Group, Color };
    for (const playerSpecies of [null, 'crow', 'clockwork-owl']) {
        calls.length = 0;
        const ai = createAIRacers(STUB, { course, createBirdFn: spy, playerSpecies });
        const by = (s) => calls.filter((c) => c.species === s);
        assert.equal(by('birb').length, 3, 'the trio');
        for (const c of by('birb')) assert.equal(c.altTint, false);
        assert.equal(by('crow')[0].altTint, playerSpecies === 'crow');
        assert.equal(by('clockwork-owl')[0].altTint, playerSpecies === 'clockwork-owl');
        assert.equal(ai.attachToScene({}, {}), 5, 'attachToScene reaches every bird that has the hook');
    }
});

// ---------------------------------------------------------------------------
// zero allocation in the new per-frame paths (source inspection)
// ---------------------------------------------------------------------------

const ALLOC = [/\bnew\s/, /=>/, /\[\s*\]/, /\{\s*\}/, /\.(map|filter|slice|concat|forEach)\(/];
function assertNoAlloc(name, src) {
    for (const re of ALLOC) assert.ok(!re.test(src), name + ' must not match ' + re);
}
function fnBody(src, header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, header + ' exists');
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced ' + header);
}

test('no allocation in any new per-frame path', () => {
    const bird = readFileSync(new URL('../gauntlet/src/bird/realistic/realistic-bird.js', import.meta.url), 'utf8');
    assertNoAlloc('orientEnv', fnBody(bird, 'function orientEnv('));
    // The mech uniforms are getters: reading one is a property read.
    assertNoAlloc('uGearAngle getter', fnBody(bird, 'uGearAngle: { get value()'));
    assertNoAlloc('uKeyAngle getter', fnBody(bird, 'uKeyAngle: { get value()'));
    assertNoAlloc('envRotationFor', envRotationFor.toString());
    const anim = readFileSync(new URL('../gauntlet/src/bird/bird-anim.js', import.meta.url), 'utf8');
    // The whole animator update (it now also writes the splay).
    assertNoAlloc('bird-anim update', fnBody(anim, 'function update(dt, state)'));
    assertNoAlloc('bird-anim applyWing', fnBody(anim, 'function applyWing('));
    // And it runs: thousands of frames on both realistic species, no throw.
    const { THREE } = makeStub();
    for (const species of SPECIES) {
        const b = createRealisticBird(THREE, { species, quality: 'high' });
        b.attachToScene(new THREE.Group(), { id: 'alloc-' + species });
        const a = createBirdAnimator(THREE, b);
        const s = animState({ turn: 0.4, boosting: true });
        for (let i = 0; i < 2000; i++) {
            s.turn = Math.sin(i * 0.01);
            a.update(1 / 60, s);
            for (const m of allMeshes(b)) m.onBeforeRender();
        }
        b.dispose();
    }
});
