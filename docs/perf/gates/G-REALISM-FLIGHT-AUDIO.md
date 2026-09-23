# G-REALISM-FLIGHT-AUDIO — hear the air

**Date:** 2026-09-23. **Branch:** `realism/flight-audio` on `e252ca1`.
**Flag:** `?airsound=0` restores the silent game (a Flags-tab switch, "Hear
the air", new **Audio** group). **Decision asked for:** SHIP as the default.
**Not claimed:** anything about the phone. Every number below is the unit
suite or headless Chromium (SwiftShader, `--autoplay-policy=no-user-gesture-required`,
`--mute-audio`), and nobody has LISTENED to any of it.

## What the base was doing

Nothing. `updateWindSound(speed)` was called every frame and was
`/* intentionally no-op */`: the immersion-pass wind bed (a looped mp3 at 0.55
under the music) had been removed because it sat on top of the music all the
time. The flight made no sound at all — not at a sprint, not in a stall, not
on a wingbeat.

## What shipped

`src/audio/flight-audio.js`: procedural aeroacoustics in Web Audio. **No
asset, no GPU, no node created after the first gesture, no JS object
allocated per frame.** One stereo noise buffer (2 s, xorshift32, generated in
the Tap-to-Start gesture) feeds four noise layers through their own loop
offsets and playback rates, plus one oscillator. Five layers, each tied to
something the flight already knows:

| layer | what drives it | the law |
|---|---|---|
| **wind** | measured airspeed | RMS ∝ V^2.5 (trailing-edge noise, power ∝ U^5 — Ffowcs Williams & Hall 1970), band centre ∝ V (constant Strouhal), 400–2000 Hz; noise → Butterworth lowpass at 2× → bandpass Q 0.8 → two slow gust LFOs → level (Farnell, *Designing Sound*, the wind practical) |
| **whistle** | airspeed | the aeolian tone f = 0.2·V/d (Strouhal; the real-time model is Selfridge, Reiss & Avital 2018), d = 1.2 mm; one oscillator with 0.2/0.07 partials at 2f/3f (the drag dipole), 5.3 Hz vibrato; silent below 14 u/s |
| **buffet** | the stunt model's OWN `isStalled()` / `authority()` | low-passed noise (300–460 Hz, phone-speaker audible) under a two-LFO tremolo at 6 → 10 Hz; pre-stall onset at 1.2× the stall speed, 0.55 on the line, 0.7–1.0 stalled |
| **whoosh** | the left wing's `rotation.x`, sampled every frame | a noise band whose envelope is RETRIGGERED (cancel-and-hold, ramp, target) on every real downstroke; level ∝ stroke speed^2.5 |
| **rush** | clearance over ground or water | lowpassed noise, brighter over water, within 9 units and moving |

**Every level is OUTPUT RMS, not a gain.** Filtered white noise keeps only
the share of its energy inside the band — a 1 kHz band at Q 0.8 keeps ~17% of
the RMS — and the share moves with the band, so each layer carries a makeup
from its filter's equivalent noise bandwidth ((π/2)·f/Q for the bandpass,
1.11·fc for the Butterworth lowpass). That is what makes `windGain` 0.0585
mean 0.0585 RMS at the master, and what lets the realism check compare the
controller's claim with an analyser.

**Airspeed is MEASURED**, not read: `|Δposition| / Δt` of the flight
controller, every frame. There is no wind in this world, so ground speed is
airspeed; it includes the sink, the knockdown fall, the launch boost and the
nest auto-fly, identically for classic, stunt and v2. A jump faster than 120
u/s is a teleport or a restored pose and reads as no sample. At the top of a
hammerhead it reads **2.4** — forward speed against sink — so the wind goes
quiet exactly where the figure goes still.

