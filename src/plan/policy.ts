/**
 * Milestone D — plan-level policy / verdict layer for ThoughtProof v2.
 *
 * Structured findings first, routed policy second.
 */

import type { PlanRecord, RiskFlag, RiskSeverity } from './types.js';
import type { MergedSupportResult } from './merged-support.js';
import type { SourceClaimConfidence, SourceClaimSupport } from './span-entailment.js';

export type DecisionSurface = 'ALLOW' | 'CONDITIONAL_ALLOW' | 'HOLD' | 'BLOCK';

export type PolicyFindingType =
  | 'wrong_answer'
  | 'unverifiable'
  | 'truly_missing_step'
  | 'plan_gap'
  | 'tool_failure'
  | 'hallucination'
  | 'coverage';

export type TaskType = 'deterministic' | 'retrieval' | 'tool_chain' | 'mixed' | 'unknown';
export type TaskTypeConfidence = 'low' | 'medium' | 'high';
export type TraceVerifiability = 'high' | 'medium' | 'low';
export type AnswerConfidence = 'high' | 'medium' | 'low';
export type ExecutionChainStatus = 'complete' | 'partial' | 'broken';
export type DissentKind = 'fact' | 'observability' | 'policy' | 'mixed';
export type HardStopClass =
  | 'factual_failure'
  | 'exact_string_mismatch'
  | 'fabricated_support'
  | 'broken_execution'
  | 'provenance_absence_claim'
  | 'observability_gap';

export interface PolicyFinding {
  id: string;
  type: PolicyFindingType;
  severity: RiskSeverity;
  description: string;
  stepIds: string[];
  count: number;
}

export interface PlanPolicyMetrics {
  verified: boolean;
  taskType: TaskType;
  taskTypeConfidence: TaskTypeConfidence;
  mergedCoverage: number;
  trulyMissingCount: number;
  executionOnlyCount: number;
  segmentOnlyCount: number;
  traceVerifiability: TraceVerifiability;
  answerConfidence: AnswerConfidence;
  answerExternallyCheckable: boolean;
  answerCorrectBySanityCheck: boolean | null;
  provenanceChainComplete: boolean;
  executionChainStatus: ExecutionChainStatus;
  dissentKind: DissentKind;
  hardStopClasses: HardStopClass[];
  sourceClaimSupport: SourceClaimSupport | null;
  sourceClaimConfidence: SourceClaimConfidence | null;
  sourceClaimExactStringQuestion: boolean;
}

export interface PlanPolicyResult {
  traceId: string;
  verdict: DecisionSurface;
  findings: PolicyFinding[];
  summary: string;
  metrics: PlanPolicyMetrics;
}

export interface PlanPolicyBatchExport {
  schemaVersion: 'plan-policy-report/v2';
  count: number;
  verdictCounts: Record<DecisionSurface, number>;
  results: PlanPolicyResult[];
}

interface PolicyContext {
  taskType: TaskType;
  taskTypeConfidence: TaskTypeConfidence;
  traceVerifiability: TraceVerifiability;
  answerConfidence: AnswerConfidence;
  answerExternallyCheckable: boolean;
  answerCorrectBySanityCheck: boolean | null;
  provenanceChainComplete: boolean;
  executionChainStatus: ExecutionChainStatus;
  dissentKind: DissentKind;
  hardStopClasses: HardStopClass[];
  sourceClaimSupport: SourceClaimSupport | null;
  sourceClaimConfidence: SourceClaimConfidence | null;
  sourceClaimExactStringQuestion: boolean;
}

export interface ExperimentalPolicyOptions {
  experimentalSourceClaim?: {
    support: SourceClaimSupport;
    confidence: SourceClaimConfidence;
    exactStringQuestion: boolean;
  };
}

export const DEFAULT_POLICY_COVERAGE_THRESHOLD = 0.75;
export const DEFAULT_POLICY_HIGH_RISK_COVERAGE_THRESHOLD = 0.5;

