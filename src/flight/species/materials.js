// PORTED from Birb Gauntlet (gauntlet/src/bird/realistic/materials.js) for the root
// game's bird picker. Gauntlet stays airtight: this is a copy, not an import.
// Root-game adaptations are marked "ROOT:".
/**
 * realistic/materials.js — the realistic birds' materials, per quality tier.
 *
 *   high  MeshPhysicalMaterial: keratin (IOR 1.56) or metal, the thin film
 *         (`iridescence`), SHEEN on the feathers, CLEARCOAT on eyes, bill and
 *         lacquered brass, the procedural detail maps, and the bird-only sky
 *         probe (environment.js).
 *   mid   MeshStandardMaterial with the same maps and probe. No film in the
 *         standard model, so a three-stop view-angle tint of the real film
 *         (film.js `filmRamp`) is mixed into the specular colour instead.
 *   low   MeshPhongMaterial: vertex colour times the baked albedo detail, a
 *         PER-SURFACE specular lobe (shininess from aSurf's roughness; metal
 *         takes its own colour as specular and a small self-coloured fill in
 *         place of the probe), no normal map, no probe.
 *
 * One program per (tier, kind) for the whole field: every material injects
 * byte-identical source and says so in `customProgramCacheKey`; the per-bird
 * state is only in uniforms.
 *
 * What the injected shader does, all from per-vertex attributes so a whole
 * bird part is ONE draw call:
 *
 *   VERTEX (realDeform, run once for the normal and once for the position):
 *     - aAxis/aGear: rigid spins — every gear by uGearAngle * its ratio about
 *       its own axis, the wind-up key by uKeyAngle about its shaft.
 *     - aDef.y: a primary's splay about its own root (uSplay, the downstroke).
 *     - the tail fan/rudder/pitch: bird-model.js's tailDeform, verbatim maths.
 *     - the wing: the HAND (aDef.x = 1) rotates about the wrist by 3/4 of
 *       uCurl, then the arm bends about the shoulder by the last 1/4, rigid
 *       past the wrist; uSweep trails the tip. Same uniforms, same meaning as
 *       the toon wing's curl/sweep, so the animator does not care which bird
 *       it drives — but now the bend is a JOINT.
 *   FRAGMENT:
 *     - aSurf -> metalnessFactor, roughnessFactor (times the detail map), the
 *       film weight, the clearcoat weight; sheen only on rough dielectric
 *       (feathers, not bill or eye).
 *     - The blink: the eye (aMask) takes the lid colour — a crow's
 *       nictitating membrane, the owl's steel shutter.
 *     - THE SKY IS COUNTED ONCE: Gauntlet's AmbientLight already is the sky's
 *       diffuse, so its irradiance is moved into the physical IBL slot and the
 *       probe keeps only its reflection. PORTED from Birb Mobile's
 *       src/flight/plumage.js `installPlumageLighting`, minus the bronze mask
 *       (the masks here are per vertex). Anchored on includes, never on chunk
 *       bodies (see authored-textures.js `installFeatherDetail` for the time a
 *       chunk-body anchor silently never matched).
 *     - A thin Fresnel rim (Birb Mobile visual-style.js `addRimLight`): the
 *       readability device that replaces the toon birds' ink hull.
 *     - Shade on dielectrics, per bird: the cyan ambient's hue is mostly
 *       neutralised (SHADE_NEUTRAL) and dielectric gets a floor of its own
 *       albedo (SHADE_FLOOR) — the owl's cream disc and amber iris in the
 *       sun's shadow. Same on all three families. On high and mid the eye
 *       glass's probe reflection is also desaturated and dimmed (SHADE_GLASS).
 */

import { FILM_RAMP_COS, thinFilmReflectance, hexToLinear } from './film.js';

export const REAL_TIERS = Object.freeze(['high', 'mid', 'low']);

