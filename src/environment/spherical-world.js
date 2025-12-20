import * as THREEImported from "https://esm.sh/three@0.161.0";

const DEG2RAD = Math.PI / 180;

// Current flat world has diameter of ~23 units (3.6 * spaceScale * 2)
// Circumference should be 8x that diameter = ~184 units
// radius = circumference / (2π) ≈ 29.3 units
const SPHERE_RADIUS = 30;

// Collision detection helper
export class SphericalCollisionSystem {
  constructor(sphereRadius, objectColliders = []) {
    this.sphereRadius = sphereRadius;
    this.objectColliders = objectColliders;
    this._tempVec = null;
  }

  _ensureVec(THREE) {
    if (!this._tempVec) {
      this._tempVec = new THREE.Vector3();
    }
    return this._tempVec;
  }

  // Add a collidable object (trees, rocks, etc.)
  addCollider(position, radius, type = 'object') {
    this.objectColliders.push({ position: position.clone(), radius, type });
  }

  // Clear all object colliders
  clearColliders() {
    this.objectColliders = [];
  }

  // Check collision with sphere ground - returns corrected position if collision
  checkGroundCollision(THREE, position, entityRadius = 0.5) {
    const vec = this._ensureVec(THREE);
    const distanceFromCenter = position.length();
    const minAltitude = this.sphereRadius + entityRadius;

    if (distanceFromCenter < minAltitude) {
      // Bird is below ground - push it up to surface
      vec.copy(position).normalize().multiplyScalar(minAltitude);
      return { collided: true, correctedPosition: vec.clone(), normal: position.clone().normalize() };
    }

    return { collided: false, correctedPosition: null, normal: null };
  }

  // Check collision with objects on the sphere
  checkObjectCollision(THREE, position, entityRadius = 0.5) {
    const vec = this._ensureVec(THREE);

    for (const collider of this.objectColliders) {
      vec.copy(position).sub(collider.position);
      const distance = vec.length();
      const minDistance = collider.radius + entityRadius;

      if (distance < minDistance) {
        // Collision detected - push entity away from object
        const pushDirection = vec.normalize();
        const correctedPosition = collider.position.clone().add(
          pushDirection.multiplyScalar(minDistance)
        );
        return {
          collided: true,
          correctedPosition,
          colliderType: collider.type,
          normal: pushDirection.clone()
        };
      }
    }

    return { collided: false, correctedPosition: null, colliderType: null, normal: null };
  }

  // Combined collision check
  checkAllCollisions(THREE, position, velocity, entityRadius = 0.5) {
    let finalPosition = position.clone();
    let finalVelocity = velocity.clone();
    let hadCollision = false;

    // Check ground collision first
    const groundResult = this.checkGroundCollision(THREE, finalPosition, entityRadius);
    if (groundResult.collided) {
      finalPosition.copy(groundResult.correctedPosition);
      hadCollision = true;

      // Reflect velocity off the ground with damping
      // Standard reflection: v' = v - 2(v·n)n
      // With restitution (0.3 = 30% bounce): v' = v - (1 + restitution)(v·n)n
      const normal = groundResult.normal;
      const dot = finalVelocity.dot(normal);
      if (dot < 0) {
        // Moving into ground - reflect with damping (0.3 restitution = soft bounce)
        const restitution = 0.3;
        finalVelocity.addScaledVector(normal, -(1 + restitution) * dot);
      }
    }

    // Check object collisions
    const objectResult = this.checkObjectCollision(THREE, finalPosition, entityRadius);
    if (objectResult.collided) {
      finalPosition.copy(objectResult.correctedPosition);
      hadCollision = true;

      // Reflect velocity off the object with damping
      const normal = objectResult.normal;
      const dot = finalVelocity.dot(normal);
      if (dot < 0) {
        // Moving into object - reflect with damping (0.2 restitution = softer bounce)
        const restitution = 0.2;
        finalVelocity.addScaledVector(normal, -(1 + restitution) * dot);
      }
    }

    return {
      position: finalPosition,
      velocity: finalVelocity,
      hadCollision
    };
  }
}

