/**
 * src/flight/plumage.js — feathers that catch the light.
 *
 * At the chase camera the bird is ~140 px tall, and the authored feather
 * detail maps measured within noise at that distance: texture does not
 * survive the minification. The SHAPE of a highlight does. So this is the
 * v3 bird's light response rebuilt on three's physical model, with a sky to
 * reflect:
 *
 *  - The WING (vane) material gets thin-film IRIDESCENCE — three's
 *    Belcour & Barla 2017 model. A Bronze-winged Pionus's bronze is
 *    structural: a keratin/melanin film over the pigment, whose interference
 *    colour moves to shorter wavelengths as the view grazes the surface
 *    (the optical path 2·n·d·cosθt shrinks). With a 265 nm film of index 1.8
 *    the face-on reflection is copper, gold at mid angles, yellow at the chase
 *    camera's ~20 degree view, and it runs on toward yellow-green at grazing —
 *    the colour change the hand-made `addFeatherSheen` band was imitating.
 *    `thinFilmReflectance` below is the same formula in JS, and the tests pin
 *    that path with it. The film is masked to the BRONZE feathers in the
 *    shader (`bronzeFilmWeight`): the red tail root and the teal primaries
 *    share this material and keep their pigment colour.
 *  - The BODY (contour) material gets SHEEN — the Charlie/Estevez-Kulla lobe
 *    three uses for cloth and fibre. Contour feathers are a pile of barbs and
 *    barbules, and a pile scatters light back toward a grazing viewer; that
 *    soft lit rim is what makes plumage read as plumage rather than as a
 *    painted shell.
 *  - Both are DIELECTRIC (keratin, n = 1.56, F0 = 0.048). The old wing was
 *    metal 0.34 to fake a brighter specular, and its own comment said why it
 *    could go no further: "there is no envMap on the shipping path — past about
 *    that, three's metal has nothing to reflect and the wing goes DARK between
 *    highlights". There is one now.
 *  - A BIRD-ONLY environment map: the biome's own sky gradient, baked with the
 *    same `buildEquirectSky` the opt-in `?ibl` path uses and prefiltered with
 *    PMREM once per biome switch — never per frame. `scene.environment` is not
 *    touched, so nothing else in the world changes.
 *
 * Two things about the environment are load-bearing.
 *
 * UP IS RADIAL. The bake puts the zenith at world +Y, and three samples an
 * env map in world space, so on this planet a straight bake is right only at
 * the north pole: on the equator the bird's back would reflect the horizon and
 * its flank the zenith. `update()` sets `envMapRotation` every frame to the
 * rotation that takes the bird's local up onto +Y (`envRotationFor`). The
 * gradient has no azimuth, so ANY such rotation is correct and the cheapest one
 * (two angles, no roll) is used. Zero allocation: it writes into the materials'
 * own Euler objects.
 *
 * THE SKY IS COUNTED ONCE. The scene's HemisphereLight already IS this game's
 * sky irradiance, tuned per biome by hand; an env map adds its own irradiance
 * on top, and at intensity 1 that roughly doubles the bird's ambient (the ?ibl
 * experiment's own header predicted exactly this washout). So the bird's
 * shader moves the hemisphere irradiance INTO the physical IBL slot
 * (`iblIrradiance`) and drops the env map's own diffuse. The hemisphere then
 * lights the bird exactly as before, but energy-conserved against the
 * specular, the film and the sheen, and it feeds the sheen's indirect lobe;
 * the env map contributes only what a hemisphere cannot — a reflection.
 * Anchored on `#include <lights_fragment_maps>` (the include, never its body:
 * see installFeatherDetail in authored-textures.js for the time that anchor
 * silently never matched).
 *
 * ANISOTROPY IS DELIBERATELY NOT USED. A feather's anisotropic highlight runs
 * across its BARBS, and the barbs leave the rachis toward the tip on both
 * sides — a chevron, mirrored across the shaft. three takes the anisotropy
 * direction from one tangent frame per surface (the UV's u axis, rotated by
 * one angle), and every v3 feather plate carries a single UV frame, so any
 * direction chosen is right on one vane and mirrored-wrong on the other. A
 * correct direction needs per-vane UVs or a direction map; neither exists, and
 * a highlight stretched the wrong way on half of every feather is not realism.
 *
 * THREE is injected (the tests run in node against a stub).
 */
