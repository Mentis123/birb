/**
 * Standing water — lakes, tarns, canyon pools, a city harbour.
 *
 * The terrain palette has carried "deep water" and "shallow water" colour
 * stops since the carve-down terrain shipped, and there has never been any
 * water: the bottoms of the valleys were painted blue-green and were dry. This
 * is the surface that was always implied.
 *
 * ── Why the mesh is built rather than being a sphere ────────────────────
 *
 * The obvious build is one big sphere at sea level and let the depth buffer
 * cut it. It works, and it is wasteful in the two ways that matter on a
 * phone: about ninety per cent of its triangles are underground, and the
 * resolution that survives at the shoreline is whatever a whole-planet sphere
 * could afford — at 96x64 that is a vertex every twelve units, which is
 * coarser than the lakes themselves.
 *
 * So the grid is walked at high resolution and a quad is emitted only where a
 * corner is actually below sea level. Ninety per cent of the sphere costs
 * nothing, and the ten per cent that remains gets a vertex every three units.
 * Same triangle count, four times the shoreline detail, and the parts that
 * were only ever going to be z-rejected are never submitted at all.
 *
 * Quads with only SOME corners flooded are kept, so the sheet always runs
 * past the waterline and under the bank. The terrain is opaque and drawn
 * first, so the depth buffer trims the overhang to the exact intersection —
 * which is a better shoreline than any polygon edge would have been.
 *
 * Each vertex carries how deep the water is beneath it. That drives the
 * shallow-to-deep gradient and the foam band, and it is why the shore reads
 * as a shore rather than as a colour change.
 *
 * One draw call, one material, no textures — the repo generates everything in
 * code and water is no exception. The waves are two crossed sine fields
 * perturbing the normal; at the distance a flying bird sees a lake from,
 * that is indistinguishable from a normal map and costs no memory.
 */

/** Sea level per biome, in units BELOW the base radius. Always negative. */
export const WATER_LEVELS = {
  // Measured, not chosen. `__BIRB.terrainHistogram()` reports the deciles of
  // each biome's BASIN field — the smooth continental layer the lakes sit in,
  // which is a narrower distribution than the full ground because the detail
  // noise is not in it. These are each biome's 18th percentile, so every world
  // floods a little under a fifth of itself: water is a normal feature of the
  // landscape rather than a rarity you have to go looking for, and the world
  // is still overwhelmingly land.
  //
  // One shared number would not work. The city's ground only reaches -11 at
  // all, so the forest's level would drown it entirely; the mountain does not
  // rise above -8 until its 90th percentile, so the city's level would leave
  // it bone dry.
  forest: -18.2,
  canyons: -28.8,
  mountain: -30,
  city: -10.1,
};

/** Per-biome water colours: shallow shelf, deep body, and the foam. */
export const WATER_PALETTE = {
  forest: { shallow: [0.24, 0.55, 0.52], deep: [0.04, 0.16, 0.24], foam: [0.80, 0.93, 0.92] },
  canyons: { shallow: [0.30, 0.48, 0.46], deep: [0.05, 0.14, 0.19], foam: [0.88, 0.86, 0.76] },
  mountain: { shallow: [0.32, 0.62, 0.70], deep: [0.04, 0.15, 0.28], foam: [0.92, 0.96, 1.00] },
  city: { shallow: [0.09, 0.20, 0.30], deep: [0.015, 0.05, 0.11], foam: [0.62, 0.72, 0.84] },
};

const VERT = `
  #include <common>
  #include <fog_pars_vertex>
  attribute float aDepth;
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vDepth = aDepth;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <fog_vertex>
  }
`;

// `fog_vertex` wants mvPosition; supply it rather than pulling in the whole
// begin_vertex/project_vertex chain for a shader that does its own transform.
const VERT_FULL = VERT.replace(
  '    #include <fog_vertex>',
  `    vec4 mvPosition = viewMatrix * world;
    #include <fog_vertex>`,
);

