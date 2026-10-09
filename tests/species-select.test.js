// The bird picker's resolution rules (src/flight/species/species-select.js):
// URL > saved > default, the Pionus A/B flags untouched, invalid values
// harmless, and the default boot path pinned to the Pionus with no species
// builder loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPECIES, DEFAULT_SPECIES, SPECIES_STORAGE_KEY, SPECIES_LABELS,
  resolveSpecies, readSavedSpecies, writeSavedSpecies, nextSpecies, birdParam, isSpecies,
} from '../src/flight/species/species-select.js';

function store(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    map: m,
  };
}

test('three species, birb first and the default, stored under birb.species', () => {
  assert.deepEqual([...SPECIES], ['birb', 'crow', 'owl']);
  assert.equal(DEFAULT_SPECIES, 'birb');
  assert.equal(SPECIES_STORAGE_KEY, 'birb.species');
  assert.deepEqual({ ...SPECIES_LABELS }, { birb: 'Birb', crow: 'Crow', owl: 'Clockwork Owl' });
});

test('no URL, nothing saved: the Pionus (v3)', () => {
  assert.deepEqual(resolveSpecies('', store()), { species: 'birb', source: 'default', variant: 'v3' });
  assert.deepEqual(resolveSpecies('?debug=1', null), { species: 'birb', source: 'default', variant: 'v3' });
});

test('the saved choice applies when the URL says nothing', () => {
  assert.deepEqual(resolveSpecies('?debug=1', store({ 'birb.species': 'owl' })), { species: 'owl', source: 'saved', variant: 'v3' });
  assert.deepEqual(resolveSpecies('', store({ 'birb.species': 'crow' })), { species: 'crow', source: 'saved', variant: 'v3' });
});

test('?bird=crow|owl|birb wins over the saved choice', () => {
  const s = store({ 'birb.species': 'owl' });
  assert.equal(resolveSpecies('?bird=crow', s).species, 'crow');
  assert.equal(resolveSpecies('?debug=1&bird=birb', s).species, 'birb');
  assert.equal(resolveSpecies('?bird=owl&debug=1', store({ 'birb.species': 'crow' })).species, 'owl');
  assert.equal(resolveSpecies('?bird=crow', s).source, 'url');
});

test('the URL override is not written back', () => {
  const s = store({ 'birb.species': 'owl' });
  resolveSpecies('?bird=crow', s);
  assert.equal(s.getItem('birb.species'), 'owl');
  const empty = store();
  resolveSpecies('?bird=owl', empty);
  assert.equal(empty.map.size, 0);
});

test('?bird=v1|v2|v3 keep working exactly as the Pionus A/B: species birb, that variant, even over a saved crow', () => {
  const s = store({ 'birb.species': 'crow' });
  for (const v of ['v1', 'v2', 'v3']) {
    assert.deepEqual(resolveSpecies(`?bird=${v}`, s), { species: 'birb', source: 'url', variant: v });
    assert.deepEqual(resolveSpecies(`?debug=1&bird=${v}&x=1`, s), { species: 'birb', source: 'url', variant: v });
  }
});

test('index.html still resolves the A/B variant with its own, unchanged regex', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes("((/[?&]bird=(v1|v2|v3)(?:&|$)/.exec(window.location?.search || '') || [])[1] || 'v3')"),
    'the v1/v2/v3 selector line must be byte-identical');
});

test('invalid values fall back: a bad URL value is ignored, a bad saved value is absent', () => {
  assert.deepEqual(resolveSpecies('?bird=eagle', store()), { species: 'birb', source: 'default', variant: 'v3' });
  assert.equal(resolveSpecies('?bird=eagle', store({ 'birb.species': 'owl' })).species, 'owl');
  assert.equal(resolveSpecies('?bird=', store()).species, 'birb');
  assert.equal(resolveSpecies('', store({ 'birb.species': 'v1' })).species, 'birb');
  assert.equal(resolveSpecies('', store({ 'birb.species': 'CROW' })).species, 'birb');
  assert.equal(readSavedSpecies(store({ 'birb.species': '' })), null);
});

test('case and encoding of the URL value are tolerated', () => {
  assert.equal(birdParam('?bird=Crow'), 'crow');
  assert.equal(resolveSpecies('?bird=OWL', store()).species, 'owl');
  assert.equal(birdParam('?bird=%63row'), 'crow');
  assert.equal(birdParam('?x=1'), null);
});

