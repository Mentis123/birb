# Birb Gauntlet — architecture contract

> **Birb Gauntlet** is a stylised arcade bird-racing game on a miniature
> planet. It lives at `/gauntlet` on the Birb Mobile site as an unlisted Birb Labs
> artefact. This document is the contract every module builds against — read it
> before writing a line.

## Hard rules

1. **Self-contained.** `gauntlet/` imports nothing from the parent Birb Mobile
   `src/`. Nothing outside `gauntlet/` may import from inside it. Birb Mobile must
   be impossible to break from here.
2. **Zero external assets.** No downloaded models, textures, HDRIs or audio
   files. Every mesh is procedural `BufferGeometry`, every texture is generated
   in code (canvas 2D or shader), every sound is synthesised with Web Audio. If
   your own code did not generate it, it does not ship.
3. **No build step.** Vanilla ES modules, Three.js from a pinned CDN via
   `src/core/three-loader.js`. No bundler, no framework, no npm runtime deps
   (that includes nipplejs — Birb Gauntlet has its own joystick).
4. **Absolute paths.** All same-origin URLs are written `/gauntlet/...`. Relative
   paths break because Vercel serves this page at `/gauntlet` *without* a trailing
   slash, which would resolve `./src/x.js` to `/src/x.js`.
5. **Zero-allocation game loop.** Pre-allocate every vector, quaternion, colour
   and array in the constructor with a `_` prefix. No `new`, no object/array
   literal, no closure creation, no `.map`/`.filter`/`.slice` inside any
   `update()`. Build-time code may allocate freely.
6. **Mobile-first.** Touch is the primary input; keyboard is a desktop
   convenience. Budget: 60fps, **<100 draw calls, <80k triangles** for the whole
   frame. Your subsystem's share is listed in your brief.
7. **Deterministic.** Seeded RNG from `src/core/rng.js` only. `Math.random()`
   is banned so the harness captures the same frame twice.

## Conventions

- **Forward is `-Z`, up is `+Y`** in every model's local space. This matches the
  flight controller's `set(0,0,-1).applyQuaternion(q)`. A model built facing `+Z`
  will fly backwards.
- **Up is radial.** The planet is centred at the world origin, so a point's
  "up" is always `normalize(position)`. There is no global up.
- Scratch objects use a `_` prefix: `_tmpVec`, `_tmpQuat`.
- Squared distances for proximity checks — never `Math.sqrt` in a loop.
- `premultiply` = apply first (world space), `multiply` = apply after (local).

## The planet

`src/core/terrain.js` is the **single source of truth** for ground height.
Anything that needs to know where the ground is imports from there — the mesh,
the props, the flight floor, the course ribbon, the AI, the minimap.

Its load-bearing invariant, restated because breaking it breaks the game:

```
surfaceHeight(d)  <=  continentalHeight(d)  <=  0        (relative to PLANET_RADIUS = 100)
```

The flight model has **no gravity**. The radial clamp is a floor, not a spring.
If the floor could rise above the baseline, a cruising bird would ratchet upward
over every hill and never come back down. So terrain carves *downward only*, and
all height above the baseline is expressed with collider-free instanced props.
`continentalHeight` is the smooth flight floor; `surfaceHeight` is the rendered
mesh and is always at or below it, so the bird glides over detail rather than
clipping into it.

## Cel pipeline

Everything lit goes through `createToonMaterial` from `src/core/toon.js`
(MeshToonMaterial + NearestFilter ramp, patched with a quantised Fresnel rim and
a banded specular). Everything with a silhouette worth reading gets an
inverted-hull outline from `src/core/outline.js`.

Verified working in a captured frame: 4-band ramp, hard-edged rim, hard-edged
specular shape, clean hulls on both smooth and hard-edged geometry.

**Tuning notes from the first captured frames — apply these:**

- **Terrain wants `specStrength: 0`.** The default banded specular on a large
  smooth surface produces a big pale blob that reads as a bleached patch, not a
  highlight. Terrain also wants a lower `rimStrength` (~0.2).
- **Detail noise finer than a few triangles becomes band noise.** Stepped
  lighting amplifies high-frequency normals into white shards. Roughness has to
  read at the scale of a gully, not a pebble. (`terrain.js` already squares the
  ridge function for exactly this reason — do not un-square it.)
- **Outlines are for hero objects only** — birds, gates, course furniture,
  drones. Instanced terrain props deliberately go without: doubling the draw
  count for lines that read as noise at prop scale is a bad trade on mobile.

