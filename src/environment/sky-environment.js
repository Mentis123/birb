/**
 * sky-environment.js — image-based lighting from the sky this game already draws.
 *
 * `scene.environment` is null today and `PMREMGenerator` appears nowhere, so
 * every material in the world is lit by two lights and nothing else. This
 * module is the proving ground for changing that, and it deliberately needs NO
 * authored asset: it bakes an equirectangular map from the SAME four-stop
 * gradient `sky-dome.js` paints, so what the props reflect cannot disagree with
 * the sky behind them.
 *
 * It exists before the authored biome skies (ASSET_JOBS.md job 02) on purpose.
 * IBL ADDS irradiance on top of the existing hemisphere ambient — 1.12 in
 * forest — so the plausible outcome of switching it on is that the whole world
 * washes out. Finding that with a procedural map costs nothing; finding it
 * after four authored maps land makes "the sky map is wrong" indistinguishable
 * from "the lighting was never rebalanced".
 *
 * THREE is injected so the maths is testable; `spherical-world.js` imports
 * three from a CDN URL that `node --test` cannot resolve.
 */

/** sRGB hex -> linear RGB, the conversion three applies to a Color on assignment. */
export function hexToLinear(hex) {
  const f = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [
    f(((hex >> 16) & 0xff) / 255),
    f(((hex >> 8) & 0xff) / 255),
    f((hex & 0xff) / 255),
  ];
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * The dome's gradient, evaluated at `h` = dot(direction, up), in LINEAR space.
 *
 * Transcribed from sky-dome.js's fragment shader, stops and all: below the
 * horizon a pow(h+1, 2.2) blend from bottom to horizon, a smoothstep to mid
 * across the first 0.35, and a smoothstep to the zenith above that. The
 * self-limiting warm horizon band comes with it, because it carries a
 * meaningful part of the sky's energy near h = 0 and dropping it would make the
 * reflection cooler than the sky it is supposed to be.
 *
 * The sun disc and halo are deliberately NOT included — the dome draws its own
 * HDR disc, and a second one baked into the reflections would disagree with it.
 * That is the same instruction the authored-sky brief gives.
 */
export function skyRadianceAt(h, colors) {
  const top = hexToLinear(colors.top);
  const mid = hexToLinear(colors.mid);
  const horizon = hexToLinear(colors.horizon);
  const bottom = hexToLinear(colors.bottom);
  const hc = Math.max(-1, Math.min(1, h));

  let c;
  if (hc < 0) {
    const t = (hc + 1) ** 2.2;
    c = [mix(bottom[0], horizon[0], t), mix(bottom[1], horizon[1], t), mix(bottom[2], horizon[2], t)];
  } else if (hc < 0.35) {
    const t = smoothstep(0, 0.35, hc);
    c = [mix(horizon[0], mid[0], t), mix(horizon[1], mid[1], t), mix(horizon[2], mid[2], t)];
  } else {
    const t = smoothstep(0.35, 1, hc);
    c = [mix(mid[0], top[0], t), mix(mid[1], top[1], t), mix(mid[2], top[2], t)];
  }

  // Additive light onto a sky that is already near white does not glow, it
  // clips — and a wide soft term clips over a wide soft area. Scaling by the
  // remaining headroom is what keeps a pale mountain sky from going to a flat
  // slab, and it is copied here rather than reinvented.
  const room = 1 - clamp01(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
  const band = Math.exp(-(((hc - 0.02) * 8) ** 2)) * 0.22 * room;
  return [c[0] + horizon[0] * band, c[1] + horizon[1] * band, c[2] + horizon[2] * band];
}

/**
 * The up-component of the direction an equirectangular row samples.
 *
 * three's `equirectUv` is `v = asin(dir.y) / PI + 0.5`, and a DataTexture's row
 * 0 is v = 0, so row 0 looks at the NADIR and the last row at the zenith. Get
 * this upside down and the ground colour lights the sky.
 */
export function rowUpComponent(row, rows) {
  const v = (row + 0.5) / rows;
  return Math.sin((v - 0.5) * Math.PI);
}

/**
 * Equirectangular UV for a view direction, measured in the LOCAL tangent
 * frame of `up` rather than against world +Y.
 *
 * This is the JS reference for the sampling in sky-dome.js's fragment shader
 * and the two must agree line for line. Why it exists: the world is a sphere,
 * so "up" is radial and rotates as the bird flies, and a panorama sampled with
 * three's world-frame convention keeps its horizon at world y = 0 while the
 * player's horizon goes round the planet — at the equator the cloud band runs
 * top to bottom of the screen. Reproduced by capture; see the test file.
 *
 * The azimuth reference is a WORLD axis (+Y, or +X within ~8 degrees of the
 * pole where the cross product would vanish), never the view direction, so
 * turning in place does not spin the clouds. At up = +Y this reduces exactly
 * to atan2(z, x) / asin(y), i.e. three's own equirectUv, which the tests pin:
 * it is a generalisation of the old mapping, not a different sky.
 *
 * `dir` and `up` are unit vectors as [x, y, z]; `rotationTurns` shifts u.
 * Returns [u, v] with u unwrapped (callers fract it) and v in 0..1.
 */
export function equirectUvLocal(dir, up, rotationTurns = 0) {
  const ref = Math.abs(up[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  // east = normalize(cross(ref, up))
  let ex = ref[1] * up[2] - ref[2] * up[1];
  let ey = ref[2] * up[0] - ref[0] * up[2];
  let ez = ref[0] * up[1] - ref[1] * up[0];
  const el = Math.hypot(ex, ey, ez) || 1;
  ex /= el; ey /= el; ez /= el;
  // north = cross(up, east)
  const nx = up[1] * ez - up[2] * ey;
  const ny = up[2] * ex - up[0] * ez;
  const nz = up[0] * ey - up[1] * ex;
  const dEast = dir[0] * ex + dir[1] * ey + dir[2] * ez;
  const dNorth = dir[0] * nx + dir[1] * ny + dir[2] * nz;
  const dUp = Math.max(-1, Math.min(1, dir[0] * up[0] + dir[1] * up[1] + dir[2] * up[2]));
  const u = Math.atan2(dEast, dNorth) / (2 * Math.PI) + 0.5 + rotationTurns;
  const v = Math.asin(dUp) / Math.PI + 0.5;
  return [u, v];
}

/**
 * Bake the gradient into a float equirectangular texture.
 *
 * 64x32 is deliberate and is not a compromise. PMREM convolves this into
 * irradiance and roughness mips, so all it has to carry is the low-frequency
 * vertical structure the gradient actually contains; a 1024x512 bake of a
 * function with no horizontal variation would cost 512x the memory to describe
 * the same thing. An AUTHORED sky with clouds is a different argument.
 */
export function buildEquirectSky(THREE, sky, { width = 64, height = 32, flat = null } = {}) {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    // `flat` paints one uniform radiance instead of the gradient. It is the
    // diagnostic that separates "my map is wrong" from "the lighting path is
    // wrong", which staring at a render cannot -- the same trick as swapping a
    // material for flat magenta to tell "never rasterised" from "lost the
    // depth test".
    const rgb = flat ? [flat, flat, flat] : skyRadianceAt(rowUpComponent(y, height), sky);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

/** `?ibl=1`. Off is the shipping default. */
export function iblRequested(search) {
  return /[?&]ibl=1/.test(search || '');
}

/**
 * Prefilter and install onto the scene. Returns a disposer.
 *
 * PMREM runs ONCE, here — never per frame. The backlog names per-frame PMREM
 * generation explicitly as a thing not to do, and the generator plus its source
 * texture are both released the moment the cubemap exists.
 */
export function installSkyEnvironment(THREE, renderer, scene, sky, { intensity = 1, width, height, flat = null } = {}) {
  const source = buildEquirectSky(THREE, sky, { width, height, flat });
  const pmrem = new THREE.PMREMGenerator(renderer);
  let target = null;
  try {
    pmrem.compileEquirectangularShader();
    target = pmrem.fromEquirectangular(source);
  } finally {
    source.dispose();
    pmrem.dispose();
  }
  const previous = { environment: scene.environment, intensity: scene.environmentIntensity };
  scene.environment = target.texture;
  scene.environmentIntensity = intensity;
  return () => {
    scene.environment = previous.environment;
    scene.environmentIntensity = previous.intensity;
    target.dispose();
  };
}
