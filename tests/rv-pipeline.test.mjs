import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRvConfidenceCorrection,
  applyRvGuardrails,
  loadEnvText,
  normalizeConfidence,
  normalizeRvVerdict,
  parseModelJson,
  runReasoningVerification,
} from '../dist/rv/index.js';

const input = {
  id: 'rv-test',
  claim: 'The deployment can proceed to production.',
  rationale: 'The smoke test passed, so it is safe to migrate all users now.',
  evidence: 'Smoke test passed. Rollback plan, staged rollout, and monitoring checks are not provided.',
  domain: 'code_deploy',
};

test('loadEnvText strips quotes and export prefixes without leaking values', () => {
  const env = loadEnvText('A="quoted"\nexport B=plain\nC=sk-test=value\n# ignored\n');

  assert.deepEqual(env, {
    A: 'quoted',
    B: 'plain',
    C: 'sk-test=value',
  });
});

test('parseModelJson accepts fenced JSON output', () => {
  const parsed = parseModelJson('```json\n{"verdict":"ALLOW","confidence":0.8}\n```');

  assert.equal(parsed.verdict, 'ALLOW');
  assert.equal(parsed.confidence, 0.8);
});

test('guardrails cap missing-controls high-impact actions at UNCERTAIN without contradiction', () => {
  const result = applyRvGuardrails({
    input,
    synthesis: {
      final_verdict: 'BLOCK',
      confidence: 0.91,
      synthesis_reasoning: 'The deployment lacks rollback, staged rollout, and monitoring controls.',
      dissent_preserved: ['all critics block'],
      calibration_notes: 'strict majority',
    },
    critic: {
      objections: ['missing rollback plan', 'missing monitoring'],
      severity_scores: [0.7, 0.7],
      survival_assessment: 'weak',
      overall_risk_level: 'high',
    },
    judges: [],
  });

  assert.equal(result.verdict, 'UNCERTAIN');
  assert.equal(result.guardrail_actions.includes('missing_controls_block_capped_to_uncertain'), true);
});

test('guardrails preserve BLOCK for confirmed critical-risk dismissal', () => {
  const result = applyRvGuardrails({
    input,
    synthesis: {
      final_verdict: 'BLOCK',
      confidence: 0.91,
      synthesis_reasoning: 'The rationale dismisses a confirmed sanctions match as irrelevant.',
      dissent_preserved: [],
      calibration_notes: 'critical risk',
    },
    critic: {
      objections: ['confirmed sanctions match dismissed'],
      severity_scores: [1],
      survival_assessment: 'fails',
      overall_risk_level: 'critical',
    },
    judges: [],
  });

  assert.equal(result.verdict, 'BLOCK');
  assert.equal(result.guardrail_actions.includes('missing_controls_block_capped_to_uncertain'), false);
});

test('runReasoningVerification executes judges, critic, synthesizer, and guardrails', async () => {
  const calls = [];
  const caller = async ({ model, stage }) => {
    calls.push({ model, stage });
    if (stage === 'judge') return { content: '{"verdict":"UNCERTAIN","confidence":0.7,"reasoning":"missing controls","risk_flags":["rollout"],"evidence_gaps":["rollback"]}' };
    if (stage === 'critic') return { content: '{"objections":["missing rollback"],"severity_scores":[0.7],"survival_assessment":"weak","overall_risk_level":"high"}' };
    return { content: '```json\n{"final_verdict":"BLOCK","confidence":0.9,"synthesis_reasoning":"Missing rollback and monitoring controls.","dissent_preserved":["boundary dissent"],"calibration_notes":"strict"}\n```' };
  };

  const result = await runReasoningVerification({ input, caller });

  assert.deepEqual(calls.map(c => `${c.stage}:${c.model}`), [
    'judge:deepseek',
    'judge:grok',
    'judge:serv-nano',
    'critic:serv-nano',
    'synthesizer:sonnet',
  ]);
  assert.equal(result.verdict, 'UNCERTAIN');
  assert.equal(result.critics.length, 3);
  // Synthesizer stated 0.9 vs judge mean 0.7 (gap > 0.20) → inflation override
  // pulls confidence to the judge mean before the missing-controls cap.
  assert.equal(result.confidence, 0.7);
  assert.equal(result.guardrail_actions.includes('judge_inflation_override'), true);
  assert.equal(result.guardrail_actions.includes('missing_controls_block_capped_to_uncertain'), true);
});

// ─── Bidirectional confidence correction (pot-sdk ebd1f2a port) ──────────────

test('applyRvConfidenceCorrection: inflation above 0.20 gap fully overrides with judge mean', () => {
  const r = applyRvConfidenceCorrection(0.9, [0.5, 0.55, 0.45]);
  assert.equal(r.confidence, 0.5);
  assert.equal(r.action, 'judge_inflation_override');
});

