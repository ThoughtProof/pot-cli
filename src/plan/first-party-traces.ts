import {
  firstPartyTraceToPlanRecord,
  type FirstPartyGaiaTrace,
} from './first-party-adapter.js';
import type { PlanRecord } from './types.js';

export type { FirstPartyGaiaTrace } from './first-party-adapter.js';

export interface CanonicalizeFirstPartyOptions {
  extractedAt?: string;
}

export function parseNumberedList(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^step\s*\d+\s*[:.)-]?\s*/i, ''))
    .map((line) => line.replace(/^\d+\s*[:.)-]?\s*/, ''))
    .map((line) => line.replace(/^[-•]\s*/, ''))
    .map((line) => line.trim())
    .filter(Boolean);
}

export function canonicalizeFirstPartyGaiaTrace(
  trace: FirstPartyGaiaTrace,
  options: CanonicalizeFirstPartyOptions = {},
): PlanRecord {
  return firstPartyTraceToPlanRecord(trace, options);
}

export function canonicalizeFirstPartyGaiaTraces(
  traces: FirstPartyGaiaTrace[],
  options: CanonicalizeFirstPartyOptions = {},
): PlanRecord[] {
  return traces.map((trace) => canonicalizeFirstPartyGaiaTrace(trace, options));
}

export function parseFirstPartyGaiaTraceJsonl(raw: string): FirstPartyGaiaTrace[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FirstPartyGaiaTrace);
}

export function looksLikeFirstPartyGaiaTrace(value: unknown): value is FirstPartyGaiaTrace {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<FirstPartyGaiaTrace>;
  return typeof candidate.task_id === 'string'
    && typeof candidate.question === 'string'
    && typeof candidate.answer === 'string'
    && !!candidate.trace
    && Array.isArray(candidate.trace.steps);
}
