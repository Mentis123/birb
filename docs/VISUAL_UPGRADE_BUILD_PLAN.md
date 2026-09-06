# Birb Mobile visual upgrade — build plan for the implementation session

Written 2026-09-06 after reviewing `docs/VISUAL_UPGRADE_BRIEF.md` and the code
it maps to. This is a **standalone guide for whichever agent implements it**.
It assumes the reader has not seen the conversation that produced it. Read the
brief first for art direction and constraints; read this for what to build,
in what order, where the hooks are, and how to prove each step worked.

**Mode:** the owner (Mentis) has authorised implementation. Work in direct
execution mode. Do not teach, do not ask permission for reversible steps.

**Branch:** `claude/birb-visual-upgrades-review-l3qm3l`. Commit and push after
every stage so nothing is lost if the session stops early. Do not open a PR or
merge to `main` unless told to.

---

## 0. The goal in one paragraph

Turn the September visual pass into a finished-feeling world without
touching flight physics, input, or the terrain floor invariant. Eight stages,
ordered by risk (safest first) so a partial session still ships value. Every
stage is gated on the adaptive quality tier, allocation-free in the frame
loop, disposable on environment switch, precached by the service worker, and
proven by a test or a captured frame. The physical-phone benchmark is still
outstanding from the previous pass; nothing here may make it worse by default
on mobile.

## 1. What this environment can and cannot verify

| Can | How |
|---|---|
| Unit tests (215 today) | `npm test` (`node --test`). Node 22 here; do not pass `--test-isolation=none`, this Node rejects it. |
| Real-Three shader compile, draw calls, rendered triangles, nest spacing, landing, pool caps | `tools/visual-review.html` driven by headless Chromium. Chromium is at `/opt/pw-browsers/chromium`. esm.sh is reachable. |
| Seeded screenshots of the world | Same harness plus Playwright, see §2 |
| Root-game screenshots including the bird | Does not exist yet. Stage A builds it. |

| Cannot | Consequence |
|---|---|
| Phone frame times, thermal, real GPU cost | Every new effect defaults OFF or reduced on mobile tier ≥ 1, and the owner runs the phone pass afterwards using the capture sheet from Stage A. |
| Judge art direction | Landmark work (Stage H) is a bounded slice, not the full route. |

**Playwright setup (once per session):**

```bash
npm install --no-save playwright
git checkout -- node_modules/three/index.js   # npm install prunes the tracked Three stub; npm test breaks silently without this
```

The second line is mandatory. `CLAUDE.md` documents why.

## 2. Stage A — verification tooling (do this first)

Nothing else in this plan is provable without it.

### A1. `tools/birb-shot.mjs` — root-game screenshot harness

Clone `tools/gauntlet-shot.mjs` (static server on an ephemeral port, headless
Chromium, fail on any page or console error, capture at DPR) and adapt it to
the root game:

- Page is `index.html`. Viewport default 390×844, DPR 3, and a `--desktop`
  flag for 1280×800 DPR 1 (mobile detection is `window.__birbIsMobile`, set
  from UA and touch at `index.html:3550`; use Playwright's iPhone device
  descriptor so the mobile path is the one exercised).
- The game hides `<main hidden data-game-main>` behind Splash → Vibe → Title
  → Tap-to-Start. Add `--start` which clicks through those (find the buttons
  by their text or data attributes in `index.html` ~line 890 onward) and waits
  until the canvas has rendered a frame.
- Add `--eval` and `--settle` exactly as Gauntlet has them, plus `--env
  forest|canyon|mountain|city` which calls the page's environment switch.
  `setEnvironment(variantId)` at `index.html:5425` is inside the module scope,
  so expose a small debug object: `window.__birb = { setEnvironment, getStats
  }` guarded so it only exists when `?debug=1` is in the URL. `getStats`
  returns `renderer.info.render.calls`, `.triangles`, `adaptiveTier.getTier()`,
  and the flight recovery / nesting states. This is the root-game equivalent
  of `window.__GAUNTLET_STATS()`.