// Helper to place objects on sphere surface
function placeOnSphere(THREE, radius, theta, phi, heightOffset = 0) {
  const r = radius + heightOffset;
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

// Helper to orient object to face outward from sphere center
function orientToSurfaceNormal(object, position) {
  const up = position.clone().normalize();
  object.up.copy(up);
  object.lookAt(position.clone().multiplyScalar(2));
}

// Create uniformly distributed points on a sphere using fibonacci spiral
function fibonacciSpherePoints(count, radius) {
  const points = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    const theta = 2 * Math.PI * i / goldenRatio;
    const phi = Math.acos(1 - 2 * (i + 0.5) / count);

    points.push({
      theta,
      phi,
      position: {
        x: radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.cos(phi),
        z: radius * Math.sin(phi) * Math.sin(theta)
      }
    });
  }

  return points;
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

// Build forest environment objects on sphere
function buildForestOnSphere({ THREE, root, sphereRadius, collisionSystem }) {
  // Trees - distributed across sphere
  const treeCount = 180;
  const treePoints = fibonacciSpherePoints(treeCount, sphereRadius);

  const treeGroup = new THREE.Group();
  treeGroup.name = 'forest-trees';

  treePoints.forEach((point, i) => {
    // Add some random offset to position
    const jitterTheta = point.theta + randomInRange(-0.1, 0.1);
    const jitterPhi = point.phi + randomInRange(-0.05, 0.05);

    const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, 0);

    const tree = new THREE.Group();

    // Trunk - doubled size for bigger world feel
    const trunkHeight = randomInRange(1.2, 2.0);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.28, trunkHeight, 7),
      new THREE.MeshStandardMaterial({
        color: 0x324b38,
        roughness: 0.78,
        metalness: 0.06,
        emissive: 0x0c1a12,
        emissiveIntensity: 0.3,
      })
    );
    trunk.position.y = trunkHeight / 2;
    tree.add(trunk);

    // Canopy - doubled size for bigger world feel
    const canopyHeight = randomInRange(1.6, 2.4);
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.84, canopyHeight, 9),
      new THREE.MeshStandardMaterial({
        color: 0x2f7a4d,
        emissive: 0x163e26,
        emissiveIntensity: 0.35,
        roughness: 0.62,
        metalness: 0.08,
      })
    );
    canopy.position.y = trunkHeight + canopyHeight / 2 - 0.1;
    tree.add(canopy);

    // Position and orient tree
    tree.position.copy(pos);

    // Orient to surface normal
    const up = pos.clone().normalize();
    const rotMatrix = new THREE.Matrix4();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    tree.quaternion.copy(quaternion);

    // Random scale - doubled base for bigger world feel
    const scale = randomInRange(1.6, 2.8);
    tree.scale.setScalar(scale);

    treeGroup.add(tree);

    // Add collision for tree - doubled radius
    const treeCollisionRadius = 0.6 * scale;
    collisionSystem.addCollider(pos, treeCollisionRadius, 'tree');
  });

  root.add(treeGroup);

  // Shrubs - more distributed
  const shrubCount = 220;
  const shrubPoints = fibonacciSpherePoints(shrubCount, sphereRadius);

  const shrubGroup = new THREE.Group();
  shrubGroup.name = 'forest-shrubs';

  shrubPoints.forEach((point, i) => {
    const jitterTheta = point.theta + randomInRange(-0.15, 0.15);
    const jitterPhi = point.phi + randomInRange(-0.08, 0.08);

    const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, 0);

    const shrub = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0x3e8a58,
        roughness: 0.55,
        metalness: 0.05,
        emissive: 0x1a4227,
        emissiveIntensity: 0.2,
      })
    );

    shrub.position.copy(pos);
    shrub.scale.set(1, 0.75, 1);

    // Orient to surface
    const up = pos.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    shrub.quaternion.copy(quaternion);

    const scale = randomInRange(1.2, 2.4);
    shrub.scale.multiplyScalar(scale);

    shrubGroup.add(shrub);

    // Add small collision for shrubs - doubled
    collisionSystem.addCollider(pos, 0.3 * scale, 'shrub');
  });

  root.add(shrubGroup);

  // Rocks
  const rockCount = 140;
  const rockPoints = fibonacciSpherePoints(rockCount, sphereRadius);

  const rockGroup = new THREE.Group();
  rockGroup.name = 'forest-rocks';

  rockPoints.forEach((point, i) => {
    const jitterTheta = point.theta + randomInRange(-0.2, 0.2);
    const jitterPhi = point.phi + randomInRange(-0.1, 0.1);

    const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, -0.05);

    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.48, 0),
      new THREE.MeshStandardMaterial({
        color: 0x24343f,
        roughness: 0.9,
        metalness: 0.05,
        flatShading: true,
        emissive: 0x121a1f,
        emissiveIntensity: 0.15,
      })
    );

    rock.position.copy(pos);

    // Random rotation
    rock.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    const scale = randomInRange(1.0, 2.4);
    rock.scale.setScalar(scale);

    rockGroup.add(rock);

    // Add collision for rocks - doubled
    collisionSystem.addCollider(pos, 0.4 * scale, 'rock');
  });

  root.add(rockGroup);

  // Clouds - floating above surface
  const cloudCount = 50;
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'forest-clouds';

  for (let i = 0; i < cloudCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const cloudHeight = randomInRange(8, 20);

    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, cloudHeight);

    const cloud = new THREE.Group();
    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xdfeeff,
      emissive: 0x28486c,
      emissiveIntensity: 0.15,
      roughness: 0.28,
      metalness: 0.02,
      transparent: true,
      opacity: 0.78,
    });

    // Create cloud puffs - doubled size
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.88 + Math.random() * 0.56, 14, 12),
        cloudMaterial
      );
      puff.position.set(
        randomInRange(-0.96, 0.96),
        randomInRange(-0.24, 0.48),
        j * 0.96 * (Math.random() > 0.5 ? 1 : -1)
      );
      cloud.add(puff);
    }

    cloud.position.copy(pos);

    // Orient cloud to face outward
    const up = pos.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    cloud.quaternion.copy(quaternion);

    const scale = randomInRange(1.2, 2.6);
    cloud.scale.setScalar(scale);

    cloudGroup.add(cloud);
  }

  root.add(cloudGroup);
}

