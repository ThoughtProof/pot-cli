import type {
  GoalNode,
  InformationFlow,
  PlanEdge,
  PlanRecord,
  PlanStep,
  Provenance,
  RiskFlag,
} from './types.js';

export interface FirstPartyTraceStep {
  index: number;
  kind: 'observe' | 'search' | 'browse' | 'read' | 'reason' | 'calculate' | 'answer';
  tool?: string | null;
  summary: string;
  evidence?: string[];
}

export interface FirstPartyGaiaTrace {
  task_id: string;
  level: string | number;
  question: string;
  model: string;
  answer: string;
  ground_truth?: string | null;
  final_correct?: boolean | null;
  attachments?: Array<{ path: string; kind?: string | null }>;
  annotator_metadata?: Record<string, unknown> | null;
  trace: {
    steps: FirstPartyTraceStep[];
    notes?: string | null;
  };
}

function explicit(sourceEvidence: string, confidence = 1): Provenance {
  return { origin: 'explicit', sourceEvidence, confidence };
}

function inferred(sourceEvidence: string, confidence = 0.8): Provenance {
  return { origin: 'inferred', sourceEvidence, confidence };
}

function annotator(sourceEvidence: string, confidence = 1): Provenance {
  return { origin: 'annotator', sourceEvidence, confidence };
}

function normalizeAnswer(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseAnnotatorSteps(stepsText: string | undefined): string[] {
  if (!stepsText) return [];

  return stepsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^step\s*\d+\s*:\s*/i, ''))
    .map((line) => line.replace(/^\d+\.\s*/, ''))
    .filter(Boolean);
}

function parseAnnotatorTools(toolsText: string | undefined): string[] {
  if (!toolsText) return [];

  return toolsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\.\s*/, ''));
}

function toolName(tool: string | null | undefined): string[] {
  if (!tool || tool === 'internal') return [];
  return [tool];
}

function buildSequentialEdges(stepIds: string[], prefix: string): PlanEdge[] {
  const edges: PlanEdge[] = [];
  for (let i = 0; i < stepIds.length - 1; i++) {
    edges.push({
      id: `${prefix}:edge:${i + 1}`,
      from: stepIds[i]!,
      to: stepIds[i + 1]!,
      type: 'sequential',
      provenance: inferred(`${prefix} sequential step order`),
    });
  }
  return edges;
}

export function firstPartyTraceToPlanRecord(
  input: FirstPartyGaiaTrace,
  options: { extractedAt?: string } = {},
): PlanRecord {
  const extractedAt = options.extractedAt ?? new Date().toISOString();
  const annotatorMeta = input.annotator_metadata ?? {};
  const annotatorStepsText = typeof annotatorMeta['Steps'] === 'string' ? annotatorMeta['Steps'] : undefined;
  const annotatorToolsText = typeof annotatorMeta['Tools'] === 'string' ? annotatorMeta['Tools'] : undefined;
  const annotatorStepsParsed = parseAnnotatorSteps(annotatorStepsText);
  const annotatorToolsParsed = parseAnnotatorTools(annotatorToolsText);
  const hasGroundTruth = input.ground_truth != null && String(input.ground_truth).trim().length > 0;
  const verified =
    typeof input.final_correct === 'boolean'
      ? input.final_correct
      : hasGroundTruth && normalizeAnswer(input.answer) === normalizeAnswer(input.ground_truth);

  const goal: GoalNode = {
    id: `goal:${input.task_id}`,
    description: input.question,
    taskId: input.task_id,
    trueAnswer: input.ground_truth ?? undefined,
    provenance: explicit('first-party trace question + ground_truth'),
  };

  const annotatorSteps: PlanStep[] = annotatorStepsParsed.map((description, index) => ({
    id: `annotator:step:${index + 1}`,
    group: 'annotator',
    index: index + 1,
    description,
    toolsUsed: [],
    provenance: annotator(`annotator_metadata.Steps line ${index + 1}`),
  }));

  const execSteps: PlanStep[] = input.trace.steps.map((step, index) => ({
    id: `agent:exec:step:${index + 1}`,
    group: 'agent:exec',
    index: index + 1,
    description: step.summary,
    toolsUsed: toolName(step.tool),
    provenance: explicit(`trace.steps[${index}]`),
  }));

  const inferredPlanSource = input.trace.steps.filter((step) => step.kind !== 'answer');
  const planSteps: PlanStep[] = inferredPlanSource.map((step, index) => ({
    id: `agent:plan:step:${index + 1}`,
    group: 'agent:plan',
    index: index + 1,
    description: step.summary,
    toolsUsed: toolName(step.tool),
    provenance: inferred(`trace.steps[${index}] projected into inferred plan`),
  }));

  const steps: PlanStep[] = [...annotatorSteps, ...planSteps, ...execSteps];

  const edges: PlanEdge[] = [
    ...buildSequentialEdges(annotatorSteps.map((s) => s.id), 'annotator'),
    ...buildSequentialEdges(planSteps.map((s) => s.id), 'agent:plan'),
    ...buildSequentialEdges(execSteps.map((s) => s.id), 'agent:exec'),
  ];

  const informationFlows: InformationFlow[] = [];
  if (planSteps[0]) {
    informationFlows.push({
      id: 'flow:goal_to_plan',
      fromStep: 'goal',
      toStep: planSteps[0].id,
      description: 'Question flows into inferred plan formation',
      value: input.question,
      provenance: inferred('question to inferred plan'),
    });
  }
  if (execSteps[0]) {
    informationFlows.push({
      id: 'flow:goal_to_exec',
      fromStep: 'goal',
      toStep: execSteps[0].id,
      description: 'Question flows into execution',
      value: input.question,
      provenance: inferred('question to execution'),
    });
  }
  if (execSteps[execSteps.length - 1]) {
    informationFlows.push({
      id: 'flow:exec_to_final_answer',
      fromStep: execSteps[execSteps.length - 1]!.id,
      toStep: 'final_answer',
      description: 'Execution culminates in the submitted answer',
      value: input.answer,
      provenance: explicit('answer from first-party trace'),
    });
  }

  const riskFlags: RiskFlag[] = [];
  if (hasGroundTruth && !verified) {
    riskFlags.push({
      id: 'risk:wrong_answer',
      type: 'wrong_answer',
      description: `Agent answer ${input.answer} does not match ground truth ${input.ground_truth ?? '[missing]'}.`,
      severity: 'high',
      provenance: inferred('answer vs ground_truth comparison'),
    });
  }

  return {
    id: `plan:${input.task_id}`,
    traceId: input.task_id,
    extractedAt,
    goal,
    steps,
    edges,
    informationFlows,
    riskFlags,
    metadata: {
      agentModel: input.model,
      agentAnswer: input.answer,
      annotatorStepCount: annotatorSteps.length,
      annotatorToolCount: annotatorToolsParsed.length,
      totalDurationSeconds: 0,
      verified,
    },
  };
}
