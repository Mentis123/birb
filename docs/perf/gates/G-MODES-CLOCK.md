# G-MODES-CLOCK — the turret landing is counted in frames

**Date:** 2026-09-23. **Decision:** AMEND the frozen oracle
`tools/birb-modes.mjs`, one wait, and regenerate `tools/oracle-manifest.txt`
in the same commit. No assertion was weakened: the check still requires the
player to reach the nest and a rocket to launch.

## What failed

Browser Health went red on the realism wave (runs 155 and 156, and main at
`a918487`) on exactly one line: `turret_defense: never reached the nest to
fire from`. Run 154, one commit earlier in the same wave, was green.

The check waited for `__BIRB.stats().nesting === "nested"` with Playwright's
`waitForFunction(..., { timeout: 20000 })` — **20 seconds of wall clock** —
while the nest landing auto-fly advances **per frame**. That is the same
trap CLAUDE.md already records for the forest landing ("a clock, not a
collider") and for Playwright's click budget.

## The measurement

- Frames to NESTED, counted with an injected rAF counter by two independent
  reviewers of the realism branches: **base `e252ca1` 96 / 99, branch 95 /
  102.** The landing is the same length on both trees.
- The CI runner renders these harness frames at **4-5 fps** (the shot steps
  in the same run print `"fps":4` and `"fps":5`), so ~100 frames is 20-25 s
  of wall clock — the far side of a 20 s budget. The realism wave made the
  SwiftShader frame heavier (horizon-shadow reads on every lit fragment, the
  physical plumage), and that alone moved an unchanged landing past the
  deadline.
- On a 4-core box at load average 10, the frozen harness failed the turret on
  base and branch alike; a copy with only the wait lengthened passed all five
  modes, turret included (`launched 1/3`, the same as base's normal output).

## The amendment

The wait is now a frame count: resolve when nested, fail after **600
rendered frames** (~6x the measured need), reported with the frame count.
Nothing else in the harness changed. A landing that genuinely never arrives
still fails, and now fails for the right reason at any frame rate.
