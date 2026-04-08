# 3D Terrain & Environment Rendering Research for Birb Mobile

> Research compiled April 2026. Focused on techniques viable for mobile 60fps in a vanilla Three.js game (no bundler, ES6 modules from CDN).

## Current State of Birb's Rendering

Before diving into what's possible, here's what Birb currently has:

| Area | Current Implementation | Upgrade Opportunity |
|------|----------------------|---------------------|
| **Sky** | Custom ShaderMaterial gradient on inverted sphere + noise stars | Physically-based atmospheric scattering, dynamic time-of-day |
| **World** | Smooth sphere (radius 30) with primitive objects on surface | Vertex-displaced terrain with hills/valleys, normal maps |
| **Lighting** | 7 lights (5 directional + hemisphere + point), no shadows | Shadow mapping on key light, time-of-day transitions |
| **Materials** | MeshStandardMaterial with colors only (no textures) | Texture atlases, normal maps, PBR textures |
| **Particles** | CPU-based PointsMaterial (snow/leaves/fireflies per biome) | GPU particle systems, trail ribbons |
| **Post-FX** | None | Bloom, depth of field, color grading |
| **LOD** | Infrastructure built but not actively used on geometry | Active mesh LOD, billboard fallbacks, BatchedMesh |
| **Trees/Foliage** | Cone + cylinder primitives | Instanced billboard grass, procedural trees |
| **Fog** | None | Height fog for depth and hiding LOD transitions |

---

## 1. Terrain Generation

### GPU Vertex Displacement (Best Fit for Birb)

The dominant modern approach: use a flat mesh (or sphere) and displace vertices in the vertex shader using procedural noise. All computation stays on the GPU.

**How it works for a spherical world:**
```
Sphere geometry (20-40k vertices)
    ↓ vertex shader
Sample Simplex FBM noise using vertex position as UV
    ↓
Displace vertex along sphere normal by noise value
    ↓
Result: organic terrain with mountains, valleys, plains
```

**Key noise functions (all implementable in GLSL):**
- **Simplex 2D/3D** -- Faster than Perlin, fewer directional artifacts
- **FBM (Fractal Brownian Motion)** -- Multiple octaves of noise layered at increasing frequency and decreasing amplitude. This is the "secret sauce" for convincing mountain terrain
- **Worley / Voronoi** -- Cell-based noise, good for cracked earth, rocky surfaces
- **Domain warping** -- Feed noise output back as input coordinates for organic, flowing shapes

**Performance:** Simplex noise in 2D costs ~5 texture lookups equivalent. Viable on mobile GPUs at <50k vertices.

