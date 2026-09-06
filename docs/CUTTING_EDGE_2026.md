# What is actually new for a mobile web game, September 2026

Research pass at the owner's request, after the visual upgrade sessions. This
is recommendations, not work. Everything here was checked against a current
source; where sources disagree it says so. Ranked for THIS game: Three.js
0.183.2, vanilla ES modules, no build step, zero downloaded assets, iPhone 12+
and Android Chrome first, desktop for testing only.

The frame that keeps this honest: over the last sessions, the single largest
visual change was one enum (tone mapping), and every geometry or overlay
effort failed on measurement. New platform capability is worth having only
where it feeds light, colour or feel — not polygons.

## The platform, as it stands

| Fact | Consequence for Birb |
|---|---|
| WebGPU ships on by default in Safari 26 (iOS, iPadOS, macOS, visionOS), Chrome, Edge, Firefox. Roughly 82% of global users, ~70% of mobile devices in use. | A real option for the first time. Not an upgrade by itself (see below). |
| Apple gates WebGPU by OS version (iOS 26), and iOS 26 runs on A13 and later — iPhone 11 up. One secondary source claims iPhone 15 Pro or later; the WebKit release notes name no hardware floor. | Your iPhone 12+ target is inside the line on the authoritative reading. **Verify on the iPhone 12 before relying on it.** |
| Three.js `WebGPURenderer` falls back to WebGL 2 automatically. TSL compiles to both WGSL and GLSL. The legacy `EffectComposer` does NOT run on `WebGPURenderer`; r183's `RenderPipeline` replaces it and runs on both. | Migration is close to a one-line renderer swap EXCEPT for custom GLSL, and this game has three `onBeforeCompile` injections (foliage wind, water ripple, water specular) that must be rewritten in TSL. |
| iOS Safari caps `requestAnimationFrame` at ~60 Hz by default. 120 Hz exists only behind a user-toggled feature flag, and not in WKWebView at all. | **60 fps is the ceiling on iOS for every player you will ever have.** Do not design for 120. Delta-time correctness matters more than ever because Android does not cap. |
| Apple never implemented the Vibration API. Web haptics on iOS work only through the `<input type="checkbox" switch>` trick, and **iOS 26.5 closed programmatic re-triggering**: multi-tick patterns now fire their first tick only; single ticks still work from a trusted tap. | This repo's `triggerHaptic` uses exactly that trick. On iOS 26.5+ any multi-pulse pattern collapses to one pulse. Nothing crashes; it just gets quieter. Test it. |
| iOS 26: every site added to the Home Screen opens as a web app, no manifest required. | Install-to-home-screen friction is gone. The existing manifest and icons still matter for the name and icon, not for the behaviour. |
| Safari 26.0 adds HDR images and `display-p3` canvas. 26.2 adds Event Timing (input-to-paint latency) in Web Inspector. | HDR is irrelevant to a generated-in-code game. Event Timing is directly useful for measuring stick latency on a real device. |
| pmndrs/postprocessing merges multiple effects into ONE fragment shader over one full-screen triangle; Three's own `EffectComposer` stacks a full-screen pass per effect. | If bloom or grading ever ships, it ships as one merged pass or not at all. Stacked passes are how mobile post-processing dies. |
| Web-native distribution is a real trend again: no store cut, Stripe/Paddle/itch flows work in-browser, WebGPU indie games are a 2026 thing. | Nothing to build. Reassurance that the artefact's platform choice is the right one. |

## Recommendations, ranked

### Do now — no phone measurement needed

1. **Assume 60 fps on iOS and make it flawless there.** Every timing path must be delta-time correct (the frame sampler already is; check the flap and tumble oscillators when item 3 of the build plan lands). Frame pacing beats frame rate on a capped platform.

2. **Verify haptics on iOS 26.5.** One tap on a real device. If the multi-tick patterns are gone, reduce every pattern to a single well-timed tick rather than adding a library — the repo is zero-dependency, and the surviving approach is the same switch overlay you already have, gated on a trusted tap.

3. **Use Event Timing on the phone benchmark.** When the outstanding benchmark finally happens, Safari 26.2's Web Inspector now shows input-to-paint latency directly. Capture it alongside frame time; a laggy stick is a worse feel problem than a dropped frame.

