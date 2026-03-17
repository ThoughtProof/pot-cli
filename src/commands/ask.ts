import ora from 'ora';
import chalk from 'chalk';
import { checkAuthorVerifierSeparation } from '@pot-sdk2/bridge';
import { getConfig, loadSystemContext, createProvidersFromConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';
import { runGenerators } from '../pipeline/generator.js';
import { runCritic } from '../pipeline/critic.js';
import { runSynthesizer, runDualSynthesizer, computeSynthesisBalance } from '../pipeline/synthesizer.js';
import { computeDPR } from '../metrics/dpr.js';
import { Block, Provider, SynthesisBalance, SynthesisVerification } from '../types.js';
import {
  CALIBRATED_NORMALIZE_SYSTEM,
  buildCalibratedNormalizePrompt,
  parseCalibratedNormalizeOutput,
  formatProposalsForNormalize,
  type NormalizeOutput,
} from '../prompts/calibrated-normalize.js';

function calculateDissentScore(proposals: { content: string }[]): number {
  // Measures how different proposals are from each other
  // Uses Jaccard distance on word sets (simple but effective)
  if (proposals.length < 2) return 0;
  
  const wordSets = proposals.map(p => {
    const words = p.content.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3); // skip small words
    return new Set(words);
  });
  
  let totalDistance = 0;
  let pairs = 0;
  
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      const intersection = new Set([...wordSets[i]].filter(w => wordSets[j].has(w)));
      const union = new Set([...wordSets[i], ...wordSets[j]]);
      const jaccard = union.size > 0 ? intersection.size / union.size : 0;
      totalDistance += (1 - jaccard); // distance = 1 - similarity
      pairs++;
    }
  }
  
  return pairs > 0 ? totalDistance / pairs : 0;
}

