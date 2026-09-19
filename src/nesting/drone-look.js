/**
 * What a drone looks like.
 *
 * It shipped as a flat crimson octahedron with a flat pink hoop around it, and
 * from twenty units away that is exactly what it read as: a red kite with a
 * hula hoop. There was nothing mechanical about it, nothing lit, and nothing
 * that said "this thing is hunting you" — which is a problem, because the
 * drone is the only antagonist in three of the five game modes and the player
 * looks straight at it every time.
 *
 * ── All of this is shader-side, and that is the point ───────────────────
 *
 * Drones are individual meshes (they move independently, so they cannot be
 * instanced), and at eight to twelve of them a body plus a ring is already
 * sixteen to twenty-four draw calls out of a hundred. Adding a lens, a second
 * gyro ring and a set of vents as geometry would have doubled that. Deriving
 * them from the fragment's own position on the existing meshes costs nothing
 * at all — no geometry, no textures, no extra calls — which is the same trade
 * the city's windows make.
 *
 * ── The octahedron's edges are free ─────────────────────────────────────
 *
 * A regular octahedron's surface satisfies |x| + |y| + |z| = r, and its twelve
 * edges are exactly where one of those coordinates passes through zero. So
 * `min(|x|, |y|, |z|)` IS the distance to the nearest edge, with no extra
 * attribute, no UV set and no wireframe pass. Glowing seams along the edges
 * turn a solid facet into a panelled shell.
 *
 * Both colours are deliberately HDR — well above 1.0 — because the bloom pass
 * thresholds the TONE-MAPPED frame and anything at 1.0 rolls back under the
 * knee without glowing. See docs/VISUAL_UPGRADE_BUILD_PLAN.md 16.4.
 */

import { addEnergyRing } from '../effects/energy-ring.js';

export const DRONE_LOOK = {
  // Near-black warm carbon. The old body was 0xff3366 — solid saturated
  // crimson — and a shell that is already at full red has nowhere to put a
  // glowing seam: everything reads as one flat colour.
  shell: 0x1c0f14,
  // The light inside it. HDR, so the seams and the band actually bloom.
  glow: [2.3, 0.40, 0.70],
  // The ring is the part seen from furthest away, so it runs hotter.
  ringGlow: [2.4, 0.50, 0.85],
  seamWidth: 0.11,
  bandWidth: 0.055,
  // Sweeps per second for the scanning band, and dashes around the ring.
  sweepRate: 1.55,
  dashes: 9,
  spinRate: 0.42,
};

function chain(material, THREE, key, uniforms, patch) {
  if (!material || material.userData?.[key]) return material;
  material.userData = material.userData || {};
  material.userData[key] = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    patch(shader);
  };
  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${base}-${key}`;
  material.needsUpdate = true;
  return material;
}

/** Shared local-position varying, declared once per shader. */
function addLocalVarying(shader) {
  if (!shader.vertexShader.includes('varying vec3 vDroneLocal;')) {
    shader.vertexShader = 'varying vec3 vDroneLocal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvDroneLocal = position;',
    );
  }
  if (!shader.fragmentShader.includes('varying vec3 vDroneLocal;')) {
    shader.fragmentShader = 'varying vec3 vDroneLocal;\n' + shader.fragmentShader;
  }
}

/**
 * Glowing panel seams and a scanning band on the drone's body.
 *
 * @param timeUniform a shared { value } updated once per frame by the caller
 */
export function addDroneShell(material, THREE, timeUniform, options = {}) {
  const config = { ...DRONE_LOOK, ...options };
  const radius = options.radius || 5.4;
  const uniforms = {
    uDroneTime: timeUniform,
    uDroneRadius: { value: radius },
    uDroneGlow: { value: new THREE.Vector3(...config.glow) },
    uDroneSeam: { value: config.seamWidth },
    uDroneBand: { value: config.bandWidth },
    uDroneSweep: { value: config.sweepRate },
  };
  return chain(material, THREE, 'birbDroneShell', uniforms, (shader) => {
    addLocalVarying(shader);
    shader.fragmentShader =
      'uniform float uDroneTime; uniform float uDroneRadius; uniform vec3 uDroneGlow;\n'
      + 'uniform float uDroneSeam; uniform float uDroneBand; uniform float uDroneSweep;\n'
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 dp = abs(vDroneLocal) / uDroneRadius;
        // On a regular octahedron the twelve edges are exactly where one
        // coordinate passes through zero, so this is the distance to the
        // nearest edge for free.
        float edge = min(min(dp.x, dp.y), dp.z);
        float seam = 1.0 - smoothstep(0.0, uDroneSeam, edge);

        // A band sweeping up and down the body. A machine that is scanning
        // reads as hunting; a machine that is merely lit reads as scenery.
        float sweep = sin(uDroneTime * uDroneSweep) * 0.62;
        float band = 1.0 - smoothstep(0.0, uDroneBand,
          abs(vDroneLocal.y / uDroneRadius - sweep));

        outgoingLight += uDroneGlow * (seam * 0.55 + band * 0.85);
      }

      #include <opaque_fragment>
    `);
  });
}

/**
 * The drone's gyro ring — the shared energy ring in the drone's own colours.
 *
 * It used to have its own copy of this shader. Every ring in the game had the
 * same problem for the same reason (flat colour, additive, under an opacity of
 * one, washing to grey against a bright sky), so the treatment lives in one
 * place now and every call site takes it.
 */
export function addDroneRing(material, THREE, timeUniform, options = {}) {
  const config = { ...DRONE_LOOK, ...options };
  return addEnergyRing(material, THREE, timeUniform, {
    tag: 'drone',
    glow: config.ringGlow,
    base: 0.34,
    pulses: config.dashes,
    speed: config.spinRate,
  });
}