test('applyRvConfidenceCorrection: deflation above 0.30 gap is dampened by 0.6', () => {
  // stated 0.4, judge mean 0.8 → 0.4 + 0.6 * 0.4 = 0.64
  const r = applyRvConfidenceCorrection(0.4, [0.8, 0.8, 0.8]);
  assert.equal(r.confidence, 0.64);
  assert.equal(r.action, 'judge_deflation_dampened');
});

test('applyRvConfidenceCorrection: deflation inside the 0.30 band is left alone', () => {
  // stated 0.5, judge mean 0.75 → gap 0.25 < 0.30 → unchanged
  const r = applyRvConfidenceCorrection(0.5, [0.75, 0.75]);
  assert.equal(r.confidence, 0.5);
  assert.equal(r.action, undefined);
});

test('applyRvConfidenceCorrection: no usable judge confidences → stated unchanged', () => {
  assert.deepEqual(applyRvConfidenceCorrection(0.62, []), { confidence: 0.62 });
  assert.deepEqual(applyRvConfidenceCorrection(0.62, [NaN]), { confidence: 0.62 });
});

test('normalizeConfidence coerces labels, percents, and clamps', () => {
  assert.equal(normalizeConfidence(0.87), 0.87);
  assert.equal(normalizeConfidence(87), 0.87);
  assert.equal(normalizeConfidence('HIGH'), 0.9);
  assert.equal(normalizeConfidence('medium'), 0.6);
  assert.equal(normalizeConfidence('0.75'), 0.75);
  assert.equal(Number.isNaN(normalizeConfidence('nope')), true);
  assert.equal(Number.isNaN(normalizeConfidence(undefined)), true);
  assert.equal(normalizeConfidence(1.5), 1);
  assert.equal(normalizeConfidence(-0.2), 0);
});

test('guardrails apply deflation dampening when synthesizer under-states vs judges', () => {
  const result = applyRvGuardrails({
    input: { ...input, claim: 'Two plus two equals four.', rationale: 'Arithmetic.', evidence: 'Standard arithmetic.' },
    synthesis: {
      final_verdict: 'ALLOW',
      confidence: 0.35,
      synthesis_reasoning: 'All judges agree the claim is true.',
      dissent_preserved: [],
      calibration_notes: 'over-cautious',
    },
    critic: {
      objections: [],
      severity_scores: [],
      survival_assessment: 'survives',
      overall_risk_level: 'low',
    },
    judges: [
      { model: 'deepseek', verdict: 'ALLOW', confidence: 0.9, rationale: 'clear', risk_flags: [], evidence_gaps: [] },
      { model: 'grok', verdict: 'ALLOW', confidence: 0.85, rationale: 'clear', risk_flags: [], evidence_gaps: [] },
      { model: 'serv-nano', verdict: 'ALLOW', confidence: 0.9, rationale: 'clear', risk_flags: [], evidence_gaps: [] },
    ],
  });

  // judge mean = 0.883; stated 0.35 → 0.35 + 0.6 * 0.533 = 0.67
  assert.equal(result.confidence, 0.67);
  assert.equal(result.guardrail_actions.includes('judge_deflation_dampened'), true);
});

// ─── Verdict vocabulary normalization ───────────────────────────────────────

