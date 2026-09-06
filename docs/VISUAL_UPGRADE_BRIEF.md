# Birb Mobile visual direction and implementation brief

Owner request, 2026-09-06: dramatically improve the graphics of the main Birb
Mobile game while keeping mobile browsers first. Originally a research review;
the owner subsequently authorized implementation, merge to main, and production
deployment. They also reported multiple nests appearing in one tree and a nested
view exposing almost the whole stripped planet. This document stands alone for
future agents. Do not treat unfinished recommendations below as shipped features.

## Scope and desired experience

The root `index.html` experience at https://birbmobile.vercel.app/ is the target.
`gauntlet/`, `warp/`, `sculpture/`, `humanoid/`, `AR/`, `grokrogue/` and `basic/`
are separate experiences; do not propagate this art direction into them silently.

Make Birb feel like a lush, animated miniature world: varied sculpted vegetation,
dark branch pockets and grounded roots, warm crowns against cool distant scenery,
a recognisable bird with feather follow-through, and readable landmarks. Keep the
stylised low-poly character. The aim is a coherent scene and satisfying movement,
not photorealism, a post-processing demo, or simply more scattered objects.

At a nest the player should feel perched inside the landscape. Nearby trees and
landmarks must remain visible. One attractive nest sits on a clear crown, rather
than several glowing blobs apparently stacked on a tree. Looking around and
shooting remain usable, but a nest is not an excuse to erase world geometry.

## Baseline observations

Reviewed root game at `30e97bddf5b3cb41fd665b61801c7e34f7b8f7c5`, including the live
forest view. Physical-phone performance was not measured during the review.

* The world already has instanced trees/props, carved terrain, vertex-colour
  gradients, sky/sun, waterfall/foam/mist, flight animation and proximity cues.
* Repeated cone silhouettes and broad plain surfaces dominate much of the frame.
* Main and world lighting rigs stack: five scene lights plus one world hemisphere
  on mobile, seven additional world lights on desktop. Their outputs differ.
* Mobile used LinearToneMapping and desktop ACES. The custom sky lacked output
  colour-conversion/tone-mapping chunks, making palette matching unreliable.
* Fog density 0.0022 on mobile contributes only ~1.2% fog at 50 units. Curved-world
  sightlines are short. Denser fog does NOT inherently add shader operations.
* Global shadow maps are disabled; contact cues need a deliberately cheap solution.
* Nest candidates are emitted for champions and every fifth grove tree, without
  grove/host deduplication. Placement retries could deliberately overlap trees.
* **Critical nested-view defect:** `hideObstructionsForNest()` matched names of
  entire InstancedMesh batches and set them invisible, clearing trees, mountains
  or buildings across the planet. This was not a distance-culling algorithm.
* Forest nest-host scale 2.6–3.6 could put crowns roughly 110 units above ground
  on a radius-120 planet. The resulting perch read as an aerial observation tower.
* Adaptive tiers lower DPR, but the resize path restored the base DPR cap.
* Explosion and sparkle bursts allocated scene objects and arrays per event.

## Implemented in the September visual pass

1. **One colour pipeline and lighting owner.** ACES + exposure 1.12 on all
   devices, sky output conversion, explicit four-biome sky palettes, stronger
   short-range atmosphere (FogExp2 0.006), and removal of the duplicate world
   lighting rig. Sky gradient follows the camera's radial up around the planet.
2. **Procedural forest variety.** Three bounded canopy profiles (layered conifer,
   rounded crown, irregular crown), retaining the former unit envelope, the
   existing three colour buckets and instanced draw-call structure. Baked crown
   shading suggests pockets between branches. No alpha foliage or asset downloads.
3. **Ground contact shading.** At build time, a spatial hash samples nearby
   trunks/boulders into the ground's existing vertex colours. Zero extra render
   passes. This is approximate grounding, not full baked AO or physical shadows.
4. **Decorative wind and bird life.** Shared time/wind uniforms move canopy tips;
   reduced motion disables wind and secondary feather flex. Shoulder/feather lag,
   turn-dependent tail spread, boost wing tuck and airborne foot tuck extend the
   existing procedural rig. Physics and input shaping are unchanged.
5. **Water highlights.** The existing pool gets analytic ripples, a Fresnel-style
   sky tint and a restrained highlight, with no reflection capture. This is a
   stylised local lighting approximation, not physical reflection/refraction.
6. **Pooled event effects.** Fixed explosion/sparkle pools (6 mobile / 10 desktop),
   short expanding impact arcs and radial gravity. Saturation drops decoration;
   it never expands the pool. Suspend/expiry reuse buffers; dispose releases them.
