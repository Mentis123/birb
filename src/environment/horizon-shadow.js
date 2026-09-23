/**
 * Horizon shadows at runtime — one chained material patch.
 *
 * horizon-map.js bakes, per texel of an equirect grid over the planet, the
 * skyline elevation in 8 azimuths. This patch reads it back in every opaque
 * world material and turns it into light:
 *
 *  - SUN VISIBILITY. The two azimuths either side of the sun are blended
 *    (tent weights, a partition of unity), and the sun's elevation over the
 *    fragment's OWN horizon is compared with that skyline through a
 *    smoothstep penumbra a few degrees wide. Then the bird's three analytic
 *    ellipsoids (src/effects/bird-shadow.js) take their share.
 *  - SKY VISIBILITY. The mean of cos^2 of the eight skylines is the
 *    cosine-weighted share of the sky dome left open; the indirect
 *    (hemisphere) light is scaled by it, so a valley floor or the ground
 *    between trees gets less sky than a ridge top.
 *
 * WHERE the visibility lands is the part that has to be exact, and it is not
 * at <opaque_fragment>. By then three has summed the sun into
 * reflectedLight.directDiffuse together with the rim and fill lights, and —
 * at Ultra — already multiplied it by the real shadow map. Subtracting "(1 -
 * lit) of the sun's Lambert" there takes the sun away twice wherever the
 * shadow map had already taken it once (and on 54b1961, where the key light
 * and the shadow light BOTH carry the sun, it would take away only half).
 * So the visibility multiplies the sun's own IncidentLight colour inside
 * three's light loop, before the shadow-map factor: `getDirectionalLightInfo`
 * is wrapped by a macro for the length of <lights_fragment_begin> and the
 * wrapper scales the light whose direction IS the sun. Matched by direction,
 * not by index, because the index moves: three sorts shadow-casting lights
 * first, so the sun is index 0 with shadows off (the key light) and index 0
 * with them on (the shadow light) — but on the base rig the key light is
 * index 1 then and still lit, and the planet-light package hides it. Every
 * directional light shining from the sun's direction is the sun.
 *
 * The sky term multiplies reflectedLight.indirectDiffuse just ahead of
 * <aomap_fragment>, which is where three applies its own ambient occlusion.
 * Both land before outgoingLight exists, so the atmosphere's cloud shadow,
 * rim and mist (addAtmosphere, chained after this) all see shadowed light —
 * and the rim is multiplied by `birbSunVis` too (visual-style.js looks for
 * the global and only then emits the factor, so its own output is
 * byte-identical when this patch is absent).
 *
 * `?horizon=0` / `?birdshadow=0` (src/ui/boot-flags.js) restore the true
 * before: with both off the patch is not applied at all.
 */

import { ensureWorldVarying } from './visual-style.js';
import { ENVELOPE_MIN, ENVELOPE_RANGE } from './horizon-map.js';
import {
  BIRD_SHADOW_GLSL, BIRD_SHADOW_UNIFORMS_GLSL, birdShadowUniforms, ensureBirdShadowUniforms,
} from '../effects/bird-shadow.js';

export function horizonShadowRequested(search) {
  return !/[?&]horizon=0(?:&|$)/.test(search || '');
}

export const HORIZON_SHADOW_DEFAULTS = Object.freeze({
  // Runtime A/B: 1 is the shipping look, 0 is pixel-for-pixel the old light.
  strength: 1,
  // How much of the indirect light the sky visibility may take away. Not 1:
  // an occluding hill is itself lit and returns part of the sky it blocks,
  // and a canopy splatted as a solid column blocks more than a crown does.
  sky: 0.65,
  // Half-width of the sun's penumbra across the skyline, radians (~2.9 deg).
  penumbra: 0.05,
  // A directional light whose direction is within ~0.8 deg of the sun's is
  // the sun (float32 round trips put key and shadow light at 1 - 1e-7).
  sunMatch: 0.9999,
  // Seconds the bake fades in over once it lands (motionState clock).
  fadeSeconds: 0.8,
  // A prop fragment this far above the envelope its skyline was measured
  // from starts to shed that skyline, and has shed it entirely by liftEnd:
  // a cloud or the top of a bare snag is not standing where the ground is.
  liftStart: 1.5,
  liftEnd: 14,
});

