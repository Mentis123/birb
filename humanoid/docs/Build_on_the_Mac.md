# Building Baby Blender on the Mac

**Time: about twenty minutes the first time, most of it Xcode indexing.**

> **Read this first.** Everything in `Sources/` is tested on Linux and green —
> 300 tests. Everything in `app/` is **compiled by CI** on every push (the
> `macos` job in `.github/workflows/humanoid.yml`, Release and Debug, for a
> device) — which it was not before 2026-09-23: that job named a project that
> no longer existed and still passed. Compiled is not run: the app layer's
> behaviour is only ever checked on the iPad, against the checklist in
> `docs/Device_Pass_3.md` §8.
>
> The split is deliberate. Every decision that could be *interestingly* wrong —
> where the camera is, what a touch hits, how far a drag moves a vertex, what a
> brush does to a mesh — lives in the tested core. What is untested is buffer
> bookkeeping and view plumbing, which fails loudly rather than subtly.

---

## 1. Generate the project

```bash
brew install xcodegen        # once
cd humanoid/app
xcodegen generate
open BabyBlender.xcodeproj
```

The `.xcodeproj` is generated and gitignored. Never edit it by hand — change
`project.yml` and regenerate, or the next person loses your edit.

## 2. Set signing

Xcode → target **BabyBlender** → *Signing & Capabilities* → tick **Automatically
manage signing** and pick your team. The bundle id is
`com.mentis.birb.BabyBlender`; change the prefix in `project.yml` if that clashes
with something already on your account.

A **Personal Team** (free Apple ID) signs for **seven days** and then the app
refuses to launch until it is rebuilt. That is the schedule, not a fault.

## 2b. Pick the right scheme — step by step

**You must run `xcodegen generate` again after pulling**, or the Release
scheme will not exist. It is generated from `project.yml`, not stored in the
project.

### Where the scheme selector is

Top-left of the Xcode window, on the toolbar, immediately right of the ▶ and ■
buttons. It reads **`BabyBlender > <your iPad name>`**. The **left half** of
that control is the scheme; the **right half** is the destination.

### Switch it

1. Click the **left half** (the word `BabyBlender`).
2. The menu lists both schemes. Choose **`BabyBlender (Release)`**.
3. Click the **right half** and choose **your iPad by name**. Not
   "My Mac (Designed for iPad)" — that runs it on the Mac.
4. Press **⌘R**.

That is the whole switch. You can tell it worked from the console: a Debug
run prints `Found debug dylib relative path string BabyBlender.debug.dylib`
in its first few lines, and a Release run does not.

### If the Release scheme is not in the menu

Either `xcodegen generate` did not re-run, or your XcodeGen is old. Do it by
hand instead, which reaches the same place:

1. **Product → Scheme → Edit Scheme…** (or ⌘<)
2. Select **Run** in the left column.
3. **Info** tab → **Build Configuration** → change `Debug` to **`Release`**.
4. **Close**.

Change it back the same way when you want breakpoints.

### The two settings a scheme cannot carry

Same dialog — **Product → Scheme → Edit Scheme… → Run → Options tab**:

- **Metal API Validation** → **Disabled**
- **GPU Frame Capture** → **Disabled**

Both add CPU work to every Metal call while the debugger is attached. Leave
them on while hunting a rendering bug; turn them off before judging speed.

### Then take Xcode out of it

Press **■** (stop) in Xcode, then tap the Baby Blender icon on the iPad's home
screen. A debugger attached to a Metal app is not the app. This is the only
run whose feel is worth reporting.

### Why this matters so much here

Debug is `-Onone`, and on this `Double`-heavy, SIMD-free geometry code that
is ten to forty times slower than Release. The paint map measured 27 ms in
Release on the build box and **2,919 ms on the iPad in Debug**. Every
`Hang detected` line in the second and third device runs was a Debug number.
**No measurement from a Debug build with the debugger attached is a
measurement about this app.**

## 3. Build and run

Pick your iPad as the destination and hit run. It is iPad-only
(`TARGETED_DEVICE_FAMILY = 2`), so the simulator list will only show iPads.

---

## What you should see

A dark screen with a pale rounded cube in the middle.

