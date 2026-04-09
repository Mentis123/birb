# Birb Mobile — Terrain & Environment: Final Consolidated Recommendation

> Synthesised April 2026 from three independent research efforts:
> 1. **Vibe Academy Brain** — broad landscape survey (terrain gen, LOD, vegetation, water, sky, shaders, engines)
> 2. **Claude (Birb)** — Birb-specific audit + phased upgrade path
> 3. **Codex (Birb)** — architectural framing, budgets, streaming patterns
>
> Plus fresh research on spherical terrain, WebGPU status, and new libraries.

---

## Executive Summary

Birb is a **spherical world** game. Most terrain research assumes flat heightmaps — that doesn't apply here. The key insight across all three sources is the same: **the biggest wins come from architecture and budgets, not one-off shader tricks.** Stable frame times first, then visual polish.

**The path forward has four layers:**
1. Fix the foundation (Three.js upgrade, renderer switch)
2. Quick visual wins on the existing sphere (displacement, fog, flat shading, instancing)
3. Chunked sphere with LOD (the real terrain refactor)
4. Atmosphere, vegetation, and progressive WebGPU enhancements

---

## Current State (What We're Working With)

| Area | Now | Opportunity |
|------|-----|-------------|
| **Three.js** | r0.161.0 | r184 (23 releases behind — perf fixes, WebGPU, TSL) |
| **Renderer** | WebGLRenderer, `powerPreference: "low-power"` | WebGPURenderer with auto WebGL2 fallback |
| **World** | Smooth `SphereGeometry(30, 128, 96)`, single mesh | Vertex-displaced terrain with biome-specific noise profiles |
| **Biomes** | 4 variants (Forest/Canyon/Mountain/City), swapped wholesale | Blended biomes on cube-sphere faces |
| **Vegetation** | Cloned objects, Fibonacci spiral placement | Chunked `InstancedMesh`, vertex shader wind |
| **Sky** | Custom gradient shader on inverted sphere | Three.js Sky addon (Preetham scattering) or enhanced gradient |
| **Lighting** | 7 lights, no shadows | 1 directional shadow + hemisphere + point, baked where possible |
| **Fog** | None | Height fog + distance fog (critical for polish and LOD hiding) |
| **Post-FX** | ACES tone mapping (exposure 1.22) | + Bloom (half-res), vignette |
| **LOD** | Infrastructure exists (`lod-system.js`), 5 levels | Actually wire it up to vegetation and terrain chunks |
| **Draw calls** | Not monitored | Budget: <100 on mobile |
| **Materials** | Colors only, no textures | Texture atlases with KTX2/Basis Universal if needed |
| **Particles** | CPU-based PointsMaterial | Keep CPU for now; GPU particles only with WebGPU |
| **Flight controls** | ✅ Resolved and working in production | Don't touch unless it breaks again |

---

## The Sphere Problem

All three research docs reference flat-terrain libraries. **None of them work for Birb:**

| Library | Spherical? | Verdict |
|---------|-----------|---------|
| three-landscape (MartiniMesh) | No — flat PlaneGeometry | Not usable |
| THREE.Terrain | No — flat PlaneGeometry | Not usable |
| Strata | No | Not usable |
| @interverse/three-terrain-lod | No — flat quadtree | Not usable |
| **PlanetTechJS** | **Yes** — cube-sphere + quadtree LOD | Alpha v0.8, reference only |
| hello-terrain | Possibly — spherical spatial hashing | Alpha 0.0.0-alpha.10, too early |
| three-geospatial (Takram) | Globe-scale (geospatial, not game) | Cherry-pick atmosphere only |

**The answer for Birb: custom cube-sphere with quadtree LOD.** Use PlanetTechJS as code reference, not dependency.

### Cube-Sphere in 30 Seconds

1. Start with 6 faces of a cube, each face owns a quadtree
2. Normalize vertices to project onto a sphere
3. Displace vertices along surface normal using noise
4. Subdivide faces near camera, merge faces far away
5. Stitch edges between faces to prevent cracks

Why not icosphere? Rectangular patches are easier for LOD transitions, neighbour-finding, and crack-stitching. Sebastian Lague's planet LOD work confirms this.

---

## Performance Budget (Consolidated & Corrected)

The three sources disagreed on budgets. Here's the reconciled target for **mid-range mobile at 60fps**:

| Metric | Target | Warning | Critical | Source Notes |
|--------|--------|---------|----------|-------------|
| FPS | 60 | <45 | <30 | All three agree |
| Draw calls | **<100** | >150 | >250 | Brain + Claude agree; Codex's <150 is too generous for mobile WebGL |
| Visible triangles | **<100K** | >120K | >200K | Brain + Claude agree; Codex's 1.5M is desktop-only territory |
| Texture VRAM | <64MB | >100MB | >150MB | A 200KB PNG = 20MB+ VRAM — use KTX2 |
| JS heap | <50MB | >80MB | >120MB | |
| Frame time | <16ms | >22ms | >33ms | |
| DPR cap | **2.0** (currently 1.4-1.8) | | | All three agree; current birb values are good |
| Shadow map | ≤1024 | ≤2048 | | Codex said 2048, but 1024 is safer for mobile |
| Lights | ≤5 total | | | 1 directional (shadow) + hemisphere + 2-3 point |

**Monitor with:** `renderer.info.render.calls`, `renderer.info.render.triangles`, `performance.memory.usedJSHeapSize`

---

## Recommended Approach: Phased Implementation

### Phase 0: Foundation (enables everything else)

Flight controls are ✅ resolved — bird flies forward correctly in production. This phase is about renderer and tooling.

| Task | Effort | Why |
|------|--------|-----|
| **Upgrade Three.js r161 → r184** | Medium | 23 releases of perf fixes, WebGPU support, TSL shaders, Safari fixes |
| **Switch to `WebGPURenderer`** | Low | Auto-falls back to WebGL2 on older iOS. One renderer path. No compute dependency. |
| **Add perf HUD** | Low | FPS, draw calls, triangles, frame time. Can't optimise what you can't measure. |
| **Add `scene.fog`** | Tiny | `new THREE.FogExp2(skyColor, 0.015)` — instant depth, hides future LOD pops |

**Note on vanilla JS + CDN:** Birb imports Three.js from esm.sh. WebGPURenderer and TSL require `three/webgpu` imports. Verify CDN availability of `three@0.184.0/build/three.webgpu.js` before committing to this path.

### Phase 1: Quick Visual Wins (No architecture changes)

These all work on the existing smooth sphere:

| Enhancement | Effort | Impact | How |
|-------------|--------|--------|-----|
| **Flat shading** | 1 line | Huge | `flatShading: true` on ground material → instant low-poly character |
| **Vertex displacement** | Medium | Huge | Displace sphere vertices along normals using simplex FBM noise in vertex shader. Keep amplitude 0.5-2.0 on radius-30 sphere. |
| **Height-based colouring** | Small | Big | Colour by displacement: water (blue) → sand → grass → rock → snow |
| **Per-biome noise profiles** | Small | Big | Forest = smooth rolling, Mountain = jagged peaks, Canyon = mesas, City = flat |
| **InstancedMesh for trees** | Medium | Big | Replace cloned objects → 1 draw call per object type. Expect ~10× draw call reduction. |
| **Bloom (half-res)** | Medium | Medium | UnrealBloomPass at 0.5× resolution, threshold 0.8 |
| **Vignette** | Tiny | Medium | CSS overlay or post-processing pass |

**Vertex displacement on a sphere:**
```glsl
// In vertex shader (or TSL equivalent)
vec3 displaced = position + normal * fbmNoise(position.xz * scale) * amplitude;
```
Compute normals analytically from noise derivative for correct lighting. Different noise scales per biome.

**Instancing on a sphere — orient to surface:**
```javascript
const dummy = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);
for (let i = 0; i < count; i++) {
    const normal = position.clone().normalize(); // sphere normal = normalized position
    dummy.position.copy(position);
    dummy.quaternion.setFromUnitVectors(up, normal);
    dummy.rotateY(Math.random() * Math.PI * 2); // random rotation for variety
    dummy.scale.setScalar(0.5 + Math.random() * 0.5);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
}
```

### Phase 2: Chunked Cube-Sphere (The Real Terrain Upgrade)

When Phase 1 is solid:

