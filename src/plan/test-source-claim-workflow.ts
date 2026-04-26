import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { planBuildSourceClaimMapCommand } from '../commands/plan-build-source-claim-map.js';
import { buildFirstPartySourceClaimMap } from './source-claim-map.js';

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./__fixtures__/hard-v2-threshold/${name}`, import.meta.url));
}

test('planBuildSourceClaimMapCommand derives exact/high source-claim support from hard-v2 fixtures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pot-cli-source-claim-'));
  const outFile = join(dir, 'source-claim.json');

  await planBuildSourceClaimMapCommand(fixturePath('traces.jsonl'), {
    goldMap: fixturePath('fine-gold.json'),
    out: outFile,
  });

  // After 7c3cf87: hard-H04 trace was removed from fixtures.
  // Only hard-H01 and hard-H07 remain.
  const payload = JSON.parse(readFileSync(outFile, 'utf8'));
  assert.equal(payload['hard-H01'].support, 'exact');
  assert.equal(payload['hard-H01'].confidence, 'high');
  assert.equal(payload['hard-H01'].exactStringQuestion, false);
  assert.match(payload['hard-H01'].explanation, /found verbatim in source/i);

  assert.equal(payload['hard-H07'].support, 'exact');
  assert.equal(payload['hard-H07'].confidence, 'high');
  assert.equal(payload['hard-H07'].exactStringQuestion, false);
  assert.match(payload['hard-H07'].explanation, /found verbatim in source/i);
});

test('planBuildSourceClaimMapCommand can enrich source pages before source-claim assessment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pot-cli-source-claim-enrich-'));
  const inputFile = join(dir, 'input.jsonl');
  const goldFile = join(dir, 'gold.json');
  const outFile = join(dir, 'source-claim.json');

  writeFileSync(inputFile, `${JSON.stringify({
    task_id: 'trace-1',
    level: '1',
    question: "According to CISA's catalog page, what does KEV stand for?",
    model: 'test-model',
    answer: 'Known Exploited Vulnerabilities',
    annotator_metadata: {
      source_url: 'https://example.test/kev',
    },
    trace: {
      steps: [
        { index: 1, kind: 'browse', tool: 'web_fetch', summary: 'opened the official catalog page', evidence: ['official catalog page loaded'] },
        { index: 2, kind: 'answer', tool: null, summary: 'returned Known Exploited Vulnerabilities', evidence: [] },
      ],
    },
  })}\n`);

  writeFileSync(goldFile, JSON.stringify({
    'trace-1': {
      ground_truth: 'Known Exploited Vulnerabilities',
      annotator_steps: [
        "Open CISA's Known Exploited Vulnerabilities Catalog page.",
        'Use the page title to identify what KEV stands for.',
        'Return Known Exploited Vulnerabilities.',
      ],
      annotator_tools: ['Web browser'],
    },
  }, null, 2));

  await planBuildSourceClaimMapCommand(inputFile, {
    goldMap: goldFile,
    out: outFile,
    enrichSourcePages: true,
    sourcePageFetcher: async () => '<html><head><title>Known Exploited Vulnerabilities Catalog | CISA</title></head><body><h1>Known Exploited Vulnerabilities Catalog</h1></body></html>',
  });

  const payload = JSON.parse(readFileSync(outFile, 'utf8'));
  assert.equal(payload['trace-1'].support, 'exact');
  assert.equal(payload['trace-1'].confidence, 'high');
});

test('buildFirstPartySourceClaimMap does not treat agent summaries as source evidence', () => {
  const payload = buildFirstPartySourceClaimMap([
    {
      task_id: 'summary-leak',
      level: '1',
      question: 'What is the status phrase exactly as it appears?',
      model: 'test-model',
      answer: 'Upgrade Required',
      ground_truth: 'Upgrade Required',
      trace: {
        steps: [
          {
            index: 1,
            kind: 'read',
            tool: 'internal',
            summary: 'The answer is Upgrade Required.',
            evidence: ['RFC section located but no exact phrase captured here.'],
          },
        ],
      },
    },
  ]);

  assert.equal(payload['summary-leak'].support, 'unsupported');
  assert.equal(payload['summary-leak'].confidence, 'high');
  assert.equal(payload['summary-leak'].exactStringQuestion, true);
  assert.match(payload['summary-leak'].explanation, /no verbatim or high-overlap match/i);
});
