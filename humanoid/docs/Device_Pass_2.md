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
   counters.** Done when: Inflate held still raises the surface during the
   press, the hover ring tracks (on a hover-capable iPad), a flick coasts,
   and `pending` at drain never exceeds single digits.
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
