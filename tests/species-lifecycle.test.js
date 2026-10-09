// The bird picker's LIFECYCLE (the review fixes on build v85): a crow or owl
// build that fails at ANY stage releases exactly what it made; a repeated
// swap/re-LOD plateaus; the bird sky's generator is shared and each probe's
// target released; the boot builds the crow/owl once, at the tier the boot
// settles on; the crow's take-off caw is the airborne rising edge (aeropose=0
// too); reduced motion freezes the owl's decorative train and key; and every
// lazily imported species module is precached for an offline boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { makeSpeciesStub } from './helpers/species-three-stub.js';
import { createSpeciesBird, OWL_CLOCKWORK, SPECIES_TIERS } from '../src/flight/species/species-bird.js';
import { featherTextureRefs, acquireFeatherTextures, releaseFeatherTextures } from '../src/flight/species/feather-textures.js';
import { createBirdEnvironment, sharedBirdPmrem } from '../src/flight/plumage.js';

const SPECIES = ['crow', 'owl'];
const KINDS = ['BufferGeometry', 'Material', 'Mesh', 'Group', 'Object3D', 'DataTexture'];
const aero = (o = {}) => ({ phase01: 0.1, depth: 1, envelope: 1, air: 1, splay: 0, ...o });

// ------------------------------------------------- item 3: exception safety

test('a build that throws at ANY construction releases every geometry/material it made and exactly one texture reference', () => {
  for (const s of SPECIES) {
    for (const q of SPECIES_TIERS) {
      // How many of each a clean build constructs: every one is a stage.
      const clean = makeSpeciesStub();
      createSpeciesBird(clean.THREE, { species: s, quality: q }).dispose();
      let stages = 0;
      for (const kind of KINDS) {
        for (let n = 1; n <= clean.made[kind]; n++) {
          // Fresh THREE: the shared textures start at zero references.
          const { THREE, live, made } = makeSpeciesStub({ failAt: { [kind]: n } });
          assert.throws(() => createSpeciesBird(THREE, { species: s, quality: q }), /injected/, `${s}/${q} ${kind}#${n}`);
          assert.equal(featherTextureRefs(THREE), 0, `${s}/${q} ${kind}#${n}: texture refs back to 0`);
          assert.equal(live.geometries.size, 0, `${s}/${q} ${kind}#${n}: ${live.geometries.size} geometries leaked`);
          assert.equal(live.materials.size, 0, `${s}/${q} ${kind}#${n}: ${live.materials.size} materials leaked`);
          assert.equal(live.textures.size, 0, `${s}/${q} ${kind}#${n}: ${live.textures.size} textures leaked`);
          assert.ok(made[kind] === n);
          stages += 1;
        }
      }
      assert.ok(stages >= 30, `${s}/${q}: walked ${stages} failure points`);
    }
  }
});

test('with another bird alive, a failed build gives back only ITS reference and leaves the shared textures intact', () => {
  for (const s of SPECIES) {
    const clean = makeSpeciesStub();
    createSpeciesBird(clean.THREE, { species: s, quality: 'high' }).dispose();
    for (const kind of ['BufferGeometry', 'Material', 'Mesh', 'Group']) {
      for (const n of [1, Math.max(1, clean.made[kind] >> 1), clean.made[kind]]) {
        // The live bird is built first, so the Nth construction is counted
        // from AFTER it: offset the fault by what the live bird made.
        const probe = makeSpeciesStub();
        const alive = createSpeciesBird(probe.THREE, { species: s, quality: 'high' });
        const before = { ...probe.made };
        alive.dispose();
        const { THREE, live } = makeSpeciesStub({ failAt: { [kind]: before[kind] + n } });
        const keep = createSpeciesBird(THREE, { species: s, quality: 'high' });
        const tex = [...live.textures];
        const geos = live.geometries.size;
        const mats = live.materials.size;
        assert.throws(() => createSpeciesBird(THREE, { species: s, quality: 'high' }), /injected/);
        assert.equal(featherTextureRefs(THREE), 1, `${s} ${kind}#${n}: the live bird still holds its reference`);
        assert.ok(tex.every((t) => !t.disposed), 'the shared textures were not disposed');
        assert.equal(live.geometries.size, geos, 'only the live bird\'s geometries remain');
        assert.equal(live.materials.size, mats, 'only the live bird\'s materials remain');
        keep.dispose();
        assert.equal(featherTextureRefs(THREE), 0);
        assert.equal(live.textures.size, 0);
      }
    }
  }
});

