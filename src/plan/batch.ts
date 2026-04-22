import type { GaiaTrace } from './gaia-trace-types.js';
import type { PlanRecord, RiskFlagType } from './types.js';
import { canonicalizeGaiaTrace } from './canonicalizer.js';
import {
  alignAgentPlanToAnnotator,
  alignAgentExecToAnnotator,
  computePlanSegmentSupport,
  deriveAlignmentRiskFlags,
  type PlanAlignmentResult,
  type ExecAlignmentResult,
  type PlanSegmentSupportResult,
} from './alignment.js';
import {
  mergeSupport,
  deriveMergedRiskFlags,
  type MergedSupportResult,
} from './merged-support.js';
import {
  evaluatePlanPolicy,
  type DecisionSurface,
  type PlanPolicyResult,
} from './policy.js';

export interface BatchItem {
  record: PlanRecord;
  /** Plan-step alignment (agent:plan steps ↔ annotator steps). */
  alignment: PlanAlignmentResult;
  alignmentRiskFlags: ReturnType<typeof deriveAlignmentRiskFlags>;
  /** Execution-step alignment (agent:exec steps ↔ annotator steps). */
  execAlignment: ExecAlignmentResult;
  /** Experimental segment-aware support for compressed agent-plan steps. */
  segmentSupport: PlanSegmentSupportResult;
  /** Per-annotator-step merged coverage from plan + execution. */
  mergedSupport: MergedSupportResult;
  /** Risk flags derived from merged support (plan_gap, truly missing_step). */
  mergedRiskFlags: ReturnType<typeof deriveMergedRiskFlags>;
  /** Deterministic plan-level policy verdict built from merged support + risk flags. */
  policyEvaluation: PlanPolicyResult;
}

export interface BatchSummary {
  count: number;
  /** Counts traces where record.metadata.verified === true. */
  verifiedCount: number;
  averageCoverage: number;
  averageSegmentCoverage: number;
  segmentCoverageDeltaVsPlan: number;
  coverageMin: number;
  coverageMax: number;
  /** Number of traces where plan coverage is below LOW_COVERAGE_THRESHOLD (0.5). */
  lowCoverageCount: number;
  /** Total uncovered annotator step slots summed across all traces (plan alignment). */
  totalUncoveredSteps: number;
  /** Total agent plan steps that failed to match any annotator step. */
  totalUncoveredAgentSteps: number;
  riskFlagCounts: Partial<Record<RiskFlagType, number>>;
  verdictCounts: Partial<Record<DecisionSurface, number>>;
  /**
   * Up to 3 annotator step positions (1-based) that were most frequently
   * uncovered across the batch, sorted by miss count descending.
   */
  mostMissedAnnotatorPositions: number[];
  // ---------------------------------------------------------------------------
  // Milestone C additions
  // ---------------------------------------------------------------------------
  /** Annotator steps newly rescued by segment-aware plan support, summed across all traces. */
  totalSegmentOnlySteps: number;
  /** Annotator steps covered by execution but not plan, summed across all traces. */
  totalExecutionOnlySteps: number;
  /** Annotator steps covered by neither plan nor execution, summed across all traces. */
  totalTrulyMissingSteps: number;
}

/** Traces with coverage below this fraction count as low-coverage. */
export const LOW_COVERAGE_THRESHOLD = 0.5;

export function canonicalizeGaiaTraceBatch(traces: GaiaTrace[]): BatchItem[] {
  return traces.map((trace) => {
    const record = canonicalizeGaiaTrace(trace);
    const alignment = alignAgentPlanToAnnotator(record);
    const alignmentRiskFlags = deriveAlignmentRiskFlags(record, alignment);
    const execAlignment = alignAgentExecToAnnotator(record);
    const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
    const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
    const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
    const policyEvaluation = evaluatePlanPolicy(record, merged, mergedRiskFlags);
    return { record, alignment, alignmentRiskFlags, execAlignment, segmentSupport, mergedSupport: merged, mergedRiskFlags, policyEvaluation };
  });
}

export function summarizePlanBatch(
  items: BatchItem[],
  options: { lowCoverageThreshold?: number } = {},
): BatchSummary {
  const lowCoverageThreshold = options.lowCoverageThreshold ?? LOW_COVERAGE_THRESHOLD;
  const riskFlagCounts: Partial<Record<RiskFlagType, number>> = {};
  const verdictCounts: Partial<Record<DecisionSurface, number>> = {};
  const positionMissCounts = new Map<number, number>();

  for (const item of items) {
    for (const flag of item.record.riskFlags) {
      riskFlagCounts[flag.type] = (riskFlagCounts[flag.type] ?? 0) + 1;
    }
    for (const flag of item.alignmentRiskFlags) {
      riskFlagCounts[flag.type] = (riskFlagCounts[flag.type] ?? 0) + 1;
    }
    for (const flag of item.mergedRiskFlags) {
      riskFlagCounts[flag.type] = (riskFlagCounts[flag.type] ?? 0) + 1;
    }
    verdictCounts[item.policyEvaluation.verdict] = (verdictCounts[item.policyEvaluation.verdict] ?? 0) + 1;
    for (const gap of item.alignment.gapDescriptions) {
      const pos = gap.annotatorStepIndex;
      positionMissCounts.set(pos, (positionMissCounts.get(pos) ?? 0) + 1);
    }
  }

  const coverages = items.map((item) => item.alignment.coverage);

  const averageCoverage =
    items.length === 0
      ? 0
      : coverages.reduce((sum, c) => sum + c, 0) / items.length;
  const averageSegmentCoverage =
    items.length === 0
      ? 0
      : items.reduce((sum, item) => sum + item.segmentSupport.coverage, 0) / items.length;

  const coverageMin = items.length === 0 ? 0 : Math.min(...coverages);
  const coverageMax = items.length === 0 ? 0 : Math.max(...coverages);
  const lowCoverageCount = coverages.filter((c) => c < lowCoverageThreshold).length;
  const totalUncoveredSteps = items.reduce(
    (sum, item) => sum + item.alignment.uncoveredAnnotatorStepIds.length,
    0,
  );
  const totalUncoveredAgentSteps = items.reduce(
    (sum, item) => sum + item.alignment.uncoveredAgentStepIds.length,
    0,
  );

  // Top 3 annotator step positions most often missed, sorted by miss count desc.
  const mostMissedAnnotatorPositions = Array.from(positionMissCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pos]) => pos);

  // Milestone C: execution-only and truly missing totals from merged support.
  const totalSegmentOnlySteps = items.reduce(
    (sum, item) => sum + item.mergedSupport.segmentOnlyCount,
    0,
  );
  const totalExecutionOnlySteps = items.reduce(
    (sum, item) => sum + item.mergedSupport.executionOnlyCount,
    0,
  );
  const totalTrulyMissingSteps = items.reduce(
    (sum, item) => sum + item.mergedSupport.trulyMissingCount,
    0,
  );

  return {
    count: items.length,
    verifiedCount: items.filter((item) => item.record.metadata.verified).length,
    averageCoverage,
    averageSegmentCoverage,
    segmentCoverageDeltaVsPlan: averageSegmentCoverage - averageCoverage,
    coverageMin,
    coverageMax,
    lowCoverageCount,
    totalUncoveredSteps,
    totalUncoveredAgentSteps,
    riskFlagCounts,
    verdictCounts,
    mostMissedAnnotatorPositions,
    totalSegmentOnlySteps,
    totalExecutionOnlySteps,
    totalTrulyMissingSteps,
  };
}
