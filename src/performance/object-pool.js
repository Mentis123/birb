/**
 * High-performance object pooling system
 * Eliminates garbage collection pressure by reusing objects
 */

/**
 * Generic object pool for any type of object
 */
export class ObjectPool {
  constructor(factory, reset, initialSize = 10) {
    this.factory = factory
    this.reset = reset
    this.pool = []
    this.activeCount = 0

    // Pre-allocate initial objects
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory())
    }
  }

  /**
   * Get an object from the pool, creating one if necessary
   */
  acquire() {
    let obj
    if (this.pool.length > 0) {
      obj = this.pool.pop()
    } else {
      obj = this.factory()
    }
    this.activeCount++
    return obj
  }

  /**
   * Return an object to the pool
   */
  release(obj) {
    this.reset(obj)
    this.pool.push(obj)
    this.activeCount--
  }

  /**
   * Pre-warm the pool with additional objects
   */
  prewarm(count) {
    for (let i = 0; i < count; i++) {
      this.pool.push(this.factory())
    }
  }

  /**
   * Clear all pooled objects (for cleanup)
   */
  clear() {
    this.pool.length = 0
    this.activeCount = 0
  }

  get available() {
    return this.pool.length
  }

  get total() {
    return this.pool.length + this.activeCount
  }
}

/**
 * Specialized pool for Three.js Vector3 objects
 * Pre-allocated scratch vectors for math operations
 */
export class Vector3Pool {
  constructor(THREE, size = 20) {
    this.THREE = THREE
    this.vectors = []
    this.index = 0

    for (let i = 0; i < size; i++) {
      this.vectors.push(new THREE.Vector3())
    }
  }

  /**
   * Get a scratch vector (auto-cycles through pool)
   * WARNING: Only use for temporary calculations within a single frame
   */
  get() {
    const vec = this.vectors[this.index]
    this.index = (this.index + 1) % this.vectors.length
    return vec
  }

  /**
   * Reset index for new frame
   */
  reset() {
    this.index = 0
  }
}

/**
 * Specialized pool for Three.js Quaternion objects
 */
export class QuaternionPool {
  constructor(THREE, size = 10) {
    this.THREE = THREE
    this.quaternions = []
    this.index = 0

    for (let i = 0; i < size; i++) {
      this.quaternions.push(new THREE.Quaternion())
    }
  }

  get() {
    const quat = this.quaternions[this.index]
    this.index = (this.index + 1) % this.quaternions.length
    return quat
  }

  reset() {
    this.index = 0
  }
}

/**
 * Specialized pool for Three.js Matrix4 objects
 */
export class Matrix4Pool {
  constructor(THREE, size = 5) {
    this.THREE = THREE
    this.matrices = []
    this.index = 0

    for (let i = 0; i < size; i++) {
      this.matrices.push(new THREE.Matrix4())
    }
  }

  get() {
    const mat = this.matrices[this.index]
    this.index = (this.index + 1) % this.matrices.length
    return mat
  }

  reset() {
    this.index = 0
  }
}

/**
 * Pool for particle-like game objects (rockets, projectiles, etc.)
 */
export class GameObjectPool {
  constructor(createFn, resetFn, activateFn, deactivateFn, initialSize = 20) {
    this.createFn = createFn
    this.resetFn = resetFn
    this.activateFn = activateFn
    this.deactivateFn = deactivateFn

    this.inactive = []
    this.active = []

    // Pre-create objects
    for (let i = 0; i < initialSize; i++) {
      const obj = this.createFn()
      this.deactivateFn(obj)
      this.inactive.push(obj)
    }
  }

  /**
   * Spawn an object from the pool
   */
  spawn() {
    let obj
    if (this.inactive.length > 0) {
      obj = this.inactive.pop()
    } else {
      obj = this.createFn()
    }
    this.resetFn(obj)
    this.activateFn(obj)
    this.active.push(obj)
    return obj
  }

  /**
   * Despawn an object back to the pool
   */
  despawn(obj) {
    const index = this.active.indexOf(obj)
    if (index !== -1) {
      this.active.splice(index, 1)
      this.deactivateFn(obj)
      this.inactive.push(obj)
    }
  }

  /**
   * Despawn by index (more efficient for iteration)
   */
  despawnAt(index) {
    if (index >= 0 && index < this.active.length) {
      const obj = this.active[index]
      this.active.splice(index, 1)
      this.deactivateFn(obj)
      this.inactive.push(obj)
      return obj
    }
    return null
  }

  /**
   * Get all active objects
   */
  getActive() {
    return this.active
  }

  /**
   * Iterate over active objects (safe for removal during iteration)
   */
  forEachActive(callback) {
    // Iterate backwards for safe removal
    for (let i = this.active.length - 1; i >= 0; i--) {
      const shouldRemove = callback(this.active[i], i)
      if (shouldRemove) {
        this.despawnAt(i)
      }
    }
  }

  /**
   * Despawn all active objects
   */
  despawnAll() {
    while (this.active.length > 0) {
      this.despawnAt(0)
    }
  }

  get activeCount() {
    return this.active.length
  }

  get inactiveCount() {
    return this.inactive.length
  }
}

/**
 * Typed array pool for particle systems
 * Reduces allocation overhead for Float32Arrays
 */
export class TypedArrayPool {
  constructor() {
    this.pools = new Map()
  }

  /**
   * Get a Float32Array of specified size
   */
  getFloat32(size) {
    const key = `f32_${size}`
    if (!this.pools.has(key)) {
      this.pools.set(key, [])
    }
    const pool = this.pools.get(key)
    if (pool.length > 0) {
      return pool.pop()
    }
    return new Float32Array(size)
  }

  /**
   * Return a Float32Array to the pool
   */
  releaseFloat32(array) {
    const key = `f32_${array.length}`
    if (!this.pools.has(key)) {
      this.pools.set(key, [])
    }
    // Zero out the array before returning
    array.fill(0)
    this.pools.get(key).push(array)
  }

  /**
   * Get a Uint16Array of specified size
   */
  getUint16(size) {
    const key = `u16_${size}`
    if (!this.pools.has(key)) {
      this.pools.set(key, [])
    }
    const pool = this.pools.get(key)
    if (pool.length > 0) {
      return pool.pop()
    }
    return new Uint16Array(size)
  }

  releaseUint16(array) {
    const key = `u16_${array.length}`
    if (!this.pools.has(key)) {
      this.pools.set(key, [])
    }
    array.fill(0)
    this.pools.get(key).push(array)
  }

  clear() {
    this.pools.clear()
  }
}
