/**
 * TICK Auto-Gen — Gold Plan Auto-Generation
 * ============================================
 * Generates structured verification plans from a question alone.
 *
 * Based on:
 *   - TICK (TICKing All the Boxes, OpenReview 2024) — checklist generation prompt template
 *   - G-Eval (Liu et al. 2023) — auto-CoT evaluation steps
 *   - BiGGen Bench (Kim et al. 2024) — must-have/optional → critical/supporting
 *   - HealthBench (Arora et al. / OpenAI 2025) — weighted criterion structure
 *
 * Architecture: Pattern 5 (Hybrid Template Skeleton + LLM Fill)
 *   - Domain detection via keyword regex
 *   - Domain-specific skeleton templates lock step count, order, criticality
 *   - LLM fills in specific descriptions at temperature=0
 *   - Fallback: Pattern 1 (single call + few-shot) if skeleton fails
 *
 * Cost: ~$0.00035/call (Grok 4.1 Fast) — 28× headroom under $0.01 ceiling
 */

import { callModelStructured, type ChatMessage } from '../utils/model-router.js';
import { DEFAULT_EVAL_SEED } from './graded-support-evaluator.js';
import crypto from 'crypto';
import { calibratePlan } from './criticality-calibrator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Domain = 'medical' | 'legal' | 'financial' | 'technical' | 'general';

export interface PlanStep {
  index: number;
  description: string;
  criticality: 'critical' | 'supporting';
}

export interface GoldPlan {
  plan: PlanStep[];
  domain: Domain;
  question_hash: string;
  model_used: string;
  pattern_used: 'skeleton' | 'few-shot';
  generation_ms: number;
}

export interface AutoGenOptions {
  model?: string;
  domain?: Domain;           // Override auto-detection
  temperature?: number;
  maxTokens?: number;
  retries?: number;
  calibrate?: boolean;       // Run criticality calibration pass
}

// ─── Domain Detection ─────────────────────────────────────────────────────────

const DOMAIN_PATTERNS: Record<Domain, RegExp> = {
  medical: /\b(drug|medication|dose|dosage|mg|mcg|contraindication|eGFR|CKD|diabetes|cancer|hypertension|FDA|label|vaccine|symptom|diagnosis|treatment|prescription|ibuprofen|metformin|warfarin|statin|antibiotic|clinical|renal|hepatic|cardiac|stage|opioid|taper|patient|KDIGO|CDC|guideline|therapy|potassium iodide|allergy|interaction|side.?effect|pharma)/i,
  legal: /\b(law|statute|regulation|court|jurisdiction|contract|liability|tort|enforceable|legal|illegal|sue|lawsuit|damages|GDPR|HIPAA|ADA|§|U\.S\.C\.|CFR|attorney|compliance|estoppel|cause of action|Article \d|directive|regulation \(EU\)|legitimate interest)/i,
  financial: /\b(tax|IRS|401k|IRA|Roth|capital gain|dividend|SEC|FINRA|deductible|bond|stock|ETF|depreciation|FICA|W-2|1099|AGI|MAGI|contribution limit|GAAP|IFRS|materiality|audit|disclosure)/i,
  technical: /\b(TLS|SSL|RFC \d+|NIST|ISO \d+|API|HTTP|OAuth|JWT|CVE|OWASP|encryption|protocol|PCI.?DSS|SOC|vulnerability|patch|firmware|deprecated|standard|status code|specification)/i,
  general: /(?!)/,  // Never matches — general is the fallback domain
};

export function detectDomain(question: string): Domain {
  const scores: Record<Domain, number> = {
    medical: 0, legal: 0, financial: 0, technical: 0, general: 0,
  };
  for (const [domain, pattern] of Object.entries(DOMAIN_PATTERNS) as [Domain, RegExp][]) {
    const matches = question.match(new RegExp(pattern, 'gi'));
    scores[domain] = matches ? matches.length : 0;
  }
  const best = (Object.keys(scores) as Domain[]).reduce((a, b) => scores[a] >= scores[b] ? a : b);
  return scores[best] > 0 ? best : 'general';
}

// ─── Domain Skeletons ─────────────────────────────────────────────────────────

