# Icon3D catalogue baseline — closeout

## Delivered contract

- `/svg` renders three source-vector tiles: Microsoft Copilot, Microsoft Foundry and Microsoft Fabric.
- Any one to three tiles can be selected; `/svg/view?icons=...` renders the selection in one measured row.
- Single-icon controls and GLB/SVG export remain available. Multi-icon export is visibly disabled until an assembly export contract is defined.
- The catalogue does not load Three.js. The viewer shares one renderer, camera, studio, environment and shadow map across all selected icons.

## Fixed-view evidence

| View | Camera/readback | Result |
| --- | --- | --- |
| Copilot diagnostic, 1024×768 | yaw 30°, pitch 15°, distance 4.52 | ribbon min IoU 0.8869 (floor 0.86), gradient MAE 0.25/255, bake MAE 0.95 |
| Foundry diagnostic, 1024×768 | yaw 30°, pitch 15°, distance 4.34 | plate min IoU 0.9944 (floor 0.985), gradient MAE 0.25/255, bake MAE 0.16 |
| Fabric diagnostic, 1024×768 | yaw 30°, pitch 15°, distance 4.27 | plate min IoU 0.9988 (floor 0.985), gradient MAE 0.24/255, bake MAE 0.24 |
| Three-icon desktop, 1440×900 | yaw 30°, pitch 15°, distance 8.19 | 12 draw calls, 37,826 triangles, 60 fps; opaque nonuniform framebuffer |
| Three-icon mobile, 390×844 @2× | yaw 30°, pitch 15°, distance 19.5 | all subjects uncropped; controls reachable; opaque nonuniform framebuffer |

The catalogue was captured at 1440×900 and 390×844 @2×. A second full-resolution read checked subject count, left-to-right order, negative spaces, gradient direction, plate overlap and mobile framing against the source tiles. No unresolved visual differences remain in the declared baseline.

## Deterministic checks

- All icon paths parse as one closed solid and remain inside their translated viewBox.
- Real Three.js extrusion tests verify every vertex stays inside its source outline and layer order is monotonic.
- Browser gates compare front silhouettes to independent Path2D rasterisation and shader colour to the JavaScript gradient evaluator.
- The baked GLB material path is rendered separately and compared to the same colour oracle.
- The capture harness fails on page errors, console errors and blank or crushed WebGL output.
