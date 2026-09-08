# Icon3D — closeout, 2026-09-08

**Subject:** the Microsoft Copilot icon, 2023 mark (the reference in the brief)
and the 2026 mark. **Two builders from one table:** Ribbon (default) and
Plates. **Evidence:** `copilot-sheet.png` (plates, first pass) and
`ribbon-sheet.png` (the ribbon, this pass) in this directory.

## Scene ledger — the ribbon reading

One strip of material, constant character, running:

| leg | class | travels | face shown |
| --- | --- | --- | --- |
| band_blue | front layer, ruled between its own two long edges | y 4 → 32.885 | front |
| fold_red | back layer (the dark strap) | y 32.885 → 44 | back |
| band_pink | front layer | y 44 → 15.11 | front |
| fold_blue | back layer | y 15.11 → 4 | back |

Four roll transitions, so the ribbon returns to its starting face: an ordinary
two-sided loop, not a Möbius band. Facing +Z toward the viewer, y up (SVG y
negated in the builder). The 2026 mark has no straps to roll through, so it
falls back to plates under either pill.

## Deterministic

| check | oracle | floor | measured |
| --- | --- | --- | --- |
| silhouette IoU, plates | browser `Path2D` fill of the same `d` | 0.985 | 0.9985 / 0.9985 / 0.9989 / 0.9992 |
| silhouette IoU, ribbon 2023 | same | 0.86 | bands 0.967 / 0.969, straps 0.887 / 0.889 |
| silhouette IoU, ribbon 2026 | same | 0.86 | 0.9995 / 0.9995 (falls back to plates) |
| gradient colour, shader vs JS reference | `evaluateFill()` | ≤ 4/255 | 0.21 – 0.25 |
| baked export textures | `evaluateFill()` | ≤ 6/255 | 0.25 (plates), 0.95 (ribbon) |
| GLB export | `GLTFExporter` | header `glTF` | 1.77 MB, valid |
| SVG export | browser render of the emitted paths | parses, one group per piece | 4 groups, 18 loops, 66 KB |
| unit tests | `node --test` | all pass | 294 (39 for icon3d) |

## Reproducible

Harness `tools/icon3d-shot.mjs`, Chromium under SwiftShader, `?three=local`.
Delivery views: desktop 1280×800 @1 (yaw 30°, pitch 15°, fit distance 4.55),
phone 390×844 @2 (distance 6.98), phone landscape 844×390, side view (yaw 82°,
pitch 12°) and front-on (yaw 0, pitch 0). Framebuffer nonblank, opaque and
nonuniform on every capture; no page or console errors. Ribbon: 6 draw calls,
24,620 triangles. Plates: 6 draw calls, 13,088.

## Human judgment

Front-on the ribbon still reads unmistakably as the Copilot mark: band order,
strap placement, colour sweep and the white S-channel all present. Orbited, it
reads as one continuous piece of material that turns over — the thing the
brief asked for and the thing the plates cannot give. The plates build remains
available and remains the exact-silhouette reference.

## Unresolved / out of scope

- Not tested on a real phone. SwiftShader is not an iPhone GPU.
- The ribbon's straps project at 0.887 against the artwork's tapered wedges.
  A lofted strip of material cannot reproduce a stylised taper exactly; the
  number is measured and reported rather than designed away.
- The plates' SVG export carries ~250 small loops from the bevel's speckled
  front-facing set (the ribbon's is 18). Usable, but the ribbon is the tidy
  vector export.
- The CDN-served `GLTFExporter` path could not be exercised in this sandbox
  (no CDN egress from the headless browser); the local copy of the same module
  was.
- Focal-point radial gradients, `spreadMethod`, `<use>`, clip paths and strokes
  are unsupported until an icon needs them.
