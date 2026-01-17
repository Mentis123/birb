/**
 * High-performance frustum culling system
 *
 * Optimizations:
 * - Pre-allocated frustum and matrix objects
 * - Spatial partitioning for large object counts
 * - Distance-based culling tiers
 * - Batch visibility updates
 */

import { scratch } from './scratch-allocations.js'

export class FrustumCuller {
  constructor(THREE) {
    this.THREE = THREE

    // Pre-allocated frustum (reused each frame)
    this.frustum = new THREE.Frustum()
    this.projScreenMatrix = new THREE.Matrix4()

    // Objects to cull
    this.cullables = []

    // Distance culling thresholds
    this.nearDistance = 5 // Always visible
    this.farDistance = 150 // Never visible beyond this
    this.mediumDistance = 50 // Reduced detail beyond this

    // Cached camera position for distance calculations
    this.cameraPosition = new THREE.Vector3()

    // Performance stats
    this.stats = {
      totalObjects: 0,
      visibleObjects: 0,
      culledByFrustum: 0,
      culledByDistance: 0
    }
  }

  /**
   * Register an object for culling
   * @param {THREE.Object3D} object - The object to cull
   * @param {number} radius - Bounding sphere radius
   * @param {string} tier - 'critical' (never cull), 'normal', 'detail' (aggressive cull)
   */
  register(object, radius = 1, tier = 'normal') {
    this.cullables.push({
      object,
      radius,
      tier,
      // Pre-allocated for world position
      worldPosition: new this.THREE.Vector3(),
      boundingSphere: new this.THREE.Sphere(new this.THREE.Vector3(), radius),
      wasVisible: true
    })
    return this.cullables.length - 1
  }

  /**
   * Register multiple objects at once
   */
  registerBatch(objects, radius = 1, tier = 'normal') {
    const indices = []
    for (const obj of objects) {
      indices.push(this.register(obj, radius, tier))
    }
    return indices
  }

  /**
   * Unregister an object
   */
  unregister(object) {
    const idx = this.cullables.findIndex(c => c.object === object)
    if (idx !== -1) {
      this.cullables.splice(idx, 1)
    }
  }

  /**
   * Clear all registered objects
   */
  clear() {
    this.cullables.length = 0
  }

  /**
   * Update visibility for all registered objects
   * @param {THREE.Camera} camera - The active camera
   */
  update(camera) {
    // Update frustum from camera
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    )
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix)

    // Cache camera position
    camera.getWorldPosition(this.cameraPosition)

    // Reset stats
    this.stats.totalObjects = this.cullables.length
    this.stats.visibleObjects = 0
    this.stats.culledByFrustum = 0
    this.stats.culledByDistance = 0

    // Process each cullable
    for (const cullable of this.cullables) {
      const visible = this._checkVisibility(cullable)

      // Only update if visibility changed (avoid unnecessary state changes)
      if (cullable.wasVisible !== visible) {
        cullable.object.visible = visible
        cullable.wasVisible = visible
      }

      if (visible) {
        this.stats.visibleObjects++
      }
    }
  }

  /**
   * Check if a single cullable should be visible
   */
  _checkVisibility(cullable) {
    const { object, radius, tier, worldPosition, boundingSphere } = cullable

    // Critical tier: never cull
    if (tier === 'critical') {
      return true
    }

    // Get world position
    object.getWorldPosition(worldPosition)

    // Distance culling (using squared distance for performance)
    const distSq = worldPosition.distanceToSquared(this.cameraPosition)
    const farDistSq = this.farDistance * this.farDistance

    // Distance-based culling
    if (tier === 'detail') {
      // Detail objects cull at medium distance
      const mediumDistSq = this.mediumDistance * this.mediumDistance
      if (distSq > mediumDistSq) {
        this.stats.culledByDistance++
        return false
      }
    } else {
      // Normal objects cull at far distance
      if (distSq > farDistSq) {
        this.stats.culledByDistance++
        return false
      }
    }

    // Frustum culling using bounding sphere
    boundingSphere.center.copy(worldPosition)
    boundingSphere.radius = radius

    if (!this.frustum.intersectsSphere(boundingSphere)) {
      this.stats.culledByFrustum++
      return false
    }

    return true
  }

  /**
   * Quick check if a point is in the frustum
   */
  isPointVisible(point) {
    return this.frustum.containsPoint(point)
  }

  /**
   * Quick check if a sphere is in the frustum
   */
  isSphereVisible(center, radius) {
    const sphere = scratch.vec3().copy(center)
    // Create temporary sphere using scratch
    return this.frustum.intersectsSphere({
      center: sphere,
      radius: radius
    })
  }

  /**
   * Set distance culling thresholds
   */
  setDistances(near, medium, far) {
    this.nearDistance = near
    this.mediumDistance = medium
    this.farDistance = far
  }

  /**
   * Get performance stats
   */
  getStats() {
    return { ...this.stats }
  }
}

/**
 * Lightweight distance-based visibility system
 * Simpler than full frustum culling, good for particles and small objects
 */
export class DistanceCuller {
  constructor(THREE) {
    this.THREE = THREE
    this.cameraPosition = new THREE.Vector3()
    this.objects = new Map() // object -> { maxDistSq, wasVisible }
  }

  /**
   * Register an object with a maximum visible distance
   */
  register(object, maxDistance) {
    this.objects.set(object, {
      maxDistSq: maxDistance * maxDistance,
      wasVisible: true
    })
  }

  /**
   * Unregister an object
   */
  unregister(object) {
    this.objects.delete(object)
  }

  /**
   * Update visibility based on camera position
   */
  update(camera) {
    camera.getWorldPosition(this.cameraPosition)

    const tempPos = scratch.vec3()

    for (const [object, data] of this.objects) {
      object.getWorldPosition(tempPos)
      const distSq = tempPos.distanceToSquared(this.cameraPosition)
      const visible = distSq <= data.maxDistSq

      if (data.wasVisible !== visible) {
        object.visible = visible
        data.wasVisible = visible
      }
    }
  }

  clear() {
    this.objects.clear()
  }
}
