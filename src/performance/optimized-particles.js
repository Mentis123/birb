/**
 * High-performance particle system optimized for mobile
 *
 * Key optimizations:
 * - Pre-allocated typed arrays (no per-frame allocations)
 * - setDrawRange() to only render active particles
 * - Batch buffer updates (single needsUpdate per frame)
 * - Age-based particle recycling
 * - Configurable update frequency
 * - Frustum culling support
 */

import { scratch } from './scratch-allocations.js'

export class OptimizedParticleSystem {
  constructor(THREE, options = {}) {
    this.THREE = THREE

    // Configuration
    this.maxParticles = options.maxParticles || 200
    this.particleSize = options.size || 0.1
    this.color = options.color || 0xffffff
    this.opacity = options.opacity || 1.0
    this.blending = options.blending || THREE.AdditiveBlending
    this.sizeAttenuation = options.sizeAttenuation !== false
    this.depthWrite = options.depthWrite || false
    this.vertexColors = options.vertexColors || false

    // State tracking
    this.activeCount = 0
    this.particleHead = 0 // Next particle slot to use

    // Pre-allocated particle data arrays
    // Each particle has: x, y, z position
    this.positions = new Float32Array(this.maxParticles * 3)
    // Each particle has: vx, vy, vz velocity
    this.velocities = new Float32Array(this.maxParticles * 3)
    // Age/lifetime per particle (negative = dead)
    this.ages = new Float32Array(this.maxParticles)
    this.lifetimes = new Float32Array(this.maxParticles)
    // Per-particle size (optional)
    this.sizes = new Float32Array(this.maxParticles)
    // Per-particle color (optional, r, g, b)
    this.colors = options.vertexColors ? new Float32Array(this.maxParticles * 3) : null

    // Initialize all particles as dead
    this.ages.fill(-1)
    this.lifetimes.fill(1)
    this.sizes.fill(this.particleSize)

    // Create geometry with pre-allocated buffers
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))

    if (this.colors) {
      this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    }

    // Set initial draw range to 0 (no particles visible)
    this.geometry.setDrawRange(0, 0)

    // Create material
    this.material = new THREE.PointsMaterial({
      color: this.color,
      size: this.particleSize,
      transparent: true,
      opacity: this.opacity,
      depthWrite: this.depthWrite,
      blending: this.blending,
      sizeAttenuation: this.sizeAttenuation,
      vertexColors: this.vertexColors
    })

    // Create points mesh
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false // We handle this manually for particles

    // Buffer update flags
    this._positionsDirty = false
    this._sizesDirty = false
    this._colorsDirty = false

    // Performance tracking
    this._lastUpdateTime = 0
    this._updateInterval = options.updateInterval || 0 // 0 = every frame
  }

  /**
   * Emit a single particle
   */
  emit(x, y, z, vx = 0, vy = 0, vz = 0, lifetime = 1, size = null, color = null) {
    // Find next available slot (circular buffer)
    const idx = this.particleHead
    this.particleHead = (this.particleHead + 1) % this.maxParticles

    const i3 = idx * 3

    // Set position
    this.positions[i3] = x
    this.positions[i3 + 1] = y
    this.positions[i3 + 2] = z

    // Set velocity
    this.velocities[i3] = vx
    this.velocities[i3 + 1] = vy
    this.velocities[i3 + 2] = vz

    // Set lifetime
    this.ages[idx] = 0
    this.lifetimes[idx] = lifetime

    // Set size
    if (size !== null) {
      this.sizes[idx] = size
      this._sizesDirty = true
    }

    // Set color
    if (color !== null && this.colors) {
      this.colors[i3] = color.r
      this.colors[i3 + 1] = color.g
      this.colors[i3 + 2] = color.b
      this._colorsDirty = true
    }

    this._positionsDirty = true

    if (this.activeCount < this.maxParticles) {
      this.activeCount++
    }

    return idx
  }

  /**
   * Emit multiple particles in a burst
   */
  emitBurst(x, y, z, count, spreadRadius = 1, speedRange = [0.5, 2], lifetime = 1) {
    for (let i = 0; i < count; i++) {
      // Random direction
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0])

      const vx = Math.sin(phi) * Math.cos(theta) * speed
      const vy = Math.sin(phi) * Math.sin(theta) * speed
      const vz = Math.cos(phi) * speed

      // Slight position offset
      const ox = (Math.random() - 0.5) * spreadRadius * 0.5
      const oy = (Math.random() - 0.5) * spreadRadius * 0.5
      const oz = (Math.random() - 0.5) * spreadRadius * 0.5

      this.emit(x + ox, y + oy, z + oz, vx, vy, vz, lifetime)
    }
  }

  /**
   * Update all particles
   * @param {number} delta - Time since last frame
   * @param {number} time - Total elapsed time
   */
  update(delta, time) {
    // Optional: Skip updates based on interval
    if (this._updateInterval > 0) {
      if (time - this._lastUpdateTime < this._updateInterval) {
        return
      }
      this._lastUpdateTime = time
    }

    let maxActiveIndex = -1

    for (let i = 0; i < this.maxParticles; i++) {
      // Skip dead particles
      if (this.ages[i] < 0) continue

      // Age the particle
      this.ages[i] += delta

      // Check if particle should die
      if (this.ages[i] >= this.lifetimes[i]) {
        this.ages[i] = -1 // Mark as dead
        continue
      }

      // Track highest active index for draw range
      maxActiveIndex = Math.max(maxActiveIndex, i)

      // Update position based on velocity
      const i3 = i * 3
      this.positions[i3] += this.velocities[i3] * delta
      this.positions[i3 + 1] += this.velocities[i3 + 1] * delta
      this.positions[i3 + 2] += this.velocities[i3 + 2] * delta
    }

    this._positionsDirty = true
    this.activeCount = maxActiveIndex + 1

    // Commit buffer updates
    this.commitBuffers()
  }

  /**
   * Custom update with callback for each particle
   * @param {number} delta - Time since last frame
   * @param {Function} updateFn - Callback(idx, age, lifetime, positions, velocities, sizes)
   */
  updateCustom(delta, updateFn) {
    let maxActiveIndex = -1

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.ages[i] < 0) continue

      this.ages[i] += delta

      if (this.ages[i] >= this.lifetimes[i]) {
        this.ages[i] = -1
        continue
      }

      maxActiveIndex = Math.max(maxActiveIndex, i)

      // Call custom update function
      const result = updateFn(
        i,
        this.ages[i],
        this.lifetimes[i],
        this.positions,
        this.velocities,
        this.sizes,
        this.colors,
        delta
      )

      // Allow custom update to mark particle as dead
      if (result === false) {
        this.ages[i] = -1
      }
    }

    this._positionsDirty = true
    this.activeCount = maxActiveIndex + 1
    this.commitBuffers()
  }

  /**
   * Commit dirty buffers to GPU
   */
  commitBuffers() {
    if (this._positionsDirty) {
      this.geometry.attributes.position.needsUpdate = true
      this._positionsDirty = false
    }

    if (this._sizesDirty) {
      this.geometry.attributes.size.needsUpdate = true
      this._sizesDirty = false
    }

    if (this._colorsDirty && this.colors) {
      this.geometry.attributes.color.needsUpdate = true
      this._colorsDirty = false
    }

    // Update draw range to only render active particles
    this.geometry.setDrawRange(0, this.activeCount)
  }

  /**
   * Apply gravity to all active particles
   */
  applyGravity(gravity = -9.8, delta) {
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.ages[i] < 0) continue
      this.velocities[i * 3 + 1] += gravity * delta
    }
  }

  /**
   * Apply drag/friction to all particles
   */
  applyDrag(drag = 0.98) {
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.ages[i] < 0) continue
      const i3 = i * 3
      this.velocities[i3] *= drag
      this.velocities[i3 + 1] *= drag
      this.velocities[i3 + 2] *= drag
    }
  }

  /**
   * Kill all particles
   */
  clear() {
    this.ages.fill(-1)
    this.activeCount = 0
    this.particleHead = 0
    this.geometry.setDrawRange(0, 0)
  }

  /**
   * Add to scene
   */
  addToScene(scene) {
    scene.add(this.points)
  }

  /**
   * Remove from scene
   */
  removeFromScene(scene) {
    scene.remove(this.points)
  }

  /**
   * Set visibility
   */
  setVisible(visible) {
    this.points.visible = visible
  }

  /**
   * Dispose all resources
   */
  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }

  /**
   * Get performance stats
   */
  getStats() {
    return {
      maxParticles: this.maxParticles,
      activeCount: this.activeCount,
      utilization: (this.activeCount / this.maxParticles * 100).toFixed(1) + '%'
    }
  }
}

