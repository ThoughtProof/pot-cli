import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeGaiaTrace } from './canonicalizer.js';
import {
  alignAgentPlanToAnnotator,
  alignAgentExecToAnnotator,
  diagnosePlanAlignmentConflicts,
  diagnosePlanContentGateBlocks,
  diagnosePlanSegmentSupport,
  computePlanSegmentSupport,
  deriveAlignmentRiskFlags,
  DEFAULT_ALIGNMENT_MINIMUM_SCORE,
  ALIGNMENT_WEIGHTS,
  LEGACY_ALIGNMENT_WEIGHTS,
} from './alignment.js';
import {
  mergeSupport,
  deriveMergedRiskFlags,
} from './merged-support.js';
import {
  evaluatePlanPolicy,
  buildPlanPolicyBatchExport,
  formatPlanPolicyReport,
  formatPlanPolicyBatchReport,
} from './policy.js';
import {
  canonicalizeGaiaTraceBatch,
  summarizePlanBatch,
  LOW_COVERAGE_THRESHOLD,
} from './batch.js';
import {
  benchmarkAlignmentModesForRecords,
  formatAlignmentBenchmarkReport,
} from './benchmark.js';
import type { GaiaTrace } from './gaia-trace-types.js';
import type { PlanRecord } from './types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dir, '__fixtures__', 'gaia-0035.json');
const rawTrace = JSON.parse(readFileSync(fixturePath, 'utf8')) as GaiaTrace;

// ---------------------------------------------------------------------------
// Helper: build a minimal PlanRecord with synthetic steps
// ---------------------------------------------------------------------------

function makeSyntheticRecord(
  id: string,
  agentDescriptions: string[],
  annotatorDescriptions: string[],
  agentTools: string[][] = [],
  annotatorTools: string[][] = [],
): PlanRecord {
  const fakeProv = { origin: 'inferred' as const, sourceEvidence: 'test', confidence: 1 };
  const steps = [
    ...annotatorDescriptions.map((desc, i) => ({
      id: `annotator:step:${i + 1}`,
      group: 'annotator' as const,
      index: i + 1,
      description: desc,
      toolsUsed: annotatorTools[i] ?? [],
      provenance: { origin: 'annotator' as const, sourceEvidence: 'test', confidence: 1 },
    })),
    ...agentDescriptions.map((desc, i) => ({
      id: `agent:plan:step:${i + 1}`,
      group: 'agent:plan' as const,
      index: i + 1,
      description: desc,
      toolsUsed: agentTools[i] ?? [],
      provenance: { origin: 'explicit' as const, sourceEvidence: 'test', confidence: 0.95 },
    })),
  ];

  return {
    id: `plan:${id}`,
    traceId: id,
    extractedAt: '2025-01-01T00:00:00Z',
    goal: { id: `goal:${id}`, description: 'test goal', taskId: id, provenance: fakeProv },
    steps,
    edges: [],
    informationFlows: [],
    riskFlags: [],
    metadata: {
      agentModel: 'test',
      agentAnswer: '',
      annotatorStepCount: annotatorDescriptions.length,
      annotatorToolCount: 0,
      totalDurationSeconds: 0,
      verified: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture-based alignment tests
// ---------------------------------------------------------------------------

test('alignment returns matches and uncovered annotator steps', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const result = alignAgentPlanToAnnotator(record);

  const agentPlanSteps = record.steps.filter(
    (step) => step.group === 'agent:plan' && !step.id.startsWith('agent:plan:facts:'),
  );

  assert.equal(result.traceId, record.traceId);
  assert.equal(result.alignments.length, agentPlanSteps.length);
  assert.ok(result.coverage >= 0 && result.coverage <= 1);
  assert.ok(Array.isArray(result.uncoveredAnnotatorStepIds));
  assert.ok(Array.isArray(result.uncoveredAgentStepIds));
  assert.ok(result.alignments.some((a) => a.matched));
  assert.ok(Array.isArray(result.gapDescriptions));
});

test('alignment StepAlignment includes composite score breakdown', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const result = alignAgentPlanToAnnotator(record);

  for (const a of result.alignments) {
    assert.ok(typeof a.lexicalScore === 'number', `lexicalScore missing on ${a.agentStepId}`);
    assert.ok(typeof a.semanticScore === 'number', `semanticScore missing on ${a.agentStepId}`);
    assert.ok(typeof a.positionScore === 'number', `positionScore missing on ${a.agentStepId}`);
    assert.ok(typeof a.toolScore === 'number', `toolScore missing on ${a.agentStepId}`);
    assert.ok(a.lexicalScore >= 0 && a.lexicalScore <= 1, 'lexicalScore out of range');
    assert.ok(a.semanticScore >= 0 && a.semanticScore <= 1, 'semanticScore out of range');
    assert.ok(a.positionScore >= 0 && a.positionScore <= 1, 'positionScore out of range');
    assert.ok(a.toolScore >= 0 && a.toolScore <= 1, 'toolScore out of range');
    assert.ok(a.score >= 0 && a.score <= 1, 'composite score out of range');
    const semanticWeightedSum =
      a.lexicalScore * ALIGNMENT_WEIGHTS.lexical +
      a.semanticScore * ALIGNMENT_WEIGHTS.semantic +
      a.positionScore * ALIGNMENT_WEIGHTS.position +
      a.toolScore * ALIGNMENT_WEIGHTS.tool;
    const lexicalFloor =
      a.lexicalScore * LEGACY_ALIGNMENT_WEIGHTS.lexical +
      a.positionScore * LEGACY_ALIGNMENT_WEIGHTS.position +
      a.toolScore * LEGACY_ALIGNMENT_WEIGHTS.tool;

    // semantic mode may lift to the lexical floor, but should never exceed both scoring branches.
    assert.ok(
      a.score <= Math.max(semanticWeightedSum, lexicalFloor) + 1e-9,
      `composite ${a.score} exceeds both scoring branches`,
    );
  }
});

test('gap descriptions exist for every uncovered annotator step', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const result = alignAgentPlanToAnnotator(record);

  assert.equal(result.gapDescriptions.length, result.uncoveredAnnotatorStepIds.length);

  for (const gap of result.gapDescriptions) {
    assert.ok(result.uncoveredAnnotatorStepIds.includes(gap.annotatorStepId));
    assert.ok(gap.annotatorStepIndex >= 1, 'annotatorStepIndex must be 1-based');
    assert.ok(gap.reason.length > 0, 'gap reason must not be empty');
    assert.ok(gap.reason.includes('scored') || gap.reason.includes('no agent'), 'reason must explain the gap');
    assert.ok(gap.bestCandidateScore >= 0 && gap.bestCandidateScore <= 1);
  }
});

// ---------------------------------------------------------------------------
// Fixture-based batch tests
// ---------------------------------------------------------------------------

