import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { planEnrichFirstPartyCommand } from '../commands/plan-enrich-first-party.js';
import { planSweepFirstPartyCommand } from '../commands/plan-sweep-first-party.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pot-cli-workflow-'));
}

test('planEnrichFirstPartyCommand enriches first-party traces from a gold map', async () => {
  const dir = makeTempDir();
  const inputFile = join(dir, 'input.jsonl');
  const goldMapFile = join(dir, 'gold.json');
  const outFile = join(dir, 'enriched.jsonl');

  writeFileSync(inputFile, `${JSON.stringify({
    task_id: 'trace-1',
    level: '1',
    question: 'According to RFC 9110 section 15.5.22, what status phrase is associated with HTTP status code 426?',
    model: 'test-model',
    answer: 'Upgrade Required',
    annotator_metadata: {},
    trace: {
      steps: [
        { index: 1, kind: 'search', tool: 'web', summary: 'Opened RFC 9110 section 15.5.22.' },
        { index: 2, kind: 'read', tool: 'web', summary: 'Read the status phrase for 426.' },
        { index: 3, kind: 'answer', tool: 'internal', summary: 'Returned Upgrade Required.' },
      ],
    },
  })}\n`);

  writeFileSync(goldMapFile, JSON.stringify({
    'trace-1': {
      ground_truth: 'Upgrade Required',
      annotator_steps: [
        'Open RFC 9110 section 15.5.22.',
        'Locate the status phrase for HTTP status code 426.',
        'Return Upgrade Required.',
      ],
      annotator_tools: ['Search engine', 'Web browser'],
    },
  }, null, 2));

  await planEnrichFirstPartyCommand(inputFile, { goldMap: goldMapFile, out: outFile });

  const lines = readFileSync(outFile, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 1);

  const enriched = JSON.parse(lines[0]!);
  assert.equal(enriched.ground_truth, 'Upgrade Required');
  assert.equal(enriched.final_correct, true);
  assert.equal(enriched.annotator_metadata.final_correct_method, 'normalized_string_exact');
  assert.match(enriched.annotator_metadata.Steps, /^1\. Open RFC 9110 section 15\.5\.22\./);
});

test('planSweepFirstPartyCommand supports per-profile source-claim configuration', async () => {
  const dir = makeTempDir();
  const inputFile = join(dir, 'input.jsonl');
  const profilesFile = join(dir, 'profiles.json');
  const coarseGoldFile = join(dir, 'coarse.json');
  const fineGoldFile = join(dir, 'fine.json');
  const sourceClaimMapFile = join(dir, 'source-claim.json');
  const outFile = join(dir, 'sweep.json');

  writeFileSync(inputFile, `${JSON.stringify({
    task_id: 'trace-1',
    level: '1',
    question: 'According to RFC 9110 section 15.5.22, what status phrase is associated with HTTP status code 426?',
    model: 'test-model',
    answer: 'Upgrade Required',
    annotator_metadata: {},
    trace: {
      steps: [
        { index: 1, kind: 'search', tool: 'web', summary: 'Opened RFC 9110 section 15.5.22.' },
        { index: 2, kind: 'answer', tool: 'internal', summary: 'Returned Upgrade Required.' },
      ],
    },
  })}\n`);

  writeFileSync(coarseGoldFile, JSON.stringify({
    'trace-1': {
      ground_truth: 'Upgrade Required',
      annotator_steps: ['Open the RFC page.', 'Return the status phrase.'],
      annotator_tools: ['Search engine', 'Web browser'],
    },
  }, null, 2));

  writeFileSync(fineGoldFile, JSON.stringify({
    'trace-1': {
      ground_truth: 'Upgrade Required',
      annotator_steps: [
        'Open RFC 9110 section 15.5.22.',
        'Locate the line for HTTP status code 426.',
        'Read the associated status phrase.',
        'Return Upgrade Required.',
      ],
      annotator_tools: ['Search engine', 'Web browser'],
    },
  }, null, 2));

  writeFileSync(profilesFile, JSON.stringify({
    coarse: { goldMap: coarseGoldFile },
    fine: { goldMap: fineGoldFile, sourceClaimMap: sourceClaimMapFile },
  }, null, 2));
  writeFileSync(sourceClaimMapFile, JSON.stringify({
    'trace-1': { support: 'exact', confidence: 'high', exactStringQuestion: false },
  }, null, 2));

  await planSweepFirstPartyCommand(inputFile, {
    profiles: profilesFile,
    out: outFile,
    minimumScore: '0.25',
    mode: 'semantic',
  });

  const payload = JSON.parse(readFileSync(outFile, 'utf8'));
  assert.equal(payload.traceCount, 1);
  assert.ok(payload.profiles.coarse);
  assert.ok(payload.profiles.fine);
  assert.equal(payload.profiles.coarse.baseline.count, 1);
  assert.equal(payload.profiles.fine.baseline.count, 1);
  assert.equal(payload.profiles.coarse.withSourceClaim, null);
  assert.ok(payload.profiles.fine.withSourceClaim);
  assert.deepEqual(payload.summary.coarse.verdictTransitions, null);
  assert.deepEqual(payload.summary.fine.withSourceClaimVerdictCounts, payload.profiles.fine.withSourceClaim.verdictCounts);
  assert.deepEqual(payload.summary.fine.sourceClaimSupportCounts, { exact: 1 });
  assert.deepEqual(payload.summary.fine.sourceClaimConfidenceCounts, { high: 1 });
});