interface TaskTypeDetection {
  taskType: TaskType;
  confidence: TaskTypeConfidence;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function highestSeverity(findings: PolicyFinding[]): RiskSeverity | null {
  if (findings.some((f) => f.severity === 'high')) return 'high';
  if (findings.some((f) => f.severity === 'medium')) return 'medium';
  if (findings.some((f) => f.severity === 'low')) return 'low';
  return null;
}

function collectRecordFlags(record: PlanRecord, type: 'tool_failure' | 'hallucination' | 'wrong_answer'): RiskFlag[] {
  return record.riskFlags.filter((flag) => flag.type === type);
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function countSignalMatches(text: string, signals: string[]): number {
  return signals.reduce((count, signal) => count + (text.includes(signal) ? 1 : 0), 0);
}

function deriveTaskType(record: PlanRecord): TaskTypeDetection {
  const goalText = record.goal.description.toLowerCase();
  const stepText = record.steps.map((step) => step.description).join(' ').toLowerCase();
  const toolText = record.steps.flatMap((step) => step.toolsUsed).join(' ').toLowerCase();
  const text = `${goalText} ${stepText} ${toolText}`;

  const strongDeterministicGoalSignals = [
    'reverse',
    'decoded',
    'decode',
    'decrypt',
    'grid',
    'puzzle',
    'riddle',
    'logic',
    'how many more',
    'difference between',
    'left to right',
    'letters in order',
    'always tell the truth',
    'always lie',
  ];
  const retrievalSignals = [
    'wikipedia',
    'database',
    'dataset',
    'article',
    'paper',
    'grant',
    'contract',
    'libretexts',
    'openreview',
    'pubmed',
    'usgs',
    'nasa',
    'archive',
    'official',
    'source page',
    'mission page',
    'rfc',
    'pep',
    'spec',
    'standard',
    'according to',
    'what does',
    'stand for',
    'zip code',
    'surname',
    'stanza',
    'poem',
    'author',
    'recipient',
    'search web',
    'search the web',
    'look up',
    'lookup',
    'retrieve ',
    'webpage',
    'website',
  ];
  const toolChainSignals = [
    'python',
    'script',
    'api',
    'sql',
    'shell',
    'calculator',
    'interpreter',
    'run code',
    'code execution',
    'tool output',
  ];
  const computationTools = new Set(['python', 'python_interpreter', 'shell', 'terminal', 'sql', 'calculator', 'interpreter', 'api']);
  const retrievalTools = new Set(['web_search', 'search', 'web_fetch', 'fetch', 'browser', 'browse', 'read', 'http']);
  const hasComputationToolUsage = record.steps.some((step) => step.toolsUsed.some((tool) => computationTools.has(tool.toLowerCase())));
  const hasRetrievalToolUsage = record.steps.some((step) => step.toolsUsed.some((tool) => retrievalTools.has(tool.toLowerCase())));

  const deterministicSignals = [
    'how many',
    'count',
    'sum',
    'subtract',
    'multiply',
    'calculate',
    'compute',
    'arithmetic',
    'canonical fact',
  ];
  const deterministicScore =
    countSignalMatches(goalText, strongDeterministicGoalSignals) * 2
    + countSignalMatches(goalText, deterministicSignals)
    + countSignalMatches(stepText, deterministicSignals);
  const retrievalScore = countSignalMatches(goalText, retrievalSignals) + countSignalMatches(stepText, retrievalSignals);
  const toolChainScore = countSignalMatches(text, toolChainSignals) + (hasComputationToolUsage ? 2 : 0);

  const scoreEntries: Array<[Exclude<TaskType, 'mixed' | 'unknown'>, number]> = [
    ['deterministic', deterministicScore],
    ['retrieval', retrievalScore],
    ['tool_chain', toolChainScore],
  ];
  const positive = scoreEntries.filter(([, score]) => score > 0);
  const sorted = [...scoreEntries].sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = sorted[0]!;
  const [, secondScore] = sorted[1]!;
  const strongDeterministicHit = countSignalMatches(goalText, strongDeterministicGoalSignals) > 0;

  if (strongDeterministicHit && deterministicScore >= retrievalScore + toolChainScore) {
    return { taskType: 'deterministic', confidence: deterministicScore >= 3 ? 'high' : 'medium' };
  }

  if (positive.length >= 2) {
    if (topScore >= secondScore + 2) {
      return { taskType: topType, confidence: 'medium' };
    }
    return { taskType: 'mixed', confidence: topScore >= 3 ? 'medium' : 'low' };
  }

  if (topType === 'deterministic' && topScore >= 2) {
    return { taskType: 'deterministic', confidence: topScore >= 3 ? 'high' : 'medium' };
  }
  if (topType === 'retrieval' && topScore >= 2) {
    return { taskType: 'retrieval', confidence: topScore >= 3 ? 'high' : 'medium' };
  }
  if (topType === 'tool_chain' && topScore >= 2) {
    return { taskType: 'tool_chain', confidence: topScore >= 3 ? 'high' : 'medium' };
  }

  if (hasComputationToolUsage) {
    return { taskType: 'tool_chain', confidence: 'medium' };
  }
  if (hasRetrievalToolUsage) {
    return { taskType: 'retrieval', confidence: 'medium' };
  }
  if (strongDeterministicHit) {
    return { taskType: 'deterministic', confidence: 'medium' };
  }

  return { taskType: 'unknown', confidence: 'low' };
}

function hasWrongAnswer(findings: PolicyFinding[]): boolean {
  return findings.some((finding) => finding.type === 'wrong_answer');
}

function hasHighHallucination(findings: PolicyFinding[]): boolean {
  return findings.some((finding) => finding.type === 'hallucination' && finding.severity === 'high');
}

function hasAnyHallucination(findings: PolicyFinding[]): boolean {
  return findings.some((finding) => finding.type === 'hallucination');
}

function hasHighToolFailure(findings: PolicyFinding[]): boolean {
  return findings.some((finding) => finding.type === 'tool_failure' && finding.severity === 'high');
}

function hasAnyToolFailure(findings: PolicyFinding[]): boolean {
  return findings.some((finding) => finding.type === 'tool_failure');
}

function hasCoverageHigh(findings: PolicyFinding[]): boolean {
  return findings.some((finding) => finding.type === 'coverage' && finding.severity === 'high');
}

function hasOnlyObservabilityIssues(findings: PolicyFinding[]): boolean {
  if (findings.length === 0) return false;

  return findings.every((finding) => {
    if (finding.type === 'coverage') {
      return finding.severity !== 'high';
    }

    return finding.type === 'plan_gap'
      || finding.type === 'unverifiable'
      || finding.type === 'truly_missing_step';
  });
}

function claimOfAbsenceWithoutEvidence(record: PlanRecord, taskType: TaskType, findings: PolicyFinding[]): boolean {
  if (taskType !== 'retrieval' && taskType !== 'mixed') {
    return false;
  }

  const hasEvidenceGap = findings.some((finding) => finding.type === 'unverifiable')
    && findings.some((finding) => finding.type === 'truly_missing_step' || finding.type === 'plan_gap');
  if (!hasEvidenceGap) {
    return false;
  }

  const text = `${record.goal.description} ${record.steps.map((step) => step.description).join(' ')}`.toLowerCase();
  const retrievalEvidenceSignals = ['search', 'retrieve', 'look up', 'lookup', 'database', 'article', 'record', 'web'];
  if (!includesAny(text, retrievalEvidenceSignals)) {
    return false;
  }

  const absencePatterns = [
    'no evidence of',
    'not found',
    'did not find',
    'could not find',
    'without any evidence',
    'does not exist',
    'none found',
    'never published',
  ];
  return includesAny(text, absencePatterns);
}

function deriveTraceVerifiability(
  support: MergedSupportResult,
  provenanceChainComplete: boolean,
  executionChainStatus: ExecutionChainStatus,
): TraceVerifiability {
  if (support.trulyMissingCount === 0 && support.mergedCoverage >= 0.8 && provenanceChainComplete && executionChainStatus === 'complete') {
    return 'high';
  }

  if (support.executionOnlyCount > 0 || (support.trulyMissingCount === 0 && support.mergedCoverage >= 0.65)) {
    return 'medium';
  }

  return 'low';
}

function deriveDissentKind(findings: PolicyFinding[], executionChainStatus: ExecutionChainStatus): DissentKind {
  if (hasWrongAnswer(findings) || hasAnyHallucination(findings)) {
    return 'fact';
  }

  const hasObservabilityIssues = findings.some((finding) =>
    finding.type === 'coverage' || finding.type === 'plan_gap' || finding.type === 'truly_missing_step' || finding.type === 'unverifiable');
  const hasPolicyIssues = findings.some((finding) => finding.severity === 'low') && !hasObservabilityIssues;

  if (hasObservabilityIssues || executionChainStatus !== 'complete') {
    return hasPolicyIssues ? 'mixed' : 'observability';
  }

  if (hasPolicyIssues) {
    return 'policy';
  }

  return 'policy';
}

const COMPARABLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'was', 'were', 'with',
]);
const NEGATION_TOKENS = new Set(['no', 'not', 'never', 'none', 'without', 'cannot', 'cant', 'doesnt', 'dont', 'isnt', 'arent', 'wasnt', 'werent', 'wont', 'didnt']);
const ENTITY_STOPWORDS = new Set(['The', 'A', 'An', 'By', 'In', 'On', 'At', 'For', 'Of']);