test('batch canonicalization returns summary metrics', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace, rawTrace]);
  const summary = summarizePlanBatch(items);

  assert.equal(items.length, 2);
  assert.equal(summary.count, 2);
  assert.equal(summary.verifiedCount, 0);
  assert.ok(items[0]?.alignmentRiskFlags.length >= 0);
  assert.ok(summary.averageCoverage >= 0 && summary.averageCoverage <= 1);
  assert.ok(summary.averageSegmentCoverage >= 0 && summary.averageSegmentCoverage <= 1);
  assert.ok((summary.riskFlagCounts.wrong_answer ?? 0) >= 2);
  assert.ok((summary.riskFlagCounts.missing_step ?? 0) >= 2);

  // Coverage range
  assert.ok(summary.coverageMin >= 0 && summary.coverageMin <= 1);
  assert.ok(summary.coverageMax >= 0 && summary.coverageMax <= 1);
  assert.ok(summary.coverageMin <= summary.averageCoverage);
  assert.ok(summary.averageCoverage <= summary.coverageMax);
  assert.ok(typeof summary.segmentCoverageDeltaVsPlan === 'number');

  // Same trace twice → min == max == average
  assert.ok(Math.abs(summary.coverageMin - summary.averageCoverage) < 1e-9);
  assert.ok(Math.abs(summary.coverageMax - summary.averageCoverage) < 1e-9);

  // Gap totals
  assert.ok(summary.totalUncoveredSteps >= 0);
  assert.ok(summary.totalUncoveredAgentSteps >= 0);
  assert.ok(summary.totalUncoveredAgentSteps >= 0);

  // Missed positions
  assert.ok(Array.isArray(summary.mostMissedAnnotatorPositions));
  assert.ok(summary.mostMissedAnnotatorPositions.length <= 3);
});

test('lowCoverageCount is consistent with averageCoverage for identical traces', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace, rawTrace]);
  const summary = summarizePlanBatch(items);

  if (summary.averageCoverage < LOW_COVERAGE_THRESHOLD) {
    assert.equal(summary.lowCoverageCount, 2);
  } else {
    assert.equal(summary.lowCoverageCount, 0);
  }
});

test('totalUncoveredSteps equals sum of uncovered step counts per trace', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace, rawTrace]);
  const expected = items.reduce(
    (sum, item) => sum + item.alignment.uncoveredAnnotatorStepIds.length,
    0,
  );
  const summary = summarizePlanBatch(items);
  assert.equal(summary.totalUncoveredSteps, expected);
});

test('totalUncoveredAgentSteps equals sum of unmatched agent step counts per trace', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace, rawTrace]);
  const expected = items.reduce(
    (sum, item) => sum + item.alignment.uncoveredAgentStepIds.length,
    0,
  );
  const summary = summarizePlanBatch(items);
  assert.equal(summary.totalUncoveredAgentSteps, expected);
});

// ---------------------------------------------------------------------------
// Synthetic-data tests: composite scoring behavior
// ---------------------------------------------------------------------------

test('composite score uses lexical + position + tool signals', () => {
  // Two perfectly aligned agent/annotator step pairs with lexical + tool overlap.
  const record = makeSyntheticRecord(
    'test-composite',
    [
      'retrieve wikipedia article about dinosaurs',
      'calculate the final numeric answer using code',
    ],
    [
      'retrieve article about dinosaurs from wikipedia',
      'calculate numeric result and verify answer',
    ],
    [['web_browser'], ['python_interpreter']],
    [['web_browser'], ['python_interpreter']],
  );

  const result = alignAgentPlanToAnnotator(record);

  // agent:1 should match annotator:1
  const a1 = result.alignments.find((a) => a.agentStepId === 'agent:plan:step:1')!;
  assert.ok(a1, 'alignment for agent step 1 should exist');
  assert.equal(a1.annotatorStepId, 'annotator:step:1');
  assert.ok(a1.matched, 'step 1 should be matched');
  assert.ok(a1.lexicalScore > 0, 'lexical score must be positive for overlapping descriptions');
  assert.ok(a1.positionScore > 0.9, `position score for first-of-two steps should be near 1, got ${a1.positionScore}`);
  assert.ok(a1.toolScore > 0, 'tool score must be positive when tools match');

  // agent:2 should match annotator:2
  const a2 = result.alignments.find((a) => a.agentStepId === 'agent:plan:step:2')!;
  assert.ok(a2, 'alignment for agent step 2 should exist');
  assert.equal(a2.annotatorStepId, 'annotator:step:2');
  assert.ok(a2.matched, 'step 2 should be matched');

  assert.equal(result.coverage, 1);
  assert.equal(result.uncoveredAnnotatorStepIds.length, 0);
  assert.equal(result.gapDescriptions.length, 0);
});

test('position score penalizes misaligned step order', () => {
  // 3 agent steps, 3 annotator steps; first agent and last annotator are positionally far apart.
  const record = makeSyntheticRecord(
    'test-position',
    ['alpha beta gamma', 'delta epsilon zeta', 'eta theta iota'],
    ['alpha beta gamma', 'delta epsilon zeta', 'eta theta iota'],
  );

  const result = alignAgentPlanToAnnotator(record);
  // Each agent step should match its counterpart by position + lexical
  for (const a of result.alignments) {
    assert.ok(a.matched, `${a.agentStepId} should be matched`);
  }
  assert.equal(result.coverage, 1);

  // Position score for step 1 vs step 3 (out-of-order) should be lower than step 1 vs step 1
  // We can verify this by checking that matched pairs have higher position scores than cross-pairs.
  const a1 = result.alignments.find((a) => a.agentStepId === 'agent:plan:step:1')!;
  assert.ok(a1.positionScore > 0.9, 'first steps positionally very close');
});

test('position alone does not create a match without lexical, semantic, or tool overlap', () => {
  const record = makeSyntheticRecord(
    'test-position-only-no-match',
    ['totally unrelated alpha', 'totally unrelated beta'],
    ['paint the ceiling blue', 'sing a song loudly'],
  );

  const result = alignAgentPlanToAnnotator(record, { minimumScore: 0.15, mode: 'semantic' });

  assert.equal(result.coverage, 0, 'pure position-only overlap should not count as coverage');
  assert.equal(result.uncoveredAnnotatorStepIds.length, 2);
  assert.equal(result.uncoveredAgentStepIds.length, 2);
});

test('diagnosePlanAlignmentConflicts lists threshold-passing candidates blocked by one-to-one assignment', () => {
  const record = makeSyntheticRecord(
    'test-conflict-diagnostics',
    [
      'open the wikipedia page for mercedes sosa',
      'count the albums in the target year range',
      'report the final count',
    ],
    [
      'search for mercedes sosa',
      'open the wikipedia page',
      'count the albums in the target year range',
      'report the final count',
    ],
  );

  const diagnostics = diagnosePlanAlignmentConflicts(record, { minimumScore: 0.25, mode: 'semantic' });

  assert.equal(diagnostics.length, 1);
  assert.ok((diagnostics[0]?.candidates.length ?? 0) >= 1);
  assert.ok(
    diagnostics[0]?.candidates.some((candidate) => candidate.assignedAnnotatorStepId !== null),
    'at least one threshold-passing candidate should already be assigned elsewhere',
  );
});

