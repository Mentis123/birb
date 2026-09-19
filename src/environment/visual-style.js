// Shared, bounded WebGL art tools. THREE is injected to keep geometry testable
// in Node without changing the game's pinned CDN dependency.
export const visualUniforms = {
  time: { value: 0 },
  wind: { value: 1 },
  // Colour the valley mist takes. Set per environment from the sky's own mid
  // tone — grey mist in a golden world reads as fog on a camera lens, not as
  // air. Mutated in place so every material shares one uniform object.
  mistColor: { value: null },
  // 0 disables cloud shadows and mist without recompiling anything.
  atmosphere: { value: 1 },
  // The key light's direction and colour, shared by every ground material so
  // the terrain's sun rim tracks the same sun as the sky disc and the water
  // glint. Set once per frame from the lighting rig; null until then, and the
  // shader term is inert while it is.
  sunDir: { value: null },
  sunColor: { value: null },
};

/**
 * Atmosphere: drifting cloud shadows, valley mist, macro tint variation.
 *
 * The most expensive-looking thing you can do to a stylised world is also one
 * of the cheapest: large, slow, low-frequency variation in VALUE across the
 * ground. Real outdoor space is never uniformly lit, and a flat-shaded world
 * with one directional light is uniformly lit everywhere the sun reaches.
 *
 * Three terms, one fragment injection, no extra pass and no extra draw call:
 *
 *  - Cloud shadows. A slow-scrolling noise multiplied into the outgoing light.
 *    This is the single biggest one, because it puts the whole world in MOTION
 *    without moving a vertex, and motion is what the eye reads as alive.
 *  - Valley mist. Fog is one global density, so the carved valleys — 24 to 46
 *    units deep — have exactly the same air in them as the ridge tops. Adding
 *    depth-driven mist below the base radius is aerial perspective, which is
 *    the strongest depth cue there is at this scale.
 *  - Macro tint. A very low-amplitude hue drift so a large flat surface is
 *    never one colour across the whole screen.
 *
 * Chains onto any existing onBeforeCompile (the canopies already carry the
 * wind injection) rather than replacing it.
 */
