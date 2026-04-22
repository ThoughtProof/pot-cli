import { readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import {
  alignAgentPlanToAnnotator,
  alignAgentExecToAnnotator,
  computePlanSegmentSupport,
  type AlignmentMode,
} from '../plan/alignment.js';
import { mergeSupport, deriveMergedRiskFlags } from '../plan/merged-support.js';
import {
  buildPlanPolicyBatchExport,
  evaluatePlanPolicy,
  formatPlanPolicyBatchReport,
  type ExperimentalPolicyOptions,
} from '../plan/policy.js';
import { loadPlanRecordsInput, parseAlignmentMode } from './plan-input.js';

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

export async function planPolicyCommand(
  inputFile: string,
  options: {
    json?: boolean;
    out?: string;
    minimumScore?: string;
    mode?: AlignmentMode;
    experimentalSourceClaimMap?: string;
  } = {},
): Promise<void> {
  const minimumScore = Number(options.minimumScore ?? '0.25');
  const mode = parseAlignmentMode(options.mode, 'semantic');
  const experimentalSourceClaimMap = loadExperimentalSourceClaimMap(options.experimentalSourceClaimMap);

  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error(`minimumScore must be a number between 0 and 1, got: ${options.minimumScore}`);
  }

  const { records, sourceFormat } = loadPlanRecordsInput(inputFile);

  const results = records.map((record) => {
    const alignment = alignAgentPlanToAnnotator(record, { minimumScore, mode });
    const execAlignment = alignAgentExecToAnnotator(record, { minimumScore, mode });
    const segmentSupport = computePlanSegmentSupport(record, { minimumScore, mode, maxSpanLength: 4 });
    const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
    const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
    return evaluatePlanPolicy(record, merged, mergedRiskFlags, {
      experimentalSourceClaim: experimentalSourceClaimMap[record.traceId],
    });
  });

  const payload = {
    sourceFormat,
    ...buildPlanPolicyBatchExport(results),
  };

  const output = options.json
    ? JSON.stringify(payload, null, 2)
    : [`sourceFormat: ${sourceFormat}`, formatPlanPolicyBatchReport(results)].join('\n');

  if (options.out) {
    writeFileSync(options.out, output);
    console.log(chalk.green(`Wrote plan policy report to ${options.out}`));
    return;
  }

  console.log(output);
}
