import { readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { enrichFirstPartyTraces, type FirstPartyGoldMapEntry } from '../plan/first-party-enrichment.js';

export async function planEnrichFirstPartyCommand(
  inputFile: string,
  options: {
    goldMap: string;
    out: string;
  },
): Promise<void> {
  if (!options.goldMap) {
    throw new Error('goldMap is required');
  }
  if (!options.out) {
    throw new Error('out is required');
  }

  const goldMap = JSON.parse(readFileSync(options.goldMap, 'utf8')) as Record<string, FirstPartyGoldMapEntry>;
  const traces = readFileSync(inputFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Parameters<typeof enrichFirstPartyTraces>[0][number]);

  const enriched = enrichFirstPartyTraces(traces, goldMap);

  writeFileSync(options.out, enriched.map((item) => JSON.stringify(item)).join('\n') + '\n');
  console.log(chalk.green(`Wrote enriched first-party traces to ${options.out}`));
}
