# Device pass 3: where paint lands, how Grab tracks, what pressure does, and how fast the glass answers

2026-09-23. The report, from the owner after the fourth device run:

> For baby blender — check the code for how it's working in the app in the
> iPad. Both the logic for how the functions work and simple things like how
> smooth it is and the lowest latency from brush to experienced application
> etc etc — go hard and make this SO SO much better. Like right now painting
> doesn't even go on the right sides and grabbing and the functions just don't
> work well — and the range of pressures for sizes and having it function
> well.

Everything below was found by reading the shipped code and then **measuring**
it — headless, through the same code the iPad runs — before anything was
changed. Where a number is quoted, a test or a bench line produces it.

## 0. The short version

| Report | What it actually was | Now |
|---|---|---|
| "Painting doesn't even go on the right sides" | The renderer sampled the texture upside down relative to the painter. Paint on the front appeared on the **left side**; on the top, on the back. It had been true since the first painter. The GLB/VRM export did the same. | Paint lands under the Pencil, on every face, and in exported files (Blender confirms). |
| "Grabbing doesn't work well" | Three defects multiplying: the drag converted at the wrong depth (surface outran the Pencil toward the screen edges, **+20–27%**); a symmetric grab at the middle of the front face moved **2×** as far as the Pencil; and the pull was scaled by the **touch-down pressure**, the lightest of any stroke. | The grabbed point stays exactly under the tip (1e-6 px in the test), anywhere on the screen, with symmetry on or off, however hard you press. |
| "The range of pressures for sizes" | Pressure never touched the size at all; it was floored at 0.35; and **paint read it once**, at touch-down, so a whole stroke painted at about 30% opacity. | A pressure curve (Soft/Linear/Firm), separate size and strength ranges, read and filtered per sample; paint tapers between samples. All adjustable in the app. |
| "The functions don't work well" | Symmetric Inflate raised a **doubled ridge** down the middle; the same stroke came out **up to 8.3 mm different** depending on how Pencil samples fell into frames; a stroke that left the model painted a **streak across the gap**. | Symmetric halves blend instead of adding; strokes are frame-rate independent (to 1e-9); leaving the model lifts the stroke. |
| "Smooth, lowest latency" | Pencil samples were drawn at the top of the display frame and presented a refresh later; the ring lagged the tip; a resting palm could orbit the model mid-stroke; every paint stroke paid ~2.5 ms (12.6 ms at 2048²) at its two ends. | iPadOS 18 low-latency loop (with automatic fallback), predicted ring, palm rejection, stroke ends almost free, and **touch-to-glass latency measured on the device** in the readout. |

And one that was not in the report but made every earlier device run a
guess: **CI had never compiled the iPad app.** The macOS job built a project
name that no longer existed and piped into `xcpretty` without `pipefail`, so it
passed in two seconds. It now builds Release and Debug for a device on every
push, and it did so cleanly for everything in this pass.

## 1. Paint on the wrong side

The painter writes texels for UVs whose **v runs up** — Blender's and FBX's
convention, with the image's first row at `v = 1` (`Paint.dab`,
`SurfacePaint.Map`). Metal's texture origin is the **top left**: `t = 0` is the
first row uploaded. `Renderer.upload` put the document's UVs into the vertex
buffer unconverted, so every painted texel was sampled from the other end of
the image. On the clay's 3×2 atlas that is the other ROW of tiles — a different
face of the cube:

| Painted on | Shown on |
|---|---|
| front (+Z) | left side (−X) |
| top (+Y) | back (−Z) |
| right side (+X) | bottom (−Y) |

…and vice versa, each mirrored top-to-bottom within its face. Fill always
worked, because a uniform colour has no top or bottom — which is also why the
fourth device run could see Fill working and paint "doing nothing": the stroke
was on a face the camera was not looking at.

**Why nothing caught it.** The painter's tests read the image back with the
painter's own convention, and the painter agrees with itself. The disagreement
was between the painter and the GPU, and no test held one against the other.

**The fix** is `HumanoidCore.TextureSpace`: the conversion for each consumer in
one place (`metal`, `gltf`), used by the renderer and the exporter, with
`TextureSpaceTests` sampling paint back **through those functions** on all six
faces. Put the raw UV back and the tests reproduce the report exactly: paint on
the front is found on the vertices of the −X face.

