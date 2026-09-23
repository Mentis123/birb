/**
 * Physical plumage (src/flight/plumage.js).
 *
 * Three things are pinned here, each because it can be wrong without looking
 * wrong in a single capture:
 *
 *  - the THIN FILM's colour at an angle, through the same formula three's
 *    shader evaluates (a film tuned by eye to one pose can be the wrong colour
 *    at every other one — and "bronze shifts toward green at grazing" is the
 *    whole claim);
 *  - the ENV ROTATION, through the exact arithmetic three applies to
 *    `envMapRotation` (it negates the Euler before building the matrix, so a
 *    rotation that looks right in isolation can be the inverse on the GPU);
 *  - the SHADER PATCH's chain and anchor (this repo has shipped a patch that
 *    silently never matched, and one that silently erased another).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  plumageRequested, PLUMAGE, KERATIN_IOR, plumageFor, plumageMaterialParams,
  installPlumageLighting, envRotationFor, thinFilmReflectance, hueDegrees, createBirdEnvironment,
  bronzeFilmWeight, linearGreyHex,
} from '../src/flight/plumage.js';
import { addRimLight, addFeatherSheen } from '../src/environment/visual-style.js';
import { readBootFlag, bootFlagByKey } from '../src/ui/boot-flags.js';

const THREE_STUB = {
  DoubleSide: 2,
  Color: class { constructor(hex) { this.hex = hex; } },
  Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
};

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test('plumage is on by default and only ?plumage=0 turns it off', () => {
  assert.equal(plumageRequested(''), true);
  assert.equal(plumageRequested(undefined), true);
  assert.equal(plumageRequested('?debug=1'), true);
  assert.equal(plumageRequested('?plumage=0'), false);
  assert.equal(plumageRequested('?debug=1&plumage=0'), false);
  assert.equal(plumageRequested('?plumage=1'), true);
  assert.equal(plumageRequested('?plumages=0'), true, 'a longer key must not match');
});

test('the Flags tab reads the flag exactly as the game does', () => {
  const flag = bootFlagByKey('plumage');
  assert.ok(flag, 'no ?plumage entry in the boot-flag table');
  assert.equal(flag.kind, 'toggle');
  assert.equal(flag.group, 'Bird');
  for (const search of ['', '?debug=1', '?plumage=0', '?debug=1&plumage=0', '?plumage=1']) {
    assert.equal(readBootFlag(search, 'plumage').on, plumageRequested(search), search);
  }
});

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

test('feathers are keratin: dielectric, n = 1.56, on both parts of both palettes', () => {
  assert.ok(Math.abs(KERATIN_IOR - 1.56) < 1e-9);
  for (const palette of [PLUMAGE.pionus, PLUMAGE.blue]) {
    for (const part of [palette.contour, palette.vane]) {
      assert.equal(part.metalness, 0, 'a feather is not a metal; the env map is what the metal was faking');
      assert.equal(part.ior, KERATIN_IOR);
      assert.ok(part.envMapIntensity > 0, 'nothing to reflect is the defect this exists to fix');
      // The Standard bird's ambient lift was 0.34 with nothing to reflect.
      assert.ok(part.emissiveIntensity < 0.34, 'the constant lift must come down now the sky lights the bird');
    }
  }
});

test('the albedo keeps the diffuse energy the metal-faked Standard bird had', () => {
  // A metalness m takes (1 - m) of the diffuse away. The Standard bird was
  // contour 0.12 / vane 0.34 (pionus) or 0.16 (blue); a dielectric gets all
  // of it back unless the albedo carries the same factor. Measured before
  // this existed: the wing +51% brighter from the metalness change alone.
  const was = { pionus: { contour: 0.12, vane: 0.34 }, blue: { contour: 0.12, vane: 0.16 } };
  for (const [palette, parts] of Object.entries(was)) {
    for (const [part, metal] of Object.entries(parts)) {
      assert.ok(Math.abs(PLUMAGE[palette][part].albedo - (1 - metal)) < 1e-9, `${palette}.${part}`);
      const p = PLUMAGE[palette][part];
      assert.ok(p.specularIntensity > 0 && p.specularIntensity <= 1, `${palette}.${part} specularIntensity`);
    }
  }
  // The hex handed to three decodes back to that linear level.
  for (const v of [0.66, 0.84, 0.88]) {
    const byte = linearGreyHex(v) & 0xff;
    const c = byte / 255;
    const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    assert.ok(Math.abs(linear - v) < 0.005, `${v} -> #${linearGreyHex(v).toString(16)} -> ${linear}`);
    assert.equal(linearGreyHex(v) >> 16, byte, 'a grey: every channel equal');
  }
  assert.equal(plumageMaterialParams(THREE_STUB, 'vane', { pionus: true }).color, linearGreyHex(0.66));
});

test('the body carries sheen; only the bronze wing carries a film', () => {
  for (const palette of [PLUMAGE.pionus, PLUMAGE.blue]) {
    assert.ok(palette.contour.sheen > 0);
    assert.ok(palette.contour.sheenRoughness > 0 && palette.contour.sheenRoughness <= 1);
  }
  const v = PLUMAGE.pionus.vane;
  assert.equal(v.iridescence, 1);
  // A film thinner in index than the keratin under it has no phase flip at
  // the top face and a very different colour sequence; this pair is chosen as
  // a denser layer (melanin-rich) over keratin.
  assert.ok(v.iridescenceIOR > KERATIN_IOR);
  const [lo, hi] = v.iridescenceThicknessRange;
  assert.ok(lo < hi && hi >= 100 && hi <= 1000, 'visible-light interference lives at 100-1000 nm');
  assert.ok(!PLUMAGE.blue.vane.iridescence, 'a blue jay is scattering blue, not a film; it does not shift with angle');
  assert.equal(plumageFor(true), PLUMAGE.pionus);
  assert.equal(plumageFor(false), PLUMAGE.blue);
});

test('material params are fresh objects the caller can hand to three', () => {
  const a = plumageMaterialParams(THREE_STUB, 'vane', { pionus: true });
  const b = plumageMaterialParams(THREE_STUB, 'vane', { pionus: true });
  assert.notEqual(a.iridescenceThicknessRange, b.iridescenceThicknessRange);
  a.iridescenceThicknessRange[1] = 9999;
  assert.equal(PLUMAGE.pionus.vane.iridescenceThicknessRange[1], b.iridescenceThicknessRange[1]);
  assert.equal(a.side, THREE_STUB.DoubleSide, 'the wing plates are seen from both sides');
  assert.equal(a.vertexColors, true);
  const c = plumageMaterialParams(THREE_STUB, 'contour', { pionus: true });
  assert.equal(c.side, undefined, 'the hull is FrontSide; its winding was fixed to make that true');
  assert.equal(c.sheen, PLUMAGE.pionus.contour.sheen);
  assert.equal(c.iridescence, undefined);
  // The palette's ambient-lift COLOUR is kept; only its intensity moves.
  assert.equal(c.emissive, 0x1c1828);
  assert.equal(plumageMaterialParams(THREE_STUB, 'contour', { pionus: false }).emissive, 0x0f1f45);
  assert.throws(() => plumageMaterialParams(THREE_STUB, 'beak'));
});

// ---------------------------------------------------------------------------
// The film
// ---------------------------------------------------------------------------

const keratinF0 = ((KERATIN_IOR - 1) / (KERATIN_IOR + 1)) ** 2;

test('a film of zero thickness is (nearly) bare keratin, and grey', () => {
  // A known point of the transcription: with no film there is nothing to
  // interfere, so there is no colour, and the reflectance is the substrate's
  // own F0 give or take the residue of three's spherical-Gaussian Schlick,
  // which does not reach exactly zero at normal incidence (measured 0.054
  // against F0 0.048).
  const r = thinFilmReflectance(1, 1.8, 0, keratinF0);
  assert.ok(Math.max(...r) - Math.min(...r) < 0.003, `a zero film has a colour: ${r}`);
  for (const c of r) assert.ok(Math.abs(c / keratinF0 - 1) < 0.2, `got ${r} against F0 ${keratinF0}`);
});

test('the bronze wing reflects COPPER face-on, GOLD at mid angles and runs toward GREEN at grazing', () => {
  const v = PLUMAGE.pionus.vane;
  const d = v.iridescenceThicknessRange[1]; // three uses the maximum with no thickness map
  const hueAt = (cos) => hueDegrees(thinFilmReflectance(cos, v.iridescenceIOR, d, keratinF0));
  const faceOn = hueAt(1);
  const mid = hueAt(0.6);
  const grazing = hueAt(0.2);
  assert.ok(faceOn >= 5 && faceOn <= 45, `face-on hue ${faceOn.toFixed(1)} is not copper/bronze`);
  assert.ok(mid >= 40 && mid <= 70, `mid-angle hue ${mid.toFixed(1)} is not gold`);
  assert.ok(grazing >= 85 && grazing <= 140, `grazing hue ${grazing.toFixed(1)} has not reached yellow-green`);
  // And it TRAVELS there — through gold and yellow, not by jumping through
  // red or blue on the way.
  let last = faceOn;
  for (const cos of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]) {
    const h = hueAt(cos);
    assert.ok(h >= last - 1, `hue went backwards at cos ${cos}: ${last.toFixed(1)} -> ${h.toFixed(1)}`);
    last = h;
  }
  // A film is a stronger mirror than bare keratin where it interferes
  // constructively — that is where the colour comes from.
  const faceOnR = thinFilmReflectance(1, v.iridescenceIOR, d, keratinF0);
  assert.ok(Math.max(...faceOnR) > 2 * keratinF0);
});

// ---------------------------------------------------------------------------
// The env rotation, through three's own arithmetic
// ---------------------------------------------------------------------------

// Matrix4.makeRotationFromEuler, order 'XYZ', as a 3x3 row-major array.
function rotationXYZ(x, y, z) {
  const a = Math.cos(x); const b = Math.sin(x);
  const c = Math.cos(y); const d = Math.sin(y);
  const e = Math.cos(z); const f = Math.sin(z);
  const ae = a * e; const af = a * f; const be = b * e; const bf = b * f;
  return [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
}
// WebGLMaterials.refreshUniformsCommon: copy the material's Euler, negate all
// three angles ("accommodate left-handed frame"), build the matrix. A PMREM
// target is a render-target texture, so no extra flip applies.
function shaderEnvMatrix(materialEuler) {
  return rotationXYZ(-materialEuler.x, -materialEuler.y, -materialEuler.z);
}
const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };

test('the env zenith lands on the bird\'s radial up, everywhere on the planet', () => {
  const ups = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [0.03, -1, 0.02], [1, 0.02, 0.03], [0.6, 0.5, -0.62], [-0.2, -0.7, 0.68],
    [1e-7, 1, 0], [0, 1, 1e-9], [0, -1, 1e-9],
  ].map(norm);
  for (const u of ups) {
    const r = envRotationFor(u[0], u[1], u[2], { x: 0, y: 0 });
    // What createBirdEnvironment writes into material.envMapRotation.
    const materialEuler = { x: -r.x, y: -r.y, z: 0 };
    const z = mul(shaderEnvMatrix(materialEuler), u);
    assert.ok(Math.abs(z[0]) < 1e-9 && Math.abs(z[1] - 1) < 1e-9 && Math.abs(z[2]) < 1e-9,
      `up ${u.map((c) => c.toFixed(3))} maps to ${z.map((c) => c.toFixed(6))}, not the zenith`);
  }
});

test('at the spawn pole the rotation is the identity (the plain bake, as ?ibl installs it)', () => {
  const r = envRotationFor(0, 1, 0, { x: 9, y: 9 });
  assert.ok(r.x === 0 && r.y === 0, `got ${r.x}, ${r.y}`); // -0 is fine
});

test('without the negation three applies, the same angles would be wrong', () => {
  // The control for the test above: writing the angles un-negated puts the
  // zenith somewhere else entirely off the pole. If this ever passes, the
  // test above is not measuring the convention it claims to.
  // (Not on the equator's +X: rotating the other way round happens to work
  // there too, by symmetry, which is exactly why a control must be chosen.)
  for (const u of [norm([0.6, 0.5, -0.62]), norm([-0.2, -0.7, 0.68])]) {
    const r = envRotationFor(u[0], u[1], u[2], { x: 0, y: 0 });
    const z = mul(shaderEnvMatrix({ x: r.x, y: r.y, z: 0 }), u);
    assert.ok(Math.abs(z[1] - 1) > 0.5, `un-negated angles still hit the zenith (${z})`);
  }
});

// ---------------------------------------------------------------------------
// The shader patch
// ---------------------------------------------------------------------------

const FRAG = [
  'void main() {',
  '#include <lights_physical_fragment>',
  '#include <lights_fragment_begin>',
  '#include <lights_fragment_maps>',
  '#include <lights_fragment_end>',
  '#include <opaque_fragment>',
  '}',
].join('\n');
const physical = () => ({ isMeshStandardMaterial: true, isMeshPhysicalMaterial: true, userData: {} });
const compile = (m, frag = FRAG) => {
  const shader = { uniforms: {}, fragmentShader: frag, vertexShader: '' };
  m.onBeforeCompile(shader, null);
  return shader;
};

test('the hemisphere moves into the IBL slot right after the maps include, which stays', () => {
  const m = physical();
  installPlumageLighting(m, THREE_STUB);
  const { fragmentShader: fs, uniforms } = compile(m);
  const include = fs.indexOf('#include <lights_fragment_maps>');
  const move = fs.indexOf('iblIrradiance = iblIrradiance * uPlumageEnvDiffuse + irradiance * uPlumageHemi;');
  const zero = fs.indexOf('irradiance = vec3( 0.0 );');
  const end = fs.indexOf('#include <lights_fragment_end>');
  assert.ok(include >= 0, 'the include itself must survive; three expands it after this');
  assert.ok(move > include && zero > move && end > zero, 'the move must sit between maps and end');
  assert.ok(/#if defined\( RE_IndirectDiffuse \) && defined\( RE_IndirectSpecular \)/.test(fs));
  assert.equal((fs.match(/uniform float uPlumageHemi;/g) || []).length, 1);
  assert.equal(uniforms.uPlumageHemi.value, 1);
  assert.equal(uniforms.uPlumageEnvDiffuse.value, 0);
});

// sRGB hex -> linear, the way three hands vertex colours to the shader.
const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
  .map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

test('the film lives on the bronze feathers, not the red tail or the teal primaries', () => {
  // The Pionus palette, as createProceduralBirbV3 paints the vane geometry.
  const back = lin(0x8a6c39); const lit = lin(0xc79a4e);
  const flight = lin(0x1e3f52); const edge = lin(0x2f8378);
  const red = lin(0xd4343c); const body = lin(0x6b6494);
  for (const [what, c] of [
    ['mantle bronze', back], ['lit covert', lit], ['covert blend', mixc(back, lit, 0.3)],
    ['secondary root', mixc(back, flight, 0.18)], ['secondary tip', mixc(back, flight, 0.6)],
  ]) assert.ok(bronzeFilmWeight(...c) > 0.95, `${what} should carry the film (${bronzeFilmWeight(...c)})`);
  for (const [what, c] of [
    ['flight feather', flight], ['feather edge', edge], ['primary', mixc(flight, edge, 0.3)],
    ['tail root red', red], ['red into teal', mixc(red, flight, 0.5)], ['violet body', body],
  ]) assert.ok(bronzeFilmWeight(...c) < 0.05, `${what} must not carry the film (${bronzeFilmWeight(...c)})`);

  // And the shader applies the same rule where three has just set the film
  // strength, before the lights read it.
  const m = physical();
  installPlumageLighting(m, THREE_STUB);
  const { fragmentShader: fs, uniforms } = compile(m);
  const set = fs.indexOf('#include <lights_physical_fragment>');
  const mask = fs.indexOf('material.iridescence *= mix( 1.0, plumBronze, uPlumageFilmMask );');
  const lights = fs.indexOf('#include <lights_fragment_begin>');
  assert.ok(set >= 0 && mask > set && lights > mask, 'the mask must sit between the material setup and the lights');
  assert.match(fs, /smoothstep\( 0\.2, 0\.4, plumWarm \) \* smoothstep\( 0\.15, 0\.35,/, 'GLSL and JS thresholds must agree');
  assert.match(fs, /#if defined\( USE_IRIDESCENCE \) && defined\( USE_COLOR \)/);
  assert.equal(uniforms.uPlumageFilmMask.value, 1);
});

test('it CHAINS the rim light and the feather sheen, and extends their cache key', () => {
  const m = physical();
  addRimLight(m, THREE_STUB);
  addFeatherSheen(m, THREE_STUB);
  installPlumageLighting(m, THREE_STUB);
  const { fragmentShader: fs, uniforms } = compile(m);
  assert.match(fs, /uBirbRimColor/, 'the rim light was erased');
  assert.match(fs, /uSheenWarm/, 'the feather sheen was erased');
  assert.match(fs, /uPlumageHemi/);
  assert.ok(uniforms.uBirbRimColor && uniforms.uSheenWarm && uniforms.uPlumageHemi);
  assert.equal(m.customProgramCacheKey(), 'birb-rim-v1-sheen|plumage-v1');
  const bare = physical(); addRimLight(bare, THREE_STUB); addFeatherSheen(bare, THREE_STUB);
  assert.notEqual(m.customProgramCacheKey(), bare.customProgramCacheKey(),
    'a plumage program must never be shared with a bare one');
});

test('a shader without the include is left alone, loudly', () => {
  const m = physical();
  installPlumageLighting(m, THREE_STUB);
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const frag = 'void main() {\n#include <opaque_fragment>\n}';
    const { fragmentShader: fs } = compile(m, frag);
    assert.equal(fs, frag, 'nothing may be injected without the anchor');
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1, 'birb-modes fails on warnings, which is the point');
});

test('it refuses what has no IBL slot, and installs once', () => {
  assert.equal(installPlumageLighting(null, THREE_STUB), null);
  assert.equal(installPlumageLighting({ isMeshBasicMaterial: true, userData: {} }, THREE_STUB), null);
  const m = physical();
  const first = installPlumageLighting(m, THREE_STUB);
  assert.equal(installPlumageLighting(m, THREE_STUB), first);
  const { fragmentShader: fs } = compile(m);
  assert.equal((fs.match(/iblIrradiance = iblIrradiance/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// The bird's environment
// ---------------------------------------------------------------------------

function fakeEnvThree() {
  const log = { generators: 0, fromEquirect: [], sources: [], disposedTargets: 0, disposedGenerators: 0, compiled: 0 };
  class DataTexture {
    constructor(data, w, h) { this.data = data; this.image = { width: w, height: h }; log.sources.push(this); }
    dispose() { this.disposed = true; }
  }
  class PMREMGenerator {
    constructor(renderer) { this.renderer = renderer; log.generators += 1; }
    compileEquirectangularShader() { log.compiled += 1; }
    fromEquirectangular(source, target) {
      log.fromEquirect.push({ source, target });
      return target || { texture: { isTexture: true }, height: 64, dispose() { log.disposedTargets += 1; } };
    }
    dispose() { log.disposedGenerators += 1; }
  }
  return {
    THREE: { DataTexture, PMREMGenerator, RGBAFormat: 'rgba', FloatType: 'float', EquirectangularReflectionMapping: 303 },
    log,
  };
}
const fakeMaterial = () => {
  const euler = { x: 0, y: 0, z: 0, order: 'XYZ', set(x, y, z, o) { this.x = x; this.y = y; this.z = z; this.order = o; return this; } };
  return { envMap: null, envMapRotation: euler, needsUpdate: false };
};
const FOREST = { top: 0x397da7, mid: 0x91bdb9, horizon: 0xffe0a1, bottom: 0x3c665d };
const CITY = { top: 0x283a75, mid: 0x748da9, horizon: 0xe5b7a0, bottom: 0x283c55 };

test('a bake binds one PMREM to both materials; a re-bake reuses it', () => {
  const { THREE, log } = fakeEnvThree();
  const a = fakeMaterial(); const b = fakeMaterial();
  const env = createBirdEnvironment(THREE, {}, [a, b]);
  assert.equal(env.setSky(FOREST), true);
  assert.ok(a.envMap && a.envMap === b.envMap, 'both feather materials reflect the same sky');
  assert.ok(a.needsUpdate && b.needsUpdate);
  assert.equal(log.sources[0].disposed, true, 'the float equirect is released once prefiltered');
  assert.equal(log.fromEquirect[0].target, null, 'the first bake lets the generator allocate');
  const first = a.envMap;
  a.needsUpdate = false;
  env.setSky(CITY);
  assert.equal(log.generators, 1, 'one generator for the session');
  assert.equal(log.compiled, 1);
  assert.ok(log.fromEquirect[1].target, 'the second bake renders into the first target');
  assert.equal(a.envMap, first, 'same texture object, so no program change and no GPU allocation');
  assert.equal(a.needsUpdate, false);
  assert.equal(env.state().bakes, 2);
  assert.equal(env.state().bound, true);
  assert.equal(env.setSky(null), false);
  assert.equal(env.state().bakes, 2);
});

test('update() aims the zenith through the materials\' own Euler objects', () => {
  const { THREE } = fakeEnvThree();
  const a = fakeMaterial(); const b = fakeMaterial();
  const eulerA = a.envMapRotation;
  const env = createBirdEnvironment(THREE, {}, [a, b]);
  env.setSky(FOREST);
  env.update({ x: 118, y: 3, z: 4 }); // on the equator
  assert.equal(a.envMapRotation, eulerA, 'written in place, never replaced');
  const u = norm([118, 3, 4]);
  for (const m of [a, b]) {
    const z = mul(shaderEnvMatrix(m.envMapRotation), u);
    assert.ok(Math.abs(z[1] - 1) < 1e-9, `zenith ${z}`);
  }
  // Degenerate input changes nothing rather than writing NaN.
  const before = { ...a.envMapRotation };
  env.update({ x: 0, y: 0, z: 0 });
  env.update(null);
  assert.equal(a.envMapRotation.x, before.x);
  assert.ok(Number.isFinite(a.envMapRotation.y));
});

test('dispose() takes the map back off and releases the GPU objects', () => {
  const { THREE, log } = fakeEnvThree();
  const a = fakeMaterial();
  const env = createBirdEnvironment(THREE, {}, [a]);
  env.setSky(FOREST);
  env.dispose();
  assert.equal(a.envMap, null);
  assert.equal(log.disposedTargets, 1);
  assert.equal(log.disposedGenerators, 1);
  assert.equal(env.state().bound, false);
});
