# Authored asset manifest

Every file under `assets/` gets a row here before it is wired into the game.
The brief, the contract and the acceptance gate are in
[docs/realism/AUTHORED_ASSETS.md](../docs/realism/AUTHORED_ASSETS.md).

Rules, in short:

- **Generated from scratch or licensed for redistribution.** This is a public
  repository used to teach. Nothing derived from a photograph, a scan or
  another artist's texture that cannot be licensed.
- **Baked offline, committed as the final runtime file.** There is no build
  step, no bundler and no asset pipeline at deploy.
- **Root Birb only.** `/gauntlet`, `/sculpture`, `/icon3d` and `/AR` ship zero
  external assets by their own rules and must not import from here.
- **Accepted means `node tools/asset-check.mjs assets/` exits zero** — and that
  says nothing about whether it *looks* right, which is a human's call on a
  real phone.

| File | Kind | Source (model + prompt, or tool) | Licence | Commit |
|---|---|---|---|---|
| `textures/bark_pine_albedo.png` | sRGB albedo | OpenAI built-in image generation; prompt: “seamless, unlit grey-brown weathered pine bark plates with deep vertical fissures”; generated from scratch, then resized to 512² RGB with Pillow 12.3.0 | ISC | `e20a04b` |
| `textures/bark_pine_normal.png` | linear tangent-space normal | Offline authored from `bark_pine_albedo.png` with Pillow 12.3.0 + NumPy 2.3.5: wrap-aware multiscale luminance height proxy, circular gradients, OpenGL +Y normals | ISC | `e20a04b` |
| `textures/bark_pine_rough.png` | linear roughness | Offline authored from `bark_pine_albedo.png` with Pillow 12.3.0 + NumPy 2.3.5: wrap-aware local relief mapped to restrained high roughness, identical RGB channels | ISC | `e20a04b` |

## Where things live

| Path | Contents |
|---|---|
| `assets/textures/` | Tiling material maps: albedo, normal, roughness, AO, packed ORM |
| `assets/env/` | Equirectangular sky/environment maps, 2:1, one per biome |
| `docs/realism/reference/` | Concept and reference imagery. **Evidence only — never imported by the running page.** |
