# Full Send — refactor audit + living-world plan

Written 2026-10-19 against main `c1bafd4` (build v88). Planning only; nothing
here is built. Owner: Mentis. Builder: Opus (code). Art: Codex, pointed at this
repo, working from the briefs in §7 under the `docs/realism/AUTHORED_ASSETS.md`
contract.

The source of the ideas is the energy/mining tabletop kit in
`Mentis123/adamrappaport` (`public/map-assets/`, `docs/three-worlds/`). That kit
already borrowed Birb's adaptive-quality rules; this round borrows back. Nothing
is copied verbatim: the kit is a flat table with +Y up and a turntable; Birb is a
radius-120 sphere where up is radial. Every port below says what changes.

## 0. What "best" means here

1. **The world is alive.** Things move on their own, on a clock, and the player
   can interact with them (chase, perch, race). Today only drones and clouds move.
2. **The world rewards looking.** Casual mode gets a soft discovery loop:
   landmarks you can find, a count, a mark on the minimap. No quiz, no score
   screen, no fog-of-war wall.
3. **It can show itself off.** Camera flights as data, recorded clean from the
   browser, so a trailer or an X clip is `?studio=1&shot=…` not a phone screen
   recording.
4. **Regressions are caught by numbers.** Every floating/buried/clipped prop this
   repo ever shipped was found by eye on the phone. A grounding audit in CI
   closes that class.
5. **index.html stops growing.** It is 16,561 lines; the `__BIRB` debug object
   alone is ~2,100. The refactor pays for the features by giving them a place
   to live.

Non-negotiables carried forward, unchanged: the hard budget (<80k scene
triangles, <100 draws; <120k/<100 shadow-inclusive), zero allocation in the
loop, no bundler, pinned CDN three, the `Math.min(0,…)` floor, the species
transaction, the frozen oracle manifest (R5), and `sw.js` CORE_ASSETS + a
`CACHE_VERSION`/`BIRB_BUILD` bump in every commit that adds a `src/` module
(`BIRB_PERF_IMPL=1 node --test tests/build-identity.test.js` is the oracle plain
`npm test` skips).

## 1. Refactor audit — what moves out of index.html, in what order

Measured section map (boundaries ±50 lines; see the audit of 2026-10-19):

| Section | Lines | Size | Risk to extract |
|---|---|---|---|
| `window.__BIRB` debug object | 14340–16456 | ~2,100 | **Low.** `?debug`-gated, read-mostly, but closes over everything → needs a context object |
| `renderFrame` main loop | 11832–13540 | ~1,700 | **High.** Core. Only sub-blocks move, as `update(dt, ctx)` modules |
| Bird model / plumage / pose | 7563–9320 | ~1,750 | High (leave) |
| Pause/renderer sizing/flight construction | 10112–10908 | ~800 | High (leave) |
| Lighting grade, shadow sizes, bloom config | 6264–6995 | ~730 | Medium — config-like |
| Audio: preload, SFX pools, sound settings | 4133–4836 | ~700 | Medium-low (`flight-audio.js` already exists) |
| Air field / weather / `setEnvironment` | 6996–7560 | ~565 | High (world rebuild) |
| Game modes start/end/HUD | 5798–6263 | ~465 | Partly (core already in `game-modes.js`) |
| Species picker + transaction hooks | 9323–9736 | ~410 | Medium-low |
| Adaptive tier / `qualitySettings` | 9737–10110 | ~375 | Medium |
| Splash / wake lock / streak / onboarding | 3212–3500 | ~300 | **Low** (DOM + localStorage only) |
| Flight/camera/bird toggles UI | 13944–14230 | ~290 | **Low** (UI glue) |
| Mobile perf detection, haptics | 3986–4132 | ~145 | **Low** (pure) |
| Settings UI, info panel | 13668–13820 | ~150 | **Low** |
| Landmark seek, goto toast, startup location | 14232–14335 | ~105 | **Low**, and it is the seed of §3 |
| Context lost/restored | 13545–13667 | ~120 | Low |
| Boot watchdog + SW update (classic scripts) | 16469–16556 | ~90 | Leave — deliberately classic, outside the module |

**Rule for every extraction:** the module takes a `ctx` object and returns
functions; index.html keeps one call site. No behaviour change, proven by the
existing Browser Health steps (`birb-default`, `birb-modes`, `birb-walk`,
`birb-stunt`, `birb-flight-v2`, `birb-quality --check all`) staying green and by
`tools/birb-shot.mjs` A/B at a pinned pose (`restorePose` + `freeze` +
`setSunTime` + `pinTier`) reading 0 differing pixels.

