# CLAUDE.md — Birb Mobile

> **2026-09-06 visual/nesting update:** Read
> [docs/VISUAL_UPGRADE_BRIEF.md](docs/VISUAL_UPGRADE_BRIEF.md) for the standalone
> direction, implementation map, mobile constraints and unfinished roadmap.
> It supersedes older notes below about hiding all props while nested and
> deliberately placing nests at fractional heights inside champion structures.
> Nesting now preserves scenery; perches occupy actual modest-height crowns/roofs.
> That plan was then executed: see
> [docs/VISUAL_UPGRADE_BUILD_PLAN.md](docs/VISUAL_UPGRADE_BUILD_PLAN.md) §13 for
> what shipped and what did not. Two things there matter most for future work.
> **The root game now has a capture harness** — `node tools/birb-shot.mjs
> --start --out shot.png` for one frame and `node tools/birb-sheet.mjs --out
> sheet.png` for all four biomes in flight and perch views. Both need
> `npm install --no-save playwright https-proxy-agent` (in ONE command; a
> second `--no-save` install prunes the first) followed by `git checkout --
> node_modules/three/index.js`. **Spatial instance sectors were measured and
> rejected** — draw calls rose past the 100 budget for a 17-22% triangle
> saving, because this world's props are deliberately scattered evenly and
> sector culling only rejects the far hemisphere. Do not rebuild it blind.
> The perch camera rests at a horizon-derived pitch, not level: on a
> radius-120 planet a 40-unit crown puts the horizon 41 degrees below level,
> and every nest in every biome used to open on empty sky.

> Context for AI assistants and Vibe Academy builders. Read this first.

## This Is a Birb Labs Artefact

Birb Mobile is a **breakable toy** — a real, shipped, playable game that also serves as a learning artefact inside Vibe Academy. It exists so people can inspect real code, run it, break it, rebuild it, and learn from it.

**Play it:** https://birbmobile.vercel.app
**Repo:** git@github.com:Mentis123/birb.git
**Ecosystem:** Part of the Vibe ecosystem (vibeacademy.com.au)

### Sibling artefacts (Birb Labs showcase)

Birb Mobile is one of three showcase artefacts for Birb Labs inside Vibe Academy. All three share the same splash treatment: primary image splash with animated conic-gradient border → Vibe Academy attribution splash → game.

1. **Birb Mobile** — birbmobile.vercel.app (3D flight, this repo)
2. **Rogue Mobile** — roguemobile.vercel.app / yagamentis.vercel.app/rogue (turn-based roguelike)
3. **Frosty Spider** — (Next.js spider solitaire)

All three link their Vibe Academy CTA to `https://www.vibeacademy.com.au/`. Never `atmanacademy.io` — that domain is retired.

### Game state (2026-04-20)

Major overhaul session. Birb Mobile now ships the full **Birb Labs Artefact Treatment** — three-page entry flow (Splash → Vibe → Title) matching Rogue Mobile and Marco Mobile. See canonical spec at `vibeacademy-brain/wiki/brand/birb-labs-artefact-treatment.md`.

**Shipped this session:**
- Splash / Vibe / Title page flow with hero image + drifting feathers + cyan sparks on the Title page; "?" help and ⚙ settings in corners
- Render loop **fully deferred** — nothing runs behind splashes; `<main hidden>` until Tap-to-Start
- Procedural bird redesigned (chibi silhouette, layered-cone wings, big eyes, prominent beak) with `leftWing` / `rightWing` / `leftFoot` / `rightFoot` named groups preserved
- Flap animation (symmetric, right wing flap is negated to counter the scale.z=-1 mirror) + walk cycle (body bob + alternating foot tilt, only when GROUNDED && input.active)
- Committed knockdown — no Self Arrest. Fall ramps 1× → 3× over 3s, tree-impact shake + thud, Fly launches with outward impulse
- Realign quaternion on launch so yaw still feels right after a tumble
- Drones rescaled for 4× world (body 3.6, ring 5.4), slowed 20%, altitude moved into bird's flight layer
- Ring Rush: r 0.6 → 2.5, count 10 → 18, fibonacci replaced with arc-ribbon across near hemisphere
- Solid colliders at cruise altitude for trees/spires/mountains/towers + new cloud colliders — you can crash into things now
- Drone-bird collision triggers the knockdown instead of a subtle freeze
- Hide host tree + nearby props while nested so horizon is clear
- Mode-aware minimap (Zen = compass+nest, Ring Rush = rings only, etc.)

**Known / pending:**
- ~~Minimap is too zoomed-out per playtest~~ — **fixed** (mode-aware `visibleRadius` 65–95 shipped)
- Task 6 playtest pass on Drone Hunter + Turret Defense tuning still open
- ~~Eruda debug still present in `index.html`~~ — **removed**

**Sibling siblings:**
- Rogue Mobile (`Mentis123/yagamentis`) — full treatment
- Marco Mobile (`Mentis123/marcomobile`) — full treatment
- Frosty Spider (`Mentis123/FrostySpider`) — treatment alignment pending

**Density / immersion pass (2026-05-31):** all four on-sphere environments densified for a fuller, more layered, exploration-feel world (terrain had been thinned for the 60fps mobile lift, which read as sparse). More trees/spires/peaks/buildings + new instanced prop layers (forest ferns + emergent snags, canyon needle-spires, mountain scree + champion-pine nests, city rooftop clutter + street pylons), taller champions/verticality, and ~2x nests across every biome. Drones are 50% bigger again (body 3.6→5.4, ring 5.4→8.1, collisionRadius 6.6→9.9) and +50% on desktop (12) / held at 8 on mobile. Forest + mountain **clouds refactored from 80/54 separate puff meshes to one InstancedMesh each** (cloud colliders preserved) — reclaims the desktop draw-call headroom that funds the pass. New props are InstancedMesh + collider-free; the remote's cruise-altitude colliders (tree/spire/peak/tower/pine canopies, solid clouds) are kept. Mobile structural counts gated to a middle tier (denser than the thinned base, lighter than desktop). Budgets hold: <100 draw calls, <80k tris, 60fps, per-env. See `src/environment/spherical-world.js` builders + `src/nesting/drone-system.js`.

**Evaluation + polish pass (2026-06-10):** a four-domain multi-agent codebase evaluation shipped as `CODEBASE_EVALUATION.md` — read it before any structural work; it has the prioritized roadmap, a consolidated zero-alloc audit, and a do-NOT-fix list of deliberate trade-offs. Fixes shipped from it: `prefers-reduced-motion` no longer pauses the game (it gates decorative motion only — shake/FOV kicks/speed lines via `reducedMotionState`); Ring Rush win condition + HUD now track the real spawned ring count (was 10 vs 18); turret drone AI loop de-allocated; SW update reload deferred during active runs; Tap-to-Start shows "Loading…" on slow networks. Visual suite shipped: sky-dome sun disc + halo aimed at the env keyLight, camera-anchored sky gradient, twinkling stars, mobile ring shimmer, speed-sense FOV, cinematic vignette. Retention: share button on results (and the results "Best:" line actually displays now — it was being clobbered), personal bests on mode cards, per-mode onboarding hints, og/twitter social cards. **Doc corrections:** the legacy controller is `src/controls/simple-flight-controller.js` (`free-flight-controller.js` does not exist); the `src/performance/` directory is currently UNWIRED dead code (index.html reimplements adaptive quality inline); `src/controls/flight-controls.js` is constructed but its input-shaping methods are no-ops on `BirdFlight` — the live touch path is `src/flight/touch-input.js` → `bird-flight.js`.

