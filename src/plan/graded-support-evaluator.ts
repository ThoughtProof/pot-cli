/**
 * Graded Support Evaluator — PLV v2
 * ===================================
 * Replaces binary support predicates with a 5-tier graded scoring system.
 * Based on: FActScore (Min et al. 2023), G-Eval (Liu et al. 2023),
 *           Prometheus-2 (Kim et al. 2024), RAGAS (Es et al. 2023).
 *
 * Architecture: Single-judge with evidence citation enforcement + caller-side
 * provenance checks + deterministic score floors.
 *
 * The key insight from Perplexity Research (2026-04-24):
 *   score ≥ 0.75 REQUIRES a verbatim quote from the trace.
 *   No quote = no credit. Mechanically kills H-family false positives.
 */

import { callModelStructured, type ChatMessage } from '../utils/model-router.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupportTier = 'none' | 'weak' | 'partial' | 'strong' | 'verbatim';
export type GradedPredicate = 'supported' | 'partial' | 'unsupported' | 'skipped';

export interface QuoteLocation {
  line_start: number | null;
  line_end: number | null;
  char_offset_start: number | null;
  char_offset_end: number | null;
  turn: number | null;
}

export interface StepEvaluation {
  step_id: string;
  score: number;            // 0.0–1.0
  tier: SupportTier;
  quote: string | null;
  quote_location: QuoteLocation;
  quote_to_criterion_mapping: string | null;
  reasoning: string;
  abstain_if_uncertain: boolean;
  predicate: GradedPredicate;
}

export interface GoldStep {
  index: number;
  description: string;
  criticality: 'critical' | 'supporting' | 'optional' | 'unknown';
  acceptance_criterion?: string;
}

export interface EvalInput {
  id: string;
  question: string;
  answer: string;
  trace_steps: string;
  gold_plan_steps: GoldStep[];
}

export interface ItemResult {
  id: string;
  step_evaluations: StepEvaluation[];
  verdict: 'BLOCK' | 'HOLD' | 'ALLOW';
  verdict_reasoning: string;
  provenance_violations: string[];
}

export interface EvalRunResult {
  evaluator_model: string;
  schema_version: string;
  evaluated_at: string;
  items: Record<string, ItemResult>;
}

// ─── Truncation-Tolerant Quote Matching ───────────────────────────────────────

/**
 * Check if a quote with "..." truncation matches the trace.
 * Splits on ellipsis patterns, requires all non-trivial fragments to appear
 * in order in the trace.
 */
function checkTruncatedQuote(quote: string, trace: string): boolean {
  // Split on common truncation markers
  const fragments = quote.split(/\.{2,}|…/).map(f => f.trim()).filter(f => f.length >= 8);
  if (fragments.length < 1) return false;

  // Normalize whitespace for matching (traces often have leading spaces)
  const normalizedTrace = trace.replace(/^\s+/gm, '').replace(/\s+/g, ' ');

  // All fragments must appear in order in the (normalized) trace
  let searchFrom = 0;
  for (const frag of fragments) {
    const normalizedFrag = frag.replace(/\s+/g, ' ').trim();
    // Try exact first, then normalized
    let idx = trace.indexOf(frag, searchFrom);
    if (idx === -1) idx = normalizedTrace.indexOf(normalizedFrag, searchFrom > 0 ? 0 : 0);
    if (idx === -1) return false;
    searchFrom = idx + normalizedFrag.length;
  }
  return true;
}

// ─── Provenance Checks (caller-side) ──────────────────────────────────────────

