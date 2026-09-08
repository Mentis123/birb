# Baby Blender — editor feel: diagnosis and plan

**Status: diagnosis from the first on-device test (2026-09-08). Nothing here is
built yet.** This is the brief for the next build pass. It is written from the
code, not from guesses: every symptom below is traced to the lines that cause
it.

> **Read `Performance_Research.md` alongside this.** It carries the sourced
> platform facts and the measured cost of the core
> (`BABY_BLENDER_BENCH=1 swift test -c release --filter BenchmarkTests`).
> The headline finding changes emphasis here: every sculpt operation is under
> 0.2 ms, so the lag is *scheduling* (§1, §4), not maths. Do not thread it or
> rewrite the core in Float. Paint is the one piece that needs real
> engineering — the naive projection walk measured 6.3 ms at the largest brush
> on 1024², so it is built Blender-style (precomputed texel runs + per-triangle
> affine map, swept per frame) rather than as the naive loop sketched in §2.

## The first device test

The app compiled, signed and ran on the first attempt. Mentis's report, and what
each answer means:

| # | Question | Answer | Actual cause |
|---|---|---|---|
| 1 | Is there a cube? | **Yes** | Buffer layout, projection, Metal library lookup are all right. |
| 2 | Inside out? | **No — but sometimes after inflating/sculpting** | Not winding. **Dab pile-up**: one dab per Pencil event stamped at pen-up. See §1. |
| 3a | Pencil marks where you touch? | **Yes** | Screen→ray and `contentScaleFactor` are right. |
| 3b | Paint shows up somewhere else | **Yes, often** | **UV-space dab bleeding across atlas tiles.** See §2. |
| 3c | Wants hover cursor showing brush radius before touch | request | `UIHoverGestureRecognizer`. See §5. |
| 4 | One drag = one undo? | Yes (probably) | Stroke grouping works. |
| 5 | Does it hold 60 fps? | "How would I know?" | There is no way to know. See §7. |

And the overall ask: **smooth, pro, no delay, no glitch.** The rest of this file
is how.

---

## 1. Inflate, Deflate, Smooth and Paint do nothing until pen-up

`EditorModel.accumulate` only applies **Grab** live. The other five tools append
to `strokePoints` / `strokeUVs` and are applied in `commit()` on `.ended`. So:

- Three of the six tools show **nothing while you stroke** and then jump when
  you lift. That is the "delayed" feel in one line.
- At pen-up, `commit()` stamps **one dab per touch event**. A Pencil delivers up
  to 240 events per second. A slow one-second stroke inside a single brush
  radius is 100–200 dabs at the same spot, each moving the surface by
  `radius × 0.35 × strength × force`. Fifty overlapping dabs at strength 0.5 is
  ~9 radii of extrusion. The surface spikes, folds through its neighbours, the
  folded triangles are back-face culled, and you see dark holes and inverted
  shells. **That is the "inside out" report.** The cube was correct until it was
  sculpted, which is the tell.

### Fix

**Distance-resample sculpt strokes exactly as `Paint.Stroke` already does**, and
apply them live, once per frame.

- New `Sculpt.Stroke` in `HumanoidCore`: same `previous`/`carry` design as
  `Paint.Stroke`, spacing = `radius × 0.25`, world-space. Result becomes a
  function of the path, not the event rate. Test it the same way Paint is tested:
  fifty events and two events over the same path must produce the same mesh.
- Per-dab amount becomes small and honest: `inflate(radius × 0.35)` was sized
  for one dab per gesture; at radius/4 spacing it should be nearer
  `radius × 0.04–0.06 × strength`. Tune on device, pin in a test that a
  10 cm stroke at strength 1 raises the surface by no more than ~0.5 radius.
- Live: every tool applies during `.changed`, inside the open stroke group, so
  undo still takes back the whole gesture. Grab already does this; it is the
  model.