import { buildEquirectSky } from '../environment/sky-environment.js';

/** `?plumage=0` restores the Standard materials, byte for byte. */
export function plumageRequested(search) {
  return !/[?&]plumage=0/.test(search || '');
}

/** Keratin, the stuff of feathers: F0 = ((n - 1) / (n + 1))^2 = 0.048. */
export const KERATIN_IOR = 1.56;

/**
 * The parameter table. Per palette, because `?pionus=0` (the old blue bird)
 * has no bronze to iridesce.
 *
 * Read off a pinned A/B against the Standard bird (tools/birb-plumage-ab.mjs;
 * docs/perf/gates/G-REALISM-PLUMAGE.md has the table). Four things decided it:
 *
 *  - `albedo` keeps the DIFFUSE energy the Standard bird had. A metalness of
 *    0.34 took 34% of the wing's diffuse away; a dielectric gets it all back.
 *    Scaling the albedo by (1 - old metalness) is the energy-preserving
 *    conversion, and it keeps every vertex colour's hue.
 *  - `specularIntensity` 0.5: a feather is not a sheet of keratin, it is barbs
 *    with gaps between them, and under this game's bright pastel sky a full
 *    keratin Fresnel reflected so much sky that the first capture measured
 *    the bird +55% brighter with its colours washed toward the sky's.
 *    Roughness 0.55 on the wing and 0.7 on the body is the rest of the same
 *    reading: barbules scatter, they do not mirror.
 *  - The film is 265 nm of n = 1.8: face-on it is copper (13 degrees), at mid
 *    angles gold, at the chase camera's ~20 degree view yellow, and it runs on
 *    toward green at grazing. 250 nm went lime at the chase camera, which read
 *    as the khaki the palette comment warns about; 280 nm never left orange.
 *    The shader masks it to the BRONZE feathers (bronzeFilmWeight), so the red
 *    tail root and the teal primaries keep their pigment colour.
 *  - The hand-made rim (x0.6) and feather sheen (x0) are scaled back rather
 *    than removed: they still chain and compile on this material, but the
 *    physical sheen and Fresnel are the rim now, and the film is the colour
 *    shift the sheen band was imitating.
 */
export const PLUMAGE = Object.freeze({
  pionus: Object.freeze({
    contour: Object.freeze({
      albedo: 0.88,
      metalness: 0,
      roughness: 0.7,
      specularIntensity: 0.5,
      ior: KERATIN_IOR,
      sheen: 1,
      sheenRoughness: 0.45,
      // Pale lilac: the dusky violet body's own hue, lifted. A white sheen
      // greys a saturated plumage at the rim; a hue-matched one reads as the
      // feathers catching light.
      sheenColor: 0x8f86b8,
      // The "ambient lift" the Standard bird needed because it had nothing to
      // reflect. The sky supplies that now, so most of it goes.
      emissiveIntensity: 0.14,
      envMapIntensity: 1,
    }),
    vane: Object.freeze({
      albedo: 0.66,
      metalness: 0,
      roughness: 0.55,
      specularIntensity: 0.5,
      ior: KERATIN_IOR,
      iridescence: 1,
      iridescenceIOR: 1.8,
      // Without a thickness map three uses the MAXIMUM of the range.
      iridescenceThicknessRange: Object.freeze([100, 265]),
      emissiveIntensity: 0.14,
      envMapIntensity: 1,
    }),
    rimScale: 0.6,
    featherSheenScale: 0,
  }),
  blue: Object.freeze({
    contour: Object.freeze({
      albedo: 0.88,
      metalness: 0,
      roughness: 0.7,
      specularIntensity: 0.5,
      ior: KERATIN_IOR,
      sheen: 1,
      sheenRoughness: 0.45,
      sheenColor: 0x7d9ee8,
      emissiveIntensity: 0.14,
      envMapIntensity: 1,
    }),
    vane: Object.freeze({
      // The blue vane was metalness 0.16.
      albedo: 0.84,
      metalness: 0,
      roughness: 0.6,
      specularIntensity: 0.5,
      ior: KERATIN_IOR,
      // A blue jay's blue is structural too, but it is not a film: it is
      // incoherent scattering from the barb's spongy keratin, which does not
      // change colour with angle. No iridescence on the blue bird.
      iridescence: 0,
      emissiveIntensity: 0.14,
      envMapIntensity: 1,
    }),
    rimScale: 0.6,
    featherSheenScale: 1,
  }),
});

