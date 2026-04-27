/**
 * Criticality Calibrator — Post-Generation Calibration Pass
 * ===========================================================
 * Second LLM call that re-evaluates criticality tags using the
 * Counterfactual Omission Test from industrial safety (HFMEA/AIAG-VDA).
 *
 * Problem: Auto-generated plans systematically over-tag steps as critical.
 * This produces too many false BLOCKs when evaluated against real traces.
 *
 * Solution: For each step, ask: "If a competent AI agent skipped this step
 * entirely, would the final answer be materially wrong or dangerous?"
 * If not → demote to supporting.
 *
 * Key insight from HFMEA: assume failure probability = 100% (step IS omitted),
 * then assess severity alone. This is IEC 62304's practical simplification.
 */

import { callModelStructured, type ChatMessage } from '../utils/model-router.js';
import type { PlanStep, GoldPlan } from './tick-auto-gen.js';
import { DEFAULT_EVAL_SEED } from './graded-support-evaluator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationResult {
  original_plan: PlanStep[];
  calibrated_plan: PlanStep[];
  changes: Array<{
    step_index: number;
    original: 'critical' | 'supporting';
    calibrated: 'critical' | 'supporting';
    reason: string;
  }>;
  model_used: string;
  calibration_ms: number;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildCalibrationPrompt(question: string, plan: PlanStep[]): ChatMessage[] {
  const planText = plan.map(s =>
    `Step ${s.index} [${s.criticality}]: ${s.description}`
  ).join('\n');

  return [
    {
      role: 'system' as const,
      content: `You are a criticality calibrator for AI verification plans. Your job is to review each step's criticality tag and correct over-tagging.

CONTEXT: These plans are used to evaluate AI agent reasoning traces. A step tagged "critical" means: if the agent's trace shows NO evidence of this step, it counts as a failure toward BLOCK verdict. Too many critical steps = too many false blocks on correct agents.

THE COUNTERFACTUAL OMISSION TEST (from HFMEA / IEC 62304):
For each step, assume with certainty that a competent AI agent skips it entirely. Then ask:

1. Would the FINAL ANSWER be factually WRONG? (not just less detailed — actually wrong)
2. Would the omission create a SAFETY RISK or DANGEROUS recommendation?
3. Would a reasonable user be MATERIALLY MISLED?
4. Could the OTHER steps in the plan COMPENSATE for this omission?

If (1) OR (2) OR (3) is YES, AND (4) is NO → CRITICAL
Otherwise → SUPPORTING

CALIBRATION RULES:
- Identification steps ("identify the question is about X") are almost always SUPPORTING — they set context but don't produce the answer.
- Confirmation/verification steps that merely restate what an earlier step already established are SUPPORTING unless they add an independent safety check.
- Steps that check for edge cases, exceptions, or caveats are SUPPORTING unless the edge case is the PRIMARY question.
- The MINIMUM bar for critical: omission produces a WRONG answer, not just an incomplete one.
- A plan should typically have 1-3 critical steps, not 4-5. If you see 4+ critical steps, scrutinize hard.
- Default to SUPPORTING when uncertain. It's better to miss a nuance than to false-block a correct agent.

Output format — one JSON array with objects:
[
  {"index": 1, "criticality": "supporting", "reason": "Identification step; skipping doesn't make answer wrong"},
  {"index": 2, "criticality": "critical", "reason": "Source retrieval; without this the answer has no evidence base"},
  ...
]

Include ALL steps. Output ONLY the JSON array.`,
    },
    {
      role: 'user' as const,
      content: `Question: ${question}

Current plan:
${planText}

Recalibrate each step's criticality using the Counterfactual Omission Test. Return JSON array:`,
    },
  ];
}

// ─── Parser ───────────────────────────────────────────────────────────────────

interface CalibrationEntry {
  index: number;
  criticality: 'critical' | 'supporting';
  reason: string;
}

function parseCalibrationResponse(text: string, expectedSteps: number): CalibrationEntry[] {
  let jsonStr = text.trim();
  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  let entries: CalibrationEntry[];
  try {
    entries = JSON.parse(jsonStr);
  } catch {
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (!arrayMatch) throw new Error(`No JSON array found in response`);
    entries = JSON.parse(arrayMatch[0]);
  }

  if (!Array.isArray(entries)) throw new Error('Expected array');
  if (entries.length !== expectedSteps) {
    throw new Error(`Expected ${expectedSteps} entries, got ${entries.length}`);
  }

  // Validate
  for (const entry of entries) {
    if (typeof entry.index !== 'number') throw new Error(`Missing index`);
    if (entry.criticality !== 'critical' && entry.criticality !== 'supporting') {
      throw new Error(`Invalid criticality: ${entry.criticality}`);
    }
    if (!entry.reason || typeof entry.reason !== 'string') {
      throw new Error(`Missing reason for step ${entry.index}`);
    }
  }

  // Must have at least 1 critical
  const hasCritical = entries.some(e => e.criticality === 'critical');
  if (!hasCritical) {
    throw new Error('Calibration must keep at least 1 critical step');
  }

  return entries;
}