export function addAtmosphere(material, THREE, {
  baseRadius = 120, cloudStrength = 0.42, sunRim = 1.5, strata = 0,
} = {}) {
  if (!material || material.userData.birbAtmosphere) return material;
  material.userData.birbAtmosphere = true;
  if (!visualUniforms.mistColor.value) visualUniforms.mistColor.value = new THREE.Color(0x9fb8bd);
  // Inert defaults, so a material compiled before the first frame does not
  // sample a null uniform.
  if (!visualUniforms.sunDir.value) visualUniforms.sunDir.value = new THREE.Vector3(0, 1, 0);
  if (!visualUniforms.sunColor.value) visualUniforms.sunColor.value = new THREE.Color(0, 0, 0);

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);

    shader.uniforms.uBirbTime = visualUniforms.time;
    shader.uniforms.uBirbMist = visualUniforms.mistColor;
    shader.uniforms.uBirbAtmos = visualUniforms.atmosphere;
    shader.uniforms.uBirbBase = { value: baseRadius };
    shader.uniforms.uBirbCloud = { value: cloudStrength };
    shader.uniforms.uBirbSun = visualUniforms.sunDir;
    shader.uniforms.uBirbSunColor = visualUniforms.sunColor;
    shader.uniforms.uBirbSunRim = { value: sunRim };
    shader.uniforms.uBirbStrata = { value: strata };

    // One shared, fully guarded injection — see ensureWorldVarying.
    ensureWorldVarying(shader);

    shader.fragmentShader =
      'uniform float uBirbTime; uniform vec3 uBirbMist; uniform float uBirbAtmos;\n'
      + 'uniform float uBirbBase; uniform float uBirbCloud;\n'
      + 'uniform vec3 uBirbSun; uniform vec3 uBirbSunColor; uniform float uBirbSunRim;\n'
      + 'uniform float uBirbStrata;\n'
      + (shader.fragmentShader.includes('varying vec3 vBirbWorld;') ? '' : 'varying vec3 vBirbWorld;\n')
      + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // ── Cloud shadows ────────────────────────────────────────────────
      // Two crossed sine fields at different scales and drift rates. Cheaper
      // than value noise and, at this size on screen, indistinguishable from
      // it: what matters is that the pattern is large, soft and never repeats
      // visibly within one view. Sampled in 3D world space so it wraps around
      // the planet without seams and needs no UV parameterisation.
      vec3 cp = vBirbWorld * 0.0135;
      float drift = uBirbTime * 0.021;
      float c1 = sin(cp.x + drift) * sin(cp.z * 1.17 - drift * 0.8) * sin(cp.y * 0.83);
      float c2 = sin(cp.x * 2.3 - drift * 1.4) * sin(cp.z * 1.9 + drift) ;
      float clouds = smoothstep(-0.15, 0.55, c1 * 0.65 + c2 * 0.35);
      outgoingLight *= mix(1.0, 1.0 - uBirbCloud, clouds * uBirbAtmos);

      // ── Macro tint ───────────────────────────────────────────────────
      float macro = sin(vBirbWorld.x * 0.037) * sin(vBirbWorld.z * 0.041) * sin(vBirbWorld.y * 0.033);
      outgoingLight *= 1.0 + macro * 0.05 * uBirbAtmos;

      // ── Sun rim ──────────────────────────────────────────────────────
      // MeshLambert has no specular term at ALL, which is why this world
      // looked identical at noon and at golden hour: the only thing the sun
      // did was set a diffuse level. Real ground does not behave like that —
      // grass, snow and rock all scatter light forward at grazing angles, and
      // the low sun catching the edge of a hill is most of what "golden hour"
      // actually looks like.
      //
      // Two terms multiplied: how much the surface faces the sun, and how
      // close to edge-on the eye sees it. Facing alone just brightens the lit
      // side (which the diffuse already did); the grazing factor is what puts
      // the light on the RIM, where it reads.
      //
      // The view-space normal is rotated back to world by multiplying on the
      // right — for a rotation that is the transpose, which is the inverse.
      vec3 birbWorldN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      vec3 birbToEye = normalize(cameraPosition - vBirbWorld);
      float birbFacesSun = max(0.0, dot(birbWorldN, normalize(uBirbSun)));
      float birbGrazing = pow(1.0 - abs(dot(birbWorldN, birbToEye)), 4.0);
      // Tinted by the surface's OWN colour, and that is not a stylistic
      // choice. A flat additive term lifts a dark material far more than a
      // bright one, in absolute terms and even more in relative ones — the
      // city's asphalt is 0.09 in linear, so an unqualified 0.07 of warm
      // light nearly doubled it and turned every street into pale snow.
      // Scaling by the albedo makes this forward scatter THROUGH the surface,
      // which is what it is meant to be: bright ground catches the low sun,
      // dark ground stays dark.
      outgoingLight += diffuseColor.rgb * uBirbSunColor
        * (birbFacesSun * birbGrazing * uBirbSunRim * uBirbAtmos);

      // ── Rock strata ──────────────────────────────────────────────────
      // Canyons only. A canyon is not a canyon because of its shape — plenty
      // of terrain is steep — it is a canyon because you can read the layers
      // in the rock, and this world's walls were one flat colour from rim to
      // floor. Bands follow the RADIUS, so they are level surfaces of constant
      // altitude and stay horizontal across every wall no matter which way it
      // faces, which is what makes sedimentary rock look deposited rather than
      // painted on. Two long-wavelength sines wobble them so they are not a
      // ruled grating.
      if (uBirbStrata > 0.0) {
        float bandY = length(vBirbWorld)
          + sin(vBirbWorld.x * 0.052) * 1.9
          + sin(vBirbWorld.z * 0.044) * 1.6;
        float band = sin(bandY * 0.62) * 0.62 + sin(bandY * 1.73) * 0.38;
        outgoingLight *= 1.0 + band * uBirbStrata * uBirbAtmos;
      }

      // ── Valley mist ──────────────────────────────────────────────────
      // Terrain carves DOWNWARD only (see spherical-world.js), so depth below
      // the base radius is exactly "how far into a valley this fragment is".
      //
      // But depth ALONE is not aerial perspective, and the first version got
      // this wrong in a way that was obvious the moment it rendered: the bird
      // spends most of its time inside a valley, so every tree beside it was
      // fully misted and the near field washed out to flat grey-green. Air
      // only accumulates over DISTANCE. Both factors, multiplied: how deep
      // the fragment sits, and how much air is between it and the eye.
      float below = max(0.0, uBirbBase - length(vBirbWorld));
      float depthFactor = 1.0 - exp(-below * 0.045);
      float viewDist = length(cameraPosition - vBirbWorld);
      float distFactor = 1.0 - exp(-viewDist * 0.022);
      // Pulled back from 0.70/0.72. Aerial perspective should place things in
      // depth, not erase them: at the old strength the mid-distance of every
      // biome went to a flat wash, and a nest view — which is nothing BUT
      // mid-distance — lost its whole subject.
      float mist = depthFactor * distFactor * 0.58 * uBirbAtmos;
      outgoingLight = mix(outgoingLight, uBirbMist, clamp(mist, 0.0, 0.56));

      #include <opaque_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => base + '-atmos-v6';
  return material;
}

/**
 * Smooth shading, the shipping default since 2026-09-13. `?smooth=0` restores
 * the flat-shaded world for the A/B.
 *
 * `flatShading` is a MATERIAL property and this world had it on thirty-four
 * materials, as if it were a rendering mode rather than a per-surface choice.
 * The ground mesh has carried correct smooth normals the whole time —
 * `displaceSphereGeometry` calls `computeVertexNormals()` and the material
 * threw the result away every frame. Soft materials (soil, foliage, snow,
 * cloud) shade smooth now; crystalline ones (rock, boulder, scree, spire,
 * peak, cliff, building) keep their facets, which is the one place low-poly
 * reads as a material rather than as a budget.
 *
 * The escape hatch stays for the same reason `?bark=0` and `?skytex=0` do: a
 * comparison you cannot re-run is one nobody re-runs.
 */
