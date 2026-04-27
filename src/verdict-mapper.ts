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

export interface PublicVerdictResponse {
  verdict: PublicVerdict;
  metadata: {
    schema_version: 'v2';
    conditions?: string[];
    review_needed?: boolean;
    dissent?: boolean;
    [key: string]: unknown;
  };
}

// ── Mapping function ────────────────────────────────────────────────────

/**
 * Maps an internal 5-tier verdict to the public 3-tier contract.
 *
 * Mapping table:
 *   ALLOW              → { verdict: 'ALLOW',     metadata: { schema_version: 'v2' } }
 *   CONDITIONAL_ALLOW  → { verdict: 'ALLOW',     metadata: { schema_version: 'v2', conditions: [...] } }
 *   HOLD               → { verdict: 'UNCERTAIN', metadata: { schema_version: 'v2', review_needed: true } }
 *   DISSENT            → { verdict: 'UNCERTAIN', metadata: { schema_version: 'v2', dissent: true } }
 *   BLOCK              → { verdict: 'BLOCK',     metadata: { schema_version: 'v2' } }
 *
 * @param internal - The engine's internal verdict
 * @param conditions - Optional conditions array for CONDITIONAL_ALLOW verdicts
 * @returns PublicVerdictResponse with 3-tier verdict + metadata
 */
export function toPublicVerdict(
  internal: InternalVerdict,
  conditions?: string[],
): PublicVerdictResponse {
  switch (internal) {
    case 'ALLOW':
      return {
        verdict: 'ALLOW',
        metadata: { schema_version: 'v2' },
      };

    case 'CONDITIONAL_ALLOW':
      return {
        verdict: 'ALLOW',
        metadata: {
          schema_version: 'v2',
          conditions: conditions ?? [],
        },
      };

    case 'HOLD':
      return {
        verdict: 'UNCERTAIN',
        metadata: {
          schema_version: 'v2',
          review_needed: true,
        },
      };

    case 'DISSENT':
      return {
        verdict: 'UNCERTAIN',
        metadata: {
          schema_version: 'v2',
          dissent: true,
        },
      };

    case 'BLOCK':
      return {
        verdict: 'BLOCK',
        metadata: { schema_version: 'v2' },
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
