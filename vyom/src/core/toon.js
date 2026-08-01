/**
 * toon.js — VYOM's cel-shading pipeline.
 *
 * Every lit surface in the game goes through `createToonMaterial`. It builds a
 * MeshToonMaterial (which already gives us hard-stepped N·L via a NearestFilter
 * gradient ramp) and then patches the shader to add the two things the stock
 * material lacks:
 *
 *   1. Fresnel rim light — a quantised, hard-edged halo on the silhouette so
 *      birds and gates separate from the terrain behind them. This is what
 *      stops the frame reading as flat-shaded mush.
 *   2. Banded specular — a Blinn-Phong highlight run through a step(), so
 *      beaks, eyes and gate metal get a hard highlight SHAPE rather than a
 *      smooth falloff. Never a real cubemap probe.
 *
 * Why MeshToonMaterial + onBeforeCompile instead of a raw ShaderMaterial:
 * instancing, fog, vertex colours, alpha and the renderer's light uniforms all
 * keep working for free. A hand-rolled ShaderMaterial would have to re-implement
 * every one of those, and would break the moment the instanced prop layers went
 * in. The look is identical; the maintenance cost is not.
 *
 * All patched materials share one compiled program (see `customProgramCacheKey`)
 * so the injection costs no extra shader compiles.
 */

import { PALETTE, KEY_LIGHT_DIR, getRamp } from './palette.js';

/** Injected once into every patched vertex shader. */
const VERT_HEAD = /* glsl */`
varying vec3 vVyomViewPos;
`;

const VERT_BODY = /* glsl */`
    vVyomViewPos = -mvPosition.xyz;
`;

/** Injected once into every patched fragment shader. */
const FRAG_HEAD = /* glsl */`
varying vec3 vVyomViewPos;
uniform vec3  uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uRimThreshold;
uniform float uRimSoftness;
uniform vec3  uSpecColor;
uniform float uSpecStrength;
uniform float uSpecPower;
uniform float uSpecThreshold;
uniform vec3  uKeyLightWorld;
`;

/**
 * Replaces `#include <opaque_fragment>` so we can add to `outgoingLight`
 * before it is written out. Both additions are quantised with smoothstep over
 * a very narrow band: a raw step() aliases badly on a moving silhouette at
 * mobile resolution, while a 0.03-wide smoothstep still reads as a hard edge
 * but antialiases cleanly. This is the one place we deliberately soften.
 */
const FRAG_BODY = /* glsl */`
    {
        vec3 vyN = normalize( normal );
        vec3 vyV = normalize( vVyomViewPos );

        // --- Fresnel rim -------------------------------------------------
        float fres = 1.0 - clamp( dot( vyN, vyV ), 0.0, 1.0 );
        fres = pow( fres, uRimPower );
        float rimBand = smoothstep( uRimThreshold, uRimThreshold + uRimSoftness, fres );
        outgoingLight += uRimColor * rimBand * uRimStrength;

        // --- Banded specular ---------------------------------------------
        // Key light arrives in world space; rotate it into view space here so
        // the CPU never has to touch this uniform per frame.
        vec3 vyL = normalize( ( viewMatrix * vec4( uKeyLightWorld, 0.0 ) ).xyz );
        vec3 vyH = normalize( vyL + vyV );
        float spec = pow( max( dot( vyN, vyH ), 0.0 ), uSpecPower );
        float specBand = smoothstep( uSpecThreshold, uSpecThreshold + 0.03, spec );
        outgoingLight += uSpecColor * specBand * uSpecStrength;
    }
    #include <opaque_fragment>
`;

/** Defaults tuned by eye against captured frames. */
const TOON_DEFAULTS = {
    ramp: 'hero',
    rimColor: 0xffe9bd,
    rimStrength: 0.55,
    rimPower: 2.4,
    rimThreshold: 0.52,
    rimSoftness: 0.06,
    specColor: 0xffffff,
    specStrength: 0.5,
    specPower: 48,
    specThreshold: 0.55,
};

/**
 * Build a patched cel material.
 *
 * @param {object} THREE
 * @param {object} opts
 * @param {number}  [opts.color]         base colour (hex int)
 * @param {string}  [opts.ramp]          key into RAMPS ('hero'|'terrain'|'graphic'|'emissive')
 * @param {number}  [opts.emissive]      self-lit colour, for gates/ribbon
 * @param {number}  [opts.emissiveIntensity]
 * @param {boolean} [opts.vertexColors]
 * @param {boolean} [opts.flatShading]   faceted look for rock/crystal forms
 * @param {boolean} [opts.transparent]
 * @param {number}  [opts.opacity]
 * @param {number}  [opts.side]          THREE.FrontSide by default
 * @param {boolean} [opts.fog]
 * @param {number}  [opts.rimColor] etc. — any TOON_DEFAULTS key to override
 * @returns {THREE.MeshToonMaterial}
 */
