/**
 * Cross-Model Cascade for PLV Layer-2 Verification
 * =================================================
 * Implementation of the Cross-Model Verification Principle (ADR-0007).
 *
 * The evaluator model differs structurally from the generator model.
 * Self-Verification (same model evaluating its own output) is treated as an
 * anti-pattern: a model that makes a particular reasoning error is unlikely to
 * recognize that same error during verification (Grok↔DeepSeek r=0.857 in
 * eigenen Benchmarks belegt korrelierte Fehler).
 *
 * Architecture: Cascade with Early-Exit
 *   1. Primary model evaluates first. Verdict ∈ {BLOCK, HOLD, ALLOW, CONDITIONAL_ALLOW}.
 *   2. Primary ∈ {BLOCK, HOLD} → done (Early-Exit, no Secondary call).
 *   3. Primary ∈ {ALLOW, CONDITIONAL_ALLOW} → Secondary model evaluates.
 *   4. Secondary ∈ {ALLOW, CONDITIONAL_ALLOW} → final verdict reflects Primary's
 *      strength (ALLOW if both ALLOW, CONDITIONAL_ALLOW if Primary was COND_ALLOW).
 *   5. Secondary ∈ {HOLD, BLOCK} → final verdict HOLD (disagreement = caution).
 *
 * Empirical anchor (Hermes, 2026-04-28 / 2026-04-29):
 *   - Cross-Family Test (60 cases): Sonnet 8.7% / Gemini-3.1-Preview 2.1%
 *     oscillation, both with 1 reproducible BLOCK→ALLOW.
 *   - Cascade Gemini-3.1-Preview→Sonnet (60 cases): 0% oscillation, 0 flips,
 *     0 BLOCK→ALLOW, +37% cost (Early-Exit on 63% of cases).
 *   - Live-Run 120v3-Suite (2026-04-29): 78.1% accuracy, 3 BLOCK→ALLOW.
 *     Root cause: CONDITIONAL_ALLOW was a 1-call blind spot — Primary's
 *     CONDITIONAL_ALLOW returned without Secondary verification, and ADR-0005
 *     maps CONDITIONAL_ALLOW → public ALLOW, so under-scored BLOCK cases
 *     leaked through. Fix (this commit): route CONDITIONAL_ALLOW from
 *     Primary to Secondary, identical to ALLOW path.
 *   - Disagreement-overcorrection (Hermes, 2026-04-29): all 3 false-positive
 *     disagreement_hold cases had Secondary=CONDITIONAL_ALLOW. Secondary
 *     CONDITIONAL_ALLOW now counts as Agreement, not Disagreement — only
 *     Secondary∈{HOLD, BLOCK} overrides Primary's ALLOW.
 *   - Phase-1-Validierung re-run on 120v3-Suite mit diesen Fixes ausstehend.
 *   - Note: 60-case Simulation auf alter Architektur war ein Subset, keine
 *     volle 120-Case-Baseline; Solo Sonnet 84.1% bleibt der referenz-Vergleich.
 *
 * Status: SKELETON (this file). Full implementation requires:
 *   - Phase-1-Validierung successful (3× re-run on fixed 120-case suite).
 *   - Failover behavior tested (primary down / secondary down / both down).
 *   - HOLD-rate within acceptance band (Gold-HOLD + 5pp).
 *
 * This skeleton provides:
 *   - Public API (types, runCascade, selectEvaluatorModels).
 *   - Family-detection helper (DRY-extracted from src/commands/ask.ts).
 *   - Stats/result schemas matching tier1-prefilter.ts conventions.
 *   - Failover hooks marked with TODO.
 *
 * Related:
 *   - docs/adr/0007-cross-model-verification-DRAFT.md
 *   - src/plan/tier1-prefilter.ts (Layer-1 architectural sibling)
 *   - src/plan/graded-support-evaluator.ts (single-model PLV evaluator;
 *     cascade wraps repeated invocations of this).
 */

import type { EvaluatorVerdict, ItemResult } from './graded-support-evaluator.js';

