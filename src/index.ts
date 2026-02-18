#!/usr/bin/env node

import { Command } from 'commander';
import { askCommand } from './commands/ask.js';
import { deepCommand } from './commands/deep.js';
import { debugCommand } from './commands/debug.js';
import { reviewCommand } from './commands/review.js';
import { auditCommand } from './commands/audit.js';
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
  .option('--context <refs>', 'Reference previous blocks (e.g., "5,8,9" or "last" or "all")')
  .action(async (question: string, options) => {
    await askCommand(question, options);
  });

program
  .command('deep <question>')
  .description('Deep analysis: multiple runs with rotated roles + meta-synthesis')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--runs <number>', 'Number of rotation runs (2-5)', '3')
  .action(async (question: string, options) => {
    await deepCommand(question, options);
  });

program
  .command('debug <file>')
  .description('Debug a code file with 3 LLMs + static analysis')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--error <message>', 'Error message or description of the bug')
  .action(async (file: string, options) => {
    await debugCommand(file, options);
  });

program
  .command('review <file>')
  .description('Code review for architecture, security, performance, best practices')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--focus <area>', 'Focus area (e.g., "security", "performance", "react patterns")')
  .action(async (file: string, options) => {
    await reviewCommand(file, options);
  });

program
  .command('audit <target>')
  .description('Compliance audit against a framework (file or directory)')
  .option('--verbose', 'Show detailed progress')
  .option('--lang <language>', 'Language (de|en)', 'de')
  .option('--framework <fw>', 'Framework: gba, dsgvo, iso9001, hipaa, soc2, eu-ai-act', 'gba')
  .action(async (target: string, options) => {
    await auditCommand(target, options);
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