/** A linear grey level as the sRGB hex three's Color.set() decodes back to it. */
export function linearGreyHex(v) {
  const c = Math.min(Math.max(v, 0), 1);
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  const byte = Math.round(s * 255);
  return (byte << 16) | (byte << 8) | byte;
}

/** The table entry for a palette. */
export function plumageFor(pionus = true) {
  return pionus ? PLUMAGE.pionus : PLUMAGE.blue;
}

/**
 * MeshPhysicalMaterial constructor parameters for one of the bird's two
 * feather materials. Fresh objects every call (three stores the thickness
 * range array by reference). `emissive` is the palette's ambient-lift colour,
 * unchanged — only its intensity moves.
 */
export function plumageMaterialParams(THREE, part, { pionus = true } = {}) {
  const p = plumageFor(pionus)[part];
  if (!p) throw new Error(`plumage: no part "${part}"`);
  const params = {
    vertexColors: true,
    // Multiplies the vertex colours: the albedo under the film.
    color: linearGreyHex(p.albedo),
    metalness: p.metalness,
    roughness: p.roughness,
    specularIntensity: p.specularIntensity,
    ior: p.ior,
    emissive: pionus ? 0x1c1828 : 0x0f1f45,
    emissiveIntensity: p.emissiveIntensity,
    envMapIntensity: p.envMapIntensity,
  };
  if (p.sheen) {
    params.sheen = p.sheen;
    params.sheenRoughness = p.sheenRoughness;
    params.sheenColor = p.sheenColor;
  }
  if (p.iridescence) {
    params.iridescence = p.iridescence;
    params.iridescenceIOR = p.iridescenceIOR;
    params.iridescenceThicknessRange = [...p.iridescenceThicknessRange];
  }
  if (part === 'vane') params.side = THREE.DoubleSide;
  return params;
}

/**
 * Route the scene's hemisphere irradiance through the physical IBL path and
 * keep only the env map's REFLECTION. See the module header ("the sky is
 * counted once"). CHAINS any onBeforeCompile already on the material (the rim
 * light and the feather sheen register first; the authored feather detail
 * chains after), and extends the program cache key so a plumage material can
 * never share a compiled program with a bare one.
 *
 * It also masks the thin film to the bronze feathers, where three has just set
 * `material.iridescence` and before the lights read it.
 *
 * `hemi`: how much of the hemisphere irradiance moves into the IBL slot (1 =
 * all of it, the shipping value). `envDiffuse`: how much of the env map's OWN
 * irradiance is kept (0 = none, the shipping value — the hemisphere already is
 * the sky's diffuse). `filmMask`: 1 = film on bronze only (shipping), 0 = film
 * everywhere (the first cut, kept for the A/B). All three are live uniforms for
 * the tuning hook.
 */