- **Optional but cheap:** a per-stroke displacement cap per vertex (e.g. 1.5 ×
  radius) so nothing can ever spike regardless of how slowly the Pencil moves.
  Nomad and ZBrush do not do this, but they also do not run at fixed per-dab
  amounts. Decide after the resample lands — it may be unnecessary.

## 2. Paint lands on the wrong face

`Paint.dab` stamps a **disc in UV space** and clips it only to the image
bounds. The clay atlas is 3×2 face tiles edge to edge (`build_clay.py`,
`ATLAS_INSET = 0.004`). A dab within one radius of a tile edge paints straight
into the neighbouring tile — which is a different cube face at an unrelated
place on the model. That is "painting onto a side shows up someplace else".

`dabAcrossSeams` makes it worse rather than better. It maps the stamp into the
partner island by a plain UV offset (`partnerUV - du, -dv`), which is only
correct when both islands have the same orientation. In a cube atlas the
neighbour is generally rotated 90° or 180°, so the seam stamp lands in the wrong
direction, and it is also unclipped.

Two further things are wrong with paint as shipped and the same fix removes
them: the paint radius is `radius × 0.6` in UV units while the sculpt radius is
world metres, so the two tools disagree about how big the brush is; and a brush
of fixed UV size covers different amounts of surface on different faces once the
model is sculpted.

### Fix: paint by projection, not in UV space

This is how every serious 3D painter does it and it is the right fix rather
than the quick one.

1. From the hit, flood out through `tables.neighbours` collecting every
   **triangle** with any vertex inside the brush's world sphere (positions from
   the current mesh, welded so seams are crossed for free).
2. For each such triangle, rasterise its **UV footprint** into the texture:
   walk the texels inside the UV triangle (with a one-texel dilation so filtering
   does not show a gap), reconstruct each texel's world position from its
   barycentric coordinates, and blend it if it is inside the sphere, with the
   same smoothstep falloff by world distance.
3. Return the union pixel rect as today; undo records are unchanged.

Consequences, all good:

- **Bleed is impossible.** Only texels belonging to triangles near the hit are
  ever written, so a neighbouring tile is touched only when its surface is
  actually within the brush.
- **Seams are correct by construction**, in every orientation. `seamUVs` and
  `dabAcrossSeams` are deleted.
- One brush radius, in metres, for sculpt and paint alike.
- Cost, **measured** (naive bounding-box walk, release, build box): 0.54 ms at
  r = 0.03, 1.96 ms at r = 0.06, 6.31 ms at r = 0.12 on 1024². Fine at the
  default brush, over budget at the largest once the albedo is 2048². So build
  it the way Blender does (`Performance_Research.md` §4): the texels each UV
  triangle covers and a pixel→position affine map are **template constants**
  (topology and UVs never change) generated once; per frame, paint the swept
  *segment* of the stroke as one capsule test over those runs rather than one
  dab at a time. Expect 4–8x over the naive numbers.

Tests to pin it (Linux): painting the centre of face +Z changes no texel outside
+Z's tile; a dab straddling an edge changes texels in exactly the two adjacent
tiles and the painted colour is continuous across the seam when sampled along a
world-space path; fifty events and two events on the same path give the same
texture.

## 3. Normals crease at the seams

`MeshData.recomputeNormals` accumulates per **unwelded** vertex. The twelve
cube edges are UV seams, so once the surface is sculpted the two copies of each
seam vertex get different normals and shading creases along every edge. Average
across `tables.weldMembers` after accumulation (or accumulate into welded slots
and write back). Fine on the sharp cube today; visible the moment it is rounded
further.

Also make it **incremental**: `Sculpt.apply` already returns the touched welded
set. Recompute normals only for touched vertices plus their one-ring; the rest
have not changed. Measured, the full pass is 0.056 ms on today's Clay and would
be ~0.25 ms at 48 divisions — so this is hygiene that keeps cost independent of
mesh size, not the fix for the lag.

