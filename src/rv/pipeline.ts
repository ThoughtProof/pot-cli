import type { PublicVerdict, ReasoningCriticJudgment, ReasoningVerificationInput, ReasoningVerificationResult } from './types.js';

export type RvStage = 'judge' | 'critic' | 'synthesizer';

export interface ModelCallRequest {
  model: string;
  stage: RvStage;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens: number;
}

export interface ModelCallResponse {
  content: string;
  usage?: { input: number; output: number };
  model?: string;
}

export type ModelCaller = (request: ModelCallRequest) => Promise<ModelCallResponse>;

export interface RvCriticResult {
  objections: string[];
  severity_scores: number[];
  survival_assessment: string;
  overall_risk_level: string;
}

export interface RvSynthesisResult {
  final_verdict: PublicVerdict;
  confidence: number;
  synthesis_reasoning: string;
  dissent_preserved: string[];
  calibration_notes: string;
}

export interface RvGuardrailInput {
  input: ReasoningVerificationInput;
  judges: ReasoningCriticJudgment[];
  critic: RvCriticResult;
  synthesis: RvSynthesisResult;
}

export interface RvPipelineResult extends ReasoningVerificationResult {
  guardrail_actions: string[];
  synthesis: RvSynthesisResult;
}

export interface RvPipelineOptions {
  input: ReasoningVerificationInput;
  caller: ModelCaller;
  judgeModels?: string[];
  criticModel?: string;
  synthesizerModel?: string;
}

export function loadEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function parseModelJson<T = any>(content: string): T {
  const text = String(content ?? '').trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]) as T;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;

  throw new Error(`Could not parse JSON from model content: ${text.slice(0, 120)}`);
}

/**
 * Coerce model confidence into a finite 0..1 number.
 * Live judges (esp. kimi) sometimes emit ordinal labels ("high"/"HIGH")
 * or percent-scale values; leave unusable values as NaN so callers can drop them.
 */
export function normalizeConfidence(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Percent-scale only when clearly 2..100 (avoid treating 1.2/1.5 as 1.2%).
    if (raw >= 2 && raw <= 100) return parseFloat((raw / 100).toFixed(3));
    return Math.max(0, Math.min(1, raw));
  }
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    const labeled: Record<string, number> = {
      very_high: 0.95, veryhigh: 0.95, 'very high': 0.95,
      high: 0.9, medium_high: 0.8, 'medium-high': 0.8,
      medium: 0.6, moderate: 0.6, med: 0.6,
      low: 0.3, very_low: 0.15, verylow: 0.15, 'very low': 0.15,
    };
    if (t in labeled) return labeled[t];
    const n = Number(t);
    if (Number.isFinite(n)) return normalizeConfidence(n);
  }
  return Number.NaN;
}

function joinedText(parts: Array<string | string[] | undefined>): string {
  return parts.flatMap(part => Array.isArray(part) ? part : (part ? [part] : [])).join(' ').toLowerCase();
}

function hasCriticalRiskDismissal(text: string): boolean {
  return /confirmed|sanctions|critical|fraud|vulnerabilit|breach/.test(text)
    && /dismiss|irrelevant|ignore|not relevant|safe anyway/.test(text);
}

function hasMissingControlsBoundary(text: string): boolean {
  return /missing|not provided|lacks|no rollback|without|incomplete/.test(text)
    && /control|rollback|monitor|staged|screening|duplicate|execution|liquidity|slippage|readiness|approval/.test(text);
}

// ─── Bidirectional confidence correction (ported from pot-sdk ebd1f2a) ───────

/**
 * pot-sdk v2.1 asymmetric override policy, re-implemented for the RV pipeline.
 *
 * RV is claim-check shaped: judges produce independent confidences, the
 * synthesizer states a final one. Pre-fix pot-sdk only corrected DOWNWARD
 * (inflation), so conservative synthesizer caps collapsed confidence on clear
 * factual claims. This ports the bidirectional fix:
 *
 * DOWNWARD (inflation): stated − mean(judges) > 0.20 → FULL replace with
 *   judge mean. Catches synthesizer inflation / prompt injection.
 * UPWARD (deflation): mean(judges) − stated > 0.30 → DAMPENED correction:
 *   final = stated + 0.6 * (mean − stated). Higher threshold + dampening
 *   because the judge mean is a crude signal and the synthesizer may have
 *   detected subtle issues judges missed.
 *
 * See pot-sdk src/pipeline/aggregator.ts (applyAggregatedConfidence) and
 * DRAFTS/2026-08-03-POT-SDK-TO-CLI-RV-TRANSFER.md.
 */
export const RV_INFLATION_GAP_THRESHOLD = 0.20;
export const RV_DEFLATION_GAP_THRESHOLD = 0.30;
export const RV_DEFLATION_DAMPENING = 0.6;

export interface RvConfidenceCorrection {
  confidence: number;
  judgeMean?: number;
  action?: 'judge_inflation_override' | 'judge_deflation_dampened';
}

