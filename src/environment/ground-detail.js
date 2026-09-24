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
 * Optional authored-texture overlay for the ground, projected TRIPLANAR off
 * the world position — the planet's own UVs run once around the sphere and
 * converge at the poles, so there is no seam-free UV to tile a texture on.
 * Triplanar has no pole singularity and needs no attribute.
 *
 * Blending is by the SPHERE normal (`gdUp`), not the facet normal (`gdN`):
 * `gdN` is constant per triangle, so blending by it would snap the projection
 * at every triangle edge that straddles the 45-degree crossover and the seam
 * would show up in the mesh itself. `gdUp` varies per fragment for free.
 * `uGroundFacet` (default 0, i.e. fully sphere-normal) exists as an A/B knob
 * only — nobody has looked at facet-blended output yet.
 *
 * The three projections are weighted by `pow(|N|, sharpness)`, RENORMALISED
 * to sum to 1. That normalisation is load-bearing: a weighted average of three
 * samples of the same texture has the texture's own mean only if the weights
 * sum to 1, and mean-preservation is the entire point of `uGroundGain`
 * (1 / the file's measured linear mean, so `mean(sample * gain) == 1` by
 * construction — the map can only add structure, never shift the ground's
 * hue or value).
 *
 * `uGroundMix` is driven from a decode gate (see authored-textures.js's
 * `commitWhenDecoded`) and starts at 0, so a texture bound but not yet
 * decoded contributes `mix(1, ..., 0) == 1` — bit-identical to the map being
 * absent. That is what stands in for the black-slab guard here: this module
 * never touches `map`, so there is no "TextureLoader returned an object with
 * an empty `image`" moment to protect against directly, but the same shape of
 * bug (switching a sampler on before its upload lands) is closed the same way.
 *
 * `smooth` is the 2026-09-13 organic pass and it changes TWO things, not one.
 * The obvious half is that the material stops flat-shading. The half that is
 * easy to miss: the slope term below — which decides soil against rock, and
 * with it every material boundary this shader draws — was deliberately taken
 * from the FACET normal, on the reasoning that it "agrees with the visible
 * faceting". Once the visible surface is lit per fragment that reasoning
 * inverts. A boundary that is constant per triangle, painted across a surface
 * whose lighting is not, snaps at every triangle edge: hard-edged blotches on
 * a soft hill. So the slope switches to the smooth normal with the shading.
 *
 * The facet normal does not go away — it becomes the thing the LIGHTING
 * normal is blended back toward wherever that slope says rock. That is the
 * whole of "smooth soil, pointy rocks": one mesh, one draw call, soil rolling
 * and rock faces fracturing, with the transition following the material
 * boundary the shader was already drawing.
 *
 * @param material   the terrain mesh's material (Lambert)
 * @param biome      key into GROUND_PROFILES; anything else is a no-op
 * @param smooth     shade soil smoothly and keep facets on rock (see above).
 *                    False emits EXACTLY the shader this module always has —
 *                    same injections, same slope source, same cache key — so
 *                    `?smooth=0` is a true before, not an approximation of it.
 * @param groundMap  optional { tile, sharpness, gain: {r,g,b} }. Omitted (the
 *                    default), this function emits exactly the shader it
 *                    always has — no sampler declared, no fetches, no dead
 *                    branch — so every biome and every existing caller is
 *                    byte-for-byte unchanged. Passed, and only for a truthy
 *                    call, every field is required: this throws rather than
 *                    defaults a missing one, the same contract
 *                    `addInstancedUvScale` uses for an unknown geometry shape.
 * @param wetMap     optional { texture, tint: [r,g,b], damp: [r,g,b],
 *                    strength, core?: [lo, hi] } — the erosion's drainage
 *                    (src/environment/erosion.js, `?erosion=1`) as an
 *                    equirect byte map in the horizon map's convention (u =
 *                    atan(z, -x) / 2PI, v = acos(y) / PI), read per fragment:
 *                    the banks multiply toward `damp` with the wetness, the
 *                    stream core — wetness between `core` lo and hi — toward
 *                    `tint`. Same contract as groundMap — omitted, the shader
 *                    and cache key are byte-for-byte what they were; passed,
 *                    every field but `core` is required.
 */