test('a texture set that fails half-way is disposed and leaves no entry; the next acquire starts clean', () => {
  for (let n = 1; n <= 10; n++) {
    const { THREE, live } = makeSpeciesStub({ failAt: { DataTexture: n } });
    assert.throws(() => acquireFeatherTextures(THREE), /injected/);
    assert.equal(live.textures.size, 0, `DataTexture#${n}: nothing held`);
    assert.equal(featherTextureRefs(THREE), 0);
    // The fault fired once; a retry builds the full set.
    const set = acquireFeatherTextures(THREE);
    assert.ok(set.engrave && set.contour.map);
    assert.equal(featherTextureRefs(THREE), 1);
    assert.equal(releaseFeatherTextures(THREE), true);
    assert.equal(live.textures.size, 0);
  }
});

// ------------------------------------- item 5: repeated swaps plateau (node)

test('Birb -> crow -> owl -> Birb x20 through every tier: geometries, materials and texture refs return to baseline', () => {
  const { THREE, live } = makeSpeciesStub();
  let current = null; // null = the Pionus
  let maxGeo = 0; let maxMat = 0; let maxTex = 0;
  const cycle = ['crow', 'owl', null];
  for (let i = 0; i < 20; i++) {
    for (const s of cycle) {
      // A re-LOD through all three tiers, then the swap: stage the new bird
      // complete, THEN dispose the old (the index.html transaction's order).
      for (const q of (s ? ['high', 'mid', 'low', 'high'] : [null])) {
        const next = s ? createSpeciesBird(THREE, { species: s, quality: q }) : null;
        if (current) current.dispose();
        current = next;
        maxGeo = Math.max(maxGeo, live.geometries.size);
        maxMat = Math.max(maxMat, live.materials.size);
        maxTex = Math.max(maxTex, live.textures.size);
      }
      // While a crow/owl flies it holds exactly one texture reference.
      assert.equal(featherTextureRefs(THREE), current ? 1 : 0);
    }
  }
  assert.equal(current, null, 'ends on Birb');
  assert.equal(live.geometries.size, 0);
  assert.equal(live.materials.size, 0);
  assert.equal(live.textures.size, 0, 'the last crow/owl gave the textures back');
  // The peak is two birds' worth (staged + outgoing) and one texture set.
  assert.ok(maxGeo <= 14 && maxMat <= 10 && maxTex === 10, `peak ${maxGeo} geometries, ${maxMat} materials, ${maxTex} textures`);
});

// --------------------------------------------- item 5: the shared generator

function fakeEnvThree() {
  const log = { generators: 0, compiled: 0, targets: 0, disposedTargets: 0, disposedGenerators: 0, failNext: false };
  class DataTexture { constructor(data, w, h) { this.image = { width: w, height: h }; } dispose() { this.disposed = true; } }
  class PMREMGenerator {
    constructor() { log.generators += 1; }
    compileEquirectangularShader() { log.compiled += 1; }
    fromEquirectangular(source, target) {
      if (log.failNext) { log.failNext = false; throw new Error('injected bake'); }
      if (target) return target;
      log.targets += 1;
      return { texture: { isTexture: true }, height: 64, dispose() { log.disposedTargets += 1; } };
    }
    dispose() { log.disposedGenerators += 1; }
  }
  return { THREE: { DataTexture, PMREMGenerator, RGBAFormat: 'rgba', FloatType: 'float', EquirectangularReflectionMapping: 303 }, log };
}
const fakeMaterial = () => ({ envMap: null, needsUpdate: false, envMapRotation: { set() { return this; } } });
const SKY = { top: 0x397da7, mid: 0x91bdb9, horizon: 0xffe0a1, bottom: 0x3c665d };

test('every bird sky shares the renderer\'s ONE generator; each probe releases only its own target', () => {
  const { THREE, log } = fakeEnvThree();
  const renderer = {};
  const g = sharedBirdPmrem(THREE, renderer);
  assert.equal(sharedBirdPmrem(THREE, renderer), g, 'one per renderer');
  assert.notEqual(sharedBirdPmrem(THREE, {}), g, 'a second renderer gets its own');
  const generatorsBefore = log.generators;
  for (let i = 0; i < 30; i++) {
    const env = createBirdEnvironment(THREE, renderer, [fakeMaterial(), fakeMaterial()], { pmrem: g });
    env.setSky(SKY);
    env.setSky(SKY); // a biome switch re-renders into the same target
    env.dispose();
  }
  assert.equal(log.generators, generatorsBefore, 'no generator per probe');
  assert.equal(log.compiled, 2, 'compiled once per renderer, never per probe');
  assert.equal(log.targets, 30);
  assert.equal(log.disposedTargets, 30, 'every probe target released');
  assert.equal(log.disposedGenerators, 0, 'the shared generator outlives every bird');
});

