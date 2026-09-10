import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeCandidatesFor } from '../src/environment/grade-candidates.js';

/**
 * tests/grade-candidates.test.js — guards src/environment/grade-candidates.js
 * against drifting from tools/birb-lighting.mjs's own copy of
 * `gradeCandidatesFor`.
 *
 * tools/birb-lighting.mjs is on tools/oracle-manifest.txt (frozen) and
 * imports `playwright`, which is NOT a normal dependency of this repo (it is
 * installed on demand for the screenshot tools per CLAUDE.md) — importing
 * that file here would make `npm test` depend on playwright being present.
 * So this test never imports it. Instead it extracts the two function
 * bodies it needs (`fmt`, `gradeCandidatesFor`) from the file's own SOURCE
 * TEXT by bracket-matching, evaluates them in isolation (they are pure —
 * no closures over anything outside themselves), and diffs the result
 * against src/environment/grade-candidates.js's copy for a spread of
 * biomes and baselines.
 *
 * If tools/birb-lighting.mjs's candidate list is ever legitimately changed
 * (a gate decision, manifest regenerated in the same commit — see that
 * file's own freeze-exception note), this test fails until
 * src/environment/grade-candidates.js is updated to match. That is the
 * point: the panel's "Next candidate" control and the offline sheet must
 * always cycle the SAME set, and nothing else enforces that.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIGHTING_TOOL_PATH = path.join(REPO_ROOT, 'tools', 'birb-lighting.mjs');

/** Extracts `functionName(...) { ... }`'s full source by counting braces
 * from the first `{` after the signature match, so it works regardless of
 * how the body is formatted (and regardless of where in the file it sits). */
function extractFunctionSource(source, signaturePattern) {
  const sigMatch = signaturePattern.exec(source);
  if (!sigMatch) {
    throw new Error(`grade-candidates drift guard: signature not found in tools/birb-lighting.mjs: ${signaturePattern}`);
  }
  const braceStart = source.indexOf('{', sigMatch.index);
  if (braceStart === -1) throw new Error('grade-candidates drift guard: no opening brace after signature match');
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(sigMatch.index, i + 1);
    }
  }
  throw new Error('grade-candidates drift guard: unbalanced braces while extracting function body');
}

function loadReferenceImplementation() {
  const source = fs.readFileSync(LIGHTING_TOOL_PATH, 'utf8');
  const fmtSrc = extractFunctionSource(source, /function\s+fmt\s*\(/);
  const gradeCandidatesForSrc = extractFunctionSource(source, /function\s+gradeCandidatesFor\s*\(/);
  // Neither function closes over anything outside itself (both are pure —
  // gradeCandidatesFor calls `fmt`, which is why both are extracted
  // together), so evaluating them in an otherwise-empty function scope is
  // faithful to what the file itself does with them.
  // eslint-disable-next-line no-new-func -- deliberate, isolated re-eval of
  // the frozen tool's own source text; see the module doc comment above.
  const factory = new Function(`${fmtSrc}\n${gradeCandidatesForSrc}\nreturn gradeCandidatesFor;`);
  return factory();
}

const SAMPLE_BASELINES = [
  { exposure: 1.12, key: 1.6, rim: 0.48, fill: 0.38 }, // forest's authored defaults
  { exposure: 0.96, key: 1.45, rim: 0.58, fill: 0.34 }, // canyons
  { exposure: 1.12, key: 1.52, rim: 0.52, fill: 0.4 }, // mountain
  { exposure: 1.2, key: 1.3, rim: 0.6, fill: 0.45 }, // an arbitrary non-authored baseline (a standing panel override)
];

test('grade-candidates.js matches tools/birb-lighting.mjs for every biome and every sample baseline', () => {
  const reference = loadReferenceImplementation();
  const biomes = ['forest', 'canyons', 'mountain', 'city'];
  for (const biome of biomes) {
    for (const baseline of SAMPLE_BASELINES) {
      const expected = reference(biome, baseline);
      const actual = gradeCandidatesFor(biome, baseline);
      assert.deepEqual(
        actual,
        expected,
        `gradeCandidatesFor("${biome}", ${JSON.stringify(baseline)}) drifted from tools/birb-lighting.mjs`,
      );
    }
  }
});

test('every candidate list starts with the untouched "current" candidate', () => {
  const baseline = { exposure: 1.12, key: 1.6, rim: 0.48, fill: 0.38 };
  for (const biome of ['forest', 'canyons', 'mountain', 'city']) {
    const list = gradeCandidatesFor(biome, baseline);
    assert.equal(list[0].name, 'current (Neutral 1.12)');
    assert.deepEqual(list[0].settings, {});
  }
});

test('every candidate list has a unique name (the panel shows the name alone)', () => {
  const baseline = { exposure: 1.12, key: 1.6, rim: 0.48, fill: 0.38 };
  for (const biome of ['forest', 'canyons', 'mountain', 'city']) {
    const list = gradeCandidatesFor(biome, baseline);
    const names = list.map((c) => c.name);
    assert.equal(new Set(names).size, names.length, `duplicate candidate name for ${biome}`);
  }
});

test('an unknown biome falls back to the city-shaped branch rather than throwing', () => {
  // gradeCandidatesFor's if/else chain ends in a bare `else` — matches
  // tools/birb-lighting.mjs's own fallthrough, not a defect this file adds.
  const baseline = { exposure: 1, key: 1, rim: 1, fill: 1 };
  assert.doesNotThrow(() => gradeCandidatesFor('not-a-real-biome', baseline));
});