**The whoosh follows whatever pose code runs.** `createDownstrokeDetector`
reads the angle the rig actually left on `leftWing.rotation.x` (a POSITIVE
rotation sends that wing's tip down) with hysteresis: it arms on an upstroke
faster than 1.0 rad/s, a downstroke faster than 1.5 starts a stroke, and the
stroke fires ONCE at its velocity peak with that peak as its strength; a jump
faster than 60 rad/s is a discontinuity and disarms. The detector is called
at the old `updateWindSound` site, which runs before the flight tick, so it
reads LAST frame's pose with last frame's `delta` — with the peak, two frames
(33 ms at 60 fps) behind the wing, and no edit to the pose block (which
another package owns).

**Lifecycle.** Built in the Tap-to-Start gesture (`beginGame`), re-armed by
every later gesture (iOS resumes an interrupted context only inside one).
Faded and suspended on a hidden tab, on the gear button's pause and on a lost
GL context — each says so explicitly — and woken by the next FRAME, which is
what "the game is running" means. A frame-counting watchdog (1 Hz, two quiet
checks) suspends a loop that stopped without saying so. The player's master
slider and SFX switch reach it live through `updateAllSoundVolumes`; SFX off
suspends the context and releases the audio session. On iOS the session is
set to `'playback'` while there is something to play — HTML Audio (the music,
every effect) already ignores the silent switch, and without this the wind
would be the one sound the switch silenced. Feature-detected, never thrown,
and reported by the probe (`sessionType`), because inside Chrome-on-iOS's
WKWebView it is unknown. The Ring Rush chime now shares the one context.

`__BIRB.flightAudio()` → `{ state, windGain, windFreq, whistleGain,
whistleFreq, buffet, stalled, rush, whooshCount, downstrokes, speed, volume,
sessionType, suspendReason, modelStalled, boosting, … }`;
`__BIRB.flightAudio({ measure: true, toneHz })` adds what actually comes out:
RMS and spectral centroid from an analyser on the master's LEFT channel (the
analyser otherwise down-mixes decorrelated stereo noise to mono and reads it
3 dB low), and how far a tone stands above the noise around it.

## The numbers

`node tools/birb-realism.mjs --only flight-audio-air,flight-audio-lifecycle,flight-audio-off,flight-audio-start-while-loading`
— **42/42** on the final tree, both boots console-clean. The live table
(master 0.7, output averaged over eight 93 ms analyser reads; the ranges are
the last four runs — the wind gusts on two slow LFOs, so any one window
moves):

| state | airspeed | windGain @ Hz | whistle | buffet | output RMS (claimed ×) | centroid |
|---|---|---|---|---|---|---|
| idle-throttle glide | 6.57–6.59 | 0.0023 @ 493 | 0 | 0.145–0.161 | 0.0086–0.0106 | 246–285 Hz |
| cruise | 11.0 | 0.00831 @ 825 | 0 | 0 | 0.0052–0.0068 (×0.89–1.17) | 1000–1020 Hz |
| sprint (`setSprint`) | 24.0 | 0.0585 @ 1800 | 0.0145 @ 4000 Hz | 0 | 0.0363–0.0397 (×0.86–0.94) | 2269–2330 Hz |

- **Cruise → sprint: ×7.0 in wind level (+17 dB), ×5.8–7.0 at the output,
  the centroid up 2.3×.** The idle glide is louder than cruise at the output
  and that is the design: at 0.55 throttle the bird settles at ~1.1× the
  stall speed, which is where a stall warner speaks, and its ~260 Hz centroid
  is the pre-stall buffet, not the wind.
- **The whistle stands +13.0 to +14.9 dB over the wind around it at a
  sprint** (+16.5 on the first run), and is exactly 0 at and below cruise.
- **Whoosh**: 8 beats forced through `flapPhase()` → **8 whooshes**; a wing
  held still → **0**; the rig's own beat under a held climb stick → **5
  whooshes for 5 downstrokes in 90 frames**, loudest 0.0017–0.0023 RMS — traced
  frame by frame, this rig's strokes there peak at **3.16 rad/s**. (On this
  base the rig beats only its IDLE stroke under a climb — it reads the raw
  stick; see `flap-follows-climb` and G-REALISM-AERO-POSE. The whoosh follows
  whichever stroke runs; this rig's own full climbing stroke is 18.9 rad/s by
  its `wingBeat()` formula, 4.8× the idle one, which at V^2.5 puts the whoosh
  at its 0.05 cap.)
- **Stall**: nose ~83° up, idle throttle, hands off — the stunt model
  reported a stall on **54–56 of 120 frames**, airspeed bottomed at **2.39**,
  buffet peaked at **0.962**. Level cruise: 0.
- **A boost is not a stall** — the controller reported a stall on **6–7 of
  the boost's 12 frames**; the buffet stayed **0**.
- **Lifecycle, through the game's own controls**: slider 70 → 30 reaches
  `volume` 0.3 live; SFX off → suspended (`muted`) and a frame does not wake
  it; on again → running; gear → suspended (`paused`); close → the next frame
  resumes it; hidden → suspended (`hidden`); visible → running.
- **`?airsound=0`**: the module is never fetched (resource timing: 0 of 57
  modules), the hook reports `off`, and every index.html hook is a no-op.
