/**
 * Minimal structural validation for PlanRecord.
 *
 * Returns a list of human-readable error strings.  An empty array means the
 * record is valid enough to be used downstream.
 *
 * Intentionally lightweight — no heavy schema library needed for Milestone A.
 */

import type {
  PlanRecord,
  PlanStep,
  PlanEdge,
  InformationFlow,
  RiskFlag,
} from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlanRecord(record: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['record is not an object'], warnings };
  }

  const r = record as Partial<PlanRecord>;

  // Required string fields
  for (const key of ['id', 'traceId', 'extractedAt'] as const) {
    if (typeof r[key] !== 'string' || r[key] === '') {
      errors.push(`record.${key} must be a non-empty string`);
    }
  }

  if (typeof r.extractedAt === 'string' && Number.isNaN(Date.parse(r.extractedAt))) {
    errors.push('record.extractedAt must be a valid ISO 8601 date string');
  }

  // Goal
  if (!r.goal || typeof r.goal !== 'object') {
    errors.push('record.goal is missing or not an object');
  } else {
    const g = r.goal;
    if (typeof g.id !== 'string' || g.id === '') errors.push('goal.id is empty');
    if (typeof g.description !== 'string' || g.description === '')
      errors.push('goal.description is empty');
    if (typeof g.taskId !== 'string' || g.taskId === '')
      errors.push('goal.taskId is empty');
    validateProvenance(g.provenance, 'goal.provenance', errors);
  }

  // Steps
  if (!Array.isArray(r.steps)) {
    errors.push('record.steps must be an array');
  } else {
    if (r.steps.length === 0) {
      warnings.push('record.steps is empty — no plan steps extracted');
    }
    const stepIds = new Set<string>();
    for (const step of r.steps as PlanStep[]) {
      if (typeof step.id !== 'string') {
        errors.push(`step is missing id: ${JSON.stringify(step).slice(0, 40)}`);
        continue;
      }
      if (stepIds.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
      stepIds.add(step.id);
      if (!['annotator', 'agent:plan', 'agent:exec'].includes(step.group)) {
        errors.push(`step ${step.id}: group must be annotator|agent:plan|agent:exec`);
      }
      if (typeof step.index !== 'number' || step.index < 1)
        errors.push(`step ${step.id}: index must be a positive number`);
      if (typeof step.description !== 'string' || step.description === '')
        errors.push(`step ${step.id}: description is empty`);
      if (!Array.isArray(step.toolsUsed))
        errors.push(`step ${step.id}: toolsUsed must be an array`);
      validateProvenance(step.provenance, `step[${step.id}].provenance`, errors);
    }

    // Edges / flows / risk flags reference valid step ids
    const allStepIds = new Set((r.steps as PlanStep[]).map((s) => s.id));
    for (const edge of (r.edges ?? []) as PlanEdge[]) {
      if (!allStepIds.has(edge.from) && edge.from !== 'goal')
        errors.push(`edge ${edge.id}: from "${edge.from}" not a valid step id`);
      if (!allStepIds.has(edge.to) && edge.to !== 'final_answer')
        errors.push(`edge ${edge.id}: to "${edge.to}" not a valid step id`);
      validateProvenance(edge.provenance, `edge[${edge.id}].provenance`, errors);
    }

    for (const flow of (r.informationFlows ?? []) as InformationFlow[]) {
      if (!allStepIds.has(flow.fromStep) && flow.fromStep !== 'goal')
        errors.push(`informationFlow ${flow.id}: fromStep "${flow.fromStep}" not a valid step id`);
      if (!allStepIds.has(flow.toStep) && flow.toStep !== 'final_answer')
        errors.push(`informationFlow ${flow.id}: toStep "${flow.toStep}" not a valid step id`);
      if (typeof flow.description !== 'string' || flow.description === '') {
        errors.push(`informationFlow ${flow.id}: description is empty`);
      }
      validateProvenance(flow.provenance, `informationFlow[${flow.id}].provenance`, errors);
    }

    for (const flag of (r.riskFlags ?? []) as RiskFlag[]) {
      if (flag.stepId && !allStepIds.has(flag.stepId)) {
        errors.push(`riskFlag ${flag.id}: stepId "${flag.stepId}" not a valid step id`);
      }
      if (typeof flag.description !== 'string' || flag.description === '') {
        errors.push(`riskFlag ${flag.id}: description is empty`);
      }
      validateProvenance(flag.provenance, `riskFlag[${flag.id}].provenance`, errors);
    }
  }

  // Metadata
  if (!r.metadata || typeof r.metadata !== 'object') {
    errors.push('record.metadata is missing');
  } else {
    const m = r.metadata;
    if (typeof m.verified !== 'boolean') errors.push('metadata.verified must be boolean');
    if (typeof m.totalDurationSeconds !== 'number')
      errors.push('metadata.totalDurationSeconds must be a number');
    if (m.totalDurationSeconds === 0) {
      warnings.push('metadata.totalDurationSeconds is 0 — duration parse may have failed or trace was near-instant');
    }
    if (typeof m.agentAnswer !== 'string')
      errors.push('metadata.agentAnswer must be a string');
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateProvenance(
  prov: unknown,
  path: string,
  errors: string[],
): void {
  if (!prov || typeof prov !== 'object') {
    errors.push(`${path} is missing`);
    return;
  }
  const p = prov as Record<string, unknown>;
  const validOrigins = ['explicit', 'inferred', 'annotator'];
  if (!validOrigins.includes(p['origin'] as string))
    errors.push(`${path}.origin must be one of ${validOrigins.join('|')}`);
  if (typeof p['sourceEvidence'] !== 'string' || p['sourceEvidence'] === '')
    errors.push(`${path}.sourceEvidence must be a non-empty string`);
  if (
    typeof p['confidence'] !== 'number' ||
    (p['confidence'] as number) < 0 ||
    (p['confidence'] as number) > 1
  )
    errors.push(`${path}.confidence must be a number in [0,1]`);
}