export function smoothShadingRequested(search) {
  return !/[?&]smooth=0/.test(search || '');
}

/**
 * A small random lean for a decorative tree, as radians about its OWN local X
 * and Z (local +Y is the trunk axis, before it is stood up on the sphere).
 *
 * Every tree in this world was oriented `setFromUnitVectors(defaultUp, up)` —
 * exactly radial, plumb to the planet, all 294 of them. That is what makes a
 * forest read as planted rather than grown.
 *
 * NULL for a nest host, and that is load-bearing: a nest is placed radially
 * above the trunk base at `(trunkHeight + canopyHeight * 0.9) * scale`, so
 * tilting a champion walks its own perch out of its crown. Three degrees on a
 * 40-unit tree is ~2 units of lateral drift — well inside an 8-16 unit canopy
 * collider, so the colliders do not move, but the perch would.
 *
 * Two draws from `rng`, always the same two, so a caller's seeded stream
 * advances identically whether or not the tree ends up leaning.
 */
export function treeLean(rng, isNestHost) {
  if (isNestHost) return null;
  const angle = 0.017 + rng() * 0.035;    // 1-3 degrees
  const bearing = rng() * Math.PI * 2;
  return { x: Math.cos(bearing) * angle, z: Math.sin(bearing) * angle };
}

/**
 * Independent per-axis proportions for a scattered rock, and how far to sink
 * it. Every rock, boulder and scree chip in this world was a REGULAR solid at
 * a uniform scale under a random rotation — which is a die, and a die at any
 * orientation is still a die. Three axes drawn separately give each one its
 * own shape; burying the base makes it something the ground has grown around
 * rather than something resting on a tablecloth.
 *
 * `max` is the longest half-axis. A caller whose collider radius was the exact
 * uniform extent must use it, or the long axis now escapes its own collider.
 */
export function rockShape(rng, s) {
  const x = s * (0.72 + rng() * 0.58);
  const y = s * (0.60 + rng() * 0.42);
  const z = s * (0.72 + rng() * 0.58);
  return { x, y, z, max: Math.max(x, y, z), sink: s * 0.30 };
}

export function createCanopyGeometry(THREE, kind = 0) {
  // All variants retain the old envelope: radius <= 1, base y=0, crown y=1.
  // This keeps placement, crown nests and collision proxies meaningful.
  const profiles = [
    [[0, 0], [1, 0.04], [0.48, 0.42], [0.75, 0.36], [0.30, 0.70], [0.48, 0.64], [0, 1]],
    [[0, 0], [0.72, 0.08], [1, 0.38], [0.84, 0.70], [0.40, 0.92], [0, 1]],
    [[0, 0], [0.85, 0.04], [1, 0.30], [0.58, 0.53], [0.63, 0.73], [0, 1]],
  ];
  const geometry = new THREE.LatheGeometry(profiles[kind % 3].map(([x, y]) => new THREE.Vector2(x, y)), 7);
  const p = geometry.attributes.position;
  const colours = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const x = p.getX(i);
    const z = p.getZ(i);
    // Distance from the lathe axis, 0..1 within the unit envelope. Rim
    // foliage catches light; the interior near the trunk is in permanent
    // shade. A purely vertical gradient cannot express that, which is why
    // the crowns read as smooth cones however the colours are tuned.
    const rim = Math.min(1, Math.sqrt(x * x + z * z));
    const pocket = 0.62 + 0.38 * rim;
    // Per-ring variation so successive branch tiers do not shade identically.
    const tier = 0.08 * Math.sin(y * 19) + 0.05 * Math.sin(rim * 11 + y * 7);
    const shade = (0.40 + 0.50 * y + tier) * pocket;
    // Rim growth is younger and yellower; interior needles go blue-green.
    colours[i * 3] = shade * (0.90 + 0.10 * rim);
    colours[i * 3 + 1] = shade;
    colours[i * 3 + 2] = shade * (0.92 - 0.10 * rim);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 0.06; // Includes shader wind displacement.
  return geometry;
}

export function addFoliageWind(material) {
  // Chained, not assigned. This used to overwrite `onBeforeCompile` and set a
  // CONSTANT `customProgramCacheKey`, so any patch already on a foliage
  // material was silently erased and any patch added later had to be applied
  // in exactly the right order to survive. Nothing caught it because the only
  // other patch on these materials (addAtmosphere) chains and runs afterwards.
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    shader.uniforms.uBirbTime = visualUniforms.time;
    shader.uniforms.uBirbWind = visualUniforms.wind;
    shader.vertexShader = 'uniform float uBirbTime; uniform float uBirbWind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float phase = 0.0;
      #ifdef USE_INSTANCING
        phase = dot(instanceMatrix[3].xyz, vec3(0.13, 0.21, 0.17));
      #endif
      float weight = clamp(position.y, 0.0, 1.0);
      transformed.x += sin(uBirbTime * 1.1 + phase) * 0.022 * weight * weight * uBirbWind;
      transformed.z += sin(uBirbTime * 0.83 + phase + 1.7) * 0.015 * weight * weight * uBirbWind;
    `);
  };
  const windBase = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${windBase}-foliage-wind-v2`;
  return material;
}

