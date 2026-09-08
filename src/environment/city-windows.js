/**
 * Lit windows, procedurally, on instanced buildings.
 *
 * The city biome shipped as grey boxes standing in a field. Everything that
 * makes a skyline read as a CITY rather than as scattered monoliths is in the
 * windows: the grid gives a building scale (you can see how many floors it
 * has), the lit fraction gives it life, and the warm points against a dusk
 * sky give it the one thing the biome never had — a reason to look at it.
 *
 * ── Why this is a shader and not geometry ───────────────────────────────
 *
 * Real window quads would be tens of thousands of extra faces, or an emissive
 * texture would be an asset, and this repo ships neither. The grid is derived
 * from the fragment's own position on the wall, so it costs no geometry, no
 * memory and no draw calls, and it works on an InstancedMesh where every
 * building shares one box.
 *
 * Three things it has to get right and each is easy to get wrong:
 *
 *  - **World units, not UVs.** The unit box is scaled per instance, so box UVs
 *    would give a sixty-unit tower and a twelve-unit shop the same number of
 *    floors. The wall coordinate is the local position multiplied by the
 *    instance's own scale, read out of the instance matrix, so the window
 *    PITCH is constant across the whole city.
 *  - **A seed per building.** Without one every tower lights exactly the same
 *    windows and the skyline reads as one building repeated, which is worse
 *    than no windows at all. The seed is hashed from the instance's
 *    translation, so it is stable, free, and different for every tower.
 *  - **Anti-aliasing from fwidth.** A hard step on a grid this fine shimmers
 *    into noise the moment the camera moves, and a flying camera moves
 *    constantly. The edges are smoothstepped by the screen-space derivative,
 *    so distant towers fade to an even glow instead of crawling.
 *
 * The roof is skipped — windows on the top face is the tell of a procedural
 * grid applied without thinking about which way the surface points.
 */

export const WINDOW_DEFAULTS = {
  // Metres between window centres, across and up. A tower 5 wide and 40 tall
  // gets about 3 columns and 17 floors, which reads as a tower.
  pitch: [1.7, 2.3],
  // Fraction of the box a window fills, leaving the rest as wall.
  fill: [0.62, 0.54],
  // Fraction of windows lit. Around half is what a real city looks like at
  // dusk; at 0.9 the building reads as one glowing slab and the grid is lost.
  litFraction: 0.46,
  // Warm interior light. Deliberately HDR: the bloom pass thresholds the
  // tone-mapped frame, so a window at 1.0 lands under the knee and does not
  // glow at all. See docs/VISUAL_UPGRADE_BUILD_PLAN.md 16.4.
  warm: [2.9, 2.05, 1.15],
  cool: [1.35, 1.85, 2.6],
  // Fraction of lit windows that are a cold office white rather than warm.
  coolFraction: 0.26,
};