## 4. Per-event work that should be per-frame

Today one Pencil event on Grab does all of this on the main thread:

- `Document.sculpt`: `var working = mesh` — `Document.mesh` is a *computed
  property* that rebuilds all 3,750 positions and recomputes every normal.
- `Sculpt.dab`: `let before = mesh.positions` — full array copy, twice when
  symmetric.
- `Sculpt.apply`: full `recomputeNormals` after each dab.
- `EditorModel.refresh` → `renderer.upload(editor.document.mesh)` — **rebuilds
  the mesh again** (second full rebuild + normals), converts every vertex to
  Float, and allocates a fresh 128 KB `MTLBuffer`.
- `view.setNeedsDisplay()`.

Each piece is cheap — the whole per-event chain measures 0.17 ms — the problem
is that it runs **per event at up to 240 Hz**, and the render is paced by input
rather than by the display. That is where "laggy / glitchy" comes from on a display refreshing
at 120 Hz.

### Fix

- **Cache the mesh in `Document`.** Hold `positions`/`normals` as stored state
  updated in place by the brushes; `mesh` returns it. Rebuild from
  `template + sculptDelta` only on undo/redo.
- **Batch input to the frame.** Touch handlers only append samples. Work
  happens once in `draw(in:)`: drain samples → stroke resample → apply dabs →
  incremental normals → upload touched vertices → render. One frame's worth of
  input becomes one frame's worth of work.
- **Coalesced touches.** In `touchesMoved`, iterate
  `event.coalescedTouches(for: touch)`, not just `touch`. UIKit delivers one
  `touchesMoved` per frame and folds the extra Pencil samples into the coalesced
  set; ignoring it throws away three quarters of the Pencil's resolution and
  strokes come out polygonal on fast curves.
- **Continuous drawing during a stroke, on-demand when idle.** On touch-down set
  `isPaused = false`; on touch-up (after the last frame drains) set it back.
  `preferredFramesPerSecond = view.window?.screen.maximumFramesPerSecond`
  (120 on ProMotion), not a hard 60.
- **Renderer buffers.** Keep one persistent shared vertex buffer (a ring of three
  if profiling ever shows a stall, but `makeBuffer` per upload today already
  avoids the CPU/GPU race by never reusing one) and write only the touched
  vertices' bytes through `contents()`. Keep one persistent albedo texture and
  `replace(region:)` the dirty rect instead of creating a 4 MB texture per
  paint refresh.

## 5. Pencil hover cursor

Apple Pencil 2 on M2-or-later iPads and Pencil Pro report **hover** from about
12 mm above the glass. The API is `UIHoverGestureRecognizer` (iPadOS 16.1+);
its `zOffset` (16.4+) is normalised height 0…1, and `azimuthAngle(in:)` /
`altitudeAngle` are available on the same recogniser.

Design:

- Add a `UIHoverGestureRecognizer` to `SculptMTKView`. On `.began`/`.changed`
  pick the surface under the hover point (the existing tested `camera.pick`).
- Draw a **world-space ring** on the surface at the hit: tangent plane at
  `hit.normal`, radius = brush radius in metres, plus a centre dot. A second tiny
  pipeline (line strip, ~64 segments, depth test with a small bias so it sits on
  the surface). Because the ring is the *real* brush radius, it also answers
  "how big is my brush?" honestly at every zoom.
- Fade/scale with `zOffset`: faint and slightly large far away, crisp as it
  approaches, and on touch-down it snaps to the stroke colour. That is the
  "cool Apple effect" — it is Procreate's and Freeform's behaviour and it is
  cheap.
- The hover path **never touches the document**. It writes a cursor uniform and
  requests a frame; nothing else. That keeps it from becoming a second source
  of per-event mesh work.
- `predictedTouches(for:)` may drive the cursor position during a stroke to hide
  the last frame of latency. Never commit predicted samples into the document.
