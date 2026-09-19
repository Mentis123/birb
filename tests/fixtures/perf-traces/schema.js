/**
 * tests/fixtures/perf-traces/schema.js — what a capacity trace IS, and the
 * validator that refuses one that lies.
 *
 * Wave 3 / P3.1. See ./README.md for the argument; this file is the contract.
 *
 * ---------------------------------------------------------------------------
 * A TRACE IS A CAPACITY MODEL, NOT A RECORDED INTERVAL ARRAY
 * ---------------------------------------------------------------------------
 * Every `sample` below carries the SUSTAINABLE FRAME COST AT EACH SETTING —
 * `costMs: { rung0: 22.0, rung1: 15.5, ... }` — and the driver synthesises the
 * delivered interval from whichever rung the controller is standing on at that
 * moment.
 *
 * This is not a stylistic preference. Replay a recorded array of intervals and
 * the controller's decision changes NOTHING about what it then measures, so
 * every test of a decision is vacuous: the trace cannot depict
 * recovery-when-capacity-returns (the trace would replay the same numbers
 * whether or not the controller restored) and it cannot depict a FAILED
 * UPGRADE PROBE at all (the probe's whole content is "what happens if I go up",
 * which a fixed array has no answer to). Both are named required regressions in
 * docs/PERFORMANCE_REALISM_PLAN.md's development loop.
 *
 * ---------------------------------------------------------------------------
 * THE FIELDS
 * ---------------------------------------------------------------------------
 *   name              kebab-case id, unique in the corpus
 *   title             one line for a human
 *   depicts           prose: the situation in the world this describes
 *   whyCapacityModel  prose: what a fixed interval replay could not show here.
 *                     REQUIRED, and required to be non-trivial, because a
 *                     scenario whose author could not answer this is a
 *                     scenario that should have been a fixed array.
 *   requires          requirement ids from docs/perf/requirements.json
 *   ladder            'compat' | 'separated' | an explicit array of rungs
 *   targetFPS         the B every threshold is against
 *   presentation      { mode: 'vsync', hz } | { mode: 'free' }
 *   startRung         integer index the run begins on
 *   allowOutOfRangeStart  true only for the corrupt-store trace
 *   durationMs        wall-clock length of the depicted situation
 *   jitterMs          deterministic per-frame jitter amplitude (0 = none)
 *   seed              seeds the jitter; identical seed => identical run
 *   samples           time-ordered capacity records (below)
 *   events            time-ordered world events (below)
 *   instrumentation   the modelled cost of having the panel open (below)
 *
 * A `sample`:
 *   atMs        when this capacity begins. samples[0].atMs must be 0.
 *   costMs      { rung0..rungN-1 } — EVERY rung, no holes. A hole is a
 *               scenario that cannot answer "what if the controller had gone
 *               there", which is the one question the corpus exists to ask.
 *   cpuShare    0..1 — how much of costMs is CPU. The rest is GPU. This is
 *               what makes "if CPU work dominates and DPR changes do little,
 *               target decorative update rates" (plan step 4) testable.
 *   interpolate when true, cost ramps linearly to the NEXT sample rather than
 *               holding. Thermal drift and delayed regression need this.
 *   note        prose for the reader of a failing test
 *
 * An `event`: { atMs, kind, ... }. Kinds are a CLOSED set; see EVENT_KINDS.
 *
 * `instrumentation`: { perFrameMs, perUpdateMs } — the world model of what the
 * dev panel costs when it is open. These are costs, not thresholds: they
 * belong to the depicted device exactly like costMs does, so they live in the
 * trace and NOT in CONTRACT §10.
 *
 * No THREE, no DOM. Imports only the two enums it must not restate.
 */

import { RESET_TAGS, INVALID_REASONS } from '../../../src/game/frame-metrics.js';
import { PROVISIONAL } from '../../../src/game/perf-constants.js';
import { buildLadder, rungKey, RUNG_SETTING_KEYS, FORBIDDEN_SETTING_KEYS } from './ladder.js';

/** The closed set of event kinds a trace may carry. */
export const EVENT_KINDS = Object.freeze([
  'reset',             // { tag } — tag from frame-metrics RESET_TAGS
  'paused',            // { paused: boolean, reason } — reason from INVALID_REASONS
  'mode',              // { mode: 'auto' | 'manual' | 'benchmark' }
  'gpu',               // { state } — from GPU_STATES
  'hitch',             // { dtMs, tag? } — a single added-cost frame
  'recurrentHitch',    // { everyMs, dtMs } — starts a repeating hitch
  'stopRecurrentHitch',// {}
  'note',              // { text } — annotates the timeline, changes nothing
]);