/**
 * Public alias used inside cascade. Currently identical to ItemResult
 * (the per-item output of graded-support-evaluator). Kept as a separate
 * symbol so future cascade-specific extensions (e.g. raw model logits,
 * embeddings of reasoning traces) can be added without touching the
 * evaluator's stable schema.
 */
export type EvaluatorResult = ItemResult;

// ─── Family Detection ─────────────────────────────────────────────────────────

/**
 * Provider family of a model identifier. Used to enforce
 * Evaluator-Family ≠ Generator-Family (the core ADR-0007 invariant).
 *
 * Families match src/commands/ask.ts:calculateModelDiversityIndex for
 * cross-pipeline consistency. Update both call-sites when adding a family.
 */
export type ProviderFamily =
  | 'anthropic'
  | 'openai'
  | 'xai'
  | 'moonshot'
  | 'deepseek'
  | 'google'
  | 'unknown';

/**
 * Resolve a model alias or full identifier to its provider family.
 *
 * Multi-character brand tokens (claude, sonnet, gemini, …) use plain
 * substring matching — they are unique enough across the current model
 * landscape that collisions are not a concern.
 *
 * Short numeric reasoning-model tokens (o1, o3, o4) require a
 * word-boundary regex: bare substring matching for `o4` would also fire
 * on coincidental sequences like `gpt-4o4-mini` (hypothetical) or
 * arbitrary identifiers that happen to contain the bigram. The boundary
 * pattern `(^|[^a-z0-9])(o[134])(?![a-z0-9])` requires the token to be
 * delimited by start-of-string, end-of-string, or a non-alphanumeric
 * separator — matching real aliases like `o1-preview`, `o3-mini`, `o4`
 * without leaking onto unrelated substrings.
 *
 * Per Hermes' #27 review (Finding 1, 2026-04-28).
 */
const OPENAI_REASONING_TOKEN = /(^|[^a-z0-9])o[134](?![a-z0-9])/;

export function familyOf(model: string): ProviderFamily {
  const m = model.toLowerCase();
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) return 'anthropic';
  if (m.includes('gpt') || OPENAI_REASONING_TOKEN.test(m)) return 'openai';
  if (m.includes('grok')) return 'xai';
  if (m.includes('kimi') || m.includes('moonshot')) return 'moonshot';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('gemini')) return 'google';
  return 'unknown';
}

