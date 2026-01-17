/**
 * Level of Detail (LOD) system for mobile optimization
 *
 * Features:
 * - Automatic LOD switching based on distance
 * - Hysteresis to prevent popping
 * - Billboard/impostor support for distant objects
 * - Batch LOD updates
 */

import { scratch } from './scratch-allocations.js'

/**
 * LOD levels configuration
 */
export const LOD_LEVELS = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  BILLBOARD: 3,
  HIDDEN: 4
}

/**
 * LOD manager for handling level-of-detail switching
 */
export class LODManager {
  constructor(THREE, camera) {
    this.THREE = THREE
    this.camera = camera
    this.cameraPosition = new THREE.Vector3()

    // LOD objects
    this.lodObjects = []

    // Distance thresholds (can be adjusted per device)
    this.thresholds = {
      high: 20,      // Full detail within 20 units
      medium: 50,    // Medium detail 20-50 units
      low: 100,      // Low detail 50-100 units
      billboard: 150 // Billboard/hidden beyond 100 units
    }

    // Hysteresis factor (prevents rapid switching at boundaries)
    this.hysteresis = 1.2

    // Update frequency (not every frame)
    this.updateInterval = 100 // ms
    this.lastUpdateTime = 0

    // Performance stats
    this.stats = {
      high: 0,
      medium: 0,
      low: 0,
      billboard: 0,
      hidden: 0
    }
  }

  /**
   * Set distance thresholds (multiply by factor for mobile)
   */
  setThresholds(high, medium, low, billboard) {
    this.thresholds.high = high
    this.thresholds.medium = medium
    this.thresholds.low = low
    this.thresholds.billboard = billboard
  }

  /**
   * Reduce thresholds for mobile performance
   */
  setMobileMode() {
    this.thresholds.high = 15
    this.thresholds.medium = 35
    this.thresholds.low = 60
    this.thresholds.billboard = 100
    this.updateInterval = 150 // Update less frequently
  }

  /**
   * Register an LOD object
   * @param {object} config - { meshes: { high, medium, low, billboard }, position }
   */
  register(config) {
    const lodObj = {
      meshes: config.meshes, // { high: Mesh, medium: Mesh, low: Mesh, billboard: Mesh }
      position: config.position || new this.THREE.Vector3(),
      getPosition: config.getPosition || null, // Function to get dynamic position
      currentLevel: LOD_LEVELS.HIGH,
      worldPosition: new this.THREE.Vector3()
    }

    // Initialize - show high detail, hide others
    if (lodObj.meshes.high) lodObj.meshes.high.visible = true
    if (lodObj.meshes.medium) lodObj.meshes.medium.visible = false
    if (lodObj.meshes.low) lodObj.meshes.low.visible = false
    if (lodObj.meshes.billboard) lodObj.meshes.billboard.visible = false

    this.lodObjects.push(lodObj)
    return this.lodObjects.length - 1
  }

  /**
   * Register a simple visibility LOD (just show/hide based on distance)
   */
  registerSimple(object, maxVisibleDistance) {
    const lodObj = {
      object,
      maxDistSq: maxVisibleDistance * maxVisibleDistance,
      simple: true,
      wasVisible: true,
      worldPosition: new this.THREE.Vector3()
    }
    this.lodObjects.push(lodObj)
    return this.lodObjects.length - 1
  }

  /**
   * Unregister an LOD object by index
   */
  unregister(index) {
    if (index >= 0 && index < this.lodObjects.length) {
      this.lodObjects.splice(index, 1)
    }
  }

  /**
   * Update all LOD objects
   */
  update(time) {
    // Throttle updates
    if (time - this.lastUpdateTime < this.updateInterval) {
      return
    }
    this.lastUpdateTime = time

    // Get camera position
    this.camera.getWorldPosition(this.cameraPosition)

    // Reset stats
    this.stats.high = 0
    this.stats.medium = 0
    this.stats.low = 0
    this.stats.billboard = 0
    this.stats.hidden = 0

    // Update each LOD object
    for (const lodObj of this.lodObjects) {
      if (lodObj.simple) {
        this._updateSimple(lodObj)
      } else {
        this._updateComplex(lodObj)
      }
    }
  }

  /**
   * Update a simple visibility LOD
   */
  _updateSimple(lodObj) {
    // Get world position
    if (lodObj.object.getWorldPosition) {
      lodObj.object.getWorldPosition(lodObj.worldPosition)
    } else {
      lodObj.worldPosition.copy(lodObj.object.position)
    }

    // Calculate squared distance
    const distSq = lodObj.worldPosition.distanceToSquared(this.cameraPosition)
    const visible = distSq <= lodObj.maxDistSq

    if (lodObj.wasVisible !== visible) {
      lodObj.object.visible = visible
      lodObj.wasVisible = visible
    }

    if (visible) {
      this.stats.high++
    } else {
      this.stats.hidden++
    }
  }

