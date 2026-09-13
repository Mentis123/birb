# The bird rebuild — plan (2026-09-13)

This is R1 from [BUILD_BACKLOG.md](BUILD_BACKLOG.md), planned against what
the bird actually is rather than what the backlog assumed. Phase 0 has since
shipped and Phase 1 is flagged — see **Status** below. Every number in the
plan body was measured on main `1c810b7` with
`__BIRB.birdStats()`, which this plan adds so the next session can re-measure
instead of trusting this page.

## Status (2026-09-13, later the same day)

**Phase 0 shipped.** Measured live with `__BIRB.birdStats()` on the merged
tree: **8 meshes / 8 draw calls / 3,408 triangles / 3 materials** (from
44 / 44 / 11,780 / 14), same silhouette, same albedo hexes part for part.
Whole-frame draw calls at spawn fell 64 → 27 in an apples-to-apples A/B where
only `index.html` differed. `src/flight/bird-contract.js` and
`tests/bird-contract.test.js` exist; `?glb=1` runs the contract and falls
back to the procedural bird with a warning (the shipped `birb.glb` fails it —
all five named nodes missing). The ten-tile sheet from
`node tools/birb-bird-sheet.mjs` is intact at every angle and the tool now
exits 1 on a tile that is only background, because its first evidence sheet
was exactly that and nothing noticed.

**Phase 1 is built as a flagged candidate, `?bird=v2`, and is NOT the
default.** 8 calls / 2,202 tris, contract green, ten tiles intact
(`node tools/birb-bird-sheet.mjs --query bird=v2`). Its two adversarial
verifiers never ran (session limit), so the only review it has had is one
pair of eyes on the two sheets side by side, and that review says: sound,
and not obviously better. The feather-plate wings are thinner than the
Phase 0 cones at chase distance, and the lofted body reads as a smooth
capsule where Phase 0 kept a pale belly. That is the question the blind
paired forced-choice on the phone exists to answer, and it has not run.
Until it does, Phase 0 is what ships.

Phases 2 and 3 are unchanged: not started.

## The measurement that changes the order of work

| | Value | Of the frame |
|---|---|---|
| Meshes | **44** | — |
| Draw calls | **44** (one per mesh; nothing merged or instanced) | **65%** of the 68 scene calls at spawn |
| Triangles | **11,780** | 16% of 75,658 |
| Unique materials | 14 (each with its own rim-light injection) | — |
| Unique geometries | 36 | — |
| World size | 1.42 × 0.86 × 1.44 units, at anchor scale 0.52 | ~140 px tall on a phone, chase camera 8 back / 3 up |

Read that first row again. **The bird is two thirds of the draw calls in the
game.** A 140-pixel object is spending 11,780 triangles — the body alone is a
`SphereGeometry(0.5, 36, 28)`, 2,016 triangles, drawn as a 60-pixel egg — and
44 draw calls, on a phone, against a budget of 100 the world already pushes to
93–96 in a champion grove.

So the backlog's framing ("the bird is the next fidelity jump") is right, but
the first phase is not art. It is the same move that made the forest
affordable: **merge and decimate before you decorate.** That phase costs half
a day, needs no asset, no phone and no taste, and pays whether or not the art
phases ever ship.

## What a replacement bird MUST satisfy — the rig contract

The rig lives in `index.html` (~line 9690 onward) and `src/flight/bird-pose.js`
holds the pure maths. It is good — asymmetric power/recovery stroke,
burst-and-glide cadence, perch fold, knockdown tumble, tail-as-elevator, walk
cycle, foot tuck. **None of that is being rebuilt.** It drives the model by
name, and this is the exact list a new model has to expose:

| Node | Type | What the rig writes | Notes |
|---|---|---|---|
| `leftWing`, `rightWing` | Group, at the shoulder | `rotation.x` (dip + flap + fold + tumble), `scale.z` (span) | `userData.baseRotation` (Euler) is REQUIRED. The right wing is mirrored with **`scale.z = -1`** and the rig writes `rightWing.scale.z = -span`; a model that mirrors any other way breaks the flap on one side. |
| `leftWing.userData.secondaryFeather` | Object3D | `position.y` (flex lag) | Optional but keep it — it is the follow-through. |
| `leftWing.userData.tipFeather` | Object3D | `position.y` (flex ×1.5); **`getWorldPosition` feeds the wingtip ribbon trail** | REQUIRED, or `src/effects/ribbon-trail.js` has no anchor and the boost trail silently vanishes. |
| `tail` | Group | `rotation.x/y/z`, `scale.z` | `userData.baseRotation` REQUIRED. |
| `leftFoot`, `rightFoot` | Group | `rotation.x` (walk), `rotation.z` (tuck) | — |

