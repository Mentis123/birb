# Profiles and iPhone validation

The goal is to find the best believable image the iPhone 16 Pro can sustain in Chrome 152.0.7977.64, while preserving an explicit higher-cost reference. Every number below is a **proposed experiment setting or acceptance criterion**, not a measured capability. The current game does not yet implement the whole ladder. The associated [JSON](profiles.proposed.json) is builder input, not a runtime import format.

## Three independent settings layers

1. **Art direction:** bird identity, anatomy, material palette, light direction, exposure/grade, broad wetness/snow masks, foliage motion character. These remain consistent across profiles.
2. **Resource quality:** scene pixels, AA, reflection representation/cadence, shadow resolution/range/casters, material sampling, near detail range and decorative population. These are the optimization variables.
3. **Comfort:** camera shake, speed smear, vignette, motion intensity and sound preferences. Respect these in all quality modes. A reduced-motion player can still select high resource quality.

Gameplay objects, collision proxies, course layout, spawn rules, timers and scoring are a separate invariant. Decorative changes must not make targets disappear, expose formerly hidden enemies or remove a required navigation cue.

## Initial profile candidates

Settings are starting points to challenge, not a promise that each candidate works. Clamp DPR against the actual display and a measured maximum pixel allocation. Do not infer CSS dimensions, native DPR, refresh cadence or GPU capabilities solely from the model name.

| Profile | Purpose and cadence | Initial render settings | New-content representation |
|---|---|---|---|
| Shipping Reference | Existing main behavior; comparator | Capture actual effective settings and adaptive state, rather than reconstructing them from old prose | Existing procedural bird/world; used for regression, not the final realism target |
| Reference Lab | Explicit opt-in; 60 target for comparison; 120-second trial | DPR 2.5 initially, native DPR as a separate sweep; scene MSAA 4× if supported; full post as an experiment; 2048 near PCF shadow; anisotropy up to supported 8× initially | Hero bird LOD0, high local terrain, full near foliage, hero water reflection, all authored interaction cues. Test expensive effects individually before combining |
| Cinematic 30 | Deliberate high-image-quality play at paced 30 | DPR 2.0; 2× AA; half post; 2048 near PCF shadow; 8× supported anisotropy | Hero/near LOD, rich surfaces, bounded pool reflection; preserve image quality while spending fewer frames |
| Ultra 60 | Candidate default for this phone if sustained tests pass | DPR 1.7; 2× AA; half post; 1024 near PCF shadow; 8× supported anisotropy | Hero bird where projected size warrants it, medium/high near terrain, cached environment reflection, full essential interactions |
| Balanced 60 | Responsive play with more headroom | DPR 1.4; 2× AA if it earns its cost; quarter post; 1024 near PCF with smaller caster region; 4× supported anisotropy | Same silhouette, material boundaries and light; shorter decorative range, simpler reflection and fewer shader samples |
| Cool 30 | Long-session/low-power preference | DPR 1.2; non-temporal AA experiment; quarter/off bloom while retaining correct final output; dynamic shadows off with contact fallback; 2× supported anisotropy | Preserve bird identity/contact and major surfaces; sparse near clutter, analytic water/sky reflection, bounded ambient effects |
| Recovery | Responsive escape after failed configuration | DPR 0.85–1.0, paced 30 if supported; bloom/shafts/reflections off; simple materials, contact fallback | Working gameplay and readable hero. This is an emergency state, not an art target |

All new-content detail labels in this table require implementations; they are not aliases for currently available controls. In particular, 30 FPS pacing, separate final-output/AA ownership, hero LOD, material variants and local reflection modes are new work. Current terrain `standard/high/ultra` keys only change whole-sphere tessellation and should be captured separately from proposed near-field terrain LOD.

Do not make “MAX REALISM” equivalent to every enum's last value. VSM softness, stronger bloom, more wind and thicker mist are not monotonically better images. Keep an engineering **all-levers stress preset** if useful, but compare the art-directed Reference Lab separately. Historical 80k scene triangles and 100 draw calls are not enforced on Reference Lab; persistent resource ownership and successful recovery still are.

## Why native resolution needs its own experiment

Pixel cost scales with the square of render DPR. At DPR 3 versus 1.7, the scene contains about **3.11× as many pixels**. This is a pixel-count ratio, not a measured frame-time multiplier. Half-resolution post uses one quarter of the pixels per post target; full post multiplies those targets' pixel count by four.

Illustration only: a 402×874 CSS viewport at DPR 3 contains 3,162,132 pixels. In the current target design, one RGBA16F resolved scene texture uses roughly 24.1 MiB of color storage. A separate 4× multisample color buffer adds roughly 96.5 MiB. Three full-resolution RGBA8 post textures add about 36.2 MiB. That is **approximately 156.8 MiB of color allocations alone**, before depth, shadows, material textures, geometry, driver overhead or browser/compositor storage. The actual viewport, formats, sample support and allocation layout must be recorded on the device.

