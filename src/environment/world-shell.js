import * as THREEImported from "https://esm.sh/three@0.161.0";

const DEG2RAD = Math.PI / 180;
const BASE_SPACE_SCALE = 3.2;

const DEFAULT_HAZE_LAYERS = [
  { radius: 38, height: 22, opacity: 0.2 },
  { radius: 52, height: 26, opacity: 0.16 },
  { radius: 64, height: 30, opacity: 0.13 },
];

const DEFAULT_OPTIONS = {
  floor: {
    color: 0x1a2f57,
    opacity: 0.6,
  },
  trail: {
    color: 0x2b4f8f,
    opacity: 0.35,
  },
  anchor: {
    color: 0x324c78,
    opacity: 0.9,
  },
  haze: {
    color: 0x132648,
  },
};

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function createScatterGroup(THREE, {
  count,
  baseObject,
  radiusRange = [1, 1],
  heightRange = [0, 0],
  scaleRange = [1, 1],
  tiltRange = [0, 0],
  yawJitter = Math.PI * 2,
}) {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();

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

function disposeWorld(scene, root) {
  if (!root) return;
  scene.remove(root);
  const geometries = new Set();
  const materials = new Set();

  root.traverse((child) => {
    if (child.geometry) {
      geometries.add(child.geometry);
    }
    if (child.material) {
      const { material } = child;
      if (Array.isArray(material)) {
        material.forEach((mat) => {
          if (mat) materials.add(mat);
        });
      } else if (material) {
        materials.add(material);
      }
    }
    if (child.isInstancedMesh) {
      if (child.instanceMatrix?.dispose) {
        child.instanceMatrix.dispose();
      }
      if (child.instanceColor?.dispose) {
        child.instanceColor.dispose();
      }
    }
  });

  geometries.forEach((geometry) => {
    if (geometry && typeof geometry.dispose === "function") {
      geometry.dispose();
    }
  });
  materials.forEach((material) => {
    if (material && typeof material.dispose === "function") {
      material.dispose();
    }
  });

  root.clear();
}

function buildForestEnvironment({ THREE, root, config, propOrigin, terrainScale, spaceScale }) {
  const islandGeometry = new THREE.IcosahedronGeometry(1, 2);
  const islandMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f3d4f,
    flatShading: true,
    roughness: 0.88,
    metalness: 0.08,
    transparent: true,
    opacity: 0.82,
  });
  const islandsGroup = new THREE.Group();
  const islandCount = 10;
  for (let i = 0; i < islandCount; i += 1) {
    const mesh = new THREE.Mesh(islandGeometry, islandMaterial);
    const angle = (i / islandCount) * Math.PI * 2 + randomInRange(-0.2, 0.2);
    const radius = terrainScale * (0.85 + Math.random() * 0.2);
    mesh.position.set(
      Math.cos(angle) * radius,
      -6.5 * spaceScale - Math.random() * 2.5,
      Math.sin(angle) * radius,
    );
    const uniformScale = 5.5 + Math.random() * 3.5;
    mesh.scale.set(uniformScale, 2.8 + Math.random() * 1.4, uniformScale);
    mesh.rotation.set(-0.18 + Math.random() * 0.36, Math.random() * Math.PI * 2, -0.18 + Math.random() * 0.36);
    islandsGroup.add(mesh);
  }
  islandsGroup.position.y = -10.5;
  root.add(islandsGroup);

  const treePrototype = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.14, 0.82, 7),
    new THREE.MeshStandardMaterial({
      color: 0x324b38,
      roughness: 0.78,
      metalness: 0.06,
      emissive: 0x0c1a12,
      emissiveIntensity: 0.2,
    }),
  );
  trunk.position.y = 0.3;
  treePrototype.add(trunk);
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.96, 9),
    new THREE.MeshStandardMaterial({
      color: 0x2f7a4d,
      emissive: 0x163e26,
      emissiveIntensity: 0.22,
      roughness: 0.62,
      metalness: 0.08,
    }),
  );
  canopy.position.y = 0.92;
  treePrototype.add(canopy);

  const treeGroup = createScatterGroup(THREE, {
    count: 28,
    baseObject: treePrototype,
    radiusRange: [propOrigin * 0.55, propOrigin * 1.15],
    heightRange: [-0.42, 0.28],
    scaleRange: [1.05, 1.55],
    tiltRange: [-6, 6],
    yawJitter: Math.PI,
  });
  treeGroup.position.y = -0.4;
  root.add(treeGroup);

  const shrubPrototype = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0x3e8a58,
      roughness: 0.55,
      metalness: 0.05,
      emissive: 0x1a4227,
      emissiveIntensity: 0.12,
    }),
  );
  shrubPrototype.scale.set(1, 0.75, 1);
  const shrubGroup = createScatterGroup(THREE, {
    count: 36,
    baseObject: shrubPrototype,
    radiusRange: [propOrigin * 0.4, propOrigin * 1.1],
    heightRange: [-0.48, -0.32],
    scaleRange: [0.8, 1.4],
    tiltRange: [-3, 3],
  });
  root.add(shrubGroup);

  const rockPrototype = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.24, 0),
    new THREE.MeshStandardMaterial({
      color: 0x24343f,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    }),
  );
  const rockGroup = createScatterGroup(THREE, {
    count: 22,
    baseObject: rockPrototype,
    radiusRange: [propOrigin * 0.6, propOrigin * 1.2],
    heightRange: [-0.5, -0.3],
    scaleRange: [0.6, 1.35],
    tiltRange: [-8, 8],
  });
  rockGroup.children.forEach((child) => {
    child.rotation.y += randomInRange(-Math.PI, Math.PI);
  });
  root.add(rockGroup);

  const cloudPrototype = new THREE.Group();
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xdfeeff,
    emissive: 0x28486c,
    emissiveIntensity: 0.08,
    roughness: 0.28,
    metalness: 0.02,
    transparent: true,
    opacity: 0.78,
  });
  for (let i = 0; i < 4; i += 1) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.44 + Math.random() * 0.28, 14, 12),
      cloudMaterial,
    );
    puff.position.set(
      randomInRange(-0.48, 0.48),
      randomInRange(-0.12, 0.24),
      i * 0.48 * (Math.random() > 0.5 ? 1 : -1),
    );
    cloudPrototype.add(puff);
  }

  const cloudGroup = createScatterGroup(THREE, {
    count: 10,
    baseObject: cloudPrototype,
    radiusRange: [propOrigin * 0.45, propOrigin * 1.55],
    heightRange: [1.6, 2.8],
    scaleRange: [0.7, 1.5],
    tiltRange: [-2, 2],
    yawJitter: Math.PI * 0.3,
  });
  cloudGroup.position.y = 0.6;
  root.add(cloudGroup);
}