**Capabilities + retention pass (2026-06-11):** researched real 2026 mobile-browser limits and adopted what's free: **Screen Wake Lock** during play (iOS 16.4+, re-acquired on tab return); **screenshot sharing** — the results Share button now attaches a fresh-rendered canvas JPEG via Web Share Level 2 (iOS 15+) with text-only fallback; **iOS haptics bridge** — `triggerHaptic` falls back to clicking a hidden `<input type="checkbox" switch>` (native tick since iOS 18) since `navigator.vibrate` remains Android-only; **real PWA icons** (pure-Python-painted 192/512 maskable + 180 apple-touch-icon in `icons/`, manifest updated) so install-to-home-screen finally looks right; **daily flight streak** chip on the title page (localStorage, extends on consecutive-day play). Found but NOT adopted: **WebGPU is now Baseline** (Safari 26+, all majors) — a future `WebGPURenderer` migration is the big graphics unlock but needs a real device-tested branch, not a blind merge.

**Distribution follow-up (2026-05-31):** the first pass only made the clusters denser, but the world still *read* as sparse — on a radius-120 sphere the horizon is ~44u away while groves/ridges/blocks sit ~125u apart, so most views land in an empty gap (see the player screenshot that prompted this). Fix: a **global evenly-distributed scatter layer** of the primary prop in every biome (forest trees 150 mobile / 240 desktop, canyon spires 70/120, mountain pines 110/180, city buildings 120/200), each pushed into the SAME instanced arrays as the clustered props → zero new draw calls, just more instances. Clusters still give dense pockets + nests; the scatter guarantees props are always in view. Applies on mobile too (the user is mobile-first), kept under the fill-rate budget since no new transparent surfaces are added.

**Terrain topology + zoning (2026-05-31):** added a broad low-frequency "continental" noise layer (`terrainDisplacement` / `TERRAIN_PROFILES.continentScale/continentAmplitude`) that carves **deep valleys/canyons DOWNWARD** from the base radius (forest −24, canyon −38, mountain −46 at the extremes). `placeOnSphere` is now terrain-aware via a module-level `_activeTerrainProfile` set in `createSphericalWorld`, so props (and the sphere mesh, via the shared `terrainDisplacement`) sit on the rolling ground. **Why downward-only:** `checkGroundCollision` is the *landing/grounded* mechanic (index.html sets GROUNDED state on a hit) and `bird-flight.js` clamps the bird to a *minimum* radius — so upward terrain rising into the cruise band would force-ground the bird. Carving only downward means the bird (cruising just above base radius) flies OVER and sees INTO the valleys with no grounding/clipping; the "highlands" are the tall instanced peaks/trees. **Fly-INTO-valleys (2026-05-31, shipped):** the bird can now descend into the canyons, not just fly over them. The flight model has NO gravity — the bird holds altitude inertially and the `sphereRadius` clamp in `bird-flight.js` is purely a *floor*. So the floor was made terrain-aware: `BirdFlight._floorAt = sphereRadius + Math.min(0, terrainHeightAt(dir))`, fed by an injected `sampleTerrainHeight` sampler (exported from spherical-world.js, reads the live `_activeTerrainProfile`). `checkGroundCollision` (landing) and `forceGroundedPose` (walking) use the **same** smooth floor (`terrainFloorDir` = continental-only, no detail jitter), so all three agree and the bird isn't trapped. **`Math.min(0,…)` is load-bearing:** with no gravity, a floor that rose above baseline would ratchet the cruising bird upward — so the floor only ever dips into valleys, never rises (rises stay visual via the detail mesh + tall props). No spawn pop (spawn 123 > floor ≤120), no false grounding, zero per-frame alloc. Verified by a 4-lens adversarial workflow (floor consistency, ratcheting/spawn/grounding, alloc/perf/env-switch, math/edge-cases) — all pass. Also: forest/pine scatter now zones by elevation (lush dense valleys → sparse dwarfed ridge tops via a terrain-height tree line), and scatter counts bumped (~25%).

**Rolling-world restore (2026-06-02):** a perceived regression — "the nice tree distribution and canyons are gone." Investigation: NOT a git revert; all terrain/scatter code was present and tree counts had even gone *up*. The real cause was a *feel* regression from two later commits. `fa16a15` ("solid ground, no fly-through") added the outer `Math.min(0, cont + detail)` clamp — correct and load-bearing (mesh == floor, floor ≤ baseline), but it turned the base radius into a hard CEILING, flattening the symmetric detail noise that used to read as rolling relief into a dead-flat plateau. `57a2f15` ("cliff-face shaping") then steepened the remaining carves via `tanh` (FACE_STEEPNESS 2.7) into sharp, isolated mesas, so the world read as a flat plain with rare pits, and — because most of the surface now sat at the flat plateau (`depth ≈ 0`) — the scatter's elevation zoning dwarfed/thinned trees almost everywhere (lush full-size trees survived only in the rare deep canyons). **Fix (keeps the ≤0 floor invariant, no fly-through/ratchet regression):** since we *cannot* raise terrain above baseline, rolling is faked by carving DOWN across most of the surface — new `CONTINENT_BIAS` (0.35) shifts the continental field negative so the average ground sinks into rolling lowlands and only the highest peaks reach the baseline ceiling; this also re-exposes the detail roughness (only visible where carved below baseline) across the whole map. `FACE_STEEPNESS` softened 2.7 → 1.4 (rolling faces, not cliffs), carve clamped to `[-1,0]` so the bias overshoot can't exceed amplitude. Scatter tree-lines widened to span the deeper range (forest exposure /12 → /24, thin >0.75 → >0.82; pine /16 → /30, thin >0.7 → >0.78) so trees stay lush across the rolling terrain and only true ridge crests thin. **Do NOT "fix" `CONTINENT_BIAS` away** thinking it's a bug — it's the deliberate trade that restores the rolling look within the gravity-less-floor constraint.

### Birb Gauntlet — unlisted sibling at `/gauntlet` (2026-08-01)

**Birb Gauntlet** is a stylised arcade bird-*racing* game living in this
repo at `gauntlet/`, deployed with the main site to **birbmobile.vercel.app/gauntlet**.
It is unlisted: `noindex`, linked from nowhere. Four birds, three laps, one
glowing ribbon circling a miniature planet.

**Full Birb Mobile port shipped (2026-08-01).** Five modes now, all built from
one world and one bird: Casual (the default — free flight with ambient drones
AND nesting, and it cannot fail), Gauntlet Race, Ring Rush, Drone Hunter and
Turret Defense. The spine is `gauntlet/src/game/modes.js` — a **capability-flag
descriptor table** (`course/laps/rivals/drones/nesting/rings/timed/canFail/
gentle/scoreKind`). Nothing in the loop branches on a mode ID; a new mode is a
table entry, not a sweep through `index.html`. Things worth knowing before you
change any of it:

- **Ring Rush's win condition reads the spawner**, never a constant.
  `run.ringsTotal = rings.count`. Birb Mobile shipped 18 rings checked against
  a hardcoded 10 and the mode could not be completed.