- Add `--nest` which lands the bird on the nearest nest via the debug object
  (call the nesting system's landing entry the same way the touch UI does) so
  the perch view can be captured.

Acceptance: `node tools/birb-shot.mjs --start --out shots/forest.png` exits 0
and the PNG shows the bird over the forest. Commit it before Stage B.

### A2. Extend `tools/visual-review.html`

It already runs eight biome/device combinations with a fixed seed (4606) and
reports max calls and triangles. Add:

- `window.__VISUAL_REVIEW` exposing `load(biome, mobile)`, `view(kind)`, and
  a `stats()` reader, so a Node script can drive it.
- `tools/visual-sheet.mjs`: boots the harness once, captures `flight`, `nest`
  and `water` views for all four biomes on the mobile path, and composites
  them into a single labelled PNG. This is the **capture sheet the owner
  compares on a phone** and the before/after evidence for every stage below.
  Follow the pattern of `tools/sculpture-sheet.mjs`.

Capture a baseline sheet from the unmodified tree before Stage B and keep it
in the scratch directory. Every later stage compares against it.

## 3. Stage B — bird contact shadow

Brief item: 4/5 payoff, 1–2 days. Fully doable here.

**Design.** One small decal mesh under the bird on the terrain floor, fading
with altitude. No shadow maps (`renderer.shadowMap.enabled = false` stays at
`index.html:3583`).

**Build.**
- New module `src/effects/contact-shadow.js`, THREE injected like
  `visual-style.js`, exporting `createContactShadow(THREE, { radius = 1.6 })`.
  Returns `{ mesh, update(birdPosition, floorRadiusAtBird, delta), dispose()
  }`.
- Geometry: `CircleGeometry(1, 16)`. Material: `MeshBasicMaterial` with a
  canvas-painted radial alpha texture (paint it once in the constructor, the
  same way `particles.js` `_createCircleTexture` does), `transparent`,
  `depthWrite: false`, `polygonOffset: true, polygonOffsetFactor: -2` so it
  never z-fights the ground, `renderOrder` above the ground mesh.
- `update()`: floor point = `normalize(birdPosition) * (floorRadius + 0.05)`.
  Orient with `quaternion.setFromUnitVectors(_zAxis, _up)` using
  pre-allocated `_up`. Altitude `h = |birdPosition| - floorRadius`. Opacity
  `0.45 * clamp(1 - h / 14, 0, 1)`, scale `radius * (1 + h * 0.08)`. Hide the
  mesh entirely when opacity < 0.02.
- Floor radius comes from `sampleTerrainHeight(x, y, z)` (exported from
  `spherical-world.js:544`, returns ≤ 0) added to `SPHERE_RADIUS` (120).
  `BirdFlight` already computes `_floorAt` the same way; reuse that value if
  it is accessible from `index.html`, otherwise call the sampler. Both are
  allocation-free.
- Hook: create once after `particleSystem` (`index.html:4295`), add to
  `scene` (not the world root, since the world is rebuilt on env switch).
  Update in the frame loop next to `particleSystem.update` (~`index.html:8030`).
  Hide while nested (`isNested` at `index.html:7348`) and while the bird is
  hidden.
- Tier gate: `adaptiveTier.getTier() >= 2` → mesh hidden.

**Prove.** Add `tests/contact-shadow.test.js` for the pure opacity/scale
function (export it separately). Capture `birb-shot --start` at low altitude
and confirm the disc. Draw calls must rise by exactly one.

## 4. Stage C — action-specific VFX and wingtip ribbons

Brief item: 4/5 payoff, 2–4 days.

**C1. Distinct burst signatures.** `src/effects/particles.js` has a fixed
burst pool (6 mobile / 10 desktop, `_initBurstPool` line 170) with two types,
`explosion` and `sparkle`, both 24 points plus one expanding ring. Add two
types without growing the pool:

- `collect` (ring pickup, called from `index.html:7523` and `7665` instead of
  `createSparkle`): short upward spiral, gold, 0.5s, ring arc scales fast and
  fades.
- `boost` (Ring Rush sprint start, where `sprintState.active` flips true near
  `index.html:8098`): a backward cone of cyan streaks, 0.35s, no arc.
- Keep `explosion` for drone kills; make its arc a double pulse (second ring
  at 40% age) by reusing the same arc mesh with a two-phase scale curve.

All parameters are per-type constants in one table at the top of the file.
`_emitBurst` already branches on `type`; extend that, do not add meshes.

**C2. Wingtip ribbons.** Two ribbon trails, one per wingtip, visible only while
boosting or banking hard (`|yawInput| > 0.45`) and airborne.

- New module `src/effects/ribbon-trail.js`, exporting `createRibbonTrail(THREE,
  { segments = 18, width = 0.12, color })`. Pre-allocate a `BufferGeometry`
  with `segments * 2` vertices and a fixed index buffer. Keep a ring buffer of
  the last `segments` anchor world positions in a `Float32Array`. `update
  (anchorWorldPos, sideVector, delta, intensity)` shifts the ring by one when
  the anchor moved more than 0.08 units, rewrites positions and per-vertex
  alpha (in a `color` attribute, oldest transparent), sets `needsUpdate`.
  `MeshBasicMaterial`, `vertexColors`, `transparent`, `depthWrite: false`,
  `AdditiveBlending`, `DoubleSide`.
- Anchor: the wingtip cone stored as `wingGroup.userData.tipFeather`
  (`index.html:5996`). Use `tip.getWorldPosition(_v)` into a pre-allocated
  vector; that method allocates nothing.
- Intensity ramps in over 0.15s and out over 0.4s so the ribbon does not pop.
  When intensity hits 0 the mesh is hidden and the ring buffer is reset on the
  next show so no stale segment streaks across the screen.
- Tier gate: hidden at tier ≥ 1 (this is the first optional effect to drop).
  Reduced motion: hidden.
- Must not obscure targets. Width 0.12 and 18 segments keeps the ribbon
  shorter than one bird length at cruise speed. Check the Drone Hunter view
  in a capture.

**Prove.** `tests/ribbon-trail.test.js`: with the Three stub, feed a straight
path and assert vertex count constant, alpha monotonic along the ribbon, and
that `update` performs no `new` (spy on the stub constructors). Capture a
boost frame with `birb-shot`.

## 5. Stage D — waterfall finish

Brief item: 4/5 payoff, 3–5 days. Everything is in
`src/environment/landmark-valley.js` and `src/environment/visual-style.js`.

- **Sun-matched highlights.** `addWaterHighlights` (`visual-style.js`) computes
  the glint against `uWaterUp + tangent * 0.4`, an arbitrary direction. Add a
  `uSunDir` uniform, set it from the environment's key light position
  (`index.html:5353` sets `lightingRig.keyLight.position` per environment and
  `5547` already forwards it to the sky dome) so the glint sits where the sun
  is. Expose a setter on the returned feature object; call it from
  `setEnvironment` after the key light is positioned.
- **Shore depth.** The pool material has vertex colours (`landmark-valley.js`
  ~line 337). Grade them by distance from the pool rim at build time: rim =
  lighter sand-teal, centre = deep. Foam ring opacity already pulses (line
  451); leave it.
- **Bounded mist coverage.** Mist is 140 / 360 additive points (line 275).
  Additive points close to the camera are the classic mobile fill-rate trap.
  In the feature's `update`, compute camera distance to the falls once per
  frame and scale `mistMat.size` down (2.2 → 1.0) and `opacity` down inside 12
  units. Also cap `mistCount` to 90 at tier ≥ 1 by setting
  `mistGeo.setDrawRange(0, n)`; the buffer stays allocated.
- **Reduced motion** already disables wind; also freeze the ripple time for
  the pool so it reads as still water.

**Prove.** The harness `water` view before/after in the sheet. Shader must
compile on both device paths (the harness already asserts this). Draw calls
unchanged.

## 6. Stage E — bird animation polish

Brief item: 5/5 payoff, 3–6 days. The rig is procedural and lives entirely in
`index.html`: build at ~5800–6070, per-frame animation at 7886–7985. The named
groups `leftWing`, `rightWing`, `tail`, `leftFoot`, `rightFoot` and the
`userData.secondaryFeather` / `tipFeather` handles are the API. **Do not
change physics, `wingInputState`, or anything that feeds `flightController`.**

Preserve the mirror rule documented at `index.html:7903`: the right wing has
`scale.z = -1`, so every symmetric motion is applied with opposite signs.

- **Landing pose.** `handleNestingStateChange` (`index.html:6868`) is the
  hook. On `LANDING` → `NESTED`, ease both wings to a folded pose (rotation.x
  toward base + 0.9 with mirror signs, `scale.z` toward 0.55) over 0.35s and
  the tail to a slight downward tilt. On leaving the nest, ease back. Drive
  this with a single `perchBlend` 0..1 value updated in the frame loop and
  mixed into the existing wing formula, not a parallel animation path.
- **Wing fold during the knockdown fall.** `isFallingVisual` is already
  computed; add a tumble-flap (asymmetric, low amplitude, 9 Hz) so the fall
  reads as a struggle rather than a frozen glide.
- **Tail.** Fan spread already responds to yaw (`fanSpread`). Add pitch: on
  climb, tail tilts down 0.15 rad; on dive, up 0.12 rad. Smoothed the same
  way as `tailSwayY`.
- **Head.** There is no named head group; the only named groups are
  `leftWing`, `rightWing`, `tail`, `leftFoot`, `rightFoot`. Skip a head
  lead-look rather than restructure the build. If the crest mesh
  (`index.html:5898`) is cheap to wrap in a group, a 0.12 rad yaw lean on the
  crest alone is acceptable; otherwise leave it.
- **Feather flex on flap** already exists. Raise the flap flex amplitude only
  while `climbing` (0.06 → 0.09) and keep the glide value.

All new state lives in pre-allocated numbers on the existing `motionState` or
a new `birdPose` object created once. No `new` in the loop.

**Prove.** `birb-shot --start --nest` before/after for the perch pose;
`--eval` a knockdown for the fall. Add a pure test only if a formula is
extracted (the perch blend easing is a good candidate: put it in
`src/flight/bird-pose.js` with no THREE and test it).

## 7. Stage F — spatial instance sectors — ATTEMPTED AND REVERTED

**Do not re-attempt this without new evidence.** It was built, measured on
all four biomes at desktop scale, and reverted because the measurement
contradicted the assumption behind it. The numbers, from
`tools/birb-sheet.mjs --desktop --views flight`:

| Variant | Draw calls | Triangles |
|---|---|---|
| One mesh per layer (baseline) | 93 / 87 / 88 / 74 | 131k / 87k / 90k / 106k |
| Six cube-face sectors | 113 / 100 / 102 / 104 | 109k / 84k / 83k / 101k |
| 24 sectors, heavy layers only | 133 / 89 / 109 / 135 | 102k / 87k / 84k / 95k |

Order is forest / canyons / mountain / city.

Draw calls rose 20 to 60 per biome — straight through the 100 budget — for a
triangle saving of 17 to 22 percent. The reason is the world's own shape. The
camera sits ON a radius-120 sphere with a horizon around 44 units, and the
2026-05-31 distribution pass deliberately scattered the primary prop of every
biome evenly across the whole planet. So every sector holds instances, and a
view toward the horizon crosses many sectors at once. Frustum culling rejects
the hemisphere behind the camera and very little else, while each surviving
sector costs its own call.

Sectoring pays off when props are clustered and the far side is genuinely
empty. Here they are deliberately not. If this is revisited, the thing to
measure first is whether draw calls or vertex throughput is actually the
binding constraint on the target phone — which is exactly the profiling the
brief asks for and which no desktop or software-rendered run can answer.

## 7b. Stage F (original plan, for reference) — spatial instance sectors

Brief item: enabler, "profile first". This is the one performance stage, and
it is measurable here because the harness reports **rendered** triangles from
`renderer.info`. Desktop forest is ~118k triangles and city ~92k against the
80k target; mobile forest ~63k.

**Why it works.** Every prop layer is one `InstancedMesh` spanning the planet
(names at `spherical-world.js:963–2391` plus `forest-canopies-${c}` and
`canyon-spires-${mi}`). One mesh means one bounding sphere the size of the
planet, so frustum culling never rejects anything and the far hemisphere is
always drawn. Splitting each layer into sectors by direction lets Three cull
the back half for free.

**Build.**
- In `spherical-world.js`, add a helper `buildSectoredInstances(THREE, name,
  geometry, material, placements, sectorCount)` that assigns each placement
  to a sector by its unit direction (use the 6 cube faces: dominant axis and
  sign; 6 sectors is enough because the camera only ever sees ~1/4 of the
  sphere), creates one `InstancedMesh` per non-empty sector named
  `${name}.s${k}`, and returns the array. Compute each mesh's bounding sphere
  from its own instances (`computeBoundingSphere` on the InstancedMesh, which
  Three 0.183 supports).
- Convert the heavy layers only: forest trunks, forest canopies, mountain
  pine trunks and canopies, mountain peaks body and snow, city towers and
  buildings, canyon spires. Leave small layers (rocks, ferns, clutter) alone.
  Budget: ≤ 30 extra draw calls per biome, keep total < 100.
- **Every consumer that matches instanced mesh names must still work.**
  There are three: `bakeGroundContacts` (`visual-style.js`, regex
  `/trunks|forest-rocks|boulders/`), `createNestOcclusion.clearNear`
  (`nest-occlusion.js`, regex on `^(forest-(trunks|canopies)|...)`), and the
  disposer at `spherical-world.js:2546`. The regexes are prefix matches and
  the disposer traverses, so a `.s3` suffix passes through, but verify each
  with a test rather than assume. Nest host metadata for instanced props
  carries `hostObject: null` plus a string `hostId` (see
  `spherical-world.js:862`, `1295`, `1652`, `1877`, `2190`), so sectoring
  does not need to remap any instance index. Do not start storing the sector
  mesh as `hostObject`: `nest-points.js:153` hides any non-instanced
  `hostObject` while nested, and an InstancedMesh there is ignored by design.
- Collision is unaffected: `SphericalCollisionSystem` and `collider-grid.js`
  hold their own arrays.

**Prove.** Harness max triangles per biome before/after; target ≥ 35% fewer
rendered triangles on the flight view with draw calls < 100. Nest count per
biome at the fixed seed must be unchanged (forest 9, canyon 15, mountain 7,
city 11 on mobile). Nesting occlusion harness check must still pass. Run
`birb-shot --nest` in every biome.

## 8. Stage G — vertex occlusion and material zoning

Brief item: 5/5, 3–6 days. Do the vertex half only. **Do not add texture
atlases or KTX2**; this game generates every texture in code and the owner has
not authorised downloaded assets.

- **Canopy pockets.** `createCanopyGeometry` (`visual-style.js`) bakes a
  vertical gradient. Add a radial term: vertices near the lathe axis darker
  than the rim, and a per-ring noise so the three profiles read as sculpted
  rather than smooth. Keep the envelope (radius ≤ 1, y 0..1) and the +0.06
  bounding sphere pad.
- **Rock crevices.** Boulder and peak geometries get a slope-based vertex
  colour: faces whose normal is within 25° of the local up are lighter
  (dust/snow), steep faces darker. Do this once at build time in the builder
  that creates the geometry, using the existing `TERRAIN_COLORS`-style
  stops.
- **Ground zoning.** The ground already colours by height. Add slope and a
  moss band: on the forest, ground within 4 units of a trunk base gets a
  moss tint (the `bakeGroundContacts` spatial hash already visits exactly
  those vertices; add a second colour term next to the occlusion term).
- Mobile and desktop get the same bake; it costs nothing at runtime.

**Prove.** Sheet before/after. Shader compile unchanged (Lambert materials
with `vertexColors`, no new shader). Triangles unchanged.

## 9. Stage H — landmark slice (only if the session still has room)

Brief item: 5/5, 7–14 days for the full route. Do a bounded slice: **one
giant nesting tree** as a forest destination plus **two silhouettes** along the
line from spawn toward the valley.

- The valley is anchored at `VALLEY_ANCHOR` (`spherical-world.js:415`) and the
  slalom at `SLALOM_ANCHOR`. Place the giant tree ~20° along the great circle
  from the valley anchor away from the slalom, on a spot where
  `terrainFloorDir` is near 0 (a plateau) so it reads as a crown, not a pit.
- Giant tree: reuse the trunk and canopy unit geometries at scale 5–6 with
  three stacked canopy layers, a single `Mesh` each (not instanced), a
  collider at cruise altitude like the champions have, and one nest
  candidate with `hostId: 'giant-tree'` and **`hostObject: null`** fed into
  the normal `selectNestPlacements` path so spacing rules apply. `hostObject`
  must stay null: `nest-points.js:153` sets any non-instanced host invisible
  while nested, which would erase the tree the player is sitting in. It must not exceed the
  brief's crown height rule: crown ≤ 40 units above local ground.
- Silhouettes: a fallen log bridge (`CylinderGeometry` laid tangent to the
  surface across a small carve) and a rock arch (`TorusGeometry` half, the
  canyon already has arches to copy from at `spherical-world.js:1472`). Both
  register a `proximityTargets` entry so the whoosh cue fires.
- Draw calls: ≤ 6 for the slice. Mobile: same objects, no extra tier gate,
  they are opaque.

**Prove.** Sheet flight view from spawn shows at least one landmark. Nest
count changes by exactly +1 in forest. Collision test: fly the harness
camera through the giant tree canopy at cruise altitude and confirm a
collider hit via the collision system (add a unit test on the collider list
if the world builder can run under the Three stub; otherwise a harness
assertion).

## 10. Not in scope for this session

- Bloom and MSAA. Gated on a phone measurement the brief says must come
  first. If you wire anything, it is a desktop-only `?bloom=1` flag, off by
  default, and you say so in the commit.
- Lighting and palette tuning. The owner does this on a phone with the Stage
  A capture sheet.
- WebGPU. Separate spike.
- Texture atlas / KTX2. Not authorised.
- Anything in `gauntlet/`, `sculpture/`, `AR/`, `humanoid/`, `basic/`.

## 11. Invariants that end the session if broken

Read these twice.

1. **Zero allocation in `update()` paths.** Pre-allocate with `_` prefix.
   `getWorldPosition(target)` is fine; `.clone()` is not.
2. **Terrain floor is ≤ 0 and shared.** Do not touch `terrainDisplacement`,
   `terrainFloorDir`, `CONTINENT_BIAS`, or `Math.min(0, …)`. The contact
   shadow *reads* the sampler, nothing *writes* it.
3. **Never hide a whole InstancedMesh** to fix a nest view. Sectoring
   (Stage F) changes what a mesh contains, not whether the occlusion helper
   may hide it. `clearNear` still collapses individual matrices.
4. **Nest hosts carry a stable `hostId`** (and forests a `groveId`). After
   sectoring, the host object is the sector mesh.
5. **Every new module goes into `sw.js` `PRECACHE`** (list at lines 43–73)
   and **`CACHE_VERSION` is bumped** (line 8, currently
   `v16-2026-09-06-visuals-perches`) in the final commit of the session.
6. **Every new material and texture is disposed** on environment switch.
   Scene-level effects (shadow, ribbons) are created once and survive
   switches; world-level ones go under the world root so `dispose()` at
   `spherical-world.js:2546` frees them (it already disposes `map`).
7. **Tier order of degradation:** optional effects first (ribbons at tier 1,
   contact shadow and mist reduction at tier 2), then distant detail, then
   resolution. Do not change the FPS thresholds at `index.html:6245–6249`.
8. **Reduced motion** gates decoration only. Never pause gameplay on it.
9. **Three stays at 0.183.2, no build step, no new dependencies.**
   Playwright is `--no-save` tooling only.
10. **Restore the Three stub after any `npm install`** (§1).

## 12. Commit cadence and the session's definition of done

One commit per stage, message in the imperative, body naming the file(s), the
tier gating, and the evidence (test name or capture path). Push after each.

The session is done when:

- `npm test` passes with the new tests added.
- `tools/visual-review.html` reports all eight combinations passing.
- `tools/visual-sheet.mjs` produces an after-sheet, and the before-sheet is
  kept beside it in `docs/visual-upgrade/` (two PNGs, mobile path).
- Harness max draw calls < 100 in every biome on both paths, and Stage F
  shows the triangle reduction in the commit body.
- `sw.js` precache and version are updated.
- This document's §13 is filled in.

Then stop and report to the owner what shipped, what did not, and the exact
phone test list from the brief's §Acceptance item 4 so they can run it.

## 13. Implementation log (fill in as you go)

| Stage | Status | Evidence | Notes |
|---|---|---|---|
| A tooling | Shipped | `tools/birb-shot.mjs`, `tools/birb-sheet.mjs`, `docs/visual-upgrade/after-mobile.png` | Also needed a CDN cache: Chromium has no NSS store here and cannot verify the proxy CA. Splash clicks must be dispatched on the elements, not at coordinates. |
| Perch horizon (unplanned) | Shipped | `tests/perch-horizon.test.js`, perch tiles in the sheet | Not in the roadmap. The first sheet showed all four biomes opening their nest view on ~85% empty sky. Level is 41 degrees above the horizon on this planet. |
| B contact shadow | Shipped | `tests/contact-shadow.test.js`, one extra draw call measured | Falloff retuned from 14 to 34 units after the debug stats exposed that cruising sits 8-15 units over real terrain, not 3. |
| C VFX + ribbons | Shipped | `tests/ribbon-trail.test.js` (zero-allocation proof), `src/effects/burst-signatures.js` | Ribbons needed three fixes a capture found and no counter could: width axis, bank rather than boost as trigger, and normal rather than additive blending. |
| D waterfall | Shipped | Shader compiles on both device paths in the sheet run | Specular now follows the key light. Mist bounded within 14 units and first to shed on tier change. |
| E bird animation | Shipped | `tests/bird-pose.test.js` | Perch fold, asymmetric knockdown tumble, tail as an elevator. |
| F instance sectors | ATTEMPTED, REVERTED | Measurement table in section 7 | Draw calls rose past the 100 budget for a 17-22% triangle saving. The world's even prop distribution defeats sector culling. |
| G vertex occlusion | Shipped | Sheet before/after | Slope shading and moss zoning on the ground, radial rim term on canopies. Build-time only. |
| H landmark slice | Shipped | Giant tree visible in the forest flight tile | Giant nesting tree, fallen log, stone arch, placed along the valley's great circle. |

### Second pass (after the first merge)

| Work | Status | Notes |
|---|---|---|
| Adaptive quality had never run | Fixed | `updateFpsReadout` returned early on a missing DOM element, and the tier manager's only call site was inside it. Pinned at tier 0 since it was written. `tests/frame-metrics.test.js`. |
| Landmarks for the other three biomes | Shipped | Leaning monolith, summit arch, broadcast mast. One each: different in kind, not merely bigger. |
| Suspected landing bug | Not a bug | The capture harness indexed into the nest list and picked nests across a 754-unit circumference; landing auto-flies in a straight line at 16 units/s. Landing on the nearest nest, as the player's tap does, succeeds 24/24 across all four biomes. |
| Sheet captured degraded output | Fixed | With adaptive quality alive, software rendering downshifts to tier 2 within seconds and every art review would have been conducted against output no phone produces. `--tier N` pins it; the sheet pins tier 0 by default. |

### Capture tooling, as it now stands

Install once per session, in ONE command (a second `--no-save` install prunes
the first), then restore the tracked Three stub:

```
npm install --no-save playwright https-proxy-agent
git checkout -- node_modules/three/index.js
```

| Tool | What it answers |
|---|---|
| `node tools/birb-shot.mjs --start --out shot.png` | Does one frame render, with no page or console error? Takes `--env`, `--nest`, `--desktop`, `--eval`. |
| `node tools/birb-sheet.mjs --out sheet.png` | How do all four biomes look in flight and at a perch? Pins tier 0 by default; `--tier N` to capture a quality level deliberately. |
| `node tools/birb-lighting.mjs --out l.png` | Which of six lighting candidates looks best, from one fixed viewpoint? Takes `--env`, `--view nest`. |

The `?debug=1` handle (`window.__BIRB`, absent without the flag) drives all
three: `setEnvironment`, `forceNest`, `takeOff`, `teleport`, `goToLandmark`,
`setStick`, `setSprint`, `setAltitude`, `pinTier`, `setLighting`,
`capturePose` / `restorePose`, and `stats`.

Two things about it are load-bearing. `capturePose` / `restorePose` exists
because zeroing speed does NOT hold the bird — the flight system rewrites it
every frame — and a comparison sheet whose tiles differ by viewpoint is worse
than none. `pinTier` exists because adaptive quality now works, and software
rendering here downshifts within seconds, so an unpinned art review is
conducted against output no phone produces.

### Left for the next session

- **Bloom, MSAA, WebGPU, texture atlas / KTX2.** Untouched, as planned.
- **Lighting and palette tuning.** Needs a phone. Use the committed sheet.
- **Adaptive quality thresholds are now live and have never been exercised on
  hardware.** 55 fps to downshift, 58 to restore, over 2 and 4 second windows.
  They were tuned against a system that could not run. A phone may now shed
  DPR where it previously never did, which is the intent, but it is the first
  thing to watch on a device.
- **The physical-phone benchmark is still outstanding** and remains the real
  acceptance gate for everything here. Nothing in this session ran on a device.

### Old empty log

| Stage | Status | Evidence | Notes |
|---|---|---|---|
| A tooling | | | |
| B contact shadow | | | |
| C VFX + ribbons | | | |
| D waterfall | | | |
| E bird animation | | | |
| F instance sectors | | | |
| G vertex occlusion | | | |
| H landmark slice | | | |