/**
 * Particle emitter that follows a position
 * Useful for trails, exhausts, etc.
 */
export class TrailEmitter {
  constructor(THREE, particleSystem, options = {}) {
    this.THREE = THREE
    this.particles = particleSystem
    this.emitRate = options.emitRate || 30 // particles per second
    this.emitAccumulator = 0

    // Trail properties
    this.spreadRadius = options.spreadRadius || 0.1
    this.speedMultiplier = options.speedMultiplier || 0.5
    this.baseLifetime = options.lifetime || 0.5
    this.inheritVelocity = options.inheritVelocity !== false

    // Previous position for velocity calculation
    this.prevPosition = new THREE.Vector3()
    this.hasPosition = false
  }

  /**
   * Update the emitter
   * @param {THREE.Vector3} position - Current emitter position
   * @param {number} delta - Frame delta time
   * @param {number} speed - Optional speed multiplier for emission rate
   */
  update(position, delta, speed = 1) {
    if (!this.hasPosition) {
      this.prevPosition.copy(position)
      this.hasPosition = true
      return
    }

    // Calculate velocity from position change
    const tempVel = scratch.vec3()
    tempVel.subVectors(position, this.prevPosition).divideScalar(delta)

    // Accumulate time for emission
    this.emitAccumulator += delta * this.emitRate * Math.max(0.5, speed)

    // Emit particles
    while (this.emitAccumulator >= 1) {
      this.emitAccumulator -= 1

      // Random offset from emit position
      const ox = (Math.random() - 0.5) * this.spreadRadius
      const oy = (Math.random() - 0.5) * this.spreadRadius
      const oz = (Math.random() - 0.5) * this.spreadRadius

      // Particle velocity (opposite direction + spread)
      let vx = (Math.random() - 0.5) * this.speedMultiplier
      let vy = (Math.random() - 0.5) * this.speedMultiplier
      let vz = (Math.random() - 0.5) * this.speedMultiplier

      // Inherit some velocity from emitter
      if (this.inheritVelocity) {
        vx -= tempVel.x * 0.3
        vy -= tempVel.y * 0.3
        vz -= tempVel.z * 0.3
      }

      this.particles.emit(
        position.x + ox,
        position.y + oy,
        position.z + oz,
        vx, vy, vz,
        this.baseLifetime * (0.8 + Math.random() * 0.4)
      )
    }

    this.prevPosition.copy(position)
  }

  reset() {
    this.hasPosition = false
    this.emitAccumulator = 0
  }
}