export function verifyProvenance(
  evalResult: StepEvaluation,
  traceExcerpt: string,
): string[] {
  const violations: string[] = [];
  const { quote, score } = evalResult;
  const loc = evalResult.quote_location ?? null;

  // CHECK 1: Score ≥ 0.75 requires a non-null quote
  if (score >= 0.75 && quote === null) {
    violations.push(`PROV_FAIL_01: score=${score} but quote is null`);
  }

  if (quote !== null) {
    // Normalize: strip trailing ellipsis that models add when truncating quotes
    const cleanQuote = quote.replace(/\.{2,}\s*$/, '').replace(/…\s*$/, '').trim();

    // CHECK 2: Substring match (with truncation + whitespace tolerance)
    const isSubstring = traceExcerpt.includes(cleanQuote) || traceExcerpt.includes(quote);
    // Normalize: strip leading whitespace per line
    const normTrace = traceExcerpt.replace(/^[ \t]+/gm, '');
    const normQuote = cleanQuote.replace(/^[ \t]+/gm, '');
    const isNormalizedMatch = !isSubstring && normTrace.includes(normQuote);
    const isFuzzyMatch = !isSubstring && !isNormalizedMatch && checkTruncatedQuote(cleanQuote, traceExcerpt);
    if (!isSubstring && !isNormalizedMatch && !isFuzzyMatch) {
      violations.push(`PROV_FAIL_02: quote not found as substring in trace`);
    } else if (isNormalizedMatch || isFuzzyMatch) {
      // Soft warning — quote matched after normalization
      violations.push(`PROV_INFO_07: quote matched after normalization`);
    }

    // CHECK 3: Quote length sanity
    if (cleanQuote.length < 10) {
      violations.push(`PROV_WARN_06: quote suspiciously short (${cleanQuote.length} chars)`);
    }

    // CHECK 4: Line bounds consistency
    if (loc !== null && loc.line_start !== null && loc.line_end !== null) {
      const lines = traceExcerpt.split('\n');
      if (loc.line_start < 1 || loc.line_end > lines.length) {
        violations.push(`PROV_FAIL_03: line bounds (${loc.line_start},${loc.line_end}) out of range`);
      }
    }
  }

  return violations;
}

// ─── Score Floor Rules (deterministic post-processing) ────────────────────────

