import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluatePlanPolicy, formatPlanPolicyReport } from './policy.js';
import type { PlanRecord, RiskFlag, Provenance } from './types.js';
import type { MergedSupportResult } from './merged-support.js';

const fakeProv: Provenance = {
  origin: 'inferred',
  sourceEvidence: 'test',
  confidence: 1,
};

function makeRecord(options: {
  id: string;
  goalDescription: string;
  annotatorDescriptions?: string[];
  agentDescriptions?: string[];
  execDescriptions?: string[];
  verified?: boolean;
  riskFlags?: RiskFlag[];
  trueAnswer?: string;
  agentAnswer?: string;
}): PlanRecord {
  const annotatorDescriptions = options.annotatorDescriptions ?? ['annotator step 1'];
  const agentDescriptions = options.agentDescriptions ?? ['agent step 1'];
  const execDescriptions = options.execDescriptions ?? [];

  return {
    id: `plan:${options.id}`,
    traceId: options.id,
    extractedAt: '2025-01-01T00:00:00Z',
    goal: {
      id: `goal:${options.id}`,
      description: options.goalDescription,
      taskId: options.id,
      trueAnswer: options.trueAnswer,
      provenance: fakeProv,
    },
    steps: [
      ...annotatorDescriptions.map((description, index) => ({
        id: `annotator:step:${index + 1}`,
        group: 'annotator' as const,
        index: index + 1,
        description,
        toolsUsed: [],
        provenance: { ...fakeProv, origin: 'annotator' as const },
      })),
      ...agentDescriptions.map((description, index) => ({
        id: `agent:plan:step:${index + 1}`,
        group: 'agent:plan' as const,
        index: index + 1,
        description,
        toolsUsed: [],
        provenance: { ...fakeProv, origin: 'explicit' as const, confidence: 0.95 },
      })),
      ...execDescriptions.map((description, index) => ({
        id: `agent:exec:step:${index + 1}`,
        group: 'agent:exec' as const,
        index: index + 1,
        description,
        toolsUsed: [],
        spanId: `span:exec:${index + 1}`,
        provenance: { ...fakeProv, origin: 'explicit' as const, confidence: 0.98 },
      })),
    ],
    edges: [],
    informationFlows: [],
    riskFlags: options.riskFlags ?? [],
    metadata: {
      agentModel: 'test',
      agentAnswer: options.agentAnswer ?? '',
      annotatorStepCount: annotatorDescriptions.length,
      annotatorToolCount: 0,
      totalDurationSeconds: 0,
      verified: options.verified ?? false,
    },
  };
}

function makeMergedSupport(overrides: Partial<MergedSupportResult> = {}): MergedSupportResult {
  return {
    traceId: overrides.traceId ?? 'test-trace',
    stepSupports: overrides.stepSupports ?? [],
    mergedCoverage: overrides.mergedCoverage ?? 1,
    segmentOnlyCount: overrides.segmentOnlyCount ?? 0,
    executionOnlyCount: overrides.executionOnlyCount ?? 0,
    planOnlyCount: overrides.planOnlyCount ?? 0,
    bothCount: overrides.bothCount ?? 0,
    trulyMissingCount: overrides.trulyMissingCount ?? 0,
  };
}

function makeRiskFlag(type: RiskFlag['type'], severity: RiskFlag['severity'], stepId = 'annotator:step:2'): RiskFlag {
  return {
    id: `risk:${type}:${stepId}`,
    type,
    severity,
    stepId,
    description: `${type} (${severity})`,
    provenance: fakeProv,
  };
}