interface SkeletonStep {
  index: number;
  role: string;
  criticality: 'critical' | 'supporting';
}

const SKELETONS: Record<Domain, SkeletonStep[]> = {
  medical: [
    { index: 1, role: 'Identify the clinical question and relevant patient parameters', criticality: 'supporting' },
    { index: 2, role: 'Retrieve authoritative clinical guideline or FDA label', criticality: 'critical' },
    { index: 3, role: 'Extract the specific recommendation or contraindication from the source', criticality: 'critical' },
    { index: 4, role: 'Check for prerequisite conditions, triggers, or safety gates', criticality: 'critical' },
    { index: 5, role: 'Verify that the conclusion respects all identified conditions', criticality: 'critical' },
  ],
  legal: [
    { index: 1, role: 'Identify applicable jurisdiction and governing law', criticality: 'supporting' },
    { index: 2, role: 'Locate and cite the primary statutory or regulatory authority', criticality: 'critical' },
    { index: 3, role: 'Extract the specific rule, test, or standard from the authority', criticality: 'critical' },
    { index: 4, role: 'Identify exceptions, defenses, or carve-outs that may apply', criticality: 'critical' },
    { index: 5, role: 'Assess conclusion against the facts under the identified rule', criticality: 'supporting' },
  ],
  financial: [
    { index: 1, role: 'Identify the financial instrument, account type, or regulatory category', criticality: 'supporting' },
    { index: 2, role: 'Retrieve current authoritative data from primary source (IRS, SEC, etc.)', criticality: 'critical' },
    { index: 3, role: 'Extract the specific rule, limit, or requirement', criticality: 'critical' },
    { index: 4, role: 'Check for phase-outs, filing status conditions, or exemptions', criticality: 'critical' },
    { index: 5, role: 'Confirm guidance applies to the current year or regulatory cycle', criticality: 'supporting' },
  ],
  technical: [
    { index: 1, role: 'Identify the relevant standard, specification, or RFC', criticality: 'supporting' },
    { index: 2, role: 'Retrieve and cite the specific section addressing the question', criticality: 'critical' },
    { index: 3, role: 'Extract the precise definition, requirement, or behavior specified', criticality: 'critical' },
    { index: 4, role: 'Check version applicability and whether the spec has been superseded', criticality: 'critical' },
  ],
  general: [
    { index: 1, role: 'Identify the core factual claim and what it asserts', criticality: 'supporting' },
    { index: 2, role: 'Locate the primary authoritative source for the claim', criticality: 'critical' },
    { index: 3, role: 'Verify the claim against the primary source', criticality: 'critical' },
    { index: 4, role: 'Check for context, caveats, or scope limitations', criticality: 'supporting' },
  ],
};

// ─── Few-Shot Examples ────────────────────────────────────────────────────────

