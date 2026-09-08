# Baby Blender — performance and smoothness research

**Date: 2026-09-08. Companion to `Editor_Feel_Plan.md`.** That file says *what*
is wrong and the order to fix it. This one supplies the *evidence*: platform
facts checked against current Apple documentation, the behaviour of the pro
tools we are measured against, and the cost of our own core measured on the
build box. Where the plan and this file disagree, this file wins, and the plan
has been updated to match.

Everything here was gathered for the Opus build pass so that it starts from
sourced facts and measured numbers rather than from memory. Sources are listed
at the end; inline references use `[n]`.

---

## 0. The headline: the sculpt maths is not the problem

`Tests/HumanoidCoreTests/BenchmarkTests.swift` (opt-in, `BABY_BLENDER_BENCH=1`,
release build) times the actual core on the actual clay template. Linux x86,
Swift 6.1.2, `-c release`:

| Operation (clay: 3,750 verts / 3,458 welded / 6,912 tris, 1024² albedo) | ms |
|---|---|
| `Document.mesh` — full rebuild from template + delta, **plus full normals** | 0.070 |
| `MeshData.recomputeNormals` (full) | 0.066 |
| `Sculpt.apply` grab, r = 0.03, symmetric, 74 welded touched (incl. full normals) | 0.096 |
| `Sculpt.apply` grab, r = 0.06, 290 welded | 0.105 |
| `Sculpt.apply` grab, r = 0.12, 941 welded | 0.174 |
| `Document.sculpt` — the whole per-event path Grab runs today | 0.162 |
| Vertex Double→Float interleave for the GPU (all 3,750) | 0.014 |
| `Paint.dab` UV disc, r = 0.018 | 0.041 |
| **Projection paint, naive**, r = 0.03 — 95 tris, 42k texels tested | 0.53 |
| **Projection paint, naive**, r = 0.06 — 332 tris, 148k texels | 1.91 |
| **Projection paint, naive**, r = 0.12 — 1,077 tris, 479k texels | 6.27 |

A 120 Hz frame is 8.33 ms. **Every sculpt operation is under 0.2 ms, including
the two full rebuilds it does not need.** Even at 240 Pencil events a second
the sculpt path costs ~40 ms/s of CPU — under 5% of a core. The lag Mentis felt
is therefore *not* arithmetic. It is:

1. three tools that do nothing until pen-up (`EditorModel.commit`);
2. rendering paced by input events rather than by the display;
3. one dab per event at pen-up with a per-gesture-sized amount — the spikes.

The plan's steps 1 and 4 fix all three. **Do not** move sculpting to a
background thread, rewrite the core in Float, or restructure the mesh storage on
performance grounds: the numbers say there is nothing to gain and the tests
would have to be rewritten. Those are answered questions now.

The one thing that *does* need engineering is projection painting (§4).

### Scaling to the planned Clay and texture

- **Clay at 48 divisions** (~15k verts, ~27.6k tris): sculpt cost scales with
  vertices *inside the brush*, so a given world radius touches ~4x the
  vertices and the full-normals pass is ~4x: still ≈ 0.3 ms. Fine. Incremental
  normals (plan §3) make it independent of mesh size and are worth doing, but
  they are not on the critical path for feel. Re-run the bench after
  regenerating the template; that is one command.
- **2048² albedo**: 4x the texels for the same world radius. The naive
  projection numbers above become 2.1 / 7.6 / 25 ms — over budget at the two
  larger radii. This is why §4 is not optional.

---

## 1. Input: Pencil, coalescing, prediction, hover

**Delivery rate.** UIKit delivers `touchesMoved` once per display refresh; the
Pencil samples at up to 240 Hz; the extra samples are folded into the delivered
touch and exposed via `UIEvent.coalescedTouches(for:)`, which returns *all*
touches since the last event including the delivered one. They must be read
during the event — there is no guarantee they survive it [1]. Today
`SculptMTKView.report` reads `touches.first` only, throwing away three of every
four Pencil samples at 60 Hz and one of two at 120 Hz. Fast curves come out
polygonal. **Iterate the coalesced array.**

**Prediction.** `UIEvent.predictedTouches(for:)` returns UIKit's estimate of
where the touch will be roughly a frame ahead. Apple's rule is explicit: treat
them as temporary, draw them, and discard them on the next real event [2].
They are for the cursor/preview only. **Never commit a predicted sample into the
document** — it would put geometry where the Pencil never went.

