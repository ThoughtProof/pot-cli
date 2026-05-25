/**
 * combined-evaluation.test.ts
 * ============================
 * Tests for ADR-0016: Combined Evaluation Mode.
 * Validates: mergeConservative (4×4 verdict matrix), disagreement detection,
 * verdictSource attribution, evaluateItem mode=combined guard.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeConservative,
  type ItemResult,
  type EvaluatorVerdict,
  type CombinedItemResult,
  evaluateItem,
} from '../plan/graded-support-evaluator.js';

// ── Helper: create a minimal ItemResult for testing mergeConservative ──

function makeItemResult(verdict: EvaluatorVerdict, id: string = 'test-01'): ItemResult {
  return {
    id,
    step_evaluations: [],
    verdict,
    verdict_reasoning: `Test verdict: ${verdict}`,
    provenance_violations: [],
  };
}

// ── 4×4 Verdict Matrix (ADR-0016 §Verdict Ordering & Merge Rule) ──

describe('mergeConservative: 4×4 verdict matrix', () => {
  const verdicts: EvaluatorVerdict[] = ['BLOCK', 'HOLD', 'CONDITIONAL_ALLOW', 'ALLOW'];

  // Expected merged verdict for each (faithfulness, support) pair.
  // Row = faithfulness, Col = support. Result = min(f, s).
  const expected: Record<string, Record<string, EvaluatorVerdict>> = {
    BLOCK: {
      BLOCK: 'BLOCK',
      HOLD: 'BLOCK',
      CONDITIONAL_ALLOW: 'BLOCK',
      ALLOW: 'BLOCK',
    },
    HOLD: {
      BLOCK: 'BLOCK',
      HOLD: 'HOLD',
      CONDITIONAL_ALLOW: 'HOLD',
      ALLOW: 'HOLD',
    },
    CONDITIONAL_ALLOW: {
      BLOCK: 'BLOCK',
      HOLD: 'HOLD',
      CONDITIONAL_ALLOW: 'CONDITIONAL_ALLOW',
      ALLOW: 'CONDITIONAL_ALLOW',
    },
    ALLOW: {
      BLOCK: 'BLOCK',
      HOLD: 'HOLD',
      CONDITIONAL_ALLOW: 'CONDITIONAL_ALLOW',
      ALLOW: 'ALLOW',
    },
  };

  for (const f of verdicts) {
    for (const s of verdicts) {
      it(`F=${f} + S=${s} → ${expected[f][s]}`, () => {
        const faith = makeItemResult(f);
        const support = makeItemResult(s);
        const result = mergeConservative(faith, support);
        expect(result.verdict).toBe(expected[f][s]);
      });
    }
  }
});

// ── ALLOW requires unanimity ──

describe('mergeConservative: ALLOW requires unanimity', () => {
  it('ALLOW only when both evaluators agree', () => {
    const faith = makeItemResult('ALLOW');
    const support = makeItemResult('ALLOW');
    const result = mergeConservative(faith, support);
    expect(result.verdict).toBe('ALLOW');
    expect(result.disagreement.detected).toBe(false);
    expect(result.verdictSource).toBe('unanimous');
  });

  it('any non-ALLOW blocks ALLOW', () => {
    for (const restrictive of ['BLOCK', 'HOLD', 'CONDITIONAL_ALLOW'] as EvaluatorVerdict[]) {
      const faith = makeItemResult('ALLOW');
      const support = makeItemResult(restrictive);
      const result = mergeConservative(faith, support);
      expect(result.verdict).toBe(restrictive);
      expect(result.verdict).not.toBe('ALLOW');
    }
  });
});

// ── Disagreement Detection ──

describe('mergeConservative: disagreement detection', () => {
  it('detects disagreement when verdicts differ', () => {
    const faith = makeItemResult('ALLOW');
    const support = makeItemResult('HOLD');
    const result = mergeConservative(faith, support);
    expect(result.disagreement.detected).toBe(true);
    expect(result.disagreement.restrictingMode).toBe('support');
    expect(result.verdictSource).toBe('support');
  });

  it('faithfulness restricts when it is stricter', () => {
    const faith = makeItemResult('BLOCK');
    const support = makeItemResult('ALLOW');
    const result = mergeConservative(faith, support);
    expect(result.verdict).toBe('BLOCK');
    expect(result.disagreement.detected).toBe(true);
    expect(result.disagreement.restrictingMode).toBe('faithfulness');
    expect(result.verdictSource).toBe('faithfulness');
  });

  it('no disagreement when verdicts match', () => {
    const faith = makeItemResult('HOLD');
    const support = makeItemResult('HOLD');
    const result = mergeConservative(faith, support);
    expect(result.disagreement.detected).toBe(false);
    expect(result.disagreement.restrictingMode).toBe('none');
    expect(result.verdictSource).toBe('unanimous');
  });
});

// ── Disagreement Summary ──

describe('mergeConservative: disagreement summary', () => {
  it('includes both verdicts and restricting mode in summary', () => {
    const faith = makeItemResult('ALLOW');
    const support = makeItemResult('HOLD');
    const result = mergeConservative(faith, support);
    expect(result.disagreement.summary).toContain('Faithfulness=ALLOW');
    expect(result.disagreement.summary).toContain('Support=HOLD');
    expect(result.disagreement.summary).toContain('restricted by support');
  });

  it('unanimous summary does not mention restriction', () => {
    const faith = makeItemResult('BLOCK');
    const support = makeItemResult('BLOCK');
    const result = mergeConservative(faith, support);
    expect(result.disagreement.summary).toContain('Both evaluators: BLOCK');
    expect(result.disagreement.summary).not.toContain('restricted');
  });
});

// ── CombinedItemResult structure ──

describe('mergeConservative: result structure', () => {
  it('preserves both individual reports', () => {
    const faith = makeItemResult('ALLOW');
    const support = makeItemResult('HOLD');
    const result = mergeConservative(faith, support);

    expect(result.faithfulness).toBe(faith);
    expect(result.support).toBe(support);
    expect(result.faithfulness.verdict).toBe('ALLOW');
    expect(result.support.verdict).toBe('HOLD');
  });

  it('preserves the input id', () => {
    const faith = makeItemResult('ALLOW', 'GAIA-01');
    const support = makeItemResult('HOLD', 'GAIA-01');
    const result = mergeConservative(faith, support);
    expect(result.id).toBe('GAIA-01');
  });
});

// ── GAIA-01 Scenario (the motivating case from ADR-0016) ──

describe('ADR-0016 motivating case: GAIA-01', () => {
  it('faithfulness=ALLOW + support=HOLD → combined=HOLD', () => {
    const faith = makeItemResult('ALLOW', 'GAIA-01');
    faith.verdict_reasoning = 'Reasoning chain is sound, agent followed logical steps.';

    const support = makeItemResult('HOLD', 'GAIA-01');
    support.verdict_reasoning = 'R6: trace uses HCI bibliography (secondary source) instead of primary paper.';

    const result = mergeConservative(faith, support);
    expect(result.verdict).toBe('HOLD');
    expect(result.verdictSource).toBe('support');
    expect(result.disagreement.detected).toBe(true);
  });
});

// ── evaluateItem mode=combined guard ──

describe('evaluateItem: mode=combined throws', () => {
  it('rejects combined mode with a helpful error message', async () => {
    const item = {
      id: 'test',
      question: 'test',
      answer: 'test',
      trace_steps: 'test',
      gold_plan_steps: [],
    };

    await expect(
      evaluateItem(item, 'grok', { mode: 'combined' }),
    ).rejects.toThrow('mode=combined is not supported here');
  });
});

// ── Symmetry check ──

describe('mergeConservative: symmetry', () => {
  it('verdict is symmetric (same result regardless of which mode is stricter)', () => {
    const verdicts: EvaluatorVerdict[] = ['BLOCK', 'HOLD', 'CONDITIONAL_ALLOW', 'ALLOW'];
    for (const a of verdicts) {
      for (const b of verdicts) {
        const ab = mergeConservative(makeItemResult(a), makeItemResult(b));
        const ba = mergeConservative(makeItemResult(b), makeItemResult(a));
        expect(ab.verdict).toBe(ba.verdict);
      }
    }
  });

  it('verdictSource swaps correctly (faithfulness vs support attribution)', () => {
    // F=ALLOW, S=HOLD → support restricts
    const r1 = mergeConservative(makeItemResult('ALLOW'), makeItemResult('HOLD'));
    expect(r1.verdictSource).toBe('support');

    // F=HOLD, S=ALLOW → faithfulness restricts
    const r2 = mergeConservative(makeItemResult('HOLD'), makeItemResult('ALLOW'));
    expect(r2.verdictSource).toBe('faithfulness');
  });
});