test('a probe whose first bake throws holds nothing; one that fails on a later bake releases its target on dispose', () => {
  const { THREE, log } = fakeEnvThree();
  const renderer = {};
  const g = sharedBirdPmrem(THREE, renderer);
  const m = fakeMaterial();
  const a = createBirdEnvironment(THREE, renderer, [m], { pmrem: g });
  log.failNext = true;
  assert.throws(() => a.setSky(SKY), /injected/);
  a.dispose();
  assert.equal(log.targets, 0);
  assert.equal(m.envMap, null);
  const b = createBirdEnvironment(THREE, renderer, [m], { pmrem: g });
  b.setSky(SKY);
  log.failNext = true;
  assert.throws(() => b.setSky(SKY), /injected/);
  b.dispose();
  assert.equal(log.disposedTargets, 1);
  assert.equal(log.disposedGenerators, 0);
});

// ---------------------------------------- item 1: the boot builds ONCE

test('index.html: the boot tier table matches what restoreQualityPreset pins, and the LOD follows the live tier only after it', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const table = /const BOOT_TIER_BY_PRESET = \{([^}]*)\}/.exec(html);
  assert.ok(table, 'BOOT_TIER_BY_PRESET');
  const boot = Object.fromEntries([...table[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const presets = [...html.matchAll(/id: '(ultra|amazing|okay|light)', label: '[^']*', tier: (null|\d+)/g)];
  assert.equal(presets.length, 4);
  for (const [, id, tier] of presets) {
    // A pinned preset settles on its tier; AUTO (null) starts at 0.
    assert.equal(boot[id], tier === 'null' ? 0 : Number(tier), `${id}`);
  }
  // The boot bird is built from the readout; the readout switches to the live
  // tier right after restoreQualityPreset() and one catch-up runs there.
  const restore = html.indexOf('\n    restoreQualityPreset();');
  const after = html.slice(restore, restore + 600);
  assert.ok(/adaptiveTierReadout = \(\) => adaptiveTier\.getTier\(\);\s*runSpeciesRetier\(\);/.test(after));
  assert.equal(html.split('adaptiveTierReadout = () => adaptiveTier.getTier()').length, 2, 'switched in exactly one place');
  assert.ok(html.includes('makeSpeciesBird(birbSpecies, speciesModule.speciesTierFor(adaptiveTierReadout()))'));
});

// ------------------------------------------- item 7: the crow's take-off caw

function crowCalls(frames) {
  const { THREE } = makeSpeciesStub();
  const b = createSpeciesBird(THREE, { species: 'crow', quality: 'high' });
  const calls = [];
  frames.forEach((f, i) => { b.update({ dt: 1 / 60, perch: 0, reducedMotion: false, ...f }); if (b.events.call) calls.push(i); });
  b.dispose();
  return calls;
}

test('crow caw: the flight controller\'s airborne RISING EDGE, however slow the climb, and never on the first frame', () => {
  const ground = Array.from({ length: 30 }, () => ({ airborne: false, aeroLive: true, aero: aero({ air: 0 }) }));
  // A gradual take-off: `air` creeps 0 -> 1 over two seconds, the controller
  // says airborne part-way through.
  const climb = Array.from({ length: 120 }, (_, i) => ({ airborne: i >= 20, aeroLive: true, aero: aero({ air: i / 119 }) }));
  assert.deepEqual(crowCalls([...ground, ...climb]), [30 + 20]);
  // Landing and relaunching: one call per take-off (the audio rate-limits).
  const land = Array.from({ length: 30 }, () => ({ airborne: false, aeroLive: true, aero: aero({ air: 0 }) }));
  const up = Array.from({ length: 30 }, () => ({ airborne: true, aeroLive: true, aero: aero({ air: 1 }) }));
  assert.deepEqual(crowCalls([...ground, ...up, ...land, ...up]), [30, 90]);
  // A bird built in mid-air (boot, swap, re-LOD) has not taken off.
  assert.deepEqual(crowCalls(up), []);
});

test('crow caw: works with ?aeropose=0 (no aero pose, `air` never moves)', () => {
  const off = (airborne) => ({ airborne, aeroLive: false, aero: null });
  const frames = [...Array(20).fill(off(false)), ...Array(20).fill(off(true)), ...Array(20).fill(off(false)), ...Array(5).fill(off(true))];
  assert.deepEqual(crowCalls(frames), [20, 60]);
});

test('crow caw: without the airborne flag, the aero `air` decides with hysteresis (0.3 / 0.7), not a one-frame jump', () => {
  // Gradual: 0 -> 1 in 0.02 steps (no single update jumps 0.3 -> 0.7).
  const ramp = Array.from({ length: 51 }, (_, i) => ({ aeroLive: true, aero: aero({ air: i / 50 }) }));
  assert.deepEqual(crowCalls(ramp), [36], 'fires once, where air first exceeds 0.7');
  // Dithering between 0.4 and 0.8 after take-off does not re-fire; a drop to
  // 0.3 re-arms it.
  const dither = [0.4, 0.8, 0.5, 0.75, 0.45].map((air) => ({ aeroLive: true, aero: aero({ air }) }));
  const rearm = [0.3, 0.5, 0.71].map((air) => ({ aeroLive: true, aero: aero({ air }) }));
  assert.deepEqual(crowCalls([...ramp, ...dither, ...rearm]), [36, 51 + 5 + 2]);
});

test('crow caw: a boost STARTING calls; a bird built mid-boost does not', () => {
  const f = (boosting) => ({ airborne: true, boosting, aeroLive: true, aero: aero() });
  assert.deepEqual(crowCalls([f(false), f(false), f(true), f(true), f(false), f(true)]), [2, 5]);
  assert.deepEqual(crowCalls([f(true), f(true)]), []);
});

// --------------------------------------- item 9: reduced motion, the owl

test('owl, reduced motion: the gears and key HOLD through sustained beats and boosts, and resume without a jump', () => {
  const { THREE } = makeSpeciesStub();
  const b = createSpeciesBird(THREE, { species: 'owl', quality: 'high' });
  const dt = 1 / 60;
  let phase = 0;
  const frame = (reducedMotion, boosting) => {
    phase = (phase + dt * 2.2) % 1;
    b.update({ dt, perch: 0, airborne: true, aeroLive: true, aero: aero({ phase01: phase }), boosting, reducedMotion });
  };
  for (let i = 0; i < 120; i++) frame(false, false);
  const gear0 = b.mech.gear.rotation.y;
  const key0 = b.mech.key.rotation.y;
  // Ten seconds of beating and boosting with reduced motion on.
  for (let i = 0; i < 600; i++) frame(true, i % 120 < 60);
  assert.equal(b.mech.gear.rotation.y, gear0, 'the train holds');
  assert.equal(b.mech.key.rotation.y, key0, 'the key holds, boost or not');
  // Off again, boosting: the first frame moves the key by one frame's spin
  // and the train by at most one tooth — no catch-up.
  frame(false, true);
  const dKey = Math.abs(b.mech.key.rotation.y - key0);
  const dGear = Math.abs(b.mech.gear.rotation.y - gear0);
  assert.ok(dKey <= OWL_CLOCKWORK.keyBoost * dt + 1e-9, `key moved ${dKey}`);
  assert.ok(dGear <= OWL_CLOCKWORK.gearTooth + 1e-9, `train moved ${dGear}`);
  // And it runs normally after that.
  for (let i = 0; i < 120; i++) frame(false, true);
  assert.notEqual(b.mech.key.rotation.y, key0);
  assert.notEqual(b.mech.gear.rotation.y, gear0);
  b.dispose();
});

// ------------------------------------------- item 10: offline, every module

test('sw.js precaches every species module and everything species-bird.js imports, so an offline crow/owl boots', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const core = sw.slice(sw.indexOf('const CORE_ASSETS = ['), sw.indexOf('];', sw.indexOf('const CORE_ASSETS = [')));
  const listed = new Set([...core.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));
  for (const f of readdirSync(new URL('../src/flight/species/', import.meta.url))) {
    if (f.endsWith('.js')) assert.ok(listed.has('src/flight/species/' + f), `CORE_ASSETS lists src/flight/species/${f}`);
  }
  // The lazy import's whole static graph, walked from the files themselves.
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    assert.ok(listed.has(rel), `CORE_ASSETS lists ${rel} (imported by the species graph)`);
    const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'(\.[^']+)'/gm)) {
      walk(new URL(m[1], new URL('../' + rel, import.meta.url)).pathname.replace(new URL('../', import.meta.url).pathname, ''));
    }
  };
  walk('src/flight/species/species-bird.js');
  assert.ok(seen.size >= 10, `walked ${seen.size} modules`);
  // And index.html's lazy import is exactly that entry point.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const m of html.matchAll(/import\('\.\/(src\/flight\/species\/[^']+)'\)/g)) assert.ok(listed.has(m[1]), m[1]);
});