**Hover.** `UIHoverGestureRecognizer` on iPadOS 16.1+; `zOffset` (normalised
0…1 height), `azimuthAngle(in:)` and `altitudeAngle` from 16.4 [3][4]. Supported
by Apple Pencil 2 on M2-or-later iPad Pro and by Apple Pencil Pro; hover range is
about 12 mm [5]. Apple's own sample does exactly what the plan proposes — a
preview of where the tip will land whose alpha is
`1 − max(zOffset − fade, 0) / (max − fade)`, fully opaque near the glass and
fading to nothing at the top of the range — and restricts it to the Pencil with
`hoverGesture.allowedTouchTypes = [.pencil]` so a trackpad does not trigger it.
Two of their guidelines matter to us: **do not start the hover preview until
the draw gesture has ended** (otherwise the cursor and the stroke fight), and
**keep it subtle far away, prominent close** [4]. Procreate's team describe the
same design and the trap they fell into: they assumed pinch-and-hover would be
universal and found that anyone holding the iPad on a couch has no free hand
for it — design hover for the stand *and* the couch [5]. Procreate renders the
exact outline of the mark the brush will make, tilt included, and considers
that hard for its brush engine; ours is a circle on a surface, which is easy.

**Pencil Pro (iPadOS 18+).** `UIPencilInteraction` delivers double-tap and
squeeze; the squeeze carries a `UIPencilHoverPose` (location, zOffset,
azimuth, altitude, **roll**). Respect `UIPencilInteraction.preferredSqueezeAction`
— if the user has Settings pointed at a system shortcut, the app does not
receive the squeeze at all; if it is `.showContextualPalette`, present the tool
palette *at the hover location*. SwiftUI has `.onPencilSqueeze` and
`@Environment(\.preferredPencilSqueezeAction)`. `rollAngle` is on both `UITouch`
and the hover recogniser and is estimated first, corrected over Bluetooth — adopt
`touchesEstimatedPropertiesUpdated` if it ever drives a brush [6]. For us: squeeze
→ palette at the tip; double-tap → toggle Paint/Erase or last tool; roll → nothing
until there is a non-round brush.

**Stabiliser.** Every serious tool has one: ZBrush "Lazy Mouse", Blender
"Smooth Stroke", Krita "Stabilizer", Nomad "Lazy Rope" [7][8]. The rope model is
the right one for sculpting: the brush is dragged by a rope of length *L*
behind the Pencil and only moves when the rope is taut, so hand tremor inside
*L* is absorbed with no time lag on deliberate motion. Nomad exposes it in stroke
settings and draws the rope while it is active; there is a standing user request
to have it off by default because it changes the feel [8]. **Ship it off by
default, toggleable, with the rope drawn.**

## 2. Frame pacing on ProMotion

`MTKView.preferredFramesPerSecond` is rounded to the nearest **factor** of
`maximumFramesPerSecond` (120 on ProMotion, 60 otherwise) — 45 does not exist,
it becomes 40 or 60 [9]. `UIScreen.maximumFramesPerSecond` is 120 on ProMotion
iPads; **the `CADisableMinimumFrameDurationOnPhone` plist key is for iPhone only
and is not required on iPad** [10]. Apple's guidance is that a *steady* rate
beats a maximum one: pick the highest rate you can hold every frame, not the
highest the panel offers [9]. The system will lower the rate under Low Power
Mode and thermal pressure regardless, and a callback that overruns its
`targetTimestamp` loses the next slot — so the per-frame work has to be bounded,
which is what §0 establishes it is [10].

For our render-on-demand design: `isPaused = true, enableSetNeedsDisplay = true`
is the documented pattern for a drawing app that changes only when touched, and
is the right idle state for battery [11]. During a stroke, though, input arrives
every frame and the work should be done *by* the frame, not *by* the event:
**unpause for the duration of the stroke** (and of any inertia), drain the
sample queue in `draw(in:)`, re-pause when idle. That makes one frame of input
into one frame of work, independent of Pencil rate.

## 3. Metal resources

- **Shared storage** is the correct mode for CPU-updated vertex buffers and
  textures on iOS; `didModifyRange` and Managed mode are macOS-only [12].
- **Do not create a buffer per frame.** Apple's best-practice guide is blunt
  about it and prescribes a ring of three with a semaphore so the CPU writes
  frame *n+1* while the GPU reads frame *n* [13]. The renderer today allocates a
  new 128 KB `MTLBuffer` per upload; at 4k vertices it is not slow (0.014 ms
  to convert) but it is allocation churn on the render thread. Move to one
  persistent shared buffer written through `contents()` for the touched
  vertices only; add the three-ring only if Instruments ever shows a stall —
  at 128 KB the copy is cheaper than the bookkeeping.
- **The albedo texture is recreated (4 MB) on every paint refresh.** Keep one
  texture and `replace(region:)` the dirty rect that `Paint` already returns.
- **MSAA 4×**: Apple GPUs resolve multisample colour in tile memory, so the
  multisample target can be `.memoryless` and the resolve costs no bandwidth;
  4 is the guaranteed-supported count and the recommended default [14][15].
  `MTKView.sampleCount = 4` plus `rasterSampleCount = 4` on the pipeline is the
  whole change. Edges of a sculpted surface shimmer without it.