export function addGroundDetail(material, THREE, { baseRadius = 120, biome, groundMap = null, smooth = false, bump = 0.0, wetMap = null } = {}) {
  const profile = GROUND_PROFILES[biome];
  // The city's ground already carries a street grid and asphalt; mottling it
  // would fight the one thing that identifies it.
  if (!material || !profile || material.userData?.birbGroundDetail) return material;
  if (groundMap) {
    for (const field of ['tile', 'sharpness', 'gain']) {
      if (groundMap[field] === undefined) {
        throw new Error(`addGroundDetail: groundMap.${field} is required when groundMap is passed`);
      }
    }
  }
  if (wetMap) {
    for (const field of ['texture', 'tint', 'damp', 'strength']) {
      if (wetMap[field] === undefined || wetMap[field] === null) {
        throw new Error(`addGroundDetail: wetMap.${field} is required when wetMap is passed`);
      }
    }
  }
  // In the closure for the same reason texUniforms are: one object shared
  // by every compile of this material.
  const wetCore = wetMap && Array.isArray(wetMap.core) ? wetMap.core : [0.5, 0.8];
  const wetUniforms = wetMap ? {
    uGdWetMap: { value: wetMap.texture },
    uGdWet: { value: new THREE.Vector4(wetMap.tint[0], wetMap.tint[1], wetMap.tint[2], wetMap.strength) },
    uGdWetDamp: { value: new THREE.Vector3(wetMap.damp[0], wetMap.damp[1], wetMap.damp[2]) },
    uGdWetCore: { value: new THREE.Vector2(wetCore[0], wetCore[1]) },
  } : null;
  material.userData = material.userData || {};
  material.userData.birbGroundDetail = true;
  // Live A/B: strength 0 is the ground without the wetness, same program.
  if (wetUniforms) material.userData.birbGroundWetUniforms = wetUniforms;

  // Created here, in the closure, so the loader can raise uGroundMix at any
  // time — before or after the material's first compile, which is when
  // onBeforeCompile actually runs — with no needsUpdate and no recompile.
  // Assigned into shader.uniforms (the same object, not a copy) below.
  const texUniforms = groundMap ? {
    uGroundMap: { value: null },
    uGroundTile: { value: groundMap.tile },
    uGroundSharp: { value: groundMap.sharpness },
    uGroundFacet: { value: 0.0 },
    uGroundGain: { value: new THREE.Vector3(groundMap.gain.r, groundMap.gain.g, groundMap.gain.b) },
    uGroundMix: { value: 0.0 },
    // Bump strength. Live only on the smooth path: perturbing a normal that
    // is about to be replaced by its own facet normal changes nothing.
    uGroundBump: { value: smooth ? bump : 0.0 },
  } : null;
  if (texUniforms) material.userData.birbGroundTexUniforms = texUniforms;

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
    if (texUniforms) Object.assign(shader.uniforms, texUniforms);
    if (wetUniforms) Object.assign(shader.uniforms, wetUniforms);

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

    // Smooth path only: take the slope from the smooth normal and bend the
    // LIGHTING normal back toward the facet on rock. This has to happen at
    // <normal_fragment_begin> — `normal` is folded into the lighting long
    // before <opaque_fragment>, so the tint block below cannot do it. The
    // two values it computes are declared in main()'s scope, which is where
    // <normal_fragment_begin> sits, so the tint block reads them for free.
    //
    // Derived in WORLD space off vBirbWorld rather than from vViewPosition:
    // the varying is already here for the tint, and it costs this injection
    // no assumption about which varyings the material happens to carry.
    if (smooth) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
      #include <normal_fragment_begin>
      vec3 gdUpW = normalize(vBirbWorld);
      vec3 gdFacetW = normalize(cross(dFdx(vBirbWorld), dFdy(vBirbWorld)));
      if (dot(gdFacetW, gdUpW) < 0.0) gdFacetW = -gdFacetW;
      // Read BEFORE the blend below overwrites it, or the slope measures its
      // own output and the rock term runs away with itself.
      vec3 gdSmoothW = inverseTransformDirection(normal, viewMatrix);
      float gdShadeSlope = 1.0 - clamp(dot(gdSmoothW, gdUpW), 0.0, 1.0);
      vec3 gdShadeW = gdSmoothW;
` + (texUniforms ? `
      // The triplanar sample, HOISTED out of the tint block below so the
      // bump and the colour share ONE set of fetches. Still three, exactly
      // as before this existed.
      vec3 gtN0 = normalize(mix(gdUpW, gdFacetW, uGroundFacet));
      vec3 gtW0 = pow(abs(gtN0), vec3(uGroundSharp));
      gtW0 /= max(gtW0.x + gtW0.y + gtW0.z, 1e-4);
      vec3 gdTex = texture2D(uGroundMap, vBirbWorld.zy / uGroundTile).rgb * gtW0.x
            + texture2D(uGroundMap, vBirbWorld.xz / uGroundTile).rgb * gtW0.y
            + texture2D(uGroundMap, vBirbWorld.xy / uGroundTile).rgb * gtW0.z;

      // The soil albedo's own luminance IS a height field, and its
      // screen-space gradient is that field's slope — so relief costs no
      // normal map and no extra fetch. Same construction as three's
      // perturbNormalArb, done in world space because everything else here
      // already is.
      //
      // Faded with view distance: at altitude one texel spans less than a
      // pixel and an unfaded bump is just aliasing that crawls when the
      // camera moves. It is a PERCH effect — a grazing camera three units
      // off the ground, where the soil otherwise reads as a photograph laid
      // flat — and it should be gone before it can shimmer.
      if (uGroundBump > 0.0) {
        float gdH = dot(gdTex, vec3(0.299, 0.587, 0.114));
        vec3 gdSX = dFdx(vBirbWorld);
        vec3 gdSY = dFdy(vBirbWorld);
        vec3 gdR1 = cross(gdSY, gdShadeW);
        vec3 gdR2 = cross(gdShadeW, gdSX);
        float gdDet = dot(gdSX, gdR1);
        // Solved, not picked. Wanted ~5 units of effective strength at a
        // perch (4 units) and ~1 by ordinary flight altitude (25): the ratio
        // fixes the rate at ln(5)/21 = 0.077, and the strength follows.
        float gdFade = exp(-length(cameraPosition - vBirbWorld) * 0.08);
        vec3 gdGrad = sign(gdDet) * (dFdx(gdH) * gdR1 + dFdy(gdH) * gdR2);
        gdShadeW = normalize(abs(gdDet) * gdShadeW - gdGrad * uGroundBump * gdFade);
      }
` : ``) + `
      gdShadeW = normalize(mix(gdShadeW, gdFacetW,
        smoothstep(uGdSlopeRange.x, uGdSlopeRange.y, gdShadeSlope)));
      normal = normalize((viewMatrix * vec4(gdShadeW, 0.0)).xyz);
      `);
    }

    shader.fragmentShader =
      'uniform float uGdBase; uniform float uGdScale;\n'
      + 'uniform vec3 uGdMoss; uniform vec3 uGdSoil; uniform vec3 uGdSlope;\n'
      + 'uniform vec2 uGdSlopeRange; uniform vec3 uGdDamp;\n'
      + 'uniform float uGdDampDepth; uniform vec2 uGdDetail; uniform vec2 uGdBand;\n'
      + (texUniforms
        ? 'uniform sampler2D uGroundMap; uniform float uGroundTile; uniform float uGroundSharp;\n'
          + 'uniform float uGroundFacet; uniform vec3 uGroundGain; uniform float uGroundMix;\n'
          + 'uniform float uGroundBump;\n'
        : '')
      + (wetUniforms ? 'uniform sampler2D uGdWetMap; uniform vec4 uGdWet; uniform vec3 uGdWetDamp; uniform vec2 uGdWetCore;\n' : '')
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
` + (smooth ? `
        // Both already computed at <normal_fragment_begin>, from the SMOOTH
        // normal — see the module doc for why the facet normal is the wrong
        // slope source the moment the surface is lit per fragment.
        vec3 gdN = gdFacetW;
        float gdSlope = gdShadeSlope;
` : `
        // The FACET normal, from the interpolated world position. Free, and
        // exactly right for flat-shaded low-poly ground: no attribute, no
        // tangent frame, and it agrees with the visible faceting rather than
        // with a smoothed vertex normal that does not.
        vec3 gdN = normalize(cross(dFdx(gdP), dFdy(gdP)));
        if (dot(gdN, gdUp) < 0.0) gdN = -gdN;
        float gdSlope = 1.0 - clamp(dot(gdN, gdUp), 0.0, 1.0);
`) + `
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
` + (texUniforms && smooth ? `
        // Already fetched at <normal_fragment_begin>, where the bump needed
        // it. Three fetches for the frame, not six.
        gdTint *= mix(vec3(1.0), gdTex * uGroundGain, uGroundMix);
` : texUniforms ? `
        // Authored ground overlay, triplanar off world position. See the
        // function doc comment above for why sphere-normal blending, why the
        // weights are renormalised, and why uGroundMix (not a clamp) is what
        // keeps this at the file's own mean.
        vec3 gtN = normalize(mix(gdUp, gdN, uGroundFacet));
        vec3 gtW = pow(abs(gtN), vec3(uGroundSharp));
        gtW /= max(gtW.x + gtW.y + gtW.z, 1e-4);
        vec2 gtUvX = gdP.zy / uGroundTile;
        vec2 gtUvY = gdP.xz / uGroundTile;
        vec2 gtUvZ = gdP.xy / uGroundTile;
        // texture2D returns LINEAR here: SRGBColorSpace decodes in hardware
        // (the texture's internal format), not in map_fragment, so this is
        // correct for any sampler, not only the map slot. gdTint is already
        // linear, so the two multiply directly with no extra conversion.
        vec3 gtTex = texture2D(uGroundMap, gtUvX).rgb * gtW.x
                   + texture2D(uGroundMap, gtUvY).rgb * gtW.y
                   + texture2D(uGroundMap, gtUvZ).rgb * gtW.z;
        gdTint *= mix(vec3(1.0), gtTex * uGroundGain, uGroundMix);
` : '') + (wetUniforms ? `
        // Where the water runs (erosion.js). The drainage is finer than the
        // mesh, so it is read here, per fragment, off the fragment's own
        // direction — the horizon map's equirect convention exactly. Two
        // readings of one field: the whole of it darkens the banks toward
        // damp ground, and only its upper part — cut crisp, so it is a line
        // and not a smudge — is the stream itself, which therefore widens
        // downstream exactly as the drainage grows.
        float gdWet = texture2D(uGdWetMap, vec2(atan(gdUp.z, -gdUp.x) * 0.15915494,
          acos(clamp(gdUp.y, -1.0, 1.0)) * 0.31830989)).r;
        gdTint = mix(gdTint, gdTint * uGdWetDamp, gdWet * uGdWet.w);
        gdTint = mix(gdTint, gdTint * uGdWet.rgb, smoothstep(uGdWetCore.x, uGdWetCore.y, gdWet) * uGdWet.w);
` : '') + `
        outgoingLight *= gdTint;
      }

      #include <opaque_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () =>
    `${base}-ground-${biome}${texUniforms ? '-tex' : ''}${smooth ? '-smooth' : ''}${smooth && bump > 0 ? '-bump' : ''}${wetUniforms ? '-wet' : ''}`;
  material.needsUpdate = true;
  return material;
}