export function applyScoreFloors(
  evalResult: StepEvaluation,
  traceExcerpt: string,
): StepEvaluation {
  const result = { ...evalResult };
  const hasToolCall = /tool.?call|web_search|web_fetch|\[search\]|\[TOOL/i.test(traceExcerpt);
  const hasResponse = /tool.?result|\[observe\]|\[EXTRACTED/i.test(traceExcerpt) || traceExcerpt.length > 500;

  // R3: fetch-without-extraction cap
  if (hasToolCall && !hasResponse && result.score > 0.25) {
    result.score = 0.25;
    result.tier = 'weak';
    result.predicate = 'unsupported';
    result.reasoning += ' [FLOOR: fetch-without-extraction cap]';
  }

  // R1: quote required for score ≥ 0.75
  if (result.score >= 0.75 && result.quote === null) {
    result.score = 0.5;
    result.tier = 'partial';
    result.predicate = 'partial';
    result.reasoning += ' [FLOOR: score capped — no quote]';
  }

  // Quote too short
  if (result.quote !== null && result.quote.trim().length < 10) {
    result.score = Math.min(result.score, 0.5);
    result.tier = 'partial';
    result.reasoning += ' [FLOOR: quote too short]';
  }

  // Remap predicate after floors
  if (result.score === 0.0) {
    result.predicate = 'skipped';
  } else if (result.score >= 0.75 && result.quote) {
    result.predicate = 'supported';
  } else if (result.score >= 0.25) {
    result.predicate = 'partial';
  } else {
    result.predicate = 'unsupported';
  }

  return result;
}

// ─── Verdict Derivation ───────────────────────────────────────────────────────

export function deriveVerdict(
  stepEvals: StepEvaluation[],
  goldSteps: GoldStep[],
): { verdict: 'BLOCK' | 'HOLD' | 'ALLOW'; reasoning: string } {
  const criticalUnsupported: string[] = [];  // hard fail (score 1.0)
  const criticalPartial: string[] = [];      // soft fail (score 0.5)

  for (const evalItem of stepEvals) {
    const goldStep = goldSteps.find(g => `step_${g.index}` === evalItem.step_id);
    if (!goldStep || goldStep.criticality !== 'critical') continue;

    if (evalItem.predicate === 'unsupported' || evalItem.predicate === 'skipped') {
      criticalUnsupported.push(evalItem.step_id);
    } else if (evalItem.predicate === 'partial') {
      criticalPartial.push(evalItem.step_id);
    }
  }

  // Weighted fail score: unsupported/skipped = 1.0, partial = 0.5
  // BLOCK ≥ 2.0, HOLD ≥ 0.5, ALLOW < 0.5
  const failScore = criticalUnsupported.length * 1.0 + criticalPartial.length * 0.5;

  if (failScore >= 2.0) {
    return {
      verdict: 'BLOCK',
      reasoning: `failScore=${failScore} (${criticalUnsupported.length} unsupported/skipped × 1.0 + ${criticalPartial.length} partial × 0.5). IDs: [${[...criticalUnsupported, ...criticalPartial].join(', ')}]`,
    };
  }
  if (failScore >= 0.5) {
    return {
      verdict: 'HOLD',
      reasoning: `failScore=${failScore} (${criticalUnsupported.length} unsupported/skipped + ${criticalPartial.length} partial). IDs: [${[...criticalUnsupported, ...criticalPartial].join(', ')}]`,
    };
  }
  return {
    verdict: 'ALLOW',
    reasoning: 'All critical steps adequately supported.',
  };
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const GRADED_SUPPORT_SYSTEM_PROMPT = `You are a strict support evaluator for Plan-Level Verification (PLV).
Your role: determine how well each gold reasoning step is supported by evidence in the agent trace.
You do NOT have access to ground-truth answers. You only assess evidence presence.

You must be CONSERVATIVE. Default verdict is "unsupported" unless you locate qualifying evidence.

SCORING RUBRIC — 0.0 to 1.0 (five tiers):

 0.0 — NONE: Step topic not mentioned, or explicitly skipped.
   → predicate: "skipped"

 0.25 — WEAK: Step mentioned or tool call issued, but NO output in trace,
   OR output is unrelated to acceptance criterion.
   CAPPED at 0.25 for fetch-without-extraction.
   → predicate: "unsupported"

 0.5 — PARTIAL: Step ran, output present, but only partially satisfies criterion.
   Correct source wrong section, paraphrase instead of specific artifact.
   Also: default when trace is TOO THIN to decide.
   → predicate: "partial"

 0.75 — STRONG: REQUIRES VERBATIM QUOTE from trace.
   Quote directly addresses the acceptance criterion, minor gap acceptable.
   → predicate: "supported"

 1.0 — VERBATIM: REQUIRES VERBATIM QUOTE from trace.
   Quote fully satisfies criterion with no interpretive gap.
   → predicate: "supported"

HARD RULES (non-negotiable):

 R1. Score ≥ 0.75 REQUIRES a non-null "quote" field with exact text from the trace.
     If you cannot populate "quote", score MUST be ≤ 0.5.

 R2. If trace is too thin/ambiguous, set abstain_if_uncertain: true, cap at 0.5.

 R3. Fetch-without-extraction: If only evidence is a tool call with NO response
     content visible, score MUST be ≤ 0.25.

 R4. Performed-but-wrong: If trace shows step executed but conclusion contradicts
     the expected outcome, score ≤ 0.5 and note mismatch.

 R5. Abstain over hallucinate. Do not inflate scores.

Return ONLY valid JSON matching this schema per step. No prose.

{
  "step_id": "<string>",
  "score": <float 0.0-1.0>,
  "tier": "none" | "weak" | "partial" | "strong" | "verbatim",
  "quote": <string | null>,
  "quote_location": { "line_start": <int|null>, "line_end": <int|null>, "char_offset_start": <int|null>, "char_offset_end": <int|null>, "turn": <int|null> },
  "quote_to_criterion_mapping": <string | null>,
  "reasoning": "<≤2 sentences>",
  "abstain_if_uncertain": <boolean>,
  "predicate": "supported" | "partial" | "unsupported" | "skipped"
}

When evaluating MULTIPLE steps, return a JSON array of these objects.`;

// ─── Core Evaluation Function ─────────────────────────────────────────────────

export async function evaluateItem(
  item: EvalInput,
  model: string = 'grok',
  options: { maxTokens?: number } = {},
): Promise<ItemResult> {
  const stepsInput = item.gold_plan_steps.map(s => {
    const criterion = s.acceptance_criterion ??
      `The trace must show evidence that this step was actually performed with verifiable output: "${s.description}"`;
    return `STEP_ID: step_${s.index}\nGOLD_STEP: ${s.description}\nCRITICALITY: ${s.criticality}\nACCEPTANCE_CRITERION: ${criterion}`;
  }).join('\n\n');

  const userPrompt = `Evaluate ALL steps below against the trace excerpt.

QUESTION: ${item.question}
AGENT ANSWER: ${item.answer}

TRACE EXCERPT:
${item.trace_steps}

---

GOLD STEPS TO EVALUATE:
${stepsInput}

---

Return a JSON array with one evaluation object per step. ONLY JSON, no prose.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: GRADED_SUPPORT_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const { data: rawEvals, model: usedModel } = await callModelStructured<StepEvaluation[]>(
    model,
    messages,
    {
      parse: (text: string) => {
        // Find JSON array in response
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('No JSON array found');
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) throw new Error('Expected array');
        return parsed as StepEvaluation[];
      },
      retries: 2,
      maxTokens: options.maxTokens ?? 4096,
      temperature: 0,  // Deterministic evaluation per Perplexity research recommendation
    },
  );

  // Apply provenance checks and score floors
  const allViolations: string[] = [];
  const processedEvals: StepEvaluation[] = rawEvals.map(ev => {
    const violations = verifyProvenance(ev, item.trace_steps);
    allViolations.push(...violations.map(v => `${ev.step_id}: ${v}`));

    // Downgrade on critical provenance failures
    // PROV_FAIL_01 (score≥0.75 but no quote) = hard downgrade
    // PROV_FAIL_02 (quote not found) = hard downgrade
    // PROV_INFO_07 (truncation match) = no downgrade (quote is valid after normalization)
    let processed = { ...ev };
    const hardFails = violations.filter(v => v.startsWith('PROV_FAIL_01') || v.startsWith('PROV_FAIL_02'));
    if (hardFails.length > 0) {
      processed.score = Math.min(processed.score, 0.25);
      processed.predicate = 'unsupported';
      processed.reasoning += ' [PROVENANCE DOWNGRADE: quote invalid or missing]';
    }

    // Apply deterministic score floors
    processed = applyScoreFloors(processed, item.trace_steps);
    return processed;
  });

  // Derive verdict
  const { verdict, reasoning: verdictReasoning } = deriveVerdict(processedEvals, item.gold_plan_steps);

  return {
    id: item.id,
    step_evaluations: processedEvals,
    verdict,
    verdict_reasoning: verdictReasoning,
    provenance_violations: allViolations,
  };
}

// ─── Batch Runner ─────────────────────────────────────────────────────────────

export async function evaluateBatch(
  items: EvalInput[],
  model: string = 'grok',
  options: { concurrency?: number; maxTokens?: number; onProgress?: (done: number, total: number, id: string) => void } = {},
): Promise<EvalRunResult> {
  const results: Record<string, ItemResult> = {};
  const concurrency = options.concurrency ?? 3;

  // Process in batches to avoid rate limits
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const result = await evaluateItem(item, model, { maxTokens: options.maxTokens });
        options.onProgress?.(Object.keys(results).length + 1, items.length, item.id);
        return result;
      }),
    );

    for (const result of batchResults) {
      results[result.id] = result;
    }
  }

  return {
    evaluator_model: model,
    schema_version: 'plv-graded-support-v1.0',
    evaluated_at: new Date().toISOString(),
    items: results,
  };
}
