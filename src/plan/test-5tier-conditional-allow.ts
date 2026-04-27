/**
 * PR-E: 5-Tier Verdict — CONDITIONAL_ALLOW Tests
 *
 * Tests the new CONDITIONAL_ALLOW verdict tier:
 * - Emitted when all critical steps pass but non-critical weaknesses exist
 * - Maps to ALLOW + conditions[] in public API
 * - Never emitted when any critical step fails (stays HOLD/BLOCK)
 * - Conditions array lists specific non-critical weaknesses
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVerdict, type StepEvaluation, type GoldStep } from './graded-support-evaluator.js';
import { toPublicVerdict } from '../verdict-mapper.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(index: number, criticality: 'critical' | 'supporting'): GoldStep {
  return { index, description: `Step ${index}`, criticality };
}

function makeEval(stepId: string, score: number, predicate: string): StepEvaluation {
  return {
    step_id: stepId,
    score,
    tier: score >= 0.75 ? 'strong' : score >= 0.5 ? 'partial' : score > 0 ? 'weak' : 'none',
    predicate: predicate as any,
    reasoning: `Test: ${predicate} at ${score}`,
    quote: score > 0 ? 'test quote' : null,
    quote_location: { line_start: null, line_end: null, char_offset_start: null, char_offset_end: null, turn: null },
    quote_to_criterion_mapping: null,
    abstain_if_uncertain: false,
  };
}

// ─── T1: Pure ALLOW — all steps fully supported ──────────────────────────────

test('T1: Pure ALLOW — all critical + context steps fully supported', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'critical'), makeStep(3, 'supporting')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.75, 'supported'),
    makeEval('step_3', 0.75, 'supported'),
  ];
  const { verdict, conditions } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'ALLOW', 'All steps strong+ → pure ALLOW');
  assert.equal(conditions, undefined, 'No conditions on pure ALLOW');
});

// ─── T2: CONDITIONAL_ALLOW — critical pass, context weak ─────────────────────

test('T2: CONDITIONAL_ALLOW — critical steps pass, non-critical weakness', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'critical'), makeStep(3, 'supporting')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.75, 'supported'),
    makeEval('step_3', 0.25, 'partial'),  // non-critical weakness
  ];
  const { verdict, conditions } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW', 'Critical pass + context weak → CONDITIONAL_ALLOW');
  assert.ok(conditions, 'Conditions array must exist');
  assert.equal(conditions!.length, 1, 'Exactly 1 non-critical weakness');
  assert.ok(conditions![0].includes('step_3'), 'Condition references the weak step');
});

// ─── T3: CONDITIONAL_ALLOW — multiple context weaknesses ─────────────────────
// ADR-0003 v2.1: Weakness band shifted to (0, 0.50). 0.25 is below threshold and
// counts as weakness; 0.40 (R7/quote-too-short floor) also counts; 0.50 is the
// new "supported" floor and does NOT count.

test('T3: CONDITIONAL_ALLOW — multiple non-critical weaknesses', () => {
  const goldSteps = [
    makeStep(1, 'critical'),
    makeStep(2, 'supporting'),
    makeStep(3, 'supporting'),
    makeStep(4, 'supporting'),
  ];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.40, 'partial'),   // weak (R7/quote-too-short floor)
    makeEval('step_3', 0.25, 'partial'),   // weak
    makeEval('step_4', 0.50, 'supported'), // at supported floor — no condition
  ];
  const { verdict, conditions } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW');
  assert.equal(conditions!.length, 2, 'Two non-critical weaknesses');
});

// ─── T4: Critical fail trumps context weakness → HOLD, not CONDITIONAL_ALLOW ─

test('T4: Critical partial → HOLD, even with context weakness', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'supporting')];
  const evals = [
    makeEval('step_1', 0.5, 'partial'),   // critical partial → failScore 0.5 → HOLD
    makeEval('step_2', 0.25, 'partial'),   // context weak
  ];
  const { verdict } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'HOLD', 'Critical partial overrides context weakness → HOLD');
});

// ─── T5: Critical unsupported → BLOCK, not CONDITIONAL_ALLOW ────────────────

test('T5: Critical unsupported → BLOCK, regardless of context', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'critical'), makeStep(3, 'supporting')];
  const evals = [
    makeEval('step_1', 0.0, 'unsupported'),
    makeEval('step_2', 0.0, 'unsupported'),
    makeEval('step_3', 0.5, 'partial'),
  ];
  const { verdict } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'BLOCK', 'Two critical unsupported → BLOCK');
});

// ─── T6: Context score=0 does NOT trigger CONDITIONAL_ALLOW ──────────────────

test('T6: Context score=0 (none) does not count as weakness', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'supporting')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.0, 'unsupported'),  // score=0, not > 0
  ];
  const { verdict } = deriveVerdict(evals, goldSteps);
  // score=0 is NOT in range (0, 0.75), so no weakness → pure ALLOW
  assert.equal(verdict, 'ALLOW', 'Context score=0 is not a weakness, it is absence');
});

// ─── T7: Public mapping — CONDITIONAL_ALLOW → ALLOW + conditions ─────────────

test('T7: verdict-mapper: CONDITIONAL_ALLOW → ALLOW with conditions', () => {
  const pub = toPublicVerdict('CONDITIONAL_ALLOW', ['step_3: partial (non-critical)']);
  assert.equal(pub.verdict, 'ALLOW');
  assert.ok(pub.metadata.conditions, 'conditions must be present');
  assert.equal(pub.metadata.conditions!.length, 1);
  assert.equal(pub.metadata.schema_version, 'v2');
});

// ─── T8: Public mapping — pure ALLOW has no conditions ───────────────────────

test('T8: verdict-mapper: pure ALLOW has no conditions', () => {
  const pub = toPublicVerdict('ALLOW');
  assert.equal(pub.verdict, 'ALLOW');
  assert.equal(pub.metadata.conditions, undefined);
});

// ─── T9: HOLD mapping unchanged ─────────────────────────────────────────────

test('T9: verdict-mapper: HOLD → UNCERTAIN (unchanged)', () => {
  const pub = toPublicVerdict('HOLD');
  assert.equal(pub.verdict, 'UNCERTAIN');
  assert.equal(pub.metadata.review_needed, true);
});

// ─── T10: Boundary — context at exactly 0.50 is NOT a weakness ──────────────
// ADR-0003 v2.1: New supported floor is SUPPORTED_THRESHOLD = 0.50.
// A non-critical context step at 0.50 is at the boundary → supported → no weakness.

test('T10: Context score=0.50 (supported floor) → no weakness → pure ALLOW', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'supporting')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.50, 'supported'),
  ];
  const { verdict } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'ALLOW', 'score=0.50 is at supported boundary → no weakness');
});

// ─── T11: Boundary — context at 0.49 IS a weakness ─────────────────────────
// ADR-0003 v2.1: Just below SUPPORTED_THRESHOLD → counts as weakness.

test('T11: Context score=0.49 → weakness → CONDITIONAL_ALLOW', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'supporting')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.49, 'partial'),
  ];
  const { verdict } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW');
});

// ─── T12: Only-critical-steps case → never CONDITIONAL_ALLOW ────────────────

test('T12: All-critical steps, all pass → pure ALLOW (no context to weaken)', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'critical')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.75, 'supported'),
  ];
  const { verdict } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'ALLOW', 'No context steps → no weaknesses → ALLOW');
});

// ─── T13: EvaluatorVerdict type exported correctly ───────────────────────────

test('T13: EvaluatorVerdict type includes CONDITIONAL_ALLOW', () => {
  // This is a compile-time test — if it compiles, CONDITIONAL_ALLOW is in the type
  const verdicts: import('./graded-support-evaluator.js').EvaluatorVerdict[] = [
    'ALLOW', 'CONDITIONAL_ALLOW', 'HOLD', 'BLOCK',
  ];
  assert.equal(verdicts.length, 4);
});