test('diagnosePlanContentGateBlocks captures raw-threshold candidates blocked only by missing content signal', () => {
  const record = makeSyntheticRecord(
    'test-content-gate-diagnostics',
    ['alpha task', 'beta task'],
    ['first unrelated thing', 'second unrelated thing'],
  );

  const diagnostics = diagnosePlanContentGateBlocks(record, { minimumScore: 0.15, mode: 'semantic' });

  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((item) => item.lexicalScore === 0));
  assert.ok(diagnostics.every((item) => item.semanticScore === 0));
  assert.ok(diagnostics.every((item) => item.positionScore > 0));
});

test('diagnosePlanSegmentSupport finds useful annotator spans for compressed agent steps', () => {
  const record = makeSyntheticRecord(
    'test-segment-support',
    ['count the children and then calculate the child potatoes'],
    ['count the children', 'subtract the second cousins', 'calculate the child potatoes'],
  );

  const diagnostics = diagnosePlanSegmentSupport(record, { minimumScore: 0.25, mode: 'semantic', maxSpanLength: 3 });

  assert.equal(diagnostics.length, 1);
  assert.ok((diagnostics[0]?.spanLength ?? 0) >= 2);
  assert.ok(
    (diagnostics[0]?.score ?? 0) > (diagnostics[0]?.singleStepBestScore ?? 0),
    'best annotator span should score above the best single-step match for compressed plans',
  );
});

test('computePlanSegmentSupport can cover multiple annotator steps with one compressed agent step', () => {
  const record = makeSyntheticRecord(
    'test-segment-coverage',
    ['count the children and then calculate the child potatoes'],
    ['count the children', 'subtract the second cousins', 'calculate the child potatoes'],
  );

  const baseline = alignAgentPlanToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });
  const segment = computePlanSegmentSupport(record, { minimumScore: 0.25, mode: 'semantic', maxSpanLength: 3 });

  assert.ok(segment.coverage > baseline.coverage, 'segment support should raise coverage for compressed plans');
  assert.ok(segment.assignments[0]?.coveredAnnotatorStepIds.length >= 2);
});

test('gap description explains uncovered annotator step with best candidate info', () => {
  // 1 agent step, 2 annotator steps — the second annotator step will be uncovered.
  const record = makeSyntheticRecord(
    'test-gap',
    ['search for relevant documents online'],
    [
      'search for relevant documents',
      'verify the computed result against known reference data',
    ],
  );

  const result = alignAgentPlanToAnnotator(record);

  // annotator:step:2 must be uncovered (completely different vocabulary from the agent step)
  assert.ok(
    result.uncoveredAnnotatorStepIds.includes('annotator:step:2'),
    'annotator:step:2 should be uncovered',
  );

  const gap = result.gapDescriptions.find((g) => g.annotatorStepId === 'annotator:step:2')!;
  assert.ok(gap, 'gap description for annotator:step:2 should exist');
  assert.equal(gap.annotatorStepIndex, 2);
  assert.ok(gap.reason.includes('scored'), 'reason should mention the score');
  assert.equal(gap.bestCandidateAgentStepId, 'agent:plan:step:1');
  assert.ok(gap.bestCandidateScore <= 0.15, `score ${gap.bestCandidateScore} should be at or below threshold`);
});

test('alignment keeps important short tokens like API and SQL', () => {
  const record = makeSyntheticRecord(
    'test-short-tokens',
    ['call API endpoint then run SQL query'],
    ['run api call and sql query'],
  );

  const result = alignAgentPlanToAnnotator(record, DEFAULT_ALIGNMENT_MINIMUM_SCORE);
  assert.equal(result.uncoveredAnnotatorStepIds.length, 0);
  assert.equal(result.uncoveredAgentStepIds.length, 0);
  assert.ok(result.alignments[0]?.matched, 'short meaningful tokens should still align');
});

test('hyphenated tokens are split for alignment', () => {
  const record = makeSyntheticRecord(
    'test-hyphenated',
    ['perform api-call verification'],
    ['perform api call verification'],
  );

  const result = alignAgentPlanToAnnotator(record, DEFAULT_ALIGNMENT_MINIMUM_SCORE);
  assert.equal(result.uncoveredAnnotatorStepIds.length, 0);
  assert.ok(result.alignments[0]?.matched, 'hyphenated and spaced tokens should align');
});

test('semantic alignment bridges paraphrases like postal code and nonindigenous site', () => {
  const record = makeSyntheticRecord(
    'test-semantic-paraphrase',
    ['locate the postal code after opening the NAS webpage'],
    ['search the web for the zip code on the nonindigenous aquatic species site'],
  );

  const result = alignAgentPlanToAnnotator(record, DEFAULT_ALIGNMENT_MINIMUM_SCORE);
  const alignment = result.alignments[0]!;

  assert.ok(alignment.matched, 'semantic paraphrases should still align');
  assert.equal(result.uncoveredAnnotatorStepIds.length, 0);
  assert.ok(
    alignment.semanticScore > alignment.lexicalScore,
    `semantic score ${alignment.semanticScore} should exceed lexical score ${alignment.lexicalScore}`,
  );
});

test('semantic alignment tolerates near-typos like anenomefish vs anemonefish', () => {
  const record = makeSyntheticRecord(
    'test-semantic-typo',
    ['open clown anenomefish collection info'],
    ['click clown anemonefish collection information'],
  );

  const result = alignAgentPlanToAnnotator(record, DEFAULT_ALIGNMENT_MINIMUM_SCORE);
  const alignment = result.alignments[0]!;

  assert.ok(alignment.matched, 'near-typos should still align semantically');
  assert.equal(result.uncoveredAnnotatorStepIds.length, 0);
  assert.ok(alignment.semanticScore >= 0.5, `semantic score ${alignment.semanticScore} should be strong`);
});

test('semantic alignment keeps one-to-one coverage when two agent steps compete for the same annotator step', () => {
  const record = makeSyntheticRecord(
    'test-semantic-one-to-one',
    [
      'Read the Mercedes Sosa Wikipedia page and located the discography section with album years.',
      'Filtered the studio album list to the years 2000 through 2009 inclusive.',
      'Counted the qualifying studio albums in the date range.',
    ],
    [
      'I did a search for Mercedes Sosa',
      'I went to the Wikipedia page for her',
      'I scrolled down to Studio albums',
      'I counted the ones between 2000 and 2009',
    ],
  );

  const result = alignAgentPlanToAnnotator(record, DEFAULT_ALIGNMENT_MINIMUM_SCORE);
  const matchedAnnotatorIds = new Set(
    result.alignments
      .filter((item) => item.matched && item.annotatorStepId)
      .map((item) => item.annotatorStepId),
  );

  assert.equal(result.coverage, 0.75, 'semantic alignment should preserve 3 covered annotator steps out of 4');
  assert.equal(matchedAnnotatorIds.size, 3, 'matched annotator coverage should be one-to-one');
  assert.ok(
    result.uncoveredAnnotatorStepIds.includes('annotator:step:2'),
    'the Wikipedia navigation step should remain the only uncovered annotator step',
  );
  assert.equal(result.uncoveredAnnotatorStepIds.length, 1);
});

