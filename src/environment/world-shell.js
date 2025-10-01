import * as THREEImported from "https://esm.sh/three@0.161.0";

// Tunable ambience constants for quick iteration on mobile GPUs.
// Adjust these values to balance clarity and performance during testing.
export const WORLD_TWEAKS = {
  /** Distance where the scene fog begins blending in. */
  FOG_START: 8.5,
  /** Distance where the fog fully obscures geometry. */
  FOG_END: 24,
  /** Emissive intensity for the skydome's subtle glow. */
  DOME_BRIGHTNESS: 0.12,
  /** Controls the base scale of distant terrain silhouettes. */
  TERRAIN_SCALE: 74,
  /** Controls the spread of procedural prop placement. */
  PROP_SPREAD: 3.4,
};

const SPACE_SCALE = 1.5;
const DEG2RAD = Math.PI / 180;

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function createScatterGroup({
  count,
  baseObject,
  radiusRange = [1, 1],
  heightRange = [0, 0],
  scaleRange = [1, 1],
  tiltRange = [0, 0],
  yawJitter = Math.PI * 2,
}) {
  const group = new THREEImported.Group();
  const dummy = new THREEImported.Object3D();

  const placements = count;
  for (let i = 0; i < placements; i += 1) {
    const clone = baseObject.clone(true);
    const angle = (i / placements) * Math.PI * 2 + randomInRange(-0.4, 0.4);
    const radius = randomInRange(radiusRange[0], radiusRange[1]);
    const height = randomInRange(heightRange[0], heightRange[1]);
    const scale = randomInRange(scaleRange[0], scaleRange[1]);
    const tilt = randomInRange(tiltRange[0], tiltRange[1]);
    const yaw = randomInRange(-yawJitter, yawJitter);

    dummy.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    dummy.rotation.set(tilt * DEG2RAD, yaw, tilt * DEG2RAD * 0.25);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();

    clone.matrixAutoUpdate = false;
    clone.matrix.copy(dummy.matrix);
    clone.matrixWorldNeedsUpdate = true;
    group.add(clone);
  }

  return group;
}

const DEFAULT_OPTIONS = {
  floor: {
    color: 0x101e39,
    opacity: 0.55,
  },
  trail: {
    color: 0x1f3c6f,
    opacity: 0.32,
  },
  anchor: {
    color: 0x2a3957,
    opacity: 0.92,
  },
  haze: {
    color: 0x0d1829,
  },
};

