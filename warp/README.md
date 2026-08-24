# Warp Harvester

An on-rails Three.js salvage game built as a separate sibling to `/AR`.

## Core loop

- Aim at slow mining formations as they arc outward and stream past the cockpit.
- `FIRE` red ore to crack it into three harvestable green cores.
- `CATCH` green cores to charge three Warp Cells.
- Filling all three cells triggers an eight-second Overdrive: x2 yield, wider lock-on, faster warp visuals, and an 18-junk cargo purge.
- Firing on green vaporises charge; catching raw red ore adds junk.
- Ignoring an object is safe. The run ends only when mistakes fill the cargo bay to 100 junk.

Targets use both colour and silhouette: ore is red, spiked, and unstable, while resource cores are green, crystalline, and ringed. Consecutive correct decisions build the Refine streak and raise the score multiplier.

## Run locally

Serve the repository root and open `/warp/`:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000/warp/`. Device-orientation aiming may require HTTPS on a physical phone; pointer aiming remains available as a desktop fallback.

## Controls

- Phone/tablet: point to aim, then tap `FIRE` or `CATCH`.
- Desktop: mouse to aim; `F` or Space fires, `C` or Enter catches.
- `R`: recalibrate aiming.
- `P` or Escape: pause.
