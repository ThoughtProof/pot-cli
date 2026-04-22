import { readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { type AlignmentMode, alignAgentExecToAnnotator, alignAgentPlanToAnnotator, computePlanSegmentSupport } from '../plan/alignment.js';
import { firstPartyTraceToPlanRecord, type FirstPartyGaiaTrace } from '../plan/first-party-adapter.js';
import { enrichFirstPartyTraces, type FirstPartyGoldMapEntry } from '../plan/first-party-enrichment.js';
import { mergeSupport, deriveMergedRiskFlags } from '../plan/merged-support.js';
import { buildPlanPolicyBatchExport, evaluatePlanPolicy, type ExperimentalPolicyOptions } from '../plan/policy.js';
import { buildFirstPartySourceClaimMap } from '../plan/source-claim-map.js';
import { enrichFirstPartyTracesWithSourcePageMetadata, type SourcePageFetcher } from '../plan/source-page-enrichment.js';
import { parseAlignmentMode } from './plan-input.js';

interface SweepProfileConfig {
  goldMap: string;
  sourceClaimMap?: string;
  deriveSourceClaim?: boolean;
  enrichSourcePages?: boolean;
}

function formatVerdictCounts(verdictCounts: Record<string, number>): string {
  return Object.entries(verdictCounts)
    .map(([verdict, count]) => `${verdict}=${count}`)
    .join(', ');
}

function formatTransitionCounts(transitions: Record<string, number> | null): string[] {
  if (!transitions || Object.keys(transitions).length === 0) return [];
  return Object.entries(transitions).map(([transition, count]) => `    - ${transition}: ${count}`);
}

function formatSweepTextReport(payload: {
  traceCount: number;
  minimumScore: number;
  mode: string;
  summary: Record<string, {
    baselineVerdictCounts: Record<string, number>;
    withSourceClaimVerdictCounts: Record<string, number> | null;
    verdictTransitions: Record<string, number> | null;
    sourceClaimSupportCounts: Record<string, number> | null;
    sourceClaimConfidenceCounts: Record<string, number> | null;
  }>;
}): string {
  const lines = [
    `Plan Sweep Report`,
    `Traces: ${payload.traceCount}`,
    `Mode: ${payload.mode}`,
    `Minimum score: ${payload.minimumScore}`,
    '',
  ];

  for (const [profileName, summary] of Object.entries(payload.summary)) {
    lines.push(`${profileName}`);
    lines.push(`  baseline: ${formatVerdictCounts(summary.baselineVerdictCounts)}`);
    if (summary.withSourceClaimVerdictCounts) {
      lines.push(`  withSourceClaim: ${formatVerdictCounts(summary.withSourceClaimVerdictCounts)}`);
    }
    const transitionLines = formatTransitionCounts(summary.verdictTransitions);
    if (transitionLines.length > 0) {
      lines.push('  transitions:');
      lines.push(...transitionLines);
    }
    if (summary.sourceClaimSupportCounts) {
      lines.push(`  sourceClaimSupport: ${formatVerdictCounts(summary.sourceClaimSupportCounts)}`);
    }
    if (summary.sourceClaimConfidenceCounts) {
      lines.push(`  sourceClaimConfidence: ${formatVerdictCounts(summary.sourceClaimConfidenceCounts)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

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

function normalizeSweepProfiles(
  rawProfiles: Record<string, string | SweepProfileConfig>,
): Record<string, SweepProfileConfig> {
  return Object.fromEntries(
    Object.entries(rawProfiles).map(([profileName, value]) => {
      if (typeof value === 'string') {
        return [profileName, { goldMap: value }];
      }
      if (!value?.goldMap) {
        throw new Error(`profile ${profileName} is missing goldMap`);
      }
      return [profileName, value];
    }),
  );
}

function loadExperimentalSourceClaimMap(
  path?: string,
): Record<string, NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>> {
  if (!path) return {};
  const raw = loadJson<Record<string, { support?: string; confidence?: string; exactStringQuestion?: boolean }>>(path);
  return Object.fromEntries(
    Object.entries(raw).flatMap(([traceId, value]) => {
      if (!value?.support || !value?.confidence) return [];
      return [[traceId, {
        support: value.support as NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>['support'],
        confidence: value.confidence as NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>['confidence'],
        exactStringQuestion: value.exactStringQuestion ?? false,
      }]];
    }),
  );
}

function buildVerdictTransitions(
  baseline: ReturnType<typeof buildPlanPolicyBatchExport>,
  withSourceClaim: ReturnType<typeof buildPlanPolicyBatchExport> | null,
): Record<string, number> | null {
  if (!withSourceClaim) return null;

  const baselineByTraceId = new Map(baseline.results.map((result) => [result.traceId, result.verdict]));
  const transitions: Record<string, number> = {};

  for (const result of withSourceClaim.results) {
    const before = baselineByTraceId.get(result.traceId);
    if (!before) continue;
    const key = `${before}->${result.verdict}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
  }

  return transitions;
}

function countMetricValues(
  results: ReturnType<typeof buildPlanPolicyBatchExport>['results'],
  metric: 'sourceClaimSupport' | 'sourceClaimConfidence',
): Record<string, number> | null {
  const counts: Record<string, number> = {};

  for (const result of results) {
    const value = result.metrics[metric];
    if (value == null) continue;
    const key = String(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return Object.keys(counts).length > 0 ? counts : null;
}

function evaluateRecords(
  records: ReturnType<typeof firstPartyTraceToPlanRecord>[],
  minimumScore: number,
  mode: AlignmentMode,
  experimentalSourceClaimMap: Record<string, NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>>,
) {
  const evaluationInputs = records.map((record) => {
    const alignment = alignAgentPlanToAnnotator(record, { minimumScore, mode });
    const execAlignment = alignAgentExecToAnnotator(record, { minimumScore, mode });
    const segmentSupport = computePlanSegmentSupport(record, { minimumScore, mode, maxSpanLength: 4 });
    const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
    const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
    return { record, merged, mergedRiskFlags };
  });

  const baseline = evaluationInputs.map(({ record, merged, mergedRiskFlags }) =>
    evaluatePlanPolicy(record, merged, mergedRiskFlags),
  );

  const withSourceClaim = Object.keys(experimentalSourceClaimMap).length > 0
    ? evaluationInputs.map(({ record, merged, mergedRiskFlags }) =>
        evaluatePlanPolicy(record, merged, mergedRiskFlags, {
          experimentalSourceClaim: experimentalSourceClaimMap[record.traceId],
        }),
      )
    : null;

  const baselineExport = buildPlanPolicyBatchExport(baseline);
  const withSourceClaimExport = withSourceClaim ? buildPlanPolicyBatchExport(withSourceClaim) : null;

  return {
    baseline: baselineExport,
    withSourceClaim: withSourceClaimExport,
    summary: {
      baselineVerdictCounts: baselineExport.verdictCounts,
      withSourceClaimVerdictCounts: withSourceClaimExport?.verdictCounts ?? null,
      verdictTransitions: buildVerdictTransitions(baselineExport, withSourceClaimExport),
      sourceClaimSupportCounts: withSourceClaimExport ? countMetricValues(withSourceClaimExport.results, 'sourceClaimSupport') : null,
      sourceClaimConfidenceCounts: withSourceClaimExport ? countMetricValues(withSourceClaimExport.results, 'sourceClaimConfidence') : null,
    },
  };
}

export async function planSweepFirstPartyCommand(
  inputFile: string,
  options: {
    profiles: string;
    out?: string;
    minimumScore?: string;
    mode?: AlignmentMode;
    sourceClaimMap?: string;
    format?: 'json' | 'text';
    enrichSourcePages?: boolean;
    sourcePageFetcher?: SourcePageFetcher;
  },
): Promise<void> {
  if (!options.profiles) {
    throw new Error('profiles is required');
  }

  const minimumScore = Number(options.minimumScore ?? '0.25');
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error(`minimumScore must be a number between 0 and 1, received: ${options.minimumScore}`);
  }
  const mode = parseAlignmentMode(options.mode, 'semantic');
  const traces = loadJsonl<FirstPartyGaiaTrace>(inputFile);
  const profiles = normalizeSweepProfiles(loadJson<Record<string, string | SweepProfileConfig>>(options.profiles));
  const globalSourceClaimMap = loadExperimentalSourceClaimMap(options.sourceClaimMap);

  const profileEntries = await Promise.all(
    Object.entries(profiles).map(async ([profileName, profileConfig]) => {
      const goldMap = loadJson<Record<string, FirstPartyGoldMapEntry>>(profileConfig.goldMap);
      const enriched = enrichFirstPartyTraces(traces, goldMap);
      const effectiveTraces = (profileConfig.enrichSourcePages ?? options.enrichSourcePages)
        ? await enrichFirstPartyTracesWithSourcePageMetadata(enriched, options.sourcePageFetcher)
        : enriched;
      const records = effectiveTraces.map((trace) => firstPartyTraceToPlanRecord(trace));
      const profileSourceClaimMap = profileConfig.sourceClaimMap
        ? loadExperimentalSourceClaimMap(profileConfig.sourceClaimMap)
        : profileConfig.deriveSourceClaim
          ? buildFirstPartySourceClaimMap(effectiveTraces)
          : globalSourceClaimMap;
      return [profileName, evaluateRecords(records, minimumScore, mode, profileSourceClaimMap)] as const;
    }),
  );

  const profileResults = Object.fromEntries(profileEntries);

  const payload = {
    sourceFormat: 'first-party-jsonl',
    traceCount: traces.length,
    minimumScore,
    mode,
    profiles: profileResults,
    summary: Object.fromEntries(
      Object.entries(profileResults).map(([profileName, result]) => [profileName, result.summary]),
    ),
  };

  const format = options.format ?? 'json';
  if (format !== 'json' && format !== 'text') {
    throw new Error(`format must be json or text, received: ${format}`);
  }

  const output = format === 'text'
    ? formatSweepTextReport(payload)
    : JSON.stringify(payload, null, 2);

  if (options.out) {
    writeFileSync(options.out, output);
    console.log(chalk.green(`Wrote first-party profile sweep to ${options.out}`));
    return;
  }

  process.stdout.write(output);
}