- **A time is only a record if the run completed** (`completed` guard in
  `finishRun`). Lower-is-better plus an early exit is a two-second best that
  nothing can ever beat.
- **Turret Defense's wave one waits for the player to be on the gun**, and
  `WAVE_SPEED_MUL` is solved for, not chosen: at the ported 1.25 a wave crossed
  its stand-off in 3.2s against a 2.0s rocket cooldown, so the first capture of
  the mode lost all three lives without a shot fired. 0.45 + a 1.15 rad
  stand-off gives ~15s and seven or eight shots.
- **Drone Hunter's ram only counts above `HUNT_STRIKE_SPEED01` (0.5).** Hunt
  drones close on you, so without the gate a player who never touches the stick
  scores — measured: 3 kills / 450 points in 8 seconds of doing nothing.
- **The turret reuses the boost pill as FIRE** and the stick as aim, so the
  player keeps the button they already dragged to their thumb. The aim rig
  needs `driveCamera: true` or `viewQuaternion` is never written and the FPV
  camera stares at the terrain.
- `nesting.update()` runs BEFORE `flight.tick()` and `drivesFlight` gates it —
  two systems writing one position is a bird that vibrates between the nest and
  the sky.

`window.__GAUNTLET_STATS()` now returns run state alongside the frame stats, so
a harness capture is evidence of what the MODE did, not just what rendered.

It is deliberately **airtight against Birb Mobile**: nothing in `gauntlet/` imports
from the parent `src/`, nothing outside imports from inside it, and `sw.js` now
explicitly bypasses `/gauntlet`. That last one is a correctness fix, not tidiness —
the SW's `networkFirst` caches every navigation response under the key
`./index.html`, so a single visit to `/gauntlet` would have overwritten Birb
Mobile's offline shell and booted the wrong game on the next offline launch.

Own stack, own rules: vanilla ES modules + pinned CDN Three, **zero external
assets** (every mesh, texture, sound and even the splash art is generated in
code), own virtual joystick (no nipplejs), seeded RNG throughout. Read
`gauntlet/ARCHITECTURE.md` before touching it.

Two constraints worth knowing:
- **Terrain carves downward only** (`gauntlet/src/core/terrain.js` guarantees
  `surfaceHeight <= continentalHeight <= 0`). Same gravity-less-floor problem
  Birb Mobile hit: a floor that could rise above baseline ratchets a cruising
  bird upward forever. Height above baseline is expressed with collider-free
  instanced props.
- **Stepped lighting amplifies high-frequency normals.** The ridge function is
  squared to kill a normal crease that threw white band-noise shards across
  the terrain, and the light rig uses an **AmbientLight, not a
  HemisphereLight** — MeshToonMaterial quantises only the direct term, so a
  normal-varying fill paints a smooth gradient straight over the hard bands and
  the whole cel look silently dies.

**Three-finger QR (2026-08-02).** Birb Labs demo convention: three fingers
held and released pops a QR of the production URL so a bystander can scan it
off your phone (`Q` on desktop). Three is the first touch count the game itself
can never produce — one is the stick, two is stick+boost. The QR is generated
in code (`gauntlet/src/ui/qr.js`, byte mode / ECC M / versions 1-10) because the
artefact ships zero external assets and this has to work offline. That encoder
was verified module-for-module against the `qrcode` npm package during
development, which caught two bugs that produce a symbol that LOOKS right and
does not scan: the two format-info copies were transposed, and version >= 7
reserved the version-info blocks without ever writing them. Both are pinned by
tests. The URL is PINNED to production, not `location.href` — a localhost or
preview URL is useless to the person scanning it.

Verify visual work with `node tools/gauntlet-shot.mjs` — it exits non-zero on any
page or console error, so a captured PNG proves the code ran. Isolation probes
live in `gauntlet/dev/`. Note: the harness needs
`npm install --no-save playwright three-real@npm:three@0.183.2` followed by
`git checkout -- node_modules/three/index.js`, because any npm install prunes
the hand-written Three test stub this repo tracks there and silently breaks
`npm test`.

### Bronze — unlisted sibling at `/sculpture` (2026-08-02)

A **3D study of the bronze group outside The Women's** (Royal Women's Hospital,
Parkville), living at `sculpture/` and deployed to
**birbmobile.vercel.app/sculpture**. Unlisted: `noindex`, linked from nowhere.
Drag to orbit, pinch to zoom, two fingers to pan, double-tap to reset.
Three-finger QR as usual.

> **Read `sculpture/ARCHITECTURE.md` before touching any of it**, and
> `sculpture/LIKENESS.md` for where it currently stands. Between them they carry
> the module map, the build pipeline, the invariants that must not be undone,
> the verification protocol, the current score and the phased plan to finish.
> The summary below is the short version.
>
> **For `/img2threejsMAX` work, read the repository-shared skill at
> `.claude/skills/img2threejs-max/SKILL.md`.** Its scripts, contracts and
> reference guidance are part of the workflow. The zero-production-asset rule
> below is immutable; reference imagery is evidence, never a runtime dependency.
>
> **Staleness warning:** parts of this section's narrative predate the
> 2026-08-04 six-relief reconstruction and still describe four freestanding
> figures on a crowded diagonal. Where they disagree,
> `sculpture/ARCHITECTURE.md` and `sculpture/validation/phase-5-closeout.md`
> are authoritative: the object is ONE folded casting of six alternating
> positive/negative reliefs.

Own stack, same house rules as Gauntlet: pinned CDN Three, vanilla ES modules,
no build step, **zero production assets** — the running sculpture imports no
images, meshes, fonts or textures and is generated in code. The committed
reference and validation images are evidence only and are never imported by the
page. That is not purism: every proportion is a NUMBER in a table
(`SHELL_PROFILE`, `TORSO_PROFILE`, `FRONT_OPENING`) that can be tuned against a
photograph, which is the whole workflow for getting a likeness.

**The reference photos were upside down**, and that mattered more than it
sounds. All four arrive with EXIF orientation 3; `ImageOps.exif_transpose`
alone is the correct fix, and an extra flip double-corrects and mirrors the
signage — which is how you can tell you have got it wrong. The first plan for
this scene was written against the un-rotated images and described a completely
different sculpture (hooded figures with flared cloaks). Upright crops live in
`sculpture/reference/` and every modelling decision is made against those.

Two structural lessons already paid for, do not undo them:

- **The robe and the hood are ONE swept shell**, not a body with a cowl around
  it. Modelled as two pieces, the cowl's radius sits barely outside the body's,
  so a front-on camera sees only its two vertical edges and the figures read as
  people standing between a pair of rails.
- **The cloak opens at the HIP, not the shoulder.** The torso inside is bare and
  fully modelled. Closing the robe at chest height turns four women into four
  bottles.

**Reference set (2026-08-02).** Mentis's four photos in `sculpture/reference/`
plus seven Google Maps community photos used TRANSIENTLY for measurement and
deliberately NOT committed — they are other people's copyrighted images, and
only the landmarks extracted from them feed the model. Those seven changed the
structure materially and the findings are recorded here so they survive:

- The work is **Michael Meszaros, 2008**, commissioned via the Harold Mitchell
  Foundation for the hospital's opening. Maps lists it as "Women's Sculpture".
- **The hood is a hollow open plate**, not a tube. It rises behind the head with
  a visible rim and a dark interior you can see into from three-quarter angles.
