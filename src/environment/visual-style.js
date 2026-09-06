// Shared, bounded WebGL art tools. THREE is injected to keep geometry testable
// in Node without changing the game's pinned CDN dependency.
export const visualUniforms = { time: { value: 0 }, wind: { value: 1 } };

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
    // Baked branch-pocket occlusion + brighter new growth, no extra texture.
    const shade = 0.48 + 0.52 * y + 0.08 * Math.sin(y * 19);
    colours[i * 3] = shade * 0.96;
    colours[i * 3 + 1] = shade;
    colours[i * 3 + 2] = shade * 0.87;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 0.06; // Includes shader wind displacement.
  return geometry;
}

export function addFoliageWind(material) {
  material.onBeforeCompile = (shader) => {
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
  material.customProgramCacheKey = () => 'birb-foliage-wind-v1';
}

/** Bake root contact shading into existing ground vertex colours at build time.
 * Small spatial hash bounds nearby queries; no extra mesh, pass or frame work.
 */
export function bakeGroundContacts(THREE, geometry, root) {
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
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize), cz = Math.floor(z / cellSize);
    let occlusion = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const near = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!near) continue;
      for (const a of near) {
        const distance2 = (x - a.x) ** 2 + (y - a.y) ** 2 + (z - a.z) ** 2;
        const t = Math.max(0, 1 - distance2 / (a.radius * a.radius));
        occlusion = Math.max(occlusion, t * t * 0.36);
      }
    }
    c.setXYZ(i, c.getX(i) * (1 - occlusion), c.getY(i) * (1 - occlusion * 0.92), c.getZ(i) * (1 - occlusion * 0.82));
  }
  c.needsUpdate = true;
}

/** Small analytic ripples and sky glints on the existing pool, without a
 * reflection render, normal-map download, transparency layer or scene copy. */
export function addWaterHighlights(material, THREE, normal) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBirbTime = visualUniforms.time;
    shader.uniforms.uWaterUp = { value: normal.clone() };
    shader.vertexShader = 'varying vec3 vWaterWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vWaterWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    `);
    shader.fragmentShader = 'uniform float uBirbTime; uniform vec3 uWaterUp; varying vec3 vWaterWorld;\n' + shader.fragmentShader;
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
      float glint = pow(max(0., dot(reflect(-viewDir, waterNormal), normalize(uWaterUp + tangent * .4))), 64.0);
      outgoingLight = mix(outgoingLight, vec3(.32,.62,.68), fresnel * .48);
      outgoingLight += vec3(1.,.86,.57) * glint * .65;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'birb-water-v1';
}

export function getQualityPixelRatio(devicePixelRatio, cap, tier) {
  return Math.min(devicePixelRatio || 1, tier >= 2 ? 0.85 : tier === 1 ? 1 : cap);
}
