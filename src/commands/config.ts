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

  console.log(chalk.bold('Models:'));
  console.log(chalk.dim('  Generator 1:  ') + chalk.white(config.models.generator1));
  console.log(chalk.dim('  Generator 2:  ') + chalk.white(config.models.generator2));
  console.log(chalk.dim('  Generator 3:  ') + chalk.white(config.models.generator3));
  console.log(chalk.dim('  Critic:       ') + chalk.white(config.models.critic));
  console.log(chalk.dim('  Synthesizer:  ') + chalk.white(config.models.synthesizer));

  console.log(chalk.bold('\nAPI Keys:'));
  console.log(chalk.dim('  ANTHROPIC_API_KEY: ') + maskApiKey(config.apiKeys.anthropic));
  console.log(chalk.dim('  OPENAI_API_KEY:    ') + maskApiKey(config.apiKeys.openai));
  console.log(chalk.dim('  XAI_API_KEY:       ') + maskApiKey(config.apiKeys.xai));
  console.log(chalk.dim('  MOONSHOT_API_KEY:  ') + maskApiKey(config.apiKeys.moonshot));

  console.log(chalk.bold('\nSettings:'));
  console.log(chalk.dim('  Block Storage: ') + chalk.white(config.blockStoragePath));
  console.log(chalk.dim('  Language:      ') + chalk.white(config.language));

  console.log(chalk.dim('\n💡 Configure via environment variables or ~/.potrc.json'));
}
