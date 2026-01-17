/**
 * Centralized scratch allocation manager
 * Pre-allocates all temporary math objects to eliminate per-frame garbage collection
 *
 * Usage:
 *   import { scratch } from './scratch-allocations.js'
 *   scratch.init(THREE)
 *
 *   // In update loop:
 *   scratch.frameStart()  // Reset indices
 *   const tempVec = scratch.vec3()  // Get a scratch vector
 *   tempVec.copy(someVector).add(otherVector)  // Use it
 *   // No need to release - automatically recycled on next frameStart()
 */

class ScratchAllocations {
  constructor() {
    this.initialized = false
    this.THREE = null

    // Pre-allocated pools
    this._vec3Pool = []
    this._vec3Index = 0

    this._vec2Pool = []
    this._vec2Index = 0

    this._quatPool = []
    this._quatIndex = 0

    this._mat4Pool = []
    this._mat4Index = 0

    this._colorPool = []
    this._colorIndex = 0

    this._eulerPool = []
    this._eulerIndex = 0

    // Named scratch vectors for specific purposes (never recycled)
    this.named = {}
  }

  /**
   * Initialize with Three.js reference
   */
  init(THREE, options = {}) {
    if (this.initialized) return this

    this.THREE = THREE

    const vec3Count = options.vec3Count || 50
    const vec2Count = options.vec2Count || 20
    const quatCount = options.quatCount || 20
    const mat4Count = options.mat4Count || 10
    const colorCount = options.colorCount || 10
    const eulerCount = options.eulerCount || 10

    // Pre-allocate Vector3 pool
    for (let i = 0; i < vec3Count; i++) {
      this._vec3Pool.push(new THREE.Vector3())
    }

    // Pre-allocate Vector2 pool
    for (let i = 0; i < vec2Count; i++) {
      this._vec2Pool.push(new THREE.Vector2())
    }

    // Pre-allocate Quaternion pool
    for (let i = 0; i < quatCount; i++) {
      this._quatPool.push(new THREE.Quaternion())
    }

    // Pre-allocate Matrix4 pool
    for (let i = 0; i < mat4Count; i++) {
      this._mat4Pool.push(new THREE.Matrix4())
    }

    // Pre-allocate Color pool
    for (let i = 0; i < colorCount; i++) {
      this._colorPool.push(new THREE.Color())
    }

    // Pre-allocate Euler pool
    for (let i = 0; i < eulerCount; i++) {
      this._eulerPool.push(new THREE.Euler())
    }

    // Create named scratch vectors for common operations
    this.named = {
      // Flight physics
      flightDirection: new THREE.Vector3(),
      flightRight: new THREE.Vector3(),
      flightUp: new THREE.Vector3(),
      flightVelocity: new THREE.Vector3(),
      flightNormal: new THREE.Vector3(),

      // Collision detection
      collisionPos: new THREE.Vector3(),
      collisionNormal: new THREE.Vector3(),
      collisionDelta: new THREE.Vector3(),
      collisionPush: new THREE.Vector3(),

      // Camera
      cameraTarget: new THREE.Vector3(),
      cameraOffset: new THREE.Vector3(),
      cameraLookAt: new THREE.Vector3(),

      // Particle emission
      particlePos: new THREE.Vector3(),
      particleVel: new THREE.Vector3(),
      particleOffset: new THREE.Vector3(),

      // General purpose
      worldPos: new THREE.Vector3(),
      localPos: new THREE.Vector3(),
      deltaPos: new THREE.Vector3(),
      tempQuat: new THREE.Quaternion(),
      tempMat4: new THREE.Matrix4(),
      tempColor: new THREE.Color(),
      tempEuler: new THREE.Euler()
    }

    this.initialized = true
    return this
  }

  /**
   * Call at the start of each frame to reset pool indices
   */
  frameStart() {
    this._vec3Index = 0
    this._vec2Index = 0
    this._quatIndex = 0
    this._mat4Index = 0
    this._colorIndex = 0
    this._eulerIndex = 0
  }

  /**
   * Get a scratch Vector3
   * WARNING: Only valid until next frameStart() call
   */
  vec3() {
    if (this._vec3Index >= this._vec3Pool.length) {
      // Pool exhausted - create more (shouldn't happen in normal use)
      console.warn('ScratchAllocations: vec3 pool exhausted, creating more')
      this._vec3Pool.push(new this.THREE.Vector3())
    }
    return this._vec3Pool[this._vec3Index++]
  }

  /**
   * Get a scratch Vector2
   */
  vec2() {
    if (this._vec2Index >= this._vec2Pool.length) {
      console.warn('ScratchAllocations: vec2 pool exhausted, creating more')
      this._vec2Pool.push(new this.THREE.Vector2())
    }
    return this._vec2Pool[this._vec2Index++]
  }

  /**
   * Get a scratch Quaternion
   */
  quat() {
    if (this._quatIndex >= this._quatPool.length) {
      console.warn('ScratchAllocations: quat pool exhausted, creating more')
      this._quatPool.push(new this.THREE.Quaternion())
    }
    return this._quatPool[this._quatIndex++]
  }

  /**
   * Get a scratch Matrix4
   */
  mat4() {
    if (this._mat4Index >= this._mat4Pool.length) {
      console.warn('ScratchAllocations: mat4 pool exhausted, creating more')
      this._mat4Pool.push(new this.THREE.Matrix4())
    }
    return this._mat4Pool[this._mat4Index++]
  }

  /**
   * Get a scratch Color
   */
  color() {
    if (this._colorIndex >= this._colorPool.length) {
      console.warn('ScratchAllocations: color pool exhausted, creating more')
      this._colorPool.push(new this.THREE.Color())
    }
    return this._colorPool[this._colorIndex++]
  }

  /**
   * Get a scratch Euler
   */
  euler() {
    if (this._eulerIndex >= this._eulerPool.length) {
      console.warn('ScratchAllocations: euler pool exhausted, creating more')
      this._eulerPool.push(new this.THREE.Euler())
    }
    return this._eulerPool[this._eulerIndex++]
  }

  /**
   * Get current pool usage stats
   */
  getStats() {
    return {
      vec3: { used: this._vec3Index, total: this._vec3Pool.length },
      vec2: { used: this._vec2Index, total: this._vec2Pool.length },
      quat: { used: this._quatIndex, total: this._quatPool.length },
      mat4: { used: this._mat4Index, total: this._mat4Pool.length },
      color: { used: this._colorIndex, total: this._colorPool.length },
      euler: { used: this._eulerIndex, total: this._eulerPool.length }
    }
  }
}

// Singleton instance
export const scratch = new ScratchAllocations()

// Also export class for testing
export { ScratchAllocations }
