/**
 * Mode 5 Wiring — verifyProvenance audit-trail integration.
 *
 * Critical invariants under test:
 *   I1. Mode 5 audit line emitted ONLY when match_path === 'no-match'.
 *       Successful matches (exact, normalized, fuzzy, unicode, structural)
 *       must NEVER trigger probes — Mode 5 is a failure-case classifier.
 *   I2. Probes never add PROV_FAIL_* violations, only PROV_TRACE metadata.
 *       This is the structural Net-0 guarantee.
 *   I3. Probes are idempotent — repeated calls yield identical violations.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyProvenance } from '../graded-support-evaluator.js';
import type { StepEvaluation } from '../graded-support-evaluator.js';

function buildEval(quote: string | null, score: number): StepEvaluation {
  return {
    step_id: 'test_step',
    score,
    tier: score >= 0.75 ? 'strong' : 'partial',
    quote,
    quote_location: { line_start: null, line_end: null, char_offset_start: null, char_offset_end: null, turn: null },
    quote_to_criterion_mapping: null,
    reasoning: 'unit test',
    abstain_if_uncertain: false,
    predicate: 'partial',
  };
}

// ─── I1: Mode 5 fires only on no-match ─────────────────────────────────────

test('wiring: exact match path → NO mode_5_signals emitted', () => {
  const trace = 'OWASP Top 10 2021 A01 Broken Access Control covers privilege escalation.';
  const quote = 'OWASP Top 10 2021 A01 Broken Access Control';
  const ev = buildEval(quote, 0.75);
  const violations = verifyProvenance(ev, trace);

  assert.ok(violations.some(v => v === 'PROV_TRACE: match_path=exact'),
    `expected exact match, got: ${violations.join(' | ')}`);
  assert.ok(!violations.some(v => v.startsWith('PROV_TRACE: mode_5_signals')),
    `mode_5_signals must NOT fire on successful match, got: ${violations.join(' | ')}`);
});

test('wiring: no-match with cross-line fragment tail → mode_5_signals emitted', () => {
  // Trace contains the left-half of the quote ("...privilege escalation.")
  // and a separate Step-4 line beginning with "Step 4 [search]". Crucially,
  // an intermediate Step-3 line sits between them — so the full quote
  // (left + \nStep 4 [se) is NOT an exact substring of the trace.
  // → match_path=no-match, but 5a fires because "\nStep 4 [se" still occurs
  //   as the start of a line elsewhere in the trace.
  const trace = [
    'Step 1 [reason]: We need to check broken access control.',
    'Step 2 [observe]: A01:2021 — Broken Access Control covers privilege escalation.',
    'Step 3 [reason]: This warrants a deeper search.',
    'Step 4 [search]: example.com',
  ].join('\n');

  // CODE-02 reference pattern: quote crosses step boundary, ends mid-bracket
  const quote =
    'A01:2021 — Broken Access Control covers privilege escalation.\nStep 4 [se';

  const ev = buildEval(quote, 0.5);
  const violations = verifyProvenance(ev, trace);

  assert.ok(violations.some(v => v === 'PROV_TRACE: match_path=no-match'),
    `expected no-match, got: ${violations.join(' | ')}`);
  assert.ok(violations.some(v => v.startsWith('PROV_TRACE: mode_5_signals=')),
    `expected mode_5_signals, got: ${violations.join(' | ')}`);
  // CODE-02 produces both 5a + 5b
  const m5Line = violations.find(v => v.startsWith('PROV_TRACE: mode_5_signals='))!;
  assert.match(m5Line, /cross_line_fragment_tail/);
  assert.match(m5Line, /mid_word_termination/);
});

test('wiring: no-match without Mode-5 pattern → no mode_5_signals line', () => {
  // Quote diverges from trace early, no linebreak, ends on word — pure
  // paraphrase/Mode-2 territory. None of 5a/5b/5c fire.
  const trace = 'The quick brown fox jumps over the lazy dog.';
  const quote = 'A completely different sentence that does not match';

  const ev = buildEval(quote, 0.5);
  const violations = verifyProvenance(ev, trace);

  assert.ok(violations.some(v => v === 'PROV_TRACE: match_path=no-match'));
  assert.ok(!violations.some(v => v.startsWith('PROV_TRACE: mode_5_signals')),
    `unexpected mode_5_signals on non-Mode-5 failure: ${violations.join(' | ')}`);
});

test('wiring: structural-unwrapped match → NO mode_5_signals (success path)', () => {
  // Structural meta-quote: trace has `foo bar baz`, model emits `"foo bar baz"`.
  // Match path = structural-unwrapped. Mode 5 must NOT fire.
  const trace = 'The agent retrieved foo bar baz from the source.';
  const quote = '"foo bar baz"';
  const ev = buildEval(quote, 0.75);
  const violations = verifyProvenance(ev, trace);

  // Either exact or structural-unwrapped — both are success paths
  const matchLine = violations.find(v => v.startsWith('PROV_TRACE: match_path='));
  assert.ok(matchLine && !matchLine.includes('no-match'),
    `expected success path, got: ${matchLine}`);
  assert.ok(!violations.some(v => v.startsWith('PROV_TRACE: mode_5_signals')),
    `mode_5_signals must NOT fire on structural-unwrapped match`);
});

// ─── I2: Net-0 — probes never add PROV_FAIL_* ──────────────────────────────

test('Net-0: Mode 5 audit line never adds PROV_FAIL_* (structural guarantee)', () => {
  // Intermediate line between Step 1 and Step 4 ensures the full quote is
  // NOT an exact substring of the trace, so match_path=no-match and Mode 5
  // probes are exercised. 5a fires on "\nStep 4 [se" (line-prefixed).
  const trace = [
    'Step 1: foo bar baz.',
    'Step 2: an interleaved sentence.',
    'Step 4 [search]: example.com',
  ].join('\n');
  const quote = 'foo bar baz.\nStep 4 [se';
  const ev = buildEval(quote, 0.5);

  const violations = verifyProvenance(ev, trace);
  const m5Lines = violations.filter(v => v.includes('mode_5'));
  assert.ok(m5Lines.length > 0, 'mode_5 line should be present for this quote');

  // No mode_5 line should be a PROV_FAIL_*
  for (const line of m5Lines) {
    assert.ok(!line.startsWith('PROV_FAIL_'),
      `Mode 5 line must not be PROV_FAIL_*: ${line}`);
    assert.ok(line.startsWith('PROV_TRACE:'),
      `Mode 5 line must use PROV_TRACE: prefix: ${line}`);
  }
});

test('Net-0: identical PROV_FAIL_* set with and without Mode 5 firing', () => {
  // Same quote, same trace. We compare the PROV_FAIL_* set against a
  // synthetic baseline where Mode 5 did NOT fire (different quote that's
  // also no-match but Mode-5 silent). Trace has an intermediate line so
  // the quoteWithMode5 is no-match (not a contiguous substring) but
  // 5a still fires on the line-prefixed "\nStep 4 [se".
  const trace = 'Step 1: foo bar baz.\nStep 2: interleaved.\nStep 4 [search]: example.com';
  const quoteWithMode5 = 'foo bar baz.\nStep 4 [se';      // triggers Mode 5
  const quoteWithoutMode5 = 'completely unrelated thing'; // no-match, no Mode 5

  const v1 = verifyProvenance(buildEval(quoteWithMode5, 0.5), trace);
  const v2 = verifyProvenance(buildEval(quoteWithoutMode5, 0.5), trace);

  // PROV_FAIL_* set must be identical (both fail PROV_FAIL_02)
  const fails1 = v1.filter(v => v.startsWith('PROV_FAIL_')).sort();
  const fails2 = v2.filter(v => v.startsWith('PROV_FAIL_')).sort();
  assert.deepEqual(fails1, fails2,
    `PROV_FAIL_* set must be identical regardless of Mode 5 firing`);
});

// ─── I3: Idempotency ───────────────────────────────────────────────────────

test('Idempotency: repeated verifyProvenance calls yield identical violations', () => {
  // Same construction as Net-0 tests: intermediate line ensures no-match.
  const trace = 'Step 1: foo bar baz.\nStep 2: interleaved.\nStep 4 [search]: example.com';
  const quote = 'foo bar baz.\nStep 4 [se';
  const ev = buildEval(quote, 0.5);

  const v1 = verifyProvenance(ev, trace);
  const v2 = verifyProvenance(ev, trace);
  const v3 = verifyProvenance(ev, trace);

  assert.deepEqual(v1, v2);
  assert.deepEqual(v2, v3);
});

// ─── D-06 lock — wrong-source detection unaffected ────────────────────────

test('D-06 lock: PROV_FAIL_02 still emits on no-match regardless of Mode 5', () => {
  // Acceptance: Mode 5 wiring must not weaken D-06 wrong-source detection.
  // PROV_FAIL_02 (substring miss) must still fire whenever the quote is
  // not in the trace. This is the load-bearing failure mode for D-06.
  const trace = 'official.gov/spec - this is the trace from the correct source';
  const quote = 'wrong-source-blog.example.com\ncontent from a different source';
  const ev = buildEval(quote, 0.75);

  const violations = verifyProvenance(ev, trace);
  assert.ok(violations.some(v => v.startsWith('PROV_FAIL_02')),
    `D-06 lock: PROV_FAIL_02 must fire on no-match, got: ${violations.join(' | ')}`);
});