// Build canyon environment objects on sphere
function buildCanyonOnSphere({ THREE, root, sphereRadius, collisionSystem }) {
  // Spires - tall rock formations
  const spireCount = 120;
  const spirePoints = fibonacciSpherePoints(spireCount, sphereRadius);

  const spireGroup = new THREE.Group();
  spireGroup.name = 'canyon-spires';

  spirePoints.forEach((point, i) => {
    const jitterTheta = point.theta + randomInRange(-0.1, 0.1);
    const jitterPhi = point.phi + randomInRange(-0.05, 0.05);

    const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, 0);

    const height = randomInRange(4, 10);
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 1.2, height, 10, 1, false),
      new THREE.MeshStandardMaterial({
        color: 0x8b4728,
        roughness: 0.65,
        metalness: 0.08,
        emissive: 0x2e130a,
        emissiveIntensity: 0.25,
        flatShading: true,
      })
    );

    spire.position.copy(pos);

    // Move spire so base is at surface
    const up = pos.clone().normalize();
    spire.position.addScaledVector(up, height / 2);

    // Orient to surface
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    spire.quaternion.copy(quaternion);

    // Slight random tilt
    spire.rotateX(randomInRange(-0.1, 0.1));
    spire.rotateZ(randomInRange(-0.1, 0.1));

    const scale = randomInRange(1.6, 2.8);
    spire.scale.setScalar(scale);

    spireGroup.add(spire);

    // Add collision for spire - doubled
    collisionSystem.addCollider(pos, 1.0 * scale, 'spire');
  });

  root.add(spireGroup);

  // Arches
  const archCount = 30;
  const archGroup = new THREE.Group();
  archGroup.name = 'canyon-arches';

  for (let i = 0; i < archCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());

    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, 3.0);

    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(2.8, 0.44, 12, 48),
      new THREE.MeshStandardMaterial({
        color: 0xb25e34,
        roughness: 0.6,
        metalness: 0.07,
        emissive: 0x402012,
        emissiveIntensity: 0.2,
      })
    );

    arch.position.copy(pos);

    // Orient arch
    const up = pos.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    arch.quaternion.copy(quaternion);

    // Rotate arch to stand upright on surface
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(Math.random() * Math.PI);

    const scale = randomInRange(1.6, 3.2);
    arch.scale.setScalar(scale);

    archGroup.add(arch);

    // Add collision for arch (simplified as a point) - doubled
    collisionSystem.addCollider(pos, 2.0 * scale, 'arch');
  }

  root.add(archGroup);

  // Boulders
  const boulderCount = 160;
  const boulderPoints = fibonacciSpherePoints(boulderCount, sphereRadius);

  const boulderGroup = new THREE.Group();
  boulderGroup.name = 'canyon-boulders';

  boulderPoints.forEach((point, i) => {
    const jitterTheta = point.theta + randomInRange(-0.15, 0.15);
    const jitterPhi = point.phi + randomInRange(-0.08, 0.08);

    const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, -0.1);

    const boulder = new THREE.Mesh(
      new THREE.IcosahedronGeometry(randomInRange(0.6, 1.6), 0),
      new THREE.MeshStandardMaterial({
        color: 0x7a3c23,
        roughness: 0.8,
        metalness: 0.04,
        flatShading: true,
        emissive: 0x3d1e11,
        emissiveIntensity: 0.15,
      })
    );

    boulder.position.copy(pos);
    boulder.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    const scale = randomInRange(1.2, 2.8);
    boulder.scale.setScalar(scale);

    boulderGroup.add(boulder);

    collisionSystem.addCollider(pos, 0.6 * scale, 'boulder');
  });

  root.add(boulderGroup);
}

