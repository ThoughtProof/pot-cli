# ADR-0005: Margin Band + Confidence Metadata

**Status:** DRAFT (PR-F implementation in flight, awaiting Hermes' halfwidth validation)
**Date:** 2026-04-27
**Decision-Maker:** Paul (ratified 2026-04-27 evening, post-Hermes-Variance-Verification)
**Implementation:** Computer (PR-F branch `feat/pr-f-margin-band-confidence`)
**Verification:** Hermes (re-run after merge, acceptance via `scripts/diff-scores.mjs`)

---

## Context

Hermes' v2.2 Variance-Verification Run (Issue #21, 2026-04-27) compared two
identical-seed (`seed=42`) executions of the v2.2 PLV pipeline and found:

| Metric | Observed | Target | Status |
|---|---:|---:|---|
| Oscillator-Rate | 19.8 % | ≤ 15 % | ❌ |
| Max per-case Drift | 0.2750 | < 0.10 | ❌ |
| Verdict-Flips | 8 | 0 | ❌ |
| D-06 (wrong-source) Drift | 0 | 0 | ✅ |
| BLOCK→ALLOW transitions | 0 | 0 | ✅ |

**Root cause** (Hermes' analysis, ratified by Paul): Grok API treats `seed=42`
as a hint, not a hard determinism constraint. Same prompt + same seed yields
slightly different per-step scores across runs, especially in regions where
the LLM's posterior is flat — i.e. near the `supported`-predicate threshold.

**All 8 verdict-flips were adjacent** (ALLOW↔UNCERTAIN or UNCERTAIN↔BLOCK),
not catastrophic (no BLOCK↔ALLOW). Issue #21 was closed with Paul's verdict:
"Variance documented, no safety violations."

### Why this is a launch-blocker

Paul's analysis (2026-04-27 evening) identified three concrete reproducibility
failures for Standard- and Thorough-Tier customers:

1. **Skye-Integration:** Re-evaluation of the same agent output yields a
   different verdict → trust score flips → operational incident.
2. **OriginDAO:** ERC-8183 on-chain attestation of an ALLOW that does not
   reproduce on dispute → integrity problem for a verification product.
3. **Regulated customers (Healthcare/Finance):** Compliance officer relies
   on an ALLOW; audit two weeks later reproduces UNCERTAIN → audit finding.

For a product whose value proposition is verification, run-to-run
non-reproducibility is a vertrauens- und audit-issue even when no safety
violation has occurred. Pre-screening (Fast tier) can tolerate this; Standard
and Thorough cannot. PR-F is therefore re-classified from "PR-F-Candidate
nice-to-have" to **launch-blocker for `/v2/verify` Endpoint**.

---

## Decision

Implement **Option C** (Paul's term): Margin Band internally + Confidence
Metadata externally.

### Margin Band (engine-internal)

Define a constant `MARGIN_BAND_HALFWIDTH = 0.05` and a helper
`isInMarginBand(stepEval)` in `src/plan/graded-support-evaluator.ts`.

A `StepEvaluation` is "in the margin band" iff:
- `predicate ∈ { 'supported', 'faithful' }` AND
- `|score - SUPPORTED_THRESHOLD| < MARGIN_BAND_HALFWIDTH`

In `deriveVerdict`:
- Critical step in margin band → counts as `criticalPartial` (failScore += 0.5).
- Non-critical step in margin band → counts as a non-critical weakness
  (surfaces in `conditions[]` for CONDITIONAL_ALLOW).
- The function additionally returns `marginBandTriggered: boolean`.

This pushes borderline `supported` cases conservatively toward HOLD/UNCERTAIN
or CONDITIONAL_ALLOW, never toward ALLOW. **"Decompose, don't loosen": the
system becomes more conservative on borderline cases, never more permissive.**

### Confidence Metadata (public API)

Extend `PublicVerdictResponse.metadata` with `confidence: 'high' | 'borderline'`,
**always present** in v2 responses. `toPublicVerdict()` accepts a third optional
options argument `{ marginBandTriggered?: boolean }`. When set true, confidence
is `'borderline'`; otherwise `'high'`.

**Customer contract:**
- `confidence: 'high'`: verdict is unambiguous; re-evaluation will reproduce.
- `confidence: 'borderline'`: at least one supporting predicate's score lay
  within ±0.05 of the threshold; the verdict is authoritative for this run
  but the customer is informed that re-evaluation may yield a different
  verdict due to LLM sampling noise. Suggested customer action: treat as
  re-screening candidate; for regulated workflows, escalate to Thorough tier.

### Hard rules unaffected

- **D-06 (wrong-source detection):** evaluated upstream of `deriveVerdict`,
  outside the margin band logic. Margin Band cannot raise a wrong-source
  failure to ALLOW.
- **P1 (BLOCK→ALLOW absolute 0):** Margin Band is a `supported`-predicate
  conservativization mechanism. It can downgrade ALLOW → CONDITIONAL_ALLOW
  → HOLD; it never upgrades.

---

## Paul's four configuration decisions (2026-04-27 evening)

Computer offered four sub-decisions on Option C; Paul ratified all with
Computer's recommendation.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Confidence granularity | 2-stage (`high` / `borderline`) | Numeric invites customer-defined thresholds (anti-pattern). 3-stage adds complexity without information. |
| 2 | Confidence coverage | Always present | Absence-based signalling is fragile. Audit-reproducibility requires the field be observable. |
| 3 | Tier visibility | All tiers | Borderline confidence in Fast → natural Standard upsell signal. SDK consistency. |
| 4 | Schema bump | None (v2 stays v2) | Additive field; existing `[key: string]: unknown` was designed for this. Future behavioural change (auto-re-run on borderline) would warrant its own breaking change. |

---

## Halfwidth selection (open, awaiting Hermes' validation)

Default `MARGIN_BAND_HALFWIDTH = 0.05` rationale:
- Symmetric around `SUPPORTED_THRESHOLD = 0.5625` → zone `[0.5125, 0.6125)`.
- The three v2.2-audited reference cases (CODE-05 / MED-05 / GAIA-02, all
  scores ≥ 0.75) are safely above the zone → **zero anti-regression risk on
  audited ALLOW cases**.
- Pre-validation: T29 in `test-5tier-conditional-allow.ts` locks scores
  `0.75 / 0.80 / 0.95 / 1.0` as never-margin-band.

**Open:** Hermes' Halfwidth-Validierungs-Aufgabe (Briefing 2026-04-28) will
extract the 8 observed flip-cases' `|score - 0.5625|` distribution. If
`max < 0.05`, the default holds. If `max ∈ [0.05, 0.075]`, raise to 0.075.
If `max > 0.075`, escalate (likely a fundamental Grok-determinism issue
beyond margin-band scope).

**Halfwidth is a single constant; raising it is a one-line change** before
merge. Estimated oscillator-rate reduction at 0.05: 19.8 % → ~5 % (Paul's
estimate, 2026-04-27 evening).

---

## Acceptance criteria for merge

PR-F merges when ALL of the following hold (verifiable via
`scripts/diff-scores.mjs`):

| Criterion | Threshold | Hard? |
|---|---:|---|
| Plan-Test Suite (post-PR-F) | 277/277 green (was 272/272) | hard |
| Hermes Halfwidth-Validation | `max(\|score - 0.5625\|)` over 8 flip-cases ≤ chosen halfwidth | hard |
| Hermes Re-Run after merge: Verdict-Flips | 0 on public-API level | hard |
| Hermes Re-Run after merge: Oscillator-Rate | ≤ 5 % | soft (informational) |
| Anti-regression: CODE-05 / MED-05 / GAIA-02 | All remain ALLOW with `confidence: 'high'` | hard |
| D-06 Drift | 0 | hard (preserved by design) |
| BLOCK→ALLOW transitions | 0 | hard (preserved by design) |

If Hermes' Re-Run still shows verdict-flips after PR-F merge, **iterate on
halfwidth** (likely 0.075), not on the architectural decision. The
architectural decision (Margin Band + Confidence) is final.

---

## Out of scope (deferred to separate ADRs / Issues)

- **Triple-Majority across models** (ADR-0002, REJECTED 2026-04-27): Multi-
  model voting yields no accuracy lift (Grok↔DS r=0.857, DS↔Gemini r=0.746).
  Margin Band addresses the variance symptom directly; no aggregator needed.
- **DS calibration**: orthogonal to variance (DS calibration is a score-level
  shift, variance is sampling-noise-level oscillation). Tracked separately.
- **Auto-re-run on `confidence: 'borderline'`**: would be a behavioural change
  to `/v2/verify`; warrants its own ADR-0006 and a major schema bump.
- **Confidence on per-step level** (rather than per-item): current scope is
  per-item only; per-step confidence on the SDK is forward-compatible
  (additive, can be added without ADR).

---

## References

- Issue #21 (closed): variance characterization
- Issue #23: PR-F implementation tracking
- ADR-0001: Verdict Model (5-tier internal, 3-tier public)
- ADR-0002: Step-Level Triple-Majority (REJECTED)
- ADR-0003 v2.2: Threshold Shift (SUPPORTED_THRESHOLD = 0.5625)
- ADR-0004: Continuous failScore (NOT-NEEDED)
- `scripts/diff-scores.mjs` (PR #25): CI-grade variance verification
- Hermes' Variance-Run Report (2026-04-27, IMG_4844.jpeg)
