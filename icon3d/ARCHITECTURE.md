# Icon3D — architecture

SVG icons, extruded into 3D objects, in code. **`/svg`** is the catalogue:
three lightweight 2D tiles with multi-select. **`/svg/view?icons=...`** loads
WebGL only after selection and composes one to three finished models in a row.
The files live at `/icon3d`; both routes remain unlisted (`noindex`). The
baseline products are Microsoft Copilot, Microsoft Foundry and Microsoft
Fabric. Copilot keeps its ribbon interpretation; Foundry and Fabric use the
reference-exact plate builder.

`/svg` and `/svg/view` are **rewrites** in `vercel.json`, so the public URLs
stay in the address bar. Every browser import is absolute
(`/icon3d/src/...`), which keeps both rewritten depths safe.

Read this before touching any of it.

## Rules (same house as Gauntlet and Bronze)

1. **Airtight.** Nothing in `icon3d/` imports from outside it and nothing
   outside imports from inside it. The orbit camera, the QR encoder and the
   Three loader are copies from the Bronze study, on purpose.
2. **Core Three only, pinned.** `src/core/three-loader.js` loads
   `three@0.183.2` from the CDN. No addons at runtime: the SVG path parser,
   hole assignment, gradient evaluator and studio environment are all here.
   The one addon, `GLTFExporter`, is fetched on demand when the GLB button is
   pressed — it is a tool, not part of the page.
3. **Zero assets.** No SVG file is loaded. An icon is a JS table in
   `src/icons/` — path `d` strings and gradient definitions transcribed
   verbatim from the source vector, with the source URL in the header — so every
   number is diffable against the original. The studio environment map is a
   PMREM capture of a scene of unlit boxes, not an HDRI.
4. **The bypass in `sw.js` covers BOTH paths.** `/icon3d` and `/svg` are in
   `SIBLING_ARTEFACTS`. The root game's service worker caches every navigation
   response under one key, so a sibling that is not bypassed overwrites Birb
   Mobile's offline shell. A rewrite does not help here: the browser navigates
   to `/svg`, so that is the path the worker sees, and listing only `/icon3d`
   would leave the short URL — the one on the QR code — unprotected.

## Two readings of the same table

The page ships **two builders** and a pill switches them, because they answer
different questions about the same four path strings.

**Plates** (`src/model/icon-mesh.js`) is what an SVG importer plus an extrude
makes: four flat cut-outs, bevelled, stacked in depth by paint order. Its
silhouette IS the vector — 0.9985 IoU per piece — and it is the honest
reference for "what does this icon look like extruded".

**Ribbon** (`src/model/ribbon.js`) is what the artwork DEPICTS: one strip of
material that rolls over at four horizontal lines and alternates between a
front layer (the rainbow curls) and a back layer (the dark straps). It is the
default, because the icon is a drawing of a ribbon and a stack of plates is
not one.

The measurements the ribbon is built from, all taken off the vector:

| fact | value | what it means |
| --- | --- | --- |
| C2 symmetry of the two bands about (24, 24) | within 0.006 units | neither band is "in front"; the plates build's layer stagger is an artefact of paint order |
| widest ruling anywhere | 17.7 units | the ribbon's width |
| crest at y = 4 and y = 44 | 16.04 = 17.7 · cos 25° | the transitions are rolls |
| crest at y = 15.11 and y = 32.885 | 6.93 = 17.7 · cos 67° | one width explains all four |
| junctions of long edge to horizontal line | tangential, 8 of 8 | rolls, not knife creases |
| distance of each fold "tip" from a band outline | ≤ 0.17 units | the tips are occlusion clipping, not material — build none |

**The construction, and why the front view survives it.** Every ring of the
loft is a ruling between the piece's own two edge paths, taken from the
artwork, and each END of that ruling carries its own depth. Orthographically
from the front the depths vanish and the projection is exactly the region the
artwork draws; from anywhere else the depths are the whole object. Fidelity
and physicality stop competing.

Two readings were built, rendered and rejected, and the reasons are the
useful part:

- a **helicoidal twist** between band corners rotates the ruling out of the
  picture plane, so a strap projects as a bow-tie instead of the artwork's
  wedge: 0.76 IoU and visibly not the icon from the front;
- forcing a **truly constant width** by leaning each ruling out of plane until
  it measures 17.7 is exact and looks wrong — where the artwork's ruling is
  1.4 units the lean is 18, and the strap explodes into a fan. The mark is a
  stylised drawing, not an isometry.