7. **Nest correction.** One highest valid crown per forest grove, unique host IDs,
   minimum 18-unit great-circle spacing across all nest candidates, invalid-data
   rejection, and no forced overlapping grove placement after exhausted retries.
   Nest hosts have crowns 30–40 units above local ground. The woven bowl sits
   just above its actual crown with a quiet amber interaction rim and an egg.
   Nested mode no longer switches off whole scenery batches. Canyon/city hosts
   now use actual tops <=65 units, mountain hosts use low bare summits or bounded
   pine crowns, and arch nests sit on the torus tube instead of above empty space.
   Tall champion structures remain scenery, rather than hiding them to expose
   nests placed halfway inside them. Actual turret-view testing exposed immediate
   canopy obstruction; `nest-occlusion.js` now clears only individual instances
   whose oriented bounds touch a 5-unit neighbourhood of the perch camera.
   Original matrices restore exactly on takeoff/reset; batch visibility stays on.
8. **Quality continuity.** Tier-aware DPR computation is shared by tier changes
   and resize/orientation. Original FPS thresholds remain unchanged.
9. **Offline delivery.** Service-worker cache version bumped; new runtime modules
   included in precache. Sibling worker bypasses preserved.

## Code map for the next agent

| Concern | Implementation |
|---|---|
| Renderer, lighting, resize, bird animation, nested transition | `index.html` |
| Four environment palettes | `src/environment/world-shell.js` (variant definitions; legacy world builder also lives here) |
| Active spherical world, tree placement, crown host metadata | `src/environment/spherical-world.js` |
| Geometry, wind, ground contacts, pool shading, DPR policy | `src/environment/visual-style.js` |
| Sky colour output and radial horizon | `src/environment/sky-dome.js` |
| Waterfall/pool/river integration | `src/environment/landmark-valley.js` |
| Pure build-time nest selection | `src/nesting/nest-placement.js` |
| Reversible clearance of individual nearby prop instances | `src/nesting/nest-occlusion.js` |
| Woven nest art, proximity and visibility | `src/nesting/nest-points.js` |
| Landing/takeoff state machine | `src/nesting/nesting-system.js` |
| Pooled burst effects | `src/effects/particles.js` |
| Pure regression tests | `tests/visual-upgrade.test.js` |
| Real Three.js browser check and repeatable art views | `tools/visual-review.html` |

## Remaining roadmap and bang for the buck

These are estimates for experienced graphics development plus art support, not
promised speedups or fixed quotes. The first pass above is not completion of the
full art-production roadmap. Scores are relative to this game and mobile target.

| Work | Payoff / cost | Approximate effort | Mobile implementation strategy |
|---|---|---|---|
| Tune lighting/palette on physical phones | 5/5 | 2–4 days | Side-by-side fixed views; preserve a single colour pipeline; compare ACES cost rather than assume it |
| Authored forest route and landmark art | 5/5; biggest remaining transformation | 7–14 days for one biome | Compose grove → passage → waterfall reveal → valley → giant nesting tree; 4–6 meaningful silhouettes, instanced detail and LOD |
| Richer material art and baked occlusion | 5/5 | 3–6 days | Shared atlas and vertex AO for branch/rock crevices, moss/soil zoning; KTX2 when texture volume warrants it |
| Polished bird animation and foliage response | 5/5 | 3–6 days | Preserve readable silhouettes; improve rigged feather flex, tail/landing poses; no per-tree JS transform updates |
| Waterfall finish | 4/5 | 3–5 days | Art-directed foam/shore depth, bounded mist screen coverage, highlights matching the actual sun |
| Action-specific VFX and wingtip ribbons | 4/5 | 2–4 days | Extend fixed pools; distinct short collection/boost/destruction signatures, preserve flight-path visibility |
| Bird contact shadow | 4/5 | 1–2 days | Small terrain-conforming decal, fading with altitude; avoid full-world dynamic shadows |
| Optional bloom and edge smoothing | 3/5 | 2–4 days | Low-resolution emissive bloom only after measured GPU headroom; mobile MSAA remains disabled in this pass |
| Spatial instance sectors and LOD | Enabler; profile first | 3–6 days | Trade a few extra batches for culling hidden hemisphere/distant detail; do not infer savings from triangle counts alone |
| WebGPU migration | 1/5 as the first visual investment | Separate spike | Re-author ShaderMaterial/onBeforeCompile paths in TSL; device test; migration alone does not change art |

Do not initially add full-screen SSAO, screen-space reflections, raymarched
volumetric clouds, depth of field or motion blur. Reconsider only for an optional
high tier after target-phone measurements show sufficient headroom.

## Non-negotiable implementation constraints

* Mobile Safari and Android Chrome are the primary experience. Desktop previews
  do not certify mobile performance. Target sustained 60fps on midrange devices.
* Keep Three.js pinned at 0.183.2 and the vanilla/no-build architecture.
* Preserve the shared terrain displacement/collision/floor sampler and its <=0
  carve constraint. Do not change flight physics to accommodate visual terrain.