- **The figures are flat slabs.** Depth is about half the width; the cloak is a
  PANEL.
- **The cloak stands BEHIND the woman and the whole front is open.** This is the
  single most expensive thing that was got wrong. `ref-c-under.jpg` silhouettes
  the group against sky and settles it: the cloak covers her back, curls a little
  round her sides, rises into a hollow collar-arch behind her head, and that is
  all it does. Her face, throat, shoulders, breasts and belly are in open air in
  front of it. So the opening runs to about **1.5 rad EACH SIDE at chest height**
  — roughly 170° of the circle simply is not there — and the cloak's axis sits
  ~0.15m behind the spine up top, closing to the body's axis only at the hem.
  Modelled with a 0.55 rad opening and a shared axis, the shell is a near-complete
  tube with a slot in it: the body was fully and correctly modelled the whole
  time and **not one square millimetre of it was visible**. The group rendered as
  four ghosts for four passes.
- **The group is a crowded diagonal**, not a zigzag: nearest figure front-left,
  each of the other three further back and further right, all facing roughly the
  same way and turning a little more to the right as they go back. The earlier
  "folded screen" reading makes a decorative arrangement of panels; the
  photographs read as four women standing close.
- **Every figure carries a story** and this is the subject of the sculpture, not
  decoration: one is heavily pregnant, one cradles a swaddled newborn with both
  forearms under it, one is the clinician with a stethoscope round her neck.
  Modelling four identical women loses the point of the piece. Note that
  *building* them is not the same as their *reading*: the first versions were
  all present in the field and measurably in the mesh, and none of them was
  findable in a render. The bundle sat at the womb, was round, and blended at
  k = 0.032, so it was indistinguishable from the pregnant figure's belly; it
  reads only once it moves up to the forearms, goes oblong across the body, and
  keeps a hard seam (k = 0.016) — a crease is wrong for anatomy and right for an
  object being held. The stethoscope's bell stood 19mm off the chest, which is a
  bump you cannot find; cast bronze tubing is fat and hangs in front of her.
- **The heads are intentionally non-uniform.** The nearest figure is a bare,
  plain rounded block. The rear-facing figure has a complete face on the
  opposite side and turns as one body/cowl/head unit. Two figures carry a
  coiled top-knot. Do not restore one identical cap to all four - that was a
  major reason the heads once read as interchangeable.
- The faces are planar with a **long nose ridge running from the brow**, hollow
  triangular eye sockets and a wide flat mouth.

**The likeness gate has two halves and neither is sufficient alone.**

`node tools/sculpture-proportions.mjs` is the measurable half — landmark heights
and spans as fractions of the figure's crown-to-ground height. Pixel IoU against
the photos was tried and abandoned on evidence: luminance thresholding, centre
flood fill and a blue-vs-neutral colour test each leaked into the winter trees or
dropped the sunlit robe, because the bronze is dark against dark trees, dark
mullions and its own shadow. A landmark is locatable in a cluttered photo where
an outline is not. `sculpture/LIKENESS.md` is the other half: 41 binary checks
each citing the photograph that settles it, scored by eye. 90% is 37 of 41.

**`node tools/sculpture-sheet.mjs` is how you score it** — it renders every
matched camera pose in ONE browser boot and composites each render beside the
reference photograph it was matched to. Building it should have been the first
thing done on this model, not the seventh: ninety renders had been judged by
comparing the model against a *memory* of the photo, and the first side-by-side
pair exposed a hem 40% too wide inside a minute. Poses live in
`tools/sculpture-views.mjs` and use the CROP's field of view, not the photo's.

**When the gate and the eye disagree, re-measure.** This has now happened twice
and the tell was identical both times — green gate, worse render. First, the
table was read off ref-c where the nearest figure is turned away, so the mass at
the top is her hood but the face below belongs to a figure further back; the
model was solved to match it exactly and got visibly worse. Second, the table
normalised by the top of the COWL, which varies per figure by design, so it
measured different figures against different rulers — and `headHeight` came out
wrong by 45%. **Normalise by the crown**: it is the one landmark every figure has
and every photograph shows. Re-measured on two figures independently, the head is
0.175 of the figure and the model had been building it at 0.130.

Verify with `node tools/sculpture-shot.mjs` for a single angle (same harness
contract as Gauntlet: non-zero exit on any page or console error).
`sculpture/dev/probe-parts.html` renders any subset of a single figure
(`?only=body,head,feet`) — **rendering the body without the cloak in front of it
is the only way to tell "the torso is wrong" from "the torso is hidden"**, and
this model was debugged the wrong way round for several passes before that probe
existed. When something looks like a lighting bug, turn one thing off or swap the
material rather than tuning: `MeshNormalMaterial` found a clipped neck in one
render after three passes of chasing it as light.

### Three things that look like lighting problems and are not

Each of these cost a round of material tuning before being identified, and each
was found by an A/B that turned one thing off rather than by adjusting numbers.

1. **`material.shadowSide` must be `FrontSide`.** Three defaults a FrontSide
   material's shadow pass to `BackSide`, which is correct for watertight solids
   and wrong here: a figure is a merge of an open-topped cloak sheet, a
   surface-nets body, a head and two feet, so the "far side" the depth pass
   writes is not a valid occluder for its own front. Every figure shadowed its
   own chest and the whole group above waist height rendered in ambient only.
   Toggling `castShadow` off on the figures is what proved it was the depth pass.
2. **The patina's occlusion term must use a FIXED radius, not the geometry's own
   extent.** Normalising by max radius was fine until the cloaks grew trains: one
   vertex a metre out rescaled everything, every point on the torso landed near
   r = 0, and the bodies were flooded with crevice black. The figures went flat
   in the same commit the trains appeared, which is the tell.
3. **Light intensity and albedo are one knob, turned opposite ways.** Three's
   lights are plain irradiance multipliers, so a 0.17 bronze under a 3.0 sun
   tone-maps to a 0.7 grey and the group renders as plaster no matter how dark
   the vertex colours get. Dark patina *and* low intensities (sun ~1.7, hemi
   ~0.6) is the pair that lands on bronze.

Also, on blending: **the blend radius must be well under the protrusion.** It is
the one rule of modelling with `smin`, it is broken by default, and it is broken
silently — a bust standing 0.02 proud of the chest wall blended at k = 0.10 is
not a soft bust, it is no bust at all. The first SDF pass lost the bust, the
belly, the swaddled bundle, the brow, the nose and the lips to exactly this.

And one more of the same family: **every `surfaceNets` sampling box must clear
its contents' caps.** The mesher leaves a torn open rim wherever the box cuts
through geometry. The body box topped out at y = 2.13 while the neck capsule's
cap reaches 2.167, and the resulting slab read as a dark trapezoidal visor across
every face — hunted as a lighting bug, then a shadow bug, then a facial-geometry
bug, before one normal-material render found it.

### State, and how to pick it up (2026-08-03)

**Phase 4 has passed its second visual-acceptance correction at 35 of 41; the
proportion gate is green at 0 of 12.** The current nine-view evidence is
sculpture/validation/phase-4-detail-correction.png and the complete record is
sculpture/validation/phase-4-closeout.md. The earlier Phase 4 sheets remain
provenance, not current sign-off. Later close-ups proved that a green numeric
gate is necessary and not sufficient: it has been green and visually wrong more
than once. The revised gated plan is at the end of
sculpture/ARCHITECTURE.md.

