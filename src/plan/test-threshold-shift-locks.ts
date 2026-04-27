/**
 * ADR-0003 v2.2 — Threshold-Shift Lock-Tests (T17–T26).
 *
 * Locks the v2.2 predicate band shift (supported ≥ 0.5625, partial
 * 0.25–0.5624, unsupported < 0.25) and the three coordinated floors
 * (R1=0.25, R7=0.40, Quote-too-short=0.40) against accidental regression.
 *
 * v2.2 changelog vs v2.1: SUPPORTED_THRESHOLD shifted 0.50 → 0.5625 after
 * Phase-2 CM Threshold-Sweep (Hermes, 2026-04-27) showed 0.5625 as the
 * empirical sweet spot (plateau 0.5625–0.75 at 86.6% accuracy, 0 gold=HOLD
 * regressions vs 4 at 0.50). Paul ratified Hard-Rule P1 Auslegung 3 after
 * auditing the 3 remaining gold=ALLOW cases (CODE-05, MED-05, GAIA-02).
 *
 * Lock contract:
 *   T17. score=0.49 raw → partial (well below new v2.2 supported floor)
 *   T18. score=0.5625 raw → supported (at new v2.2 floor, with quote)
 *   T19. score=0.74 raw → supported (well above new floor, with quote)
 *   T20. R7 cross-step input=0.75 → capped to 0.40 → partial
 *   T21. Quote-too-short input=0.75 → capped to 0.40 → partial
 *   T22. R1 no-quote input=0.75 → capped to 0.25 → partial
 *   T23. score=0.25 raw → partial (PARTIAL_THRESHOLD is inclusive — Paul boundary flag)
 *   T24. score=0.2499 raw → unsupported (Float-Rounding-Lock just below boundary)
 *   T25. score=0.5624 raw → partial (v2.2 Float-Rounding-Lock just below new supported floor)
 *   T26. score=0.50 raw → partial (v2.2 anti-regression: 0.50 cluster must NOT be supported)
 *
 * These tests pin numeric constants AND predicate transitions. They will fail
 * loudly if any of {SUPPORTED_THRESHOLD, PARTIAL_THRESHOLD, R1_NO_QUOTE_FLOOR,
 * R7_CROSS_STEP_FLOOR, QUOTE_TOO_SHORT_FLOOR} drifts from the v2.2 contract.
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

test('Constants: ADR-0003 v2.2 numeric values are locked', () => {
  assert.equal(SUPPORTED_THRESHOLD, 0.5625, 'SUPPORTED_THRESHOLD must be 0.5625 (v2.2)');
  assert.equal(PARTIAL_THRESHOLD, 0.25, 'PARTIAL_THRESHOLD must be 0.25');
  assert.equal(R1_NO_QUOTE_FLOOR, 0.25, 'R1_NO_QUOTE_FLOOR must be 0.25');
  assert.equal(R7_CROSS_STEP_FLOOR, 0.40, 'R7_CROSS_STEP_FLOOR must be 0.40');
  assert.equal(QUOTE_TOO_SHORT_FLOOR, 0.40, 'QUOTE_TOO_SHORT_FLOOR must be 0.40');
});

// ─── T17: Just below supported floor → partial ──────────────────────────────

test('T17: score=0.49 with quote → partial (well below v2.2 SUPPORTED_THRESHOLD)', () => {
  const out = applyScoreFloors(
    buildEval({ score: 0.49, quote: 'verbatim quote from the trace excerpt' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.49, 'score must pass through unchanged');
  assert.equal(out.predicate, 'partial', '0.49 < 0.5625 → partial band');
});

// ─── T18: At supported floor → supported ────────────────────────────────────

test('T18: score=0.5625 with quote → supported (at v2.2 SUPPORTED_THRESHOLD, inclusive)', () => {
  const out = applyScoreFloors(
    buildEval({ score: 0.5625, quote: 'verbatim quote from the trace excerpt' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.5625, 'score must pass through unchanged');
  assert.equal(out.predicate, 'supported', '0.5625 ≥ SUPPORTED_THRESHOLD AND quote present → supported');
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

// ─── T25: v2.2 Float-Rounding-Lock just below new supported floor ────────────

test('T25: score=0.5624 raw → partial (v2.2 Float-Rounding-Lock just below SUPPORTED_THRESHOLD)', () => {
  const out = applyScoreFloors(
    buildEval({ score: 0.5624, quote: 'a sufficiently long quote here' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.5624, 'score must pass through unchanged');
  assert.equal(out.predicate, 'partial', '0.5624 < 0.5625 → partial (Float-Rounding-Lock for v2.2 floor)');
});

// ─── T26: v2.2 anti-regression — 0.50 cluster must NOT be supported ──────────

test('T26: score=0.50 raw → partial (v2.2 anti-regression: 0.50 DS+Gemini cluster must land in partial)', () => {
  // The DS+Gemini score-cluster bimodal mode at 0.50 was the source of the
  // gold=HOLD regressions in v2.1 Phase-2 CM. v2.2 deliberately places the
  // floor above 0.50 so this cluster is non-supported. This test pins that
  // intent: if 0.50 ever maps to supported again, this test will fail loudly.
  const out = applyScoreFloors(
    buildEval({ score: 0.50, quote: 'verbatim quote from the trace excerpt' }),
    TRACE_OK,
  );
  assert.equal(out.score, 0.50, 'score must pass through unchanged');
  assert.equal(out.predicate, 'partial', '0.50 < 0.5625 → partial (v2.2 contract: 0.50 cluster is partial, not supported)');
});