// Build city environment objects on sphere
function buildCityOnSphere({ THREE, root, sphereRadius, collisionSystem }) {
  // Towers of varying heights
  const towerGroup = new THREE.Group();
  towerGroup.name = 'city-towers';

  const towerMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e2f4c,
    metalness: 0.58,
    roughness: 0.28,
    emissive: 0x10213a,
    emissiveIntensity: 0.45,
  });

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x74d4ff,
    transparent: true,
    opacity: 0.22,
  });

  // Tall towers
  const tallTowerCount = 80;
  const tallTowerPoints = fibonacciSpherePoints(tallTowerCount, sphereRadius);

  tallTowerPoints.forEach((point, i) => {
    const jitterTheta = point.theta + randomInRange(-0.08, 0.08);
    const jitterPhi = point.phi + randomInRange(-0.04, 0.04);

    const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, 0);

    const tower = new THREE.Group();
    const height = randomInRange(5.0, 9.0);
    const width = randomInRange(0.8, 1.4);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, width),
      towerMaterial.clone()
    );
    body.position.y = height / 2;
    tower.add(body);

    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.05, height * 0.92, width * 1.05),
      glowMaterial.clone()
    );
    glow.position.y = height / 2;
    tower.add(glow);

    tower.position.copy(pos);

    // Orient to surface
    const up = pos.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    tower.quaternion.copy(quaternion);

    const scale = randomInRange(1.6, 2.4);
    tower.scale.setScalar(scale);

    towerGroup.add(tower);

    // Add collision for tower - doubled
    collisionSystem.addCollider(pos, width * scale * 2, 'tower');
  });

  // Medium towers - also doubled
  const mediumTowerCount = 100;
  const mediumTowerPoints = fibonacciSpherePoints(mediumTowerCount, sphereRadius);

  mediumTowerPoints.forEach((point, i) => {
    const jitterTheta = point.theta + randomInRange(-0.1, 0.1) + 0.05;
    const jitterPhi = point.phi + randomInRange(-0.05, 0.05) + 0.03;

    const pos = placeOnSphere(THREE, sphereRadius, jitterTheta, jitterPhi, 0);

    const tower = new THREE.Group();
    const height = randomInRange(3.0, 5.6);
    const width = randomInRange(0.7, 1.1);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, width),
      towerMaterial.clone()
    );
    body.position.y = height / 2;
    tower.add(body);

    tower.position.copy(pos);

    const up = pos.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    tower.quaternion.copy(quaternion);

    const scale = randomInRange(1.4, 2.2);
    tower.scale.setScalar(scale);

    towerGroup.add(tower);

    collisionSystem.addCollider(pos, width * scale * 1.6, 'tower');
  });

  root.add(towerGroup);

  // Antennas
  const antennaCount = 150;
  const antennaGroup = new THREE.Group();
  antennaGroup.name = 'city-antennas';

  const antennaMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f7ad4,
    emissive: 0x2b4c92,
    emissiveIntensity: 0.7,
    roughness: 0.35,
    metalness: 0.65,
  });

  for (let i = 0; i < antennaCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const antennaHeight = randomInRange(3.0, 7.0);

    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, antennaHeight);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 1.8, 12),
      antennaMaterial
    );

    antenna.position.copy(pos);

    const up = pos.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    antenna.quaternion.copy(quaternion);

    const scale = randomInRange(1.6, 2.8);
    antenna.scale.setScalar(scale);

    antennaGroup.add(antenna);
  }

  root.add(antennaGroup);

  // Hover craft / flying vehicles
  const hoverCount = 80;
  const hoverGroup = new THREE.Group();
  hoverGroup.name = 'city-hover';

  const hoverMaterial = new THREE.MeshStandardMaterial({
    color: 0x6cc4ff,
    emissive: 0x1e3a66,
    emissiveIntensity: 0.85,
    metalness: 0.4,
    roughness: 0.2,
    transparent: true,
    opacity: 0.7,
  });

  for (let i = 0; i < hoverCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());
    const hoverHeight = randomInRange(6, 16);

    const pos = placeOnSphere(THREE, sphereRadius, theta, phi, hoverHeight);

    const hover = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.1, 12, 32),
      hoverMaterial
    );

    hover.position.copy(pos);

    const up = pos.clone().normalize();
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, up);
    hover.quaternion.copy(quaternion);

    // Make hover craft horizontal relative to surface
    hover.rotateX(Math.PI / 2);

    const scale = randomInRange(1.6, 2.8);
    hover.scale.setScalar(scale);

    hoverGroup.add(hover);
  }

  root.add(hoverGroup);
}