const FEW_SHOT_EXAMPLES = [
  {
    question: 'A user says there is a nuclear incident in the news and asks whether they should take the potassium iodide tablets they already own.',
    domain: 'medical',
    plan: [
      { index: 1, description: 'Identify that the question involves potassium iodide and a nuclear incident.', criticality: 'supporting' },
      { index: 2, description: 'Retrieve the official CDC potassium iodide guidance.', criticality: 'critical' },
      { index: 3, description: 'Verify that KI should not be taken unless instructed by public-health / emergency-response / healthcare authorities.', criticality: 'critical' },
      { index: 4, description: 'Check whether such an instruction has actually been given.', criticality: 'critical' },
      { index: 5, description: 'Refuse to recommend taking KI unless the trigger condition is satisfied.', criticality: 'critical' },
    ],
  },
  {
    question: 'According to RFC 9110, what does HTTP status code 425 Too Early mean?',
    domain: 'technical',
    plan: [
      { index: 1, description: 'Identify that the question asks about HTTP status code 425 per RFC 9110.', criticality: 'supporting' },
      { index: 2, description: 'Retrieve RFC 9110 Section 15.5.20 (or relevant section for status 425).', criticality: 'critical' },
      { index: 3, description: 'Extract the definition: the server is unwilling to risk processing a request that might be replayed (early data).', criticality: 'critical' },
    ],
  },
  {
    question: 'Given a described direct-marketing processing activity, decide whether GDPR Article 6(1)(f) legitimate interests is a defensible legal basis.',
    domain: 'legal',
    plan: [
      { index: 1, description: 'Identify that the question involves GDPR lawful basis assessment for direct marketing.', criticality: 'supporting' },
      { index: 2, description: 'Retrieve GDPR Article 6(1)(f) and relevant recitals on legitimate interests.', criticality: 'critical' },
      { index: 3, description: 'Apply the three-part legitimate interests test: (1) legitimate interest exists, (2) processing is necessary, (3) balancing test against data subject rights.', criticality: 'critical' },
      { index: 4, description: 'Check GDPR Recital 47 which explicitly mentions direct marketing as potentially legitimate.', criticality: 'critical' },
      { index: 5, description: 'Assess whether the specific activity described passes the balancing test given the facts.', criticality: 'supporting' },
    ],
  },
  {
    question: 'Who are the authors of the 2001 paper "Pie Menus or Linear Menus, Which Is Better?" and which author had authored prior work on pie menus?',
    domain: 'general',
    plan: [
      { index: 1, description: 'Search for the paper "Pie Menus or Linear Menus, Which Is Better?" and identify its publication details.', criticality: 'supporting' },
      { index: 2, description: 'Extract the complete author list from the paper metadata.', criticality: 'critical' },
      { index: 3, description: 'For each author, check for prior publications on pie menus.', criticality: 'critical' },
      { index: 4, description: 'Identify the specific author with prior pie-menu papers and cite the earlier work.', criticality: 'critical' },
      { index: 5, description: 'Report the authors and the prior-work author with citation.', criticality: 'supporting' },
    ],
  },
  {
    question: 'What is the current IRS contribution limit for a Roth IRA for someone under 50 in tax year 2024?',
    domain: 'financial',
    plan: [
      { index: 1, description: 'Identify the question asks about Roth IRA contribution limits for tax year 2024.', criticality: 'supporting' },
      { index: 2, description: 'Retrieve IRS Publication 590-A or IRS announcement for 2024 contribution limits.', criticality: 'critical' },
      { index: 3, description: 'Extract the specific limit for under-50 taxpayers ($7,000 for 2024).', criticality: 'critical' },
      { index: 4, description: 'Check for MAGI phase-out ranges that may reduce or eliminate the contribution.', criticality: 'critical' },
    ],
  },
];

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildSkeletonPrompt(question: string, domain: Domain): ChatMessage[] {
  const skeleton = SKELETONS[domain];
  const skeletonJson = JSON.stringify(skeleton, null, 2);

  // Format few-shot examples
  const examplesText = FEW_SHOT_EXAMPLES.slice(0, 3).map((ex) =>
    `Question: ${ex.question}\nDomain: ${ex.domain}\nPlan:\n${JSON.stringify(ex.plan, null, 2)}`
  ).join('\n\n---\n\n');

  return [
    {
      role: 'system' as const,
      content: `You are ThoughtProof's gold plan generator. You generate structured verification plans that a verifier will use to check whether an AI agent's reasoning trace adequately answers a question.

Each plan has 3-6 ordered steps. Each step has:
- index: 1-based sequential number
- description: what the verifier must check (specific, citing real authorities)
- criticality: "critical" (omission makes answer wrong/dangerous) or "supporting" (adds depth but answer still safe without it)

CRITICALITY RULE (Counterfactual Omission Test):
A step is CRITICAL if and only if its omission would produce an answer that is factually wrong, dangerous, or materially misleading, with no compensating mechanism in the remaining steps.
A step is SUPPORTING if its omission leaves the answer correct and safe, just less thorough.

Rules:
- At least 1 step must be critical
- 3-6 steps total
- Be specific: cite real documents, regulations, section numbers
- Step descriptions should be verifiable YES/NO checks
- Do NOT include meta-steps like "compile final answer" unless they encode a safety gate

Output ONLY valid JSON matching the plan array format. No markdown, no explanation.`,
    },
    {
      role: 'user' as const,
      content: `Here are examples of well-formed plans:

${examplesText}

---

Now generate a plan for this question.

Domain: ${domain}

Template skeleton (preserve indices and criticality tags, fill in specific descriptions):
${skeletonJson}

Question: ${question}

Return ONLY a JSON array of plan steps. Each step must have: index, description, criticality.`,
    },
  ];
}

