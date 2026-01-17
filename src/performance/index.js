/**
 * Performance optimization framework
 *
 * High-performance utilities for mobile game optimization:
 * - Object pooling (eliminate garbage collection)
 * - Scratch allocations (pre-allocated math objects)
 * - Optimized particles (batch buffer updates, draw range)
 * - Frustum culling (skip off-screen rendering)
 * - Collision detection (spatial hashing, squared distance)
 * - LOD system (distance-based detail reduction)
 * - Material optimization (caching, batched updates)
 * - Performance manager (coordinates all systems)
 *
 * Usage:
 *   import { getPerformanceManager, scratch } from './performance/index.js'
 *
 *   // Initialize once
 *   const perf = getPerformanceManager(THREE, { isMobile: true })
 *   perf.init(camera, renderer, scene)
 *
 *   // Each frame:
 *   const delta = perf.frameStart(time)
 *   // ... game logic ...
 *   perf.frameEnd(time)
 *   renderer.render(scene, camera)
 */

// Object pooling
export {
  ObjectPool,
  GameObjectPool,
  Vector3Pool,
  QuaternionPool,
  Matrix4Pool,
  TypedArrayPool
} from './object-pool.js'

// Scratch allocations
export { scratch, ScratchAllocations } from './scratch-allocations.js'

// Particle systems
export { OptimizedParticleSystem, TrailEmitter } from './optimized-particles.js'

// Frustum culling
export { FrustumCuller, DistanceCuller } from './frustum-culling.js'

// Collision detection
export {
  SpatialHashGrid,
  OptimizedCollisionSystem,
  SimpleCollisionChecker
} from './optimized-collision.js'

// LOD system
export {
  LODManager,
  LODMeshFactory,
  InstancedLOD,
  LOD_LEVELS
} from './lod-system.js'

// Material optimization
export {
  MaterialCache,
  AnimatedMaterialManager,
  ShaderProgramManager,
  MaterialBatcher,
  createOptimizedMaterials
} from './material-optimizer.js'

// Performance manager
export {
  PerformanceManager,
  QualityLevel,
  getPerformanceManager,
  resetPerformanceManager
} from './performance-manager.js'
