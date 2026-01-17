# Performance Optimization Notes

## Target Platform: Mobile (WebGL)

This is a mobile-first game running in a browser via WebGL. Key platform constraints:
- **No GPU compute shaders** (WebGL 1.0/2.0 doesn't support them)
- **No transform feedback** for GPU particles (limited mobile support)
- **Limited GPU memory** and fill rate
- **Battery/thermal throttling** on sustained load
- **Variable device capabilities** (low-end to flagship)

---

## Current Optimizations (Implemented)

### 1. Zero-Allocation Math Operations
**Files:** `src/flight/bird-flight.js`, `src/environment/collectibles.js`, `src/environment/speed-trail.js`

- Pre-allocated scratch vectors/quaternions for all per-frame math
- Eliminates garbage collection pauses
- Reused pose output objects

### 2. Squared Distance Collision Detection
**File:** `src/environment/collectibles.js`, `src/performance/optimized-collision.js`

- Avoids expensive `Math.sqrt()` calls
- Compare `distSq < thresholdSq` instead of `dist < threshold`
- ~30% faster collision checks

### 3. Spatial Hash Grid (Available)
**File:** `src/performance/optimized-collision.js`

- O(1) broad-phase collision lookups
- Reduces collision checks from O(n^2) to O(n)
- Grid-based spatial partitioning

### 4. Object Pooling Framework
**File:** `src/performance/object-pool.js`

- Reuse rockets, particles, projectiles
- Eliminates allocation/deallocation overhead
- Pre-warm pools during loading

### 5. Particle System Optimizations
**File:** `src/performance/optimized-particles.js`

- `setDrawRange()` to only render active particles
- Single buffer update per frame (batch `needsUpdate = true`)
- Age-based particle recycling

### 6. LOD System (Available)
**File:** `src/performance/lod-system.js`

- Distance-based detail reduction
- Hysteresis to prevent popping
- Simple visibility culling for distant objects

### 7. Material Caching
**File:** `src/performance/material-optimizer.js`

- Share identical materials (reduces shader switches)
- Batched animated material updates
- Pre-computed sin/cos lookup tables

### 8. Frustum Culling (Available)
**File:** `src/performance/frustum-culling.js`

- Skip rendering off-screen objects
- Distance-based culling tiers

---

## Future Optimizations (Phase 2)

### HIGH IMPACT (Recommended)

#### 1. Instanced Mesh Rendering
**Effort:** Medium | **Impact:** High

Currently: Each tree/rock is a separate mesh = separate draw call
Better: Use `THREE.InstancedMesh` for identical objects

```javascript
// Before: 100 draw calls
trees.forEach(tree => scene.add(tree));

// After: 1 draw call
const instancedTrees = new THREE.InstancedMesh(treeGeom, treeMat, 100);
trees.forEach((tree, i) => instancedTrees.setMatrixAt(i, tree.matrix));
```

**Expected gain:** Reduce draw calls from ~300 to ~10 in forest environment

#### 2. Geometry Merging for Static Objects
**Effort:** Medium | **Impact:** Medium-High

Merge all static world geometry into fewer meshes:
```javascript
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const mergedRocks = mergeGeometries(rockGeometries);
```

**Expected gain:** 50-70% reduction in draw calls for static scenery

#### 3. Dynamic Resolution Scaling
**Effort:** Low | **Impact:** Medium

Auto-reduce pixel ratio when FPS drops:
```javascript
if (fps < 30) {
  renderer.setPixelRatio(Math.max(1.0, currentDPR * 0.8));
}
```

Already partially implemented in performance manager's adaptive quality system.

### MEDIUM IMPACT

#### 4. Web Workers for Collision Detection
**Effort:** High | **Impact:** Medium

Offload collision calculations to background thread:
- Main thread handles rendering
- Worker thread handles physics/collision
- Use SharedArrayBuffer for position data (requires COOP/COEP headers)

**Note:** Adds complexity, only worth it if collision becomes bottleneck

#### 5. Texture Atlases
**Effort:** Medium | **Impact:** Medium

Combine multiple textures into single atlas:
- Reduces texture bind calls
- Better GPU cache utilization

#### 6. Render Target Downscaling for Effects
**Effort:** Medium | **Impact:** Medium

Render particles/glow effects at lower resolution, then composite:
```javascript
const effectTarget = new THREE.WebGLRenderTarget(width/2, height/2);
```

### LOWER PRIORITY

#### 7. Animation LOD
Reduce animation complexity for distant objects:
- Skip wing flapping for far birds
- Reduce particle emission rate at distance

#### 8. Occlusion Culling
Skip objects hidden behind other objects.
**Note:** Complex for spherical world, likely not worth the effort.

---

## Mobile-Specific Considerations

### What WON'T Work on Mobile WebGL:
- GPU compute shaders (WebGL doesn't support)
- Transform feedback for GPU particles (poor mobile support)
- Heavy post-processing (bloom, SSAO, etc.)
- High polygon counts (keep under 100k triangles visible)
- Too many lights (limit to 4-5 total)

### What DOES Work Well:
- Instanced rendering (well supported)
- Geometry merging (CPU-side, no GPU features needed)
- Object pooling (pure JavaScript)
- Spatial hashing (pure JavaScript)
- LOD switching (simple visibility toggling)
- Texture atlases (standard WebGL feature)
- Reduced particle counts based on device
- Dynamic resolution scaling

### Device Detection Strategy:
```javascript
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isLowEnd = navigator.hardwareConcurrency <= 4;

if (isMobile || isLowEnd) {
  perfManager.setQuality(QualityLevel.LOW);
  maxParticles = 100;
  lodManager.setMobileMode();
}
```

---

## Performance Budget Guidelines

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| FPS | 60 | <45 | <30 |
| Draw calls | <100 | >150 | >250 |
| Triangles | <80k | >120k | >200k |
| Texture memory | <64MB | >100MB | >150MB |
| JS heap | <50MB | >80MB | >120MB |
| Frame time | <16ms | >22ms | >33ms |

---

## Profiling Tools

1. **Chrome DevTools Performance tab** - Frame timing, JS profiling
2. **`renderer.info`** - Draw calls, triangles, textures
3. **`performance.memory`** - JS heap size (Chrome only)
4. **Stats.js** - Real-time FPS/MS/MB overlay
5. **Spector.js** - WebGL call inspection

---

## Implementation Priority

1. **Instanced Mesh Rendering** - Biggest impact, moderate effort
2. **Geometry Merging** - Good impact, one-time setup
3. **Dynamic Resolution** - Already partially done, easy to complete
4. **Texture Atlases** - Worth it if texture count is high
5. **Web Workers** - Only if collision becomes bottleneck

Focus on draw call reduction first - that's typically the biggest bottleneck on mobile WebGL.