export function addWindowLights(material, THREE, options = {}) {
  if (!material || material.userData?.birbWindows) return material;
  const config = { ...WINDOW_DEFAULTS, ...options };
  material.userData = material.userData || {};
  material.userData.birbWindows = true;

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);

    shader.uniforms.uWinPitch = { value: new THREE.Vector2(...config.pitch) };
    shader.uniforms.uWinFill = { value: new THREE.Vector2(...config.fill) };
    shader.uniforms.uWinLit = { value: config.litFraction };
    shader.uniforms.uWinWarm = { value: new THREE.Vector3(...config.warm) };
    shader.uniforms.uWinCool = { value: new THREE.Vector3(...config.cool) };
    shader.uniforms.uWinCoolMix = { value: config.coolFraction };

    shader.vertexShader = 'varying vec3 vWinLocal;\nvarying vec3 vWinNrm;\nvarying float vWinSeed;\n'
      + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec3 winSize = vec3(1.0);
      float winSeed = 0.0;
      #ifdef USE_INSTANCING
        // The instance's own scale, read straight out of its matrix. This is
        // what keeps the window pitch constant instead of scaling with the
        // building.
        winSize = vec3(length(instanceMatrix[0].xyz),
                       length(instanceMatrix[1].xyz),
                       length(instanceMatrix[2].xyz));
        winSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
      #endif
      vWinLocal = transformed * winSize;
      vWinNrm = normal;
      vWinSeed = winSeed;
    `);

    shader.fragmentShader =
      'uniform vec2 uWinPitch; uniform vec2 uWinFill; uniform float uWinLit;\n'
      + 'uniform vec3 uWinWarm; uniform vec3 uWinCool; uniform float uWinCoolMix;\n'
      + 'varying vec3 vWinLocal; varying vec3 vWinNrm; varying float vWinSeed;\n'
      + 'float birbWinHash(vec2 p) {\n'
      + '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n'
      + '}\n'
      + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 winAxis = abs(normalize(vWinNrm));
      // Walls only. A grid on the roof is the tell of a procedural pattern
      // applied without asking which way the surface faces.
      if (winAxis.y < 0.5) {
        vec2 winUv = winAxis.x > winAxis.z ? vWinLocal.zy : vWinLocal.xy;
        vec2 winGrid = winUv / uWinPitch;
        vec2 winCell = floor(winGrid);
        vec2 winF = fract(winGrid);

        float winPick = birbWinHash(winCell + vWinSeed * 53.7);
        float winOn = step(1.0 - uWinLit, winPick);

        // Anti-aliased window edges. A hard step on a grid this fine crawls
        // into shimmering noise under a moving camera, and this camera never
        // stops moving.
        vec2 winW = max(fwidth(winGrid), vec2(0.001));
        vec2 lo = (1.0 - uWinFill) * 0.5;
        vec2 hi = 1.0 - lo;
        vec2 winShape2 =
          smoothstep(lo - winW, lo + winW, winF) * (1.0 - smoothstep(hi - winW, hi + winW, winF));
        float winShape = winShape2.x * winShape2.y;
        // Once a window is smaller than a pixel the two smoothstep bands
        // overlap and every fragment lands on a partial value — which is not
        // an average, it is speckle, and a distant tower turns to static.
        // Fade the pattern out as the cell shrinks and let the facade settle
        // to its own colour instead.
        float winFade = 1.0 - smoothstep(0.30, 0.85, max(winW.x, winW.y));
        winShape *= winFade;

        // Per-window brightness and colour, so a lit facade is not a flat
        // sheet of identical dots.
        float winVar = birbWinHash(winCell * 1.7 + vWinSeed * 91.3);
        vec3 winColor = mix(uWinWarm, uWinCool, step(1.0 - uWinCoolMix, winVar));
        outgoingLight += winColor * (winOn * winShape * (0.55 + 0.45 * winVar));
      }

      #include <opaque_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => base + '-windows-v2';
  material.needsUpdate = true;
  return material;
}

/**
 * A street grid on the city's ground.
 *
 * With lit towers the skyline reads, and the ground still does not: it is
 * smooth rolling terrain in a colour, which is what every other biome has.
 * A city's ground is the one surface a person can identify from a mile up,
 * and what identifies it is the grid.
 *
 * Same trick as the windows — derived from the fragment's own position, so no
 * geometry, no texture and no draw calls. The parameterisation is spherical:
 * longitude and latitude scaled to world units, with longitude corrected by
 * cos(latitude) so blocks stay roughly square instead of pinching to nothing
 * at the poles. The grid still curves across the planet, which is correct for
 * a city built on a sphere and reads like a city built on hills.
 *
 * Roads carry warm lamps. They are the reason to do this at dusk rather than
 * at noon: a dark grid with points of warm light in it says "city" from any
 * altitude, and it is the same bloom the windows already feed.
 */
export function addStreetGrid(material, THREE, {
  // Block pitch and road width, in world units on a radius-120 planet.
  block = 44,
  roadWidth = 7.5,
  radius = 120,
  roadColor = [0.045, 0.05, 0.062],
  lampColor = [2.6, 1.75, 0.85],
  lampSpacing = 11,
} = {}) {
  if (!material || material.userData?.birbStreets) return material;
  material.userData = material.userData || {};
  material.userData.birbStreets = true;

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    shader.uniforms.uStreetBlock = { value: block };
    shader.uniforms.uStreetWidth = { value: roadWidth };
    shader.uniforms.uStreetRadius = { value: radius };
    shader.uniforms.uStreetColor = { value: new THREE.Color(...roadColor) };
    shader.uniforms.uStreetLamp = { value: new THREE.Vector3(...lampColor) };
    shader.uniforms.uStreetLampGap = { value: lampSpacing };

    // The atmosphere injection already provides a world-position varying, and
    // this material always has it; declare it only if it is missing so the
    // two injections can be applied in either order.
    if (!shader.vertexShader.includes('varying vec3 vBirbWorld;')) {
      shader.vertexShader = 'varying vec3 vBirbWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vBirbWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    }
    if (!shader.fragmentShader.includes('varying vec3 vBirbWorld;')) {
      shader.fragmentShader = 'varying vec3 vBirbWorld;\n' + shader.fragmentShader;
    }

    shader.fragmentShader =
      'uniform float uStreetBlock; uniform float uStreetWidth; uniform float uStreetRadius;\n'
      + 'uniform vec3 uStreetColor; uniform vec3 uStreetLamp; uniform float uStreetLampGap;\n'
      + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 sp = normalize(vBirbWorld);
        float lat = asin(clamp(sp.y, -1.0, 1.0));
        // cos(lat) keeps blocks square instead of pinching to nothing as the
        // meridians converge.
        float lon = atan(sp.z, sp.x) * cos(lat);
        vec2 street = vec2(lon, lat) * uStreetRadius / uStreetBlock;
        vec2 edge = abs(fract(street) - 0.5);
        // How wide a road is, expressed as a fraction of a block.
        float halfRoad = (uStreetWidth * 0.5) / uStreetBlock;
        vec2 sw = max(fwidth(street), vec2(0.0005));
        vec2 onRoad2 = smoothstep(0.5 - halfRoad - sw, 0.5 - halfRoad + sw, edge);
        float onRoad = max(onRoad2.x, onRoad2.y);

        // outgoingLight, NOT diffuseColor. By the time <opaque_fragment> runs,
        // Lambert has already folded the diffuse colour into the lighting;
        // writing diffuseColor here changes nothing anyone can see, which is
        // exactly what the first version of this did.
        outgoingLight = mix(outgoingLight, outgoingLight * 0.30 + uStreetColor, onRoad * 0.92);

        // Lamps, spaced along whichever axis this fragment's road runs.
        float along = onRoad2.x > onRoad2.y ? street.y : street.x;
        float lampPhase = fract(along * (uStreetBlock / uStreetLampGap));
        float lampW = max(fwidth(lampPhase), 0.02);
        float lamp = 1.0 - smoothstep(0.10, 0.10 + lampW * 3.0, abs(lampPhase - 0.5));
        outgoingLight += uStreetLamp * (lamp * onRoad * 0.22);
      }

      #include <opaque_fragment>
    `);
  };

  const base = typeof previousKey === 'function' ? previousKey.call(material) : 'birb';
  material.customProgramCacheKey = () => base + '-streets-v2';
  material.needsUpdate = true;
  return material;
}