- Extras that are one afternoon each: `UIPencilInteraction` double-tap to toggle
  Paint ↔ Erase (or last tool); Pencil Pro squeeze to pop the tool palette at the
  tip; Pro barrel roll to rotate a non-round brush later.

## 6. Gestures: the small things that read as "not pro"

In `SculptView.makeUIView`:

- `doubleTap` has **no `allowedTouchTypes`**, so a Pencil double-tap on the
  model reframes the camera mid-workflow. Restrict it to `.direct`.
- One `UIPanGestureRecognizer` with `maximumNumberOfTouches = 2` does both
  orbit and pan by counting fingers, so the view **jumps** when a second finger
  lands. Use two recognisers: one-finger (min=max=1) orbit, two-finger (min=max=2)
  pan.
- `pinch.require(toFail: pan)` means pan and pinch are **exclusive** — you cannot
  zoom while panning, which every 3D app allows. Make the two-finger pan, pinch
  and (later) two-finger rotate **simultaneous** via
  `gestureRecognizer(_:shouldRecognizeSimultaneouslyWith:)`, sharing the
  midpoint as the anchor so zoom happens about the fingers, not the target.
- **Inertia** on orbit: on `.ended` take the pan's `velocity(in:)`, decay it
  with a ~0.92/frame factor while unpaused, stop below a threshold. This is the
  single biggest "feels expensive" upgrade for the cost of ten lines.
- **Brush radius in screen space by default.** The slider is world metres
  (0.005…0.12). Pro sculpting apps size the brush in screen pixels and convert
  at the hit depth: `world = px × 2·d·tan(fov/2) / viewportHeight`. Zoom in and
  you get fine detail for free; the hover ring stays the same size on screen.
  Keep a "lock world size" toggle for people who want the other behaviour.
- **Light stabiliser** on sculpt hit positions (EMA α≈0.5) to take the
  hand-tremor out of Pencil input without feeling laggy. Paint gets none —
  painters expect the raw line.

## 7. "How would I know if it holds 60 fps?"

Nothing on screen says. Two fixes:

- **Debug HUD**, off by default, toggled by three-finger tap (the Birb Labs
  convention — three fingers is the first count the tool itself never uses):
  frame time (ms, with a 120-frame sparkline), fps, dabs this frame, texels
  painted this frame, vertices uploaded this frame, `MTLCommandBuffer`
  `gpuEndTime − gpuStartTime`. This is the on-device analogue of Gauntlet's
  `window.__GAUNTLET_STATS()`; without it a device report is an impression.
- **Xcode's FPS gauge** while attached (Debug navigator → FPS) and Instruments
  → Metal System Trace for a proper look. Neither needs code.

Budget: 120 fps on iPad Pro, 60 on the rest, with stroke input costing < 2 ms
of CPU per frame at the default brush.

## 8. Rendering polish that is close to free

- `view.sampleCount = 4`. Apple's tile-based GPUs resolve MSAA in tile memory;
  4× is nearly free and removes the shimmer on every sculpted edge. Requires a
  matching `pipeline.rasterSampleCount`.
- Matcap-style shading option later; the half-Lambert + rim in `Shaders.metal`
  is right for now.
- A subtle **ground shadow / contact disc** under the model gives the eye a
  floor. Later.

---

## Order of work

Each step is independently shippable and each has a Linux test where the logic
lives in the core.

1. **`Sculpt.Stroke` resampling + live application of every tool + retuned
   per-dab amounts.** Kills the inside-out spikes and the pen-up jump. Core +
   `EditorModel`. *Tests: event-count invariance; displacement bound.*
2. **Projection painting** (Blender-style: precomputed texel runs + affine
   maps, per-frame swept segment); delete `dabAcrossSeams`/`seamUVs`. Core.
   *Tests: no bleed outside the hit tile; seam continuity; event-count
   invariance; bench under 4 ms at r = 0.12 on 2048².*