**Order (each is one PR, each must be a no-op on screen):**

- R1 `src/debug/birb-hooks.js` — the `__BIRB` object. Biggest line win, lowest
  risk, and the features below need a stable place to add hooks. Build it as
  `installDebugHooks(ctx)`; index.html passes the closure variables in one
  literal. Keep it a dynamic `import()` only under `?debug=1` so production
  never fetches it.
- R2 `src/ui/title-flow.js` (splash/streak/wake lock/onboarding) and
  `src/ui/settings-glue.js` (toggles, info panel, quality-preset buttons).
- R3 `src/platform/device.js` (mobile detection, haptics, DPR caps).
- R4 `src/audio/sfx.js` (preload + pools + settings) beside `flight-audio.js`.
- R5 `src/game/world-tick.js` — the thing the living world needs: a per-world
  **update registry**. Today the loop is 21 hard-wired calls (nesting 11862,
  `features.update` 11871, water 11875, rockets 11924 … minimap 13519).
  `features.update` at `spherical-world.js:4523` only calls `valley.update`;
  it becomes `world.tick(dt, time, ctx)` iterating `world.updates[]`, same
  shape as the map kit's `world.updates`. Existing calls do not move in R5;
  only new systems register. (Moving the old ones is a later, separate PR per
  system, and only if it buys something.)
- R6 Landmark registry gains `label`, `biome`, `kind` and a stable slug; it
  is currently `{id, position, viewDistance}` built inside each biome builder
  (`spherical-world.js:1946`, `:2283`). This is a data change that §3 and §4
  both need.

Not in scope, still open from `CODEBASE_EVALUATION.md`: M7 import map, M8
camera damping unification, L4 dual input stacks, L6 one phase owner for
FLYING/GROUNDED/NESTED. Leave them listed; do not fold them into this round.

## 2. Living world — clocked actors

**Port of** `world.actors[name] = {cycle, phases, stateAt(t)}` from
`activity.js` / `service-traffic.js` / `mining-vehicles.js`. Every actor is a
pure function of absolute scene time: `phase = ((t+offset) % cycle)`. Nothing
integrates, so seek, pause, capture and tests are exact, and the per-frame cost
is a curve lookup and one matrix write.

**Changes for the sphere.** `stateAt(t)` returns `{position: Vector3,
heading, phase}` where heading is an angle in the local tangent plane; the
frame is built from `up = normalize(position)` and parallel transport along the
route (the same machinery `bird-flight.js` uses). Routes are `CatmullRomCurve3`
through points sampled on the ground via `sampleTerrainMeshHeight`
(`spherical-world.js:908`) plus a ride height; the audit in §5 checks them.

**Where the budget is.** Forest spawn is 75.4–77.9k scene triangles with the
Pionus and the owl's worst random boot is 79,765 — **the forest gets nothing
with geometry.** City (49–51k) and mountain (46.5–48k) each have ~30k of
headroom; canyons is unmeasured (run `tools/species-frame-budget.mjs` for it
first). Every actor layer is one `InstancedMesh` per material, merged with the
`makeBatch` idea (UVs stripped, one geometry per material), so an actor is ~1–3
draws for the whole fleet, not per vehicle. Hard cap for this round: **+6 draws
and +8k triangles per biome**, measured by the budget tool, with the Okay/Light
tiers cutting fleet counts the way scatter counts already gate on `_isMobile()`.

**Actors, in build order:**

