# Birb AR — High-Level Specification

> Status: **prototype shipped 2026-08-07** — phases 1-3 complete and verified
> headlessly; phase 4's real-iPhone pass is the outstanding gate. Owner: Mentis.
>
> **What shipped:** `/ar` redirect + `AR/` hub (shooter preserved), `sw.js`
> bypass, `gauntlet/ar/` app (camera passthrough, gyro pinning, drag/pinch
> placement, GO!, Gauntlet free-flight rendered to a texture on the screen,
> joystick + BOOST on glass, reposition, wake lock), and `tools/ar-shot.mjs`.
> Measured at 23 draw calls / 23.9k triangles for both passes — inside the
> <100 / <80k budget.
>
> **Not yet done:** real-device performance pass; three-finger QR; audio; modes
> beyond free flight (rings, drones, nesting); Android WebXR hit-test path.
> Deviations from the plan below are recorded in §11.

## 1. Product summary

**Birb AR** is a "magic window" augmented-reality mode for Birb Mobile, served at
`birbmobile.vercel.app/ar`. You open it on your phone, grant camera + motion
access, and a floating **Birb Mobile screen** appears in your room through the
camera view. You drag it to position it, pinch to resize it, tap **Go!** — and
the game starts playing *on that screen*, pinned in space, while the familiar
thumbstick and boost controls sit on the phone glass over the camera view.

The `/ar` page is also a small hub that preserves and links the **original AR
Shooter** prototype (the 2025 camera+gyro target-shooting test bed already
living in `AR/`).

### Explicitly in scope (prototype)
- iPhone Safari first (iPhone 12+), Android Chrome second.
- Camera-passthrough + gyroscope screen pinning (rotation-only tracking).
- One game mode on the screen: Gauntlet **Casual** (free flight, cannot fail).
- Placement UX (drag / pinch / Go!), on-glass flight controls.
- Old AR Shooter preserved, reachable, and SW-safe.

### Explicitly out of scope (prototype)
- True world anchoring / walking around the screen (needs WebXR or native — §7).
- Sound design, scores, modes beyond Casual, multiplayer, persistence.
- Any change to Birb Mobile's main game or Gauntlet's existing entry points.

## 2. Platform reality (why the design is what it is)

- **iOS Safari has no WebXR `immersive-ar` (still true in 2026).** No ARKit,
  no plane detection, no positional tracking from the browser. The viable web
  pattern is: fullscreen `<video>` from `getUserMedia` (rear camera) +
  `DeviceOrientationEvent` driving a Three.js camera. The virtual screen holds
  its *direction* in the room as you look around; it does not respond to you
  physically moving. Gyro drift over minutes is acceptable for a demo session.
- **Android Chrome supports WebXR `immersive-ar` + hit-test** (real plane
  anchoring). Planned as a progressive enhancement, not part of the prototype.
- iOS handling that is mandatory, not optional:
  - `DeviceOrientationEvent.requestPermission()` must be called inside a user
    gesture (iOS 13+).
  - Camera requires HTTPS (Vercel provides it) and a
    `playsinline muted autoplay` video element.
  - Screen Wake Lock during play (pattern already shipped in Birb Mobile).

## 3. Codebase decision: build on Gauntlet

The game rendered on the AR screen is **Birb Gauntlet's Casual mode**, not the
main Birb Mobile game. Rationale:

| Concern | Birb Mobile (`/`) | Gauntlet (`/gauntlet`) |
|---|---|---|
| Extractability | ~5,600-line `index.html` owns loop, UI, audio, quality inline | Importable ES modules (`src/world`, `src/bird`, `src/input`, `src/game/modes.js`) + a thin boot |
| Assets | mp3s, nipplejs CDN, GLB, service-worker entanglement | **Zero external assets**, own joystick, seeded RNG |
| Demo-safe mode | Casual wired through the monolith | `modes.js` capability table; Casual literally cannot fail |
| Verification | manual | `tools/gauntlet-shot.mjs` harness + `__GAUNTLET_STATS()` |

**Isolation rule resolution:** Gauntlet's invariant is "nothing outside
`gauntlet/` imports from inside it." Rather than relax it, the AR game boot
lives **inside Gauntlet** at `gauntlet/ar/`, and `/ar` routes there. The
invariant survives untouched.

## 4. Architecture

### 4.1 URL & directory layout

```
/AR/                      (existing dir, capital — kept; new lowercase ar/ dir is
 │                         FORBIDDEN: case-insensitive filesystems break checkout)
 ├── index.html           REWORKED into the Birb AR hub: device checks (kept),
 │                         links → Birb AR + AR Shooter + test pages
 ├── game.html            original AR Shooter — PRESERVED, untouched paths
 ├── test-camera/gyro/3d  original test pages — preserved
 ├── js/, css/            original shooter modules — preserved; camera.js and
 │                         gyro.js are also the reference for the new port (§4.3)
gauntlet/
 └── ar/
     ├── index.html       Birb AR app: permission flow, placement UX, controls
     └── src/             AR-only modules (ar-camera.js, ar-gyro.js, screen.js,
                           placement.js, boot.js)  — boot.js imports ../src/*
vercel.json               NEW: rewrites  /ar → /AR/index.html  (hub)
sw.js                     SIBLING_ARTEFACTS += '/AR', '/ar'
```

