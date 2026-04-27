# ADR-0002 (REJECTED): Step-Level Triple-Majority Aggregation

**Status**: ❌ REJECTED — Empirical preconditions failed
**Date proposed**: 2026-04-27
**Date rejected**: 2026-04-27 (same day, ~2h cycle)
**Deciders**: Raul, Paul, Hermes
**Editor**: Computer
**Replaced by**: ADR-0003 (Threshold-Shift)

---

## Why this ADR was rejected

Both empirical preconditions failed in Hermes' correlation test (`runs/correlation-test-2026-04-27.md`).

### Pearson correlations (P1 PRIMARY GATE)

| Pair | Baseline | +Ollama |
|---|---|---|
| Grok↔DS | **0.857** | **0.884** |
| Grok↔Gemini | **0.717** | **0.730** |
| DS↔Gemini | **0.746** | **0.689** |

All six values exceed the |r| < 0.6 ratification threshold. Models are strongly correlated, not independent. Triple-Majority cannot mediate disagreement when models systematically agree.

### Co-Clipping (P2)

40–64% co-clipping rate when one model sits at the 0.75 cliff, the others sit at the same cliff with 40–64% probability. Independent clipping was the second precondition; this also failed.

### The Killer Finding: Step-TMaj Underperforms Single-Model

Hermes' simulation on the 40-case library:

| Config | Grok | DS | Gemini | **Step-TMaj** |
|---|---|---|---|---|
| Baseline | 77.5% | 75.0% | 70.0% | **67.5%** |
| +Ollama | 82.5% | 70.0% | 70.0% | **65.0%** |

Step-Level Triple-Majority scores **worse** than every individual model, in both configurations.

### Mechanism: Union-of-Critiques Effect

Strict Majority predicate over `{supported, partial, unsupported}`:

```python
def majority_predicate(preds):
    c = Counter(preds)
    most = c.most_common(1)[0]
    if most[1] >= 2:
        return most[0]      # 2-of-3 wins
    return "partial"         # 3-way tie → middle
```

When models have **structurally similar** but **slightly offset** critiques (high correlation, different granularity), Majority emphasizes the **intersection** of critique loci, not the average position.

Worked example with 3 steps:

| Step | Grok | DS | Gemini | Strict Majority |
|---|---|---|---|---|
| s1 | unsupported | unsupported | partial | **unsupported** |
| s2 | partial | unsupported | unsupported | **unsupported** |
| s3 | unsupported | partial | unsupported | **unsupported** |

Each individual model sees 2 of 3 steps as unsupported (moderate failScore). Step-Majority sees **all 3** as unsupported (high failScore). Union of critiques, not consensus.

4 cases in Hermes' run had this exact pattern: all 3 models would correctly emit HOLD, but Step-Majority emitted BLOCK because the unsupported-loci accumulated across models.

### Methodological lesson

Triple-Majority is a strong stabilizer when model errors are **uncorrelated and symmetric**. With correlated structural critiques, Majority **amplifies** the union of weak signals rather than averaging them. This is a property of the data distribution, not the algorithm.

For PLV's case library, models see similar weak loci with slight offset. The right architecture must address Threshold Fragility upstream (at the score-to-predicate boundary), not downstream (at the predicate-to-verdict boundary).

## What replaces this ADR

**ADR-0003 (Threshold-Shift)**: narrow the `partial` band to `[0.25, 0.49]`, raise `supported` to `[0.50, 1.0]`, with simultaneous R1 score-floor adjustment to preserve semantic coherence (R1 "no quote" floor moves from 0.50 → 0.25 so that "no quote" is not classified as "supported").

## Process note (for future ADR archivists)

This ADR went from proposed to rejected in approximately 2 hours. The cycle was:

1. Hermes proposes Step-Level Triple-Majority based on DS-Recon (13:28)
2. Computer drafts ADR-0002 with cliff-specific Pearson preconditions (13:29–13:34)
3. Paul refines methodology (cliff-specific subpopulation, tier-gating, CA-ordinal-tiebreak) (14:00)
4. Computer updates ADR with Paul's architectural decisions (14:00–14:05)
5. Hermes runs correlation test, finds all preconditions fail, simulates Step-TMaj, finds it underperforms (14:05)
6. Hermes reverses own recommendation: "honest signal > self-consistency" (14:05)
7. ADR rejected, ADR-0003 (Threshold-Shift) opened (14:24)