function buildCanyonEnvironment({ THREE, root, propOrigin, terrainScale, spaceScale }) {
  const mesaGeometry = new THREE.CylinderGeometry(1.2, 2.4, 2.8, 12, 1, false);
  const mesaMaterial = new THREE.MeshStandardMaterial({
    color: 0x7a3c23,
    roughness: 0.72,
    metalness: 0.06,
    flatShading: true,
  });
  const mesaGroup = new THREE.Group();
  const mesaCount = 8;
  for (let i = 0; i < mesaCount; i += 1) {
    const mesh = new THREE.Mesh(mesaGeometry, mesaMaterial);
    const angle = (i / mesaCount) * Math.PI * 2 + randomInRange(-0.25, 0.25);
    const radius = terrainScale * (0.78 + Math.random() * 0.22);
    mesh.position.set(
      Math.cos(angle) * radius,
      -5.8 * spaceScale - Math.random() * 1.6,
      Math.sin(angle) * radius,
    );
    const scale = 4.8 + Math.random() * 2.6;
    mesh.scale.set(scale, 2.1 + Math.random() * 1.1, scale * (0.8 + Math.random() * 0.4));
    mesh.rotation.y = randomInRange(0, Math.PI * 2);
    mesaGroup.add(mesh);
  }
  mesaGroup.position.y = -9.6;
  root.add(mesaGroup);

  const spirePrototype = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.6, 4.4, 10, 1, false),
    new THREE.MeshStandardMaterial({
      color: 0x8b4728,
      roughness: 0.65,
      metalness: 0.08,
      emissive: 0x2e130a,
      emissiveIntensity: 0.18,
      flatShading: true,
    }),
  );
  const spireGroup = createScatterGroup(THREE, {
    count: 20,
    baseObject: spirePrototype,
    radiusRange: [propOrigin * 0.65, propOrigin * 1.3],
    heightRange: [-0.4, 0.9],
    scaleRange: [1.1, 1.8],
    tiltRange: [-3, 3],
    yawJitter: Math.PI * 0.2,
  });
  spireGroup.children.forEach((child) => {
    child.rotation.z = randomInRange(-6, 6) * DEG2RAD;
  });
  root.add(spireGroup);

  const archMaterial = new THREE.MeshStandardMaterial({
    color: 0xb25e34,
    roughness: 0.6,
    metalness: 0.07,
    emissive: 0x402012,
    emissiveIntensity: 0.12,
  });
  const archGroup = new THREE.Group();
  const archCount = 5;
  for (let i = 0; i < archCount; i += 1) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.22, 12, 48), archMaterial);
    const angle = (i / archCount) * Math.PI * 2 + randomInRange(-0.2, 0.2);
    const radius = propOrigin * randomInRange(0.5, 0.82);
    arch.position.set(
      Math.cos(angle) * radius,
      randomInRange(0.6, 1.2),
      Math.sin(angle) * radius,
    );
    arch.rotation.set(Math.PI / 2, randomInRange(-Math.PI, Math.PI), randomInRange(-0.25, 0.25));
    arch.scale.set(1.4, 1.4, 1.4);
    archGroup.add(arch);
  }
  root.add(archGroup);

  const dustMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc48c,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const dustRing = new THREE.Mesh(
    new THREE.RingGeometry(propOrigin * 0.65, propOrigin * 1.45, 64, 1),
    dustMaterial,
  );
  dustRing.rotation.x = -Math.PI / 2;
  dustRing.position.y = 0.25;
  root.add(dustRing);
}

