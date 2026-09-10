# Research handoff and validation record

Read [the executive decisions](README.md), then [the build order](BUILD_BACKLOG.md) and [the profile protocol](PROFILES.md). The [profile proposal](profiles.proposed.json) supplies versioned starting candidates for builders; it is not executable configuration for the current game.

## Repository provenance

- Repository: `Mentis123/birb`, root mobile game.
- Review date: 10 September 2026.
- Remote main fetched and fast-forwarded before review: `f3f7c171e1ade34057c89929f8193ca600431815`.
- Remote main fetched again before finalization: unchanged at the same commit.
- Research branch: `docs/iphone-realism-research`.
- Primary device requested by the owner: iPhone 16 Pro, Chrome **152.0.7977.64**. iOS version and physical-device measurements remain unrecorded.
- Runtime/source/test changes in this handoff: none. Changes are this research/evidence package plus entry-point and stale-grade notices.

## Validation actually performed

| Check | Result and boundary |
|---|---|
| Unit baseline | `node --test --test-isolation=none`: 633 total, 423 passed, 210 skipped, zero failed. The default skip state includes future adaptive/learning work. |
| Existing contact-sheet harness | `node tools/birb-sheet.mjs --out ../review-contact-sheet.png --dpr 1 --settle 600`: exit 0, eight flight/perch views. Windows Chromium/SwiftShader, mobile viewport, tier 0 pinned. Scene counts are view-specific. |
| Additional composition observations | Four mobile-viewport captures via the existing server/start/CDN helpers, seed 16160, tier 0 pinned, sun motion disabled; Windows Chromium without the harness's forced SwiftShader arguments. Four snapshots, zero collected page/console warnings/errors. The backend was not separately identified, so no hardware-performance inference is made. |
| Official mode harness | `node tools/birb-modes.mjs` attempted twice; both hit `page.click: Timeout 5000ms exceeded` on the title Start button before the mode loop. Inconclusive local environment result, not scored as a gameplay pass. |
| Document links/JSON | Local report links resolve; JSON parses, has unique profile IDs, uses the corrected browser version, and explicitly contains no qualified profile or selected default. |
| Protected oracles | All 58 manifest-listed paths unchanged against reviewed main. No threshold, fixture or oracle was edited. This is a Git change check, not a claim that every historical manifest hash was revalidated. |
| Whitespace | `git diff --check` passed before commit. |

Evidence is in [the evidence folder](evidence/manifest.json): the contact sheet, four single-biome frames and raw telemetry, with SHA-256 hashes. The single-biome snapshots are composition observations, not matched motion A/B benchmarks. The world seed pins generation after the next rebuild, but camera/animation progression during these captures is not a deterministic input replay. The proposed protocol explicitly closes that gap.

The saved contact sheet includes bad views because they are findings: a foreground-dominated canyon frame and an obstructed mountain perch frame. The harness's successful exit is retained alongside those limitations rather than being presented as visual acceptance.

## Outstanding implementation gates

1. Reproduce and resolve camera/subject visibility failures with named deterministic views; obtain a clean mode-harness baseline in a suitable environment.
2. Build the maximum-quality forest-river reference and its proposed bird/terrain/material systems.
3. Implement actual profile loading/rollback, independent AA/output ownership and 30 FPS pacing.
4. Qualify the profile candidates on the actual phone, including sustained sessions and lifecycle transitions.
5. Implement the replacement adaptive controller under its implementation-enabled tests and the existing performance contract.

This handoff completes research and executive planning. None of these future build gates is claimed complete by committing it.
