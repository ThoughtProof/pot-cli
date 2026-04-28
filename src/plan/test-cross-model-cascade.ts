/**
 * Unit tests for src/plan/cross-model-cascade.ts (ADR-0007 skeleton).
 *
 * Run after `npm run build` via:
 *   node dist/plan/test-cross-model-cascade.js
 * Picked up by `npm run test:plan`.
 *
 * Coverage:
 *   1. familyOf()            — all 6 families + unknown
 *   2. sameFamily()          — cross-family + unknown handling
 *   3. selectEvaluatorModels() — invariants (same-family throws,
 *                              generator-conflict throws, defaults)
 *   4. runCascade()          — happy paths for each primary verdict
 *                              (BLOCK, HOLD, CONDITIONAL_ALLOW, ALLOW)
 *   5. runCascade()          — failover (primary throws, secondary throws,
 *                              both throw, secondaryErrorFallback='allow')
 *   6. runCascade()          — disabled flag → primary-only
 *   7. aggregateBatchStats() — empty input, mixed results, latency averages
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  familyOf,
  sameFamily,
  selectEvaluatorModels,
  runCascade,
  aggregateBatchStats,
  type CascadeResult,
  type EvaluatorResult,
} from './cross-model-cascade.js';
import type { EvaluatorVerdict } from './graded-support-evaluator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ItemResult-shaped object for tests. */
function mkResult(verdict: EvaluatorVerdict, id = 'test-1'): EvaluatorResult {
  return {
    id,
    step_evaluations: [],
    verdict,
    verdict_reasoning: `synthetic ${verdict}`,
    provenance_violations: [],
  };
}

/** Stub evaluator that returns a verdict per model alias. */
function stubEvaluator(map: Record<string, EvaluatorVerdict>) {
  return async (model: string, _input: unknown): Promise<EvaluatorResult> => {
    const v = map[model];
    if (v === undefined) {
      throw new Error(`stub: no verdict configured for model='${model}'`);
    }
    return mkResult(v, `case-${model}`);
  };
}

/** Throwing stub (configurable per model). */
function throwingEvaluator(throwsFor: Set<string>, others: Record<string, EvaluatorVerdict>) {
  return async (model: string, _input: unknown): Promise<EvaluatorResult> => {
    if (throwsFor.has(model)) {
      throw new Error(`stub: forced failure for model='${model}'`);
    }
    const v = others[model];
    if (v === undefined) {
      throw new Error(`stub: no verdict configured for model='${model}'`);
    }
    return mkResult(v, `case-${model}`);
  };
}

// ─── 1. familyOf ──────────────────────────────────────────────────────────────

test('familyOf: anthropic family detection', () => {
  assert.equal(familyOf('claude-sonnet-4-6'), 'anthropic');
  assert.equal(familyOf('sonnet'), 'anthropic');
  assert.equal(familyOf('opus'), 'anthropic');
  assert.equal(familyOf('claude-haiku'), 'anthropic');
  assert.equal(familyOf('Sonnet-4.6'), 'anthropic'); // case-insensitive
});

test('familyOf: openai family detection', () => {
  assert.equal(familyOf('gpt-5'), 'openai');
  assert.equal(familyOf('gpt-4o'), 'openai');
  assert.equal(familyOf('o1-preview'), 'openai');
  assert.equal(familyOf('o3-mini'), 'openai');
  assert.equal(familyOf('o4'), 'openai');
});

test('familyOf: xai / moonshot / deepseek / google', () => {
  assert.equal(familyOf('grok-4'), 'xai');
  assert.equal(familyOf('kimi-k2'), 'moonshot');
  assert.equal(familyOf('moonshot-v1'), 'moonshot');
  assert.equal(familyOf('deepseek-v3'), 'deepseek');
  assert.equal(familyOf('gemini-3-pro'), 'google');
  assert.equal(familyOf('gemini'), 'google');
});

test('familyOf: unknown for unrecognized aliases', () => {
  assert.equal(familyOf(''), 'unknown');
  assert.equal(familyOf('llama-3'), 'unknown');
  assert.equal(familyOf('mistral-large'), 'unknown');
  assert.equal(familyOf('random-string'), 'unknown');
});