**The export had the same bug.** glTF's texture origin is also the top left, and
the VRM/GLB writer passed v-up UVs straight through, so every exported texture
sat upside down on the model — on the clay, on the wrong faces. The Blender
render oracle could not see it because it replaces the material with plain clay
before it takes its picture. `tools/blender_check_paint.py` now asks Blender's
own importer: in `clay-sculpted.glb` the front face reads the paint
`(63, 77, 133)` against `(40, 60, 120)` painted; the old exporter's file reads
the fill `(196, 176, 210)` there. It is in `verify.sh` stage 5 and the CI
Blender step. FBX was always right: its convention is the document's.

## 2. Grab

**The depth.** A drag is converted from pixels to metres at the grabbed point's
depth. The editor passed `Picking.Hit.distance`, which runs **along the picking
ray** — longer than the view depth by 1/cos of the angle off-axis: 1.10× at the
top edge of an 11-inch iPad in landscape, 1.20× at the side, 1.27× in the
corner. The surface outran the Pencil everywhere but the middle of the screen.
`Camera.viewDepth(of:)` is the right depth, and with it the conversion is exact,
not approximate: a pinhole camera maps the plane at a fixed view depth onto the
screen linearly. `testTheGrabbedPointStaysUnderThePencilAwayFromTheMiddleOfTheScreen`
drags from near a corner and requires the handle to land on the pointer to 1e-6
pixels. The same depth now sizes the brush, so a brush in points is that many
points anywhere on the screen.

**Symmetry.** The mirrored half of every brush ran as a second, independent
dab, so any vertex inside both footprints moved twice. The footprints overlap
wherever the brush is near `x = 0` — and the middle of the front face is
`x = 0`, the first place anyone grabs. There a symmetric Grab moved the surface
**twice as far as the Pencil** (the sideways halves cancel, the up-down ones
add), and Inflate raised a doubled ridge along the centre line of any stroke
that crossed it. Each vertex now takes the weighted mean of the two falloffs,
`(w1² + w2²)/(w1 + w2)`: the one-sided weight where only one half reaches,
never more than the larger half, exactly the one-sided result for a brush
centred on the plane (which is its own mirror), smooth across the plane where
a `max` would crease, and still exactly mirror-symmetric. Grab's direction
blends by the same shares, so on the plane it moves up and down with the
Pencil, once. Reverting to the sum reproduces 0.024 against 0.012.

**Pressure.** The Grab's weights were captured with `strength × force`, and
the force was the first sample's — the Pencil still landing — floored at 0.35.
So a Grab typically moved the surface a third to a half as far as the Pencil
for the whole drag. Grab ignores pressure now: `EditTool.followsPressure` is
false for it, and `testPressureDoesNotChangeAGrab` compares a feather-light
drag with a hard one bit for bit.

Together: `testAGrabAtTheFrontCentreMovesTheSurfaceWithThePencilOneToOne` puts
all three worst cases at once — symmetry on, a light Pencil, the middle of the
front face — and requires the surface under the tip to move between 0.9 and 1.0
of the tip's travel (the 0.9 is falloff, not slip).

## 3. Pressure

What it was: `max(0.35, force / maximumPossibleForce)`, multiplied into
strength. Size never followed pressure. Paint built its brush **once** per
stroke, from the first sample, and the painter only ever raises a texel's
alpha within a stroke — so the touch-down opacity (about 0.9 × 0.35 = 0.32)
was the ceiling for the whole stroke. That is "paint doesn't work" as much as
the flip was.

What it is (`HumanoidCore.PressureResponse`, `PressureFilter`):

