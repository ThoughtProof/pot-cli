/**
 * Milestone C — Merged support model for annotator step coverage.
 *
 * An annotator step can be supported by:
 *   - the agent's plan text  (plan alignment)
 *   - the agent's execution  (exec alignment)
 *   - or both
 *
 * This module merges both alignment results into a single per-step verdict
 * and derives risk flags that distinguish "truly missing" steps from steps
 * the plan omitted but execution actually performed.
 */

import type { PlanRecord, RiskFlag } from './types.js';
import type {
  PlanAlignmentResult,
  ExecAlignmentResult,
  PlanSegmentSupportResult,
  SegmentSupportAssignment,
} from './alignment.js';
import { DEFAULT_ALIGNMENT_MINIMUM_SCORE } from './alignment.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Where coverage for a single annotator step came from. */
export type SupportSource = 'plan' | 'execution' | 'both' | 'none';

export type PlanSupportKind = 'none' | 'single_step' | 'segment_only' | 'single_step_and_segment';

export interface AnnotatorStepSupport {
  annotatorStepId: string;
  /** 1-based index of this annotator step within the annotator sequence. */
  annotatorStepIndex: number;
  /** Coverage provenance: which sources covered this step. */
  supportSource: SupportSource;
  /** How the plan text covered this step, if at all. */
  planSupportKind: PlanSupportKind;
  /** Best composite score from single-step plan alignment (0 if uncovered by plan). */
  planScore: number;
  /** Best composite score from segment-aware plan support (0 if uncovered by segments). */
  segmentScore: number;
  /** Agent plan step that provided segment-aware support, if any. */
  segmentAgentStepId: string | null;
  segmentAgentStepIndex: number | null;
  /** Human-readable explanation for segment-aware support, if any. */
  segmentSupportExplanation: string | null;
  /** Best composite score from exec alignment (0 if uncovered by exec). */
  execScore: number;
  /** True when at least one source (plan or exec) covers this step. */
  mergedCoverage: boolean;
}

export interface MergedSupportResult {
  traceId: string;
  stepSupports: AnnotatorStepSupport[];
  /** Coverage fraction considering both plan and execution support. */
  mergedCoverage: number;
  /** Annotator steps newly rescued by segment-aware plan support. */
  segmentOnlyCount: number;
  /** Annotator steps covered only by execution (plan text was silent even at segment level). */
  executionOnlyCount: number;
  /** Annotator steps covered only by the plan. */
  planOnlyCount: number;
  /** Annotator steps covered by both plan and execution. */
  bothCount: number;
  /** Annotator steps covered by neither — truly missing. */
  trulyMissingCount: number;
}

// ---------------------------------------------------------------------------
// Helpers: build best-score-per-annotator-step lookups
// ---------------------------------------------------------------------------

/**
 * Return a map of annotatorStepId → best composite score seen across all
 * StepAlignments.  Uses the explicit alignment entries for covered steps and
 * gapDescription scores for uncovered ones.
 */