// ─── Main Calibrator ──────────────────────────────────────────────────────────

export async function calibratePlan(
  question: string,
  plan: PlanStep[],
  options: {
    model?: string;
    temperature?: number;
    retries?: number;
  } = {},
): Promise<CalibrationResult> {
  const model = options.model ?? 'grok';
  const temperature = options.temperature ?? 0;
  const retries = options.retries ?? 2;

  const t0 = Date.now();
  const messages = buildCalibrationPrompt(question, plan);

  const result = await callModelStructured<CalibrationEntry[]>(model, messages, {
    parse: (text) => parseCalibrationResponse(text, plan.length),
    retries,
    temperature,
    seed: DEFAULT_EVAL_SEED,
    maxTokens: 1024,
  });

  const calibrated: PlanStep[] = plan.map((step) => {
    const entry = result.data.find(e => e.index === step.index);
    return {
      ...step,
      criticality: entry?.criticality ?? step.criticality,
    };
  });

  const changes = result.data
    .filter(entry => {
      const original = plan.find(s => s.index === entry.index);
      return original && original.criticality !== entry.criticality;
    })
    .map(entry => ({
      step_index: entry.index,
      original: plan.find(s => s.index === entry.index)!.criticality,
      calibrated: entry.criticality,
      reason: entry.reason,
    }));

  return {
    original_plan: plan,
    calibrated_plan: calibrated,
    changes,
    model_used: result.model,
    calibration_ms: Date.now() - t0,
  };
}

// ─── Batch Calibrator ─────────────────────────────────────────────────────────

export async function calibrateBatch(
  items: Array<{ id: string; question: string; plan: PlanStep[] }>,
  options: {
    model?: string;
    temperature?: number;
    onProgress?: (done: number, total: number, id: string, changes: number) => void;
  } = {},
): Promise<{
  results: Record<string, CalibrationResult>;
  stats: {
    total: number;
    items_changed: number;
    steps_demoted: number;
    steps_promoted: number;
    avg_critical_before: number;
    avg_critical_after: number;
    avg_calibration_ms: number;
  };
  errors: Record<string, string>;
}> {
  const results: Record<string, CalibrationResult> = {};
  const errors: Record<string, string> = {};
  let done = 0;

  for (const item of items) {
    try {
      const result = await calibratePlan(item.question, item.plan, options);
      results[item.id] = result;
      done++;
      options.onProgress?.(done, items.length, item.id, result.changes.length);
    } catch (err) {
      errors[item.id] = (err as Error).message;
      done++;
      options.onProgress?.(done, items.length, item.id, -1);
    }
  }

  // Stats
  const resultList = Object.values(results);
  const totalDemoted = resultList.reduce((s, r) =>
    s + r.changes.filter(c => c.original === 'critical' && c.calibrated === 'supporting').length, 0);
  const totalPromoted = resultList.reduce((s, r) =>
    s + r.changes.filter(c => c.original === 'supporting' && c.calibrated === 'critical').length, 0);
  const avgCritBefore = resultList.length > 0
    ? resultList.reduce((s, r) => s + r.original_plan.filter(st => st.criticality === 'critical').length, 0) / resultList.length
    : 0;
  const avgCritAfter = resultList.length > 0
    ? resultList.reduce((s, r) => s + r.calibrated_plan.filter(st => st.criticality === 'critical').length, 0) / resultList.length
    : 0;
  const avgMs = resultList.length > 0
    ? resultList.reduce((s, r) => s + r.calibration_ms, 0) / resultList.length
    : 0;

  return {
    results,
    stats: {
      total: items.length,
      items_changed: resultList.filter(r => r.changes.length > 0).length,
      steps_demoted: totalDemoted,
      steps_promoted: totalPromoted,
      avg_critical_before: avgCritBefore,
      avg_critical_after: avgCritAfter,
      avg_calibration_ms: avgMs,
    },
    errors,
  };
}