export function createWorldShell(
  scene,
  { options = {}, three } = {},
) {
  const THREE = three ?? THREEImported;
  const mergedOptions = {
    floor: { ...DEFAULT_OPTIONS.floor, ...options.floor },
    trail: { ...DEFAULT_OPTIONS.trail, ...options.trail },
    anchor: { ...DEFAULT_OPTIONS.anchor, ...options.anchor },
    haze: { ...DEFAULT_OPTIONS.haze, ...options.haze },
  };

  // Ensure fog aligns with the shell defaults for quick iteration.
  if (scene.fog) {
    scene.fog.color.set(0x050a14);
    scene.fog.near = WORLD_TWEAKS.FOG_START;
    scene.fog.far = WORLD_TWEAKS.FOG_END;
  } else {
    scene.fog = new THREE.Fog(0x050a14, WORLD_TWEAKS.FOG_START, WORLD_TWEAKS.FOG_END);
  }

  const skyGeometry = new THREE.SphereGeometry(60 * SPACE_SCALE, 48, 32);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x1a2a4b) },
      bottomColor: { value: new THREE.Color(0x050913) },
      glowIntensity: { value: WORLD_TWEAKS.DOME_BRIGHTNESS },
    },
    side: THREE.BackSide,
    fog: false,
    transparent: false,
    vertexShader: `
      varying float vGradient;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vGradient = smoothstep(-0.2, 0.8, normalize(worldPosition.xyz).y);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float glowIntensity;
      varying float vGradient;
      void main() {
        vec3 base = mix(bottomColor, topColor, vGradient);
        base += glowIntensity * 0.4 * vec3(0.18, 0.3, 0.55) * pow(vGradient, 2.5);
        gl_FragColor = vec4(base, 1.0);
      }
    `,
  });
  const skydome = new THREE.Mesh(skyGeometry, skyMaterial);
  skydome.renderOrder = -5;
  scene.add(skydome);

  const hazeGroup = new THREE.Group();
  const hazeLayers = [
    { radius: 32 * SPACE_SCALE, height: 16 * SPACE_SCALE, opacity: 0.24 },
    { radius: 42 * SPACE_SCALE, height: 18 * SPACE_SCALE, opacity: 0.19 },
    { radius: 55 * SPACE_SCALE, height: 22 * SPACE_SCALE, opacity: 0.15 },
  ];

  hazeLayers.forEach((layer, index) => {
    const hazeGeometry = new THREE.CylinderGeometry(layer.radius, layer.radius, layer.height, 24, 1, true);
    const hazeMaterial = new THREE.MeshBasicMaterial({
      color: mergedOptions.haze.color,
      transparent: true,
      opacity: layer.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hazeMesh = new THREE.Mesh(hazeGeometry, hazeMaterial);
    hazeMesh.position.y = -layer.height * 0.25 + index * 0.6;
    hazeGroup.add(hazeMesh);
  });
  hazeGroup.position.y = -3.5;
  scene.add(hazeGroup);

  const trailGeometry = new THREE.TorusGeometry(1.8 * SPACE_SCALE, 0.016 * SPACE_SCALE, 16, 120);
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: mergedOptions.trail.color,
    transparent: true,
    opacity: mergedOptions.trail.opacity,
  });
  const glideTrail = new THREE.Mesh(trailGeometry, trailMaterial);
  glideTrail.rotation.x = Math.PI / 2;
  scene.add(glideTrail);

  const groundGeometry = new THREE.CylinderGeometry(3.3 * SPACE_SCALE, 4.5 * SPACE_SCALE, 1.2, 36, 2, true);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x142238,
    roughness: 0.85,
    metalness: 0.08,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  const groundShell = new THREE.Mesh(groundGeometry, groundMaterial);
  groundShell.rotation.x = Math.PI;
  groundShell.position.y = -1.25;
  scene.add(groundShell);

  const floorGeometry = new THREE.CircleGeometry(3.2 * SPACE_SCALE, 48);
  const floorMaterial = new THREE.MeshBasicMaterial({
    color: mergedOptions.floor.color,
    transparent: true,
    opacity: mergedOptions.floor.opacity,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.46;
  scene.add(floor);

  const islandGeometry = new THREE.IcosahedronGeometry(1, 2);
  const islandMaterial = new THREE.MeshStandardMaterial({
    color: 0x172742,
    flatShading: true,
    roughness: 0.95,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
  });

  const islandsGroup = new THREE.Group();
  const islandCount = 6;
  for (let i = 0; i < islandCount; i += 1) {
    const mesh = new THREE.Mesh(islandGeometry, islandMaterial);
    const angle = (i / islandCount) * Math.PI * 2;
    const radius = WORLD_TWEAKS.TERRAIN_SCALE * (0.86 + Math.random() * 0.18);
    mesh.position.set(Math.cos(angle) * radius, -5.5 - Math.random() * 2, Math.sin(angle) * radius);
    const uniformScale = 4.5 + Math.random() * 2.5;
    mesh.scale.set(uniformScale, 2.2 + Math.random() * 1.2, uniformScale);
    mesh.rotation.set(-0.18 + Math.random() * 0.35, Math.random() * Math.PI * 2, -0.18 + Math.random() * 0.35);
    islandsGroup.add(mesh);
  }
  islandsGroup.position.y = -9.5;
  scene.add(islandsGroup);

  const propOrigin = WORLD_TWEAKS.PROP_SPREAD * SPACE_SCALE;

  const treePrototype = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.65, 6),
    new THREE.MeshStandardMaterial({
      color: 0x2a3a4d,
      roughness: 0.85,
      metalness: 0.05,
      emissive: 0x050e16,
      emissiveIntensity: 0.18,
    }),
  );
  trunk.position.y = -0.1;
  treePrototype.add(trunk);
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.72, 7),
    new THREE.MeshStandardMaterial({
      color: 0x3c6a7c,
      emissive: 0x102c38,
      emissiveIntensity: 0.2,
      roughness: 0.65,
      metalness: 0.08,
    }),
  );
  canopy.position.y = 0.32;
  treePrototype.add(canopy);

  const treeGroup = createScatterGroup({
    count: 14,
    baseObject: treePrototype,
    radiusRange: [propOrigin * 0.6, propOrigin],
    heightRange: [-0.4, 0.1],
    scaleRange: [0.85, 1.2],
    tiltRange: [-4, 4],
    yawJitter: Math.PI,
  });
  treeGroup.position.y = -0.35;
  scene.add(treeGroup);

  const rockPrototype = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.22, 0),
    new THREE.MeshStandardMaterial({
      color: 0x223042,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    }),
  );
  const rockGroup = createScatterGroup({
    count: 20,
    baseObject: rockPrototype,
    radiusRange: [propOrigin * 0.55, propOrigin * 1.1],
    heightRange: [-0.48, -0.32],
    scaleRange: [0.6, 1.35],
    tiltRange: [-8, 8],
  });
  rockGroup.children.forEach((child) => {
    child.rotation.y += randomInRange(-Math.PI, Math.PI);
  });
  scene.add(rockGroup);

  const cloudPrototype = new THREE.Group();
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xcedef3,
    emissive: 0x203452,
    emissiveIntensity: 0.05,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: 0.8,
  });
  const cloudSegments = 3;
  for (let i = 0; i < cloudSegments; i += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random() * 0.25, 12, 10), cloudMaterial);
    puff.position.set(randomInRange(-0.4, 0.4), randomInRange(-0.1, 0.2), i * 0.45 * (Math.random() > 0.5 ? 1 : -1));
    cloudPrototype.add(puff);
  }

  const cloudGroup = createScatterGroup({
    count: 8,
    baseObject: cloudPrototype,
    radiusRange: [propOrigin * 0.4, propOrigin * 1.45],
    heightRange: [1.4, 2.5],
    scaleRange: [0.6, 1.4],
    tiltRange: [-2, 2],
    yawJitter: Math.PI * 0.35,
  });
  scene.add(cloudGroup);

  const anchorGeometry = new THREE.TetrahedronGeometry(0.35, 0);
  const anchorMaterial = new THREE.MeshStandardMaterial({
    color: mergedOptions.anchor.color,
    transparent: true,
    opacity: mergedOptions.anchor.opacity,
    roughness: 0.6,
    metalness: 0.05,
  });

  const anchorCount = 24;
  const anchors = new THREE.InstancedMesh(anchorGeometry, anchorMaterial, anchorCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < anchorCount; i += 1) {
    const radius = (5 + Math.random() * 10) * SPACE_SCALE;
    const angle = Math.random() * Math.PI * 2;
    const height = -0.3 + Math.random() * 3.5;
    dummy.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const scale = 0.6 + Math.random() * 0.8;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    anchors.setMatrixAt(i, dummy.matrix);
  }
  anchors.instanceMatrix.needsUpdate = true;
  scene.add(anchors);

  return {
    skydome,
    hazeGroup,
    glideTrail,
    groundShell,
    floor,
    islandsGroup,
    treeGroup,
    rockGroup,
    cloudGroup,
    anchors,
  };
}