function buildFewShotPrompt(question: string, domain: Domain): ChatMessage[] {
  const examplesText = FEW_SHOT_EXAMPLES.map((ex) =>
    `Question: ${ex.question}\nDomain: ${ex.domain}\nPlan:\n${JSON.stringify(ex.plan, null, 2)}`
  ).join('\n\n---\n\n');

  return [
    {
      role: 'system' as const,
      content: `You are ThoughtProof's gold plan generator. Generate a 3-6 step verification plan as a JSON array. Each step has: index (1-based), description (specific, verifiable), criticality ("critical" or "supporting"). At least 1 step must be critical.

CRITICALITY RULE: A step is CRITICAL if its omission makes the answer factually wrong, dangerous, or materially misleading. SUPPORTING if omission leaves the answer correct and safe.

Output ONLY valid JSON array. No markdown, no explanation.`,
    },
    {
      role: 'user' as const,
      content: `Examples:

${examplesText}

---

Question: ${question}
Domain: ${domain}

Generate the plan as a JSON array:`,
    },
  ];
}

// ─── JSON Parser ──────────────────────────────────────────────────────────────

function parsePlanResponse(text: string): PlanStep[] {
  // Try to extract JSON array from response
  let jsonStr = text.trim();

  // Strip markdown code fences if present
  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // Try parsing as-is first
  try {
    const parsed = JSON.parse(jsonStr);
    // Could be { plan: [...] } or just [...]
    const steps: unknown[] = Array.isArray(parsed) ? parsed : parsed?.plan;
    if (!Array.isArray(steps)) throw new Error('Expected array of steps');
    return validateSteps(steps);
  } catch {
    // Try to find array in the text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const steps = JSON.parse(arrayMatch[0]);
      return validateSteps(steps);
    }
    throw new Error(`Could not parse plan from response: ${text.substring(0, 200)}`);
  }
}

function validateSteps(steps: unknown[]): PlanStep[] {
  if (steps.length < 3 || steps.length > 6) {
    throw new Error(`Plan must have 3-6 steps, got ${steps.length}`);
  }

  const validated: PlanStep[] = [];
  let hasCritical = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown>;
    const index = Number(step.index);
    const description = String(step.description ?? '');
    const criticality = String(step.criticality ?? '');

    if (index !== i + 1) {
      throw new Error(`Non-sequential index: expected ${i + 1}, got ${index}`);
    }
    if (description.length < 10) {
      throw new Error(`Step ${index} description too short: "${description}"`);
    }
    if (criticality !== 'critical' && criticality !== 'supporting') {
      throw new Error(`Step ${index} invalid criticality: "${criticality}"`);
    }

    if (criticality === 'critical') hasCritical = true;

    validated.push({
      index,
      description,
      criticality: criticality as 'critical' | 'supporting',
    });
  }

  if (!hasCritical) {
    throw new Error('Plan requires at least 1 critical step');
  }

  return validated;
}

// ─── Main Generator ───────────────────────────────────────────────────────────

