# Performance baseline — HEAD

Recorded for Wave 0 (`docs/ULTRACODE_PERFORMANCE_PLAN.md` §4) per
`docs/PERFORMANCE_REALISM_PLAN.md`. This is what HEAD actually does on every
existing oracle, exit code and console-noise both — later waves assert
**"unchanged from this file"**, never "exit 0".

- **Date:** 2026-09-09
- **Commit:** `f3259db26e1d2022dddb70f5218b462278a0589f`
- **Branch:** `claude/ultracode-sub-agents-plan-c9qmba`
- **Harness install:** `tools/ensure-harness.sh` (playwright + https-proxy-agent
  via `npm install --no-save`, then `git checkout -- node_modules/three/index.js`,
  then `npx playwright install --with-deps chromium`). Ran clean, exit 0.

## Summary table

| Oracle | Exit code | Console noise |
|---|---|---|
| `npm test` | 0 | none |
| `node tools/birb-shot.mjs --out X --start` | 0 | none |
| `node tools/birb-shot.mjs --out X --start --nest` | 0 | none |
| `node tools/birb-modes.mjs` | 0 | none |
| `node tools/birb-shaders.mjs` | 0 | none |

**HEAD is green across the board, with no warnings anywhere.** This matters
specifically for `birb-modes.mjs`, which treats console warnings as failures —
nobody had confirmed it was actually green on this branch before this task;
it is, and is now safe to use as a regression gate for later waves.

## 1. `npm test`

```
node --test
```

- **Exit code:** `0`
- **Result:** `359` tests, `357` pass, `0` fail, `2` skipped, `0` todo,
  `24760.44ms` duration.
- **Skipped tests (both, same reason, unrelated to this repo's runtime code):**
  - `plates: a bevelled band grows a burr at its cusp and clampToOutline removes it` — `SKIP three-real not installed`
  - `plates: every piece of every icon stays inside its outline and stacks by layer` — `SKIP three-real not installed`
  These are `icon3d` tests that require the real `three` package
  (`three-real@npm:three@0.183.2`) rather than the hand-written stub tracked
  at `node_modules/three/index.js`; `tools/ensure-harness.sh` intentionally
  does not install that alias, so these two remain skipped under this
  procedure. Not a regression — same skip reason is baked into the test file.
- **Console noise:** none. No `console.warn`/`console.error` output, no
  unhandled rejections, no stray stack traces in the full log.

## 2. `node tools/birb-shot.mjs --out /tmp/start.png --start`

- **Exit code:** `0`
- **Output:**
  ```
  shot: /tmp/start.png  (390x844 @3x mobile)
  stats: {"calls":66,"triangles":76600,"sunUv":[0,0,0],"programs":39,"tier":1,"fps":3,"recovery":"flying","nesting":"flying","environment":"spherical-world-forest","altitudeAboveBase":3.02,"altitudeAboveGround":18.36,"elapsed":0.72}
  ```
- **Console noise:** none beyond the two lines above (the harness's own
  summary, not a page console warning/error).
- Note per the ground truth in the task brief: `fps: 3` here is a startup
  transient from the shot being taken at `elapsed: 0.72s`, not a steady-state
  measurement, and `tier: 1` / `calls: 66` reflect whatever adaptive-tier
  state the page reached by settle time on this run — record only, do not
  read significance into single-run values yet (no `--afterSettle`/repeat
  averaging was done for this baseline).

## 3. `node tools/birb-shot.mjs --out /tmp/nest.png --start --nest`

- **Exit code:** `0`
- **Output:**
  ```
  shot: /tmp/nest.png  (390x844 @3x mobile)
  stats: {"calls":36,"triangles":64088,"sunUv":[0,0,0],"programs":47,"tier":2,"fps":11,"recovery":"flying","nesting":"nested","environment":"spherical-world-forest","altitudeAboveBase":30.36,"altitudeAboveGround":39.41,"elapsed":10.97}
  ```
- **Console noise:** none.

## 4. `node tools/birb-modes.mjs`

- **Exit code:** `0`
- **Output:**
  ```
    casual: ok — rings 18/18, lives 3, nesting flying
    ring_rush: ok — rings 18/18, lives 3, nesting flying
    drone_hunter: ok — rings 18/18, lives 3, nesting flying
    turret_defense: ok — rings 18/18, lives 3, nesting landing, launched 2/3
    zen: ok — rings 18/18, lives 3, nesting nested
  all 5 modes ok in forest
  ```
- **Console noise:** none. This harness treats console **warnings** as
  failures (per the ground truth in the task brief) and it still exits 0 with
  the summary line matching the per-mode results — i.e. the "ok" tail is
  trustworthy on this run, not the failure mode recorded in
  `CLAUDE.md`'s §16 ("printed 'all 5 modes ok' on a run that was exiting 1").

## 5. `node tools/birb-shaders.mjs`

- **Exit code:** `0`
- **Output:**
  ```
    forest: ok
    canyons: ok
    mountain: ok
    city: ok
  all shaders compile in 4 environments
  ```
- **Console noise:** none.

## Oracle rules honoured while recording this

- No `--test-name-pattern` used anywhere (R1).
- Every harness was run to a log file first, exit code captured via `$?`
  into a separate file, and greps were run against the saved log afterward —
  never piped directly into `grep` (R2).
- Only the oracles named in this task were run; no whole-suite/gate run was
  performed here (R3).
- No SwiftShader/software-render number in this document is used as, or
  should be read as, a device claim (R6) — the shot/modes/shaders harnesses
  above ran under Playwright Chromium in this container, not on a phone.

## Surprises

**None.** HEAD is fully green on every existing oracle, with zero console
noise anywhere, including on `birb-modes.mjs` (which is designed to fail on
warnings) and on the two Playwright-driven `birb-shot.mjs` captures. The only
non-pass items in the whole run are the two structurally-skipped `icon3d`
tests, which skip for an documented, unrelated reason (missing
`three-real` alias, intentionally not installed by `tools/ensure-harness.sh`)
and are not a regression to chase.

This is itself worth flagging forward: later waves that assert "unchanged
from baseline" have a genuinely clean baseline to diff against — any new
warning, non-zero exit, or skipped/failed test introduced by an
implementation wave is attributable to that wave, not to pre-existing rot.
