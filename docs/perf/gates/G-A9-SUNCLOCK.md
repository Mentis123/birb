# G-A9-SUNCLOCK — A9 aims at the sun a FRAME has placed, not the one a number names

**Date:** 2026-09-24. **Decision:** AMEND the frozen oracle
`tools/birb-quality.mjs` — one helper, `putSunOnScreen()` — and regenerate
`tools/oracle-manifest.txt` in the same commit. No assertion changed: A9
still requires 8 render passes with the sun on screen before the toggle and
a collapse to 5 that never recurs after it (`assertA9` in the frozen
`tools/lib/quality-assertions.mjs` is untouched).

## What failed

`node tools/birb-quality.mjs --check all` on `realism/auto-exposure` failed
one line, in every one of the builder's five runs:

```
A9 state=fail
  A9: the sun was not producing shafts before the toggle (passes 5, expected 8)
```

`--check A9` alone passed, and main `d28da11` passed A9 in the builder's four
`all` runs — which read like a regression in the branch. The builder's own
bisect then made it look stranger: main's `index.html` plus only two guarded
lines that never execute at tier 0 failed, and the same file with 29 extra
COMMENT lines passed. A behaviour cannot depend on comments. Timing can.

## The cause

`putSunOnScreen()` transcribes CONTRACT §4.1's recipe — "enable -> set ->
one frame -> disable" — and implemented "one frame" as
`page.waitForTimeout(50)`: fifty milliseconds. `__BIRB.setSunTime(0)` only
writes `sunState.seconds`; the key light is re-aimed by the next RENDERED
frame (`index.html`, the sun-cycle block of the frame loop). An Amazing frame
under SwiftShader takes 70-130 ms here, so the 50 ms wait holds a frame
roughly half the time. When it does not, `faceSun()` reads a key light still
at whatever hour the session had reached — `sunState.seconds` starts at
`Math.random() * 600` — and points the bird at THAT sun; the next frame moves
the sun to t = 0 (19.5 degrees up) and out of the frame.

The re-aim loop could not rescue it: it read `stats().sunUv` in the SAME
evaluate as `faceSun()`, which is the previous frame's projection — the exact
trap this file's own `sampleFramesWithSun()` comment records — so all five
pitches read 0 and nothing retried.

## The measurement

An instrumented copy of the frozen harness (not committed) logged, at A9, the
recovery state, the sun's clock and elevation, and whether a frame had
rendered (`stats().elapsed`) between `setSunTime(0)` and `faceSun()`. Six
`--check all` runs, three per tree, same machine, one browser at a time:

| run | tree | bird at A9 | sun `faceSun()` aimed at | before-toggle passes | A9 |
|---|---|---|---|---|---|
| 1 | branch | flying, 15 up | t = 0.07, 19.48 deg (a frame landed) | 5, **8** | pass |
| 2 | branch | grounded | t = 149.6, **38.89 deg** (stale) | 5, 5 | **fail** |
| 3 | branch | flying, 14 up | t = 595.3, 19.50 deg (stale, but the cycle is 600 s, so it was the t = 0 sun anyway) | 8, 8 | pass |
| 1 | main | flying, 22 up | t = 173.8, **43.77 deg** (stale) | 5, 5 | **fail** |
| 2 | main | falling -> grounded | t = 0.07, 19.48 deg (a frame landed) | 5, **8** | pass |
| 3 | main | grounded | t = 204.5, **49.48 deg** (stale) | 5, 5 | **fail** |

Every failure is a stale sun and every stale sun that was not coincidentally
the t = 0 one failed, on both trees. **Main fails A9 exactly as the branch
does** (2 of 3 here); the builder's 4/4 green on main and 5/5 red on the
branch were runs of a coin. The builder's diagnosis — the bird grounded, so
`faceSun()`'s heading does not hold — is refuted by the same logs: in both
grounded failures the heading and pitch `faceSun()` set were still there,
unchanged to the logged precision, when the before-toggle sample was taken
(branch run 2: heading 0.39, pitch 38.66 at both reads; main run 3: -32.656,
38.66 at both) — only the SUN had moved (38.9 -> 19.5 deg, 49.5 -> 19.5).
Main run 2 was grounded by the time it sampled and passed with the sun at
uv (0.50, 0.47). Grounding is incidental.

## The amendment

`putSunOnScreen()` waits two RENDERED frames after `setSunTime(0)` (the
recipe's "one frame", with one of margin) instead of 50 ms, and each re-aim
reads `sunUv` from a frame rendered after `faceSun()` through the existing
`sampleFramesWithSun()`. Nothing else in the harness changed; `captureA9`
and `captureA7` call the helper exactly as before. A sun that genuinely does
not produce shafts still fails A9, now for the reason its message names.

Not done, deliberately: forcing the bird airborne. The table shows the
grounded state is incidental, and changing the flight state from inside a
quality capture would be a second behaviour change riding on a clock fix.

## Verification

`node tools/birb-quality.mjs --check all` with the amended helper, same
machine (4 cores, load average 8-9 from other agents' work), one browser at a
time:

| tree | runs | A9 | whole board |
|---|---|---|---|
| main `d28da11` + this amendment | 3 | **3/3** `8 -> 6,5,5,5` | **12/12 three in a row** |
| `realism/auto-exposure` + this amendment, first batch | 3 | **3/3** `8 -> 6,5,5,5` | 12/12 once; A5 red twice |
| `realism/auto-exposure` + this amendment, second batch | 6 | **6/6** `8 -> 6,5,5,5` | **12/12 six in a row** |

A9 has not failed once since the amendment. The two red boards are A5
("scene draw calls did not fall") — the G-A5-DRIFT clock, a known and still
unapplied gate decision in `tools/lib/quality-captures.mjs`, which main also
shows (1 in 4 in the builder's runs). It is not touched here: one gate
decision per clock.

Also checked: `sha256sum -c tools/oracle-manifest.txt` 0 failures and
`node tools/oracle-manifest-regen.mjs --check` current after the
regeneration. The regeneration is additive by construction and also pinned
`tests/exposure.test.js`, the one new test file on this branch, which is
what the builder's report asked the integrator to do; `npm test` is fully
green with it (1220 tests, 1010 pass, 0 fail, 210 skipped).