export function installPlumageLighting(material, THREE, { hemi = 1, envDiffuse = 0, filmMask = 1 } = {}) {
  if (!material) return null;
  if (material.userData?.birbPlumage) return material.userData.birbPlumage;
  // Physical/standard only: the IBL slot and RE_IndirectSpecular exist only
  // in the meshphysical shader. On anything else this would fail to COMPILE,
  // and three then draws nothing for that material at all.
  if (!material.isMeshStandardMaterial) return null;
  const uniforms = {
    uPlumageHemi: { value: hemi },
    uPlumageEnvDiffuse: { value: envDiffuse },
    uPlumageFilmMask: { value: filmMask },
  };
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    if (typeof previous === 'function') previous.call(this, shader, renderer);
    const ANCHOR = '#include <lights_fragment_maps>';
    const MATERIAL = '#include <lights_physical_fragment>';
    if (!shader.fragmentShader.includes(ANCHOR) || !shader.fragmentShader.includes(MATERIAL)) {
      // birb-modes and the realism runner fail on console warnings, so this
      // cannot ship silently.
      console.warn('plumage: no #include <lights_fragment_maps>/<lights_physical_fragment> in this material; sky left uncorrected');
      return;
    }
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = 'uniform float uPlumageHemi;\nuniform float uPlumageEnvDiffuse;\nuniform float uPlumageFilmMask;\n'
      + shader.fragmentShader
        .replace(MATERIAL, [
          MATERIAL,
          // The film lives on the BRONZE feathers. The vane material also
          // carries the teal primaries and the red tail root, and a gold film
          // over those turns the red orange and the teal olive — the hue the
          // palette exists to keep. Same rule as bronzeFilmWeight() below.
          '#if defined( USE_IRIDESCENCE ) && defined( USE_COLOR )',
          '  {',
          '    float plumMax = max( max( vColor.r, vColor.g ), vColor.b );',
          '    float plumChroma = plumMax - min( min( vColor.r, vColor.g ), vColor.b );',
          '    float plumWarm = ( vColor.r >= plumMax && plumChroma > 1e-4 )',
          '      ? ( vColor.g - min( vColor.g, vColor.b ) ) / plumChroma : 0.0;',
          '    float plumBronze = smoothstep( 0.2, 0.4, plumWarm ) * smoothstep( 0.15, 0.35, plumChroma / max( plumMax, 1e-4 ) );',
          '    material.iridescence *= mix( 1.0, plumBronze, uPlumageFilmMask );',
          '  }',
          '#endif',
        ].join('\n'))
        .replace(ANCHOR, [
          ANCHOR,
          '#if defined( RE_IndirectDiffuse ) && defined( RE_IndirectSpecular )',
          '  iblIrradiance = iblIrradiance * uPlumageEnvDiffuse + irradiance * uPlumageHemi;',
          '  irradiance = vec3( 0.0 );',
          '#endif',
        ].join('\n'));
  };
  material.customProgramCacheKey = function () {
    const base = typeof previousKey === 'function' ? previousKey.call(this) : '';
    return `${base}|plumage-v1`;
  };
  material.needsUpdate = true;
  material.userData = material.userData || {};
  material.userData.birbPlumage = uniforms;
  return uniforms;
}

/**
 * The env-map rotation that puts the bird's local up at the bake's zenith.
 *
 * Returns (in `out`) Euler angles x, y for order 'XYZ' such that
 * R_X(x)·R_Y(y) maps the unit vector `up` onto +Y. First R_Y swings `up` into
 * the YZ plane (y = atan2(-ux, uz)), then R_X tips it onto +Y
 * (x = atan2(-r, uy), r = |(ux, uz)|). At up = +Y both are zero: at the spawn
 * pole the bird reflects exactly the plain bake, the same map `?ibl` installs.
 *
 * three NEGATES material.envMapRotation before building the shader's matrix
 * ("accommodate left-handed frame", WebGLMaterials), so the caller writes
 * (-x, -y, 0) and the matrix the shader multiplies by is R_X(x)·R_Y(y).
 */