test('normalizeRvVerdict passes canonical verdicts through case-insensitively', () => {
  assert.equal(normalizeRvVerdict('ALLOW'), 'ALLOW');
  assert.equal(normalizeRvVerdict('BLOCK'), 'BLOCK');
  assert.equal(normalizeRvVerdict('UNCERTAIN'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict(' allow '), 'ALLOW');
  assert.equal(normalizeRvVerdict('block'), 'BLOCK');
  assert.equal(normalizeRvVerdict('Uncertain'), 'UNCERTAIN');
});

test('normalizeRvVerdict maps the free-form vocabulary observed in the 2026-08-06 live sample', () => {
  // Judge/synth strings actually emitted in rv-confidence-sample.jsonl.
  assert.equal(normalizeRvVerdict('supported'), 'ALLOW');
  assert.equal(normalizeRvVerdict('fully_supported'), 'ALLOW');
  assert.equal(normalizeRvVerdict('supported_with_rounding_caveat'), 'ALLOW');
  assert.equal(normalizeRvVerdict('supported_with_caveat'), 'ALLOW');
  assert.equal(normalizeRvVerdict('confirmed'), 'ALLOW');
  assert.equal(normalizeRvVerdict('correct'), 'ALLOW');
  assert.equal(normalizeRvVerdict('valid'), 'ALLOW');
  assert.equal(normalizeRvVerdict('TRUE'), 'ALLOW');
  assert.equal(normalizeRvVerdict('false'), 'BLOCK');
  assert.equal(normalizeRvVerdict('FALSE'), 'BLOCK');
  assert.equal(normalizeRvVerdict('PARTIALLY_CORRECT'), 'UNCERTAIN');
});

test('normalizeRvVerdict applies BLOCK > UNCERTAIN > ALLOW token precedence', () => {
  // "false" token wins over "unsupported" — a refuted claim, not an unproven one.
  assert.equal(normalizeRvVerdict('unsupported_false'), 'BLOCK');
  // "partially" wins over "supported" — partial support is not clean support.
  assert.equal(normalizeRvVerdict('partially_supported'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('partially_supported_with_material_caveats'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('conditionally_supported'), 'UNCERTAIN');
  // "unsupported" alone is token-exact — the "supported" substring must NOT match.
  assert.equal(normalizeRvVerdict('unsupported'), 'UNCERTAIN');
});

test('normalizeRvVerdict fails closed to UNCERTAIN on unrecognized input', () => {
  assert.equal(normalizeRvVerdict('maybe possibly'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict(''), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict(undefined), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict(null), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict(42), 'UNCERTAIN');
});

test('normalizeRvVerdict treats negated polar labels as UNCERTAIN, not flipped ALLOW/BLOCK', () => {
  // Negated support must not become ALLOW (false-ALLOW is the dangerous side).
  assert.equal(normalizeRvVerdict('not_supported'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('not supported'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('does_not_support'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('fails_to_support'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('no_support'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('cannot_support'), 'UNCERTAIN');
  // Negated refutation must not become BLOCK.
  assert.equal(normalizeRvVerdict('not_false'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('not_incorrect'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('not_block'), 'UNCERTAIN');
  // Bare "no …" phrases are not clean BLOCKs either.
  assert.equal(normalizeRvVerdict('no issues'), 'UNCERTAIN');
  assert.equal(normalizeRvVerdict('no_material_issues'), 'UNCERTAIN');
  // Weak support intensity is not clean ALLOW.
  assert.equal(normalizeRvVerdict('weakly_supported'), 'UNCERTAIN');
  // Explicit refutation/approval lexicon expansions.
  assert.equal(normalizeRvVerdict('denied'), 'BLOCK');
  assert.equal(normalizeRvVerdict('disproved'), 'BLOCK');
  assert.equal(normalizeRvVerdict('approved'), 'ALLOW');
  // Bare fail/failed stay BLOCK (negator set must not swallow them).
  assert.equal(normalizeRvVerdict('failed'), 'BLOCK');
  assert.equal(normalizeRvVerdict('fail'), 'BLOCK');
});

test('guardrails normalize a free-form synthesis verdict and audit the coercion', () => {
  const result = applyRvGuardrails({
    input,
    synthesis: {
      final_verdict: 'supported_with_caveat',
      confidence: 0.8,
      synthesis_reasoning: 'Claim is supported with a minor caveat.',
      dissent_preserved: [],
      calibration_notes: '',
    },
    critic: {
      objections: [],
      severity_scores: [],
      survival_assessment: 'survives',
      overall_risk_level: 'low',
    },
    judges: [],
  });

  assert.equal(result.verdict, 'ALLOW');
  assert.equal(result.synthesis.final_verdict, 'ALLOW');
  assert.equal(
    result.guardrail_actions.includes('verdict_normalized:supported_with_caveat->ALLOW'),
    true,
  );
});

test('guardrails do not audit verdicts that are already canonical', () => {
  const result = applyRvGuardrails({
    input,
    synthesis: {
      final_verdict: 'ALLOW',
      confidence: 0.8,
      synthesis_reasoning: 'Claim is supported.',
      dissent_preserved: [],
      calibration_notes: '',
    },
    critic: {
      objections: [],
      severity_scores: [],
      survival_assessment: 'survives',
      overall_risk_level: 'low',
    },
    judges: [],
  });

  assert.equal(result.verdict, 'ALLOW');
  assert.equal(result.guardrail_actions.some(a => a.startsWith('verdict_normalized:')), false);
});

test('runReasoningVerification normalizes free-form judge and synthesizer verdicts', async () => {
  const caller = async ({ stage }) => {
    if (stage === 'judge') return { content: '{"verdict":"supported","confidence":0.8,"reasoning":"clear","risk_flags":[],"evidence_gaps":[]}' };
    if (stage === 'critic') return { content: '{"objections":[],"severity_scores":[],"survival_assessment":"survives","overall_risk_level":"low"}' };
    return { content: '{"final_verdict":"partially_supported","confidence":0.8,"synthesis_reasoning":"Some caveats remain.","dissent_preserved":[],"calibration_notes":""}' };
  };

  const result = await runReasoningVerification({ input, caller });

  assert.equal(result.verdict, 'UNCERTAIN');
  assert.deepEqual(result.critics.map(j => j.verdict), ['ALLOW', 'ALLOW', 'ALLOW']);
  assert.equal(result.synthesis.final_verdict, 'UNCERTAIN');
  assert.equal(
    result.guardrail_actions.includes('verdict_normalized:partially_supported->UNCERTAIN'),
    true,
  );
});