/**
 * What the injected GPU timer reports. Mirrors src/game/gpu-timer.js's own
 * `read()` contract exactly, including that a DISJOINT result carries
 * `value: null` — the extension returned a number and the disjoint flag says
 * do not trust it, so the module discards it and reports the reason.
 * CONTRACT §3.1: `no-context` is a STOP condition, not a result, so no trace
 * may declare it as a steady state.
 */
export const GPU_STATES = Object.freeze(['ok', 'no-extension', 'not-webgl2', 'disjoint']);

/** Controller modes a trace may drive, from quality-settings.js QUALITY_MODES. */
export const MODES = Object.freeze(['auto', 'manual', 'benchmark']);

/** Presentation models. See driver.js `deliver()` for what each does. */
export const PRESENTATION_MODES = Object.freeze(['vsync', 'free']);

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * validateScenario(scenario, { K }) — returns an array of problem strings.
 * Empty means valid. Never throws on a bad trace: the caller decides whether a
 * malformed fixture is a test failure or a generator bug, and a validator that
 * throws on the first problem hides the other nine.
 */
export function validateScenario(scenario, { K = PROVISIONAL } = {}) {
  const p = [];
  const at = (what) => `${scenario && scenario.name ? scenario.name : '<unnamed>'}: ${what}`;

  if (!scenario || typeof scenario !== 'object') return ['scenario is not an object'];

  if (typeof scenario.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(scenario.name)) {
    p.push(at(`name "${scenario.name}" must be kebab-case`));
  }
  for (const field of ['title', 'depicts', 'whyCapacityModel']) {
    if (typeof scenario[field] !== 'string' || scenario[field].trim().length < 40) {
      p.push(at(`${field} must be prose of at least 40 characters — a scenario nobody could describe is a scenario nobody can debug`));
    }
  }
  if (!Array.isArray(scenario.requires) || scenario.requires.length === 0) {
    p.push(at('requires must be a non-empty array of requirement ids'));
  }

  // ---- ladder -------------------------------------------------------------
  let ladder = null;
  try {
    ladder = Array.isArray(scenario.ladder) ? scenario.ladder : buildLadder(scenario.ladder, K);
  } catch (err) {
    p.push(at(err.message));
  }
  if (ladder) {
    if (ladder.length < 2) p.push(at('a ladder needs at least two rungs; with one there is no decision to make'));
    for (const rung of ladder) {
      if (!rung || typeof rung.id !== 'string') { p.push(at('every rung needs an id')); continue; }
      for (const key of Object.keys(rung.settings || {})) {
        if (FORBIDDEN_SETTING_KEYS.includes(key)) {
          p.push(at(`rung "${rung.id}" carries forbidden gameplay key "${key}" — plan step 4: never reduce collision, input or flight simulation fidelity`));
        } else if (!RUNG_SETTING_KEYS.includes(key)) {
          p.push(at(`rung "${rung.id}" carries unknown setting key "${key}"`));
        }
      }
    }
  }
  const depth = ladder ? ladder.length : 0;

  // ---- scalars ------------------------------------------------------------
  if (!isFiniteNumber(scenario.targetFPS) || scenario.targetFPS <= 0) p.push(at('targetFPS must be a positive number'));
  if (!isFiniteNumber(scenario.durationMs) || scenario.durationMs <= 0) p.push(at('durationMs must be positive'));
  if (!Number.isInteger(scenario.startRung)) p.push(at('startRung must be an integer'));
  else if (!scenario.allowOutOfRangeStart && (scenario.startRung < 0 || scenario.startRung >= depth)) {
    p.push(at(`startRung ${scenario.startRung} is outside the ladder (0..${depth - 1}); set allowOutOfRangeStart to depict a corrupt store`));
  }
  if (scenario.jitterMs !== undefined && (!isFiniteNumber(scenario.jitterMs) || scenario.jitterMs < 0)) {
    p.push(at('jitterMs must be a non-negative number'));
  }
  if (!Number.isInteger(scenario.seed)) p.push(at('seed must be an integer — jitter has to be reproducible'));

  const pres = scenario.presentation;
  if (!pres || !PRESENTATION_MODES.includes(pres.mode)) {
    p.push(at(`presentation.mode must be one of ${PRESENTATION_MODES.join(', ')}`));
  } else if (pres.mode === 'vsync' && (!isFiniteNumber(pres.hz) || pres.hz <= 0)) {
    p.push(at('presentation.hz must be a positive number for vsync'));
  }

  const inst = scenario.instrumentation;
  if (!inst || !isFiniteNumber(inst.perFrameMs) || !isFiniteNumber(inst.perUpdateMs)) {
    p.push(at('instrumentation must be { perFrameMs, perUpdateMs } — the modelled cost of an open panel'));
  } else if (inst.perFrameMs < 0 || inst.perUpdateMs <= 0) {
    p.push(at('instrumentation.perUpdateMs must be > 0: "identical costMs, panel-on cpuMs strictly greater" is the required pair, and a zero-cost panel cannot produce it'));
  }

  // ---- samples ------------------------------------------------------------
  const samples = scenario.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    p.push(at('samples must be a non-empty array'));
  } else {
    if (samples[0].atMs !== 0) p.push(at('samples[0].atMs must be 0 — the run has to start somewhere defined'));
    let last = -1;
    samples.forEach((s, i) => {
      if (!isFiniteNumber(s.atMs) || s.atMs < 0) { p.push(at(`samples[${i}].atMs must be a non-negative number`)); return; }
      if (s.atMs <= last && i > 0) p.push(at(`samples[${i}].atMs (${s.atMs}) must be strictly after samples[${i - 1}].atMs (${last})`));
      last = s.atMs;
      if (s.atMs > scenario.durationMs) p.push(at(`samples[${i}].atMs (${s.atMs}) is past durationMs (${scenario.durationMs}) — dead capacity nobody reaches`));
      if (!s.costMs || typeof s.costMs !== 'object') { p.push(at(`samples[${i}] has no costMs`)); return; }
      for (let r = 0; r < depth; r += 1) {
        const v = s.costMs[rungKey(r)];
        if (!isFiniteNumber(v) || v <= 0) {
          p.push(at(`samples[${i}].costMs.${rungKey(r)} is ${v} — every sample must state the sustainable cost at EVERY rung, or the trace cannot answer "what if the controller had gone there"`));
        }
      }
      for (const key of Object.keys(s.costMs)) {
        if (!/^rung\d+$/.test(key)) p.push(at(`samples[${i}].costMs has non-rung key "${key}"`));
        else if (Number(key.slice(4)) >= depth) p.push(at(`samples[${i}].costMs.${key} is past the end of a ${depth}-rung ladder`));
      }
      if (s.cpuShare !== undefined && (!isFiniteNumber(s.cpuShare) || s.cpuShare < 0 || s.cpuShare > 1)) {
        p.push(at(`samples[${i}].cpuShare must be within 0..1`));
      }
    });
  }

  // ---- events -------------------------------------------------------------
  const events = scenario.events ?? [];
  if (!Array.isArray(events)) {
    p.push(at('events must be an array'));
  } else {
    let lastAt = -Infinity;
    events.forEach((e, i) => {
      if (!e || typeof e !== 'object') { p.push(at(`events[${i}] is not an object`)); return; }
      if (!isFiniteNumber(e.atMs) || e.atMs < 0) p.push(at(`events[${i}].atMs must be non-negative`));
      else if (e.atMs < lastAt) p.push(at(`events[${i}] is out of order (${e.atMs} < ${lastAt})`));
      else lastAt = e.atMs;
      if (!EVENT_KINDS.includes(e.kind)) { p.push(at(`events[${i}].kind "${e.kind}" is not in the closed set ${EVENT_KINDS.join(', ')}`)); return; }
      switch (e.kind) {
        case 'reset':
          if (!RESET_TAGS.includes(e.tag)) {
            p.push(at(`events[${i}] reset tag "${e.tag}" is not in frame-metrics RESET_TAGS — CONTRACT §2.1: an untagged reset is a contract violation`));
          }
          break;
        case 'paused':
          if (typeof e.paused !== 'boolean') p.push(at(`events[${i}].paused must be boolean`));
          if (e.paused && !INVALID_REASONS.includes(e.reason)) {
            p.push(at(`events[${i}] pause reason "${e.reason}" is not in frame-metrics INVALID_REASONS`));
          }
          break;
        case 'mode':
          if (!MODES.includes(e.mode)) p.push(at(`events[${i}].mode "${e.mode}" is not one of ${MODES.join(', ')}`));
          break;
        case 'gpu':
          if (!GPU_STATES.includes(e.state)) {
            p.push(at(`events[${i}].state "${e.state}" is not in ${GPU_STATES.join(', ')}` +
              (e.state === 'no-context' ? ' — CONTRACT §3.1: no-context is a STOP condition (a wiring bug wearing a platform fact\'s clothes), never a depicted steady state' : '')));
          }
          break;
        case 'hitch':
          if (!isFiniteNumber(e.dtMs) || e.dtMs <= 0) p.push(at(`events[${i}].dtMs must be positive`));
          if (e.tag !== undefined && e.tag !== null && !RESET_TAGS.includes(e.tag)) p.push(at(`events[${i}].tag "${e.tag}" is not a reset tag`));
          break;
        case 'recurrentHitch':
          if (!isFiniteNumber(e.everyMs) || e.everyMs <= 0) p.push(at(`events[${i}].everyMs must be positive`));
          if (!isFiniteNumber(e.dtMs) || e.dtMs <= 0) p.push(at(`events[${i}].dtMs must be positive`));
          break;
        default:
          break;
      }
    });
  }

  return p;
}

