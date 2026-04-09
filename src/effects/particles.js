import * as THREE from "https://esm.sh/three@0.183.2";

const MAX_PARTICLES = 600;
const AMBIENT_COUNT = 80;

/**
 * Lightweight GPU particle system using THREE.Points
 */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.ambientParticles = null;
    this.ambientType = 'default';
    this.ambientTime = 0;

    // Shared texture - soft circle
    this.texture = this._createCircleTexture();
  }

  _createCircleTexture() {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Create an explosion burst at a position (drone destruction)
   */
  createExplosion(position, color = 0xff6633) {
    const count = 24;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    const lifetimes = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      // Random direction burst
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 3 + Math.random() * 8;
      velocities.push(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      );
      lifetimes.push(0.4 + Math.random() * 0.6);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: color,
      size: 0.8,
      map: this.texture,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    this.particles.push({
      type: 'explosion',
      points,
      geometry,
      material,
      velocities,
      lifetimes,
      maxLifetimes: [...lifetimes],
      age: 0,
      maxAge: Math.max(...lifetimes),
    });
  }

  /**
   * Create sparkle burst at position (ring collection)
   */
  createSparkle(position) {
    const count = 16;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    const lifetimes = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      const angle = (i / count) * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      const upward = 1 + Math.random() * 3;
      velocities.push(
        Math.cos(angle) * speed,
        upward,
        Math.sin(angle) * speed
      );
      lifetimes.push(0.5 + Math.random() * 0.5);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffd700,
      size: 0.5,
      map: this.texture,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    this.particles.push({
      type: 'sparkle',
      points,
      geometry,
      material,
      velocities,
      lifetimes,
      maxLifetimes: [...lifetimes],
      age: 0,
      maxAge: Math.max(...lifetimes),
    });
  }

  /**
   * Set ambient particle type based on environment
   */
  setAmbientType(envId) {
    this.ambientType = envId;

    // Dispose existing ambient particles
    if (this.ambientParticles) {
      this.scene.remove(this.ambientParticles.points);
      this.ambientParticles.geometry.dispose();
      this.ambientParticles.material.dispose();
      this.ambientParticles = null;
    }

    const configs = {
      forest: { color: 0xccff66, size: 0.25, spread: 40, height: 15, speed: 0.3 },
      canyons: { color: 0xff8844, size: 0.15, spread: 45, height: 20, speed: 0.15 },
      mountain: { color: 0xeeffff, size: 0.2, spread: 50, height: 25, speed: 0.5 },
      city: { color: 0x88ccff, size: 0.15, spread: 40, height: 20, speed: 0.2 },
    };

    const config = configs[envId] || configs.forest;
    const count = AMBIENT_COUNT;
    const positions = new Float32Array(count * 3);
    const basePositions = [];

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * config.spread;
      const y = Math.random() * config.height;
      const z = (Math.random() - 0.5) * config.spread;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      basePositions.push(x, y, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: config.color,
      size: config.size,
      map: this.texture,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    this.ambientParticles = {
      points,
      geometry,
      material,
      basePositions,
      config,
    };
  }

  /**
   * Update all particle systems
   */
  update(delta, cameraPosition) {
    // Update burst particles (explosions, sparkles)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += delta;

      if (p.age >= p.maxAge) {
        this.scene.remove(p.points);
        p.geometry.dispose();
        p.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      const posAttr = p.geometry.getAttribute('position');
      const count = posAttr.count;

      for (let j = 0; j < count; j++) {
        const lifeProgress = p.age / p.maxLifetimes[j];
        if (lifeProgress >= 1) continue;

        const vx = p.velocities[j * 3];
        const vy = p.velocities[j * 3 + 1];
        const vz = p.velocities[j * 3 + 2];

        // Apply velocity with drag
        const drag = Math.pow(0.96, delta * 60);
        p.velocities[j * 3] *= drag;
        p.velocities[j * 3 + 1] *= drag;
        p.velocities[j * 3 + 2] *= drag;

        posAttr.array[j * 3] += p.velocities[j * 3] * delta;
        posAttr.array[j * 3 + 1] += p.velocities[j * 3 + 1] * delta;
        posAttr.array[j * 3 + 2] += p.velocities[j * 3 + 2] * delta;

        // Gravity for explosions
        if (p.type === 'explosion') {
          p.velocities[j * 3 + 1] -= 4 * delta;
        }
      }

      posAttr.needsUpdate = true;
      p.material.opacity = Math.max(0, 1 - (p.age / p.maxAge));
      p.material.size *= (1 - delta * 0.5);
    }

    // Update ambient particles
    if (this.ambientParticles && cameraPosition) {
      this.ambientTime += delta;
      const ap = this.ambientParticles;
      const posAttr = ap.geometry.getAttribute('position');
      const speed = ap.config.speed;

      for (let i = 0; i < posAttr.count; i++) {
        const bx = ap.basePositions[i * 3];
        const by = ap.basePositions[i * 3 + 1];
        const bz = ap.basePositions[i * 3 + 2];

        // Gentle floating motion
        const t = this.ambientTime * speed + i * 1.7;
        posAttr.array[i * 3] = cameraPosition.x + bx + Math.sin(t * 0.7) * 2;
        posAttr.array[i * 3 + 1] = cameraPosition.y + by + Math.sin(t * 0.5 + i) * 1.5;
        posAttr.array[i * 3 + 2] = cameraPosition.z + bz + Math.cos(t * 0.6) * 2;
      }

      posAttr.needsUpdate = true;

      // Subtle pulsing opacity
      ap.material.opacity = 0.4 + Math.sin(this.ambientTime * 1.5) * 0.2;
    }

    // Cap active particle systems
    while (this.particles.length > 20) {
      const oldest = this.particles.shift();
      this.scene.remove(oldest.points);
      oldest.geometry.dispose();
      oldest.material.dispose();
    }
  }

  dispose() {
    for (const p of this.particles) {
      this.scene.remove(p.points);
      p.geometry.dispose();
      p.material.dispose();
    }
    this.particles = [];

    if (this.ambientParticles) {
      this.scene.remove(this.ambientParticles.points);
      this.ambientParticles.geometry.dispose();
      this.ambientParticles.material.dispose();
      this.ambientParticles = null;
    }

    if (this.texture) {
      this.texture.dispose();
    }
  }
}
