/**
 * CLI Command: plan-graded-eval
 * ==============================
 * Runs the graded support evaluator against PLV pilot items.
 *
 * Usage:
 *   pot-cli plan-graded-eval --input <path> --model grok [--output <path>]
 */

import { readFileSync, writeFileSync } from 'fs';
import { evaluateBatch, type EvalInput, type EvalRunResult, type ItemResult } from '../plan/graded-support-evaluator.js';
import type { Tier1Config } from '../plan/tier1-prefilter.js';
import { toPublicVerdict, assertInternalFormat, type InternalVerdict } from '../verdict-mapper.js';

interface GoldVerdicts {
  [id: string]: 'BLOCK' | 'HOLD' | 'ALLOW';
}

// Gold verdicts from the PLV pilot
const GOLD_VERDICTS: GoldVerdicts = {
  // B-family (execution risk)
  'V3-01': 'BLOCK', 'V3-03': 'BLOCK', 'V3-07': 'BLOCK', 'V3-12': 'BLOCK',
  'B-05': 'BLOCK', 'B-06': 'BLOCK',
  // C-family (dependency chain)
  'V2-C01': 'BLOCK', 'V2-C02': 'HOLD', 'V2-C03': 'ALLOW', 'V2-C04': 'BLOCK', // was HOLD — 2/3 critical steps missing from trace
  'C-05': 'BLOCK', 'C-06': 'BLOCK',
  // D-family (negative control)
  'V0-14': 'HOLD', 'V0-01': 'ALLOW', 'V0-02': 'ALLOW',
  'D-01': 'ALLOW', 'D-02': 'ALLOW', 'D-03': 'HOLD', 'D-04': 'HOLD',
  // H-family (retrieval boundary)
  'V1-R01': 'HOLD', 'V1-R02': 'HOLD', 'V1-R04': 'HOLD', 'V1-R05': 'BLOCK', // was HOLD — 83-char trace, 0 evidence for 2 critical steps
  'H-05': 'HOLD', 'H-06': 'HOLD', 'H-07': 'ALLOW', 'H-08': 'ALLOW',
  // GAIA-family (realistic web-grounded tasks)
  'GAIA-01': 'HOLD', 'GAIA-02': 'ALLOW', 'GAIA-03': 'ALLOW', 'GAIA-04': 'ALLOW', 'GAIA-05': 'ALLOW',
  'GAIA-06': 'BLOCK', 'GAIA-07': 'HOLD', 'GAIA-08': 'BLOCK', 'GAIA-09': 'HOLD', 'GAIA-10': 'BLOCK',
  'GAIA-11': 'BLOCK', 'GAIA-12': 'BLOCK', 'GAIA-13': 'BLOCK', 'GAIA-14': 'BLOCK', 'GAIA-15': 'BLOCK',
};

