export const meta = {
  name: 'perf-ascend',
  description: 'Above-baseline realism: real shadow maps, antialiasing on mobile, anisotropy, terrain resolution and densities past 1.0 — all opt-in from the workbench',
  whenToUse: 'Run when the workbench needs to push quality UP rather than shed it. Every lever is opt-in; the shipping default must not move.',
  phases: [
    { title: 'Levers', detail: 'The systems that are switched off or capped on mobile' },
    { title: 'Panel', detail: 'Expose them, plus a one-tap max-realism preset' },
    { title: 'Gate', detail: 'Does each lever move measured rendering work, and is the default untouched?' },
  ],
}

const REPO = `Repo /home/user/birb — Birb Mobile. Branch claude/ultracode-sub-agents-plan-c9qmba.
Waves 0-3A are merged and live. The three-finger workbench is on the production path and working.

READ FIRST:
  docs/perf/CONTRACT.md  §3.1 sentinel protocol, §7 PRECEDENCE + routing register, §9 deferrals,
                         §10 provisional constants, §11 names + the compatibility ladder
  docs/perf/gates/G2b.md the standard this wave is judged by: is each control wired to RENDERING
                         WORK, or to a label? One measurement per control class, with numbers.
  docs/PERFORMANCE_REALISM_PLAN.md — Experiment 2 ("image stability before more effects") is
                         exactly what the antialiasing task below is, pulled forward because the
                         owner has the device in hand and is asking for it.

WHY THIS WAVE EXISTS. Reported from a real iPhone: "all of the settings start at full and I can
only dial them back... I want to push the envelope on the most realistic graphics." That is a true
observation about the panel's parentage — it was built to serve ADAPTIVE QUALITY, which only ever
sheds, so every ceiling was the shipping value wearing a slider's clothes. Two ceilings were lifted
already (render DPR to native 3.0, post quality gains Full). This wave does the rest, and the rest
is bigger than sliders: TWO WHOLE SYSTEMS ARE SWITCHED OFF on mobile.

  index.html:3633  renderer.shadowMap.enabled = false      <- no real shadows AT ALL
  index.html:3611  antialias: !isMobile                    <- no AA on the target device

THE ONE INVARIANT THIS WAVE MUST NOT BREAK. Everything here is OPT-IN from the panel. The shipping
default — what a player who never opens the workbench sees, and what the adaptive tier manages —
does not move. Same principle as CONTRACT §11's compatibility ladder: a no-device outcome ships
nothing riskier than today. If a lever cannot be made opt-in, say so rather than changing default
behaviour.

REPO TRAPS THAT WILL BITE THIS WAVE SPECIFICALLY:
- A shader that fails to compile does not render wrong: Three logs the error and draws NOTHING for
  that material, while the page still paints and a screenshot still exits zero. Two whole systems
  shipped invisible that way in one session. node tools/birb-shaders.mjs is the guard and it visits
  every biome. Enabling shadow maps recompiles EVERY material in the scene — this is the single
  most likely way to break this repo.
- A rendering world is not a working world. node tools/birb-modes.mjs treats console WARNINGS as
  failures and exists because a world once rendered perfectly with its nesting and collectibles
  systems never created.
- Zero-allocation game loop: no \`new\` per frame.
- CONTRACT §7.1 precedence: panel request > adaptive tier > capability probe. A panel value
  clobbered on the next frame by a per-frame writer is a label, and G2b measures exactly that.

VERIFY WITH REAL OUTPUT, capture exit codes, never pipe a harness into grep:
  npm test                                   # 419 pass / 0 fail, exit 0 — four sibling projects
  node tools/birb-shaders.mjs                # every material, every biome
  node tools/birb-modes.mjs                  # warnings are failures
  node tools/birb-quality.mjs --check all    # all 12 assertions must still pass
  sha256sum -c tools/oracle-manifest.txt     # 58 frozen files`