function buildCityEnvironment({ THREE, root, propOrigin, terrainScale }) {
  const plazaMaterial = new THREE.MeshStandardMaterial({
    color: 0x122437,
    roughness: 0.4,
    metalness: 0.25,
  });
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(propOrigin * 0.4, propOrigin * 0.48, 0.6, 36, 1, true),
    plazaMaterial,
  );
  plaza.rotation.x = Math.PI;
  plaza.position.y = -0.72;
  root.add(plaza);

  const towerMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e2f4c,
    metalness: 0.58,
    roughness: 0.28,
    emissive: 0x10213a,
    emissiveIntensity: 0.36,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x74d4ff,
    transparent: true,
    opacity: 0.22,
  });

  const createTower = (height, widthScale = 1) => {
    const group = new THREE.Group();
    const width = 0.5 * widthScale;
    const depth = 0.5 * widthScale;
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), towerMaterial.clone());
    body.position.y = height / 2;
    group.add(body);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.05, height * 0.92, depth * 1.05),
      glowMaterial.clone(),
    );
    glow.position.y = height / 2;
    group.add(glow);
    return group;
  };

  const tallTower = createTower(3.4, 1.05);
  const mediumTower = createTower(2.4, 0.85);
  const shortTower = createTower(1.6, 0.7);

  const tallGroup = createScatterGroup(THREE, {
    count: 12,
    baseObject: tallTower,
    radiusRange: [propOrigin * 0.5, propOrigin * 0.95],
    heightRange: [-0.4, 0.4],
    scaleRange: [1, 1.28],
    tiltRange: [-1, 1],
    yawJitter: Math.PI,
  });
  root.add(tallGroup);

  const mediumGroup = createScatterGroup(THREE, {
    count: 16,
    baseObject: mediumTower,
    radiusRange: [propOrigin * 0.35, propOrigin * 0.9],
    heightRange: [-0.38, 0.22],
    scaleRange: [0.9, 1.1],
    tiltRange: [-1.5, 1.5],
    yawJitter: Math.PI,
  });
  root.add(mediumGroup);

  const shortGroup = createScatterGroup(THREE, {
    count: 18,
    baseObject: shortTower,
    radiusRange: [propOrigin * 0.25, propOrigin * 0.8],
    heightRange: [-0.32, 0.16],
    scaleRange: [0.8, 1.2],
    tiltRange: [-2, 2],
    yawJitter: Math.PI,
  });
  root.add(shortGroup);

  const antennaMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f7ad4,
    emissive: 0x2b4c92,
    emissiveIntensity: 0.6,
    roughness: 0.35,
    metalness: 0.65,
  });
  const antennaPrototype = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.9, 12),
    antennaMaterial,
  );
  antennaPrototype.position.y = 0.45;
  const antennaGroup = createScatterGroup(THREE, {
    count: 24,
    baseObject: antennaPrototype,
    radiusRange: [propOrigin * 0.35, propOrigin * 1.05],
    heightRange: [1.2, 2.6],
    scaleRange: [1, 1.4],
    tiltRange: [-4, 4],
    yawJitter: Math.PI,
  });
  root.add(antennaGroup);

  const hoverMaterial = new THREE.MeshStandardMaterial({
    color: 0x6cc4ff,
    emissive: 0x1e3a66,
    emissiveIntensity: 0.75,
    metalness: 0.4,
    roughness: 0.2,
    transparent: true,
    opacity: 0.7,
  });
  const hoverCraft = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 12, 32), hoverMaterial);
  const hoverGroup = createScatterGroup(THREE, {
    count: 14,
    baseObject: hoverCraft,
    radiusRange: [propOrigin * 0.65, propOrigin * 1.35],
    heightRange: [1.2, 2.4],
    scaleRange: [0.8, 1.2],
    tiltRange: [-6, 6],
    yawJitter: Math.PI,
  });
  root.add(hoverGroup);

  const skylineMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2d45,
    emissive: 0x0a1a30,
    emissiveIntensity: 0.2,
    roughness: 0.8,
    metalness: 0.15,
  });
  const skyline = new THREE.Mesh(
    new THREE.CylinderGeometry(terrainScale * 0.95, terrainScale * 0.95, 2.4, 40, 1, true),
    skylineMaterial,
  );
  skyline.rotation.x = Math.PI;
  skyline.position.y = -5.8;
  root.add(skyline);
}

