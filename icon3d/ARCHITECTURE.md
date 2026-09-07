# Icon3D — architecture

An SVG icon, extruded into a 3D object, in code. Lives at `/icon3d`, unlisted
(`noindex`, linked from nowhere). The first icon is the Microsoft Copilot mark —
the 2023 rainbow ribbon and the flatter 2026 one — because the study started as
"do what Blender's SVG importer does to this icon, without Blender".

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
4. **The bypass in `sw.js`.** `/icon3d` is in `SIBLING_ARTEFACTS`. The root
   game's service worker caches every navigation response under one key, so a
   sibling that is not bypassed overwrites Birb Mobile's offline shell.

## Module map

```
icon3d/
  index.html                 page: boot, pills (Colour/Clay · 2023/2026 · GLB), loop, harness hooks
  src/
    core/three-loader.js     pinned CDN Three, ?three=local escape hatch (copy)
    icons/
      index.js               the registry — add a table, add a line
      copilot-2023.js        6-path Figma export → 4 pieces (2 bands + 2 folds), sheens as overlays
      copilot-2026.js        2 pieces, radial gradients with a skewX transform
    model/
      svg-path.js            full SVG path grammar → lines + cubics (arcs via centre parameterisation)
      fill-shapes.js         rings → solids with holes, nonzero AND evenodd done properly
      svg-gradient.js        gradientTransform, userSpace/objectBoundingBox, stops, overlay; JS + GLSL
      icon-mesh.js           table → ExtrudeGeometry per piece, gradient shader material, z by layer
      export.js              bake the gradient to textures + position UVs, GLTFExporter → GLB
      gate.js                silhouette IoU vs Path2D, colour MAE vs the JS evaluator, bake check
    view/
      studio.js              PMREM room, key light + shadow, rounded tile, shadow catcher
      orbit.js               phone-first orbit/pinch/pan camera (copy)
    ui/qr.js, qr-overlay.js  three-finger QR (copy)
tools/icon3d-shot.mjs        screenshot harness; --gate runs the likeness gate; --print evaluates JS
tests/icon3d-svg.test.js     23 tests over the pure modules
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

- **Silhouette.** The plates rendered front-on, orthographic, in flat ID
  colours, against the browser's own `Path2D` fill of the same `d` strings with
  the same pixel mapping. Per-piece IoU; the threshold is 0.985 and the
  measured value is 0.9985–0.9995 (the residual is edge anti-aliasing).
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
3. Register it in `src/icons/index.js`, open `?icon=<id>`, run the gate.

Unsupported on purpose until an icon needs them: radial gradients with a
focal point off-centre, `spreadMethod` other than pad, `<use>`, clip paths,
strokes. Each is a small addition to `svg-gradient.js` or `icon-mesh.js`, and
each should arrive with a test.

## Budget

6 draw calls, ~13k triangles, one 2048² shadow map, DPR ≤ 2, renders on
demand (a still frame costs nothing; the idle turntable renders continuously
by choice). Measured under SwiftShader at 60 fps; a real-phone pass is still
owed, as it is for Bronze.