// ── Shared GLSL ────────────────────────────────────────────────────────────
// The world-position varying every prop patch below needs. Declared
// CONDITIONALLY in both stages: addAtmosphere wants the same varying and
// either can run first. Declared twice the shader does not compile at all
// ("vBirbWorld : redefinition"), three logs it and draws NOTHING for that
// material — which is how the city's entire ground once shipped invisible.
//
// The instance transform lands in <project_vertex>, AFTER <begin_vertex>, so
// `modelMatrix * transformed` alone gives every instance the unit geometry at
// the world origin. Every prop here is instanced, so that is not a detail.
function ensureWorldVarying(shader) {
  if (!shader.vertexShader.includes('varying vec3 vBirbWorld;')) {
    shader.vertexShader = 'varying vec3 vBirbWorld;\n' + shader.vertexShader;
  }
  // Guarded on the WRITE, not only on the declaration. addAtmosphere used to
  // guard the `varying` line and then replace <begin_vertex> unconditionally,
  // so a second patch on the same material declared `birbWorldPos` twice and
  // the shader did not compile — 140 of them, caught by birb-shaders.mjs
  // rather than by anything on screen, because three then draws nothing.
  if (!shader.vertexShader.includes('vBirbWorld =')) {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec4 birbWorldPos = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        birbWorldPos = instanceMatrix * birbWorldPos;
      #endif
      vBirbWorld = (modelMatrix * birbWorldPos).xyz;`);
  }
  if (!shader.fragmentShader.includes('varying vec3 vBirbWorld;')) {
    shader.fragmentShader = 'varying vec3 vBirbWorld;\n' + shader.fragmentShader;
  }
}

/**
 * The world-space surface normal, as the GEOMETRY declares it.
 *
 * Not the facet normal from `dFdx(vBirbWorld)`, and the difference is the
 * whole of whether the leaf edge reads. A lathe canopy has seven radial
 * segments, so a facet normal is CONSTANT across a facet the size of a third
 * of the crown: thresholding on it erodes whole faces at once, which measured
 * as a crown with one clean straight edge and the opposite third dissolved.
 * The interpolated vertex normal varies per fragment, so the same threshold
 * cuts a thin band that follows the true silhouette.
 *
 * And it is per-MATERIAL correct for free: three's polyhedra are non-indexed
 * with per-face vertices, so on a boulder `objectNormal` already IS the facet
 * normal, while on a lathe it is smooth. Each surface gets what it wants
 * without the caller choosing.
 *
 * Scaled by the instance matrix the way three's own <defaultnormal_vertex>
 * does — dividing by each column's squared length — because canopy instances
 * carry a non-uniform (radius, height, radius) scale and a plain rotate would
 * skew every normal on a tall tree.
 */
function ensureWorldNormalVarying(shader) {
  if (shader.vertexShader.includes('vBirbNormalW =')) return;
  if (!shader.vertexShader.includes('varying vec3 vBirbNormalW;')) {
    shader.vertexShader = 'varying vec3 vBirbNormalW;\n' + shader.vertexShader;
  }
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
    #include <beginnormal_vertex>
    vec3 birbNrm = objectNormal;
    #ifdef USE_INSTANCING
      mat3 birbIM = mat3(instanceMatrix);
      birbNrm /= vec3(dot(birbIM[0], birbIM[0]), dot(birbIM[1], birbIM[1]), dot(birbIM[2], birbIM[2]));
      birbNrm = birbIM * birbNrm;
    #endif
    vBirbNormalW = mat3(modelMatrix) * birbNrm;`);
  if (!shader.fragmentShader.includes('varying vec3 vBirbNormalW;')) {
    shader.fragmentShader = 'varying vec3 vBirbNormalW;\n' + shader.fragmentShader;
  }
}

// One octave of 3D value noise, named so it cannot collide with
// ground-detail.js's copy if both ever land on one material.
const LEAF_NOISE_GLSL = `
  float birbLeafHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }
  float birbLeafNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(birbLeafHash(i + vec3(0.0, 0.0, 0.0)), birbLeafHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(birbLeafHash(i + vec3(0.0, 1.0, 0.0)), birbLeafHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(birbLeafHash(i + vec3(0.0, 0.0, 1.0)), birbLeafHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(birbLeafHash(i + vec3(0.0, 1.0, 1.0)), birbLeafHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
`;

