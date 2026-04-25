#!/usr/bin/env node

import { Command } from 'commander';
import { askCommand } from './commands/ask.js';
import { deepCommand } from './commands/deep.js';
import { debugCommand } from './commands/debug.js';
import { reviewCommand } from './commands/review.js';
import { auditCommand } from './commands/audit.js';
import { securityAuditCommand } from './commands/security-audit.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { configCommand, addProviderCommand } from './commands/config.js';
import { calibrationCommand } from './commands/calibration.js';
import { planBenchmarkCommand } from './commands/plan-benchmark.js';
import { planPolicyCommand } from './commands/plan-policy.js';
import { planEnrichFirstPartyCommand } from './commands/plan-enrich-first-party.js';
import { planEnrichSourcePagesCommand } from './commands/plan-enrich-source-pages.js';
import { planSweepFirstPartyCommand } from './commands/plan-sweep-first-party.js';
import { planBuildSourceClaimMapCommand } from './commands/plan-build-source-claim-map.js';
import { planScoreBenchmarkCommand } from './commands/plan-score-benchmark.js';
import { runGradedEval } from './commands/plan-graded-eval.js';
import { runAutoGen } from './commands/plan-auto-gen.js';
import { runLOOCV } from './commands/plan-loocv.js';

const program = new Command();

program
  .name('pot')
  .description('ThoughtProof Proof-of-Thought CLI Tool')
  .version('0.5.0');

program
  .command('ask <question>')
  .description('Run the PoT pipeline on a question')
  .option('--dry-run', 'Run without calling APIs (fake responses)')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--context <refs>', 'Reference previous blocks (e.g., "5,8,9" or "last" or "all")')
  .option('--verify-synthesis', 'Run synthesis twice with different models and compare results')
  .option('--calibrate', 'Run calibrated normalize step (extra API call — opt-in)')
  .action(async (question: string, options) => {
    await askCommand(question, options);
  });

program
  .command('deep <question>')
  .description('Deep analysis: multiple runs with rotated roles + meta-synthesis')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--runs <number>', 'Number of rotation runs (2-5)', '3')
  .action(async (question: string, options) => {
    await deepCommand(question, options);
  });

program
  .command('debug <file>')
  .description('Debug a code file with 3 LLMs + static analysis')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--error <message>', 'Error message or description of the bug')
  .option('--lines <range>', 'Line range to analyze (e.g., "50-120")')
  .action(async (file: string, options) => {
    await debugCommand(file, options);
  });

program
  .command('review <file>')
  .description('Code review for architecture, security, performance, best practices')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--focus <area>', 'Focus area (e.g., "security", "performance", "react patterns")')
  .action(async (file: string, options) => {
    await reviewCommand(file, options);
  });

program
  .command('audit <target>')
  .description('Compliance audit against a framework (file or directory)')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--framework <fw>', 'Framework: gba, dsgvo, iso9001, hipaa, soc2, eu-ai-act', 'gba')
  .action(async (target: string, options) => {
    await auditCommand(target, options);
  });

program
  .command('security-audit <target>')
  .description('Static security analysis on a code repo (local path or GitHub URL)')
  .option('--json', 'Output structured JSON instead of human-readable report')
  .option('--tp-vc', 'Generate a TP-VC attestation JSON alongside the report')
  .option('--verbose', 'Show per-file scan progress')
  .action(async (target: string, options) => {
    await securityAuditCommand(target, options);
  });

program
  .command('list')
  .description('List all blocks')
  .action(() => {
    listCommand();
  });

program
  .command('show <number>')
  .description('Show a specific block')
  .action((number: string) => {
    showCommand(number);
  });

const configCmd = program
  .command('config')
  .description('Manage pot configuration');

configCmd
  .command('show', { isDefault: true })
  .description('Show current configuration (default)')
  .action(() => {
    configCommand();
  });