| Task | Effort | Impact |
|------|--------|--------|
| **Replace SphereGeometry with 6 cube faces** | High | Enables per-face LOD, chunking, streaming |
| **Quadtree per face (3-4 levels)** | High | Subdivide near bird, merge far away |
| **Per-chunk InstancedMesh** | Medium | Vegetation only on visible/nearby chunks |
| **Web Workers for chunk gen** | Medium | Offload noise computation off main thread |
| **Frustum + hemisphere culling** | Medium | Skip entire back-of-planet (massive win on sphere) |
| **Crack stitching** | Medium | Prevent gaps between LOD levels at face edges |
| **Geomorph transitions** | Medium | Smooth vertex morphing between LOD levels (eliminates popping) |

**Reference code:** PlanetTechJS (quadtree subdivision), Sebastian Lague's planet LOD (adjacency lookup), Godot cuberact-planet-chunked-lod (architecture).

### Phase 3: Atmosphere & Polish

| Enhancement | Effort | Impact | Notes |
|-------------|--------|--------|-------|
| **Sky upgrade** | Medium | Very High | Three.js Sky addon (Preetham scattering) OR enhanced gradient with sun glow. Supports sunrise/sunset via sun position uniform. |
| **Billboard clouds** | Medium | High | 20-30 camera-facing sprites on outer shell. Procedural noise texture. Animate UV offset for drift. |
| **Day/night cycle** | Medium | Big | Sky gradient lerp + light colour/intensity animation |
| **Instanced grass** | High | Big | ~5K-10K instances near camera (mobile budget). Vertex shader wind: `sin(time * speed + worldPos.x * 0.5) * strength * uv.y`. Orient along sphere normal. |
| **Tree LOD** | High | High | Full mesh <30m → cross-billboard 30-100m → single sprite >100m |
| **Stylised water** | High | High | Gerstner wave displacement at low altitude. Fresnel + sky cubemap (no planar reflections). Or simpler: scrolling normal maps on flat disc. |
| **Height fog** | Medium | High | Custom shader: `exp(-density * max(0, altitude - fogBase))` — adds massive depth |
| **God rays** | Medium | Medium | Half-res screen-space radial blur. [three-good-godrays](https://github.com/Ameobea/three-good-godrays) |

**Cloud tiers (from procedural-clouds-threejs):**
| Tier | Technique | Target Device |
|------|-----------|---------------|
| Low | Billboard sprites | All mobile |
| Medium | Instanced mesh clusters | Mid-range mobile |
| High | Volumetric raymarching | Desktop / WebGPU only |

### Phase 4: WebGPU Progressive Enhancement

Only on capable devices (iOS 26+, Chrome 121+, Firefox 147+):

| Enhancement | What It Enables |
|-------------|----------------|
| **Compute shader terrain gen** | Generate chunk heightmaps on GPU |
| **GPU vegetation placement** | Scatter instances via compute |
| **Volumetric clouds** | Raymarched Beer-Lambert with self-shadowing |
| **GPU particles** | Trail effects, ambient particles on GPU |
| **Indirect draw calls** | GPU-driven culling and rendering |

**Strategy:** Feature-detect WebGPU, use as enhancement. Core game must work on WebGL2 fallback.

---

## Shader Strategy: TSL (Three.js Shading Language)

All three sources converge on TSL as the future:
- Write once → compiles to GLSL (WebGL) or WGSL (WebGPU)
- Node-based, composable, JavaScript-like syntax
- LLMs generate it well
- Compute shaders via `instancedArray`

**For Birb:** Write terrain displacement, grass wind, water, and sky shaders in TSL. They work on both renderers automatically.

**Caveat:** TSL requires `three/webgpu` imports. Verify this works with Birb's CDN-based architecture before committing.

---

## What NOT to Do

| Don't | Why |
|-------|-----|
| Adopt R3F (React Three Fiber) | Birb is vanilla JS. A React rewrite is a separate project. |
| Use three-landscape / THREE.Terrain | Flat-only libraries. Won't work on a sphere. |
| Add volumetric clouds on mobile | Billboard sprites look great and cost nothing. |
| Implement flat CDLOD | That's for flat terrain. Use quadtree on cube-sphere faces. |
| Use real-time planar reflections | Doubles draw calls. Use Fresnel + cubemap for water. |
| Depend on compute shaders | WebGL2 fallback doesn't support them. Enhancement only. |
| Add parallax mapping | Heavy on mobile GPUs, not worth it. |
| Skip the Three.js upgrade | r161→r184 has critical perf fixes and WebGPU maturation. |
| Touch flight code without reading docs | KNOWN_ISSUES.md + FLIGHT_CONTROLS_PLAN.md first. Always. |
| Target >100K triangles on mobile | Low-poly aesthetic naturally fits the 100K budget. Don't fight it. |

---

## Libraries to Evaluate

| Library | Purpose | Status |
|---------|---------|--------|
| `simplex-noise` | Heightmap noise in JS / vertex shader | Stable, well-proven |
| `three/addons/objects/Sky.js` | Preetham atmospheric scattering | Built into Three.js |
| `three-good-godrays` | Screen-space god rays | MIT, compatible |
| `procedural-clouds-threejs` | Tiered cloud system (billboard → volumetric) | MIT, Feb 2026 |
| `ez-tree` | Procedural tree generator with LOD | MIT |
| `stats-gl` | WebGL/WebGPU performance monitor | Lightweight |
| `leva` | GUI controls for live shader tweaking | Dev-time only |

**Do NOT depend on:** PlanetTechJS (alpha), hello-terrain (alpha), three-landscape (flat-only), Strata (flat-only).

---

## Key References (Best of All Three Sources)

### Tutorials & Guides
- [TSL Official Docs](https://threejs.org/docs/pages/TSL.html) — the new shader language
- [Field Guide to TSL and WebGPU (Maxime Heckel)](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [10 Noise Functions for TSL](https://threejsroadmap.com/blog/10-noise-functions-for-threejs-tsl-shaders)
- [Fluffiest Grass (Codrops)](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/)
- [Building Efficient Three.js Scenes (Codrops)](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/)
- [Rendering Semi-Realistic Landscapes (Nathan Pointer)](https://nathanpointer.com/blog/landscapes)
- [Draw Calls: The Silent Killer](https://threejsroadmap.com/blog/draw-calls-the-silent-killer)
- [Choosing Texture Formats (Don McCurdy)](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)

### Spherical Terrain Reference
- [PlanetTechJS](https://github.com/FunSoftWareTechologies/PlanetTech) — only Three.js spherical terrain lib (alpha, study architecture)
- Sebastian Lague's planet LOD — cube-sphere quadtree with adjacency lookup
- [OpenWorldJS](https://github.com/obecerra3/OpenWorldJS) — CDLOD terrain + physics (flat, but LOD patterns apply)

### Demos to Study
- [False Earth](https://www.webgpu.com/showcase/false-earth-procedural-planet-webgpu/) — procedural planet, 1M+ grass, compute shaders, post-FX
- [Three.js TSL Procedural Terrain](https://threejs.org/examples/webgpu_tsl_procedural_terrain.html) — FBM noise terrain via TSL
- [Nugget8 Ocean Scene](https://github.com/Nugget8/Three.js-Ocean-Scene) — mobile-optimised (12 triangles, 120fps on 2021 mobile)
- [stylized-water](https://github.com/thaslle/stylized-water) — toon water with GLSL in R3F

### Mobile Performance
- [Cesium 3D Tiles Performance](https://cesium.com/blog/2019/05/07/faster-3d-tiles/) — streaming LOD architecture
- [deck.gl Performance Guide](https://deck.gl/docs/developer-guide/performance) — mobile budgets and adaptive quality

---

## Priority Order (The Final Word)

1. **Upgrade Three.js to r184** + switch to WebGPURenderer
2. **Add fog + flat shading** (two lines, instant visual upgrade)
3. **Vertex displacement on sphere** (terrain comes alive)
4. **InstancedMesh vegetation** (draw call massacre)
5. **Perf HUD** (measure everything)
6. **Sky upgrade** (Preetham or enhanced gradient)
7. **Billboard clouds** (atmosphere)
8. **Chunked cube-sphere** (when ready for the big refactor)
9. **Instanced grass + tree LOD** (ground feels alive)
10. **Water + god rays + day/night** (full polish)
11. **WebGPU compute enhancements** (future progressive upgrades)

---

*This document supersedes the individual research files. Source files preserved for reference:*
- `wiki/gamedev/3d-mobile-terrain-research.md` (vibeacademy-brain)
- `docs/TERRAIN_RENDERING_RESEARCH.md` (Claude research)
- `docs/class-research-3d-mobile-terrain-rendering.md` (Codex research)
