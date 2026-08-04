# Three.js implementation and visual verification

## Contents

1. Assembly reconstruction
2. Camera reconstruction
3. Geometry selection
4. Sampled-surface invariants
5. Topology checks
6. Material and lighting diagnosis
7. Browser and framebuffer verification
8. Mobile and interaction checks
9. Performance without detail loss

## 1. Assembly reconstruction

Represent the source assembly explicitly before shaping individual parts. Give
every subject or panel a stable id and data for order, position, facing vector,
front/back or relief side, pose, body state and required contacts. Add
deterministic assertions for count, ordering and facing so a visually plausible
but reversed or permuted assembly cannot pass.

A directional relief is not automatically a freestanding figure. Build the
visible relief face, an intentional reverse surface and a bridged boundary as a
closed outward-wound solid. Negative relief still needs a real near surface; do
not rely on transparency or DoubleSide to reveal a far interior.

## 2. Camera reconstruction

Store every acceptance camera as data, not as a manually orbited screenshot:

```js
{
  id: 'detail-front',
  viewport: [1400, 900],
  dpr: 1,
  fov: 40,
  target: [0, 1.2, 0],
  yaw: 0,
  pitch: 2,
  distance: 2.5,
}
```

Record coordinate conventions and the model-facing direction. For each capture:

1. Set viewport and DPR.
2. Set FOV and update the projection matrix.
3. Apply target, yaw, pitch and distance.
4. Disable idle spin and wait for damping to settle, or set the final transform
   directly.
5. Render explicitly.
6. Read the live camera values back into the result.

Match silhouette and perspective before surface polish. A wrong FOV can make
correct geometry look too deep, wide or compressed. Choose a diagnostic camera
that exposes the exact axis or contour being edited and add an orthogonal view
when depth remains ambiguous.

When a camera is matched to a reference CROP, compute its field of view from
the crop, never from the full photograph — a crop is a narrower FOV at the
same station point, and using the photo's FOV silently mismatches every
proportion judged in the pair. Build the photo|model contact-sheet harness
(all matched poses, one browser boot) before shaping begins, not after.

For responsive fitting, derive horizontal FOV from vertical FOV and aspect:

```text
horizontalFov = 2 * atan(tan(verticalFov / 2) * aspect)
distanceForWidth >= halfWidth / tan(horizontalFov / 2)
distanceForHeight >= halfHeight / tan(verticalFov / 2)
```

Use the larger fitted distance, then include heading and safe-area clearance.
Do not tune portrait mobile framing by vertical FOV alone.

## 3. Geometry selection

Prefer existing project and library primitives:

- GLTF/GLB loaders for supplied authored assets, only where the project's
  representation contract permits imported assets at all;
- TubeGeometry for continuous narrow paths;
- LatheGeometry or profiles for axial forms;
- Shape/ExtrudeGeometry for planar profiles with thickness;
- tested CSG libraries for true boolean solids;
- sampled distance fields for organic unions and broad fillets;
- BufferGeometry for controlled custom topology.

Avoid encoding a thin semantic feature in a coarse field simply to keep one
mesh. Preserve it as a separate accepted component, then merge or batch only if
performance evidence requires it. A single subject can legitimately mix a
sampled body, explicit face strokes, curve-based accessories and an authored
asset; representation follows signal scale rather than object ownership.

For tubes, choose enough longitudinal segments to preserve curvature in the
closest diagnostic view and enough radial segments to preserve a round
silhouette. Evaluate screen-space faceting, not segment counts in isolation.

## 4. Sampled-surface invariants

Maintain all of these:

- isolation and production use the same geometry factory, voxel size, blend,
  deformation limits and feature flags;
- sampling bounds are recomputed from final deformed and rotated extents rather
  than copied from an earlier smaller form;
- sampling bounds clear every primitive cap and every rotated extent;
- blend radius remains materially smaller than the protrusion being preserved;
- generated surfaces are closed and outward-wound;
- neighboring closed meshes use deliberate overlap or clearance, not equal
  coplanar skins;
