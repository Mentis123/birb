/**
 * A ring that reads as energy rather than as a plastic hoop.
 *
 * Two things in this game are torus-shaped and meant to look powered — the
 * drones' gyro ring and the slalom course's checkpoint gates — and both
 * shipped the same way: a flat colour, `transparent`, `AdditiveBlending`, at
 * an opacity under one. That combination has a specific failure mode, and it
 * is not subtle once you know it.
 *
 * **Additive light on a bright sky is grey.** Adding cyan to an already-pale
 * dusk sky pushes every channel toward the top of the range, the tone mapper
 * compresses what is left, and the result is a washed neutral — so the
 * checkpoint gates, which are supposed to be the most legible objects on the
 * course, rendered as concrete lifebuoys. An OPAQUE ring with an HDR colour
 * has a definite silhouette against any background, and the bloom pass turns
 * the HDR part into the glow that additive blending was reaching for.
 *
 * On top of that, a travelling pulse. A ring at a constant brightness is a
 * prop; a ring with something moving round it is a machine that is switched
 * on, and it costs one `fract` and two `smoothstep`s.
 *
 * The whole thing is a shader injection on whatever material is already
 * there, so it adds no geometry, no texture and no draw calls.
 */

export const ENERGY_RING_DEFAULTS = {
  // HDR on purpose. The bloom pass thresholds the TONE-MAPPED frame, so a
  // colour at 1.0 rolls back under the knee and does not glow at all.
  glow: [0.55, 2.6, 3.2],
  // Brightness between pulses. Never near zero: these rings are the things a
  // player has to see and steer through, and a mostly-dark ring is a
  // readability regression wearing an art department's clothes.
  base: 0.34,
  pulses: 9,
  speed: 0.42,
  // Fraction of each segment the pulse occupies, and how soft its ends are.
  width: 0.42,
  softness: 0.18,
};

/**
 * @param material    any material whose fragment shader defines outgoingLight
 *                    (Basic, Lambert, Standard — all of them do)
 * @param timeUniform a shared { value } the caller updates once per frame
 */
export function addEnergyRing(material, THREE, timeUniform, options = {}) {
  if (!material || material.userData?.birbEnergyRing) return material;
  const config = { ...ENERGY_RING_DEFAULTS, ...options };
  material.userData = material.userData || {};
  material.userData.birbEnergyRing = true;

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const tag = options.tag || 'energy';

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    shader.uniforms.uRingTime = timeUniform;
    shader.uniforms.uRingGlow = { value: new THREE.Vector3(...config.glow) };
    shader.uniforms.uRingBase = { value: config.base };
    // Pre-divided by 2*PI so the shader turns an angle straight into segments.
    shader.uniforms.uRingCount = { value: config.pulses / (Math.PI * 2) };
    shader.uniforms.uRingSpeed = { value: config.speed };
    shader.uniforms.uRingWidth = { value: config.width };
    shader.uniforms.uRingSoft = { value: config.softness };

    if (!shader.vertexShader.includes('varying vec3 vRingLocal;')) {
      shader.vertexShader = 'varying vec3 vRingLocal;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvRingLocal = position;',
      );
    }
    shader.fragmentShader =
      'uniform float uRingTime; uniform vec3 uRingGlow; uniform float uRingBase;\n'
      + 'uniform float uRingCount; uniform float uRingSpeed;\n'
      + 'uniform float uRingWidth; uniform float uRingSoft;\n'
      + 'varying vec3 vRingLocal;\n'
      + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        // A torus is built in its own XY plane, so this is the angle around
        // the ring however the mesh has since been rotated into place.
        float ringAng = atan(vRingLocal.y, vRingLocal.x);
        float ringCell = fract(ringAng * uRingCount + uRingTime * uRingSpeed);
        float ringPulse =
          smoothstep(0.0, uRingSoft, ringCell)
          * (1.0 - smoothstep(uRingWidth, uRingWidth + uRingSoft, ringCell));
        outgoingLight = uRingGlow * (uRingBase + (1.0 - uRingBase) * ringPulse);
      }

      #include <opaque_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${base}-ring-${tag}`;
  material.needsUpdate = true;
  return material;
}
