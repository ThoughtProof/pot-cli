# ADR-0005: failScore-Gate-Decoupling + Confidence Metadata (DRAFT)

**Status:** DRAFT — pending Hermes' Re-Run validation against acceptance criteria
**Date:** 2026-04-27
**Supersedes (in spirit):** Initial Margin Band hypothesis (same ADR number, pre-revision)
**Owners:** Computer (impl), Paul (decisions), Hermes (variance data)

## Context

Hermes' v2.2 Variance-Verification (Issue #21, 2026-04-27) re-ran the
benchmark twice with `seed=42` pinned and observed:

- **8 verdict-flips** between Run A and Run B on a stable case set.
- **All 8 adjacent** (ALLOW↔UNCERTAIN or UNCERTAIN↔BLOCK; never ALLOW↔BLOCK).
- **Oscillator-rate: 19.8%** (8/40+ unstable items).
- Hard-rule flips (D-06, BLOCK→ALLOW): **0**, as designed.

Cause: the Grok-API treats `seed` as a hint, not a hard constraint, producing
small score-jitter (~0.10) on individual step evaluations.

For a verification product whose value proposition is reproducibility
(Skye re-eval, OriginDAO on-chain attestation, Healthcare/Finance audit
trails), run-to-run flips at the threshold are a launch-blocker. Paul
escalated PR-F from "nice-to-have" to "Launch-Blocker for Standard and
Thorough" on 2026-04-27.

### The hypothesis we tested first (Margin Band)

The original PR #26 hypothesis was that score-jitter caused `supported`
predicate scores to oscillate across `SUPPORTED_THRESHOLD = 0.5625`,
producing predicate-level flips that propagated to verdict-level flips.
The fix: a Margin Band of width ±`MARGIN_BAND_HALFWIDTH = 0.05` around the
threshold, treating supported scores in that band as criticalPartial
(more conservative routing).

### What Hermes' Halfwidth-Validierung actually showed (2026-04-27 evening)

When Hermes extracted the 16 score-datapoints (8 cases × 2 runs) for the
flipping cases, **0/8 had a `supported` score within ±0.05 of
SUPPORTED_THRESHOLD**. The Margin Band would have addressed zero of the
observed flips.

The real mechanism is one level deeper:

1. A critical step jitters between **score=0.50 (predicate=supported)** and
   **score=0.40 (predicate=partial)**.
2. predicate=supported → criticalPartial empty → **failScore=0.0** → ALLOW.
3. predicate=partial → criticalPartial=1 → **failScore=0.5** → HOLD/UNCERTAIN.
4. **Binary cliff:** a 0.10-point jitter on a single step crosses the gate.

This is the same "binary cliff" pattern ADR-0003 fixed at SUPPORTED_THRESHOLD,
just one layer deeper at the failScore gate.

## Decision

### Primary fix — failScore-Gate-Decoupling

`failScore = criticalUnsupported × 1.0 + criticalPartial × 0.5`. The pre-PR-F
gate was:

```
failScore ≥ 2.0 → BLOCK
failScore ≥ 0.5 → HOLD
failScore <  0.5 → ALLOW (or CONDITIONAL_ALLOW with non-critical weaknesses)
```

The PR-F gate is:

```
failScore ≥ 2.0 → BLOCK                                        [unchanged]
failScore ≥ 1.0 → HOLD                                         [≥2 critical issues]
failScore ∈ [0.5, 1.0) → CONDITIONAL_ALLOW + low_confidence    [NEW: 1 marginal issue]
failScore <  0.5 → ALLOW (or CONDITIONAL_ALLOW with weaknesses) [unchanged]
```

Semantically: **"exactly one critical step is marginally unsupported"** is
not "we don't know" (UNCERTAIN). It is "we are nearly sure, one point is
weak." That belongs in metadata (`confidence: 'low'`), not at the verdict
gate.

Audit-safety preserved:

- **failScore ≥ 1.0** still gates: 2+ critical issues OR 1 unsupported critical.
- **BLOCK→ALLOW = 0** (Hard-Rule P1) preserved by definition: 2+ unsupported
  criticals → failScore ≥ 2.0 → BLOCK regardless of low_confidence.
- **D-06** (wrong-source) evaluated upstream of `deriveVerdict`, unaffected.

### Secondary — Margin Band as dormant defensive layer

Margin Band stays in the codebase but is **dormant**:

- `isInMarginBand(stepEval)` is unchanged.
- `deriveVerdict` no longer pushes margin-band hits into `criticalPartial` or
  `nonCriticalWeaknesses`. It only records them in `marginBandSteps` and
  contributes them to `lowConfidence`.
- If a future model/version produces real flips at supportScore proximity,
  re-activation is a one-line change (add `criticalPartial.push(...)` back).

Rationale: deleting the layer would lose audit-traceability of the original
hypothesis. Keeping it active would inject false fragility (0/8 flips
addressed, while 0.5625 supported scores would unjustifiably route to
CONDITIONAL_ALLOW).

### Confidence metadata (Paul's four decisions, 2026-04-27)

Surfaced via `metadata.confidence: 'high' | 'low'` in the public v2 response:

1. **Granularity: 2-tier** (`high` / `low`). Numerical confidence would be an
   anti-pattern (false precision, customer over-interpretation).
2. **Coverage: always present.** Absence-as-signal is too fragile a contract.
3. **Tier visibility: all tiers.** Fast-tier customers seeing `low` is a
   natural Standard-tier upsell signal, not a marketing trick.
