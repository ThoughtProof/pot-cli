import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeFirstPartyGaiaTrace,
  parseFirstPartyGaiaTraceJsonl,
  parseNumberedList,
  type FirstPartyGaiaTrace,
} from './first-party-traces.js';

test('parseNumberedList handles numbered and Step-prefixed lines', () => {
  assert.deepEqual(
    parseNumberedList('1. Search\nStep 2: Calculate\n- Answer'),
    ['Search', 'Calculate', 'Answer'],
  );
});

test('parseFirstPartyGaiaTraceJsonl ignores blank lines', () => {
  const raw = `${JSON.stringify({ task_id: 'a', question: 'q', answer: '1', trace: { steps: [] } })}\n\n${JSON.stringify({ task_id: 'b', question: 'q2', answer: '2', trace: { steps: [] } })}\n`;
  const parsed = parseFirstPartyGaiaTraceJsonl(raw);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].task_id, 'a');
  assert.equal(parsed[1].task_id, 'b');
});

test('canonicalizeFirstPartyGaiaTrace builds a PlanRecord and flags wrong answers', () => {
  const trace: FirstPartyGaiaTrace = {
    task_id: 'demo-task',
    level: '2',
    question: 'How many apples are left?',
    answer: '4',
    ground_truth: '3',
    model: 'anthropic/claude-sonnet-4-6',
    annotator_metadata: {
      Steps: '1. Count the starting apples\n2. Remove the eaten apples\n3. Return the remainder',
      Tools: '1. calculator',
      'Number of steps': '3',
      'Number of tools': '1',
    },
    trace: {
      steps: [
        { index: 1, kind: 'observe', tool: 'calculator', summary: 'Counted the starting apples.' },
        { index: 2, kind: 'calculate', tool: 'calculator', summary: 'Subtracted the eaten apples from the total.' },
        { index: 3, kind: 'answer', summary: 'Returned the remaining apple count.' },
      ],
    },
  };

  const record = canonicalizeFirstPartyGaiaTrace(trace, { extractedAt: '2026-04-20T10:00:00.000Z' });

  assert.equal(record.id, 'plan:demo-task');
  assert.equal(record.traceId, 'demo-task');
  assert.equal(record.extractedAt, '2026-04-20T10:00:00.000Z');
  assert.equal(record.steps.filter((step) => step.group === 'annotator').length, 3);
  assert.equal(record.steps.filter((step) => step.group === 'agent:plan').length, 2);
  assert.equal(record.steps.filter((step) => step.group === 'agent:exec').length, 3);
  assert.equal(record.metadata.agentModel, 'anthropic/claude-sonnet-4-6');
  assert.equal(record.metadata.annotatorStepCount, 3);
  assert.equal(record.metadata.annotatorToolCount, 1);
  assert.equal(record.metadata.verified, false);
  assert.ok(record.riskFlags.some((flag) => flag.type === 'wrong_answer'));
  assert.ok(record.informationFlows.some((flow) => flow.id === 'flow:exec_to_final_answer'));
});
