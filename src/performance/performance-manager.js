/**
 * Central performance manager
 *
 * Coordinates all performance optimization systems:
 * - Object pooling
 * - Scratch allocations
 * - Particle systems
 * - Frustum culling
 * - Collision detection
 * - LOD management
 * - Material optimization
 * - Frame timing
 * - Adaptive quality
 */

import { scratch } from './scratch-allocations.js'
import { ObjectPool, GameObjectPool, Vector3Pool, QuaternionPool } from './object-pool.js'
import { OptimizedParticleSystem, TrailEmitter } from './optimized-particles.js'
import { FrustumCuller, DistanceCuller } from './frustum-culling.js'
import { OptimizedCollisionSystem, SimpleCollisionChecker, SpatialHashGrid } from './optimized-collision.js'
import { LODManager, InstancedLOD, LOD_LEVELS } from './lod-system.js'
import { MaterialCache, AnimatedMaterialManager, createOptimizedMaterials } from './material-optimizer.js'

/**
 * Performance quality levels
 */
export const QualityLevel = {
  ULTRA: 'ultra',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  POTATO: 'potato'
}

/**
 * Quality presets
 */
const QualityPresets = {
  [QualityLevel.ULTRA]: {
    maxParticles: 500,
    lodDistances: { high: 30, medium: 70, low: 120, billboard: 180 },
    shadowQuality: 2048,
    antiAlias: true,
    dprCap: 2.0,
    updateFrequency: 0
  },
  [QualityLevel.HIGH]: {
    maxParticles: 300,
    lodDistances: { high: 25, medium: 55, low: 100, billboard: 150 },
    shadowQuality: 1024,
    antiAlias: true,
    dprCap: 1.8,
    updateFrequency: 0
  },
  [QualityLevel.MEDIUM]: {
    maxParticles: 200,
    lodDistances: { high: 20, medium: 45, low: 80, billboard: 120 },
    shadowQuality: 512,
    antiAlias: true,
    dprCap: 1.5,
    updateFrequency: 16
  },
  [QualityLevel.LOW]: {
    maxParticles: 100,
    lodDistances: { high: 15, medium: 35, low: 60, billboard: 100 },
    shadowQuality: 256,
    antiAlias: false,
    dprCap: 1.2,
    updateFrequency: 33
  },
  [QualityLevel.POTATO]: {
    maxParticles: 50,
    lodDistances: { high: 10, medium: 25, low: 45, billboard: 70 },
    shadowQuality: 0,
    antiAlias: false,
    dprCap: 1.0,
    updateFrequency: 50
  }
}

/**
 * Frame timing and FPS tracking
 */
class FrameTimer {
  constructor() {
    this.lastTime = 0
    this.delta = 0
    this.fps = 60
    this.frameCount = 0
    this.fpsAccumulator = 0
    this.fpsSampleInterval = 250 // ms
    this.lastFpsSample = 0

    // Frame time history for adaptive quality
    this.frameTimeHistory = new Float32Array(60)
    this.historyIndex = 0

    // Jank detection
    this.jankThreshold = 33 // ms (30fps)
    this.jankCount = 0
    this.consecutiveJanks = 0
  }

  /**
   * Update frame timing
   */
  update(currentTime) {
    this.delta = Math.min((currentTime - this.lastTime) / 1000, 0.05) // Cap at 50ms
    this.lastTime = currentTime

    // Track frame times
    const frameTimeMs = this.delta * 1000
    this.frameTimeHistory[this.historyIndex] = frameTimeMs
    this.historyIndex = (this.historyIndex + 1) % this.frameTimeHistory.length

    // Jank detection
    if (frameTimeMs > this.jankThreshold) {
      this.jankCount++
      this.consecutiveJanks++
    } else {
      this.consecutiveJanks = 0
    }

    // FPS calculation
    this.frameCount++
    this.fpsAccumulator += this.delta

    if (currentTime - this.lastFpsSample >= this.fpsSampleInterval) {
      this.fps = Math.round(this.frameCount / this.fpsAccumulator)
      this.frameCount = 0
      this.fpsAccumulator = 0
      this.lastFpsSample = currentTime
    }

    return this.delta
  }

  /**
   * Get average frame time
   */
  getAverageFrameTime() {
    let sum = 0
    for (let i = 0; i < this.frameTimeHistory.length; i++) {
      sum += this.frameTimeHistory[i]
    }
    return sum / this.frameTimeHistory.length
  }

  /**
   * Check if performance is struggling
   */
  isStruggling() {
    return this.consecutiveJanks > 10 || this.getAverageFrameTime() > 25
  }
}

/**
 * Main performance manager
 */