Key factors that made this fast:
- Empirical preconditions written into the draft (not implicit assumptions)
- Hermes self-corrected when his own data falsified his recommendation
- Computer queried the simulation methodology to distinguish "data signal" from "implementation artifact" before pivoting (the BLOCK-bias finding turned out to be data signal, not artifact)
- Paul's cliff-specific methodology refinement made the test sharp enough to falsify cleanly

---

## Original draft preserved below for reference

---

---

## Context

PR-E (#12) introduced 5-tier verdicts. Validation runs revealed two related quality issues:

1. **LLM Scoring Variance** (Grok, two CM-Runs on 82-case library): ~28% vs ~5% supporting steps in the CA-range `(0, 0.75)` between runs of the same library. CA emissions varied from 7 to 2.

2. **Threshold Fragility** (DS, 4×4 runs on 40-case library): 25% of cases oscillate between runs because DS step-scores cluster on the 0.50/0.75 cliff. A ±0.25 jitter flips `supported→partial` and tips ALLOW→HOLD.

Score distribution histograms (Hermes, 4-run aggregate, 158 steps):

| Score | Grok | DeepSeek | Gemini |
|---|---|---|---|
| 0.00 | 64 | 77 | 71 |
| 0.25 | 11 | 9 | 24 |
| 0.50 | 30 | 17 | 13 |
| 0.75 | 18 | **32** | **31** |
| 1.00 | **36** | 24 | 20 |

DS and Gemini both clip overproportionally on 0.75 (the `supported→partial` cliff). Grok clips on 1.00 (safe distance from the cliff). This means single-model scoring is fundamentally fragile for two of three models.

The original PR-F roadmap proposed Verdict-Level Triple-Majority: 3 models each emit a verdict, aggregator picks majority. This addresses verdict-level oscillation but does **not** address step-score-level oscillation, which is upstream.

## Decision

Implement **Tier-Gated Multi-Model Aggregation**, with Step-Level Triple-Majority as the highest tier:

### Tier-dependent aggregation strategy

| Tier | Aggregation | Calls/Case | Stabilization | Pricing |
|---|---|---|---|---|
| **Fast** | Single-Model | ~5 (1× per step) | Accepts variance | $0.008 |
| **Standard** | Verdict-Level Majority | 3 per case | Moderate (verdict-only) | $0.02 |
| **Thorough** | Step-Level Majority | ~15 (3× per step) | Maximum (eliminates Threshold Fragility) | $0.08 |

The tier system makes the pricing structure architecturally grounded rather than arbitrary, and turns the cost concern into a feature gradation.

### Step-Level Majority (Thorough tier)

1. Each step is scored by 3 models in parallel: Grok 4.1 Fast, Gemini 3.1 Flash Lite, DeepSeek V4 Flash
2. Per-step, a **Majority-Predicate** determines the canonical step-score:
   - If 2 of 3 models agree on a discrete score band (`{0, 0.25, 0.5, 0.75, 1.0}`), use that band's representative
   - If all three disagree (rare): use median
3. The per-step canonical score feeds into existing `applyScoreFloors()` and `deriveVerdict()` unchanged
4. Output `metadata.model_agreement` per step: `{score: 0.75, voters: ["grok", "gemini"], dissenter: "deepseek@0.5"}` for observability

### Verdict-Level Majority (Standard tier)

1. Each model produces a complete `EvaluatorVerdict` independently
2. Aggregator picks majority over the **ordinal** verdict scale: `BLOCK < HOLD < CONDITIONAL_ALLOW < ALLOW`
3. **CA-Ordinal-Tiebreak rule** (caught by Paul, 2026-04-27): if three models give three different verdicts (e.g. ALLOW / CONDITIONAL_ALLOW / HOLD), the aggregator picks the **median** in ordinal order, not first-vote-wins. The median rule produces the safer-conservative choice when the three are split.
4. 1-1-1 splits (no majority, no median consensus) emit `DISSENT` per ADR-0001

This tier exists for users who want stabilization but cannot afford 3× step calls. It does not eliminate Threshold Fragility on individual step-scores — a single model's score-jitter can still flip its emitted verdict, and Majority operates on already-flipped verdicts. It is a less powerful but cheaper option.

## Preconditions (must be satisfied before ratification)

**P1: Model Independence — Cliff-Specific (PRIMARY GATE)**

Pearson correlation of step-scores between {Grok, DS, Gemini} pairs, **filtered to the subpopulation where at least one model scores in {0.50, 0.75}**, must satisfy |r| < 0.6 across the 40-case library.

Methodological rationale (Paul, 2026-04-27): global Pearson over all step-scores measures the wrong population. If DS and Gemini correlate at `score=0.0` and `score=1.0` (which is expected and benign — these are the deterministic verdict cases), it doesn't matter for Triple-Majority. What matters is correlation **on the cliff**, where the threshold fragility lives.

- |r| < 0.3 (cliff) → ratify as written
- 0.3 ≤ |r| < 0.6 (cliff) → ratify with caveat; consider hybrid with Patch #2 (threshold shift)
- |r| ≥ 0.6 (cliff) → reject this ADR; pursue Patch #2 as primary fix

Currently being measured by Hermes (`runs/correlation-test-2026-04-27.md`), updated brief 2026-04-27 14:00.

**P1-Sanity: Global Pearson (SECONDARY)**

Global Pearson over all step-scores must show the models are not pathologically correlated overall (|r| < 0.7 globally). This is a sanity check, not a gate. The cliff-specific P1 takes precedence.

**P2: 0.75-Clipping Independence**

Specifically, when DS scores 0.75 on a step, the joint distribution of Gemini's score on the same step must not be concentrated on 0.75. If DS and Gemini systematically both clip at 0.75 on the same steps, Majority would not break the tie.

Same Hermes run, sub-section.

## Consequences

### Positive

- Eliminates single-model oscillation by construction (3 independent samples per step)
- Removes Threshold Fragility from the system (~25% oscillator rate eliminated)
- Provides natural model-agreement telemetry for observability
- Self-correcting against any single model's drift over time

### Negative

- **API cost (Thorough tier)**: 3× calls per step. On 40 cases × ~5 steps = ~600 calls per run, vs ~200 in single-model. **Mitigated by tier gating** — only Thorough tier pays this cost.
- **Latency**: assuming parallel calls per step, latency = max(3 models) instead of 1, plus rate-limit pressure
- **Implementation complexity**: per-step model orchestration, error handling for partial failures (1 of 3 errors → fall back to 2 of 2 majority)
- **Operational dependency**: requires all 3 model providers to be reachable; degraded mode logic needed
- **Tier configuration surface**: users now have to choose a tier; default tier policy must be documented (proposed default: Standard for all interactive flows, Fast for batch/research, Thorough for safety-critical evaluation)

### Neutral

- Existing `EvaluatorVerdict` (4-tier) remains the per-model output; the multi-model aggregator emits `InternalVerdict` (5-tier, including DISSENT for 1-1-1 disagreements)
- Hard-Rules (0 BLOCK→ALLOW, 0 HOLD→ALLOW) must hold post-implementation; confusion-matrix-validated against 82-case library

## Alternatives Considered

### A. Verdict-Level Triple-Majority (original PR-F)

Each model emits a complete verdict; aggregator picks majority.

- ✅ Cheaper (3 calls per case, not per step)
- ✅ Simpler to implement
- ❌ Does **not** address Threshold Fragility — score-level oscillation propagates to verdict-level on a different distribution
- ❌ Single-model verdict = single-model accuracy ceiling for that model

Reject in favor of Step-Level if P1+P2 satisfied.

### B. Partial-Threshold Shift (Hermes' Patch #2)

Narrow the `partial` band from `[0.25, 0.74]` to `[0.25, 0.49]`. Score 0.50–0.74 becomes `supported`.

- ✅ Eliminates the 0.75 cliff entirely
- ✅ Cheap (config change, no architecture change)
- ❌ Would also reclassify 0.50 as `supported` — breaks T6 (`score=0` is Absence, not Weakness) iff there are 0.50-Absence-cases
- ❌ Requires confusion-matrix re-validation on 82-case library; high risk of BLOCK→ALLOW regression
- ❓ Effectiveness depends on actual score distribution — if 0.5 is a real "partial" signal, narrowing the band loses information

Could be ratified separately if P1 fails (i.e., models too correlated for Triple-Majority).

### C. Seed Pinning (Hermes' Patch #3, refined)

Original proposal: "DS temperature=0 + Seed Pinning". Code audit showed `temperature: 0` is already set in `graded-support-evaluator.ts:695`. The actionable component is **seed pinning** — `model-router.ts` currently has no seed parameter, requiring pass-through through `callModel`, `callModelStructured`, `callOpenAICompat`, and `callAnthropic`, plus tests.

- ✅ Reduces all-model Eigenvarianz directly (not just DS)
- ✅ Architecturally clean (seed is a standard OpenAI-API parameter)
- ❌ Doesn't address Threshold Fragility (models would still clip at 0.75 deterministically — just consistently)
- ❌ Mid-sized PR (~2h), not a one-liner

Should be done **independently of this ADR** as a Track-B0. Compatible with all other paths and reduces noise floor for ADR-0002 validation runs.

### D. Per-Model Calibration Weights (Hermes' Patch #4)

Assign different weights to each model's score based on calibration data; e.g., DS borderline scores weighted lower.

- ✅ Preserves all model signal
- ❌ Requires calibration dataset and re-calibration cadence
- ❌ Adds complexity to scoring pipeline
- ❌ Hard to test, hard to debug

Last-resort fallback.

## Implementation Sketch (if ratified)

### Phase 1: Infrastructure

- Refactor `evaluator.ts` to support pluggable per-step scorers
- Add `MultiModelScorer` class with parallel-call orchestration
- Add `MajorityPredicate` function: `(scores: number[]) => number` with documented tie-breaking
- Add `OrdinalVerdictMajority` function: `(verdicts: EvaluatorVerdict[]) => InternalVerdict` with median-rule tiebreaking on the `BLOCK < HOLD < CA < ALLOW` ordinal scale

### Phase 2: Integration

- Wire `MultiModelScorer` into `evaluateItem()` for critical steps (Thorough tier)
- Wire `OrdinalVerdictMajority` into post-evaluation aggregation (Standard tier)
- Tier-1 (Ollama) remains for non-critical steps as cost optimization across all tiers
- New CLI flag: `--aggregator fast | standard | thorough` (replaces `step-majority | verdict-majority | single`)
- Tier mapping documented: `fast → single-model`, `standard → verdict-majority`, `thorough → step-majority`

### Phase 3: Validation

- 4× CM-Runs on 82-case library, all three tiers compared:
  - Fast (current behavior baseline)
  - Standard (Verdict-Level Majority)
  - Thorough (Step-Level Majority)
- Hard-Rule check **per tier**: 0 BLOCK→ALLOW, 0 HOLD→ALLOW must hold for all three
- Oscillator-rate measurement per tier: target Thorough ≤5%, Standard ≤15%, Fast unchanged ~25%
- Cost + latency measurement per tier: validates the pricing-tier mapping

### Phase 4: Cutover

- Default `--aggregator standard` once Phase 3 passes
- Document tier policy: Fast for batch, Standard interactive default, Thorough for safety-critical
- Keep all three tiers available; this is feature gradation, not migration

## Refs

- ADR-0001 (Verdict Model)
- PR-E (#12) — 5-tier introduction
- PR #14, #15 — Plumbing fix for `CONDITIONAL_ALLOW`
- Hermes DS-Recon Report 2026-04-27 (`runs/ds-minus5pp-recon-2026-04-27.md`)
- Hermes Correlation Test (in progress, `runs/correlation-test-2026-04-27.md`)
- Post-Mortem 0001 — CA Plumbing Gap (PR #17)

---

**Status**: DRAFT pending cliff-specific correlation test
**Architectural decision (Paul, 2026-04-27)**: Tier-gated, Step-Level for Thorough tier, Verdict-Level for Standard tier with ordinal-median tiebreaking, Single-Model for Fast tier.
**Next steps**:
1. Hermes delivers correlation test (cliff-specific Pearson)
2. If P1 (cliff |r| < 0.6): ratify, open PR-F implementing Phase 1+2 (both Standard and Thorough tiers)
3. If P1 fails: archive this draft, pivot to Patch #2 (threshold shift) ADR; Standard tier may still be ratified in a reduced ADR since Verdict-Level Majority does not depend on cliff independence (it operates on emitted verdicts, not raw scores)