- **Cost, measured on the live page** (CDP, 300 frames, stick/sprint/flap
  varied, three runs on a box shared with another build):
  **24.6–35.9 µs of main-thread JS per frame** for the whole path, 1.9–2.9%
  of `renderFrame`'s JS (SwiftShader's GPU time is not in that figure) — the
  largest single items are the Web Audio automation calls and the terrain
  sample for the rush (every fourth frame). Allocation (CDP sampling heap
  profiler, 32-byte interval, 240 frames, three runs): **1.2–2.0 KB**
  attributed to the path against the frame's 138–144 KB (0.9–1.4%) — every
  sampled byte is V8 boxing a double across the Web Audio binding, in the
  rarely-called whoosh trigger's interpreter tier, or the 1 Hz watchdog's own
  call; no object, array or closure. Before the watchdog counted frames it
  read the clock every frame and sampled **10.4 KB**.
- Unit suite: `tests/flight-audio.test.js`, **38 tests** — the mappings'
  properties, the makeups against a real cookbook biquad run over real noise,
  the detector (one fire per cycle at 20/60/144 fps, one per beat of the rig's
  own `wingBeat()`, none below threshold, none on a drift or a jump), and the
  graph against an injected AudioContext: **no node created in 3,000 frames
  and ~200 beats**, a tap cannot wake a paused game, the watchdog, the
  session, `unavailable` without Web Audio.
- `node tools/birb-modes.mjs`: all 5 modes ok, exit 0 (fails on any console
  warning). `node tools/birb-default.mjs` (the Ultra production default),
  `birb-shot --start`, `birb-walk` and `birb-stunt` (41/41): all exit 0.
  `birb-flight-v2` (`?flight=v2`, not the default) fails ONE ground-contact
  check per run — and fails it on the base `e252ca1` too: base run, the
  upright landing read as a crash; this branch, once the inverted contact
  read as a landing and once the upright one as a crash. Pre-existing
  nondeterminism in a flagged model, and nothing here writes flight state.

## The start button was losing taps — and it looked like "did not load"

Found on the way through the Tap-to-Start path this package owns. The Start
button is wired near the TOP of the module script and its first act was
`unlockAudio()` — a `const` declared AFTER the module's import awaits. Held
three.js's core module in flight for 12 s and tapped Start on the Title
(reachable in ~1.5 s by tapping through the splashes):

| | base `e252ca1` | this branch |
|---|---|---|
| the tap | **throws** `Cannot access 'unlockAudio' before initialization` | queued: button reads **Loading…**, disabled |
| boot watchdog `reason` | **the ReferenceError** | empty |
| 40 s later (module ready at 13.6 s) | **title still up, "Tap to Start"** — the game never started | started by itself, title gone |

So a tap during the download was silently lost — the handler died before its
own "scene still loading" branch — and the ReferenceError sat in the boot
watchdog's `reason`, so a second tap before the load finished, or a load
slower than 25 s, would have put up **"The game did not finish loading"**
over a game that was loading fine. That is the shape of CLAUDE.md's "Hitting
start doesn't start", which was never reproduced because nobody tapped during
the download. The fix is one guard (`try { unlockAudio(); } catch {}`); the
pending path does the rest, and the audio unlocks on the next tap.
**This fix is NOT behind `?airsound`** — `?airsound=0` restores the silent
game, not a crash. `flight-audio-start-while-loading` holds the download and
asserts the queued start, the empty `reason` and the self-start.

## Traps, each of which cost a round

