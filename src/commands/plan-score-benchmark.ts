import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import chalk from 'chalk';
import {
  alignAgentPlanToAnnotator,
  alignAgentExecToAnnotator,
  computePlanSegmentSupport,
  type AlignmentMode,
} from '../plan/alignment.js';
import { mergeSupport, deriveMergedRiskFlags } from '../plan/merged-support.js';
import {
  evaluatePlanPolicy,
  type DecisionSurface,
  type ExperimentalPolicyOptions,
  type PlanPolicyResult,
} from '../plan/policy.js';
import { canonicalizeFirstPartyGaiaTraces, parseFirstPartyGaiaTraceJsonl } from '../plan/first-party-traces.js';
import { enrichFirstPartyTraces, type FirstPartyGoldMapEntry } from '../plan/first-party-enrichment.js';
import type { FirstPartyGaiaTrace } from '../plan/first-party-adapter.js';
import type { PlanRecord } from '../plan/types.js';

export interface BenchmarkBundleItem {
  id: string;
  title?: string;
  sourceType?: 'real' | 'synthetic';
  sourceRef?: string;
  sourceArtifacts?: string[];
  candidateObjectType: 'trace' | 'decision_memo' | 'plan' | string;
  candidateObjectRef?: string;
  traceFile?: string;
  goldMapFile?: string;
  sourceClaimMapFile?: string;
  expectedVerdict: DecisionSurface;
  referenceSteps?: string[];
  criticalSteps?: string[];
  notes?: string;
}

export interface BenchmarkScoreItem {
  id: string;
  title: string;
  candidateObjectType: string;
  expectedVerdict: DecisionSurface;
  actualVerdict: DecisionSurface | null;
  status: 'exact_match' | 'conservative_miss' | 'dangerous_miss' | 'manual_gap';
  reason: string;
  traceId?: string;
  metrics?: PlanPolicyResult['metrics'];
}

export interface BenchmarkScoreSummary {
  total: number;
  scored: number;
  manualGap: number;
  exactMatch: number;
  conservativeMiss: number;
  dangerousMiss: number;
  exactMatchRateOnScored: number;
}

export interface BenchmarkScoreReport {
  bundlePath: string;
  minimumScore: number;
  mode: AlignmentMode;
  summary: BenchmarkScoreSummary;
  items: BenchmarkScoreItem[];
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

function compareVerdicts(expected: DecisionSurface, actual: DecisionSurface): BenchmarkScoreItem['status'] {
  if (expected === actual) return 'exact_match';

  const rank: Record<DecisionSurface, number> = {
    BLOCK: 0,
    HOLD: 1,
    CONDITIONAL_ALLOW: 2,
    ALLOW: 3,
  };

  return rank[actual] < rank[expected] ? 'conservative_miss' : 'dangerous_miss';
}

function loadExperimentalSourceClaimMap(
  path?: string,
): Record<string, NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>> {
  if (!path) {
    return {};
  }

  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, {
    support?: string;
    confidence?: string;
    exactStringQuestion?: boolean;
  }>;

  return Object.fromEntries(
    Object.entries(raw).flatMap(([traceId, value]) => {
      if (!value?.support || !value?.confidence) {
        return [];
      }
      return [[traceId, {
        support: value.support as NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>['support'],
        confidence: value.confidence as NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>['confidence'],
        exactStringQuestion: value.exactStringQuestion ?? false,
      }]];
    }),
  );
}

function scoreTraceRecord(
  record: PlanRecord,
  expectedVerdict: DecisionSurface,
  minimumScore: number,
  mode: AlignmentMode,
  experimentalSourceClaim?: NonNullable<ExperimentalPolicyOptions['experimentalSourceClaim']>,
): BenchmarkScoreItem {
  const alignment = alignAgentPlanToAnnotator(record, { minimumScore, mode });
  const execAlignment = alignAgentExecToAnnotator(record, { minimumScore, mode });
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore, mode, maxSpanLength: 4 });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags, {
    experimentalSourceClaim,
  });

  return {
    id: record.traceId,
    title: record.goal.description,
    candidateObjectType: 'trace',
    expectedVerdict,
    actualVerdict: result.verdict,
    status: compareVerdicts(expectedVerdict, result.verdict),
    reason: result.summary,
    traceId: record.traceId,
    metrics: result.metrics,
  };
}