function buildMountainEnvironment({ THREE, root, propOrigin, terrainScale, spaceScale }) {
  const ridgeMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d5662,
    roughness: 0.86,
    metalness: 0.08,
    flatShading: true,
  });
  const snowMaterial = new THREE.MeshStandardMaterial({
    color: 0xe6f1ff,
    emissive: 0x93b8ff,
    emissiveIntensity: 0.18,
    roughness: 0.35,
    metalness: 0.08,
  });

  const peakPrototype = new THREE.Group();
  const ridge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.92, 1.8, 8, 2, false),
    ridgeMaterial,
  );
  ridge.position.y = 0.9;
  peakPrototype.add(ridge);
  const snow = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.68, 8), snowMaterial);
  snow.position.y = 1.68;
  peakPrototype.add(snow);

  const peakGroup = createScatterGroup(THREE, {
    count: 18,
    baseObject: peakPrototype,
    radiusRange: [propOrigin * 0.55, propOrigin * 1.2],
    heightRange: [-0.35, 0.65],
    scaleRange: [2.1, 3.4],
    tiltRange: [-5, 5],
    yawJitter: Math.PI * 0.4,
  });
  peakGroup.position.y = -0.6;
  root.add(peakGroup);

  const pinePrototype = new THREE.Group();
  const pineTrunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.12, 0.48, 7),
    new THREE.MeshStandardMaterial({
      color: 0x2e3b2b,
      roughness: 0.78,
      metalness: 0.06,
      emissive: 0x0c120e,
      emissiveIntensity: 0.14,
    }),
  );
  pineTrunk.position.y = 0.24;
  pinePrototype.add(pineTrunk);
  const pineCanopy = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.72, 9),
    new THREE.MeshStandardMaterial({
      color: 0x3b6b45,
      emissive: 0x1d3322,
      emissiveIntensity: 0.18,
      roughness: 0.62,
      metalness: 0.08,
    }),
  );
  pineCanopy.position.y = 0.72;
  pinePrototype.add(pineCanopy);

  const pineGroup = createScatterGroup(THREE, {
    count: 36,
    baseObject: pinePrototype,
    radiusRange: [propOrigin * 0.6, propOrigin * 1.2],
    heightRange: [-0.48, 0.12],
    scaleRange: [1.2, 1.9],
    tiltRange: [-6, 6],
  });
  pineGroup.position.y = -0.5;
  root.add(pineGroup);

  const boulderMaterial = new THREE.MeshStandardMaterial({
    color: 0x404853,
    roughness: 0.88,
    metalness: 0.05,
    flatShading: true,
  });
  const boulderPrototype = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), boulderMaterial);
  const boulderGroup = createScatterGroup(THREE, {
    count: 24,
    baseObject: boulderPrototype,
    radiusRange: [propOrigin * 0.5, propOrigin * 1.05],
    heightRange: [-0.5, -0.25],
    scaleRange: [0.9, 1.6],
    tiltRange: [-8, 8],
    yawJitter: Math.PI * 0.5,
  });
  boulderGroup.children.forEach((child) => {
    child.rotation.y += randomInRange(-Math.PI, Math.PI);
  });
  root.add(boulderGroup);

  const mistMaterial = new THREE.MeshBasicMaterial({
    color: 0xdce9f9,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mistRing = new THREE.Mesh(
    new THREE.RingGeometry(propOrigin * 0.55, propOrigin * 1.3, 72, 1),
    mistMaterial,
  );
  mistRing.rotation.x = -Math.PI / 2;
  mistRing.position.y = 0.18;
  root.add(mistRing);

  const floatingIce = new THREE.Mesh(
    new THREE.CircleGeometry(propOrigin * 0.42, 18),
    new THREE.MeshBasicMaterial({
      color: 0xbfd4e8,
      transparent: true,
      opacity: 0.32,
    }),
  );
  floatingIce.rotation.x = -Math.PI / 2;
  floatingIce.position.y = -0.4;
  root.add(floatingIce);
}

const ENVIRONMENT_VARIANTS = [
  {
    id: "forest",
    label: "Forest",
    spaceScale: 3.15,
    propSpread: 6.8,
    terrainScale: 118,
    backgroundColor: 0x071422,
    fogColor: 0x0a1b2e,
    fogNear: 24,
    fogFar: 160,
    sky: { top: 0x4d80c0, bottom: 0x071323, glow: 0.28 },
    hazeColor: 0x112a3f,
    hazeLayers: [
      { radius: 44, height: 26, opacity: 0.2 },
      { radius: 58, height: 30, opacity: 0.16 },
      { radius: 70, height: 34, opacity: 0.12 },
    ],
    groundColor: 0x123324,
    floor: { color: 0x1e5f3c, opacity: 0.82 },
    trail: { color: 0x49b088, opacity: 0.46 },
    anchor: { color: 0x2c556e, opacity: 0.94 },
    lighting: {
      ambient: { sky: 0xd4f1ff, ground: 0x1a2f32, intensity: 0.92 },
      key: { color: 0xf3f0d2, intensity: 1.2, position: [7.5, 8.2, 5.2] },
      rim: { color: 0x78b6ff, intensity: 0.48, position: [-6.2, 5.1, -5.4] },
      fill: { color: 0x9fc8ff, intensity: 0.38, position: [1.2, 3.1, -6.2] },
      glow: { color: 0x63d0ff, intensity: 1.35, distance: 12, decay: 2.1, position: [0.3, 1.6, 0.8] },
    },
    builder: buildForestEnvironment,
  },
  {
    id: "canyons",
    label: "Canyons",
    spaceScale: 3.4,
    propSpread: 7.6,
    terrainScale: 134,
    backgroundColor: 0x1e0f0d,
    fogColor: 0x2b150f,
    fogNear: 28,
    fogFar: 185,
    sky: { top: 0xf8b274, bottom: 0x2a080a, glow: 0.34 },
    hazeColor: 0x3c1b12,
    hazeLayers: [
      { radius: 48, height: 26, opacity: 0.22 },
      { radius: 64, height: 32, opacity: 0.18 },
      { radius: 78, height: 36, opacity: 0.14 },
    ],
    groundColor: 0x4a2518,
    floor: { color: 0x6e3520, opacity: 0.78 },
    trail: { color: 0xff9a63, opacity: 0.54 },
    anchor: { color: 0x7c4126, opacity: 0.88 },
    lighting: {
      ambient: { sky: 0xffd5b0, ground: 0x32170b, intensity: 0.96 },
      key: { color: 0xffbe85, intensity: 1.45, position: [6.4, 8.3, 4.6] },
      rim: { color: 0xff7f4f, intensity: 0.58, position: [-6.8, 4.1, -4.8] },
      fill: { color: 0xffc9a4, intensity: 0.34, position: [2.2, 3, -7.1] },
      glow: { color: 0xffa05e, intensity: 1.5, distance: 14, decay: 2.6, position: [1, 2.1, 0.4] },
    },
    builder: buildCanyonEnvironment,
  },
  {
    id: "mountain",
    label: "Mountains",
    spaceScale: 3.3,
    propSpread: 7.4,
    terrainScale: 132,
    backgroundColor: 0x0b1521,
    fogColor: 0x0f1f2f,
    fogNear: 24,
    fogFar: 182,
    sky: { top: 0x6da0df, bottom: 0x08121f, glow: 0.32 },
    hazeColor: 0x1a2f42,
    hazeLayers: [
      { radius: 46, height: 26, opacity: 0.19 },
      { radius: 60, height: 30, opacity: 0.15 },
      { radius: 74, height: 34, opacity: 0.12 },
    ],
    groundColor: 0x1d2e2f,
    floor: { color: 0x24424b, opacity: 0.84 },
    trail: { color: 0x7fd5ff, opacity: 0.5 },
    anchor: { color: 0x315a6b, opacity: 0.92 },
    lighting: {
      ambient: { sky: 0xc6e3ff, ground: 0x112028, intensity: 1.02 },
      key: { color: 0xeaf4ff, intensity: 1.32, position: [7.6, 8.5, 5.4] },
      rim: { color: 0x81c5ff, intensity: 0.52, position: [-6.4, 5, -5.2] },
      fill: { color: 0x99c9ff, intensity: 0.4, position: [1.6, 3.4, -6.6] },
      glow: { color: 0x88d1ff, intensity: 1.55, distance: 13, decay: 2.2, position: [0.4, 2, 0.6] },
    },
    builder: buildMountainEnvironment,
  },
  {
    id: "city",
    label: "City",
    spaceScale: 3.25,
    propSpread: 7.2,
    terrainScale: 126,
    backgroundColor: 0x050a16,
    fogColor: 0x0b1524,
    fogNear: 22,
    fogFar: 175,
    sky: { top: 0x6b96ff, bottom: 0x040910, glow: 0.36 },
    hazeColor: 0x162740,
    hazeLayers: [
      { radius: 46, height: 26, opacity: 0.18 },
      { radius: 60, height: 30, opacity: 0.15 },
      { radius: 72, height: 34, opacity: 0.12 },
    ],
    groundColor: 0x0d1b2e,
    floor: { color: 0x132d44, opacity: 0.86 },
    trail: { color: 0x69c8ff, opacity: 0.52 },
    anchor: { color: 0x1c3f62, opacity: 0.9 },
    lighting: {
      ambient: { sky: 0xc9e5ff, ground: 0x101a29, intensity: 1.05 },
      key: { color: 0xf0f7ff, intensity: 1.28, position: [8.2, 9.1, 6.4] },
      rim: { color: 0x4fb7ff, intensity: 0.64, position: [-6.9, 5.5, -5.9] },
      fill: { color: 0x9bd5ff, intensity: 0.45, position: [1.4, 3.8, -7.6] },
      glow: { color: 0x7fd8ff, intensity: 1.7, distance: 15, decay: 2.2, position: [0.2, 2.4, 1.1] },
    },
    builder: buildCityEnvironment,
  },
];

const VARIANT_LOOKUP = new Map(ENVIRONMENT_VARIANTS.map((variant) => [variant.id, variant]));

export function getEnvironmentDefinition(id) {
  return VARIANT_LOOKUP.get(id) ?? ENVIRONMENT_VARIANTS[0];
}

export function createWorldShell(
  scene,
  { options = {}, three, variant } = {},
) {
  const THREE = three ?? THREEImported;
  const definition = getEnvironmentDefinition(variant);
  const spaceScale = definition.spaceScale ?? BASE_SPACE_SCALE;
  const propSpread = definition.propSpread ?? 6.2;
  const terrainScale = definition.terrainScale ?? 110;

  const baseOptions = {
    floor: { ...DEFAULT_OPTIONS.floor, ...definition.floor },
    trail: { ...DEFAULT_OPTIONS.trail, ...definition.trail },
    anchor: { ...DEFAULT_OPTIONS.anchor, ...definition.anchor },
    haze: { ...DEFAULT_OPTIONS.haze, ...definition.haze },
  };
  const mergedOptions = {
    floor: { ...baseOptions.floor, ...options.floor },
    trail: { ...baseOptions.trail, ...options.trail },
    anchor: { ...baseOptions.anchor, ...options.anchor },
    haze: { ...baseOptions.haze, ...options.haze },
  };

  const fogColor = new THREE.Color(definition.fogColor ?? 0x0a1426);
  const backgroundColor = new THREE.Color(definition.backgroundColor ?? definition.fogColor ?? 0x0a1426);
  const fogNear = definition.fogNear ?? 24;
  const fogFar = definition.fogFar ?? 150;

  if (scene.fog) {
    scene.fog.color.copy(fogColor);
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;
  } else {
    scene.fog = new THREE.Fog(fogColor.getHex(), fogNear, fogFar);
  }

  if (scene.background && scene.background.isColor) {
    scene.background.copy(backgroundColor);
  } else {
    scene.background = backgroundColor.clone();
  }

  const root = new THREE.Group();
  root.name = `world-shell-${definition.id}`;
  scene.add(root);

  const skyGeometry = new THREE.SphereGeometry(70 * spaceScale, 64, 48);
  let skyMaterial;
  try {
    skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(definition.sky?.top ?? 0x2f4f86) },
        bottomColor: { value: new THREE.Color(definition.sky?.bottom ?? 0x08152a) },
        glowIntensity: { value: definition.sky?.glow ?? 0.24 },
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
  } catch (shaderError) {
    // Fallback to simple material if shader compilation fails (common on mobile)
    skyMaterial = new THREE.MeshBasicMaterial({
      color: definition.sky?.top ?? 0x2f4f86,
      side: THREE.BackSide,
      fog: false,
    });
  }
  const skydome = new THREE.Mesh(skyGeometry, skyMaterial);
  skydome.renderOrder = -5;
  root.add(skydome);

  const hazeGroup = new THREE.Group();
  const hazeLayers = (definition.hazeLayers ?? DEFAULT_HAZE_LAYERS).map((layer) => ({
    radius: layer.radius * spaceScale,
    height: layer.height * spaceScale,
    opacity: layer.opacity,
  }));

  hazeLayers.forEach((layer, index) => {
    const hazeGeometry = new THREE.CylinderGeometry(layer.radius, layer.radius, layer.height, 32, 1, true);
    const hazeMaterial = new THREE.MeshBasicMaterial({
      color: mergedOptions.haze.color,
      transparent: true,
      opacity: layer.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hazeMesh = new THREE.Mesh(hazeGeometry, hazeMaterial);
    hazeMesh.position.y = -layer.height * 0.25 + index * 0.8;
    hazeGroup.add(hazeMesh);
  });
  hazeGroup.position.y = -3.6;
  root.add(hazeGroup);

  const trailGeometry = new THREE.TorusGeometry(2.3 * spaceScale, 0.024 * spaceScale, 20, 140);
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: mergedOptions.trail.color,
    transparent: true,
    opacity: mergedOptions.trail.opacity,
  });
  const glideTrail = new THREE.Mesh(trailGeometry, trailMaterial);
  glideTrail.rotation.x = Math.PI / 2;
  root.add(glideTrail);

  const groundGeometry = new THREE.CylinderGeometry(3.9 * spaceScale, 5.8 * spaceScale, 1.4, 40, 2, true);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: definition.groundColor ?? 0x1e3254,
    roughness: 0.78,
    metalness: 0.16,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const groundShell = new THREE.Mesh(groundGeometry, groundMaterial);
  groundShell.rotation.x = Math.PI;
  groundShell.position.y = -1.35;
  root.add(groundShell);

  const floorGeometry = new THREE.CircleGeometry(3.6 * spaceScale, 64);
  const floorMaterial = new THREE.MeshBasicMaterial({
    color: mergedOptions.floor.color,
    transparent: true,
    opacity: mergedOptions.floor.opacity,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.52;
  root.add(floor);

  const anchorGeometry = new THREE.TetrahedronGeometry(0.36, 0);
  const anchorMaterial = new THREE.MeshStandardMaterial({
    color: mergedOptions.anchor.color,
    transparent: true,
    opacity: mergedOptions.anchor.opacity,
    roughness: 0.58,
    metalness: 0.12,
  });

  const anchorCount = 32;
  const anchors = new THREE.InstancedMesh(anchorGeometry, anchorMaterial, anchorCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < anchorCount; i += 1) {
    const radius = (5 + Math.random() * 12) * spaceScale;
    const angle = Math.random() * Math.PI * 2;
    const height = -0.2 + Math.random() * 3.8;
    dummy.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const scale = 0.6 + Math.random() * 0.9;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    anchors.setMatrixAt(i, dummy.matrix);
  }
  anchors.instanceMatrix.needsUpdate = true;
  root.add(anchors);

  const builder = definition.builder;
  if (typeof builder === "function") {
    try {
      builder({
        THREE,
        root,
        config: definition,
        propOrigin: propSpread * spaceScale,
        terrainScale: terrainScale * spaceScale,
        spaceScale,
      });
    } catch (builderError) {
      // Environment props failed to build - base scene will still render
      console.warn("Environment builder failed:", builderError);
    }
  }

  return {
    root,
    glideTrail,
    config: definition,
    dispose() {
      disposeWorld(scene, root);
    },
  };
}

export { ENVIRONMENT_VARIANTS };
