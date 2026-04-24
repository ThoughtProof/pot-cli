import type { FirstPartyGaiaTrace } from './first-party-adapter.js';

export type FirstPartyGoldMapEntry = {
  ground_truth?: string;
  true_answer?: string;
  annotator_steps: string[];
  annotator_tools?: string[];
  accepted_answers?: string[];
};

function getGoldTruth(gold: FirstPartyGoldMapEntry): string {
  const truth = gold.ground_truth ?? gold.true_answer;
  if (!truth) {
    throw new Error('gold map entry missing ground_truth/true_answer');
  }
  return truth;
}

export function normalizeFirstPartyAnswer(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function deriveFinalCorrect(
  traceAnswer: string | undefined,
  gold: FirstPartyGoldMapEntry,
  existingFinalCorrect?: boolean | null,
): { finalCorrect: boolean; method: string } {
  if (typeof existingFinalCorrect === 'boolean') {
    return {
      finalCorrect: existingFinalCorrect,
      method: 'preserved_from_trace',
    };
  }

  const goldTruth = getGoldTruth(gold);
  const acceptedAnswers = [goldTruth, ...(gold.accepted_answers ?? [])]
    .map((value) => normalizeFirstPartyAnswer(value))
    .filter(Boolean);
  const normalizedTraceAnswer = normalizeFirstPartyAnswer(traceAnswer);
  return {
    finalCorrect: acceptedAnswers.includes(normalizedTraceAnswer),
    method: gold.accepted_answers?.length ? 'normalized_string_exact_with_aliases' : 'normalized_string_exact',
  };
}

export function enrichFirstPartyTrace(
  trace: FirstPartyGaiaTrace,
  goldMap: Record<string, FirstPartyGoldMapEntry>,
): FirstPartyGaiaTrace {
  const gold = goldMap[trace.task_id];
  if (!gold) {
    throw new Error(`gold map missing entry for traceId: ${trace.task_id}`);
  }

  const goldTruth = getGoldTruth(gold);
  const annotatorTools = gold.annotator_tools ?? ['Search engine', 'Web browser'];
  const { finalCorrect, method } = deriveFinalCorrect(trace.answer, gold, trace.final_correct);

  return {
    ...trace,
    ground_truth: goldTruth,
    final_correct: finalCorrect,
    annotator_metadata: {
      ...(trace.annotator_metadata ?? {}),
      Steps: gold.annotator_steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
      'Number of steps': String(gold.annotator_steps.length),
      Tools: annotatorTools.map((tool, index) => `${index + 1}. ${tool}`).join('\n'),
      'Number of tools': String(annotatorTools.length),
      gold_ground_truth: goldTruth,
      accepted_answers: JSON.stringify(gold.accepted_answers ?? []),
      final_correct_method: method,
    },
  };
}

export function enrichFirstPartyTraces(
  traces: FirstPartyGaiaTrace[],
  goldMap: Record<string, FirstPartyGoldMapEntry>,
): FirstPartyGaiaTrace[] {
  return traces.map((trace) => enrichFirstPartyTrace(trace, goldMap));
}
