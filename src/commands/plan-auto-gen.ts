/**
 * CLI Command: plan-auto-gen
 * ===========================
 * Auto-generate gold verification plans from questions using TICK + domain skeletons.
 *
 * Usage:
 *   # Single question
 *   pot-cli plan-auto-gen --question "What does HTTP 425 mean per RFC 9110?"
 *
 *   # Batch from JSON file (array of {id, question})
 *   pot-cli plan-auto-gen --input items.json --output plans.json
 *
 *   # Compare auto-gen vs existing gold plans (LOOCV validation)
 *   pot-cli plan-auto-gen --input benchmark.json --compare --output comparison.json
 *
 *   # Override domain detection
 *   pot-cli plan-auto-gen --question "..." --domain medical
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  generateGoldPlan,
  generateBatch,
  detectDomain,
  type GoldPlan,
  type PlanStep,
  type BatchGenResult,
} from '../plan/tick-auto-gen.js';

interface BenchmarkItem {
  id: string;
  question: string;
  gold_plan_steps?: Array<{
    index: number;
    description: string;
    criticality: 'critical' | 'supporting';
  }>;
}

// ─── Verdict Logic (matches graded-support-evaluator) ─────────────────────────

function verdictFromPlan(steps: Array<{ criticality: string }>): string {
  const criticalCount = steps.filter(s => s.criticality === 'critical').length;
  const supportingCount = steps.filter(s => s.criticality === 'supporting').length;
  return `${criticalCount}C/${supportingCount}S`;
}

// ─── Plan Comparison ──────────────────────────────────────────────────────────

interface PlanComparison {
  id: string;
  question: string;
  domain_detected: string;
  domain_gold?: string;
  auto_steps: number;
  gold_steps: number;
  auto_critical: number;
  gold_critical: number;
  criticality_structure_match: boolean;
  step_count_match: boolean;
  verdict_structure_match: boolean; // same critical/supporting distribution
  generation_ms: number;
  pattern_used: string;
  auto_plan: PlanStep[];
  gold_plan?: Array<{ index: number; description: string; criticality: string }>;
}

function comparePlans(
  autoGen: GoldPlan,
  gold: BenchmarkItem,
): PlanComparison {
  const goldSteps = gold.gold_plan_steps ?? [];
  const autoCrit = autoGen.plan.filter(s => s.criticality === 'critical').length;
  const goldCrit = goldSteps.filter(s => s.criticality === 'critical').length;
  const autoSup = autoGen.plan.filter(s => s.criticality === 'supporting').length;
  const goldSup = goldSteps.filter(s => s.criticality === 'supporting').length;

  return {
    id: gold.id,
    question: gold.question.substring(0, 150),
    domain_detected: autoGen.domain,
    auto_steps: autoGen.plan.length,
    gold_steps: goldSteps.length,
    auto_critical: autoCrit,
    gold_critical: goldCrit,
    criticality_structure_match: autoCrit === goldCrit && autoSup === goldSup,
    step_count_match: autoGen.plan.length === goldSteps.length,
    verdict_structure_match: autoCrit === goldCrit,
    generation_ms: autoGen.generation_ms,
    pattern_used: autoGen.pattern_used,
    auto_plan: autoGen.plan,
    gold_plan: goldSteps,
  };
}

// ─── Main Command ─────────────────────────────────────────────────────────────

export async function runAutoGen(options: {
  question?: string;
  input?: string;
  output?: string;
  model?: string;
  domain?: string;
  compare?: boolean;
  concurrency?: number;
  calibrate?: boolean;
  addToBenchmark?: string;  // path to benchmark JSON to append to
  caseId?: string;           // custom case ID
  trace?: string;            // path to trace file or inline trace
}): Promise<void> {
  const model = options.model ?? 'grok';

  // Single question mode
  if (options.question) {
    console.log('\n=== PLV Gold Plan Auto-Generator (TICK v1.0) ===');
    console.log(`Model: ${model}`);
    const domain = (options.domain as any) ?? detectDomain(options.question);
    console.log(`Domain: ${domain} (${options.domain ? 'override' : 'auto-detected'})`);
    console.log('');

    const plan = await generateGoldPlan(options.question, {
      model,
      domain: options.domain as any,
      calibrate: options.calibrate,
    });

    console.log(`Pattern: ${plan.pattern_used}`);
    console.log(`Generated in: ${plan.generation_ms}ms`);
    console.log(`Steps: ${plan.plan.length} (${plan.plan.filter(s => s.criticality === 'critical').length} critical)`);
    console.log('');

    for (const step of plan.plan) {
      const tag = step.criticality === 'critical' ? '🔴' : '🔵';
      console.log(`  ${tag} Step ${step.index} [${step.criticality}]: ${step.description}`);
    }

    console.log(`\nHash: ${plan.question_hash}`);
    console.log(`Model: ${plan.model_used}`);

    // Add-to-benchmark mode
    if (options.addToBenchmark) {
      const benchPath = options.addToBenchmark;
      const caseId = options.caseId ?? `AUTO-${plan.question_hash.substring(0, 6).toUpperCase()}`;

      // Load trace if provided
      let traceSteps = '[TRACE PENDING — run agent on this question, then update trace_steps]';
      let answer = '[ANSWER PENDING]';
      if (options.trace) {
        if (existsSync(options.trace)) {
          const traceData = readFileSync(options.trace, 'utf-8');
          try {
            const parsed = JSON.parse(traceData);
            traceSteps = parsed.trace_steps ?? traceData;
            answer = parsed.answer ?? '[ANSWER PENDING]';
          } catch {
            traceSteps = traceData;
          }
        } else {
          traceSteps = options.trace; // inline trace
        }
      }

      // Build new benchmark item
      const newItem = {
        id: caseId,
        question: options.question,
        answer,
        trace_steps: traceSteps,
        gold_plan_steps: plan.plan,
        _meta: {
          auto_generated: true,
          calibrated: options.calibrate ?? false,
          domain: plan.domain,
          model: plan.model_used,
          pattern: plan.pattern_used,
          generated_at: new Date().toISOString(),
          generation_ms: plan.generation_ms,
        },
      };

      // Print review format
      console.log('\n' + '═'.repeat(60));
      console.log('  📋 REVIEW BEFORE ADDING TO BENCHMARK');
      console.log('═'.repeat(60));
      console.log(`  Case ID:  ${caseId}`);
      console.log(`  Domain:   ${plan.domain}`);
      console.log(`  Question: ${options.question}`);
      console.log('');
      for (const step of plan.plan) {
        const tag = step.criticality === 'critical' ? '🔴 CRITICAL' : '🔵 SUPPORT ';
        console.log(`  ${tag}  Step ${step.index}: ${step.description}`);
      }
      console.log('');
      console.log(`  Trace: ${options.trace ? '✅ loaded' : '⚠️  PENDING (add with --trace <file>)'}`);
      console.log('═'.repeat(60));

      // Load existing benchmark and append
      let benchmark: any[] = [];
      if (existsSync(benchPath)) {
        benchmark = JSON.parse(readFileSync(benchPath, 'utf-8'));
      }

      // Check for duplicate IDs
      if (benchmark.some((item: any) => item.id === caseId)) {
        console.error(`\n❌ Case ID "${caseId}" already exists in benchmark. Use --case-id to specify a unique ID.`);
        process.exit(1);
      }

      benchmark.push(newItem);
      writeFileSync(benchPath, JSON.stringify(benchmark, null, 2));
      console.log(`\n✅ Added ${caseId} to ${benchPath} (${benchmark.length} total cases)`);

      // Also save standalone review file
      const reviewPath = benchPath.replace(/\.json$/, `-review-${caseId}.json`);
      writeFileSync(reviewPath, JSON.stringify(newItem, null, 2));
      console.log(`📝 Review file: ${reviewPath}`);

      return;
    }

    if (options.output) {
      writeFileSync(options.output, JSON.stringify(plan, null, 2));
      console.log(`\nSaved to: ${options.output}`);
    }

    return;
  }

  // Batch mode
  if (!options.input) {
    console.error('Usage: pot-cli plan-auto-gen --question "..." OR --input <file>');
    process.exit(1);
  }

  const raw = readFileSync(options.input, 'utf-8');
  const items: BenchmarkItem[] = JSON.parse(raw);

  console.log('\n=== PLV Gold Plan Auto-Generator — Batch Mode (TICK v1.0) ===');
  console.log(`Model: ${model}`);
  console.log(`Items: ${items.length}`);
  console.log(`Compare mode: ${options.compare ? 'ON' : 'OFF'}`);
  console.log('');

  const batchItems = items.map(i => ({ id: i.id, question: i.question }));
  const calibrate = options.calibrate ?? false;
  if (calibrate) console.log('Calibration pass: ON\n');

  const result = await generateBatch(batchItems, {
    model,
    domain: options.domain as any,
    calibrate,
    concurrency: options.concurrency ?? 2,
    onProgress: (done, total, id) => {
      console.log(`  [${done}/${total}] ${id} — generated`);
    },
  });

  // Print stats
  console.log('\n=== STATS ===\n');
  console.log(`Succeeded: ${result.stats.succeeded}/${result.stats.total}`);
  console.log(`Failed: ${result.stats.failed}`);
  console.log(`Avg steps: ${result.stats.avg_steps.toFixed(1)}`);
  console.log(`Avg critical: ${result.stats.avg_critical.toFixed(1)}`);
  console.log(`Avg generation time: ${result.stats.avg_ms.toFixed(0)}ms`);
  console.log(`Domain distribution: ${JSON.stringify(result.stats.domain_distribution)}`);
  console.log(`Pattern distribution: ${JSON.stringify(result.stats.pattern_distribution)}`);

  if (Object.keys(result.errors).length > 0) {
    console.log('\n=== ERRORS ===\n');
    for (const [id, err] of Object.entries(result.errors)) {
      console.log(`  ${id}: ${err}`);
    }
  }

  // Compare mode
  if (options.compare) {
    console.log('\n=== COMPARISON: Auto-Gen vs Gold ===\n');
    console.log('ID         Domain   Auto Gold  AutoC GoldC  StepMatch CritMatch VerMatch  Pattern   ms');
    console.log('─'.repeat(100));

    const comparisons: PlanComparison[] = [];
    let stepMatches = 0;
    let critMatches = 0;
    let verMatches = 0;
    let compared = 0;

    for (const item of items) {
      const autoGen = result.plans[item.id];
      if (!autoGen || !item.gold_plan_steps) continue;

      compared++;
      const comp = comparePlans(autoGen, item);
      comparisons.push(comp);

      if (comp.step_count_match) stepMatches++;
      if (comp.criticality_structure_match) critMatches++;
      if (comp.verdict_structure_match) verMatches++;

      console.log(
        `${comp.id.padEnd(10)} ${comp.domain_detected.padEnd(8)} ${String(comp.auto_steps).padEnd(4)} ${String(comp.gold_steps).padEnd(5)} ${String(comp.auto_critical).padEnd(5)} ${String(comp.gold_critical).padEnd(6)} ${comp.step_count_match ? '✅' : '❌'}         ${comp.criticality_structure_match ? '✅' : '❌'}         ${comp.verdict_structure_match ? '✅' : '❌'}         ${comp.pattern_used.padEnd(9)} ${comp.generation_ms}`
      );
    }

    console.log('─'.repeat(100));
    console.log(`\nStep count match: ${stepMatches}/${compared} (${((stepMatches / compared) * 100).toFixed(1)}%)`);
    console.log(`Criticality structure match: ${critMatches}/${compared} (${((critMatches / compared) * 100).toFixed(1)}%)`);
    console.log(`Verdict-relevant match (same #critical): ${verMatches}/${compared} (${((verMatches / compared) * 100).toFixed(1)}%)`);

    // Save comparison details
    if (options.output) {
      const outputData = {
        generated_at: new Date().toISOString(),
        model,
        stats: result.stats,
        comparison_stats: {
          compared,
          step_count_match: stepMatches,
          criticality_structure_match: critMatches,
          verdict_structure_match: verMatches,
        },
        comparisons,
        errors: result.errors,
      };
      writeFileSync(options.output, JSON.stringify(outputData, null, 2));
      console.log(`\nResults saved to: ${options.output}`);
    }
  } else if (options.output) {
    writeFileSync(options.output, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to: ${options.output}`);
  }
}
