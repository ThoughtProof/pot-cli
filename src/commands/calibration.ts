/**
 * pot-cli calibration — show judge calibration stats
 * Usage:
 *   pot-cli calibration           # full table
 *   pot-cli calibration --model grok-4-fast
 *   pot-cli calibration --role critic
 *   pot-cli calibration --domain medical
 */

import chalk from 'chalk';
import { CalibrationStorage } from '../storage/calibration.js';

export async function calibrationCommand(options: {
  model?: string;
  role?: string;
  domain?: string;
}): Promise<void> {
  const cal = new CalibrationStorage();
  const rows = cal.getSummaryTable();
  cal.close();

  // Apply filters
  let filtered = rows;
  if (options.model)  filtered = filtered.filter(r => r.model.includes(options.model!));
  if (options.role)   filtered = filtered.filter(r => r.role === options.role);
  if (options.domain) filtered = filtered.filter(r => r.domain === options.domain);

  if (filtered.length === 0) {
    console.log(chalk.yellow('No calibration data yet. Run some `pot-cli ask` commands first.'));
    return;
  }

  console.log(chalk.bold('\n🎯 Judge Calibration Stats\n'));
  console.log(chalk.dim('Model / Role / Domain → avg score + bias estimate\n'));

  // Column widths
  const modelW  = Math.max(5, ...filtered.map(r => r.model.length));
  const roleW   = Math.max(4, ...filtered.map(r => r.role.length));
  const domainW = Math.max(6, ...filtered.map(r => r.domain.length));

  const header = [
    'MODEL'.padEnd(modelW),
    'ROLE'.padEnd(roleW),
    'DOMAIN'.padEnd(domainW),
    'RUNS'.padStart(4),
    'AVG SCORE'.padStart(10),
    'BIAS',
  ].join('  ');

  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(header.length)));

  for (const r of filtered) {
    const biasColor = r.bias.includes('lenient') ? chalk.green : r.bias.includes('strict') ? chalk.red : chalk.gray;
    console.log([
      r.model.padEnd(modelW),
      r.role.padEnd(roleW),
      r.domain.padEnd(domainW),
      r.runs.toString().padStart(4),
      r.avgScore.padStart(10),
      biasColor(r.bias),
    ].join('  '));
  }

  console.log(chalk.dim(`\nTotal rows: ${filtered.length}`));
  console.log(chalk.dim('Bias = lenient if avg > global+5%, strict if avg < global-5%'));
  console.log(chalk.dim('DB: ~/.pot/calibration.db (override: POT_CALIBRATION_DB)\n'));
}