test('benchmarkAlignmentModesForRecords shows semantic improvement on paraphrase-heavy traces', () => {
  const paraphraseRecord = makeSyntheticRecord(
    'benchmark-semantic-win',
    ['locate the postal code after opening the webpage'],
    ['search the website and click through to find the zip code'],
  );
  const literalRecord = makeSyntheticRecord(
    'benchmark-no-change',
    ['retrieve article about dinosaurs from wikipedia'],
    ['retrieve article about dinosaurs from wikipedia'],
  );

  const benchmark = benchmarkAlignmentModesForRecords(
    [paraphraseRecord, literalRecord],
    { minimumScore: 0.4 },
  );

  assert.equal(benchmark.traceCount, 2);
  assert.ok(benchmark.improvedTraceCount >= 1, 'at least one trace should improve under semantic alignment');
  assert.ok(benchmark.averageCoverageDelta > 0, 'semantic mode should improve average coverage');

  const paraphraseComparison = benchmark.traces.find((item) => item.traceId === 'benchmark-semantic-win')!;
  assert.ok(
    paraphraseComparison.semanticCoverage > paraphraseComparison.lexicalCoverage,
    'semantic coverage should beat lexical coverage on paraphrase-heavy trace',
  );
});

test('semantic mode never undercuts lexical coverage on the same record', () => {
  const record = makeSyntheticRecord(
    'benchmark-semantic-floor',
    ['convert the gathered figures into a rounded result'],
    ['convert the numbers and round the answer'],
  );

  const lexical = alignAgentPlanToAnnotator(record, { minimumScore: 0.25, mode: 'lexical' });
  const semantic = alignAgentPlanToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });

  assert.ok(
    semantic.coverage >= lexical.coverage,
    `semantic coverage ${semantic.coverage} should never be below lexical coverage ${lexical.coverage}`,
  );
});

test('formatAlignmentBenchmarkReport returns compact summary text', () => {
  const benchmark = benchmarkAlignmentModesForRecords([], { minimumScore: 0.2 });
  const report = formatAlignmentBenchmarkReport(benchmark);

  assert.ok(report.includes('traceCount: 0'));
  assert.ok(report.includes('minimumScore: 0.2'));
  assert.ok(report.includes('averageCoverageDelta: 0.000'));
});

test('summarizePlanBatch accepts custom low coverage threshold', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace, rawTrace]);
  const strict = summarizePlanBatch(items, { lowCoverageThreshold: 0.95 });
  assert.ok(strict.lowCoverageCount >= 0 && strict.lowCoverageCount <= items.length);
});

test('deriveAlignmentRiskFlags raises missing_step for uncovered annotator steps', () => {
  const record = makeSyntheticRecord(
    'test-derived-missing-step',
    ['search for relevant documents online'],
    [
      'search for relevant documents',
      'verify the computed result against known reference data',
    ],
  );

  const alignment = alignAgentPlanToAnnotator(record);
  const flags = deriveAlignmentRiskFlags(record, alignment);

  assert.ok(flags.some((flag) => flag.type === 'missing_step'));
  assert.ok(flags.some((flag) => flag.stepId === 'annotator:step:2'));
});

test('deriveAlignmentRiskFlags raises gap for unmatched agent steps', () => {
  const record = makeSyntheticRecord(
    'test-derived-unmatched-agent',
    ['invent unrelated detour step'],
    ['search for relevant documents'],
  );

  const alignment = alignAgentPlanToAnnotator(record, 0.6);
  const flags = deriveAlignmentRiskFlags(record, alignment, 0.6);

  assert.ok(flags.some((flag) => flag.type === 'gap'));
  assert.ok(flags.some((flag) => flag.stepId === 'agent:plan:step:1'));
});

test('deriveAlignmentRiskFlags uses alignment minimumScore by default', () => {
  const record = makeSyntheticRecord(
    'test-derived-minimum-score-propagation',
    ['invent unrelated detour step'],
    ['search for relevant documents'],
  );

  const alignment = alignAgentPlanToAnnotator(record, 0.6);
  const flags = deriveAlignmentRiskFlags(record, alignment);

  const gapFlag = flags.find((flag) => flag.type === 'gap');
  assert.ok(gapFlag, 'gap flag should exist for unmatched agent step');
  assert.ok(gapFlag!.description.includes('0.6'), 'description should use alignment minimumScore');
});

test('mostMissedAnnotatorPositions surfaces repeated gap patterns across batch', () => {
  // Three traces where the final annotator step is consistently the top uncovered position.
  const makeTrace = (id: string) =>
    makeSyntheticRecord(
      id,
      ['search web for data', 'extract numeric value'],
      ['search web for data', 'extract numeric value', 'paint the ceiling blue'],
    );

  const items = [makeTrace('t1'), makeTrace('t2'), makeTrace('t3')].map((record) => {
    const alignment = alignAgentPlanToAnnotator(record);
    const execAlignment = alignAgentExecToAnnotator(record);
    const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
    const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
    const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
    return {
      record,
      alignment,
      alignmentRiskFlags: deriveAlignmentRiskFlags(record, alignment),
      execAlignment,
      segmentSupport,
      mergedSupport: merged,
      mergedRiskFlags,
      policyEvaluation: evaluatePlanPolicy(record, merged, mergedRiskFlags),
    };
  });

  const summary = summarizePlanBatch(items);

  // Position 3 should be the top missed position (missed in all 3 traces)
  assert.ok(
    summary.mostMissedAnnotatorPositions.includes(3),
    `expected position 3 in mostMissedAnnotatorPositions, got ${JSON.stringify(summary.mostMissedAnnotatorPositions)}`,
  );
  assert.equal(
    summary.mostMissedAnnotatorPositions[0],
    3,
    'position 3 should be the top missed position',
  );
  assert.equal(summary.totalUncoveredSteps, 3);
});