export function leafEdgeRequested(search) { return !/[?&]leaves=0/.test(search || ''); }
export function upwardSnowRequested(search) { return !/[?&]snowline=0/.test(search || ''); }

/**
 * Silhouette erosion — the leaves.
 *
 * A solid crown reads as solid because its OUTLINE is solid. Adding segments
 * cannot fix that at any price this frame can pay: the forest's 285 canopies
 * are already 41% of its triangles, and doubling the lathe is +24k on a 58k
 * frame. So the ragged edge is CUT OUT of the existing mesh in the fragment
 * shader, at zero geometry cost — noise thresholded near the silhouette and
 * fed to three's own alpha test.
 *
 * Three details are load-bearing:
 *
 *  - **The silhouette term uses NO three varying.** The obvious `normal.z`
 *    is not available: three's fragment order puts <alphatest_fragment>
 *    BEFORE <normal_fragment_begin>, so `normal` does not exist yet, and
 *    `vNormal` is compiled away entirely under FLAT_SHADED (i.e. `?smooth=0`).
 *    The world-space facet normal against the eye needs neither and is
 *    identical in both paths.
 *  - **The noise is in WORLD space.** Screen-space noise swims as the camera
 *    moves; world-space is pinned to the crown and only stirs with the wind
 *    displacement, which is what leaves do.
 *  - **three's alpha test, not a hand-rolled `discard`.** It then also
 *    applies in any depth-only pass, so a shadow map would see the same
 *    lacy edge rather than a solid cone.
 */
export function addLeafEdge(material, THREE, {
  rimStart = 0.74, rimEnd = 0.995, cut = 0.52, scale = 1.3, key = 'leaf',
} = {}) {
  if (!material || material.userData?.birbLeafEdge) return material;
  material.userData = material.userData || {};
  material.userData.birbLeafEdge = true;
  // USE_ALPHATEST is defined off material.alphaTest, and <alphatest_fragment>
  // is a no-op without it — the erosion would compute and then be discarded
  // by nothing at all.
  material.alphaTest = 0.5;
  // Free where the scene target has MSAA (tier 0), ignored where it does not.
  material.alphaToCoverage = true;

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    ensureWorldVarying(shader);
    ensureWorldNormalVarying(shader);
    shader.uniforms.uLeafRim = { value: new THREE.Vector2(rimStart, rimEnd) };
    shader.uniforms.uLeafCut = { value: cut };
    shader.uniforms.uLeafScale = { value: scale };
    shader.fragmentShader =
      'uniform vec2 uLeafRim; uniform float uLeafCut; uniform float uLeafScale;\n'
      + LEAF_NOISE_GLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      {
        vec3 leN = normalize(vBirbNormalW);
        vec3 leV = normalize(cameraPosition - vBirbWorld);
        float leRim = 1.0 - abs(dot(leN, leV));
        float leMask = birbLeafNoise(vBirbWorld * uLeafScale) * 0.62
                     + birbLeafNoise(vBirbWorld * uLeafScale * 3.1) * 0.38;
        // Solid in the interior; the outer band of the silhouette keeps only
        // the fragments the noise leaves above the cut.
        float leEdge = smoothstep(uLeafRim.x, uLeafRim.y, leRim);
        float leKeep = smoothstep(uLeafCut - 0.07, uLeafCut + 0.07, leMask);
        diffuseColor.a *= 1.0 - leEdge * (1.0 - leKeep);
      }
      #include <alphatest_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${base}-${key}-edge-v1`;
  material.needsUpdate = true;
  return material;
}

/**
 * Snow settles on what faces up.
 *
 * One dot product against the local radial up — this is a sphere, so "up" is
 * `normalize(worldPos)`, never world +Y. Written at <color_fragment>, after
 * three has applied the vertex colour and BEFORE the lighting: Lambert has
 * folded diffuseColor into the outgoing light by <opaque_fragment>, so a
 * write there changes nothing at all, which this repo has paid for once.
 *
 * The normal comes from `ensureWorldNormalVarying`, which is per-material
 * correct without the caller choosing: three's polyhedra are non-indexed, so
 * on a boulder it is already the facet normal — snow on the up-facing planes,
 * bare rock on the sides, which is what settled snow looks like — while on a
 * lathe or a cone it is smooth. `vNormal` would not do: FLAT_SHADED compiles
 * it away entirely, so the patch would fail to build under `?smooth=0`.
 */