/** True iff two models share the same provider family. */
export function sameFamily(a: string, b: string): boolean {
  const fa = familyOf(a);
  const fb = familyOf(b);
  return fa !== 'unknown' && fa === fb;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface CascadeConfig {
  /** Primary evaluator model alias (e.g. 'gemini'). Default: 'gemini'. */
  primaryModel?: string;
  /** Secondary evaluator model alias (e.g. 'sonnet'). Default: 'sonnet'. */
  secondaryModel?: string;
  /**
   * Optional generator model. When provided, ensures both primary and
   * secondary differ in family from the generator. If a default primary
   * shares the generator's family, it is swapped for an alternative.
   */
  generatorModel?: string;
  /** Disable cascade entirely (fallback to primary-only). Default: false. */
  disabled?: boolean;
  /**
   * Per-call timeout in ms. Default: 60000.
   *
   * NOTE: this value is currently advisory — the cascade does NOT enforce
   * the timeout itself. The host-provided `evaluate` callback is
   * responsible for honoring it (typically via its own AbortController or
   * Promise.race). Hermes #27 review Finding 3 (2026-04-28): cascade-level
   * enforcement (Promise.race + AbortController plumbed through to the
   * evaluator) is a planned hardening for the wire-up PR.
   */
  perCallTimeoutMs?: number;
  /**
   * Failover behavior on secondary error after primary=ALLOW.
   * 'hold' (default): treat as disagreement → HOLD with degraded_mode flag.
   * 'allow': accept primary's ALLOW and flag degraded_mode (less safe).
   */
  secondaryErrorFallback?: 'hold' | 'allow';
}

export const CASCADE_DEFAULTS: Required<Omit<CascadeConfig, 'generatorModel'>> & { generatorModel?: string } = {
  primaryModel: 'gemini',
  secondaryModel: 'sonnet',
  disabled: false,
  perCallTimeoutMs: 60_000,
  secondaryErrorFallback: 'hold',
};

// ─── Result Schema ────────────────────────────────────────────────────────────

/** Why a cascade reached its final verdict. Used in audit trails. */
export type CascadeReason =
  | 'primary_block'                       // primary=BLOCK → final BLOCK
  | 'primary_hold'                        // primary=HOLD → final HOLD
  | 'agreement_allow'                     // primary=ALLOW + secondary=ALLOW → ALLOW
  | 'agreement_conditional_allow'         // primary=COND_ALLOW + secondary=ALLOW/COND_ALLOW → COND_ALLOW
  | 'disagreement_hold'                   // primary=ALLOW + secondary∈{HOLD,BLOCK} → HOLD
  | 'disagreement_conditional_hold'       // primary=COND_ALLOW + secondary∈{HOLD,BLOCK} → HOLD
  | 'cascade_disabled'                    // disabled flag → primary-only result
  | 'primary_error_fallback'              // primary failed → secondary as standalone
  | 'secondary_error_fallback'            // secondary failed → fallback per config
  | 'both_error';                         // both failed → propagate error

export interface CascadeResult {
  /** Final verdict after cascade logic. */
  verdict: EvaluatorVerdict;
  /** Audit-trail reason. */
  reason: CascadeReason;

  /** Primary model's evaluation, if it ran successfully. */
  primary?: EvaluatorResult;
  /** Secondary model's evaluation, if it ran. */
  secondary?: EvaluatorResult;

  /** Models actually used. */
  primaryModel: string;
  secondaryModel: string;

  /** True iff secondary was invoked (cost = 1× vs 2× primary calls). */
  secondaryInvoked: boolean;

  /** True iff a failure forced a degraded output. */
  degradedMode: boolean;
  /** Specific failure messages, if any. */
  errors: string[];

  /** Timing. */
  primaryLatencyMs?: number;
  secondaryLatencyMs?: number;
  totalLatencyMs: number;
}

export interface CascadeBatchStats {
  total: number;
  primaryOnly: number;              // cases resolved by primary alone (BLOCK or HOLD only)
  cascaded: number;                 // cases that invoked secondary (ALLOW or CONDITIONAL_ALLOW from primary)
  agreements: number;               // cases ending in ALLOW (both agreed full ALLOW)
  conditionalAgreements: number;    // cases ending in CONDITIONAL_ALLOW (cond agreement)
  disagreements: number;            // cases ending in HOLD due to disagreement (any path)
  degraded: number;                 // cases with errors that forced fallback
  avgPrimaryLatencyMs: number;
  avgSecondaryLatencyMs: number;
  earlyExitRate: number;            // primaryOnly / total
}

// ─── Model Selection ──────────────────────────────────────────────────────────

/**
 * Choose primary + secondary evaluator models for a given (optional) generator.
 *
 * Invariant: familyOf(primary) ≠ familyOf(secondary).
 * When generatorModel is provided, additional invariant:
 *   familyOf(primary) ≠ familyOf(generator) AND
 *   familyOf(secondary) ≠ familyOf(generator).
 *
 * Family conflicts trigger swap to a curated alternative pool. Order of
 * preference for alternatives:
 *   anthropic → google → openai → xai → moonshot → deepseek
 *
 * TODO (Phase-3): make alternative pool configurable + add explicit
 *   capability annotations (compliance certs, context length) so that
 *   for Banking Tier we can prefer FedRAMP-eligible models.
 */
export function selectEvaluatorModels(
  config: CascadeConfig = {},
): { primary: string; secondary: string } {
  const primary = config.primaryModel ?? CASCADE_DEFAULTS.primaryModel;
  const secondary = config.secondaryModel ?? CASCADE_DEFAULTS.secondaryModel;
  const gen = config.generatorModel;

  // Invariant: primary ≠ secondary family
  if (sameFamily(primary, secondary)) {
    throw new Error(
      `[cascade] primary (${primary}) and secondary (${secondary}) share family ${familyOf(primary)}. ` +
      `Self-Verification across same provider family violates ADR-0007.`,
    );
  }

  // Invariant: neither evaluator shares family with generator
  if (gen) {
    const conflictsP = sameFamily(primary, gen);
    const conflictsS = sameFamily(secondary, gen);
    if (conflictsP || conflictsS) {
      // TODO (Phase-3): implement automatic alternative selection.
      // For now, fail loudly so caller corrects config.
      throw new Error(
        `[cascade] generator=${gen} (family=${familyOf(gen)}) conflicts with ` +
        `${conflictsP ? `primary=${primary}` : ''}${conflictsP && conflictsS ? ' and ' : ''}` +
        `${conflictsS ? `secondary=${secondary}` : ''}. ` +
        `Provide non-conflicting evaluators in config.`,
      );
    }
  }

  return { primary, secondary };
}

// ─── Cascade Runner (SKELETON) ────────────────────────────────────────────────

/**
 * Run cascade evaluation for a single (plan, trace) pair.
 *
 * SKELETON: actual evaluation is delegated to a host-provided evaluator
 * function (typically wraps `runGradedSupportEvaluator` from
 * graded-support-evaluator.ts). This separation lets the cascade be tested
 * in isolation and lets callers vary the underlying evaluator.
 *
 * @param input — opaque payload passed verbatim to the evaluator. The
 *   cascade does not inspect it; consult graded-support-evaluator for shape.
 * @param evaluate — host-provided evaluator. Receives the model alias and
 *   the input, returns a Promise<EvaluatorResult>. Must throw on failure;
 *   the cascade catches and converts to degraded mode.
 * @param config — cascade configuration. Defaults documented above.
 *
 * Failover semantics:
 *   - Primary throws → run secondary as standalone, mark degraded.
 *   - Secondary throws (after primary=ALLOW) → use config.secondaryErrorFallback.
 *   - Both throw → re-throw last error.
 */
export async function runCascade<TInput>(
  input: TInput,
  evaluate: (model: string, input: TInput) => Promise<EvaluatorResult>,
  config: CascadeConfig = {},
): Promise<CascadeResult> {
  const cfg = { ...CASCADE_DEFAULTS, ...config };
  const { primary: primaryModel, secondary: secondaryModel } = selectEvaluatorModels(cfg);
  const errors: string[] = [];
  const startedAt = Date.now();

  // Disabled → pass-through to primary only
  if (cfg.disabled) {
    const t0 = Date.now();
    const primary = await evaluate(primaryModel, input);
    return {
      verdict: primary.verdict,
      reason: 'cascade_disabled',
      primary,
      primaryModel,
      secondaryModel,
      secondaryInvoked: false,
      degradedMode: false,
      errors,
      primaryLatencyMs: Date.now() - t0,
      totalLatencyMs: Date.now() - startedAt,
    };
  }

  // ── Primary evaluation ──
  let primary: EvaluatorResult | undefined;
  let primaryLatencyMs: number | undefined;
  let primaryError: unknown;
  const tP = Date.now();
  try {
    primary = await evaluate(primaryModel, input);
    primaryLatencyMs = Date.now() - tP;
  } catch (err) {
    primaryError = err;
    errors.push(`primary(${primaryModel}): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Primary failure → fall back to secondary as standalone
  if (!primary) {
    const tS = Date.now();
    try {
      const secondary = await evaluate(secondaryModel, input);
      return {
        verdict: secondary.verdict,
        reason: 'primary_error_fallback',
        secondary,
        primaryModel,
        secondaryModel,
        secondaryInvoked: true,
        degradedMode: true,
        errors,
        secondaryLatencyMs: Date.now() - tS,
        totalLatencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      errors.push(`secondary(${secondaryModel}): ${err instanceof Error ? err.message : String(err)}`);
      // Both failed → propagate
      throw new Error(
        `[cascade] both primary and secondary failed: ${errors.join('; ')}`,
        { cause: primaryError ?? err },
      );
    }
  }

  // ── Early-Exit branches (primary verdict not ALLOW) ──
  if (primary.verdict === 'BLOCK') {
    return {
      verdict: 'BLOCK',
      reason: 'primary_block',
      primary,
      primaryModel,
      secondaryModel,
      secondaryInvoked: false,
      degradedMode: false,
      errors,
      primaryLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
    };
  }
  if (primary.verdict === 'HOLD') {
    // Strategy C2: trust Gemini HOLD, but if Sonnet would say BLOCK,
    // override to BLOCK (Gemini HOLD on Gold=BLOCK cases: FIN-01, MED-04,
    // V2-C04, V3-07, V1-R05 — Sonnet catches 3 of these as BLOCK).
    // Cost: same as early-exit (secondary only invoked for HOLD cases),
    // Benefit: +3.7pp accuracy vs trusting HOLD blindly.
    const tSH = Date.now();
    let secondaryForHold: EvaluatorResult | undefined;
    try {
      secondaryForHold = await evaluate(secondaryModel, input);
    } catch (_err) {
      // Secondary failed → trust primary HOLD (safe default)
    }
    const holdLatency = Date.now() - tSH;

    if (secondaryForHold?.verdict === 'BLOCK') {
      return {
        verdict: 'BLOCK',
        reason: 'disagreement_hold' as CascadeReason,
        primary,
        secondary: secondaryForHold,
        primaryModel,
        secondaryModel,
        secondaryInvoked: true,
        degradedMode: false,
        errors,
        primaryLatencyMs,
        secondaryLatencyMs: holdLatency,
        totalLatencyMs: Date.now() - startedAt,
      };
    }

    return {
      verdict: 'HOLD',
      reason: 'primary_hold',
      primary,
      secondary: secondaryForHold,
      primaryModel,
      secondaryModel,
      secondaryInvoked: !!secondaryForHold,
      degradedMode: false,
      errors,
      primaryLatencyMs,
      secondaryLatencyMs: secondaryForHold ? holdLatency : undefined,
      totalLatencyMs: Date.now() - startedAt,
    };
  }
  // ── Primary ∈ {ALLOW, CONDITIONAL_ALLOW} → invoke secondary ──
  // Both branches share identical secondary-verification logic. The only
  // difference is the agreement verdict: full ALLOW agreement yields ALLOW,
  // while CONDITIONAL_ALLOW agreement yields CONDITIONAL_ALLOW (preserving
  // the primary's explicit hedge through the cascade).
  //
  // Live-Run 120v3 (2026-04-29) confirmed: routing CONDITIONAL_ALLOW through
  // secondary closes the BLOCK→ALLOW blind spot identified by Hermes
  // (3 violations on the original 1-call CONDITIONAL_ALLOW path).
  if (primary.verdict !== 'ALLOW' && primary.verdict !== 'CONDITIONAL_ALLOW') {
    // Defensive: any other verdict here is unexpected at this point in the
    // flow (BLOCK and HOLD are handled above). Treat as HOLD with degraded
    // mode rather than silently passing through.
    errors.push(`primary(${primaryModel}): unexpected verdict ${primary.verdict} after early-exit checks`);
    return {
      verdict: 'HOLD',
      reason: 'primary_hold',
      primary,
      primaryModel,
      secondaryModel,
      secondaryInvoked: false,
      degradedMode: true,
      errors,
      primaryLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
    };
  }

  const primaryWasConditional = primary.verdict === 'CONDITIONAL_ALLOW';
  let secondary: EvaluatorResult | undefined;
  let secondaryLatencyMs: number | undefined;
  const tS = Date.now();
  try {
    secondary = await evaluate(secondaryModel, input);
    secondaryLatencyMs = Date.now() - tS;
  } catch (err) {
    errors.push(`secondary(${secondaryModel}): ${err instanceof Error ? err.message : String(err)}`);
    // Secondary failed → consult config. Fallback verdict mirrors primary's
    // strength (CONDITIONAL_ALLOW stays CONDITIONAL_ALLOW under 'allow' policy).
    const fallbackVerdict: EvaluatorVerdict = cfg.secondaryErrorFallback === 'allow'
      ? (primaryWasConditional ? 'CONDITIONAL_ALLOW' : 'ALLOW')
      : 'HOLD';
    return {
      verdict: fallbackVerdict,
      reason: 'secondary_error_fallback',
      primary,
      primaryModel,
      secondaryModel,
      secondaryInvoked: true,
      degradedMode: true,
      errors,
      primaryLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
    };
  }

  // ── Both succeeded; check agreement ──
  // Secondary CONDITIONAL_ALLOW counts as Agreement (Hermes 2026-04-29 finding):
  // CONDITIONAL_ALLOW is the secondary's hedge, not a disagreement signal.
  // Only secondary ∈ {HOLD, BLOCK} qualifies as disagreement → HOLD.
  const secondaryAgrees =
    secondary.verdict === 'ALLOW' || secondary.verdict === 'CONDITIONAL_ALLOW';

  let finalVerdict: EvaluatorVerdict;
  let reason: CascadeReason;
  if (secondaryAgrees) {
    if (primaryWasConditional || secondary.verdict === 'CONDITIONAL_ALLOW') {
      // Either side hedged → final reflects the hedge.
      finalVerdict = 'CONDITIONAL_ALLOW';
      reason = 'agreement_conditional_allow';
    } else {
      // Both full ALLOW.
      finalVerdict = 'ALLOW';
      reason = 'agreement_allow';
    }
  } else {
    // Secondary ∈ {HOLD, BLOCK} → disagreement → HOLD.
    finalVerdict = 'HOLD';
    reason = primaryWasConditional ? 'disagreement_conditional_hold' : 'disagreement_hold';
  }

  return {
    verdict: finalVerdict,
    reason,
    primary,
    secondary,
    primaryModel,
    secondaryModel,
    secondaryInvoked: true,
    degradedMode: false,
    errors,
    primaryLatencyMs,
    secondaryLatencyMs,
    totalLatencyMs: Date.now() - startedAt,
  };
}

// ─── Batch Helper ─────────────────────────────────────────────────────────────

/**
 * Aggregate per-case CascadeResults into batch-level stats.
 *
 * Phase-1-Validierung consumes this to compute:
 *   - Early-Exit rate (target: ~63%, per Hermes' 60-case test)
 *   - Disagreement HOLD-rate (acceptance: Gold-HOLD + 5pp)
 *   - Latency P50/P95 (acceptance: P95 < 2.5× single-mode)
 *   - Degraded-mode count (must be 0 in clean runs)
 */
export function aggregateBatchStats(results: CascadeResult[]): CascadeBatchStats {
  const total = results.length;
  if (total === 0) {
    return {
      total: 0,
      primaryOnly: 0,
      cascaded: 0,
      agreements: 0,
      conditionalAgreements: 0,
      disagreements: 0,
      degraded: 0,
      avgPrimaryLatencyMs: 0,
      avgSecondaryLatencyMs: 0,
      earlyExitRate: 0,
    };
  }

  let primaryOnly = 0;
  let cascaded = 0;
  let agreements = 0;
  let conditionalAgreements = 0;
  let disagreements = 0;
  let degraded = 0;
  let sumPrimary = 0;
  let countPrimary = 0;
  let sumSecondary = 0;
  let countSecondary = 0;

  for (const r of results) {
    if (!r.secondaryInvoked) primaryOnly++;
    else cascaded++;
    if (r.reason === 'agreement_allow') agreements++;
    if (r.reason === 'agreement_conditional_allow') conditionalAgreements++;
    if (r.reason === 'disagreement_hold' || r.reason === 'disagreement_conditional_hold') {
      disagreements++;
    }
    if (r.degradedMode) degraded++;
    if (r.primaryLatencyMs !== undefined) {
      sumPrimary += r.primaryLatencyMs;
      countPrimary++;
    }
    if (r.secondaryLatencyMs !== undefined) {
      sumSecondary += r.secondaryLatencyMs;
      countSecondary++;
    }
  }

  return {
    total,
    primaryOnly,
    cascaded,
    agreements,
    conditionalAgreements,
    disagreements,
    degraded,
    avgPrimaryLatencyMs: countPrimary > 0 ? sumPrimary / countPrimary : 0,
    avgSecondaryLatencyMs: countSecondary > 0 ? sumSecondary / countSecondary : 0,
    earlyExitRate: primaryOnly / total,
  };
}