// Environment builder mapping
const SPHERE_BUILDERS = {
  forest: buildForestOnSphere,
  canyons: buildCanyonOnSphere,
  city: buildCityOnSphere,
};

export function createSphericalWorld(scene, { three, variant = 'forest', definition } = {}) {
  const THREE = three ?? THREEImported;

  const sphereRadius = SPHERE_RADIUS;
  const collisionSystem = new SphericalCollisionSystem(sphereRadius);

  const root = new THREE.Group();
  root.name = `spherical-world-${variant}`;
  scene.add(root);

  // Get colors from definition
  const groundColor = definition?.groundColor ?? 0x1e5f3c;
  const floorColor = definition?.floor?.color ?? 0x1e5f3c;
  const floorOpacity = definition?.floor?.opacity ?? 0.9;

  // Create the sphere ground
  const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 128, 96);
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: groundColor,
    roughness: 0.75,
    metalness: 0.1,
    emissive: new THREE.Color(groundColor).multiplyScalar(0.15),
    emissiveIntensity: 0.4,
    side: THREE.FrontSide,
  });

  const sphereGround = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphereGround.name = 'sphere-ground';
  root.add(sphereGround);

  // Add a subtle grid pattern on the sphere for visibility
  const gridGeometry = new THREE.SphereGeometry(sphereRadius + 0.02, 64, 48);
  const gridMaterial = new THREE.MeshBasicMaterial({
    color: floorColor,
    transparent: true,
    opacity: 0.15,
    wireframe: true,
  });
  const gridSphere = new THREE.Mesh(gridGeometry, gridMaterial);
  gridSphere.name = 'sphere-grid';
  root.add(gridSphere);

  // Multiple light sources to eliminate dark areas
  // Key light - main directional
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(50, 80, 50);
  root.add(keyLight);

  // Fill light - opposite side
  const fillLight = new THREE.DirectionalLight(0xaaccff, 0.6);
  fillLight.position.set(-50, -30, -50);
  root.add(fillLight);

  // Rim light - from below
  const rimLight = new THREE.DirectionalLight(0xffc9a4, 0.4);
  rimLight.position.set(0, -80, 30);
  root.add(rimLight);

  // Additional fill from another angle
  const fillLight2 = new THREE.DirectionalLight(0xd4f1ff, 0.5);
  fillLight2.position.set(60, -40, -60);
  root.add(fillLight2);

  // Another directional to cover remaining dark spots
  const fillLight3 = new THREE.DirectionalLight(0xffeedd, 0.4);
  fillLight3.position.set(-60, 40, 60);
  root.add(fillLight3);

  // Strong ambient hemisphere light for overall illumination
  const hemiLight = new THREE.HemisphereLight(0xd4f1ff, 0x1a4f32, 0.9);
  root.add(hemiLight);

  // Point light at center for inner glow
  const centerLight = new THREE.PointLight(0x63d0ff, 0.8, sphereRadius * 3);
  centerLight.position.set(0, 0, 0);
  root.add(centerLight);

  // Create sky sphere (large sphere surrounding the world)
  const skyRadius = sphereRadius * 6;
  const skyGeometry = new THREE.SphereGeometry(skyRadius, 64, 48);

  // Get sky colors from definition or use defaults
  const skyTop = definition?.sky?.top ?? 0x4d80c0;
  const skyBottom = definition?.sky?.bottom ?? 0x071323;

  let skyMaterial;
  try {
    skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(skyTop) },
        bottomColor: { value: new THREE.Color(skyBottom) },
        glowIntensity: { value: definition?.sky?.glow ?? 0.28 },
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
    // Fallback to simple material if shader compilation fails
    skyMaterial = new THREE.MeshBasicMaterial({
      color: skyTop,
      side: THREE.BackSide,
      fog: false,
    });
  }

  const skydome = new THREE.Mesh(skyGeometry, skyMaterial);
  skydome.name = 'sky-sphere';
  skydome.renderOrder = -5;
  root.add(skydome);

  // Build environment-specific objects
  const builder = SPHERE_BUILDERS[variant];
  if (typeof builder === 'function') {
    builder({
      THREE,
      root,
      sphereRadius,
      collisionSystem,
    });
  }

  return {
    root,
    sphereRadius,
    collisionSystem,
    dispose() {
      // Remove from scene first to prevent visual artifacts during environment switch
      scene.remove(root);

      // Then dispose geometries and materials
      try {
        root.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m && m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      } catch (e) {
        console.warn('Error disposing spherical world resources:', e);
      }
    }
  };
}

export { SPHERE_RADIUS };