const OUT = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    levers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          how: { type: 'string', description: 'the mechanism, concretely' },
          measuredEffect: { type: 'string', description: 'the MEASURED change with numbers — draw calls, buffer dims, triangle count, program count. Not "looks better".' },
          costMeasured: { type: 'string', description: 'what it costs, measured, even if only under SwiftShader (label it as such — R6)' },
          defaultUnchanged: { type: 'boolean', description: 'MUST be true: a player who never opens the panel sees exactly what they saw before' },
        },
        required: ['name', 'how', 'measuredEffect', 'costMeasured', 'defaultUnchanged'],
      },
    },
    harnessResults: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'levers', 'harnessResults', 'deviations'],
}

phase('Levers')

const TASKS = [
  {
    key: 'shadows', model: 'sonnet', effort: 'high',
    prompt: `TASK — REAL SHADOW MAPS, opt-in. This is the biggest realism win available and it is
currently switched off entirely: index.html:3633 sets renderer.shadowMap.enabled = false. The game
fakes contact shadows instead (src/effects/contact-shadow.js) and has no cast shadows at all.

Build a runtime-togglable shadow path:
- shadowMap.enabled, type (PCF / PCFSoft / VSM), and map size as separate controls.
- Decide and document WHICH light casts. There is a keyLight per environment; a directional light
  over a radius-120 SPHERE needs its shadow camera fitted to the visible region or the map
  resolution is wasted on empty space — say what frustum you chose and why.
- Decide and document WHICH meshes cast and receive. Everything casting is wrong: the instanced
  scatter is hundreds of props, and castShadow on all of them will cost more than it returns.
  Prefer: terrain receives; champion structures and the bird cast.
- CLAUDE.md records a hard-won trap in a sibling: material.shadowSide must be FrontSide for
  open/non-watertight geometry, or a mesh shadows its own front face and the whole thing renders in
  ambient only. This world is full of open geometry. Watch for it and say what you found.

Enabling shadow maps RECOMPILES EVERY MATERIAL. tools/birb-shaders.mjs across all four biomes is
the check that matters, and a material that fails to compile draws NOTHING while the page still
screenshots fine. Run it with shadows ON, not just off.

Default stays OFF. Report the measured cost: draw calls and programs with and without.`,
  },
  {
    key: 'antialias', model: 'sonnet', effort: 'high',
    prompt: `TASK — ANTIALIASING ON MOBILE. index.html:3611 is \`antialias: !isMobile\`, so every edge
on the target device is jagged. This is Experiment 2 in docs/PERFORMANCE_REALISM_PLAN.md ("image
stability before more effects"), pulled forward because the owner has the phone in hand.

antialias is a CONTEXT-CREATION flag: it cannot be toggled on a live WebGLRenderer. So there are
two routes and you must weigh both, implement one, and say why:
  (a) An FXAA-style resolve in the composite. src/effects/bloom-pass.js already owns a full-screen
      composite pass, so this is a shader addition with no new draw call, and it works whether or
      not the post chain is at full resolution. It softens; it can also blur detail, which the plan
      warns about explicitly.
  (b) Recreate the renderer with antialias:true (MSAA) when the panel asks. Truthful hardware AA,
      but it means tearing down and rebuilding the WebGL context, every material, every texture and
      every render target mid-session. That is a large blast radius and the plan says to test
      "low-sample target MSAA" rather than assume it.
A third exists and is worth naming: a WebGLRenderTarget with a samples:N option for the SCENE pass,
resolved into the post chain — hardware MSAA without recreating the context. Consider it first; if
it works it is strictly better than both.

Whatever you build: default OFF on mobile (unchanged), on-demand from the panel, and
tools/birb-shaders.mjs green. Report the measured cost.`,
  },
  {
    key: 'sharpness', model: 'sonnet', effort: 'medium',
    prompt: `TASK — TEXTURE SHARPNESS AND TERRAIN RESOLUTION, opt-in.

1. ANISOTROPY. The only anisotropy in the entire repo is \`cloudTex.anisotropy = 2\`
   (index.html:4336). Every ground and prop texture is sampled isotropically, which is why surfaces
   at grazing angles — the whole ground plane in flight — go to mush. Add a controllable anisotropy
   level applied to the textures that actually benefit, bounded by
   renderer.capabilities.getMaxAnisotropy(). Report that maximum: on the target phone it is likely
   16, and the game is using 2 on one texture.

2. TERRAIN MESH RESOLUTION. src/environment/spherical-world.js builds the ground with
   SphereGeometry(sphereRadius, groundWidthSeg, groundHeightSeg) — 96x64 on mobile. CLAUDE.md
   records the consequence: the detail noise has features about twenty units across and the mesh
   cannot resolve them, which is why flooding water from the full field produced "lakes" the ground
   drew straight over. A higher segment count is REAL silhouette and terrain detail, not a filter.
   Make it a control. Rebuilding terrain is not free and not per-frame: apply on release, and say
   what it costs in triangles at each level you expose.

Default unchanged at both. Report measured triangle counts per level.`,
  },
  {
    key: 'density', model: 'haiku', effort: 'medium',
    prompt: `TASK — LET THE DENSITY CONTROLS EXCEED 1.0.

Weather density, mist budget and decorative density are sliders bounded 0..1, where 1.0 is exactly
today's shipping value. So they can only ever subtract. Raise each ceiling so the workbench can ask
for MORE than ships: more weather particles, thicker mist, more wind/ribbon/contact-shadow activity.

For each one, find what 1.0 actually maps to and make >1 mean something real — more particles, not
just a brighter uniform. If a system genuinely cannot exceed its shipping value without new
geometry (a fixed particle-buffer size, for instance), SAY SO in deviations rather than scaling a
uniform and calling it density. A slider that multiplies a colour is a label, and G2b measures the
difference.

Cap somewhere defensible (2.0 is a reasonable doubling) and say why. Default stays 1.0 exactly.
Report the measured particle/draw-call change at 1.0 vs your new maximum.`,
  },
]