/**
 * The shared uniforms. Samplers are bound per receiver kind: the GROUND reads
 * the ground-eye set, every prop the envelope-eye set (see horizon-map.js).
 */
export const horizonUniforms = {
  groundA: { value: null }, groundB: { value: null },
  propA: { value: null }, propB: { value: null },
  // One byte a texel: the occluder envelope's height (horizon-map.js).
  envelope: { value: null },
  // x lift start, y lift end (units above the envelope), z planet radius
  lift: { value: null },
  // x strength, y sky strength, z penumbra, w sun-match cosine
  params: { value: null },
  // x the clock value the bake landed at (1e9 = not yet), y fade seconds
  ready: { value: null },
  sun: { value: null },     // bound to visualUniforms.sunDir by the caller
  time: { value: null },    // bound to visualUniforms.time by the caller
};

/** Idempotent. Allocates the uniform VALUES (THREE injected). */
export function ensureHorizonUniforms(THREE, { sunDir, time } = {}) {
  const d = HORIZON_SHADOW_DEFAULTS;
  if (!horizonUniforms.params.value) {
    horizonUniforms.params.value = new THREE.Vector4(d.strength, d.sky, d.penumbra, d.sunMatch);
  }
  if (!horizonUniforms.ready.value) horizonUniforms.ready.value = new THREE.Vector2(1e9, d.fadeSeconds);
  if (!horizonUniforms.lift.value) horizonUniforms.lift.value = new THREE.Vector3(d.liftStart, d.liftEnd, 120);
  if (sunDir) horizonUniforms.sun = sunDir;
  if (time) horizonUniforms.time = time;
  if (!horizonUniforms.sun.value) horizonUniforms.sun.value = new THREE.Vector3(0, 1, 0);
  if (horizonUniforms.time.value == null) horizonUniforms.time.value = 0;
  return horizonUniforms;
}

// One sampler pair, one set of names: the receiver kind only changes which
// shared texture objects are bound to them, never the GLSL.
const HORIZON_PARS_GLSL = `
uniform sampler2D uHorizonA;
uniform sampler2D uHorizonB;
uniform sampler2D uHorizonEnvelope;
uniform vec3 uHorizonLift;
uniform vec3 uHorizonSun;
uniform vec4 uHorizonParams;
uniform vec2 uHorizonReady;
uniform float uHorizonTime;
`;

// Globals: written once in main() before the light loop, read by the wrapper
// below, by the sky term, and by addAtmosphere's rim.
const HORIZON_GLOBALS_GLSL = `
float birbSunVis = 1.0;
float birbSkyVis = 1.0;
vec3 birbSunView = vec3( 0.0, 0.0, 1.0 );
`;

// After <lights_pars_begin>: DirectionalLight and IncidentLight exist here.
const HORIZON_LIGHT_WRAPPER_GLSL = `
#if NUM_DIR_LIGHTS > 0
void birbHorizonDirInfo( const in DirectionalLight dl, out IncidentLight light ) {
  getDirectionalLightInfo( dl, light );
  if ( dot( light.direction, birbSunView ) > uHorizonParams.w ) light.color *= birbSunVis;
}
#endif
`;

/**
 * The skyline lookup. Mirrors horizon-map.js exactly: u = atan(z, -x) / 2PI,
 * v = acos(y) / PI, East = normalize(Y x up), North = up x East, azimuth a at
 * a * PI/4 from East toward North, angles decoded (byte/255 - 0.5) * PI.
 */
