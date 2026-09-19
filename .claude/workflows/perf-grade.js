export const meta = {
  name: 'perf-grade',
  description: 'Per-biome colour grade: give each environment its own tone curve and exposure, generate candidate sheets, and let the owner pick on real glass',
  whenToUse: 'The last visual item that needs a human eye. Agents build the system and the candidates; the owner chooses.',
  phases: [
    { title: 'System', detail: 'Per-biome grade block, applied on environment switch, default identical to today' },
    { title: 'Candidates', detail: 'Contact sheets per biome — same pose, same sun, only the grade varies' },
    { title: 'Gate', detail: 'Default untouched, grades real, and the owner can actually choose on a phone' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Branch claude/ultracode-sub-agents-plan-c9qmba.
Waves 0-3A and Ascend are merged and live. The three-finger workbench works on the production path.

READ FIRST:
  docs/VISUAL_UPGRADE_BUILD_PLAN.md §16.10 — "Per-biome colour grade. Still needs an owner on a real
    phone; the tools to generate the candidates exist." This wave is that item.
  tools/birb-lighting.mjs — the existing candidate-sheet tool. It holds camera, world and bird
    COMPLETELY still and varies ONLY lighting between tiles, because anything else moving between
    two frames makes the comparison worthless. Reuse it; do not write a second one.
  src/environment/world-shell.js ENVIRONMENT_VARIANTS (line ~624)
  docs/perf/CONTRACT.md §7 precedence, §3.1 sentinels, §11 names

THE GAP, measured before this wave was written:
  index.html:4268  renderer.toneMapping = THREE.NeutralToneMapping
  index.html:4269  renderer.toneMappingExposure = 1.12
Both are set ONCE, globally. Zero environment variants define a tone or an exposure — confirmed by
grep. So a cool forest dawn, a hot canyon, a snow mountain and a dusk city all share one tone curve
and one exposure. Meanwhile each variant ALREADY carries a rich per-biome light rig (ambient / key /
rim / fill / glow) plus its own sky, fog, haze and ground colours. The lights are graded; the curve
that sits on top of them is not.

WHY THIS IS WORTH DOING AT ALL. CLAUDE.md records that in an earlier session ONE ENUM — tone
mapping — was the largest visual change of the entire session, and that every geometry and overlay
effort that session failed. This is the cheapest cinematic lever in the engine: one enum, one float,
zero per-frame cost, no new draw call, no new geometry.

THE INTERACTION THAT WILL BITE YOU, and it is documented in CLAUDE.md:
  "The bright pass thresholds the TONE-MAPPED frame and Neutral tone mapping preserves hue, so a
   forest ring at three times its brightness still lands at 0.79 against a 0.78 knee and
   contributes nothing."
Changing the tone curve per biome CHANGES WHAT BLOOMS. ACES pushes highlights toward white and will
cross the bloom knee where Neutral does not; AgX holds saturation and may cross it less. A grade
that silently turns the drone rings and slalom gates into either headlights or concrete is a
regression wearing an art department's clothes. If a biome's grade needs its own bloom threshold to
stay coherent, the grade block carries that too — and you must MEASURE it, not assume.

THE INVARIANT: the shipping default does not move until the owner picks a grade. Every biome's
default grade is exactly Neutral / 1.12 — today's global values — so a player who never opens the
workbench sees precisely what they see now. The grade system ships; the grades themselves are a
human decision this wave PREPARES rather than makes.

TRAPS: a shader that fails to compile draws NOTHING while the page still paints (tools/birb-shaders.mjs
is the guard, all four biomes). tools/birb-modes.mjs treats console warnings as failures. Zero
allocation per frame. 58 files in tools/oracle-manifest.txt are frozen. R6: under SwiftShader a
frame time is not a device claim — and a COLOUR is not a device claim either, because the harness
renders on a different display pipeline than the owner's phone.

VERIFY, capture exit codes, never pipe a harness into grep:
  npm test                                # 419 pass / 0 fail
  node tools/birb-shaders.mjs             # every material, every biome
  node tools/birb-modes.mjs               # warnings are failures
  node tools/birb-quality.mjs --check all # 12/12
  sha256sum -c tools/oracle-manifest.txt`

const OUT = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    defaultUnchanged: { type: 'boolean', description: 'MUST be true — every biome defaults to Neutral/1.12' },
    measured: { type: 'string', description: 'the measurement proving the grade actually changes the frame, with numbers' },
    bloomInteraction: { type: 'string', description: 'what changing the tone curve did to what crosses the bloom knee — MEASURED, not assumed' },
    harnessResults: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'summary', 'defaultUnchanged', 'measured', 'bloomInteraction', 'harnessResults', 'deviations'],
}

phase('System')

const system = await agent(
`${REPO}

TASK — the per-biome grade SYSTEM. You own src/environment/world-shell.js and the grade plumbing in
index.html. Do not build the candidate sheets or the panel UI; other agents own those.

1. Add a \`grade\` block to every entry of ENVIRONMENT_VARIANTS:
     grade: { tone: 'neutral', exposure: 1.12, bloomThreshold: <today's value> }
   Defaults are EXACTLY today's global values for all four biomes, so this change alone is a no-op
   on screen. Prove that: a frame captured before and after your change, same seed and pose, must be
   pixel-identical or explain any difference.

2. Apply the grade on setEnvironment(), and make it survive an environment switch — the switch
   rebuilds meshes and this repo has a recorded history of settings that quietly do not survive it.

3. Respect CONTRACT §7.1 precedence. A panel-requested tone/exposure OUTRANKS the biome's grade and
   must not be clobbered when the biome re-applies. The plan is explicit that the Look controls are
   artistic choices Auto never touches — the adaptive tier must never write these.

4. Expose the grade through the existing __BIRB.setLighting surface (which already resolves
   aces/agx/neutral) and report the ACTIVE biome's grade in the quality export, so a capture records
   the grade it was taken under. A screenshot that does not say what grade produced it is not
   evidence.

5. MEASURE THE BLOOM INTERACTION. Set a biome to ACES, then AgX, and measure what crosses the bright
   knee — __BIRB.setBloom({view:1}) renders the bright buffer for exactly this purpose. Report mean
   pixel of the bright buffer under each curve. If a curve needs its own threshold to keep the rings
   readable, that is what bloomThreshold in the grade block is for. This is the single most likely
   way this wave breaks something visible.`,
  { label: 'grade-system', phase: 'System', model: 'sonnet', effort: 'high', schema: OUT })

log(`System: ${system?.defaultUnchanged ? 'default unchanged' : 'DEFAULT MOVED — problem'}`)

phase('Candidates')

const CAND = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    sheets: { type: 'array', items: { type: 'string' }, description: 'the contact sheets produced, by path' },
    variants: { type: 'array', items: { type: 'string' }, description: 'the candidate grades rendered, per biome' },
    howToChoose: { type: 'string', description: 'exactly what the owner does on the phone to pick one and hand the answer back' },
    harnessResults: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'sheets', 'variants', 'howToChoose', 'harnessResults', 'deviations'],
}

