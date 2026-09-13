# G-ULTRA-DEFAULT — Ultra is the old MAX REALISM, the harnesses boot at the baseline

**Date:** 2026-09-13 (night). **Build:** `v69-2026-09-13-ultra-max-panel`.
**Decision:** SHIP, with three frozen harness boot lines edited under R5 and
one new gate that pays for the default.

## What the owner asked for

> "Seems when I go into the settings and choose max realism button or
> whatever it looks better? I want the best view as default always on."

The MAX REALISM button (Ascend wave) requested: native DPR, post Full,
shadows on, VSM, 2048, 4x MSAA, anisotropy at the device max, terrain High,
decorative density 1. The Ultra preset shipped at v67/v68 was a subset:
tier pinned at 0, DPR ceiling 2.4, PCF 2048 shadows, nothing else. Those two
were not the same state, and the owner could see it.

## What changed

1. **A preset is a complete visual state.** `applyQualityPreset` now starts
   from `resetVisualOverridesToShipping()` (every override null, tier
   unpinned, shadows off, bloom 0.78, PCF, medium, terrain standard,
   anisotropy restored) and then applies the preset's own lever list through
   `qualitySettings.request` — the panel's path, CONTRACT §7.1. Ultra's list
   IS the MAX REALISM set. Amazing/Okay/Light have empty lists: they are the
   baseline plus a tier pin. G-ASCEND found BACK TO SHIPPING landing 0.07
   above shipping bloom because it restored by intent; a preset switch now
   always goes through the list, both directions.
2. **Native DPR through the CEILING, not an override.** MAX REALISM wrote a
   `dpr` panel override. An override takes the pixel ratio away from the
   tier entirely, so `__BIRB.pinTier(1)` no longer moves the drawing buffer
   — and the frozen A3 oracle's own self-check (pin 0, pin 1, expect the
   ratio to differ) would read false on every fresh boot. Ultra sets
   `dprCap = Infinity` with the tier pinned at 0 instead: same pixels
   (measured 3.0 on the iPhone 13 profile), the tier still owns the ratio.
   Measured on the boot path: pin 0 -> 3, pin 1 -> 1. DISCRIMINATES.
3. **MAX REALISM and BACK TO SHIPPING became presets.** `maxRealism` ->
   `applyQualityPreset(0)`, `backToShipping`/`reset` -> the baseline preset
   (index 1, not persisted). The panel shows the four presets as a strip in
   its header instead of the two buttons.
4. **`?quality=ultra|amazing|okay|light`** boots a preset by URL, not
   remembered. A production review switch like `?env=`/`?goto=`.

## Measured (SwiftShader, iPhone 13 profile at deviceScaleFactor 3, one page)

| preset | frame ms p50 / p90 / max | dpr | aa | shadows | post | ground | calls | tris |
|---|---|---|---|---|---|---|---|---|
| ultra (boot) | 2683 / 2917 / 2983 | 3 | 4x | vsm 2048 | full | high | 30 | 76,162 |
| amazing | 133 / 267 / 933 | 1.7 | off | off (pcf 1024 set) | half | standard | 32 | 59,998 |
| ultra (again) | 2583 / 2933 / 2950 | 3 | 4x | vsm 2048 | full | high | 35 | 77,274 |

A screenshot at Ultra took 24.0 s. Boot to Tap-to-Start: 30 s.

Per-lever cost from Ultra, one lever back at a time (same page, appended
below when the probe finished):

| from Ultra, one lever back | frame ms p50 | max |
|---|---|---|
| (Ultra as booted) | 2700 | 3050 |
| AA off | 2267 | 2800 |
| AA off, PCF instead of VSM | 2450 | 3567 |
| AA off, shadows off | 1833 | 1950 |
| AA off, post Half | 1883 | 3383 |
| AA off, DPR 2.4 | 1567 | 2317 |
| AA off, DPR 1.7 | 1133 | 1667 |
| AA off, terrain Standard | 2150 | 2717 |
| AA off, shadows off, post Half, DPR 1.7 | 433 | 450 |
| Amazing (tier auto, landed on tier 2 here: DPR 1) | 333 | 1917 |

No single lever owns it: DPR is the largest (3 -> 1.7 saves 1.1 s), then
shadows (0.4 s), post resolution (0.4 s), MSAA (0.4 s), terrain (0.1 s).
So there is no one lever to drop from Ultra that would make the harnesses
viable at the default, and the decision below is to boot them at the
baseline rather than to weaken the preset.

Effective state read back at boot (`__BIRB.qualityPreset()`, which reads
`panelGetControlState`, never the preset table):

```
{"dpr":3,"postQuality":"full","shafts":true,"bloomStrength":0.78,"weatherDensity":1,
 "mistBudget":1,"decorativeDensity":1,"antialiasing":"4x","shadowsEnabled":true,
 "shadowType":"vsm","shadowMapSize":"high","anisotropy":16,"terrainResolution":"high",
 "tone":"neutral","exposure":1.2096,"bloomThreshold":0.78}
setShadows({}) -> {"enabled":true,"type":3,"mapSize":2048,"casterCount":23}
```

After `qualityPreset('amazing')` on the same page: shadows false, pcf, 1024,
aa off, post half, anisotropy 1 (each texture's own value), terrain
standard, bloom 0.78, pinned false — the baseline, field for field.
`tools/birb-default.mjs` repeats this as a CI gate and adds the round trip
(ultra -> amazing -> ultra must equal boot).

## The harness consequence, and the R5 edits

Every browser harness boots `index.html?debug=1` and therefore at the
default. At 2.6 s a frame, `tools/birb-walk.mjs` (frame-counted landing and
walk), `tools/birb-modes.mjs` (five modes) and `tools/birb-quality.mjs`
(`--check all`, windows of sampled frames) cannot finish inside the job's 24
minutes; the first attempt at this session's panel screenshots timed out
inside Playwright's own screenshot step under the same load.

Three frozen files gained `&quality=amazing` on their boot URL:
`tools/birb-modes.mjs`, `tools/birb-walk.mjs`, `tools/birb-quality.mjs`.
Why this is restoring the oracle rather than eroding it: every quality
assertion was written and frozen against the OLD shipping default — shadows
off, tier auto, no overrides — which is exactly the Amazing preset. Ultra
becoming the default at v67 changed their boot conditions silently (G-A5-DRIFT
is dated the same day); the flag puts them back. `quality-captures.mjs`'s
`openProductionPage` (A1) is untouched: it strips the query, never taps
start, and never renders a frame. `tools/birb-shot.mjs` is untouched; the
workflow passes it `--query quality=amazing`.

`tools/birb-shaders.mjs` stays at Ultra ON PURPOSE — the VSM depth
programs and the multisampled scene target exist only there — and now waits
for three RENDERED frames per biome instead of 2200 ms, because at 2.6 s a
frame the old wait could switch biomes before the previous one had drawn
once, and a material never submitted has no compile error to report.

`tools/birb-default.mjs` (new, in Browser Health) is the one check that
boots with no flag: it asserts Ultra with every lever at its ceiling, the
tier discriminator, the Amazing baseline, the round trip, and that
`?quality=amazing` is not remembered.

## What is NOT known

The phone. Ultra at DPR 3 with 4x MSAA, VSM 2048, full-resolution post and
the high ground mesh has not been measured on the iPhone 16 Pro from here;
the tier is pinned, so nothing sheds if it cannot hold 60. The owner has
been playing with MAX REALISM pressed (the same set) and asked for it. The
escape hatch is one tap: Amazing, in the gear menu or the panel strip.
