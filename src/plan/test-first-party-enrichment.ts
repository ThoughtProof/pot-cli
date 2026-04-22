import test from 'node:test';
import assert from 'node:assert/strict';

import { enrichFirstPartyTrace } from './first-party-enrichment.js';

test('enrichFirstPartyTrace marks accepted answer aliases as final_correct', () => {
  const enriched = enrichFirstPartyTrace(
    {
      task_id: 'trace-1',
      level: '1',
      question: 'What status phrase is associated with HTTP status code 426?',
      model: 'test-model',
      answer: 'upgrade required status phrase',
      trace: {
        steps: [{ index: 1, kind: 'answer', tool: 'internal', summary: 'Returned the answer.' }],
      },
    },
    {
      'trace-1': {
        ground_truth: 'Upgrade Required',
        accepted_answers: ['upgrade required status phrase'],
        annotator_steps: ['Find the status phrase.', 'Return the answer.'],
      },
    },
  );

  assert.equal(enriched.final_correct, true);
  assert.equal(enriched.annotator_metadata?.final_correct_method, 'normalized_string_exact_with_aliases');
});