export function addUpwardSnow(material, THREE, {
  color = 0xe6f1ff, amount = 0.75, start = 0.45, end = 0.85, key = 'snow',
} = {}) {
  if (!material || material.userData?.birbUpwardSnow) return material;
  material.userData = material.userData || {};
  material.userData.birbUpwardSnow = true;

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    ensureWorldVarying(shader);
    ensureWorldNormalVarying(shader);
    shader.uniforms.uSnowColor = { value: new THREE.Color(color) };
    shader.uniforms.uSnowAmount = { value: amount };
    shader.uniforms.uSnowRange = { value: new THREE.Vector2(start, end) };
    shader.fragmentShader =
      'uniform vec3 uSnowColor; uniform float uSnowAmount; uniform vec2 uSnowRange;\n'
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      {
        vec3 snUp = normalize(vBirbWorld);
        vec3 snN = normalize(vBirbNormalW);
        float snLie = smoothstep(uSnowRange.x, uSnowRange.y, dot(snN, snUp));
        diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, snLie * uSnowAmount);
      }
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${base}-${key}-snow-v1`;
  material.needsUpdate = true;
  return material;
}

/** Bake root contact shading into existing ground vertex colours at build time.
 * Small spatial hash bounds nearby queries; no extra mesh, pass or frame work.
 */
export function bakeGroundContacts(THREE, geometry, root, options = {}) {
  const moss = options.moss !== false;
  const cellSize = 12;
  const cells = new Map();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  root.traverse((object) => {
    if (!object.isInstancedMesh || !/trunks|forest-rocks|boulders/.test(object.name)) return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      const radius = Math.min(9, Math.max(3, Math.max(scale.x, scale.z) * 2.5));
      const key = `${Math.floor(position.x / cellSize)},${Math.floor(position.y / cellSize)},${Math.floor(position.z / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ x: position.x, y: position.y, z: position.z, radius });
    }
  });
  const p = geometry.attributes.position, c = geometry.attributes.color;
  const n = geometry.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize), cz = Math.floor(z / cellSize);
    let occlusion = 0;
    // How close this vertex is to the nearest trunk base, 0..1. Same walk as
    // the occlusion term, so the second effect is free.
    let nearTrunk = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const near = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!near) continue;
      for (const a of near) {
        const distance2 = (x - a.x) ** 2 + (y - a.y) ** 2 + (z - a.z) ** 2;
        const t = Math.max(0, 1 - distance2 / (a.radius * a.radius));
        occlusion = Math.max(occlusion, t * t * 0.36);
        nearTrunk = Math.max(nearTrunk, t);
      }
    }

    // Slope term: how far this face tilts off the local radial up. The ground
    // is a displaced sphere, so the local up IS the normalised position, and
    // steep ground is bare earth while flat ground holds growth. Without it
    // the terrain colours purely by height and every slope at one altitude
    // reads identically, which is what makes the world look flat.
    let slope = 0;
    if (n) {
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 1e-6) {
        const dot = (n.getX(i) * x + n.getY(i) * y + n.getZ(i) * z) / len;
        slope = Math.max(0, Math.min(1, 1 - dot));
      }
    }
    // Steep faces lose the green and gain a dry, warmer soil tint.
    const bare = Math.min(0.55, slope * 2.2);
    let r = c.getX(i) * (1 - occlusion) * (1 + bare * 0.34);
    let g = c.getY(i) * (1 - occlusion * 0.92) * (1 - bare * 0.14);
    let b = c.getZ(i) * (1 - occlusion * 0.82) * (1 - bare * 0.40);

    // Moss collects on flat ground at the foot of trunks, not on the cliffs
    // above them, so the two terms multiply rather than add.
    if (moss && nearTrunk > 0) {
      const m = nearTrunk * nearTrunk * (1 - slope) * 0.5;
      r += (0.10 - r) * m;
      g += (0.34 - g) * m;
      b += (0.14 - b) * m;
    }
    c.setXYZ(i, r, g, b);
  }
  c.needsUpdate = true;
}

/** Small analytic ripples and sky glints on the existing pool, without a
 * reflection render, normal-map download, transparency layer or scene copy. */
export function addWaterHighlights(material, THREE, normal) {
  // Where the sun is. Set from the environment's key light so the glint lands
  // where the light actually comes from; the first version reflected an
  // arbitrary fixed direction, which put the highlight on the wrong side of
  // the pool in three of the four biomes.
  const sunUniform = { value: new THREE.Vector3(0.55, 0.62, 0.38).normalize() };
  material.userData.birbSun = sunUniform;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBirbTime = visualUniforms.time;
    shader.uniforms.uBirbSun = sunUniform;
    shader.uniforms.uWaterUp = { value: normal.clone() };
    shader.vertexShader = 'varying vec3 vWaterWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vWaterWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    `);
    shader.fragmentShader = 'uniform float uBirbTime; uniform vec3 uWaterUp; uniform vec3 uBirbSun; varying vec3 vWaterWorld;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 helper = abs(uWaterUp.y) > 0.9 ? vec3(1.,0.,0.) : vec3(0.,1.,0.);
      vec3 tangent = normalize(cross(helper, uWaterUp));
      vec3 bitangent = cross(uWaterUp, tangent);
      vec2 waterUV = vec2(dot(vWaterWorld, tangent), dot(vWaterWorld, bitangent));
      vec2 ripple = vec2(sin(waterUV.x * 1.8 + waterUV.y * .7 + uBirbTime * 1.3),
                        cos(waterUV.y * 2.1 - waterUV.x * .6 - uBirbTime * 1.1));
      vec3 waterNormal = normalize(uWaterUp + .11 * (tangent * ripple.x + bitangent * ripple.y));
      vec3 viewDir = normalize(cameraPosition - vWaterWorld);
      float fresnel = pow(1.0 - abs(dot(viewDir, waterNormal)), 3.0);
      // Specular against the REAL sun direction, plus a broader sheen so the
      // highlight has a body rather than a single hot pixel that strobes as
      // the ripples move under it.
      vec3 sun = normalize(uBirbSun);
      vec3 mirrored = reflect(-viewDir, waterNormal);
      float glint = pow(max(0., dot(mirrored, sun)), 96.0);
      float sheen = pow(max(0., dot(mirrored, sun)), 12.0);
      outgoingLight = mix(outgoingLight, vec3(.32,.62,.68), fresnel * .48);
      outgoingLight += vec3(1.,.86,.57) * (glint * .70 + sheen * .16);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'birb-water-v1';
}