const VERT_HEAD = /* glsl */`
uniform float uCurl;
uniform float uSweep;
uniform float uSpanInv;
uniform float uWristX;
uniform float uSplay;
uniform float uTailYaw;
uniform float uTailPitch;
uniform float uTailFan;
uniform float uTailZ;
uniform float uTailInv;
attribute vec4 aSurf;
attribute vec4 aDef;
attribute float aMask;
varying vec4 vSurf;
varying float vMask;
varying float vUpN;
#ifdef REAL_MECH
uniform float uGearAngle;
uniform float uKeyAngle;
attribute vec4 aGear;
attribute vec4 aAxis;
#endif
vec3 realRot( vec3 v, vec3 k, float a ) {
    float c = cos( a ), s = sin( a );
    return v * c + cross( k, v ) * s + k * dot( k, v ) * ( 1.0 - c );
}
void realDeform( inout vec3 p, inout vec3 n ) {
#ifdef REAL_MECH
    if ( aAxis.w > 0.5 ) {
        float ang = aAxis.w > 1.5 ? uKeyAngle : uGearAngle * aGear.w;
        vec3 k = normalize( aAxis.xyz );
        p = aGear.xyz + realRot( p - aGear.xyz, k, ang );
        n = realRot( n, k, ang );
    }
#endif
    if ( aDef.y != 0.0 ) {
        float sa = aDef.y * uSplay;
        float c = cos( sa ), s = sin( sa );
        float dx = p.x - aDef.z, dz = p.z - aDef.w;
        p.x = aDef.z + dx * c + dz * s;
        p.z = aDef.w - dx * s + dz * c;
        float nx0 = n.x;
        n.x = nx0 * c + n.z * s;
        n.z = -nx0 * s + n.z * c;
    }
    {
        float w = clamp( ( p.z - uTailZ ) * uTailInv, 0.0, 1.0 );
        float ya = uTailYaw * w, pa = uTailPitch * w;
        float ca = cos( ya ), sa = sin( ya ), cb = cos( pa ), sb = sin( pa );
        float nx = n.x, ny = n.y, nz = n.z;
        float rnx = nx * ca + nz * sa;
        float rnz = -nx * sa + nz * ca;
        n.x = rnx;
        n.y = ny * cb - rnz * sb;
        n.z = ny * sb + rnz * cb;
        p.x *= mix( 1.0, uTailFan, w );
        float dz = p.z - uTailZ;
        float rx = p.x * ca + dz * sa;
        float rz = -p.x * sa + dz * ca;
        p.x = rx;
        float ry = p.y * cb - rz * sb;
        float rz2 = p.y * sb + rz * cb;
        p.y = ry;
        p.z = uTailZ + rz2;
    }
    {
        float sx = position.x < 0.0 ? -1.0 : 1.0;
        float ah = uCurl * 0.75 * aDef.x * sx;
        float ch = cos( ah ), sh = sin( ah );
        float px = p.x - sx * uWristX, py = p.y;
        p.x = sx * uWristX + px * ch - py * sh;
        p.y = px * sh + py * ch;
        float nx = n.x, ny = n.y;
        n.x = nx * ch - ny * sh;
        n.y = nx * sh + ny * ch;
        float t = clamp( abs( position.x ) / max( uWristX, 1e-3 ), 0.0, 1.0 );
        float aa = uCurl * 0.25 * t * t * sx;
        float ca = cos( aa ), sa = sin( aa );
        px = p.x; py = p.y;
        p.x = px * ca - py * sa;
        p.y = px * sa + py * ca;
        nx = n.x; ny = n.y;
        n.x = nx * ca - ny * sa;
        n.y = nx * sa + ny * ca;
        float s2 = clamp( abs( position.x ) * uSpanInv, 0.0, 1.0 );
        p.z += uSweep * s2 * s2;
    }
}
`;

const FRAG_HEAD = /* glsl */`
varying vec4 vSurf;
varying float vMask;
varying float vUpN;
uniform float uBlink;
uniform vec3 uLidColor;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uPlumHemi;
uniform float uPlumEnvDiffuse;
uniform float uShadeNeutral;
uniform float uShadeFloor;
uniform float uSpecNeutral;
uniform float uMetalNeutral;
#ifdef REAL_FAUX_FILM
uniform vec3 uFilmFace;
uniform vec3 uFilmMid;
uniform vec3 uFilmGraze;
#endif
`;

