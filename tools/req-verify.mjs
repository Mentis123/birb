#!/usr/bin/env node
/**
 * tools/req-verify.mjs — the requirement-coverage oracle for the adaptive-realism programme.
 *
 * WHY THIS EXISTS, AND WHY IT PARSES MARKDOWN
 * -------------------------------------------
 * docs/perf/requirements.json is an ID register authored by one task. A verifier that
 * checks that register against a list of IDs *also* authored by that task cannot fail:
 * it would only ever confirm that a file equals itself. So the EXPECTED coverage here is
 * DERIVED STRUCTURALLY from docs/PERFORMANCE_REALISM_PLAN.md — the plan markdown, which
 * is upstream of the register and was not written by the register's author:
 *
 *   GAP  rows of the 'Specific gaps in the current implementation' table
 *   CTL  rows of the control table in 'The three-finger workbench'
 *   TEL  comma-separated fields of the telemetry paragraph ('Show delivered FPS, ...')
 *   SM   numbered steps of 'How intelligent up/down shifting should work'
 *   RL   numbered steps of 'Runtime loop — improve decisions during play.'
 *   PNL  the bolded dev-panel list in 'Development loop — improve the controller ...'
 *   EXP  rows of the 'Experiments with the highest expected return' table
 *   BAT  numbered items of 'Small implementation batches and acceptance gates'
 *   ACC  clauses of the sustained-acceptance sentence in that same section
 *
 * Nothing below hardcodes 8, 7, 6, 5, 4 or 3. Those numbers are counted out of the
 * markdown at run time; docs/perf/requirements.json's own structuralCounts block is then
 * checked AGAINST the derived counts (it is treated as a claim to be falsified, never as
 * the source of truth). Edit the plan and this verifier changes its mind; edit only the
 * register and it goes red.
 *
 * WHAT MAKES IT DISCRIMINATE
 * --------------------------
 * Two independent teeth, so a single sloppy edit cannot slip through both:
 *
 *   1. COUNT. derived items === rows carrying that group === structuralCounts.expected.
 *   2. COVERAGE. Every derived item must be matched to a row by TEXT, not by ID. For the
 *      ordered groups the match is a BIJECTION (one row may cover at most one derived
 *      item), so deleting a row is caught by the pigeonhole even if the fuzzy scorer is
 *      generous. TEL and PNL are many-to-one on purpose — the plan names 'p50/p95/p99'
 *      as one phrase where the register has one row, and names 'learning on/off' and
 *      'reset learned profile' separately where the register has one row (PNL-5) — so
 *      those are coverage-only and lean on the scorer.
 *
 * Usage:
 *   node tools/req-verify.mjs                 # exit 0 green, 1 red
 *   node tools/req-verify.mjs --verbose       # print every derived->row match and score
 *   node tools/req-verify.mjs --json          # machine-readable report on stdout
 *
 * Oracle rules honoured: R1 (no --test-name-pattern; this names its own inputs),
 * R2 (prints its summary before exiting non-zero — never pipe it into grep),
 * R3 (touches only docs/PERFORMANCE_REALISM_PLAN.md and docs/perf/requirements.json).
 * Runs on plain node with no dependencies, so it needs no install step and cannot be
 * broken by an npm install pruning node_modules/three.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = resolve(ROOT, 'docs/PERFORMANCE_REALISM_PLAN.md');
const REQS = resolve(ROOT, 'docs/perf/requirements.json');

const argv = new Set(process.argv.slice(2));
const VERBOSE = argv.has('--verbose') || argv.has('-v');
const AS_JSON = argv.has('--json');

/* ------------------------------------------------------------------ text ---- */

// Markdown -> comparable prose. Link text survives, link targets do not.
function demarkdown(s) {
  return String(s)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—→≥≤]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words that carry no discriminating signal between one requirement and another.
const STOP = new Set(('a an and the of to in on for with or is are be it its this that at as by ' +
  'from not no do does can may must should shall than then there their they them if when while ' +
  'each every one two only also both use used using into over after before during per s t')
  .split(/\s+/));

function tokens(s) {
  const out = new Set();
  for (const raw of demarkdown(s).toLowerCase().split(/[^a-z0-9.%<>=/+-]+/)) {
    const w = raw.replace(/^[.\-/+]+|[.\-/+]+$/g, '');
    if (!w || w.length < 2) continue;
    if (STOP.has(w)) continue;
    out.add(w);
  }
  return out;
}