function tokenizeComparableText(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function contentTokens(value: string): string[] {
  return tokenizeComparableText(value).filter((token) => !COMPARABLE_STOPWORDS.has(token));
}

function numericTokens(value: string): string[] {
  return tokenizeComparableText(value).filter((token) => /\d/.test(token));
}

function tokenJaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(contentTokens(left));
  const rightTokens = new Set(contentTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function hasNegationMismatch(left: string, right: string): boolean {
  const leftNegation = contentTokens(left).some((token) => NEGATION_TOKENS.has(token));
  const rightNegation = contentTokens(right).some((token) => NEGATION_TOKENS.has(token));
  return leftNegation !== rightNegation;
}

function extractEntityishTokens(value: string): string[] {
  const matches = value.match(/(?:\b[A-Z]{2,}\b|\b[A-Z][a-z]+\b|\b[A-Z]\.)/g) ?? [];
  return matches.filter((token) => !ENTITY_STOPWORDS.has(token));
}

function hasEntitySubstitutionMismatch(left: string, right: string): boolean {
  const leftEntities = new Set(extractEntityishTokens(left));
  const rightEntities = new Set(extractEntityishTokens(right));
  if (leftEntities.size === 0 || rightEntities.size === 0) {
    return false;
  }

  const shared = [...leftEntities].filter((token) => rightEntities.has(token));
  const leftOnly = [...leftEntities].filter((token) => !rightEntities.has(token));
  const rightOnly = [...rightEntities].filter((token) => !leftEntities.has(token));

  return shared.length >= 2 && leftOnly.length > 0 && rightOnly.length > 0;
}

function hasEntityOmissionMismatch(left: string, right: string): boolean {
  const leftEntities = new Set(extractEntityishTokens(left));
  const rightEntities = new Set(extractEntityishTokens(right));
  if (leftEntities.size === 0 || rightEntities.size === 0) {
    return false;
  }

  const shared = [...leftEntities].filter((token) => rightEntities.has(token));
  const leftOnly = [...leftEntities].filter((token) => !rightEntities.has(token));
  const rightOnly = [...rightEntities].filter((token) => !leftEntities.has(token));
  if (shared.length < 1) {
    return false;
  }

  const omittedTokens = leftOnly.length > 0 && rightOnly.length === 0
    ? leftOnly
    : rightOnly.length > 0 && leftOnly.length === 0
      ? rightOnly
      : [];

  if (omittedTokens.length === 0) {
    return false;
  }

  return omittedTokens.every((token) => token.replace(/\./g, '').length <= 2);
}

function hasLikelyExactStringMismatch(
  record: PlanRecord,
  findings: PolicyFinding[],
  exactStringQuestion: boolean,
): boolean {
  if (!exactStringQuestion || !hasWrongAnswer(findings)) {
    return false;
  }

  const claimedAnswer = String(record.metadata.agentAnswer ?? '').trim();
  const trueAnswer = String(record.goal.trueAnswer ?? '').trim();
  if (!claimedAnswer || !trueAnswer) {
    return false;
  }

  if (hasNegationMismatch(claimedAnswer, trueAnswer)) {
    return false;
  }

  if (hasEntitySubstitutionMismatch(claimedAnswer, trueAnswer) || hasEntityOmissionMismatch(claimedAnswer, trueAnswer)) {
    return false;
  }

  const claimedNumeric = numericTokens(claimedAnswer);
  const trueNumeric = numericTokens(trueAnswer);
  if (claimedNumeric.length > 0 && trueNumeric.length > 0) {
    const sharedNumeric = claimedNumeric.filter((token) => trueNumeric.includes(token));
    if (sharedNumeric.length === 0) {
      return false;
    }
  }

  const normalizedClaimed = claimedAnswer.toLowerCase();
  const normalizedTrue = trueAnswer.toLowerCase();
  if (normalizedClaimed.includes(normalizedTrue)) {
    const claimedLength = contentTokens(claimedAnswer).length;
    const trueLength = contentTokens(trueAnswer).length;
    return claimedLength <= trueLength + 8;
  }

  const claimedContent = new Set(contentTokens(claimedAnswer));
  const trueContent = new Set(contentTokens(trueAnswer));
  const overlapCount = [...claimedContent].filter((token) => trueContent.has(token)).length;

  return overlapCount >= 3 && tokenJaccardSimilarity(claimedAnswer, trueAnswer) >= 0.25;
}

function deriveHardStopClasses(
  record: PlanRecord,
  taskType: TaskType,
  findings: PolicyFinding[],
  executionChainStatus: ExecutionChainStatus,
  exactStringQuestion: boolean,
): HardStopClass[] {
  const hardStopClasses: HardStopClass[] = [];

  if (hasLikelyExactStringMismatch(record, findings, exactStringQuestion)) {
    hardStopClasses.push('exact_string_mismatch');
  } else if (hasWrongAnswer(findings)) {
    hardStopClasses.push('factual_failure');
  }
  if (hasAnyHallucination(findings)) {
    hardStopClasses.push('fabricated_support');
  }
  if (executionChainStatus === 'broken') {
    hardStopClasses.push('broken_execution');
  }
  if (claimOfAbsenceWithoutEvidence(record, taskType, findings)) {
    hardStopClasses.push('provenance_absence_claim');
  }
  if (hasOnlyObservabilityIssues(findings)) {
    hardStopClasses.push('observability_gap');
  }

  return unique(hardStopClasses);
}

function derivePolicyContext(
  record: PlanRecord,
  support: MergedSupportResult,
  findings: PolicyFinding[],
  taskDetection: TaskTypeDetection,
  options?: ExperimentalPolicyOptions,
): PolicyContext {
  const taskType = taskDetection.taskType;
  const answerExternallyCheckable = taskType === 'deterministic' || record.metadata.verified;
  const answerCorrectBySanityCheck = hasWrongAnswer(findings)
    ? false
    : record.metadata.verified
      ? true
      : null;

  const executionChainStatus: ExecutionChainStatus =
    hasHighToolFailure(findings) || hasHighHallucination(findings)
      ? 'broken'
      : support.executionOnlyCount > 0 || hasAnyToolFailure(findings)
        ? 'partial'
        : 'complete';

  const provenanceChainComplete = taskType !== 'retrieval'
    ? true
    : !findings.some((finding) =>
      finding.type === 'unverifiable' || finding.type === 'truly_missing_step' || finding.type === 'plan_gap');

  const traceVerifiability = deriveTraceVerifiability(support, provenanceChainComplete, executionChainStatus);

  const answerConfidence: AnswerConfidence =
    hasWrongAnswer(findings) || hasAnyHallucination(findings) || executionChainStatus === 'broken'
      ? 'low'
      : record.metadata.verified
        ? 'high'
        : 'medium';

  const dissentKind = deriveDissentKind(findings, executionChainStatus);
  const sourceClaimExactStringQuestion = options?.experimentalSourceClaim?.exactStringQuestion ?? false;
  const hardStopClasses = deriveHardStopClasses(record, taskType, findings, executionChainStatus, sourceClaimExactStringQuestion);

  return {
    taskType,
    taskTypeConfidence: taskDetection.confidence,
    traceVerifiability,
    answerConfidence,
    answerExternallyCheckable,
    answerCorrectBySanityCheck,
    provenanceChainComplete,
    executionChainStatus,
    dissentKind,
    hardStopClasses,
    sourceClaimSupport: options?.experimentalSourceClaim?.support ?? null,
    sourceClaimConfidence: options?.experimentalSourceClaim?.confidence ?? null,
    sourceClaimExactStringQuestion,
  };
}

function evaluateDeterministicPolicy(ctx: PolicyContext, findings: PolicyFinding[]): DecisionSurface {
  if (hasWrongAnswer(findings) || hasHighHallucination(findings)) {
    return 'BLOCK';
  }

  if (ctx.hardStopClasses.includes('broken_execution')) {
    return 'BLOCK';
  }

  if (ctx.answerCorrectBySanityCheck === true) {
    if (findings.length === 0) {
      return 'ALLOW';
    }
    if (hasOnlyObservabilityIssues(findings)) {
      return 'CONDITIONAL_ALLOW';
    }
  }

  if (hasOnlyObservabilityIssues(findings)) {
    return 'CONDITIONAL_ALLOW';
  }

  if (ctx.answerConfidence === 'high' && ctx.dissentKind !== 'fact') {
    return 'CONDITIONAL_ALLOW';
  }

  if (ctx.dissentKind === 'fact' || ctx.answerConfidence === 'low') {
    return 'HOLD';
  }

  return 'HOLD';
}

function evaluateRetrievalPolicy(ctx: PolicyContext, findings: PolicyFinding[]): DecisionSurface {
  if (
    hasHighHallucination(findings)
    || ctx.hardStopClasses.includes('provenance_absence_claim')
  ) {
    return 'BLOCK';
  }

  if (ctx.hardStopClasses.includes('exact_string_mismatch')) {
    return 'HOLD';
  }

  if (hasWrongAnswer(findings)) {
    return 'BLOCK';
  }

  const hasMissingStep = findings.some((finding) => finding.type === 'truly_missing_step');
  const hasPlanGap = findings.some((finding) => finding.type === 'plan_gap');
  const hasNonHighCoverage = findings.some((finding) => finding.type === 'coverage' && finding.severity !== 'high');
  const hasObservabilityGap = hasMissingStep || hasPlanGap || hasNonHighCoverage;

  if (hasObservabilityGap) {
    if (
      (ctx.sourceClaimSupport === 'exact' || ctx.sourceClaimSupport === 'paraphrase')
      && (ctx.sourceClaimConfidence === 'high' || ctx.sourceClaimConfidence === 'medium')
    ) {
      return 'CONDITIONAL_ALLOW';
    }
    return 'HOLD';
  }

  if (ctx.provenanceChainComplete && ctx.answerConfidence !== 'low') {
    return ctx.answerCorrectBySanityCheck === true ? 'ALLOW' : 'CONDITIONAL_ALLOW';
  }

  if (!ctx.provenanceChainComplete && ctx.answerConfidence !== 'low') {
    return 'CONDITIONAL_ALLOW';
  }

  return 'HOLD';
}

function evaluateToolChainPolicy(ctx: PolicyContext, findings: PolicyFinding[]): DecisionSurface {
  if (hasWrongAnswer(findings) || ctx.executionChainStatus === 'broken' || hasHighHallucination(findings)) {
    return 'BLOCK';
  }

  if (ctx.executionChainStatus === 'complete' && ctx.answerConfidence === 'high') {
    return findings.length === 0 ? 'ALLOW' : 'CONDITIONAL_ALLOW';
  }

  if (ctx.executionChainStatus === 'partial' && ctx.answerConfidence !== 'low') {
    return 'CONDITIONAL_ALLOW';
  }

  return 'HOLD';
}

function qualifiesForNarrowSupportSoftening(ctx: PolicyContext, findings: PolicyFinding[]): boolean {
  const hasTrulyMissingStep = findings.some((finding) => finding.type === 'truly_missing_step');
  if (!hasTrulyMissingStep) {
    return false;
  }

  const hasOnlyObservabilityHardStop = ctx.hardStopClasses.length > 0
    && ctx.hardStopClasses.every((hardStop) => hardStop === 'observability_gap');
  if (!hasOnlyObservabilityHardStop) {
    return false;
  }

  const hasSupportedSourceClaim = (ctx.sourceClaimSupport === 'exact' || ctx.sourceClaimSupport === 'paraphrase')
    && (ctx.sourceClaimConfidence === 'high' || ctx.sourceClaimConfidence === 'medium');

  return hasSupportedSourceClaim;
}

function evaluateFallbackPolicy(ctx: PolicyContext, findings: PolicyFinding[]): DecisionSurface {
  if (
    ctx.hardStopClasses.includes('factual_failure')
    || ctx.hardStopClasses.includes('fabricated_support')
    || ctx.hardStopClasses.includes('broken_execution')
  ) {
    return 'BLOCK';
  }

  if (findings.some((finding) => finding.type === 'truly_missing_step') || hasCoverageHigh(findings)) {
    if (qualifiesForNarrowSupportSoftening(ctx, findings)) {
      return 'CONDITIONAL_ALLOW';
    }
    return 'HOLD';
  }

  if (ctx.executionChainStatus === 'partial' || highestSeverity(findings) === 'low') {
    return 'CONDITIONAL_ALLOW';
  }

  return 'ALLOW';
}

function evaluateMixedPolicy(ctx: PolicyContext, findings: PolicyFinding[]): DecisionSurface {
  if (
    ctx.hardStopClasses.includes('factual_failure')
    || ctx.hardStopClasses.includes('fabricated_support')
    || ctx.hardStopClasses.includes('broken_execution')
  ) {
    return 'BLOCK';
  }

  if (findings.some((finding) => finding.type === 'truly_missing_step')) {
    if (qualifiesForNarrowSupportSoftening(ctx, findings)) {
      return 'CONDITIONAL_ALLOW';
    }
    return 'HOLD';
  }

  if (ctx.executionChainStatus === 'partial' || !ctx.provenanceChainComplete) {
    return 'CONDITIONAL_ALLOW';
  }

  return evaluateFallbackPolicy(ctx, findings);
}

function buildPolicySummary(
  verdict: DecisionSurface,
  ctx: PolicyContext,
  findings: PolicyFinding[],
): string {
  if (verdict === 'ALLOW') {
    if (ctx.taskType === 'deterministic') {
      return 'Deterministic answer appears correct and externally checkable; remaining trace uncertainty is non-material.';
    }
    if (ctx.taskType === 'retrieval') {
      return 'Retrieval answer is supported by a sufficiently complete provenance chain and no material factual disagreement remains.';
    }
    if (ctx.taskType === 'tool_chain') {
      return 'Execution chain appears complete and the resulting answer is materially supported.';
    }
    return 'Plan is coherent, materially covered, and free of blocking compositional findings.';
  }

  if (verdict === 'CONDITIONAL_ALLOW') {
    if (ctx.taskType === 'deterministic') {
      return 'Deterministic answer looks acceptable, but observability is incomplete and should remain auditable.';
    }
    if (ctx.taskType === 'retrieval') {
      return 'Retrieval answer is plausible, but provenance or observability is partial, so proceed only with elevated auditability.';
    }
    if (ctx.taskType === 'tool_chain') {
      return 'Execution appears only partially visible, but the observed output is still plausibly defensible.';
    }
    return 'Plan is broadly defensible but still carries observability caveats or other recoverable plan-level gaps.';
  }

  if (verdict === 'HOLD') {
    if (ctx.dissentKind === 'observability') {
      return 'Answer may be defensible, but unresolved observability or provenance gaps remain too material to proceed.';
    }
    return 'Plan may be defensible, but unresolved structural gaps remain and should be reviewed before proceeding.';
  }

  if (ctx.hardStopClasses.includes('factual_failure')) {
    return 'Trace contains a wrong outcome, so the result is not defensible.';
  }
  if (ctx.hardStopClasses.includes('exact_string_mismatch')) {
    return 'Trace appears semantically related, but it fails an exact-string or quote-style requirement and should be reviewed before proceeding.';
  }
  if (ctx.hardStopClasses.includes('fabricated_support')) {
    return 'Trace contains fabricated or unsupported support, so the result is not defensible.';
  }
  if (ctx.hardStopClasses.includes('broken_execution')) {
    return 'Trace contains a broken execution path, so the result is not defensible.';
  }
  if (ctx.hardStopClasses.includes('provenance_absence_claim')) {
    return 'Trace makes an absence-style retrieval claim without sufficient evidence, so the result is not defensible.';
  }

  return findings.some((finding) => finding.type === 'wrong_answer')
    ? 'Plan-level policy found a wrong outcome, so the strategy is not defensible as-is.'
    : 'Plan-level policy found blocking issues, so the strategy is not defensible as-is.';
}

export function evaluatePlanPolicy(
  record: PlanRecord,
  support: MergedSupportResult,
  mergedRiskFlags: RiskFlag[],
  options?: ExperimentalPolicyOptions,
): PlanPolicyResult {
  const findings: PolicyFinding[] = [];
  const taskDetection = deriveTaskType(record);
  const wrongAnswers = collectRecordFlags(record, 'wrong_answer');

  if (wrongAnswers.length > 0) {
    findings.push({
      id: `policy:wrong_answer:${record.traceId}`,
      type: 'wrong_answer',
      severity: 'high',
      description: 'The agent answer does not match the known correct answer, so the overall plan outcome is not defensible.',
      stepIds: wrongAnswers.flatMap((flag) => (flag.stepId ? [flag.stepId] : [])),
      count: wrongAnswers.length,
    });
  } else if (!record.metadata.verified) {
    findings.push({
      id: `policy:unverifiable:${record.traceId}`,
      type: 'unverifiable',
      severity: 'low',
      description: 'The final answer could not be verified against a known ground truth, so plan quality is assessable but outcome correctness remains unresolved.',
      stepIds: [],
      count: 1,
    });
  }

  const trulyMissingFlags = mergedRiskFlags.filter((flag) => flag.type === 'truly_missing_step');
  if (trulyMissingFlags.length > 0) {
    findings.push({
      id: `policy:truly_missing:${record.traceId}`,
      type: 'truly_missing_step',
      severity: support.trulyMissingCount >= 2 || support.mergedCoverage < 0.75 ? 'high' : 'medium',
      description: `${support.trulyMissingCount} annotator step(s) remain uncovered even after plan, execution, and segment-aware support are combined.`,
      stepIds: trulyMissingFlags.flatMap((flag) => (flag.stepId ? [flag.stepId] : [])),
      count: support.trulyMissingCount,
    });
  }

  const planGapFlags = mergedRiskFlags.filter((flag) => flag.type === 'plan_gap');
  if (planGapFlags.length > 0) {
    findings.push({
      id: `policy:plan_gap:${record.traceId}`,
      type: 'plan_gap',
      severity: support.executionOnlyCount >= 2 ? 'medium' : 'low',
      description: `${support.executionOnlyCount} annotator step(s) were only supported by execution, not by the stated plan.`,
      stepIds: planGapFlags.flatMap((flag) => (flag.stepId ? [flag.stepId] : [])),
      count: support.executionOnlyCount,
    });
  }

  const toolFailures = collectRecordFlags(record, 'tool_failure');
  if (toolFailures.length > 0) {
    findings.push({
      id: `policy:tool_failure:${record.traceId}`,
      type: 'tool_failure',
      severity: toolFailures.some((flag) => flag.severity === 'high') ? 'high' : 'medium',
      description: `${toolFailures.length} tool failure flag(s) were raised in the underlying trace.`,
      stepIds: toolFailures.flatMap((flag) => (flag.stepId ? [flag.stepId] : [])),
      count: toolFailures.length,
    });
  }

  const hallucinations = collectRecordFlags(record, 'hallucination');
  if (hallucinations.length > 0) {
    findings.push({
      id: `policy:hallucination:${record.traceId}`,
      type: 'hallucination',
      severity: hallucinations.some((flag) => flag.severity === 'high') ? 'high' : 'medium',
      description: `${hallucinations.length} hallucination flag(s) were raised in the underlying trace.`,
      stepIds: hallucinations.flatMap((flag) => (flag.stepId ? [flag.stepId] : [])),
      count: hallucinations.length,
    });
  }

  if (support.mergedCoverage < DEFAULT_POLICY_COVERAGE_THRESHOLD) {
    findings.push({
      id: `policy:coverage:${record.traceId}`,
      type: 'coverage',
      severity:
        support.mergedCoverage < DEFAULT_POLICY_HIGH_RISK_COVERAGE_THRESHOLD
          ? 'high'
          : support.mergedCoverage < 0.7
            ? 'medium'
            : 'low',
      description: `Merged plan support coverage is ${(support.mergedCoverage * 100).toFixed(1)}%, leaving non-trivial structural uncertainty.`,
      stepIds: [],
      count: Math.max(1, support.trulyMissingCount + support.executionOnlyCount),
    });
  }

  const ctx = derivePolicyContext(record, support, findings, taskDetection, options);

  let verdict: DecisionSurface;
  switch (ctx.taskType) {
    case 'deterministic':
      verdict = evaluateDeterministicPolicy(ctx, findings);
      break;
    case 'retrieval':
      verdict = evaluateRetrievalPolicy(ctx, findings);
      break;
    case 'tool_chain':
      verdict = evaluateToolChainPolicy(ctx, findings);
      break;
    case 'mixed':
      verdict = evaluateMixedPolicy(ctx, findings);
      break;
    default:
      verdict = evaluateFallbackPolicy(ctx, findings);
      break;
  }

  const summary = buildPolicySummary(verdict, ctx, findings);

  return {
    traceId: record.traceId,
    verdict,
    findings,
    summary,
    metrics: {
      verified: record.metadata.verified,
      taskType: ctx.taskType,
      taskTypeConfidence: ctx.taskTypeConfidence,
      mergedCoverage: support.mergedCoverage,
      trulyMissingCount: support.trulyMissingCount,
      executionOnlyCount: support.executionOnlyCount,
      segmentOnlyCount: support.segmentOnlyCount,
      traceVerifiability: ctx.traceVerifiability,
      answerConfidence: ctx.answerConfidence,
      answerExternallyCheckable: ctx.answerExternallyCheckable,
      answerCorrectBySanityCheck: ctx.answerCorrectBySanityCheck,
      provenanceChainComplete: ctx.provenanceChainComplete,
      executionChainStatus: ctx.executionChainStatus,
      dissentKind: ctx.dissentKind,
      hardStopClasses: ctx.hardStopClasses,
      sourceClaimSupport: ctx.sourceClaimSupport,
      sourceClaimConfidence: ctx.sourceClaimConfidence,
      sourceClaimExactStringQuestion: ctx.sourceClaimExactStringQuestion,
    },
  };
}

export function formatPlanPolicyReport(result: PlanPolicyResult): string {
  const lines = [
    `traceId: ${result.traceId}`,
    `verdict: ${result.verdict}`,
    `summary: ${result.summary}`,
    `verified: ${result.metrics.verified}`,
    `taskType: ${result.metrics.taskType}`,
    `taskTypeConfidence: ${result.metrics.taskTypeConfidence}`,
    `mergedCoverage: ${result.metrics.mergedCoverage.toFixed(3)}`,
    `trulyMissingCount: ${result.metrics.trulyMissingCount}`,
    `executionOnlyCount: ${result.metrics.executionOnlyCount}`,
    `segmentOnlyCount: ${result.metrics.segmentOnlyCount}`,
    `traceVerifiability: ${result.metrics.traceVerifiability}`,
    `answerConfidence: ${result.metrics.answerConfidence}`,
    `answerExternallyCheckable: ${result.metrics.answerExternallyCheckable}`,
    `answerCorrectBySanityCheck: ${result.metrics.answerCorrectBySanityCheck}`,
    `provenanceChainComplete: ${result.metrics.provenanceChainComplete}`,
    `executionChainStatus: ${result.metrics.executionChainStatus}`,
    `dissentKind: ${result.metrics.dissentKind}`,
    `hardStopClasses: ${result.metrics.hardStopClasses.length > 0 ? result.metrics.hardStopClasses.join(', ') : 'none'}`,
    `sourceClaimSupport: ${result.metrics.sourceClaimSupport ?? 'none'}`,
    `sourceClaimConfidence: ${result.metrics.sourceClaimConfidence ?? 'none'}`,
    `sourceClaimExactStringQuestion: ${result.metrics.sourceClaimExactStringQuestion}`,
  ];

  if (result.findings.length === 0) {
    lines.push('findings: none');
  } else {
    lines.push('findings:');
    for (const finding of result.findings) {
      lines.push(
        `- [${finding.severity}] ${finding.type} x${finding.count}: ${finding.description}`,
      );
    }
  }

  return lines.join('\n');
}

export function buildPlanPolicyBatchExport(results: PlanPolicyResult[]): PlanPolicyBatchExport {
  const verdictCounts: Record<DecisionSurface, number> = {
    ALLOW: 0,
    CONDITIONAL_ALLOW: 0,
    HOLD: 0,
    BLOCK: 0,
  };

  for (const result of results) {
    verdictCounts[result.verdict] += 1;
  }

  return {
    schemaVersion: 'plan-policy-report/v2',
    count: results.length,
    verdictCounts,
    results,
  };
}

export function formatPlanPolicyBatchReport(results: PlanPolicyResult[]): string {
  const batch = buildPlanPolicyBatchExport(results);

  const header = [
    `count: ${batch.count}`,
    `ALLOW: ${batch.verdictCounts.ALLOW}`,
    `CONDITIONAL_ALLOW: ${batch.verdictCounts.CONDITIONAL_ALLOW}`,
    `HOLD: ${batch.verdictCounts.HOLD}`,
    `BLOCK: ${batch.verdictCounts.BLOCK}`,
    '',
  ];

  return header.concat(results.map((result) => formatPlanPolicyReport(result)).join('\n\n---\n\n')).join('\n');
}
