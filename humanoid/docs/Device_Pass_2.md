# Device pass 2: the Pencil does nothing, two fingers fight, and where the time goes

2026-09-19. Second run of Baby Blender on the iPad, from Xcode's Run button,
on the build at `4f0bbd3`. The report, verbatim:

> It worked!! I could see the cube and kind of spin it around...? But the
> performance is shite and the controls don't quite work right when I use two
> fingers to zoom in and out or want to drag it around or look at it from a
> slightly different view angle size scale etc. ? [...] And none of the
> pencil actions seems to work? Like some grab or whatever - they didn't do
> anything I could see.

Xcode's console during the run: `Hang detected: 0.63s`, then
`paint map ready (3242 ms, off the main thread)`, then
`Hang detected: 4.46s`, `3.63s`, `1.22s`.

This is the evaluation, written to be handed to an implementing agent. It
reads the shipped code rather than guessing at it, and where a claim rests on
a platform fact the source is cited at the end. Nothing here has been changed
in the code yet.

## 0. The short version

Three root causes explain every symptom in the report, and they are ranked
by how much they explain.

1. **The render loop never runs continuously.** `SculptView` puts the
   `MTKView` in on-demand mode (`enableSetNeedsDisplay = true`,
   `isPaused = true`) and tries to switch to continuous drawing during a
   stroke by setting `isPaused = false`. That does nothing: Apple's own
   header for `enableSetNeedsDisplay` says setting it true "will also pause
   the MTKView's internal render loop and updates will instead be event
   driven" [S1]. The view still draws only when something calls
   `setNeedsDisplay()`. Pencil samples are queued by `enqueue` and drained
   only inside `draw`, and nothing on the Pencil path ever requests a draw.
   So a stroke goes into the queue and stays there until a finger moves the
   camera, at which point the whole stroke is applied in one frame. This is
   why **no Pencil tool showed anything**, why the **hover ring never
   appeared**, why the **flick coast never played** (same switch), and it is
   the most likely source of the **multi-second hangs**: a queue of hundreds
   of samples, each doing a linear raycast in a debug build, dumped into
   one frame when the camera finally moved.

2. **The one-finger orbit keeps running when the second finger lands,
   and every recogniser is allowed to run simultaneously.** A two-finger
   drag is therefore orbit + pan + pinch at once, and the view lurches. On
   top of that the pan is off by the aspect ratio horizontally, the zoom
   scales about the look-at point rather than the fingers, and the pivot
   never moves off the model's centre. Each of these is what "doesn't quite
   work right when I use two fingers" feels like.

3. **Everything measured so far was a Debug build with the debugger
   attached.** Xcode's Run button builds `-Onone`; on this `Double`-based
   SIMD-free geometry code that is 10–40x slower than release (the paint map
   took 3242 ms on the device against about 27 ms measured in release on the
   build box). The debugger also enables Metal API validation and per-frame
   GPU capture hooks. No number from this run is a number about the app.
   Two structural costs are real regardless of build and are listed in §3.

Fix 1 first: it is a two-line change and it changes what every other test
means. Then 2 and 3 together, because the camera work needs the loop running
to be judged.

## 1. Why the Pencil does nothing

### The chain, and where it breaks

```
touchesBegan (SculptMTKView)            .pencil touches only, by design
  → report → onSample → editor.enqueue   appends to `pending`; on .began calls onActivity(true)
  → onActivity(true): view.isPaused = false            ← does nothing in on-demand mode [S1]
  → (nothing requests a frame)
  → draw(in:) never runs → beforeDraw never runs → drainInput never runs
  → the stroke sits in `pending`
  ... finger orbits → cameraMoved → onChange(.camera) → setNeedsDisplay()
  → ONE draw → drainInput applies every queued sample in one go
```

Hover is the same story: `onHover` sets `view.isPaused = false` and queues
the position; `updateCursor` only runs in `drainInput`; no draw is requested.
The coast: `flick` → `onActivity(true)` → nothing. Three features share one
dead switch.

The comment in `SculptView.makeUIView` describes the intended behaviour
correctly ("during a stroke or a coast it runs continuously, which is what
`onActivity` switches") and the code does not do it. This is the class of
bug the Linux suite structurally cannot see: it is a property of `MTKView`.

### What to do

Either of these works; the first is smaller.

**A. Toggle both properties.** Continuous mode is
`enableSetNeedsDisplay = false; isPaused = false`. On-demand mode is
`isPaused = true; enableSetNeedsDisplay = true` followed by one
`setNeedsDisplay()` so the final frame of the stroke is drawn. Set them in
that order in `onActivity`. This is the documented way to switch modes on an
`MTKView` [S1].

**B. Own the clock.** Drop `MTKView`'s timer entirely (`isPaused = true`,
`enableSetNeedsDisplay = true`) and drive `view.draw()` from a
`CADisplayLink` the coordinator owns, started on activity and invalidated
on idle, with `preferredFrameRateRange = CAFrameRateRange(minimum: 80,
maximum: 120, preferred: 120)`. This is what drawing apps do because it
gives one place to reason about pacing, and it makes the "am I drawing"
state an object rather than two booleans on someone else's view. Prefer this
if the loop is going to grow a predicted-touch path (§3.4).

