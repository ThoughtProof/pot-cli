import { canonicalizeGaiaTrace } from './canonicalizer.js';
import {
  alignAgentPlanToAnnotator,
  alignAgentExecToAnnotator,
  computePlanSegmentSupport,
  DEFAULT_ALIGNMENT_MINIMUM_SCORE,
  type AlignmentMode,
} from './alignment.js';
import { mergeSupport } from './merged-support.js';
import type { GaiaTrace } from './gaia-trace-types.js';
import type { PlanRecord } from './types.js';

const NEAR_MISS_MARGIN = 0.02;
const BENCHMARK_MATCH_EPSILON = 1e-9;

export interface TraceAlignmentComparison {
  traceId: string;
  lexicalCoverage: number;
  semanticCoverage: number;
  segmentCoverage: number;
  execCoverage: number;
  mergedCoverage: number;
  coverageDelta: number;
  segmentCoverageDeltaVsSemantic: number;
  lexicalUncoveredAnnotatorSteps: number;
  semanticUncoveredAnnotatorSteps: number;
  lexicalUncoveredAgentSteps: number;
  semanticUncoveredAgentSteps: number;
  lexicalNearMissAnnotatorSteps: number;
  semanticNearMissAnnotatorSteps: number;
  lexicalConflictAnnotatorSteps: number;
  semanticConflictAnnotatorSteps: number;
  lexicalAssignmentConflictAnnotatorSteps: number;
  semanticAssignmentConflictAnnotatorSteps: number;
  lexicalContentGateBlockedAnnotatorSteps: number;
  semanticContentGateBlockedAnnotatorSteps: number;
}

export interface AlignmentModeSummary {
  mode: AlignmentMode;
  averageCoverage: number;
  minCoverage: number;
  maxCoverage: number;
  totalUncoveredAnnotatorSteps: number;
  totalUncoveredAgentSteps: number;
  totalNearMissAnnotatorSteps: number;
  totalConflictAnnotatorSteps: number;
  totalAssignmentConflictAnnotatorSteps: number;
  totalContentGateBlockedAnnotatorSteps: number;
}

export interface AlignmentBenchmarkResult {
  traceCount: number;
  minimumScore: number;
  lexical: AlignmentModeSummary;
  semantic: AlignmentModeSummary;
  segmentAverageCoverage: number;
  execAverageCoverage: number;
  mergedAverageCoverage: number;
  segmentAverageCoverageDeltaVsSemantic: number;
  improvedTraceCount: number;
  unchangedTraceCount: number;
  regressedTraceCount: number;
  averageCoverageDelta: number;
  traces: TraceAlignmentComparison[];
}

function summarizeMode(
  mode: AlignmentMode,
  comparisons: TraceAlignmentComparison[],
): AlignmentModeSummary {
  const coverages = comparisons.map((item) =>
    mode === 'lexical' ? item.lexicalCoverage : item.semanticCoverage,
  );

  return {
    mode,
    averageCoverage:
      coverages.length === 0 ? 0 : coverages.reduce((sum, value) => sum + value, 0) / coverages.length,
    minCoverage: coverages.length === 0 ? 0 : Math.min(...coverages),
    maxCoverage: coverages.length === 0 ? 0 : Math.max(...coverages),
    totalUncoveredAnnotatorSteps: comparisons.reduce(
      (sum, item) =>
        sum + (mode === 'lexical' ? item.lexicalUncoveredAnnotatorSteps : item.semanticUncoveredAnnotatorSteps),
      0,
    ),
    totalUncoveredAgentSteps: comparisons.reduce(
      (sum, item) =>
        sum + (mode === 'lexical' ? item.lexicalUncoveredAgentSteps : item.semanticUncoveredAgentSteps),
      0,
    ),
    totalNearMissAnnotatorSteps: comparisons.reduce(
      (sum, item) =>
        sum + (mode === 'lexical' ? item.lexicalNearMissAnnotatorSteps : item.semanticNearMissAnnotatorSteps),
      0,
    ),
    totalConflictAnnotatorSteps: comparisons.reduce(
      (sum, item) =>
        sum + (mode === 'lexical' ? item.lexicalConflictAnnotatorSteps : item.semanticConflictAnnotatorSteps),
      0,
    ),
    totalAssignmentConflictAnnotatorSteps: comparisons.reduce(
      (sum, item) =>
        sum + (mode === 'lexical'
          ? item.lexicalAssignmentConflictAnnotatorSteps
          : item.semanticAssignmentConflictAnnotatorSteps),
      0,
    ),
    totalContentGateBlockedAnnotatorSteps: comparisons.reduce(
      (sum, item) =>
        sum + (mode === 'lexical'
          ? item.lexicalContentGateBlockedAnnotatorSteps
          : item.semanticContentGateBlockedAnnotatorSteps),
      0,
    ),
  };
}

