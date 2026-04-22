import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import {
  benchmarkAlignmentModesForRecords,
  formatAlignmentBenchmarkReport,
} from '../plan/benchmark.js';
import { loadPlanRecordsInput } from './plan-input.js';

export async function planBenchmarkCommand(
  inputFile: string,
  options: {
    json?: boolean;
    out?: string;
    minimumScore?: string;
    planRecordsOut?: string;
  } = {},
): Promise<void> {
  const minimumScore = Number(options.minimumScore ?? '0.25');
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error(`minimumScore must be a number between 0 and 1, got: ${options.minimumScore}`);
  }

  const { records, sourceFormat } = loadPlanRecordsInput(inputFile);
  const result = benchmarkAlignmentModesForRecords(records, { minimumScore });

  if (options.planRecordsOut) {
    writeFileSync(options.planRecordsOut, JSON.stringify(records, null, 2));
    console.log(chalk.green(`Wrote canonicalized plan records to ${options.planRecordsOut}`));
  }

  const payload = {
    sourceFormat,
    ...result,
  };

  const output = options.json
    ? JSON.stringify(payload, null, 2)
    : [`sourceFormat: ${sourceFormat}`, formatAlignmentBenchmarkReport(result)].join('\n');

  if (options.out) {
    writeFileSync(options.out, output);
    console.log(chalk.green(`Wrote plan benchmark report to ${options.out}`));
    return;
  }

  console.log(output);
}