export async function runGradedEval(args: string[]): Promise<void> {
  // Parse args
  let inputPath = '';
  let outputPath = '';
  let model = 'grok';
  let tier1Backend: string | null = null;
  let tier1Model = 'deepseek';
  let tier1TLow = 0.20;
  let tier1THigh = 0.80;
  let outputFormat: 'public' | 'internal' = 'public';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) inputPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) outputPath = args[++i];
    else if (args[i] === '--model' && args[i + 1]) model = args[++i];
    else if (args[i] === '--tier1' && args[i + 1]) tier1Backend = args[++i];
    else if (args[i] === '--tier1-model' && args[i + 1]) tier1Model = args[++i];
    else if (args[i] === '--t-low' && args[i + 1]) tier1TLow = parseFloat(args[++i]);
    else if (args[i] === '--t-high' && args[i + 1]) tier1THigh = parseFloat(args[++i]);
    else if (args[i] === '--format' && args[i + 1]) outputFormat = args[++i] as 'public' | 'internal';
  }

  // Guard: --format internal requires THOUGHTPROOF_INTERNAL=1
  if (outputFormat === 'internal') {
    assertInternalFormat();
  }

  if (!inputPath) {
    console.error('Usage: pot-cli plan-graded-eval --input <path> [--model grok] [--output <path>] [--tier1 llm|minicheck|hf-inference] [--tier1-model deepseek] [--t-low 0.20] [--t-high 0.80]');
    process.exit(1);
  }

  // Read input
  const raw = readFileSync(inputPath, 'utf-8');
  const items: EvalInput[] = JSON.parse(raw);

  // Build Tier-1 config
  const tier1Config: Tier1Config | undefined = tier1Backend ? {
    backend: tier1Backend as 'llm' | 'minicheck' | 'hf-inference',
    model: tier1Model,
    tLow: tier1TLow,
    tHigh: tier1THigh,
    enabled: true,
  } : undefined;

  console.log(`\n=== PLV Graded Support Evaluator (v2.0 Two-Tier) ===`);
  console.log(`Tier 2 Model: ${model}`);
  if (tier1Config) {
    console.log(`Tier 1: ${tier1Backend} (model=${tier1Model}, tLow=${tier1TLow}, tHigh=${tier1THigh})`);
  } else {
    console.log(`Tier 1: disabled (all steps → Tier 2)`);
  }
  console.log(`Items: ${items.length}`);
  console.log(`Schema: plv-graded-support-v2.0`);
  console.log('');

  // Run evaluation
  const result = await evaluateBatch(items, model, {
    concurrency: 1,  // Sequential to avoid OOM on Mac mini with two-tier API calls
    maxTokens: 4096,
    tier1: tier1Config,
    onProgress: (done, total, id) => {
      console.log(`  [${done}/${total}] ${id} — evaluated`);
    },
  });

  // Print Tier-1 aggregate stats if available
  if (tier1Config) {
    let t1Rejected = 0;  // Steps Tier-1 fast-rejected (unsupported, skipped Grok)
    let t1Total = 0;
    let t2Evaluated = 0;
    for (const itemResult of Object.values(result.items)) {
      for (const stepEval of itemResult.step_evaluations) {
        t1Total++;
        if (stepEval.reasoning.startsWith('[TIER1')) {
          t1Rejected++;
        } else {
          t2Evaluated++;
        }
      }
    }
    if (t1Total > 0) {
      const rejPct = ((t1Rejected / t1Total) * 100).toFixed(1);
      const t2Pct = ((t2Evaluated / t1Total) * 100).toFixed(1);
      console.log(`\n  📊 Tier-1 fast-rejected: ${t1Rejected}/${t1Total} steps (${rejPct}%) — skipped Grok`);
      console.log(`  📊 Tier-2 (Grok) evaluated: ${t2Evaluated}/${t1Total} steps (${t2Pct}%)`);
      console.log(`  💰 Grok calls saved: ${rejPct}%`);
    }
  }

  // Compare with gold
  console.log('\n=== RESULTS ===\n');
  console.log('ID         Fam  Gold    Eval    Score  OK   Prov');
  console.log('─'.repeat(60));

  let correct = 0;
  let total = 0;
  let totalProvViolations = 0;
  const families: Record<string, { correct: number; total: number }> = {};

  for (const [id, itemResult] of Object.entries(result.items)) {
    const gold = GOLD_VERDICTS[id];
    if (!gold) continue;
    total++;

    const ok = itemResult.verdict === gold;
    if (ok) correct++;

    // Determine family
    let fam = '?';
    if (id.startsWith('V3-') || id.startsWith('B-')) fam = 'B';
    else if (id.startsWith('V2-') || id.startsWith('C-')) fam = 'C';
    else if (id.startsWith('V0-') || id.startsWith('D-')) fam = 'D';
    else if (id.startsWith('V1-') || id.startsWith('H-')) fam = 'H';
    else if (id.startsWith('GAIA-')) fam = 'G';

    if (!families[fam]) families[fam] = { correct: 0, total: 0 };
    families[fam].total++;
    if (ok) families[fam].correct++;

    const provCount = itemResult.provenance_violations.length;
    totalProvViolations += provCount;

    // Avg score across steps
    const avgScore = itemResult.step_evaluations.length > 0
      ? (itemResult.step_evaluations.reduce((s, e) => s + e.score, 0) / itemResult.step_evaluations.length).toFixed(2)
      : 'N/A';

    console.log(
      `${id.padEnd(10)} ${fam.padEnd(4)} ${gold.padEnd(7)} ${itemResult.verdict.padEnd(7)} ${String(avgScore).padEnd(6)} ${ok ? '✅' : '❌'}   ${provCount > 0 ? `⚠️ ${provCount}` : '—'}`
    );
  }

  console.log('─'.repeat(60));
  console.log(`\nVerdict accuracy: ${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)`);
  console.log(`Provenance violations: ${totalProvViolations}`);

  console.log('\nPer-family:');
  for (const [fam, data] of Object.entries(families).sort()) {
    console.log(`  ${fam}: ${data.correct}/${data.total} (${((data.correct / data.total) * 100).toFixed(0)}%)`);
  }

  // Step-level stats
  let totalSteps = 0;
  let supportedSteps = 0;
  let partialSteps = 0;
  let unsupportedSteps = 0;
  let skippedSteps = 0;

  for (const item of Object.values(result.items)) {
    for (const step of item.step_evaluations) {
      totalSteps++;
      switch (step.predicate) {
        case 'supported': supportedSteps++; break;
        case 'partial': partialSteps++; break;
        case 'unsupported': unsupportedSteps++; break;
        case 'skipped': skippedSteps++; break;
      }
    }
  }

  console.log(`\nStep predicates: supported=${supportedSteps} partial=${partialSteps} unsupported=${unsupportedSteps} skipped=${skippedSteps} (total=${totalSteps})`);

  // Detailed step breakdown for mismatches
  const mismatches = Object.entries(result.items).filter(([id, r]) => GOLD_VERDICTS[id] && r.verdict !== GOLD_VERDICTS[id]);
  if (mismatches.length > 0) {
    console.log('\n=== MISMATCH DETAILS ===\n');
    for (const [id, itemResult] of mismatches) {
      console.log(`${id} — Gold: ${GOLD_VERDICTS[id]}, Got: ${itemResult.verdict}`);
      console.log(`  Reason: ${itemResult.verdict_reasoning}`);
      for (const step of itemResult.step_evaluations) {
        const goldStep = items.find(i => i.id === id)?.gold_plan_steps.find(g => `step_${g.index}` === step.step_id);
        console.log(`  ${step.step_id} [${goldStep?.criticality ?? '?'}]: score=${step.score} tier=${step.tier} pred=${step.predicate}`);
        if (step.quote) console.log(`    quote: "${step.quote.substring(0, 80)}${step.quote.length > 80 ? '...' : ''}"`);
        console.log(`    reasoning: ${step.reasoning.substring(0, 120)}`);
      }
      if (itemResult.provenance_violations.length > 0) {
        console.log(`  Provenance: ${itemResult.provenance_violations.join('; ')}`);
      }
      console.log('');
    }
  }

  // Save output — apply verdict mapping for public format
  if (!outputPath) {
    outputPath = inputPath.replace(/\.json$/, '-graded-eval-result.json');
  }

  if (outputFormat === 'public') {
    // Map internal verdicts to public 3-tier contract
    const publicResult: Record<string, any> = {
      ...result,
      output_format: 'public',
      items: {} as Record<string, any>,
    };
    for (const [id, item] of Object.entries(result.items)) {
      const mapped = toPublicVerdict(item.verdict as InternalVerdict);
      publicResult.items[id] = {
        ...item,
        verdict: mapped.verdict,
        verdict_internal: undefined, // strip internal
        metadata: mapped.metadata,
      };
    }
    writeFileSync(outputPath, JSON.stringify(publicResult, null, 2));
    console.log(`\nResults saved to: ${outputPath} (format: public, 3-tier)`);
  } else {
    // Internal format — keep engine verdicts as-is
    const internalResult = { ...result, output_format: 'internal' };
    writeFileSync(outputPath, JSON.stringify(internalResult, null, 2));
    console.log(`\nResults saved to: ${outputPath} (format: internal, 5-tier)`);
  }
}