A strap's outline is mostly CLIP: runs that lie on a transition line, a V
notch that leaves and returns to the same line, and a sliver of tuck allowance
that overshoots the line and is covered by a band. `splitFold` keeps only the
two runs that connect the two lines, and `trimBetweenLines` cuts them at the
crossings. Leaving the tuck in costs 15 points of IoU, because it eats half
the edge's arc length and the rulings then fan across the wrong region.

## Exporting: GLB for 3D, SVG for the page

A PNG of a render is not a Visio object, so the page exports both:

- **GLB** (`src/model/export.js`) bakes the shader gradients into textures with
  position-mapped UVs and hands the scene to `GLTFExporter`. Blender, Unity and
  PowerPoint open it directly. `flipY` is false on purpose — glTF puts v = 0 at
  the top and the bake writes its first row at the piece's minimum SVG y.
- **SVG** (`src/model/export-svg.js`) projects the actual meshes through the
  orthographic axonometric you are looking along and emits real vector paths —
  one `<g>` per component, the brand gradients still gradients (carried across
  by a `gradientTransform` fitted by least squares from the mesh's own
  SVG-space coordinates to their projected positions), and shading as a few
  semi-transparent overlay paths so the drawing reads as lit without a single
  raster pixel. The ribbon exports in about 18 loops and 60 KB.

  Orthographic, not perspective, because a diagram icon must scale and tile
  without a vanishing point — and because the projection of a plane is then an
  exact affine map, which is what makes the gradient transfer exact for the
  plates. Watch the basis: `up` is `view × right`; the other order points down
  and mirrors the whole drawing, gradients included, which reads as a colour
  bug rather than an axis one.

## Module map

```
icon3d/
  index.html                 2D catalogue: three tiles, selection state, viewer URL
  view.html                  WebGL chrome and pinned local-Three import map
  src/
    core/three-loader.js     pinned CDN Three, ?three=local escape hatch (copy)
    icons/
      index.js               the registry — add a table, add a line
      copilot-2023.js        6-path Figma export → 4 pieces (2 bands + 2 folds), sheens as overlays
      copilot-2026.js        2 pieces, radial gradients with a skewX transform
      ai-foundry.js          3 visible source regions and gradients
      microsoft-fabric.js    3 source paths, gradients and nested translations
      preview.js             inert inline SVG used by catalogue tiles
    model/
      svg-path.js            full SVG path grammar → lines + cubics (arcs via centre parameterisation)
      fill-shapes.js         rings → solids with holes, nonzero AND evenodd done properly
      svg-gradient.js        gradientTransform, userSpace/objectBoundingBox, stops, overlay; JS + GLSL
      icon-mesh.js           PLATES: table → ExtrudeGeometry per piece, gradient shader material, z by layer
      ribbon.js              RIBBON: band/fold edge extraction, per-edge depth, hairpin turns, one loft
      sweep.js               rotation-minimising (Bishop) frames + holonomy, sections, mesh audits
      lift.js                planar refinement, boundary rims, watertight thickening
      export.js              bake the gradient to textures + position UVs, GLTFExporter → GLB
      export-svg.js          axonometric projection → vector paths per component, gradients preserved
      gate.js                silhouette IoU vs Path2D, colour MAE vs the JS evaluator, bake check
    view/
      studio.js              PMREM room, key light + shadow, rounded tile, shadow catcher
      orbit.js               phone-first orbit/pinch/pan camera (copy)
      viewer-app.js          one-to-three composition, controls, exports and harness hooks
    ui/qr.js, qr-overlay.js  three-finger QR (copy)
    dev/
      probe.html             render ONE builder alone in colour/clay/unlit/id/normal/wire
      builders.js            the builder registry the probe picks from
tools/icon3d-shot.mjs        screenshot harness; --gate runs the likeness gate; --print evaluates JS
tests/icon3d-*.test.js       pure-module, registry, mesh, export and ribbon tests
```

## The pipeline, and where it differs from a loader

`d` string → `parsePath` → closed rings → `assignHoles` → `THREE.Shape`s →
`ExtrudeGeometry` → one mesh per painted path → `mesh.position.z` by layer.
That is Blender's importer in ~100 lines of core Three. Three's own
`SVGLoader` would do the first three steps too, but it lives in `examples/`,
drags the SVG DOM model in for one attribute, and decides holes by winding
alone — wrong for the common Figma/Illustrator evenodd export whose hole ring
runs the same way as its outer ring. `fill-shapes.js` implements both rules
from nesting depth and orientation and has tests for the cases that differ.