test('planSweepFirstPartyCommand can derive source-claim with source-page enrichment', async () => {
  const dir = makeTempDir();
  const inputFile = join(dir, 'input.jsonl');
  const profilesFile = join(dir, 'profiles.json');
  const goldFile = join(dir, 'gold.json');
  const outFile = join(dir, 'sweep.json');

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
        { index: 2, kind: 'answer', tool: 'internal', summary: 'Returned Known Exploited Vulnerabilities.' },
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

  writeFileSync(profilesFile, JSON.stringify({
    enriched: { goldMap: goldFile, deriveSourceClaim: true, enrichSourcePages: true },
  }, null, 2));

  await planSweepFirstPartyCommand(inputFile, {
    profiles: profilesFile,
    out: outFile,
    minimumScore: '0.25',
    mode: 'semantic',
    sourcePageFetcher: async () => '<html><head><title>Known Exploited Vulnerabilities Catalog | CISA</title></head><body><h1>Known Exploited Vulnerabilities Catalog</h1></body></html>',
  });

  const payload = JSON.parse(readFileSync(outFile, 'utf8'));
  assert.deepEqual(payload.summary.enriched.sourceClaimSupportCounts, { exact: 1 });
  assert.deepEqual(payload.summary.enriched.sourceClaimConfidenceCounts, { high: 1 });
});

test('planSweepFirstPartyCommand can write a compact text report', async () => {
  const dir = makeTempDir();
  const inputFile = join(dir, 'input.jsonl');
  const profilesFile = join(dir, 'profiles.json');
  const fineGoldFile = join(dir, 'fine.json');
  const sourceClaimMapFile = join(dir, 'source-claim.json');
  const outFile = join(dir, 'sweep.txt');

  writeFileSync(inputFile, `${JSON.stringify({
    task_id: 'trace-1',
    level: '1',
    question: 'According to RFC 9110 section 15.5.22, what status phrase is associated with HTTP status code 426?',
    model: 'test-model',
    answer: 'Upgrade Required',
    annotator_metadata: {},
    trace: {
      steps: [
        { index: 1, kind: 'search', tool: 'web', summary: 'Opened RFC 9110 section 15.5.22.' },
        { index: 2, kind: 'answer', tool: 'internal', summary: 'Returned Upgrade Required.' },
      ],
    },
  })}\n`);

  writeFileSync(fineGoldFile, JSON.stringify({
    'trace-1': {
      ground_truth: 'Upgrade Required',
      annotator_steps: [
        'Open RFC 9110 section 15.5.22.',
        'Locate the line for HTTP status code 426.',
        'Read the associated status phrase.',
        'Return Upgrade Required.',
      ],
      annotator_tools: ['Search engine', 'Web browser'],
    },
  }, null, 2));

  writeFileSync(sourceClaimMapFile, JSON.stringify({
    'trace-1': { support: 'exact', confidence: 'high', exactStringQuestion: false },
  }, null, 2));

  writeFileSync(profilesFile, JSON.stringify({
    fine: { goldMap: fineGoldFile, sourceClaimMap: sourceClaimMapFile },
  }, null, 2));

  await planSweepFirstPartyCommand(inputFile, {
    profiles: profilesFile,
    out: outFile,
    minimumScore: '0.25',
    mode: 'semantic',
    format: 'text',
  });

  const text = readFileSync(outFile, 'utf8');
  assert.match(text, /Plan Sweep Report/);
  assert.match(text, /fine/);
  assert.match(text, /baseline:/);
  assert.match(text, /withSourceClaim:/);
  assert.match(text, /sourceClaimSupport:/);
  assert.match(text, /sourceClaimConfidence:/);
});

test('planSweepFirstPartyCommand can write to stdout when out is omitted', async () => {
  const dir = makeTempDir();
  const inputFile = join(dir, 'input.jsonl');
  const profilesFile = join(dir, 'profiles.json');
  const fineGoldFile = join(dir, 'fine.json');

  writeFileSync(inputFile, `${JSON.stringify({
    task_id: 'trace-1',
    level: '1',
    question: 'According to RFC 9110 section 15.5.22, what status phrase is associated with HTTP status code 426?',
    model: 'test-model',
    answer: 'Upgrade Required',
    annotator_metadata: {},
    trace: {
      steps: [
        { index: 1, kind: 'search', tool: 'web', summary: 'Opened RFC 9110 section 15.5.22.' },
        { index: 2, kind: 'answer', tool: 'internal', summary: 'Returned Upgrade Required.' },
      ],
    },
  })}\n`);

  writeFileSync(fineGoldFile, JSON.stringify({
    'trace-1': {
      ground_truth: 'Upgrade Required',
      annotator_steps: ['Open RFC 9110 section 15.5.22.', 'Return Upgrade Required.'],
      annotator_tools: ['Search engine', 'Web browser'],
    },
  }, null, 2));

  writeFileSync(profilesFile, JSON.stringify({ fine: { goldMap: fineGoldFile } }, null, 2));

  let stdout = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;

  try {
    await planSweepFirstPartyCommand(inputFile, {
      profiles: profilesFile,
      minimumScore: '0.25',
      mode: 'semantic',
      format: 'text',
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(stdout, /Plan Sweep Report/);
  assert.match(stdout, /fine/);
});
