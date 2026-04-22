import test from 'node:test';
import assert from 'node:assert/strict';
import type { FirstPartyGaiaTrace } from './first-party-adapter.js';
import {
  extractSourcePageMetadata,
  enrichFirstPartyTracesWithSourcePageMetadata,
} from './source-page-enrichment.js';

test('extractSourcePageMetadata returns cleaned title and h1 text', () => {
  const html = `
    <html>
      <head><title>About &#8211; Open Source Security Foundation</title></head>
      <body><h1>OpenSSF About</h1></body>
    </html>
  `;

  const result = extractSourcePageMetadata(html);
  assert.equal(result.title, 'About – Open Source Security Foundation');
  assert.equal(result.h1, 'OpenSSF About');
});

test('extractSourcePageMetadata can recover acronym expansions from page text', () => {
  const html = `
    <html>
      <head><title>NVD - CPE</title></head>
      <body><div>Official Common Platform Enumeration (CPE) Dictionary</div></body>
    </html>
  `;

  const result = extractSourcePageMetadata(html, "According to NVD's CPE page, what does CPE stand for?");
  assert.equal(result.acronymExpansion, 'Common Platform Enumeration (CPE)');
});

test('enrichFirstPartyTracesWithSourcePageMetadata appends title and h1 to browse evidence', async () => {
  const traces: FirstPartyGaiaTrace[] = [
    {
      task_id: 'trace-1',
      level: 'test',
      question: 'According to the page, what does OpenSSF stand for?',
      model: 'test-model',
      answer: 'Open Source Security Foundation',
      annotator_metadata: {
        source_url: 'https://openssf.org/about/',
      },
      trace: {
        steps: [
          {
            index: 1,
            kind: 'browse',
            tool: 'web_fetch',
            summary: 'opened the official foundation page',
            evidence: ['official foundation page loaded'],
          },
          {
            index: 2,
            kind: 'answer',
            tool: null,
            summary: 'returned Open Source Security Foundation',
            evidence: [],
          },
        ],
      },
    },
  ];

  const enriched = await enrichFirstPartyTracesWithSourcePageMetadata(
    traces,
    async () => '<html><head><title>About &#8211; Open Source Security Foundation</title></head><body><h1>About</h1></body></html>',
  );

  assert.deepEqual(enriched[0]?.trace.steps[0]?.evidence, [
    'official foundation page loaded',
    'About – Open Source Security Foundation',
    'About',
  ]);
  assert.deepEqual(traces[0]?.trace.steps[0]?.evidence, ['official foundation page loaded']);
});

test('enrichFirstPartyTracesWithSourcePageMetadata leaves traces unchanged when no browse step exists', async () => {
  const traces: FirstPartyGaiaTrace[] = [
    {
      task_id: 'trace-2',
      level: 'test',
      question: 'Question',
      model: 'test-model',
      answer: 'Answer',
      annotator_metadata: {
        source_url: 'https://example.com',
      },
      trace: {
        steps: [
          {
            index: 1,
            kind: 'reason',
            tool: 'internal',
            summary: 'reasoned about the page',
            evidence: ['summary only'],
          },
        ],
      },
    },
  ];

  const enriched = await enrichFirstPartyTracesWithSourcePageMetadata(
    traces,
    async () => '<html><head><title>Ignored</title></head><body><h1>Ignored</h1></body></html>',
  );

  assert.deepEqual(enriched, traces);
});
