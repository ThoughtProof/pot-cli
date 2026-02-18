import ora from 'ora';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getConfig, loadSystemContext, createProvidersFromConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';
import { StaticAnalysisProvider } from '../providers/static-analysis.js';
import { runGenerators } from '../pipeline/generator.js';
import { runCritic } from '../pipeline/critic.js';
import { runSynthesizer } from '../pipeline/synthesizer.js';
import { Block, Provider } from '../types.js';

function calculateModelDiversityIndex(models: string[]): number {
  const counts = new Map<string, number>();
  models.forEach(m => {
    const key = m.split('-')[0];
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const total = models.length;
  let sum = 0;
  counts.forEach(count => {
    const fraction = count / total;
    sum += fraction * fraction;
  });
  return 1 - sum;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
    '.tsx': 'typescript', '.jsx': 'javascript', '.sh': 'bash',
    '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.cpp': 'cpp', '.c': 'c', '.swift': 'swift',
  };
  return map[ext] || 'text';
}

export async function reviewCommand(
  filePath: string,
  options: { verbose?: boolean; lang?: string; focus?: string }
): Promise<void> {
  const config = getConfig();
  const storage = new BlockStorage(config.blockStoragePath);

  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(chalk.red(`File not found: ${resolved}`));
    process.exit(1);
  }

  const code = readFileSync(resolved, 'utf8');
  const language = detectLanguage(resolved);
  const fileName = path.basename(resolved);

  console.log(chalk.bold(`\n🔍 ThoughtProof Review: ${fileName}`));
  console.log(chalk.dim(`   Language: ${language} | ${code.split('\n').length} lines\n`));

  const focusArea = options.focus
    ? `\nFocus especially on: ${options.focus}\n`
    : '';

  const question = `Review this ${language} code from "${fileName}" for quality, architecture, and best practices.${focusArea}

Evaluate:
1. **Architecture & Design:** Is the structure clean? Are responsibilities separated? Are there design pattern violations?
2. **Security:** SQL injection, XSS, hardcoded secrets, input validation, auth issues?
3. **Performance:** N+1 queries, unnecessary re-renders, memory leaks, O(n²) where O(n) is possible?
4. **Maintainability:** Naming, readability, DRY violations, dead code, missing error handling?
5. **Best Practices:** Language-specific idioms, modern patterns, dependency issues?

For each issue found: severity (critical/warning/info), line number, explanation, and suggested fix.

\`\`\`${language}
${code}
\`\`\``;

  const spinner = ora('Initializing review pipeline...').start();
  const startTime = Date.now();

  try {
    const { generators, critic, synthesizer } = createProvidersFromConfig(config);
    const staticAnalysis = new StaticAnalysisProvider();

    const unavailable = generators.filter(g => !g.provider.isAvailable());
    if (unavailable.length > 0) {
      spinner.fail('Some API keys are missing');
      unavailable.forEach(g => console.log(chalk.red(`  - ${g.provider.name}`)));
      process.exit(1);
    }

    const pipelineLang = (options.lang as 'de' | 'en') || config.language;
    const systemContext = loadSystemContext();

    spinner.text = `Running ${generators.length} LLM reviewers + static analysis in parallel...`;

    const [llmProposals, staticResult] = await Promise.all([
      runGenerators(generators, question, pipelineLang, false, systemContext || undefined),
      staticAnalysis.call('static-analysis', question),
    ]);

    const staticProposal = {
      model: 'static-analysis',
      role: 'generator' as const,
      content: staticResult.content,
    };

    const allProposals = [...llmProposals, staticProposal];

    if (options.verbose) {
      console.log(chalk.dim(`\n✓ ${generators.length} LLM reviewers + static analysis completed`));
    }

    spinner.text = 'Running Red-Team critic...';
    const critique = await runCritic(
      critic.provider, critic.model, allProposals, pipelineLang, false, systemContext || undefined
    );
    if (options.verbose) console.log(chalk.dim('✓ Critic completed'));

    spinner.text = 'Synthesizing review...';
    const synthesis = await runSynthesizer(
      synthesizer.provider, synthesizer.model, allProposals, critique, pipelineLang, false, systemContext || undefined
    );
    if (options.verbose) console.log(chalk.dim('✓ Synthesizer completed'));

    spinner.text = 'Saving block...';
    const duration = (Date.now() - startTime) / 1000;
    const modelList = [...allProposals.map(p => p.model), critique.model, synthesis.model];
    const mdi = calculateModelDiversityIndex(modelList);

    const block: Block = {
      id: '',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      question: `[REVIEW] ${fileName}: Code review for quality, architecture, security, performance`,
      normalized_question: question,
      proposals: allProposals,
      critique,
      synthesis,
      metadata: {
        total_tokens: 0,
        total_cost_usd: 0,
        duration_seconds: duration,
        model_diversity_index: mdi,
      },
    };

    const blockId = storage.save(block);
    spinner.succeed(chalk.green(`Review block ${blockId} created in ${duration.toFixed(1)}s`));

    console.log(chalk.bold('\n🔍 CODE REVIEW SYNTHESIS:\n'));
    console.log(synthesis.content);
    console.log(chalk.dim(`\n💾 Saved as ${blockId}`));
    console.log(chalk.dim(`📈 Model Diversity Index: ${mdi.toFixed(3)}`));
    console.log(chalk.dim(`🔧 Reviewers: ${generators.length} LLMs + 1 Static Analysis (${language})`));

  } catch (error) {
    spinner.fail('Review pipeline failed');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
