/**
 * What the ground is made of.
 *
 * The four-biome contact sheet makes the case on its own: the city, which got
 * a legibility pass (lit windows, a street grid), is far and away the best
 * frame on it, and the other three are one flat colour each. The forest is a
 * plain olive field, the canyons are a smooth orange dome and the mountain is
 * a uniform pale blue-grey — and the forest is the DEFAULT biome, so it is the
 * first thing anyone ever sees.
 *
 * The ground is also, by a long way, the largest thing on screen. Every other
 * item on the visual roadmap improves something occupying a tenth of the
 * frame. This one improves half of it.
 *
 * ── The geometric normal is free, and it is the whole trick ─────────────
 *
 * `normalize(cross(dFdx(P), dFdy(P)))` on the interpolated world position is
 * the FACET normal, which suits a flat-shaded low-poly terrain exactly: it
 * costs two derivatives and a cross product, needs no attribute, and gives a
 * clean per-face slope. Snow that lies on the flats and not on the faces,
 * sand that collects in the basins and not on the walls, soil that shows
 * through where the hill is steep — all of that is one `smoothstep` away once
 * you have the slope, with no texture and no extra draw call.
 *
 * Only the forest needs actual noise, and one octave of it. Two things follow
 * from that: this stays cheap enough for a phone's fill rate, and there is no
 * octave stack to tune.
 *
 * ── outgoingLight, not diffuseColor ─────────────────────────────────────
 *
 * By the time `<opaque_fragment>` runs, Lambert has already folded
 * `diffuseColor` into the lighting, so writing to it there changes nothing at
 * all — which is exactly how the city's street grid shipped invisible the
 * first time (docs/VISUAL_UPGRADE_BUILD_PLAN.md 16.13). This tints
 * `outgoingLight`, so it modulates the LIT result and keeps the light rig's
 * shaping instead of flattening it.
 *
 * ── Tints multiply, they never add ──────────────────────────────────────
 *
 * A flat additive term lifts a dark material far more than a bright one, which
 * is how a sun rim once turned the city's asphalt into snow. Everything here
 * is a multiply against a mean of about 1.0, so a face keeps its exposure and
 * only its hue and value shift.
 */

/** Per-biome ground character. All multiplicative tints, mean ~1. */
export const GROUND_PROFILES = {
  forest: {
    // Mottled moss and soil. The world position is in units and the planet is
    // radius 120, so a cell is 1/scale units across: 0.055 gives patches about
    // 18 units wide, which is a couple of ground facets and a few tree
    // spacings — big enough to read from the air, small enough that a low pass
    // still shows several.
    noiseScale: 0.055,
    // Contrast between the two has to be REAL. The first pass used tints
    // about 0.1 apart in every channel and the result was a soft gradient
    // across the whole field rather than ground with anything on it — the
    // effect was measurably present and visually absent.
    mossTint: [0.72, 1.18, 0.68],
    soilTint: [1.26, 0.92, 0.62],
    // Steep ground sheds its litter and shows dirt.
    slopeTint: [1.24, 0.90, 0.64],
    slopeStart: 0.10, slopeEnd: 0.42,
    // Valleys are damper and darker than the ridges above them.
    dampTint: [0.78, 0.94, 0.84],
    dampDepth: 26,
    // Second, finer noise cell, as a fraction of the first. Undergrowth inside
    // a clearing; without it the macro patches read as painted shapes.
    detailScale: 4.5,
    detail: 0.16,
    band: 0, bandScale: 0,
  },
  canyons: {
    // Sand gathers in the basins, rock shows on the walls — and, crucially,
    // the sediment BANDS run all the way across the ground, not only down the
    // cliff faces. addAtmosphere already bands the walls by radius, but a
    // canyon floor is nearly level, so its radius barely changes across a
    // whole view and not one band ever appeared on it. The first capture with
    // ground detail on still read as a smooth orange dome for exactly that
    // reason. Banding the ground too turns the plateau into exposed strata
    // seen from above, which is what a canyon country actually looks like.
    noiseScale: 0.09,
    mossTint: [1.16, 1.00, 0.82],
    soilTint: [0.94, 0.84, 0.76],
    slopeTint: [0.72, 0.58, 0.52],
    slopeStart: 0.12, slopeEnd: 0.44,
    dampTint: [1.18, 1.08, 0.90],
    dampDepth: 34,
    detailScale: 3.2,
    detail: 0.10,
    // Amplitude, and radians of phase per world unit of radius: 0.9 is a band
    // every ~7 units, which is one or two ground facets thick.
    band: 0.13, bandScale: 0.9,
  },
  mountain: {
    // The big one. A mountain lit as one pale mass has no mountain in it; the
    // shape only appears when snow lies on what is flat and rock shows on what
    // is steep. `slopeStart` is deliberately early — on a 96x64 mobile ground
    // mesh a genuinely vertical face is rare, so waiting for one means the
    // rock never appears.
    noiseScale: 0.07,
    mossTint: [1.02, 1.04, 1.08],
    soilTint: [0.94, 0.96, 1.02],
    slopeTint: [0.58, 0.60, 0.68],
    slopeStart: 0.07, slopeEnd: 0.34,
    dampTint: [0.82, 0.86, 0.96],
    dampDepth: 30,
    detailScale: 4.0,
    detail: 0.12,
    // A little banding reads as strata in the exposed rock.
    band: 0.06, bandScale: 0.55,
  },
};

/**
 * @param material   the terrain mesh's material (Lambert, flat-shaded)
 * @param biome      key into GROUND_PROFILES; anything else is a no-op
 */