export class PerformanceManager {
  constructor(THREE, options = {}) {
    this.THREE = THREE
    this.initialized = false

    // Configuration
    this.qualityLevel = options.qualityLevel || QualityLevel.MEDIUM
    this.adaptiveQuality = options.adaptiveQuality !== false
    this.isMobile = options.isMobile || false

    // Core systems
    this.frameTimer = new FrameTimer()
    this.materialCache = new MaterialCache(THREE)
    this.animatedMaterials = new AnimatedMaterialManager(THREE)
    this.collisionChecker = new SimpleCollisionChecker()

    // Systems requiring camera (initialized later)
    this.frustumCuller = null
    this.lodManager = null

    // Object pools
    this.pools = new Map()

    // Particle systems
    this.particleSystems = new Map()

    // Stats
    this.stats = {
      fps: 60,
      frameTime: 16.67,
      drawCalls: 0,
      triangles: 0,
      quality: this.qualityLevel,
      jankCount: 0
    }

    // Quality adjustment timing
    this.lastQualityCheck = 0
    this.qualityCheckInterval = 2000 // Check every 2 seconds
  }

  /**
   * Initialize the performance manager
   * Call after THREE is loaded and camera is created
   */
  init(camera, renderer, scene) {
    if (this.initialized) return this

    // Initialize scratch allocations
    scratch.init(this.THREE)

    // Initialize camera-dependent systems
    this.frustumCuller = new FrustumCuller(this.THREE)
    this.lodManager = new LODManager(this.THREE, camera)

    // Apply mobile settings if needed
    if (this.isMobile) {
      this.setQuality(QualityLevel.MEDIUM)
      this.lodManager.setMobileMode()
    }

    // Store references
    this.camera = camera
    this.renderer = renderer
    this.scene = scene

    this.initialized = true
    return this
  }

  /**
   * Call at the start of each frame
   */
  frameStart(time) {
    // Reset scratch allocations for new frame
    scratch.frameStart()

    // Update frame timing
    const delta = this.frameTimer.update(time)

    // Check for quality adjustment
    if (this.adaptiveQuality && time - this.lastQualityCheck > this.qualityCheckInterval) {
      this._checkQualityAdjustment()
      this.lastQualityCheck = time
    }

    return delta
  }

  /**
   * Call at the end of each frame (before render)
   */
  frameEnd(time) {
    // Update animated materials
    this.animatedMaterials.update(time / 1000, this.frameTimer.delta)

    // Update LOD
    if (this.lodManager) {
      this.lodManager.update(time)
    }

    // Update frustum culling
    if (this.frustumCuller && this.camera) {
      this.frustumCuller.update(this.camera)
    }

    // Update stats
    this._updateStats()
  }

  /**
   * Check if quality should be adjusted
   */
  _checkQualityAdjustment() {
    if (!this.adaptiveQuality) return

    const avgFrameTime = this.frameTimer.getAverageFrameTime()
    const isStruggling = this.frameTimer.isStruggling()

    // Downgrade quality if struggling
    if (isStruggling) {
      this._decreaseQuality()
    }
    // Upgrade quality if consistently good
    else if (avgFrameTime < 12 && this.frameTimer.consecutiveJanks === 0) {
      this._increaseQuality()
    }
  }

  /**
   * Decrease quality level
   */
  _decreaseQuality() {
    const levels = Object.values(QualityLevel)
    const currentIndex = levels.indexOf(this.qualityLevel)

    if (currentIndex < levels.length - 1) {
      this.setQuality(levels[currentIndex + 1])
      console.log(`Performance: Quality decreased to ${this.qualityLevel}`)
    }
  }

  /**
   * Increase quality level
   */
  _increaseQuality() {
    const levels = Object.values(QualityLevel)
    const currentIndex = levels.indexOf(this.qualityLevel)

    if (currentIndex > 0) {
      this.setQuality(levels[currentIndex - 1])
      console.log(`Performance: Quality increased to ${this.qualityLevel}`)
    }
  }

  /**
   * Set quality level
   */
  setQuality(level) {
    if (!QualityPresets[level]) {
      console.warn(`Unknown quality level: ${level}`)
      return
    }

    this.qualityLevel = level
    const preset = QualityPresets[level]

    // Apply LOD distances
    if (this.lodManager) {
      const d = preset.lodDistances
      this.lodManager.setThresholds(d.high, d.medium, d.low, d.billboard)
    }

    // Update renderer settings
    if (this.renderer) {
      const dpr = Math.min(window.devicePixelRatio || 1, preset.dprCap)
      this.renderer.setPixelRatio(dpr)
    }

    this.stats.quality = level
  }