- The hub's "Birb AR" button links to `/gauntlet/ar/`.
- Both pages are unlisted per house convention: `noindex`, linked from nowhere
  but the hub.

### 4.2 Rendering pipeline (one WebGL context, two passes)

```
getUserMedia video  (DOM layer 0, fullscreen, playsinline)
        ▲
WebGL canvas, alpha:true, transparent clear   (DOM layer 1)
  pass 1: gauntlet scene  → WebGLRenderTarget (~1024×640, DPR-independent)
  pass 2: AR scene (gyro camera) → screen plane textured with pass-1 target,
          plus a code-generated bezel/glow frame
Controls + HUD  (DOM layer 2: joystick zone, boost pill, Go!/reset buttons)
```

- Render-target resolution is fixed and modest; the game occupies a fraction of
  the display, which roughly funds the second pass. Gauntlet's DPR caps apply
  to the composite pass.
- Zero-allocation rules apply to both passes (house rule #4).
- Three.js pinned `three@0.183.2` from esm.sh, same as both parents.

### 4.3 Tracking & placement

- Port `AR/js/camera.js` and `AR/js/gyro.js` to ES modules on Three 0.183.2
  (they are r128 global-script code today). The gyro math (Euler → quaternion,
  screen-orientation correction, gimbal-lock avoidance) carries over as-is.
- The screen is a plane at fixed distance `d` (default ≈ 2 m equivalent) from a
  fixed viewer origin. Placement mode:
  - **One-finger drag** → raycast onto the sphere of radius `d`, screen follows.
  - **Pinch** → scales the plane (clamped, e.g. 0.5×–3×).
  - Gyro keeps it pinned while looking around; there is no positional tracking.
- **Go!** freezes placement, starts the run, swaps placement gestures for the
  flight joystick. A small **↺ reposition** button returns to placement.

### 4.4 Input

- Gauntlet's own `gauntlet/src/input/touch.js` joystick is bound to the AR
  page's DOM overlay (it is a self-contained module; this is its designed use).
- Placement mode and flight mode are mutually exclusive input states; the boot
  owns the switch. No touches are forwarded into iframes — there are no iframes.

### 4.5 Game boot contract (`gauntlet/ar/src/boot.js`)

A slim (~300-line) alternative to `gauntlet/index.html`'s boot:
- builds world + bird + Casual mode from existing modules,
- accepts an injected `{ renderer, renderTarget }`,
- exposes `start()`, `pause()`, `tick(now)` — the AR page owns rAF,
- respects `nesting.update()` before `flight.tick()` ordering and every
  documented Gauntlet invariant (see `gauntlet/ARCHITECTURE.md`).

## 5. Preserving the original AR Shooter

The shooter already works in production (`/AR/game.html`) — preservation means
not breaking it while building around it:

1. **Do not move or rename** `game.html`, `test-*.html`, `js/`, `css/`.
2. **SW bypass `/AR`** (and `/ar`). Without it, one visit to any `/AR/*` page is
   cached by `networkFirst` under `./index.html` and replaces Birb Mobile's
   offline shell — the exact bug `/gauntlet` was bypassed for.
3. Its Three **r128 cdnjs** script tag stays (it is legacy, exempt from the
   zero-external-asset rule). Deploy-time check: load `/AR/game.html` on device
   and confirm the CDN resolves; if cdnjs ever dies, vendor `three.min.js`
   (r128, ~600 KB) into `AR/js/` — a one-line fix.
4. The reworked hub keeps the original device-check cards and links the shooter
   as "AR Shooter (classic)".

## 6. Permission & entry flow

```
/ar (hub) ──► Birb AR ──► [Tap: Enable camera & motion]   (single gesture:
                              getUserMedia + DeviceOrientation.requestPermission)
                    ├─ denied → friendly fallback card, retry button
                    └─ granted → PLACEMENT (drag/pinch, live splash on screen)
                                   └─ [Go!] → FLYING (controls on glass)
                                                └─ [↺] back to PLACEMENT
```

Splash treatment: the Birb Labs artefact treatment applies to the hub page
styling; the AR app itself goes straight to the permission card (an AR page
that opens with three splashes before the camera is a worse demo).

## 7. What an iOS native port opens up

Ordered from cheapest to most capable:

1. **Web app in an ARKit shell (e.g. Variant Launch–style App Clip / custom
   WKWebView shell exposing WebXR).** The entire JS/Three codebase survives.
   Unlocks: real 6-DoF positional tracking, plane detection ("put the screen
   ON the table" like the Quest diorama reference), hit-test placement, no
   per-session permission prompts. Cheapest path to true anchoring.
2. **Full native (Swift + ARKit + RealityKit/Metal).** Everything above plus:
   - **LiDAR scene depth & people occlusion** — the screen hides behind
     furniture and people walk in front of it; the single biggest realism jump.
   - **Persistent world maps** — the screen stays where you left it between
     sessions; shareable multi-device anchors (two phones see one screen).
   - **Light estimation** — the screen's glow matches the room.
   - Core Haptics, Game Center, push, App Store presence, Metal-level perf.
   - Cost: the game itself must be rebuilt or embedded; per-frame texturing of
     a WKWebView onto an AR plane is not a supported 60 fps path, so "native
     shell, web game on the plane" is *not* a shortcut here — that's what
     makes option 1 attractive.
3. **visionOS** — Birb Mobile as a floating window/volume in Vision Pro is
   nearly free once content is native, and matches the reference screenshot's
   vibe most literally.

Recommendation if/when the web prototype proves the concept: option 1 first —
it converts this exact codebase from rotation-only to true anchoring.

## 8. Performance budget & verification

- Budget: 60 fps target / 30 fps floor on iPhone 12, <100 draw calls total
  across both passes, RTT fixed at ~1024×640, composite DPR ≤ 1.4.
- Harness: extend the Gauntlet screenshot-harness pattern with
  `tools/ar-shot.mjs` (fake camera via Chromium
  `--use-fake-device-for-media-stream`, scripted orientation events); non-zero
  exit on any page or console error. `window.__AR_STATS()` mirrors
  `__GAUNTLET_STATS()`.
- Real-device pass on Mentis's iPhone is the ship gate (house rule: desktop is
  not representative).

## 9. Build phases

1. **Hub + preservation** — rework `AR/index.html` into the hub, add
   `vercel.json` rewrite + `sw.js` bypasses, verify shooter on device.
2. **AR shell** — `gauntlet/ar/`: permission flow, camera background, gyro
   camera, screen plane with code-generated splash, drag/pinch placement, Go!
   button. *Demoable on its own.*
3. **Game on screen** — `boot.js` renders Casual into the render target;
   joystick + boost wired; reposition button.
4. **Polish + gates** — QR (three-finger, existing `gauntlet/src/ui/qr.js`),
   wake lock, `noindex`, harness, real-iPhone performance pass.
5. **Later / optional** — Android WebXR hit-test path; native shell (§7).

## 10. Risks

| Risk | Mitigation |
|---|---|
| SW cache poisoning via `/AR` or `/ar` | Bypass first, in phase 1, before anything links to the pages |
| `AR/` vs `ar/` case collision on macOS/Windows checkouts | Never create a lowercase `ar/` directory; `/ar` is a rewrite only |
| Gyro pinning feels swimmy | Slerp-smooth orientation; keep sessions short; set expectations in hub copy |
| Two passes + camera decode too heavy on older iPhones | Fixed small RTT; drop composite DPR before touching game quality |
| cdnjs r128 disappears | Vendor `three.min.js` into `AR/js/` |
| Gauntlet module changes silently break `/ar` boot | Boot lives inside `gauntlet/`; add `/ar` capture to the gauntlet harness run |

## 11. Deviations from this plan, and why

Recorded during the build so the plan and the code do not silently disagree.

1. **`/ar` is a redirect, not a rewrite.** The plan proposed rewriting `/ar/*` →
   `/AR/*` to keep the lowercase URL in the bar. A rewrite breaks the
   no-trailing-slash case: at `birbmobile.vercel.app/ar`, the hub's relative
   `game.html` resolves to `/game.html`. A 307 redirect lands the browser on the
   canonical path and every relative link then works natively.
2. **The AR page is the hub's child, not the hub.** `/ar` opens the reworked
   `AR/index.html` hub; Birb AR itself is at `/gauntlet/ar/`. This is what lets
   the original shooter stay reachable and untouched alongside the new work,
   which was the explicit requirement.
3. **The game view is slimmer than "Casual".** Nesting, drones, rings, the race
   course, rival AI, the HUD and the minimap are not built. On a screen
   subtending ~20° at 2.7m none of them resolve, and each costs draw calls the
   composite pass now needs. What ships is planet + sky + bird + flight + chase
   camera + feathers, driven by the real joystick.
4. **Pinch changes distance, not scale.** Scaling a "screen" up to 3m wide at 1m
   away reads as a billboard glued to the lens; pushing it away keeps apparent
   size honest. The splash copy was corrected to match the gesture.
5. **The screen faces the viewer and lives in spherical coordinates.** With no
   positional tracking every reachable placement is a point on a sphere around a
   stationary viewer anyway, which makes dragging a two-angle problem instead of
   a raycast-and-project one.