export function benchmarkAlignmentModesForRecords(
  records: PlanRecord[],
  options: { minimumScore?: number } = {},
): AlignmentBenchmarkResult {
  const minimumScore = options.minimumScore ?? DEFAULT_ALIGNMENT_MINIMUM_SCORE;

  const traces = records.map((record) => {
    const lexical = alignAgentPlanToAnnotator(record, { minimumScore, mode: 'lexical' });
    const semantic = alignAgentPlanToAnnotator(record, { minimumScore, mode: 'semantic' });
    const segment = computePlanSegmentSupport(record, { minimumScore, mode: 'semantic', maxSpanLength: 4 });
    const exec = alignAgentExecToAnnotator(record, { minimumScore, mode: 'semantic' });
    const merged = mergeSupport(record, semantic, exec, segment);

    const lexicalNearMissAnnotatorSteps = lexical.gapDescriptions.filter(
      (gap) =>
        gap.bestCandidateScore >= minimumScore - NEAR_MISS_MARGIN &&
        gap.bestCandidateScore + BENCHMARK_MATCH_EPSILON < minimumScore,
    ).length;
    const semanticNearMissAnnotatorSteps = semantic.gapDescriptions.filter(
      (gap) =>
        gap.bestCandidateScore >= minimumScore - NEAR_MISS_MARGIN &&
        gap.bestCandidateScore + BENCHMARK_MATCH_EPSILON < minimumScore,
    ).length;
    const lexicalConflictAnnotatorSteps = lexical.gapDescriptions.filter(
      (gap) => gap.bestCandidateScore + BENCHMARK_MATCH_EPSILON >= minimumScore,
    ).length;
    const semanticConflictAnnotatorSteps = semantic.gapDescriptions.filter(
      (gap) => gap.bestCandidateScore + BENCHMARK_MATCH_EPSILON >= minimumScore,
    ).length;
    const lexicalAssignmentConflictAnnotatorSteps = lexical.assignmentConflictAnnotatorStepIds.length;
    const semanticAssignmentConflictAnnotatorSteps = semantic.assignmentConflictAnnotatorStepIds.length;
    const lexicalContentGateBlockedAnnotatorSteps = lexical.contentGateBlockedAnnotatorStepIds.length;
    const semanticContentGateBlockedAnnotatorSteps = semantic.contentGateBlockedAnnotatorStepIds.length;

    return {
      traceId: record.traceId,
      lexicalCoverage: lexical.coverage,
      semanticCoverage: semantic.coverage,
      segmentCoverage: segment.coverage,
      execCoverage: exec.coverage,
      mergedCoverage: merged.mergedCoverage,
      coverageDelta: semantic.coverage - lexical.coverage,
      segmentCoverageDeltaVsSemantic: segment.coverage - semantic.coverage,
      lexicalUncoveredAnnotatorSteps: lexical.uncoveredAnnotatorStepIds.length,
      semanticUncoveredAnnotatorSteps: semantic.uncoveredAnnotatorStepIds.length,
      lexicalUncoveredAgentSteps: lexical.uncoveredAgentStepIds.length,
      semanticUncoveredAgentSteps: semantic.uncoveredAgentStepIds.length,
      lexicalNearMissAnnotatorSteps,
      semanticNearMissAnnotatorSteps,
      lexicalConflictAnnotatorSteps,
      semanticConflictAnnotatorSteps,
      lexicalAssignmentConflictAnnotatorSteps,
      semanticAssignmentConflictAnnotatorSteps,
      lexicalContentGateBlockedAnnotatorSteps,
      semanticContentGateBlockedAnnotatorSteps,
    };
  });

  const improvedTraceCount = traces.filter((item) => item.coverageDelta > 0).length;
  const unchangedTraceCount = traces.filter((item) => item.coverageDelta === 0).length;
  const regressedTraceCount = traces.filter((item) => item.coverageDelta < 0).length;

  return {
    traceCount: traces.length,
    minimumScore,
    lexical: summarizeMode('lexical', traces),
    semantic: summarizeMode('semantic', traces),
    segmentAverageCoverage:
      traces.length === 0 ? 0 : traces.reduce((sum, item) => sum + item.segmentCoverage, 0) / traces.length,
    execAverageCoverage:
      traces.length === 0 ? 0 : traces.reduce((sum, item) => sum + item.execCoverage, 0) / traces.length,
    mergedAverageCoverage:
      traces.length === 0 ? 0 : traces.reduce((sum, item) => sum + item.mergedCoverage, 0) / traces.length,
    segmentAverageCoverageDeltaVsSemantic:
      traces.length === 0 ? 0 : traces.reduce((sum, item) => sum + item.segmentCoverageDeltaVsSemantic, 0) / traces.length,
    improvedTraceCount,
    unchangedTraceCount,
    regressedTraceCount,
    averageCoverageDelta:
      traces.length === 0 ? 0 : traces.reduce((sum, item) => sum + item.coverageDelta, 0) / traces.length,
    traces,
  };
}

