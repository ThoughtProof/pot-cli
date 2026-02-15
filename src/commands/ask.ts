import ora from 'ora';
import chalk from 'chalk';
import { getConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { XAIProvider, MoonshotProvider } from '../providers/openai.js';
import { runGenerators } from '../pipeline/generator.js';
import { runCritic } from '../pipeline/critic.js';
import { runSynthesizer } from '../pipeline/synthesizer.js';
import { Block, Provider } from '../types.js';

function calculateModelDiversityIndex(models: string[]): number {
  const counts = new Map<string, number>();
  models.forEach(m => {
    const key = m.split('-')[0]; // Group by base model
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

export async function askCommand(
  question: string,
  options: { dryRun?: boolean; verbose?: boolean; lang?: string }
): Promise<void> {
  const config = getConfig();
  const language = (options.lang as 'de' | 'en') || config.language;
  const isDryRun = options.dryRun || false;
  
  const spinner = ora('Initializing ThoughtProof pipeline...').start();
  const startTime = Date.now();

  try {
    // Initialize providers
    const anthropic = new AnthropicProvider(config.apiKeys.anthropic);
    const xai = new XAIProvider(config.apiKeys.xai);
    const moonshot = new MoonshotProvider(config.apiKeys.moonshot);

    const providers: { provider: Provider; model: string }[] = [
      { provider: xai, model: config.models.generator1 },
      { provider: moonshot, model: config.models.generator2 },
      { provider: anthropic, model: config.models.generator3 },
    ];

    // Check availability (skip in dry-run)
    if (!isDryRun) {
      const unavailable = providers.filter(p => !p.provider.isAvailable());
      if (unavailable.length > 0) {
        spinner.fail('Some API keys are missing');
        console.log(chalk.red('\nMissing API keys for:'));
        unavailable.forEach(p => console.log(chalk.red(`  - ${p.provider.name}`)));
        console.log(chalk.yellow('\nSet environment variables or configure .potrc.json'));
        process.exit(1);
      }
    }

    // Step 1: Normalize question (simple for v0.1)
    spinner.text = 'Normalizing question...';
    const normalizedQuestion = question.trim();

    // Step 2: Run generators in parallel
    spinner.text = 'Running 3 generators in parallel...';
    const proposals = await runGenerators(providers, normalizedQuestion, language, isDryRun);
    
    if (options.verbose) {
      console.log(chalk.dim('\n✓ Generators completed'));
    }

    // Step 3: Run critic
    spinner.text = 'Running Red-Team critic...';
    const critique = await runCritic(
      anthropic,
      config.models.critic,
      proposals,
      language,
      isDryRun
    );
    
    if (options.verbose) {
      console.log(chalk.dim('✓ Critic completed'));
    }

    // Step 4: Run synthesizer
    spinner.text = 'Synthesizing final answer...';
    const synthesis = await runSynthesizer(
      anthropic,
      config.models.synthesizer,
      proposals,
      critique,
      language,
      isDryRun
    );
    
    if (options.verbose) {
      console.log(chalk.dim('✓ Synthesizer completed'));
    }

    // Step 5: Create and save block
    spinner.text = 'Saving block...';
    const duration = (Date.now() - startTime) / 1000;
    
    const modelList = [
      ...proposals.map(p => p.model),
      critique.model,
      synthesis.model,
    ];
    const mdi = calculateModelDiversityIndex(modelList);

    const block: Block = {
      id: '', // Will be set by storage
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      question,
      normalized_question: normalizedQuestion,
      proposals,
      critique,
      synthesis,
      metadata: {
        total_tokens: 0, // Would need to track from API responses
        total_cost_usd: 0, // Would need to track from API responses
        duration_seconds: duration,
        model_diversity_index: mdi,
      },
    };

    const storage = new BlockStorage(config.blockStoragePath);
    const blockId = storage.save(block);

    spinner.succeed(chalk.green(`Block ${blockId} created in ${duration.toFixed(1)}s`));

    // Display synthesis
    console.log(chalk.bold('\n📊 SYNTHESIS:\n'));
    console.log(synthesis.content);
    console.log(chalk.dim(`\n💾 Saved as ${blockId}`));
    console.log(chalk.dim(`📈 Model Diversity Index: ${mdi.toFixed(3)}`));
    
  } catch (error) {
    spinner.fail('Pipeline failed');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