**Phase 1 (mass) is done.** Every span was ~20% too narrow, the head ~35% too
small, the bust too high, and the hem read 0.56 of figure height against the
photograph's 0.39 — that last one entirely because the train scaled the ring's
RADIUS and so pushed the hem sideways as well as backward, while the base profile
measured correct to within 0.007. It is a displacement now.

**Phase 2 (cast section and the stride) is done.** The dark V up the front of
every figure was structural, not cosmetic: the cloak closed into a tube below the
hip, and a cloak that closes has to close somewhere. It never closes in the
photographs — she wears a long skirt, and the cloak is a panel hanging behind it
— so the skirt is now part of the body field, running to the paving, and the
opening holds its full height. Every free edge carries a rounded bead built into
one closed cross-section; hems rake clear of a leading foot; each column shears
forward of vertical; no two figures agree on stride, rake, lean or head angle.
The original feet were too small, while the first corrections then read as
detached pebbles or long paddles. The current planted foot is a narrower
root/instep/forefoot/toe form unioned directly into the robe field; no separate
shoe or exposed leg is rendered.

**Phase 3 (the heads) is done, and cost more than the other two together.** The
head is a rounded BLOCK — flat front, flat sides, domed top — not an ovoid; built
as an egg a face has nowhere flat to sit and every feature slides off. The
nearest head is bare/plain. The rear-facing figure has a complete face on
the opposite side and rotates as one body/cowl/head unit instead of twisting at
the neck. Two figures carry coiled top-knots. The lesson worth keeping is that
**thin features do not survive
surface nets, and it fails silently**: the mesher averages one vertex per cell,
so a form three or four cells thick vanishes — while the field measures correct
AND a max-z sweep of the mesh still finds the stray slivers, so every number
agrees the brow is there and no render shows it. A `MeshNormalMaterial` pass is
what settles it. Four other hypotheses were tested and discarded first; two of
them were real bugs worth fixing and neither was the cause.

**Phase 4A (arms and negative space) is done, including the reopened detail
correction.** The four figures use distinct reference-led arm paths. The carried
infant is a separate fine closed swaddle on a curved support; the clinician's
instrument is two separate curved tubes with ringed terminals. A7 and F4 pass.

**Phase 4B (surface and bronze) is done.** Stronger existing displacement,
two-scale vertical runoff, warmer bronze values and a colder environment make
the hand-worked casting legible at group distance. `G2`, `G3` and `G5` pass.

**Performance remains a final ship gate.** The corrected scene is 514,780
triangles, 6 draw calls and 4 figures. The nine-view local Chromium matrix
reported roughly 44-60 FPS under SwiftShader with no page or console errors,
but that software-rendered result is not a real-iPhone result and is not a
reason to rewrite the geometry blindly. An iPhone 12-or-newer load and orbit test
is still outstanding; if the real device also struggles, test a lower mobile
renderer-DPR cap before changing mesh resolution.

### Birb AR — unlisted sibling at `/ar` (2026-08-07)

**Birb AR** is a "magic window" AR prototype: point your phone at the room, a
Birb Mobile screen appears floating in it, you drag/pinch it into place, tap
**GO!**, and Gauntlet's free-flight game plays on that screen while the
thumbstick and BOOST pill sit on the phone glass over the camera feed.

`/ar` is a **redirect** (`vercel.json`) to the pre-existing capital-`AR/`
directory, which is now a hub linking Birb AR, the original 2025 **AR Shooter**
(preserved untouched at `/AR/game.html`) and its camera/gyro/3D test pages.
**Never create a lowercase `ar/` directory** — it collides with `AR/` on
case-insensitive filesystems and breaks checkout on macOS and Windows.

The app itself lives at `gauntlet/ar/` and is routed to from the hub. It is
inside `gauntlet/` deliberately: it imports planet, sky, bird, flight, chase
camera, feathers and the joystick from `/gauntlet/src/`, and ARCHITECTURE.md
rule 1 forbids anything OUTSIDE `gauntlet/` importing from inside it. Putting
the page in there keeps the invariant instead of relaxing it.

Things that cost a debugging round and must not be undone:

- **`/AR` and `/ar` are in `sw.js`'s `SIBLING_ARTEFACTS` bypass.** They were not,
  and that was a live bug: `networkFirst()` writes EVERY navigation response to
  the cache key `./index.html`, so visiting `/AR/game.html` overwrote Birb
  Mobile's offline shell with the shooter — and a flaky load of `/AR/*` served
  Birb Mobile's HTML at the `/AR/` URL, where its relative `./src/` imports all
  404 and the page renders blank. Both directions read as "it doesn't load".
- **The screen spawns where the phone is ALREADY pointing, on the first frame
  that has a real gyro reading.** Azimuth 0 is a fixed world direction and the
  device's heading at launch is arbitrary, so a fixed spawn puts the screen
  anywhere in the room — including behind you. Computing it in `startAR()` does
  not work either: that runs before the first rAF and before the first
  `deviceorientation` event, so the quaternion is still identity. It is deferred
  via `pendingFace`.
- **The screen is PORTRAIT (9:16), and so is the render target.** It shipped
  16:10 landscape first and that was wrong three ways. The AR illusion needs the
  room visible AROUND the screen, so it can only occupy ~62% of the view — on a
  portrait phone that is 242 CSS px of width, and a 16:10 plane inside it is
  151px tall, a postage stamp you cannot fly on. Portrait buys ~430px of height
  from the same width, near 3x the area. It also frees the bottom third of the
  phone for the stick and boost pill, which in landscape had nowhere to sit but
  on top of the game. And Gauntlet is itself composed for portrait (its captures
  are 390x844), so a landscape render target was off-design as well.
- **Default distance is solved from the field of view, not hardcoded, on BOTH
  axes.** The same screen subtends very different angles portrait vs landscape.
  Fitting width alone was right only while the screen was landscape; a portrait
  screen on a portrait phone is height-constrained, and a width-only fit put its
  top and bottom off the ends of the view. `framingDistance()` solves both and
  takes the further.
- **The bezel is two textures, swapped — not one texture tinted.** The corner
  ticks are painted cyan into the bitmap, so the old "not placing" state (tint
  the material white) left them at full strength and the placement affordance
  was on permanently, including mid-flight.
- **`renderer.info.render` resets on every `render()` call.** The AR page renders
  twice — game into a `WebGLRenderTarget`, then the composite over the camera
  feed — so reading it after the composite reports 3 draw calls for a frame that
  really costs 23. `gameView.frameStats` is captured between the passes.
- **The render target's texture needs `SRGBColorSpace`** or the game renders
  visibly darker through the screen than it does at `/gauntlet`.
- **Each pass sets its own clear colour.** The composite clears transparent so
  the camera shows through; the game pass must clear opaque sky or the room
  shows through its own horizon seam.

**Birb AR Shooter** (`/gauntlet/ar/shooter/`) is the second app on the hub: drones
close in on your room from every bearing, you aim by moving the phone and tap to
launch rockets. It reuses `ar-camera.js` / `ar-gyro.js` and adds `drones.js`
(room-space swarm, 2 InstancedMeshes), `weapons.js` (rockets + explosion
particles, 2 more) and a fully synthesised `audio.js`. Four draw calls total.
Its own hard-won details:

