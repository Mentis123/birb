# Icon3D — closeout, 2026-09-07

**Subject:** the Microsoft Copilot icon, 2023 mark (the reference screenshot)
and the 2026 mark. **Representation:** four (2023) / two (2026) extruded
plates from the official vector, stacked by paint order, gradients evaluated
per pixel from the SVG's own definitions. **Evidence sheet:**
`copilot-sheet.png` in this directory.

## Scene ledger

| piece | class | layer | what it is |
| --- | --- | --- | --- |
| band_pink | extruded plate | 0 (front) | purple→pink→orange band, painted last in the SVG |
| band_blue | extruded plate | −1 | cyan sheen → blue → green → yellow band |
| fold_blue | extruded plate | −2 | dark-blue fold; its left end is hidden under band_blue |
| fold_red | extruded plate | −2 | orange→red fold; notch hidden under band_blue, right half under band_pink |

Facing: +Z toward the viewer, y up (SVG y flipped in the shape builder, flipped
back inside the shader). The 2026 mark is two plates, both layer 0.

## Deterministic

| check | oracle | threshold | measured |
| --- | --- | --- | --- |
| silhouette IoU per piece, front-on orthographic, 768 px wide | browser `Path2D` fill of the same `d` | ≥ 0.985 | 0.9985 / 0.9985 / 0.9989 / 0.9992 (2023); 0.9995 / 0.9995 (2026) |
| gradient colour, unlit shader vs JS evaluator, interior pixels | `evaluateFill()` | ≤ 4/255 MAE | 0.25 / 0.21 / 0.25 / 0.25 (2023); 0.24 (2026) |
| baked export textures rendered vs JS evaluator | `evaluateFill()` | ≤ 6/255 MAE | 0.25 (2023, 368k samples); 0.24 (2026) |
| GLB export | `GLTFExporter` (local copy via import map) | header `glTF` | 1,770,292 bytes, `glTF` |
| unit tests | `node --test` | all pass | 267 (23 new) |

## Reproducible

Harness: `tools/icon3d-shot.mjs`, Chromium under SwiftShader, `?three=local`.
Views on the sheet: desktop 1280×800 @1 (yaw 30°, pitch 15°, fit distance
4.55), phone 390×844 @2 (distance 6.98–7.08), front-on (yaw 0, pitch 0,
distance 4.4, no tile), diagnostic side view (yaw 78°, pitch 10°). Framebuffer
nonblank, opaque and nonuniform on every capture; no page or console errors.
6 draw calls, 13,088 triangles (2023); 4 draw calls, 8,180 (2026).

## Human judgment

Front-on against the Wikipedia render of the same vector: silhouette, band
order, fold placement and colour sweep match (structural and identity levels
both pass — the shape is the source vector, so this is expected). The 3D
reading — plates staggered by paint order, folds two layers back — reproduces
the Blender build in the brief.

## Unresolved / out of scope

- Not tested on a real phone. SwiftShader is not an iPhone GPU.
- The CDN-served `GLTFExporter` path could not be exercised here (no CDN
  egress from the headless browser); the local copy of the same module was.
  The root game imports `GLTFLoader` the same way in production.
- The folds are flat plates behind the bands, as in Blender, not a ribbon
  that actually turns over. A true twisted ribbon is a different model.
- Focal-point radial gradients, `spreadMethod`, `<use>`, clip paths and
  strokes are unsupported until an icon needs them.
