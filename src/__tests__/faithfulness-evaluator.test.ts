/**
 * faithfulness-evaluator.test.ts
 * ===============================
 * Tests for Faithfulness mode in the graded support evaluator.
 * Validates: mode selection, predicate mapping, score floors, Tier-1 disablement.
 */

import { describe, it, expect } from 'vitest';
import {
  applyScoreFloors,
  verifyProvenance,
  deriveVerdict,
  type StepEvaluation,
  type GoldStep,
  type EvalMode,
  type FaithfulnessPredicate,
} from '../plan/graded-support-evaluator.js';

// ── Helper: create a StepEvaluation ──

function makeStepEval(overrides: Partial<StepEvaluation> = {}): StepEvaluation {
  return {
    step_id: 'step_1',
    score: 0.5,
    tier: 'partial',
    quote: null,
    quote_location: { line_start: null, line_end: null, char_offset_start: null, char_offset_end: null, turn: null },
    quote_to_criterion_mapping: null,
    reasoning: 'Test reasoning',
    abstain_if_uncertain: false,
    predicate: 'partial',
    ...overrides,
  };
}

function makeGoldStep(overrides: Partial<GoldStep> = {}): GoldStep {
  return {
    index: 1,
    description: 'Test step',
    criticality: 'critical',
    ...overrides,
  };
}

// ── Predicate Mapping Tests ──

describe('Faithfulness mode: predicate mapping', () => {
  it('maps score >= 0.75 with quote to "faithful"', () => {
    const ev = makeStepEval({ score: 0.8, quote: 'The agent reasoned about X before acting' });
    const result = applyScoreFloors(ev, 'some trace', 'faithfulness');
    expect(result.predicate).toBe('faithful');
  });

  it('maps score 0.5 to "partially_faithful"', () => {
    const ev = makeStepEval({ score: 0.5 });
    const result = applyScoreFloors(ev, 'some trace', 'faithfulness');
    expect(result.predicate).toBe('partially_faithful');
  });

  it('maps score 0.25 to "weakly_faithful"', () => {
    const ev = makeStepEval({ score: 0.25 });
    const result = applyScoreFloors(ev, 'some trace', 'faithfulness');
    expect(result.predicate).toBe('weakly_faithful');
  });

  it('maps score 0.0 to "unfaithful"', () => {
    const ev = makeStepEval({ score: 0.0 });
    const result = applyScoreFloors(ev, 'some trace', 'faithfulness');
    expect(result.predicate).toBe('unfaithful');
  });

  it('caps score >= 0.75 without quote to 0.5 (F1 rule)', () => {
    const ev = makeStepEval({ score: 0.75, quote: null });
    const result = applyScoreFloors(ev, 'some trace', 'faithfulness');
    expect(result.score).toBe(0.5);
    expect(result.predicate).toBe('partially_faithful');
  });
});

// ── Support mode: predicate mapping unchanged ──

describe('Support mode: predicate mapping (regression)', () => {
  it('maps score 0.0 to "skipped"', () => {
    const ev = makeStepEval({ score: 0.0 });
    const result = applyScoreFloors(ev, 'some trace', 'support');
    expect(result.predicate).toBe('skipped');
  });

  it('maps score >= 0.75 with quote to "supported"', () => {
    const ev = makeStepEval({ score: 0.8, quote: 'Evidence from the trace that matches' });
    const result = applyScoreFloors(ev, 'Evidence from the trace that matches', 'support');
    expect(result.predicate).toBe('supported');
  });

  it('maps score 0.25 to "partial"', () => {
    const ev = makeStepEval({ score: 0.25 });
    const result = applyScoreFloors(ev, 'some trace', 'support');
    expect(result.predicate).toBe('partial');
  });
});

// ── R6 wrong-source: only fires in support mode ──

describe('R6 wrong-source: mode-specific', () => {
  it('fires in support mode', () => {
    const ev = makeStepEval({ score: 0.5, reasoning: 'Agent used blog instead of official source' });
    const result = applyScoreFloors(ev, 'some trace', 'support');
    expect(result.score).toBe(0.0);
    expect(result.reasoning).toContain('R6 wrong-source');
  });

  it('does NOT fire in faithfulness mode', () => {
    const ev = makeStepEval({ score: 0.5, reasoning: 'Agent used blog instead of official source' });
    const result = applyScoreFloors(ev, 'some trace', 'faithfulness');
    expect(result.score).toBe(0.5);
    expect(result.reasoning).not.toContain('R6');
  });
});

// ── Verdict derivation works with faithfulness predicates ──

describe('deriveVerdict with faithfulness predicates', () => {
  it('BLOCK when 2+ critical steps are unfaithful', () => {
    const evals: StepEvaluation[] = [
      makeStepEval({ step_id: 'step_1', predicate: 'unfaithful', score: 0.0 }),
      makeStepEval({ step_id: 'step_2', predicate: 'unfaithful', score: 0.0 }),
      makeStepEval({ step_id: 'step_3', predicate: 'faithful', score: 0.8 }),
    ];
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical' }),
      makeGoldStep({ index: 3, criticality: 'supporting' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('BLOCK');
  });

  it('HOLD when 1 critical step is weakly_faithful', () => {
    const evals: StepEvaluation[] = [
      makeStepEval({ step_id: 'step_1', predicate: 'weakly_faithful', score: 0.25 }),
      makeStepEval({ step_id: 'step_2', predicate: 'faithful', score: 0.9 }),
    ];
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('HOLD');
  });

  it('HOLD when 1 critical step is partially_faithful', () => {
    const evals: StepEvaluation[] = [
      makeStepEval({ step_id: 'step_1', predicate: 'partially_faithful', score: 0.5 }),
      makeStepEval({ step_id: 'step_2', predicate: 'faithful', score: 0.8 }),
    ];
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('HOLD');
  });

  it('ALLOW when all critical steps are faithful', () => {
    const evals: StepEvaluation[] = [
      makeStepEval({ step_id: 'step_1', predicate: 'faithful', score: 0.9 }),
      makeStepEval({ step_id: 'step_2', predicate: 'faithful', score: 0.8 }),
    ];
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('ALLOW');
  });
});