export function applyRvConfidenceCorrection(
  statedConfidence: number,
  judgeConfidences: number[],
): RvConfidenceCorrection {
  const valid = judgeConfidences.filter(c => typeof c === 'number' && !isNaN(c));
  if (valid.length === 0) return { confidence: statedConfidence };

  const judgeMean = parseFloat((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(3));
  const gap = statedConfidence - judgeMean;

  if (gap > RV_INFLATION_GAP_THRESHOLD) {
    return { confidence: judgeMean, judgeMean, action: 'judge_inflation_override' };
  }
  if (-gap > RV_DEFLATION_GAP_THRESHOLD) {
    const corrected = statedConfidence + RV_DEFLATION_DAMPENING * (judgeMean - statedConfidence);
    return { confidence: parseFloat(corrected.toFixed(3)), judgeMean, action: 'judge_deflation_dampened' };
  }
  return { confidence: statedConfidence, judgeMean };
}

export function applyRvGuardrails(args: RvGuardrailInput): RvPipelineResult {
  const synthesis = args.synthesis;
  const critic = args.critic;
  const text = joinedText([
    args.input.claim,
    args.input.rationale,
    args.input.evidence,
    synthesis.synthesis_reasoning,
    synthesis.calibration_notes,
    critic.objections,
  ]);

  let verdict = synthesis.final_verdict;
  const guardrailActions: string[] = [];

  // Bidirectional confidence correction vs independent judge mean (pot-sdk port).
  const correction = applyRvConfidenceCorrection(
    synthesis.confidence,
    args.judges.map(j => j.confidence),
  );
  let confidence = correction.confidence;
  if (correction.action) guardrailActions.push(correction.action);

  if (verdict === 'BLOCK' && hasMissingControlsBoundary(text) && !hasCriticalRiskDismissal(text)) {
    verdict = 'UNCERTAIN';
    confidence = Math.min(confidence, 0.74);
    guardrailActions.push('missing_controls_block_capped_to_uncertain');
  }

  const riskFlags = Array.from(new Set([
    ...args.judges.flatMap(j => j.risk_flags),
    ...critic.objections,
  ].filter(Boolean)));
  const evidenceGaps = Array.from(new Set(args.judges.flatMap(j => j.evidence_gaps).filter(Boolean)));

  return {
    id: args.input.id ?? 'rv-generated',
    verdict,
    confidence,
    verdict_reasoning: synthesis.synthesis_reasoning,
    dissent: synthesis.dissent_preserved ?? [],
    risk_flags: riskFlags,
    evidence_gaps: evidenceGaps,
    critics: args.judges,
    guardrail_actions: guardrailActions,
    synthesis,
  };
}

const JUDGE_SYSTEM = `You are a Proof-of-Thought / Reasoning Verification judge. Evaluate claim + rationale + evidence. Return JSON only with verdict, confidence, reasoning, risk_flags, evidence_gaps. confidence MUST be a numeric float in [0,1] (never a label like "high").`;
const CRITIC_SYSTEM = `You are an adversarial Reasoning Verification critic. Find material flaws, missing controls, overclaims, contradictions, and critical-risk dismissals. Return JSON only with objections, severity_scores, survival_assessment, overall_risk_level.`;
const SYNTH_SYSTEM = `You are the final Reasoning Verification synthesizer. Preserve dissent, apply materiality, respect stated-claim boundaries, and return JSON only with final_verdict, confidence, synthesis_reasoning, dissent_preserved, calibration_notes.

CONFIDENCE CALIBRATION (verification mode — claim checking, not open-ended opinion):
- Cap confidence at 0.95 maximum — even clear facts retain marginal uncertainty
- For fact-based claims with clear evidence and no material critic objections: 0.80-0.95 is appropriate
- For subjective assessments or missing evidence: cap at 0.75
- When judges agree but the critic found shared bias or unaddressed objections: cap at 0.65
- IMPORTANT: When all judges clearly support the verdict and the critic raised no material objections, confidence of 0.80+ is warranted — do not collapse to 0.5 out of generic caution`;

export async function runReasoningVerification(options: RvPipelineOptions): Promise<RvPipelineResult> {
  const judgeModels = options.judgeModels ?? ['deepseek', 'grok', 'serv-nano'];
  const criticModel = options.criticModel ?? 'serv-nano';
  const synthesizerModel = options.synthesizerModel ?? 'sonnet';
  const input = options.input;
  const casePrompt = `CLAIM: ${input.claim}\nRATIONALE: ${input.rationale}\nEVIDENCE: ${input.evidence}\nDOMAIN: ${input.domain ?? 'unspecified'}\nCONTEXT: ${input.context ?? ''}`;

  const judges: ReasoningCriticJudgment[] = [];
  for (const model of judgeModels) {
    const response = await options.caller({
      model,
      stage: 'judge',
      maxTokens: 800,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: casePrompt },
      ],
    });
    const parsed = parseModelJson<{ verdict: PublicVerdict; confidence: number; reasoning?: string; rationale?: string; risk_flags?: string[]; evidence_gaps?: string[] }>(response.content);
    judges.push({
      model,
      verdict: parsed.verdict,
      confidence: normalizeConfidence(parsed.confidence),
      rationale: parsed.reasoning ?? parsed.rationale ?? '',
      risk_flags: parsed.risk_flags ?? [],
      evidence_gaps: parsed.evidence_gaps ?? [],
    });
  }

  const criticResponse = await options.caller({
    model: criticModel,
    stage: 'critic',
    maxTokens: 1000,
    messages: [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: `${casePrompt}\n\nJUDGES:\n${JSON.stringify(judges)}` },
    ],
  });
  const critic = parseModelJson<RvCriticResult>(criticResponse.content);

  const synthResponse = await options.caller({
    model: synthesizerModel,
    stage: 'synthesizer',
    maxTokens: 1200,
    messages: [
      { role: 'system', content: SYNTH_SYSTEM },
      { role: 'user', content: `${casePrompt}\n\nJUDGES:\n${JSON.stringify(judges)}\n\nCRITIC:\n${JSON.stringify(critic)}` },
    ],
  });
  const synthesis = parseModelJson<RvSynthesisResult>(synthResponse.content);
  synthesis.confidence = normalizeConfidence(synthesis.confidence);
  if (Number.isNaN(synthesis.confidence)) synthesis.confidence = 0.5;

  return applyRvGuardrails({ input, judges, critic, synthesis });
}
