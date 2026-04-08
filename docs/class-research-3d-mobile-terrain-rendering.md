# Class Research: 3D Mobile Browser Terrain & Environment Rendering

_Date: April 8, 2026_

## Purpose
This document captures research on high-impact techniques and real-world references for making **Birb**'s terrain and environment rendering look significantly better on mobile browsers while remaining performant.

## Key Industry Patterns

### 1) Streamed terrain detail with strong LOD policies
Modern web 3D stacks avoid loading full worlds at once. They stream terrain/scene tiles and select level-of-detail (LOD) based on camera position and visual error.

Why this matters for Birb:
- Reduces startup time and memory pressure on phones.
- Keeps near-field detail high while simplifying far-field geometry.
- Prevents frame drops caused by over-detailed distant content.

References:
- Cesium blog on 3D Tiles performance work: https://cesium.com/blog/2019/05/07/faster-3d-tiles/
- CesiumJS tileset API and tuning options: https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html

### 2) Hybrid map/terrain engines plus custom 3D object layers
A common production pattern is to use a map/terrain engine for camera + terrain while overlaying custom 3D content.

Why this matters for Birb:
- Lets us stand on mature terrain/camera systems quickly.
- Frees Birb-specific development time for bird feel, effects, and gameplay.

References:
- MapLibre example: Three.js model on terrain: https://maplibre.org/maplibre-gl-js/docs/examples/adding-3d-models-using-threejs-on-terrain/
- deck.gl TerrainLayer example: https://deck.gl/examples/terrain-layer

### 3) Mobile-first performance engineering is now a solved discipline
Most mature frameworks now document concrete mobile optimization strategies: fewer draw calls, binary data paths, aggressive layer simplification, and progressive loading.

Why this matters for Birb:
- We can define clear budgets and automatically scale quality to keep frame times stable.

References:
- deck.gl performance guide: https://deck.gl/docs/developer-guide/performance
- Mapbox GL JS performance guide: https://docs.mapbox.com/help/troubleshooting/mapbox-gl-js-performance/

### 4) WebGPU is increasingly practical, but fallback is required
WebGPU enables stronger GPU-driven pipelines (compute-assisted culling/effects), but mobile/browser variance means WebGL fallback should remain part of architecture.

Why this matters for Birb:
- Future headroom for better atmospherics/terrain shading.
- Maintain broad device compatibility with a fallback renderer path.

References:
- WebGPU support overview: https://web.dev/blog/webgpu-supported-major-browsers
- Babylon and PlayCanvas engine ecosystem references:
  - https://www.babylonjs.com/specifications/
  - https://playcanvas.com/

## Concrete Recommendations for Birb

### Recommended technical priorities
1. Implement chunked terrain streaming with distance-based LOD.
2. Use instancing for repeated environment props (rocks, trees, particles, birds).
3. Add adaptive quality controls tied to frame time:
   - dynamic resolution
   - shadow distance/resolution scaling
   - post-processing toggles
4. Use compressed assets by default:
   - textures: KTX2/Basis
   - geometry: Draco or Meshopt
5. Favor "atmospheric" quality tricks over raw geometry complexity:
   - fog/aerial perspective
   - sky and gradient tuning
   - subtle volumetric-like cloud layers (cheap approximations)
6. Render-on-demand for static/non-changing states when possible.

### Suggested starting budgets for mid-tier mobile devices
- Draw calls: target < 150 visible per frame
- Visible triangles: target < 1.5M
- Shadow map size: cap at <= 2048
- Peak GPU memory: keep under ~300MB (device-dependent)

## Proposed Implementation Phases

### Phase A (fast wins, 1-2 weeks)
- Add a real-time perf HUD (FPS, draw calls, tris, frame time).
- Add dynamic resolution scaling.
- Convert repeated props to GPU instancing.
- Turn on texture/geometry compression in pipeline.

### Phase B (core visual upgrade)
- Add terrain chunking + geomorph transitions.
- Add distance-tiered material complexity.
- Improve environment atmosphere (fog, sky gradients, lighting polish).

### Phase C (forward-looking)
- Prototype WebGPU renderer path for heavy effects/culling.
- Keep WebGL path as default fallback for broad compatibility.

## Notes for Class / Team Discussion
- The biggest gains are from **architecture and budgets**, not one-off shader tricks.
- "Feels better" on mobile usually comes from stable frame times first, then visual polish.
- Success criteria should include both visual metrics and frame-time consistency on real devices.