## Quality tiers

`index.html` picks a tier at boot and passes it to every factory as
`quality: 'low' | 'mid' | 'high'`.

| | low (older mobile) | mid (modern mobile) | high (desktop) |
|---|---|---|---|
| DPR cap | 1.2 | 1.4 | 1.8 |
| planet subdivision | 48 | 72 | 110 |
| prop instances | ~40% | ~65% | 100% |
| clouds | 12 | 20 | 34 |
| stars | off | 120 | 260 |
| feather particles | 90 | 180 | 320 |
| edge-detect post pass | off | off | on |

Every factory must honour its tier. Never branch on user-agent inside a
subsystem — read the tier you were handed.

## Module map and ownership

Each module owns its files exclusively. Do not edit a file you do not own; if
you need something from another module, code to the API below.

```
gauntlet/
  index.html                  INTEGRATOR — shell, splash flow, HUD markup, CSS,
                              boot, main loop, quality tiers
  ARCHITECTURE.md             this file
  README.md                   INTEGRATOR
  src/core/                   FOUNDATION (done, do not edit)
    three-loader.js             loadThree()
    palette.js                  PALETTE, CSS, KEY_LIGHT_DIR, RAMPS, getRamp()
    terrain.js                  PLANET_RADIUS, continentalHeight, surfaceHeight,
                                surfaceRadius, floorRadius, depthAt, biomeAt,
                                biomeNoise, BIOME, TERRAIN, fbm
    toon.js                     createToonMaterial, patchToon, createLightRig,
                                setRimStrength, setSpecStrength, setRimColor
    outline.js                  attachOutline, attachOutlineTree,
                                ensureSmoothNormals, createOutlineMaterial,
                                updateOutlineProjection, setOutlinesVisible
    rng.js                      makeRng, rngRange, rngInt, fibonacciDirection
  src/world/planet.js         AGENT: planet
  src/world/sky.js            AGENT: sky
  src/bird/bird-model.js      AGENT: bird
  src/bird/bird-anim.js       AGENT: bird
  src/bird/flight.js          AGENT: flight
  src/camera/chase-camera.js  AGENT: flight
  src/race/course.js          AGENT: course
  src/race/race-logic.js      AGENT: course   (PURE — no THREE, no DOM)
  src/race/ai-racer.js        AGENT: ai
  src/fx/feathers.js          AGENT: fx
  src/fx/shake.js             AGENT: fx
  src/ui/hud.js               AGENT: hud
  src/audio/audio.js          AGENT: audio
  src/input/touch.js          AGENT: input
  dev/<name>.html             one probe page per agent, owned by that agent
tools/gauntlet-shot.mjs           screenshot harness (done)
tests/gauntlet-*.test.js          pure-logic unit tests (node --test, no deps)
```

## Module APIs — build exactly these

Every factory takes `THREE` as its first argument (the game loads Three once and
passes it down; modules never import it themselves).

Every returned object exposes `dispose()`.

### `world/planet.js`

```js
createPlanet(THREE, { quality, seed }) -> {
  group,                    // THREE.Group — add to scene
  update(dt, birdDirX, birdDirY, birdDirZ),   // prop fade / LOD. Zero-alloc.
  triangleCount, drawCallCount,               // reported at build time
  dispose()
}
```
Budget: <= 26 draw calls, <= 46k triangles at `high`.
Displaced icosphere with vertex colours from `biomeAt`/`depthAt`, plus instanced
prop layers (broadleaf trees, pines, spires, rock scatter, snow caps). Props are
collider-free and scattered with `fibonacciDirection` + seeded jitter, zoned by
`depthAt` (lush valleys, thinning toward crests).

### `world/sky.js`

```js
createSky(THREE, { quality }) -> {
  group,                    // anchor to the camera each frame
  update(dt, camera),       // drift clouds, twinkle stars, follow camera
  dispose()
}
```
Budget: <= 8 draw calls, <= 6k triangles. Gradient dome (BackSide shader using
`PALETTE.skyZenith/skyMid/skyHorizon`), a graphic sun disc + halo aimed along
`KEY_LIGHT_DIR`, flat cel clouds as ONE InstancedMesh, stars as one Points.

### `bird/bird-model.js`