- **Gauntlet's `nesting/drones.js` is NOT reusable here** and trying is a trap:
  those drones orbit a planet, take up from `normalize(pos)` and are placed
  against nests and terrain. Here the world is a living room and the player is
  a fixed point. Same silhouette, new module.
- **Rockets home, gently (7.6° cone, capped turn rate), on purpose.** You are
  aiming by waving a phone at a weaving target with no stick and no mouse. Pure
  ballistics tested as frustrating rather than skilful — every near miss read as
  the game's fault. It shipped at 15.2° and that was too generous (playtest:
  "the homing helps too much"), so it was halved. Note the two scales when
  tuning it: halving the cone halves the AIM ACCURACY demanded of the player,
  but quarters the hit rate of an unaimed shot, because solid angle goes as the
  square. The blind-fire harness score fell 4x for a 2x change.
- **The reticle's lock light reads `WEAPON_TUNING.homingCone`, never a
  literal.** It promises "a rocket fired now will steer onto that drone", so a
  hardcoded threshold silently becomes a lie the moment the cone is retuned —
  as it did, going gold ~2° wider than the homing would actually assist.
- **Wave 1 spawns within ±0.55 rad of where you are already looking**, widening
  ~0.6 rad per wave. At the first value (±0.95) most of wave one spawned outside
  a portrait phone's ~31° horizontal FOV, so the game opened on an empty wall
  and read as broken. The off-screen gold arrow that points at the nearest drone
  exists for the same reason and is not optional in a 360° shooter.
- **`SVGElement` has no `hidden` IDL property** — it does not inherit from
  `HTMLElement`. `svg.hidden = false` sets a stray JS property, leaves the
  attribute (and `display:none`) alone, and the reticle never appears. It is
  wrapped in a div.
- Verify play, not just paint: `node tools/ar-shot.mjs --page
  gauntlet/ar/shooter/index.html --fire 14` taps the trigger for 14s and reports
  the score, which is the only way to prove rocket → hit → kill → score works.

**Platform ceiling, not a TODO:** iOS Safari still exposes no WebXR `immersive-ar`
and no ARKit, so tracking is **rotation-only** — the screen holds its direction
as you look around but does not respond to you walking. Android Chrome does have
`immersive-ar` + hit-test, and an ARKit-backed web shell (App Clip style) would
convert this exact codebase to true 6-DoF anchoring. See `docs/AR-SPEC.md` §7 for
the native-port ladder.

Verify with `node tools/ar-shot.mjs [--go]`. It fakes a camera
(`--use-fake-device-for-media-stream`), grants the permission, synthesises
`deviceorientation`, clicks through the gate, and asserts on `window.__AR_STATS`
— a zero exit means the gyro produced a reading, the stream went live and
something actually rendered, not just that a PNG appeared.

### Baby Blender — the iPad app, not a web artefact (2026-09-05)

**Baby Blender** is the one thing in this repo that is not a web page. It is a
native iPadOS app: sculpt and paint a protected fixed-topology model with the
Pencil, then export something a game engine can open. It lives in
`humanoid/` (Swift package, builds and tests on Linux) and `humanoid/app`
(XcodeGen spec for the iPad shell).

**Read `docs/PRD-humanoid-creator-v0.1.md` before touching any of it**, and
`docs/humanoid-creator-validation/REPORT.md` for the research the plan rests on.
Both keep their old filenames; the product was named Baby Blender on 2026-09-05.

Two document types, one engine:

- **Clay** — a pre-subdivided rounded cube, no rig, exports a static mesh.
  **Ships first.**
- **Humanoid** — 51 bones, T-posed, exports an avatar Unity maps as a Humanoid
  for the normal VRChat flow.

Things that will cost a round if you undo them:

- **Topology is immutable.** No remeshing, no subdivide, no vertex is ever
  created or destroyed. That is what lets every adjacency, symmetry-pair and
  seam-partner table be generated offline and the runtime use flat arrays
  instead of a half-edge mesh. Clay being *pre*-subdivided is the whole trick;
  a literal 8-vertex cube would be unsculptable.
- **`rig` is optional, not empty.** A zero-bone skeleton for Clay would put
  `if boneCount > 0` through the skinning, export and validation paths, and
  every one of those is a silent failure waiting to happen.
- **`build_template.py`'s T-pose report is tautological** — it measures
  head-to-tail of bones it just aimed, so it reads 0.00 degrees whatever the
  body did. `tools/check_template.py` is the real oracle: it shares no code with
  the baker, re-derives from the written bytes, and measures head to CHILD head,
  which is what Unity's `AvatarAutoMapper` actually scores. It found four
  defects the report structurally could not see.
- **Keep all eight stages of `tools/verify.sh` green while Clay is built.** The
  humanoid work is finished and unattended, which is exactly how code rots.

**Engine state (2026-09-06):** sculpt, paint, picking, tables and the document
with undo are all built and tested headless — 133 tests, eight verify stages.
Three things in there are non-obvious and were each found by a failing test:
brushes address WELDED positions (a UV seam stores one point two or three times,
and moving one copy tears the surface); a paint stroke carries its leftover
distance ACROSS segments (resampling each segment alone double-stamps the joins,
so a stroke delivered as 50 events came out 10x darker than the same path as 2);
and `MeshTables` keys its weld map on the quantised coordinate TRIPLE, never a
hash of it (a hash welded 3,750 vertices down to 2,024, fusing unrelated parts
of the surface).

Unity/VRChat state: the FBX imports and Unity builds a Humanoid Avatar from it
on the first attempt. Unity's auto-mapper leaves **Chest unmapped**, which Unity
tolerates and VRChat's `AnalyzeIK` does not — assign it by hand for now. Mirror
handedness and the SDK panel are still unverified.

## What This Is

A mobile-first 3D bird flight game built with Three.js. A bird flies on a spherical world — you control it with touch (virtual joystick), collect rings, shoot rockets from nests, and fight drones. Four game modes: Casual free flight, Ring Rush (timed collection), Drone Hunter (60s survival), Turret Defense (wave-based).

**Target platform:** iOS Safari (iPhone 12+), Android Chrome, desktop for testing.
**Deploy:** Vercel static hosting. Push to main → auto-deploys.

## Who Made This

**Mentis** (Adam Rappaport) — call him Mentis, not Adam.

## Default Interaction Mode

**Assume the user is a Vibe Academy student** unless they indicate otherwise. This means:

- **Teach, don't just do.** Walk through changes step by step. Explain *why*, not just *what*.
- **Ask what they want to learn.** Before diving into code, understand their experience level and what they're trying to get out of this.
- **Point them to the right starting place.** Use the "Notes for Vibe Academy" section below to suggest tasks matched to their level.
- **Let them drive.** Offer options rather than making choices for them. The goal is learning, not shipping.
- **Keep it fun.** This is a game. The vibe should be playful and encouraging.

**To exit student mode:** If the user says "admin", "Mentis", or otherwise implies they're the project owner, switch to direct execution mode — just make the changes, skip the teaching, and focus on shipping.

## House Rules

1. **Never test locally unless you must** — push to git, Vercel auto-deploys at birbmobile.vercel.app
2. **Git remote uses SSH** — `git@github.com:Mentis123/birb.git`
3. **Mobile-first always** — touch devices are primary, desktop is for testing only
4. **Zero-allocation game loop** — reuse objects with `_` prefix, never allocate in update()
5. **No build step** — this is vanilla JS with ES6 imports from CDN. No webpack, no bundler.
6. **Preserve the fun** — this is a game. Changes should make it more delightful, not more complex.

