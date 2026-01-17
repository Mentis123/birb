/**
 * High-performance collision detection system
 *
 * Optimizations:
 * - Squared distance comparisons (avoids sqrt)
 * - Spatial hash grid for broad phase
 * - Pre-allocated scratch vectors
 * - Batch collision checks
 */

import { scratch } from './scratch-allocations.js'

/**
 * Spatial hash grid for broad-phase collision detection
 */
export class SpatialHashGrid {
  constructor(cellSize = 10) {
    this.cellSize = cellSize
    this.invCellSize = 1 / cellSize
    this.cells = new Map()
    this.objectCells = new Map() // object -> cell keys
  }

  /**
   * Get cell key from position
   */
  _getKey(x, y, z) {
    const cx = Math.floor(x * this.invCellSize)
    const cy = Math.floor(y * this.invCellSize)
    const cz = Math.floor(z * this.invCellSize)
    return `${cx},${cy},${cz}`
  }

  /**
   * Insert an object into the grid
   */
  insert(object, x, y, z, radius = 1) {
    // Remove from old cells first
    this.remove(object)

    // Calculate all cells this object overlaps
    const minX = Math.floor((x - radius) * this.invCellSize)
    const maxX = Math.floor((x + radius) * this.invCellSize)
    const minY = Math.floor((y - radius) * this.invCellSize)
    const maxY = Math.floor((y + radius) * this.invCellSize)
    const minZ = Math.floor((z - radius) * this.invCellSize)
    const maxZ = Math.floor((z + radius) * this.invCellSize)

    const cellKeys = []

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const key = `${cx},${cy},${cz}`
          cellKeys.push(key)

          if (!this.cells.has(key)) {
            this.cells.set(key, new Set())
          }
          this.cells.get(key).add(object)
        }
      }
    }

    this.objectCells.set(object, cellKeys)
  }

  /**
   * Remove an object from the grid
   */
  remove(object) {
    const cellKeys = this.objectCells.get(object)
    if (cellKeys) {
      for (const key of cellKeys) {
        const cell = this.cells.get(key)
        if (cell) {
          cell.delete(object)
          if (cell.size === 0) {
            this.cells.delete(key)
          }
        }
      }
      this.objectCells.delete(object)
    }
  }

  /**
   * Query potential colliders near a position
   */
  query(x, y, z, radius = 1) {
    const results = new Set()

    const minX = Math.floor((x - radius) * this.invCellSize)
    const maxX = Math.floor((x + radius) * this.invCellSize)
    const minY = Math.floor((y - radius) * this.invCellSize)
    const maxY = Math.floor((y + radius) * this.invCellSize)
    const minZ = Math.floor((z - radius) * this.invCellSize)
    const maxZ = Math.floor((z + radius) * this.invCellSize)

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const key = `${cx},${cy},${cz}`
          const cell = this.cells.get(key)
          if (cell) {
            for (const obj of cell) {
              results.add(obj)
            }
          }
        }
      }
    }

    return results
  }

  /**
   * Clear all objects from the grid
   */
  clear() {
    this.cells.clear()
    this.objectCells.clear()
  }
}

/**
 * Optimized collision system using spatial hashing and squared distances
 */
export class OptimizedCollisionSystem {
  constructor(THREE, options = {}) {
    this.THREE = THREE

    // Spatial hash for broad phase
    this.spatialHash = new SpatialHashGrid(options.cellSize || 10)

    // Collision groups (for filtering)
    this.groups = new Map()

    // Pre-allocated collision result object
    this.result = {
      collided: false,
      object: null,
      position: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      penetration: 0
    }

    // Performance stats
    this.stats = {
      broadPhaseChecks: 0,
      narrowPhaseChecks: 0,
      collisionsDetected: 0
    }
  }

  /**
   * Register a collider
   * @param {string} group - Collision group name
   * @param {object} collider - { object, getPosition(), radius }
   */
  registerCollider(group, collider) {
    if (!this.groups.has(group)) {
      this.groups.set(group, [])
    }
    this.groups.get(group).push(collider)

    // Add to spatial hash
    const pos = collider.getPosition()
    this.spatialHash.insert(collider, pos.x, pos.y, pos.z, collider.radius)
  }

  /**
   * Remove a collider
   */
  unregisterCollider(group, collider) {
    const groupColliders = this.groups.get(group)
    if (groupColliders) {
      const idx = groupColliders.indexOf(collider)
      if (idx !== -1) {
        groupColliders.splice(idx, 1)
      }
    }
    this.spatialHash.remove(collider)
  }

  /**
   * Update collider positions in spatial hash
   */
  updateColliderPositions(group) {
    const colliders = this.groups.get(group)
    if (!colliders) return

    for (const collider of colliders) {
      const pos = collider.getPosition()
      this.spatialHash.insert(collider, pos.x, pos.y, pos.z, collider.radius)
    }
  }

  /**
   * Check sphere vs sphere collision using squared distance
   * Returns true if collision detected
   */
  checkSphereSphere(pos1, radius1, pos2, radius2) {
    const dx = pos2.x - pos1.x
    const dy = pos2.y - pos1.y
    const dz = pos2.z - pos1.z

    const distSq = dx * dx + dy * dy + dz * dz
    const radiusSum = radius1 + radius2
    const radiusSumSq = radiusSum * radiusSum

    return distSq < radiusSumSq
  }