configCmd
  .command('add-provider <name> <model> <apiKey>')
  .description('Add or update a provider in ~/.potrc.json')
  .option('--base-url <url>', 'Custom base URL for OpenAI-compatible endpoints (e.g. http://localhost:11434/v1 for Ollama)')
  .action((name: string, model: string, apiKey: string, options) => {
    addProviderCommand(name, model, apiKey, options);
  });

program
  .command('calibration')
  .description('Show judge calibration stats (critic/synthesizer bias per model and domain)')
  .option('--model <name>', 'Filter by model name (partial match)')
  .option('--role <role>', 'Filter by role (critic|synthesizer|generator)')
  .option('--domain <domain>', 'Filter by domain (general|medical|legal|financial|code|creative)')
  .action(async (options) => {
    await calibrationCommand(options);
  });

program
  .command('plan-benchmark <inputFile>')
  .description('Benchmark lexical, semantic, and segment-aware plan alignment on PlanRecords or first-party GAIA traces')
  .option('--json', 'Output machine-readable JSON instead of text report')
  .option('--out <file>', 'Write output to a file instead of stdout')
  .option('--plan-records-out <file>', 'Write canonicalized PlanRecord JSON to a file')
  .option('--minimum-score <number>', 'Alignment minimum score threshold (0-1)', '0.25')
  .action(async (inputFile: string, options) => {
    await planBenchmarkCommand(inputFile, options);
  });

program
  .command('plan-policy <inputFile>')
  .description('Evaluate plan-level policy verdicts for a JSON array of PlanRecord objects')
  .option('--json', 'Output machine-readable JSON instead of text report')
  .option('--out <file>', 'Write output to a file instead of stdout')
  .option('--minimum-score <number>', 'Alignment minimum score threshold (0-1)', '0.25')
  .option('--mode <mode>', 'Alignment mode: lexical|semantic', 'semantic')
  .option('--experimental-source-claim-map <file>', 'Optional JSON map keyed by traceId with {support, confidence, exactStringQuestion}')
  .action(async (inputFile: string, options) => {
    await planPolicyCommand(inputFile, options);
  });

program
  .command('plan-score-benchmark <inputFile>')
  .description('Score a mixed plan-level benchmark bundle against expected verdicts, marking unresolved item types explicitly')
  .option('--json', 'Output machine-readable JSON instead of text report')
  .option('--out <file>', 'Write output to a file instead of stdout')
  .option('--minimum-score <number>', 'Alignment minimum score threshold (0-1)', '0.25')
  .option('--mode <mode>', 'Alignment mode: lexical|semantic', 'semantic')
  .option('--experimental-source-claim', 'Include experimental source-claim support during benchmark scoring (off by default)')
  .action(async (inputFile: string, options) => {
    await planScoreBenchmarkCommand(inputFile, options);
  });

program
  .command('plan-enrich-first-party <inputFile>')
  .description('Enrich first-party JSONL traces with ground truth and annotator metadata from a gold map')
  .requiredOption('--gold-map <file>', 'JSON gold map keyed by traceId with ground_truth and annotator_steps')
  .requiredOption('--out <file>', 'Write enriched JSONL to a file')
  .action(async (inputFile: string, options) => {
    await planEnrichFirstPartyCommand(inputFile, options);
  });

program
  .command('plan-sweep-first-party <inputFile>')
  .description('Run the same first-party traces against multiple gold-map profiles and compare policy outcomes')
  .requiredOption('--profiles <file>', 'JSON object mapping profile name to gold-map path')
  .option('--out <file>', 'Write sweep report to a file (defaults to stdout)')
  .option('--format <format>', 'Output format: json|text', 'json')
  .option('--minimum-score <number>', 'Alignment minimum score threshold (0-1)', '0.25')
  .option('--mode <mode>', 'Alignment mode: lexical|semantic', 'semantic')
  .option('--source-claim-map <file>', 'Optional JSON map keyed by traceId with {support, confidence, exactStringQuestion}')
  .option('--enrich-source-pages', 'Enrich browse evidence with fetched source-page metadata before deriving source claims')
  .action(async (inputFile: string, options) => {
    await planSweepFirstPartyCommand(inputFile, options);
  });

