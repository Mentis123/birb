VERDICT: PASS — every G2d blocker closed and re-measured; Wave 2 is cleared to merge.

# G2e — Wave 2 final gate (orchestrator, Opus 5)

Decided on branch `claude/ultracode-sub-agents-plan-c9qmba`. G2d returned STOP with two open
findings and three carry-forwards. All five are closed below, each re-measured rather than
re-argued. G2a/G2b/G2c/G2d stand as the record.

## 1. QS-A6 / QS-A7 — a frozen oracle was overridden by advice about the oracle

G2d's headline: Wave 2R took G2a §4.7's **prose recommendation** — redefine `clamped` from
`effectiveAfter !== value` to `clampedValue !== value` — over the frozen suite's own
definition, and two assertions that were green at G2c went red. That is exactly what R5
forbids and what two agents were commended for refusing in Wave 1.

Reading the suite settles it. QS-A7's own failure message is *"and the gap between the two is
reported as a clamp"*, and QS-A6's rig injects its quantiser on the **renderer**, not as a
clamp function — so a live object snapping 1.73 to its own 0.05 grid is a clamp that was
genuinely applied. The suite means what it says, and **G2a's advice was wrong on this point.**

But G2a's *finding* was real and was never about `clamped`. It was about `applied`: a control
wired to nothing reported `applied: true`. Resolution, additive rather than either/or —

- `clamped = effectiveAfter !== value` — the frozen definition, restored.
- `desync = effectiveAfter !== clampedValue` — **kept**. It is the distinction G2a was
  reaching for and it is real: an honest clamp and a live object ignoring what it was handed
  are different failures, and only this field separates them.
- `applied = changed || effectiveAfter === clampedValue` — rendering state moved, or the value
  already in force was re-requested. Not `!desync`, which QS-A6 disproves.

```
BIRB_PERF_IMPL=1 node --test tests/quality-settings.test.js -> 0   11/11 pass
apply wired to nothing:
  {"requested":1,"effective":1.7,"clamped":true,"desync":true,"changed":false,"applied":false}
```
The frozen oracle is satisfied and the unwired control still refuses to claim it was applied.

## 2. The seven ungraded assertions — wired, and the ordering defect they exposed

Wave 2R wrote the capturers into the unfrozen `tools/lib/quality-captures.mjs` and correctly
refused to touch the frozen harness to wire them in. Two authorised edits to
`tools/birb-quality.mjs` were taken here, both additive, neither able to weaken an assertion:

1. `import { LIVE_CAPTURES as PANEL_CAPTURES }` spread into `LIVE_CAPTURES`.
2. **A6 gets its own page** in `--check all`.

The second was not planned and is the finding of this gate. `--check all` deliberately boots
ONE page — SwiftShader costs 20–60 s a boot and twelve would price the gate out of CI — so
wiring the capturers in made **A6 fail inside `--check all` while passing standalone**. It
began its `tier0` step at the 1.3 `captureA3` had left on the DPR slider. Fixing it per
quantity did not converge: restoring DPR moved the failure to A5, and restoring the sun and
density moved it to A9, which reported *"the sun was not producing shafts before the toggle"*
because `captureA5` disables the sun and never re-enables it.

Both restores were kept — a capturer that disables the sun and walks away is rewriting the
world for everything downstream — but **a check whose verdict depends on which siblings ran
before it is not a check**, so A6 alone now runs clean. One extra boot buys the assertion this
wave exists to satisfy.

```
node tools/birb-quality.mjs --check all -> 0    12/12 pass
  A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 all state=pass
```
Previously: exit 1, seven assertions with no capturer at all.

## 3. `__BIRB.worldSeed()` — text asserting the opposite of the tree

It returned the not-implemented sentinel behind a comment asserting as present fact that
*"src/environment/ still has 76 raw Math.random() call sites and no seeded-random.js exists on
disk"*. Wave 2R shipped the generator and threaded it through the builders, so both clauses
were false. This is G2c §3.5's defect class — the CI step names asserting a bug was still
present after it was fixed — recurring in the same wave, one file over.

Wired to the real generator, stale comment deleted:
```
worldSeed(12345) -> {"seed":12345,"appliesOn":"next-world-build"};  worldSeed() -> 12345
```
It reports that the seed applies on the next world build rather than implying the world in
front of you is already the seeded one.

## 4. `EXPECTED-RED.md` — superseded, retained

G2c §7.1 authorised the revision; it is taken here. The file now carries a SUPERSEDED banner
and is kept as the historical description of the defect, because two things it governs are
still live: `EXPECTED_RED_HEAD` in the frozen assertion library still encodes the broken
values (so `matchesExpectedRed` correctly reports `matches: false` — the frozen assertion was
NOT edited to agree), and its four-step sequence is still the required shape of the check. A
run truncated at step 2 is red today for the right reason and would go green forever the
moment anyone touched the sizing path.

## 5. CI — `--check all` promoted to a hard gate

G2d confirmed the ordering fix: `birb-shot --start`, `--start --nest`, `birb-modes` and
`birb-shaders` run FIRST and unconditionally, so nothing this programme adds can stop the
game-health checks running. `--check all` now exits 0, so its `continue-on-error` is removed —
with it, a regression in any of the twelve would be tolerated silently, which is the failure
mode this programme exists to prevent. `--check resize-restore` remains a hard gate.

`--selftest` keeps `continue-on-error` and a comment naming the wave that removes it. It
legitimately exits 1: 25 catalogued, 25 applicable, **23 detected**. The two undetected are
page-REAL mutations (`M-A1-gesture-behind-debug`, `M-A2-panel-opens-on-any-touch`) that need
source-mutating verifiers, which no wave has built. **This is Wave 1's F1 guard working as
designed** — before that fix it would have exited 0 while covering nothing. Carried to Wave 3
as the last open item in the workbench.

## 6. Full oracle set at the merge commit

```
npm test                              -> 0   485 tests, 399 pass, 0 fail, 86 skipped
BIRB_PERF_IMPL=1 npm test             -> 0   485 tests, 483 pass, 0 fail
node tools/birb-modes.mjs             -> 0   all 5 modes ok in forest
node tools/birb-shaders.mjs           -> 0   all shaders compile in 4 environments
node tools/birb-shot.mjs --start      -> 0
node tools/birb-shot.mjs --start --nest -> 0
node tools/birb-quality.mjs --check all -> 0   12/12
node tools/birb-quality.mjs --check resize-restore -> 0
node tools/req-verify.mjs             -> 0
sha256sum -c tools/oracle-manifest.txt -> 0   58 files
python3 yaml.safe_load on both workflow files -> parses
```

Siblings unharmed: humanoid, gauntlet, sculpture and icon3d all still pass under the
env-unset run. The baseline legitimately moved from 460/378/0/82 to 485/399/0/86; pass and
fail counts are what matter and both are clean.

## 7. Open, and recorded rather than hidden

- **`--selftest` two page-real verifiers.** Above. Wave 3.
- **`gpu-timer` returns `not-webgl2`**, which is not in CONTRACT §3.1's closed reason enum.
  The behaviour is right and the contract is short a row; §3.1 is frozen, so the amendment is
  a Wave 3 gate decision. Recorded, not silently absorbed.
- **The compatibility ladder holds.** Wave 2 changed no live adaptive behaviour: the 55/58
  thresholds, the tier table and DPR_CAP are untouched. The workbench did not alter the thing
  it exists to measure.
- **Nothing here is a device claim (R6).** Every number above is a dimension, a count or an
  exit code. CI renders through SwiftShader at 2–9 fps and the four acceptance gates remain
  unmeasured until Wave 4 puts this on a phone.
