/**
 * Mode 5 Detection — unit tests.
 *
 * Coverage: each probe (5a, 5b, 5c) on positive/negative cases plus the
 * aggregator. Edge cases: false-positive guards, sentence-terminator
 * handling, ellipsis as legitimate truncation marker.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCrossLineFragmentTail,
  detectMidWordTermination,
  detectBridgeSpan,
  detectMode5,
} from './mode5-truncation-detection.js';

// ─── Probe 5a: cross_line_fragment_tail ────────────────────────────────────

test('5a: CODE-02 step_1 pattern — "Step 4 [se" tail matches new line in trace', () => {
  const trace = [
    'Step 1 [reason]: We need to check broken access control patterns.',
    'Step 2 [search]: OWASP Top 10 2021 Broken Access Control',
    'Step 3 [observe]: A01:2021 — Broken Access Control covers privilege escalation.',
    'Step 4 [search]: example.com/owasp-top-10',
    'Step 5 [observe]: confirmed.',
  ].join('\n');

  const quote =
    'A01:2021 — Broken Access Control covers privilege escalation.\nStep 4 [se';

  const result = detectCrossLineFragmentTail(quote, trace);

  assert.equal(result.isCrossLine, true);
  assert.equal(result.fragmentTail, 'Step 4 [se');
  assert.ok(result.matchedSpan !== null);
});

test('5a: clean quote without linebreak — no signal', () => {
  const trace = 'Step 1: foo. Step 2: bar.';
  const quote = 'Step 1: foo.';
  const result = detectCrossLineFragmentTail(quote, trace);
  assert.equal(result.isCrossLine, false);
});

test('5a: linebreak but tail not found in trace — no signal (false-positive guard)', () => {
  const trace = 'Step 1: foo.\nStep 2: bar.';
  const quote = 'Step 1: foo.\nUnrelated tail';
  const result = detectCrossLineFragmentTail(quote, trace);
  assert.equal(result.isCrossLine, false);
});

test('5a: tail too long (>16 chars) — no signal', () => {
  const trace = 'Step 1: foo.\nThis is a much longer sentence that exceeds the heuristic threshold.';
  const quote = 'Step 1: foo.\nThis is a much longer sentence';
  const result = detectCrossLineFragmentTail(quote, trace);
  assert.equal(result.isCrossLine, false);
});

// ─── Probe 5b: mid_word_termination ────────────────────────────────────────

test('5b: ends on bracket "[se" → mid-word', () => {
  const r = detectMidWordTermination('Step 4 [se');
  assert.equal(r.isMidWord, true);
});

test('5b: ends on letter mid-word', () => {
  const r = detectMidWordTermination('The cat sat on the m');
  assert.equal(r.isMidWord, true);
});

test('5b: ends on period — clean', () => {
  const r = detectMidWordTermination('The cat sat on the mat.');
  assert.equal(r.isMidWord, false);
});

test('5b: ends on ellipsis — clean (model-style truncation marker)', () => {
  const r = detectMidWordTermination('The cat sat on the mat ...');
  assert.equal(r.isMidWord, false);
});

test('5b: ends on closing bracket — clean', () => {
  const r = detectMidWordTermination('See OWASP A01:2021 (broken access control)');
  assert.equal(r.isMidWord, false);
});

test('5b: ends on question mark — clean', () => {
  const r = detectMidWordTermination('Is this OWASP A01?');
  assert.equal(r.isMidWord, false);
});

// ─── Probe 5c: bridge_span_concat ──────────────────────────────────────────

test('5c: two spans concatenated across non-adjacent trace lines → bridge', () => {
  const trace = [
    'Step 1: alpha alpha alpha.',
    'Step 2: middle middle middle.',
    'Step 3: omega omega omega.',
  ].join('\n');

  // Quote concatenates step 1 and step 3, skipping step 2
  const quote = 'alpha alpha alpha.\nomega omega omega.';

  const result = detectBridgeSpan(quote, trace);
  assert.equal(result.isBridge, true);
});

test('5c: adjacent lines concatenated — NOT a bridge (legitimate)', () => {
  const trace = ['line one here', 'line two here'].join('\n');
  const quote = 'line one here\nline two here';
  const result = detectBridgeSpan(quote, trace);
  assert.equal(result.isBridge, false);
});

test('5c: right half too short (< 4 chars) — no signal', () => {
  const trace = ['line one here', 'XYZ'].join('\n');
  const quote = 'line one here\nXYZ';
  const result = detectBridgeSpan(quote, trace);
  assert.equal(result.isBridge, false);
});

test('5c: left half not found in trace — no signal', () => {
  const trace = ['present line', 'another line'].join('\n');
  const quote = 'absent left half\npresent line';
  const result = detectBridgeSpan(quote, trace);
  assert.equal(result.isBridge, false);
});

// ─── Aggregator ────────────────────────────────────────────────────────────

test('detectMode5: CODE-02 pattern triggers 5a + 5b together', () => {
  const trace = [
    'Step 1: foo bar baz.',
    'Step 2: more content here.',
    'Step 4 [search]: example.com',
  ].join('\n');
  const quote = 'foo bar baz.\nStep 4 [se';

  const result = detectMode5(quote, trace);
  assert.ok(result.signals.includes('cross_line_fragment_tail'));
  assert.ok(result.signals.includes('mid_word_termination'));
});

test('detectMode5: clean quote ending on punctuation yields no signals', () => {
  const trace = 'The cat sat on the mat. Then it slept.';
  const quote = 'The cat sat on the mat.';
  const result = detectMode5(quote, trace);
  assert.equal(result.signals.length, 0);
});

test('detectMode5: bridge span triggers only 5c', () => {
  const trace = [
    'Step 1: alpha alpha alpha alpha.',
    'Step 2: filler filler filler.',
    'Step 3: omega omega omega omega.',
  ].join('\n');
  const quote = 'alpha alpha alpha alpha.\nomega omega omega omega.';
  const result = detectMode5(quote, trace);
  assert.ok(result.signals.includes('bridge_span_concat'));
  // Quote ends on ".", so 5b should NOT fire
  assert.ok(!result.signals.includes('mid_word_termination'));
});

test('detectMode5: idempotent on repeated calls (no hidden state)', () => {
  const trace = 'Step 1: foo bar.\nStep 2: baz qux.';
  const quote = 'Step 1: foo bar.';
  const r1 = detectMode5(quote, trace);
  const r2 = detectMode5(quote, trace);
  const r3 = detectMode5(quote, trace);
  assert.deepEqual(r1.signals, r2.signals);
  assert.deepEqual(r2.signals, r3.signals);
});