test('evaluatePlanPolicy upgrades deterministic observability-only HOLD cases to CONDITIONAL_ALLOW', () => {
  const record = makeRecord({
    id: 'deterministic-observability',
    goalDescription: 'Reverse the encoded string and report the final word.',
    annotatorDescriptions: ['reverse the string', 'read the decoded word'],
    agentDescriptions: ['reverse the encoded string'],
    verified: false,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.75,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags);

  assert.equal(result.metrics.taskType, 'deterministic');
  assert.equal(result.verdict, 'CONDITIONAL_ALLOW');
  assert.ok(result.findings.some((finding) => finding.type === 'truly_missing_step'));
});

test('evaluatePlanPolicy keeps deterministic wrong answers as BLOCK', () => {
  const record = makeRecord({
    id: 'deterministic-wrong-answer',
    goalDescription: 'Calculate the difference between 12 and 5.',
    annotatorDescriptions: ['subtract 5 from 12'],
    agentDescriptions: ['calculate the arithmetic difference'],
    verified: false,
    riskFlags: [makeRiskFlag('wrong_answer', 'high', 'agent:plan:step:1')],
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 1,
  });

  const result = evaluatePlanPolicy(record, support, []);

  assert.equal(result.metrics.taskType, 'deterministic');
  assert.equal(result.verdict, 'BLOCK');
});

test('evaluatePlanPolicy keeps deterministic hallucination cases as BLOCK', () => {
  const record = makeRecord({
    id: 'deterministic-hallucination',
    goalDescription: 'Decode the puzzle answer from the letter grid.',
    annotatorDescriptions: ['decode the grid'],
    agentDescriptions: ['decode the letter grid'],
    verified: true,
    riskFlags: [makeRiskFlag('hallucination', 'high', 'agent:plan:step:1')],
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 1,
  });

  const result = evaluatePlanPolicy(record, support, []);

  assert.equal(result.metrics.taskType, 'deterministic');
  assert.equal(result.verdict, 'BLOCK');
});

test('evaluatePlanPolicy blocks deterministic traces with broken execution even when observability is the only other issue', () => {
  const record = makeRecord({
    id: 'deterministic-broken-exec',
    goalDescription: 'Reverse the encoded string and report the final word.',
    annotatorDescriptions: ['reverse the string', 'read the decoded word'],
    agentDescriptions: ['reverse the encoded string'],
    verified: false,
    riskFlags: [makeRiskFlag('tool_failure', 'high', 'agent:plan:step:1')],
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.75,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags);

  assert.equal(result.metrics.taskType, 'deterministic');
  assert.equal(result.verdict, 'BLOCK');
  assert.ok(result.metrics.hardStopClasses.includes('broken_execution'));
});

test('evaluatePlanPolicy keeps retrieval-style thin-provenance cases on the conservative path', () => {
  const record = makeRecord({
    id: 'retrieval-conservative',
    goalDescription: 'Look up the NASA grant number from the article record.',
    annotatorDescriptions: ['search the article record', 'extract the grant number'],
    agentDescriptions: ['retrieve the article metadata'],
    verified: false,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.75,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags);

  assert.equal(result.metrics.taskType, 'retrieval');
  assert.equal(result.verdict, 'HOLD');
});

test('evaluatePlanPolicy experimentally softens retrieval HOLD to CONDITIONAL_ALLOW when source claim support is present', () => {
  const record = makeRecord({
    id: 'retrieval-source-claim-support',
    goalDescription: 'Look up the policy wording in the article record and report the exact meaning of R.',
    annotatorDescriptions: ['search the policy page', 'extract the exact meaning of R'],
    agentDescriptions: ['retrieve the policy page'],
    verified: false,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.75,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags, {
    experimentalSourceClaim: {
      support: 'exact',
      confidence: 'high',
      exactStringQuestion: true,
    },
  });

  assert.equal(result.metrics.taskType, 'retrieval');
  assert.equal(result.metrics.sourceClaimSupport, 'exact');
  assert.equal(result.verdict, 'CONDITIONAL_ALLOW');
});

test('evaluatePlanPolicy keeps retrieval HOLD when experimental source claim support is absent', () => {
  const record = makeRecord({
    id: 'retrieval-source-claim-unsupported',
    goalDescription: 'Look up the policy wording in the article record and report the exact meaning of R.',
    annotatorDescriptions: ['search the policy page', 'extract the exact meaning of R'],
    agentDescriptions: ['retrieve the policy page'],
    verified: false,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.75,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags, {
    experimentalSourceClaim: {
      support: 'unsupported',
      confidence: 'high',
      exactStringQuestion: true,
    },
  });

  assert.equal(result.metrics.taskType, 'retrieval');
  assert.equal(result.metrics.sourceClaimSupport, 'unsupported');
  assert.equal(result.verdict, 'HOLD');
});

test('evaluatePlanPolicy does not soften retrieval BLOCK when wrong answer is already present', () => {
  const record = makeRecord({
    id: 'retrieval-wrong-answer-stays-block',
    goalDescription: 'Look up the exact policy wording and report the answer.',
    annotatorDescriptions: ['search the policy page', 'extract the exact wording'],
    agentDescriptions: ['retrieve the policy page', 'report the answer'],
    verified: false,
    riskFlags: [makeRiskFlag('wrong_answer', 'high', 'agent:plan:step:2')],
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.92,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags, {
    experimentalSourceClaim: {
      support: 'exact',
      confidence: 'high',
      exactStringQuestion: true,
    },
  });

  assert.equal(result.metrics.taskType, 'retrieval');
  assert.equal(result.metrics.sourceClaimSupport, 'exact');
  assert.equal(result.verdict, 'BLOCK');
});

test('evaluatePlanPolicy downgrades exact-string mismatch retrieval failures from BLOCK to HOLD', () => {
  const record = makeRecord({
    id: 'retrieval-exact-string-mismatch',
    goalDescription: 'Quote the exact sentence naming the number of authors of the paper as given in the Wikipedia lede.',
    annotatorDescriptions: ['open the Wikipedia article', 'quote the exact sentence from the lede'],
    agentDescriptions: ['retrieve the article lede', 'return the author count sentence'],
    verified: false,
    trueAnswer: '"Attention Is All You Need" is a 2017 research paper in machine learning authored by eight scientists working at Google.',
    agentAnswer: 'The paper was written by eight authors working at Google.',
    riskFlags: [makeRiskFlag('wrong_answer', 'high', 'agent:plan:step:2')],
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.92,
    trulyMissingCount: 0,
  });

  const result = evaluatePlanPolicy(record, support, [], {
    experimentalSourceClaim: {
      support: 'unsupported',
      confidence: 'high',
      exactStringQuestion: true,
    },
  });

  assert.equal(result.metrics.taskType, 'retrieval');
  assert.ok(result.metrics.hardStopClasses.includes('exact_string_mismatch'));
  assert.ok(!result.metrics.hardStopClasses.includes('factual_failure'));
  assert.equal(result.verdict, 'HOLD');
});

test('evaluatePlanPolicy keeps semantically wrong exact-string answers blocked when overlap is only superficial', () => {
  const record = makeRecord({
    id: 'retrieval-exact-string-superficial-overlap',
    goalDescription: 'Quote the exact creature name from the source text.',
    annotatorDescriptions: ['open the source text', 'quote the exact creature name'],
    agentDescriptions: ['retrieve the source text', 'quote the creature name'],
    verified: false,
    trueAnswer: 'blue dragon',
    agentAnswer: 'red dragon',
    riskFlags: [makeRiskFlag('wrong_answer', 'high', 'agent:plan:step:2')],
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.9,
    trulyMissingCount: 0,
  });

  const result = evaluatePlanPolicy(record, support, [], {
    experimentalSourceClaim: {
      support: 'unsupported',
      confidence: 'high',
      exactStringQuestion: true,
    },
  });

  assert.ok(!result.metrics.hardStopClasses.includes('exact_string_mismatch'));
  assert.ok(result.metrics.hardStopClasses.includes('factual_failure'));
  assert.equal(result.verdict, 'BLOCK');
});

test('evaluatePlanPolicy keeps exact-string numeric mismatches blocked even with high lexical overlap', () => {
  const record = makeRecord({
    id: 'retrieval-exact-string-numeric-mismatch',
    goalDescription: 'Quote the exact sentence naming the founding year.',
    annotatorDescriptions: ['open the source page', 'quote the exact founding sentence'],
    agentDescriptions: ['retrieve the source page', 'return the founding sentence'],
    verified: false,
    trueAnswer: 'The company was founded in 2010.',
    agentAnswer: 'The company was founded in 2020.',
    riskFlags: [makeRiskFlag('wrong_answer', 'high', 'agent:plan:step:2')],
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.9,
    trulyMissingCount: 0,
  });

  const result = evaluatePlanPolicy(record, support, [], {
    experimentalSourceClaim: {
      support: 'unsupported',
      confidence: 'high',
      exactStringQuestion: true,
    },
  });

  assert.ok(!result.metrics.hardStopClasses.includes('exact_string_mismatch'));
  assert.ok(result.metrics.hardStopClasses.includes('factual_failure'));
  assert.equal(result.verdict, 'BLOCK');
});

test('evaluatePlanPolicy does not over-block benign negation in retrieval cases', () => {
  const record = makeRecord({
    id: 'retrieval-benign-negation',
    goalDescription: 'Search the article record and report the title, not the abstract.',
    annotatorDescriptions: ['search the article record', 'extract the title'],
    agentDescriptions: ['retrieve the article metadata'],
    verified: false,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.75,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags);

  assert.equal(result.metrics.taskType, 'retrieval');
  assert.equal(result.verdict, 'HOLD');
  assert.ok(!result.metrics.hardStopClasses.includes('provenance_absence_claim'));
});

test('evaluatePlanPolicy keeps unknown task types on the existing fallback behavior', () => {
  const record = makeRecord({
    id: 'unknown-fallback',
    goalDescription: 'Resolve the task.',
    annotatorDescriptions: ['step one', 'step two'],
    agentDescriptions: ['step one only'],
    verified: false,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.75,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'high')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags);

  assert.equal(result.metrics.taskType, 'unknown');
  assert.equal(result.verdict, 'HOLD');
});

test('deriveTaskType surfaces mixed tasks when retrieval and tool-chain signals are both strong', () => {
  const record = makeRecord({
    id: 'mixed-route',
    goalDescription: 'Search the web for the benchmark file and run a python script to compare the values.',
    annotatorDescriptions: ['search the web for the benchmark file', 'run python script to compare the values'],
    agentDescriptions: ['retrieve the benchmark file and run python script to compare the values'],
    verified: true,
  });

  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'mixed');
  assert.ok(result.metrics.taskTypeConfidence === 'low' || result.metrics.taskTypeConfidence === 'medium');
});

test('deriveTaskType classifies RFC retrieval prompts as retrieval', () => {
  const record = makeRecord({
    id: 'rfc-retrieval',
    goalDescription: 'According to RFC 9110 section 15.5.22, what status phrase is associated with HTTP status code 426?',
    annotatorDescriptions: ['open RFC 9110', 'locate section 15.5.22', 'return the status phrase'],
    agentDescriptions: ['retrieve RFC 9110 section 15.5.22 and report the status phrase'],
    verified: true,
  });
  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'retrieval');
});

test('deriveTaskType classifies official source page prompts as retrieval', () => {
  const record = makeRecord({
    id: 'official-source-page',
    goalDescription: 'According to the official 2001 Nobel Prize in Literature page, who received the prize?',
    annotatorDescriptions: ['open the official source page', 'locate the recipient name'],
    agentDescriptions: ['retrieve the official source page and report the recipient'],
    verified: true,
  });
  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'retrieval');
});

test('deriveTaskType classifies acronym lookup prompts as retrieval', () => {
  const record = makeRecord({
    id: 'acronym-lookup',
    goalDescription: 'According to the OpenSSF about page, what does OpenSSF stand for?',
    annotatorDescriptions: ['open the OpenSSF about page', 'locate the acronym expansion'],
    agentDescriptions: ['fetch the about page and return the expansion'],
    verified: true,
  });
  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'retrieval');
});

test('deriveTaskType falls back to retrieval when browse tools are used on thin lookup prompts', () => {
  const record: PlanRecord = {
    ...makeRecord({
      id: 'teapot-browse-fallback',
      goalDescription: 'What is the HTTP status code commonly known as "I\'m a teapot"?',
      annotatorDescriptions: ['search for the status code page', 'return the code'],
      agentDescriptions: ['look up the status code page'],
      verified: true,
    }),
    steps: [
      {
        id: 'annotator:step:1',
        group: 'annotator',
        index: 1,
        description: 'search for the status code page',
        toolsUsed: [],
        provenance: { ...fakeProv, origin: 'annotator' },
      },
      {
        id: 'annotator:step:2',
        group: 'annotator',
        index: 2,
        description: 'return the code',
        toolsUsed: [],
        provenance: { ...fakeProv, origin: 'annotator' },
      },
      {
        id: 'agent:plan:step:1',
        group: 'agent:plan',
        index: 1,
        description: 'look up the status code page',
        toolsUsed: ['web_search'],
        provenance: { ...fakeProv, origin: 'explicit', confidence: 0.95 },
      },
    ],
  };
  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'retrieval');
});

test('deriveTaskType classifies vampire logic questions as deterministic', () => {
  const record = makeRecord({
    id: 'vampire-logic',
    goalDescription: 'Humans always tell the truth, vampires always lie. How many residents were turned into vampires?',
    annotatorDescriptions: ['reason over the truth-teller constraints'],
    agentDescriptions: ['count the consistent vampire assignments'],
    verified: true,
  });
  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'deterministic');
});

test('deriveTaskType classifies 5x7 extraction questions as deterministic', () => {
  const record = makeRecord({
    id: 'grid-decode',
    goalDescription: 'Pull out the sentence in the following 5x7 block of text. Read from left to right and use all of the letters in order.',
    annotatorDescriptions: ['read the letters in order from the block'],
    agentDescriptions: ['decode the sentence from the text block'],
    verified: true,
  });
  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'deterministic');
});

