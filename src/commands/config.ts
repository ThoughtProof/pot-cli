import chalk from 'chalk';
import { getConfig } from '../config.js';

function maskApiKey(key?: string): string {
  if (!key) return chalk.red('❌ Not set');
  if (key.length < 8) return chalk.yellow('⚠️  Too short');
  return chalk.green(`✓ ${key.substring(0, 6)}...${key.substring(key.length - 4)}`);
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