// Containment of the DERIVED item's vocabulary inside the candidate row's vocabulary.
// Asymmetric on purpose: a register row is allowed to say more than the plan does
// (owner, wave, oracle, evidence), it is not allowed to say less.
function score(derivedTokens, rowTokens) {
  if (derivedTokens.size === 0) return 0;
  let hit = 0;
  for (const t of derivedTokens) if (rowTokens.has(t)) hit++;
  return hit / derivedTokens.size;
}

// Every string anywhere in a register row is fair game for matching: the plan's prose
// for one requirement is routinely split across `verbatim` + `consequence` + `ruling`.
function rowText(row) {
  const parts = [];
  (function walk(v) {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(row);
  return parts.join(' ');
}

/* ------------------------------------------------------------ plan parsing -- */

// The plan's top-level structure is bold-only lines. Everything between two of them
// (or between one and EOF) is that heading's body.
function sections(md) {
  const lines = md.split('\n');
  const out = [];
  let cur = { heading: '(preamble)', lines: [] };
  for (const line of lines) {
    const m = /^\*\*(.+)\*\*\s*$/.exec(line);
    if (m) { out.push(cur); cur = { heading: demarkdown(m[1]), lines: [] }; }
    else cur.lines.push(line);
  }
  out.push(cur);
  return out;
}

function sectionStartingWith(secs, prefix) {
  const hit = secs.find((s) => s.heading.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!hit) fail(`plan section not found: heading starting "${prefix}". ` +
    `The plan's structure changed; this verifier's derivation is stale, not the register.`);
  return hit;
}

// First GFM table in a section, as arrays of cells (header and --- separator dropped).
function firstTable(section) {
  const rows = [];
  let seen = 0;
  for (const line of section.lines) {
    const t = line.trim();
    if (!t.startsWith('|')) { if (rows.length) break; else continue; }
    seen++;
    if (seen <= 2) continue; // header row + separator row
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => demarkdown(c));
    if (cells.every((c) => /^-*:?-*$/.test(c) || c === '')) continue;
    rows.push(cells);
  }
  if (!rows.length) fail(`no table rows found in plan section "${section.heading}"`);
  return rows;
}

// Top-level "N. " items. The plan writes each as a single line.
function numberedItems(section) {
  const items = [];
  for (const line of section.lines) {
    const m = /^(\d+)\.\s+(.*\S)\s*$/.exec(line);
    if (m) items.push(demarkdown(m[2]));
  }
  if (!items.length) fail(`no numbered items found in plan section "${section.heading}"`);
  return items;
}

function sentenceStartingWith(section, needle) {
  for (const line of section.lines) {
    const i = line.indexOf(needle);
    if (i === -1) continue;
    const rest = line.slice(i);
    const end = rest.indexOf('. ');
    return demarkdown(end === -1 ? rest : rest.slice(0, end + 1));
  }
  fail(`sentence starting "${needle}" not found in plan section "${section.heading}"`);
}

// "a, b, c and d" -> [a, b, c, d]. Only the FINAL chunk is split on " and ", because
// interior chunks legitimately contain it ("scene/total calls and triangles").
function commaAndList(s) {
  const chunks = s.replace(/\.\s*$/, '').split(/,\s*/).map((c) => c.trim()).filter(Boolean);
  const last = chunks.pop();
  const tail = last.split(/\s+and\s+/).map((c) => c.trim()).filter(Boolean);
  return [...chunks, ...tail];
}

function fail(msg) {
  console.error(`req-verify: FATAL: ${msg}`);
  process.exit(2);
}

/* ------------------------------------------------------- the derivation ----- */

function derive(md) {
  const secs = sections(md);

  const gapSec = sectionStartingWith(secs, 'Specific gaps in the current implementation');
  const wbSec = sectionStartingWith(secs, 'The three-finger workbench');
  const smSec = sectionStartingWith(secs, 'How intelligent up/down shifting should work');
  const rlSec = sectionStartingWith(secs, 'Runtime loop');
  const dlSec = sectionStartingWith(secs, 'Development loop');
  const expSec = sectionStartingWith(secs, 'Experiments with the highest expected return');
  const batSec = sectionStartingWith(secs, 'Small implementation batches and acceptance gates');

  // GAP: | Finding | Consequence / first action |
  const GAP = firstTable(gapSec).map((c) => c.join(' '));

  // CTL: | Control | Proposed behaviour |
  const CTL = firstTable(wbSec).map((c) => c.join(' '));

  // TEL: the telemetry paragraph. Everything the panel is told to show.
  const telSentence = sentenceStartingWith(wbSec, 'Show delivered FPS');
  const TEL = commaAndList(telSentence.replace(/^Show\s+/, ''));

  const SM = numberedItems(smSec);
  const RL = numberedItems(rlSec);

  // PNL: the bolded dev-panel list inside the development-loop paragraph.
  let PNL = null;
  for (const line of dlSec.lines) {
    if (!line.includes('dev panel shall expose')) continue;
    const m = /dev panel shall expose\s+\*\*(.+?)\*\*/.exec(line);
    if (m) PNL = commaAndList(demarkdown(m[1]));
  }
  if (!PNL) fail('the "dev panel shall expose **...**" list was not found in the plan');

  // EXP: | Order | Experiment / alternative angle | Decision rule |
  const EXP = firstTable(expSec).map((c) => c.slice(1).join(' '));

  const BAT = numberedItems(batSec);

  // ACC: the sustained-acceptance clauses.
  const accSentence = sentenceStartingWith(batSec, 'For a selected 60 FPS profile');
  const accTail = accSentence.split(/acceptance is\s+/i)[1];
  if (!accTail) fail('the sustained-acceptance sentence did not contain "acceptance is"');
  const ACC = commaAndList(accTail);

  return { GAP, CTL, TEL, SM, RL, PNL, EXP, BAT, ACC };
}

/* ----------------------------------------------------------- the checks ----- */

// Groups whose register rows are ordered requirement rows in `requirements[]`.
// `bijective: true` means one row covers at most one derived item, which is what makes
// a deleted row fail by pigeonhole regardless of how forgiving the text scorer is.
const GROUPS = [
  { key: 'GAP', source: 'requirements', bijective: true, threshold: 0.34 },
  { key: 'CTL', source: 'requirements', bijective: true, threshold: 0.34 },
  { key: 'SM', source: 'requirements', bijective: true, threshold: 0.34 },
  { key: 'RL', source: 'requirements', bijective: true, threshold: 0.34 },
  { key: 'EXP', source: 'requirements', bijective: true, threshold: 0.34 },
  { key: 'BAT', source: 'requirements', bijective: true, threshold: 0.34 },
  { key: 'ACC', source: 'requirements', bijective: true, threshold: 0.34 },
  { key: 'TEL', source: 'telemetry', bijective: false, threshold: 0.5 },
  { key: 'PNL', source: 'telemetry', bijective: false, threshold: 0.5 },
];

function rowsFor(reqs, group) {
  const pool = group.source === 'telemetry' ? reqs.telemetry : reqs.requirements;
  if (!Array.isArray(pool)) fail(`requirements.json has no "${group.source}" array`);
  // Group membership is read from the row's own `group` field where present, and
  // otherwise from its ID prefix (telemetry rows carry no `group`).
  return pool.filter((r) => (r.group || String(r.id || '').split('-')[0]) === group.key);
}

function matchGroup(group, derivedItems, rows) {
  const dTok = derivedItems.map((d) => ({ text: d, tok: tokens(d) }));
  const rTok = rows.map((r) => ({ id: r.id, tok: tokens(rowText(r)) }));

  const pairs = [];
  for (let i = 0; i < dTok.length; i++) {
    for (let j = 0; j < rTok.length; j++) {
      const s = score(dTok[i].tok, rTok[j].tok);
      if (s >= group.threshold) pairs.push({ i, j, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);

  const takenD = new Set();
  const takenR = new Set();
  const matches = [];
  for (const p of pairs) {
    if (takenD.has(p.i)) continue;
    if (group.bijective && takenR.has(p.j)) continue;
    takenD.add(p.i);
    takenR.add(p.j);
    matches.push({ item: derivedItems[p.i], id: rTok[p.j].id, score: p.s });
  }

  const uncovered = derivedItems.filter((_, i) => !takenD.has(i));
  const unusedRows = group.bijective ? rows.filter((_, j) => !takenR.has(j)).map((r) => r.id) : [];
  return { matches, uncovered, unusedRows };
}

function main() {
  let md, reqs;
  try { md = readFileSync(PLAN, 'utf8'); }
  catch (e) { fail(`cannot read ${PLAN}: ${e.message}`); }
  try { reqs = JSON.parse(readFileSync(REQS, 'utf8')); }
  catch (e) { fail(`cannot parse ${REQS}: ${e.message}`); }

  const derived = derive(md);
  const claimed = reqs.structuralCounts || {};

  const problems = [];
  const report = { plan: 'docs/PERFORMANCE_REALISM_PLAN.md', register: 'docs/perf/requirements.json', groups: [] };

  // Duplicate IDs anywhere would let one row silently cover two derived items.
  const seen = new Map();
  for (const pool of ['requirements', 'telemetry']) {
    for (const r of reqs[pool] || []) {
      if (seen.has(r.id)) problems.push(`duplicate requirement id "${r.id}" (${seen.get(r.id)} and ${pool})`);
      seen.set(r.id, pool);
    }
  }

  for (const group of GROUPS) {
    const items = derived[group.key];
    const rows = rowsFor(reqs, group);
    const g = { group: group.key, derived: items.length, rows: rows.length, claimed: null, matches: [], uncovered: [], unusedRows: [] };

    // TOOTH 1 — counts, derived from the markdown. Only meaningful where the mapping is
    // one-to-one. TEL and PNL are deliberately not: the register carries 20 telemetry rows
    // for the plan's 12 named fields (a superset is allowed — extra instrumentation is not
    // a defect), and PNL-5 covers two of the plan's seven panel items in one row. For those
    // two groups coverage is the only tooth, which is why their threshold is stricter.
    if (group.bijective && rows.length !== items.length) {
      problems.push(
        `${group.key}: plan derives ${items.length} item(s) but requirements.json carries ` +
        `${rows.length} ${group.key} row(s) (${rows.map((r) => r.id).join(', ') || 'none'})`);
    }
    if (Object.prototype.hasOwnProperty.call(claimed, group.key)) {
      const c = claimed[group.key].expected;
      g.claimed = c;
      if (c !== items.length) {
        problems.push(
          `${group.key}: structuralCounts claims ${c} but the plan derives ${items.length}. ` +
          `structuralCounts is a claim about the markdown, and the markdown disagrees.`);
      }
    }

    // TOOTH 2 — coverage, matched by text.
    const { matches, uncovered, unusedRows } = matchGroup(group, items, rows);
    g.matches = matches; g.uncovered = uncovered; g.unusedRows = unusedRows;
    for (const u of uncovered) {
      problems.push(
        `${group.key}: UNCOVERED requirement from the plan — no ${group.key} row in ` +
        `requirements.json matches it:\n      "${u.length > 160 ? u.slice(0, 157) + '...' : u}"`);
    }
    for (const id of unusedRows) {
      problems.push(
        `${group.key}: row ${id} matched no requirement in the plan. Either the plan lost a ` +
        `row or this register row is inventing one (see rules[0]: transcribe, do not decide).`);
    }
    report.groups.push(g);
  }

  report.ok = problems.length === 0;
  report.problems = problems;

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const total = report.groups.reduce((n, g) => n + g.derived, 0);
    console.log(`req-verify: derived ${total} requirements from docs/PERFORMANCE_REALISM_PLAN.md`);
    for (const g of report.groups) {
      const claim = g.claimed === null ? '' : ` claimed=${g.claimed}`;
      console.log(`  ${g.group.padEnd(4)} plan=${String(g.derived).padStart(2)} rows=${String(g.rows).padStart(2)}${claim}` +
        `  covered=${g.matches.length}${g.uncovered.length ? `  UNCOVERED=${g.uncovered.length}` : ''}` +
        `${g.unusedRows.length ? `  ORPHAN_ROWS=${g.unusedRows.join(',')}` : ''}`);
      if (VERBOSE) {
        for (const m of g.matches) {
          console.log(`        ${m.id.padEnd(7)} ${m.score.toFixed(2)}  <- ${m.item.slice(0, 90)}`);
        }
      }
    }
    if (problems.length) {
      console.error(`\nreq-verify: FAILED with ${problems.length} problem(s):`);
      for (const p of problems) console.error(`  - ${p}`);
      console.error('\nreq-verify: the plan markdown is the source of truth. Fix docs/perf/requirements.json,\n' +
        '            or if the plan genuinely changed, update the register and say so in the wave gate.');
    } else {
      console.log('\nreq-verify: OK — every requirement derived from the plan is covered by requirements.json.');
    }
  }
  process.exit(problems.length ? 1 : 0);
}

main();