| Gesture | Does |
|---|---|
| One finger drag | Orbit |
| Two finger drag | Pan |
| Pinch | Zoom |
| Double tap | On the model, orbit around that point; off it, frame the model |
| **Two finger tap** | Undo |
| Three finger tap | The readout: fps, frame time, **touch→glass latency**, pressure |
| **Apple Pencil** | Sculpt or paint with the selected tool; pressure sets size and strength |
| Pencil double tap / Pro squeeze | Whatever Settings → Apple Pencil says: eraser, previous tool, ignore; the palette settings (the squeeze's default) open Brush & Pencil |

**Fingers navigate, the Pencil edits.** No mode switch. Until a Pencil has ever
been seen on this iPad (it is remembered), a finger that lands ON the model
sculpts; the hand icon in the top bar keeps that rule on afterwards. A palm
resting on the glass while you draw is ignored, and a Pencil that lands while
a palm holds a stroke takes it over and throws the palm's stroke away.

The pencil-tip button in the top bar opens **Brush & Pencil**: the pressure
curve and the size and strength ranges, paint hardness, mirror, the rope
stabiliser, size fixed on the model, and the low-latency drawing switch
(experimental, off by default since 2026-09-24: `Device_Pass_3.md` §11).

Six tools along the bottom: Grab, Inflate, Deflate, Smooth, Paint, Erase, with
size and strength. **Export** runs the real pre-flight and shows the checks.

---

## What changed since the first device run

The editor loop was rebuilt against what that run found. Everything below is new
and none of it has been compiled against an Apple SDK, so expect the first build
to want small fixes — that is the expected outcome, not a failure.

| | |
|---|---|
| Every tool applies **live** | Only Grab did; the rest waited for pen-up |
| Strokes resample by distance | One dab per Pencil event — the spikes |
| Brush size in **screen points** | Was world metres, so right at one zoom only |
| Paint is a sphere on the model | Was a disc in UV space, which bled across faces |
| Pencil **hover ring** on the surface | Nothing until you touched |
| Coalesced touches | Three of four Pencil samples were thrown away |
| Input drained once per **frame** | The whole chain ran per event, up to 240 Hz |
| Orbit and pan are separate gestures | One recogniser counting fingers — it jumped |
| Pinch and pan run together | They blocked each other |
| Orbit coasts after a flick | Stopped dead on lift |
| Pencil double tap swaps Paint/Erase | — |
| Three-finger tap shows the readout | No way to know the frame rate |
| MSAA 4x | Aliased edges |

## What to look at first, in this order

These are the things most likely to be wrong, and each one is diagnostic.

1. **Is there a cube at all?** If the screen is empty but not crashing, the
   likely cause is the projection matrix or the vertex descriptor. The camera
   maths is tested; the buffer layout is not.
2. **Is it inside out?** Front-facing winding is set to counter-clockwise and
   culling to back. If you can see the inside of the cube, one of those two
   disagrees with the template — which the Linux tests say winds outward.
3. **Does the hover ring appear before you touch, and sit ON the surface?** It
   needs an Apple Pencil 2 on an M2-or-later iPad, or a Pencil Pro; older
   hardware reports no hover and the ring simply never shows, which is not a
   bug. It should fade in as the tip approaches and vanish while you draw.
4. **Does the Pencil paint where you touch it?** Screen-to-ray is tested,
   including the top-left origin flip, so if the stroke lands somewhere else the
   suspect is `contentScaleFactor` — the code multiplies the touch location by
   it to get drawable pixels, and if the view's scale and the drawable's size
   ever disagree, that is where.
5. **Does one drag make one undo step?** Grab applies live, so it calls `sculpt`
   dozens of times per gesture; `beginStroke`/`endStroke` merge them. If undo
   takes back a single frame, the group is not being opened or closed.
6. **Does it hold 120 fps?** Three-finger tap and read it off. Budget: under
   2 ms of CPU per frame for input plus sculpt at the default brush. If it is
   over, the readout says whether the time is CPU or GPU before you start
   guessing.

## What I would not chase yet

- **Texture memory.** The document ships a 1024 albedo; the PRD's target is 2048
  with a 1024 export preset. Not worth tuning before the editor feels right.
- **Autosave.** `Document` holds the state and nothing persists it yet. Phase 2.
- **The New Project screen.** Clay is the only template until the humanoid layer
  lands in Phase 3, and a picker with one option is furniture.

---

## If it will not build

Most likely causes, in the order I would check them:

- **`Cannot find 'Camera' in scope`** and similar — the package products are
  wired in `project.yml` (`HumanoidCore`, `ExporterVRM`, `ExporterFBX`). If
  Xcode has not resolved them, File → Packages → Reset Package Caches.
- **A Metal function is not found at runtime.** `Renderer` looks up
  `model_vertex` and `model_fragment` by name in the default library. If
  `Shaders.metal` was not added to the target's compile sources, `makeDefaultLibrary`
  returns something without them and `Renderer.init` returns nil, which shows as
  a blank view rather than a crash. Regenerating the project fixes it.
- **`Uniforms` size mismatch.** The Swift struct and the Metal struct must match
  field for field including padding. Metal will not complain — it will read the
  wrong bytes and draw something wrong. Both are commented to say so.

Send me the errors verbatim and I will fix them here rather than you patching
them by hand on the Mac; that keeps the repo the source of truth.

---

## The other thing still outstanding

The Windows/Unity session, whenever you are back at it: map **Chest**, hit
**Apply**, and tell me **which hand lights up when you click `LeftHand`**. That
last one is the only unknown left in the export path and it is a one-line fix
either way.