const AFTER_PHYSICAL = /* glsl */`
#ifdef REAL_FILM_UP
    // A crow's gloss is on its upper surfaces: wing undersides and the belly
    // (normals facing down in bird space, on whichever face is drawn) carry
    // none.
    float realUp = smoothstep( -0.05, 0.45, vUpN * faceDirection );
#else
    float realUp = 1.0;
#endif
#ifdef USE_IRIDESCENCE
    material.iridescence *= vSurf.z * realUp;
#endif
#ifdef USE_CLEARCOAT
    material.clearcoat *= vSurf.w;
#endif
#ifdef USE_SHEEN
    material.sheenColor *= ( 1.0 - vSurf.x ) * smoothstep( 0.42, 0.52, vSurf.y );
#endif
#ifdef REAL_FAUX_FILM
    {
        float fNV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
        vec3 fT = fNV > 0.55
            ? mix( uFilmMid, uFilmFace, ( fNV - 0.55 ) / 0.45 )
            : mix( uFilmGraze, uFilmMid, clamp( ( fNV - 0.15 ) / 0.40, 0.0, 1.0 ) );
        material.specularColor = mix( material.specularColor, fT, vSurf.z * realUp );
    }
#endif
`;

/**
 * The warm neutral the ambient's hue is pulled toward (#fff1dc, linear,
 * scaled to unit luminance so the pull never brightens or darkens).
 */
export const SHADE_WARM = (() => {
    const c = hexToLinear(0xfff1dc);
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return [c[0] / y, c[1] / y, c[2] / y];
})();

/** Dielectric weight: 1 on vSurf.x = 0, gone by 0.2 (the oxidised seams). */
export function dielectricWeight(metal) {
    return Math.min(1, Math.max(0, 1 - 5 * metal));
}

// Gauntlet's AmbientLight is a stylised cel-world fill: PALETTE.skyMid, pure
// cyan. The realistic birds are lit as if the ambient were sky + ground
// bounce, which is near-neutral and a little warm, so on dielectrics the
// ambient keeps its luminance but loses most of its hue (uShadeNeutral; 0 on
// the crow, whose blue-black and grey were tuned under the cyan). Without
// this a cream disc facing away from the sun is albedo x cyan = teal. Metal
// is untouched: it takes its colour from the probe, not the diffuse fill.
const SHADE_NEUTRAL = /* glsl */`
    {
        float realNeutral = clamp( 1.0 - 5.0 * vSurf.x, 0.0, 1.0 ) * uShadeNeutral;
        vec3 realWarm = vec3( ${SHADE_WARM.map((v) => v.toFixed(4)).join(', ')} );
        irradiance = mix( irradiance, dot( irradiance, vec3( 0.2126, 0.7152, 0.0722 ) ) * realWarm, realNeutral );
    }
`;

/** How much of the eye glass's probe reflection SHADE_GLASS removes (owl). */
export const SHADE_GLASS_DIM = 0.7;

// The eye glass (dielectric under the eye mask: the owl's enamel iris and
// pupil) is a near-mirror, so on high and mid it shows the cyan sky probe,
// and a cyan reflection over amber reads grey-mauve. On that surface only,
// the reflection (base and clearcoat) loses uShadeNeutral of its hue and
// SHADE_GLASS_DIM x uShadeNeutral of its strength: a pale glint on glazed
// enamel, not a sky. Per bird via uShadeNeutral (0 on the crow: mix by 0,
// times 1, the identity); the metal aperture blades are untouched.
// ROOT: uSpecNeutral extends the same desaturation to EVERY dielectric's sky
// reflection (not its strength), and uMetalNeutral to every metal's. The root
// game's bird-only sky is the biome's own saturated zenith: a near-black crow
// seen from the chase camera is almost all grazing-angle reflection, so 0
// (Gauntlet's identity) read royal blue, and the owl's steel read ice-blue and
// its blackened bay blue. Pulling the REFLECTED sky toward its luminance keeps
// each metal's own F0 colour — brass stays brass, steel stays steel. Both 0 is
// Gauntlet's shader exactly. The glass term and its dimming are unchanged.
const SHADE_GLASS = /* glsl */`
#if defined( RE_IndirectSpecular )
    {
        float realDiel = clamp( 1.0 - 5.0 * vSurf.x, 0.0, 1.0 );
        float realGlass = realDiel * vMask * uShadeNeutral;
        float realSpecN = clamp( realGlass + realDiel * uSpecNeutral + ( 1.0 - realDiel ) * uMetalNeutral, 0.0, 1.0 );
        float realGlassDim = 1.0 - ${SHADE_GLASS_DIM.toFixed(4)} * realGlass;
        radiance = mix( radiance, vec3( dot( radiance, vec3( 0.2126, 0.7152, 0.0722 ) ) ), realSpecN ) * realGlassDim;
#ifdef USE_CLEARCOAT
        clearcoatRadiance = mix( clearcoatRadiance, vec3( dot( clearcoatRadiance, vec3( 0.2126, 0.7152, 0.0722 ) ) ), realSpecN ) * realGlassDim;
#endif
    }
#endif
`;

