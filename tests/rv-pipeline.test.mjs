import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRvGuardrails,
  loadEnvText,
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
  assert.equal(result.guardrail_actions.includes('missing_controls_block_capped_to_uncertain'), true);
});