export function benchmarkAlignmentModesForTraces(
  traces: GaiaTrace[],
  options: { minimumScore?: number } = {},
): AlignmentBenchmarkResult {
  return benchmarkAlignmentModesForRecords(
    traces.map((trace) => canonicalizeGaiaTrace(trace)),
    options,
  );
}

export function formatAlignmentBenchmarkReport(result: AlignmentBenchmarkResult): string {
  return [
    `traceCount: ${result.traceCount}`,
    `minimumScore: ${result.minimumScore}`,
    `lexical.averageCoverage: ${result.lexical.averageCoverage.toFixed(3)}`,
    `semantic.averageCoverage: ${result.semantic.averageCoverage.toFixed(3)}`,
    `segment.averageCoverage: ${result.segmentAverageCoverage.toFixed(3)}`,
    `exec.averageCoverage: ${result.execAverageCoverage.toFixed(3)}`,
    `merged.averageCoverage: ${result.mergedAverageCoverage.toFixed(3)}`,
    `averageCoverageDelta: ${result.averageCoverageDelta.toFixed(3)}`,
    `segmentAverageCoverageDeltaVsSemantic: ${result.segmentAverageCoverageDeltaVsSemantic.toFixed(3)}`,
    `improvedTraceCount: ${result.improvedTraceCount}`,
    `unchangedTraceCount: ${result.unchangedTraceCount}`,
    `regressedTraceCount: ${result.regressedTraceCount}`,
    `lexical.totalNearMissAnnotatorSteps: ${result.lexical.totalNearMissAnnotatorSteps}`,
    `semantic.totalNearMissAnnotatorSteps: ${result.semantic.totalNearMissAnnotatorSteps}`,
    `lexical.totalConflictAnnotatorSteps: ${result.lexical.totalConflictAnnotatorSteps}`,
    `semantic.totalConflictAnnotatorSteps: ${result.semantic.totalConflictAnnotatorSteps}`,
    `lexical.totalAssignmentConflictAnnotatorSteps: ${result.lexical.totalAssignmentConflictAnnotatorSteps}`,
    `semantic.totalAssignmentConflictAnnotatorSteps: ${result.semantic.totalAssignmentConflictAnnotatorSteps}`,
    `lexical.totalContentGateBlockedAnnotatorSteps: ${result.lexical.totalContentGateBlockedAnnotatorSteps}`,
    `semantic.totalContentGateBlockedAnnotatorSteps: ${result.semantic.totalContentGateBlockedAnnotatorSteps}`,
  ].join('\n');
}
