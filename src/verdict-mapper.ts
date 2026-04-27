/**
 * verdict-mapper.ts
 * =================
 * Maps internal engine verdicts to the public 3-tier API contract.
 *
 * Internal vocabulary:    ALLOW | CONDITIONAL_ALLOW | HOLD | DISSENT | BLOCK
 * Public (API/SDK):       ALLOW | BLOCK | UNCERTAIN
 *
 * Currently emitted by the engine: ALLOW, CONDITIONAL_ALLOW, HOLD, BLOCK
 * (`EvaluatorVerdict` in src/plan/graded-support-evaluator.ts).
 *
 * DISSENT is preserved in the InternalVerdict type and the mapping table for
 * forward-compatibility. It was historically reserved for a multi-model
 * aggregator path that ADR-0002 rejected on 2026-04-27 (correlation test
 * showed no accuracy lift from multi-model voting). If a future ADR
 * re-introduces an aggregator that emits DISSENT, no mapper change is needed.
 *
 * This is the ONLY module that performs this mapping. All API/SDK response
 * paths MUST call toPublicVerdict(). No bypass path.
 *
 * @since v0.8.1
 * @see docs/adr/0001-verdict-model.md
 * @see docs/adr/0002-step-level-triple-majority-REJECTED.md
 * @see docs/adr/0005-margin-band-and-confidence-metadata-DRAFT.md
 */

// ── Internal verdict type (engine/CLI, 5-tier) ──────────────────────────

export type InternalVerdict =
  | 'ALLOW'
  | 'CONDITIONAL_ALLOW'
  | 'HOLD'
  | 'DISSENT'
  | 'BLOCK';

// ── Public verdict type (API/SDK, 3-tier) ───────────────────────────────

export type PublicVerdict = 'ALLOW' | 'BLOCK' | 'UNCERTAIN';

/**
 * Confidence indicator (ADR-0005, PR-F).
 *
 * - 'high':       score is unambiguously inside its predicate band (no margin-band hit).
 * - 'borderline': at least one critical or non-critical step had a `supported`/`faithful`
 *                 predicate whose score lay within MARGIN_BAND_HALFWIDTH of
 *                 SUPPORTED_THRESHOLD. The verdict is still authoritative
 *                 (Margin Band already pushes such cases to UNCERTAIN internally),
 *                 but the customer is informed that re-evaluation may yield a
 *                 different verdict due to LLM sampling noise.
 *
 * Always present in v2 responses (Paul, Entscheidung 2A, 2026-04-27).
 */
export type Confidence = 'high' | 'borderline';

export interface PublicVerdictResponse {
  verdict: PublicVerdict;
  metadata: {
    schema_version: 'v2';
    confidence: Confidence;
    conditions?: string[];
    review_needed?: boolean;
    dissent?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Optional flags forwarded from the engine to the public mapping. Additive;
 * unset fields default to behaviour equivalent to pre-PR-F.
 */
export interface ToPublicVerdictOptions {
  /** True iff deriveVerdict's marginBandTriggered flag was set. Default: false. */
  marginBandTriggered?: boolean;
}

// ── Mapping function ────────────────────────────────────────────────────

/**
 * Maps an internal 5-tier verdict to the public 3-tier contract.
 *
 * Mapping table:
 *   ALLOW              → { verdict: 'ALLOW',     metadata: { schema_version: 'v2', confidence } }
 *   CONDITIONAL_ALLOW  → { verdict: 'ALLOW',     metadata: { schema_version: 'v2', confidence, conditions: [...] } }
 *   HOLD               → { verdict: 'UNCERTAIN', metadata: { schema_version: 'v2', confidence, review_needed: true } }
 *   DISSENT            → { verdict: 'UNCERTAIN', metadata: { schema_version: 'v2', confidence, dissent: true } }
 *   BLOCK              → { verdict: 'BLOCK',     metadata: { schema_version: 'v2', confidence } }
 *
 * `confidence` (PR-F, ADR-0005): always present, 'high' by default. Set to
 * 'borderline' iff `options.marginBandTriggered` is true — indicating the
 * engine's deriveVerdict found at least one `supported` predicate whose
 * score lay within MARGIN_BAND_HALFWIDTH of SUPPORTED_THRESHOLD.
 *
 * @param internal - The engine's internal verdict
 * @param conditions - Optional conditions array for CONDITIONAL_ALLOW verdicts
 * @param options - Optional flags from the engine (marginBandTriggered)
 * @returns PublicVerdictResponse with 3-tier verdict + metadata (confidence always present)
 */
export function toPublicVerdict(
  internal: InternalVerdict,
  conditions?: string[],
  options?: ToPublicVerdictOptions,
): PublicVerdictResponse {
  const confidence: Confidence = options?.marginBandTriggered ? 'borderline' : 'high';

  switch (internal) {
    case 'ALLOW':
      return {
        verdict: 'ALLOW',
        metadata: { schema_version: 'v2', confidence },
      };

    case 'CONDITIONAL_ALLOW':
      return {
        verdict: 'ALLOW',
        metadata: {
          schema_version: 'v2',
          confidence,
          conditions: conditions ?? [],
        },
      };

    case 'HOLD':
      return {
        verdict: 'UNCERTAIN',
        metadata: {
          schema_version: 'v2',
          confidence,
          review_needed: true,
        },
      };

    case 'DISSENT':
      return {
        verdict: 'UNCERTAIN',
        metadata: {
          schema_version: 'v2',
          confidence,
          dissent: true,
        },
      };

    case 'BLOCK':
      return {
        verdict: 'BLOCK',
        metadata: { schema_version: 'v2', confidence },
      };

    default: {
      // Exhaustiveness check — if a new internal verdict is added
      // without updating this mapper, TypeScript will error here.
      const _exhaustive: never = internal;
      throw new Error(`Unknown internal verdict: ${_exhaustive}`);
    }
  }
}

// ── Guard: internal format requires env var ─────────────────────────────

/**
 * Checks whether internal (5-tier) output format is allowed.
 * Requires THOUGHTPROOF_INTERNAL=1 environment variable.
 */
export function isInternalFormatAllowed(): boolean {
  return process.env.THOUGHTPROOF_INTERNAL === '1';
}

/**
 * Asserts internal format is allowed, or throws with a clear message.
 */
export function assertInternalFormat(): void {
  if (!isInternalFormatAllowed()) {
    throw new Error(
      'Internal format requires research mode (set THOUGHTPROOF_INTERNAL=1)',
    );
  }
}