## 4. Texture painting: how the real ones do it

Blender's PBVH texture paint (the design behind its 3.x sculpt-mode painting)
is the reference implementation [16][17]. Per triangle it **precomputes** the
texels the UV triangle covers, packed as row runs (start x, y, count), and a
3×3 **affine matrix from pixel coordinates to object-space position**, so a
stroke evaluates each covered texel as one matrix-vector multiply and a
distance test — no barycentric solve per texel. Seams are handled by dilating
island masks by a seam margin and duplicating border triangles onto the
neighbouring island so filtering never samples an unpainted gutter. Only pixel
*values* change per stroke; the mapping is rebuilt only when UVs or topology
change — which for us is **never**.

That last point is decisive for Baby Blender. Because topology and UVs are
immutable, **the texel→triangle map and the pixel-run table are template
constants**: they can be generated offline like every other table in
`MeshTables`, or built once at load in a few milliseconds. What varies per
stroke is only the positions used for the world-space distance test, and those
are `template + sculptDelta` for the three corners of each triangle.

Our naive prototype (bounding-box walk, barycentric solve per texel) measured
0.53 / 1.91 / 6.27 ms at r = 0.03 / 0.06 / 0.12 on 1024² (§0). Where the time
goes: a cube-face triangle's UV bounding box is a square containing *two*
triangles, so half the texels tested are outside the triangle, and the whole
triangle is walked even when the brush clips one corner. With precomputed runs
the outside-triangle waste disappears, and clipping each run to the sphere's UV
bounding box removes most of the rest. Expect 4–8x, which puts r = 0.12 on 2048²
at roughly 3–6 ms — acceptable for the biggest brush and tiny for the default.

Two further wins, in order of value:

1. **Paint per frame as a swept segment, not per dab.** With frame-batched input
   the painter receives a polyline per frame; test each texel against the
   *capsule* of that polyline once, rather than once per dab. Cost becomes
   proportional to the area swept per frame, and spacing stops mattering
   entirely. Sculpt keeps dabs (a displacement has to accumulate); paint does
   not need them.
2. **Move the texel loop to a Metal compute kernel** later if 2048² at large
   radius on an A15 proves tight. The data layout above (runs + affine maps in
   buffers) is already GPU-shaped. Not for this pass.

Nomad's forum shows what happens when a stroke pipeline is *not* independent of
frame rate: under load its dab spacing visibly opens up and curves become
chords, and the developer's answer is to reduce render cost ("disable
postprocess, matcap, partial drawing") rather than to fix the coupling [18].
Distance-resampled strokes fed from coalesced touches are how we avoid having
that conversation.

## 5. Brush size convention

