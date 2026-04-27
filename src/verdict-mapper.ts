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
 * @see docs/adr/0005-failscore-gate-decoupling-DRAFT.md
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
 * Two semantics, both covered by 'low':
 *
 * - 'high': verdict is robust against expected LLM sampling jitter. No critical
 *           step is in the failScore-gate band, no supported predicate is in
 *           the (dormant) margin band.
 * - 'low':  verdict is authoritative but at least one signal of step-level
 *           fragility was detected. Concretely:
 *             (a) PRIMARY: exactly one critical step has a `partial`/`weakly_faithful`/
 *                 `partially_faithful` predicate (failScore == 0.5) — the
 *                 step is marginally unsupported, not unsupported. ALLOW with low
 *                 confidence is the calibrated answer; UNCERTAIN here would be
 *                 a binary cliff per Hermes' variance data (2026-04-27).
 *             (b) DEFENSIVE: a `supported`/`faithful` predicate's score sat within
 *                 MARGIN_BAND_HALFWIDTH of SUPPORTED_THRESHOLD. Empirically 0/8
 *                 of observed flips, kept as future defensive layer.
 *
 * Naming: 'low' (not 'borderline') because the empirical mechanism is a weak
 * critical step, not threshold proximity (Paul, 2026-04-27 21:42 CEST).
 *
 * Always present in v2 responses (Paul, Entscheidung 2A, 2026-04-27).
 */
export type Confidence = 'high' | 'low';

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
  /**
   * True iff deriveVerdict signalled step-level fragility — either via the
   * primary failScore-gate path (failScore in [0.5, 1.0)) or the defensive
   * margin-band path. Surfaces as `metadata.confidence: 'low'` in the public
   * response.
   */
  lowConfidence?: boolean;
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
 * 'low' iff `options.lowConfidence` is true — indicating the engine's
 * deriveVerdict detected step-level fragility (failScore-gate band or
 * margin-band hit).
 *
 * @param internal - The engine's internal verdict
 * @param conditions - Optional conditions array for CONDITIONAL_ALLOW verdicts
 * @param options - Optional flags from the engine (lowConfidence)
 * @returns PublicVerdictResponse with 3-tier verdict + metadata (confidence always present)
 */
export function toPublicVerdict(
  internal: InternalVerdict,
  conditions?: string[],
  options?: ToPublicVerdictOptions,
): PublicVerdictResponse {
  const confidence: Confidence = options?.lowConfidence ? 'low' : 'high';

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
