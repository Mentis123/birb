# Building Baby Blender on the Mac

**Time: about twenty minutes the first time, most of it Xcode indexing.**

> **Read this first.** Everything in `Sources/` is tested on Linux and green —
> 155 tests. Everything in `app/` is **not compiled anywhere yet**: there is no
> Apple SDK on the build box, so the SwiftUI, UIKit and Metal layer was written
> without a compiler. Expect to fix a handful of small things on the first
> build. That is the expected outcome, not a failure, and the fixes belong in a
> commit rather than in your head.
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
open Humanoid.xcodeproj
```

The `.xcodeproj` is generated and gitignored. Never edit it by hand — change
`project.yml` and regenerate, or the next person loses your edit.

## 2. Set signing

Xcode → target **HumanoidApp** → *Signing & Capabilities* → tick **Automatically
manage signing** and pick your team. The bundle id is
`com.mentis.birb.HumanoidApp`; change the prefix in `project.yml` if that clashes
with something already on your account.

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
| Double tap | Frame the model |
| **Apple Pencil** | Sculpt or paint with the selected tool |

**Fingers navigate, the Pencil edits.** No mode switch. There is a
`fingerEditing` flag on `EditorModel` if you want to try it without a Pencil,
but leave it off by default — with it on, every orbit is also a stroke.

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
