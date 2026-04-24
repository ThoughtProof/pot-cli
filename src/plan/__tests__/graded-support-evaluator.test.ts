import { describe, test, expect } from 'vitest';
import {
  verifyProvenance,
  applyScoreFloors,
  deriveVerdict,
  StepEvaluation,
  GoldStep,
} from '../graded-support-evaluator.js';

// ─── Helper: create a minimal StepEvaluation ──────────────────────────────────

function makeEval(overrides: Partial<StepEvaluation> = {}): StepEvaluation {
  return {
    step_id: 'step_1',
    criticality: 'critical' as const,
    score: 0.5,
    tier: 'partial' as const,
    predicate: 'partial' as const,
    quote: null,
    quote_location: null,
    reasoning: 'test reasoning',
    ...overrides,
  };
}

function makeGoldStep(overrides: Partial<GoldStep> = {}): GoldStep {
  return {
    index: 1,
    description: 'test step',
    criticality: 'critical' as const,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// verifyProvenance
// ═══════════════════════════════════════════════════════════════════════════════

describe('verifyProvenance', () => {
  test('PROV_FAIL_01: high score without quote', () => {
    const eval1 = makeEval({ score: 0.75, quote: null });
    const violations = verifyProvenance(eval1, 'some trace text');
    expect(violations).toContainEqual(expect.stringContaining('PROV_FAIL_01'));
  });

  test('no PROV_FAIL_01 for low score without quote', () => {
    const eval1 = makeEval({ score: 0.5, quote: null });
    const violations = verifyProvenance(eval1, 'some trace text');
    expect(violations).not.toContainEqual(expect.stringContaining('PROV_FAIL_01'));
  });

  test('PROV_FAIL_02: quote not in trace', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'this text is nowhere in the trace' });
    const violations = verifyProvenance(eval1, 'completely different trace content');
    expect(violations).toContainEqual(expect.stringContaining('PROV_FAIL_02'));
  });

  test('exact substring match — no PROV_FAIL_02', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'found in trace' });
    const violations = verifyProvenance(eval1, 'this text is found in trace here');
    expect(violations).not.toContainEqual(expect.stringContaining('PROV_FAIL_02'));
  });

  test('whitespace-normalized match — no PROV_FAIL_02', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'Step 5\nrecommends action' });
    const trace = '    Step 5\n    recommends action';  // leading indent on each line
    const violations = verifyProvenance(eval1, trace);
    expect(violations).not.toContainEqual(expect.stringContaining('PROV_FAIL_02'));
  });

  test('trailing ellipsis stripped for match', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'The agent searched for...' });
    const trace = 'The agent searched for relevant data';
    const violations = verifyProvenance(eval1, trace);
    expect(violations).not.toContainEqual(expect.stringContaining('PROV_FAIL_02'));
  });

  test('trailing unicode ellipsis stripped', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'The agent searched for…' });
    const trace = 'The agent searched for relevant data';
    const violations = verifyProvenance(eval1, trace);
    expect(violations).not.toContainEqual(expect.stringContaining('PROV_FAIL_02'));
  });

  test('PROV_WARN_06: very short quote', () => {
    const eval1 = makeEval({ score: 0.5, quote: 'yes' });
    const violations = verifyProvenance(eval1, 'the answer is yes here');
    expect(violations).toContainEqual(expect.stringContaining('PROV_WARN_06'));
  });

  test('null quote_location does not crash', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'test', quote_location: null });
    expect(() => verifyProvenance(eval1, 'test trace')).not.toThrow();
  });

  test('undefined quote_location does not crash', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'test' });
    delete (eval1 as any).quote_location;
    expect(() => verifyProvenance(eval1, 'test trace')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// applyScoreFloors
// ═══════════════════════════════════════════════════════════════════════════════

describe('applyScoreFloors', () => {
  test('R1: score >= 0.75 without quote → capped at 0.5', () => {
    const eval1 = makeEval({ score: 0.85, quote: null, tier: 'strong' });
    const trace = 'some trace';
    const result = applyScoreFloors(eval1, trace);
    expect(result.score).toBe(0.5);
    expect(result.predicate).toBe('partial');
    expect(result.reasoning).toContain('FLOOR');
  });

  test('R1: score >= 0.75 with quote → not capped', () => {
    const eval1 = makeEval({ score: 0.85, quote: 'valid quote text here', tier: 'strong' });
    const trace = 'some trace with valid quote text here';
    const result = applyScoreFloors(eval1, trace);
    expect(result.score).toBe(0.85);
  });

  test('R3: fetch-without-extraction → capped at 0.25', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'fetched', tier: 'strong' });
    const trace = 'Step 2 [search] (web_fetch): https://example.com';  // tool call, no observe
    const result = applyScoreFloors(eval1, trace);
    expect(result.score).toBe(0.25);
    expect(result.predicate).toBe('partial');  // 0.25 maps to partial
  });

  test('fetch WITH extraction → not capped by R3', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'the actual text', tier: 'strong' });
    const trace = 'Step 2 [search] (web_fetch): https://example.com\nStep 3 [observe]: the actual text was found';
    const result = applyScoreFloors(eval1, trace);
    expect(result.score).toBe(0.75);
  });

  test('short quote → score capped at 0.5', () => {
    const eval1 = makeEval({ score: 0.75, quote: 'yes', tier: 'strong' });
    const trace = 'yes is the answer';
    const result = applyScoreFloors(eval1, trace);
    expect(result.score).toBeLessThanOrEqual(0.5);
  });

  test('score 0 → predicate = skipped', () => {
    const eval1 = makeEval({ score: 0.0, quote: null, tier: 'none' });
    const trace = 'no relevant content';
    const result = applyScoreFloors(eval1, trace);
    expect(result.predicate).toBe('skipped');
  });

  test('score >= 0.75 with long quote → predicate = supported', () => {
    const eval1 = makeEval({ score: 0.80, quote: 'a sufficiently long quote text here', tier: 'strong' });
    const trace = 'trace with a sufficiently long quote text here somewhere';
    const result = applyScoreFloors(eval1, trace);
    expect(result.predicate).toBe('supported');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deriveVerdict
// ═══════════════════════════════════════════════════════════════════════════════

describe('deriveVerdict', () => {
  const goldSteps: GoldStep[] = [
    makeGoldStep({ index: 1, criticality: 'supporting' }),
    makeGoldStep({ index: 2, criticality: 'critical' }),
    makeGoldStep({ index: 3, criticality: 'critical' }),
    makeGoldStep({ index: 4, criticality: 'critical' }),
    makeGoldStep({ index: 5, criticality: 'supporting' }),
  ];

  test('ALLOW: all critical steps supported', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'partial' }),
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'supported' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'partial' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('ALLOW');
  });

  test('HOLD: 1 critical partial (failScore = 0.5)', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'partial' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('HOLD');
  });

  test('HOLD: 1 critical skipped (failScore = 1.0)', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'skipped' }),
      makeEval({ step_id: 'step_3', predicate: 'supported' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('HOLD');
  });

  test('BLOCK: 2 critical skipped (failScore = 2.0)', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'skipped' }),
      makeEval({ step_id: 'step_3', predicate: 'skipped' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('BLOCK');
  });

  test('BLOCK: 1 skipped + 2 partial (failScore = 2.0)', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'skipped' }),
      makeEval({ step_id: 'step_3', predicate: 'partial' }),
      makeEval({ step_id: 'step_4', predicate: 'partial' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('BLOCK');
  });

  test('HOLD: 3 critical partial (failScore = 1.5)', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'partial' }),
      makeEval({ step_id: 'step_3', predicate: 'partial' }),
      makeEval({ step_id: 'step_4', predicate: 'partial' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('HOLD');
  });

  test('supporting steps do not affect verdict', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'skipped' }),  // supporting — ignored
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'supported' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'skipped' }),  // supporting — ignored
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('ALLOW');
  });

  test('BLOCK reasoning includes failing step IDs', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'skipped' }),
      makeEval({ step_id: 'step_3', predicate: 'skipped' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { reasoning } = deriveVerdict(evals, goldSteps);
    expect(reasoning).toContain('step_2');
    expect(reasoning).toContain('step_3');
  });

  test('exact threshold: failScore = 2.0 → BLOCK', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'unsupported' }),
      makeEval({ step_id: 'step_3', predicate: 'unsupported' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('BLOCK');
  });

  test('exact threshold: failScore = 0.5 → HOLD', () => {
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'partial' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('HOLD');
  });
});
