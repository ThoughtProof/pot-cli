import chalk from 'chalk';
import { getConfig } from '../config.js';
import { BlockStorage } from '../storage/blocks.js';

export function showCommand(blockNumber: string): void {
  const config = getConfig();
  const storage = new BlockStorage(config.blockStoragePath);
  
  const num = parseInt(blockNumber, 10);
  if (isNaN(num)) {
    console.error(chalk.red('Invalid block number'));
    process.exit(1);
  }

  const block = storage.getByNumber(num);
  
  if (!block) {
    console.error(chalk.red(`Block PoT-${num.toString().padStart(3, '0')} not found`));
    process.exit(1);
  }

  const date = new Date(block.timestamp).toLocaleString('de-DE');

  console.log(chalk.bold.cyan(`\n${block.id}`));
  console.log(chalk.dim('='.repeat(60)));
  console.log(chalk.dim(`Created: ${date}`));
  console.log(chalk.dim(`Version: ${block.version}`));
  console.log(chalk.dim(`Duration: ${block.metadata.duration_seconds.toFixed(1)}s`));
  console.log(chalk.dim(`MDI: ${block.metadata.model_diversity_index.toFixed(3)}`));
  
  if (block.context_refs && block.context_refs.length > 0) {
    console.log(chalk.dim(`References: ${block.context_refs.join(', ')}`));
  }
  
  console.log(chalk.bold('\n❓ QUESTION:'));
  console.log(block.question);

  console.log(chalk.bold('\n💡 PROPOSALS:'));
  block.proposals.forEach((proposal, i) => {
    console.log(chalk.yellow(`\n[${i + 1}] ${proposal.model}:`));
    console.log(proposal.content);
  });

  console.log(chalk.bold('\n🔴 CRITIQUE:'));
  console.log(chalk.red(`[${block.critique.model}]`));
  console.log(block.critique.content);

  console.log(chalk.bold('\n📊 SYNTHESIS:'));
  console.log(chalk.green(`[${block.synthesis.model}]`));
  console.log(block.synthesis.content);

  console.log(chalk.dim('\n' + '='.repeat(60)));
}