Plus two conventions from `positionBirbModel`: the model is **re-centred on its
bounding-box centre** so yaw/roll pivot on the body, and the whole thing is
scaled ×0.52 on `birbAnchor`. The asset contract says origin-at-feet; the
runtime says pivot-at-centre. That conflict is real and Phase 0 resolves it
(below), because a rebuilt bird with a longer wingspan moves the bbox centre
off the body and the bird starts yawing about a point in the air.

**This contract is why the existing `birb.glb` lost its A/B.** Measured:
1 mesh, 1 material, 10,000 triangles, no skin, no animation, no named nodes,
and 1,368 KB of its 1,728 KB is one baked JPEG. It cannot flap. An authored
bird without the rig contract is a statue with a texture on it, and the
procedural bird beat it because it moves. Every route below keeps the rig.

**The bird is invisible at the perch.** `birbAnchor.visible = mode !== FPV`,
and nesting is FPV. So the perch fold animation runs on a bird nobody sees,
and every unit of fidelity has exactly one customer: **the chase camera, from
behind and above, banking.** The back, the upper wing surfaces, the tail fan
and the crest are what is on screen. The belly and the face are on screen for
the two seconds of a takeoff turn. Spend accordingly.

## Three routes, and which one this project can actually execute

| Route | What it is | Assets | Rig | Honest status |
|---|---|---|---|---|
| **A. Procedural v2** | Rebuild in code: few merged meshes, real feather plates, sane tessellation, native rig contract | none | native | Executable now. Every tool exists. |
| **B. Authored rigged GLB** | A modelled bird with named nodes matching the contract, baked textures, 3 LODs | 1 GLB + textures | must be authored in | **Not executable with the tools in this project.** Needs Blender or a service that emits a rigged, named-node glTF. ChatGPT produces images, not rigs. |
| **C. Hybrid** | Route A's mesh with proper UVs, dressed in **authored feather textures** through the exact pipeline that shipped bark, stone and skies this week | 2–3 PNGs | native | Executable the day Phase 1 has UVs. This is the route that matches what works here. |

Route B is the backlog's picture of R1 and it is the best image. It is also
the one item with no proven consumer and no proven producer. It goes to a
go/no-go after Phase 1, not before — the same rule that killed the roughness
map and the IBL: **prove the consumer before commissioning the asset.**

## Phases

### Phase 0 — measure, merge, decimate  (half a day, no art, ship it)

Goal: the same bird, at a fraction of the cost, with a contract test.

1. **Tessellation.** Spheres at 36×28 → 18×14 for the body/head, 12×10 for
   everything under 0.2 units. Cones with 20 radial segments → 8. Target
   **≤ 4,000 triangles**. Nothing under 0.05 units gets more than 6 segments.
2. **Merge by material.** 44 meshes into ~6: body (body+belly+saddle+head+
   cheek merged with per-vertex colour), beak, eyes, each wing (kept as a
   Group with ONE merged blade mesh + the tip as a separate tiny Object3D so
   `tipFeather` survives), tail (one merged fan mesh inside the `tail` group),
   feet (one mesh each inside their groups). Target **≤ 8 draw calls**.
   `BufferGeometryUtils.mergeGeometries` is in three's examples; vertex colour
   replaces the per-part materials.
3. **Materials.** 14 → 3: feather (Standard, vertex-coloured), beak/feet
   (Standard), eyes (Basic, unlit). Rim light injected once per material.
4. **Pivot.** Stop re-centring on the bbox; centre on the body's own origin,
   which the constructor knows. Origin-at-feet for the asset contract is a
   Group offset above that, not a bbox guess.
5. **The contract test.** `tests/bird-contract.test.js`: a validator
   `birdRigContract(model)` that walks any model and asserts the table above
   — the five named groups, both `baseRotation`s, `tipFeather` on both wings,
   right wing `scale.z < 0`. Run it against the procedural bird in the test
   fake, and wire it into the `?glb=1` load path so a GLB that fails it
   **falls back with a warning** instead of shipping a statue. This is the
   check that would have caught the current GLB, and it is what makes Route B
   commissionable at all.

Gate: `birdStats()` ≤ 8 calls / ≤ 4,000 tris; `birb-modes` green; the bird
contract test green; a **six-angle bird sheet** (below) shows no seam, no
hole and no dropped part. Then a blind paired A/B on the owner's phone
against main — it should be indistinguishable or better at 140 px, and if it
is visibly worse the decimation went too far, not the idea.

### Phase 1 — procedural v2: a bird, not an egg with cones  (2–3 sessions)

The ceiling the research package named: "rounded component-based anatomy".
Same rig, same materials, new geometry, built for the chase view.

- **Wings that are wings.** Replace the single flattened cone with a
  shoulder→wrist→tip chain of overlapping feather plates: coverts at the
  shoulder, secondaries along the arm, primaries fanning from the wrist with
  visible finger separation at the tips. Each plate is a thin quad strip with
  a real leading and trailing edge, so the wing has a silhouette from above,
  behind AND edge-on — the three angles the camera actually sees. Keep the
  whole wing as ONE merged mesh under the `leftWing` group; `tipFeather`
  becomes an empty at the outermost primary's tip.