const HORIZON_EVAL_GLSL = `
  {
    vec3 hzUp = normalize( vBirbWorld );
    vec3 hzE = vec3( hzUp.z, 0.0, -hzUp.x );
    float hzEl = length( hzE );
    hzE = hzEl > 1e-6 ? hzE / hzEl : vec3( 1.0, 0.0, 0.0 );
    vec3 hzN = cross( hzUp, hzE );
    vec3 hzSun = normalize( uHorizonSun );
    birbSunView = normalize( ( viewMatrix * vec4( hzSun, 0.0 ) ).xyz );
    float hzFade = clamp( ( uHorizonTime - uHorizonReady.x ) / max( uHorizonReady.y, 1e-3 ), 0.0, 1.0 );
    float hzStrength = uHorizonParams.x * hzFade;
#ifdef BIRB_HORIZON_MAP
    if ( hzStrength > 0.0 ) {
      vec2 hzUv = vec2( atan( hzUp.z, -hzUp.x ) * 0.15915494, acos( clamp( hzUp.y, -1.0, 1.0 ) ) * 0.31830989 );
      vec4 hzA = ( texture2D( uHorizonA, hzUv ) - 0.5 ) * 3.14159265;
      vec4 hzB = ( texture2D( uHorizonB, hzUv ) - 0.5 ) * 3.14159265;
      float hzElev = asin( clamp( dot( hzSun, hzUp ), -1.0, 1.0 ) );
      float hzAz = atan( dot( hzSun, hzN ), dot( hzSun, hzE ) );
      vec4 hzDA = abs( mod( vec4( hzAz ) - vec4( 0.0, 0.78539816, 1.57079633, 2.35619449 ) + 3.14159265, 6.28318531 ) - 3.14159265 );
      vec4 hzDB = abs( mod( vec4( hzAz ) - vec4( 3.14159265, 3.92699082, 4.71238898, 5.49778714 ) + 3.14159265, 6.28318531 ) - 3.14159265 );
      vec4 hzWA = max( vec4( 0.0 ), 1.0 - hzDA * 1.27323954 );
      vec4 hzWB = max( vec4( 0.0 ), 1.0 - hzDB * 1.27323954 );
      float hzH = dot( hzA, hzWA ) + dot( hzB, hzWB );
      float hzLit = smoothstep( hzH - uHorizonParams.z, hzH + uHorizonParams.z, hzElev );
      vec4 hzSA = sin( max( hzA, vec4( 0.0 ) ) );
      vec4 hzSB = sin( max( hzB, vec4( 0.0 ) ) );
      float hzSky = 1.0 - ( dot( hzSA, hzSA ) + dot( hzSB, hzSB ) ) * 0.125;
  #ifdef BIRB_HORIZON_LIFT
      // A prop fragment well ABOVE the envelope its skyline was measured from
      // (a cloud, a bare snag's top, the upper storeys of a wall) sheds it.
      float hzEnv = texture2D( uHorizonEnvelope, hzUv ).r * ${ENVELOPE_RANGE.toFixed(1)} + ${ENVELOPE_MIN.toFixed(1)};
      float hzLift = smoothstep( uHorizonLift.x, uHorizonLift.y, length( vBirbWorld ) - uHorizonLift.z - hzEnv );
      hzLit = mix( hzLit, 1.0, hzLift );
      hzSky = mix( hzSky, 1.0, hzLift );
  #endif
      birbSunVis = mix( 1.0, hzLit, hzStrength );
      birbSkyVis = mix( 1.0, hzSky, hzStrength * uHorizonParams.y );
    }
#endif
#ifdef BIRB_BIRD_SHADOW
    float hzBird = birbBirdShadow( vBirbWorld, hzSun );
  #ifdef USE_SHADOWMAP
    // A fragment that already receives the real shadow map already has the
    // bird in it (the bird is a caster whenever maps are on).
    if ( receiveShadow ) hzBird = 1.0;
  #endif
    birbSunVis *= hzBird;
#endif
  }
`;

/**
 * Patch a lit material. Chains any existing onBeforeCompile and extends the
 * program cache key. `receiver` is 'ground' or 'prop'. Returns the material.
 *
 * Call BEFORE addAtmosphere, so this runs first in the chain and the rim can
 * see `birbSunVis`.
 */