```js
createBird(THREE, { bodyColor, bellyColor, scale, quality, outline }) -> {
  group,                    // faces -Z, up +Y, ~2.4 units long at scale 1
  parts: { body, head, beak, leftWing, rightWing, leftFoot, rightFoot,
           tail, leftEye, rightEye, leftPupil, rightPupil },
  dispose()
}
```
Budget: <= 9 draw calls, <= 2.5k triangles per bird *including outline hulls*
(4 birds on screen). Chibi silhouette: round body, big eyes, prominent beak,
layered-cone wings. Wings pivot at the shoulder so a rotation on the group
reads as a flap.

### `bird/bird-anim.js`

```js
createBirdAnimator(THREE, bird) -> {
  update(dt, state),        // zero-alloc
  dispose()
}
// state (a caller-owned object, mutated in place — never allocate one per frame):
// { speed01, turn, pitch, boosting, flapImpulse, tumbling, grounded, celebrating, phase }
```
Must deliver: flap cycle whose rate rises with `flapImpulse` and falls to a glide
at speed, bank/lean into `turn`, wing-tuck on dive, flare-and-reach on landing,
head counter-rotation so the bird looks where it turns, idle bob, tumble spin,
and a wing-spread celebration. A stiff bird sinks the whole look.

### `bird/flight.js`

```js
new GauntletFlight(THREE, {
  sphereRadius, terrainHeightAt, birdRadius, position, quaternion,
  speed, yawRate, pitchRate, maxPitch
})
  .tick(input, dt) -> { position, quaternion, velocity }   // reused object
  .position .quaternion .speed .boost01 .airSpeed01 .isBoosting
  .applyKnockdown(), .reset(), .setThrottle(v)
// input: { x, y, boost } — x/y in [-1,1], boost boolean
```
Arcade feel on a sphere: parallel-transport the orientation as the bird moves
over the curve (see `Mentis123/birb`'s `src/flight/bird-flight.js` for the
solved version of this — it is the hardest problem in the codebase and it is
already solved, so port the approach rather than re-deriving it). Speed builds
in a dive and bleeds in a climb; turns tighten with speed; a dive-then-pull-up
slingshot charges the boost meter. Floor comes from `terrainHeightAt`, never
from a constant.

### `camera/chase-camera.js`

```js
createChaseCamera(THREE, camera, { quality }) -> {
  update(dt, targetPos, targetQuat, speed01, shakeAmount),
  snapToTarget(targetPos, targetQuat),
  setMode('chase'|'orbit'|'results'),
  dispose()
}
```
Spring-damped, radial-up aware (never world-up), FOV kick with speed. Must call
`updateOutlineProjection` whenever it changes FOV so line widths stay constant.

### `race/course.js`

```js
createCourse(THREE, { quality, seed, gateCount }) -> {
  group, curve,             // THREE.CatmullRomCurve3, closed
  gateCount,
  sampleAt(t, outVec3),     // point on the racing line, terrain-following
  tangentAt(t, outVec3),
  nearestT(x, y, z),        // -> t in [0,1); zero-alloc
  gatePositions,            // Float32Array(gateCount*3)
  gateT,                    // Float32Array(gateCount)
  setNextGate(index),       // recolour the upcoming gate
  update(dt),
  dispose()
}
```
Budget: <= 20 draw calls, <= 12k triangles. The ribbon is a tube/extruded strip
along the spline sitting a fixed altitude above `floorRadius`, so it dips into
canyons with the terrain instead of clipping through it. Design a circuit with
real character: a fast ridge straight, a hairpin, a wide sweeper, a canyon dive
where the line drops below the baseline, and a climbing chicane.

### `race/race-logic.js` — **PURE. No THREE, no DOM.**

```js
export const RACE_CONFIG          // laps, countdown ms, gate radius, ...
createRaceState({ laps, gateCount, racerCount }) -> state
resetRaceState(state)
recordGate(state, racerIndex, gateIndex, nowMs) -> boolean   // true if it counted
racerProgress(state, racerIndex)  // -> laps + fraction, monotonic, for standings
updateStandings(state)            // sorts in place into state.order
isWrongWay(state, racerIndex, t)  // -> boolean
formatTime(ms)                    // "1:23.45"
lapSplit(state, racerIndex, lap)  // -> ms or null
isFinished(state, racerIndex)
```
Must be unit-tested in `tests/gauntlet-race-logic.test.js` with `node --test` and no
dependencies (CI runs `npm test` without installing anything).

### `race/ai-racer.js`