// Hermes #27 review Finding 1: o1/o3/o4 must not match coincidental substrings.
test('familyOf: openai reasoning tokens require word boundary (no substring leak)', () => {
  // Real aliases must still match.
  assert.equal(familyOf('o1'), 'openai');
  assert.equal(familyOf('o1-preview'), 'openai');
  assert.equal(familyOf('o3-mini'), 'openai');
  assert.equal(familyOf('o4'), 'openai');
  assert.equal(familyOf('openai-o3'), 'openai');
  assert.equal(familyOf('o4_mini'), 'openai');

  // Coincidental substrings must NOT match.
  assert.equal(familyOf('proto4col'), 'unknown');
  assert.equal(familyOf('photo3d'), 'unknown');
  assert.equal(familyOf('demo1-engine'), 'unknown');
  assert.equal(familyOf('cargo3-runner'), 'unknown');

  // Adjacent alphanumerics must not falsely qualify the token.
  assert.equal(familyOf('o1x'), 'unknown');
  assert.equal(familyOf('xo3'), 'unknown');
  assert.equal(familyOf('o42'), 'unknown'); // numeric continuation
});

// ─── 2. sameFamily ────────────────────────────────────────────────────────────

test('sameFamily: cross-family returns false', () => {
  assert.equal(sameFamily('sonnet', 'gemini'), false);
  assert.equal(sameFamily('grok', 'deepseek'), false);
  assert.equal(sameFamily('gpt-5', 'kimi'), false);
});

test('sameFamily: same-family returns true', () => {
  assert.equal(sameFamily('sonnet', 'opus'), true);
  assert.equal(sameFamily('claude-3', 'haiku'), true);
  assert.equal(sameFamily('gpt-5', 'o3-mini'), true);
});

test('sameFamily: unknown vs unknown returns false (no false positives)', () => {
  // Two unknowns must NOT collide as "same family" — that would let
  // unrecognized aliases bypass the cross-family invariant.
  assert.equal(sameFamily('llama-3', 'mistral'), false);
  assert.equal(sameFamily('unknown-1', 'unknown-2'), false);
});

// ─── 3. selectEvaluatorModels ─────────────────────────────────────────────────

test('selectEvaluatorModels: defaults are gemini + sonnet', () => {
  const { primary, secondary } = selectEvaluatorModels();
  assert.equal(primary, 'gemini');
  assert.equal(secondary, 'sonnet');
});

test('selectEvaluatorModels: overrides honored', () => {
  const { primary, secondary } = selectEvaluatorModels({
    primaryModel: 'grok',
    secondaryModel: 'deepseek',
  });
  assert.equal(primary, 'grok');
  assert.equal(secondary, 'deepseek');
});

test('selectEvaluatorModels: throws when primary and secondary share family', () => {
  assert.throws(
    () => selectEvaluatorModels({ primaryModel: 'sonnet', secondaryModel: 'opus' }),
    /share family anthropic/,
  );
  assert.throws(
    () => selectEvaluatorModels({ primaryModel: 'gpt-5', secondaryModel: 'o3' }),
    /share family openai/,
  );
});

test('selectEvaluatorModels: throws when generator conflicts with primary', () => {
  assert.throws(
    () => selectEvaluatorModels({
      primaryModel: 'gemini',
      secondaryModel: 'sonnet',
      generatorModel: 'gemini-3-pro',
    }),
    /conflicts with primary=gemini/,
  );
});

test('selectEvaluatorModels: throws when generator conflicts with secondary', () => {
  assert.throws(
    () => selectEvaluatorModels({
      primaryModel: 'gemini',
      secondaryModel: 'sonnet',
      generatorModel: 'opus',
    }),
    /conflicts with .*secondary=sonnet/,
  );
});

test('selectEvaluatorModels: passes when generator differs from both', () => {
  // Generator=grok (xai), evaluators=gemini (google) + sonnet (anthropic)
  const { primary, secondary } = selectEvaluatorModels({
    generatorModel: 'grok-4',
  });
  assert.equal(primary, 'gemini');
  assert.equal(secondary, 'sonnet');
});

// ─── 4. runCascade — happy paths ──────────────────────────────────────────────