  /**
   * Check sphere vs sphere with full collision info
   */
  checkSphereSphereDetailed(pos1, radius1, pos2, radius2, result) {
    const dx = pos2.x - pos1.x
    const dy = pos2.y - pos1.y
    const dz = pos2.z - pos1.z

    const distSq = dx * dx + dy * dy + dz * dz
    const radiusSum = radius1 + radius2
    const radiusSumSq = radiusSum * radiusSum

    if (distSq >= radiusSumSq) {
      result.collided = false
      return result
    }

    const dist = Math.sqrt(distSq)
    result.collided = true
    result.penetration = radiusSum - dist

    // Calculate collision normal
    if (dist > 0.0001) {
      result.normal.set(dx / dist, dy / dist, dz / dist)
    } else {
      result.normal.set(0, 1, 0) // Default normal if overlapping
    }

    // Calculate collision point
    result.position.copy(pos1).addScaledVector(result.normal, radius1)

    return result
  }

  /**
   * Check a point against all colliders in a group
   * Uses broad phase spatial hash + narrow phase sphere check
   */
  checkPointVsGroup(position, radius, group) {
    this.stats.broadPhaseChecks = 0
    this.stats.narrowPhaseChecks = 0
    this.stats.collisionsDetected = 0

    const colliders = this.groups.get(group)
    if (!colliders) {
      this.result.collided = false
      return this.result
    }

    // Broad phase: query spatial hash
    const candidates = this.spatialHash.query(
      position.x, position.y, position.z,
      radius + 10 // Add some margin
    )
    this.stats.broadPhaseChecks = candidates.size

    // Narrow phase: check each candidate
    for (const candidate of candidates) {
      // Skip if not in the target group
      if (!colliders.includes(candidate)) continue

      this.stats.narrowPhaseChecks++

      const candidatePos = candidate.getPosition()
      if (this.checkSphereSphere(position, radius, candidatePos, candidate.radius)) {
        this.stats.collisionsDetected++

        // Get detailed collision info
        this.checkSphereSphereDetailed(
          position, radius,
          candidatePos, candidate.radius,
          this.result
        )
        this.result.object = candidate.object

        return this.result
      }
    }

    this.result.collided = false
    this.result.object = null
    return this.result
  }

  /**
   * Check collisions between two groups
   * Returns array of collision pairs
   */
  checkGroupVsGroup(groupA, groupB) {
    const collidersA = this.groups.get(groupA) || []
    const collidersB = this.groups.get(groupB) || []
    const collisions = []

    for (const a of collidersA) {
      const posA = a.getPosition()

      // Broad phase
      const candidates = this.spatialHash.query(
        posA.x, posA.y, posA.z,
        a.radius + 10
      )

      // Narrow phase
      for (const b of candidates) {
        if (!collidersB.includes(b)) continue

        const posB = b.getPosition()
        if (this.checkSphereSphere(posA, a.radius, posB, b.radius)) {
          collisions.push({ a, b })
        }
      }
    }

    return collisions
  }

  /**
   * Simple sphere collision check against world boundary sphere
   * Used for keeping bird inside the spherical world
   */
  checkSphereInWorld(position, entityRadius, worldCenter, worldRadius) {
    const tempVec = scratch.vec3()

    // Vector from world center to entity
    tempVec.subVectors(position, worldCenter)
    const distFromCenter = tempVec.length()

    // Check if outside world boundary
    const maxDist = worldRadius - entityRadius
    if (distFromCenter > maxDist) {
      // Push back inside
      const normal = scratch.vec3().copy(tempVec).normalize()
      const correctedPos = scratch.vec3()
        .copy(worldCenter)
        .addScaledVector(normal, maxDist)

      return {
        collided: true,
        correctedPosition: correctedPos,
        normal: normal,
        penetration: distFromCenter - maxDist
      }
    }

    return { collided: false }
  }

  /**
   * Clear all colliders
   */
  clear() {
    this.groups.clear()
    this.spatialHash.clear()
  }

  getStats() {
    return { ...this.stats }
  }
}

/**
 * Lightweight collision checker for simple sphere-sphere tests
 * No spatial hashing, just direct checks with squared distances
 */
export class SimpleCollisionChecker {
  constructor() {
    this._tempResult = {
      collided: false,
      index: -1,
      distSq: 0
    }
  }

  /**
   * Check position against array of targets
   * Each target should have: { position: Vector3, radius: number }
   */
  checkVsArray(pos, radius, targets) {
    this._tempResult.collided = false
    this._tempResult.index = -1

    const radiusSq = radius * radius

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      if (!target || !target.position) continue

      const dx = target.position.x - pos.x
      const dy = target.position.y - pos.y
      const dz = target.position.z - pos.z
      const distSq = dx * dx + dy * dy + dz * dz

      const targetRadiusSq = target.radius * target.radius
      const combinedRadiusSq = radiusSq + targetRadiusSq + 2 * radius * target.radius

      if (distSq < combinedRadiusSq) {
        this._tempResult.collided = true
        this._tempResult.index = i
        this._tempResult.distSq = distSq
        return this._tempResult
      }
    }

    return this._tempResult
  }

  /**
   * Check position against array using squared distance threshold
   */
  findNearestInRange(pos, maxDistSq, targets) {
    let nearestIdx = -1
    let nearestDistSq = maxDistSq

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      if (!target || !target.position) continue

      const dx = target.position.x - pos.x
      const dy = target.position.y - pos.y
      const dz = target.position.z - pos.z
      const distSq = dx * dx + dy * dy + dz * dz

      if (distSq < nearestDistSq) {
        nearestDistSq = distSq
        nearestIdx = i
      }
    }

    return {
      found: nearestIdx !== -1,
      index: nearestIdx,
      distSq: nearestDistSq
    }
  }
}