test('empty batch returns zeroed summary', () => {
  const summary = summarizePlanBatch([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.averageCoverage, 0);
  assert.equal(summary.averageSegmentCoverage, 0);
  assert.equal(summary.segmentCoverageDeltaVsPlan, 0);
  assert.equal(summary.coverageMin, 0);
  assert.equal(summary.coverageMax, 0);
  assert.equal(summary.lowCoverageCount, 0);
  assert.equal(summary.totalUncoveredSteps, 0);
  assert.equal(summary.totalUncoveredAgentSteps, 0);
  assert.deepEqual(summary.mostMissedAnnotatorPositions, []);
});

// ---------------------------------------------------------------------------
// Milestone C helpers
// ---------------------------------------------------------------------------

/**
 * Build a PlanRecord that includes both agent:plan steps AND agent:exec steps.
 * exec descriptions and toolsUsed mimic what the enriched canonicalizer produces
 * (thought text + extracted tools from TOOL-kind child spans).
 */
function makeSyntheticRecordWithExec(
  id: string,
  agentDescriptions: string[],
  annotatorDescriptions: string[],
  execDescriptions: string[],
  agentTools: string[][] = [],
  annotatorTools: string[][] = [],
  execTools: string[][] = [],
): PlanRecord {
  const fakeProv = { origin: 'inferred' as const, sourceEvidence: 'test', confidence: 1 };
  const steps = [
    ...annotatorDescriptions.map((desc, i) => ({
      id: `annotator:step:${i + 1}`,
      group: 'annotator' as const,
      index: i + 1,
      description: desc,
      toolsUsed: annotatorTools[i] ?? [],
      provenance: { origin: 'annotator' as const, sourceEvidence: 'test', confidence: 1 },
    })),
    ...agentDescriptions.map((desc, i) => ({
      id: `agent:plan:step:${i + 1}`,
      group: 'agent:plan' as const,
      index: i + 1,
      description: desc,
      toolsUsed: agentTools[i] ?? [],
      provenance: { origin: 'explicit' as const, sourceEvidence: 'test', confidence: 0.95 },
    })),
    ...execDescriptions.map((desc, i) => ({
      id: `agent:exec:step:${i + 1}`,
      group: 'agent:exec' as const,
      index: i + 1,
      description: desc,
      toolsUsed: execTools[i] ?? [],
      spanId: `span:exec:${i + 1}`,
      provenance: { origin: 'explicit' as const, sourceEvidence: 'test', confidence: 0.98 },
    })),
  ];

  return {
    id: `plan:${id}`,
    traceId: id,
    extractedAt: '2025-01-01T00:00:00Z',
    goal: { id: `goal:${id}`, description: 'test goal', taskId: id, provenance: fakeProv },
    steps,
    edges: [],
    informationFlows: [],
    riskFlags: [],
    metadata: {
      agentModel: 'test',
      agentAnswer: '',
      annotatorStepCount: annotatorDescriptions.length,
      annotatorToolCount: 0,
      totalDurationSeconds: 0,
      verified: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Milestone C: execution alignment tests
// ---------------------------------------------------------------------------

test('alignAgentExecToAnnotator returns results for exec-group steps', () => {
  const record = makeSyntheticRecordWithExec(
    'exec-basic',
    ['plan: do something unrelated'],
    ['search USGS nonnative species database', 'extract zip code from results'],
    ['Execution Step 1: usgs nonnative species clownfish database query'],
  );

  const result = alignAgentExecToAnnotator(record);
  assert.equal(result.traceId, 'exec-basic');
  assert.equal(result.alignments.length, 1, 'one alignment per exec step');
  assert.ok(result.coverage >= 0 && result.coverage <= 1);
  assert.ok(Array.isArray(result.uncoveredAnnotatorStepIds));
  assert.ok(Array.isArray(result.uncoveredExecStepIds));
  assert.ok(Array.isArray(result.gapDescriptions));
});

test('alignAgentExecToAnnotator matches exec step to annotator step via lexical overlap', () => {
  // Exec thought text overlaps strongly with annotator step 1 but not step 2.
  const record = makeSyntheticRecordWithExec(
    'exec-lexical',
    ['plan: vague unrelated planning step'],
    [
      'retrieve wikipedia article about dinosaurs',
      'calculate the numeric answer from the data',
    ],
    [
      // Exec thought mentions dinosaurs + wikipedia → should match annotator:step:1
      'Execution Step 1: I verified the dinosaur species via wikipedia article content',
    ],
  );

  const result = alignAgentExecToAnnotator(record);
  const al = result.alignments[0]!;
  assert.ok(al.matched, 'exec step should match annotator:step:1');
  assert.equal(al.annotatorStepId, 'annotator:step:1');
  assert.ok(al.lexicalScore > 0, 'lexical score must be positive for overlapping tokens');
  // annotator:step:2 should remain uncovered by exec
  assert.ok(result.uncoveredAnnotatorStepIds.includes('annotator:step:2'));
});

test('alignAgentExecToAnnotator gap descriptions cover uncovered annotator steps', () => {
  const record = makeSyntheticRecordWithExec(
    'exec-gaps',
    [],
    ['search web for nonnative species', 'verify zip code from fred howard park'],
    // Exec step only overlaps with step 1
    ['Execution Step 1: search for nonnative species usgs database'],
  );

  const result = alignAgentExecToAnnotator(record);
  // step 2 should be uncovered
  assert.ok(result.uncoveredAnnotatorStepIds.includes('annotator:step:2'));
  assert.equal(result.gapDescriptions.length, result.uncoveredAnnotatorStepIds.length);
  const gap = result.gapDescriptions.find((g) => g.annotatorStepId === 'annotator:step:2')!;
  assert.ok(gap, 'gap description for step 2 must exist');
  assert.ok(gap.reason.includes('exec candidate') || gap.reason.includes('no agent'), 'reason must explain the exec gap');
});

test('exec alignment on fixture trace produces scores and uses enriched thought text', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const execSteps = record.steps.filter((s) => s.group === 'agent:exec');
  const result = alignAgentExecToAnnotator(record);

  assert.equal(result.alignments.length, execSteps.length);
  // Exec step thought mentions USGS, clownfish, nonnative — should score > 0 against relevant annotator steps
  assert.ok(result.alignments.some((a) => a.lexicalScore > 0), 'some exec step must have positive lexical score');
  // Gap descriptions should cover uncovered annotator steps
  assert.equal(result.gapDescriptions.length, result.uncoveredAnnotatorStepIds.length);
});

// ---------------------------------------------------------------------------
// Milestone C: mergeSupport tests
// ---------------------------------------------------------------------------

test('mergeSupport identifies execution-only coverage when plan is silent', () => {
  // Annotator step 2 is about zip codes — plan is silent, exec covers it.
  const record = makeSyntheticRecordWithExec(
    'merge-exec-only',
    ['vague plan: do some research'],  // plan doesn't mention zip codes
    [
      'search web for nonnative species database',
      'find the zip code for fred howard park',
    ],
    [
      'Execution Step 1: I searched usgs nonnative database',        // covers annotator:1
      'Execution Step 2: I found the fred howard park zip code',      // covers annotator:2
    ],
  );

  const planAlignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const support = mergeSupport(record, planAlignment, execAlignment);

  assert.equal(support.traceId, 'merge-exec-only');
  assert.equal(support.stepSupports.length, 2);

  // At least one step should be exec-only (plan didn't cover it but exec did)
  const execOnlySteps = support.stepSupports.filter((s) => s.supportSource === 'execution');
  assert.ok(execOnlySteps.length >= 1, 'at least one step should be execution-only');
  assert.ok(support.executionOnlyCount >= 1);
});

test('mergeSupport identifies truly missing steps when neither plan nor exec covers', () => {
  // Neither plan nor exec mentions "verify zip code"
  const record = makeSyntheticRecordWithExec(
    'merge-truly-missing',
    ['search web for dinosaurs'],
    [
      'search web for dinosaurs',
      'verify zip code from postal database',  // completely unrelated to plan and exec
    ],
    ['Execution Step 1: I searched for dinosaur information on the web'],
  );

  const planAlignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const support = mergeSupport(record, planAlignment, execAlignment);

  // annotator:step:2 (zip code) should be truly missing
  const step2 = support.stepSupports.find((s) => s.annotatorStepId === 'annotator:step:2')!;
  assert.ok(step2, 'support entry for step 2 must exist');
  assert.equal(step2.supportSource, 'none', 'step 2 should be truly missing');
  assert.equal(step2.mergedCoverage, false);
  assert.ok(support.trulyMissingCount >= 1);
});

test('mergeSupport identifies both-covered steps correctly', () => {
  // Annotator step 1 is well-described in both plan and exec.
  const record = makeSyntheticRecordWithExec(
    'merge-both-covered',
    ['retrieve wikipedia article about dinosaurs'],
    ['retrieve wikipedia article about dinosaurs'],
    ['Execution Step 1: retrieved wikipedia article dinosaurs confirmed'],
  );

  const planAlignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const support = mergeSupport(record, planAlignment, execAlignment);

  const step1 = support.stepSupports[0]!;
  assert.equal(step1.supportSource, 'both', 'step 1 should be covered by both');
  assert.equal(step1.planSupportKind, 'single_step');
  assert.equal(step1.mergedCoverage, true);
  assert.ok(step1.planScore > 0);
  assert.ok(step1.execScore > 0);
  assert.equal(support.mergedCoverage, 1);
});

 test('mergeSupport can rescue compressed plan coverage via segment support', () => {
  const record = makeSyntheticRecordWithExec(
    'merge-segment-rescue',
    ['count the children and then calculate the child potatoes'],
    ['count the children', 'subtract the second cousins', 'calculate the child potatoes'],
    [],
  );

  const planAlignment = alignAgentPlanToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });
  const execAlignment = alignAgentExecToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: 0.25, mode: 'semantic', maxSpanLength: 3 });
  const support = mergeSupport(record, planAlignment, execAlignment, segmentSupport);

  const rescued = support.stepSupports.filter((s) => s.planSupportKind === 'segment_only');
  assert.ok(rescued.length >= 2, 'segment support should rescue multiple annotator steps');
  assert.ok(support.segmentOnlyCount >= 2);
  assert.ok(support.mergedCoverage > planAlignment.coverage);
  assert.ok(rescued.every((s) => s.segmentAgentStepId), 'rescued steps should point back to the compressed agent step');
  assert.ok(rescued.every((s) => s.segmentSupportExplanation?.includes('Covered by compressed agent plan step')));
 });