export function getQualityPixelRatio(devicePixelRatio, cap, tier) {
  return Math.min(devicePixelRatio || 1, tier >= 2 ? 0.85 : tier === 1 ? 1 : cap);
}

/**
 * A rim light, for the one object that is on screen in every single frame.
 *
 * The bird is a mid-blue silhouette against a pale sky for most of a session,
 * and a diffuse-lit mid-blue against a pale anything is the exact case where
 * a form goes flat: the terminator lands somewhere in the middle of the body
 * and the edge nearest the camera has no contrast against the background at
 * all. Every stylised game solves this the same way and it costs three
 * instructions — a Fresnel term added to the outgoing light, so the edges
 * that turn away from the camera pick up a sky-coloured lip.
 *
 * It is added to the light, never mixed into it: this is a light source, and
 * a mix would darken the lit side to pay for the rim.
 *
 * The colour is a uniform so the caller can hand it the biome's own sky. A
 * fixed cyan rim in the canyon's ochre world reads as a selection outline.
 */
export function addRimLight(material, THREE, { color = 0x9fe8ff, power = 3.0, strength = 0.42 } = {}) {
  if (!material) return null;
  if (material.userData?.birbRim) return material.userData.birbRim;
  // Only LIT materials. A MeshBasicMaterial has no vNormal, no vViewPosition
  // and no outgoingLight, so this injection does not fail to look right — it
  // fails to COMPILE, and Three then refuses to use the program at all. The
  // symptom is a stream of "useProgram: program not valid" warnings and one
  // invisible object, which is a long way from the cause. The guard belongs
  // here rather than in the caller: every future caller would need to
  // remember it, and one of them would not.
  const lit = material.isMeshStandardMaterial || material.isMeshPhysicalMaterial
    || material.isMeshPhongMaterial || material.isMeshLambertMaterial
    || material.isMeshToonMaterial;
  if (!lit) return null;
  const uniforms = {
    uBirbRimColor: { value: new THREE.Color(color) },
    uBirbRimPower: { value: power },
    uBirbRimStrength: { value: strength },
  };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader =
      'uniform vec3 uBirbRimColor; uniform float uBirbRimPower; uniform float uBirbRimStrength;\n'
      + shader.fragmentShader;
    // opaque_fragment is where outgoingLight becomes gl_FragColor, so this is
    // the last moment the light can still be added to.
    const anchor = shader.fragmentShader.includes('#include <opaque_fragment>')
      ? '#include <opaque_fragment>'
      : '#include <output_fragment>';
    shader.fragmentShader = shader.fragmentShader.replace(anchor, `
      // vViewPosition runs from the fragment TO the camera, so this is N·V.
      float birbRimFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
      float birbRim = pow(1.0 - birbRimFacing, uBirbRimPower);
      outgoingLight += uBirbRimColor * birbRim * uBirbRimStrength;
      ${anchor}
    `);
  };
  material.customProgramCacheKey = () => 'birb-rim-v1';
  material.needsUpdate = true;
  material.userData = material.userData || {};
  material.userData.birbRim = uniforms;
  return uniforms;
}

/**
 * Iridescent sheen for the bird's wing surfaces.
 *
 * A Bronze-winged Pionus's coverts are STRUCTURALLY coloured: the bronze
 * flashes gold when the light is behind you and goes green-black at a grazing
 * angle. That is a view-dependent hue shift, which no vertex colour and no
 * albedo texture can express — both are fixed the moment the geometry is
 * built. It is one fresnel term and no extra draw calls.
 *
 * Two things about the form are deliberate:
 *
 *  - It MULTIPLIES the light already there rather than adding a flat term.
 *    A flat additive lifts a dark material far more than a bright one — that
 *    is how a sun rim once turned the city's 0.09-linear asphalt into pale
 *    snow — and here it would wash the dark flight feathers to grey while
 *    doing nothing visible on the bronze.
 *  - It CHAINS, and it extends the program cache key. `addRimLight` sets a
 *    CONSTANT key ('birb-rim-v1'), so a material carrying this patch and one
 *    carrying only the rim would otherwise share a compiled program and one
 *    of them would silently render the other's shader.
 *
 * @param warm   the face-on colour the sheen pushes toward (gold)
 * @param cool   the grazing-angle colour (green, for a bronze wing)
 * @param power  fresnel exponent; higher keeps the shift to the very edge
 */
