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
// ADR-0003 v2.2: Weakness band is (0, 0.5625). 0.25 is below threshold and
// counts as weakness; 0.40 (R7/quote-too-short floor) also counts; 0.5625 is
// the new "supported" floor and does NOT count. NB: this test sets predicate
// directly via makeEval, so it tests deriveVerdict's predicate-handling, not
// the score → predicate mapping (locked separately in test-threshold-shift-locks).

// PR-F (ADR-0005, 2026-04-27): score=0.5625 with predicate=supported now
// falls inside the Margin Band [SUPPORTED_THRESHOLD - 0.05, +0.05) and counts
// as a non-critical weakness with `margin_band_triggered=true`. So this case
// now produces THREE weaknesses (was 2 pre-PR-F). The trade-off is intentional:
// borderline `supported` predicates are surfaced to customers via
// metadata.confidence='borderline' rather than silently flipping run-to-run.
test('T3: CONDITIONAL_ALLOW — multiple non-critical weaknesses (incl. margin-band)', () => {
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
    makeEval('step_4', 0.5625, 'supported'), // PR-F: in margin band → weakness
  ];
  const { verdict, conditions, marginBandTriggered } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW');
  assert.equal(conditions!.length, 3, 'Three non-critical weaknesses (2 partial + 1 margin-band supported)');
  assert.equal(marginBandTriggered, true, 'step_4 supported at threshold triggered margin band');
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

// ─── T10: Boundary — context at exactly 0.5625 is NOT a weakness ──────────────
// ADR-0003 v2.2: New supported floor is SUPPORTED_THRESHOLD = 0.5625.
// A non-critical context step at 0.5625 is at the boundary → supported → no weakness.

// PR-F (ADR-0005): score=0.5625 with predicate=supported now falls inside the
// Margin Band [SUPPORTED_THRESHOLD - 0.05, +0.05). For non-critical steps,
// this surfaces as a weakness AND sets margin_band_triggered=true.
// Rationale: Hermes' Variance-Run (Issue #21, 2026-04-27) showed `supported`
// predicates at the threshold flipped run-to-run due to Grok-API non-determinism;
// pushing them to CONDITIONAL_ALLOW is the audit-reproducibility fix Paul
// ratified as launch-blocker.
test('T10: Context score=0.5625 → in margin band → CONDITIONAL_ALLOW (PR-F)', () => {
  const goldSteps = [makeStep(1, 'critical'), makeStep(2, 'supporting')];
  const evals = [
    makeEval('step_1', 1.0, 'supported'),
    makeEval('step_2', 0.5625, 'supported'),
  ];
  const { verdict, marginBandTriggered } = deriveVerdict(evals, goldSteps);
  assert.equal(verdict, 'CONDITIONAL_ALLOW',
    'PR-F: score=0.5625 is INSIDE margin band → weakness → CA');
  assert.equal(marginBandTriggered, true, 'margin band must be flagged for borderline confidence');
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
// PR-F (ADR-0005): Margin Band + Confidence Metadata Tests T27–T31
// =========================================================================
//
// Spec: scripts/diff-scores.mjs and Hermes' Variance-Run (Issue #21) show
// that adjacent verdict-flips concentrate around SUPPORTED_THRESHOLD due to
// Grok-API non-determinism. Margin Band reclassifies `supported` predicates
// with score in [SUPPORTED_THRESHOLD - MARGIN_BAND_HALFWIDTH,
// SUPPORTED_THRESHOLD + MARGIN_BAND_HALFWIDTH) as criticalPartial (for
// critical steps) or non-critical weakness, and sets marginBandTriggered=true.
// toPublicVerdict surfaces this as metadata.confidence='borderline'.
//
// Hard rules unaffected: D-06 (wrong-source) and P1 (BLOCK→ALLOW absolute 0)
// are evaluated upstream of deriveVerdict and outside the margin band logic.

import {
  isInMarginBand,
  MARGIN_BAND_HALFWIDTH,
  SUPPORTED_THRESHOLD,
} from './graded-support-evaluator.js';

// ─── T27: Margin band predicate — critical step at threshold → HOLD ([conservative)
test('T27: Critical supported at score=0.5625 (in margin band) → HOLD with margin_band_triggered', () => {
  const goldSteps = [makeStep(1, 'critical')];
  const evals = [makeEval('step_1', 0.5625, 'supported')]; // exactly at threshold
  const { verdict, marginBandTriggered, reasoning } = deriveVerdict(evals, goldSteps);
  // PR-F: 1 critical step in margin band → criticalPartial → failScore=0.5 → HOLD
  assert.equal(verdict, 'HOLD',
    'Sole critical supported predicate inside margin band must conservatively HOLD');
  assert.equal(marginBandTriggered, true);
  assert.ok(reasoning.includes('margin-band'), 'Reasoning must surface margin band trigger');
});

// ─── T28: Margin band lower edge — score=0.5125 (just inside) → triggers
test('T28: Critical supported at score=0.5125 (lower edge of margin band) → HOLD', () => {
  const goldSteps = [makeStep(1, 'critical')];
  const evals = [makeEval('step_1', 0.5125, 'supported')];
  // distance = |0.5125 - 0.5625| = 0.05; isInMarginBand uses < (strict)
  // → 0.05 is NOT < 0.05 → NOT in band. Sanity-check that boundary is exclusive on both sides.
  assert.equal(isInMarginBand(evals[0]), false,
    'Distance == MARGIN_BAND_HALFWIDTH must be excluded (strict <)');
  // For coverage, also test 0.5126 (just inside): in band.
  const justInside = makeEval('step_1', 0.5126, 'supported');
  assert.equal(isInMarginBand(justInside), true);
  const { verdict: v2, marginBandTriggered: m2 } = deriveVerdict([justInside], goldSteps);
  assert.equal(v2, 'HOLD');
  assert.equal(m2, true);
});

// ─── T29: Reference cases (CODE-05/MED-05/GAIA-02) all unaffected: score ≥0.75
test('T29: Anti-regression — score ≥0.75 (audited reference cases) NEVER triggers margin band', () => {
  for (const score of [0.75, 0.80, 0.95, 1.0]) {
    const evals = [makeEval('step_1', score, 'supported')];
    assert.equal(isInMarginBand(evals[0]), false,
      `score=${score} must be safely above margin band (zone is [0.5125, 0.6125))`);
    const goldSteps = [makeStep(1, 'critical')];
    const { verdict, marginBandTriggered } = deriveVerdict(evals, goldSteps);
    assert.equal(verdict, 'ALLOW', `score=${score} must remain ALLOW`);
    assert.equal(marginBandTriggered, false, `score=${score} must NOT trigger margin band`);
  }
});

// ─── T30: predicate=partial is NOT in margin band even with high score
test('T30: Margin band gates ONLY supported/faithful predicates, not partial/unsupported', () => {
  // Even if a partial predicate has a score in the margin band zone, it is
  // NOT classified as margin band — partial is already a weakness on its own merits.
  const partialInZone = makeEval('step_1', 0.5625, 'partial');
  assert.equal(isInMarginBand(partialInZone), false,
    'predicate=partial is excluded from margin band gating');
  const unsupportedInZone = makeEval('step_2', 0.5625, 'unsupported');
  assert.equal(isInMarginBand(unsupportedInZone), false,
    'predicate=unsupported is excluded from margin band gating');
  // faithful (faithfulness mode equivalent of supported) IS gated:
  const faithfulInZone = makeEval('step_3', 0.5625, 'faithful');
  assert.equal(isInMarginBand(faithfulInZone), true,
    'predicate=faithful (faithfulness mode) IS gated by margin band');
});

// ─── T31: Public mapping — marginBandTriggered → metadata.confidence='borderline'
test('T31: toPublicVerdict({marginBandTriggered: true}) sets metadata.confidence=borderline', () => {
  // ALLOW (engine) + margin band hit → ALLOW (public) + confidence=borderline
  const allowBorderline = toPublicVerdict('ALLOW', undefined, { marginBandTriggered: true });
  assert.equal(allowBorderline.verdict, 'ALLOW');
  assert.equal(allowBorderline.metadata.confidence, 'borderline');

  // HOLD (engine) + margin band hit → UNCERTAIN (public) + confidence=borderline
  const holdBorderline = toPublicVerdict('HOLD', undefined, { marginBandTriggered: true });
  assert.equal(holdBorderline.verdict, 'UNCERTAIN');
  assert.equal(holdBorderline.metadata.confidence, 'borderline');
  assert.equal(holdBorderline.metadata.review_needed, true);

  // No flag → confidence=high (default)
  const allowHigh = toPublicVerdict('ALLOW');
  assert.equal(allowHigh.metadata.confidence, 'high', 'Default confidence must be high');

  // Confidence is ALWAYS present (Paul Entscheidung 2A)
  for (const v of ['ALLOW', 'HOLD', 'BLOCK', 'CONDITIONAL_ALLOW', 'DISSENT'] as const) {
    const r = toPublicVerdict(v);
    assert.ok(r.metadata.confidence === 'high' || r.metadata.confidence === 'borderline',
      `${v}: confidence must be set to either 'high' or 'borderline'`);
  }

  // Sanity: MARGIN_BAND_HALFWIDTH constant is exported and equals 0.05 (default)
  assert.equal(MARGIN_BAND_HALFWIDTH, 0.05, 'Default halfwidth pinned to 0.05');
  assert.equal(SUPPORTED_THRESHOLD, 0.5625, 'Threshold pinned to 0.5625 (ADR-0003 v2.2)');
});