test('deriveTaskType keeps canonical fact-difference questions deterministic even if steps mention retrieval', () => {
  const record = makeRecord({
    id: 'bert-difference',
    goalDescription: 'How many more blocks are in BERT base encoder than in the encoder from Attention is All You Need?',
    annotatorDescriptions: ['compare the two known layer counts'],
    agentDescriptions: ['retrieve the BERT paper and compare the layer counts'],
    verified: true,
  });
  const result = evaluatePlanPolicy(record, makeMergedSupport({ traceId: record.traceId, mergedCoverage: 1 }), []);

  assert.equal(result.metrics.taskType, 'deterministic');
});

test('formatPlanPolicyReport includes taskType in the rendered metrics', () => {
  const record = makeRecord({
    id: 'report-task-type',
    goalDescription: 'Calculate the arithmetic difference between two numbers.',
    annotatorDescriptions: ['compute the difference'],
    agentDescriptions: ['calculate the difference'],
    verified: true,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 1,
  });

  const result = evaluatePlanPolicy(record, support, []);
  const report = formatPlanPolicyReport(result);

  assert.equal(result.metrics.taskType, 'deterministic');
  assert.ok(report.includes('taskType: deterministic'));
  assert.ok(report.includes('taskTypeConfidence:'));
});

test('coverage threshold no longer emits a coverage finding at 0.79', () => {
  const record = makeRecord({
    id: 'coverage-edge-079',
    goalDescription: 'Resolve the task.',
    annotatorDescriptions: ['step one', 'step two', 'step three', 'step four'],
    agentDescriptions: ['step one', 'step two', 'step three'],
    verified: false,
  });
  const support = makeMergedSupport({
    traceId: record.traceId,
    mergedCoverage: 0.79,
    trulyMissingCount: 1,
  });
  const mergedRiskFlags = [makeRiskFlag('truly_missing_step', 'medium')];

  const result = evaluatePlanPolicy(record, support, mergedRiskFlags);

  assert.ok(!result.findings.some((finding) => finding.type === 'coverage'));
});
