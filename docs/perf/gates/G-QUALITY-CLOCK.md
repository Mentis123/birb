# G-QUALITY-CLOCK — A1/A2's production page gets 60 s, not 20

**Date:** 2026-09-24. **Decision:** AMEND the frozen oracle
`tools/lib/quality-captures.mjs`, one timeout, and regenerate
`tools/oracle-manifest.txt` in the same commit. No assertion changed.

## What failed

Browser Health on the realism-wave-2 branch (run 162) failed
`birb-quality --check all` on one line: `A2 state=unavailable — no panel
exists yet`. The same check passed when run alone, and the full board passed
on a second run.

`unavailable` with `present: false` is what `captureA2` returns when
`openProductionPage` THROWS — its `waitForSelector('#birb-dev-quality-panel',
{ timeout: 20000 })` expired. That wait is wall clock for the module script
to evaluate on a second page, while the harness's first page keeps rendering
the game under SwiftShader.

## The measurement

Time from `domcontentloaded` to the panel node attaching, three boots each:

| tree | idle machine | a game page rendering beside it |
|---|---|---|
| base `d47fc7e` | 1.3-2.5 s | **8.3-8.6 s** |
| wave 2 | 1.3-2.5 s | **7.8-8.8 s** |

The same on both trees: wave 2 did not make it slower. On a 4-core box the
contended boot takes ~8.5 s; a CI runner about twice as slow sits on the
20 s edge, which is why this reads as a coin toss.

## The amendment

60 s. A panel that genuinely never attaches still fails, now without
depending on how busy the runner is.