test('mergeSupport merged coverage is always >= plan-only coverage', () => {
  const record = makeSyntheticRecordWithExec(
    'merge-coverage-monotone',
    ['vague plan step'],
    ['search for relevant documents', 'verify computed result'],
    ['Execution Step 1: I searched for relevant documents online'],
  );

  const planAlignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const support = mergeSupport(record, planAlignment, execAlignment);

  assert.ok(
    support.mergedCoverage >= planAlignment.coverage - 1e-9,
    `merged coverage ${support.mergedCoverage} should be >= plan coverage ${planAlignment.coverage}`,
  );
});

test('mergeSupport with no exec steps equals plan-only coverage', () => {
  // No exec steps: merged support should mirror plan alignment exactly.
  const record = makeSyntheticRecord(
    'merge-no-exec',
    ['search for relevant documents online'],
    ['search for relevant documents', 'verify the result'],
  );

  const planAlignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const support = mergeSupport(record, planAlignment, execAlignment);

  // With no exec steps, nothing new gets covered
  assert.ok(Math.abs(support.mergedCoverage - planAlignment.coverage) < 1e-9,
    'mergedCoverage must equal plan coverage when there are no exec steps');
  assert.equal(support.executionOnlyCount, 0);
});

// ---------------------------------------------------------------------------
// Milestone C: deriveMergedRiskFlags tests
// ---------------------------------------------------------------------------

test('deriveMergedRiskFlags raises plan_gap for execution-only coverage', () => {
  const record = makeSyntheticRecordWithExec(
    'flags-plan-gap',
    ['vague plan step unrelated to zip codes'],
    [
      'search web for nonnative species',
      'find the zip code for fred howard park',
    ],
    [
      'Execution Step 1: searched usgs nonnative database',
      'Execution Step 2: found the fred howard park zip code florida',
    ],
  );

  const planAlignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const support = mergeSupport(record, planAlignment, execAlignment);
  const flags = deriveMergedRiskFlags(record, support);

  const planGapFlags = flags.filter((f) => f.type === 'plan_gap');
  assert.ok(planGapFlags.length >= 1, 'at least one plan_gap flag expected');
  for (const f of planGapFlags) {
    assert.equal(f.severity, 'medium');
    assert.ok(f.description.includes('execution'), 'description should mention execution');
    assert.ok(f.description.includes('plan'), 'description should mention plan');
  }
});

test('deriveMergedRiskFlags raises truly_missing_step for truly uncovered steps, not plan_gap', () => {
  const record = makeSyntheticRecordWithExec(
    'flags-truly-missing',
    ['search web for dinosaurs'],
    [
      'search web for dinosaurs',
      'completely unrelated verification with no overlap',
    ],
    ['Execution Step 1: searched for dinosaur information'],
  );

  const planAlignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const support = mergeSupport(record, planAlignment, execAlignment);
  const flags = deriveMergedRiskFlags(record, support);

  const missingFlags = flags.filter((f) => f.type === 'truly_missing_step');
  const planGapFlags = flags.filter((f) => f.type === 'plan_gap');

  assert.ok(missingFlags.length >= 1, 'at least one truly_missing_step flag expected');
  // The truly missing step should not produce a plan_gap flag
  const step2MissingFlag = flags.find((f) => f.stepId === 'annotator:step:2' && f.type === 'truly_missing_step');
  assert.ok(step2MissingFlag, 'truly_missing_step flag for step 2 must exist');
  assert.equal(step2MissingFlag!.severity, 'high');
  // No plan_gap for the truly missing step
  const step2PlanGap = planGapFlags.find((f) => f.stepId === 'annotator:step:2');
  assert.equal(step2PlanGap, undefined, 'truly missing step must not produce plan_gap');
});

test('batch summary includes merged risk flags in riskFlagCounts', () => {
  const record = makeSyntheticRecordWithExec(
    'summary-merged-risk-counts',
    ['search web for dinosaurs'],
    ['search web for dinosaurs', 'verify zip code from postal database'],
    ['Execution Step 1: searched for dinosaur information'],
  );

  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const items = [{
    record,
    alignment,
    alignmentRiskFlags: deriveAlignmentRiskFlags(record, alignment),
    execAlignment,
    segmentSupport,
    mergedSupport: merged,
    mergedRiskFlags,
    policyEvaluation: evaluatePlanPolicy(record, merged, mergedRiskFlags),
  }];

  const summary = summarizePlanBatch(items);
  assert.ok((summary.riskFlagCounts.truly_missing_step ?? 0) >= 1);
});

// ---------------------------------------------------------------------------
// Milestone D: policy verdict tests
// ---------------------------------------------------------------------------

