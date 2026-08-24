# Warp Harvester

An on-rails Three.js salvage game built as a separate sibling to `/AR`.

## Core loop

- Aim at incoming objects with device orientation or the desktop pointer.
- `FIRE` red hazards to destroy them.
- `CATCH` green resources to add clean fuel.
- Firing on green burns fuel.
- Catching red adds junk to the cargo bay.
- Unstopped red hazards also add junk; the run ends at 100 junk.

Targets use both colour and silhouette: hazards are spiked and unstable, while resources are crystalline and ringed.

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
