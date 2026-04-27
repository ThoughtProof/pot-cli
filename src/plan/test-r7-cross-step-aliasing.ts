/**
 * R7 Cross-Step Evidence Aliasing — Lock-Tests for the Plan-then-Execute pattern.
 *
 * R7 lifts gold-step scoring from `none` → `partial` (0.40, ADR-0003 v2.1)
 * when evidence is split across trace steps (e.g. step 1 plans, step 4
 * executes). Defensive Code-Floor caps cross-step evidence at 0.40 —
 * reaching supported (≥ 0.5625) still requires a verbatim quote from a SINGLE
 * contiguous span in ONE trace step (R1 + R1a remain non-negotiable).
 *
 * Lock-test contract:
 *   L1. Prompt contains the R7 section with both example domains
 *       (Healthcare CPR-AHA + Finance IRA) and the explicit hard cap (0.40).
 *   L2. R7 Code-Floor caps cross-step-aliasing reasoning at 0.40.
 *   L3. R7 NEVER raises a score (only ever caps downward).
 *   L4. R7 NEVER overrides R6 — wrong-source still zeroes.
 *   L5. R7 does NOT fire on faithfulness mode (support-only by design).
 *   L6. Plain reasoning without R7-keywords passes through untouched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScoreFloors,
  GRADED_SUPPORT_SYSTEM_PROMPT_FOR_TEST,
  R7_CROSS_STEP_FLOOR,
  type StepEvaluation,
} from './graded-support-evaluator.js';

// ─── Helper ────────────────────────────────────────────────────────────────

function buildEval(opts: {
  score: number;
  quote: string | null;
  reasoning: string;
  tier?: StepEvaluation['tier'];
  predicate?: StepEvaluation['predicate'];
}): StepEvaluation {
  return {
    step_id: 'test_step',
    score: opts.score,
    tier: opts.tier ?? (opts.score >= 0.75 ? 'strong' : 'partial'),
    quote: opts.quote,
    quote_location: { line_start: null, line_end: null, char_offset_start: null, char_offset_end: null, turn: null },
    quote_to_criterion_mapping: null,
    reasoning: opts.reasoning,
    abstain_if_uncertain: false,
    predicate: opts.predicate ?? 'partial',
  };
}

// ─── L1: Prompt-Lock ───────────────────────────────────────────────────────

test('L1a: GRADED_SUPPORT_SYSTEM_PROMPT contains R7 Cross-Step section', () => {
  const p = GRADED_SUPPORT_SYSTEM_PROMPT_FOR_TEST;
  assert.match(p, /R7\.\s+Cross-step evidence aliasing/);
  assert.match(p, /Plan-then-Execute pattern/);
});

test('L1b: R7 prompt contains the explicit 0.40 hard cap (ADR-0003 v2.1)', () => {
  const p = GRADED_SUPPORT_SYSTEM_PROMPT_FOR_TEST;
  assert.match(p, /HARD CAP:.*0\.40.*PARTIAL/);
  assert.match(p, /R7 NEVER raises a score above 0\.40/);
});

test('L1c: R7 prompt contains both symmetric examples (Healthcare + Finance)', () => {
  const p = GRADED_SUPPORT_SYSTEM_PROMPT_FOR_TEST;
  assert.match(p, /Example A.*Healthcare.*CPR\/AHA/);
  assert.match(p, /Example B.*Finance.*IRA/);
});

test('L1d: R7 prompt contains the R6-trumps-R7 counter-example', () => {
  const p = GRADED_SUPPORT_SYSTEM_PROMPT_FOR_TEST;
  assert.match(p, /Counter-example.*R6 trumps R7/);
  assert.match(p, /R7 NEVER overrides R6/);
});

test('L1e: R1 + R1a remain referenced as non-negotiable in R7', () => {
  const p = GRADED_SUPPORT_SYSTEM_PROMPT_FOR_TEST;
  assert.match(p, /R1 \+ R1a remain non-negotiable/);
});

// ─── L2: Code-Floor caps cross-step at 0.5 ────────────────────────────────

test('L2a: R7 floor caps 0.75 → 0.40 when reasoning mentions cross-step aliasing', () => {
  const ev = buildEval({
    score: 0.75,
    quote: 'Some quote text from one trace step here',
    reasoning: 'Used cross-step evidence: plan in step 1, execution in step 4.',
    tier: 'strong',
    predicate: 'supported',
  });
  const result = applyScoreFloors(ev, 'trace excerpt with [search] and [observe]', 'support');
  assert.equal(result.score, R7_CROSS_STEP_FLOOR, 'cross-step evidence must be capped at R7_CROSS_STEP_FLOOR (0.40)');
  assert.equal(result.tier, 'partial');
  assert.equal(result.predicate, 'partial');
  assert.match(result.reasoning, /\[FLOOR: R7 cross-step evidence/);
});

test('L2b: R7 floor caps 1.0 → 0.40 when reasoning mentions Plan-then-Execute', () => {
  const ev = buildEval({
    score: 1.0,
    quote: 'verbatim quote from execution step',
    reasoning: 'Plan-then-execute pattern: gold step satisfied across multiple steps.',
    tier: 'verbatim',
    predicate: 'supported',
  });
  const result = applyScoreFloors(ev, 'trace excerpt', 'support');
  assert.equal(result.score, R7_CROSS_STEP_FLOOR);
  assert.equal(result.predicate, 'partial');
});

test('L2c: R7 floor caps when reasoning mentions "spans multiple trace steps"', () => {
  const ev = buildEval({
    score: 0.75,
    quote: 'A sufficiently long quote of at least ten characters here.',
    reasoning: 'Evidence spans multiple trace steps — plan in step_1, fetch in step_3.',
  });
  const result = applyScoreFloors(ev, 'trace excerpt', 'support');
  assert.equal(result.score, R7_CROSS_STEP_FLOOR);
});

test('L2d: R7 floor caps when reasoning mentions explicit R7 token', () => {
  const ev = buildEval({
    score: 0.75,
    quote: 'A sufficiently long quote of at least ten characters here.',
    reasoning: 'Applied R7 cross-step aliasing rule.',
  });
  const result = applyScoreFloors(ev, 'trace excerpt', 'support');
  assert.equal(result.score, R7_CROSS_STEP_FLOOR);
});

// ─── L3: R7 never raises a score ─────────────────────────────────────────

test('L3a: R7 never raises 0.0 to 0.5 by itself (Code-Floor is cap-only)', () => {
  // R7 lifting is a PROMPT-level instruction to the LLM. The Code-Floor
  // never raises scores — it only caps. A 0.0 input stays 0.0 even when
  // reasoning mentions cross-step evidence.
  const ev = buildEval({
    score: 0.0,
    quote: null,
    reasoning: 'Cross-step evidence not actually present in trace.',
    tier: 'none',
    predicate: 'skipped',
  });
  const result = applyScoreFloors(ev, 'trace', 'support');
  assert.equal(result.score, 0.0, 'R7 floor must never raise scores');
});

test('L3b: R7 floor preserves scores ≤ R7_CROSS_STEP_FLOOR (no-op at or below cap)', () => {
  // Under ADR-0003 v2.1, the cap is 0.40. A score at exactly 0.40 must be a
  // no-op for R7 (cap-only, never raises). A quote is provided here to avoid
  // triggering quote-too-short or R1 floors that would also touch the score.
  const ev = buildEval({
    score: R7_CROSS_STEP_FLOOR,
    quote: 'A sufficiently long quote from one trace step here.',
    reasoning: 'Plan-then-execute pattern; partial credit awarded.',
  });
  const result = applyScoreFloors(ev, 'trace', 'support');
  assert.equal(result.score, R7_CROSS_STEP_FLOOR, 'R7 must be no-op at exactly the cap value');
  assert.ok(!/R7 cross-step/.test(result.reasoning),
    'no R7 floor tag should be added when no cap occurred');
});

// ─── L4: R7 never overrides R6 (wrong-source) ────────────────────────────

test('L4a: R6 wrong-source still zeroes even when reasoning mentions cross-step', () => {
  // Combined signal: cross-step aliasing + wrong-source. R6 must trump R7.
  const ev = buildEval({
    score: 0.5,
    quote: 'q',
    reasoning: 'Cross-step plan-then-execute, but agent fetched a blog instead of the official AHA source.',
  });
  const result = applyScoreFloors(ev, 'trace', 'support');
  assert.equal(result.score, 0.0, 'R6 must zero out wrong-source regardless of R7');
  assert.match(result.reasoning, /R6 wrong-source/);
});

test('L4b: R7 cap order — R6 runs first, then R7. Combined at high input: R7 cap wins.', () => {
  const ev = buildEval({
    score: 0.75,
    quote: 'A sufficiently long quote of at least ten characters here.',
    reasoning: 'Cross-step evidence aliasing — used a different source (secondary blog instead of primary).',
    tier: 'strong',
    predicate: 'supported',
  });
  const result = applyScoreFloors(ev, 'trace', 'support');
  // R6 fires only on score ∈ (0, 0.5]. At 0.75 input, R6's `<=0.5` guard
  // skips it. R7 then caps to R7_CROSS_STEP_FLOOR (0.40). Note that 0.40 is
  // INSIDE R6's trigger range — but R6 has already run and skipped, so the
  // final score stays at 0.40. This is a documented order-sensitivity:
  // if R6 ran AFTER R7, it would catch the 0.40 output and zero it.
  // The current order (R6 before R7) is intentional and ADR-0003 keeps it.
  assert.notEqual(result.score, 0.75, 'must not stay at strong with wrong-source');
  assert.equal(
    result.score,
    R7_CROSS_STEP_FLOOR,
    'documented order: R6 misses 0.75-input, R7 caps to R7_CROSS_STEP_FLOOR (0.40)',
  );
  assert.match(result.reasoning, /R7 cross-step/);
});

// ─── L5: R7 floor is support-mode only ───────────────────────────────────

test('L5: R7 floor does NOT fire in faithfulness mode', () => {
  const ev = buildEval({
    score: 0.75,
    quote: 'reasoning quote',
    reasoning: 'Cross-step plan-then-execute aliasing.',
    tier: 'strong',
    predicate: 'supported',
  });
  const result = applyScoreFloors(ev, 'trace', 'faithfulness');
  assert.equal(result.score, 0.75, 'R7 must not affect faithfulness scoring');
  assert.ok(!/R7 cross-step/.test(result.reasoning),
    'no R7 tag in faithfulness mode');
});

// ─── L6: Untriggered reasoning is untouched ──────────────────────────────

test('L6a: plain reasoning without R7 keywords passes through untouched', () => {
  const ev = buildEval({
    score: 0.75,
    quote: 'A clean verbatim quote from a single trace step.',
    reasoning: 'Quote directly addresses the criterion in step 1.',
    tier: 'strong',
    predicate: 'supported',
  });
  const result = applyScoreFloors(ev, 'trace excerpt', 'support');
  assert.equal(result.score, 0.75, 'untriggered reasoning must keep its score');
  assert.equal(result.predicate, 'supported');
  assert.ok(!/R7 cross-step/.test(result.reasoning));
});

test('L6b: word "step" alone in reasoning does NOT trigger R7', () => {
  // Defensive: the regex must not over-trigger on benign mentions of "step".
  const ev = buildEval({
    score: 0.75,
    quote: 'A sufficiently long quote of at least ten characters here.',
    reasoning: 'The step is supported by a quote.',
  });
  const result = applyScoreFloors(ev, 'trace', 'support');
  assert.equal(result.score, 0.75, 'plain "step" must not trigger R7');
});

test('L6c: R7 regex is case-insensitive', () => {
  const ev = buildEval({
    score: 0.75,
    quote: 'A sufficiently long quote of at least ten characters here.',
    reasoning: 'CROSS-STEP EVIDENCE used here.',
  });
  const result = applyScoreFloors(ev, 'trace', 'support');
  assert.equal(result.score, R7_CROSS_STEP_FLOOR, 'R7 must match case-insensitively');
});