```js
createAIRacers(THREE, { course, count, quality, seed, createBirdFn }) -> {
  racers,                   // [{ group, t, lap, speed, personality, ... }]
  update(dt, playerProgress, raceState),
  reset(),
  dispose()
}
```
Spline-following with lookahead steering. Three personalities: aggressive
(cuts inside, brakes late, bumps), clean (holds the ideal line, consistent),
erratic (wide swings, occasional real mistakes). Mild rubber-banding so races
stay close, mutual avoidance so they don't stack, and genuine mistakes so
beating them feels earned. Kinematic, not full physics — 3 birds of full flight
sim is neither stable nor affordable.

### `fx/feathers.js`

```js
createFeatherFX(THREE, { quality, capacity }) -> {
  group,
  emitTrail(x, y, z, vx, vy, vz, colorHex),
  burst(x, y, z, count, colorHex),
  update(dt),
  dispose()
}
```
One InstancedMesh, fixed capacity, ring-buffer allocation. Budget: 2 draw calls.

### `fx/shake.js`

```js
createScreenShake({ seed }) -> { add(amount), update(dt), value, dispose() }
```

### `ui/hud.js`

```js
createHUD(rootEl, { quality }) -> {
  setLap(lap, total), setPosition(pos, total), setSpeed(kmh, speed01),
  setBoost(boost01), setSplit(text, delta), setGate(index, total),
  showCountdown(n), hideCountdown(),
  showWrongWay(on),
  showResults(rows), hideResults(),
  minimap: { update(courseSamples, racerPositions, playerIndex) },
  dispose()
}
```
Hand-designed in the cel style (see `PALETTE`/`CSS`), DOM + one small canvas for
the minimap. Never mutate `textContent` with a value that has not changed.

### `audio/audio.js`

```js
createAudio() -> {
  unlock(),                 // call from the first user gesture
  setEnabled(music, sfx),
  setFlightSpeed(speed01),  // wind rush + engine-ish tone
  flap(), gate(streak), boost(), impact(), countdownBeep(), horn(),
  finish(placement),
  dispose()
}
```
All synthesised with Web Audio. iOS: the context starts suspended — everything
must be created lazily after `unlock()` and must not throw before it.

### `input/touch.js`

```js
createInput(rootEl, { onBoost }) -> {
  value,                    // { x, y, boost } — mutated in place, never replaced
  update(dt),               // applies deadzone/expo/smoothing
  setVisible(on),
  dispose()
}
```
Own virtual joystick — no nipplejs. Deadzone 0.14, expo 0.3, smoothing 0.28.
Also handles keyboard (WASD/arrows, space = boost) for desktop testing.

## Verification protocol — non-negotiable

Every visual claim gets checked against a real captured frame. Never against
your assumption about what the code does.

1. Build a probe page at `gauntlet/dev/<yourname>.html` that renders your subsystem
   in isolation, sets `window.__GAUNTLET_READY = true` after the first render, and
   exposes `window.__GAUNTLET_STATS = () => ({ drawCalls, triangles })`.
2. Capture it:
   ```bash
   node tools/gauntlet-shot.mjs --page gauntlet/dev/<yourname>.html \
     --out /tmp/shots/<yourname>.png --query "three=local" \
     --w 900 --h 1000 --dpr 2 --wait 25000
   ```
   **`--query "three=local"` is required in this sandbox** — the CDN is not
   reachable from here, so the page falls back to a locally installed Three.
   The harness exits non-zero on any page or console error: a zero exit is your
   proof the module actually loaded, not just that a PNG appeared.
3. **Read the PNG back and look at it.** Then be harsh with yourself: would this
   frame pass as a shipped, published stylised racing game? Name the specific
   defect — a band threshold that reads as mush, an outline that breaks on a
   silhouette, a wing that reads as a hinge, terrain that repeats — and fix it.
4. Loop until you cannot name another specific defect. "It works" is the floor,
   not the goal.
5. Also capture at phone size (`--w 390 --h 844 --dpr 3`) before you finish.
   Mobile is the target; a composition that only reads at 900px wide has failed.
6. `node --check` every file you write, and `npm test` if you added a test.

## Reporting

When you finish, report: files written, verified draw calls / triangles, what
you captured, and **an honest percentage against the quality bar with the
specific reason for any gap**. "The flap is at 70% — the downstroke has no
follow-through on the primaries" is useful. "Done" is not.
