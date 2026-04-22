import type { FirstPartyGaiaTrace } from './first-party-adapter.js';
import { assessSpanEntailment } from './span-entailment.js';

export interface SourceClaimMapEntry {
  support: ReturnType<typeof assessSpanEntailment>['support'];
  confidence: ReturnType<typeof assessSpanEntailment>['confidence'];
  exactStringQuestion: boolean;
  explanation: string;
  matchedSpan?: string;
}

export function buildFirstPartySourceText(trace: FirstPartyGaiaTrace): string {
  const chunks: string[] = [];

  for (const step of trace.trace.steps ?? []) {
    for (const evidence of step.evidence ?? []) {
      if (evidence) chunks.push(evidence);
    }
  }

  return chunks.join('\n');
}

export function buildFirstPartySourceClaimMap(
  traces: FirstPartyGaiaTrace[],
): Record<string, SourceClaimMapEntry> {
  return Object.fromEntries(
    traces.map((trace) => {
      if (!trace.ground_truth) {
        throw new Error(`trace ${trace.task_id} is missing ground_truth; source-claim derivation requires enriched traces`);
      }

      const result = assessSpanEntailment({
        question: trace.question,
        claimedAnswer: trace.ground_truth,
        sourceText: buildFirstPartySourceText(trace),
      });

      return [trace.task_id, {
        support: result.support,
        confidence: result.confidence,
        exactStringQuestion: result.exactStringQuestion,
        explanation: result.explanation,
        matchedSpan: result.matchedSpan,
      }];
    }),
  );
}
