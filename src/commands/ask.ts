import ora from 'ora';
import chalk from 'chalk';
import { getConfig, loadSystemContext, createProvidersFromConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';
import { runGenerators } from '../pipeline/generator.js';
import { runCritic } from '../pipeline/critic.js';
import { runSynthesizer } from '../pipeline/synthesizer.js';
import { Block, Provider } from '../types.js';

function calculateModelDiversityIndex(models: string[]): number {
  const counts = new Map<string, number>();
  models.forEach(m => {
    // Group by provider family, not just first token
    const lower = m.toLowerCase();
    let key: string;
    if (lower.includes('claude') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('haiku')) {
      key = 'anthropic';
    } else if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) {
      key = 'openai';
    } else if (lower.includes('grok')) {
      key = 'xai';
    } else if (lower.includes('kimi') || lower.includes('moonshot')) {
      key = 'moonshot';
    } else if (lower.includes('deepseek')) {
      key = 'deepseek';
    } else if (lower.includes('gemini')) {
      key = 'google';
    } else {
      key = lower.split('-')[0]; // Fallback
    }
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

function truncateText(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

function parseContextOption(contextOption: string, storage: BlockStorage): { refs: string[]; contextText: string; lang: 'de' | 'en' } {
  const refs: string[] = [];
  const contextParts: string[] = [];

  if (contextOption === 'last') {
    const lastNum = storage.getLastBlockNumber();
    if (lastNum === 0) {
      throw new Error('No blocks found for --context last');
    }
    const block = storage.loadBlock(lastNum);
    if (block) {
      refs.push(block.id);
      const truncated = truncateText(block.synthesis.content, 500);
      contextParts.push(`[${block.id} Synthese]: ${truncated}`);
    }
  } else if (contextOption === 'all') {
    const allBlocks = storage.list();
    if (allBlocks.length === 0) {
      throw new Error('No blocks found for --context all');
    }
    allBlocks.forEach(block => {
      refs.push(block.id);
      const truncated = truncateText(block.synthesis.content, 500);
      contextParts.push(`[${block.id} Synthese]: ${truncated}`);
    });
  } else {
    // Parse comma-separated numbers: "5,8,9"
    const numbers = contextOption.split(',').map(s => parseInt(s.trim(), 10));
    const blocks = storage.loadBlocks(numbers);
    
    if (blocks.length === 0) {
      throw new Error(`No blocks found for context: ${contextOption}`);
    }
    
    blocks.forEach(block => {
      refs.push(block.id);
      const truncated = truncateText(block.synthesis.content, 500);
      contextParts.push(`[${block.id} Synthese]: ${truncated}`);
    });
  }

  const lang: 'de' | 'en' = contextParts[0]?.includes('Synthese') ? 'de' : 'en';
  const contextLabel = lang === 'de' ? 'KONTEXT AUS VORHERIGEN BLOCKS:' : 'CONTEXT FROM PREVIOUS BLOCKS:';
  const contextText = contextParts.length > 0
    ? `${contextLabel}\n${contextParts.join('\n\n')}\n`
    : '';

  return { refs, contextText, lang };
}

export async function askCommand(
  question: string,
  options: { dryRun?: boolean; verbose?: boolean; lang?: string; context?: string }
): Promise<void> {
  const config = getConfig();
  const storage = new BlockStorage(config.blockStoragePath);
  const isDryRun = options.dryRun || false;
  
  // Parse context if provided
  let contextRefs: string[] = [];
  let contextText: string | undefined;
  let language = (options.lang as 'de' | 'en') || config.language;

  // Load system context (always injected if present)
  const systemContext = loadSystemContext();

  if (options.context) {
    try {
      const parsed = parseContextOption(options.context, storage);
      contextRefs = parsed.refs;
      contextText = systemContext + (parsed.contextText || '');
      // Use language from context if not explicitly set
      if (!options.lang) {
        language = parsed.lang;
      }
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : 'Context parsing failed'));
      process.exit(1);
    }
  } else if (systemContext) {
    // Even without --context, inject system context
    contextText = systemContext;
  }
  
  const spinner = ora('Initializing ThoughtProof pipeline...').start();
  const startTime = Date.now();

  try {
    // Initialize providers from config (handles both old and new format)
    const { generators, critic, synthesizer } = createProvidersFromConfig(config);

    // Check availability (skip in dry-run)
    if (!isDryRun) {
      const unavailable = generators.filter(g => !g.provider.isAvailable());
      if (unavailable.length > 0 || !critic.provider.isAvailable() || !synthesizer.provider.isAvailable()) {
        spinner.fail('Some API keys are missing');
        console.log(chalk.red('\nMissing API keys for:'));
        unavailable.forEach(g => console.log(chalk.red(`  - ${g.provider.name}`)));
        if (!critic.provider.isAvailable()) console.log(chalk.red(`  - ${critic.provider.name} (critic)`));
        if (!synthesizer.provider.isAvailable()) console.log(chalk.red(`  - ${synthesizer.provider.name} (synthesizer)`));
        console.log(chalk.yellow('\nSet environment variables or configure .potrc.json'));
        process.exit(1);
      }
    }

    // Step 1: Normalize question (simple for v0.1)
    spinner.text = 'Normalizing question...';
    const normalizedQuestion = question.trim();

    // Step 2: Run generators in parallel
    spinner.text = `Running ${generators.length} generators in parallel...`;
    const proposals = await runGenerators(generators, normalizedQuestion, language, isDryRun, contextText);
    
    if (options.verbose) {
      console.log(chalk.dim('\n✓ Generators completed'));
    }

    // Step 3: Run critic
    spinner.text = `Running Red-Team critic (${critic.model.split('-').slice(0,2).join('-')})...`;
    const critique = await runCritic(
      critic.provider,
      critic.model,
      proposals,
      language,
      isDryRun,
      contextText
    );
    
    if (options.verbose) {
      console.log(chalk.dim('✓ Critic completed'));
    }

    // Step 4: Run synthesizer
    spinner.text = 'Synthesizing final answer...';
    const synthesis = await runSynthesizer(
      synthesizer.provider,
      synthesizer.model,
      proposals,
      critique,
      language,
      isDryRun,
      contextText
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
      context_refs: contextRefs.length > 0 ? contextRefs : undefined,
    };

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
