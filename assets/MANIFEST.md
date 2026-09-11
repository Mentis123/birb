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

| File | Kind | Target (material + slot) | World tile | Source (model + prompt, or tool) | Licence | Commit |
|---|---|---|---|---|---|---|
| `textures/bark_pine_albedo.png` | sRGB albedo | `barkMat.map` (forest landmark trunk + fallen log) | ~4.3 m square | OpenAI image generation; prompt "seamless, unlit grey-brown weathered pine bark plates with deep vertical fissures"; from scratch, resized to 512² RGB with Pillow 12.3.0 | ISC | `e20a04b` |
| `textures/bark_pine_normal.png` | linear tangent-space normal, OpenGL +Y | `barkMat.normalMap` | ~4.3 m square | Offline from the albedo with Pillow 12.3.0 + NumPy 2.3.5: wrap-aware multiscale luminance height proxy, circular gradients | ISC | `e20a04b` |
| `textures/stone_rock_albedo.png` | sRGB albedo → `stoneMat.map`, ~4.5 m tile, `?stone=1` | `stoneMat.map` (landmark arch) | ~4 m square | OpenAI image generation; prompt “seamless, orthographic weathered grey-brown sandstone with horizontal bedding, wind-scoured pitting and shallow cracks under flat ambient light”; generated from scratch, resized and mean-graded to `#6b6257` with Pillow 12.3.0 + NumPy 2.3.5 | ISC | `2df735c` |
| `textures/stone_rock_normal.png` | linear tangent-space normal, OpenGL +Y | `stoneMat.normalMap` (landmark arch) | ~4 m square | Offline from `stone_rock_albedo.png` with Pillow 12.3.0 + NumPy 2.3.5: wrap-aware multiscale luminance height proxy and circular gradients; independently generated normal rejected because its surface features did not align | ISC | `2df735c` |
| `env/forest_sky.png` | RGB LDR equirectangular environment | `scene.environment` (authored candidate; not wired) | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere humid forest atmosphere, blue-green sky, warm horizon, broad directional brightening, no sun disc or landscape”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |
| `env/canyons_sky.png` | RGB LDR equirectangular environment | `scene.environment` (authored candidate; not wired) | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere high-desert atmosphere, mauve upper air, peach horizon, subtle dust and cirrus, no sun disc or terrain”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |
| `env/mountain_sky.png` | RGB LDR equirectangular environment | `scene.environment` (authored candidate; not wired) | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere high-altitude atmosphere, cool blue vault, subdued warm horizon and wind-stretched cloud, no sun disc or mountains”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |
| `env/city_sky.png` | RGB LDR equirectangular environment | `scene.environment` (authored candidate; not wired) | n/a — equirectangular | OpenAI image generation; prompt “seamless full-sphere dark urban dusk atmosphere, deep blue sky, muted peach afterglow and layered cloud, no sun, skyline or lights”; generated from scratch, resized to 1024×512 RGB with Pillow 12.3.0 | ISC | `59b3cbf` |

`bark_pine_rough.png` was delivered in the same commit and **is not here**: it spans
0.145 across 37 of 256 values, which the gate rejects as a constant wearing a
texture's filename, and `MeshLambertMaterial` — which is every tree material in
this game — has no `roughnessMap` slot to put it in anyway.

**Target** names the material and the slot the asset is for — `barkMat.map`, not "trees".
A slot the material class does not have is a silent no-op: `MeshLambertMaterial` has no
`roughnessMap`, and assigning one uploads a texture, perturbs the program cache key, and
samples nothing.

**World tile** is how many metres of surface one tile of the image depicts. `map.repeat`,
not the pixel count, is what sets on-screen density, and without this number nobody can
set it.

## Where things live

| Path | Contents |
|---|---|
| `assets/textures/` | Tiling material maps: albedo, normal, roughness, AO, packed ORM |
| `assets/env/` | Equirectangular sky/environment maps, 2:1, one per biome |
| `docs/realism/reference/` | Concept and reference imagery. **Evidence only — never imported by the running page.** |