Belt and braces in both cases: `enqueue` and `enqueueHover` should also
call `setNeedsDisplay()` on the view. It is coalesced per run-loop pass, it
costs nothing, and it means a queued sample can never again wait on an
unrelated event to be seen.

### Verify it, on the device, with numbers

The HUD (`report(frame:elapsed:)`) already exists. Add two counters to it
and log them once per stroke:

- `pending` at the top of `drainInput` — during a stroke this should read
  1–4 (a Pencil at 240 Hz against a 120 Hz frame), never hundreds.
- frames drawn during the stroke — should be about `duration × 120`.

Acceptance: hold the Pencil still on the model with Inflate for one second.
The surface rises visibly *during* the second, and the HUD shows dabs/frame
non-zero the whole time. Before the fix the HUD cannot even update, which is
itself the tell.

### Two more reasons a stroke can silently do nothing

These are real once the loop runs, and each reads as "the tool is broken".

**A stroke that starts a millimetre off the model is dead for its whole
length.** In `applySamples`, `.began` does `guard let hit = pick(...) else
{ continue }`, so `sculptStroke` stays nil and `grabDepth` stays 0; every
later `.moved` sample then does nothing even when it crosses the model.
Start the stroke on the first sample that hits, whatever its phase. Nomad
tolerates this too, and it is one of the few places it should not be
copied.

**Nothing on screen says a finger will not sculpt.** `fingerEditing` is
false by default and there is no hint, so a person who taps Grab and drags
with a finger sees an orbit and concludes Grab is broken. This may be part
of what happened. The rule should be visible (a one-line hint in the tool
rail on first launch: "Pencil sculpts · fingers move the camera") and the
toggle should be in the rail, not buried. Better still, adopt Nomad's rule
in §2 so a finger CAN sculpt when it starts on the model, which removes the
question.

## 2. Two-finger navigation, done the way sculpting apps do it

### What is wrong now

