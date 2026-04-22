/**
 * Milestone A — canonicalizer integration test using the real GAIA trace.
 *
 * Run after `npm run build` via:
 *   node dist/plan/test-canonicalizer.js
 *
 * Uses Node's built-in `node:test` (available since Node 18).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeGaiaTrace } from './canonicalizer.js';
import { validatePlanRecord } from './validate.js';
import type { GaiaTrace } from './gaia-trace-types.js';

// ---------------------------------------------------------------------------
// Load fixture
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dir, '__fixtures__', 'gaia-0035.json');
const rawTrace = JSON.parse(readFileSync(fixturePath, 'utf8')) as GaiaTrace;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('trace loads and has expected trace_id', () => {
  assert.equal(rawTrace.trace_id, '0035f455b3ff2295167a844f04d85d34');
  assert.ok(Array.isArray(rawTrace.spans), 'spans must be an array');
  assert.ok(rawTrace.spans.length > 0, 'must have at least one span');
});

test('canonicalizeGaiaTrace returns a PlanRecord without throwing', () => {
  const record = canonicalizeGaiaTrace(rawTrace, {
    extractedAt: '2025-03-19T16:33:57.000Z',
  });
  assert.ok(record, 'canonicalizer must return a record');
  assert.equal(typeof record, 'object');
  assert.equal(record.extractedAt, '2025-03-19T16:33:57.000Z');
});

test('PlanRecord has correct ids', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  assert.equal(record.traceId, '0035f455b3ff2295167a844f04d85d34');
  assert.equal(record.id, 'plan:0035f455b3ff2295167a844f04d85d34');
});

test('goal is extracted from get_examples_to_answer span', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  assert.ok(
    record.goal.description.includes('Finding Nemo'),
    `Expected "Finding Nemo" in goal description, got: ${record.goal.description.slice(0, 100)}`,
  );
  assert.equal(record.goal.taskId, '17b5a6a3-bc87-42e8-b0fb-6ab0781ef2cc');
  assert.equal(record.goal.trueAnswer, '34689');
  assert.equal(record.goal.provenance.origin, 'explicit');
  assert.ok(record.goal.provenance.confidence >= 0.9);
});

test('annotator steps are extracted with annotator provenance', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const annotatorSteps = record.steps.filter((s) =>
    s.id.startsWith('annotator:'),
  );
  assert.ok(
    annotatorSteps.length >= 9,
    `Expected at least 9 annotator steps, got ${annotatorSteps.length}`,
  );
  for (const step of annotatorSteps) {
    assert.equal(step.group, 'annotator');
    assert.equal(step.provenance.origin, 'annotator');
    assert.ok(step.provenance.confidence >= 0.9);
    assert.ok(step.description.length > 0, 'step description must not be empty');
  }
});

test('agent plan steps are extracted with explicit provenance', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const agentPlanSteps = record.steps.filter((s) =>
    s.id.startsWith('agent:plan:'),
  );
  assert.ok(
    agentPlanSteps.length >= 3,
    `Expected at least 3 agent plan steps, got ${agentPlanSteps.length}`,
  );
  for (const step of agentPlanSteps) {
    assert.equal(step.group, 'agent:plan');
    assert.ok(['explicit', 'inferred'].includes(step.provenance.origin));
    assert.ok(step.description.length > 0);
  }
});

test('execution steps are extracted from CodeAgent spans', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const execSteps = record.steps.filter((s) => s.id.startsWith('agent:exec:'));
  assert.ok(
    execSteps.length >= 1,
    `Expected at least 1 execution step, got ${execSteps.length}`,
  );
  for (const step of execSteps) {
    assert.equal(step.group, 'agent:exec');
    assert.equal(step.provenance.origin, 'explicit');
    assert.ok(step.spanId, 'execution steps should have a spanId');
  }
});

test('edges are built sequentially between annotator steps', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const annotatorEdges = record.edges.filter((e) =>
    e.id.startsWith('annotator:'),
  );
  const annotatorSteps = record.steps.filter((s) =>
    s.id.startsWith('annotator:'),
  );
  assert.equal(
    annotatorEdges.length,
    Math.max(0, annotatorSteps.length - 1),
    'Should have N-1 sequential edges for N annotator steps',
  );
  for (const edge of annotatorEdges) {
    assert.equal(edge.type, 'sequential');
    assert.equal(edge.provenance.origin, 'inferred');
  }
});

test('information flows connect goal → plan → execution → final_answer', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  assert.ok(record.informationFlows.length >= 2, 'Expected at least 2 information flows');

  const factsToPlan = record.informationFlows.find(
    (f) => f.id === 'flow:facts:to:plan',
  );
  assert.ok(factsToPlan, 'flow:facts:to:plan should exist');
  assert.ok(factsToPlan!.fromStep.startsWith('agent:plan:facts:'));

  const finalAnswerFlow = record.informationFlows.find(
    (f) => f.toStep === 'final_answer',
  );
  assert.ok(finalAnswerFlow, 'flow to final_answer should exist');
});

test('wrong_answer risk flag is raised when agent answer ≠ true answer', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  // Agent said 33149, true answer is 34689
  const wrongFlag = record.riskFlags.find((f) => f.type === 'wrong_answer');
  assert.ok(wrongFlag, 'wrong_answer risk flag must be present');
  assert.equal(wrongFlag!.severity, 'high');
  assert.equal(wrongFlag!.provenance.origin, 'inferred');
  assert.ok(wrongFlag!.provenance.confidence <= 0.7);
  assert.ok(wrongFlag!.description.includes('34689'), 'flag must mention true answer');
});

test('fewer_steps risk flag is raised because agent ran fewer steps than annotator', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const fewerFlag = record.riskFlags.find((f) => f.type === 'missing_step');
  assert.ok(fewerFlag, 'missing_step risk flag must be present');
});

test('metadata reflects correct agent model and verified=false', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  assert.equal(record.metadata.verified, false);
  assert.ok(
    record.metadata.agentModel.includes('o3') ||
      record.metadata.agentModel === 'unknown',
    `Unexpected agentModel: ${record.metadata.agentModel}`,
  );
  assert.ok(record.metadata.totalDurationSeconds > 0);
  assert.equal(record.metadata.annotatorStepCount, 10);
  assert.equal(record.metadata.annotatorToolCount, 2);
});

test('validatePlanRecord passes for canonicalized record', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const result = validatePlanRecord(record);
  if (!result.valid) {
    console.error('Validation errors:', result.errors);
  }
  assert.ok(
    result.valid,
    `PlanRecord validation failed:\n${result.errors.join('\n')}`,
  );
});

test('all steps have valid provenance', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  for (const step of record.steps) {
    const p = step.provenance;
    assert.ok(['explicit', 'inferred', 'annotator'].includes(p.origin));
    assert.ok(p.sourceEvidence.length > 0, `step ${step.id} has empty sourceEvidence`);
    assert.ok(
      p.confidence >= 0 && p.confidence <= 1,
      `step ${step.id} confidence out of range: ${p.confidence}`,
    );
  }
});

test('falls back cleanly when get_examples_to_answer span is missing', () => {
  const mutated: GaiaTrace = {
    ...rawTrace,
    spans: rawTrace.spans.map((span) => ({
      ...span,
      child_spans: span.child_spans.filter((child) => child.span_name !== 'get_examples_to_answer'),
    })),
  };
  const record = canonicalizeGaiaTrace(mutated);
  assert.equal(record.goal.provenance.origin, 'inferred');
  assert.equal(record.goal.taskId, mutated.trace_id);
});

test('invalid duration does not break canonicalization', () => {
  const mutated: GaiaTrace = {
    ...rawTrace,
    spans: rawTrace.spans.map((span, index) =>
      index === 0 ? { ...span, duration: 'not-a-duration' } : span,
    ),
  };
  const record = canonicalizeGaiaTrace(mutated);
  const result = validatePlanRecord(record);
  assert.equal(record.metadata.totalDurationSeconds, 0);
  assert.ok(result.warnings.some((warning) => warning.includes('totalDurationSeconds is 0')));
});