export function createToonMaterial(THREE, opts = {}) {
    const o = { ...TOON_DEFAULTS, ...opts };

    const material = new THREE.MeshToonMaterial({
        color: o.color ?? 0xffffff,
        gradientMap: getRamp(THREE, o.ramp),
        vertexColors: Boolean(o.vertexColors),
        flatShading: Boolean(o.flatShading),
        transparent: Boolean(o.transparent),
        opacity: o.opacity ?? 1,
        side: o.side ?? THREE.FrontSide,
        depthWrite: o.depthWrite ?? true,
        fog: o.fog !== false,
    });

    if (o.emissive !== undefined) {
        material.emissive = new THREE.Color(o.emissive);
        material.emissiveIntensity = o.emissiveIntensity ?? 1;
    }

    patchToon(THREE, material, o);
    return material;
}

/**
 * Patch an existing MeshToonMaterial with the rim + specular injection.
 * Exposed separately so callers who need an exotic base material (e.g. one
 * carrying a map) can still opt into the VYOM look.
 */
export function patchToon(THREE, material, opts = {}) {
    const o = { ...TOON_DEFAULTS, ...opts };

    // One uniform block per material, reachable later via
    // `material.userData.vyom` for runtime tweaks (rim pulses, gate flashes).
    const uniforms = {
        uRimColor: { value: new THREE.Color(o.rimColor) },
        uRimStrength: { value: o.rimStrength },
        uRimPower: { value: o.rimPower },
        uRimThreshold: { value: o.rimThreshold },
        uRimSoftness: { value: o.rimSoftness },
        uSpecColor: { value: new THREE.Color(o.specColor) },
        uSpecStrength: { value: o.specStrength },
        uSpecPower: { value: o.specPower },
        uSpecThreshold: { value: o.specThreshold },
        uKeyLightWorld: { value: new THREE.Vector3(KEY_LIGHT_DIR.x, KEY_LIGHT_DIR.y, KEY_LIGHT_DIR.z).normalize() },
    };
    material.userData.vyom = uniforms;

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);

        shader.vertexShader = VERT_HEAD + shader.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n' + VERT_BODY
        );

        shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            FRAG_BODY
        );
    };

    // All patched materials inject byte-identical source, so they can share a
    // program. Without this, three treats every onBeforeCompile material as
    // unique and recompiles per material — a visible hitch on mobile.
    material.customProgramCacheKey = () => 'vyom-toon-v1';

    return material;
}

/**
 * Per-material runtime knobs. Safe to call every frame (writes a float into an
 * existing uniform — no allocation, no recompile).
 */
export function setRimStrength(material, value) {
    const u = material.userData && material.userData.vyom;
    if (u) u.uRimStrength.value = value;
}

export function setSpecStrength(material, value) {
    const u = material.userData && material.userData.vyom;
    if (u) u.uSpecStrength.value = value;
}

export function setRimColor(material, hex) {
    const u = material.userData && material.userData.vyom;
    if (u) u.uRimColor.value.setHex(hex);
}

/**
 * Standard VYOM light rig. One key directional (the sun you can see in the
 * sky), one hemisphere fill so shadowed sides pick up sky bounce instead of
 * going black. No shadow maps — cel shading reads better without them and it
 * buys back the whole shadow pass on mobile.
 */
export function createLightRig(THREE, scene) {
    const key = new THREE.DirectionalLight(0xfff4d6, 2.6);
    key.position.set(KEY_LIGHT_DIR.x, KEY_LIGHT_DIR.y, KEY_LIGHT_DIR.z).normalize().multiplyScalar(600);
    scene.add(key);

    // AmbientLight, NOT HemisphereLight, and this is the whole ballgame for the
    // cel look.
    //
    // MeshToonMaterial quantises only the DIRECT term — it runs N·L through the
    // NearestFilter ramp. Indirect light is added afterwards, unquantised. A
    // HemisphereLight's contribution varies smoothly with the surface normal,
    // so it paints a soft vertical gradient straight over the top of the hard
    // bands: the ramp is still working, you just cannot see it any more. That
    // is exactly what made the bird read as smooth-shaded in the first
    // captured frames while the hard specular shape proved the material was
    // applied correctly.
    //
    // AmbientLight is constant regardless of normal, so it lifts the shadow
    // band without smearing the terminator. Keep it low: every unit of ambient
    // compresses the ramp's contrast.
    const fill = new THREE.AmbientLight(PALETTE.skyMid, 0.55);
    scene.add(fill);

    return { key, fill };
}