const cands = (await parallel([
  () => agent(`${REPO}

The grade system now exists:
${system?.summary ?? '(system task failed — say so and work from ENVIRONMENT_VARIANTS directly)'}

TASK — CANDIDATE SHEETS, one per biome. Extend tools/birb-lighting.mjs (do NOT write a second tool).

For EACH of forest, canyons, mountain, city, render a contact sheet where the camera, the world, the
bird, the seed and the SUN TIME are held completely still and ONLY the grade varies. The sun matters
and is not decoration: the game runs a ten-minute sun cycle, so two tiles captured a minute apart are
lit differently and the comparison is worthless. Pin it.

Candidates per biome — each a single coherent intent, not one slider nudged:
  - current (Neutral 1.12) — MUST be first and MUST be untouched. A comparison with no status quo in
    it cannot tell you whether a change is an improvement.
  - AgX at a couple of exposures — holds saturation in highlights where Neutral flattens
  - ACES at a couple of exposures — more contrast, pushes highlights toward white
  - one deliberately warm and one deliberately cool exposure/tint pairing suited to that biome's
    existing light rig (the forest is a cool dawn, the canyons hot, the mountain pale and cold, the
    city dusk — read their ambient/key/rim colours and pick candidates that AMPLIFY the intent
    already in the rig rather than fighting it)

Label every tile with its grade in the image itself. An unlabelled tile is unusable evidence: the
owner will be looking at this on a phone and cannot hover.

Write the sheets to docs/visual-upgrade/. Also write a short docs/visual-upgrade/GRADE-CHOICE.md
telling the owner exactly what to do: which URL, which control, and what to send back so a chosen
grade can be committed. That instruction is the deliverable — a sheet nobody knows how to act on is
a picture.`,
    { label: 'grade-sheets', phase: 'Candidates', model: 'sonnet', effort: 'high', schema: CAND }),

  () => agent(`${REPO}

The grade system now exists:
${system?.summary ?? '(system task failed — say so)'}

TASK — the PANEL side, so the owner can judge on real glass rather than on a contact sheet rendered
by SwiftShader on a different display pipeline. You own src/ui/dev-quality-panel.js.

In the Look view, add a GRADE section:
  - Tone: Neutral / AgX / ACES  (the three __BIRB.setLighting already resolves)
  - Exposure: a slider around today's 1.12, wide enough to be useful (roughly 0.7 to 1.8)
  - Bloom threshold, if the system task put one in the grade block
  - A "next candidate" control that CYCLES the same candidate list the sheets use, so what the owner
    sees on the phone and what they see on the sheet are the same set. Show the candidate's NAME.
  - "Copy grade" — puts the current biome's grade on the clipboard as a JSON line the owner can
    paste straight back into a message. This is how the choice gets home; without it the owner is
    reading numbers off a phone screen and retyping them.

Everything routes through quality-settings like the existing controls (CONTRACT §7.1), appears in the
evidence export, and is per-BIOME: switching environment shows that biome's grade, and a grade chosen
for the forest must not follow you to the city.

Mobile-first. This is operated by a thumb, in flight, outdoors, possibly in sunlight.`,
    { label: 'grade-panel', phase: 'Candidates', model: 'sonnet', effort: 'high', schema: CAND }),
])).filter(Boolean)