export function envRotationFor(ux, uy, uz, out) {
  const r = Math.sqrt(ux * ux + uz * uz);
  out.y = r > 1e-9 ? Math.atan2(-ux, uz) : 0;
  out.x = Math.atan2(-r, uy);
  return out;
}

/**
 * The thin-film Fresnel three's shader computes (iridescence_fragment,
 * `evalIridescence`), transcribed to JS so the film's colour at an angle is
 * something a test can assert rather than something a capture has to catch.
 * Air outside; `filmIor` over a base of Fresnel reflectance `baseF0` (a
 * scalar: a dielectric's F0 is grey). Returns linear RGB reflectance.
 */
export function thinFilmReflectance(cosTheta1, filmIor, thicknessNm, baseF0) {
  const PI = Math.PI;
  const pow2 = (x) => x * x;
  // three's F_Schlick is the spherical-Gaussian fit, not pow(1 - c, 5).
  const schlick = (f0, f90, c) => { const f = 2 ** ((-5.55473 * c - 6.98316) * c); return f0 * (1 - f) + f90 * f; };
  const outside = 1;
  const t = Math.min(Math.max(thicknessNm / 0.03, 0), 1);
  const eta = outside + (filmIor - outside) * (t * t * (3 - 2 * t));
  const sin2Sq = pow2(outside / eta) * (1 - pow2(cosTheta1));
  const cos2Sq = 1 - sin2Sq;
  if (cos2Sq < 0) return [1, 1, 1];
  const cos2 = Math.sqrt(cos2Sq);
  const R0 = pow2((eta - outside) / (eta + outside));
  const R12 = schlick(R0, 1, cosTheta1);
  const T121 = 1 - R12;
  const phi12 = eta < outside ? PI : 0;
  const phi21 = PI - phi12;
  const s = Math.sqrt(Math.min(Math.max(baseF0, 0), 0.9999));
  const baseIor = (1 + s) / (1 - s);
  const R1 = pow2((baseIor - eta) / (baseIor + eta));
  const R23 = schlick(R1, 1, cos2);
  const phi23 = baseIor < eta ? PI : 0;
  const OPD = 2 * eta * thicknessNm * cos2;
  const phi = phi21 + phi23;
  const R123 = Math.min(Math.max(R12 * R23, 1e-5), 0.9999);
  const r123 = Math.sqrt(R123);
  const Rs = pow2(T121) * R23 / (1 - R123);
  const I = [R12 + Rs, R12 + Rs, R12 + Rs];
  let Cm = Rs - T121;
  // evalSensitivity: the CIE XYZ response of a phase shift, as three fits it.
  const val = [5.4856e-13, 4.4201e-13, 5.2481e-13];
  const pos = [1.6810e+06, 1.7953e+06, 2.2084e+06];
  const vr = [4.3278e+09, 9.3046e+09, 6.6121e+09];
  for (let m = 1; m <= 2; m += 1) {
    Cm *= r123;
    const phase = 2 * PI * (m * OPD) * 1e-9;
    const shift = m * phi;
    const xyz = [0, 1, 2].map((i) => val[i] * Math.sqrt(2 * PI * vr[i]) * Math.cos(pos[i] * phase + shift) * Math.exp(-pow2(phase) * vr[i]));
    xyz[0] += 9.7470e-14 * Math.sqrt(2 * PI * 4.5282e+09) * Math.cos(2.2399e+06 * phase + shift) * Math.exp(-4.5282e+09 * pow2(phase));
    const [X, Y, Z] = xyz.map((v) => v / 1.0685e-7);
    const rgb = [
      3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
      -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
      0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
    ];
    for (let i = 0; i < 3; i += 1) I[i] += Cm * 2 * rgb[i];
  }
  return I.map((v) => Math.max(v, 0));
}

