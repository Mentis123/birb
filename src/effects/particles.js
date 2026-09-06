import * as THREE from "https://esm.sh/three@0.183.2";

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
    this.suspended = false;

    // Shared texture - soft circle
    this.texture = this._createCircleTexture();

    // Pre-allocated whoosh streak pool — for proximity "flying past" cue.
    // 4 slots is plenty; streaks last ~0.35s and are at most rare per frame.
    this._whooshPoolSize = 4;
    this._whooshPool = [];
    this._whooshPerStreak = 10;
    this._initWhooshPool();
    this._initBurstPool();
  }

  _initWhooshPool() {
    for (let i = 0; i < this._whooshPoolSize; i++) {
      const count = this._whooshPerStreak;
      const positions = new Float32Array(count * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.55,
        map: this.texture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.visible = false;
      points.frustumCulled = false;
      this.scene.add(points);
      this._whooshPool.push({
        points,
        geometry,
        material,
        velocities: new Float32Array(count * 3),
        basePositions: new Float32Array(count * 3),
        active: false,
        age: 0,
        maxAge: 0.35,
      });
    }
  }

  /**
   * Trigger a whoosh streak near the bird when it flies close to a large prop.
   * origin: world-space point on the prop the bird is passing.
   * birdPos, birdForward: used to lay the streak along the bird's passing axis.
   * Fully pooled — no allocations per call.
   */
  createWhoosh(origin, birdPos, birdForward, tint = 0xdfeeff) {
    if (this.suspended) return;
    // Find a free slot
    let slot = null;
    for (let i = 0; i < this._whooshPool.length; i++) {
      if (!this._whooshPool[i].active) { slot = this._whooshPool[i]; break; }
    }
    if (!slot) return; // All streaks in flight — skip silently

    const count = this._whooshPerStreak;
    // Build a streak axis roughly along bird forward, offset to the side of origin.
    // We scatter points along a short line and give them a drift perpendicular
    // to forward so they read as "going past."
    const fx = birdForward.x, fy = birdForward.y, fz = birdForward.z;
    const ox = origin.x - birdPos.x, oy = origin.y - birdPos.y, oz = origin.z - birdPos.z;
    // Side vector = forward × (origin - bird), then normalize roughly
    let sx = fy * oz - fz * oy;
    let sy = fz * ox - fx * oz;
    let sz = fx * oy - fy * ox;
    const sl = Math.sqrt(sx*sx + sy*sy + sz*sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;

    const pos = slot.geometry.getAttribute('position').array;
    const vel = slot.velocities;
    const base = slot.basePositions;

    for (let i = 0; i < count; i++) {
      const t = (i / count - 0.5) * 6.0; // streak length ~6 units
      // start behind the bird a bit, along forward
      const px = birdPos.x + fx * t + sx * (Math.random() - 0.5) * 1.2;
      const py = birdPos.y + fy * t + sy * (Math.random() - 0.5) * 1.2;
      const pz = birdPos.z + fz * t + sz * (Math.random() - 0.5) * 1.2;
      pos[i * 3]     = px;
      pos[i * 3 + 1] = py;
      pos[i * 3 + 2] = pz;
      base[i * 3]     = px;
      base[i * 3 + 1] = py;
      base[i * 3 + 2] = pz;
      // Drift opposite to forward (streak trails behind) + slight outward push
      const driftSpeed = 14 + Math.random() * 8;
      vel[i * 3]     = -fx * driftSpeed + sx * 2;
      vel[i * 3 + 1] = -fy * driftSpeed + sy * 2;
      vel[i * 3 + 2] = -fz * driftSpeed + sz * 2;
    }

    slot.geometry.getAttribute('position').needsUpdate = true;
    slot.material.color.setHex(tint);
    slot.material.opacity = 0.85;
    slot.material.size = 0.55;
    slot.points.visible = true;
    slot.active = true;
    slot.age = 0;
  }

  _updateWhooshes(delta) {
    for (let i = 0; i < this._whooshPool.length; i++) {
      const slot = this._whooshPool[i];
      if (!slot.active) continue;
      slot.age += delta;
      if (slot.age >= slot.maxAge) {
        slot.active = false;
        slot.points.visible = false;
        continue;
      }
      const pos = slot.geometry.getAttribute('position').array;
      const vel = slot.velocities;
      const count = this._whooshPerStreak;
      for (let j = 0; j < count; j++) {
        pos[j * 3]     += vel[j * 3]     * delta;
        pos[j * 3 + 1] += vel[j * 3 + 1] * delta;
        pos[j * 3 + 2] += vel[j * 3 + 2] * delta;
        // Drag
        vel[j * 3]     *= 0.92;
        vel[j * 3 + 1] *= 0.92;
        vel[j * 3 + 2] *= 0.92;
      }
      slot.geometry.getAttribute('position').needsUpdate = true;
      const lifeT = slot.age / slot.maxAge;
      slot.material.opacity = Math.max(0, 0.85 * (1 - lifeT));
      slot.material.size = 0.55 * (1 - lifeT * 0.4);
    }
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

  // All burst buffers and scene objects live for the system lifetime.
  // A full pool drops a decorative burst instead of causing combat GC spikes.
  _initBurstPool() {
    this._up = new THREE.Vector3(0, 1, 0);
    this._burstNormal = new THREE.Vector3();
    this._burstTangent = new THREE.Vector3();
    this._burstSide = new THREE.Vector3();
    const slots = typeof window !== 'undefined' && window.__birbIsMobile ? 6 : 10;
    for (let i = 0; i < slots; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      const material = new THREE.PointsMaterial({
        color: 0xffc677, size: 0.8, map: this.texture, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.visible = false;
      this.scene.add(points);
      const arc = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 24), new THREE.MeshBasicMaterial({
        color: 0xffdfaa, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }));
      arc.visible = false;
      this.scene.add(arc);
      this.particles.push({ points, geometry, material, arc, active: false,
        velocities: new Float32Array(72), gravity: new THREE.Vector3(),
        age: 0, maxAge: 0.8, type: 'explosion' });
    }
  }

  _emitBurst(position, color, type) {
    if (this.suspended) return;
    let slot = null;
    for (const p of this.particles) { if (!p.active) { slot = p; break; } }
    if (!slot) return;
    slot.active = true;
    slot.type = type;
    slot.age = 0;
    slot.maxAge = type === 'sparkle' ? 0.65 : 0.9;
    slot.points.visible = true;
    slot.material.color.set(color);
    slot.material.opacity = 1;
    slot.material.size = type === 'sparkle' ? 0.4 : 0.85;
    this._burstNormal.copy(position).normalize();
    if (this._burstNormal.lengthSq() < 0.5) this._burstNormal.copy(this._up);
    this._burstTangent.set(1, 0, 0);
    if (Math.abs(this._burstNormal.x) > 0.9) this._burstTangent.set(0, 0, 1);
    this._burstTangent.cross(this._burstNormal).normalize();
    this._burstSide.crossVectors(this._burstNormal, this._burstTangent);
    slot.gravity.copy(this._burstNormal).multiplyScalar(type === 'explosion' ? -4 : 0);
    const positions = slot.geometry.attributes.position.array;
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      const speed = type === 'sparkle' ? 3 + Math.random() * 2 : 3 + Math.random() * 8;
      const lift = type === 'sparkle' ? 1 : (Math.random() - 0.3) * 7;
      const x = Math.cos(angle) * speed, z = Math.sin(angle) * speed;
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      slot.velocities[i * 3] = this._burstTangent.x * x + this._burstSide.x * z + this._burstNormal.x * lift;
      slot.velocities[i * 3 + 1] = this._burstTangent.y * x + this._burstSide.y * z + this._burstNormal.y * lift;
      slot.velocities[i * 3 + 2] = this._burstTangent.z * x + this._burstSide.z * z + this._burstNormal.z * lift;
    }
    slot.geometry.attributes.position.needsUpdate = true;
    slot.arc.position.copy(position);
    // RingGeometry faces local +Z; align to the radial surface normal.
    this._burstSide.set(0, 0, 1);
    slot.arc.quaternion.setFromUnitVectors(this._burstSide, this._burstNormal);
    slot.arc.scale.setScalar(0.2);
    slot.arc.material.color.set(color);
    slot.arc.material.opacity = 0.65;
    slot.arc.visible = true;
  }

  createExplosion(position, color = 0xffb05c) { this._emitBurst(position, color, 'explosion'); }
  createSparkle(position) { this._emitBurst(position, 0xffdf8c, 'sparkle'); }

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

    if (this.suspended) {
      this.ambientParticles.points.visible = false;
    }
  }

  setSuspended(suspended) {
    const next = Boolean(suspended);
    if (this.suspended === next) return;
    this.suspended = next;

    if (this.ambientParticles?.points) {
      this.ambientParticles.points.visible = !next;
    }

    if (next) {
      for (const p of this.particles) {
        p.active = false;
        p.points.visible = false;
        p.arc.visible = false;
      }
    }

    for (let i = 0; i < this._whooshPool.length; i++) {
      const slot = this._whooshPool[i];
      slot.active = !next && slot.active;
      if (next) slot.points.visible = false;
    }
  }

  /**
   * Update all particle systems
   */
  update(delta, cameraPosition) {
    if (this.suspended) return;
    // Update pooled bursts, radial gravity works on every side of the planet.
    const dt = Math.min(Math.max(delta, 0), 0.05);
    const drag = Math.pow(0.96, dt * 60);
    for (const p of this.particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        p.points.visible = false;
        p.arc.visible = false;
        continue;
      }
      const positions = p.geometry.attributes.position.array;
      for (let j = 0; j < 24; j++) {
        p.velocities[j * 3] = p.velocities[j * 3] * drag + p.gravity.x * dt;
        p.velocities[j * 3 + 1] = p.velocities[j * 3 + 1] * drag + p.gravity.y * dt;
        p.velocities[j * 3 + 2] = p.velocities[j * 3 + 2] * drag + p.gravity.z * dt;
        positions[j * 3] += p.velocities[j * 3] * dt;
        positions[j * 3 + 1] += p.velocities[j * 3 + 1] * dt;
        positions[j * 3 + 2] += p.velocities[j * 3 + 2] * dt;
      }
      p.geometry.attributes.position.needsUpdate = true;
      const life = p.age / p.maxAge;
      p.material.opacity = (1 - life) * (1 - life);
      p.arc.visible = life < 0.45;
      p.arc.scale.setScalar(0.4 + life * (p.type === 'sparkle' ? 5 : 9));
      p.arc.material.opacity = Math.max(0, 0.65 * (1 - life / 0.45));
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

    // Pooled whoosh streaks (proximity cue)
    this._updateWhooshes(delta);
  }

  dispose() {
    for (const p of this.particles) {
      this.scene.remove(p.points);
      p.geometry.dispose();
      p.material.dispose();
      this.scene.remove(p.arc);
      p.arc.geometry.dispose();
      p.arc.material.dispose();
    }
    this.particles = [];

    if (this.ambientParticles) {
      this.scene.remove(this.ambientParticles.points);
      this.ambientParticles.geometry.dispose();
      this.ambientParticles.material.dispose();
      this.ambientParticles = null;
    }

    // Dispose pooled whoosh streaks
    if (this._whooshPool) {
      for (const slot of this._whooshPool) {
        this.scene.remove(slot.points);
        slot.geometry.dispose();
        slot.material.dispose();
      }
      this._whooshPool = [];
    }

    if (this.texture) {
      this.texture.dispose();
    }
  }
}
