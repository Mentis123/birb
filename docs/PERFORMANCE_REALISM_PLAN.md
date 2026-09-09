# Birb: realism within a measured frame budget

Research and implementation plan · 9 September 2026

**Recommendation:** build a small performance workbench and a reversible quality controller first. Spend recovered frame time on image stability, believable materials and nearby detail. The controller runs locally; it needs no AI calls or ongoing token spend.

Reviewed root Birb Mobile at [main `2eac8e1`](https://github.com/Mentis123/birb/tree/2eac8e1a2bf71d91ac952670696cd27a0f48394f), including the latest ground, drone, gate and ribbon changes. This is source review and targeted research, not a physical-device benchmark. Effort and thresholds below are initial engineering estimates. No game code was changed.

**What is already there — preserve it**

Three.js is pinned to 0.183.2. Recent passes added atmospheric shading, material variation, improved silhouettes, water, light shafts, bloom, contact shading, wind and flight effects. Mobile DPR now caps at 1.7 following positive device feedback. Recommending those features again would waste effort. The previous spatial-sector experiment increased draw calls beyond its budget for a modest triangle saving; reopen it only with a changed scene distribution and new evidence. The removed flock also has direct negative playtest evidence.

**Specific gaps in the current implementation**

| Finding | Consequence / first action |
|---|---|
| The [adaptive manager](https://github.com/Mentis123/birb/blob/2eac8e1a2bf71d91ac952670696cd27a0f48394f/index.html#L6494) uses three bundled tiers, 250 ms FPS samples and averages. | Tier 0→1 changes DPR 1.7→1.0, switches bloom off and reduces other effects together. That removes about 65% of scene pixels on a device reaching the cap; it is not a measured 65% frame-time saving. Separate the controls. |
| The averaging window is selected by the current tier. | At tier 1, a further downgrade waits for the same four-second window used for recovery. Separate overload and recovery timers. |
| Tier changes call `renderer.setPixelRatio()` directly; [resize handling](https://github.com/Mentis123/birb/blob/2eac8e1a2bf71d91ac952670696cd27a0f48394f/index.html#L6775) separately sizes the bloom targets. | Source-level inconsistency: resizing while degraded, then restoring, can leave the scene target below the requested resolution. Route every quality/viewport change through one sizing function; verify this sequence in a browser. |
| [Bloom stats](https://github.com/Mentis123/birb/blob/2eac8e1a2bf71d91ac952670696cd27a0f48394f/src/effects/bloom-pass.js#L374) snapshot the scene before post-processing. | Better than reporting only the final triangle, but still excludes four regular post draws and up to three shaft draws. Show both scene and whole-frame totals. |
| Background/environment transitions reset the frame sampler; the tier manager has separate accumulated state. | Add a coordinated reset so stale history does not cross loading, resume or resize boundaries. |
| Debug hooks expose bloom, lighting, stats and `pinTier`; there is no unpin method. | Reuse these capabilities behind a common settings API; add explicit Resume Auto and reset. |
| Three-finger QR overlays exist in sibling apps; no matching root dev-console integration was found. | Reuse the gesture recognition pattern, then wire the requested panel into root Birb. Do not assume the sibling overlay already controls this game. |

**The three-finger workbench**

Use a small DOM panel with three views: Performance, Look and Capture. Three fingers arriving together and holding briefly should open it on release. Cancel gameplay pointers when it opens, respect touch cancellation, and prevent one-/two-finger flight gestures from triggering it. Supply a debug-URL button and keyboard fallback because OS gestures can intercept touch input. Preserve QR access wherever that already exists.

Provide live tuning while safely perched or flying, plus pause/freeze for art comparison. Mark paused measurements invalid for adaptive decisions. Update panel telemetry about four times per second; avoid per-frame DOM work. Close restores control cleanly.

| Control | Proposed behaviour |
|---|---|
| Auto / Manual / Benchmark | Manual suspends Auto. Benchmark fixes seed, route, settings and sun; it does not adapt during a comparison. Resume Auto clears stale history. |
| Target rate | 60 default; explicit 30 FPS battery/stability option with actual render pacing. Add 90/120 only after observed browser cadence and device testing justify them. |
| Resolution | Absolute render-DPR slider, initially 0.85–2.0 in 0.05 steps, bounded by native DPR and a maximum pixel budget. Default ceiling stays 1.7 mobile. Show effective buffer dimensions and native-resolution percentage. Values above today's cap are experimental. |
| Post quality | Off / quarter / half resolution. Independent shafts toggle and bloom strength slider. Strength is a look adjustment, not a promise of lower rendering cost. |
| Weather, mist, decorative effects | Density sliders 0–100%; hide/skip work at zero. Preserve gameplay targets and collision geometry. |
| Surface detail | Existing baseline / simplified / richer experimental variant. Shader variants apply on release and are prepared outside active flight. |
| Look | Exposure, atmosphere/mist strength, wind and existing bloom threshold. Display current values; retain per-biome baselines. Auto never changes these artistic choices. |
| Compare / export / reset | Fixed-view A/B, copy/download JSON including build, seed, device/browser, requested/effective values and timing. Version local presets; keep benchmark/manual locks session-scoped. |

Show delivered FPS, p50/p95/p99 frame interval, missed-target-frame percentage, CPU update/submission time, GPU time or “unavailable”, drawing-buffer pixels, scene/total calls and triangles, program/resource counts, estimated owned render-target memory, last adjustment/reason, cooldown and active mode. Resource counts are not byte-accurate GPU memory readings.

**How intelligent up/down shifting should work**

Use a deterministic state machine: **observe → reduce one cost → settle → evaluate → hold or revert**. Learn a small amount from local measurements rather than guessing device quality from a user-agent or CPU-core count.

1. Collect frame intervals in a fixed-size buffer. Time CPU simulation and render submission separately. Feature-detect optional GPU timer queries, read completed results on later frames, discard disjoint results and clean up queries. A timer around `renderer.render()` is not GPU execution time. Follow the [Khronos timer-query specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).
2. Start from a conservative last-known stable profile or today's baseline, with a short warm-up. Use a target budget `B = 1000 / targetFPS`. Evaluate one-second windows; initial overload rule: p95 interval >1.2×B or >5% missed-target frames for two windows. Severe sustained overload may take another step sooner. Tune these numbers on phones.
3. Restore one small step only after 10–15 seconds of stability, with roughly 20% measured CPU/GPU work headroom where available. Hold for 2–3 seconds after ordinary adjustments. If an upgrade regresses, roll back and lengthen its retry cooldown. Delivered 60 FPS alone does not reveal spare GPU capacity on a 60 Hz display; without GPU timing use occasional bounded probes and learn from their result.
4. Diagnose approximately: if pixel reduction helps, target pixel/effect cost; if CPU work dominates and DPR changes do little, target decorative update rates, allocations or submission overhead. Keep confidence low when measurements are ambiguous. Persist an action only if it helps beyond noise. Never reduce collision, input or flight simulation fidelity to conceal a rendering bottleneck. [MDN WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) supports smaller buffers and avoiding synchronous GPU stalls.
5. Prefer low visual loss: reduce shaft work, distant mist/weather coverage and post resolution; then reduce scene DPR in 0.05–0.10 steps. Reorder this list from device A/B evidence. Protect the bird, near silhouettes, contact cues and readable targets. Uniform intensity changes alone may leave the expensive shader work intact.
6. Apply renderer, scene target and effect dimensions atomically. Round dimensions and enforce total pixel/memory ceilings. Commit resolution changes at intervals, not on every slider input; repeated reallocations can create the stalls being measured. Keep HTML controls at CSS resolution. [Three.js responsive rendering](https://threejs.org/manual/en/responsive.html) explains explicit drawing-buffer control.
7. Reset all relevant history after bounded, explicitly tagged loading/resume/resize events. Do not erase recurrent gameplay hitches. Continue observing throughout the session and back off upgrades when sustainable performance declines. Report “sustained slowdown”, not a claimed temperature measurement. Never silently change the user's FPS target.

**Mandatory self-evaluation and improvement loops**

Both loops below are required deliverables. A controller that changes settings without evaluating the result is incomplete; an implementation that passes one screenshot or one favourable route is also incomplete.

**Runtime loop — improve decisions during play.**

1. **Observe and predict:** record the current effective settings, frame-time distribution, available CPU/GPU timings, biome, gameplay state and recent load trend. Select one bounded adjustment and record its expected benefit and confidence.
2. **Apply and verify:** confirm the effective buffer sizes, effect activity or update rates actually changed. A slider value changing is not evidence that rendering work changed. Allow the settling period before scoring.
3. **Evaluate:** compare equal-duration windows in comparable gameplay conditions. A flight into a quieter area must not be credited to the adjustment. Mark changing scenes, unavailable evidence or differences within measured noise as inconclusive. Use controlled replay to establish causality during development; live observations provide weaker evidence.
4. **Keep or roll back:** retain a quality reduction only when it provides a useful, measurable performance benefit, or is a temporary emergency measure pending evaluation. Retain a quality increase only when frame pacing and headroom remain within budget. Roll back ineffective reductions and failed upgrades; an inconclusive probe returns to the prior stable state once safe. Emergency recovery takes priority while severe overload persists.
5. **Learn:** maintain a small action history with predicted versus observed benefit, confidence, failed probes and cooldowns. Prefer actions with demonstrated benefit and low visual cost. Scope persisted summaries to build/settings schema, browser/device capability profile and biome; age out stale evidence, bound storage and revalidate after updates. Do not require a unique device fingerprint.
6. **Evaluate the evaluator:** track adjustment frequency, reversals, time outside budget, time spent unnecessarily degraded, prediction error and recovery time. Excessive oscillation or repeated ineffective actions disables exploratory upgrades and selects the last stable profile while protective downshifts remain active. A stable frame rate with permanently poor quality is not success: schedule occasional safe recovery probes.

Continue a longer watchdog after accepting a change: improved average timing must not conceal worse tail latency, input responsiveness, resource growth or visible instability. Revoke acceptance if delayed regressions appear. Invalidate affected cost estimates when other settings change, because effect costs interact; require repeatable gains before raising confidence, particularly with compilation, streaming or sustained device slowdown in play.

Exploration is bounded: one outstanding probe, no probing during loading or high-input gameplay, and initially at most one optional upgrade probe per 30 seconds. Emergency reductions use the faster overload policy. The existing warm-up and cooldown rules still apply. These are tunable starting limits. All runtime learning is local, deterministic and restricted to approved settings ranges.

**Development loop — improve the controller and the visuals.**

For each change: state a hypothesis and success gate → record a fixed-build baseline → change one factor → repeat matched A/B or A/B/A runs → inspect timing, gameplay and visual evidence → revise or revert → rerun the affected gates. Use different routes and devices for final validation from those used to tune the change. Compare Auto with the current controller and fixed reference profiles to verify that adaptation earns its overhead.

Every retained change needs a short evidence record: hypothesis, build/settings/seed, device/browser, warm/cold state, repeated results and variability, observed visual tradeoff, decision, and next unresolved issue. Automated checks cover frame pacing, settings application, control integrity, shader failures, missing objects and stable reference views. Image differences alone cannot establish improved realism; review matched motion clips or obtain player feedback for shimmer, blur, distracting transitions and perceived improvement.

Add deterministic trace regressions for each controller failure found. Test slowdowns, recovery, missing/disjoint GPU queries, scene changes, misleading FPS plateaus, stuck quality settings and measurement overhead. Require bounded response, eventual recovery when capacity returns, correct rollback and freedom from persistent oscillation. Measure with telemetry and the panel both enabled and disabled so instrumentation does not manufacture the bottleneck.

Keep the work bounded: initially allow three candidate revisions per experiment. Stop when the gates pass with a visible benefit, or when repeated runs show no useful gain; record the result and move to the next ranked experiment. Reopening needs new evidence or an explicit budget decision. Runtime learning tunes settings; algorithm/code changes go through the development loop and normal release validation.

The dev panel shall expose **last hypothesis, measured outcome, confidence, recent decisions, learning on/off, reset learned profile and export evidence**. Manual and Benchmark modes suspend learning-driven changes; Resume Auto starts with fresh measurement windows. This makes the improvement loop inspectable and reproducible.

**Experiments with the highest expected return**

| Order | Experiment / alternative angle | Decision rule |
|---|---|---|
| 1 | **Find the cost of today's realism.** Fixed route, independently toggle ground detail, atmosphere, water, shafts, bloom, weather and ribbons. Repeat at two DPRs. | Rank visible benefit against p95 GPU/CPU cost; record interactions. Low draw-call counts do not prove cheap fragment shading. Arm's [mobile profiling guidance](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/finding-and-fixing-hidden-performance-problems-in-mobile-games-with-arm-performance-studio) highlights overdraw and shader cost. |
| 2 | **Image stability before more effects.** Compare current DPR 1.7 against slightly lower DPR with a bounded FXAA-style composite option; separately test low-sample target MSAA. Fade procedural microdetail below pixel scale. | Judge moving edges, foliage shimmer and distant surfaces in video, alongside GPU cost. AA may improve perceived realism; it may also blur detail or cost more than it saves. Do not add TAA/upscaling machinery first. |
| 3 | **Compute versus texture lookup.** Compare current procedural noise against a small shared mipmapped noise/material atlas; precompute static terms where sensible. | Keep whichever gives the better device-specific timing and look. “No textures / no extra draw calls” is not equivalent to free. Preserve slope/macro variation and avoid a broad asset-pipeline rewrite. |
| 4 | **Spend detail where it is visible.** Improve one bird/near-tree/waterfall material and silhouette; use screen-size thresholds for cosmetic detail. | Demonstrable improvement in the same flight route and perch. Avoid multiplying instanced batches or restoring previously rejected global sectors without evidence. |
| 5 | **Protect sustained smoothness.** Profile allocations, first-use shader compilation and periodic decorative updates. | Remove actual spikes; stagger only noncritical work. Use existing pooling, and prepare known shader variants with supported [Three.js compilation facilities](https://threejs.org/docs/pages/WebGLRenderer.html#compileAsync) outside flight. |

Reserve screen-space AO/reflections, volumetric cloud raymarching, temporal reconstruction and a renderer migration for a later measured need. A coherent light direction, convincing material scale, stable edges and responsive motion should lead the next realism pass.

**Small implementation batches and acceptance gates**

1. **Measurements and workbench: roughly 1–2 engineering days.** Extend `src/game/frame-metrics.js`; add `src/ui/dev-quality-panel.js` and a settings API; correct whole-frame stats and sizing. Existing `setLighting`/`setBloom` hooks remain adapters. Make requested and effective settings agree after orientation changes and context recovery. Count all passes using a consistent reset boundary as described by [Three.js renderer statistics](https://threejs.org/docs/pages/WebGLRenderer.html#info).
2. **Controller: original estimate roughly 1–2 days for the basic policy.** Extract it from `index.html` into `src/game/adaptive-quality.js`; split effect controls in `src/effects/bloom-pass.js`. Include the mandatory runtime evaluation, rollback and bounded learning loop above; allow roughly 1–2 additional engineering days for its evidence history, panel feedback and regression coverage, subject to device findings. Test recorded/synthetic timing traces for overload, recovery, oscillation, absent GPU timers, manual→auto, resume and unsuccessful probes. A fake clock makes the policy tests cheap.
3. **Envelope experiments: roughly 1–2 days plus device access.** Extend `tools/birb-shot.mjs`, `birb-sheet.mjs` and `birb-modes.mjs` with a seeded flight route and JSON performance capture. Change one thing at a time; rerun promising combinations. Then select one visual improvement from the table above. Art/asset creation is additional work.

Use at least an older supported iPhone, a newer iPhone and a midrange Android with actual hardware acceleration. Start with forest low flight, waterfall/shafts, boost effects and city perch; confirm all four biomes and five modes before release. Record cold-start separately from warmed performance. Follow a short repeatable comparison with a 15–20-minute session, orientation changes, background/resume and repeated scene switches.

For a selected 60 FPS profile, initial sustained acceptance is p95 frame interval ≤18.5 ms, <1% intervals >25 ms on the repeatable route, no recurring unexplained >50 ms spikes, and no persistent quality oscillation after settling. If a device cannot meet this, report it and offer the explicit 30 FPS mode. These are proposed gates, not current measured results. Export raw intervals so percentiles and misses can be checked.

Keep the existing browser health and gameplay assertions. Add a targeted degraded-resize-restore check that verifies actual scene/post buffer dimensions, and a panel gesture/control-release check. Visual captures must state whether quality was pinned. SwiftShader and desktop viewport emulation can catch functional/shader regressions but cannot establish phone performance. The existing city-nest capture timeout remains a separate known issue; require successful landing before using that view as visual evidence.

**Budget stop rule:** complete the workbench and controller before commissioning more effects. Proceed only with an experiment that produces a visible gain within sustained device budgets. This is a short, testable sequence, not authorization for an open-ended graphics rewrite.