| # | Biome | Actor | Route | Why first |
|---|---|---|---|---|
| A1 | City | **Hover traffic.** The 14/38 instanced tori at `spherical-world.js:3747` already exist and are parked at 30–60 units. Give them lanes along the shader's own street grid (block 44, lat/lon lines where `fract(street)==0.5`, `city-windows.js:170`) at the bird's cruise band | analytic grid lines, no new geometry | Zero triangles, zero draws, instantly visible, and it puts moving things in the flight layer the player is already in |
| A2 | City | **Tram.** One articulated vehicle on a loop road, 2 cars, lit windows via the existing emissive bucket; headlight is an emissive quad, not a light | one Catmull-Rom loop around the largest block cluster | First perchable mover (§2.1) |
| A3 | Mountain | **Cable car.** Two cabins on a wire between a valley station and the summit-arch ridge; counter-moving, pure `t` | straight wire between two sampled points, sag by catenary | A moving perch with a view; the arch landmark gets a reason to exist |
| A4 | Forest / all biomes | **Barge on the lake / river.** Lakes are a flood-fill mesh, not data (`water.js:172`); find them at build time by scanning directions with `sampleBasinHeight < waterLevel` and clustering, pick the largest; the valley river ribbon in `landmark-valley.js` has a known centreline | polygon around the lake, or the river ribbon | The valley is the authored hero slice; a single low boat is ≤400 triangles |
| A5 | Canyons | **Buzzards** — a lazy thermal circle of 3 silhouette birds (crossed quads) over the leaning-monolith, riding the existing `air-field.js` thermal positions | circle around a thermal centre | Reuses the air field as data; the one biome with nothing moving |

**2.1 Moving perches.** `nesting-system.js:69` reads the nest's world position
from the live group each time `setLandingTargetFromNest` runs, and the LANDING
state re-calls it (`:295`). So a nest group parented under an actor's node
*should* track it. Unverified: NESTED pose follow, occupancy, and
`nest-occlusion.js`. Gate: `tools/birb-modes.mjs`-style headless run that lands
on the tram, waits 10 s, asserts the bird's world position moved with the tram
and the camera stayed sane. Ship A2 without the perch if that gate is red; the
tram is still worth it as scenery.

**2.2 Colliders.** `SphericalCollisionSystem` is static (positions cloned,
grid rebuilt lazily, `insert` build-time only). Actors do **not** go in the
grid. A small dynamic list (≤8 entries) is tested after the grid query each
frame; a hit is the existing knockdown. Drones already prove the pattern.

**2.3 Game hooks** (after A1–A3 are in; one each, small): Ring Rush variant
with 4 rings carried by hover traffic; "catch the tram" Casual hint; cable-car
perch counts as a discovery (§3).

## 3. Discovery — pins and a found-places loop

**Port of** `pins-layer.js`: DOM `<button role=listitem aria-label="Fly to X">`
over a projected anchor, distance-tiered fade (`clamp((range-dist)/(range*.15))`),
off-screen hide, overlap suppression (selected first, then nearest; a clash
drops the label and keeps the dot), one throttled raycast per 60 ms round-robin
for occlusion (dim, never hide), coarse-pointer cap of 6.

**Birb version** (`src/ui/discovery.js`, pure logic + `src/ui/pins-layer.js`
DOM):
- Source of truth is the landmark registry from R6, extended with the moving
  perches and the biome's champion trees. Target: 6–10 places per biome.
- A place is **found** when the bird is within `viewDistance` and it has been
  on screen for 1.5 s, or when the bird perches on it. Persisted in
  `localStorage['birb.found.v1']` as `{biome: [ids]}`. Found count on the
  title page beside the streak chip, and on the minimap (`minimap.js:354`
  already draws the nearest landmark; add found/unfound styling and a count).
- Pins render only in Casual/Zen, fade in inside `viewDistance * 2`, and
  never inside a mini-game. Occlusion raycasts against a cached list of the
  biome's landmark meshes only (never the instanced layers).
- Phone: dots only below the fade mid-point, label on the nearest.
- A toast on first find, same style as the `?goto=` toast (index.html:14232).

Gate: `tools/birb-discovery.mjs` — boot forest, `goToLandmark('stone-arch')`,
assert found count 1 and the pin's `.found` class; reload, assert persisted;
assert zero pins in Ring Rush; phone viewport, ≤6 pins, no overflow.

## 4. Shots — camera flights as data, studio capture, attract mode

