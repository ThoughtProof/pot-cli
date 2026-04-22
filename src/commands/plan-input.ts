import { readFileSync } from 'node:fs';
import {
  canonicalizeFirstPartyGaiaTraces,
  looksLikeFirstPartyGaiaTrace,
  parseFirstPartyGaiaTraceJsonl,
  type FirstPartyGaiaTrace,
} from '../plan/first-party-traces.js';
import type { AlignmentMode } from '../plan/alignment.js';
import type { PlanRecord } from '../plan/types.js';

export type PlanInputSourceFormat = 'plan-records' | 'first-party-json' | 'first-party-jsonl';

export function looksLikePlanRecord(value: unknown): value is PlanRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PlanRecord>;
  return typeof candidate.id === 'string'
    && typeof candidate.traceId === 'string'
    && !!candidate.goal
    && Array.isArray(candidate.steps)
    && Array.isArray(candidate.edges)
    && Array.isArray(candidate.informationFlows)
    && Array.isArray(candidate.riskFlags)
    && !!candidate.metadata;
}

export function loadPlanRecordsInput(inputFile: string): {
  records: PlanRecord[];
  sourceFormat: PlanInputSourceFormat;
} {
  const raw = readFileSync(inputFile, 'utf8');

  if (inputFile.endsWith('.jsonl')) {
    const traces = parseFirstPartyGaiaTraceJsonl(raw);
    return {
      records: canonicalizeFirstPartyGaiaTraces(traces),
      sourceFormat: 'first-party-jsonl',
    };
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${inputFile} to contain a JSON array or JSONL file.`);
  }

  if (parsed.length === 0) {
    return {
      records: [],
      sourceFormat: 'plan-records',
    };
  }

  if (looksLikePlanRecord(parsed[0])) {
    return {
      records: parsed as PlanRecord[],
      sourceFormat: 'plan-records',
    };
  }

  if (looksLikeFirstPartyGaiaTrace(parsed[0])) {
    return {
      records: canonicalizeFirstPartyGaiaTraces(parsed as FirstPartyGaiaTrace[]),
      sourceFormat: 'first-party-json',
    };
  }

  throw new Error(
    `Could not detect input format for ${inputFile}. Expected PlanRecord[] or first-party GAIA trace objects.`,
  );
}

export function parseAlignmentMode(mode: string | undefined, defaultMode: AlignmentMode = 'semantic'): AlignmentMode {
  const resolved = mode ?? defaultMode;
  if (resolved !== 'lexical' && resolved !== 'semantic') {
    throw new Error(`mode must be one of: lexical, semantic. Got: ${resolved}`);
  }
  return resolved;
}