program
  .command('plan-enrich-source-pages <inputFile>')
  .description('Enrich first-party browse evidence with fetched source-page metadata such as <title> and <h1>')
  .requiredOption('--out <file>', 'Write enriched JSONL to a file')
  .option('--no-title', 'Do not append fetched HTML <title> strings')
  .option('--no-h1', 'Do not append fetched HTML <h1> strings')
  .action(async (inputFile: string, options) => {
    await planEnrichSourcePagesCommand(inputFile, options);
  });

program
  .command('plan-build-source-claim-map <inputFile>')
  .description('Build a source-claim map from first-party traces, optionally enriching them with a gold map first')
  .option('--gold-map <file>', 'Optional gold map to enrich raw first-party traces before source-claim assessment')
  .option('--out <file>', 'Write source-claim map to a file (defaults to stdout)')
  .option('--enrich-source-pages', 'Enrich browse evidence with fetched source-page metadata before assessing source claims')
  .action(async (inputFile: string, options) => {
    await planBuildSourceClaimMapCommand(inputFile, options);
  });

program
  .command('plan-auto-gen')
  .description('Auto-generate gold verification plans from questions using TICK + domain skeletons')
  .option('--question <text>', 'Single question to generate a plan for')
  .option('--input <file>', 'Input JSON with items [{id, question, gold_plan_steps?}]')
  .option('--output <file>', 'Output JSON path')
  .option('--model <model>', 'Model alias (grok, sonnet, deepseek)', 'grok')
  .option('--domain <domain>', 'Override domain detection (medical, legal, financial, technical, general)')
  .option('--compare', 'Compare auto-generated plans vs existing gold plans')
  .option('--calibrate', 'Run criticality calibration pass (Counterfactual Omission Test)')
  .option('--add-to-benchmark <file>', 'Append generated plan to benchmark JSON file')
  .option('--case-id <id>', 'Custom case ID (default: AUTO-<hash>)')
  .option('--trace <file>', 'Agent trace file or inline trace text')
  .option('--concurrency <n>', 'Parallel generation limit', '2')
  .action(async (options) => {
    await runAutoGen({
      ...options,
      addToBenchmark: options.addToBenchmark,
      caseId: options.caseId,
      trace: options.trace,
      concurrency: parseInt(options.concurrency, 10),
    });
  });

program
  .command('plan-graded-eval')
  .description('Run graded support evaluator (PLV v2) against pilot items with 5-tier scoring + evidence citation')
  .option('--input <file>', 'Input JSON with PLV items')
  .option('--model <model>', 'Model alias (grok, sonnet, deepseek)', 'grok')
  .option('--output <file>', 'Output JSON path')
  .option('--tier1 <backend>', 'Tier-1 pre-filter backend: llm, minicheck, hf-inference')
  .option('--tier1-model <model>', 'Tier-1 LLM model alias', 'deepseek')
  .option('--t-low <number>', 'Tier-1 low confidence threshold', '0.20')
  .option('--t-high <number>', 'Tier-1 high confidence threshold', '0.80')
  .action(async (options) => {
    const args: string[] = [];
    if (options.input) args.push('--input', options.input);
    if (options.model) args.push('--model', options.model);
    if (options.output) args.push('--output', options.output);
    if (options.tier1) args.push('--tier1', options.tier1);
    if (options.tier1Model) args.push('--tier1-model', options.tier1Model);
    if (options.tLow) args.push('--t-low', options.tLow);
    if (options.tHigh) args.push('--t-high', options.tHigh);
    await runGradedEval(args);
  });

program
  .command('plan-loocv')
  .description('Leave-One-Out Cross-Validation analysis on pre-computed evaluation results')
  .option('--input <file>', 'Merged evaluation results JSON (from plan-graded-eval batches)')
  .option('--gate <number>', 'Gate 1 threshold (default: 0.80)', '0.80')
  .action(async (options) => {
    const args: string[] = [];
    if (options.input) args.push('--input', options.input);
    if (options.gate) args.push('--gate', options.gate);
    await runLOOCV(args);
  });

program.parse();
