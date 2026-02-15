import chalk from 'chalk';
import { getConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';

export function listCommand(): void {
  const config = getConfig();
  const storage = new BlockStorage(config.blockStoragePath);
  const blocks = storage.list();

  if (blocks.length === 0) {
    console.log(chalk.yellow('No blocks found.'));
    console.log(chalk.dim('Create your first block with: pot ask "Your question"'));
    return;
  }

  console.log(chalk.bold(`\n📚 ${blocks.length} Block${blocks.length > 1 ? 's' : ''} found:\n`));

  blocks.forEach(block => {
    const date = new Date(block.timestamp).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    
    const question = block.question.length > 60 
      ? block.question.substring(0, 57) + '...'
      : block.question;

    const mdi = block.metadata.model_diversity_index;
    const mdiColor = mdi > 0.6 ? chalk.green : mdi > 0.4 ? chalk.yellow : chalk.red;

    console.log(
      chalk.cyan(block.id) + 
      chalk.dim(` │ ${date} │ `) +
      chalk.white(question) +
      chalk.dim(' │ MDI: ') +
      mdiColor(mdi.toFixed(2))
    );
  });

  console.log(chalk.dim(`\nUse ${chalk.white('pot show <number>')} to view details`));
}
