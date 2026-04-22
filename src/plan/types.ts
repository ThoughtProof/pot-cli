/**
 * Milestone A — Plan-level verification types for ThoughtProof v2.
 *
 * Every field that is derived / inferred (rather than copied verbatim from the
 * source trace) carries a Provenance tag so downstream consumers know exactly
 * where the value came from and how much to trust it.
 */

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Where a value originated. */
export type ProvenanceOrigin =
  | 'explicit'   // read directly from a clearly-labelled trace field
  | 'inferred'   // derived algorithmically from one or more trace fields
  | 'annotator'; // supplied by a human annotator outside the agent trace

export interface Provenance {
  /** How the value was obtained. */
  origin: ProvenanceOrigin;
  /**
   * A human-readable pointer to the evidence: span_id, JSON path, or a short
   * description.  Enough to locate the original data in the raw trace.
   */
  sourceEvidence: string;
  /** Confidence in this value, 0 (guess) … 1 (verbatim copy). */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

/** The top-level task / question the agent is trying to answer. */
export interface GoalNode {
  id: string;
  description: string;
  taskId: string;
  /** Ground-truth answer when available (e.g. from GAIA benchmark). */
  trueAnswer?: string;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Plan Steps
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: string;
  /** Logical group for step alignment and ordering. */
  group: 'annotator' | 'agent:plan' | 'agent:exec';
  /** 1-based position within the step group, not the global step array. */
  index: number;
  description: string;
  /** Tool names mentioned or used in this step. */
  toolsUsed: string[];
  /** Span ID in the source trace that corresponds to this step, if any. */
  spanId?: string;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Plan Edges
// ---------------------------------------------------------------------------

export type PlanEdgeType = 'sequential' | 'conditional' | 'parallel';

export interface PlanEdge {
  id: string;
  from: string; // PlanStep.id
  to: string;   // PlanStep.id
  type: PlanEdgeType;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Information Flows
// ---------------------------------------------------------------------------

/** A named piece of data that flows from one step to another. */
export interface InformationFlow {
  id: string;
  fromStep: string; // PlanStep.id or 'goal'
  toStep: string;   // PlanStep.id or 'final_answer'
  description: string;
  /** The actual value, if small enough to inline. */
  value?: string;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Risk Flags
// ---------------------------------------------------------------------------

export type RiskFlagType =
  | 'wrong_answer'   // agent final answer ≠ ground truth
  | 'missing_step'   // annotator step not covered by agent plan
  | 'truly_missing_step' // annotator step not covered by either plan or execution
  | 'tool_failure'   // a tool call returned an error or unexpected value
  | 'hallucination'  // agent stated a fact not supported by retrieved data
  | 'gap'            // unresolved information gap in the reasoning chain
  | 'plan_gap';      // annotator step covered by execution but not by plan text (work was done, plan was silent)

export type RiskSeverity = 'low' | 'medium' | 'high';

export interface RiskFlag {
  id: string;
  /** Which step triggered this flag, if applicable. */
  stepId?: string;
  type: RiskFlagType;
  description: string;
  severity: RiskSeverity;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Plan Record (top-level output of the canonicalizer)
// ---------------------------------------------------------------------------

export interface PlanMetadata {
  /** LLM model used by the agent. */
  agentModel: string;
  /** The answer the agent produced. */
  agentAnswer: string;
  /** Number of steps the human annotator used (from benchmark metadata). */
  annotatorStepCount: number;
  /** Number of distinct tools the human annotator used. */
  annotatorToolCount: number;
  /** Wall-clock duration of the top-level span in seconds. */
  totalDurationSeconds: number;
  /** True if agentAnswer matches trueAnswer (case-insensitive trim). */
  verified: boolean;
}

export interface PlanRecord {
  /** Stable plan-record ID, distinct from the underlying trace ID. */
  id: string;
  traceId: string;
  extractedAt: string; // ISO 8601
  goal: GoalNode;
  /** Steps derived from the agent's own plan (explicit) and/or the annotator's reference solution. */
  steps: PlanStep[];
  edges: PlanEdge[];
  informationFlows: InformationFlow[];
  riskFlags: RiskFlag[];
  metadata: PlanMetadata;
}