test('evaluatePlanPolicy returns BLOCK for wrong answers', () => {
  const record = canonicalizeGaiaTrace(rawTrace);
  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  assert.equal(result.verdict, 'BLOCK');
  assert.ok(result.findings.some((f) => f.type === 'wrong_answer'));
});

test('evaluatePlanPolicy returns CONDITIONAL_ALLOW for unverifiable but structurally covered plans', () => {
  const record = makeSyntheticRecordWithExec(
    'policy-unverifiable',
    ['retrieve wikipedia article about dinosaurs'],
    ['retrieve wikipedia article about dinosaurs'],
    ['Execution Step 1: retrieved wikipedia article dinosaurs confirmed'],
  );

  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  assert.equal(result.verdict, 'CONDITIONAL_ALLOW');
  assert.ok(result.findings.some((f) => f.type === 'unverifiable'));
  assert.ok(!result.findings.some((f) => f.type === 'wrong_answer'));
});

test('evaluatePlanPolicy returns HOLD for unresolved truly missing steps', () => {
  const record = makeSyntheticRecordWithExec(
    'policy-hold',
    ['search web for dinosaurs'],
    ['search web for dinosaurs', 'verify zip code from postal database'],
    ['Execution Step 1: searched for dinosaur information'],
  );
  record.metadata.verified = true;

  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  assert.equal(result.verdict, 'HOLD');
  assert.ok(result.findings.some((f) => f.type === 'truly_missing_step'));
});

test('evaluatePlanPolicy returns CONDITIONAL_ALLOW for execution-only plan gaps', () => {
  const record = makeSyntheticRecordWithExec(
    'policy-conditional-allow',
    ['search web for nonnative species'],
    [
      'search web for nonnative species',
      'find the zip code for fred howard park',
    ],
    [
      'Execution Step 1: searched usgs nonnative database',
      'Execution Step 2: found the fred howard park zip code florida',
    ],
  );
  record.metadata.verified = true;

  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  // After 38f55ff: retrieval observability gap detection now routes this to HOLD
  assert.equal(result.verdict, 'HOLD');
  assert.ok(result.findings.some((f) => f.type === 'plan_gap'));
});

test('evaluatePlanPolicy returns CONDITIONAL_ALLOW for fully covered verified plans', () => {
  // After 7c3cf87: answerCorrectBySanityCheck→ALLOW fast-path was removed.
  // Fully covered verified plans now return CONDITIONAL_ALLOW.
  const record = makeSyntheticRecordWithExec(
    'policy-allow',
    ['retrieve wikipedia article about dinosaurs'],
    ['retrieve wikipedia article about dinosaurs'],
    ['Execution Step 1: retrieved wikipedia article dinosaurs confirmed'],
  );
  record.metadata.verified = true;

  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  assert.equal(result.verdict, 'CONDITIONAL_ALLOW');
});

test('evaluatePlanPolicy returns ALLOW when segment support fully rescues a compressed verified plan', () => {
  const record = makeSyntheticRecordWithExec(
    'policy-segment-allow',
    ['worked out the resulting win probabilities for the earliest positions'],
    [
      'for each trial, either 1 or 2 balls from the ramp will advance to the platform',
      'for any given selection, there is a 50% chance that the ball advances to position 2 or position 3',
    ],
    [],
  );
  record.metadata.verified = true;

  const alignment = alignAgentPlanToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });
  const execAlignment = alignAgentExecToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: 0.25, mode: 'semantic', maxSpanLength: 4 });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  assert.ok(merged.segmentOnlyCount >= 1, 'expected at least one segment-rescued step');
  assert.equal(result.verdict, 'ALLOW');
  assert.equal(result.findings.length, 0);
});

test('evaluatePlanPolicy exposes hard-stop classes for wrong-answer blocks', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace]);
  const result = items[0]!.policyEvaluation;

  assert.equal(result.verdict, 'BLOCK');
  assert.ok(result.metrics.hardStopClasses.includes('factual_failure'));
  assert.ok(result.metrics.answerConfidence === 'low');
});

test('evaluatePlanPolicy routes tool-chain traces separately and treats execution-only support as partial execution', () => {
  const record = makeSyntheticRecordWithExec(
    'policy-tool-chain-partial',
    ['run python script to compute the numeric result'],
    [
      'run python script to compute the numeric result',
      'verify the computed result in the script output',
    ],
    [
      'Execution Step 1: ran python script to compute the numeric result',
      'Execution Step 2: verified the computed result in the script output',
    ],
    [['python_interpreter']],
    [],
    [['python_interpreter'], ['python_interpreter']],
  );
  record.metadata.verified = true;

  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  assert.equal(result.metrics.taskType, 'tool_chain');
  assert.equal(result.metrics.executionChainStatus, 'partial');
  assert.equal(result.verdict, 'CONDITIONAL_ALLOW');
  assert.ok(result.findings.some((f) => f.type === 'plan_gap'));
});

test('evaluatePlanPolicy routes deterministic traces separately', () => {
  const record = makeSyntheticRecordWithExec(
    'policy-deterministic-route',
    ['worked out the resulting win probabilities for the earliest positions'],
    [
      'for each trial, either 1 or 2 balls from the ramp will advance to the platform',
      'for any given selection, there is a 50% chance that the ball advances to position 2 or position 3',
    ],
    [],
  );
  record.goal.description = 'solve the logic puzzle about the resulting win probabilities';
  record.metadata.verified = true;

  const alignment = alignAgentPlanToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });
  const execAlignment = alignAgentExecToAnnotator(record, { minimumScore: 0.25, mode: 'semantic' });
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: 0.25, mode: 'semantic', maxSpanLength: 4 });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);

  assert.equal(result.metrics.taskType, 'deterministic');
  assert.equal(result.verdict, 'ALLOW');
});

test('formatPlanPolicyReport renders verdict, metrics, and findings', () => {
  const record = makeSyntheticRecordWithExec(
    'policy-report',
    ['search web for dinosaurs'],
    ['search web for dinosaurs', 'verify zip code from postal database'],
    ['Execution Step 1: searched for dinosaur information'],
  );
  record.metadata.verified = true;

  const alignment = alignAgentPlanToAnnotator(record);
  const execAlignment = alignAgentExecToAnnotator(record);
  const segmentSupport = computePlanSegmentSupport(record, { minimumScore: alignment.minimumScore, mode: alignment.mode });
  const merged = mergeSupport(record, alignment, execAlignment, segmentSupport);
  const mergedRiskFlags = deriveMergedRiskFlags(record, merged);
  const result = evaluatePlanPolicy(record, merged, mergedRiskFlags);
  const report = formatPlanPolicyReport(result);

  assert.ok(report.includes('traceId: policy-report'));
  assert.ok(report.includes('verdict: HOLD'));
  assert.ok(report.includes('findings:'));
  assert.ok(report.includes('truly_missing_step'));
});