**TSL Noise Reference:** [threejsroadmap.com/blog/10-noise-functions-for-threejs-tsl-shaders](https://threejsroadmap.com/blog/10-noise-functions-for-threejs-tsl-shaders)

### Notable Libraries

| Library | GitHub | What It Does | Mobile? |
|---------|--------|-------------|---------|
| **THREE.Terrain** | [IceCreamYou/THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain) | 10+ noise algorithms, Diamond-Square, Perlin, Simplex, Worley | Yes |
| **three-landscape** | [nwpointer/three-landscape](https://github.com/nwpointer/three-landscape) | AAA-style terrain with splat maps, progressive textures | Yes (R3F) |
| **Terrain-Builder** | [FarazzShaikh/Terrain-Builder](https://github.com/FarazzShaikh/Terrain-Builder) | GPU-accelerated Perlin terrain | Yes |

**Three.js official example:** [webgpu_tsl_procedural_terrain.html](https://threejs.org/examples/webgpu_tsl_procedural_terrain.html) -- FBM noise computed entirely on GPU via TSL.

### Birb-Specific Approach

Since Birb uses a spherical world, vertex displacement along the sphere normal is the natural fit:

```glsl
// In vertex shader
vec3 displaced = position + normal * fbmNoise(position.xz * scale) * amplitude;
```

- Keep displacement amplitude small relative to sphere radius (0.5-2 units on a radius-30 sphere)
- Use different noise scales per biome (smooth rolling hills for forest, jagged peaks for mountain, flat mesas for canyon)
- Compute normals analytically from the noise derivative for correct lighting

---

## 2. Sky & Atmosphere

### Physically-Based Sky (Quick Win)

**Three.js Sky addon** -- Uses the Preetham analytical daylight model with Rayleigh and Mie scattering. Single draw call, looks great, runs fast on mobile.

```javascript
import { Sky } from 'three/addons/objects/Sky.js';
const sky = new Sky();
sky.scale.setScalar(450000);
// Uniforms: turbidity, rayleigh, mieCoefficient, mieDirectionalG, sunPosition
```

This would replace Birb's current gradient shader sky with a physically accurate atmosphere that supports sunrise/sunset just by moving the sun position uniform.

**Also available:** [glsl-atmosphere](https://github.com/wwwtyro/glsl-atmosphere) -- Standalone GLSL Rayleigh + Mie scattering, easy to port into a ShaderMaterial.

### Dynamic Day/Night Cycle

A **Complete Sky System** was shared on the Three.js forum (Nov 2025) providing: skybox with color blending, sun/moon, day/night cycle, clouds, stars, and lensflares. Lightweight manual color lerp approach rather than full physics simulation.

Source: [Three.js Forum - Complete Sky System](https://discourse.threejs.org/t/complete-sky-system-for-three-js-skybox-sun-moon-day-night-cycle-clouds-stars-lensflares/88311)

### Volumetric Clouds

**Tiered approach (best for mobile):**

| Tier | Technique | Performance | Quality |
|------|-----------|------------|---------|
| **Billboard** | Camera-facing sprites with noise texture | Negligible | Good at distance |
| **Mesh Cluster** | Instanced soft-particle spheres | Moderate | Great |
| **Raymarched** | Full volumetric with Beer-Lambert scattering | Expensive | Stunning |

**Key libraries:**
- **[@takram/three-clouds](https://www.npmjs.com/package/@takram/three-clouds)** -- Most sophisticated. Beer shadow maps, physically-based scattering. Author notes: if "Low" preset doesn't hit your FPS target, use a skybox instead.
- **[procedural-clouds-threejs](https://github.com/CK42BB/procedural-clouds-threejs)** -- Tiered system with automatic mobile fallback to billboards. Supports all 10 cloud genera, time-of-day coloring.

**For Birb:** Billboard clouds are the realistic mobile option. 20-30 camera-facing quads with soft cloud textures placed on a sphere slightly larger than the world. Animate UV offset slowly for drift.

### God Rays

**[three-good-godrays](https://github.com/Ameobea/three-good-godrays)** -- Screen-space raymarched godrays. Parameters: exposure, decay, density, weight. Compatible with Three.js 0.125-0.182+.

**Mobile approach:** Render at half resolution. The classic radial blur technique (render light source white, occluders black, apply radial blur, additive blend) is cheap -- just a few texture samples per pixel.

### Fog (Critical for Polish)

Fog communicates scale, depth, and hides LOD transitions. Nathan Pointer's landscape work emphasizes this as the single highest-impact visual technique for terrain.

- **Built-in:** `THREE.Fog` (linear) and `THREE.FogExp2` (exponential). Free performance cost.
- **Height fog:** Mix fog color based on world Y position in a custom shader:
  ```glsl
  float fogFactor = exp(-density * max(0.0, worldPosition.y - fogBase));
  ```
- **Volumetric fog:** Raymarching through density field. Too expensive for mobile unless at quarter resolution.

---

## 3. Vegetation & Nature

### Instanced Grass (Solved Problem in 2025)

Recent demos achieve **1 million+ grass blades at 60fps** in the browser. Key techniques:

**Billboard grass with InstancedMesh:**
1. Single quad geometry with grass texture (alpha cutoff)
2. Per-instance attributes: position, scale, rotation, color
3. Wind animation via sine functions in vertex shader
4. Frustum culling by world chunks (each chunk = its own InstancedMesh)
5. LOD: reduce segment count at distance, skip grass beyond ~30m

**Wind shader pattern:**
```glsl
float wind = sin(time * windSpeed + worldPos.x * 0.5) * windStrength;
wind *= uv.y; // Only displace upper parts
displaced.x += wind;
```

Multiple sine waves of different frequency/amplitude create organic motion. Scrolling a noise texture as wind produces the best results.

**Fake ambient occlusion:** Darken grass at the base (low UV.y), lighten at tip. Sells the look with zero cost.

**For Birb (spherical):** Orient each billboard along the sphere normal instead of world up. Keep instance count under ~5,000-10,000 for mobile 60fps. Only render grass within ~30m of the camera.

**Key references:**
- ["How to Make the Fluffiest Grass with Three.js" (Codrops, Feb 2025)](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/)
- [1M Blades at 60fps (Three.js Forum)](https://discourse.threejs.org/t/real-time-grass-simulation-in-the-browser-over-1-million-blades-at-60-fps/82808)
- ["Grass & Debris in Three.js" (Medium)](https://medium.com/@pablobandinopla/grass-debri-in-three-js-6da6b3d599c3)
- [Growing My Grass Shader (Gjoreski)](https://aleksandargjoreski.dev/blog/growing-my-grass-shader/)

### Trees: Billboard + LOD

**LOD strategy for forests:**

| Distance | Technique | Triangle Count |
|----------|-----------|---------------|
| < 30m | Full 3D mesh (low-poly) | ~500 tris |
| 30-100m | Cross-billboard (two perpendicular quads) | ~4 tris |
| 100m+ | Single billboard sprite | ~2 tris |

**[ez-tree](https://github.com/dgreenheck/ez-tree)** -- Procedural tree generator for Three.js with multiple LOD levels and billboard rendering options.

**["Fractals to Forests" (Codrops, Jan 2025)](https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/)** -- L-system procedural generation, fractal branching, optimized rendering.

---

## 4. Water Rendering

### Mobile-Viable Approaches

| Technique | Draw Calls | Quality | Mobile? |
|-----------|-----------|---------|---------|
| **Gerstner waves** (vertex displacement) | 1 | Good | Yes |
| **Fresnel + cubemap reflection** | 1 | Good | Yes |
| **Planar reflections** | Doubles scene | Great | Risky |
| **FFT ocean** (Three.js Water Pro) | Several | Stunning | WebGPU only |

**Best for Birb:** Gerstner wave displacement on a disc at the sphere surface. Fresnel-based blend between water color and sky cubemap (skip planar reflections -- they double draw calls).

**Gerstner water shader tutorial:** [sbcode.net/threejs/gerstnerwater](https://sbcode.net/threejs/gerstnerwater/)

**Free ocean implementations:**
- [jbouny/ocean](https://github.com/jbouny/ocean) -- FFT ocean for Three.js
- Built-in `Water` class with planar reflection normal maps

---

## 5. Post-Processing

### Mobile-Safe Effects

| Effect | Cost | Impact | How |
|--------|------|--------|-----|
| **Bloom** | Low | High | UnrealBloomPass at half-res, threshold 0.8 |
| **Color grading** | Negligible | Medium | LUT texture or manual curves in fragment shader |
| **Vignette** | Negligible | Medium | Darken screen edges |
| **Tone mapping** | Free | Medium | `renderer.toneMapping = ACESFilmicToneMapping` |
| **Depth of field** | Medium | High | BokehPass, or cheaper distance-based blur |
| **FXAA** | Low | Medium | Cheaper than MSAA |
| **Screen-space AO** | High | Medium | SAOPass at quarter res, or skip on mobile |

**Critical insight:** Set `renderer.toneMapping = THREE.ACESFilmicToneMapping` and `renderer.toneMappingExposure = 1.0`. This single line makes everything look dramatically better by mapping HDR values into a cinematic range. Birb currently has no tone mapping configured.

---

## 6. Performance Techniques

### Draw Call Budget

**Target: < 100 draw calls for mobile 60fps.** Monitor with `renderer.info.render.calls`.

**Techniques ranked by impact:**
1. **InstancedMesh** -- Same geometry + material, different transforms. Single draw call for thousands of objects (trees, rocks, grass, rings). Birb's trees, shrubs, and rocks are prime candidates.
2. **BatchedMesh** (r156+) -- Different geometries, same material, one draw call. Supports per-instance LOD switching.
3. **mergeGeometries()** -- Merge static geometry that never moves. Zero overhead.
4. **Material sharing** -- Reuse material instances. Birb's MaterialCache already does this.
5. **Texture atlases** -- Combine textures to reduce unique materials.

Source: ["Draw Calls: The Silent Killer" (threejsroadmap.com)](https://threejsroadmap.com/blog/draw-calls-the-silent-killer)

### Material LOD

Switch materials based on distance to reduce fragment shader cost:
- **Near:** MeshStandardMaterial (full PBR)
- **Medium:** MeshLambertMaterial (diffuse only)
- **Far:** MeshBasicMaterial (unlit, cheapest)

### Texture Compression (KTX2 / Basis Universal)

If adding textures, use KTX2 format:
- **ETC1S mode:** Smaller files, acceptable quality (environment textures)
- **UASTC mode:** Higher quality (normal maps, hero assets)
- Stays compressed on GPU: ~10x less VRAM than PNG/JPEG
- Three.js `KTX2Loader` transcodes to device-native format (ASTC on iOS, ETC2 on Android)

Source: ["Choosing Texture Formats" (Don McCurdy)](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)

### WebGPU Status (2026)

WebGPU reached production readiness across all major browsers (including Safari 26, Sep 2025). Three.js supports it via `WebGPURenderer` since r171, with automatic WebGL2 fallback. However, for Birb's vanilla JS / CDN architecture, WebGPU adoption requires careful consideration of the import structure.

---

## 7. Flagship Demos to Study

### False Earth (The Gold Standard)

[webgpu.com showcase](https://www.webgpu.com/showcase/false-earth-procedural-planet-webgpu/) -- Procedural planet by Ming Jyun Hung (MJ):
- 1M+ grass blades via compute shader
- FBM heightmap terrain with compute-sampled normals
- VAT-animated vegetation
- Post-processing: Bloom, DoF, SMAA
- Adaptive DPR via PerformanceMonitor

### Other Notable Projects

- **Three.js Journey Procedural Terrain** -- Bruno Simon's widely-referenced tutorial
- **Utsubo 2024** -- WebGPU experiment demonstrating TSL/Node Materials
- **Windland** (Codrops case study) -- Custom shaders for animated vegetation with wind
- **spacejack/terra** -- WebGL grass on terrain, practical reference implementation

---

## 8. Recommended Upgrade Path for Birb

Ordered by impact-to-effort ratio, with mobile 60fps preserved:

### Phase 1: Quick Wins (No Architecture Changes)

| Change | Effort | Impact | Details |
|--------|--------|--------|---------|
| **Tone mapping** | 1 line | High | `renderer.toneMapping = ACESFilmicToneMapping` |
| **Fog** | ~20 lines | High | `scene.fog = new THREE.FogExp2(color, density)` |
| **InstancedMesh for trees** | Medium | High | Replace individual tree meshes with instanced rendering |
| **Bloom** | Medium | High | UnrealBloomPass at half resolution |
| **Vignette** | ~10 lines | Medium | Post-processing or CSS overlay |

### Phase 2: Sky Upgrade

| Change | Effort | Impact | Details |
|--------|--------|--------|---------|
| **Three.js Sky addon** | Medium | Very High | Replace gradient shader with Preetham atmospheric scattering |
| **Billboard clouds** | Medium | High | 20-30 sprite clouds on outer sphere shell |
| **Dynamic sun position** | Low | Medium | Animate sun for time-of-day feel |

### Phase 3: Terrain Enhancement

| Change | Effort | Impact | Details |
|--------|--------|--------|---------|
| **Vertex displacement** | High | Very High | Simplex FBM noise on sphere vertices |
| **Per-biome noise profiles** | Medium | High | Different terrain character per environment |
| **Height fog** | Medium | High | Custom shader fog based on terrain altitude |
| **Normal computation** | Medium | Medium | Analytical normals from noise derivative |

### Phase 4: Vegetation

| Change | Effort | Impact | Details |
|--------|--------|--------|---------|
| **Instanced billboard grass** | High | Very High | ~5000 instances near camera, wind shader |
| **Tree LOD system** | High | High | 3D mesh → cross-billboard → sprite |
| **Wind animation** | Medium | Medium | Sine-based vertex displacement |

### Phase 5: Water & Polish

| Change | Effort | Impact | Details |
|--------|--------|--------|---------|
| **Gerstner water** | High | High | Vertex-displaced water surface |
| **God rays** | Medium | Medium | Half-res screen-space radial blur |
| **Color grading** | Low | Medium | LUT-based or manual curve |
| **Depth of field** | Medium | Medium | Distance-based blur at far range |

---

## Key References

### Tutorials
- [Three.js Journey - Procedural Terrain Shader](https://threejs-journey.com/lessons/procedural-terrain-shader)
- [Fluffiest Grass (Codrops, Feb 2025)](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/)
- [Fractals to Forests (Codrops, Jan 2025)](https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/)
- [Building Efficient Three.js Scenes (Codrops, Feb 2025)](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/)
- [Rendering Semi-Realistic Landscapes (Nathan Pointer)](https://nathanpointer.com/blog/landscapes)
- [Real-time Cloudscapes with Volumetric Raymarching (Maxime Heckel)](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/)
- [Gerstner Water Shader (sbcode.net)](https://sbcode.net/threejs/gerstnerwater/)

### Libraries
- [THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain) -- Procedural terrain
- [three-landscape](https://github.com/nwpointer/three-landscape) -- AAA terrain rendering
- [ez-tree](https://github.com/dgreenheck/ez-tree) -- Procedural trees
- [three-good-godrays](https://github.com/Ameobea/three-good-godrays) -- Screen-space god rays
- [procedural-clouds-threejs](https://github.com/CK42BB/procedural-clouds-threejs) -- Tiered cloud system
- [@takram/three-clouds](https://www.npmjs.com/package/@takram/three-clouds) -- Volumetric clouds

### Performance
- [Draw Calls: The Silent Killer (threejsroadmap.com)](https://threejsroadmap.com/blog/draw-calls-the-silent-killer)
- [100 Three.js Tips (utsubo.com)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [Choosing Texture Formats (Don McCurdy)](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)
- [Field Guide to TSL and WebGPU (Maxime Heckel)](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
