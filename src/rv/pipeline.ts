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
  let confidence = synthesis.confidence;
  const guardrailActions: string[] = [];

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

const JUDGE_SYSTEM = `You are a Proof-of-Thought / Reasoning Verification judge. Evaluate claim + rationale + evidence. Return JSON only with verdict, confidence, reasoning, risk_flags, evidence_gaps.`;
const CRITIC_SYSTEM = `You are an adversarial Reasoning Verification critic. Find material flaws, missing controls, overclaims, contradictions, and critical-risk dismissals. Return JSON only with objections, severity_scores, survival_assessment, overall_risk_level.`;
const SYNTH_SYSTEM = `You are the final Reasoning Verification synthesizer. Preserve dissent, apply materiality, respect stated-claim boundaries, and return JSON only with final_verdict, confidence, synthesis_reasoning, dissent_preserved, calibration_notes.`;

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
      confidence: parsed.confidence,
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

  return applyRvGuardrails({ input, judges, critic, synthesis });
}