- detail thickness meets the project's measured cell-ratio threshold;
- normals are recomputed after topology changes.

An open or inward surface rendered with FrontSide often exposes the far interior
and looks transparent. Do not hide it with DoubleSide. Count boundaries and
inspect signed volume.

## 5. Topology checks

For indexed triangle geometry, assert as applicable:

- expected connected components;
- zero boundary edges for a closed solid;
- zero non-manifold edges;
- positive signed volume under the project's winding convention;
- finite positions and normals;
- expected bounding box and landmark extrema;
- required gaps, contacts and clearances;
- no detached duplicate appendages;
- deliberate bridge topology between relief front, reverse and perimeter;
- expected facing vector and front/back landmark ordering;
- stable triangle count range when regression-sensitive.

Useful signed-volume accumulation:

```js
volume6 += ax * (by * cz - bz * cy)
         + ay * (bz * cx - bx * cz)
         + az * (bx * cy - by * cx);
```

Interpret the sign consistently with the project's coordinate and winding
conventions. Test a known primitive before relying on it.

Geometry tests must assert semantic relationships. A maximum-Z test can prove a
sliver exists while no recognizable feature remains.

## 6. Material and lighting diagnosis

Use a fixed diagnostic sequence:

1. Unlit silhouette material.
2. MeshNormalMaterial.
3. Neutral rough standard material with shadows off.
4. Final material with shadows off.
5. Final material and final light rig.

This separates topology, normals, albedo, roughness, lights and shadow depth.

Treat albedo and light intensity as one exposure system. Avoid tuning key light,
fill, roughness and base color simultaneously. Keep a cool or neutral fill when
rear surfaces must remain readable through a full orbit.

## 7. Browser and framebuffer verification

Use Playwright or the repository's existing browser harness. Capture page and
console errors, then sample the live WebGL framebuffer after an explicit render.

```js
const gl = renderer.getContext();
const width = gl.drawingBufferWidth;
const height = gl.drawingBufferHeight;
const rgba = new Uint8Array(width * height * 4);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
```

Sample across the entire image and calculate:

- opaque sample ratio;
- luminance minimum and maximum;
- mean and standard deviation;
- non-background pixel ratio when a stable background is available.

Reject blank, mostly transparent or nearly uniform frames. Store thresholds in
the test rather than accepting any PNG that exists.

Do not let a string-evaluation API silently drop camera arguments. Pass a real
function and object, then read the camera state back. Ensure every view matrix
entry produces a materially distinct live camera where expected.

## 8. Mobile and interaction checks

Test at least one narrow portrait and one landscape viewport when the scene is
interactive. Verify:

- the primary object is visible on first paint;
- heading or controls do not overlap the canvas subject;
- horizontal and vertical FOV fits preserve the full intended composition;
- touch orbit/pan/zoom works without scrolling conflicts;
- DPR does not exceed the device performance budget unnecessarily;
- orientation changes recompute camera and renderer dimensions;
- a static frame remains nonblank after idle and resume.

Use a real-device check for final mobile acceptance when feasible. Emulation is
necessary but does not reproduce every mobile GPU or browser behavior.

## 9. Performance without detail loss

Record triangles, draw calls, construction time and representative frame rate.
Do not optimize away semantic identity to reach an arbitrary count.

Use this order:

1. Remove genuinely invisible or duplicate geometry.
2. Reuse materials and geometries.
3. Instance repeated accepted objects.
4. Merge static accepted meshes when it does not damage material or culling.
5. Add LOD for delivery distance while preserving the diagnostic source mesh.
6. Lower DPR or effects on constrained mobile devices.
7. Reduce tessellation only after screenshot comparison at the closest delivery
   camera.

After every performance change, rerun the relevant detail views. A faster scene
that no longer communicates its fine features has regressed.