/**
 * How much of the thin film a feather of this (LINEAR) vertex colour carries:
 * the JS reference for the mask installPlumageLighting writes into the
 * shader. 1 on the bronze (a warm hue, red the largest channel and green
 * between red and blue — 20-40% of the way to yellow — at a real
 * saturation), 0 on the red tail root, the teal flight feathers and the
 * violet body.
 */
export function bronzeFilmWeight(r, g, b) {
  const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
  const mx = Math.max(r, g, b);
  const chroma = mx - Math.min(r, g, b);
  const warm = (r >= mx && chroma > 1e-4) ? (g - Math.min(g, b)) / chroma : 0;
  return smooth(0.2, 0.4, warm) * smooth(0.15, 0.35, chroma / Math.max(mx, 1e-4));
}

/** Hue in degrees (0-360) of a linear RGB triple, or null for a grey. */
export function hueDegrees([r, g, b]) {
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (d < 1e-9) return null;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * The bird's own environment: a PMREM of the biome's sky gradient on the
 * feather materials, re-baked when the biome changes and turned every frame so
 * its zenith is the bird's local up.
 *
 * ONE PMREMGenerator and ONE render target for the session: the first bake
 * allocates them and every later bake re-renders into the same target, so a
 * biome switch costs a re-render and no GPU allocation. `dispose()` releases
 * both and takes the map back off the materials.
 */
export function createBirdEnvironment(THREE, renderer, materials, { width = 64, height = 32 } = {}) {
  const mats = (materials || []).filter(Boolean);
  let pmrem = null;
  let target = null;
  let bakes = 0;
  let sky = null;
  const _rot = { x: 0, y: 0 };
  const _up = { x: 0, y: 1, z: 0 };

  const env = {
    /** Bake `skyColors` ({ top, mid, horizon, bottom }) and bind it. */
    setSky(skyColors) {
      if (!skyColors || !renderer) return false;
      const source = buildEquirectSky(THREE, skyColors, { width, height });
      try {
        if (!pmrem) {
          pmrem = new THREE.PMREMGenerator(renderer);
          pmrem.compileEquirectangularShader();
        }
        // First bake: no target, so the generator allocates its ping-pong
        // buffers and blur materials along with the cube. Later bakes pass the
        // target back and render into it; the equirect size never changes, so
        // everything the first bake allocated still fits.
        target = pmrem.fromEquirectangular(source, target);
      } finally {
        source.dispose();
      }
      for (const m of mats) {
        if (m.envMap !== target.texture) {
          m.envMap = target.texture;
          m.needsUpdate = true;
        }
      }
      sky = skyColors;
      bakes += 1;
      return true;
    },
    /** Per frame, zero allocation: aim the bake's zenith at the local up. */
    update(position) {
      if (!position) return;
      const len = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);
      if (!(len > 1e-6)) return;
      _up.x = position.x / len; _up.y = position.y / len; _up.z = position.z / len;
      envRotationFor(_up.x, _up.y, _up.z, _rot);
      for (let i = 0; i < mats.length; i += 1) {
        const e = mats[i].envMapRotation;
        if (e) e.set(-_rot.x, -_rot.y, 0, 'XYZ');
      }
    },
    /** What is in force, for the debug hook and the realism checks. */
    state() {
      return {
        bakes,
        sky: sky ? { ...sky } : null,
        bound: mats.length > 0 && !!target && mats.every((m) => m.envMap === target.texture),
        cubeHeight: target?.height ?? null,
        up: { ..._up },
        rotation: { x: -_rot.x, y: -_rot.y },
      };
    },
    dispose() {
      for (const m of mats) {
        if (target && m.envMap === target.texture) {
          m.envMap = null;
          m.needsUpdate = true;
        }
      }
      target?.dispose();
      pmrem?.dispose();
      target = null;
      pmrem = null;
      sky = null;
    },
  };
  return env;
}