// installPlumageLighting's sky routing (Birb Mobile src/flight/plumage.js).
const AFTER_MAPS = SHADE_NEUTRAL + SHADE_GLASS + /* glsl */`
#if defined( RE_IndirectDiffuse ) && defined( RE_IndirectSpecular )
    iblIrradiance = iblIrradiance * uPlumEnvDiffuse + irradiance * uPlumHemi;
    irradiance = vec3( 0.0 );
#endif
`;

const RIM = /* glsl */`
    {
        float realRimF = 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
        outgoingLight += uRimColor * pow( realRimF, uRimPower ) * uRimStrength;
    }
`;

// Even neutralised, the 0.55 fill only lights an albedo to ~9% of itself, so
// the owl's cream disc (it faces forward, the sun is behind) still read as
// dark. A shade FLOOR, not a fill: a final linear-light floor on the
// composited colour (before the rim), so dielectric surfaces never read
// darker than uShadeFloor x albedo, and anything already lit past that (sun,
// specular) is untouched, so the sunlit side cannot blow out. Per bird (0 on
// the crow: max with 0 is the identity); on the owl only the enamel is
// dielectric — the cream disc and the eye glass (amber iris; the pupil's
// floor is ~black) — so this is the enamel's term, not a brighten. A blink
// lifts it off the eye, so the steel shutter keeps its own look.
const SHADE_FLOOR = /* glsl */`
    {
        float realFloorW = clamp( 1.0 - 5.0 * vSurf.x, 0.0, 1.0 ) * ( 1.0 - uBlink * vMask ) * uShadeFloor;
        outgoingLight = max( outgoingLight, diffuseColor.rgb * realFloorW );
    }
`;

// Phong (low): a per-surface lobe from aSurf instead of one bird-wide
// setting. Shininess follows roughness (enamel ~100, polished trim ~60-70,
// rough shells and feathers ~20-35); on metal (vSurf.x) the specular takes
// the metal's own colour and the diffuse drops, as a metal's would.
const AFTER_PHONG = /* glsl */`
    material.specularShininess = clamp( 100.0 - 160.0 * ( vSurf.y - 0.06 ), 20.0, 100.0 );
    material.specularColor = mix( material.specularColor, diffuseColor.rgb, vSurf.x * 0.85 );
    material.diffuseColor *= mix( 1.0, 0.55, vSurf.x );
`;

// Low has no probe to give metal its colour, so the sky's blue ambient would
// tint a pale nickel disc cyan: a small self-coloured term stands in for the
// reflection the probe gives high and mid.
const PHONG_METAL_FILL = /* glsl */`
    totalEmissiveRadiance += diffuseColor.rgb * 0.16 * vSurf.x;
`;

/** Every anchor the injection needs, per shader family, for the guard. */
const REQUIRED = {
    vertex: ['#include <beginnormal_vertex>', '#include <begin_vertex>'],
    fragment: ['#include <color_fragment>', '#include <lights_fragment_maps>', '#include <opaque_fragment>'],
    phong: ['#include <specularmap_fragment>', '#include <emissivemap_fragment>', '#include <lights_phong_fragment>'],
    standard: [
        '#include <normal_fragment_begin>', '#include <metalnessmap_fragment>', '#include <roughnessmap_fragment>',
        '#include <lights_physical_fragment>',
    ],
};

let warned = false;

function occurrences(src, a) {
    return src.split(a).length - 1;
}

/** The anchors a family needs that are not present exactly once. */
export function missingAnchors(shader, family) {
    const missing = [];
    for (const a of REQUIRED.vertex) if (occurrences(shader.vertexShader, a) !== 1) missing.push(a);
    const frag = REQUIRED.fragment.concat(family === 'phong' ? REQUIRED.phong : REQUIRED.standard);
    for (const a of frag) if (occurrences(shader.fragmentShader, a) !== 1) missing.push(a);
    return missing;
}

