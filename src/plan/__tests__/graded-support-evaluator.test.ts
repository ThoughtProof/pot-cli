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
  test('R1: score >= 0.75 without quote → capped at 0.25 (post-ADR-0003)', () => {
    // ADR-0003 v2.2: R1_NO_QUOTE_FLOOR shifted from 0.5 → 0.25. A high score
    // without provenance now collapses to PARTIAL_THRESHOLD (0.25), still
    // mapping to `partial` predicate.
    const eval1 = makeEval({ score: 0.85, quote: null, tier: 'strong' });
    const trace = 'some trace';
    const result = applyScoreFloors(eval1, trace);
    expect(result.score).toBe(0.25);
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

  test('CONDITIONAL_ALLOW: all critical supported, non-critical partial weaknesses (PR-F)', () => {
    // PR-F (ADR-0005): non-critical steps with predicate `partial` (score 0.5,
    // in (0, 0.5625)) count as nonCriticalWeaknesses → CONDITIONAL_ALLOW with
    // conditions attached. Critical-only path remains untouched.
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'partial' }),       // supporting → weakness
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'supported' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'partial' }),       // supporting → weakness
    ];
    const { verdict, conditions } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('CONDITIONAL_ALLOW');
    expect(conditions).toBeDefined();
    expect(conditions!.length).toBeGreaterThan(0);
  });

  test('ALLOW: all critical supported, no non-critical weaknesses', () => {
    // Pure ALLOW path: every step has score ≥ SUPPORTED_THRESHOLD (0.5625),
    // so no nonCriticalWeakness is emitted and no CONDITIONAL_ALLOW promotion.
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported', score: 0.85 }),
      makeEval({ step_id: 'step_2', predicate: 'supported', score: 0.85 }),
      makeEval({ step_id: 'step_3', predicate: 'supported', score: 0.85 }),
      makeEval({ step_id: 'step_4', predicate: 'supported', score: 0.85 }),
      makeEval({ step_id: 'step_5', predicate: 'supported', score: 0.85 }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('ALLOW');
  });

  test('CONDITIONAL_ALLOW: 1 critical partial (failScore = 0.5, PR-F)', () => {
    // PR-F (failScore-Gate-Decoupling, ADR-0005): failScore=0.5 is in [0.5, 1.0)
    // → CONDITIONAL_ALLOW + low_confidence (was HOLD pre-PR-F). Hermes' variance
    // data showed this band oscillates predictably; CA preserves audit safety
    // while exposing the marginal critical step as a fragility condition.
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'partial' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('CONDITIONAL_ALLOW');
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

  test('supporting steps do not affect critical-gate verdict (PR-F: surface as conditions)', () => {
    // Pre-PR-F invariant: non-critical steps cannot trigger HOLD/BLOCK.
    // Post-PR-F: non-critical weaknesses surface as CONDITIONAL_ALLOW conditions
    // (no critical-gate impact, no verdict downgrade past ALLOW-equivalent).
    // The skipped non-critical steps here (default makeEval score=0.5, predicate
    // `skipped`) → score 0.5 is in (0, 0.5625) → counted as nonCriticalWeakness
    // → CONDITIONAL_ALLOW. Critical gate is untouched; this is the design intent.
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'skipped' }),  // supporting — surfaces as condition
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'supported' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'skipped' }),  // supporting — surfaces as condition
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('CONDITIONAL_ALLOW');
  });

  test('supporting steps with score 0 do not affect verdict (true ALLOW)', () => {
    // True non-critical no-op: score=0 falls outside the (0, 0.5625) weakness
    // window, so no conditions are emitted and the gate returns plain ALLOW.
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'skipped', score: 0 }),
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'supported' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'skipped', score: 0 }),
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

  test('exact threshold: failScore = 0.5 → CONDITIONAL_ALLOW (PR-F gate-decoupling)', () => {
    // PR-F boundary lock (ADR-0005): failScore=0.5 sits at the lower edge of
    // [0.5, 1.0) and now routes to CONDITIONAL_ALLOW + low_confidence. The
    // failScore≥1.0 → HOLD boundary is locked separately (T33).
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported' }),
      makeEval({ step_id: 'step_2', predicate: 'supported' }),
      makeEval({ step_id: 'step_3', predicate: 'partial' }),
      makeEval({ step_id: 'step_4', predicate: 'supported' }),
      makeEval({ step_id: 'step_5', predicate: 'supported' }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('CONDITIONAL_ALLOW');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// resolveEvidenceSource (ADR-0009 — Answer-Consistency-Step)
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveEvidenceSource (ADR-0009)', () => {
  const item = {
    id: 'test',
    question: 'Q?',
    answer: 'ANSWER-TEXT',
    trace_steps: 'TRACE-TEXT',
    gold_plan_steps: [] as GoldStep[],
  };

  test('returns trace_steps for legacy step (no step_type)', async () => {
    const { resolveEvidenceSource } = await import('../graded-support-evaluator.js');
    const step = makeGoldStep();
    expect(resolveEvidenceSource(item, step)).toBe('TRACE-TEXT');
  });

  test('returns trace_steps for explicit trace_evidence step', async () => {
    const { resolveEvidenceSource } = await import('../graded-support-evaluator.js');
    const step = makeGoldStep({ step_type: 'trace_evidence' });
    expect(resolveEvidenceSource(item, step)).toBe('TRACE-TEXT');
  });

  test('returns answer for answer_consistency step', async () => {
    const { resolveEvidenceSource } = await import('../graded-support-evaluator.js');
    const step = makeGoldStep({ step_type: 'answer_consistency' });
    expect(resolveEvidenceSource(item, step)).toBe('ANSWER-TEXT');
  });

  test('answer-quote against answer-evidence does NOT trigger PROV_FAIL_02', () => {
    // The whole point of ADR-0009: a quote drawn from the agent answer must
    // verify cleanly when the provenance check is rerouted to the answer.
    const evalWithAnswerQuote = makeEval({
      score: 0.85,
      quote: '$5,000 or more regardless of amount',
    });
    const answer = 'SAR filing threshold is $5,000 or more regardless of amount.';
    const violations = verifyProvenance(evalWithAnswerQuote, answer);
    expect(violations).not.toContainEqual(expect.stringContaining('PROV_FAIL_02'));
  });

  test('answer-quote against trace_steps DOES trigger PROV_FAIL_02 (negative control)', () => {
    // Without the routing fix, this is the exact failure mode that would
    // false-downgrade every answer_consistency step.
    const evalWithAnswerQuote = makeEval({
      score: 0.85,
      quote: '$5,000 or more regardless of amount',
    });
    const trace = 'Trace step 4: 31 CFR 1020.320 confirms $5,000 with suspect; $25,000 no suspect.';
    const violations = verifyProvenance(evalWithAnswerQuote, trace);
    expect(violations).toContainEqual(expect.stringContaining('PROV_FAIL_02'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deriveVerdict v3-Calibration (ADR-0009 — 0.5× AC weights + AC-Floor)
// Hermes 2026-04-28 v3-Run zeigte 0/16 HOLD — zusätzlicher AC-fail pushte
// failScore über 2.0 → BLOCK. Calibration:
//   AC unsupported/skipped × 0.5 (war 1.0); AC partial × 0.25 (war 0.5).
//   AC-Floor: AC-fail + saubere TE-Steps → max HOLD, nie BLOCK.
// ════════════════════════════════════════════════════════════════════════════

describe('deriveVerdict v3-calibration (ADR-0009)', () => {
  test('AC weight 0.5×: 1 TE-skipped + 1 AC-skipped → HOLD (was BLOCK pre-calib)', () => {
    // failScore = 1.0 (TE skipped) + 0.5 (AC skipped) = 1.5 → HOLD.
    // Pre-calibration: 1.0 + 1.0 = 2.0 → BLOCK. Calibration prevents that flip.
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical', step_type: 'answer_consistency' }),
    ];
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'skipped', score: 0 }),
      makeEval({ step_id: 'step_2', predicate: 'skipped', score: 0 }),
    ];
    const { verdict, reasoning } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('HOLD');
    // The reasoning should signal the per-type breakdown so audits can see
    // the calibration applied.
    expect(reasoning).toMatch(/TE.*AC/);
  });

  test('AC-Floor: 2 TE-partial + 1 AC-skipped, would-be-BLOCK → HOLD via floor', () => {
    // The exact MRM-03-shaped case Hermes flagged: TE has multiple partials
    // pushing failScore high, but trace-research is sound (no TE skipped).
    // Without floor: TE 2×0.5 + AC 1×0.5 = 1.5 → HOLD already (calib alone
    // suffices here). To force the floor path we need failScore ≥ 2.0 with
    // zero TE-skipped: 4 TE-partial (2.0) + 1 AC-skipped (0.5) = 2.5.
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical' }),
      makeGoldStep({ index: 3, criticality: 'critical' }),
      makeGoldStep({ index: 4, criticality: 'critical' }),
      makeGoldStep({ index: 5, criticality: 'critical', step_type: 'answer_consistency' }),
    ];
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'partial', score: 0.4 }),
      makeEval({ step_id: 'step_2', predicate: 'partial', score: 0.4 }),
      makeEval({ step_id: 'step_3', predicate: 'partial', score: 0.4 }),
      makeEval({ step_id: 'step_4', predicate: 'partial', score: 0.4 }),
      makeEval({ step_id: 'step_5', predicate: 'skipped', score: 0 }),
    ];
    const { verdict, reasoning } = deriveVerdict(evals, goldSteps);
    // failScore = 4×0.5 + 0.5 = 2.5 → would BLOCK — but no TE-skipped, so
    // AC-Floor caps to HOLD.
    expect(verdict).toBe('HOLD');
    expect(reasoning).toContain('ac-floor');
  });

  test('AC-Floor inactive: TE-skipped present → BLOCK still possible', () => {
    // Negative control for the floor: when ANY TE-step is skipped/unsupported,
    // the trace-research itself is not sound, so AC-Floor must NOT kick in
    // — the verdict can still escalate to BLOCK on aggregate failScore.
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical' }),
      makeGoldStep({ index: 3, criticality: 'critical', step_type: 'answer_consistency' }),
    ];
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'skipped', score: 0 }),  // TE skipped → floor inactive
      makeEval({ step_id: 'step_2', predicate: 'skipped', score: 0 }),  // TE skipped
      makeEval({ step_id: 'step_3', predicate: 'skipped', score: 0 }),  // AC skipped
    ];
    const { verdict, reasoning } = deriveVerdict(evals, goldSteps);
    // failScore = 2×1.0 + 0.5 = 2.5 ≥ 2.0 AND TE-unsupported.length > 0 → BLOCK.
    expect(verdict).toBe('BLOCK');
    expect(reasoning).not.toContain('ac-floor');
  });

  test('AC partial only, all TE clean → HOLD via floor (UNCERTAIN-band rescue)', () => {
    // Hermes' UNCERTAIN-cluster: AC-step came back as partial (score 0.25-0.5),
    // TE-steps are all supported. Pre-calibration this would have been a
    // partial → 0.5 failScore → CONDITIONAL_ALLOW (the UNCERTAIN band). With
    // the floor active, even a partial AC-fail must rescue to HOLD when the
    // trace itself was sound.
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical' }),
      makeGoldStep({ index: 3, criticality: 'critical', step_type: 'answer_consistency' }),
    ];
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported', score: 0.85 }),
      makeEval({ step_id: 'step_2', predicate: 'supported', score: 0.85 }),
      makeEval({ step_id: 'step_3', predicate: 'partial', score: 0.4 }),
    ];
    const { verdict, reasoning } = deriveVerdict(evals, goldSteps);
    // failScore = 0 + 0.25 = 0.25 < 0.5 — normally ALLOW. But AC-Floor active
    // (≥1 AC-fail, 0 TE-unsupported), so cap to HOLD.
    expect(verdict).toBe('HOLD');
    expect(reasoning).toContain('ac-floor');
  });

  test('All-supported clean plan with AC step → ALLOW (floor inactive)', () => {
    // Sanity: presence of an answer_consistency step alone does not trigger
    // the floor. Only AC-FAILS trigger it.
    const goldSteps: GoldStep[] = [
      makeGoldStep({ index: 1, criticality: 'critical' }),
      makeGoldStep({ index: 2, criticality: 'critical', step_type: 'answer_consistency' }),
    ];
    const evals: StepEvaluation[] = [
      makeEval({ step_id: 'step_1', predicate: 'supported', score: 0.85 }),
      makeEval({ step_id: 'step_2', predicate: 'supported', score: 0.85 }),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    expect(verdict).toBe('ALLOW');
  });
});
