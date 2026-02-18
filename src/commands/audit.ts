import ora from 'ora';
import chalk from 'chalk';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { getConfig, loadSystemContext, createProvidersFromConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';
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

const FRAMEWORKS: Record<string, { name: string; description: string }> = {
  'gba': {
    name: 'GBA QM (Gemeinsamer Bundesausschuss)',
    description: 'German healthcare quality management: §135a SGB V, Patientensicherheit, Hygiene, Risikomanagement, Schulungen, Dokumentation, PDCA-Zyklen',
  },
  'dsgvo': {
    name: 'DSGVO / GDPR',
    description: 'Data protection: Lawful basis, consent, data minimization, right to erasure, DPO, DPIA, breach notification, cross-border transfers, processor agreements',
  },
  'iso9001': {
    name: 'ISO 9001:2015',
    description: 'Quality management system: Context, leadership, planning, support, operation, performance evaluation, improvement, documented information',
  },
  'hipaa': {
    name: 'HIPAA',
    description: 'US healthcare data: Privacy Rule, Security Rule, PHI, minimum necessary, BAA, breach notification, administrative/physical/technical safeguards',
  },
  'soc2': {
    name: 'SOC 2',
    description: 'Trust Services Criteria: Security, availability, processing integrity, confidentiality, privacy. Controls, monitoring, risk assessment',
  },
  'eu-ai-act': {
    name: 'EU AI Act',
    description: 'AI regulation: Risk classification (unacceptable/high/limited/minimal), transparency, human oversight, data governance, conformity assessment, GPAI obligations',
  },
};

export async function auditCommand(
  target: string,
  options: { verbose?: boolean; lang?: string; framework?: string }
): Promise<void> {
  const config = getConfig();
  const storage = new BlockStorage(config.blockStoragePath);

  // Determine framework
  const fwKey = (options.framework || 'gba').toLowerCase();
  const framework = FRAMEWORKS[fwKey];
  if (!framework) {
    console.error(chalk.red(`Unknown framework: ${fwKey}`));
    console.log(chalk.yellow('Available frameworks:'));
    Object.entries(FRAMEWORKS).forEach(([key, fw]) => {
      console.log(chalk.yellow(`  --framework ${key}  →  ${fw.name}`));
    });
    process.exit(1);
  }

  // Read target (file or directory)
  const resolved = path.resolve(target);
  let content = '';
  let targetName = '';

  if (!existsSync(resolved)) {
    console.error(chalk.red(`Target not found: ${resolved}`));
    process.exit(1);
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    // Read all .md files in directory (max 10)
    const files = readdirSync(resolved)
      .filter(f => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.pdf'))
      .slice(0, 10);
    
    if (files.length === 0) {
      console.error(chalk.red('No .md/.txt files found in directory'));
      process.exit(1);
    }

    targetName = path.basename(resolved) + '/ (' + files.length + ' files)';
    content = files.map(f => {
      const text = readFileSync(path.join(resolved, f), 'utf8');
      return `--- FILE: ${f} ---\n${text.slice(0, 3000)}\n`;
    }).join('\n');
  } else {
    targetName = path.basename(resolved);
    content = readFileSync(resolved, 'utf8');
  }

  console.log(chalk.bold(`\n📋 ThoughtProof Audit: ${targetName}`));
  console.log(chalk.dim(`   Framework: ${framework.name}\n`));

  const question = `Perform a compliance audit of the following document(s) against the ${framework.name} framework.

**Framework requirements:**
${framework.description}

**Audit tasks:**
1. **Gap Analysis:** Which requirements are covered? Which are missing?
2. **Compliance Score:** Rate overall compliance 0-100% with justification
3. **Critical Gaps:** List the top 5 most critical missing items (severity: critical/major/minor)
4. **Recommendations:** Specific, actionable steps to close each gap
5. **Risk Assessment:** What are the legal/operational risks of current gaps?

Be specific. Reference exact sections of the framework and exact parts of the document.

**Document(s) to audit:**
${content.slice(0, 8000)}`;

  const spinner = ora('Initializing audit pipeline...').start();
  const startTime = Date.now();

  try {
    const { generators, critic, synthesizer } = createProvidersFromConfig(config);

    const unavailable = generators.filter(g => !g.provider.isAvailable());
    if (unavailable.length > 0) {
      spinner.fail('Some API keys are missing');
      unavailable.forEach(g => console.log(chalk.red(`  - ${g.provider.name}`)));
      process.exit(1);
    }

    const pipelineLang = (options.lang as 'de' | 'en') || config.language;
    const systemContext = loadSystemContext();

    spinner.text = `Running ${generators.length} auditors against ${framework.name}...`;
    const proposals = await runGenerators(generators, question, pipelineLang, false, systemContext || undefined);
    if (options.verbose) console.log(chalk.dim(`\n✓ ${generators.length} auditors completed`));

    spinner.text = 'Running compliance critic...';
    const critique = await runCritic(
      critic.provider, critic.model, proposals, pipelineLang, false, systemContext || undefined
    );
    if (options.verbose) console.log(chalk.dim('✓ Critic completed'));

    spinner.text = 'Synthesizing audit report...';
    const synthesis = await runSynthesizer(
      synthesizer.provider, synthesizer.model, proposals, critique, pipelineLang, false, systemContext || undefined
    );
    if (options.verbose) console.log(chalk.dim('✓ Synthesizer completed'));

    spinner.text = 'Saving block...';
    const duration = (Date.now() - startTime) / 1000;
    const modelList = [...proposals.map(p => p.model), critique.model, synthesis.model];
    const mdi = calculateModelDiversityIndex(modelList);

    const block: Block = {
      id: '',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      question: `[AUDIT] ${targetName} against ${framework.name}`,
      normalized_question: question,
      proposals,
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
    spinner.succeed(chalk.green(`Audit block ${blockId} created in ${duration.toFixed(1)}s`));

    console.log(chalk.bold(`\n📋 AUDIT REPORT — ${framework.name}:\n`));
    console.log(synthesis.content);
    console.log(chalk.dim(`\n💾 Saved as ${blockId}`));
    console.log(chalk.dim(`📈 Model Diversity Index: ${mdi.toFixed(3)}`));

  } catch (error) {
    spinner.fail('Audit pipeline failed');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
