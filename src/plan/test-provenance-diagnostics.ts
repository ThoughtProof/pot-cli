/**
 * Provenance Diagnostics — TDD test suite
 * =========================================
 *
 * Run via:
 *   npm run build && npm run test:plan
 *
 * Two layers of tests:
 *
 *   GREEN (must pass) — exercise the *new* pure helper functions in
 *   provenance-diagnostics.ts. They lock in the diagnostic contract so a future
 *   refactor cannot silently regress hex-dumps / mode classification.
 *
 *   RED (intentionally failing) — replicate the four PROVENANCE-DOWNGRADE
 *   failure cases from the 40-case benchmark (C-08, CODE-05 step_2/_3/_4,
 *   D-05 step_3). Each test asserts the *desired* behavior of verifyProvenance
 *   after the matcher is fixed. Until the fix lands, these tests are RED on
 *   purpose — that is the TDD contract for this branch.
 *
 *   KEEP-FAILING-AS-FEATURE (must stay green) — D-06 wrong-source test. If a
 *   well-meaning fix loosens the matcher enough to let D-06 through, this test
 *   goes red and blocks the PR. That is by design.
 *
 * Coding-style: same as src/plan/test-canonicalizer.ts and
 * src/plan/test-exact-string-canary.ts (node:test, ESM, no jest/vitest).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  diagnoseProvenance,
  longestPrefixFound,
  hexDump,
  detectTokenizationSignals,
  looksStructural,
} from './provenance-diagnostics.js';
import { verifyProvenance, applyScoreFloors, type StepEvaluation } from './graded-support-evaluator.js';

// ─── Helper: build a StepEvaluation with sensible defaults ────────────────────

function makeEval(partial: Partial<StepEvaluation>): StepEvaluation {
  return {
    step_id: partial.step_id ?? 'step_test',
    score: partial.score ?? 0.85,
    tier: partial.tier ?? 'strong',
    quote: partial.quote ?? null,
    quote_location: partial.quote_location ?? {
      line_start: null,
      line_end: null,
      char_offset_start: null,
      char_offset_end: null,
      turn: null,
    },
    quote_to_criterion_mapping: partial.quote_to_criterion_mapping ?? null,
    reasoning: partial.reasoning ?? '',
    abstain_if_uncertain: partial.abstain_if_uncertain ?? false,
    predicate: partial.predicate ?? 'supported',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — GREEN — Pure helpers in provenance-diagnostics.ts
// ═══════════════════════════════════════════════════════════════════════════════

test('hexDump renders ASCII bytes correctly', () => {
  assert.equal(hexDump('abc'), '61 62 63');
});

test('hexDump renders smart apostrophe (U+2019) as e2 80 99', () => {
  // The smoking gun byte sequence we expect to see when an LLM emits “smart” quotes.
  assert.equal(hexDump('\u2019'), 'e2 80 99');
});

test('hexDump renders NBSP (U+00A0) as c2 a0', () => {
  assert.equal(hexDump('\u00A0'), 'c2 a0');
});

test('hexDump truncates to maxBytes', () => {
  const out = hexDump('a'.repeat(100), 4);
  assert.equal(out.split(' ').length, 4);
});

test('longestPrefixFound returns full match when quote is a substring', () => {
  const trace = 'The quick brown fox jumps over the lazy dog';
  const { position, length } = longestPrefixFound('quick brown fox', trace);
  assert.equal(length, 'quick brown fox'.length);
  assert.equal(position, trace.indexOf('quick brown fox'));
});

test('longestPrefixFound shrinks until a prefix is found', () => {
  const trace = 'The quick brown FOX jumps over the lazy dog';
  // Quote diverges at "fox" vs "FOX" — the shrinking loop should still find
  // "quick brown " (length 12) at the right position.
  const { position, length } = longestPrefixFound('quick brown fox jumps', trace);
  assert.ok(length >= 8, `expected a partial prefix of at least 8 chars, got ${length}`);
  assert.ok(length < 'quick brown fox jumps'.length, 'must not claim full match');
  assert.equal(position, trace.indexOf('quick brown '));
});

test('longestPrefixFound returns -1/0 when nothing matches', () => {
  const { position, length } = longestPrefixFound('zzz unrelated text yyy', 'completely different content');
  assert.equal(position, -1);
  assert.equal(length, 0);
});

test('detectTokenizationSignals flags smart apostrophe', () => {
  const sigs = detectTokenizationSignals('it\u2019s a test');
  assert.ok(sigs.includes('smart_apostrophe'), `expected smart_apostrophe, got ${sigs}`);
});

test('detectTokenizationSignals flags NBSP, em-dash, ellipsis char', () => {
  const sigs = detectTokenizationSignals('foo\u00A0bar\u2014baz\u2026');
  assert.ok(sigs.includes('nbsp'));
  assert.ok(sigs.includes('en_or_em_dash'));
  assert.ok(sigs.includes('ellipsis_char'));
});

test('detectTokenizationSignals flags zero-width-space', () => {
  const sigs = detectTokenizationSignals('hello\u200Bworld');
  assert.ok(sigs.includes('zero_width_space'));
});

test('detectTokenizationSignals returns [] for plain ASCII', () => {
  const sigs = detectTokenizationSignals('plain ascii content with no surprises');
  assert.deepEqual(sigs, []);
});

test('looksStructural is true for nested-quote LLM output', () => {
  // Pattern: model wrapped a meta-quote inside another quote.
  assert.equal(looksStructural('"He said: \'don\'t worry\' to her"'), true);
});

test('looksStructural is false for a plain quote', () => {
  assert.equal(looksStructural('the quick brown fox jumps over the lazy dog'), false);
});

test('diagnoseProvenance reports matched=true when any path matched', () => {
  const report = diagnoseProvenance({
    step_id: 'step_x',
    quote: 'foo bar baz',
    trace: 'irrelevant',
    cleanQuote: 'foo bar baz',
    isSubstring: true,
    isNormalizedMatch: false,
    isFuzzyMatch: false,
  });
  assert.equal(report.suspected_mode, 'matched');
  assert.equal(report.match_path.finalResult, 'exact');
  assert.equal(report.char_diff, null);
});

test('diagnoseProvenance flags Mode 1 (tokenization) for smart-apostrophe failure', () => {
  // Trace has an ASCII apostrophe; quote has a smart apostrophe.
  const trace = "The plan said don't refactor before tests pass.";
  const cleanQuote = 'don\u2019t refactor before tests pass'; // U+2019
  const report = diagnoseProvenance({
    step_id: 'step_x',
    quote: cleanQuote,
    trace,
    cleanQuote,
    isSubstring: false,
    isNormalizedMatch: false,
    isFuzzyMatch: false,
  });
  assert.equal(report.suspected_mode, 'mode_1_tokenization');
  assert.ok(report.suspected_mode_signals.some(s => s.includes('smart_apostrophe')));
  assert.ok(report.char_diff !== null);
});

test('diagnoseProvenance flags Mode 3 (structural / meta-quote)', () => {
  const trace = 'The model produced exactly: hello world.';
  const cleanQuote = '"He said: \'hello world\' here"'; // nested quotes — won't match
  const report = diagnoseProvenance({
    step_id: 'step_x',
    quote: cleanQuote,
    trace,
    cleanQuote,
    isSubstring: false,
    isNormalizedMatch: false,
    isFuzzyMatch: false,
  });
  assert.equal(report.suspected_mode, 'mode_3_structural');
});

test('diagnoseProvenance reports no_quote when quote is null', () => {
  const report = diagnoseProvenance({
    step_id: 'step_x',
    quote: null,
    trace: 'whatever',
    cleanQuote: '',
    isSubstring: false,
    isNormalizedMatch: false,
    isFuzzyMatch: false,
  });
  assert.equal(report.suspected_mode, 'no_quote');
  assert.equal(report.quote_present, false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2 — Audit-trail PROV_TRACE assertion
// ═══════════════════════════════════════════════════════════════════════════════

test('verifyProvenance emits PROV_TRACE audit-trail line on exact match', () => {
  const ev = makeEval({
    step_id: 'step_audit_1',
    quote: 'the answer is 42',
  });
  const trace = 'After much deliberation, the answer is 42, period.';
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    violations.some(v => v === 'PROV_TRACE: match_path=exact'),
    `expected PROV_TRACE=exact, got: ${violations.join(' | ')}`,
  );
});

test('verifyProvenance emits PROV_TRACE=no-match when quote is missing', () => {
  const ev = makeEval({
    step_id: 'step_audit_2',
    quote: 'this exact phrase does not appear anywhere',
  });
  const trace = 'completely unrelated content about pizza';
  const violations = verifyProvenance(ev, trace);
  assert.ok(violations.some(v => v.startsWith('PROV_FAIL_02')));
  assert.ok(violations.some(v => v === 'PROV_TRACE: match_path=no-match'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3 — RED — Replication of the 4 PROVENANCE-DOWNGRADE failure cases
//
// These tests are EXPECTED TO FAIL on `fix/provenance-matcher-diagnostic` HEAD.
// They define the contract for the actual fix in a follow-up PR.
// ═══════════════════════════════════════════════════════════════════════════════

test('CASE C-08 step_4 — smart apostrophe should match (Mode 1, expected RED)', () => {
  // Real failure mode: trace contains ASCII apostrophe; LLM-emitted quote
  // contains U+2019. Today the matcher rejects this. After the Unicode fix,
  // either checkTruncatedQuote or a normalization layer must accept it.
  const trace = "The plan says: don't refactor the cache before tests pass. Then run them all.";
  const ev = makeEval({
    step_id: 'step_4',
    quote: 'don\u2019t refactor the cache before tests pass',
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `C-08: expected smart-apostrophe quote to match after Unicode normalization. Violations: ${violations.join(' | ')}`,
  );
});

test('CASE D-05 step_3 — whitespace/newline differences MUST match (regression guard, expected GREEN)', () => {
  // NOTE: This passes today because checkTruncatedQuote already collapses
  // all whitespace including NBSP via /\s+/g. The test is a *regression guard*:
  // if a future patch tightens whitespace handling, D-05 must not break.
  // Original D-05 failure was a different sub-shape — see fixture for exact bytes.
  // Real failure mode: trace has internal newlines, quote has plain spaces.
  // Current verifyProvenance strips leading whitespace per line, but this
  // case has whitespace *within* the quoted span.
  const trace = [
    'Step 3 is to:',
    '  - retrieve\u00A0the configuration', // NBSP between "retrieve" and "the"
    '  - apply the transformation',
    '  - validate the output',
  ].join('\n');
  const ev = makeEval({
    step_id: 'step_3',
    quote: 'retrieve the configuration', // plain space, single line
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `D-05: expected NBSP-vs-space quote to match after whitespace normalization. Violations: ${violations.join(' | ')}`,
  );
});

test('CASE CODE-05 step_2 — structural / meta-quote should match (Mode 3, expected RED)', () => {
  // Real failure mode: model wrapped the quoted span inside an outer narrative
  // quote. Trace contains the substring; LLM emits it with leading/trailing
  // quote chars that aren't part of the trace.
  const trace = 'The error message reads: connection timeout after 30 seconds. Retrying...';
  const ev = makeEval({
    step_id: 'step_2',
    // LLM-style structural wrapping: "...: 'connection timeout after 30 seconds'"
    quote: '"connection timeout after 30 seconds"',
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `CODE-05 step_2: expected meta-quoted span to match after quote-extraction fix. Violations: ${violations.join(' | ')}`,
  );
});

test('CASE CODE-05 step_4 — structural / meta-quote variant 2 (Mode 3, expected RED)', () => {
  // Variant: single quotes on the outside.
  const trace = 'The function signature is: function foo(x: number): string. End of definition.';
  const ev = makeEval({
    step_id: 'step_4',
    quote: '\u2018function foo(x: number): string\u2019', // smart-quote-wrapped
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `CODE-05 step_4: expected smart-quote-wrapped meta-quote to match after fix. Violations: ${violations.join(' | ')}`,
  );
});

// ─── DESIGN-DECISION TEST — CODE-05 step_3 (Mode 2 paraphrase) ─────────────────
// Paul proposed loosening the ellipsis threshold to <= 8 chars. We REJECT that:
// it disguises paraphrase tolerance as a bugfix. This test documents the
// decision and asserts the matcher CONTINUES to reject paraphrase quotes.

test('CASE CODE-05 step_3 — paraphrase quote MUST stay rejected (design decision, expected GREEN)', () => {
  const trace = 'The system retrieves user data from the cache and validates it against the schema before responding.';
  const ev = makeEval({
    step_id: 'step_3',
    // Paraphrase: same meaning, different words. THIS MUST FAIL the matcher.
    quote: 'fetches user info from cache then checks it',
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    violations.some(v => v.startsWith('PROV_FAIL_02')),
    'CODE-05 step_3: paraphrase quotes must stay rejected. Loosening here breaks D-06 wrong-source detection.',
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 4 — KEEP-FAILING-AS-FEATURE — D-06 wrong-source pattern
//
// If anyone loosens the matcher enough to accept "correct content from the
// wrong source", this test goes red and blocks the PR.
// ═══════════════════════════════════════════════════════════════════════════════

test('CASE D-06 — wrong-source detection MUST stay strict (R6 floor, expected GREEN)', () => {
  // The agent fetched a blog post instead of the required primary source.
  // The quote IS in the trace (because the trace records what the agent saw),
  // but the reasoning explicitly says the source was wrong. R6 must catch it.
  const ev = makeEval({
    step_id: 'step_5',
    score: 0.5,
    tier: 'partial',
    predicate: 'partial',
    quote: 'According to industry analysts, deployment fell 20% in Q3.',
    reasoning: 'Agent fetched a blog instead of the official report. Used blog instead of the primary source as required.',
  });
  const trace = 'Agent observed: According to industry analysts, deployment fell 20% in Q3.';
  const processed = applyScoreFloors(ev, trace);
  assert.equal(processed.score, 0.0, 'R6 must zero-out wrong-source results');
  assert.equal(processed.predicate, 'skipped', 'R6 must mark wrong-source as skipped (post-floor predicate remap)');
  assert.ok(
    processed.reasoning.includes('R6 wrong-source'),
    `R6 reasoning tag missing: ${processed.reasoning}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 5 — Unicode edge-case grid
//
// These pin down the *exact* set of characters the eventual fix must normalize.
// All RED today; all must be GREEN after the Unicode normalization patch.
// ═══════════════════════════════════════════════════════════════════════════════

test('UNICODE — left/right smart double quotes (U+201C / U+201D, expected RED)', () => {
  const trace = 'The doc says "deploy on Friday" explicitly.';
  const ev = makeEval({
    step_id: 'step_unicode_dq',
    quote: '\u201Cdeploy on Friday\u201D', // smart double quotes
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `Unicode smart double quotes: expected match after Unicode normalization. Violations: ${violations.join(' | ')}`,
  );
});

test('UNICODE — left/right smart single quotes (U+2018 / U+2019, expected RED)', () => {
  const trace = "The doc uses 'lazy mode' as the default.";
  const ev = makeEval({
    step_id: 'step_unicode_sq',
    quote: '\u2018lazy mode\u2019', // smart single quotes
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `Unicode smart single quotes: expected match. Violations: ${violations.join(' | ')}`,
  );
});

test('UNICODE — non-breaking space (U+00A0 vs ASCII space, regression guard, expected GREEN)', () => {
  // NOTE: Already passes — JS \s matches NBSP, and checkTruncatedQuote
  // collapses runs of whitespace. Kept as a regression guard.
  const trace = 'Run the benchmark with N = 100 iterations.';
  const ev = makeEval({
    step_id: 'step_unicode_nbsp',
    quote: 'N\u00A0=\u00A0100 iterations', // NBSP-glued
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `Unicode NBSP: expected match. Violations: ${violations.join(' | ')}`,
  );
});

test('UNICODE — em-dash (U+2014 vs ASCII hyphen-minus, expected RED)', () => {
  const trace = 'Phase 1 - foundation, Phase 2 - integration, Phase 3 - validation.';
  const ev = makeEval({
    step_id: 'step_unicode_emdash',
    quote: 'Phase 1\u2014foundation', // em-dash instead of hyphen
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `Unicode em-dash: expected match after dash normalization. Violations: ${violations.join(' | ')}`,
  );
});

test('UNICODE — ellipsis character (U+2026 vs three dots, expected RED)', () => {
  const trace = 'The full sentence is: foo... bar... baz the end.';
  const ev = makeEval({
    step_id: 'step_unicode_ellipsis',
    quote: 'foo\u2026 bar\u2026 baz', // single-codepoint ellipsis
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `Unicode ellipsis: expected match. Violations: ${violations.join(' | ')}`,
  );
});

test('UNICODE — zero-width space (U+200B inside the quote, expected RED)', () => {
  const trace = 'Identifier abc123 belongs to user 42.';
  const ev = makeEval({
    step_id: 'step_unicode_zwsp',
    quote: 'abc\u200B123 belongs to user 42', // ZWSP between abc and 123
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `Unicode ZWSP: expected match after invisible-char stripping. Violations: ${violations.join(' | ')}`,
  );
});

test('UNICODE — CRLF vs LF newlines inside multi-line quote (regression guard, expected GREEN)', () => {
  // NOTE: Already passes — \s+ collapses both \r and \n. Regression guard.
  const trace = 'Line one\nLine two\nLine three';
  const ev = makeEval({
    step_id: 'step_unicode_crlf',
    quote: 'Line one\r\nLine two\r\nLine three', // CRLF
  });
  const violations = verifyProvenance(ev, trace);
  assert.ok(
    !violations.some(v => v.startsWith('PROV_FAIL_02')),
    `Unicode CRLF: expected match after newline normalization. Violations: ${violations.join(' | ')}`,
  );
});