1. **A whistle inside the wind is present in the graph and absent in the
   ear.** At a 2 mm shaft the tone sat at 2.4 kHz inside a 1.8 kHz band; a
   critical-band estimate put it ~8 dB under the noise it had to beat. 1.2 mm
   (a primary's distal rachis) puts it at 4.0 kHz, above the wind's lowpass,
   where it measures +13 to +16.5 dB. A unit test now requires the whistle
   above the wind band at every speed it sounds.
2. **The lowpass above the band ate 25% of the wind.** The bandpass makeup
   alone left the chain at 0.75 of its claimed RMS; `lowpassedBandShare`
   integrates the two analog responses once (0.751 at Q 0.8, ratio 2) and the
   test runs the actual cascade over real noise.
3. **Web Audio reads a lowpass Q in DECIBELS.** Butterworth is −3.01, not
   0.707; the default of 1 is a 1 dB resonant bump on every layer.
4. **The controller's stall test measures against the BOOSTED target.** A
   boost moves the energy target to 2.4× cruise, so for its first few frames
   the stunt model reports a stall at 11 of 26.4. Gated on the target, not on
   `boostTimer`: the target is written before the timer is decremented, so a
   timer gate leaked the frame after every boost as a 0.046 buffet (caught by
   the check, not by review). The same quirk moves the PHYSICS — the stunt
   model's `liftFactor()` is normalised by the boosted cruise too, so a boost
   reads as low lift and SINKS the bird. Measured from a level start, twice
   each: a tap on the pill loses **1.41 and 1.55 units** of altitude over the
   next 1.2 s of sim time, against **+0.01 and +0.02** without. Not this
   package's to fix; recorded for whoever owns the flight model.
5. **A tap must not wake a paused game.** The gear button pauses, and its
   own tap then bubbles to the page's unlock listener — which resumed the
   context of a paused game. A gesture now resumes only what the OS stopped;
   the game's own pauses are lifted by the next frame.
6. **Onset at 1.28× the stall speed buffeted ordinary steep climbs.** Against
   G-STUNT-1's climb table a 55–60° climb would have shuddered. 1.2× is
   silent through 55°, light at 60°, the stall at 70°. A test pins the 50°
   climb (authority 0.70) at zero — "it stalls too much", in sound form.
7. **`touchstart` is not a user activation.** Creating a context there logs
   a Chrome warning and leaves it suspended; `unlock()` reads
   `navigator.userActivation` and waits for a gesture that counts.
8. **An analyser has heard nothing the moment it is connected.** The first
   read is zeros and would have measured "silent"; it says `fresh` now.
9. **A whoosh that fires at the threshold does not know how hard the stroke
   is.** The first detector fired on the crossing — by construction early in
   the stroke — and patched the level with a decaying memory of earlier
   strokes. Run on three seconds of 9.4 rad/s strokes followed by 2.83 rad/s
   ones, it reported the slow strokes as **5.68, 3.28** and then settled
   UNDER them at **1.99** (the crossing value): wrong both ways. It fires at
   the stroke's own sampled PEAK now — **2.78** on every stroke of the same
   input — which needs no memory and is where the air is loudest anyway. The
   first version of THAT returned on the firing sample without letting it
   arm, and at 20 fps a 6 Hz beat's firing sample is already the next
   upstroke: 21 fires for 30 beats, caught by the unit test's 20 fps row.
   (And one false lead worth recording: a live "loudest whoosh" of 0.012 in
   the climb looked like the memory inflating this rig's 3.9 rad/s idle
   beat. It was the check reading `whooshLast`, which still held the last
   FORCED beat — traced frame by frame, the climb's own strokes peak at
   3.16 rad/s. The check now counts only whooshes that happen in its window.)
10. **A clock read per frame is an allocation per frame.** The idle watchdog
   compared `performance.now()` against a per-frame timestamp; it counts
   frames now, and the per-frame path reads no DOM (the `document.hidden`
   check was 1.3 µs of the 25).

## Not verified

- **The phone, all of it.** The iOS gesture rule (headless runs with autoplay
  allowed), the silent switch and whether `navigator.audioSession` exists in
  Chrome-on-iOS's WKWebView (`__BIRB.flightAudio().sessionType` reports it),
  and whether a programmatic `resume()` after the game's own pause works
  there without a gesture (if not, the next touch resumes it).
- **The mix, by ear.** It is set by measurement against the game's own
  tracks, decoded and scaled exactly as `getEffectiveVolume` plays them
  (master 0.7): the music averages **0.0259 RMS** (its quietest tenth of
  seconds 0.0099), the rocket 0.0239, the ring chime 0.0352. Against that the
  wind is **0.005–0.007 at cruise — 12–14 dB under the music**, 3–6 dB under
  its quietest passages — **0.036–0.040 at a sprint (+3 to +4 dB over it)**, a full stall
  buffet ~0.054 (+6 dB) and a capped whoosh 0.035. The wind bed that came out
  before was removed for sitting on the music; this one is a texture under it
  until the flight does something, but nobody has listened to it, and a phone
  speaker loses everything under ~300 Hz. `?airsound=0` and the SFX switch are
  the controls.
- **CPU, battery and Safari's automation timeline** under per-frame
  `setTargetAtTime` (sent only when a target moves by more than 0.4–1%).
- **The air field.** If gusts land, airspeed is `|v_bird − v_air|`, not the
  measured ground speed `updateFlightAudio` uses today.
