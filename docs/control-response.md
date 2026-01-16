# Control response expectations

This project now ships with a deterministic replay harness (`tests/helpers/flight-harness.js`) built on the `SimpleFlightController`. The harness feeds yaw/pitch sequences through `setInputs` and captures position, velocity, and facing quaternions per frame. The scenarios below are codified in the unit tests and serve as the review checklist for control regressions.

## Stick patterns → pose/velocity changes

All runs use a 0.05s timestep.

| Scenario | Input sequence | Expected result |
| --- | --- | --- |
| Yaw sweep | `yaw=1` for 1.0s, then neutral for 0.5s | Final forward vector ≈ `(-0.998, 0, -0.069)` with velocity aligned to facing; position arcs left to roughly `x=-2.38, z=-2.24` while staying above `y=4.9`. |
| Pitch climb | `pitch=1` for 0.8s, then neutral for 0.4s | Nose tilts up (`forward.y ≈ 0.54`), altitude climbs from 5 to about `5.88`, and vertical velocity remains positive (~`1.20`). |
| Coordinated left climb | `yaw=0.6, pitch=0.8` for 0.6s | Forward vector rotates left and up (`≈ -0.330, 0.217, -0.919`), ending near `y=5.17` with continued forward momentum. |

Reviewers can rerun `npm test` to regenerate the traces and confirm the expected control responses before merging.