test('a storage that throws never breaks the boot', () => {
  const evil = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(resolveSpecies('', evil), { species: 'birb', source: 'default', variant: 'v3' });
  assert.equal(writeSavedSpecies(evil, 'crow'), false);
});

test('writeSavedSpecies stores only the three ids', () => {
  const s = store();
  assert.equal(writeSavedSpecies(s, 'owl'), true);
  assert.equal(s.getItem('birb.species'), 'owl');
  assert.equal(writeSavedSpecies(s, 'v2'), false);
  assert.equal(writeSavedSpecies(s, 'eagle'), false);
  assert.equal(s.getItem('birb.species'), 'owl');
});

test('the settings cycle: birb -> crow -> owl -> birb', () => {
  assert.equal(nextSpecies('birb'), 'crow');
  assert.equal(nextSpecies('crow'), 'owl');
  assert.equal(nextSpecies('owl'), 'birb');
  assert.equal(nextSpecies('nonsense'), 'crow');
  for (const s of SPECIES) assert.ok(isSpecies(s));
  assert.ok(!isSpecies('v3'));
});

// ---- the default path is the Pionus, and builds nothing new --------------

test('species-select.js is pure and imports nothing (it is the only species module on every boot)', () => {
  const src = readFileSync(new URL('../src/flight/species/species-select.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'no static imports');
  assert.ok(!/import\s*\(/.test(src), 'no dynamic imports');
  assert.ok(!/\b(document|window)\b\./.test(src), 'no DOM');
});

test('index.html: the species builder is imported lazily and only off the birb path', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // No static import of the builder anywhere.
  assert.ok(!/import\s*\{[^}]*\}\s*from\s*['"]\.\/src\/flight\/species\/species-bird\.js['"]/.test(html));
  const boot = html.indexOf("if (birbSpecies === 'birb') {");
  assert.ok(boot > 0, 'the boot branches on the resolved species');
  const birbArm = html.slice(boot, html.indexOf('} else {', boot));
  assert.ok(birbArm.includes('buildBirbPionus();') && birbArm.includes('installBirbPlumageSky();') && birbArm.includes('installBirbFeathers();'),
    'the birb arm builds the Pionus with its plumage sky and feathers, in that order');
  assert.ok(!birbArm.includes('species-bird.js') && !birbArm.includes('createSpeciesBird'),
    'the birb arm neither imports nor constructs a species bird');
  // Every import of the builder sits behind a non-birb condition.
  const imports = [...html.matchAll(/import\('\.\/src\/flight\/species\/species-bird\.js'\)/g)].map((m) => m.index);
  assert.ok(imports.length >= 1);
  for (const at of imports) {
    const before = html.slice(Math.max(0, at - 400), at);
    assert.ok(/\} else \{|id !== 'birb'/.test(before), 'species-bird.js is only imported for a crow or an owl');
  }
});

test('index.html: a swap and a re-LOD build the incoming bird BEFORE tearing down the old one', () => {
  // The procedural feather textures are refcounted; teardown first would drop
  // them to zero and regenerate all ten on every swap and every re-tier.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const header of ['const setBirdSpecies = async', 'const respeciesForTier = () => {']) {
    const at = html.indexOf(header);
    assert.ok(at > 0, header);
    const body = html.slice(at, html.indexOf('\n    };', at));
    const make = body.indexOf('makeSpeciesBird(');
    const tear = body.indexOf('teardownBird(');
    assert.ok(make > 0 && tear > make, `${header}: make ${make} before teardown ${tear}`);
    assert.ok(body.indexOf('syncSwappedBird();') > tear, `${header}: the mounted bird inherits shadows/rim`);
  }
});

test('index.html: the per-frame species hook does nothing while the Pionus flies', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const at = html.indexOf('speciesBird.update(_speciesFrame)');
  assert.ok(at > 0);
  const guard = html.lastIndexOf('if (speciesBird) {', at);
  assert.ok(guard > 0 && at - guard < 800, 'the update sits inside if (speciesBird)');
  // The re-LOD poll is guarded too, and runs BEFORE the frame looks the rig
  // up (so a rebuilt bird is posed on its first frame and the ribbon never
  // samples a detached wing).
  const poll = html.indexOf('if (speciesBird) respeciesForTier();');
  const lookup = html.indexOf("const leftWing = birbAnchor.getObjectByName('leftWing');", poll);
  assert.ok(poll > 0 && lookup > poll && lookup - poll < 3000, 'the poll precedes this frame\'s wing lookup');
});