## Product Intent

Birb Mobile should feel **playful, responsive, and alive**. The bird should feel good to fly. The turret should feel heavy and satisfying. The rings should feel rewarding to collect. Performance must hold 60fps on mid-range mobile.

**Non-goals:** Realistic flight simulation, desktop-first design, unnecessary abstractions that make learning harder, framework dependencies.

## Architecture Overview

**Stack:** Three.js (WebGL), vanilla JavaScript (ES6 modules), HTML5 Audio, nipplejs (virtual joystick). No frameworks, no build tools.

**Entry point:** `index.html` — single-file game (~5600 lines). Imports modular systems from `src/`.

```
index.html (main game loop, scene setup, state coordination)
├── src/flight/          Flight physics, bird visuals, touch input
├── src/controls/        Input aggregation, joystick, thumbstick UI
├── src/camera/          Follow cam, FPV cam, mode switching
├── src/nesting/         Nest landing, turret aiming, rockets, drones
├── src/environment/     Spherical world, sky dome, collectibles, trails
├── src/effects/         Particles, screen shake
├── sound/               Audio assets (mp3)
├── basic/               Minimal reference implementation
├── AR/                  Experimental AR branch (not integrated)
└── docs/                Technical documentation
```

**Data flow:**
```
Touch Input → flight-controls.js → bird-flight.js → Three.js Render
                                        ↓
                                 position + quaternion
                                        ↓
                              camera, collectibles, drones
```

**Key CDN imports:**
- `three@0.183.2` from esm.sh
- `nipplejs@0.10.1` from esm.sh
- GLTFLoader from Three.js examples

## Key Files

| File | What It Does |
|------|-------------|
| `index.html` | Main game — scene, loop, UI, audio, all systems coordinated |
| `src/flight/bird-flight.js` | Current flight controller (vector-based) |
| `src/controls/simple-flight-controller.js` | Legacy flight controller (kept as reference, unwired) |
| `src/flight/touch-input.js` | **Live** touch input path (raw clamp → `bird-flight.js`) |
| `src/flight/flight-recovery.js` | FLYING/FALLING/GROUNDED state machine core — states enum, config, fall-ramp/launch-boost timer math + `createFlightRecovery()` factory (side effects injected as callbacks; no THREE/DOM; unit-tested) |
| `src/game/game-modes.js` | Game-mode core — `GAME_MODES` enum, mini-game state shape/reset, win/lose conditions (Ring Rush rings, Drone Hunter 60s, Turret lives + 2+wave curve), combo/scoring + best-score math (no THREE/DOM; unit-tested) |
| `src/controls/flight-controls.js` | Input shaping (deadzone/expo/smoothing) — wired but its shaping methods are no-ops on `BirdFlight`; see CODEBASE_EVALUATION.md |
| `src/camera/follow-camera.js` | Third-person chase camera with damping |
| `src/nesting/nesting-system.js` | Nest landing/takeoff state machine |
| `src/nesting/aim-rig.js` | Turret aiming with spring-damper inertia |
| `src/nesting/rocket.js` | Projectile system with arc trajectory |
| `src/nesting/drone-system.js` | Enemy drone spawning and AI |
| `src/environment/spherical-world.js` | Sphere + collision system |
| `src/environment/collectibles.js` | Ring collection with proximity detection |
| `src/environment/collider-grid.js` | Spatial-hash collision broad-phase (unit-tested) |
| `src/ui/minimap.js` | Minimap radar (extracted from index.html; pure helpers unit-tested) |
| `CODEBASE_EVALUATION.md` | Four-domain evaluation: scorecard, findings, prioritized roadmap |
| `gauntlet/ARCHITECTURE.md` | Birb Gauntlet (`/gauntlet`) — read before touching it |
| `sculpture/ARCHITECTURE.md` | Bronze (`/sculpture`) — module map, invariants, verification, plan |
| `sculpture/LIKENESS.md` | Bronze — the 41-check rubric and the current score |
| `KNOWN_ISSUES.md` | Bug tracker with detailed fix attempts |
| `FLIGHT_CONTROLS_PLAN.md` | 4-phase flight system redesign plan |
| `TURRET_RESEARCH.md` | Gun feel research, spring-damper physics |
| `docs/PRD-game-modes.md` | Game mode specifications |
| `basic/index.html` | Minimal reference implementation (single-file) |

## Flight Direction — ✅ RESOLVED

The spherical flight direction bug — where the bird flew in a fixed world direction regardless of facing — was the longest-running issue in this project (Dec 2025 – Jan 2026). It is now **fixed and working in production.**

The active controller (`src/flight/bird-flight.js`) uses vector-based forward direction tracking with parallel transport and sphere re-projection. The legacy `src/controls/simple-flight-controller.js` is kept as reference only.

See `KNOWN_ISSUES.md` Issue 5 for the investigation history.

## Key Technical Patterns

**Zero-allocation game loop:** All vectors and quaternions pre-allocated in constructors with `_` prefix. No `new Vector3()` in update(). Target: <1ms GC per frame on mobile.

**iOS audio:** Web Audio API doesn't work on iOS Safari. Use HTML Audio elements with a `Set` reference pool to prevent garbage collection clipping sounds.

**Control feel tuning:**
```
Forward speed: 3.5-7 m/s    Yaw rate: 135°/sec
Pitch rate: 108°/sec         Max bank: 65°
Joystick deadzone: 0.15      Expo curve: 0.32
Input smoothing: 0.3
```

**Turret feel:** Spring-damper system (C0=8.0 stiffness, C1=6.0 damping). Heavy, inertial, momentum carry-through on release. See `TURRET_RESEARCH.md`.

**Performance budget:** 60fps, <100 draw calls, <80k triangles, <50MB heap, <16ms frame time.

**Mobile rendering:** DPR capped at 1.4 (mobile) / 1.8 (desktop). Adaptive quality via performance manager.

## Environment Variables

None — this is a static site with no backend.

## How to Run

```bash
# Local (for testing only — prefer pushing to Vercel)
python3 -m http.server 8000
# Open http://localhost:8000 on mobile or desktop
```

For mobile testing: use Edge DevTools device emulation, or access via local network IP on phone.

## Safe Change Zones

**Safe to edit:**
- Copy/text in UI overlays (in `index.html` HTML section)
- Visual styling (CSS in `index.html`)
- Tuning constants (speeds, rates, deadzones in controllers)
- Sound effects (swap mp3 files in `sound/`)
- Particle effects and visual juice
- Game mode balancing (scoring, timers, spawn rates)

**Edit carefully:**
- `src/flight/` — flight physics affect everything
- `src/nesting/nesting-system.js` — state machine is delicate
- `src/controls/flight-controls.js` — input pipeline affects feel
- Camera systems — bad changes cause motion sickness

**Never touch without explicit permission:**
- Three.js import URLs (version pinned for stability)
- Performance manager thresholds (tuned for mobile)
- The `_` prefixed pre-allocated objects (zero-allocation pattern)

## Common Tasks