3. **Welded + incremental normals**; cached mesh in `Document`. Core.
   *Tests: normals equal across weld members; incremental == full recompute.*
4. **Frame-batched input** (coalesced touches, unpause during stroke, drain in
   `draw`), persistent vertex buffer and texture with partial updates,
   `maximumFramesPerSecond`. App only.
5. **Hover cursor** (ring pipeline, `UIHoverGestureRecognizer`, `zOffset`
   fade), screen-space brush radius. App + a `Camera` helper for px→metres
   (testable).
6. **Gesture fixes** (double-tap touch type, split orbit/pan, simultaneous
   pan+pinch, inertia). App only.
7. **Debug HUD** and MSAA 4×.

Steps 1–3 are where the engine was wrong; 4–7 are where it was merely not yet
pro. Do them in that order — the hover ring is the fun one, and it will be
tempting to start there, but it will be drawing the brush radius around a tool
that still spikes.

## What was right

For the record, because the first-build report is also evidence of what the
Linux-side testing bought: projection, view matrix, screen→ray, the top-left
flip, `contentScaleFactor`, vertex layout, index buffer, sRGB, depth, winding,
culling, template loading, undo grouping. Everything the tests covered worked
first time on hardware. Everything that did not was in the two places the tests
did not reach — the per-event application policy in `EditorModel`, and the
UV-space assumption in `Paint` that a cube atlas breaks.

---

## 9. What the first screenshot adds (2026-09-08, 11:29)

Mentis's first sculpt: a face with blue eyes, an orange nose, a yellow moustache
and a crown of spikes. Three things in it are diagnostic beyond the table above.

1. **The spikes are §1, photographed.** A cluster of sharp yellow pyramids on
   the crown — a few hundred inflate dabs stamped at pen-up into one spot. Their
   faces are flat-shaded and some catch light from the wrong side: those are the
   folded, back-face-culled triangles that read as "inside out".
2. **The surface is faceted.** The grabbed ears and the brow show flat polygons.
   Clay is 24 divisions per cube face — 3,458 welded vertices, 6,912 triangles.
   That was chosen to sit under the VRChat mobile 10k limit, but that limit is a
   **humanoid export** constraint, not a sculpting one, and Clay exports a static
   mesh. Raise Clay to 48 divisions (~13.8k vertices, ~27.6k triangles): four
   times the surface resolution, still trivial for Metal, and every per-dab cost
   in this plan scales with the vertices *inside the brush*, not the mesh. The
   template is byte-reproducible and CI-verified, so this is a one-constant
   change in `build_clay.py` plus a regenerated blob. It should happen with step
   3, since incremental normals are what keep a larger mesh free.
3. **The paint is soft.** Edges of the eyes and nose blur. The albedo is 1024²
   across a 3×2 atlas, so each face gets ~340 px — on a hand-sized object that is
   under 1 px/mm. The PRD target is 2048 with a 1024 export preset; move the
   document to 2048 in step 2, when projection painting lands and the texel loop
   is being written anyway.

Symmetry was on and the face came out symmetric, so the mirrored dab path is
right on hardware too.

---

## 10. What shipped (2026-09-08)

All seven steps, plus the two core fixes they rested on. 189 → 193 tests, the
eight-stage gate green, and `humanoid-cli bench` added as the release-mode
authority for anything per-texel.

### The three device findings, and what each turned out to be

**"Sometimes it goes inside out."** Not winding, not culling. Inflate, Deflate,
Smooth and Paint applied nothing until pen-up and then stamped **one dab per
Pencil event** at a per-*gesture* amount. `SculptStrokeTests` reproduces it
headless: a hundred and twenty samples of a Pencil held still, with the brush
re-raycast each time as the editor does, extrudes a spike and then **stops being
raycastable at all** — the surface has folded through itself and back-face
culling finds no front face on the axis. Strokes are now resampled to a dab
every quarter radius and the per-dab amount is 0.04 rather than 0.35.