test('runCascade: primary=BLOCK → final BLOCK, secondary not invoked', async () => {
  const evaluate = stubEvaluator({ gemini: 'BLOCK', sonnet: 'ALLOW' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'BLOCK');
  assert.equal(r.reason, 'primary_block');
  assert.equal(r.secondaryInvoked, false);
  assert.equal(r.degradedMode, false);
  assert.equal(r.errors.length, 0);
  assert.ok(r.primary);
  assert.equal(r.secondary, undefined);
});

test('runCascade: primary=HOLD + secondary=ALLOW → final HOLD (Strategy C2)', async () => {
  const evaluate = stubEvaluator({ gemini: 'HOLD', sonnet: 'ALLOW' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'HOLD');
  assert.equal(r.reason, 'primary_hold');
  assert.equal(r.secondaryInvoked, true);
});

test('runCascade: primary=HOLD + secondary=BLOCK → final BLOCK (Strategy C2 override)', async () => {
  const evaluate = stubEvaluator({ gemini: 'HOLD', sonnet: 'BLOCK' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'BLOCK');
  assert.equal(r.reason, 'disagreement_hold');
  assert.equal(r.secondaryInvoked, true);
});

test('runCascade: primary=CONDITIONAL_ALLOW → final CONDITIONAL_ALLOW, secondary not invoked', async () => {
  const evaluate = stubEvaluator({ gemini: 'CONDITIONAL_ALLOW', sonnet: 'ALLOW' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'CONDITIONAL_ALLOW');
  assert.equal(r.reason, 'primary_uncertain');
  assert.equal(r.secondaryInvoked, false);
});

test('runCascade: primary=ALLOW + secondary=ALLOW → agreement_allow', async () => {
  const evaluate = stubEvaluator({ gemini: 'ALLOW', sonnet: 'ALLOW' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'ALLOW');
  assert.equal(r.reason, 'agreement_allow');
  assert.equal(r.secondaryInvoked, true);
  assert.equal(r.degradedMode, false);
  assert.ok(r.primary);
  assert.ok(r.secondary);
});

test('runCascade: primary=ALLOW + secondary=HOLD → disagreement_hold (HOLD wins)', async () => {
  const evaluate = stubEvaluator({ gemini: 'ALLOW', sonnet: 'HOLD' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'HOLD');
  assert.equal(r.reason, 'disagreement_hold');
  assert.equal(r.secondaryInvoked, true);
});

test('runCascade: primary=ALLOW + secondary=BLOCK → disagreement_hold (NOT BLOCK)', async () => {
  // Disagreement collapses to HOLD by design (cascade is a verifier, not a
  // tie-breaker). BLOCK requires explicit primary BLOCK.
  const evaluate = stubEvaluator({ gemini: 'ALLOW', sonnet: 'BLOCK' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'HOLD');
  assert.equal(r.reason, 'disagreement_hold');
});

test('runCascade: primary=ALLOW + secondary=CONDITIONAL_ALLOW → disagreement_hold', async () => {
  const evaluate = stubEvaluator({ gemini: 'ALLOW', sonnet: 'CONDITIONAL_ALLOW' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'HOLD');
  assert.equal(r.reason, 'disagreement_hold');
});

// ─── 5. runCascade — disabled flag ────────────────────────────────────────────

test('runCascade: disabled flag → primary-only (any verdict pass-through)', async () => {
  const evaluate = stubEvaluator({ gemini: 'ALLOW', sonnet: 'BLOCK' });
  const r = await runCascade('input', evaluate, { disabled: true });
  assert.equal(r.verdict, 'ALLOW');
  assert.equal(r.reason, 'cascade_disabled');
  assert.equal(r.secondaryInvoked, false);
  assert.equal(r.degradedMode, false);
  assert.ok(r.primary);
  assert.equal(r.secondary, undefined);
});

// ─── 6. runCascade — failover ─────────────────────────────────────────────────

test('runCascade: primary throws → secondary as standalone (degraded)', async () => {
  const evaluate = throwingEvaluator(new Set(['gemini']), { sonnet: 'ALLOW' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'ALLOW');
  assert.equal(r.reason, 'primary_error_fallback');
  assert.equal(r.secondaryInvoked, true);
  assert.equal(r.degradedMode, true);
  assert.equal(r.primary, undefined);
  assert.ok(r.secondary);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!, /primary\(gemini\)/);
});

test('runCascade: primary throws + secondary throws → re-throws aggregate error', async () => {
  const evaluate = throwingEvaluator(new Set(['gemini', 'sonnet']), {});
  await assert.rejects(
    () => runCascade('input', evaluate),
    /both primary and secondary failed/,
  );
});

test('runCascade: secondary throws after primary=ALLOW → fallback HOLD (default)', async () => {
  const evaluate = throwingEvaluator(new Set(['sonnet']), { gemini: 'ALLOW' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'HOLD');
  assert.equal(r.reason, 'secondary_error_fallback');
  assert.equal(r.secondaryInvoked, true);
  assert.equal(r.degradedMode, true);
  assert.ok(r.primary);
  assert.equal(r.secondary, undefined);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!, /secondary\(sonnet\)/);
});

test("runCascade: secondary throws + secondaryErrorFallback='allow' → ALLOW (degraded)", async () => {
  const evaluate = throwingEvaluator(new Set(['sonnet']), { gemini: 'ALLOW' });
  const r = await runCascade('input', evaluate, { secondaryErrorFallback: 'allow' });
  assert.equal(r.verdict, 'ALLOW');
  assert.equal(r.reason, 'secondary_error_fallback');
  assert.equal(r.degradedMode, true);
});

test('runCascade: secondary throws after primary=BLOCK → secondary never invoked, no degradation', async () => {
  // Primary BLOCK is an early-exit; we must NOT touch secondary, so even
  // a guaranteed-throwing secondary must not leak into errors.
  const evaluate = throwingEvaluator(new Set(['sonnet']), { gemini: 'BLOCK' });
  const r = await runCascade('input', evaluate);
  assert.equal(r.verdict, 'BLOCK');
  assert.equal(r.reason, 'primary_block');
  assert.equal(r.secondaryInvoked, false);
  assert.equal(r.degradedMode, false);
  assert.equal(r.errors.length, 0);
});

// ─── 7. runCascade — invariant enforcement ───────────────────────────────────

test('runCascade: same-family config rejected before any evaluation', async () => {
  const evaluate = stubEvaluator({ sonnet: 'ALLOW', opus: 'ALLOW' });
  await assert.rejects(
    () => runCascade('input', evaluate, {
      primaryModel: 'sonnet',
      secondaryModel: 'opus',
    }),
    /share family anthropic/,
  );
});

// ─── 8. aggregateBatchStats ───────────────────────────────────────────────────

test('aggregateBatchStats: empty input returns zeroes', () => {
  const s = aggregateBatchStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.primaryOnly, 0);
  assert.equal(s.cascaded, 0);
  assert.equal(s.agreements, 0);
  assert.equal(s.disagreements, 0);
  assert.equal(s.degraded, 0);
  assert.equal(s.earlyExitRate, 0);
  assert.equal(s.avgPrimaryLatencyMs, 0);
  assert.equal(s.avgSecondaryLatencyMs, 0);
});

test('aggregateBatchStats: mixed results aggregated correctly', () => {
  const r = (
    secondaryInvoked: boolean,
    reason: CascadeResult['reason'],
    verdict: EvaluatorVerdict,
    degraded: boolean,
    primaryMs?: number,
    secondaryMs?: number,
  ): CascadeResult => ({
    verdict,
    reason,
    primaryModel: 'gemini',
    secondaryModel: 'sonnet',
    secondaryInvoked,
    degradedMode: degraded,
    errors: [],
    primaryLatencyMs: primaryMs,
    secondaryLatencyMs: secondaryMs,
    totalLatencyMs: (primaryMs ?? 0) + (secondaryMs ?? 0),
  });

  const results: CascadeResult[] = [
    r(false, 'primary_block', 'BLOCK', false, 100),
    r(false, 'primary_hold', 'HOLD', false, 120),
    r(true, 'agreement_allow', 'ALLOW', false, 110, 200),
    r(true, 'agreement_allow', 'ALLOW', false, 90, 220),
    r(true, 'disagreement_hold', 'HOLD', false, 130, 210),
    r(true, 'secondary_error_fallback', 'HOLD', true, 100), // degraded, no secondaryMs
  ];

  const s = aggregateBatchStats(results);
  assert.equal(s.total, 6);
  assert.equal(s.primaryOnly, 2);
  assert.equal(s.cascaded, 4);
  assert.equal(s.agreements, 2);
  assert.equal(s.disagreements, 1);
  assert.equal(s.degraded, 1);
  assert.equal(s.earlyExitRate, 2 / 6);
  // primaryLatency: avg over 6 = (100+120+110+90+130+100)/6 = 650/6
  assert.equal(s.avgPrimaryLatencyMs, 650 / 6);
  // secondaryLatency: avg over 3 (only those with values) = (200+220+210)/3 = 210
  assert.equal(s.avgSecondaryLatencyMs, 210);
});

test('aggregateBatchStats: all-primary-only dataset → earlyExitRate=1', () => {
  const results: CascadeResult[] = [
    {
      verdict: 'BLOCK',
      reason: 'primary_block',
      primaryModel: 'gemini',
      secondaryModel: 'sonnet',
      secondaryInvoked: false,
      degradedMode: false,
      errors: [],
      totalLatencyMs: 100,
    },
    {
      verdict: 'HOLD',
      reason: 'primary_hold',
      primaryModel: 'gemini',
      secondaryModel: 'sonnet',
      secondaryInvoked: false,
      degradedMode: false,
      errors: [],
      totalLatencyMs: 100,
    },
  ];
  const s = aggregateBatchStats(results);
  assert.equal(s.earlyExitRate, 1);
  assert.equal(s.cascaded, 0);
});