1. **Orbit does not stop when the second finger lands.** `orbit` is a
   `UIPanGestureRecognizer` with `maximumNumberOfTouches = 1`; a pan that
   has already begun keeps tracking its first touch when extra touches
   arrive rather than failing, and `shouldRecognizeSimultaneouslyWith`
   returns `true` for every pair. So a two-finger drag runs `handleOrbit`
   (from finger one's translation), `handlePan` and `handlePinch` in the
   same frame. That is the lurch.
2. **Pan is wrong by the aspect ratio.** `handlePan` normalises `dx` by the
   view WIDTH and `dy` by the HEIGHT; `Camera.pan` then scales both by
   `distance * 2 * tan(fov/2)`, which is the VERTICAL extent. In landscape
   the model follows the fingers vertically and lags them horizontally by
   the aspect ratio (1.33–1.43 on an iPad). The one correct formula already
   exists: `metresPerPixel(depth:viewportHeight:)`, which Grab uses. Pan
   should move by `pixelDelta × metresPerPixel(depth: distance)` on both
   axes.
3. **Zoom is about the look-at point, not the fingers.** `Camera.zoom`
   scales `distance` only, so the thing under the fingers slides toward the
   centre as you pinch. Every 2D and 3D touch app anchors zoom at the pinch
   centre.
4. **The pivot never moves.** Orbit is always about `target`, which after a
   pan is somewhere off the model. Nomad moves the pivot to the point under
   two fingers the moment they land, and on a double tap [S2]. Without it,
   "look at it from a slightly different angle" after any pan swings the
   model out of frame.
5. **No coast** — same dead switch as §1.

### The model to copy (Nomad Sculpt, documented [S2][S3])

- One finger (or Pencil) **on the model**: sculpt. One finger **on the
  background**: rotate the camera.
- Two fingers: drag pans, pinch zooms, and (trackball mode only) rotating
  the pair rolls the view. Turntable is the default and the more intuitive
  of the two, which matches what `Camera` already is.
- Placing two fingers on screen centres the pivot under them. Double tap
  on the model sets the pivot there; double tap on the background recentres
  on the mesh. A pink dot shows the pivot.

That rule set needs no mode switch and no "is a Pencil paired" API, which
does not exist. Refinement for this app: once a `.pencil` touch or hover
has been seen this session, a finger on the model navigates too (Nomad has
this as a gesture-panel option; making it automatic is one fewer setting).
Keep `fingerEditing` as the explicit override.

### How to build it

**One navigation recogniser, not four.** Replace `orbit`, `pan` and `pinch`
with a `UIGestureRecognizer` subclass that tracks all `.direct` touches
itself (override `touchesBegan/Moved/Ended/Cancelled`, `cancelsTouchesInView
= false`, `delaysTouchesBegan = false`). Each frame it looks at the touch
count:

- 1 touch: orbit from the delta of that touch. If the touch began on the
  model and the finger is allowed to sculpt (no Pencil seen, or
  `fingerEditing`), the recogniser fails and the view's own touch handlers
  take the stroke.
- 2 touches: centroid delta → pan; distance ratio → zoom about the
  centroid; angle delta → roll only if trackball is on (skip for now).
  When the count changes 1→2 or 2→1, re-base the reference points so
  nothing jumps.

The double tap and the three-finger tap stay as `UITapGestureRecognizer`s;
the hover recogniser stays.

**Camera state that can change its pivot without the view jumping.** The
current `target/distance/azimuth/elevation` cannot: moving `target` to a
hit point moves the eye too. Add a view-plane offset:

```
eye   = pivot + R(azimuth, elevation) · (0, 0, distance) + right·offset.x + up·offset.y
lookAt = pivot + right·offset.x + up·offset.y
```

- orbit: change azimuth/elevation (offset rides along, so the frame rotates
  about the pivot);
- pan: change `offset`, in metres, by `pixels × metresPerPixel(depth: distance)`;
- zoom about a screen point: scale `distance` by `1/f`, and move `offset`
  so the world point under that screen point at depth `distance` stays
  put: `offset += (s − offset) · (1 − 1/f)` where `s` is the screen point's
  view-plane position at that depth;
- set pivot to a world point P with no jump: `distance' = dot(P − eye,
  forward)`, `offset' = view-plane components of (eye + forward·distance' − P)`,
  azimuth/elevation unchanged. The eye and the view direction are
  unchanged by construction, so the frame does not move; only the centre
  of the next orbit does.

All of that is arithmetic in `Camera.swift`, which is in `HumanoidCore` and
tested on Linux; each rule above is a three-line test (zoom about a point
leaves that point's projection fixed; set-pivot leaves `eye` and `forward`
fixed; pan by N pixels moves the projected pivot by N pixels).

**Feel numbers to start from, then tune by hand.** Orbit 3.0 rad per screen
width is in range (about 170° across the screen). Coast decay `0.998^ms` is
a 0.5 s tail, fine. Clamp `distance` to `[0.4, 12] × model radius` rather
than the fixed `[0.05, 5]` metres, so a bigger template cannot zoom
through itself.

## 3. Where the time is going

### 3.1 Measure a Release build before believing anything

- **Product → Scheme → Edit Scheme → Run → Build Configuration → Release**
  (keep "Debug executable" on so `NSLog` still shows), or use **Profile
  (⌘I)**, which builds Release and opens Instruments.
- In the same dialog, **Options → Metal API Validation → Disabled** and
  **GPU Frame Capture → Disabled** for feel runs; both add CPU work per
  encoder call while the debugger is attached.
- For the honest feel test, stop Xcode and launch from the home screen. A
  debugger attached to a Metal app is not the app.

Expected: the paint map drops from 3242 ms to well under 100 ms; the whole
per-frame sculpt chain from `Performance_Research.md` is about 0.3 ms.

### 3.2 The hangs, ranked by likelihood

| Hang | Most likely cause | How to confirm |
|---|---|---|
| 0.63 s at launch | `Document.clay()` + `MeshTables` + first `upload` on the main thread, in debug | Time `EditorModel.init` and `Renderer.init` with `os_signpost`; expect it to vanish in release. If not, build tables off-thread like the paint map. |
| 4.46 / 3.63 / 1.22 s mid-session | Queued Pencil samples applied in one frame when the camera finally moved (§1): each sample is a linear raycast over 7k triangles + a dab, in debug | Log `pending.count` at the top of `drainInput`; a value in the hundreds on the frame before a hang is the proof. Gone with the §1 fix. |
| Any of them | SwiftUI re-evaluating `EditorView` at touch rate: `camera` and `document` are `@Published`, so `editor.camera.orbit(...)` and `document.sculpt(...)` each fire `objectWillChange` and rebuild the toolbar | Instruments Time Profiler, filter `AG::Graph` / SwiftUI. Fix below. |
| Any of them | `inFlight.wait()` on the main thread | Only blocks if the GPU is three frames behind; at ~1 ms GPU frames it never does. Not it — but see §3.4 for the drawable count. |

### 3.3 Stop publishing what SwiftUI does not show

`refresh()` already guards `canUndo/canRedo` so the toolbar is not rebuilt
every frame — and then `@Published var camera` and `@Published private(set)
var document` undo that work, because mutating a `@Published` struct
property publishes whether or not any view reads it. Make `camera` a plain
`var` (it reaches the renderer through `onChange` and nothing in SwiftUI
reads it) and make `document` a plain `var` with the two booleans the UI
needs published separately. Keep `tool`, `radiusPoints`, `strength`,
`symmetric`, `stabilise`, `colour`, `showStats`, `hud`, `status` as they
are. This is a certain win in every build configuration.

### 3.4 The latency budget, and what is worth buying

Input to photon today, best case at 120 Hz: touch delivered at the start of
the run-loop pass (~4 ms average age), drained at the top of `draw`
(good — the latest possible point), encoded, one GPU frame (~1 ms),
presented through a 3-deep drawable queue (up to 2 more frames). About
25–33 ms. Things that move it:

- **`CAMetalLayer.maximumDrawableCount = 2`** (`(view.layer as?
  CAMetalLayer)`). Saves one frame of presentation latency at the cost of
  a stall if a frame overruns. Drawing apps generally take the trade;
  measure with the HUD's worst-frame figure before and after.
- **Predicted touches** (`event.predictedTouches(for:)`) for the CURSOR
  RING only. Apple's own latency technique for drawing apps [S4]; it must
  not feed the sculpt, which is undoable geometry, but a ring drawn where
  the tip will be in 8 ms is the cheapest way to make hover feel attached.
- **Keep the drain where it is.** `beforeDraw` at the top of `draw`, before
  `inFlight.wait()`, is correct: input is read as late as possible and the
  wait, if it ever happens, does not delay reading input.
- `preferredFramesPerSecond = 120` is right; verify with the HUD that the
  panel is actually running 120 (ProMotion iPads only). Nothing to do on a
  60 Hz iPad.

### 3.5 Per-frame allocations still on the path

- `Renderer.update(albedo:rect:)` allocates `rows` per call. Keep one
  staging `[UInt8]` (or a shared `MTLBuffer` and blit) sized to the largest
  rect seen.
- `applySamples` allocates `sculptCentres` and `paintSteps` per frame;
  make them instance arrays with `removeAll(keepingCapacity:)`.
- `hud` string building is 4x/s and fine. `frameSamples.removeFirst()` on
  120 elements is fine.

None of these is a hang; they are GC-free-loop hygiene the rest of the repo
already holds itself to (`CLAUDE.md`, house rule 4).

### 3.6 Scaling levers — NOT for this pass, recorded so nobody reaches for them early

- **Picking** is a linear Möller–Trumbore over every triangle: 0.07 ms in
  release at 7k triangles, ×(1 hover + ≤4 samples) per frame. Fine. A BVH
  is what makes Clay denser than 24 divisions affordable; build it then.
- **`Sculpt.apply` scans every welded vertex per dab** (`for welded in
  0..<tables.weldedCount`). At 2k welded that is nothing; at 4x density it
  is the cost. A uniform grid over welded positions, rebuilt lazily, is
  the fix when it is needed.
- **Vertex upload is the whole buffer** (0.026 ms). Leave it, per the
  comment in `Renderer.upload`.
- **`Double` everywhere.** A `SIMD3<Float>` core would be roughly 2x on
  the geometry paths and is a rewrite of the tested module. Not warranted
  at this vertex count.
- **2048 textures** wait on sparse undo (`Performance_Research.md`).

### 3.7 Instrumentation to add so the next report has numbers

- `os_signpost` intervals: `drain`, `pick`, `sculpt`, `paint`, `upload`,
  `encode`. They show up in Instruments' Points of Interest lane beside
  the Hangs instrument, which is what produced the "Hang detected" lines.
- One boot log line: device model, `UIScreen.maximumFramesPerSecond`,
  whether a hover event has ever arrived (see §4), build configuration
  (`#if DEBUG`).
- HUD additions: `pending` at drain, frames this stroke, `pick` ms, and a
  one-line "last stroke: N samples, M reached the model, K vertices
  moved". A stroke that moved nothing should say so on screen in debug
  builds. The rule from the rest of this repo applies: a check that only
  proves something painted is not a check.

## 4. Tool behaviour that reads as broken even with the loop running

**Grab re-picks the surface every frame.** `.moved` picks the hit under
the current tip and appends it; `commit` applies the summed `grabDelta` at
the LAST hit with falloff computed there. As the pulled surface moves under
the tip, or the tip runs off the bump, a different vertex set is grabbed
mid-stroke. Every sculpting package fixes the Grab set at stroke start:
capture the welded vertices within radius of the first hit with their
falloff weights and their ORIGINAL positions, then each frame set
`position = original + weight × totalDelta`. That is stable, does not
accumulate error, and undo needs exactly the set it captured. Also drop
`× sample.force` from the grab delta: if the finger moved 5 mm the surface
should move 5 mm.

**Show the ring during the stroke.** `updateCursor` hides it while
`strokeOpen`, citing Apple's hover guidance. That guidance is for drawing
apps where the mark is the feedback; ZBrush and Nomad both keep the brush
circle visible while sculpting because the radius IS the tool. Keep it,
faded to ~0.4.

**Hover exists only on some iPads.** Pencil hover (`zOffset`) requires an
M2 or later iPad Pro/Air, or the A17 Pro iPad mini, with Pencil 2 or Pencil
Pro [S5]. On any other iPad `UIHoverGestureRecognizer` never fires and the
ring never appears by design. Log whether a hover event has ever arrived,
and on devices where none has, show the ring at touch-down instead.

**Stroke start off-model** — §1, fix it.

**Pressure floor.** `force` is floored at 0.15 so an upright Pencil marks;
Nomad's default pressure curve is closer to linear with a floor near 0.25
for Inflate/Smooth. Expose the floor; it is a feel number to tune on glass.

## 5. Small things

- `prepareForPaintingSoon` warns `'weak' ownership of capture 'self'
  differs from implicitly-captured strong reference`: the outer
  `DispatchQueue.global` closure captures `self` strongly (via `document`
  reads hoisted before it — fine) and the inner one weakly. Write it as
  `Task.detached(priority: .utility) { let map = ...; await MainActor.run
  { [weak self] in self?.document.installPaintMap(map) } }`, which also
  respects `@MainActor` on the class instead of dispatching past it.
- `updateUIView` calls `setNeedsDisplay()` on every SwiftUI update. Once
  `camera` is unpublished it will run rarely; until then it is one more
  draw per toolbar rebuild.
- `handleOrbit` on `.began` zeroes `lastOrbit` but translation is already
  zero there; harmless. It goes away with the unified recogniser.

## 6. Order of work, and what "done" looks like on the device

1. **Loop switch (§1A or §1B) + `setNeedsDisplay` on enqueue + HUD
   counters.** Done when: Inflate **dragged slowly** across the model raises
   it as you go, the hover ring tracks (on a hover-capable iPad), a flick
   coasts, and `pending` at drain never exceeds single digits.

   > **Corrected 2026-09-20.** This first read "Inflate held still raises the
   > surface during the press", which contradicts the design it is checking:
   > dabs are spaced along the PATH, so a stationary pointer emits none, and
   > that is the half of the 2026-09-08 fix that stopped a held pen extruding
   > a spike through the surface. ZBrush and Nomad both behave this way. An
   > acceptance test that asks for the bug back is worse than no test.
2. **Release scheme + signposts + boot log line.** Done when: a Release run
   detached from Xcode shows no `Hang detected` and the HUD reads ≥ 100 fps
   idle-to-stroke on a ProMotion iPad.
3. **Unpublish `camera` and `document`.** Done when: Time Profiler during a
   stroke shows no SwiftUI graph update per frame.
4. **Camera model (pivot + offset) in core with tests; unified navigation
   recogniser; Nomad rule set.** Done when: two-finger drag pans without
   rotating, pinch keeps the point under the fingers fixed, two fingers
   down then one-finger drag orbits about the model where they landed,
   nothing jumps on 1→2→1 finger transitions, and a finger drag that
   starts on the background orbits while one that starts on the model
   sculpts (until a Pencil has been seen).
5. **Grab captured at stroke start; stroke starts on first hit; ring
   visible while stroking; finger/Pencil hint in the rail.**
6. **Drawable count 2 vs 3, predicted-touch cursor** — measured with the
   HUD worst-frame number, kept only if it reads better.

Each of 1, 3, 4 and 5 is a `SculptView`/`EditorModel`/`Camera` change; the
Linux suite covers 4's arithmetic and nothing else here — the rest is
verified by the on-device checklist above, which is why the HUD counters
come first.

## Sources

- [S1] MetalKit `MTKView.h`, `enableSetNeedsDisplay`: "Setting
  enableSetNeedsDisplay to true will also pause the MTKView's internal
  render loop and updates will instead be event driven."
  https://github.com/mstg/iOS-full-sdk/blob/master/iPhoneOS9.3.sdk/System/Library/Frameworks/MetalKit.framework/Headers/MTKView.h
  (Apple's header, mirrored; the wording is unchanged in current SDKs.)
- [S2] Nomad Sculpt manual, Camera: one finger on the model sculpts, on the
  background rotates; two fingers pan/zoom; placing two fingers centres the
  pivot under them; double tap sets the pivot; turntable default.
  https://nomadsculpt.com/manual/camera
- [S3] Nomad Sculpt manual, Getting started.
  https://nomadsculpt.com/manual/gettingstarted
- [S4] Apple, "Adopting hover support for Apple Pencil" and UIKit's
  `predictedTouches(for:)` guidance for drawing latency.
  https://developer.apple.com/documentation/uikit/adopting-hover-support-for-apple-pencil
- [S5] Pencil hover device list (M2+ iPad Pro/Air, iPad mini A17 Pro,
  Pencil 2 / Pencil Pro): https://support.apple.com/en-us/108937 and
  https://astropad.com/blog/apple-pencil-hover-everything-you-need-to-know/
- `UIPanGestureRecognizer.maximumNumberOfTouches` documentation and
  observed behaviour: a pan already in `.changed` keeps tracking its
  original touches when extra touches land; it does not fail. Verify on
  the device with a log line in `handleOrbit` — if it does fail on
  current iPadOS, root cause 2 is only the simultaneity, and the unified
  recogniser is still the right fix.
  https://developer.apple.com/documentation/uikit/uipangesturerecognizer/maximumnumberoftouches

---

# 7. What shipped (2026-09-19, same day)

Everything in §6 except the predicted-touch cursor, which is left open at the
bottom. The core changes are covered by tests on Linux; the app changes are
not compiled anywhere until the Mac builds them, which is the same split
`Build_on_the_Mac.md` opens with. **224 core tests, 1 skipped, 0 failures;
`tools/verify.sh` PASS.**

## 7.1 The render loop (§1)

`onActivity` now switches BOTH properties, which is what the MetalKit header
requires and what the previous version missed:

| | `isPaused` | `enableSetNeedsDisplay` |
|---|---|---|
| busy (stroke, hover, coast) | false | **false** |
| idle | true | true, plus one `setNeedsDisplay()` |

`EditorModel.requestDraw` is called from `enqueue`, `enqueueHover`,
`clearHover` and `flick`, so anything that queues work asks for the frame that
drains it instead of reasoning about whether one is already coming.
`setNeedsDisplay` coalesces and is a no-op in continuous mode, so this is
free.

Two further things that made a stroke silently do nothing:

- **A stroke that starts off the model now arms on the first sample that hits
  it.** `strokeArmed` replaces the old "set everything up in `.began` or never".
- **`SculptMTKView` decides once, per touch, who owns it** (`editingTouch`),
  and a finger that lands ON the model sculpts while one that lands off it
  orbits — until a Pencil has been seen, after which fingers navigate only.
  That is Nomad's documented rule [S2][S3] and it needs no setting. The line
  under the tool rail says which regime is in force, because "no pencil action
  works" and "I was using a finger" look identical on the glass.

## 7.2 Two-finger navigation (§2)

**`Camera` is pivot plus a view-plane offset now.** `pivot` is what orbit turns
around; `lookAt` is `pivot` slid by `offset` in the camera's own right/up
plane. Splitting them is what lets all three gestures be independent, and what
lets the pivot move without the view jumping.

New, each with tests that fail on the old behaviour:

- `pan(pixels:viewportHeight:)` — the aspect-ratio bug is gone. Mutation-tested:
  restoring the old normalise-x-by-width form makes
  `testPanMovesTheModelExactlyAsFarAsTheFingers` read **77.14 against 120**,
  which is 120 divided by the 1400x900 aspect ratio, exactly the defect.
- `zoom(by:about:viewport:)` — the world point under the fingers stays under
  the fingers, and a pinch that runs into a limit stops rather than sliding the
  view sideways.
- `setPivot(to:)` — moves the orbit centre with the eye **bit-identical**, so
  re-pivoting is invisible until the next orbit.
- `minDistance` / `maxDistance` derived from the model's radius by `frame`,
  rather than the fixed 0.05 / 5 metres.
- `project(_:viewport:)` — the exact inverse of `ray`, which is what lets every
  rule above be stated as a measurement rather than as an assertion about the
  camera's internals.

**One recogniser replaces three.** `NavigationGesture` counts its own touches:
one orbits, two pan and pinch together and re-pivot under themselves on
landing, three suspends navigation for the debug tap. The 1 -> 2 -> 1
transitions re-read the reference centroid and spread, so adding or lifting a
finger moves nothing. `delaysTouchesEnded` is off, which was holding the end of
every stroke back by about 150 ms.

## 7.3 Performance (§3)

- **A Release scheme ships in `project.yml`** ("BabyBlender (Release)"), so the
  measurement discipline is a dropdown rather than an instruction. Metal API
  validation and GPU frame capture still have to be turned off by hand in the
  scheme editor; a scheme spec cannot express them portably.
- **`camera` and `document` are no longer `@Published`.** Between them they
  were republishing the whole SwiftUI toolbar at up to 120 Hz. Nothing reads
  them live: the mesh, texture, camera and cursor go straight to the renderer,
  and the export sheet reads the document when it opens.
- **`os_signpost` intervals**: `drain`, `samples`, `sculpt`, `grab`, `paint`,
  `frame`. They land in Instruments' Points of Interest lane beside the Hang
  instrument that produced the original report.
- **The HUD gained the counter that proves the loop is alive**: queue depth at
  drain (and its worst), picks per frame, and the frame count of the last
  stroke. During a stroke the queue reads single digits. Hundreds is the bug
  this pass fixed, and now it is visible on the device rather than inferred.
- **`maximumDrawableCount = 2`** — one frame less presentation latency, as a
  named constant with the trade written next to it. **Unmeasured on the
  device**; the HUD's worst-frame figure is what decides whether it stays.
- Per-frame allocations removed: the partial texture upload reuses a staging
  buffer, and the sample/centre arrays are instance properties.

## 7.4 Grab, captured (§4)

`Sculpt.GrabSet` + `Document.beginGrab` / `grab(to:)`. The gesture decides what
it holds ONCE, and every frame places that set at the **total** displacement
rather than adding a delta to wherever the vertices had got to. Eleven tests,
including: sixty frames of drag land where one call would, to 1e-12; returning
to zero restores the surface exactly; one drag is one undo step that puts
everything back; the captured set does not outlive its stroke. Grab is also
handled before the pick now, so dragging the pointer off the silhouette keeps
pulling instead of stalling.

Pressure no longer multiplies the displacement: if the finger moved five
millimetres the surface moves five millimetres. Pressure is in the weights the
capture took at the start.

## 7.5 Also

- The brush ring stays visible while stroking, faded, and rides with the
  surface a Grab is dragging. Apple's hover guidance says to hide a preview
  once the pen is down, which is right for a drawing app where the mark is the
  feedback; on a sculpting tool the ring is the only honest answer to "how big
  is my brush", and ZBrush and Nomad both keep it up.
- The `'weak' ownership of capture` warning is gone: the paint map build is a
  `Task.detached` with one `MainActor.run` hop, which is also isolation-correct
  rather than merely quiet.

## 7.6 Still open

- **Predicted touches** for the cursor ring (§3.4). Deliberately not done: it
  must not feed the sculpt, and it is worth nothing until the loop above has
  been confirmed on the device.
- **Every number in §3 is still a build-box number.** Nothing here has been
  run on the iPad. The acceptance checklist in §6 is what to run, in order,
  and the HUD now carries every figure it asks for.
- The A5-style question for this app: nothing yet proves the loop stays alive
  under a long stroke. The queue-depth worst-case in the HUD is the closest
  thing, and it is a reading rather than a check.


---

# 8. Third device run: the Pencil stopped and started (2026-09-20)

The console settles the top-level question before any of the rest matters:

```
Found debug dylib relative path string `BabyBlender.debug.dylib`
...
App is being debugged, do not track this hang
Hang detected: 0.92s (debugger attached, not reporting)
[BabyBlender] paint map ready (2919 ms, off the main thread)
```

`BabyBlender.debug.dylib` and "App is being debugged" mean this was the
**Debug** scheme again, so every latency number in the run is a debug number
and the checklist's items 2 and 3 have still not been attempted. The
"System gesture gate timed out" lines are a SYMPTOM of that, not a separate
gesture bug: the system gesture gate waits on the main thread, and a main
thread stopped for 0.9 s misses the window. Section 2b of
`Build_on_the_Mac.md` now spells the scheme switch out step by step.

Three real defects came out of the report anyway, and each is a fix rather
than a measurement.

## 8.1 "The pencil wasn't working, then did"

`beginStroke()` opened with `guard !strokeOpen else { return }`. A stroke
whose `.ended` never arrived therefore left `strokeOpen` true **forever**,
and every later touch-down returned at that guard: no arm, no undo group, no
paint stroke. The Pencil went on reporting and nothing happened, for the rest
of the session.

Ends do go missing. A touch cancelled while the main thread is blocked — a
0.9 s hang, exactly what the console shows — may never deliver one, and
`editingTouch` is a weak reference to a `UITouch` UIKit is free to recycle.

Three changes, because one of them alone leaves a hole:

- `beginStroke()` closes a stranded stroke instead of refusing to start. A
  new touch-down means the previous gesture is over.
- `SculptMTKView.touchesBegan` releases an `editingTouch` whose `phase` has
  already ended or been cancelled, rather than letting it block the guard.
- A five-second watchdog in `drainInput` closes a stroke that has heard
  nothing, and logs it. Long on purpose: UIKit sends no `touchesMoved` for a
  pointer that is not moving, so a short timeout would cut a stroke in half
  whenever somebody paused to think.

The readout now ends with `last: 14f dabs 9 texels 0 skipped 31 armed yes`,
which distinguishes the three ways a stroke can look broken: it never found
the model, it ran and moved nothing, or it painted nothing.

## 8.2 "Inflate at full strength almost didn't"

Two causes, multiplying.

**The brush was half the size the slider claimed.** `radiusPoints` is in
screen POINTS and `metresPerPixel` is per DRAWABLE pixel, and nothing
converted between them. On a 2x iPad a "46 point" brush was 46 drawable
pixels — 23 points. Inflate's displacement scales with the radius, so that
halved the effect as well as the footprint. `pointScale` is read from the
view each frame.

**And the constant was too small.** `inflatePerDab` 0.04 moved the surface
0.42 mm per dab at full strength. Measured in
`testAFullStrengthPassVisiblyMovesTheSurface`: one 50 mm pass with a 21 mm
brush at full strength moved the clay **3.28 mm** — and the test fails below
3.6 mm, which is 1.5% of the model's width. At 0.09 it moves 7.5 mm. The
ceiling is the feedback gain `inflatePerDab / spacing`, which the existing
convergence test holds under 0.125; 0.09 / 0.25 is 0.36.

Together that is about 4.5x. The gain test and the new floor test now pin it
from both sides, which is what the first value was missing.

## 8.3 "The paint didn't work"

`Document.beginPaintStroke` builds the paint map on demand if it is missing,
**on the main thread**, and that is the 2,919 ms the console reports. The
background build starts when the viewport comes up, so the only way to reach
the synchronous path is to paint in the first few seconds — and the result
is a three-second freeze with the stroke lost, which is indistinguishable
from a broken tool.

Painting now refuses to build the map itself. It says "Paint is still warming
up" and leaves the stroke unarmed, so it starts painting the moment the map
lands, mid-gesture. `status` existed and nothing had ever displayed it; there
is a toast now.

## 8.4 Two costs removed while in there

Both are pure waste and both hurt most in exactly the build the owner keeps
running.

- **`Document.sculpt` scanned every welded position per dab centre** to build
  a deliberately generous superset of the vertices the brush was about to
  report anyway — 3,458 x 4 x 2 set insertions for an ordinary frame.
  `Sculpt.apply` already returns what it moved, and `sculptDelta` is
  untouched by it, so reading `before` after the brush runs gives the same
  answer. Exact instead of generous, and the scan is gone.
- **`Sculpt.dab` snapshotted all 3,750 positions per dab.** Only Smooth needs
  it: it averages across weld groups. Grab and Inflate write each disjoint
  group exactly once and can never read a position their own dab has moved.
  `testDroppingThePerDabSnapshotChangedNothing` pins all three brushes
  against a reference that still snapshots.
- **Redundant raycasts are skipped.** A Pencil reports at 240 Hz and dabs are
  a quarter of the brush radius apart, so at any ordinary drawing speed most
  coalesced samples move a pixel or two and emit nothing — while each costs a
  linear pass over 6,912 triangles. A sample under two drawable pixels from
  the last one is folded into the next **without advancing the travel**, so
  the path is unchanged and only the waste goes. At a normal 5 cm/s the
  Pencil covers about four drawable pixels per sample, so nothing is skipped
  while the hand is moving. The readout counts the skips.

## 8.5 What is still unmeasured

Everything about speed. 226 core tests and `verify.sh` PASS is what exists.
Until a **Release** run detached from Xcode reports its numbers, §3 of this
document is a prediction.

---

# 9. Fourth device run: Release at last, and Erase was wearing Paint's clothes
(2026-09-20)

**The scheme switch worked.** `paint map ready (185 ms, off the main thread)`
against 2,919 ms the run before — a 16x drop that is the Debug-to-Release
difference and nothing else. One `Hang detected: 0.35s` at launch remains and
is Metal pipeline compilation, which happens once. The repeated 0.26–0.92 s
hangs are gone.

(`fopen failed for data file` and `Errors found! Invalidating cache...` are
the Metal shader cache warming on a first run. `RBSServiceErrorDomain Code=1
"Client not entitled"` is the debugger asking FrontBoard for CPU time it is
not entitled to. Neither is ours.)

## 9.1 "Fill works but paint with a colour does not"

Fill and a paint stroke reach the GPU through the **same** function
(`Renderer.update(albedo:rect:)` with the whole image as its rectangle), so an
upload bug cannot explain one working and the other not. And the core path is
sound: a probe that replicates the editor's exact sequence — pick at screen
centre, `beginPaintStroke`, twenty `paint(to:seed:)` steps across a 200-pixel
drag — reports a dirty rectangle of 131 x 119 and **13,453 texels changed**.

What was left is that the tool was not Paint.

`togglePaintErase()` read `tool = tool == .erase ? .paint : .erase`. From ANY
sculpting tool that lands on **Erase** — and Erase paints the base colour
back, so on a model nobody has painted yet it changes nothing a person can
see. It is driven by `UIPencilInteraction`, which is a double tap on a Pencil
2 and a squeeze on a Pencil Pro: gestures that are easy to produce by accident
while picking the Pencil up, and which said nothing on screen when they fired.
Fill kept working throughout because Fill uses the colour directly.

It now selects Paint from a sculpting tool, Erase from Paint, Paint from
Erase, and says which in the toast. The readout carries the live tool too, and
names Erase as "paints base colour".

**A destination state that is invisible on a fresh document is not a state to
arrive at silently.**

## 9.2 "Max strength for everything has to be turned way up"

Four things were multiplying, and three of them were defaults rather than
limits.

| | was | now |
|---|---|---|
| Brush size default | 46 pt (~16 mm on a 240 mm model) | 80 pt (~36 mm) |
| Strength default | 0.5 | 1.0 |
| Pencil pressure floor | 0.15 | 0.35 |
| Inflate per dab | 0.09 R | **0.22 R** (driven strokes) |

Strength at 0.5 is the worst of them, because for **Grab** it means the
surface moves half as far as the finger — the one thing Grab must not do. The
slider exists to go gentler; there is no reason for the middle of it to be
where everyone starts.

The per-dab constant needed a second value rather than a bigger one.
`Sculpt.inflatePerDab` (0.09) is bounded by a FEEDBACK GAIN: a stroke that
measures the surface counts its own output as travel, so a dab must move the
surface less than the spacing that earns the next dab. **The editor does not
measure the surface** — it passes pointer travel, and has since 2026-09-08 —
so that loop does not exist on its path, and the bound that does apply is the
shape of one pass. Dabs land every 0.25 R and the smoothstep weights at
0, ±0.25, ±0.5, ±0.75 R sum to 4.0, so a pass displaces `4 x value x R`.
`inflatePerDabDriven = 0.22` makes that just under one brush radius, which is
what a confident single stroke should do. At 0.09 it was a third of it.

Both constants are guarded and the guards say different things: the old gain
test still pins `inflatePerDab`, and the new pass test pins the driven one
from BOTH sides — at least half a radius (or it is invisible) and under one
and a half (or it is a spike) — and then re-raycasts the surface across the
stroke to prove a full-strength pass has not folded it through itself. That
last assertion is the property the 2026-09-08 spike bug broke, and it is the
real reason a number this size is safe now and was not then.

## 9.3 "Is Smooth really different from Deflate, and Grab from Inflate?"

They are, and two of them had a reason to look alike.

- **Grab** moves the surface with the pointer. At strength 0.5 it moved half
  as far, which reads as a weak Inflate rather than as dragging. At 1.0 the
  surface follows the tip.
- **Inflate** pushes along the surface normal, so it grows a dome wherever you
  go instead of following you. With the default brush at 16 mm and 0.09 per
  dab, both were small bumps.
- **Deflate** is Inflate negated and always was.
- **Smooth** moves each point toward the average of its neighbours. On a
  surface that is already smooth — a fresh clay cube — that is **correctly
  nothing**. It only shows once there is something to flatten. Sculpt a lump
  with Inflate first, then run Smooth across it.

## 9.4 "Can't see the Apple Pencil when near the screen floating"

Pencil hover is not a universal feature. It needs an M2-or-later iPad Pro or
Air, or the iPad mini (A17 Pro), with a Pencil 2 or Pencil Pro. On anything
else `UIHoverGestureRecognizer` never fires and there is nothing to draw —
which is a device fact that looks exactly like a bug.

The readout now says `hover 412` or `hover never (iPad may not have it)`, and
the first hover event that ever arrives logs itself. That distinguishes "this
iPad cannot" from "this build will not" without another guess. The ring is
already shown during a stroke, so the brush size is visible on contact either
way.