/** Throwing wrapper, for callers that want the fixture to be self-policing. */
export function assertValidScenario(scenario, opts) {
  const problems = validateScenario(scenario, opts);
  if (problems.length) {
    throw new Error(`Invalid trace scenario:\n  - ${problems.join('\n  - ')}`);
  }
  return scenario;
}

/**
 * capacityAt(scenario, tMs, depth) -> { costMs: number[], cpuShare, index, note }
 *
 * Piecewise-constant by default; linear between a sample flagged
 * `interpolate` and the one after it. Returns costs as an ARRAY indexed by
 * rung, so the driver never does string concatenation per frame.
 */
export function capacityAt(scenario, tMs, depth) {
  const samples = scenario.samples;
  let i = 0;
  while (i + 1 < samples.length && samples[i + 1].atMs <= tMs) i += 1;
  const s = samples[i];
  const next = samples[i + 1];
  const costMs = new Array(depth);

  if (s.interpolate && next) {
    const span = next.atMs - s.atMs;
    const f = span > 0 ? Math.min(1, Math.max(0, (tMs - s.atMs) / span)) : 0;
    for (let r = 0; r < depth; r += 1) {
      const a = s.costMs[rungKey(r)];
      const b = next.costMs[rungKey(r)];
      costMs[r] = a + (b - a) * f;
    }
    const ca = s.cpuShare ?? DEFAULT_CPU_SHARE;
    const cb = next.cpuShare ?? DEFAULT_CPU_SHARE;
    return { costMs, cpuShare: ca + (cb - ca) * f, index: i, note: s.note };
  }

  for (let r = 0; r < depth; r += 1) costMs[r] = s.costMs[rungKey(r)];
  return { costMs, cpuShare: s.cpuShare ?? DEFAULT_CPU_SHARE, index: i, note: s.note };
}

/**
 * The CPU/GPU split a sample gets when it does not state one.
 *
 * Not a threshold and not in CONTRACT §10: it is a property of the depicted
 * device, exactly like costMs, and a scenario that cares states its own. It is
 * deliberately NOT 0.5, so that a controller which happens to treat the two
 * halves identically is not accidentally right.
 */
export const DEFAULT_CPU_SHARE = 0.45;

/**
 * feasibleRung(costMs, budgetMs) — the ground truth the controller is trying
 * to find: the HIGHEST-QUALITY rung (lowest index) whose sustainable cost fits
 * the budget. Returns the deepest rung when nothing fits (the device simply
 * cannot hold the target, and the honest answer is the cheapest setting).
 *
 * Derived from the capacity model, never from a controller run — that is what
 * makes it usable as an oracle for a controller that has never seen the trace.
 */
export function feasibleRung(costMs, budget) {
  for (let r = 0; r < costMs.length; r += 1) {
    if (costMs[r] <= budget) return r;
  }
  return costMs.length - 1;
}
