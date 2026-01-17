/**
 * Material optimization utilities
 *
 * Features:
 * - Material caching/sharing to reduce shader compilations
 * - Batched uniform updates
 * - Pre-compiled shader variants
 * - Animated material management
 */

/**
 * Material cache for sharing identical materials
 */
export class MaterialCache {
  constructor(THREE) {
    this.THREE = THREE
    this.cache = new Map()
    this.stats = {
      hits: 0,
      misses: 0,
      total: 0
    }
  }

  /**
   * Generate a cache key from material properties
   */
  _generateKey(type, props) {
    const sortedProps = Object.keys(props).sort().map(k => `${k}:${props[k]}`).join('|')
    return `${type}|${sortedProps}`
  }

  /**
   * Get or create a MeshBasicMaterial
   */
  getBasic(props) {
    const key = this._generateKey('basic', props)

    if (this.cache.has(key)) {
      this.stats.hits++
      return this.cache.get(key)
    }

    this.stats.misses++
    this.stats.total++

    const material = new this.THREE.MeshBasicMaterial(props)
    this.cache.set(key, material)
    return material
  }

  /**
   * Get or create a MeshStandardMaterial
   */
  getStandard(props) {
    const key = this._generateKey('standard', props)

    if (this.cache.has(key)) {
      this.stats.hits++
      return this.cache.get(key)
    }

    this.stats.misses++
    this.stats.total++

    const material = new this.THREE.MeshStandardMaterial(props)
    this.cache.set(key, material)
    return material
  }

  /**
   * Get or create a PointsMaterial
   */
  getPoints(props) {
    const key = this._generateKey('points', props)

    if (this.cache.has(key)) {
      this.stats.hits++
      return this.cache.get(key)
    }

    this.stats.misses++
    this.stats.total++

    const material = new this.THREE.PointsMaterial(props)
    this.cache.set(key, material)
    return material
  }

  /**
   * Clear the cache
   */
  clear() {
    for (const material of this.cache.values()) {
      material.dispose()
    }
    this.cache.clear()
    this.stats = { hits: 0, misses: 0, total: 0 }
  }

  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1) + '%'
        : '0%'
    }
  }
}

/**
 * Animated material manager
 * Batches animated material updates to reduce state changes
 */
export class AnimatedMaterialManager {
  constructor(THREE) {
    this.THREE = THREE

    // Animated materials grouped by update type
    this.pulsing = []      // opacity pulsing
    this.colorCycling = [] // color cycling
    this.custom = []       // custom update functions

    // Pre-calculated values
    this._sinTable = new Float32Array(360)
    this._cosTable = new Float32Array(360)

    // Pre-compute sin/cos lookup table
    for (let i = 0; i < 360; i++) {
      const rad = i * Math.PI / 180
      this._sinTable[i] = Math.sin(rad)
      this._cosTable[i] = Math.cos(rad)
    }
  }

  /**
   * Fast sin using lookup table
   */
  fastSin(time, frequency = 1) {
    const degrees = Math.floor((time * frequency * 180 / Math.PI) % 360)
    const index = degrees < 0 ? degrees + 360 : degrees
    return this._sinTable[index]
  }

  /**
   * Register a pulsing opacity material
   */
  registerPulsing(material, config = {}) {
    this.pulsing.push({
      material,
      baseOpacity: config.baseOpacity || 0.6,
      amplitude: config.amplitude || 0.3,
      frequency: config.frequency || 2,
      phase: config.phase || 0
    })
  }

  /**
   * Register a color cycling material
   */
  registerColorCycling(material, colors, cycleDuration = 2) {
    this.colorCycling.push({
      material,
      colors, // Array of THREE.Color or hex values
      cycleDuration,
      currentIndex: 0
    })
  }

  /**
   * Register a custom animated material
   */
  registerCustom(material, updateFn) {
    this.custom.push({ material, updateFn })
  }