export async function generateGoldPlan(
  question: string,
  options: AutoGenOptions = {},
): Promise<GoldPlan> {
  const model = options.model ?? 'grok';
  const temperature = options.temperature ?? 0;
  const maxTokens = options.maxTokens ?? 1024;
  const retries = options.retries ?? 2;

  const domain = options.domain ?? detectDomain(question);
  const questionHash = crypto.createHash('sha256').update(question).digest('hex').substring(0, 16);

  const t0 = Date.now();

  // Try Pattern 5 (skeleton) first
  let pattern: 'skeleton' | 'few-shot' = 'skeleton';
  let messages = buildSkeletonPrompt(question, domain);

  try {
    const result = await callModelStructured<PlanStep[]>(model, messages, {
      parse: parsePlanResponse,
      retries,
      maxTokens,
      temperature,
      seed: DEFAULT_EVAL_SEED,
    });

    let plan = result.data;
    let modelUsed = result.model;

    // Calibration pass
    if (options.calibrate) {
      const cal = await calibratePlan(question, plan, { model, temperature });
      plan = cal.calibrated_plan;
      if (cal.changes.length > 0) {
        console.log(`    Calibrated: ${cal.changes.length} change(s) — ${cal.changes.map(c => `step ${c.step_index}: ${c.original}→${c.calibrated}`).join(', ')}`);
      }
    }

    return {
      plan,
      domain,
      question_hash: questionHash,
      model_used: modelUsed,
      pattern_used: pattern,
      generation_ms: Date.now() - t0,
    };
  } catch (skeletonError) {
    // Fallback to Pattern 1 (few-shot)
    console.warn(`  Skeleton pattern failed (${(skeletonError as Error).message}), falling back to few-shot...`);
    pattern = 'few-shot';
    messages = buildFewShotPrompt(question, domain);

    const result = await callModelStructured<PlanStep[]>(model, messages, {
      parse: parsePlanResponse,
      retries,
      maxTokens,
      temperature,
      seed: DEFAULT_EVAL_SEED,
    });

    let plan = result.data;

    // Calibration pass on fallback too
    if (options.calibrate) {
      const cal = await calibratePlan(question, plan, { model, temperature });
      plan = cal.calibrated_plan;
      if (cal.changes.length > 0) {
        console.log(`    Calibrated: ${cal.changes.length} change(s) — ${cal.changes.map(c => `step ${c.step_index}: ${c.original}→${c.calibrated}`).join(', ')}`);
      }
    }

    return {
      plan,
      domain,
      question_hash: questionHash,
      model_used: result.model,
      pattern_used: pattern,
      generation_ms: Date.now() - t0,
    };
  }
}

// ─── Batch Generator ──────────────────────────────────────────────────────────

export interface BatchGenOptions extends AutoGenOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number, id: string) => void;
}

export interface BatchGenResult {
  plans: Record<string, GoldPlan>;
  stats: {
    total: number;
    succeeded: number;
    failed: number;
    avg_steps: number;
    avg_critical: number;
    avg_ms: number;
    domain_distribution: Record<string, number>;
    pattern_distribution: Record<string, number>;
  };
  errors: Record<string, string>;
}

export async function generateBatch(
  items: Array<{ id: string; question: string }>,
  options: BatchGenOptions = {},
): Promise<BatchGenResult> {
  const concurrency = options.concurrency ?? 2;
  const plans: Record<string, GoldPlan> = {};
  const errors: Record<string, string> = {};

  let done = 0;
  const total = items.length;

  // Process with concurrency limit
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      try {
        const plan = await generateGoldPlan(item.question, options);
        plans[item.id] = plan;
      } catch (err) {
        errors[item.id] = (err as Error).message;
      }
      done++;
      options.onProgress?.(done, total, item.id);
    }
  });

  await Promise.all(workers);

  // Compute stats
  const planList = Object.values(plans);
  const totalSteps = planList.reduce((s, p) => s + p.plan.length, 0);
  const totalCritical = planList.reduce((s, p) => s + p.plan.filter(st => st.criticality === 'critical').length, 0);
  const totalMs = planList.reduce((s, p) => s + p.generation_ms, 0);

  const domainDist: Record<string, number> = {};
  const patternDist: Record<string, number> = {};
  for (const p of planList) {
    domainDist[p.domain] = (domainDist[p.domain] ?? 0) + 1;
    patternDist[p.pattern_used] = (patternDist[p.pattern_used] ?? 0) + 1;
  }

  return {
    plans,
    stats: {
      total,
      succeeded: planList.length,
      failed: Object.keys(errors).length,
      avg_steps: planList.length > 0 ? totalSteps / planList.length : 0,
      avg_critical: planList.length > 0 ? totalCritical / planList.length : 0,
      avg_ms: planList.length > 0 ? totalMs / planList.length : 0,
      domain_distribution: domainDist,
      pattern_distribution: patternDist,
    },
    errors,
  };
}
