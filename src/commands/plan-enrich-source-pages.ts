import { readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import type { FirstPartyGaiaTrace } from '../plan/first-party-adapter.js';
import { enrichFirstPartyTracesWithSourcePageMetadata } from '../plan/source-page-enrichment.js';

function loadJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function planEnrichSourcePagesCommand(
  inputFile: string,
  options: {
    out: string;
    title?: boolean;
    h1?: boolean;
  },
): Promise<void> {
  const traces = loadJsonl<FirstPartyGaiaTrace>(inputFile);
  const enriched = await enrichFirstPartyTracesWithSourcePageMetadata(traces, undefined, {
    includeTitle: options.title ?? true,
    includeH1: options.h1 ?? true,
  });

  const output = enriched.map((trace) => JSON.stringify(trace)).join('\n');
  writeFileSync(options.out, `${output}\n`);
  console.log(chalk.green(`Wrote source-page-enriched traces to ${options.out}`));
}