| Task | Where to Look |
|------|--------------|
| Tweak flight feel | `src/flight/bird-flight.js` — speed, rates, damping |
| Adjust turret feel | `src/nesting/aim-rig.js` — spring-damper constants |
| Add a sound effect | `sound/` folder + audio system in `index.html` (~line 1198) |
| Change game mode balancing | `index.html` game mode sections + `docs/PRD-game-modes.md` |
| Improve mobile controls | `src/flight/touch-input.js` (live path) + `src/flight/bird-flight.js` — the shaping in `src/controls/flight-controls.js` is currently inert |
| Add visual effect | `src/effects/particles.js` or `src/effects/screen-shake.js` |
| Fix a camera issue | `src/camera/follow-camera.js` or `fpv-camera.js` |
| Performance optimization | Adaptive quality is inline in `index.html` (search `__birbPerfDebug`); collision broad-phase in `src/environment/collider-grid.js` |

## Code Conventions

- **Three.js quaternion:** `premultiply` = apply first, `multiply` = apply after
- **Euler order:** `'YXZ'` (yaw around Y, then pitch around X)
- **Object reuse:** `_` prefix for pre-allocated scratch objects (e.g., `_tempVec`, `_tempQuat`)
- **No `new` in update loops** — ever
- **ES6 modules** from CDN — no bundler, no build step
- **Squared distance** for proximity checks (avoid `Math.sqrt`)

## Known Issues

1. ~~Spherical flight direction bug~~ — **RESOLVED.** Fixed in `src/flight/bird-flight.js`. See `KNOWN_ISSUES.md` for history.
2. ~~Eruda debug console in `index.html`~~ — **RESOLVED.** Already removed.
3. iOS audio full duration testing incomplete
4. ~~`src/performance/` dead code~~ — **RESOLVED (2026-06-11).** The ~3,500-line never-imported directory (plus `ambient-particles.js`, `speed-trail.js`) was deleted; git history retains it. Live adaptive quality is inline in `index.html`; the collision broad-phase shipped as `src/environment/collider-grid.js` (tested), superseding `optimized-collision.js`.

See `KNOWN_ISSUES.md` for detailed history and fix attempts.

---

## Notes for Vibe Academy

This is a **breakable toy** — a real, playable game you can pull down, modify, and make your own. The whole point is to get your hands in it. Below are things to try, roughly ordered from "I've never touched code" to "I want a real challenge."

### First Steps (Do These First)

1. **Play it** — open birbmobile.vercel.app on your phone. Fly around. Try all four game modes (Casual, Ring Rush, Drone Hunter, Turret Defense). Get a feel for what it does.
2. **Clone and run it** — `git clone git@github.com:Mentis123/birb.git`, then `python3 -m http.server 8000` and open it in your browser. You're now running the game locally.
3. **Open `basic/index.html`** — this is the stripped-down version. Read it top to bottom. It's the simplest possible flight game — one file, no complexity. This is your Rosetta Stone.

### Things to Try: Reskin & Retheme

These are visual/audio changes — low risk, high reward, instant gratification.

- **Change the world colour** — find the sky dome setup in `src/environment/sky-dome.js`. Change the sky gradient. Make it sunset orange. Make it alien green. Push it and see your world on Vercel.
- **Swap the music** — drop a new mp3 into `sound/` and update the ambient music reference in `index.html` (search for `ambient-forest`). Your world, your soundtrack.
- **Change the ring collect sound** — replace `sound/ring-collect.mp3` with any short sound effect. A coin ding? A whoosh? A voice saying "nice"?
- **Modify the rocket explosion** — in `index.html`, find the explosion particle effect. Change the colour, the size, the count. Make it fireworks. Make it confetti.
- **Restyle the UI** — the game mode selector, the score display, the splash screen — it's all CSS in `index.html`. Retheme it. Dark mode? Neon? Retro?

### Things to Try: Tweak the Feel

These change how the game *feels*. Small numbers, big impact. Great way to understand game design.

- **Make the bird faster** — in `src/flight/bird-flight.js`, find the speed constants. Double them. Now halve them. Which feels better? Why?
- **Change how tight the turns are** — find `YAW_RATE` and `PITCH_RATE`. Crank them up for an arcade feel. Lower them for a floaty glider.
- **Adjust the camera** — in `src/camera/follow-camera.js`, change the offset distance. Pull the camera way back for a cinematic feel. Push it close for intensity.
- **Make the turret snappier or heavier** — in `src/nesting/aim-rig.js`, the spring-damper constants (`C0` and `C1`) control how the turret feels. Higher C0 = snappier. Higher C1 = more damped. Try extremes.
- **Change the drone speed** — in `src/nesting/drone-system.js`, find how fast drones approach. Make them terrifying. Make them lazy.

### Things to Try: Modify Game Modes

Now you're changing what the game actually *does*.

- **Change Ring Rush rules** — find the Ring Rush setup in `index.html`. Change the ring count from 10 to 25. Add a speed multiplier. Change the timer.
- **Make Drone Hunter harder** — increase spawn rates, make drones faster, reduce the time limit. Or make it easier — more time, slower drones, more ammo.
- **Invent a new scoring rule** — what if you got bonus points for collecting rings while banking? Or a combo multiplier for consecutive hits?
- **Add a new collectible** — use `src/environment/collectibles.js` as a template. Create speed boost pickups, shield orbs, or ammo crates scattered on the sphere.

### Things to Try: Add Features

Real features. Real shipping. Real learning.

- **Add haptic feedback** — use the Vibration API (`navigator.vibrate(50)`) to add a buzz when you fire a rocket or collect a ring. Mobile-only, but very satisfying.
- **Add a new particle effect** — feathers when you graze the ground? Sparks on near-misses? Look at `src/effects/particles.js` for the pattern.
- **Build a simple HUD element** — altitude meter, speed gauge, compass direction. Pure HTML/CSS overlaid on the canvas.
- **Add a new sound layer** — wind intensity that changes with speed, a heartbeat at low health, a crowd cheer on high scores.

### The Big Challenge

- **Study how the spherical flight bug was solved** — the bird used to fly in a fixed world direction regardless of facing. Read `KNOWN_ISSUES.md` Issue 5 for the investigation saga, then study the fix in `src/flight/bird-flight.js`. This is a masterclass in quaternions, spherical geometry, and vector-based direction tracking on curved surfaces.

### What You'll Learn Along the Way

- **Three.js** — how 3D scenes work in the browser (scene, camera, renderer, game loop)
- **Game feel** — why numbers matter, how small tweaks change everything
- **Mobile development** — touch controls, performance budgets, iOS quirks
- **Physics** — quaternions, spherical geometry, spring-damper systems
- **Audio** — web audio on iOS, sound pools, volume mixing
- **Shipping** — from code change to deployed, playable game that others can try

---

## First Suggestions for Claude

If you're an AI assistant working on this repo:

1. **Default to student mode.** Assume the user is a Vibe Academy learner. Teach, explain, offer choices. See "Default Interaction Mode" above.
2. **Read `KNOWN_ISSUES.md` and `FLIGHT_CONTROLS_PLAN.md`** before touching flight code
3. **Good quick wins:** Remove eruda console, clean up debug UI, improve mobile CSS
4. **Good improvement:** Add screen shake intensity options, improve ring spawn variety
5. **Always test on mobile** — desktop behaviour is not representative
6. **Preserve zero-allocation** — never add `new` calls inside the game loop
