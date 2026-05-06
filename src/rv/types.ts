import type { PublicVerdict } from '../verdict-mapper.js';

export type { PublicVerdict } from '../verdict-mapper.js';

export interface ReasoningVerificationInput {
  id?: string;
  claim: string;
  /** The reasoning under review. */
  rationale: string;
  evidence: string;
  context?: string;
  domain?: string;
}

export interface ReasoningCriticJudgment {
  model: string;
  verdict: PublicVerdict;
  /** 0..1 model-reported confidence; not a calibrated probability. */
  confidence: number;
  /** Critic explanation for its own judgment. */
  rationale: string;
  risk_flags: string[];
  evidence_gaps: string[];
}

export interface ReasoningVerificationResult {
  id: string;
  verdict: PublicVerdict;
  /** 0..1 policy/model confidence; not a calibrated probability. */
  confidence: number;
  /** Final verifier explanation. Distinct from the input rationale under review. */
  verdict_reasoning: string;
  dissent: string[];
  risk_flags: string[];
  evidence_gaps: string[];
  critics?: ReasoningCriticJudgment[];
}