export function addFeatherSheen(material, THREE, {
  warm = 0xffd27a, cool = 0x4fb488, power = 2.2, strength = 0.55,
} = {}) {
  if (!material) return null;
  if (material.userData?.birbSheen) return material.userData.birbSheen;
  const lit = material.isMeshStandardMaterial || material.isMeshPhysicalMaterial
    || material.isMeshPhongMaterial || material.isMeshLambertMaterial;
  if (!lit) return null;
  const uniforms = {
    uSheenWarm: { value: new THREE.Color(warm) },
    uSheenCool: { value: new THREE.Color(cool) },
    uSheenPower: { value: power },
    uSheenStrength: { value: strength },
  };
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    if (typeof previous === 'function') previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader =
      'uniform vec3 uSheenWarm; uniform vec3 uSheenCool; uniform float uSheenPower; uniform float uSheenStrength;\n'
      + shader.fragmentShader;
    const anchor = shader.fragmentShader.includes('#include <opaque_fragment>')
      ? '#include <opaque_fragment>'
      : '#include <output_fragment>';
    shader.fragmentShader = shader.fragmentShader.replace(anchor, `
      // vViewPosition runs from the fragment TO the camera, so this is N·V.
      float sheenFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
      // The band PEAKS across the surface and falls back to zero at the
      // silhouette, instead of growing monotonically to the edge. Two reasons,
      // and the second is the one that showed up in a capture: iridescence is
      // a shift that travels across a covert, not a halo on its outline; and
      // addRimLight already owns the silhouette, so a monotonic term stacks
      // with it. A feather plate seen near edge-on is almost ALL silhouette —
      // with the monotonic form the whole wing washed to grey against a bright
      // sky, which is the opposite of what a sheen is for.
      float sheenF = 1.0 - sheenFacing;
      float sheenP = pow(sheenF, uSheenPower);
      float sheenBand = sheenP * (1.0 - sheenP * sheenP * sheenP);
      // Face-on is gold, grazing is green — the way a real structural colour
      // travels across a curved covert as the bird banks.
      vec3 sheenTint = mix(uSheenWarm, uSheenCool, sheenBand);
      outgoingLight += outgoingLight * sheenTint * sheenBand * uSheenStrength;
      ${anchor}
    `);
  };
  material.customProgramCacheKey = function () {
    const base = typeof previousKey === 'function' ? previousKey.call(this) : '';
    return `${base}-sheen`;
  };
  material.needsUpdate = true;
  material.userData = material.userData || {};
  material.userData.birbSheen = uniforms;
  return uniforms;
}

/** `?pionus=0` puts the old blue jay palette and the flat wings back. */
export function pionusPlumageRequested(search) {
  return !/[?&]pionus=0/.test(search || '');
}

/**
 * Cap how large a Points material may draw a single particle.
 *
 * `sizeAttenuation` scales a point by `scale / -mvPosition.z`, with no upper
 * bound at all — so a particle that drifts within a metre of the camera is
 * drawn hundreds of pixels across. On a phone that is a soft disc covering a
 * quarter of the screen, appearing and vanishing for no reason the player can
 * see, and it was reported from a real device as exactly that: pale circles
 * showing up sporadically over the trees.
 *
 * The fix cannot be a smaller `size`, because that shrinks the particle at
 * every distance and the effect is tuned for the distance it is normally seen
 * at. It has to be a clamp, and PointsMaterial has no option for one — so the
 * clamp is injected straight after Three sets gl_PointSize, before the depth
 * and clipping chunks that read it.
 *
 * @param maxPixels ceiling in DEVICE pixels, so it is a real fraction of the
 *                  screen rather than of a CSS layout that varies by DPR.
 */
export function clampPointSize(material, THREE, maxPixels = 46) {
  if (!material || material.userData?.birbPointClamp) return material;
  material.userData = material.userData || {};
  material.userData.birbPointClamp = true;

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    shader.uniforms.uBirbMaxPoint = { value: maxPixels };
    shader.vertexShader = 'uniform float uBirbMaxPoint;\n' + shader.vertexShader;
    // logdepthbuf_vertex is the first chunk after gl_PointSize is assigned and
    // scaled by the attenuation, so this is the earliest point the final value
    // exists to be clamped.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <logdepthbuf_vertex>',
      'gl_PointSize = min(gl_PointSize, uBirbMaxPoint);\n\t#include <logdepthbuf_vertex>',
    );
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => `${base}-pointclamp-${maxPixels}`;
  material.needsUpdate = true;
  return material;
}
