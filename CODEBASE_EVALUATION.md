# Birb Mobile — Comprehensive Codebase Evaluation

**Authored:** 2026-06-10 by **Claude Opus 4.8**, synthesizing a four-domain multi-agent evaluation:

1. **Architecture & Hygiene** — organization, dead code, tests, service worker, dependencies
2. **Flight, Controls & Cameras** — flight physics, input pipeline, camera rigs, zero-allocation compliance
3. **Environment, Rendering & Performance** — world generation, collision, the `src/performance/` subsystem, frame budget
4. **UI, UX & Game Design** — entry flow, HUD, touch ergonomics, game-mode balancing, audio, accessibility, retention

This document is the **definitive** evaluation. It consolidates and supersedes the four scratch reports (which will be deleted), preserving every substantive finding with file:line citations, priorities, and effort estimates. Disputed claims between reports were re-verified against the live tree on the date above.

---

## 1. Executive Summary

### Overall verdict

Birb Mobile is a **genuinely well-engineered vanilla-JS Three.js game** operating under hard, self-imposed constraints (no build step, mobile-first, ES6-from-CDN, teaching artefact). The make-or-break dimensions are strong: the flight core is mathematically correct and zero-allocation-disciplined, the service worker is the best-engineered file in the repo, the deferred render loop is exemplary, dispose hygiene on environment swaps is clean, and the most important physics is unit-tested (18/18 green).

The liabilities are **structural, not algorithmic**, and they cluster around a single meta-theme that is uniquely corrosive for a *teaching* artefact: **the documentation and file structure promise capabilities the runtime does not deliver.** ~3,900 lines of plausible-looking dead code, two parallel input/camera stacks where the documented one is inert, and a CLAUDE.md that cites a file which does not exist — all actively mislead the learners this project exists to serve. None of this breaks the game; all of it breaks the *learning*.

The shipped game also carries a small number of **real player-facing bugs** — most urgently a reduced-motion lockout that makes the game unplayable for the exact accessibility cohort the setting serves, and a three-way ring-count drift that ends Ring Rush early with rings still floating.

### Scorecard

| Domain | Grade | One-line justification |
|---|---|---|
| **Flight physics & feel** | **A** | Vector-based parallel-transport core is correct, zero-alloc, dt-clamped, unit-tested; the famous spherical bug is genuinely fixed. |
| **Service worker / PWA** | **A** | Versioned caches, per-asset install, correct strategy matrix, iOS 206 Range slicing. One precache gap. |
| **Performance / rendering** | **B+** | Instanced props, real adaptive tier, responsible mobile fill-rate gating; held back by O(n) collision scan and un-pooled explosions. |
| **Environment / world-gen** | **A−** | Sound terrain-floor invariant, shared zero-alloc displacement math, clean dispose. Deliberate trades well-documented. |
| **Architecture & hygiene** | **C+** | Cohesive `src/` modules undermined by an 8,705-line monolith and ~3,900 lines of dead code; stale docs. |
| **Input pipeline** | **C** | Live path works but is the *minimal* one; the documented sophisticated stack is dead, so docs lie to students. |
| **Cameras** | **B** | Live `BirdCamera` is fine; three divergent damping idioms + an `up`-after-`lookAt` bug + dormant duplicate rig. |
| **UX / game design** | **B** | Strong entry flow, audio, haptics; dragged down by a11y lockout, ring-count bug, no motion-intensity control. |
| **Testing** | **B** | Deep where it counts (physics/feel), but nothing in `index.html` is testable because it isn't importable. |

### Headline findings

1. **~3,900 lines of dead code** masquerade as live systems — the *entire* `src/performance/` engine (9 files), plus `simple-flight-controller.js`, `ambient-particles.js`, `speed-trail.js`. Found independently by the architecture **and** performance agents; the repo's own `ULTRA-REFACTOR-REPORT.md` arrived at the same figure. CLAUDE.md's "Key Files" table lists several of these as if live.
2. **Two parallel input + camera stacks run simultaneously**; the *documented, sophisticated* one (`flight-controls.js` deadzone/expo/smoothing) is **inert** — its methods aren't implemented on `BirdFlight`. The live touch path does raw clamp only. A student following CLAUDE.md to "tweak the feel" edits a file with zero runtime effect.
3. **CRITICAL — reduced-motion users can't play.** `prefers-reduced-motion: reduce` sets `controlState.systemPaused = true` at boot; the world never animates after Tap-to-Start.
4. **CRITICAL — Ring Rush ring count is broken three ways** (+PRD): spawns 18, wins at 10, copy says 10, PRD says 20. Race ends early with 8 rings floating and HUD reading "10/10".
5. **Zero-allocation rule violated on the hot path in at least six places** across three domains — most importantly the per-frame `getAmbientOffsets` fallback (`index.html:8111`), the drone-explosion allocation storm, and the Turret Defense drone loop.
6. **Per-frame collision is an O(n) linear scan over ~700–1,200 colliders** — and the spatial-hash fix that would solve it *already exists* in the dead `optimized-collision.js`, never imported.
7. **The 8,705-line `index.html`** holds ~5,740 lines of module script with ~292 top-level globals coordinating everything by mutable-global convention — fragile to edit, impossible to unit-test.
8. **Several CLAUDE.md claims are stale or wrong** — eruda is already removed, the minimap is already fixed, dead modules are listed as Key Files, and `free-flight-controller.js` **does not exist in the repo at all**.

---

## 2. Cross-Cutting Synthesis

This is the section that the individual reports could not produce: the themes that surfaced in *multiple* domains, where the whole is worse (or more fixable) than any single report conveyed.

### Theme A — "Structure and docs promise things the runtime doesn't do"

This is the single most important meta-finding, and it appeared independently in three domains. For a *teaching artefact* whose stated mission is "people inspect real code, run it, break it, rebuild it," a gap between what the code *looks like it does* and what it *actually does* is the most expensive possible defect — it wastes the learner's time and breaks trust.

Three concrete instances, all pointing the same direction:

1. **Dead `src/performance/` engine (architecture + performance agents).** A student opens `performance-manager.js`, `object-pool.js`, or `lod-system.js` — files CLAUDE.md's Key Files table *names as live* — and reasonably assumes they run the game. They do not. The real adaptive-quality logic is an inline IIFE at `index.html:6441`; the real pooling is ad-hoc. ~3,488 lines of convincing-but-inert framework.
2. **Dead documented input stack (flight agent).** CLAUDE.md says: "Improve mobile controls → `src/controls/flight-controls.js` — deadzone, expo, smoothing." A student edits `TOUCH_INPUT_SMOOTHING`, the deadzone, the expo curve — and sees **zero effect**, because live touch flows through the minimal `touch-input.js` (raw clamp) into `BirdFlight`, while `flight-controls.js` calls `setInputs`/`setYawOnlyMode`/`addLookDelta` that `BirdFlight` never implements (silently swallowed by `?.`).
3. **Dead documented file that doesn't even exist.** CLAUDE.md's Key Files table and "Flight Direction" section cite `free-flight-controller.js` as the legacy controller — the centrepiece of the "spherical-bug masterclass" it directs advanced students to study. **That file is not in the repo** (verified: `find` returns nothing).

