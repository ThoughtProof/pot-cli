import test from 'node:test';
import assert from 'node:assert/strict';

import { firstPartyTraceToPlanRecord } from './first-party-adapter.js';

test('firstPartyTraceToPlanRecord maps a correct trace into a PlanRecord', () => {
  const record = firstPartyTraceToPlanRecord({
    task_id: 'task-1',
    level: '1',
    question: 'What is 2 + 2?',
    model: 'test-model',
    answer: '4',
    ground_truth: '4',
    final_correct: true,
    annotator_metadata: {
      Steps: '1. Read the question\n2. Calculate the answer',
      Tools: '1. Calculator',
    },
    trace: {
      steps: [
        {
          index: 1,
          kind: 'read',
          tool: 'web_fetch',
          summary: 'Read the question.',
        },
        {
          index: 2,
          kind: 'calculate',
          tool: 'internal',
          summary: 'Computed 2 + 2 = 4.',
        },
        {
          index: 3,
          kind: 'answer',
          tool: 'internal',
          summary: 'Returned 4.',
        },
      ],
    },
  });

  assert.equal(record.goal.taskId, 'task-1');
  assert.equal(record.metadata.agentAnswer, '4');
  assert.equal(record.metadata.verified, true);
  assert.equal(record.riskFlags.length, 0);

  const annotatorSteps = record.steps.filter((step) => step.group === 'annotator');
  const planSteps = record.steps.filter((step) => step.group === 'agent:plan');
  const execSteps = record.steps.filter((step) => step.group === 'agent:exec');

  assert.equal(annotatorSteps.length, 2);
  assert.equal(planSteps.length, 2, 'answer step should be excluded from inferred plan');
  assert.equal(execSteps.length, 3);
  assert.equal(record.metadata.annotatorToolCount, 1);
  assert.deepEqual(annotatorSteps.map((step) => step.toolsUsed), [[], []]);
});

test('firstPartyTraceToPlanRecord does not raise wrong_answer when ground truth is missing', () => {
  const record = firstPartyTraceToPlanRecord({
    task_id: 'task-missing-ground-truth',
    level: '1',
    question: 'What is 2 + 2?',
    model: 'test-model',
    answer: '4',
    trace: {
      steps: [
        {
          index: 1,
          kind: 'answer',
          tool: 'internal',
          summary: 'Returned 4.',
        },
      ],
    },
  });

  assert.equal(record.metadata.verified, false);
  assert.equal(record.riskFlags.length, 0);
});

test('firstPartyTraceToPlanRecord flags wrong answers', () => {
  const record = firstPartyTraceToPlanRecord({
    task_id: 'task-2',
    level: '1',
    question: 'What is 2 + 2?',
    model: 'test-model',
    answer: '5',
    ground_truth: '4',
    trace: {
      steps: [
        {
          index: 1,
          kind: 'answer',
          tool: 'internal',
          summary: 'Returned 5.',
        },
      ],
    },
  });

  assert.equal(record.metadata.verified, false);
  assert.equal(record.riskFlags.length, 1);
  assert.equal(record.riskFlags[0]?.type, 'wrong_answer');
});