* Never hide an entire InstancedMesh to hide one nest host. Any future local
  occlusion treatment must act on explicitly identified instances, be reversible,
  and leave other groves/biomes visible. Prefer correct crown placement first.
* A new instanced host supplies a stable `hostId`; forests also supply `groveId`.
  Do not use the shared InstancedMesh object as the identity of every tree.
* Preserve aim, takeoff, collision and touch responsiveness. Keep the horizon
  stable; no forced cinematic camera swings during player-controlled flight.
* Pool runtime effect objects and geometry. Dispose new textures/materials on
  environment changes; precache new modules and bump SW version for releases.
* Quality degradation should first reduce optional effects, then distant detail,
  then resolution. Wind amplitude is currently reduced at tier 2; broader
  effect/LOD tier control is still future work, not implemented.
* Proposed full-scene budgets remain <100 calls / <80k triangles, but these are
  targets, not measured proof. Browser harness world-only counts exclude the
  player/HUD/gameplay effects and cannot certify the complete game budget.

## Acceptance and validation

1. `npm test` runs the normal suite. In a restricted Windows shell that forbids
   Node child-process spawning, use `node --test --test-isolation=none` instead;
   don't confuse EPERM with an application assertion failure.
2. Serve the unchanged static project and open `/tools/visual-review.html`.
   Press **Run mobile + desktop checks**. It uses real Three.js 0.183.2, fixed
   world seeds, all four biome builders, shader compilation, nest spacing,
   landing-state completion and bounded particle-pool checks. Inspect nest,
   world and water views separately. It is deliberately noindex/unlinked.
3. In the actual root game: fly, boost, land, look around, fire and take off.
   Repeat landing, switch environments and modes, then rotate the viewport.
   Confirm scenery stays visible before/during/after nesting, no stacked nests,
   no airborne nest tower, no stuck landing, and correct camera return.
4. On actual phones, test portrait/landscape, reduced motion, cold load and warm
   cache, at least 10 minutes of flight and combat (thermal throttling), waterfall
   close-ups and repeated biome changes. Capture frame-time percentiles, long
   frames, draw calls, triangles, memory and the tested device/OS/browser/build.
5. Compare identical seeded camera views, not different random groves. Material
   and silhouette improvements must remain clear at phone size. Effects must not
   conceal targets or cost control responsiveness. Target p95 frame time <=16.7ms
   on the agreed midrange reference phone; document exceptions rather than claim
   every browser/device holds 60fps.
6. Verify the production deployment is for the merged commit, root page works,
   changed modules and SW version are served, and CI is green. A successful Git
   push alone is not proof that production was updated.

## Research sources

### Validation record for this pass

* Node suite: 215 passed using `node --test --test-isolation=none` (the sandbox
  blocks the default runner's child-process spawn with EPERM). Focused nesting,
  flight, aiming and quality tests were rerun after the perch corrections: 17/17.
* Browser harness, real Three.js: all eight biome/device-path combinations passed
  shader compilation, spacing and landing; burst pool capacity, expiry,
  suspension and reuse passed. Fixed-seed mobile nest counts: forest 9, canyon 15,
  mountain 7, city 11. Minor geometric seating adjustments can change sample counts.
* Sampled world-only maxima on the mobile paths: forest ~63.6k triangles/58 calls,
  canyon ~41.3k/65, mountain ~39.8k/58, city ~42.1k/60. These are scene samples,
  not whole-game maxima or physical-phone frame-time measurements.
* Desktop forest (~118k) and city (~92.5k) exceed the historical 80k triangle
  target even without player/gameplay; do not cite the old doc budget as achieved.
  Instance sectors/LOD and actual device profiling remain follow-up work.
* Visually inspected the live game, upgraded root forest and close nest render.
  The actual Turret Defense flow also confirmed the world-erasure fix and exposed
  the need for local instance clearance. The browser harness tests nearby-only
  hiding, unchanged distant instances and exact matrix restoration.
  Production/CI completion is tracked by GitHub deployment/check status after push.

### References

* Three.js colour pipeline and custom shader conversion:
  https://threejs.org/manual/en/color-management.html
* Shadow costs and inexpensive alternatives:
  https://threejs.org/manual/en/shadows.html
* WebGL backbuffer, batching and GPU memory guidance:
  https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
* GPU-compressed textures and device transcoding:
  https://threejs.org/docs/pages/KTX2Loader.html
* Adjustable bloom (not free rendering work):
  https://threejs.org/docs/pages/UnrealBloomPass.html
* WebGPU migration limitations for custom GLSL:
  https://threejs.org/manual/en/webgpurenderer

These sources support the rendering techniques; impact rankings, effort ranges,
art direction and the proposed route are review judgments specific to Birb.