const built = (await parallel(TASKS.map(t => () =>
  agent(`${REPO}\n\n${t.prompt}

DELIVERABLE DISCIPLINE:
- Own only your files; another agent owns the rest. If you must touch index.html, make the
  SMALLEST edit that works and say exactly which region.
- Do NOT edit anything in tools/oracle-manifest.txt (58 frozen files, tests/** among them).
- Every lever reports a MEASURED effect with numbers. "Looks better" is not a measurement, and
  under SwiftShader a timing is not a device claim (R6) — say which numbers are which.
- defaultUnchanged must be true for every lever. If you cannot achieve that, stop and report.`,
    { label: `asc-${t.key}`, phase: 'Levers', model: t.model, effort: t.effort, schema: OUT })
))).filter(Boolean)

log(`Levers: ${built.length}/${TASKS.length}; defaults unchanged: ${built.every(b => b.levers.every(l => l.defaultUnchanged))}`)

phase('Panel')

const panel = await agent(
`${REPO}

The levers now exist:
${built.map(b => b.levers.map(l => `- ${l.name}: ${l.how}\n  measured: ${l.measuredEffect}`).join('\n')).join('\n')}

TASK — expose them in src/ui/dev-quality-panel.js, and add the thing the owner actually asked for.

1. A new "Ultra" view (or a clearly separated ABOVE-BASELINE section of the Look view) holding every
   new lever. It must be visually obvious which controls go beyond the shipping default and which
   only shed — that distinction is the whole complaint that started this wave.
2. A ONE-TAP "MAX REALISM" PRESET that sets every lever to its ceiling at once: DPR native, post
   Full, shadows on at the highest map size, AA on, anisotropy max, terrain resolution high,
   densities at their new maximum. The owner wants to see the envelope, not assemble it from
   fourteen sliders on a phone in bright sunlight.
3. A "BACK TO SHIPPING DEFAULT" control next to it that returns every lever to what a player sees.
   Getting out must be exactly as easy as getting in.
4. Every new control routes through quality-settings (CONTRACT §7.1 precedence) exactly as the
   existing ones do, and appears in the evidence export — a capture taken at max realism that does
   not record it was at max realism is not evidence.
5. Show the COST live: the panel already has draw calls, triangles and frame interval. Make the
   preset's effect legible, because the point is to see what realism costs.

Mobile-first: this is operated by a thumb, in flight, on a phone. Do not build a desktop inspector.`,
  { label: 'asc-panel', phase: 'Panel', model: 'sonnet', effort: 'high', schema: OUT })

