import type {
  PublicVerdict,
  ReasoningCriticJudgment,
  ReasoningVerificationInput,
  ReasoningVerificationResult,
} from '../index.js';

const verdict: PublicVerdict = 'UNCERTAIN';

const input: ReasoningVerificationInput = {
  id: 'rv-test-1',
  claim: 'The invoice can be approved for payment.',
  rationale: 'The invoice amount matches the purchase order.',
  evidence: 'PO amount equals invoice amount. No sanctions-screening record provided.',
  domain: 'compliance_invoice',
};

const critic: ReasoningCriticJudgment = {
  model: 'serv-nano',
  verdict,
  confidence: 0.72,
  rationale: 'The amount match supports part of the claim, but sanctions evidence is missing.',
  risk_flags: ['missing sanctions screening'],
  evidence_gaps: ['sanctions screening record'],
};

const result: ReasoningVerificationResult = {
  id: input.id ?? 'rv-generated',
  verdict: critic.verdict,
  confidence: critic.confidence,
  verdict_reasoning: critic.rationale,
  dissent: [],
  risk_flags: critic.risk_flags,
  evidence_gaps: critic.evidence_gaps,
  critics: [critic],
};

if (result.verdict !== 'UNCERTAIN') {
  throw new Error('unexpected verdict');
}