/**
 * Splice the realistic-bird code into a three shader. Exported (with no THREE
 * needed) so the tests can run it against stand-in shader text and check
 * every anchor lands. Every anchor is validated BEFORE anything is changed:
 * if any is missing or ambiguous the shader is returned untouched (the bird
 * draws undeformed and plain, never half-patched) and one warning is logged.
 */
export function patchRealShader(shader, flags) {
    const missing = missingAnchors(shader, flags.family);
    if (missing.length) {
        if (!warned) {
            warned = true;
            // The harness fails on console warnings, so this cannot ship silently.
            console.warn('realistic bird: shader anchors missing or repeated (' + missing.join(', ') + '); left unpatched');
        }
        return shader;
    }
    const defs = (flags.mech ? '#define REAL_MECH\n' : '') + (flags.fauxFilm ? '#define REAL_FAUX_FILM\n' : '')
        + (flags.filmUp ? '#define REAL_FILM_UP\n' : '');
    shader.vertexShader = defs + VERT_HEAD + shader.vertexShader
        .replace('#include <beginnormal_vertex>',
            '#include <beginnormal_vertex>\n{ vec3 realP = vec3( position ); realDeform( realP, objectNormal ); }\nvUpN = normalize( objectNormal ).y;')
        .replace('#include <begin_vertex>',
            '#include <begin_vertex>\n{ vec3 realN = vec3( 0.0, 1.0, 0.0 ); realDeform( transformed, realN ); }\nvSurf = aSurf;\nvMask = aMask;');
    let f = defs + FRAG_HEAD + shader.fragmentShader
        .replace('#include <color_fragment>',
            '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uLidColor, uBlink * vMask );')
        .replace('#include <opaque_fragment>', SHADE_FLOOR + RIM + '#include <opaque_fragment>');
    if (flags.family === 'phong') {
        f = f
            .replace('#include <specularmap_fragment>',
                '#include <specularmap_fragment>\nspecularStrength *= mix( 0.45, 1.0, vSurf.x ) * clamp( 1.25 - vSurf.y, 0.2, 1.0 );')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + PHONG_METAL_FILL)
            .replace('#include <lights_phong_fragment>', '#include <lights_phong_fragment>\n' + AFTER_PHONG)
            .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + SHADE_NEUTRAL);
    } else {
        f = f
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.x;')
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vSurf.y;')
            .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + AFTER_PHYSICAL)
            .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + AFTER_MAPS);
    }
    shader.fragmentShader = f;
    return shader;
}

/** Raw film reflectance at FILM_RAMP_COS, floored so it never goes black. */
export function filmStops(film) {
    return FILM_RAMP_COS.map((c) => {
        const r = thinFilmReflectance(c, film.ior, film.thickness, film.baseF0);
        return { x: Math.max(r[0], 0.004), y: Math.max(r[1], 0.004), z: Math.max(r[2], 0.004) };
    });
}

function vec3Lin(hex) {
    const c = hexToLinear(hex);
    return { x: c[0], y: c[1], z: c[2] };
}

/**
 * The per-material look uniforms (rim, lid, sky routing, shade neutral/floor,
 * faux film). `o.shade` is { neutral, floor }; omitted = 0 (the stylised fill
 * as is).
 */
export function lookUniforms(o) {
    const shade = o.shade || { neutral: 0, floor: 0 };
    const u = {
        uLidColor: { value: vec3Lin(o.lid) },
        uRimColor: { value: vec3Lin(o.rim.color) },
        uRimStrength: { value: o.rim.strength },
        uRimPower: { value: o.rim.power },
        uPlumHemi: { value: 1 },
        uPlumEnvDiffuse: { value: 0 },
        uShadeNeutral: { value: shade.neutral },
        uShadeFloor: { value: shade.floor },
        // ROOT: the reflection's hue pull on every dielectric (0 = Gauntlet).
        uSpecNeutral: { value: shade.spec || 0 },
        uMetalNeutral: { value: shade.metal || 0 },
    };
    if (o.film) {
        const s = filmStops(o.film);
        u.uFilmFace = { value: s[0] };
        u.uFilmMid = { value: s[1] };
        u.uFilmGraze = { value: s[2] };
    }
    return u;
}