**Port of** `flythrough.js` (114 lines, imports only three's math): spec
`{name, world, title, fov, audit:{maxSpeed,minClearance}, clock, fade, keys[{t,pos,look,fov?,ease?}]}`;
refs `[x,y,z]`, `{object, offset}`, `{actor, offset:[along,up,side]}`;
centripetal Catmull-Rom with key *i* reached exactly at *tᵢ*; `fade` as a
clip-space quad so it survives a WebM.

**Sphere changes:** `actorFrame` takes an up vector (tangent-plane frame);
`auditShot` clearance becomes `|p| - (120 + sampleTerrainMeshHeight(p))` and
water is `|p| - (120 + waterLevel)` where `sampleBasinHeight < waterLevel`;
drop `yaw`; `{view}` refs become `{landmark:id, back, lift}` resolved by the
same math as `goToLandmark`. Shots live in `src/shots/<name>.js` with a
registry in `src/shots/index.js` (and in CORE_ASSETS).

**Player:** `src/camera/shot-player.js` drives the live `BirdCamera` rig
(NOT `follow-camera.js`, which is parked — see the aerobatics note in
CLAUDE.md) by writing position/lookAt directly while a shot plays; Esc or a
touch returns the previous view. `?shot=<name>` plays on boot; `?studio=1`
hides every piece of chrome, pins Ultra, pauses the perf advisor, runs the
clock from wall time (dt clamp 0.25 s, so a dropped frame skips not
stretches), holds the last frame; `&record=1` → `canvas.captureStream(60)` +
`MediaRecorder` vp9→vp8→webm at 16 Mbps, downloads `<name>.webm`.

**Attract mode:** the Title page currently sits on a hero image. Once the
shot player exists, `title-attract` is a 40 s looping shot of the current
biome behind the title, started only after the first idle 6 s, at the Okay
tier, stopped on any touch. Gate it on `prefers-reduced-motion` and on the
perf advisor not being yellow. This is the one place the attract costs
battery, so it is opt-out in the gear menu.

**Recorder script:** port `scripts/map-flythrough.mjs` as
`tools/birb-flythrough.mjs` (audit → refuse on fail → `seek(i/fps)` →
screenshot → ffmpeg; 12-frame contact sheet). Under SwiftShader it is minutes
per second of footage; the real path is `?studio=1&record=1` on the Mac.

Shots to author first: `forest-valley` (waterfall → pool → river → champion
grove, 30 s), `city-night` (tram chase → mast, 25 s), `mountain-cable` (ride
the cable car up to the arch, 25 s). Each is also a §3 tour.

Gate: `npm run test:shots` (kernel: every registered shot compiles, audit
passes on the fixed-seed world, fade monotone where declared) and a headless
`tools/birb-shot-play.mjs` that plays each shot at 2 fps and asserts the
camera position matches `sample(t)` to 1e-3 and the chrome is hidden.

## 5. Audits — props on the ground, in CI

**Port of** `auditLandmarks().beacons[].groundError` (`base − ground ≈ 0`) and
the `infrastructure-audit` separation tests. Birb's version,
`src/environment/world-audit.js`, exported as `__BIRB.auditWorld()`:

- **Grounding.** For every landmark mesh, every nest point, every actor route
  sample, and a 2% sample of every instanced layer's matrices (seeded):
  `clearance = |P| − 120 − sampleTerrainMeshHeight(P)` at the object's
  contact point. Fail if `> +tol` (floating) or `< −tol` (buried), with tol
  per kind (trees 0.6, rocks sunk by design up to 1.5, arches 0.4 at each
  foot, nests 0.3). This exact check would have caught the floating canyon
  tori, the flat forest arch, and the arch buried 20 units in a pit.
- **Separation.** Landmark bounding spheres vs each other and vs the
  waterfall sheet; nest points vs the nearest canopy ceiling disc.
- **Geometry.** Non-finite positions/normals, bad indices, degenerate
  triangles per unique geometry (straight port of `geometry-audit.js`).
- **Routes.** Every actor route sample has clearance in `[rideHeight−0.2,
  rideHeight+0.5]` and never enters water unless the actor is a boat.

Output `{pass, checks:[{name, pass, detail}]}`; `tools/birb-audit.mjs` runs it
on all four biomes × fixed seed + 3 random seeds and exits 1. Added to
`browser-health.yml` after `birb-modes`. **Build this first** (§6): it guards
every other item.

## 6. Grounding and wear (cheap realism)

From `MAP-REALISM.md`, what applies and what it costs:

- **Contact AO under props.** One `InstancedMesh` of `CircleGeometry(1,16)`
  discs per biome, sharing `contact-shadow.js`'s radial canvas texture,
  oriented to the surface normal, `depthWrite:false`, polygon offset,
  `renderOrder` after terrain. Instances come from the same placement arrays
  as trunks/spires/towers. **+1 draw, +32 triangles per 1,000 props.** Opt-out
  `?groundao=0`; A/B with pinned pose.
- **Wet bands.** In `ground-detail.js`, darken + lower roughness within 1.5
  units above `waterLevel` in the basin (`sampleBasinHeight` is already
  sampled for the shoreline foam) — a shader term, zero geometry. The pool
  and lake shores stop looking painted on.
- **Scale cues.** §2 is this item. One tram tells the eye how big the towers
  are better than any texture.

Skipped on purpose: the planar reservoir reflection (a second scene render;
the Ultra forest cannot carry it) and the Lab's modal exhibits (pause the
game; a perch "field guide" card is the only version that fits, and it is a
§3 follow-up, not this round).