phase('Gate')

const GATE = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    defaultUntouched: { type: 'boolean' },
    gradeIsReal: { type: 'boolean', description: 'does changing the grade measurably change the frame?' },
    perBiome: { type: 'boolean', description: 'does a grade stay with its biome across a switch?' },
    ownerCanChoose: { type: 'boolean', description: 'sheets exist, labelled, and there is a written path from "I like tile 3" to a committed grade' },
    bloomStillReadable: { type: 'string', description: 'what happens to the drone rings and slalom gates under each candidate curve — MEASURED' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reason', 'defaultUntouched', 'gradeIsReal', 'perBiome', 'ownerCanChoose', 'bloomStillReadable', 'blockers'],
}

const gate = await agent(
`${REPO}

You are the GRADE GATE. Write docs/perf/gates/G-GRADE.md, first line exactly 'VERDICT: PASS' or
'VERDICT: STOP — <reason>'. Measure; do not read the agents' reports.

1. THE DEFAULT IS UNTOUCHED. A load with no panel interaction must render exactly what main rendered
   before this wave: same tone enum, same exposure, same bloom threshold, per biome. Capture and
   compare. Any drift is a STOP — the grades are a decision the owner has not made yet.
2. THE GRADE IS REAL. Changing tone or exposure must measurably change the frame. Mean pixel value of
   the same pinned pose under Neutral vs ACES vs AgX, with numbers. A grade that does not move the
   image is a label.
3. IT IS PER-BIOME AND IT STICKS. Set a grade in the forest, switch to the city, switch back. The
   forest's grade must return and the city must NOT have inherited it. Environment switch rebuilds
   meshes and this repo has a history of settings not surviving it.
4. PANEL PRECEDENCE. A panel-requested tone must outrank the biome grade and survive several frames
   (CONTRACT §7.1, and the plan's rule that Auto never touches artistic choices).
5. BLOOM IS STILL COHERENT. This is the one most likely to have broken something. Under each
   candidate curve, measure what crosses the bright knee (__BIRB.setBloom({view:1})). Report whether
   the drone rings and slalom gates — the most important things to SEE on those courses — are still
   readable, or whether a curve has turned them into headlights or concrete. Numbers.
6. THE OWNER CAN ACTUALLY CHOOSE. The sheets exist, every tile is labelled IN THE IMAGE, the status
   quo is present as a tile, and GRADE-CHOICE.md gives a path from "I like tile 3" to a committed
   grade. A sheet nobody knows how to act on is a picture, not a deliverable.
7. HOUSEKEEPING: npm test 419/0; birb-shaders all four biomes; birb-modes (warnings are failures);
   --check all 12/12; sha256sum -c the manifest.

R6 applies with force here: a COLOUR rendered by SwiftShader is not a claim about what the owner's
phone will show. Say plainly which of your findings are structural (enums, floats, pixel means of the
same pipeline) and which would need the phone to settle.`,
  { label: 'G-GRADE', phase: 'Gate', model: 'opus', effort: 'high', schema: GATE })

log(`GRADE gate: ${gate?.verdict} — default untouched: ${gate?.defaultUntouched}, real: ${gate?.gradeIsReal}, per-biome: ${gate?.perBiome}, owner can choose: ${gate?.ownerCanChoose}`)
if (gate?.blockers?.length) log(`Blockers: ${gate.blockers.join(' | ')}`)

return { wave: 'grade', system, cands, gate, safeToMerge: gate?.verdict === 'PASS' && gate?.defaultUntouched === true }
