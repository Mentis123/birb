import * as THREEImported from "https://esm.sh/three@0.161.0";

// Tunable ambience constants for quick iteration on mobile GPUs.
// Adjust these values to balance clarity and performance during testing.
export const WORLD_TWEAKS = {
  /** Distance where the scene fog begins blending in. */
  FOG_START: 6.5,
  /** Distance where the fog fully obscures geometry. */
  FOG_END: 18,
  /** Emissive intensity for the skydome's subtle glow. */
  DOME_BRIGHTNESS: 0.18,
  /** Controls the base scale of distant terrain silhouettes. */
  TERRAIN_SCALE: 52,
};

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
    scene.fog.near = WORLD_TWEAKS.FOG_START;
    scene.fog.far = WORLD_TWEAKS.FOG_END;
  } else {
    scene.fog = new THREE.Fog(0x060912, WORLD_TWEAKS.FOG_START, WORLD_TWEAKS.FOG_END);
  }

  const skyGeometry = new THREE.SphereGeometry(60, 48, 32);
  const skyMaterial = new THREE.MeshStandardMaterial({
    color: 0x08111f,
    emissive: 0x0a1b33,
    emissiveIntensity: WORLD_TWEAKS.DOME_BRIGHTNESS,
    side: THREE.BackSide,
    fog: false,
  });
  const skydome = new THREE.Mesh(skyGeometry, skyMaterial);
  skydome.renderOrder = -5;
  scene.add(skydome);

  const hazeGroup = new THREE.Group();
  const hazeLayers = [
    { radius: 32, height: 16, opacity: 0.22 },
    { radius: 42, height: 18, opacity: 0.18 },
    { radius: 55, height: 22, opacity: 0.14 },
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

  const trailGeometry = new THREE.TorusGeometry(1.8, 0.016, 16, 120);
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: mergedOptions.trail.color,
    transparent: true,
    opacity: mergedOptions.trail.opacity,
  });
  const glideTrail = new THREE.Mesh(trailGeometry, trailMaterial);
  glideTrail.rotation.x = Math.PI / 2;
  scene.add(glideTrail);

  const floorGeometry = new THREE.CircleGeometry(3.4, 48);
  const floorMaterial = new THREE.MeshBasicMaterial({
    color: mergedOptions.floor.color,
    transparent: true,
    opacity: mergedOptions.floor.opacity,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.7;
  scene.add(floor);

  const terrainGroup = new THREE.Group();
  const terrainGeometry = new THREE.IcosahedronGeometry(1, 1);
  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d1b2f,
    flatShading: true,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.65,
  });

  const terrainCount = 8;
  for (let i = 0; i < terrainCount; i += 1) {
    const mesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
    const angle = (i / terrainCount) * Math.PI * 2;
    const radius = WORLD_TWEAKS.TERRAIN_SCALE * (0.9 + Math.random() * 0.2);
    mesh.position.set(Math.cos(angle) * radius, -6 - Math.random() * 2, Math.sin(angle) * radius);
    const uniformScale = 6 + Math.random() * 4;
    mesh.scale.set(uniformScale, 3 + Math.random() * 2, uniformScale);
    mesh.rotation.set(-0.2 + Math.random() * 0.4, Math.random() * Math.PI * 2, -0.2 + Math.random() * 0.4);
    terrainGroup.add(mesh);
  }
  terrainGroup.position.y = -10;
  scene.add(terrainGroup);

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
    const radius = 5 + Math.random() * 10;
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
    floor,
    terrainGroup,
    anchors,
  };
}
