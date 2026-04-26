/**
 * Sweep Toggle Smoketest
 * ======================
 *
 * Verifies that PLV_DISABLE_NEW_MATCH_PATHS=1 actually disables the Mode-1
 * (unicode-normalized) and Mode-3 (structural-unwrapped) match paths in
 * verifyProvenance(). Without this, the --full sweep could silently produce
 * "vorher == nachher" not because the matcher is correct, but because the
 * toggle is broken.
 *
 * Test design: synthetic StepEvaluation objects with quotes that
 *   - exact-match → must always succeed (control)
 *   - smart-quote variant → must FAIL with toggle on, SUCCEED with toggle off
 *   - structural-wrapped variant → must FAIL with toggle on, SUCCEED with toggle off
 *   - paraphrase variant → must always FAIL (lock)
 *
 * Reads PROV_TRACE match_path from violations to confirm which path resolved.
 *
 * Usage:
 *   node dist/scripts/sweep-toggle-smoketest.js
 *
 * Exits 0 on success, 1 on any unexpected behavior.
 */

import { verifyProvenance, type StepEvaluation } from '../plan/graded-support-evaluator.js';

const TRACE = `Step 1 [reason]: User asks about Python's pickle module safety.
Step 2 [search] (web_search): "pickle CWE-502 deserialization vulnerability"
Step 3 [reason]: Confirmed pickle is unsafe for untrusted data.`;

interface Probe {
  name: string;
  quote: string;
  toggleOn: { mustMatch: boolean; expectedPath: string };
  toggleOff: { mustMatch: boolean; expectedPath: string };
}

const PROBES: Probe[] = [
  {
    name: 'control-exact',
    // exact substring of the trace
    quote: "User asks about Python's pickle module safety.",
    toggleOn: { mustMatch: true, expectedPath: 'exact' },
    toggleOff: { mustMatch: true, expectedPath: 'exact' },
  },
  {
    name: 'mode1-smart-apostrophe',
    // U+2019 instead of ASCII apostrophe in "Python's"
    quote: "User asks about Python\u2019s pickle module safety.",
    toggleOn: { mustMatch: false, expectedPath: 'no-match' },
    toggleOff: { mustMatch: true, expectedPath: 'unicode-normalized' },
  },
  {
    name: 'mode3-structural-wrap',
    // entire span wrapped in outer double quotes that aren't in the trace
    quote: '"User asks about Python\'s pickle module safety."',
    toggleOn: { mustMatch: false, expectedPath: 'no-match' },
    toggleOff: { mustMatch: true, expectedPath: 'structural-unwrapped' },
  },
  {
    name: 'mode2-paraphrase-lock',
    // word order swapped — must NEVER match
    quote: "User about asks Python's pickle module safety.",
    toggleOn: { mustMatch: false, expectedPath: 'no-match' },
    toggleOff: { mustMatch: false, expectedPath: 'no-match' },
  },
];

function mkEval(quote: string): StepEvaluation {
  return {
    step_id: 'probe',
    score: 0.85,
    tier: 'strong',
    quote,
    quote_location: { line_start: null, line_end: null, char_offset_start: null, char_offset_end: null, turn: null },
    quote_to_criterion_mapping: null,
    reasoning: '',
    abstain_if_uncertain: false,
    predicate: 'supported',
  };
}

function probe(quote: string): { matched: boolean; matchPath: string } {
  const violations = verifyProvenance(mkEval(quote), TRACE);
  const failed = violations.some(v => v.startsWith('PROV_FAIL_02'));
  const traceLine = violations.find(v => v.startsWith('PROV_TRACE'));
  const matchPath = traceLine ? (traceLine.split('match_path=')[1] ?? 'unknown') : 'unknown';
  return { matched: !failed, matchPath };
}

function runProbes(label: string): Map<string, { matched: boolean; matchPath: string }> {
  const out = new Map<string, { matched: boolean; matchPath: string }>();
  console.log(`\n[${label}]`);
  for (const p of PROBES) {
    const r = probe(p.quote);
    out.set(p.name, r);
    console.log(`  ${p.name.padEnd(28)}  matched=${String(r.matched).padEnd(5)}  path=${r.matchPath}`);
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('PLV Sweep Toggle Smoketest');
console.log('==========================');
console.log(`Trace: ${TRACE.split('\n')[0]}...`);

// Toggle ON (= vorher, new paths disabled)
process.env.PLV_DISABLE_NEW_MATCH_PATHS = '1';
const vorher = runProbes('VORHER (toggle ON, new paths disabled)');

// Toggle OFF (= nachher, new paths enabled)
delete process.env.PLV_DISABLE_NEW_MATCH_PATHS;
const nachher = runProbes('NACHHER (toggle OFF, new paths enabled)');

// Verify expectations
console.log('\nVerification');
console.log('============');
let failed = 0;
let passed = 0;
for (const p of PROBES) {
  const v = vorher.get(p.name)!;
  const n = nachher.get(p.name)!;

  const vorherOk = v.matched === p.toggleOn.mustMatch && v.matchPath === p.toggleOn.expectedPath;
  const nachherOk = n.matched === p.toggleOff.mustMatch && n.matchPath === p.toggleOff.expectedPath;

  if (vorherOk && nachherOk) {
    passed++;
    console.log(`  ✅ ${p.name}`);
  } else {
    failed++;
    console.log(`  ❌ ${p.name}`);
    if (!vorherOk) {
      console.log(`     VORHER expected: matched=${p.toggleOn.mustMatch}, path=${p.toggleOn.expectedPath}`);
      console.log(`     VORHER actual:   matched=${v.matched}, path=${v.matchPath}`);
    }
    if (!nachherOk) {
      console.log(`     NACHHER expected: matched=${p.toggleOff.mustMatch}, path=${p.toggleOff.expectedPath}`);
      console.log(`     NACHHER actual:   matched=${n.matched}, path=${n.matchPath}`);
    }
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);

// Crucial sanity check: at least one probe must produce vorher != nachher.
// If all probes are identical, the toggle is doing nothing.
let hasDifference = false;
for (const p of PROBES) {
  const v = vorher.get(p.name)!;
  const n = nachher.get(p.name)!;
  if (v.matched !== n.matched || v.matchPath !== n.matchPath) {
    hasDifference = true;
    break;
  }
}
if (!hasDifference) {
  console.log('❌ Toggle has NO observable effect — bug suspected.');
  process.exit(1);
}
console.log('✅ Toggle produces observable vorher/nachher difference — mechanism works.');

if (failed > 0) process.exit(1);
process.exit(0);