The fix is not just deletion — it is **curation**. Either delete the dead code, or move it to a clearly-labelled `attic/`/`reference/` directory with a one-line "NOT WIRED — reference only" header, and realign CLAUDE.md so every breadcrumb leads somewhere real.

### Theme B — Zero-allocation violations (consolidated audit)

The "zero-allocation game loop" is House Rule #4 and is invoked all over CLAUDE.md. The discipline is *real and excellent* in the flight/camera/world-gen hot paths — which makes the violations elsewhere both surprising and important (they're also bad examples for students learning the pattern). **Three different agents** independently found violations; consolidated:

| # | Site | What allocates | Frequency | Pri | Effort | Source |
|---|---|---|---|---|---|---|
| Z1 | `index.html:8111` | `getAmbientOffsets()` fallback allocates `{position: new Vector3(), quaternion: new Quaternion()}` — `BirdFlight` has no `getAmbientOffsets`, so the `else` runs **every frame**; only `.position` is even read | Every frame | **High** | S | flight |
| Z2 | `drone-system.js:106–285` | `createDroneExplosion` per kill: ~60 `Mesh` + ~60 `MeshBasicMaterial` + ~100+ `Vector3` | Per drone kill | **Med** | M | perf |
| Z3 | `index.html:~7822–7842` | Turret Defense drone loop: `nestPos.clone()`, `new Vector3()` ×N for tangent/side/spiral, per drone per frame | Every frame, dense waves | **Med** | M | UX + perf |
| Z4 | `drone-system.js:626` | `getDrones()` does `drones.filter(...)` → new array; called every frame minimap is visible (~most of play) | ~60/sec | **Med** | S | perf |
| Z5 | `rocket.js:296,302,317` | `position.clone()`, `velocity.clone().normalize()`, `trail.unshift(position.clone())` per rocket per frame | Per rocket/frame | Low | S | perf |
| Z6 | `touch-input.js:52` | `get()` returns `{ ...state }` — a fresh object per call | Once/frame | Low | S | flight + UX |
| Z7 | `index.html:7233` | `_launchFwd.clone().negate()` in launch tap handler (not loop, but inconsistent) | Per launch | Low | S | flight |
| Z8 | `bird-flight.js:339` | `_deflectAlongTerrain` creates a `sample` closure per penetration frame (gated to penetration-only, documented) | Per wall-skim frame | Low | S | flight |
| Z9 | `effects/particles.js:195,251,317` | `createExplosion`/`createSparkle` allocate `BufferGeometry`+`Points`+`PointsMaterial` per burst; `createSparkle` fires every ring collect | Per ring collect | Low | S | perf |

**Z2 is the most player-felt** (GC churn + ~60 transient draw calls right when Drone Hunter is densest — see Theme C). **Z1 is the highest-value cheapest fix** (hoist one module-level `_emptyAmbient` constant). The cluster as a whole is the kind of thing that should be fixed *visibly* and commented, precisely because students are learning the pattern from this code.

### Theme C — The fix often already exists in the dead code

A striking pattern: the live runtime does the naive thing while the *better* implementation sits unused in `src/performance/`.

- **Collision broad-phase:** the live path (`spherical-world.js:77–103`, called `index.html:8031`) is an O(n) linear scan over **~700 (mobile) to ~1,200 (desktop)** static colliders every frame. `optimized-collision.js` contains a finished `SpatialHashGrid` / `OptimizedCollisionSystem` that would drop this to single-digit tests. It is never imported.
- **Particle bursts:** drone explosions (Z2) allocate ~60 individual meshes per kill. `optimized-particles.js` literally implements a draw-range `THREE.Points` burst designed for exactly this case. Never imported.

This sharpens the dead-code recommendation: it's not *all* worthless reference material — at least two of the dead modules are **the solution to live problems**. The cleanest path is to *wire* `optimized-collision.js` (fixing the densification scaling cliff) and *harvest* the Points-burst idea for explosions, then delete or attic the rest.

### Theme D — Stale / wrong CLAUDE.md claims

CLAUDE.md is otherwise excellent (the load-bearing-oddity notes are a model of self-documentation), but several claims have drifted from the code. For a doc that students read *first*, accuracy is load-bearing:

| Claim in CLAUDE.md | Reality | Source |
|---|---|---|
| "Eruda debug still present in `index.html` — can strip when next touching" (Known/pending + Known Issue #2) | **Already removed** — 0 references in `index.html` | UX (verified) |
| "Minimap is too zoomed-out per playtest — tighten the radius" (Known/pending) | **Already fixed** — `updateMinimap` uses mode-aware `visibleRadius` 65/70/80/95 with a comment citing the playtest | UX |
| Key Files table lists `performance-manager.js`, `object-pool.js`, `lod-system.js` | **Dead** — nothing imports `src/performance/` | arch + perf |
| Key Files table + Flight Direction cite `free-flight-controller.js` as the legacy controller | **File does not exist.** The real legacy file is `src/controls/simple-flight-controller.js` | arch (verified) |
| Control-feel block: "Joystick deadzone 0.15, Expo 0.32, Input smoothing 0.3" | **Not in effect** on the live path — `touch-input.js` does raw clamp only; the file implementing these (`flight-controls.js`) is inert | flight |
| PRD describes a `src/game-modes/*.js` architecture (ring-rush-mode.js, combo.js…) | **Does not exist** — all mode logic is inline in `index.html` | UX |

---

## 3. Conflict Resolution Between Reports

Where the four reports disagreed, here is the verified truth:

**`free-flight-controller.js` — does it exist?**
The flight report said it was "confirmed unreferenced at runtime" (implying it exists as a dead file). The architecture report said it "does not exist in the repo." **Verified 2026-06-10: the architecture report is correct.** `find . -name "free-flight-controller.js"` returns nothing. The flight report's phrasing is misleading — you cannot reference a file that isn't there; the references it found were all in *docs* (`KNOWN_ISSUES.md`, `FLIGHT_CONTROLS_PLAN.md`, `basic/README.md`, `ULTRA-REFACTOR-REPORT.md`). The actual legacy/reference controller in the tree is **`src/controls/simple-flight-controller.js`** (111 lines, test-only, imports the bare `three` specifier). CLAUDE.md's references to `free-flight-controller.js` should be corrected to `simple-flight-controller.js` (or the doc should make clear the named "before" artefact is gone and the history lives only in `KNOWN_ISSUES.md` Issue 5).

**Dead-code line count.** Architecture (~3,986) and performance (~3,900) agents counted the same set with minor rounding. Reconciled total: **~3,900–3,986 lines** across `src/performance/` (9 files, ~3,200–3,488), `simple-flight-controller.js` (111), `ambient-particles.js` (432), `speed-trail.js` (276). Both match `ULTRA-REFACTOR-REPORT.md`'s independent figure. No real conflict.

**`index.html` size.** Reports cite 8,705 lines (architecture/UX) and "~5,740-line module script" (architecture §1). Both are right and refer to different things: the **file** is 8,705 lines (verified); the `<script type="module">` *within* it is ~5,744 lines (2874–8618). No conflict.

---

## 4. Domain Findings (Comprehensive)

All substantive findings from the four scratch reports, preserved with citations, priority (Critical/High/Medium/Low) and effort (S/M/L). These reports are being deleted; this section is their permanent record.

### 4.1 Architecture & Hygiene

**A-1 — The `index.html` monolith. [High · M–L]**
8,705 lines / 321 KB. `<style>` 18–2474 (~2,456 CSS), `<script type="module">` 2874–8618 (~5,744 game), SW registration script 8619–8702. 81 `function` declarations, ~292 top-level globals. All 18 `src/` modules pulled via dynamic `import()` at 3281–3341. Mixes ≥7 separable concerns with clean seams: game-mode system (`GAME_MODES` 4947, `currentGameMode` 4985, `startGameMode`, `updateGameModeUI` 5239, per-mode switches 5046–5157, ~600 lines); flight-recovery/GROUNDED machine (`FLIGHT_RECOVERY_STATES` 4896, `FLIGHT_RECOVERY_CONFIG` 4901, fall-ramp/boost, ~400 lines); freeze state (`freezeState` 4940, `updateFreezeState` 5385); minimap (`updateMinimap` 4356, ~250 lines); audio (pool, ambient swap 3501); HUD (`updateGameHud` 5042); bootstrap/scene setup.
*Recommendation:* do **not** adopt a framework. Extract the 3–4 cleanest self-contained seams to plain ES modules with explicit deps + `update(delta)` API: `src/game/game-modes.js`, `src/flight/flight-recovery.js`, `src/ui/minimap.js`. Removes ~1,200–1,500 lines, unlocks unit tests, keeps audio/HUD/bootstrap inline (DOM-bound). `index.html` stays the conductor.

**A-2 — Coupling via shared mutable globals. [High · M]**
Cross-system comms are almost entirely module-scope `let` bindings (`flightController`, `nestingState`, `flightRecoveryState`, `currentGameMode`, `collectiblesSystem`, `droneSystem`). The GROUNDED↔NESTED↔FLYING interactions (7097–7115, 7218–7255, 8044–8064) are correct only by careful convention (e.g. `nestingControlsBird` covering LANDING+NESTED, load-bearing comment at 8022). Works, well-commented, but fragile and untestable. No single owner of "what state is the game in." Adding a phase means touching ~15 sites.
*Recommendation:* extract flight-recovery (A-1) as first step toward one explicit phase owner; longer term a tiny hand-rolled `gameState` object with a validating `setFlightPhase()` — minimal, readable, no framework.

**A-3 — Dead/unwired code. [Critical (clarity) · S]** See Theme A/C. ~3,900–3,986 lines:

| File(s) | Lines | Status |
|---|---|---|
| `src/performance/` (all 9: `performance-manager`, `object-pool`, `lod-system`, `frustum-culling`, `optimized-collision`, `optimized-particles`, `material-optimizer`, `scratch-allocations`, `index`) | ~3,200–3,488 | Orphaned. 0 imports from `index.html`. Game reimplements adaptive quality inline (`adaptiveTier` IIFE `index.html:6441`). |
| `src/controls/simple-flight-controller.js` | 111 | Orphaned (test-only). |
| `src/environment/ambient-particles.js` | 432 | Orphaned. |
| `src/environment/speed-trail.js` | 276 | Orphaned. |

All added 2026-04-18, never touched — abandoned, not in-progress. *Recommendation:* wire `optimized-collision.js` (Theme C / 4.3 F1), harvest the Points burst from `optimized-particles.js`, then delete or move the rest to a labelled `attic/`/`reference/` with "NOT WIRED" headers.

**A-4 — `node_modules` committed — deliberate, leave it. [Not a problem]**
`.gitignore` whitelists only `!node_modules/three/index.js`, a 9.8 KB esm.sh re-export shim (`du -sh node_modules` = 20 KB). Load-bearing: lets `node --test` `import 'three'` without a network fetch in CI. *Nit (Low, S):* add a one-line comment explaining why it's committed so a future cleanup doesn't delete it and break CI.

**A-5 — Stale markdown. [Medium · S]**
`KNOWN_ISSUES.md` (live, keep), `CLAUDE.md` (load-bearing, has errors — Theme D), `ULTRA-REFACTOR-REPORT.md` (56 KB plan snapshot, archive-worthy), `AGENT_LOG.md`/`codex.md` (stale 04-18 scratch), `FLIGHT_CONTROLS_PLAN.md`/`TURRET_RESEARCH.md` (historical design, keep + date-stamp), `basic.MD` (keep), `docs/*.md` (2,892 lines, 04-18; `PRD-game-modes.md` referenced by CLAUDE.md). `AR/` (1,879 lines) experimental, unwired — verify `AR/README.md` banners it. `mobiletest.html` (12 KB) referenced by nothing — document or remove. *Recommendation:* `docs/archive/` for `AGENT_LOG.md`, `codex.md`, `ULTRA-REFACTOR-REPORT.md`, `mobiletest.html`, 04-18 research docs; date-stamp the rest.

**A-6 — Testing. [Medium · M]**
5 `node --test` suites, 415 lines incl. a 25-line `flight-harness.js`, **18 tests green**. CI runs `npm test` on push+PR. Deep where it matters: `bird-flight.test.js` (delta clamp, throttle, reset, pitch clamp, sphere-floor-dive), `flight-controller.test.js` (yaw/velocity align — the spherical bug, pitch→altitude, YXZ), `aim-rig.test.js` (spring-damper inertia, pitch limits, carry-through), `nesting-system.test.js` (landing machine, moving nest), `input-shaping.test.js` (deadzone, expo, `shapeAxis`). *Gap:* nothing in `index.html` is tested because nothing in it is importable — the monolith's testability cost. The A-1 extractions directly unlock `flight-recovery.test.js`, `game-modes.test.js` using the existing injected-dep style.

**A-7 — Service worker. [Strongest file in the repo]**
`sw.js` (7.2 KB): versioned caches (`CACHE_VERSION='v6-2026-06-08'`), `activate` evicts old, `skipWaiting`+`clients.claim`; per-asset `install` try/catch (one missing file won't sink install); correct strategy matrix (navigation→network-first, same-origin `.js`→**stale-while-revalidate** to stop iOS pinning old module code, media→cache-first); **`rangeRespond`** slices cached audio into HTTP 206 Partial Content for iOS `<audio>` Range requests; esm.sh runtime-cached (not precached) because transitive deps are unpredictable; robust update flow in `index.html` 8625–8690 (handles iOS `controllerchange` re-emit, guards first-install). *Issues (Medium, S):* (1) CORE_ASSETS lists `ambient-forest.mp3` but **not `ambient-mountain.mp3`** (exists in `sound/`) — add it; GLTFLoader sub-path is covered by the esm.sh host allowlist (acceptable). (2) `birb.glb` 1.7 MB is precached — large mobile install but unavoidable for offline; acceptable.

**A-8 — Dependency strategy. [Medium · S]**
Two pinned CDN deps via dynamic `import()`: `three@0.183.2` (esm.sh, 3281) + GLTFLoader sub-path (3337), `nipplejs@0.10.1` (3341), plus the test shim. *Risks:* esm.sh is a single point of failure on cold/cache-miss boot; the three.js version is hard-coded in 3 places (bump → easy to miss one → two copies → `instanceof` breakage). *Recommendation:* add an **import map** in `<head>` mapping `"three"` and `"three/addons/"` to the pinned esm.sh URLs; route all imports through bare specifiers. Single version source, aligns the test shim + browser on the same specifier, stays 100% build-free, and reads better for students. (Self-hosting three.js to kill the SPOF is heavier and works against the CDN teaching story — only if cold-start reliability becomes a hard requirement.)

### 4.2 Flight, Controls & Cameras

**Flight core (`src/flight/bird-flight.js`) — genuinely solid.** Parallel transport via `setFromUnitVectors(oldNormal,newNormal)` premultiplied (191–201); auto-level + pitch clamp use `dot(forward,sphereNormal)`=sin(pitch) with `Math.max(-1,min(1,…))` before `asin` (203–237, line 230); scratch discipline throughout (73–92); dt clamp at `tick()` 243 (`min(max(dt,0),0.05)`) defends physics even if a caller forgets; terrain floor `_floorAt` 300–303 coherent with `checkGroundCollision`/`forceGroundedPose` (load-bearing per CLAUDE.md — not flagged). Pole handling sound (movement ≈0.26°/frame, never approaches the 180° transport degeneracy).

| # | Finding | Class | Pri | Effort |
|---|---|---|---|---|
| F1.1 | Auto-level uses linear `value*dt` not `1-exp(-k·dt)` (lines 213–214; same in `_applyZenAutoLevelRoll` 276). Equilibrium leveling rate varies with frame rate (2× per-frame correction at 30fps vs 60fps). Bounded by the dt≤0.05 clamp, but a 120Hz iPhone and 30fps Android level differently. | Feel/UX | Medium | S |
| F1.2 | `_deflectAlongTerrain` creates a `sample` closure per penetration frame (339). Documented + gated to penetration-only; fires every frame on a long canyon-wall skim. Could hoist to a method using `this._scratch`. | Code quality | Low | S |
| F1.3 | `setThrottle` (414–418) sets `this.speed` but `index.html:7950–7969` re-asserts `flight.speed` every frame from sprint/recovery, so the throttle slider only drives the % readout (admitted in comment 408–413). Latent foot-gun for students. | Code quality | Low | S |
| F1.4 | `getPosition()` (400) returns `this._scratch.vec3.copy(...)` — a **shared** scratch the next `update()` mutates, NOT a copy as the JSDoc claims. Either `.clone()` or fix the comment. | Bug | Low | S |
| F2.1 | **Dual input stacks; `createFlightControls`'s flight path is dead.** Live: `createTouchInput`+`createKeyboardInput`+`combineInputs`→`flightInput` (6799–6805)→`flight.tick` (7993). Dead: `createFlightControls` (864 lines, 7004) calls `setInputs`/`setYawOnlyMode`/`setPitchOnlyMode`/`addLookDelta` — `BirdFlight` implements **none** (silenced by `?.`). So its deadzone/expo/staged-mode/yaw-only machinery, plus `thumbstick.js`/`virtual-thumbstick.js`, are inert. CLAUDE.md's documented tuning is not in effect. See Theme A. | Code quality/Bug | **High** | M |
| F2.2 | Live touch (`touch-input.js:33–39`) does `clamp(data.vector.x,-1,1)` straight from nipplejs — **no deadzone, no expo, no smoothing.** Thumb jitter feeds yaw/pitch directly. Add ~0.12 deadzone + ~0.3 expo to match documented intent (flip side of F2.1). | Feel/UX | Medium | S |
| F2.4 | **`invertPitch` is a silent no-op.** `index.html:7014` passes it to `createFlightControls`; `applyInvertPitchPreference` (7017+) calls `flightController.setInvertPitch?.()` — `BirdFlight` has no such method. If there's a settings toggle, it's a broken control. Implement (negate `input.y` in `tick`) or remove the toggle. | Bug | **High** | S |
| F2.5 | Passive-listener hygiene good (`{passive:false}` on preventDefault handlers; multitouch disabled on the live joystick). No responsiveness red flags. | Good | — | — |
| F2.6 | `simple-flight-controller.js` allocates per-frame (`new Euler` 77, `new Vector3` 81, `.clone()`×3 95–100) but is **test-only** (imports bare `three`). Fine as a fixture. | Code quality | Low | — |

**Cameras.** Live FOLLOW is `BirdCamera` (`bird-camera.js`, `index.html:8097`); legacy `createCameraState` rig handles FPV/Sequence/Fixed (8100); turret sets camera directly (8090–8094).

| # | Finding | Class | Pri | Effort |
|---|---|---|---|---|
| F3.1 | **Three different frame-rate-independence formulas.** `bird-camera.js:85` `1-pow(smoothing,dt*60)` (correct). `follow-camera.js:21–32` & `sequence-camera.js:15–26` `resolveWeight` `1-pow(1-d,min(step*60,1))` (correct but **stops compensating <60fps** → camera lags on slow devices). `fpv-camera.js:132–138` `getDampedAlpha` `1-exp(-λ*step)` (textbook). Standardize on the exp form, express damping as per-second rates. | Code quality | Medium | S |
| F3.3 | **`BirdCamera.update` sets `camera.up` AFTER `lookAt`** (90–96). `lookAt` consumes `camera.up` at call time, so each frame uses the *previous* frame's up. Self-corrects with one-frame lag on a sphere; can wobble/tilt on fast traversal/poles. Set `up` before `lookAt`. | Bug | Medium | S |
| F3.2 | `snap()` (102–105) calls `update(...,1)` with dt=1 to force `alpha≈1`. Works but smells; the `_initialized` guard already handles first frame. | Polish | Low | S |
| F3.4 | Motion-sickness posture is well-considered: `computeStableUp` (60–89) guards the pole zone; `CAMERA_BREATH` small (±0.05u, 0.4Hz, position-only 377–389); `fpv-camera.js` strips ambient bob/rotation (105–113). No red flags on the live path. | Good | — | — |
| F3.5 | `BirdCamera` ignores velocity/steering look-ahead; the richer anticipation lives only in the unused `follow-camera.js`. Deliberate "simpler, tighter" per comment 6934. Enhancement: port look-ahead into `BirdCamera` or drop `follow-camera.js`. | Enhancement | Low | S |
| F3.6 | Possible one-frame pop on FOLLOW↔FPV handoff: `BirdCamera._currentPosition` and `cameraState.position` are independent, not synced at the `currentMode` switch (8095–8101). Likely minor given blend durations; playtest rapid camera-cycling. | Feel/UX | Low | S |

**Knockdown / tumble / flap-walk (`index.html`).** State machine `applyFlightRecoveryState` (5465+) readable; launch realign (7223–7234) correctly re-projects forward onto the tangent plane + `makeBasis` (the right fix for "can't turn after a tumble"). Fall ramp (7998–7999) and radial impulse (8003, 8014) are dt-scaled correctly. Flap/walk driven off accumulated `motionState.elapsed` (frame-rate independent); mirror-sign handling for the `scale.z=-1` right wing (8172–8175) correct + well-commented; `isWalking` gate (`isGroundedVisual && inputState.active`, 8196) matches spec. *Nits:* F4.2 `_launchFwd.clone().negate()` (7233) allocs in the tap handler (Z7); tail lerp `min(1,delta*8)` (8189) approximately fps-independent (pure form `1-exp(-8·dt)`).

**Zero-alloc audit (flight domain):** live flight/camera/animation hot path is clean **except Z1** (`index.html:8111` — the highest-value cheapest fix, see Theme B). `camera-state.js` `updateFollow` (337) clones velocity/position but runs only on the non-live FOLLOW path — another reason to converge the camera stacks.

### 4.3 Environment, Rendering & Performance

**F1 — Per-frame collision is an O(n) linear scan. [High · M]**
`index.html:8031` calls `collisionSystem.checkObjectCollision` every frame in free flight. `SphericalCollisionSystem.checkObjectCollision` (`spherical-world.js:77–103`) is a flat `for…of` loop over **~700 (mobile) / ~1,200 (desktop)** colliders — per-collider math is zero-alloc (`copy().sub()`+`lengthSq()`) but there's no broad phase. Forest desktop ≈ 132 trees×2 + 420 scatter×2 + 70 rocks + 20 clouds ≈ 1,184; forest mobile ≈ 700. That's ~42k–72k sphere tests/sec, and the cost **grows with every densification pass** (CLAUDE.md log shows counts only rising). *Fix:* wire the dead `OptimizedCollisionSystem`/`SpatialHashGrid` from `optimized-collision.js` (colliders are static after build → one-time insert + per-frame cell query → single digits), or a lightweight inline uniform grid keyed by `placeOnSphere` direction. See Theme C.

**F2 — Dead code (~3,900 LOC). [High clarity / Low runtime · S]** See A-3 / Theme A. The CLAUDE.md "Key Files" table lists `performance-manager.js`/`object-pool.js`/`lod-system.js` as if live — inaccurate.

**F3 — Drone explosions: un-pooled spike. [Medium · M]**
`createDroneExplosion` (`drone-system.js:106–285`) per kill: 1 flash + 2 rings + 12 shards + 30 sparks + 15 embers = **~60 `Mesh` + ~60 `MeshBasicMaterial`** (all transparent, `AdditiveBlending`, `depthWrite:false`) + ~100+ `Vector3`. Disposed ~0.6–1.2s later (`disposeExplosion` 372). Each live explosion = ~60 extra **non-instanced** draw calls + additive overdraw, exactly during dense Drone Hunter kills — two concurrent ≈ 120 transient draw calls (past the <100 budget) + GC churn. Geometry partially shared (shard/spark/ember geom once per explosion; shared shard geom disposed 12× — idempotent, harmless). *Fix:* pool explosion rigs across kills, or convert each particle class to one `InstancedMesh`/`THREE.Points` burst — `optimized-particles.js` already implements a draw-range Points burst for exactly this (Theme C). *Secondary:* `effects/particles.js` `createExplosion`/`createSparkle` (195,251,317) allocate per burst; `createSparkle` fires every ring collect (`index.html:7756,7901`) — Z9.

**F4 — Small per-frame allocs. [Medium · S]** `getDrones()` filter (Z4), rocket clones (Z5). `getStats()`/`getCount` are fine when not per-frame.

**F5 — Light count. [Low–Medium · S]**
Scene rig `index.html:4660–4678` = 5 lights (1 Hemi + 3 Directional + 1 Point); `spherical-world.js:2309` adds 1 Hemi mobile / 7 desktop. **Mobile total 6, desktop 12.** Every `MeshLambertMaterial` fragment loops all active lights (the ~24k-tri ground + instanced props fill a lot of screen). 6 mobile is borderline-acceptable (the `:2278` comment correctly gates the desktop rig off mobile). *Opportunity (Low, measure first):* fold the point `glowLight` + a fill on mobile to 3–4 lights.

**F6 — `birb.glb` 1.7 MB + audio load budget. [Low · S]**
`index.html:6343` always loads `./birb.glb` and swaps it over the procedural bird if it loads — but CLAUDE.md describes the **procedural** bird as shipped, so the 1.7 MB GLB may be redundant download on every cold load (async, non-blocking — a *load-budget*, not frame-budget, concern). `ambient-mountain.mp3` is **5.6 MB**, `ambient-forest.mp3` 1.4 MB, `info.jpg` 700 KB. *Recommendation:* confirm GLB-vs-procedural intent (drop GLB if procedural, else Draco/meshopt); confirm audio is lazy/per-environment not eager all-at-once.

**F7 — Env-switch dispose hygiene. [Clean]** `createSphericalWorld().dispose()` (`spherical-world.js:2381–2404`) removes root + `traverse`s disposing geometry + materials (incl. CanvasTexture `.map`/`.emissiveMap`). Shared unit geometries (`boulderUnitGeom`, canopy cones) get `dispose()` once per referencing mesh — idempotent/harmless in three.js, not a leak. `displaceSphereGeometry` allocates color/displacement `Float32Array`s once per build (512,516) — fine.

**F8 — Renderer config well-tuned. [Positive]** `WebGLRenderer` (3394): `antialias:!isMobile`, `powerPreference` mobile→high-performance/desktop→low-power, `preserveDrawingBuffer:false`, `shadowMap.enabled=false`. `DPR_CAP` 1.2 mobile / 1.8 desktop. `FogExp2` density mobile-trimmed (4012). Full-screen BackSide sky sphere already removed (2322); `cloudShell` null on mobile (4031). Mobile fill-rate responsibly managed.

**F9 — Adaptive quality is real and wired. [Positive]** `adaptiveTier` IIFE (`index.html:6441–6505`) samples FPS over 2s/4s windows with anti-flip-flop dwell; on sustained <55fps drops DPR 1.2→1.0→0.85 + hides cloud shell. This is the *actual* system (NOT the dead `PerformanceManager`). *Enhancement (Low):* at tier 2 also cull canopy ceilings or reduce drone target.

**F10 — Rocket raycast. [Low · S]** `rocket.js:287` `intersectObjects(collisionTargets,true)` recursive, allocates a results array internally; gated to in-flight rockets (few). Confirm `collisionTargets` is a small curated list, not the whole world root (instanced props would spike per-rocket cost).

**Frame-budget verdict (mid-range mobile):** steady-state draw calls ~40–70 (well within budget). The transient spike risk is F3 drone explosions (~60 non-instanced each; 1–2 concurrent kills momentarily exceed 100 — the most likely felt Drone Hunter hitch). Fill rate responsibly gated. CPU/frame dominated by F1 collision scan + small allocs (both cheap to fix). Heap <50 MB; GC *churn* (F3+F4) is the concern, not footprint. Load time dominated by F6 (1.7 MB GLB + up to 7 MB audio).

### 4.4 UI, UX & Game Design

**Entry flow — strong.** Deferred loop (`startGameLoop`/`pendingGameStart`/`gameLoopStarted` 2915–2919, started only at Tap-to-Start 3044); Title revealed *under* the fading Vibe page (2944) so the canvas never peeks; `<main hidden data-game-main>` (2574) unhidden only on Start (3041); audio unlocked in the Start gesture (`unlockAudio()` 3037). Exemplary.

| # | Finding | Class | Pri | Effort |
|---|---|---|---|---|
| 5.1 | **CRITICAL — reduced-motion = unplayable.** `controlState.systemPaused = motionQuery.matches` (6400) + `motionState.animate = !motionQuery.matches` (6358); change-listener re-pauses (6698–6700). A `prefers-reduced-motion:reduce` user taps Start and the bird never moves — a holdover from the "ambient lab demo" framing. *Fix:* don't pause; use the query to gate *decorative* motion (shake, speed lines, drifting feathers, particle volume) while core flight runs. | UX bug / A11y | **Critical** | S |
| 3.1 | **CRITICAL — Ring Rush ring count broken three ways (+PRD).** `collectibles.js RING_COUNT=18` (spawns 18, verified). `miniGameState.ringsTotal=10` default (5001) and `startGameMode` never re-syncs it (5108–5133). Win `ringsCollected>=ringsTotal` (7766) fires at **10 of 18** → race ends early, HUD reads "10/10", 8 rings still floating. Mode-select copy says "all **10** rings" (2711). PRD §6 says **20** (288/296/305). *Fix:* set `miniGameState.ringsTotal = collectiblesSystem.count` in `startGameMode`; reconcile copy + PRD to 18. | UX bug | **Critical** | S |
| 5.2 | **HIGH — no screen-shake / motion-intensity control.** Shake fires on tree-impact, ground-land, nest-hit, drone-destroyed, ring-collect (5476–7850). The `ScreenShake` instance (4148) is a single chokepoint — easy to gate. Add an intensity slider/off in Settings. Pairs with 5.1. | A11y / Missing affordance | **High** | M |
| 3.4 | **HIGH — Turret Defense drone AI allocates every frame** (7822–7842): `nestPos.clone()`, `new Vector3()` for tangent/side, `.clone().multiplyScalar()` chains, per drone per frame. House Rule #4 violation + GC hitch risk in dense waves. Pre-allocate `_tmpDir`/`_tmpTangent`/`_tmpSpiral` (Z3). | Perf / Bug | High | M |
| 7-share | **HIGH — no `navigator.share`** anywhere. Results screen (2752–2762) is the natural home for "I scored X in Birb Mobile" + URL — the biggest free distribution lever. | Delight / Retention | High | S |
| 4.1 | **HIGH — distinct ring-collect SFX missing.** `ringCollect`/`speedBoost`/`nestLand` alias `rocket-fire.mp3`; `droneDestroyed`→`explosion.mp3` (3505–3510). Ring collect is the single most-repeated action; a real short bright `ring-collect.mp3` is the highest-ROI audio task. The pitch-shift combo-semitone logic (3753–3755) already waits for a tonal asset. | Friction / Delight | High | M |
| 6.2 | **MEDIUM — SW auto-reloads mid-session.** On installed+controlled, banner then `reloadForUpdate` after 1500ms (8688–8696) + 60s poll + visibility poll (8681–8684). Can reload a player out of an active Drone Hunter run. Gate on `!miniGameState.active` or make it tap-to-update. (`RELOAD_FLAG` sessionStorage prevents loops — good.) | Friction | Medium | S |
| 2.2 | HUD top-center over the brightest sky; text-shadow helps but legibility marginal at 1.5rem. Add a subtle pill/scrim behind `.hud-top`. | Polish | Medium | S |
| 2.5 | Results screen has no share hook + only one stat (2754–2757) — the natural retention moment. | Friction | Medium | M |
| 3.2 | Turret Defense wave counts inconsistent: default `waveSpawnCount:4` (5007), `startGameMode` resets to 3 (5119), transition sets `2+wave` (7873). The init value (4) is dead. Pick one curve + document. | Friction | Medium | S |
| 3.5 | No per-mode onboarding. Ring Rush has a one-line hint (5053–5056); Drone Hunter/Turret drop the player in cold — Hunter players must *discover* they shoot from nests. Add a 2s "Land on a nest, then aim & fire" banner on first entry. | Missing affordance | Medium | S |
| 5.3 | Color-blind safety: drones red `#ff4d4d`, rings yellow `#ffd84a`, forest rings `0x44ff88` over green foliage (low contrast for everyone); red-only drone minimap markers are the deuteranopia trap. Add shape/icon differentiation + high-contrast minimap palette option. | Polish | Medium | S |
| 1.1 | No perceived-loading affordance: static `splash.jpg` + "Tap to start" (2479–2484); on slow networks the GLB/three/nipplejs may still be loading at Start → revealed-but-empty canvas, no spinner. Add a "Loading…" Start-button state until the scene is ready. | Friction | Medium | S |
| 2b.1 | Joystick zone is the entire canvas (`.touch-controls__zone{inset:0}` 159); buttons win via z-index + `pointer-events:auto`, but a touch starting on empty sky near a button + dragging can still grab the stick. Watch the bottom action cluster. | Polish | Medium | S |
| 2.6 | Zen copy promises "soft chimes when you drift through a ring" (2701) but Zen hides rings entirely (`setVisible(mode===RING_RUSH)` 5132) — promise unreachable. Add ambient Zen rings or fix copy. | Polish | Low | S |
| 2.3 | Minimap "too zoomed-out" — **already fixed** (mode-aware `visibleRadius` 65/70/80/95, 4383–4389). CLAUDE.md open item is stale; close it. If still sparse, drop Ring Rush to ~55. | Polish | Low | S |
| 2.4 | Minimap is draggable + viewport-clamped (4174–4207) — nice, but drag position not persisted across reloads. Persist `left/bottom` to localStorage. | Delight | Low | S |
| 2b.2 | `createTouchInput().get()` returns `{...state}` — per-call alloc (touch-input.js 52, Z6). Return live `state` or a reused out-object. | Friction | Low | S |
| 2b.3 | Hit targets under iOS 44px min: `.canvas-action-button` 2.6rem ≈ 41.6px (321–326); `.lift-button` ~32px tall via padding. Bump to ≥44px (padding or invisible hit-slop). | Polish | Low | S |
| 2b.4 | Manifest `orientation:portrait` locked but iOS Safari ignores it; landscape HUD untested. Add a "rotate to portrait" hint or landscape pass. | Polish | Low | S |
| 3.3 | PRD describes a `src/game-modes/*.js` architecture that **does not exist** (all inline in `index.html`) — reads as aspirational, misleads students. Note "implementation consolidated in index.html" in the PRD. | Friction | Low | S |
| 4.2 | Two sound panels (`data-title-settings` toggles vs `data-sound-settings-overlay` with the master slider) — can drift. Consolidate or share state. | Polish | Low | S |
| 4.3 | No ducking of ambient music under SFX / on results — explosions over music can muddy. Optional. | Polish | Low | S |
| 5.4 | Canvas is `role="img"` with a static label (2577) — screen-reader users get no game state. Out of scope for a 3D arcade game; one-line note only. | Polish | Low | S |
| 5.6 | Left-handed mode is effectively free (dynamic joystick spawns where you touch, `mode:'dynamic'` touch-input.js 25) but invisible. A one-line How-to-Play hint turns an accidental feature into a selling point. | Delight | Low | S |
| 6.1 | **Eruda already removed** (0 refs, verified). CLAUDE.md Known Issue #2 is stale; close it. 19 `console.*` remain (mostly load-failure warns) — acceptable; could gate behind `?debug`. | Polish | Low | — |
| 6.3 | Manifest thin: single SVG icon `purpose:"any"` (12–18), no maskable, no 192/512 PNG, no 180×180 apple-touch-icon. Add for a proper installed experience. | Polish | Low | S |
| 6.4 | No `og:image`/`twitter:card` — links render bare. Reuse `splash.jpg` + `summary_large_image`. Cheap distribution win. | Polish | Low | S |
| 6.6 | GLB load failure → procedural fallback (6351–6353, good); audio failure swallowed by `.catch(()=>{})` everywhere — a single "audio unavailable" state would aid debugging. | Polish | Low | S |
| 1.2 | `splash.jpg` not `<link rel="preload">`'d in `<head>` (only `<img>` 2481/2518) — in SW CORE_ASSETS so repeat visits fine, but first paint would benefit. | Polish | Low | S |
| 1.3 | Vibe splash gated by `sessionStorage('vibe-splash-shown')` (2928) but the primary splash shows every load — confirm intended per Birb Labs spec. | Friction | Low | S |
| 3.6 | Juice is solid (combo popup/timer/multiplier, kill vignette, wave banner, countdown, speed lines, shake, haptics). Consider extending combo to Ring Rush (PRD hints). | Delight | Low | S |

**Audio — good iOS strategy.** HTML `Audio` pools (`SOUND_POOL_SIZE=3`, 3476–3535), preloaded, unlocked in Start gesture, persisted settings (`birb_masterVolume/sfxEnabled/musicEnabled` 3456–3467), master×base mixing (`getEffectiveVolume` 3470), music starts only after Start (3050). Pragmatic asset aliasing with an honest comment.

**Touch ergonomics — good.** `touch-action:manipulation` (41,54), `touch-action:none` on canvas/zones, `-webkit-tap-highlight-color:transparent`, `user-scalable=no`+`maximum-scale=1` (7), `gesturestart` prevented (2905), `EDGE_SWIPE_GUARD_PX` (2900). Dynamic joystick = ambidextrous-friendly.

---

## 5. Deliberate Trade-offs — Do NOT "fix" these

These look like problems but are load-bearing decisions, most documented in CLAUDE.md. Respect them.

- **`CONTINENT_BIAS` (0.35).** Deliberately shifts the continental noise field negative so average ground sinks into rolling lowlands — the only way to fake "rolling relief" given the gravity-less floor can't raise terrain above baseline. CLAUDE.md explicitly says "Do NOT 'fix' `CONTINENT_BIAS` away thinking it's a bug."
- **`Math.min(0,…)` terrain floor clamp.** Load-bearing: with no gravity, a floor rising above baseline would ratchet the cruising bird upward. The floor only ever dips into valleys. Carving is downward-only for the same reason (rises stay visual via the detail mesh + tall instanced props). `bird-flight.js`, `checkGroundCollision`, and `forceGroundedPose` all agree on this floor — verified consistent.
- **No bundler / pinned CDN ES6 imports.** A core constraint and part of the teaching story. Don't introduce webpack/vite. (An import map is build-free and *aligned* with this — see A-8.)
- **Committed `node_modules/three/index.js` shim** (9.8 KB, whitelisted in `.gitignore`). Lets the Node test harness `import 'three'` without a network fetch. Not the committed-deps antipattern.
- **`basic/index.html`** (703 lines) — the intentional Rosetta-Stone reference for students. CLAUDE.md First-Steps points here.
- **Single-file `index.html` entry** — the *single-file* choice is defensible (no build step, whole game flow readable in one place). The *internal overgrowth* is the issue, not the single-file decision per se.
- **Zero-allocation `_`-prefixed scratch objects** — the project's discipline; respect it (and the violations in §Theme B are exactly where it's being *broken*, not where it should be loosened).

---

## 6. Prioritized Roadmap

### (a) Critical correctness / accessibility — do first

| # | Action | Where | Effort |
|---|---|---|---|
| C1 | Stop pausing the game on `prefers-reduced-motion`; gate decorative motion instead (shake, speed lines, feathers, particle volume) | `index.html:6400`, 6358, 6698–6700 | S |
| C2 | Set `miniGameState.ringsTotal = collectiblesSystem.count` in `startGameMode`; reconcile mode-select copy (2711) + PRD to 18 | `index.html:5001,5108–5133,2711`; `collectibles.js:11` | S |

### (b) Quick wins — S effort, High impact

| # | Action | Where | Effort |
|---|---|---|---|
| Q1 | Hoist a module-level `_emptyAmbient` constant to kill the per-frame Vector3/Quaternion alloc (Z1) | `index.html:8111` | S |
| Q2 | Add a screen-shake / motion-intensity control in Settings, gating the `ScreenShake` instance | `index.html:4148` | S |
| Q3 | Add a `navigator.share` button to the results screen (clipboard fallback) | `index.html:2752–2762` | S |
| Q4 | Implement or remove `invertPitch` (it's a silent no-op today) | `bird-flight.js`, `index.html:7014,7017+` | S |
| Q5 | Gate SW auto-reload on `!miniGameState.active` | `index.html:8688–8696` | S |
| Q6 | Fix `getDrones()` to reuse a persistent `_aliveDrones` array (Z4) | `drone-system.js:626` | S |
| Q7 | Add `ambient-mountain.mp3` to SW CORE_ASSETS | `sw.js` | S |
| Q8 | Realign CLAUDE.md: eruda removed, minimap fixed, `free-flight-controller.js`→`simple-flight-controller.js`, drop dead Key Files | `CLAUDE.md` | S |
| Q9 | `BirdCamera`: set `camera.up` before `lookAt` (F3.3) | `bird-camera.js:90–96` | S |

### (c) Medium-term — extractions, broad-phase, pooling, onboarding

| # | Action | Where | Effort |
|---|---|---|---|
| M1 | Wire the dead `optimized-collision.js` spatial hash (or an inline uniform grid) to replace the O(n) scan — kills the densification scaling cliff | `spherical-world.js:77–103`, `index.html:8031`; `optimized-collision.js` | M |
| M2 | Pool drone explosions or convert to InstancedMesh/Points bursts (harvest `optimized-particles.js`) — removes the Drone Hunter draw-call + GC spike (Z2) | `drone-system.js:106–285` | M |
| M3 | Pre-allocate scratch vectors in the Turret Defense drone loop (Z3) | `index.html:7822–7842` | M |
| M4 | Add a deadzone (~0.12) + expo (~0.3) to the live `touch-input.js` so the documented feel is real (F2.2) | `touch-input.js` | S |
| M5 | Per-mode 2s onboarding banner (esp. "land on a nest to shoot" for Hunter/Turret) | `index.html` game-mode start | S |
| M6 | Ship a real `ring-collect.mp3`; point `SOUND_ASSETS.ringCollect` at it | `sound/`, `index.html:3505–3510` | M |
| M7 | Add an import map; route all three.js imports through bare `three`/`three/addons/` | `index.html` `<head>` | S |
| M8 | Unify the three camera damping idioms onto `1-exp(-λ·dt)` (F3.1) | `bird-camera.js`, `follow-camera.js`, `sequence-camera.js`, `fpv-camera.js` | S |

### (d) Long-term / strategic

| # | Action | Effort |
|---|---|---|
| L1 | Extract the cleanest monolith seams (`game-modes.js`, `flight-recovery.js`, `minimap.js`) as plain ES modules with explicit deps + `update(delta)`; keep `index.html` the conductor. Removes ~1,200–1,500 lines and unlocks unit tests. | L |
| L2 | Pair the extractions with `node --test` suites (`flight-recovery.test.js`, `game-modes.test.js`) using the existing injected-dep style. | M |
| L3 | **Teaching-artefact curation of dead code:** wire `optimized-collision.js` (M1), harvest `optimized-particles.js` (M2), then delete or move the rest of `src/performance/` + `simple-flight-controller.js` + `ambient-particles.js` + `speed-trail.js` to a labelled `attic/`/`reference/` with "NOT WIRED" headers. ~3,900 lines off the apparent surface. | M |
| L4 | Resolve the dual input/camera stacks — pick one owner, delete/attic the other (F2.1, F3.5). | M |
| L5 | Doc realignment + archive: `docs/archive/` for stale 04-18 docs, `ULTRA-REFACTOR-REPORT.md`, `AGENT_LOG.md`, `codex.md`, `mobiletest.html`; date-stamp the rest; banner `AR/`. | S |
| L6 | Centralize the FLYING/GROUNDED/NESTED phase into one explicit owner with a validating setter. | M |

---

## 7. For Vibe Academy Students

### What this codebase does exceptionally well — worth studying

- **The deferred render loop.** Nothing animates behind the splashes; `<main hidden>` until Tap-to-Start, audio unlocked inside the Start gesture, the Title revealed *under* the fading Vibe page so the canvas never peeks. This is how you build a mobile web game that doesn't burn battery or trip iOS autoplay rules. (`index.html:2915–3050`)
- **The service worker (`sw.js`).** The single best-engineered file here. Study the strategy matrix (network-first navigation, stale-while-revalidate JS, cache-first media), the per-asset install, and especially `rangeRespond` — the HTTP 206 slicing that makes `<audio>` work on iOS Safari. This is real production PWA craft.
- **The zero-allocation scratch pattern.** Look at `bird-flight.js` (`this._scratch`, lines 73–92) and how `update`/`yaw`/`pitch` reuse it with zero `new` in the hot path. This is *the* technique for steady 60fps on mobile. (Then look at the §Theme B violations to see the contrast — the rule being broken is as instructive as the rule being kept.)
- **The spherical flight fix.** `bird-flight.js` solves a bug that took months: a bird that flew in a fixed world direction regardless of facing. The fix is parallel transport (`setFromUnitVectors`) + sphere re-projection + vector-based forward tracking. Read `KNOWN_ISSUES.md` Issue 5 for the saga, then the code. A genuine masterclass in quaternions on curved surfaces.
- **Dispose hygiene.** `spherical-world.js dispose()` (2381–2404) shows how to tear down a Three.js scene without leaking GPU memory across environment swaps — geometries, materials, and CanvasTextures all released.
- **Self-documenting load-bearing decisions.** The CLAUDE.md notes on `CONTINENT_BIAS` and the `Math.min(0,…)` floor are exemplary: they explain *why* a weird-looking constant must stay, so a future maintainer doesn't "fix" it into a bug.

### Where to be careful — documented files that are dead

If CLAUDE.md or the PRD points you at one of these, the file **does not affect the running game** — edit it and you'll see no change:

- **`src/performance/` (all 9 files)** — listed in Key Files as if live; nothing imports it. The real adaptive quality is `index.html:6441`.
- **`src/controls/flight-controls.js`, `thumbstick.js`, `virtual-thumbstick.js`** — the documented "tweak the feel: deadzone/expo/smoothing" path is **inert**. Live touch is `src/flight/touch-input.js` (raw clamp) → `bird-flight.js`.
- **`src/controls/simple-flight-controller.js`** — test-only fixture, not the runtime controller.
- **`src/environment/ambient-particles.js`, `speed-trail.js`** — orphaned.
- **`free-flight-controller.js`** — cited by CLAUDE.md but **does not exist**; the legacy controller's history lives in `KNOWN_ISSUES.md` Issue 5.

To change how flight *feels*, edit `src/flight/bird-flight.js` (speeds, rates, damping) and `src/flight/touch-input.js` (the live input). To change a game mode, search `GAME_MODES` / `startGameMode` in `index.html`. The Key Files table and PRD are aspirational in places — trust the import graph over the docs until the doc realignment (Q8/L5) lands.