function buildBestScoreMap(
  alignments: { annotatorStepId: string | null; score: number }[],
  gapDescriptions: { annotatorStepId: string; bestCandidateScore: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const al of alignments) {
    if (al.annotatorStepId) {
      const prev = map.get(al.annotatorStepId) ?? 0;
      if (al.score > prev) map.set(al.annotatorStepId, al.score);
    }
  }
  // Fill in uncovered steps from gap descriptions (their best-candidate score).
  for (const gap of gapDescriptions) {
    if (!map.has(gap.annotatorStepId)) {
      map.set(gap.annotatorStepId, gap.bestCandidateScore);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// mergeSupport
// ---------------------------------------------------------------------------

/**
 * Merge plan and exec alignment results into a per-annotator-step support model.
 *
 * Coverage decisions are taken directly from each alignment's
 * `uncoveredAnnotatorStepIds` (which already reflects the threshold chosen
 * when those alignments were computed).  Scores are stored for explainability.
 */
export function mergeSupport(
  record: PlanRecord,
  planAlignment: PlanAlignmentResult,
  execAlignment: ExecAlignmentResult,
  segmentSupport?: PlanSegmentSupportResult,
): MergedSupportResult {
  const annotatorSteps = record.steps.filter((s) => s.group === 'annotator');

  const planUncovered = new Set(planAlignment.uncoveredAnnotatorStepIds);
  const execUncovered = new Set(execAlignment.uncoveredAnnotatorStepIds);
  const segmentCovered = new Set(segmentSupport?.coveredAnnotatorStepIds ?? []);

  const planBestScore = buildBestScoreMap(planAlignment.alignments, planAlignment.gapDescriptions);
  const execBestScore = buildBestScoreMap(execAlignment.alignments, execAlignment.gapDescriptions);
  const segmentBestScore = new Map<string, number>();
  const bestSegmentAssignment = new Map<string, SegmentSupportAssignment>();
  for (const assignment of segmentSupport?.assignments ?? []) {
    for (const annotatorStepId of assignment.coveredAnnotatorStepIds) {
      const prev = segmentBestScore.get(annotatorStepId) ?? 0;
      if (assignment.score > prev) {
        segmentBestScore.set(annotatorStepId, assignment.score);
        bestSegmentAssignment.set(annotatorStepId, assignment);
      }
    }
  }

  let coveredCount = 0;
  let segmentOnlyCount = 0;
  let executionOnlyCount = 0;
  let planOnlyCount = 0;
  let bothCount = 0;
  let trulyMissingCount = 0;

  const stepSupports: AnnotatorStepSupport[] = annotatorSteps.map((step) => {
    const coveredBySingleStepPlan = !planUncovered.has(step.id);
    const coveredBySegment = segmentCovered.has(step.id);
    const coveredByPlan = coveredBySingleStepPlan || coveredBySegment;
    const coveredByExec = !execUncovered.has(step.id);
    const mergedCov = coveredByPlan || coveredByExec;

    let planSupportKind: PlanSupportKind;
    if (coveredBySingleStepPlan && coveredBySegment) {
      planSupportKind = 'single_step_and_segment';
    } else if (coveredBySingleStepPlan) {
      planSupportKind = 'single_step';
    } else if (coveredBySegment) {
      planSupportKind = 'segment_only';
      segmentOnlyCount++;
    } else {
      planSupportKind = 'none';
    }

    let supportSource: SupportSource;
    if (coveredByPlan && coveredByExec) {
      supportSource = 'both';
      bothCount++;
    } else if (coveredByPlan) {
      supportSource = 'plan';
      planOnlyCount++;
    } else if (coveredByExec) {
      supportSource = 'execution';
      executionOnlyCount++;
    } else {
      supportSource = 'none';
      trulyMissingCount++;
    }

    if (mergedCov) coveredCount++;

    const segmentAssignment = bestSegmentAssignment.get(step.id) ?? null;
    const segmentSupportExplanation = segmentAssignment
      ? `Covered by compressed agent plan step ${segmentAssignment.agentStepIndex} via annotator span ${segmentAssignment.spanStartAnnotatorStepIndex}-${segmentAssignment.spanEndAnnotatorStepIndex} (segment score ${segmentAssignment.score.toFixed(2)}).`
      : null;

    return {
      annotatorStepId: step.id,
      annotatorStepIndex: step.index,
      supportSource,
      planSupportKind,
      planScore: planBestScore.get(step.id) ?? 0,
      segmentScore: segmentBestScore.get(step.id) ?? 0,
      segmentAgentStepId: segmentAssignment?.agentStepId ?? null,
      segmentAgentStepIndex: segmentAssignment?.agentStepIndex ?? null,
      segmentSupportExplanation,
      execScore: execBestScore.get(step.id) ?? 0,
      mergedCoverage: mergedCov,
    };
  });

  return {
    traceId: record.traceId,
    stepSupports,
    mergedCoverage: annotatorSteps.length === 0 ? 0 : coveredCount / annotatorSteps.length,
    segmentOnlyCount,
    executionOnlyCount,
    planOnlyCount,
    bothCount,
    trulyMissingCount,
  };
}

// ---------------------------------------------------------------------------
// deriveMergedRiskFlags
// ---------------------------------------------------------------------------

/**
 * Produce risk flags from merged support:
 *
 *  - `truly_missing_step` (high): neither plan nor execution covers the annotator step.
 *    This is a stronger signal than plan-only missing_step because execution
 *    also had a chance to demonstrate coverage.
 *
 *  - `plan_gap` (medium): execution covers the step but plan text did not mention
 *    it.  The work appears to have been done; the plan was just silent.
 *
 * Note: steps covered by both plan and execution, or plan only, do not produce
 * additional flags here.  Plan-only alignment risk flags (missing_step, gap)
 * continue to be derived separately via deriveAlignmentRiskFlags.
 */
export function deriveMergedRiskFlags(
  record: PlanRecord,
  support: MergedSupportResult,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  for (const stepSupport of support.stepSupports) {
    if (stepSupport.supportSource === 'none') {
      flags.push({
        id: `merged:risk:truly_missing_step:${stepSupport.annotatorStepId}`,
        stepId: stepSupport.annotatorStepId,
        type: 'truly_missing_step',
        description:
          `Annotator step ${stepSupport.annotatorStepIndex} is not covered by either the agent plan ` +
          `(single-step score: ${stepSupport.planScore.toFixed(2)}, segment score: ${stepSupport.segmentScore.toFixed(2)}) or execution ` +
          `(score: ${stepSupport.execScore.toFixed(2)}). Truly missing.`,
        severity: 'high',
        provenance: {
          origin: 'inferred',
          sourceEvidence: `merged support for ${stepSupport.annotatorStepId} in trace ${record.traceId}`,
          confidence: 0.85,
        },
      });
    } else if (stepSupport.supportSource === 'execution') {
      flags.push({
        id: `merged:risk:plan_gap:${stepSupport.annotatorStepId}`,
        stepId: stepSupport.annotatorStepId,
        type: 'plan_gap',
        description:
          `Annotator step ${stepSupport.annotatorStepIndex} is covered by execution ` +
          `(exec score: ${stepSupport.execScore.toFixed(2)}) but not mentioned in the agent plan ` +
          `(single-step score: ${stepSupport.planScore.toFixed(2)}, segment score: ${stepSupport.segmentScore.toFixed(2)}). Work was done; plan text was silent.`,
        severity: 'medium',
        provenance: {
          origin: 'inferred',
          sourceEvidence: `merged support for ${stepSupport.annotatorStepId} in trace ${record.traceId}`,
          confidence: 0.75,
        },
      });
    }
  }

  return flags;
}

export { DEFAULT_ALIGNMENT_MINIMUM_SCORE };