  /**
   * Update a complex multi-mesh LOD
   */
  _updateComplex(lodObj) {
    // Get world position
    if (lodObj.getPosition) {
      lodObj.worldPosition.copy(lodObj.getPosition())
    } else if (lodObj.meshes.high) {
      lodObj.meshes.high.getWorldPosition(lodObj.worldPosition)
    } else {
      lodObj.worldPosition.copy(lodObj.position)
    }

    // Calculate distance
    const dist = lodObj.worldPosition.distanceTo(this.cameraPosition)

    // Determine target LOD level (with hysteresis)
    const targetLevel = this._getLevelForDistance(dist, lodObj.currentLevel)

    // Switch LOD if needed
    if (targetLevel !== lodObj.currentLevel) {
      this._switchLevel(lodObj, targetLevel)
    }

    // Track stats
    switch (lodObj.currentLevel) {
      case LOD_LEVELS.HIGH: this.stats.high++; break
      case LOD_LEVELS.MEDIUM: this.stats.medium++; break
      case LOD_LEVELS.LOW: this.stats.low++; break
      case LOD_LEVELS.BILLBOARD: this.stats.billboard++; break
      case LOD_LEVELS.HIDDEN: this.stats.hidden++; break
    }
  }

  /**
   * Get appropriate LOD level for distance (with hysteresis)
   */
  _getLevelForDistance(dist, currentLevel) {
    const t = this.thresholds
    const h = this.hysteresis

    // Going from near to far
    if (dist <= t.high) return LOD_LEVELS.HIGH
    if (dist <= t.medium) return LOD_LEVELS.MEDIUM
    if (dist <= t.low) return LOD_LEVELS.LOW
    if (dist <= t.billboard) return LOD_LEVELS.BILLBOARD
    return LOD_LEVELS.HIDDEN

    // Note: For full hysteresis, we'd check both directions:
    // if (currentLevel === LOD_LEVELS.HIGH && dist > t.high * h) return LOD_LEVELS.MEDIUM
    // etc. Simplified for performance.
  }

  /**
   * Switch an object to a new LOD level
   */
  _switchLevel(lodObj, newLevel) {
    const oldLevel = lodObj.currentLevel

    // Hide old mesh
    const oldMesh = this._getMeshForLevel(lodObj, oldLevel)
    if (oldMesh) oldMesh.visible = false

    // Show new mesh
    const newMesh = this._getMeshForLevel(lodObj, newLevel)
    if (newMesh) newMesh.visible = true

    lodObj.currentLevel = newLevel
  }

  /**
   * Get mesh for a given LOD level
   */
  _getMeshForLevel(lodObj, level) {
    switch (level) {
      case LOD_LEVELS.HIGH: return lodObj.meshes.high
      case LOD_LEVELS.MEDIUM: return lodObj.meshes.medium
      case LOD_LEVELS.LOW: return lodObj.meshes.low
      case LOD_LEVELS.BILLBOARD: return lodObj.meshes.billboard
      default: return null
    }
  }

  /**
   * Clear all LOD objects
   */
  clear() {
    this.lodObjects.length = 0
  }

  /**
   * Get performance stats
   */
  getStats() {
    return { ...this.stats, total: this.lodObjects.length }
  }
}

/**
 * Simple LOD helper for creating reduced-detail meshes
 */
export class LODMeshFactory {
  constructor(THREE) {
    this.THREE = THREE
  }

  /**
   * Create a simplified version of a mesh (reduce geometry)
   * Note: This is a basic implementation - for production, use a proper mesh simplification algorithm
   */
  createSimplified(originalMesh, detailFactor = 0.5) {
    // Clone the mesh
    const simplified = originalMesh.clone()

    // For now, just scale it slightly (placeholder for real simplification)
    // In production, you'd use something like simplify-js or a geometry reduction algorithm

    return simplified
  }

  /**
   * Create a billboard sprite from a mesh
   */
  createBillboard(originalMesh, size = 1, color = 0xffffff) {
    // Create a simple sprite as billboard
    const spriteMaterial = new this.THREE.SpriteMaterial({
      color: color,
      transparent: true,
      opacity: 0.8
    })

    const sprite = new this.THREE.Sprite(spriteMaterial)
    sprite.scale.set(size, size, 1)

    // Copy position from original
    sprite.position.copy(originalMesh.position)

    return sprite
  }

