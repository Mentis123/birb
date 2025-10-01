# Camera Mode Roadmap

This roadmap outlines the work required to introduce a three-state camera system (Follow, FPV, Fixed) and the mode toggle control that cycles through them.

## Guiding Principles
- Preserve the current flight mechanics while extending camera behaviors.
- Keep camera state transitions deterministic and debuggable.
- Make mode toggling discoverable with a clear visual indicator of the active mode.

## Phase 1 — Baseline Assessment & Preparation
1. **Inventory current camera implementation**
   - Locate existing camera setup logic and bindings for the fixed view.
   - Document how the current "reset camera" flow works and how the Birb FPV is derived.
2. **Extract camera state management**
   - Centralize camera state into a dedicated module or hook to simplify adding multiple modes.
   - Add explicit type definitions or enums for camera modes.
3. **Add developer instrumentation**
   - Introduce temporary logging or on-screen debug info for active camera mode and key parameters (offset vectors, easing speeds).

## Phase 2 — Implement Follow (Chase) Camera (New Default)
1. **Define follow camera rig**
   - Compute desired camera position as an offset behind Birb aligned with its velocity vector.
   - Apply smoothing/easing to interpolate toward the target position and look-at direction.
   - Ensure the camera anticipates upcoming turns by blending in velocity and steering inputs.
2. **Integrate as default mode**
   - Set follow mode as default on load.
   - Ensure existing input handlers update follow camera target values.
3. **Regression checks**
   - Verify camera avoids clipping into Birb model.
   - Confirm "reset camera" snaps to the follow camera's canonical offset.

## Phase 3 — Implement FPV Camera
1. **Leverage existing FPV calculations**
   - Reuse Birb orientation data to align camera with its head/forward vector.
   - Add minimal head-bob or stabilization if necessary for comfort.
2. **Integrate into mode system**
   - Ensure toggling updates UI indicator and camera pipeline.
   - Reconcile "reset camera" behavior (should return to follow view when invoked outside fixed mode).

## Phase 4 — Rework Fixed Camera Mode
1. **Capture FPV snapshot as anchor**
   - On switching to Fixed mode, store Birb's current FPV transform as the camera position & orientation.
2. **Maintain stored fixed transform**
   - Keep the anchor stable until the player re-enters Fixed mode or triggers "reset camera".
   - Allow reset to reapply the last stored anchor instead of a hard-coded location.

## Phase 5 — Mode Toggle Control & Indicator
1. **Design compact UI control**
   - Add a small on-screen button that cycles through Follow → FPV → Fixed → Follow.
   - Display an icon or label representing each mode.
2. **Integrate with input system**
   - Wire the control into existing UI event handling, including keyboard/gamepad shortcuts if applicable.
3. **Provide visual feedback**
   - Highlight the active mode via button state and possibly on-screen text.

## Phase 6 — Polish & QA
1. **Tuning**
   - Adjust follow camera offsets, damping, and anticipation curves for comfort and cinematic feel.
   - Smooth transitions between modes with short blends to avoid camera jerk.
2. **Testing matrix**
   - Desktop (mouse + keyboard) and mobile (touch) interaction.
   - Stress test with fast banking, climbs, and dives.
3. **Documentation**
   - Update README or in-game help with camera mode descriptions and controls.
   - Remove temporary debug instrumentation.

## Stretch Goals
- Add settings menu options to tweak camera sensitivity and offsets.
- Include accessibility options (motion sickness reduction, snap angles).
- Provide telemetry hooks to learn which camera modes players prefer.