function getDissentLabel(score: number): string {
  if (score < 0.3) return '🟢 Low (models largely agree)';
  if (score < 0.5) return '🟡 Moderate (some disagreement)';
  if (score < 0.7) return '🟠 High (significant disagreement — review carefully)';
  return '🔴 Very High (models fundamentally disagree — treat with caution)';
}

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
  options: { dryRun?: boolean; verbose?: boolean; lang?: string; context?: string; verifySynthesis?: boolean; calibrate?: boolean }
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

    // Author-Verifier Separation: warn if critic or synthesizer overlaps with generators
    // A model cannot reliably critique/verify output it generated itself.
    const generatorModels = generators.map(g => g.model);
    checkAuthorVerifierSeparation(
      generatorModels[0] ?? 'unknown',
      [critic.model, synthesizer.model],
      { mode: 'warn', logger: ((msg: string) => console.warn(chalk.yellow(`\n⚠️  ${msg}`))) },
    );

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

    // Step 4: Run synthesizer (with optional verify-synthesis dual-run)
    let synthVerification: SynthesisVerification | undefined;
    let synthesis;

    if (options.verifySynthesis && !isDryRun) {
      spinner.text = 'Synthesizing final answer (dual-model verification)...';
      // Use critic model as the secondary synthesizer for cross-verification
      const dualResult = await runDualSynthesizer(
        synthesizer.provider,
        synthesizer.model,
        critic.provider,
        critic.model,
        proposals,
        critique,
        language,
        contextText
      );
      synthesis = dualResult.primary;
      synthVerification = dualResult.verification;
    } else {
      spinner.text = 'Synthesizing final answer...';
      synthesis = await runSynthesizer(
        synthesizer.provider,
        synthesizer.model,
        proposals,
        critique,
        language,
        isDryRun,
        contextText
      );
    }

    if (options.verbose) {
      console.log(chalk.dim('✓ Synthesizer completed'));
    }

    // Step 4b: Compute Synthesis Balance Score
    const synthesisBalance: SynthesisBalance = isDryRun
      ? { score: 1, generator_coverage: [], warning: false }
      : computeSynthesisBalance(proposals, synthesis.content);

    // Step 4c: Compute DPR (Dissent Preservation Rate)
    const dpr = computeDPR(critique.content, synthesis.content, synthesisBalance.warning);

    // Step 4d: Calibrated Normalize (DSPy-optimized, opt-in via --calibrate flag)
    // Note: runs an extra synthesizer API call — opt-in to avoid doubling cost by default
    let normalizeResult: NormalizeOutput | undefined;
    if (options.calibrate) try {
      const normalizePrompt = buildCalibratedNormalizePrompt({
        question: normalizedQuestion,
        proposals: formatProposalsForNormalize(proposals),
        critique: critique.content,
        synthesis: synthesis.content,
      });
      const combinedPrompt = `${CALIBRATED_NORMALIZE_SYSTEM}\n\n---\n\n${normalizePrompt}`;
      const rawConf = synthesis.content.match(/confidence[:\s]*(\d+(?:\.\d+)?)%/i);
      const fallback = rawConf ? parseFloat(rawConf[1]) / 100 : 0.5;
      const normalizeResponse = await synthesizer.provider.call(synthesizer.model, combinedPrompt);
      normalizeResult = parseCalibratedNormalizeOutput(normalizeResponse.content, fallback);
    } catch {
      // Non-fatal — pipeline continues without calibration
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
    const dissentScore = calculateDissentScore(proposals);

    const block: Block = {
      id: '', // Will be set by storage
      version: '0.4.0',
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
        dissent_score: dissentScore,
        synthesis_balance: synthesisBalance,
        synthesis_verification: synthVerification,
        dpr,
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
    console.log(chalk.dim(`⚖️  Dissent Score: ${dissentScore.toFixed(3)} — ${getDissentLabel(dissentScore)}`));

    // Display Synthesis Balance Score
    const balanceEmoji = synthesisBalance.score > 0.75 ? '🟢' : synthesisBalance.score > 0.5 ? '🟡' : '🔴';
    console.log(chalk.dim(`${balanceEmoji} Synthesis Balance Score: ${synthesisBalance.score.toFixed(3)}`));
    if (synthesisBalance.warning && synthesisBalance.dominated_by) {
      console.log(chalk.yellow(`⚠️  Balance Warning: "${synthesisBalance.dominated_by}" dominates the synthesis (>60% share)`));
    }

    // Display DPR
    if (dpr.total_objections > 0) {
      const dprEmoji = dpr.score > 0.6 ? '🟢' : dpr.score > 0.4 ? '🟡' : '🔴';
      console.log(chalk.dim(`${dprEmoji} Dissent Preservation Rate: ${dpr.score.toFixed(3)} (${dpr.preserved}/${dpr.total_objections} objections preserved)`));
      if (dpr.false_consensus) {
        console.log(chalk.red(`⚠️  FALSE CONSENSUS detected — synthesizer discarded critic objections (DPR ${dpr.score.toFixed(2)} < 0.40)`));
      }
    }

    // Display Calibrated Normalize result
    if (normalizeResult) {
      const verdictEmoji: Record<string, string> = {
        VERIFIED: '✅', UNCERTAIN: '🟡', DISSENT: '🔴', UNVERIFIED: '❌',
      };
      const confBar = normalizeResult.confidence >= 0.75 ? '🟢' : normalizeResult.confidence >= 0.50 ? '🟡' : '🔴';
      console.log(chalk.dim(
        `${verdictEmoji[normalizeResult.verdict] ?? '🔲'} Calibrated Verdict: ${normalizeResult.verdict} ` +
        `${confBar} ${(normalizeResult.confidence * 100).toFixed(0)}% — ${normalizeResult.calibration_reason}`
      ));
    }

    // Display Synthesis Verification result
    if (synthVerification) {
      if (synthVerification.verified) {
        console.log(chalk.green(`✅ Synthesis Verified — both models converge (similarity: ${synthVerification.similarity_score.toFixed(3)})`));
      } else {
        console.log(chalk.yellow(`⚠️  Synthesis Diverged — models produced different results (similarity: ${synthVerification.similarity_score.toFixed(3)})`));
        if (synthVerification.alt_synthesis) {
          console.log(chalk.dim(`\n📊 ALT SYNTHESIS (${synthVerification.alt_model}):\n`));
          console.log(chalk.dim(synthVerification.alt_synthesis));
        }
      }
    };
    
  } catch (error) {
    spinner.fail('Pipeline failed');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