export function addHorizonShadow(material, THREE, {
  receiver = 'prop', horizon = true, birdShadow = true,
} = {}) {
  if (!material || material.userData?.birbHorizon) return material;
  if (!horizon && !birdShadow) return material;
  const lit = material.isMeshLambertMaterial || material.isMeshPhongMaterial
    || material.isMeshStandardMaterial || material.isMeshToonMaterial;
  if (!lit || material.isShaderMaterial) return material;
  material.userData = material.userData || {};
  material.userData.birbHorizon = { receiver, horizon, birdShadow };
  ensureHorizonUniforms(THREE);
  if (birdShadow) ensureBirdShadowUniforms(THREE);

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const ground = receiver === 'ground';

  material.onBeforeCompile = function birbHorizonPatch(shader, renderer) {
    if (typeof previous === 'function') previous.call(this, shader, renderer);
    const frag = shader.fragmentShader;
    // Anchors this patch needs; a material without them is left alone rather
    // than half-patched (three would draw nothing for a shader that fails).
    if (!frag.includes('#include <lights_fragment_begin>')
      || !frag.includes('#include <lights_pars_begin>')
      || !frag.includes('#include <aomap_fragment>')) return;

    ensureWorldVarying(shader);
    shader.uniforms.uHorizonA = ground ? horizonUniforms.groundA : horizonUniforms.propA;
    shader.uniforms.uHorizonB = ground ? horizonUniforms.groundB : horizonUniforms.propB;
    shader.uniforms.uHorizonSun = horizonUniforms.sun;
    shader.uniforms.uHorizonParams = horizonUniforms.params;
    shader.uniforms.uHorizonReady = horizonUniforms.ready;
    shader.uniforms.uHorizonTime = horizonUniforms.time;
    shader.uniforms.uHorizonEnvelope = horizonUniforms.envelope;
    shader.uniforms.uHorizonLift = horizonUniforms.lift;
    if (birdShadow) {
      shader.uniforms.uBirdShadowE = birdShadowUniforms.uBirdShadowE;
      shader.uniforms.uBirdShadowP = birdShadowUniforms.uBirdShadowP;
    }

    const defines = (horizon ? '#define BIRB_HORIZON_MAP\n' : '')
      + (horizon && !ground ? '#define BIRB_HORIZON_LIFT\n' : '')
      + (birdShadow ? '#define BIRB_BIRD_SHADOW\n' : '');
    shader.fragmentShader = defines + HORIZON_PARS_GLSL
      + (birdShadow ? BIRD_SHADOW_UNIFORMS_GLSL + BIRD_SHADOW_GLSL : '')
      + HORIZON_GLOBALS_GLSL
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>\n${HORIZON_LIGHT_WRAPPER_GLSL}`)
      .replace('#include <lights_fragment_begin>', `${HORIZON_EVAL_GLSL}
#if NUM_DIR_LIGHTS > 0
#define getDirectionalLightInfo( dl, l ) birbHorizonDirInfo( dl, l )
#endif
#include <lights_fragment_begin>
#if NUM_DIR_LIGHTS > 0
#undef getDirectionalLightInfo
#endif`)
      .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= birbSkyVis;
#include <aomap_fragment>`);
  };

  // The receiver kind changes the GLSL (the prop lift), so it is in the key.
  const flags = `${horizon ? 'h' : ''}${horizon && !ground ? 'l' : ''}${birdShadow ? 'b' : ''}`;
  material.customProgramCacheKey = function birbHorizonKey() {
    const base = typeof previousKey === 'function' ? previousKey.call(this) : 'birb';
    return `${base}-horizon-${flags}-v1`;
  };
  material.needsUpdate = true;
  return material;
}

/** Live strength (runtime A/B). Returns the value in force. */
export function setHorizonStrength(s) {
  const p = horizonUniforms.params.value;
  if (!p) return null;
  p.x = Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : HORIZON_SHADOW_DEFAULTS.strength;
  return p.x;
}

/** The fade-in: 0 until the bake lands, 1 `fadeSeconds` later. */
export function horizonReadiness() {
  const r = horizonUniforms.ready.value;
  const t = horizonUniforms.time.value;
  if (!r || !Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, (t - r.x) / Math.max(r.y, 1e-3)));
}

/**
 * Plain-JS mirror of the shader's skyline evaluation for one fragment
 * direction, given the 8 decoded angles there. Tests use it to pin the GLSL's
 * conventions to horizon-map.js's.
 */
export function evaluateSunElevationAzimuth(up, sun) {
  const [ux, uy, uz] = up;
  let ex = uz; let ez = -ux;
  const el = Math.hypot(ex, ez);
  if (el > 1e-6) { ex /= el; ez /= el; } else { ex = 1; ez = 0; }
  const nx = uy * ez; const ny = uz * ex - ux * ez; const nz = -uy * ex;
  const sl = Math.hypot(...sun);
  const s = sun.map((v) => v / sl);
  const elev = Math.asin(Math.max(-1, Math.min(1, s[0] * ux + s[1] * uy + s[2] * uz)));
  const az = Math.atan2(s[0] * nx + s[1] * ny + s[2] * nz, s[0] * ex + s[2] * ez);
  return { elevation: elev, azimuth: az };
}