4. **Everything in the build plan's section 14, items 1-4.** Ground shader pass, sun drift, flap realism, per-biome grade. None of it needs new platform capability, all of it is where the measured payoff is.

### Do after the phone benchmark — fill-rate items

5. **Emissives, then half-resolution bloom as ONE merged pass.** The classic cinematic cue, ~75% fewer fragment invocations at half res. pmndrs/postprocessing is the right shape (merged effects, single triangle) but it is a dependency; the alternative is a hand-written single pass, which fits the house rules better. Tier 0 only, first thing tier 1 sheds.

6. **A single grade + vignette pass**, folded into the same shader as 5. Never a second pass.

### Plan for, do not start

7. **WebGPU migration, as an enabler.** It is real now and it will eventually unlock things WebGL cannot afford on a phone (compute-driven particles, cheaper post). But: three GLSL injections to rewrite in TSL; `RenderPipeline` instead of `EffectComposer`; a device-tested branch, never a blind merge; and on its own it changes nothing a player sees. The honest sequencing is: do the ground shader pass in GLSL now, and treat "rewrite it in TSL" as the first task of a WebGPU branch, because TSL is the cost of the migration and that pass would become injection number four.

8. **Frame-rate independence for Android's uncapped rAF.** When Android phones run at 90 or 120 Hz, anything not delta-time correct runs fast. Worth an audit before the flap work, not after.

### Do not

- **SSAO/GTAO, SSR, depth of field, volumetrics.** Fill-rate bound on a fill-rate-bound device. Unchanged.
- **Environment maps.** Measured invisible on Lambert (build plan, fourth pass).
- **Instance sectors.** Measured worse (build plan, section 7).
- **HDR output, display-p3 canvas.** Nothing here is an image; the palette is authored in sRGB and the gain would be invisible on the target phones.
- **Compute shaders / GPGPU particles.** Real under WebGPU, but this game's particle budget is a 6-slot pool by design. Solving a problem it does not have.
- **A 120 Hz target.** Not reachable on iOS without the user toggling a feature flag.
- **Adding a haptics library.** The surviving technique is the one already in the repo.

## The one thing that has not changed

Every fill-rate recommendation above is gated on the same phone benchmark it
was gated on three sessions ago. Adaptive quality is live now, so that
measurement will also tell you whether the 55/58 fps thresholds are right on
a platform that caps at 60. Get the number.

## Sources

- [WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- [WebKit Features for Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/)
- [WebGPU in iOS 26 (App Developer Magazine — the iPhone 15 Pro claim)](https://appdevelopermagazine.com/webgpu-in-ios-26/)
- [iOS 26 compatibility — A13 and later (TechRadar)](https://www.techradar.com/phones/iphone/ios-26-and-ipados-26-compatibility-explained-which-models-are-supported)
- [WebGPU browser support 2026](https://webo360solutions.com/blog/webgpu-browser-support/)
- [WebGPU and the return of browser indie games (StraySpark)](https://www.strayspark.studio/blog/webgpu-browser-indie-games-2026)
- [Migrate Three.js to WebGPU 2026 checklist](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [Three.js post-processing in 2026](https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026)
- [Three.js in production 2026 (AppScale)](https://appscale.blog/en/blog/threejs-production-3d-web-2026-webgpu-realtime-standards)
- [pmndrs/postprocessing — Effect Merging](https://github.com/pmndrs/postprocessing/wiki/Effect-Merging)
- [Unlock 120 fps browsing in Safari (iDownloadBlog)](https://www.idownloadblog.com/2026/05/04/120fps-browsing-safari/)
- [WebKit bug 173434 — 120Hz requestAnimationFrame](https://bugs.webkit.org/show_bug.cgi?id=173434)
- [Web haptics that survive iOS 26.5 (@haptics)](https://haptics.kushagragolash.dev/)
- [MDN compat data issue — navigator.vibrate on iOS](https://github.com/mdn/browser-compat-data/issues/29166)
- [Why PWAs in 2026 (DEV)](https://dev.to/dhruvjoshi9/why-pwas-are-the-future-of-mobile-web-experience-in-2026-1j7a)