  /**
   * Get current quality preset
   */
  getQualityPreset() {
    return QualityPresets[this.qualityLevel]
  }

  /**
   * Create an object pool
   */
  createPool(name, factory, reset, initialSize = 10) {
    const pool = new ObjectPool(factory, reset, initialSize)
    this.pools.set(name, pool)
    return pool
  }

  /**
   * Create a game object pool (for rockets, drones, etc.)
   */
  createGameObjectPool(name, createFn, resetFn, activateFn, deactivateFn, initialSize = 20) {
    const pool = new GameObjectPool(createFn, resetFn, activateFn, deactivateFn, initialSize)
    this.pools.set(name, pool)
    return pool
  }

  /**
   * Get a pool by name
   */
  getPool(name) {
    return this.pools.get(name)
  }

  /**
   * Create an optimized particle system
   */
  createParticleSystem(name, options = {}) {
    // Apply quality-based particle limits
    const preset = this.getQualityPreset()
    const maxParticles = Math.min(
      options.maxParticles || preset.maxParticles,
      preset.maxParticles
    )

    const system = new OptimizedParticleSystem(this.THREE, {
      ...options,
      maxParticles
    })

    this.particleSystems.set(name, system)
    return system
  }

  /**
   * Get a particle system by name
   */
  getParticleSystem(name) {
    return this.particleSystems.get(name)
  }

  /**
   * Update all particle systems
   */
  updateParticleSystems(delta, time) {
    for (const system of this.particleSystems.values()) {
      system.update(delta, time)
    }
  }

  /**
   * Register object for frustum culling
   */
  registerCullable(object, radius = 1, tier = 'normal') {
    if (this.frustumCuller) {
      return this.frustumCuller.register(object, radius, tier)
    }
    return -1
  }

  /**
   * Register object for LOD
   */
  registerLOD(config) {
    if (this.lodManager) {
      return this.lodManager.register(config)
    }
    return -1
  }

  /**
   * Register simple visibility LOD
   */
  registerSimpleLOD(object, maxDistance) {
    if (this.lodManager) {
      return this.lodManager.registerSimple(object, maxDistance)
    }
    return -1
  }

  /**
   * Get cached material
   */
  getMaterial(type, props) {
    switch (type) {
      case 'basic': return this.materialCache.getBasic(props)
      case 'standard': return this.materialCache.getStandard(props)
      case 'points': return this.materialCache.getPoints(props)
      default: return null
    }
  }

  /**
   * Register animated material
   */
  registerAnimatedMaterial(material, type, config = {}) {
    switch (type) {
      case 'pulsing':
        this.animatedMaterials.registerPulsing(material, config)
        break
      case 'colorCycling':
        this.animatedMaterials.registerColorCycling(material, config.colors, config.duration)
        break
      case 'custom':
        this.animatedMaterials.registerCustom(material, config.updateFn)
        break
    }
  }

  /**
   * Update stats
   */
  _updateStats() {
    this.stats.fps = this.frameTimer.fps
    this.stats.frameTime = this.frameTimer.delta * 1000
    this.stats.jankCount = this.frameTimer.jankCount

    if (this.renderer && this.renderer.info) {
      this.stats.drawCalls = this.renderer.info.render.calls
      this.stats.triangles = this.renderer.info.render.triangles
    }
  }

  /**
   * Get performance stats
   */
  getStats() {
    return {
      ...this.stats,
      frustumCulling: this.frustumCuller?.getStats() || {},
      lod: this.lodManager?.getStats() || {},
      materialCache: this.materialCache.getStats(),
      scratchAllocations: scratch.getStats()
    }
  }

  /**
   * Dispose all resources
   */
  dispose() {
    // Dispose particle systems
    for (const system of this.particleSystems.values()) {
      system.dispose()
    }
    this.particleSystems.clear()

    // Clear pools
    for (const pool of this.pools.values()) {
      if (pool.clear) pool.clear()
    }
    this.pools.clear()

    // Clear material cache
    this.materialCache.clear()

    // Clear LOD
    if (this.lodManager) {
      this.lodManager.clear()
    }

    // Clear frustum culler
    if (this.frustumCuller) {
      this.frustumCuller.clear()
    }

    // Clear animated materials
    this.animatedMaterials.clear()

    this.initialized = false
  }
}

// Singleton instance
let _instance = null

/**
 * Get or create the global performance manager instance
 */
export function getPerformanceManager(THREE, options) {
  if (!_instance && THREE) {
    _instance = new PerformanceManager(THREE, options)
  }
  return _instance
}

/**
 * Reset the global instance (for testing or reinitialization)
 */
export function resetPerformanceManager() {
  if (_instance) {
    _instance.dispose()
    _instance = null
  }
}