- **A full press** is `force / maximumPossibleForce = 0.5` (a firm stroke on
  glass reads about 2–2.5 of the Pencil's 4.2). Harder is still full.
- **A curve**: Soft (exponent 0.6, the default), Linear, Firm (1.7). With Soft
  an ordinary drawing pressure (≈0.3) reaches about 0.74 of the brush; a
  feather touch still does something.
- **Size range**: the lightest touch makes a brush 20% of the chosen size by
  default; **strength/opacity range**: 20% by default. Either can be switched
  off.
- **Per sample**, through an 8 ms exponential filter that takes the ripple out
  of the Pencil's quantised force without lagging a frame.
- A finger reports no pressure and gets the full brush, as before.
- Paint tapers radius and opacity along each segment between samples, so a
  pressure change is a smooth taper, not a step per sample.

In the app: the pencil-tip button in the top bar opens **Brush & Pencil**, where
all of it is set (and remembered between launches). The hover ring shows **two
circles** when size follows pressure: the outer is a firm press, the inner the
lightest touch.

## 4. The other functions

- **Frame-rate independence.** Moving the stroke logic into a testable engine
  immediately found this: dab centres were re-picked on the surface the stroke
  was raising, so the same Inflate path came out **5.4 mm** different delivered
  three samples a frame instead of one, and **8.3 mm** different in a single
  frame — the brush changed its mind with the frame rate, which on a device
  means with load. Dabs are now placed on, and weighed against, the shape the
  stroke started from (Blender's "accumulate off" and "original normal"), and
  the result is identical to 1e-9 however the samples are batched. The ring
  still sits on the surface you can see.
- **Leaving the model** mid-stroke used to join the exit and the re-entry
  point with a straight segment through space, and the brush capsule around it
  painted (or dabbed) a streak across whatever surface it passed near. The
  stroke now lifts and restarts.
- **Paint hardness**: the whole-radius smoothstep made every stroke a thin
  line of the chosen colour with a wide wash either side ("the paint is soft").
  The default now paints the inner half solid; adjustable 0–90%.
- **Symmetric painting**: mirror mode now paints too, with the mirror track
  sharing the stroke's alpha buffer so the centre line is not painted twice.
  (The clay's positions are symmetric but its triangulation is not, so the
  mirrored point is found by position and projected onto the surface.)
- **The tool is fixed at touch-down**; a double tap mid-stroke changes the next
  stroke, not this one.
- **The Pencil double tap and Pencil Pro squeeze honour Settings → Apple
  Pencil** (Ignore, Switch to previous tool, Switch to eraser). The old code
  always toggled Paint/Erase — the silent switch behind run four's "paint does
  nothing".
- **Two fingers tapped together is undo**, as in every iPad drawing app.

## 5. Smoothness and latency

**Stroke ends.** A new bench line (`humanoid-cli bench`) measured a whole paint
stroke at 3.7 ms at 1024² (16.9 ms at 2048²) against 1.2 ms (4.3 ms) for the
painting inside it: every touch-down allocated and zeroed a full-size alpha
buffer, and every lift built the undo record four bytes at a time — both inside
one frame. The buffer is now reused (clearing only what the last stroke
dirtied) and undo rows are copied whole: **1.7 ms** and **4.9 ms**; undo+redo
0.30 → **0.017 ms**. That removes the reason the texture was held at 1024; the
switch to 2048 is now a product decision, not a performance one.

Also: a paint step that touched no texels (a Pencil resting on paint it had
already laid) re-uploaded the **entire 4 MB texture every frame**; the empty
rectangle was read as "upload everything". It uploads nothing now.

**The loop.** Two ways to drive the viewport, switchable in Brush & Pencil:

- **Display link** — MetalKit's own timer, as before: draws at the top of a
  display frame with whatever Pencil samples UIKit had dispatched, presents a
  refresh later.
- **Low-latency (iPadOS 18+; off by default since the fifth device run, §11)**
  — a `UIUpdateLink` with Apple's two
  drawing-app features: Pencil events dispatched in the *middle* of the UI
  update (`wantsLowLatencyEventDispatch`), and the frame shown immediately after
  the update's Core Animation commit (`wantsImmediatePresentation`, which Apple
  documents as one frame duration sooner). To ride that commit the Metal layer
  presents inside it (`presentsWithTransaction`, commit → `waitUntilScheduled`
  → `present`). If it ever stops producing frames it falls back to the display
  link by itself and says so.

**Neither has been measured on the iPad**, which is why the readout now
**measures touch-to-glass on the device**: the newest Pencil sample a frame
consumed, against the moment the drawable reports it was actually on screen
(`addPresentedHandler`/`presentedTime`, same clock as `UITouch.timestamp`).
Median and p90 over the last 120 frames that carried input.

**The ring** is drawn at UIKit's **predicted** touch during a stroke — Apple's
technique for hiding a frame of latency, used only for what you see; the
stroke itself uses only real samples.

**Palm rejection.** The heel of a hand usually lands a moment before the Pencil
tip, and it started an orbit: the model turned under the Pencil. Now a finger
that lands while the Pencil is down is ignored, a contact over 40 pt across is
ignored once a Pencil has been seen, and a one-finger orbit younger than
0.75 s is cancelled **and undone** when the Pencil lands.

## 6. Why this is testable now

Every stroke defect the device runs found lived in `EditorModel`, in the app,
where the Linux suite could not reach it. The stroke logic is now
`HumanoidCore.StrokeEngine`, and `StrokeEngineTests` drives it with synthetic
Pencil samples through a real camera onto the real clay, reading results back
the way the GPU would. Each fix above was **mutation-checked**: putting the
old behaviour back fails at least one named test.

| Re-introduced defect | Fails |
|---|---|
| Grab depth = ray length | the handle-under-the-Pencil and one-to-one tests |
| Grab weights × pressure | pressure-invariance and one-to-one |
| Paint brush frozen at touch-down | `testPaintReachesFullOpacityAfterALightTouchDown` |
| No lift across a gap | `testAStrokeThatLeavesTheModelDoesNotPaintAcrossTheGap` |
| Dabs chase the rising surface | `testHowTheSamplesAreBatchedIntoFramesDoesNotChangeTheShape` |
| Symmetric paint ignored | `testSymmetricPaintAlsoPaintsTheMirrorImage` |
| Symmetric halves summed | the three plane tests in `GrabTrackingTests` |
| UV flip removed (renderer or exporter) | `TextureSpaceTests`, the export test, the Blender oracle |
| Reused alpha buffer not cleared | `testASecondStrokeOverTheFirstBuildsUpAndUndoesSeparately` |
| Lift drops the paint it applied (§10) | `testPaintJustBeforeTheStrokeRunsOffTheModelIsStillUploaded` |
| Discard leaves texels, normals or the upload behind, or is close-and-undo (§10) | the four discard tests |

226 → **270 core tests**, 1 skipped, 0 failures; `tools/verify.sh` all eight
stages PASS with Blender 4.5.13 and the Khronos validator; the app builds clean
(Release and Debug, Xcode 26.6) in CI.

## 7. Bench, release, build box

| | before | after |
|---|---|---|
| Paint dab, r = 0.01 / 0.04 / 0.06, 1024² | 0.59 / 0.80 / 1.05 ms | 0.60 / 0.72 / 1.20 ms |
| Paint dab, r = 0.12 (wider than the app allows), 1024² | 4.84 ms | 6.14 ms |
| Whole paint stroke (begin + r=0.06 dab + end), 1024² | 3.69 ms | **1.73 ms** |
| Whole paint stroke, 2048² | 16.9 ms | **4.91 ms** |
| Undo + redo of that stroke, 1024² / 2048² | 0.30 / 1.51 ms | **0.017 / 0.098 ms** |
| `Picking.raycast`, 6,912 triangles | 0.053 ms | 0.044 ms |

The per-texel cost of the taper and hardness is inside the noise at the sizes
the app uses and about 25% at a brush wider than the model.

## 8. On the iPad — the checklist

Pull, `xcodegen generate`, pick **BabyBlender (Release)**, run, then stop Xcode
and launch from the home screen. Three-finger tap for the readout.

1. **Paint lands under the Pencil on every face.** Paint on the front, the
   top, each side. The stroke is where the tip is, on that face, right way up.
2. **Mirror.** With Mirror on (default), paint on one cheek: the other cheek
   gets it too. Turn it off in Brush & Pencil: only one side.
3. **Pressure.** Draw light, then press: the line thickens and darkens as you
   press, smoothly, from the first millimetre. The readout's `pressure` figure
   follows your hand. If your iPad has Pencil hover, the ring shows two circles
   before you touch: firm size outside, lightest size inside. Try Soft/Linear/
   Firm and the two ranges; they persist.
4. **Grab.** Pencil on the middle of the front face, drag up about 3 cm: the
   surface under the tip stays under the tip — not twice as far, not a third.
   Repeat near a corner of the screen, and with a very light touch.
5. **Inflate across the middle** of the front face with Mirror on: one smooth
   bump, no ridge down the centre line.
6. **Off and back on.** Paint off the edge of the model into the background and
   back on: no streak where the Pencil was off the model.
7. **Palm.** Rest the heel of your hand on the glass, then draw: the model does
   not turn.
8. **Two-finger tap** undoes the last stroke, and the camera does not move.
   A small two-finger pinch or pan moves the camera and does NOT undo.
9. **Latency — the number to send back.** Draw small circles for five seconds
   and read `touch→glass` (median, p90), the `main` line and the loop name
   after the dot. Then Brush & Pencil → turn **Low-latency drawing
   (experimental)** on, and repeat. Both sets of numbers, please, with the
   iPad model. If the loop name says `display link` while the switch is on,
   the low-latency loop gave way; the console line `[BabyBlender] low-latency
   loop fell back …` says why, with the number. (Before §11 this read the
   other way round: the low-latency loop was the default.)
10. **Console lines worth pasting:** any `[BabyBlender] slow frame` line (it
    names the loop and where the time went), the fall-back line if there is
    one, `paint map ready (… ms)`, and any `Hang detected`.
11. **Palm first, on the first launch of this build.** Rest the heel of your
    hand on the MODEL, then put the Pencil down and draw. The Pencil draws
    from its first stroke, and whatever the palm did is taken back (the
    readout's last line says `discarded`).
12. **A coasting model stops.** Flick the model to spin it, then touch the
    Pencil down while it is still turning: it stops at touch-down, and a
    Pencil held still makes a dot, not a smear.
13. **A flicked stroke keeps its tail.** Paint a quick stroke that flicks off
    at the end: the paint reaches where the Pencil left the glass.
14. **Pencil Pro squeeze** (left at the system default) opens Brush & Pencil
    and does not change the tool. Double tap still switches Paint and Erase
    unless Settings → Apple Pencil says otherwise.

## 9. What is still unmeasured

- Everything about the device: touch-to-glass under either loop, whether
  `wantsImmediatePresentation` actually brings a frame forward on this iPad
  (Apple's documentation says it does; one developer on Apple's forums could
  not make it report so), and the frame time with the new ring and paint paths.
  The readout now carries every figure needed.
- Whether the pressure defaults suit the owner's hand. They are a starting
  point chosen from the Pencil's measured force range, and every one of them is
  a slider.
- Whether 40 pt is the right palm size on this iPad; `NavigationGesture.palmRadius`.
- Whether ten points of travel before a one-finger orbit starts
  (`NavigationGesture.slop`, §10) feels late; it is UIKit's own pan
  hysteresis, and it is what makes the two-finger tap reliable.

## 10. A second look at the app layer

The app is compiled by CI but runs nowhere except the iPad, so after the pass
above an adversarial review read `EditorModel`, `SculptView`, `Renderer` and
`EditorView` for behaviour, not syntax. Each finding below was checked against
the code before anything changed; the one it rated minor and could only be
settled on the device (a late low-latency confirmation delaying one frame's
samples) was left as it is.

| Finding | Fix |
|---|---|
| **A palm on the model before the first Pencil stroke of every session took the stroke, and the Pencil was refused** until it was lifted and put down again: `pencilSeen` was not saved, and the Pencil's touch-down was turned away because a touch was already being followed. The most likely cause of "the pencil wasn't working, then did". | `pencilSeen` persists. A Pencil landing while a finger holds the stroke takes it over, and the finger's stroke is **discarded**, not kept (`StrokeEngine.discard`). A Pencil nothing is following is taken up on its next move. |
| **The low-latency watchdogs were both switched off at launch.** The did-become-active observer stamped a frame that had not happened; on a cold launch it fires after the view is built, so a `UIUpdateLink` that never drew would have left the viewport blank for the session. In the other direction, one draw that stalled half a second after its drain fell back for good, and a draw that found no drawable counted as drawn. | The loop judges on frames **presented** (stamped after `present`, counted for the first-frame check); a draw with no drawable asks again; activation only restarts a waiting request's clock. The frame-rate range comes from the panel, because the 80 Hz floor was asked of 60 Hz iPads too — including the M2/M3 iPad Air, which have hover and no ProMotion. |
| **A stroke started during a flick's coast was applied through a turning camera**: a still Pencil smeared, a Grab's handle drifted. | A touch-down, or a finger landing, stops the coast. |
| **Undo, redo and fill ran inside an open stroke.** The toolbar's Undo, tapped by the other hand mid-stroke, undid the previous stroke while this one was recording, and part of it came back when this one closed. The two-finger tap could do the same with its own first finger's stroke. | Commands close the open stroke first and drop the rest of its gesture. The two-finger tap **discards** its own finger's stroke and then undoes: undoing it instead would leave it on the redo stack, or, if it changed nothing, undo the stroke before. `Document.discardStroke` restores shape, normals and texels and leaves history and redo exactly as they were; four tests, each mutation-checked. |
| **A two-finger tap undid and moved the camera**; the camera moved after one point of travel. | The tap waits for the camera gesture to fail, and the camera waits for UIKit's own ten points. |
| **A Pencil Pro squeeze at its system default (Show contextual palette) switched a sculpt tool to Paint**, and "Run a shortcut" ran the Shortcut AND switched tool. | Only Switch to eraser switches; the palette actions open Brush & Pencil; the rest are ignored. |
| **Paint just before a stroke ran off the model could stay invisible**: the lift applied it and threw its upload flag away. A core bug, found by reading the app's use of it. | `lift` returns its effect; `testPaintJustBeforeTheStrokeRunsOffTheModelIsStillUploaded`. |
| Palm rejection read a touch's size only as it landed (palms land small and spread); a resting palm's own movement reset a finger's flick; the hand lifting after a stroke could orbit. | Size re-read while followed; only followed fingers move the camera; touches in the 0.3 s after the Pencil lifts are ignored. |
| The last samples of every stroke — the ones between the last move and the lift — were never applied, clipping a flicked stroke's tail. | The lift's coalesced samples are applied before the end. |
| A stroke whose touch-down and lift fell in one frame left the viewport drawing at full rate while idle; toasts stayed up until the next touch; the brush colour was converted through UIKit twice a frame; the Size slider did nothing with the size locked on the model; "Let a finger sculpt" took the camera away from fingers entirely; loop changes were published from inside SwiftUI view updates. | All fixed as described in the code comments at each site. |

## 11. The fifth device run (2026-09-24): the low-latency loop held up every stroke

*"Working... performance still sucks / laggy and lame-ish."* The console: a
Release build (the paint map ready in 34 ms), the debugger attached, `drawing
through the low-latency UIUpdateLink`, the first frame at 2732x2048 — and
**thirty-nine `Hang detected` lines, from 0.26 s to 5.05 s**, with `stroke had
no samples for 5.0 s; closing it` three times, each followed by a hang of
5.04–5.05 s.

**The three five-second hangs say what the others are.** The stroke watchdog
runs inside a frame's input drain, and it printed exactly 5.0 s all three
times. A single slow call would have ended at an arbitrary moment and the
watchdog would have printed 5.3 or 7.2. So frames were being drawn back to back
for those five seconds, and in all that time not one Pencil sample arrived.
The hang then ended within 50 ms of the watchdog closing the stroke, because
closing it is what stops the loop drawing continuously. These were not a slow
function. They were the loop keeping the main thread busy for as long as a
stroke was open, while UIKit's own event delivery waited. The other thirty-six
are stroke-, hover- and coast-length stretches on the same loop. The display
link it replaced ran the fourth device run with no repeated hangs, and the
loop is the only thing new between those two runs.

**What this run could not say is which call held each frame**, because nothing
timed the phases. The FrameLoop watchdogs (§10) looked only for a loop that
**stops** drawing. A loop that draws and starves everything else looked,
to every check in the app, like a loop working perfectly.

| Change | Why |
|---|---|
| **The display link is the default again**; the low-latency loop is a switch marked experimental, stored under a new key (`lowLatencyLoop`) | So an iPad that saved the old default gets the new one. It is the configuration the fourth device run measured without repeated hangs. |
| The low-latency loop takes **three drawables**, the system default, not two | It presents inside the update's Core Animation transaction, and the frame reaches the glass at the refresh after the commit. When the next update starts, the drawable on screen and the one just committed are both still held. With two, none is free, and taking one blocks the main thread until the display gives one back. |
| **It gives way by itself** when its frames hold the main thread: one frame over 250 ms (Apple's own hang threshold), or three over 34 ms within two seconds, while something is happening | `MainThreadMonitor` in the core, with nine tests. The first piece of the plan's M0 `FrameWatchdog` to move out of `app/`. |
| **Every frame is timed by phase**: draining input, waiting for a drawable, waiting for a vertex buffer, submitting. A frame over 34 ms is logged, `[BabyBlender] slow frame, <loop>: 812.0 ms: drawable 790.0, …`, at most once a second with a count of the rest. The readout gains the `main` and `slowest lately` lines. | So the next report names the call rather than the feeling. `FrameTiming.summary` puts the largest phase first. |
| The **Release scheme runs without GPU frame capture, Metal API validation and the thread checkers** | Each sits between the app and every Metal or UIKit call. The debugger stays attached, because its console is where these lines arrive. For a feel test, stop Xcode and launch from the home screen. |

**What to send back from the next run:**

1. Build with **BabyBlender (Release)**, then stop Xcode and launch from the
   home screen to feel it. Draw for a minute: is it smooth now?
2. Three-finger tap and screenshot the readout while drawing: `main`,
   `slowest lately` and `touch→glass`.
3. If it still drags, run once more from Xcode and paste the console,
   `slow frame` lines included.
4. Only then, turn on **Low-latency drawing (experimental)** and do 1–3
   again. If it gives way, the console line says why.

**Unmeasured on the iPad: all of it.** 279 core tests and `verify.sh` PASS
is what exists.
