# Flight Quality & Regression Guidance

## Priorities
- **Mobile-first flight feel:** Optimize for touch devices before desktop; interactions should remain responsive at 60fps on midrange phones.
- **Smooth touch controls:** Thumbstick/touch drag should have no dead jitter, predictable centering, and stable acceleration curves with consistent input scaling across pixel densities.
- **Camera mode expectations:** Default camera follows behind the birb with gentle damping, never losing sight of the model; camera transitions must avoid abrupt snaps or horizon flips.
- **Regression checks before merging:** Block merges on any control latency increase, camera jitter, frame pacing drop, or touch gesture misfires observed on target mobile devices.

## Running the Demo
1. From repo root, start a static server (e.g., `python3 -m http.server 8000`).
2. Open `http://localhost:8000/` (or `http://<host>:8000/` on your phone) and load the main `index.html` or `/basic/index.html` experience.
3. Rotate the device to the expected orientation and ensure the page is in full-screen for accurate touch areas.

## What “Good Flight” Looks Like
- Takeoff and turns respond within one frame of touch input; no visible stutter when initiating or releasing input.
- Camera tracks the birb smoothly with minimal oscillation and maintains clear sight lines during banking and dives.
- Speed changes feel continuous (no sudden spikes/drops) and the birb maintains altitude predictably when controls are neutral.
- Touch UI stays anchored under the thumb, never drifting or resizing mid-session.

## Logging & Triaging Control/Render Regressions
- **Capture:** Record device/OS/browser, build SHA, scenario, and a short screen recording showing the issue plus FPS overlay if available.
- **Repro steps:** List exact inputs (touch paths, duration, gestures), camera mode, and environment state (altitude, speed) leading to the problem.
- **Expected vs. actual:** Describe what good behavior would be (per above) and what deviated (lag, wobble, artifact, missing model, etc.).
- **Triage:** File an issue labeled `mobile-regression` and `controls` or `render`. Add severity (P0 crash, P1 major jitter, P2 minor drift) and assign an owner.
- **Verification:** Attach test replay or manual checklist results showing the fix removes the regression without new side effects on target devices.