This is why the new ledger must distinguish color/depth/sample/resolve/shadow storage and retained inactive resources. A resource count or a JS heap reading is not GPU memory. The existing `estimateBloomTargetMb()` is useful as a scoped color estimate but cannot certify a memory ceiling. See [research sources S15–S16](README.md#sources).

## Profile application contract

Persist named profiles with `schemaVersion`, profile revision/hash, content/art revision, renderer backend/version and provenance. Keep the user preference separate from temporary Benchmark/Manual locks. Validate ranges, enums and capability requirements at load. Ignore unknown keys with a diagnostic; do not silently apply half a future profile and mark it complete.

For each key, export **requested → resolved → allocated/configured → actually used on last frame** where applicable. For example, MSAA 4× may resolve to 2×; a target may carry 2× storage but the last frame may have used a direct no-post path. Those are different facts. Export the concrete fallback and reason. Report a pending structural transition until the new scene state has actually rendered.

Apply cheap uniforms immediately through the single settings owner. Apply geometry rebuilds, target changes and shader variants at a controlled boundary, then prewarm/settle and start a new measurement segment. Do not compile a new material on every slider-input event. Avoid holding both complete old/new worlds indefinitely; account for peak overlap during transitions.

Every profile needs round-trip checks: boot → candidate → Shipping Reference; candidate A → B → A; biome change; portrait/landscape; background/resume; context loss/restore; saved-state reload. Compare actual buffers, material modes, cast/receive settings, active effects and grade. Retain a stable “Restore shipping / Exit trial” control outside the main workbench. A reset must restore the content variant too once the bird and world have alternatives.

Reference Lab is session-only. Save the previous validated settings before entry. End the 120-second trial on the next responsive tick unless deliberately extended, and restore automatically after a lost context or failed configuration. Severe unresponsiveness cannot be cured by a JavaScript timer that itself is not running; include reload recovery and do not promise a temperature cap. Browser-visible heat telemetry is unavailable unless a real API is demonstrated.

## Deterministic benchmark routes

Use a world/content seed plus a fixed simulation step, input trace, sun state, weather seed and effect-event trace. A world seed alone is insufficient: the current `freeze()` hook does not actually hold the bird, and the contact sheet runs through changing poses and times. Performance runs must keep relevant animation and gameplay active; a perfectly still art frame is not a flight workload.

| Route | Duration per repeat | Purpose |
|---|---:|---|
| R0 plain start | First load and first 60 seconds | Splash/start, complete environment systems, first shader use and first interaction without an environment-switch workaround |
| R1 forest valley | 90 seconds | Open vista → canopy turn → waterfall/pool skim → climb → perch → takeoff; core visual reference |
| R2 canyon slalom | 90 seconds | Sun-facing rock silhouettes, arch clearance, bank/boost, gate crossing and near-wall camera |
| R3 mountain ridge | 90 seconds | Thin silhouettes against sky, snow motion, distant LOD, fog/readability and pole/high-latitude transition |
| R4 city flight | 90 seconds | Windows at oblique angles, rooftops, material/reflection variation, target contrast |
| R5 turret/combat | 90 seconds minimum, plus full representative waves | Land, aim, fire with multiple live rockets, impact/drone events, repeated target refresh; CPU collision and effect bursts |
| R6 lifecycle | Explicit event list | Repeated biome/profile swaps, rotation, browser chrome resize, hidden tab, phone lock/resume and context restoration |

Place named camera checkpoints with subject bounds and clearance predicates. Save screenshot/short clip plus settings at each. The canyon obstruction caught during this review must become a reproducible checkpoint; avoid “fixing” it only by choosing a prettier camera for the report. Inspect shadow/contact and bank/water intersections with material-ID and normal/depth views when necessary.

Each feature has both an isolated experiment and an integrated route. Initial sweep order: coherent output/PBR environment → bird/terrain representation → near shadows → AA/DPR → water reflection → vegetation/detail → fog/effects. Keep all other parameters fixed, test A/B/A or alternating order, and use at least three repeats. When one feature changes initialization cost, measure both first-use and warm execution.

## Physical iPhone protocol

Record the exact iOS version, browser version, browser tab versus installed app, viewport/native/effective DPR, display cadence, renderer/GL strings if exposed, extensions, render-target formats/sample support, code commit, serving build, service-worker status, seed/route/profile hashes and audio state. Redact any unnecessary identifying data from exports. Run production startup both without an existing service worker and with a prior-version cache.

The authoritative run is Chrome on the specified iPhone. Safari on that same device is a diagnostic comparison, not a substitute. Desktop mobile emulation, Playwright WebKit and SwiftShader can catch structure and rendering failures but cannot qualify phone power or timing. Do not assume the Chrome version identifies the graphics backend; test capabilities. WebGPU needs an actual successful adapter/device/render test, not only a `navigator.gpu` property.

For comparable performance trials, start unplugged at a recorded battery range, stable indoor ambient conditions, the same brightness and the same case. Record Low Power Mode, charging status, ambient conditions and relevant display settings manually where web APIs cannot supply them. Keep instrumentation and audio settings consistent. Disable screen recording and the open workbench during primary timing trials; do a separate visual capture and a diagnostics-on/off comparison. A USB-debug run is supporting evidence because charging and debugging can alter the workload.

First test Reference Lab in short segments to establish the attainable visual target. Then test sustained candidates for **20 minutes**, repeating the route suite without a cooldown in the middle. Compare the initial five minutes with the final five. A separate 30-minute check is appropriate for the eventual default and Cool profile. Repeated trials start after the phone has returned to comparable conditions; do not credit the first profile with a cold device and penalize the next with its residual heat.

Record battery start/end and elapsed time as a coarse observation, not precise power. Record perceived comfort/dimming and optionally an external surface-temperature measurement with location/instrument provenance. Frame slowdown is evidence of reduced delivered performance, not proof of thermal causation: browser load, GC, other apps and charging can confound it. Never present an inferred GPU temperature as a sensor reading.

## Proposed gates

These are **acceptance targets to be confirmed or deliberately amended**, not measured thresholds for the current controller. Keep existing performance-contract provenance and add a gate amendment before changing any frozen comparator.

Let `B = 1000 / targetFPS` and derive delivered-frame metrics from actual presented/rendered frames. A 30 FPS mode must really skip/pacing-limit rendering; changing a label or reporting half the RAF count does not qualify.

| Gate | Proposed requirement |
|---|---|
| Structural | Zero shader failures, unexpected warnings, missing systems, invalid profile keys silently accepted, unrecovered contexts or failed render targets. All five existing mode checks remain successful. |
| Sustained cadence | In each final-five-minute route segment: p95 interval ≤1.15B, p99 ≤1.5B, missed target slots ≤1%. Use one documented missed-slot formula and observed display cadence; revise explicitly if device quantization requires it. |
| Hitches | No unexplained >100 ms steady-flight stall. Keep boundary/loading samples in the export and assess them separately; do not discard arbitrary slow frames as “warmup”. |
| Decline | Final-five-minute p95 no more than 10% worse than the corresponding first-five-minute route, with no breach of the absolute cadence gate. A stable but continuously slow run still fails. |
| Headroom | Where valid GPU or CPU service timings exist, aim initially for p95 below 75% of B for the limiting measured stage. Do not sum overlapping CPU/GPU time or derive either from RAF intervals. If unavailable, use conservative sustained delivered-frame comparisons. |
| Transitions | No gameplay-state reset, stranded control, wrong-size target or repeated oscillation. Structural setting changes either fit their measured boundary budget or are explicitly staged before play. |
| Resource lifecycle | Repeated profile/biome cycles reach a bounded plateau in owned resources. Report retained cache allocations and peak transition memory. No per-cycle growth without a documented bound. |
| Visual | Bird anatomy/contact, terrain-bank continuity, plausible shadows, water attachment, route/target visibility and camera clearance pass at real playing size and in motion. Fine-detail changes must be visible before receiving cost budget. |
| Input/comfort | No changed steering, aim, collision or scoring; no profile-dependent hit/collection outcomes for the same trace. Compare touch response live; quantitative finger-to-photon claims require external high-speed capture. |

The beauty gate is explicit: the rebuilt slice must clearly beat Shipping Reference in bird anatomy, terrain/material character, light/contact and environmental response, without a new obstruction or shimmer problem. Have the art reviewer score named checkpoints against references; record pass/fail and unresolved items rather than invent a percentage “photorealism” score. On profile reduction, preserve these gains before retaining a costly decorative flourish.

## Controller behavior after measurement

Use the existing quality request router and frozen oracle program. Implement the missing adaptive controller only after obtaining device traces and addressing the remaining fixture notes in `G3o.md`. Enable `BIRB_PERF_IMPL=1` when assessing the implementation; the current skipped default run is not acceptance.

Start with bounded profile neighborhoods, not a controller free to permute every knob. Identify whether a change helped at all. Reduce one relevant cost, settle, compare equivalent route segments, and retain or undo it. Upward trials need more stable headroom than downward recovery; temporary probes expire and record their outcome. Do not let Manual or Benchmark adapt behind the operator's back.

For a likely fill-rate limit, first consider expensive reflection/fog update cost and post resolution, then small DPR increments and material sampling. For a CPU/submission limit, reducing DPR may do little: reduce decorative draws/update work or simplify the measured collision path. If timing sources cannot distinguish the cause, label it unknown and run short bounded cost experiments. Preserve hero silhouette, essential contacts and game cues.

Use a slowly changing sustained-performance envelope to avoid repeatedly climbing back into a configuration that just failed after warming. This is a performance-history signal, not a thermal sensor. Allow explicit recovery when capacity returns. Persist only validated preferences/evidence with backend/content versions; invalidate incompatible learning when code, renderer, content, browser or capability fingerprint materially changes.

The final default is the highest-fidelity **nondominated** profile that passes sustained cadence, visual, lifecycle and comfort checks on the primary phone. If Ultra 60 fails and Cinematic 30 wins visually, keep both preferences available; do not silently trade a user's chosen cadence for prettier lighting. If none pass, keep Shipping Reference available and continue the measured rebuild work.
