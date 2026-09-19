# G-A5-DRIFT — A5 measures the clock, not the weather

**Status: FINDING + proposed patch. NOT applied. Needs a gate decision,
because the fix lands in a hash-frozen oracle (`tools/lib/quality-captures.mjs`,
`tools/oracle-manifest.txt`, R5 "implementers must not edit these").**

Raised 2026-09-13 after `Browser Health` went red on `main` at `58e240a`.

## What happened

`node tools/birb-quality.mjs --check all` failed with:

```
A5 state=fail
  A5: scene draw calls did not fall.
```

The same commit PASSED the same job on the branch four seconds earlier:

| run | ref | commit | conclusion |
|-----|-----|--------|-----------|
| 97 | `claude/ultracode-sub-agents-plan-c9qmba` | `58e240a` | success |
| 98 | `main` | `58e240a` | **failure** |

Identical tree, opposite verdicts. Three more same-commit pairs disagree in
the preceding twenty runs of this workflow (`23f2290`, `9fe2317`, `aa07ef4`).
Note what did NOT fail: the hidden half. The weather points were correctly
invisible at density 0. Only the draw-call total had not moved.

## Why it is not measurable as written

`assertA5` compares two medians with a strict `zero < one`, and the entire
signal is the weather's **one** draw call.

`__BIRB.freeze(true)` freezes the **bird** and nothing else — it sets the
flight controller's speed to 0 (`index.html` ~11751). Drones, clouds and every
other independently animated object keep crossing the frustum for the whole
capture, and `captureA5` samples all of density 1 and then all of density 0,
so the two medians are taken at different points on whatever the rest of the
scene was doing.

Measured on this tree, pose frozen, sun disabled, tier pinned, forest:

| probe | result |
|---|---|
| 60 frames, one window | seven distinct values, 30 to 36 |
| median first 10 vs last 10 of that window | 30 vs 36 (**+6**) |
| after a 40-frame warm-up, four consecutive 15-frame windows | medians **34, 32, 28, 29** (spread 28-35) |
| same probe in Ring Rush, which is drone-free | still 4 of drift, six distinct values |

So it is not a startup transient (it survives a warm-up), and it is not only
the drones (it persists in the drone-free mode). Consecutive windows of equal
length, with nothing the harness controls changing, differ by up to **six draw
calls against one call of signal**.

The drift in these samples trends DOWNWARD, which is why the check usually
passes: density 0 is always the later window, so a falling count flatters
`zero < one`. It fails on the runs where the drift happens to rise. That is the
shape of the CI history.

## Proposed patch

`tools/lib/quality-captures.mjs` only. `assertA5` is untouched: still
`zero < one`, still one call of signal. What changes is that the number it
compares becomes attributable to the weather.

1. **Interleave.** Four cycles of (density 1 window, density 0 window) at 5
   frames each, pooling all density-1 frames and all density-0 frames, so
   drift lands on both medians instead of only the second.
2. **Counterbalance the order.** Cycles 0 and 2 sample density 1 first; cycles
   1 and 3 sample density 0 first. Interleaving alone is not enough — if
   density 0 is always the later half of a cycle, a rising ramp biases the zero
   pool upward every time, converting a false pass into a false FAIL. The
   alternation cancels a linear drift to first order in both directions.
3. **Wait on frames, not milliseconds.** The capturer slept 200 ms after moving
   a slider. Under SwiftShader in CI this page runs at 2-4 fps, so 200 ms is
   routinely less than one frame. `waitForFrames(page, 2)` means the same thing
   on a desktop and on a runner.
4. **Within a window, `visible` stays the SETTLED (last-frame) value**, and is
   sticky-true across cycles. Treating a single stale frame as the verdict
   would trade this flake for a fresh one in the other direction.

Measured with the patch applied: `--check all` 12/12 pass, `--check
resize-restore` exit 0, and `--selftest` still reports 23 of 25 mutations
detected with **both** A5 mutations caught —
`M-A5-uniform-not-visibility -> fail` and `M-A5-tier-confound -> invalid` — so
the assertion is still falsifiable.

## The alternative, and why it was not taken

The root cause is that `__BIRB.freeze()` does not freeze the scene, only the
bird. Making it also pause the drone system would fix this for every harness
that relies on freeze for determinism (the contact sheet, the bird sheet,
`birb-shot`). It was not done here for two reasons: the Ring Rush probe shows
drones are not the whole source of the drift, so it would not close the gap on
its own; and it changes a shared hook that several gates depend on, which is a
larger decision than the one this document asks for.

## The general lesson

**When a check's signal is one unit and its window is seconds long, it is not
measuring what it names unless something proves the rest of the frame held
still.** This check has been green for most of its life without ever having
been measurable.
