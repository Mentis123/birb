/**
 * tests/fixtures/perf-traces/index.js — the corpus.
 *
 * Wave 3 / P3.1 of docs/ULTRACODE_PERFORMANCE_PLAN.md §4.
 *
 * Sixteen named capacity scenarios plus the holdout generator. Read
 * ./README.md for the shape and the argument; ./schema.js is the contract and
 * ./driver.js is the machine.
 *
 * Every scenario is a FUNCTION of the provisional constants (CONTRACT §10
 * rule 1: "Traces are authored as capacity models parameterised on the
 * threshold, not as arrays baked against one"), so `buildCorpus(K)` with a
 * retuned table produces a retuned corpus and nothing has to be edited.
 */

import { PROVISIONAL } from '../../../src/game/perf-constants.js';
import { assertValidScenario } from './schema.js';

import * as overload from './scenarios/overload.js';
import * as recovery from './scenarios/recovery-when-capacity-returns.js';
import * as oscillationBait from './scenarios/oscillation-bait.js';
import * as misleadingPlateau from './scenarios/misleading-plateau.js';
import * as absentGpu from './scenarios/absent-gpu-timer.js';
import * as disjointGpu from './scenarios/disjoint-gpu-results.js';
import * as manualToAuto from './scenarios/manual-to-auto.js';
import * as resume from './scenarios/resume.js';
import * as sceneChange from './scenarios/scene-change.js';
import * as stuckQuality from './scenarios/stuck-quality.js';
import * as boundaryHitch from './scenarios/boundary-interleaved-with-recurrent-hitch.js';
import * as coldStart from './scenarios/cold-start-from-persisted-profile.js';
import * as corruptStore from './scenarios/corrupt-store-clamped.js';
import * as delayedRegression from './scenarios/delayed-regression.js';
import * as shaderCompile from './scenarios/first-use-shader-compilation.js';
import * as instrumentation from './scenarios/instrumentation-pair.js';

/**
 * The commissioning list, verbatim from the P3.1 brief and
 * docs/ULTRACODE_PERFORMANCE_PLAN.md §4 Wave 3. Order is the order they were
 * commissioned in, not an order of importance.
 *
 * A test asserts this list against the module registry below, so a scenario
 * that is quietly dropped fails loudly instead of shrinking the corpus.
 */
export const REQUIRED_SCENARIOS = Object.freeze([
  'overload',
  'recovery-when-capacity-returns',
  'oscillation-bait',
  'misleading-plateau',
  'absent-gpu-timer',
  'disjoint-gpu-results',
  'manual-to-auto',
  'resume',
  'scene-change',
  'stuck-quality',
  'boundary-interleaved-with-recurrent-hitch',
  'cold-start-from-persisted-profile',
  'corrupt-store-clamped',
  'delayed-regression',
  'first-use-shader-compilation',
  'instrumentation-pair',
]);

const MODULES = Object.freeze([
  overload, recovery, oscillationBait, misleadingPlateau,
  absentGpu, disjointGpu, manualToAuto, resume,
  sceneChange, stuckQuality, boundaryHitch, coldStart,
  corruptStore, delayedRegression, shaderCompile, instrumentation,
]);

/** name -> scenario module. */
export const SCENARIO_MODULES = Object.freeze(Object.fromEntries(MODULES.map((m) => [m.name, m])));

/** The names actually present, in registry order. */
export const SCENARIO_NAMES = Object.freeze(MODULES.map((m) => m.name));

/**
 * Build one scenario. Validates before returning: an invalid fixture that
 * reaches a controller test produces a failure the controller gets blamed for.
 */
export function buildScenario(name, K = PROVISIONAL) {
  const mod = SCENARIO_MODULES[name];
  if (!mod) {
    throw new RangeError(`Unknown scenario "${name}". Known: ${SCENARIO_NAMES.join(', ')}.`);
  }
  const scenario = mod.build(K);
  assertValidScenario(scenario, { K });
  return scenario;
}

/**
 * A scenario's discrimination matrix, in either form it may be exported.
 * Most scenarios name their policies flatly; the ones whose discriminator has
 * to be TUNED to a threshold (scene-change's beat is derived from PRO-3) export
 * a function of K, because a constant there would silently stop discriminating
 * the moment Wave 4 retunes the window.
 */
export function discriminatorsFor(name, K = PROVISIONAL) {
  const mod = SCENARIO_MODULES[name];
  if (!mod) throw new RangeError(`Unknown scenario "${name}".`);
  const d = mod.discriminators;
  return typeof d === 'function' ? d(K) : d;
}

/** Build every scenario. Returns [{ name, module, scenario }]. */
export function buildCorpus(K = PROVISIONAL) {
  return MODULES.map((mod) => ({ name: mod.name, module: mod, scenario: buildScenario(mod.name, K) }));
}

export { PROVISIONAL };
export * from './schema.js';
export { runTrace, runPair, APPLY_KINDS } from './driver.js';
export * as invariants from './invariants.js';
export { makePolicy, POLICY_FACTORIES } from './reference-policies.js';
export { generateHoldout, HOLDOUT_ENV_VAR, holdoutFingerprint } from './holdout.js';
