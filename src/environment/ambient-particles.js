/**
 * Ambient Particle Systems
 * Environment-specific particles for atmosphere and immersion
 */

/**
 * Create falling snow particles for mountain environment
 */
function createSnowParticles(THREE, count = 400) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const phases = [];

  const radius = 40;
  const height = 30;

  for (let i = 0; i < count; i++) {
    // Distribute in cylindrical volume
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * height - 5;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    velocities.push({
      x: (Math.random() - 0.5) * 0.3,
      y: -0.4 - Math.random() * 0.6,
      z: (Math.random() - 0.5) * 0.3,
    });

    phases.push(Math.random() * Math.PI * 2);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.08,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  particles.userData.phases = phases;
  particles.userData.radius = radius;
  particles.userData.height = height;

  return particles;
}

/**
 * Create falling leaves for forest environment
 */
function createLeafParticles(THREE, count = 200) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const rotations = [];
  const sizes = new Float32Array(count);

  const radius = 45;
  const height = 25;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * height - 2;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    velocities.push({
      x: (Math.random() - 0.5) * 0.4,
      y: -0.2 - Math.random() * 0.3,
      z: (Math.random() - 0.5) * 0.4,
      spin: (Math.random() - 0.5) * 2,
    });

    rotations.push(Math.random() * Math.PI * 2);
    sizes[i] = 0.12 + Math.random() * 0.08;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0x88cc66,
    size: 0.15,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    map: createLeafTexture(THREE),
    blending: THREE.NormalBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  particles.userData.rotations = rotations;
  particles.userData.radius = radius;
  particles.userData.height = height;

  return particles;
}

/**
 * Create fireflies for forest environment
 */
function createFireflies(THREE, count = 80) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const basePositions = [];
  const phases = [];

  const radius = 35;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * radius;
    const height = 1 + Math.random() * 12;

    const x = Math.cos(angle) * r;
    const y = height;
    const z = Math.sin(angle) * r;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    basePositions.push({ x, y, z });
    phases.push(Math.random() * Math.PI * 2);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffee88,
    size: 0.12,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.basePositions = basePositions;
  particles.userData.phases = phases;

  return particles;
}

/**
 * Create dust particles for canyon environment
 */
function createDustParticles(THREE, count = 300) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const sizes = new Float32Array(count);

  const radius = 50;
  const height = 20;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * height - 2;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    velocities.push({
      x: (Math.random() - 0.5) * 0.6,
      y: (Math.random() - 0.5) * 0.3,
      z: (Math.random() - 0.5) * 0.6,
    });

    sizes[i] = 0.1 + Math.random() * 0.15;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0xd4a574,
    size: 0.12,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  particles.userData.radius = radius;
  particles.userData.height = height;

  return particles;
}

/**
 * Create neon particles for city environment
 */
function createNeonParticles(THREE, count = 350) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const velocities = [];
  const phases = [];

  const radius = 55;
  const height = 35;

  const colorPalette = [
    { r: 0.4, g: 0.8, b: 1.0 }, // Cyan
    { r: 1.0, g: 0.3, b: 0.8 }, // Magenta
    { r: 0.3, g: 1.0, b: 0.5 }, // Green
    { r: 1.0, g: 0.9, b: 0.2 }, // Yellow
  ];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * height;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    velocities.push({
      x: (Math.random() - 0.5) * 0.8,
      y: 0.2 + Math.random() * 0.6,
      z: (Math.random() - 0.5) * 0.8,
    });

    phases.push(Math.random() * Math.PI * 2);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.1,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  particles.userData.phases = phases;
  particles.userData.radius = radius;
  particles.userData.height = height;

  return particles;
}

/**
 * Create light beams for city environment
 */
function createLightBeams(THREE, count = 12) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  const radius = 40;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const r = 15 + Math.random() * radius;

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(angle) * r;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x6ac8ff,
    size: 2.5,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  particles.userData.beams = true;

  return particles;
}

/**
 * Simple leaf texture generator
 */
function createLeafTexture(THREE) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, 32, 32);

  ctx.fillStyle = 'rgba(136, 204, 102, 1)';
  ctx.beginPath();
  ctx.ellipse(16, 16, 12, 6, 0.3, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * Update particle systems
 */
function updateParticles(particles, delta, time) {
  if (!particles || !particles.geometry) return;

  const positions = particles.geometry.attributes.position.array;
  const velocities = particles.userData.velocities;
  const radius = particles.userData.radius || 50;
  const height = particles.userData.height || 30;

  if (velocities) {
    // Standard velocity-based movement (snow, leaves, dust)
    for (let i = 0; i < velocities.length; i++) {
      positions[i * 3] += velocities[i].x * delta;
      positions[i * 3 + 1] += velocities[i].y * delta;
      positions[i * 3 + 2] += velocities[i].z * delta;

      // Wrap around when out of bounds
      if (positions[i * 3 + 1] < -5) {
        positions[i * 3 + 1] = height;
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        positions[i * 3] = Math.cos(angle) * r;
        positions[i * 3 + 2] = Math.sin(angle) * r;
      }

      // Add drift
      velocities[i].x += (Math.random() - 0.5) * 0.01;
      velocities[i].z += (Math.random() - 0.5) * 0.01;
    }

    particles.geometry.attributes.position.needsUpdate = true;
  } else if (particles.userData.basePositions) {
    // Fireflies with floating motion
    const basePositions = particles.userData.basePositions;
    const phases = particles.userData.phases;

    for (let i = 0; i < basePositions.length; i++) {
      const base = basePositions[i];
      const phase = phases[i] + time;

      positions[i * 3] = base.x + Math.sin(phase * 0.5) * 0.8;
      positions[i * 3 + 1] = base.y + Math.sin(phase * 0.7) * 0.6;
      positions[i * 3 + 2] = base.z + Math.cos(phase * 0.6) * 0.8;
    }

    particles.geometry.attributes.position.needsUpdate = true;

    // Pulse opacity
    particles.material.opacity = 0.6 + Math.sin(time * 2) * 0.3;
  } else if (particles.userData.beams) {
    // Light beams subtle movement
    particles.rotation.y += delta * 0.05;
  }
}

/**
 * Create ambient particles for environment
 */
export function createAmbientParticles(THREE, environmentId) {
  const systems = [];

  switch (environmentId) {
    case 'mountain':
      systems.push(createSnowParticles(THREE));
      break;

    case 'forest':
      systems.push(createLeafParticles(THREE));
      systems.push(createFireflies(THREE));
      break;

    case 'canyons':
      systems.push(createDustParticles(THREE));
      break;

    case 'city':
      systems.push(createNeonParticles(THREE));
      systems.push(createLightBeams(THREE));
      break;
  }

  return {
    systems,

    update(delta, time) {
      systems.forEach(particles => updateParticles(particles, delta, time));
    },

    addToScene(scene) {
      systems.forEach(system => scene.add(system));
    },

    removeFromScene(scene) {
      systems.forEach(system => scene.remove(system));
    },

    dispose() {
      systems.forEach(system => {
        if (system.geometry) system.geometry.dispose();
        if (system.material) {
          if (system.material.map) system.material.map.dispose();
          system.material.dispose();
        }
      });
    },
  };
}
