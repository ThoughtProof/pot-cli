import ora from 'ora';
import chalk from 'chalk';
import { getConfig, loadSystemContext, createProvidersFromConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';
import { runGenerator } from '../pipeline/generator.js';
import { runCritic } from '../pipeline/critic.js';
import { runSynthesizer } from '../pipeline/synthesizer.js';
import { Block, Provider, Proposal, Critique } from '../types.js';

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

interface RunResult {
  runNumber: number;
  constellation: string;
  proposals: Proposal[];
  critique: Critique;
  synthesis: { model: string; role: string; content: string };
}

export async function deepCommand(
  question: string,
  options: { verbose?: boolean; lang?: string; runs?: string }
): Promise<void> {
  const config = getConfig();
  const storage = new BlockStorage(config.blockStoragePath);
  const numRuns = parseInt(options.runs || '3', 10);

  console.log(chalk.bold(`\n🔬 ThoughtProof Deep Analysis`));
  console.log(chalk.dim(`   ${numRuns} runs with rotated roles\n`));

  const spinner = ora('Initializing deep pipeline...').start();
  const startTime = Date.now();

  try {
    // Initialize all providers from config
    const { generators, critic, synthesizer } = createProvidersFromConfig(config);

    // Build agent pool from generators + critic + synthesizer for rotations
    const agents: { name: string; provider: Provider; model: string }[] = [
      ...generators.map(g => ({ name: g.provider.name, provider: g.provider, model: g.model })),
    ];

    // For deep mode, we need at least 4 agents to rotate
    if (agents.length < 4) {
      // Add critic and synthesizer if we need more agents
      agents.push({ name: critic.provider.name, provider: critic.provider, model: critic.model });
      if (agents.length < 4) {
        agents.push({ name: synthesizer.provider.name, provider: synthesizer.provider, model: synthesizer.model });
      }
    }

    // Generate rotation constellations
    // Each run: 3 generators + 1 critic (rotated), synthesizer always Opus (needs to be highest quality)
    const constellations: { generators: number[]; critic: number }[] = [
      { generators: [0, 1, 2], critic: 3 },  // Run 1: Grok+Kimi+Sonnet gen, Opus critic
      { generators: [3, 1, 2], critic: 0 },  // Run 2: Opus+Kimi+Sonnet gen, Grok critic
      { generators: [0, 3, 2], critic: 1 },  // Run 3: Grok+Opus+Sonnet gen, Kimi critic
      { generators: [0, 1, 3], critic: 2 },  // Run 4: Grok+Kimi+Opus gen, Sonnet critic
      { generators: [3, 0, 1], critic: 2 },  // Run 5: Opus+Grok+Kimi gen, Sonnet critic
    ].slice(0, numRuns);

    const pipelineLang = (options.lang as 'de' | 'en') || config.language;
    const systemContext = loadSystemContext();
    const contextText = systemContext || undefined;

    const runResults: RunResult[] = [];

    // Execute each run
    for (let i = 0; i < constellations.length; i++) {
      const constellation = constellations[i];
      const genNames = constellation.generators.map(idx => agents[idx].name).join('+');
      const criticName = agents[constellation.critic].name;
      const label = `${genNames} → ${criticName}`;

      spinner.text = `Run ${i + 1}/${constellations.length}: ${label} — generators...`;

      // Run generators in parallel
      const genPromises = constellation.generators.map(idx => {
        const agent = agents[idx];
        return runGenerator(agent.provider, agent.model, question, pipelineLang, false, contextText)
          .catch((error: Error) => ({
            model: agent.model.split('/').pop() || agent.model,
            role: 'generator' as const,
            content: `[ERROR] ${agent.name} failed: ${error.message}`,
          }));
      });

      const proposals = await Promise.all(genPromises);

      if (options.verbose) {
        console.log(chalk.dim(`\n✓ Run ${i + 1} generators done (${genNames})`));
      }

      // Run critic
      spinner.text = `Run ${i + 1}/${constellations.length}: ${label} — critic (${criticName})...`;
      const criticAgent = agents[constellation.critic];
      const critique = await runCritic(
        criticAgent.provider,
        criticAgent.model,
        proposals,
        pipelineLang,
        false,
        contextText
      );

      if (options.verbose) {
        console.log(chalk.dim(`✓ Run ${i + 1} critic done (${criticName})`));
      }

      // Run per-run synthesis (lighter weight — use the critic's provider to save an Opus call)
      spinner.text = `Run ${i + 1}/${constellations.length}: ${label} — synthesis...`;
      const synthesis = await runSynthesizer(
        criticAgent.provider,
        criticAgent.model,
        proposals,
        critique,
        pipelineLang,
        false,
        contextText
      );

      if (options.verbose) {
        console.log(chalk.dim(`✓ Run ${i + 1} complete`));
      }

      runResults.push({
        runNumber: i + 1,
        constellation: label,
        proposals,
        critique,
        synthesis,
      });
    }

    // Meta-Synthesis: Use synthesizer from config
    spinner.text = `Running meta-synthesis across all runs (${synthesizer.provider.name})...`;

    const metaPromptDE = `Du bist der Meta-Synthesizer. Du hast ${numRuns} unabhängige ThoughtProof-Durchläufe mit ROTIERTEN ROLLEN gesehen. In jedem Durchlauf waren andere Modelle Generator und Critic.

Deine Aufgabe:
1. **Konvergenz:** Was sagen ALLE Durchläufe übereinstimmend? (Höchste Confidence)
2. **Divergenz:** Wo widersprechen sich die Durchläufe? Was sagt das über Modell-Bias?
3. **Critic-Bias-Analyse:** Hat der Critic-Wechsel die Ergebnisse verändert? Wie?
4. **Finale Empfehlung:** Basierend auf der Gesamtschau aller Durchläufe
5. **Meta-Confidence:** Wie sicher bist du im Gesamtergebnis? (0-100%)

DURCHLÄUFE:
${runResults.map(r => `
=== RUN ${r.runNumber}: ${r.constellation} ===
SYNTHESE:
${r.synthesis.content}
`).join('\n---\n')}`;

    const metaPromptEN = metaPromptDE; // Use German for now since config is DE

    const metaSynthesis = await synthesizer.provider.call(synthesizer.model, metaPromptDE);

    if (options.verbose) {
      console.log(chalk.dim('✓ Meta-synthesis completed'));
    }

    // Save as a special deep block
    spinner.text = 'Saving deep block...';
    const duration = (Date.now() - startTime) / 1000;

    // Collect all models used across all runs
    const allModels: string[] = [];
    runResults.forEach(r => {
      r.proposals.forEach(p => allModels.push(p.model));
      allModels.push(r.critique.model);
      allModels.push(r.synthesis.model);
    });
    allModels.push(config.models?.synthesizer || config.synthesizer?.model || 'unknown'); // meta-synth
    const mdi = calculateModelDiversityIndex(allModels);

    // Flatten all proposals and critiques for storage
    const allProposals = runResults.flatMap((r, i) =>
      r.proposals.map(p => ({
        ...p,
        role: `generator-run${i + 1}` as any,
      }))
    );

    const block: Block = {
      id: '',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      question: `[DEEP-${numRuns}x] ${question}`,
      normalized_question: question,
      proposals: allProposals,
      critique: {
        model: 'multi-critic',
        role: 'critic',
        content: runResults.map(r =>
          `=== CRITIC RUN ${r.runNumber} (${r.constellation}) ===\n${r.critique.content}`
        ).join('\n\n---\n\n'),
      },
      synthesis: {
        model: synthesizer.model.split('/').pop() || synthesizer.model,
        role: 'synthesizer',
        content: metaSynthesis.content,
      },
      metadata: {
        total_tokens: 0,
        total_cost_usd: 0,
        duration_seconds: duration,
        model_diversity_index: mdi,
      },
    };

    const blockId = storage.save(block);

    spinner.succeed(chalk.green(`Deep block ${blockId} created in ${duration.toFixed(1)}s (${numRuns} runs)`));

    // Display
    console.log(chalk.bold('\n🔬 META-SYNTHESIS (across all runs):\n'));
    console.log(metaSynthesis.content);

    console.log(chalk.dim('\n--- Run Summary ---'));
    runResults.forEach(r => {
      console.log(chalk.dim(`  Run ${r.runNumber}: ${r.constellation}`));
    });

    console.log(chalk.dim(`\n💾 Saved as ${blockId}`));
    console.log(chalk.dim(`📈 Model Diversity Index: ${mdi.toFixed(3)}`));
    console.log(chalk.dim(`🔬 ${numRuns} runs × (3 generators + 1 critic + 1 synthesis) + 1 meta-synthesis`));

  } catch (error) {
    spinner.fail('Deep pipeline failed');
    console.error(chalk.red('\nError:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