  /**
   * Unregister a material from all animation types
   */
  unregister(material) {
    this.pulsing = this.pulsing.filter(m => m.material !== material)
    this.colorCycling = this.colorCycling.filter(m => m.material !== material)
    this.custom = this.custom.filter(m => m.material !== material)
  }

  /**
   * Update all animated materials
   * Call this once per frame
   */
  update(time, delta) {
    // Update pulsing materials
    for (const item of this.pulsing) {
      const pulse = this.fastSin(time + item.phase, item.frequency)
      item.material.opacity = item.baseOpacity + pulse * item.amplitude
    }

    // Update color cycling materials
    for (const item of this.colorCycling) {
      const t = (time % item.cycleDuration) / item.cycleDuration
      const colorIndex = Math.floor(t * item.colors.length)
      const nextIndex = (colorIndex + 1) % item.colors.length
      const blend = (t * item.colors.length) % 1

      // Lerp between colors
      if (item.material.color.lerpColors) {
        item.material.color.lerpColors(
          item.colors[colorIndex],
          item.colors[nextIndex],
          blend
        )
      }
    }

    // Update custom materials
    for (const item of this.custom) {
      item.updateFn(item.material, time, delta)
    }
  }

  /**
   * Clear all registered materials
   */
  clear() {
    this.pulsing.length = 0
    this.colorCycling.length = 0
    this.custom.length = 0
  }
}

/**
 * Shader program cache to prevent recompilation
 * Works by ensuring materials with same shaders share programs
 */
export class ShaderProgramManager {
  constructor(THREE, renderer) {
    this.THREE = THREE
    this.renderer = renderer

    // Track compiled programs
    this.programs = new Map()
  }

  /**
   * Pre-compile a material's shader
   * Call this during loading to avoid runtime compilation stutter
   */
  precompile(material, camera, scene) {
    // Create a dummy mesh to trigger compilation
    const dummyGeom = new this.THREE.BufferGeometry()
    dummyGeom.setAttribute('position', new this.THREE.BufferAttribute(
      new Float32Array([0, 0, 0]), 3
    ))

    const dummyMesh = new this.THREE.Mesh(dummyGeom, material)
    scene.add(dummyMesh)

    // Render to compile
    this.renderer.compile(scene, camera)

    // Clean up
    scene.remove(dummyMesh)
    dummyGeom.dispose()
  }

  /**
   * Pre-compile multiple materials
   */
  precompileAll(materials, camera, scene) {
    for (const material of materials) {
      this.precompile(material, camera, scene)
    }
  }
}

/**
 * Optimized material presets for common use cases
 */
export function createOptimizedMaterials(THREE) {
  return {
    // Particle material - additive blending, no depth write
    particle: new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.1,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    }),

    // Glow material - for emissive effects
    glow: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    }),

    // Simple unlit material - fastest rendering
    unlit: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false
    }),

    // Simple lit material - minimal PBR cost
    simpleLit: new THREE.MeshLambertMaterial({
      color: 0xffffff
    }),

    // Trail material - fades out
    trail: new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.05,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      vertexColors: true
    }),

    // Ring/collectible material
    collectible: new THREE.MeshBasicMaterial({
      color: 0xffdd00,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  }
}

/**
 * Batch material property updates to minimize state changes
 */
export class MaterialBatcher {
  constructor() {
    this.pendingUpdates = new Map()
  }

  /**
   * Queue a material property update
   */
  queueUpdate(material, property, value) {
    if (!this.pendingUpdates.has(material)) {
      this.pendingUpdates.set(material, {})
    }
    this.pendingUpdates.get(material)[property] = value
  }

  /**
   * Apply all queued updates
   */
  flush() {
    for (const [material, updates] of this.pendingUpdates) {
      for (const [property, value] of Object.entries(updates)) {
        material[property] = value
      }
    }
    this.pendingUpdates.clear()
  }

  /**
   * Clear pending updates without applying
   */
  clear() {
    this.pendingUpdates.clear()
  }
}
