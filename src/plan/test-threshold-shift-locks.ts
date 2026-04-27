/**
 * ADR-0003 v2.1 — Threshold-Shift Lock-Tests (T17–T24).
 *
 * Locks the new predicate band shift (supported ≥ 0.50, partial 0.25–0.49,
 * unsupported < 0.25) and the three coordinated floors (R1=0.25, R7=0.40,
 * Quote-too-short=0.40) against accidental regression.
 *
 * Lock contract:
 *   T17. score=0.49 raw → partial (just below new supported floor)
 *   T18. score=0.50 raw → supported (at new floor, with quote)
 *   T19. score=0.74 raw → supported (well above new floor, with quote)
 *   T20. R7 cross-step input=0.75 → capped to 0.40 → partial
 *   T21. Quote-too-short input=0.75 → capped to 0.40 → partial
 *   T22. R1 no-quote input=0.75 → capped to 0.25 → partial
 *   T23. score=0.25 raw → partial (PARTIAL_THRESHOLD is inclusive — Paul boundary flag)
 *   T24. score=0.2499 raw → unsupported (Float-Rounding-Lock just below boundary)
 *
 * These tests pin numeric constants AND predicate transitions. They will fail
 * loudly if any of {SUPPORTED_THRESHOLD, PARTIAL_THRESHOLD, R1_NO_QUOTE_FLOOR,
 * R7_CROSS_STEP_FLOOR, QUOTE_TOO_SHORT_FLOOR} drifts from the v2.1 contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScoreFloors,
  SUPPORTED_THRESHOLD,
  PARTIAL_THRESHOLD,
  R1_NO_QUOTE_FLOOR,
  R7_CROSS_STEP_FLOOR,
  QUOTE_TOO_SHORT_FLOOR,
  type StepEvaluation,
} from './graded-support-evaluator.js';

// ─── Helper ────────────────────────────────────────────────────────────────

function buildEval(opts: {
  score: number;
  quote: string | null;
  reasoning?: string;
}): StepEvaluation {
  return {
    step_id: 'test_step',
    score: opts.score,
    tier: opts.score >= 0.5 ? 'partial' : opts.score > 0 ? 'weak' : 'none',
    quote: opts.quote,
    quote_location: { line_start: null, line_end: null, char_offset_start: null, char_offset_end: null, turn: null },
    quote_to_criterion_mapping: null,
    reasoning: opts.reasoning ?? 'Plain reasoning describing single-step support directly from trace.',
    abstain_if_uncertain: false,
    predicate: 'partial',
  };
}

// A trace excerpt that is "well-formed" (has both tool-call and response indicators)
// so R3 fetch-without-extraction does not fire.
const TRACE_OK = '[TOOL_CALL] web_fetch(...)\n[TOOL_RESULT] full response body here.\n[EXTRACTED] some content.';

// ─── Constant-pin tests (defensive) ─────────────────────────────────────────

test('Constants: ADR-0003 v2.1 numeric values are locked', () => {
  assert.equal(SUPPORTED_THRESHOLD, 0.50, 'SUPPORTED_THRESHOLD must be 0.50');
  assert.equal(PARTIAL_THRESHOLD, 0.25, 'PARTIAL_THRESHOLD must be 0.25');
  assert.equal(R1_NO_QUOTE_FLOOR, 0.25, 'R1_NO_QUOTE_FLOOR must be 0.25');
  assert.equal(R7_CROSS_STEP_FLOOR, 0.40, 'R7_CROSS_STEP_FLOOR must be 0.40');
  assert.equal(QUOTE_TOO_SHORT_FLOOR, 0.40, 'QUOTE_TOO_SHORT_FLOOR must be 0.40');
});

// ─── T17: Just below supported floor → partial ──────────────────────────────

test('T17: score=0.49 with quote → partial (just below SUPPORTED_THRESHOLD)', () => {
  const out = applyScoreFloors(
    buildEval({ score: 0.49, quote: 'verbatim quote from the trace excerpt' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.49, 'score must pass through unchanged');
  assert.equal(out.predicate, 'partial', '0.49 < 0.50 → partial band');
});

// ─── T18: At supported floor → supported ────────────────────────────────────

test('T18: score=0.50 with quote → supported (at SUPPORTED_THRESHOLD, inclusive)', () => {
  const out = applyScoreFloors(
    buildEval({ score: 0.50, quote: 'verbatim quote from the trace excerpt' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.50, 'score must pass through unchanged');
  assert.equal(out.predicate, 'supported', '0.50 ≥ SUPPORTED_THRESHOLD AND quote present → supported');
});

// ─── T19: Well above supported floor → supported ────────────────────────────

test('T19: score=0.74 with quote → supported (in new supported band)', () => {
  const out = applyScoreFloors(
    buildEval({ score: 0.74, quote: 'verbatim quote from the trace excerpt' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.74, 'score must pass through unchanged');
  assert.equal(out.predicate, 'supported', '0.74 in new supported band');
});

// ─── T20: R7 cross-step floor caps to 0.40 ──────────────────────────────────

test('T20: R7 cross-step input=0.75 → capped to R7_CROSS_STEP_FLOOR (0.40), partial', () => {
  const out = applyScoreFloors(
    buildEval({
      score: 0.75,
      quote: 'verbatim quote from one of the steps',
      reasoning: 'Evidence spans multiple trace steps via Plan-then-Execute pattern (R7 cross-step aliasing).',
    }),
    TRACE_OK,
  );
  assert.equal(out.score, R7_CROSS_STEP_FLOOR, 'cross-step caps at 0.40');
  assert.equal(out.predicate, 'partial', '0.40 < SUPPORTED_THRESHOLD → partial');
  assert.match(out.reasoning, /R7 cross-step/);
});

// ─── T21: Quote-too-short floor caps to 0.40 ────────────────────────────────

test('T21: Quote-too-short input=0.75 → capped to QUOTE_TOO_SHORT_FLOOR (0.40), partial', () => {
  const out = applyScoreFloors(
    buildEval({
      score: 0.75,
      quote: 'short',  // < 10 chars
      reasoning: 'Quote present but minimal.',
    }),
    TRACE_OK,
  );
  assert.equal(out.score, QUOTE_TOO_SHORT_FLOOR, 'quote-too-short caps at 0.40');
  assert.equal(out.predicate, 'partial', '0.40 < SUPPORTED_THRESHOLD → partial');
  assert.match(out.reasoning, /quote too short/);
});

// ─── T22: R1 no-quote floor caps to 0.25 ────────────────────────────────────

test('T22: R1 no-quote input=0.75 → capped to R1_NO_QUOTE_FLOOR (0.25), partial', () => {
  const out = applyScoreFloors(
    buildEval({
      score: 0.75,
      quote: null,  // R1 trigger
      reasoning: 'High-confidence reasoning but no verbatim quote extracted.',
    }),
    TRACE_OK,
  );
  assert.equal(out.score, R1_NO_QUOTE_FLOOR, 'R1 no-quote caps at 0.25');
  assert.equal(out.predicate, 'partial', '0.25 ≥ PARTIAL_THRESHOLD → partial (boundary, inclusive)');
  assert.match(out.reasoning, /R1 no-quote/);
});

// ─── T23: PARTIAL_THRESHOLD boundary — inclusive ────────────────────────────

test('T23: score=0.25 raw → partial (PARTIAL_THRESHOLD is inclusive, Paul boundary flag)', () => {
  // Note: a quote is present and trace is OK, so neither R1 nor quote-too-short fires.
  const out = applyScoreFloors(
    buildEval({ score: 0.25, quote: 'a sufficiently long quote here' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.25, 'score must pass through unchanged');
  assert.equal(out.predicate, 'partial', '0.25 ≥ PARTIAL_THRESHOLD → partial (inclusive boundary)');
});

// ─── T24: Float-Rounding-Lock — just below 0.25 → unsupported ───────────────

test('T24: score=0.2499 raw → unsupported (Float-Rounding-Lock just below PARTIAL_THRESHOLD)', () => {
  const out = applyScoreFloors(
    buildEval({ score: 0.2499, quote: 'a sufficiently long quote here' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.2499, 'score must pass through unchanged');
  assert.equal(out.predicate, 'unsupported', '0.2499 < PARTIAL_THRESHOLD → unsupported');
});