- **Body with a neck and a back.** One lathe/loft profile, not two spheres:
  a real S-curve from beak through neck to a rounded back and a tapered rump
  into the tail, so the top-down chase view reads a spine and shoulders
  instead of two balls. Flat-shaded is fine and matches the world; the shape
  is what is missing, not the shading.
- **Tail as a fan of feathers**, already the design — keep it, merge it,
  give the feathers a slight overlap so it reads as a fan from above rather
  than five sticks.
- **Head kept chibi.** The big eyes and beak are the character and the owner
  has signed them off; proportions stay. The crest becomes two or three
  feather plates instead of one cone.
- **UVs, planned now.** Lay out one atlas for the whole bird (body/wings/
  tail/head) with the feather-flow direction consistent, so Phase 2's
  textures have somewhere to land. Route C dies without this.

Gate: bird sheet from six angles plus **three flap frames** (top of stroke,
mid-downstroke, recovery) plus a banking chase frame; `birdStats()` still
≤ 8 calls / ≤ 5,000 tris (the plates buy silhouette cheaply); contract test
green; ribbon trail verified anchored to the new tip (capture with
`__BIRB.boost(true)`). Then the phone A/B, blind, paired, forced-choice — the
only check that can tell "more detailed" from "better".

### Phase 2 — authored feather surfaces  (1–2 sessions + image generation)

Route C. The pipeline is proven end to end this week: prompt → PNG → gate →
tint solved from the measured mean → decode-gated swap → A/B → default.
Same modules (`authored-textures.js`, `commitWhenDecoded`, `asset-check.mjs`).

- `bird_feather_albedo.png` — blue contour feathers with barbs, desaturated,
  flat-lit, tiling, feather flow running **top to bottom** of the image.
- `bird_feather_normal.png` — derived offline from the albedo, as bark's was.
- Possibly `bird_belly_albedo.png` if the atlas gives the belly its own region.

The tint is solved, not picked, exactly as `BARK_TINT`, `STONE_TINT` and
`PINE_BARK_TINT` were; the blue/cyan identity is the constraint. Textures are
optional and precached: at ~0.5 MB they are worth a `CORE_ASSETS` row because
the bird is on screen every frame of every session.

Gate: the cross-asset separation test extended to the feather (it must not
be the bark's colour either); bird sheet; phone A/B.

### Phase 3 — Route B go/no-go  (only after Phase 1)

Ask one question with evidence: can a rigged, named-node glTF that passes
`birdRigContract` be produced by a tool this project has access to, at
≤ 5,000 triangles for LOD0 and with a texture the gate accepts? If yes,
commission it against the contract and A/B it against Phase 2. If no, Phase 2
is the bird and this row closes with the reason recorded. Do not start
modelling on the assumption the answer is yes.

## Tooling this plan needs (build in Phase 0)

- **`tools/birb-bird-sheet.mjs`** — the bird alone, neutral grey background,
  six angles (front, back, left, top, three-quarter rear = chase, edge-on wing)
  plus flap and bank frames, in one browser boot, composited like
  `birb-sheet.mjs`. *A prop you cannot reliably photograph is a prop nobody
  reviews*, and until now the bird has only ever been photographed by
  accident, from one angle, mid-frame of something else. Use `__BIRB.freeze`
  + `setSunTime` + `setSunEnabled(false)` for determinism.
- **`__BIRB.birdStats()`** — added with this plan.
- **`tests/bird-contract.test.js`** — Phase 0, above.

## Things this plan deliberately does not do

- **Does not touch flight, recovery, nesting or scoring.** The backlog's
  rule; also the bird's pose maths is already the best-written animation in
  the repo and nothing here needs it to change.
- **Does not touch the Gauntlet bird.** Separate app, separate contract.
- **Does not grow the triangle budget.** The world is at 75–79k of 80k. The
  bird gets more silhouette for fewer triangles, or it does not ship.
- **Does not add skinning.** A skinned mesh is more draw-call- and
  upload-expensive than a few rigid groups, and the rig is group-based. If
  Route B ever lands with bones, it comes with its own adapter and its own
  measurement.
- **Does not decide the art on this machine.** SwiftShader captures settle
  budgets, seams and holes. Whether it looks better is decided on the phone,
  blind, in pairs, per `ULTRACODE_REALISM_PLAN.md`.

## Effort, honestly

Phase 0: half a day. Phase 1: two to three sessions of the kind this week
was. Phase 2: one to two sessions plus the owner's image generation. Phase 3:
unknown, and possibly "no". The backlog's 5–10 specialist days for R1 assumed
Route B; this plan gets the visible benefit of R1 through A→C in less, and
keeps B on the table with a test that makes it safe to accept.
