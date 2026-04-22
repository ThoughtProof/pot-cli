import { readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { type FirstPartyGaiaTrace } from '../plan/first-party-adapter.js';
import { enrichFirstPartyTraces, type FirstPartyGoldMapEntry } from '../plan/first-party-enrichment.js';
import { buildFirstPartySourceClaimMap } from '../plan/source-claim-map.js';
import { enrichFirstPartyTracesWithSourcePageMetadata, type SourcePageFetcher } from '../plan/source-page-enrichment.js';

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function loadJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function planBuildSourceClaimMapCommand(
  inputFile: string,
  options: {
    out?: string;
    goldMap?: string;
    enrichSourcePages?: boolean;
    sourcePageFetcher?: SourcePageFetcher;
  },
): Promise<void> {
  const traces = loadJsonl<FirstPartyGaiaTrace>(inputFile);
  const enrichedTraces = options.goldMap
    ? enrichFirstPartyTraces(traces, loadJson<Record<string, FirstPartyGoldMapEntry>>(options.goldMap))
    : traces;
  const effectiveTraces = options.enrichSourcePages
    ? await enrichFirstPartyTracesWithSourcePageMetadata(enrichedTraces, options.sourcePageFetcher)
    : enrichedTraces;

  const payload = buildFirstPartySourceClaimMap(effectiveTraces);

  const output = JSON.stringify(payload, null, 2);
  if (options.out) {
    writeFileSync(options.out, output);
    console.log(chalk.green(`Wrote source-claim map to ${options.out}`));
    return;
  }

  process.stdout.write(`${output}\n`);
}