4. **Schema-bump: none, v2 stays.** The change is additive; the public
   response object already accepts `[key: string]: unknown` in metadata.

`confidence: 'low'` is set iff EITHER:

- **(a) Primary path:** `failScore ∈ [0.5, 1.0)` — exactly one critical step
  marginally unsupported (the empirical source of all 8 observed flips), OR
- **(b) Defensive path:** a `supported`/`faithful` predicate's score sits
  within `MARGIN_BAND_HALFWIDTH` of `SUPPORTED_THRESHOLD` (currently dormant,
  empirically 0/8).

Naming: **`'low'`** (not `'borderline'`) — the empirical mechanism is a weak
critical step, not threshold proximity (Paul, 2026-04-27 21:42 CEST).

## Customer scenarios (Paul's verdict)

Three concrete reproducibility-as-product cases the fix addresses:

1. **Skye Re-Eval:** A user re-runs the same trace expecting the same verdict.
   Pre-PR-F: 19.8% chance of a flipped verdict. Post-PR-F: ≤5% expected.
2. **OriginDAO on-chain attestation:** Verdicts written on-chain must be
   stable. A flip means an immutable record of a verdict that no longer
   reproduces. Post-PR-F: failScore=0.5 ALLOW with `confidence: 'low'` is
   the deterministic answer that re-runs.
3. **Healthcare/Finance audit:** Compliance auditor re-runs the same
   evidence and expects the same call. Same fix.

## Acceptance criteria (PR #26 un-DRAFT)

- [ ] **Hermes Re-Run after merge:** Oscillator-rate **≤5%** (Paul's estimate;
      eliminates 6/8 observed flips).
- [ ] **Public-API verdict-flips: 0** between Run A and Run B.
- [ ] **D-06 = 0** (HARD, by design).
- [ ] **BLOCK→ALLOW = 0** (HARD, by design — Hard-Rule P1).
- [ ] **Three v2.2 reference cases** (CODE-05 SameSite RFC 6265bis, MED-05
      Amoxicillin GAS pharyngitis IDSA 2012, GAIA-02 UDHR Article 25 verbatim)
      remain `ALLOW` with `confidence: 'high'` — locked by T29.

If oscillator-rate stays > 5%, escalate to Paul: it would mean Grok-API
non-determinism produces flips beyond the failScore-gate and Margin-Band
zones (e.g., a critical step jittering between supported and unsupported),
requiring a deeper fix.

## Out of scope

- Multi-model voting (ADR-0002 REJECTED).
- Continuous failScore (ADR-0004 NOT-NEEDED).
- Numerical confidence (Paul Decision 1, anti-pattern).
- Fast-tier confidence-suppression (Paul Decision 3, all tiers).
- Schema v3 (Paul Decision 4, additive in v2).

## Implementation pointers

- **Constant:** `MARGIN_BAND_HALFWIDTH = 0.05` in
  `src/plan/graded-support-evaluator.ts`. One-line patch if Hermes' future
  data shows broader supportScore-proximity flips.
- **Gate:** `deriveVerdict` in `src/plan/graded-support-evaluator.ts`.
  failScore branch documented inline.
- **Public mapping:** `toPublicVerdict(internal, conditions?, options?)` in
  `src/verdict-mapper.ts`. `options.lowConfidence` gates `confidence: 'low'`.
- **CLI plumbing:** `src/commands/plan-graded-eval.ts`. Engine-internal
  `low_confidence` field is stripped before public response; surfaces only
  via `metadata.confidence`.
- **Tests:** `src/plan/test-5tier-conditional-allow.ts` T27, T32-T34
  (failScore-gate primary path), T28-T31 (dormant margin band + confidence
  mapping). 280/280 plan-tests + 15/15 vitest.

## Decision log

- **2026-04-27 ~17:00 CEST:** Computer drafts initial Margin Band hypothesis
  in [Issue #23](https://github.com/ThoughtProof/pot-cli/issues/23).
- **2026-04-27 ~20:30 CEST:** Paul escalates to Launch-Blocker, ratifies
  Option C (intern strenger + extern transparent), Default-Halfwidth 0.05,
  authorises Computer to "sofort vorbauen."
- **2026-04-27 ~21:00 CEST:** PR #26 DRAFT pushed (initial Margin Band impl,
  commit `2da4f02`).
- **2026-04-27 ~21:38 CEST:** Hermes' Halfwidth-Validierung shows 0/8 flips
  in margin band; real mechanism is failScore=0.5 binary cliff.
- **2026-04-27 ~21:45 CEST:** Paul ratifies pivot — failScore-gate-decoupling
  as primary, Margin Band as dormant defensive layer, confidence label
  renamed `'borderline'` → `'low'`.
- **2026-04-27 ~22:00 CEST:** PR #26 refactor commit. ADR-0005 in-place
  rewrite (this document). 280/280 + 15/15 green.

## Related ADRs

- **ADR-0001 (verdict-model):** the 5-tier internal vocabulary this fix
  emits into.
- **ADR-0002 REJECTED (step-level-triple-majority):** correlation test ruled
  out multi-model voting as a fragility-mitigation; failScore-gate-decoupling
  is the alternative path.
- **ADR-0003 (threshold-shift v2.2):** SUPPORTED_THRESHOLD = 0.5625 anchor;
  failScore-gate-decoupling sits one layer below.
- **ADR-0004 NOT-NEEDED (continuous failScore):** considered as alternative;
  rejected because it would require model re-training and a v3 schema.