phase('Gate')

const GATE = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'STOP'] },
    reason: { type: 'string' },
    levers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          movesRenderingWork: { type: 'boolean' },
          evidence: { type: 'string', description: 'the measurement YOU took, not the agent\'s report' },
        },
        required: ['name', 'movesRenderingWork', 'evidence'],
      },
    },
    defaultUntouched: { type: 'boolean' },
    shadersCompile: { type: 'boolean' },
    assertionsPass: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reason', 'levers', 'defaultUntouched', 'shadersCompile', 'assertionsPass', 'blockers'],
}

const gate = await agent(
`${REPO}

You are the ASCEND GATE. Write docs/perf/gates/G-ASCEND.md, first line exactly
'VERDICT: PASS' or 'VERDICT: STOP — <reason>'. This ships to a real phone, so measure, do not read.

1. EVERY LEVER MOVES RENDERING WORK. One measurement per lever, taken by YOU on the live page:
   shadows -> program count and draw calls change, and something actually casts a shadow;
   AA -> the resolve is real (sample count, or the FXAA pass present in the frame);
   anisotropy -> the texture's anisotropy property actually changed on the textures claimed;
   terrain resolution -> triangle count changes;
   densities > 1 -> particle or draw count RISES above the 1.0 baseline.
   A lever that only changes a number in a panel is a label. G2b's standard, applied again.

2. THE SHIPPING DEFAULT IS UNTOUCHED. This is the one that decides shipping. Load the page WITHOUT
   opening the panel and compare draw calls, triangles, program count and buffer dimensions against
   the pre-wave values in docs/perf/BASELINE.md and the current main. A player who never opens the
   workbench must see EXACTLY what they saw before. Any drift is a STOP.

3. SHADERS COMPILE IN EVERY BIOME, WITH THE NEW LEVERS ON. node tools/birb-shaders.mjs with
   shadows enabled and AA enabled, not just at the default. A material that fails to compile draws
   NOTHING while the page still screenshots fine — this repo shipped two systems invisible that
   way, and turning on shadow maps recompiles every material in the scene.

4. ALL 12 QUALITY ASSERTIONS STILL PASS: node tools/birb-quality.mjs --check all.
   Plus birb-modes (warnings are failures), birb-shot --start and --start --nest, npm test 419/0.

5. NOTHING FROZEN WAS EDITED: sha256sum -c tools/oracle-manifest.txt.

6. THE PRESET IS REVERSIBLE. Apply max realism, then back-to-default, and confirm every value
   returns to baseline. A one-way door on a phone in a park is a bad control.

Report what you could not determine. Under SwiftShader a frame time is not a device claim (R6):
say which of your numbers are structural (counts, dimensions) and which are not.`,
  { label: 'G-ASCEND', phase: 'Gate', model: 'opus', effort: 'high', schema: GATE })

log(`ASCEND gate: ${gate?.verdict} — default untouched: ${gate?.defaultUntouched}, shaders: ${gate?.shadersCompile}, assertions: ${gate?.assertionsPass}`)
const labels = (gate?.levers ?? []).filter(l => !l.movesRenderingWork).map(l => l.name)
if (labels.length) log(`LEVERS THAT ARE LABELS: ${labels.join(', ')}`)
if (gate?.blockers?.length) log(`Blockers: ${gate.blockers.join(' | ')}`)

return { wave: 'ascend', built, panel, gate, safeToMerge: gate?.verdict === 'PASS' && gate?.defaultUntouched === true }