ZBrush's `Draw Size` is a radius **in screen pixels**, with a *Dynamic* mode that
rescales it with the model so it does not balloon when you zoom out [19]. Nomad
offers both explicitly — *Screen* ("100 pixels wide stays 100 pixels wide
regardless of zoom") and *Constant (3d)* in world units [20]. Ours is world
metres only. **Default to screen-space radius**, converted at the hit depth
(`world = px × 2·d·tan(fov/2) / viewportHeight`, a `Camera` helper that is
testable on Linux), with a world-lock toggle. It is what a hover ring wants
too: the ring stays the same size on screen until you lock it.

## 6. Gestures and camera

- Apple's simultaneous-recognition delegate
  (`gestureRecognizer(_:shouldRecognizeSimultaneouslyWith:)`) is the standard
  way to let pan, pinch and rotation run together in one two-finger gesture;
  by default recognisers block each other, which is exactly the "can't zoom
  while panning" feel today [21]. Anchor the zoom at the finger midpoint.
- Inertia: UIScrollView's model is exponential velocity decay per millisecond
  (`.normal` = 0.998, `.fast` = 0.99), integrated to a logarithmic position
  curve; take `velocity(in:)` from the pan on `.ended` and apply the same decay
  to azimuth/elevation each frame while unpaused [22]. `.normal` feels like a
  turntable; start there.
- Restrict the double-tap to `.direct` touches so a Pencil double-tap never
  reframes the camera.

## 7. Refactor decisions, argued

- **Keep `Vec3 = SIMD3<Double>` in the core.** Everything from the exporters to
  the 155 tests is written against it, the per-dab cost is 0.1 ms, and the
  Float conversion for the GPU is 0.014 ms. A Float core would buy nothing
  measurable and cost a rewrite. Revisit only if a profile of a 50k-vertex
  template on an A14 says otherwise.
- **Make `Document.mesh` cached state, not a computed rebuild.** It is 0.07 ms
  today, but it is called twice per event and it is the wrong shape for
  incremental normals and partial GPU uploads. Store `positions`/`normals`
  updated in place; rebuild from `template + sculptDelta` only on undo/redo and
  load.
- **Stay on the main thread.** With every sculpt op under 0.2 ms and paint
  bounded by §4, there is no work here that justifies a second thread and the
  synchronisation it drags in. The frame-batching in §2 is the concurrency
  model.
- **`Sculpt.apply` returns the touched set** and Blender's own note on sculpt
  normals is that most of the time goes to *bookkeeping* which vertices are
  dirty, not to the maths [23]. Keep it simple: touched welded set → union of
  one-rings → recompute those. A dirty bitvector is the upgrade if the set
  logic shows up in a profile.

## 8. What to measure on the device

The bench is the build-box half. The other half is the debug HUD in the plan
(§7 there): frame time, fps, dabs and texels per frame, `MTLCommandBuffer`
`gpuEndTime − gpuStartTime`. Targets: **120 fps on ProMotion with a stroke in
progress at the default brush; < 2 ms CPU per frame for input + sculpt; < 4 ms
for input + paint at the largest brush on 2048².** Report those three numbers
with every device test from now on, the way Gauntlet reports
`__GAUNTLET_STATS`.

---

## Sources

1. Apple, *Getting high-fidelity input with coalesced touches* — https://developer.apple.com/documentation/uikit/touches_presses_and_gestures/handling_touches_in_your_view/getting_high-fidelity_input_with_coalesced_touches
2. Apple, *Minimizing latency with predicted touches* — https://developer.apple.com/documentation/uikit/minimizing-latency-with-predicted-touches
3. Apple, `UIHoverGestureRecognizer.zOffset` — https://developer.apple.com/documentation/uikit/uihovergesturerecognizer/zoffset
4. Apple, *Adopting hover support for Apple Pencil* (sample) — https://developer.apple.com/documentation/UIKit/adopting-hover-support-for-apple-pencil
5. Apple Developer News, *Spotlight on: Apple Pencil hover* (Procreate) — https://developer.apple.com/news/?id=23ksaoks ; TechCrunch on 16.4 hover — https://techcrunch.com/2023/03/27/apple-discusses-ipados-16-4s-new-pencil-hover-features/
6. Apple, WWDC24 *Squeeze the most out of Apple Pencil* — https://developer.apple.com/videos/play/wwdc2024/10214/
7. Drawpile / OpenToonz stabiliser threads — https://github.com/drawpile/Drawpile/issues/179 ; https://github.com/opentoonz/opentoonz/issues/81
8. Nomad forum, *Lazy Rope off by default* — https://forum.nomadsculpt.com/t/lazy-rope-feature-off-by-default/4287
9. Apple, *Metal Best Practices: Frame Rate* — https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/FrameRate.html
10. Apple, *Optimizing iPhone and iPad apps to support ProMotion displays* — https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays
11. Apple Developer Forums on `isPaused`/`enableSetNeedsDisplay` — https://developer.apple.com/forums/thread/105252
12. Apple, *Metal Best Practices: Resource Options* — https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/ResourceOptions.html
13. Apple, *Metal Best Practices: Triple Buffering* — https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/TripleBuffering.html
14. Apple, *Improving edge-rendering quality with MSAA* — https://developer.apple.com/documentation/Metal/improving-edge-rendering-quality-with-multisample-antialiasing-msaa
15. Apple, WWDC20 *Harness Apple GPUs with Metal* — https://developer.apple.com/videos/play/wwdc2020/10602/
16. Blender, *PBVH image texture painting technical design* (T96223) — https://projects.blender.org/blender/blender/issues/96223
17. Blender source, `pbvh_pixels.cc` — https://github.com/blender/blender/blob/main/source/blender/blenkernel/intern/pbvh_pixels.cc
18. Nomad forum, *Brush stroke spacing changes when lagging* — https://forum.nomadsculpt.com/t/brush-stroke-spacing-changes-when-lagging/4604
19. Maxon, ZBrush *Draw* palette (Draw Size, Dynamic) — https://help.maxon.net/zbr/en-us/Content/html/zbrushcore/reference-guide/draw/draw.html
20. Nomad manual, *Settings* / *Stroke* — https://nomadsculpt.com/manual/settings ; https://nomadsculpt.com/manual/stroke
21. Ole Begemann, *Gesture Recognition on iOS With Attention to Detail* — https://oleb.net/blog/2012/01/gesture-recognition-on-ios-with-attention-to-detail/
22. Ilya Lobanov, *Deceleration mechanics of UIScrollView* — https://medium.com/@esskeetit/scrolling-mechanics-of-uiscrollview-142adee1142c
23. Blender PR, *Sculpt: Reduce overhead in Mesh normals calculation* — https://projects.blender.org/blender/blender/pulls/163164
