# ADR-0003 (DRAFT): Threshold-Shift with R1 Score-Floor Adjustment

**Status**: DRAFT — Pending Confusion-Matrix validation on 82-case library and architectural review by Raul + Paul
**Date**: 2026-04-27
**Deciders**: Raul, Paul, Hermes
**Editor**: Computer
**Replaces**: ADR-0002 (Step-Level Triple-Majority, REJECTED 2026-04-27)
**Relates to**: ADR-0001 (Verdict Model)

---

## Context

PR-E (#12) introduced 5-tier verdicts and the `CONDITIONAL_ALLOW` boundary. Validation revealed two related quality issues:

1. **LLM Scoring Variance**: Grok step-scores oscillate between runs (28% vs 5% steps in CA-range across two CM-Runs)
2. **Threshold Fragility**: 25% of cases oscillate between runs because step-scores cluster on the 0.50/0.75 cliff. A ±0.25 jitter flips `supported→partial`, tipping ALLOW→HOLD.

Hermes' 4×4-run analysis quantified the score distribution:

| Score | Grok | DeepSeek | Gemini |
|---|---|---|---|
| 0.00 | 64 | 77 | 71 |
| 0.25 | 11 | 9 | 24 |
| 0.50 | 30 | 17 | 13 |
| 0.75 | 18 | **32** | **31** |
| 1.00 | **36** | 24 | 20 |

DS and Gemini cluster on the 0.75 `supported→partial` cliff. Grok clusters on 1.00 (safe distance). The cliff itself is the problem, not the model.

ADR-0002 attempted to address this with Step-Level Triple-Majority. The correlation test showed all model pairs at |r| > 0.68 (cliff-specific), and the simulation showed Step-TMaj underperforms every single model (67.5% vs 70–82.5%). ADR-0002 was rejected.

The failure of ADR-0002 leaves the diagnosis intact but rules out downstream aggregation as a fix. The cliff must be addressed **upstream** at the score-to-predicate boundary.

## Decision

Three coordinated changes to the score-to-predicate-to-verdict pipeline:

### 1. Predicate-Band Shift

Current bands:
- `supported`: score ≥ 0.75
- `partial`: 0.25 ≤ score < 0.75
- `unsupported`: score < 0.25

New bands:
- `supported`: score ≥ 0.50
- `partial`: 0.25 ≤ score < 0.50
- `unsupported`: score < 0.25

This eliminates the 0.75 cliff. Steps scoring 0.50 (DS+Gemini high-frequency mode after 0.75) now land cleanly in `supported` rather than oscillating with the cliff.

### 2. R1 Score-Floor Adjustment

Current R1 score-floor (no quote provided): 0.50.
New R1 score-floor: 0.25.

**Rationale (Paul's semantic objection)**: Under the new bands, score=0.50 maps to `supported`. If R1's floor remains 0.50, then "no quote provided" would be classified as `supported` — which inverts the floor's meaning. Lowering R1's floor to 0.25 keeps "no quote" in the `partial` band, preserving floor semantics.

This is the load-bearing coordination. Predicate-shift without floor-adjustment breaks Score-Floor semantics. Floor-adjustment without predicate-shift does nothing useful. Both must land together in the same PR.

### 3. Boundary-Test Re-Validation

T1, T6, T7 fixtures must be re-audited:
- **T6** (`score=0` is Absence, not Weakness): unchanged. `score=0 < 0.25 = unsupported` holds in both old and new bands.
- **T1** (Floor application): fixture must use `score=0.25` for "no quote" cases (new R1 floor) instead of `score=0.50`.
- **T7** (Predicate boundary): fixture for `score=0.50` must now assert `supported` (was `partial`).
- **T10, T11** (Score-Floor interaction): re-validate that R3 (0.25), R6 (0.0), R7 (0.5), R1 (0.25 new) interact correctly with the new bands.

New tests T17–T19 should lock the predicate-band shift:
- T17: `score=0.49` → `partial`
- T18: `score=0.50` → `supported`
- T19: `score=0.74` → `supported` (no longer cliff-sensitive)

## Preconditions

**P1: Hard-Rule preservation on 82-case library**

Confusion-Matrix-Run with the new bands and floor must show:
- 0 BLOCK→ALLOW regressions
- 0 HOLD→ALLOW regressions
- 0 ALLOW→BLOCK regressions

This is the non-negotiable constraint. If any of these regress, the ADR is rejected.

**P2: Variance reduction**

Two CM-Runs with new bands must show oscillator-rate ≤15% (current ~25% for DS, expected drop because the cliff is gone). If oscillator-rate stays at ~25%, the change does not address the diagnosis and should be reverted.

**P3: CONDITIONAL_ALLOW emission stability**

CA emissions across runs should stabilize. Old behavior: 7 emissions in Run 1, 2 in Run 2 (high variance because cliff-sensitive). New behavior expected: less run-to-run variance because predicate boundary is no longer at the score-cluster mode.

This is a soft expectation, not a gate. CA emission rate is a property of the case library, not a hard rule.

## Consequences

### Positive

- Eliminates the 0.75 cliff per construction (the score cluster mode is now safely in `supported`)
- Single-PR change, low blast radius (config + R1-floor constant + 3 new lock tests + fixture updates for T1/T7/T10/T11)
- Cost-neutral (no extra API calls, unlike ADR-0002)
- Compatible with future Verdict-Level aggregation if it becomes useful (does not foreclose ADR-0002-revision)

### Negative

- Score=0.50 now treated as `supported`. If 0.50 carries genuine "partial information" signal in the case library, that signal is collapsed into `supported`. Two consequences:
  - The `partial` band narrows from 0.49 width (0.25–0.74) to 0.24 width (0.25–0.49). Less resolution between unsupported and supported.
  - CONDITIONAL_ALLOW emissions may decrease because the supporting-step-CA-window also narrows. This is a feature trade-off, not a bug.
- Boundary-Test fixtures need updating, which is mechanical but error-prone. T6 must specifically be re-validated (the Hard-Rule against BLOCK→ALLOW lives there).

### Neutral

- Score-Floor semantics preserved (R1 floor adjusted in lockstep)
- ADR-0001 Verdict Model unchanged
- ADR-0002 stays rejected; this ADR explicitly does not re-open Triple-Majority

## Alternatives Considered

### A. Continuous failScore (Hermes' proposed Patch #3 in revised set)

Replace discrete predicate bands with a continuous score-to-failScore mapping. Eliminates cliffs entirely.

- ✅ Maximum cliff-elimination
- ❌ Larger architectural change (all score-floors must be re-calibrated to the continuous space)
- ❌ All 16 existing lock-tests must be re-derived
- ❌ Output format changes (continuous values in `metadata.conditions`)

Parked as **future ADR-0004 candidate**. If Threshold-Shift (this ADR) does not deliver expected variance reduction in P2, Continuous failScore is the next escalation. Worth a separate decision cycle, not bundled into this ADR.

### B. Verdict-Level Majority with Grok-Weighting (Hermes' revised Patch #2)

Use Grok as primary verdict source, DS+Gemini as ratifying votes.

- ❌ At r(Grok↔DS)=0.857 the second vote is largely redundant
- ❌ Costs 3× API calls for marginal stabilization
- ❌ Inherits CA-ordinal-tiebreak complexity (Paul's finding from ADR-0002 review)
- ❌ Does not address Threshold Fragility upstream

Rejected. If we trust Grok as primary, Single-Model + Threshold-Shift is cheaper and architecturally cleaner.

### C. Per-Model Calibration Weights (Hermes' original Patch #4)

Weight each model's score by inverse calibration error.

- ❌ Requires calibration dataset and re-calibration cadence
- ❌ Adds free parameters to a system that already has variance issues
- ❌ Does not address cliff (just shifts where each model's cliff is)

Rejected as last-resort fallback. Not on the current path.

### D. Drop Tier-Gating Entirely

Paul's tier proposal (Fast=Single, Standard=Verdict-Majority, Thorough=Step-Majority) was contingent on Step-Majority working. With Step-Majority rejected, the tier hierarchy collapses:
- Fast (Single-Model) and Thorough (Step-Majority) become Fast > Thorough in accuracy
- Standard (Verdict-Majority) inherits all the problems above

**Proposal**: Drop Tier-Gating from this ADR. Single-Model with Threshold-Shift becomes the canonical path. Verdict-Level Majority becomes a future optional feature **iff** it can be empirically shown to outperform Single-Model on the 82-case library. Today there is no such evidence.

This is a real architectural decision Paul should ratify explicitly.

## Implementation Sketch

### Phase 1: Code Changes (estimated <2h)

- `src/plan/graded-support-evaluator.ts`: predicate-band thresholds (3 constants)
- `src/plan/graded-support-evaluator.ts`: R1 score-floor (1 constant)
- `src/plan/test-*.ts`: T1, T7, T10, T11 fixture updates; T17–T19 new lock tests
- `src/plan/__fixtures__/`: any 0.50-bearing fixtures may need values shifted to 0.49 or 0.51 to preserve their original test intent

### Phase 2: Validation (estimated 1h, plus run time)

- Build clean, all existing tests green (≥256/256)
- Run T17–T19 to lock new predicate boundaries
- 2× Confusion-Matrix-Runs on 82-case library (replicates needed because variance is the thing we're measuring)
- Compare to Pauls Run 1 (81.7%, 7 CA, ~28% CA-range) and Run 2 (80.5%, 2 CA, ~5% CA-range) baselines

### Phase 3: Decision (Raul + Paul)

If P1 (Hard-Rules) holds and P2 (oscillator-rate ≤15%) is met:
- Ratify ADR-0003
- Merge PR
- Close ADR-0002 chapter

If P1 fails: hard reject. If P2 fails (oscillator-rate stays ~25%): revert and open ADR-0004 (Continuous failScore).

## Refs

- ADR-0001 (Verdict Model)
- ADR-0002 (Step-Level Triple-Majority, REJECTED)
- PR-E (#12) — 5-tier introduction
- PR #14, #15 — Plumbing fix for `CONDITIONAL_ALLOW`
- Hermes DS-Recon Report 2026-04-27 (`runs/ds-minus5pp-recon-2026-04-27.md`)
- Hermes Correlation Test 2026-04-27 (`runs/correlation-test-2026-04-27.md`)
- Post-Mortem 0001 — CA Plumbing Gap (PR #17)

---

**Status**: DRAFT pending P1+P2 validation
**Next steps**:
1. Raul + Paul review architectural direction (especially the Tier-Gating drop)
2. Implementation PR (Phase 1) — Computer or Hermes
3. Two-run CM validation on 82-case library (Phase 2)
4. Ratify or reject based on P1+P2 results
