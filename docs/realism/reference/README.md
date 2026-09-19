# Reference imagery — evidence only

**Nothing in this directory is ever imported by the running page.** It is not an
asset directory; it is the pile of images the art is judged against.

This is the `/sculpture` convention, and that project's history is the argument
for it: it solved a likeness problem with matched photographs, a compositor that
put render beside reference at the same camera, and a rubric of binary checks
committed *before* the work — and it still records, twice, the failure this
guards against: **green gate, worse render**.

Commissioned as job 03 in [../ASSET_JOBS.md](../ASSET_JOBS.md). The rubric that
goes with it is `docs/realism/LIKENESS_BIRB.md`.

Rules:

- **Generated from scratch, or licensed for redistribution.** This is a public
  repository used to teach. Do not commit someone else's photograph you cannot
  licence — extract the landmark or the measurement and cite the source instead,
  which is what the Bronze study did with the seven Maps photos it deliberately
  did not commit.
- **No format or budget rules apply** — nothing here reaches a GPU. Readable is
  the whole specification.
- **A file here must be cited by a check** in the rubric, or it is decoration.

## Job 03 reference set

Generated from scratch with OpenAI's built-in image generation tool on
2026-09-11, two candidates per commissioned brief. The four selected outputs
were re-encoded as plain RGB PNGs with Pillow 12.3.0; no compositing, retouching
or runtime asset conversion was applied. Repository licence: ISC.

| File | Commissioned prompt | Selection decision |
|---|---|---|
| [`bird-flight-side.png`](bird-flight-side.png) | “A photorealistic Eastern bluebird in level flight, side-on, wings fully extended, strong afternoon light. Sharp enough to read individual primary and secondary feathers and the layering across the wing. Neutral background.” | Candidate B: cleaner body profile, stronger primary/secondary separation and less confusing wing overlap. |
| [`bird-perched-contact.png`](bird-perched-contact.png) | “A photorealistic small blue songbird perched on a thick pine branch, feet gripping the bark, wings folded, three-quarter view from slightly below. Close enough to read how the toes wrap the branch and how the folded wing sits against the body.” | Candidate A: clearer folded-wing stack and more readable two-foot branch contact. |
| [`forest-river-golden-hour.png`](forest-river-golden-hour.png) | “A forest river valley at golden hour, seen from above the canopy looking down the valley: a river winding between wooded banks, exposed rock on the far side, mist in the low ground, sunlight raking across the treetops. Cinematic, natural colour, no people, no buildings.” | Candidate B: clearest winding river, exposed far-bank geology, confined low mist and canopy rake light. |
| [`bark-and-ground-arm-length.png`](bark-and-ground-arm-length.png) | “Pine bark and forest floor at arm's length: deeply fissured bark on the left, needle litter and wet gravel on the right, overcast even light, natural colour, sharp detail.” | Candidate A: strongest left/right material split and most useful scale relationship. |

These generated images are visual targets, not zoological or geological source
material. [`../LIKENESS_BIRB.md`](../LIKENESS_BIRB.md) limits their authority to
the visible relationships each image can actually settle. In particular, the
flight reference's orange and white plumage does not supersede Birb's fixed
blue/cyan identity.
