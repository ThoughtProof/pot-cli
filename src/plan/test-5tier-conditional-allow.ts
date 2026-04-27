/**
 * PR-E + PR-F: 5-Tier Verdict + failScore-Gate-Decoupling Tests
 *
 * Tests the CONDITIONAL_ALLOW verdict tier and the PR-F failScore gate fix:
 * - Emitted when all critical steps pass but non-critical weaknesses exist
 * - Maps to ALLOW + conditions[] in public API
 * - Never emitted when ≥2 critical steps fail (stays HOLD/BLOCK)
 * - PR-F: failScore in [0.5, 1.0) → CONDITIONAL_ALLOW + low_confidence (not HOLD)
 * - PR-F: Margin Band is dormant defensive layer; flags low_confidence only.
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
// ADR-0003 v2.2: Weakness band is (0, 0.5625). 0.25 and 0.40 count.
//
// PR-F (ADR-0005, post-Hermes 2026-04-27): Margin Band is DORMANT. A non-
// critical supported predicate at 0.5625 no longer pushes into nonCritical-
// Weaknesses; it only flags low_confidence. So this case yields TWO
// weaknesses (was 3 in the pre-revision design), and low_confidence=true
// from the margin-band hit.
test('T3: CONDITIONAL_ALLOW — non-critical weaknesses (margin-band only flags low_confidence)', () => {
  const goldSteps = [
    makeStep(1, 'critical'),
    makeStep(2, 'supporting'),
    makeStep(3, 'supporting'),
    makeStep(4, 'supporting'),
  ];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.40, 'partial'),     // weak (R7/quote-too-short floor)
    makeEval('step_3', 0.25, 'partial'),     // weak
    makeEval('step_4', 0.5625, 'supported'), // margin band hit → flags low_confidence, no weakness add
  ];
  const { verdict, conditions, lowConfidence } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW');
  assert.equal(conditions!.length, 2, 'Two non-critical weaknesses (margin-band no longer adds a weakness)');
  assert.equal(lowConfidence, true, 'step_4 in margin band must flag low_confidence');
});

// ─── T4: Critical partial → PR-F: CONDITIONAL_ALLOW with low_confidence (was HOLD pre-PR-F)
// This is the PRIMARY PR-F change: failScore=0.5 is no longer a HOLD gate.
test('T4: Critical partial → CONDITIONAL_ALLOW + low_confidence (PR-F failScore-gate)', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'supporting')];
  const evals = [
    makeEval('step_1', 0.5, 'partial'),    // critical partial → failScore 0.5
    makeEval('step_2', 0.25, 'partial'),   // context weak
  ];
  const { verdict, lowConfidence, conditions } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW',
    'PR-F: failScore=0.5 → CONDITIONAL_ALLOW (was HOLD pre-PR-F)');
  assert.equal(lowConfidence, true, 'failScore-gate-band must flag low_confidence');
  assert.ok(conditions, 'Conditions must include both fragility and non-critical weakness');
  assert.ok(conditions!.some(c => c.includes('marginally unsupported')),
    'Conditions must surface critical-step fragility');
  assert.ok(conditions!.some(c => c.includes('step_2')),
    'Conditions must still surface non-critical weakness');
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

// ─── T10: Boundary — non-critical context at exactly 0.5625 ───────────────────
// ADR-0003 v2.2: A non-critical context step at 0.5625 has predicate=supported
// and is NOT below threshold → no weakness from the (0, threshold) range.
//
// PR-F (ADR-0005, post-Hermes 2026-04-27): score=0.5625 with predicate=supported
// IS in the (dormant) margin band. Margin band no longer pushes into
// nonCriticalWeaknesses; it only flags low_confidence. So a sole non-critical
// step at 0.5625 produces pure ALLOW + low_confidence=true.
test('T10: Non-critical at score=0.5625 → ALLOW + low_confidence (margin band dormant)', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'supporting')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.5625, 'supported'),
  ];
  const { verdict, lowConfidence, conditions } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'ALLOW',
    'PR-F: margin band is dormant → no weakness, no CA. Verdict path untouched.');
  assert.equal(lowConfidence, true,
    'Margin band hit must still flag low_confidence for public confidence metadata');
  assert.equal(conditions, undefined, 'No conditions array on pure ALLOW');
});

// ─── T11: Boundary — context at 0.49 IS a weakness ─────────────────────────
// ADR-0003 v2.2: Below SUPPORTED_THRESHOLD=0.5625 → counts as weakness.

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

// =========================================================================
// PR-F (ADR-0005): failScore-Gate-Decoupling + dormant Margin Band
// =========================================================================
//
// Empirical basis: Hermes' Variance-Run (Issue #21, 2026-04-27) showed
// that all 8 observed verdict-flips between two seed-pinned runs originated
// from the failScore gate, NOT from supportScore proximity to threshold.
// Mechanism: a critical step jittered between predicate=supported (score 0.50)
// and predicate=partial (score 0.40), flipping failScore between 0 and 0.5
// and crossing the pre-PR-F HOLD gate.
//
// PRIMARY FIX (T27, T32, T33, T34): failScore in [0.5, 1.0) → CONDITIONAL_ALLOW
//   with low_confidence=true. Eliminates 6/8 observed flips. failScore ≥ 1.0
//   still gates to HOLD, ≥ 2.0 still BLOCKs — audit-safety preserved.
//
// DEFENSIVE LAYER (T28, T29, T30, T31): Margin Band remains in code but
//   dormant. It only contributes to low_confidence, never mutates the verdict.
//
// Hard rules unaffected: D-06 (wrong-source) and P1 (BLOCK→ALLOW absolute 0)
// are evaluated upstream of deriveVerdict.

import {
  isInMarginBand,
  MARGIN_BAND_HALFWIDTH,
  SUPPORTED_THRESHOLD,
} from './graded-support-evaluator.js';

// ─── T27: Primary PR-F path — single critical partial → CA + low_confidence ──
// This is the central regression case from Hermes' Variance-Run: pre-PR-F
// this verdict was HOLD, post-PR-F it is CONDITIONAL_ALLOW + low_confidence.
test('T27: Single critical partial (failScore=0.5) → CONDITIONAL_ALLOW + low_confidence', () => {
  const goldSteps = [makeStep(1, 'critical')];
  const evals = [makeEval('step_1', 0.40, 'partial')]; // critical, partial → failScore 0.5
  const { verdict, lowConfidence, reasoning, conditions } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW',
    'PR-F: failScore=0.5 must route to CONDITIONAL_ALLOW (was HOLD pre-PR-F)');
  assert.equal(lowConfidence, true);
  assert.ok(reasoning.includes('failScore=0.5'));
  assert.ok(reasoning.includes('failScore-gate-decoupling'));
  assert.ok(conditions && conditions.length === 1, 'One fragility condition');
  assert.ok(conditions![0].includes('step_1'));
});

// ─── T28: Margin Band is dormant — does NOT alter verdict ────────────────────
test('T28: Critical supported in margin band → ALLOW (margin band no longer mutates verdict)', () => {
  const goldSteps = [makeStep(1, 'critical')];
  const evals = [makeEval('step_1', 0.5625, 'supported')]; // exactly at threshold, in band
  // Pre-revision: this was HOLD via Margin Band → criticalPartial → failScore=0.5.
  // Post-revision: Margin Band is dormant → criticalUnsupported empty,
  // criticalPartial empty, failScore=0 → pure ALLOW. low_confidence flags it.
  const { verdict, lowConfidence } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'ALLOW',
    'Margin band must NOT push to HOLD/CA — verdict path is untouched (Hermes 2026-04-27)');
  assert.equal(lowConfidence, true,
    'Margin band hit still surfaces as low_confidence for the public API');

  // Distance == MARGIN_BAND_HALFWIDTH must be excluded (strict <):
  const exactlyOnEdge = makeEval('step_1', 0.5125, 'supported');
  assert.equal(isInMarginBand(exactlyOnEdge), false,
    'Distance == MARGIN_BAND_HALFWIDTH must be excluded (strict <)');
  // Just-inside coverage:
  const justInside = makeEval('step_1', 0.5126, 'supported');
  assert.equal(isInMarginBand(justInside), true);
});

// ─── T29: Anti-regression — score ≥0.75 (audited reference cases) untouched ─
test('T29: Anti-regression — score ≥0.75 (CODE-05/MED-05/GAIA-02) ALLOW + high confidence', () => {
  for (const score of [0.75, 0.80, 0.95, 1.0]) {
    const evals = [makeEval('step_1', score, 'supported')];
    assert.equal(isInMarginBand(evals[0]), false,
      `score=${score} must be safely above margin band (zone is [0.5125, 0.6125))`);
    const goldSteps = [makeStep(1, 'critical')];
    const { verdict, lowConfidence } = deriveVerdict(evals, goldSteps);
    assert.equal(verdict, 'ALLOW', `score=${score} must remain ALLOW`);
    assert.equal(lowConfidence, false,
      `score=${score} must NOT trigger low_confidence (high confidence in public API)`);
  }
});

// ─── T30: predicate gating — only supported/faithful are margin-band candidates
test('T30: Margin band gates ONLY supported/faithful predicates, not partial/unsupported', () => {
  const partialInZone = makeEval('step_1', 0.5625, 'partial');
  assert.equal(isInMarginBand(partialInZone), false,
    'predicate=partial is excluded from margin band gating');
  const unsupportedInZone = makeEval('step_2', 0.5625, 'unsupported');
  assert.equal(isInMarginBand(unsupportedInZone), false,
    'predicate=unsupported is excluded from margin band gating');
  const faithfulInZone = makeEval('step_3', 0.5625, 'faithful');
  assert.equal(isInMarginBand(faithfulInZone), true,
    'predicate=faithful (faithfulness mode) IS gated by margin band');
});

// ─── T31: Public mapping — lowConfidence → metadata.confidence='low' ─────────
test('T31: toPublicVerdict({lowConfidence: true}) sets metadata.confidence=low', () => {
  // ALLOW (engine) + low confidence → ALLOW (public) + confidence=low
  const allowLow = toPublicVerdict('ALLOW', undefined, { lowConfidence: true });
  assert.equal(allowLow.verdict, 'ALLOW');
  assert.equal(allowLow.metadata.confidence, 'low');

  // CONDITIONAL_ALLOW + low → ALLOW (public) + confidence=low + conditions
  const caLow = toPublicVerdict('CONDITIONAL_ALLOW', ['step_1: marginally unsupported'], { lowConfidence: true });
  assert.equal(caLow.verdict, 'ALLOW');
  assert.equal(caLow.metadata.confidence, 'low');
  assert.equal(caLow.metadata.conditions!.length, 1);

  // HOLD + low → UNCERTAIN + confidence=low
  const holdLow = toPublicVerdict('HOLD', undefined, { lowConfidence: true });
  assert.equal(holdLow.verdict, 'UNCERTAIN');
  assert.equal(holdLow.metadata.confidence, 'low');
  assert.equal(holdLow.metadata.review_needed, true);

  // No flag → confidence=high (default)
  const allowHigh = toPublicVerdict('ALLOW');
  assert.equal(allowHigh.metadata.confidence, 'high', 'Default confidence must be high');

  // Confidence is ALWAYS present (Paul Entscheidung 2A)
  for (const v of ['ALLOW', 'HOLD', 'BLOCK', 'CONDITIONAL_ALLOW', 'DISSENT'] as const) {
    const r = toPublicVerdict(v);
    assert.ok(r.metadata.confidence === 'high' || r.metadata.confidence === 'low',
      `${v}: confidence must be either 'high' or 'low'`);
  }

  // Sanity: MARGIN_BAND_HALFWIDTH constant is exported and equals 0.05 (default)
  assert.equal(MARGIN_BAND_HALFWIDTH, 0.05, 'Default halfwidth pinned to 0.05');
  assert.equal(SUPPORTED_THRESHOLD, 0.5625, 'Threshold pinned to 0.5625 (ADR-0003 v2.2)');
});

// =========================================================================
// PR-F NEW TESTS T32–T34: failScore-gate band coverage + audit-safety
// =========================================================================

// ─── T32: Lower edge of failScore-gate band — failScore=0 still pure ALLOW ───
test('T32: failScore=0 (no critical issues) → pure ALLOW + high confidence', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'critical')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.75, 'supported'),
  ];
  const { verdict, lowConfidence, reasoning } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'ALLOW');
  assert.equal(lowConfidence, false);
  assert.ok(!reasoning.includes('failScore-gate-decoupling'),
    'Pure-ALLOW reasoning must not mention failScore-gate fix path');
});

// ─── T33: Upper edge of failScore-gate band — failScore=1.0 → HOLD ───────────
// This is the audit-safety boundary: TWO critical issues (≥1.0) still HOLD.
// One unsupported (1.0) + zero partial → failScore=1.0.
// One partial (0.5) × 2 → failScore=1.0.
test('T33: failScore=1.0 → HOLD (audit-safety boundary preserved)', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'critical')];
  // Path A: 1 unsupported critical → failScore=1.0
  {
    const evals = [
      makeEval('step_1', 0.0, 'unsupported'),
      makeEval('step_2', 1.0, 'supported'),
    ];
    const { verdict, reasoning } = deriveVerdict(evals, goldSteps);
    assert.equal(verdict, 'HOLD', 'failScore=1.0 (1 unsupported) must HOLD');
    assert.ok(reasoning.includes('failScore=1'));
  }
  // Path B: 2 partial critical → failScore=1.0
  {
    const evals = [
      makeEval('step_1', 0.40, 'partial'),
      makeEval('step_2', 0.40, 'partial'),
    ];
    const { verdict } = deriveVerdict(evals, goldSteps);
    assert.equal(verdict, 'HOLD', 'failScore=1.0 (2 partial) must HOLD');
  }
});

// ─── T34: BLOCK boundary unchanged — failScore≥2.0 → BLOCK ───────────────────
// "BLOCK→ALLOW=0" Hard-Rule P1: 2+ critical unsupported MUST stay BLOCK
// regardless of low_confidence flag.
test('T34: failScore≥2.0 → BLOCK (Hard-Rule P1 preserved, BLOCK→ALLOW=0)', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'critical')];
  const evals = [
    makeEval('step_1', 0.0, 'unsupported'),
    makeEval('step_2', 0.0, 'unsupported'),
  ];
  const { verdict } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'BLOCK', 'failScore=2.0 must BLOCK (Hard-Rule P1)');

  // Public mapping: BLOCK + low_confidence still BLOCK (no downgrade)
  const pub = toPublicVerdict('BLOCK', undefined, { lowConfidence: true });
  assert.equal(pub.verdict, 'BLOCK', 'Public BLOCK with low_confidence must STILL be BLOCK');
  assert.equal(pub.metadata.confidence, 'low');
});
