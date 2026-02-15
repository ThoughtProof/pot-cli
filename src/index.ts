#!/usr/bin/env node

import { Command } from 'commander';
import { askCommand } from './commands/ask.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
  .name('pot')
  .description('ThoughtProof Proof-of-Thought CLI Tool')
  .version('0.1.0');

program
  .command('ask <question>')
  .description('Run the PoT pipeline on a question')
  .option('--dry-run', 'Run without calling APIs (fake responses)')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .action(async (question: string, options) => {
    await askCommand(question, options);
  });

program
  .command('list')
  .description('List all blocks')
  .action(() => {
    listCommand();
  });

program
  .command('show <number>')
  .description('Show a specific block')
  .action((number: string) => {
    showCommand(number);
  });

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    configCommand();
  });

program.parse();