One thing that only appeared once the resampler existed: a stroke must advance
by **pointer** travel, not by how far the surface moved, or Inflate partly
measures its own output. The loop gain is `inflatePerDab / spacing` — 0.16 today,
and a test pins it below 1.

**"Painting onto a side has it show up someplace else."** A disc stamped in UV
space, on an atlas whose six face tiles touch. Not tunable: replaced with a
world-space sphere. Bleed is now impossible by construction and seams need no
special case in any orientation.

**"How would I know?"** Three-finger tap shows fps, frame time with its worst
case, GPU milliseconds from the command buffer's own clock, draw calls,
triangles, brush size in millimetres and dabs per frame.

### Numbers, measured

Build box, release, `humanoid-cli bench`. A control loop of comparable float
work runs at 3 ns an iteration, so these are calibrated rather than asserted.

| | 1024² | 2048² |
|---|---|---|
| Paint map build (once, at load) | 27 ms | 68 ms |
| Albedo snapshot for undo (once per **stroke**) | 0.36 ms | 5.1 ms |
| Paint, default brush, per **frame** | 0.57 ms | 1.08 ms |
| Paint, largest brush (r = 0.06), per frame | 1.2 ms | 3.9 ms |
| Sculpt, any brush, per frame | < 0.55 ms | — |
| `Picking.raycast`, 6,912 triangles | 0.072 ms | — |

The painter went from 71 ms to 27 ms at the widest setting on 2048² over four
measured passes. What actually moved it, in order of size, and none of it
guessable:

1. **Dilating every triangle** to cover bilinear filtering made the map own
   **195% of the texture**. Only island-edge triangles need a gutter — 103%.
   Before this the "optimised" painter was *slower* than the naive one.
2. **Three signed `Int` divisions by 255** in the blend cost more than all the
   geometry above them.
3. **Four nested `withUnsafeBufferPointer` closures** defeated the type checker,
   and a body the compiler cannot type is one it does not optimise either.
   Lifting the loop into a function taking raw pointers was worth a third.
4. Strength reduction along the row; scalar `Float` instead of `SIMD3<Float>`,
   whose `.sum()` does not lower to a horizontal add.

And one measurement about measurement: **`@testable import` numbers are not
release numbers.** It compiles the library with `-enable-testing`, which cost
this loop several fold. The paint bench moved out of XCTest into the CLI.

### Decisions the measurements settled

- **The texture stays at 1024.** The PRD asks for 2048 and the per-frame cost
  would be fine, but the undo snapshot is a copy-on-write charged to the first
  texel of every stroke: 5.1 ms, a dropped frame each time the Pencil lands.
  2048 is gated on making undo sparse (record each texel's original on first
  touch, rather than snapshotting the whole albedo), which is the next
  optimisation and now has a number attached.
- **The brush maximum is 0.06, not 0.12.** Clay is a 24 cm cube, so the old
  maximum was a brush as wide as the model's half-width. At 0.06 the largest
  brush meets the 4 ms target even at 2048².
- **The vertex buffer is uploaded whole, not partially.** Converting all 3,750
  vertices costs 0.026 ms; tracking which normals the one-ring dirtied, in two
  places, to save a fortieth of a frame is a stale-normal bug waiting to happen.
  What mattered was not *allocating* to do it — three buffers in rotation now.
- **Clay stays at 24 divisions.** The faceting in the first screenshot is real,
  but picking is linear over triangles at 0.072 ms per ray, so 48 divisions puts
  ~1.2 ms per frame into raycasting alone. Density wants a BVH first.

### Still open

- Sparse undo, which unlocks 2048.
- A BVH for picking, which unlocks a denser Clay.
- Pencil Pro squeeze → tool palette at the tip (`UIPencilInteraction`,
  iOS 18); the double tap is wired, squeeze is not.
- The `lockWorldSize` toggle exists on the model but has no control in the UI.