export function addGroundDetail(material, THREE, { baseRadius = 120, biome } = {}) {
  const profile = GROUND_PROFILES[biome];
  // The city's ground already carries a street grid and asphalt; mottling it
  // would fight the one thing that identifies it.
  if (!material || !profile || material.userData?.birbGroundDetail) return material;
  material.userData = material.userData || {};
  material.userData.birbGroundDetail = true;

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);

    shader.uniforms.uGdBase = { value: baseRadius };
    shader.uniforms.uGdScale = { value: profile.noiseScale };
    shader.uniforms.uGdMoss = { value: new THREE.Vector3(...profile.mossTint) };
    shader.uniforms.uGdSoil = { value: new THREE.Vector3(...profile.soilTint) };
    shader.uniforms.uGdSlope = { value: new THREE.Vector3(...profile.slopeTint) };
    shader.uniforms.uGdSlopeRange = { value: new THREE.Vector2(profile.slopeStart, profile.slopeEnd) };
    shader.uniforms.uGdDamp = { value: new THREE.Vector3(...profile.dampTint) };
    shader.uniforms.uGdDampDepth = { value: profile.dampDepth };
    shader.uniforms.uGdDetail = { value: new THREE.Vector2(profile.detailScale, profile.detail) };
    shader.uniforms.uGdBand = { value: new THREE.Vector2(profile.band, profile.bandScale) };

    // Shared with addAtmosphere and the city's street grid; whichever runs
    // first declares it. Declared twice the shader does not compile, Three
    // draws nothing, and the entire ground disappears — which has happened.
    if (!shader.vertexShader.includes('varying vec3 vBirbWorld;')) {
      shader.vertexShader = 'varying vec3 vBirbWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvBirbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    }
    if (!shader.fragmentShader.includes('varying vec3 vBirbWorld;')) {
      shader.fragmentShader = 'varying vec3 vBirbWorld;\n' + shader.fragmentShader;
    }

    shader.fragmentShader =
      'uniform float uGdBase; uniform float uGdScale;\n'
      + 'uniform vec3 uGdMoss; uniform vec3 uGdSoil; uniform vec3 uGdSlope;\n'
      + 'uniform vec2 uGdSlopeRange; uniform vec3 uGdDamp;\n'
      + 'uniform float uGdDampDepth; uniform vec2 uGdDetail; uniform vec2 uGdBand;\n'
      + `
      float gdHash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      // One octave of 3D value noise. One is enough: the slope term below
      // carries the structure, and the noise only has to break up the flat
      // facets. A stack of octaves here is fill-rate spent on a phone for a
      // difference nobody sees at flight altitude.
      float gdNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = gdHash(i + vec3(0.0, 0.0, 0.0));
        float n100 = gdHash(i + vec3(1.0, 0.0, 0.0));
        float n010 = gdHash(i + vec3(0.0, 1.0, 0.0));
        float n110 = gdHash(i + vec3(1.0, 1.0, 0.0));
        float n001 = gdHash(i + vec3(0.0, 0.0, 1.0));
        float n101 = gdHash(i + vec3(1.0, 0.0, 1.0));
        float n011 = gdHash(i + vec3(0.0, 1.0, 1.0));
        float n111 = gdHash(i + vec3(1.0, 1.0, 1.0));
        return mix(
          mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
          mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
          f.z);
      }
      `
      + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 gdP = vBirbWorld;
        vec3 gdUp = normalize(gdP);

        // The FACET normal, from the interpolated world position. Free, and
        // exactly right for flat-shaded low-poly ground: no attribute, no
        // tangent frame, and it agrees with the visible faceting rather than
        // with a smoothed vertex normal that does not.
        vec3 gdN = normalize(cross(dFdx(gdP), dFdy(gdP)));
        if (dot(gdN, gdUp) < 0.0) gdN = -gdN;
        float gdSlope = 1.0 - clamp(dot(gdN, gdUp), 0.0, 1.0);

        // Macro patches, plus a finer cell mixed in. Two calls, not an octave
        // stack: the slope term below carries the structure and the noise only
        // has to break up the facets, so a third octave is fill rate spent on
        // a phone for a difference nobody sees at flight altitude.
        float gdM = gdNoise(gdP * uGdScale);
        gdM = mix(gdM, gdNoise(gdP * uGdScale * uGdDetail.x), uGdDetail.y);
        vec3 gdTint = mix(uGdSoil, uGdMoss, smoothstep(0.32, 0.70, gdM));

        // Steep ground sheds whatever lies on it. On the mountain this IS the
        // mountain: rock on the faces, snow on the flats.
        gdTint = mix(gdTint, uGdSlope,
          smoothstep(uGdSlopeRange.x, uGdSlopeRange.y, gdSlope));

        // Depth below the base radius. The terrain only ever carves DOWNWARD
        // (the gravity-less-floor invariant), so this is >= 0 everywhere and
        // reads straight as "how deep in the valley am I".
        float gdDepth = max(0.0, uGdBase - length(gdP));
        gdTint = mix(gdTint, gdTint * uGdDamp,
          smoothstep(0.0, uGdDampDepth, gdDepth));

        // Sediment banding by RADIUS, so the layers stay level everywhere on
        // the planet — the same reason the canyon walls band by radius rather
        // than by height above a local ground plane.
        if (uGdBand.x > 0.0) {
          float gdR = length(gdP);
          float gdBand = sin(gdR * uGdBand.y) * 0.68 + sin(gdR * uGdBand.y * 2.37 + 1.7) * 0.32;
          gdTint *= 1.0 + gdBand * uGdBand.x;
        }

        outgoingLight *= gdTint;
      }

      #include <opaque_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${base}-ground-${biome}`;
  material.needsUpdate = true;
  return material;
}