## 7. Codex — the art it can own, by brief

All under `docs/realism/AUTHORED_ASSETS.md`: PNG 8-bit, POT, tiling, suffix-
named (`_albedo/_normal/_rough/_orm`), metres-per-tile stated, 24 MB
resident ceiling per biome, `node tools/asset-check.mjs` exit 0, a row in
`assets/MANIFEST.md`, `?flag=0` opt-out with the procedural fallback kept.

| Brief | Target | Notes |
|---|---|---|
| C1 `tram_albedo/_orm` 512² | A2 | One atlas for both cars: panels, lit windows (emissive in B channel of a 4th map or vertex colour), roof. Tiles are not needed; say so in the brief (first non-tiling map — asset-check will need a `--kind decal` path) |
| C2 `cablecar_albedo/_orm` 512² | A3 | Same shape as C1 |
| C3 `city_asphalt_albedo/_normal/_rough` 512² | §6 | Replaces the shader-only street tone under the grid lines; tiles at 6 m |
| C4 `lake_bed_albedo` 512² | §6 wet bands | Pebbled bed seen through shallow water; tiles at 4 m |
| C5 Title-page attract **poster** 1024×512 per biome | §4 fallback | The still shown under `prefers-reduced-motion` or while the shot loads. Not a texture; goes in `assets/posters/` |
| C6 Hero bird rebuild (from `docs/realism/README.md`) | later | Only after the rig-contract test (`tests/bird-contract.test.js`) is extended to GLB skins; a statue is not a bird. Out of this round |

Codex gets this file, `AUTHORED_ASSETS.md`, `ASSET_JOBS.md`, and the
`asset-check` tool; it should not touch `src/` or `index.html`.

## 8. Build order and gates

Each row is one branch off main, one journal note in CLAUDE.md (the way every
pass here has been recorded), the budget tool run on the touched biomes, and
Browser Health green before merge.

| Step | What | Gate |
|---|---|---|
| 1 | §5 world audit + `tools/birb-audit.mjs` in CI | Red-first: plant a floating tree with `?audittest=float` and prove the tool fails, then passes |
| 2 | R1 `__BIRB` extraction, R5 update registry, R6 landmark data | Pinned-pose A/B 0 px; all Browser Health steps green; build-identity test |
| 3 | A1 hover traffic (city) | Budget tool: +0 tris; `birb-modes` green; a 10 s headless run proves the instance matrices change |
| 4 | §4 shot kernel + player + studio + `forest-valley` shot | `test:shots`; `birb-shot-play`; one WebM recorded on the Mac and looked at |
| 5 | A2 tram + perch gate; A3 cable car | Budget ≤ +8k/+6 draws per biome; perch gate; audit routes |
| 6 | §3 discovery pins + minimap + title count | `birb-discovery.mjs`; phone cap |
| 7 | §6 contact AO + wet bands | A/B pinned pose; budget +1 draw |
| 8 | A4 barge, A5 buzzards, `city-night` + `mountain-cable` shots, attract mode | Same gates; attract respects reduced-motion and the perf chip |
| 9 | R2–R4 extractions | 0 px A/B each |
| 10 | Codex C1–C5 land; §2.3 game hooks | `asset-check`; mode harness |

**Phone measurement is still unowned** and every past pass says so. Step 3 is
the first visible change; before step 5 merges, Mentis flies A1 + the audit
build on the iPhone 16 Pro and reports the perf chip state. If the chip goes
yellow at Ultra in the city with hover traffic alone, the tram waits on a
Light/Okay gating of fleet counts rather than shipping on faith.

## 9. Open questions for the owner (answer before step 3)

1. Discovery persistence: per device (localStorage, simplest) or do you want
   it to travel with the daily-streak chip into a future account? Plan assumes
   per device.
2. Attract mode default: on (with the opt-out) or off? Plan assumes on, after
   6 s idle, Okay tier.
3. Tram perch: if the perch gate is red, ship the tram as scenery (plan) or
   hold it until the perch works?
4. Canyons budget: run the budget tool before A5, or skip canyons this round?