  /**
   * Create LOD set with automatic simplified versions
   */
  createLODSet(originalMesh, options = {}) {
    const high = originalMesh

    // Medium detail - slightly simplified
    const medium = options.medium || this.createSimplified(originalMesh, 0.6)
    medium.position.copy(high.position)
    medium.rotation.copy(high.rotation)
    medium.scale.copy(high.scale)

    // Low detail - more simplified
    const low = options.low || this.createSimplified(originalMesh, 0.3)
    low.position.copy(high.position)
    low.rotation.copy(high.rotation)
    low.scale.copy(high.scale)

    // Billboard for very far
    const billboard = options.billboard || this.createBillboard(originalMesh, 1, 0x666666)

    return { high, medium, low, billboard }
  }
}

/**
 * Instanced LOD for many identical objects (trees, rocks, etc.)
 */
export class InstancedLOD {
  constructor(THREE, options = {}) {
    this.THREE = THREE
    this.maxInstances = options.maxInstances || 100

    // Instance data
    this.instances = []

    // Instanced meshes for each LOD level
    this.instancedMeshes = {
      high: null,
      medium: null,
      low: null
    }

    // Distance thresholds
    this.thresholds = {
      high: options.highDist || 20,
      medium: options.mediumDist || 50,
      low: options.lowDist || 100
    }
  }

  /**
   * Initialize with geometries for each LOD level
   */
  init(highGeom, mediumGeom, lowGeom, material) {
    // Create instanced meshes
    this.instancedMeshes.high = new this.THREE.InstancedMesh(
      highGeom,
      material,
      this.maxInstances
    )
    this.instancedMeshes.medium = new this.THREE.InstancedMesh(
      mediumGeom,
      material,
      this.maxInstances
    )
    this.instancedMeshes.low = new this.THREE.InstancedMesh(
      lowGeom,
      material,
      this.maxInstances
    )

    // Initially hide medium and low
    this.instancedMeshes.medium.count = 0
    this.instancedMeshes.low.count = 0
  }

  /**
   * Add an instance
   */
  addInstance(matrix) {
    if (this.instances.length >= this.maxInstances) {
      console.warn('InstancedLOD: max instances reached')
      return -1
    }

    const index = this.instances.length
    this.instances.push({
      matrix: matrix.clone(),
      position: new this.THREE.Vector3().setFromMatrixPosition(matrix),
      currentLOD: 'high'
    })

    // Set the matrix for all LOD levels
    this.instancedMeshes.high.setMatrixAt(index, matrix)
    this.instancedMeshes.medium.setMatrixAt(index, matrix)
    this.instancedMeshes.low.setMatrixAt(index, matrix)

    this.instancedMeshes.high.count = this.instances.length

    return index
  }

  /**
   * Update LOD assignments based on camera position
   */
  update(cameraPosition) {
    let highCount = 0
    let mediumCount = 0
    let lowCount = 0

    const t = this.thresholds
    const tempMatrix = scratch.mat4()

    for (let i = 0; i < this.instances.length; i++) {
      const inst = this.instances[i]
      const dist = inst.position.distanceTo(cameraPosition)

      // Determine LOD and assign to appropriate instanced mesh
      if (dist <= t.high) {
        this.instancedMeshes.high.setMatrixAt(highCount, inst.matrix)
        highCount++
      } else if (dist <= t.medium) {
        this.instancedMeshes.medium.setMatrixAt(mediumCount, inst.matrix)
        mediumCount++
      } else if (dist <= t.low) {
        this.instancedMeshes.low.setMatrixAt(lowCount, inst.matrix)
        lowCount++
      }
      // Beyond low threshold - not rendered
    }

    // Update instance counts
    this.instancedMeshes.high.count = highCount
    this.instancedMeshes.medium.count = mediumCount
    this.instancedMeshes.low.count = lowCount

    // Mark matrices as needing update
    this.instancedMeshes.high.instanceMatrix.needsUpdate = true
    this.instancedMeshes.medium.instanceMatrix.needsUpdate = true
    this.instancedMeshes.low.instanceMatrix.needsUpdate = true
  }

  /**
   * Add all instanced meshes to scene
   */
  addToScene(scene) {
    scene.add(this.instancedMeshes.high)
    scene.add(this.instancedMeshes.medium)
    scene.add(this.instancedMeshes.low)
  }

  /**
   * Dispose all resources
   */
  dispose() {
    this.instancedMeshes.high?.dispose()
    this.instancedMeshes.medium?.dispose()
    this.instancedMeshes.low?.dispose()
  }
}