/**
 * Build one material.
 *
 * @param {object} THREE
 * @param {object} o
 * @param {'high'|'mid'|'low'} o.tier
 * @param {'contour'|'vane'|'metal'} o.kind
 * @param {boolean} [o.double]   DoubleSide (feather and plate sheets)
 * @param {boolean} [o.mech]     carries the gear/key attributes (the owl)
 * @param {object}  o.textures   the shared set from feather-textures.js
 * @param {object}  o.uniforms   deformer + look uniform objects, by name
 * @param {object}  [o.film]     { ior, thickness, range } — the thin film
 * @param {number}  [o.sheen]    sheen colour (feathers)
 * @param {number}  [o.lowSpecular] Phong specular colour (shininess is per surface, from aSurf)
 * @param {boolean} [o.filmUp]   gate the film to upward-facing surfaces (the crow)
 * @param {number}  [o.envIntensity] probe reflection strength (default 1)
 */
export function createRealMaterial(THREE, o) {
    const tier = REAL_TIERS.indexOf(o.tier) >= 0 ? o.tier : 'high';
    const tx = o.textures;
    const set = o.kind === 'contour' ? tx.contour : (o.kind === 'vane' ? tx.vane : tx.brushed);
    const side = o.double ? THREE.DoubleSide : THREE.FrontSide;
    let mat;
    let family = 'standard';
    const fauxFilm = tier === 'mid' && !!o.film;
    if (tier === 'low') {
        family = 'phong';
        mat = new THREE.MeshPhongMaterial({
            vertexColors: true,
            color: 0xffffff,
            map: o.kind === 'metal' ? tx.engrave : set.map,
            specular: o.lowSpecular === undefined ? 0x333333 : o.lowSpecular,
            // The shader sets shininess per surface from aSurf's roughness.
            shininess: 30,
            side,
        });
    } else {
        const p = {
            vertexColors: true,
            color: 0xffffff,
            metalness: 1,       // the real value comes from aSurf.x per vertex
            roughness: 1,       // multiplied by aSurf.y and the detail map's G
            map: o.kind === 'metal' ? tx.engrave : set.map,
            normalMap: set.normal,
            roughnessMap: set.surf,
            envMapIntensity: o.envIntensity === undefined ? 1 : o.envIntensity,
            side,
        };
        if (tier === 'high') {
            p.ior = o.kind === 'metal' ? 1.5 : 1.56;
            p.specularIntensity = o.kind === 'metal' ? 1 : 0.5;
            if (o.kind !== 'metal') {
                // A faint, near-black blue sheen: enough to round the feather
                // mass at grazing, never enough to grey it.
                p.sheen = o.kind === 'contour' ? 0.25 : 0.2;
                p.sheenRoughness = o.kind === 'contour' ? 0.5 : 0.4;
                p.sheenColor = o.sheen === undefined ? 0x161c2c : o.sheen;
            }
            if (o.film) {
                p.iridescence = 1;
                p.iridescenceIOR = o.film.ior;
                p.iridescenceThicknessRange = [o.film.range[0], o.film.range[1]];
            }
            if (o.kind !== 'vane') {
                // Full strength; aSurf.w weights it per vertex (eyes and
                // enamel ~1, bill ~0.35, brushed shells ~0.1, feathers 0).
                p.clearcoat = 1;
                p.clearcoatRoughness = o.kind === 'metal' ? 0.30 : 0.08;
            }
            mat = new THREE.MeshPhysicalMaterial(p);
        } else {
            mat = new THREE.MeshStandardMaterial(p);
        }
        if (mat.normalScale && mat.normalScale.set) {
            const k = o.kind === 'metal' ? 0.4 : (o.kind === 'vane' ? 0.8 : 0.55);
            mat.normalScale.set(k, k);
        }
    }
    const uniforms = o.uniforms;
    const filmUp = !!o.filmUp && family !== 'phong';
    const flags = { mech: !!o.mech, fauxFilm, filmUp, family };
    mat.onBeforeCompile = function (shader) {
        Object.assign(shader.uniforms, uniforms);
        patchRealShader(shader, flags);
    };
    const key = 'birb-species-v1|' + tier + '|' + o.kind + '|' + (flags.mech ? 'm' : '-') + (fauxFilm ? 'f' : '-') // ROOT: own program key
        + (filmUp ? 'u' : '-');
    mat.customProgramCacheKey = function () { return key; };
    mat.userData.realistic = { tier, kind: o.kind, uniforms, programKey: key };
    return mat;
}