**Geometry stays in SVG units, y flipped.** Centring and scale live on the
group. That is what lets the fragment shader read a vertex's SVG coordinate
straight off `position`, flip y back, and evaluate the icon's own gradient at
it — `gradientTransform` and all — per pixel. A gradient sampled at the corners
of an extruded cap's few large triangles and interpolated across them is
visibly wrong; the sweep of a radial gradient cannot be rebuilt from three
vertex colours.

**The bevel is offset inward** (`bevelOffset = -bevelSize`). Three's default
bevel grows the plate outward, so a bevelled extrusion is fatter than its
outline and two pieces that share an edge in the SVG collide. With the offset,
the walls sit exactly on the outline and the caps are inset; the front-on
silhouette is the SVG's, which is what the gate measures.

**Layers follow paint order.** The 2023 mark's two folds each have a portion
hidden under a band, so they sit two layers back; the pink band is painted
last and stands in front. `layer` is declared per piece in the table because
the answer is known; deriving it from overlap analysis is the obvious next
step for a converter that takes any SVG.

**Every piece has its own program cache key.** Three caches compiled programs
by `onBeforeCompile.toString()`; four materials whose hook is the same closure
with different captured GLSL look identical to the cache, and every plate
renders with the first gradient compiled. That one cost a round.

## The gate

`node tools/icon3d-shot.mjs --page icon3d/index.html --out shot.png --query three=local --gate`

Three checks, all against an oracle that shares no code with the thing under
test:

- **Silhouette.** The geometry rendered front-on, orthographic, in flat ID
  colours, against the browser's own `Path2D` fill of the same `d` strings with
  the same pixel mapping. Per-piece IoU, with a floor that depends on which
  builder is loaded and is reported either way:

  | builder | floor | measured |
  | --- | --- | --- |
  | plates | 0.985 | 0.9985 – 0.9995 (residual is edge anti-aliasing) |
  | ribbon | 0.86 | bands 0.967, straps 0.887 |

  The ribbon's floor is lower **on purpose and only for the ribbon**. Its bands
  still land on their own outlines; its straps are a lofted strip where the
  artist drew a tapered wedge, and no strip reproduces that exactly. Relaxing
  the floor for both builders would be hiding a regression; relaxing it for one
  and reporting the number is describing the model.
- **Colour.** The unlit gradient shader against `evaluateFill()`, the JS
  reference the GLSL was emitted from, over every interior pixel. Mean
  absolute error in 8-bit sRGB: 0.25.
- **Bake.** The export scene — baked textures, position UVs, `flipY` off —
  rendered the same way and compared the same way. A mirrored bake or a
  linear-space texture shows up here as a large error; the shader gate cannot
  see either because the shader never touches a texture.

The harness exits non-zero on any page error, console error, blank
framebuffer or failed gate. Run it with `?three=local`: it needs
`npm install --no-save playwright three-real@npm:three@0.183.2` followed by
`git checkout -- node_modules/three/index.js`, because any npm install prunes
the hand-written Three stub this repo tracks and silently breaks `npm test`.
The `?three=local` page also injects an import map for the bare `three`
specifier so the local `GLTFExporter` resolves; production never sees it.

## Adding an icon

1. Get the vector. Transcribe each `<path d>` and each gradient into a table in
   `src/icons/`; resolve `class`/`url(#id)` fills by hand; fold any
   semi-transparent duplicate path into the base piece's `overlay`.
2. Give each piece a `layer`: pieces painted over something they overlap go
   in front; pieces that overlap nothing can share a layer.
3. Register its product metadata in `src/icons/index.js`, open
   `/svg/view?icons=<id>`, and run the gate.

The catalogue imports no Three.js code. Its 2D preview and the 3D builder read
the same audited recipe, so a newly registered product cannot drift between
tile and model. Multi-select is URL state: a comma-separated, de-duplicated
list of at most three valid icon IDs. The viewer builds each model once, lays
out their measured widths with a fixed world-space gap, then fits the camera
against both composition width and height.

Unsupported on purpose until an icon needs them: radial gradients with a
focal point off-centre, `spreadMethod` other than pad, `<use>`, clip paths,
strokes. Each is a small addition to `svg-gradient.js` or `icon-mesh.js`, and
each should arrive with a test.

## Budget

The catalogue has no WebGL cost. The three-icon composition is 12 draw calls
and ~38k triangles with one shared renderer, camera, environment and 2048²
shadow map; DPR is capped at 2. Measured under SwiftShader at 60 fps on the
1440×900 and 390×844 validation views. A still frame renders on demand; the
idle turntable renders continuously by choice.
