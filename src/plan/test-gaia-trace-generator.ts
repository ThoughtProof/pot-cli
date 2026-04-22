import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFirstPartyTrace,
  coerceGeneratedTracePayload,
  extractJsonObject,
  normalizeGaiaSample,
} from './gaia-trace-generator.js';

test('normalizeGaiaSample accepts mixed GAIA input shapes', () => {
  const sample = normalizeGaiaSample({
    task_id: 'gaia-1',
    Question: 'What is 2 + 2?',
    Final_answer: '4',
    file_path: '/tmp/input.pdf',
    Annotator_Metadata: { Steps: '1. Read\n2. Answer' },
  });

  assert.equal(sample.task_id, 'gaia-1');
  assert.equal(sample.question, 'What is 2 + 2?');
  assert.equal(sample.groundTruth, '4');
  assert.deepEqual(sample.attachments, [{ path: '/tmp/input.pdf' }]);
  assert.deepEqual(sample.annotatorMetadata, { Steps: '1. Read\n2. Answer' });
});

test('normalizeGaiaSample accepts GAIA samples with spaced Annotator Metadata key', () => {
  const sample = normalizeGaiaSample({
    task_id: 'gaia-1b',
    Question: 'What is 3 + 3?',
    'Final answer': '6',
    'Annotator Metadata': { Steps: '1. Read\n2. Answer' },
  });

  assert.equal(sample.groundTruth, '6');
  assert.deepEqual(sample.annotatorMetadata, { Steps: '1. Read\n2. Answer' });
});

test('coerceGeneratedTracePayload normalizes steps and appends a final answer step', () => {
  const payload = coerceGeneratedTracePayload({
    answer: '42',
    steps: [
      { kind: 'Search', tool: 'web_search', summary: 'Looked up the number.' },
      { kind: 'unknown_kind', summary: 'Reasoned about the evidence.' },
    ],
  });

  assert.equal(payload.answer, '42');
  assert.equal(payload.steps.length, 3);
  assert.equal(payload.steps[0]?.index, 1);
  assert.equal(payload.steps[0]?.kind, 'search');
  assert.equal(payload.steps[1]?.kind, 'reason');
  assert.equal(payload.steps[2]?.kind, 'answer');
});

test('buildFirstPartyTrace emits benchmark-ready first-party traces', () => {
  const sample = normalizeGaiaSample({
    task_id: 'gaia-2',
    level: '2',
    question: 'What is the capital of France?',
    ground_truth: 'Paris',
    annotator_metadata: { Steps: '1. Recall the capital' },
  });

  const trace = buildFirstPartyTrace(sample, {
    answer: 'Paris',
    notes: 'Simple factual recall.',
    steps: [
      { kind: 'reason', tool: 'internal', summary: 'Recalled the capital of France.' },
      { kind: 'answer', summary: 'Submitted Paris.' },
    ],
  }, 'claude-sonnet-4-5');

  assert.equal(trace.task_id, 'gaia-2');
  assert.equal(trace.level, '2');
  assert.equal(trace.model, 'claude-sonnet-4-5');
  assert.equal(trace.answer, 'Paris');
  assert.equal(trace.final_correct, true);
  assert.equal(trace.trace.steps.length, 2);
  assert.equal(trace.trace.notes, 'Simple factual recall.');
});

test('extractJsonObject accepts fenced json responses', () => {
  const raw = '```json\n{\n  "answer": "42",\n  "steps": []\n}\n```';
  const extracted = extractJsonObject(raw);

  assert.equal(extracted.trim(), '{\n  "answer": "42",\n  "steps": []\n}');
});