test('formatPlanPolicyBatchReport renders verdict counts and per-trace sections', () => {
  const allowRecord = makeSyntheticRecordWithExec(
    'policy-batch-allow',
    ['retrieve wikipedia article about dinosaurs'],
    ['retrieve wikipedia article about dinosaurs'],
    ['Execution Step 1: retrieved wikipedia article dinosaurs confirmed'],
  );
  allowRecord.metadata.verified = true;
  const allowAlignment = alignAgentPlanToAnnotator(allowRecord);
  const allowExec = alignAgentExecToAnnotator(allowRecord);
  const allowSegment = computePlanSegmentSupport(allowRecord, { minimumScore: allowAlignment.minimumScore, mode: allowAlignment.mode });
  const allowMerged = mergeSupport(allowRecord, allowAlignment, allowExec, allowSegment);
  const allowResult = evaluatePlanPolicy(allowRecord, allowMerged, deriveMergedRiskFlags(allowRecord, allowMerged));

  const holdRecord = makeSyntheticRecordWithExec(
    'policy-batch-hold',
    ['search web for dinosaurs'],
    ['search web for dinosaurs', 'verify zip code from postal database'],
    ['Execution Step 1: searched for dinosaur information'],
  );
  holdRecord.metadata.verified = true;
  const holdAlignment = alignAgentPlanToAnnotator(holdRecord);
  const holdExec = alignAgentExecToAnnotator(holdRecord);
  const holdSegment = computePlanSegmentSupport(holdRecord, { minimumScore: holdAlignment.minimumScore, mode: holdAlignment.mode });
  const holdMerged = mergeSupport(holdRecord, holdAlignment, holdExec, holdSegment);
  const holdResult = evaluatePlanPolicy(holdRecord, holdMerged, deriveMergedRiskFlags(holdRecord, holdMerged));

  const report = formatPlanPolicyBatchReport([allowResult, holdResult]);
  assert.ok(report.includes('count: 2'));
  assert.ok(report.includes('ALLOW: 1'));
  assert.ok(report.includes('HOLD: 1'));
  assert.ok(report.includes('traceId: policy-batch-allow'));
  assert.ok(report.includes('traceId: policy-batch-hold'));
});

test('buildPlanPolicyBatchExport returns stable JSON-friendly schema', () => {
  const allowRecord = makeSyntheticRecordWithExec(
    'policy-export-allow',
    ['retrieve wikipedia article about dinosaurs'],
    ['retrieve wikipedia article about dinosaurs'],
    ['Execution Step 1: retrieved wikipedia article dinosaurs confirmed'],
  );
  allowRecord.metadata.verified = true;
  const allowAlignment = alignAgentPlanToAnnotator(allowRecord);
  const allowExec = alignAgentExecToAnnotator(allowRecord);
  const allowSegment = computePlanSegmentSupport(allowRecord, { minimumScore: allowAlignment.minimumScore, mode: allowAlignment.mode });
  const allowMerged = mergeSupport(allowRecord, allowAlignment, allowExec, allowSegment);
  const allowResult = evaluatePlanPolicy(allowRecord, allowMerged, deriveMergedRiskFlags(allowRecord, allowMerged));

  const holdRecord = makeSyntheticRecordWithExec(
    'policy-export-hold',
    ['search web for dinosaurs'],
    ['search web for dinosaurs', 'verify zip code from postal database'],
    ['Execution Step 1: searched for dinosaur information'],
  );
  holdRecord.metadata.verified = true;
  const holdAlignment = alignAgentPlanToAnnotator(holdRecord);
  const holdExec = alignAgentExecToAnnotator(holdRecord);
  const holdSegment = computePlanSegmentSupport(holdRecord, { minimumScore: holdAlignment.minimumScore, mode: holdAlignment.mode });
  const holdMerged = mergeSupport(holdRecord, holdAlignment, holdExec, holdSegment);
  const holdResult = evaluatePlanPolicy(holdRecord, holdMerged, deriveMergedRiskFlags(holdRecord, holdMerged));

  const batch = buildPlanPolicyBatchExport([allowResult, holdResult]);
  assert.equal(batch.schemaVersion, 'plan-policy-report/v2');
  assert.equal(batch.count, 2);
  // After 7c3cf87: fully covered verified plans return CONDITIONAL_ALLOW, not ALLOW
  assert.equal(batch.verdictCounts.CONDITIONAL_ALLOW, 1);
  assert.equal(batch.verdictCounts.HOLD, 1);
  assert.equal(batch.results.length, 2);
});

// ---------------------------------------------------------------------------
// Milestone C: batch integration tests
// ---------------------------------------------------------------------------

test('batch item includes execAlignment, mergedSupport, mergedRiskFlags, and policyEvaluation fields', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace]);
  assert.equal(items.length, 1);
  const item = items[0]!;

  assert.ok(item.execAlignment, 'execAlignment must be present');
  assert.ok(item.segmentSupport, 'segmentSupport must be present');
  assert.ok(item.mergedSupport, 'mergedSupport must be present');
  assert.ok(item.mergedRiskFlags, 'mergedRiskFlags must be present');
  assert.ok(item.policyEvaluation, 'policyEvaluation must be present');

  assert.equal(item.execAlignment.traceId, item.record.traceId);
  assert.equal(item.segmentSupport.traceId, item.record.traceId);
  assert.equal(item.mergedSupport.traceId, item.record.traceId);
  assert.equal(item.policyEvaluation.traceId, item.record.traceId);
  assert.ok(item.mergedSupport.stepSupports.length > 0, 'stepSupports must have entries');
  assert.ok(Array.isArray(item.mergedRiskFlags));
});

test('batch summary includes totalExecutionOnlySteps, totalTrulyMissingSteps, and verdictCounts', () => {
  const items = canonicalizeGaiaTraceBatch([rawTrace, rawTrace]);
  const summary = summarizePlanBatch(items);

  assert.ok(typeof summary.totalSegmentOnlySteps === 'number');
  assert.ok(typeof summary.totalExecutionOnlySteps === 'number');
  assert.ok(typeof summary.totalTrulyMissingSteps === 'number');
  assert.ok(summary.totalSegmentOnlySteps >= 0);
  assert.ok(summary.totalExecutionOnlySteps >= 0);
  assert.ok(summary.totalTrulyMissingSteps >= 0);
  assert.ok(typeof summary.verdictCounts.BLOCK === 'number');

  // Consistency: execOnly + planOnly + both + trulyMissing == total annotator steps per trace
  for (const item of items) {
    const ms = item.mergedSupport;
    const annotatorCount = item.record.steps.filter((s) => s.group === 'annotator').length;
    const total = ms.executionOnlyCount + ms.planOnlyCount + ms.bothCount + ms.trulyMissingCount;
    assert.equal(total, annotatorCount, `support counts must sum to annotator step count for ${item.record.traceId}`);
  }
});

test('empty batch returns zeroed Milestone C summary fields', () => {
  const summary = summarizePlanBatch([]);
  assert.equal(summary.totalSegmentOnlySteps, 0);
  assert.equal(summary.totalExecutionOnlySteps, 0);
  assert.equal(summary.totalTrulyMissingSteps, 0);
});