function findArtifact(item: BenchmarkBundleItem, predicate: (value: string) => boolean): string | undefined {
  return [item.candidateObjectRef, ...(item.sourceArtifacts ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .find(predicate);
}

function resolveWorkspaceArtifact(bundleDir: string, artifactPath: string): string {
  if (isAbsolute(artifactPath)) {
    return artifactPath;
  }

  const candidates = [
    resolve(bundleDir, artifactPath),
    resolve(bundleDir, '..', artifactPath),
    resolve(bundleDir, '..', '..', artifactPath),
    resolve(bundleDir, '..', '..', '..', artifactPath),
    resolve('/Users/rauljager/.openclaw/workspace', artifactPath),
  ];

  const match = candidates.find((candidate) => existsSync(candidate));
  return match ?? candidates[candidates.length - 1]!;
}

function scoreTraceBundleItem(
  bundleDir: string,
  item: BenchmarkBundleItem,
  minimumScore: number,
  mode: AlignmentMode,
): BenchmarkScoreItem {
  const tracesPath = item.traceFile ?? findArtifact(item, (value) => value.endsWith('traces.jsonl'));
  const goldPath = item.goldMapFile ?? findArtifact(item, (value) => value.endsWith('gold.json'));
  const sourceClaimPath = item.sourceClaimMapFile ?? findArtifact(item, (value) => value.endsWith('source-claim.json'));

  if (!tracesPath || !goldPath) {
    return {
      id: item.id,
      title: item.title ?? item.id,
      candidateObjectType: item.candidateObjectType,
      expectedVerdict: item.expectedVerdict,
      actualVerdict: null,
      status: 'manual_gap',
      reason: 'Trace item does not expose a deterministic traces.jsonl + gold.json path pair.',
    };
  }

  const resolvedTracesPath = resolveWorkspaceArtifact(bundleDir, tracesPath);
  const resolvedGoldPath = resolveWorkspaceArtifact(bundleDir, goldPath);
  const resolvedSourceClaimPath = sourceClaimPath ? resolveWorkspaceArtifact(bundleDir, sourceClaimPath) : undefined;

  const traces = loadJsonl<FirstPartyGaiaTrace>(resolvedTracesPath);
  const goldMap = loadJson<Record<string, FirstPartyGoldMapEntry>>(resolvedGoldPath);
  const enriched = enrichFirstPartyTraces(traces, goldMap);
  const records = canonicalizeFirstPartyGaiaTraces(enriched);
  const record = records.find((candidate) => candidate.traceId === item.candidateObjectRef || candidate.traceId === item.sourceRef);

  if (!record) {
    return {
      id: item.id,
      title: item.title ?? item.id,
      candidateObjectType: item.candidateObjectType,
      expectedVerdict: item.expectedVerdict,
      actualVerdict: null,
      status: 'manual_gap',
      reason: `Could not resolve trace ${item.candidateObjectRef ?? item.sourceRef ?? '[unknown]'} in ${tracesPath}.`,
    };
  }

  const sourceClaimMap = loadExperimentalSourceClaimMap(resolvedSourceClaimPath);
  const scored = scoreTraceRecord(record, item.expectedVerdict, minimumScore, mode, sourceClaimMap[record.traceId]);
  return {
    ...scored,
    id: item.id,
    title: item.title ?? scored.title,
  };
}

function summarize(items: BenchmarkScoreItem[]): BenchmarkScoreSummary {
  const scored = items.filter((item) => item.status !== 'manual_gap');
  const exactMatch = scored.filter((item) => item.status === 'exact_match').length;
  const conservativeMiss = scored.filter((item) => item.status === 'conservative_miss').length;
  const dangerousMiss = scored.filter((item) => item.status === 'dangerous_miss').length;
  const manualGap = items.filter((item) => item.status === 'manual_gap').length;

  return {
    total: items.length,
    scored: scored.length,
    manualGap,
    exactMatch,
    conservativeMiss,
    dangerousMiss,
    exactMatchRateOnScored: scored.length === 0 ? 0 : exactMatch / scored.length,
  };
}

function formatTextReport(report: BenchmarkScoreReport): string {
  const lines = [
    `bundlePath: ${report.bundlePath}`,
    `mode: ${report.mode}`,
    `minimumScore: ${report.minimumScore}`,
    `total: ${report.summary.total}`,
    `scored: ${report.summary.scored}`,
    `manualGap: ${report.summary.manualGap}`,
    `exactMatch: ${report.summary.exactMatch}`,
    `conservativeMiss: ${report.summary.conservativeMiss}`,
    `dangerousMiss: ${report.summary.dangerousMiss}`,
    `exactMatchRateOnScored: ${report.summary.exactMatchRateOnScored.toFixed(3)}`,
    '',
    'items:',
  ];

  for (const item of report.items) {
    lines.push(`- ${item.id} [${item.candidateObjectType}] expected=${item.expectedVerdict} actual=${item.actualVerdict ?? 'n/a'} status=${item.status}`);
    lines.push(`  reason: ${item.reason}`);
  }

  return lines.join('\n');
}

export async function planScoreBenchmarkCommand(
  inputFile: string,
  options: {
    json?: boolean;
    out?: string;
    minimumScore?: string;
    mode?: AlignmentMode;
  } = {},
): Promise<void> {
  const minimumScore = Number(options.minimumScore ?? '0.25');
  const mode = (options.mode ?? 'semantic') as AlignmentMode;
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error(`minimumScore must be a number between 0 and 1, got: ${options.minimumScore}`);
  }
  if (mode !== 'lexical' && mode !== 'semantic') {
    throw new Error(`mode must be one of: lexical, semantic. Got: ${options.mode}`);
  }

  const resolvedInputFile = resolve(inputFile);
  const bundleDir = resolve(resolvedInputFile, '..');
  const bundle = loadJsonl<BenchmarkBundleItem>(resolvedInputFile);

  const items = bundle.map((item) => {
    if (item.candidateObjectType !== 'trace') {
      return {
        id: item.id,
        title: item.title ?? item.id,
        candidateObjectType: item.candidateObjectType,
        expectedVerdict: item.expectedVerdict,
        actualVerdict: null,
        status: 'manual_gap' as const,
        reason: `No deterministic scorer is implemented yet for candidateObjectType=${item.candidateObjectType}.`,
      };
    }

    return scoreTraceBundleItem(bundleDir, item, minimumScore, mode);
  });

  const report: BenchmarkScoreReport = {
    bundlePath: resolvedInputFile,
    minimumScore,
    mode,
    summary: summarize(items),
    items,
  };

  const output = options.json
    ? JSON.stringify(report, null, 2)
    : formatTextReport(report);

  if (options.out) {
    writeFileSync(options.out, output);
    console.log(chalk.green(`Wrote plan benchmark score report to ${options.out}`));
    return;
  }

  console.log(output);
}