const FRAG = `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uSky;
  uniform float uTime;
  uniform float uWaves;
  varying vec3 vWorld;
  varying float vDepth;

  void main() {
    vec3 N = normalize(vWorld);
    vec3 V = normalize(cameraPosition - vWorld);

    // ── Waves ────────────────────────────────────────────────────────────
    // Two crossed sine fields, evaluated on world position, tilting the
    // normal in a tangent basis. A real normal map would look the same from
    // a bird and would cost a texture fetch and a megabyte.
    vec3 ref = abs(N.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(ref, N));
    vec3 B = cross(N, T);
    float u = dot(vWorld, T);
    float v = dot(vWorld, B);
    float w1 = sin(u * 0.42 + uTime * 1.15) * cos(v * 0.31 - uTime * 0.83);
    float w2 = sin((u + v) * 0.86 - uTime * 1.9) * 0.5;
    // Flat water offshore would mirror the sky as one hard sheet; the swell
    // is what makes it read as liquid at this distance.
    N = normalize(N + (T * (w1 * 0.9 + w2) + B * (w2 * 1.1 - w1 * 0.6)) * uWaves);

    // ── Body colour ──────────────────────────────────────────────────────
    float deepen = smoothstep(0.4, 9.0, vDepth);
    vec3 body = mix(uShallow, uDeep, deepen);

    // ── Fresnel ──────────────────────────────────────────────────────────
    // Grazing angles mirror the sky, which is most of what tells a viewer a
    // surface is water rather than a blue floor.
    // Capped well below 1: a full Fresnel mirror at grazing angles turns the
    // far half of every lake into flat sky and the water stops reading as
    // water at exactly the distance most of it is seen from.
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    vec3 color = mix(body, uSky, clamp(fres * 0.85, 0.0, 0.55));

    // ── Sun glitter ──────────────────────────────────────────────────────
    vec3 L = normalize(uSunDirection);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 150.0);
    // A broad sheen under the tight highlight: the wide lobe is the path of
    // light across the water that you can see from a mile away, and it is the
    // thing that actually makes a lake look like a lake from the air.
    float sheen = pow(max(dot(N, H), 0.0), 13.0) * 0.075;
    // Tuned DOWN hard from 2.6. The glint is additive, the frame is
    // tone-mapped, and the bloom pass then finds whatever clipped — so a
    // highlight that looks reasonable in isolation becomes a white hole the
    // size of a harbour with a halo around it.
    color += uSunColor * (spec * 1.25 + sheen);

    // ── Shore foam ───────────────────────────────────────────────────────
    // A band where the water is shallowest, wobbled by the same swell so it
    // is not a clean contour line.
    // Narrow and light. The first pass ran a 2.6-unit band at 0.55 and every
    // lake wore a white ribbon that read as snow rather than as surf.
    float shoreline = smoothstep(1.5, 0.0, vDepth + w1 * 0.42);
    color = mix(color, uFoam, shoreline * 0.30);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Build the water sheet for one biome.
 *
 * @param terrainHeightAt (nx,ny,nz) -> height <= 0 relative to the base radius
 * @returns { mesh, level, update(seconds), setSunDirection(vec3), setSky(color), dispose() }
 *          or null when nothing floods.
 */
export function createWater(THREE, {
  sphereRadius = 120,
  level = -20,
  terrainHeightAt,
  // Where the lakes ARE. Defaults to the full terrain, which is right only if
  // the caller has no smooth basin field to offer.
  basinHeightAt,
  palette = WATER_PALETTE.forest,
  // Grid resolution over the whole sphere. Only flooded cells are emitted, so
  // this buys shoreline detail rather than triangles.
  segmentsU = 320,
  segmentsV = 160,
  waves = 0.045,
} = {}) {
  if (typeof terrainHeightAt !== 'function') return null;
  const basinAt = typeof basinHeightAt === 'function' ? basinHeightAt : terrainHeightAt;

  const radius = sphereRadius + level;
  const positions = [];
  const depths = [];
  const indices = [];

  // Vertex cache over the grid: a shared corner must be one vertex or the
  // sheet is four times heavier than it needs to be.
  const index = new Int32Array((segmentsU + 1) * (segmentsV + 1)).fill(-1);
  const heightCache = new Float32Array((segmentsU + 1) * (segmentsV + 1)).fill(NaN);
  const basinCache = new Float32Array((segmentsU + 1) * (segmentsV + 1)).fill(NaN);

  function key(i, j) { return j * (segmentsU + 1) + i; }

  function heightAt(i, j) {
    const k = key(i, j);
    const cached = heightCache[k];
    if (cached === cached) return cached;   // NaN check without isNaN's call
    const theta = (i / segmentsU) * Math.PI * 2;
    const phi = (j / segmentsV) * Math.PI;
    const sp = Math.sin(phi);
    const h = terrainHeightAt(sp * Math.cos(theta), Math.cos(phi), sp * Math.sin(theta));
    heightCache[k] = h;
    return h;
  }

  function basinAtCell(i, j) {
    const k = key(i, j);
    const cached = basinCache[k];
    if (cached === cached) return cached;
    const theta = (i / segmentsU) * Math.PI * 2;
    const phi = (j / segmentsV) * Math.PI;
    const sp = Math.sin(phi);
    const h = basinAt(sp * Math.cos(theta), Math.cos(phi), sp * Math.sin(theta));
    basinCache[k] = h;
    return h;
  }

  function vertexAt(i, j) {
    const k = key(i, j);
    if (index[k] >= 0) return index[k];
    const theta = (i / segmentsU) * Math.PI * 2;
    const phi = (j / segmentsV) * Math.PI;
    const sp = Math.sin(phi);
    const nx = sp * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = sp * Math.sin(theta);
    const id = positions.length / 3;
    positions.push(nx * radius, ny * radius, nz * radius);
    // Depth of water under this vertex. Clamped at 0 so a corner that is on
    // dry land does not push the shore gradient negative.
    depths.push(Math.max(0, level - heightAt(i, j)));
    index[k] = id;
    return id;
  }

  for (let j = 0; j < segmentsV; j++) {
    for (let i = 0; i < segmentsU; i++) {
      // Any corner under water keeps the quad, so the sheet always runs past
      // the waterline and under the bank.
      const flooded = basinAtCell(i, j) < level || basinAtCell(i + 1, j) < level
        || basinAtCell(i, j + 1) < level || basinAtCell(i + 1, j + 1) < level;
      if (!flooded) continue;
      const a = vertexAt(i, j);
      const b = vertexAt(i + 1, j);
      const c = vertexAt(i + 1, j + 1);
      const d = vertexAt(i, j + 1);
      // Winding matters and it is easy to get backwards. On this
      // parameterisation cross(dP/dtheta, dP/dphi) points OUTWARD, so a
      // triangle must advance in theta before phi: a -> b -> c, a -> c -> d.
      // Reversed, every lake in the world is back-facing and FrontSide culls
      // the lot — which looks exactly like water that was never built, and
      // cost a debug pass that painted the sheet magenta to tell the two
      // apart.
      indices.push(a, b, c, a, c, d);
    }
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.4).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.94, 0.80) },
      uShallow: { value: new THREE.Color(...palette.shallow) },
      uDeep: { value: new THREE.Color(...palette.deep) },
      uFoam: { value: new THREE.Color(...palette.foam) },
      uSky: { value: new THREE.Color(0.62, 0.74, 0.86) },
      uTime: { value: 0 },
      uWaves: { value: waves },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT_FULL,
    fragmentShader: FRAG,
    uniforms,
    // The sheet is a closed-ish patch seen from outside; the far side of a
    // lake basin is behind the terrain anyway.
    side: THREE.FrontSide,
    fog: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  // After the opaque terrain, so early-z rejects every fragment that is under
  // a bank instead of shading it and throwing it away.
  mesh.renderOrder = 2;

  return {
    mesh,
    level,
    triangles: indices.length / 3,
    update(seconds) { material.uniforms.uTime.value = seconds; },
    setSunDirection(direction) {
      material.uniforms.uSunDirection.value.copy(direction).normalize();
    },
    setSunColor(color) { material.uniforms.uSunColor.value.copy(color); },
    setSky(color) { material.uniforms.uSky.value.copy(color); },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
