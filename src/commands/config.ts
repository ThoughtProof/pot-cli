import chalk from 'chalk';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getConfig, DEFAULT_BASE_URLS } from '../config.js';
import type { GeneratorConfig } from '../types.js';

function maskApiKey(key?: string): string {
  if (!key) return chalk.red('❌ Not set');
  if (key.length < 8) return chalk.yellow('⚠️  Too short');
  return chalk.green(`✓ ${key.substring(0, 6)}...${key.substring(key.length - 4)}`);
}

/**
 * pot config add-provider <name> <model> <apiKey> [--base-url <url>]
 * Adds or updates a provider in ~/.potrc.json
 */
export function addProviderCommand(
  name: string,
  model: string,
  apiKey: string,
  options: { baseUrl?: string }
): void {
  const configPath = join(homedir(), '.potrc.json');
  let fileConfig: any = {};

  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      console.error(chalk.red('Failed to read ~/.potrc.json'));
      process.exit(1);
    }
  }

  // Determine baseUrl
  const nameLower = name.toLowerCase();
  const baseUrl = options.baseUrl || DEFAULT_BASE_URLS[nameLower];
  const isAnthropic = nameLower === 'anthropic' || model.toLowerCase().startsWith('claude');

  const newProvider: GeneratorConfig = {
    name,
    model,
    apiKey,
    ...(isAnthropic ? { provider: 'anthropic' as const } : { baseUrl: baseUrl || DEFAULT_BASE_URLS['openai'] }),
  };

  // Initialize generators array if needed
  if (!fileConfig.generators) fileConfig.generators = [];

  // Replace if name already exists, otherwise append
  const existingIdx = fileConfig.generators.findIndex((g: GeneratorConfig) =>
    g.name.toLowerCase() === name.toLowerCase()
  );
  if (existingIdx >= 0) {
    fileConfig.generators[existingIdx] = newProvider;
    console.log(chalk.yellow(`Updated provider: ${name}`));
  } else {
    fileConfig.generators.push(newProvider);
    console.log(chalk.green(`✅ Added provider: ${name} (${model})`));
  }

  // Auto-assign critic/synthesizer to last two providers
  const gens = fileConfig.generators;
  if (gens.length >= 2) {
    fileConfig.critic = gens[gens.length - 2];
    fileConfig.synthesizer = gens[gens.length - 1];
  } else {
    fileConfig.critic = gens[0];
    fileConfig.synthesizer = gens[0];
  }

  writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));
  console.log(chalk.dim(`Saved to ${configPath}`));
  console.log(chalk.dim(`Run ${chalk.white('pot config')} to verify.`));
}

export function configCommand(): void {
  const config = getConfig();

  console.log(chalk.bold.cyan('\n🔧 pot Configuration\n'));

  // Display new format if present
  if (config.generators && config.critic && config.synthesizer) {
    console.log(chalk.bold('Generators:'));
    config.generators.forEach((gen, i) => {
      const providerLabel = gen.provider === 'anthropic' ? '[Anthropic API]' : `[${gen.baseUrl || 'OpenAI-compatible'}]`;
      console.log(chalk.dim(`  ${i + 1}. ${gen.name}:`) + chalk.white(` ${gen.model}`));
      console.log(chalk.dim(`     Provider: ${providerLabel}`));
      console.log(chalk.dim('     API Key:  ') + maskApiKey(gen.apiKey));
    });

    console.log(chalk.bold('\nCritic:'));
    const criticLabel = config.critic.provider === 'anthropic' ? '[Anthropic API]' : `[${config.critic.baseUrl || 'OpenAI-compatible'}]`;
    console.log(chalk.dim(`  ${config.critic.name}:`) + chalk.white(` ${config.critic.model}`));
    console.log(chalk.dim(`  Provider: ${criticLabel}`));
    console.log(chalk.dim('  API Key:  ') + maskApiKey(config.critic.apiKey));

    console.log(chalk.bold('\nSynthesizer:'));
    const synthLabel = config.synthesizer.provider === 'anthropic' ? '[Anthropic API]' : `[${config.synthesizer.baseUrl || 'OpenAI-compatible'}]`;
    console.log(chalk.dim(`  ${config.synthesizer.name}:`) + chalk.white(` ${config.synthesizer.model}`));
    console.log(chalk.dim(`  Provider: ${synthLabel}`));
    console.log(chalk.dim('  API Key:  ') + maskApiKey(config.synthesizer.apiKey));
  } else {
    // Fallback: display old format (for backward compatibility)
    console.log(chalk.bold('Models:'));
    console.log(chalk.dim('  Generator 1:  ') + chalk.white(config.models?.generator1 || 'N/A'));
    console.log(chalk.dim('  Generator 2:  ') + chalk.white(config.models?.generator2 || 'N/A'));
    console.log(chalk.dim('  Generator 3:  ') + chalk.white(config.models?.generator3 || 'N/A'));
    console.log(chalk.dim('  Generator 4:  ') + chalk.white(config.models?.generator4 || 'N/A'));
    console.log(chalk.dim('  Critic:       ') + chalk.white(config.models?.critic || 'N/A'));
    console.log(chalk.dim('  Synthesizer:  ') + chalk.white(config.models?.synthesizer || 'N/A'));

    console.log(chalk.bold('\nAPI Keys:'));
    console.log(chalk.dim('  ANTHROPIC_API_KEY: ') + maskApiKey(config.apiKeys?.anthropic));
    console.log(chalk.dim('  OPENAI_API_KEY:    ') + maskApiKey(config.apiKeys?.openai));
    console.log(chalk.dim('  XAI_API_KEY:       ') + maskApiKey(config.apiKeys?.xai));
    console.log(chalk.dim('  MOONSHOT_API_KEY:  ') + maskApiKey(config.apiKeys?.moonshot));
    console.log(chalk.dim('  DEEPSEEK_API_KEY:  ') + maskApiKey(config.apiKeys?.deepseek));
  }

  console.log(chalk.bold('\nSettings:'));
  console.log(chalk.dim('  Block Storage: ') + chalk.white(config.blockStoragePath));
  console.log(chalk.dim('  Language:      ') + chalk.white(config.language));

  console.log(chalk.dim('\n💡 Configure via .potrc.json in project root or ~/.potrc.json'));
  console.log(chalk.dim('   New format: flexible generators array with custom baseUrl/apiKey'));
  console.log(chalk.dim('   Old format: models + apiKeys (automatically migrated)'));
}
