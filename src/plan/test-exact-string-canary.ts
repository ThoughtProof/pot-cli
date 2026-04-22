import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { evaluatePlanPolicy } from './policy.js';
import { assessSpanEntailment } from './span-entailment.js';
import type { PlanRecord, Provenance, RiskFlag } from './types.js';
import type { MergedSupportResult } from './merged-support.js';

type ExpectedVerdict = 'ALLOW' | 'CONDITIONAL_ALLOW' | 'HOLD' | 'BLOCK';
type ExpectedHardStopClass = 'exact_string_mismatch' | 'factual_failure';

type SyntheticCanaryCase = {
  id: string;
  kind: 'constructive' | 'adversarial';
  question: string;
  trueAnswer: string;
  agentAnswer: string;
  expectedVerdict: ExpectedVerdict;
  expectedHardStopClass: ExpectedHardStopClass;
};

type ExactStringCanaryFixture = {
  syntheticCases: SyntheticCanaryCase[];
};

const fixture = JSON.parse(
  fs.readFileSync(new URL('./__fixtures__/exact-string-canary-v1.json', import.meta.url), 'utf8'),
) as ExactStringCanaryFixture;

const fakeProv: Provenance = {
  origin: 'inferred',
  sourceEvidence: 'exact-string-canary',
  confidence: 1,
};

function makeRiskFlag(type: RiskFlag['type'], severity: RiskFlag['severity'], stepId: string): RiskFlag {
  return {
    id: `risk:${type}:${stepId}`,
    type,
    severity,
    stepId,
    description: `${type} (${severity})`,
    provenance: fakeProv,
  };
}

function makeMergedSupport(traceId: string): MergedSupportResult {
  return {
    traceId,
    stepSupports: [],
    mergedCoverage: 0.9,
    segmentOnlyCount: 0,
    executionOnlyCount: 0,
    planOnlyCount: 0,
    bothCount: 0,
    trulyMissingCount: 0,
  };
}

function makeRecord(testCase: SyntheticCanaryCase): PlanRecord {
  return {
    id: `plan:${testCase.id}`,
    traceId: testCase.id,
    extractedAt: '2025-01-01T00:00:00Z',
    goal: {
      id: `goal:${testCase.id}`,
      description: testCase.question,
      taskId: testCase.id,
      trueAnswer: testCase.trueAnswer,
      provenance: fakeProv,
    },
    steps: [
      {
        id: 'annotator:step:1',
        group: 'annotator',
        index: 1,
        description: 'open the source page and identify the target sentence',
        toolsUsed: [],
        provenance: { ...fakeProv, origin: 'annotator' },
      },
      {
        id: 'annotator:step:2',
        group: 'annotator',
        index: 2,
        description: 'quote the exact sentence requested by the task',
        toolsUsed: [],
        provenance: { ...fakeProv, origin: 'annotator' },
      },
      {
        id: 'agent:plan:step:1',
        group: 'agent:plan',
        index: 1,
        description: 'retrieve the source page and answer the quote-style question',
        toolsUsed: ['web_fetch'],
        provenance: { ...fakeProv, origin: 'explicit', confidence: 0.95 },
      },
      {
        id: 'agent:plan:step:2',
        group: 'agent:plan',
        index: 2,
        description: 'return the requested quote',
        toolsUsed: [],
        provenance: { ...fakeProv, origin: 'explicit', confidence: 0.95 },
      },
    ],
    edges: [],
    informationFlows: [],
    riskFlags: [makeRiskFlag('wrong_answer', 'high', 'agent:plan:step:2')],
    metadata: {
      agentModel: 'test',
      agentAnswer: testCase.agentAnswer,
      annotatorStepCount: 2,
      annotatorToolCount: 0,
      totalDurationSeconds: 0,
      verified: false,
    },
  };
}

test('exact-string canary fixture matches expected verdicts and hard-stop classes', () => {
  for (const testCase of fixture.syntheticCases) {
    const entailment = assessSpanEntailment({
      question: testCase.question,
      claimedAnswer: testCase.agentAnswer,
      sourceText: testCase.trueAnswer,
    });
    const mergedRiskFlags = [makeRiskFlag('wrong_answer', 'high', 'agent:plan:step:2')];
    const result = evaluatePlanPolicy(makeRecord(testCase), makeMergedSupport(testCase.id), mergedRiskFlags, {
      experimentalSourceClaim: {
        support: 'unsupported',
        confidence: 'high',
        exactStringQuestion: entailment.exactStringQuestion,
      },
    });
    const actualHardStopClass = result.metrics.hardStopClasses[0] ?? null;

    assert.equal(entailment.exactStringQuestion, true, `${testCase.id} should be recognized as an exact-string question`);
    assert.equal(result.verdict, testCase.expectedVerdict, `${testCase.id} verdict mismatch`);
    assert.equal(actualHardStopClass, testCase.expectedHardStopClass, `${testCase.id} hard-stop class mismatch`);
  }
});
